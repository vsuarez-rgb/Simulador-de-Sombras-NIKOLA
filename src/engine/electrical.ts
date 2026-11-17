// Modelo eléctrico: curva IV por celda (diodo simple), 3 diodos bypass por módulo, módulos en serie (string),
// strings en paralelo por MPPT, ventana de voltaje del inversor y optimizadores (buck por módulo).
import type { Layout, ModStep } from './engine';

export interface ModuleElec { pmax: number; voc: number; isc: number; vmp: number; imp: number; celdas: 60 | 72; gammaP: number; noct: number }
export interface CellModel { a: number; I0: number; Rs: number; isc: number; nSub: number; perSub: number }
export interface StringDef { name: string; mppt: number; mods: number[] }
export interface ElecSetup {
  cell: CellModel; strings: StringDef[]; optimized: number[];
  mpptMin: number; mpptMax: number; optEff: number; gammaP: number; noct: number;
}

const VBYPASS = -0.5;

/** Ajuste del modelo de celda a partir de la ficha técnica (Voc, Isc, Vmp, Imp). */
export function fitCell(me: ModuleElec): CellModel {
  const n = me.celdas, a = 1.2 * 0.025693; // factor de idealidad 1.2 a 25 °C
  const vocC = me.voc / n, vmpC = me.vmp / n;
  const I0 = me.isc / (Math.exp(vocC / a) - 1);
  const Rs = Math.max(0, (a * Math.log((me.isc - me.imp) / I0 + 1) - vmpC) / me.imp);
  return { a, I0, Rs, isc: me.isc, nSub: 3, perSub: n / 3 };
}

// ---------- substrings ----------
/** Grupos de celdas con igual fotocorriente dentro de cada substring (acelera mucho el cálculo). */
type SubGroups = { iph: number[]; cnt: number[]; minIph: number };
function moduleSubstrings(lay: Layout, mi: number, r: ModStep, cell: CellModel): SubGroups[] {
  const m = lay.modules[mi];
  const maps: Map<number, number>[] = [new Map(), new Map(), new Map()];
  for (let iv = 0; iv < m.nv; iv++) for (let iu = 0; iu < m.nu; iu++) {
    const g = r.Gbc * (1 - r.cells[iv * m.nu + iu]) + r.Gdu;
    const iph = Math.round((cell.isc * g) / 1000 * 2000) / 2000; // resolución 0.5 mA
    const s = m.portrait ? Math.floor(iu / 2) : Math.floor(iv / 2);
    maps[s].set(iph, (maps[s].get(iph) ?? 0) + 1);
  }
  return maps.map(mp => {
    const iph = [...mp.keys()], cnt = iph.map(k => mp.get(k)!);
    return { iph, cnt, minIph: Math.min(...iph) };
  });
}
function vSub(I: number, sg: SubGroups, c: CellModel) {
  if (I >= sg.minIph) return VBYPASS;
  let v = 0;
  for (let j = 0; j < sg.iph.length; j++) v += sg.cnt[j] * (c.a * Math.log((sg.iph[j] - I) / c.I0 + 1) - I * c.Rs);
  return Math.max(VBYPASS, v);
}
function vModule(I: number, subs: SubGroups[], c: CellModel) {
  let v = 0; for (const s of subs) v += vSub(I, s, c); return v;
}

/** Rejilla de corriente común: uniforme + puntos justo antes de cada "rodilla" de bypass. */
function currentGrid(allSubs: SubGroups[][], imax: number, n = 90) {
  const g: number[] = [];
  for (let k = 0; k < n; k++) g.push((imax * k) / (n - 1));
  for (const subs of allSubs) for (const s of subs) if (s.minIph > 0.01) { g.push(s.minIph * 0.999); g.push(s.minIph * 0.985); g.push(s.minIph * 0.96); }
  g.sort((a, b) => a - b);
  const out: number[] = [];
  for (const x of g) if (x >= 0 && (!out.length || x - out[out.length - 1] > imax * 1e-4)) out.push(x);
  return out;
}

/** Potencia de un módulo uniforme a irradiancia G (referencia sin sombra). */
export function uniformModulePower(G: number, c: CellModel) {
  if (G <= 0) return 0;
  const iph = (c.isc * G) / 1000, n = c.nSub * c.perSub;
  let best = 0;
  for (let k = 1; k < 200; k++) {
    const I = (iph * k) / 200, v = n * (c.a * Math.log((iph - I) / c.I0 + 1) - I * c.Rs);
    best = Math.max(best, I * v);
  }
  return best;
}

// ---------- strings y MPPT ----------
interface Curve { I: number[]; V: number[] }
/** Máxima potencia de un MPPT con varias curvas en paralelo, respetando la ventana de voltaje. */
function mpptPower(curves: Curve[], vmin: number, vmax: number): { p: number; v: number; parts: number[] } {
  if (!curves.length) return { p: 0, v: 0, parts: [] };
  if (curves.length === 1) {
    const { I, V } = curves[0];
    let best = 0, bv = 0;
    for (let k = 0; k < I.length; k++) if (V[k] >= vmin && V[k] <= vmax) { const p = I[k] * V[k]; if (p > best) { best = p; bv = V[k]; } }
    // punto en el borde de la ventana (interpolado) si la curva cruza vmin
    for (let k = 1; k < I.length; k++) if ((V[k - 1] - vmin) * (V[k] - vmin) < 0) {
      const t = (V[k - 1] - vmin) / (V[k - 1] - V[k]), i = I[k - 1] + t * (I[k] - I[k - 1]);
      if (i * vmin > best) { best = i * vmin; bv = vmin; }
    }
    return { p: best, v: bv, parts: [best] };
  }
  // paralelo: corriente de cada string a voltaje común (V(I) no creciente → se invierte por interpolación)
  const vtop = Math.min(vmax, Math.max(...curves.map(c => c.V[0])));
  let best = 0, bv = 0, bparts: number[] = curves.map(() => 0);
  for (let k = 0; k <= 160; k++) {
    const v = vmin + ((vtop - vmin) * k) / 160; if (v <= 0) continue;
    let itot = 0; const parts: number[] = [];
    for (const c of curves) { const i = currentAt(c, v); itot += i; parts.push(i * v); }
    if (itot * v > best) { best = itot * v; bv = v; bparts = parts; }
  }
  return { p: best, v: bv, parts: bparts };
}
function currentAt(c: Curve, v: number) {
  if (v > c.V[0]) return 0;
  for (let k = 1; k < c.I.length; k++) if (c.V[k] <= v) {
    const dv = c.V[k - 1] - c.V[k]; if (dv <= 1e-9) return c.I[k];
    return c.I[k - 1] + ((c.V[k - 1] - v) / dv) * (c.I[k] - c.I[k - 1]);
  }
  return c.I[c.I.length - 1];
}

export interface StepElec {
  ref: number; modMpp: number; actual: number; noOpt: number; allOpt: number;
  strings: { actual: number; modMpp: number; ref: number; v: number }[];
  modMppEach: Float64Array; modRef: Float64Array; removeGain: Float64Array; optGain: Float64Array;
}

/** Calcula todos los escenarios eléctricos de un instante (potencias en W). */
export function electricalStep(lay: Layout, res: ModStep[], es: ElecSetup, withMarginal: boolean): StepElec {
  const c = es.cell, N = lay.modules.length, opt = new Set(es.optimized), eta = es.optEff;
  const modMppEach = new Float64Array(N), modRef = new Float64Array(N), removeGain = new Float64Array(N), optGain = new Float64Array(N);
  for (let i = 0; i < N; i++) modRef[i] = uniformModulePower(res[i].Gref, c);
  const out: StepElec = { ref: 0, modMpp: 0, actual: 0, noOpt: 0, allOpt: 0, strings: [], modMppEach, modRef, removeGain, optGain };
  const byMppt = new Map<number, { cur: Curve; noopt: Curve; s: number }[]>();
  const sInfo: { grid: number[]; Vm: Float64Array[]; mpp: { p: number; i: number }[]; mods: number[] }[] = [];

  es.strings.forEach((st, si) => {
    const subs = st.mods.map(mi => moduleSubstrings(lay, mi, res[mi], c));
    const imax = Math.max(0.01, ...subs.flat().map(s => Math.max(...s.iph)));
    const grid = currentGrid(subs, imax);
    const Vm = subs.map(sb => Float64Array.from(grid, I => vModule(I, sb, c)));
    const mpp = Vm.map(v => { let best = 0, bi = 0; grid.forEach((I, k) => { if (I * v[k] > best) { best = I * v[k]; bi = I; } }); return { p: best, i: bi }; });
    st.mods.forEach((mi, j) => { modMppEach[mi] = mpp[j].p; });
    // curva del string con optimizadores seleccionados (buck: entrega su MPP si la corriente del string ≥ su Impp)
    const curV = grid.map((I, k) => st.mods.reduce((s, mi, j) => s + (opt.has(mi) ? (I >= mpp[j].i && I > 0 ? (mpp[j].p * eta) / I : Vm[j][k] * eta) : Vm[j][k]), 0));
    const nooV = grid.map((_, k) => Vm.reduce((s, v) => s + v[k], 0));
    const entry = { cur: { I: grid, V: curV }, noopt: { I: grid, V: nooV }, s: si };
    if (!byMppt.has(st.mppt)) byMppt.set(st.mppt, []);
    byMppt.get(st.mppt)!.push(entry);
    sInfo.push({ grid, Vm, mpp, mods: st.mods });
    out.strings.push({ actual: 0, modMpp: mpp.reduce((s, x) => s + x.p, 0), ref: st.mods.reduce((s, mi) => s + modRef[mi], 0), v: 0 });
  });

  for (const [, list] of byMppt) {
    const a = mpptPower(list.map(e => e.cur), es.mpptMin, es.mpptMax);
    const b = mpptPower(list.map(e => e.noopt), es.mpptMin, es.mpptMax);
    out.actual += a.p; out.noOpt += b.p;
    list.forEach((e, j) => { out.strings[e.s].actual = a.parts[j] ?? 0; out.strings[e.s].v = a.v; });
    // análisis marginal (string solo en su MPPT): eliminar el módulo, o agregarle un optimizador
    if (withMarginal && list.length === 1) {
      const si = list[0].s, { grid, Vm, mpp, mods } = sInfo[si], base = a.p;
      mods.forEach((mi, j) => {
        const Vrm = grid.map((_, k) => list[0].cur.V[k] - (opt.has(mi) ? (grid[k] >= mpp[j].i && grid[k] > 0 ? (mpp[j].p * eta) / grid[k] : Vm[j][k] * eta) : Vm[j][k]));
        removeGain[mi] += mpptPower([{ I: grid, V: Vrm }], es.mpptMin, es.mpptMax).p - base;
        if (!opt.has(mi)) {
          const Vo = grid.map((I, k) => Vrm[k] + (I >= mpp[j].i && I > 0 ? (mpp[j].p * eta) / I : Vm[j][k] * eta));
          optGain[mi] += mpptPower([{ I: grid, V: Vo }], es.mpptMin, es.mpptMax).p - base;
        }
      });
    }
  }
  for (const st of out.strings) { out.ref += st.ref; out.modMpp += st.modMpp; }
  out.allOpt = out.modMpp * eta;
  return out;
}

/** Factor de temperatura sobre la potencia (modelo NOCT). */
export function tempFactor(es: ElecSetup, ta: number, gpoa: number) {
  const tc = ta + ((es.noct - 20) / 800) * gpoa;
  return 1 + (es.gammaP / 100) * (tc - 25);
}
