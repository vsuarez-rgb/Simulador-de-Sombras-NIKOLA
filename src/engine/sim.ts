import { accumulate, arrayStats, clearSky, computeStep, dayOfYear, newAcc, summarize, sunPosition, sunVector, type Irr, type Layout, type ModSummary, type V3 } from './engine';
import { electricalStep, tempFactor, type ElecSetup } from './electrical';
import type { Weather } from './project';

export interface SimParams { lat: number; lon: number; tz: number; albedo: number; sub: number }
export interface DayProfile { h: number; sombra: number; perdElec: number; perdString: number; poa: number }
export interface MonthStat { sombra: number; perdElec: number; perdIrr: number; perdString: number; kwh: number }
export interface ElecResult {
  // energías anuales (o del día) en kWh DC
  ref: number; modMpp: number; actual: number; noOpt: number; allOpt: number;
  strings: { name: string; n: number; mppt: number; actual: number; modMpp: number; ref: number; vmpMax: number }[];
  mods: { mpp: number; ref: number; removeGain: number; optGain: number }[];
}
export interface DayResult { kind: 'dia'; mods: ModSummary[]; prof: DayProfile[]; elec: ElecResult | null }
export interface YearResult { kind: 'anio'; mods: ModSummary[]; months: MonthStat[]; fuente: string; elec: ElecResult | null }

interface Step { sv: V3; el: number; irr: Irr; doy: number; ta: number; w: number; month: number; h: number }

function newElec(lay: Layout, es: ElecSetup | null): ElecResult | null {
  if (!es) return null;
  return {
    ref: 0, modMpp: 0, actual: 0, noOpt: 0, allOpt: 0,
    strings: es.strings.map(s => ({ name: s.name, n: s.mods.length, mppt: s.mppt, actual: 0, modMpp: 0, ref: 0, vmpMax: 0 })),
    mods: lay.modules.map(() => ({ mpp: 0, ref: 0, removeGain: 0, optGain: 0 })),
  };
}

/** Recorre los pasos de tiempo, acumula sombra por módulo y energía por escenario eléctrico. */
function run(lay: Layout, fdiff: number[], sp: SimParams, steps: Step[], es: ElecSetup | null, marginal: boolean, onProgress?: (f: number) => void) {
  const acc = newAcc(lay), months: { acc: ReturnType<typeof newAcc>; ref: number; act: number; kwh: number }[] = [];
  for (let m = 0; m < 12; m++) months.push({ acc: newAcc(lay), ref: 0, act: 0, kwh: 0 });
  const E = newElec(lay, es), prof: DayProfile[] = [];
  let pmaxSeen: number[] = es ? es.strings.map(() => 0) : [];
  const every = Math.max(1, Math.floor(steps.length / 50));
  steps.forEach((st, k) => {
    const res = computeStep(lay, st.sv, st.irr, fdiff, { albedo: sp.albedo, sub: sp.sub, doy: st.doy, el: st.el });
    accumulate(acc, res, st.w); accumulate(months[st.month - 1].acc, res, st.w);
    let pRef = 0, pAct = 0;
    if (es && E) {
      const gAvg = res.reduce((s, r) => s + r.Gref, 0) / Math.max(1, res.length), tf = tempFactor(es, st.ta, gAvg), w = (st.w * tf) / 1000;
      const el = electricalStep(lay, res, es, marginal);
      E.ref += el.ref * w; E.modMpp += el.modMpp * w; E.actual += el.actual * w; E.noOpt += el.noOpt * w; E.allOpt += el.allOpt * w;
      el.strings.forEach((s, i) => {
        const S = E.strings[i]; S.actual += s.actual * w; S.modMpp += s.modMpp * w; S.ref += s.ref * w;
        if (s.actual > pmaxSeen[i]) { pmaxSeen[i] = s.actual; S.vmpMax = s.v; }
      });
      for (let i = 0; i < lay.modules.length; i++) {
        const M = E.mods[i]; M.mpp += el.modMppEach[i] * w; M.ref += el.modRef[i] * w; M.removeGain += el.removeGain[i] * w; M.optGain += el.optGain[i] * w;
      }
      pRef = el.ref; pAct = el.actual;
      const mo = months[st.month - 1]; mo.ref += el.ref * w; mo.act += el.actual * w; mo.kwh += el.actual * w;
    }
    if (st.w <= 0.1) prof.push({ h: st.h, ...arrayStats(res), perdString: pRef > 0 ? 1 - pAct / pRef : 0 });
    if (onProgress && k % every === 0) onProgress(k / steps.length);
  });
  pmaxSeen = [];
  const monthsOut: MonthStat[] = months.map(mo => {
    const a = mo.acc, gb = a.reduce((s, x) => s + x.Gb, 0), gbs = a.reduce((s, x) => s + x.GbSh, 0), gt = a.reduce((s, x) => s + x.Gtot, 0);
    const ps = a.reduce((s, x) => s + x.Psh, 0), gl = a.reduce((s, x) => s + x.GdLost, 0);
    return { sombra: gb > 0 ? gbs / gb : 0, perdElec: gt > 0 ? 1 - ps / gt : 0, perdIrr: gt > 0 ? (gbs + gl) / gt : 0, perdString: mo.ref > 0 ? 1 - mo.act / mo.ref : 0, kwh: mo.kwh };
  });
  return { mods: summarize(acc), months: monthsOut, prof, elec: E };
}

function clearStep(sp: SimParams, y: number, m: number, d: number, h: number, w: number): Step | null {
  const pos = sunPosition(sp.lat, sp.lon, sp.tz, y, m, d, h);
  if (pos.el <= 0.5) return null;
  return { sv: sunVector(pos.el, pos.az), el: pos.el, irr: clearSky(pos.el), doy: dayOfYear(y, m, d), ta: 20, w, month: m, h };
}

export function simulateDay(lay: Layout, fdiff: number[], sp: SimParams, es: ElecSetup | null, y: number, m: number, d: number, dtMin = 5): DayResult {
  const steps: Step[] = [];
  for (let h = 0; h < 24; h += dtMin / 60) { const s = clearStep(sp, y, m, d, h + dtMin / 120, dtMin / 60); if (s) steps.push(s); }
  const r = run(lay, fdiff, sp, steps, es, true);
  return { kind: 'dia', mods: r.mods, prof: r.prof, elec: r.elec };
}

/** Año con cielo despejado: 3 días representativos por mes, paso 15 min. */
export function simulateYearClear(lay: Layout, fdiff: number[], sp: SimParams, es: ElecSetup | null, y: number, onProgress?: (f: number) => void): YearResult {
  const dim = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31], steps: Step[] = [];
  for (let mo = 1; mo <= 12; mo++) for (const dd of [5, 15, 25]) for (let h = 0; h < 24; h += 0.25) {
    const s = clearStep(sp, y, mo, dd, h + 0.125, (0.25 * dim[mo - 1]) / 3); if (s) steps.push(s);
  }
  const r = run(lay, fdiff, sp, steps, es, true, onProgress);
  return { kind: 'anio', mods: r.mods, months: r.months, fuente: 'Cielo despejado', elec: r.elec };
}

/** Año con clima horario real (TMY de Explorador Solar, PVGIS, EPW...). 8760 horas. */
export function simulateYearWeather(lay: Layout, fdiff: number[], sp: SimParams, es: ElecSetup | null, w: Weather, onProgress?: (f: number) => void): YearResult {
  const steps: Step[] = [];
  for (let i = 0; i < w.ghi.length; i++) {
    if (w.ghi[i] <= 0) continue;
    const pos = sunPosition(sp.lat, sp.lon, 0, 2023, w.m[i], w.d[i], w.h[i]);
    if (pos.el <= 0.5) continue;
    steps.push({ sv: sunVector(pos.el, pos.az), el: pos.el, irr: { ghi: w.ghi[i], dni: w.dni[i], dhi: w.dhi[i] }, doy: dayOfYear(2023, w.m[i], w.d[i]), ta: w.ta[i], w: 1, month: w.m[i], h: w.h[i] });
  }
  const r = run(lay, fdiff, sp, steps, es, true, onProgress);
  return { kind: 'anio', mods: r.mods, months: r.months, fuente: `${w.fuente} · ${w.nombre}`, elec: r.elec };
}
