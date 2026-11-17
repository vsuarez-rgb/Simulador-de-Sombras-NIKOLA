// Modelo del proyecto y conversión a geometría de cálculo.
import { add, boxPrim, D2R, mul, sub, triPrim, type Layout, type Module, type Prim, type Table, type V3 } from './engine';

export type RoofType = 'plano' | 'una_agua' | 'dos_aguas' | 'cuatro_aguas';
export interface House {
  enabled: boolean;
  x: number; y: number;          // centro en planta (X Este, Y Norte), m
  rot: number;                   // azimut del frente de la casa (0 = Norte)
  ancho: number; fondo: number;  // ancho a lo largo del frente, fondo perpendicular
  pisos: number; altoPiso: number;
  techo: RoofType; pendiente: number; alero: number; parapeto: number;
}
export type Mount = 'coplanar' | 'inclinada';
export type TiltRange = '10-15' | '15-30' | '30-60';
export const TILT_RANGES: Record<TiltRange, [number, number]> = { '10-15': [10, 15], '15-30': [15, 30], '30-60': [30, 60] };
export interface Field {
  id: string; nombre: string;
  x: number; y: number;          // centro del campo en planta
  montaje: Mount; rango: TiltRange; tilt: number; azim: number;
  filas: number; mods: number; enAlto: number; orient: 'V' | 'H';
  pitch: number; altura: number; // pitch (planta) entre filas para bases inclinadas; altura del borde inferior sobre la superficie
}
export type ObsType = 'arbol' | 'poste' | 'edificio' | 'muro' | 'chimenea';
export interface Obstacle { id: string; tipo: ObsType; x: number; y: number; alto: number; ancho: number; largo: number; rot: number; copa: number }
export interface ModuleSpec {
  largo: number; ancho: number; gap: number;
  pmax: number; voc: number; isc: number; vmp: number; imp: number; celdas: 60 | 72; gammaP: number; noct: number;
}
export type ElecTool = 'string' | 'optimizador' | 'excluir';
export interface StringCfg { id: string; nombre: string; mppt: number; mods: string[] }
export interface ElecConfig {
  mpptMin: number; mpptMax: number; nMppt: number; optEff: number;
  modo: 'auto' | 'manual'; modsPorString: number;
  strings: StringCfg[]; optimizados: string[]; excluidos: string[];
}
export interface Weather {
  nombre: string; fuente: string; tz: number; offset: number; lat?: number; lon?: number;
  // horas UTC del año: mes, día, hora UTC decimal (centro del intervalo), irradiancias W/m², temperatura °C
  m: number[]; d: number[]; h: number[]; ghi: number[]; dni: number[]; dhi: number[]; ta: number[];
}
export interface Site { nombre: string; lat: number; lon: number; tz: number; albedo: number }
export interface Project { version: 2; nombre: string; site: Site; modulo: ModuleSpec; house: House; fields: Field[]; obstacles: Obstacle[]; elec: ElecConfig; clima?: Weather | null }

export const DEFAULT_MODULE: ModuleSpec = {
  largo: 2.278, ancho: 1.134, gap: 0.02, pmax: 550, voc: 49.6, isc: 14.0, vmp: 41.6, imp: 13.22, celdas: 72, gammaP: -0.35, noct: 45,
};
export const DEFAULT_ELEC: ElecConfig = {
  mpptMin: 90, mpptMax: 560, nMppt: 2, optEff: 0.99, modo: 'auto', modsPorString: 10, strings: [], optimizados: [], excluidos: [],
};
/** Completa proyectos guardados con versiones anteriores. */
export function migrate(p: Project): Project {
  return { ...p, modulo: { ...DEFAULT_MODULE, ...p.modulo }, elec: { ...DEFAULT_ELEC, ...(p.elec ?? {}) }, clima: p.clima ?? null };
}
export const uid = () => Math.random().toString(36).slice(2, 8);

export function defaultProject(): Project {
  return {
    version: 2, nombre: 'Proyecto nuevo',
    site: { nombre: 'Santiago', lat: -33.45, lon: -70.66, tz: -3, albedo: 0.2 },
    modulo: DEFAULT_MODULE,
    elec: DEFAULT_ELEC, clima: null,
    house: { enabled: true, x: 0, y: 0, rot: 0, ancho: 12, fondo: 8, pisos: 2, altoPiso: 2.6, techo: 'dos_aguas', pendiente: 25, alero: 0.5, parapeto: 0.8 },
    fields: [
      { id: uid(), nombre: 'Techo norte', x: 0, y: 2.2, montaje: 'coplanar', rango: '10-15', tilt: 12, azim: 0, filas: 2, mods: 5, enAlto: 1, orient: 'V', pitch: 3, altura: 0.12 },
    ],
    obstacles: [
      { id: uid(), tipo: 'arbol', x: -11, y: 6, alto: 9, ancho: 0, largo: 0, rot: 0, copa: 5 },
      { id: uid(), tipo: 'edificio', x: 14, y: 3, alto: 9, ancho: 6, largo: 10, rot: 0, copa: 0 },
      { id: uid(), tipo: 'chimenea', x: 3.5, y: 1, alto: 1.2, ancho: 0.6, largo: 0.6, rot: 0, copa: 0 },
    ],
  };
}

// ---------- Casa ----------
export const eaveHeight = (h: House) => h.pisos * h.altoPiso;
function houseAxes(h: House) {
  const r = h.rot * D2R;
  // frente de la casa mira al azimut rot. Local x: a lo largo del frente; local z: hacia atrás.
  const ex: V3 = [Math.cos(r), 0, Math.sin(r)], ez: V3 = [-Math.sin(r), 0, Math.cos(r)];
  const c: V3 = [h.x, 0, -h.y];
  return { ex, ez, c };
}
export function toLocal(h: House, x: number, yN: number) {
  const { ex, ez, c } = houseAxes(h);
  const d: V3 = [x - c[0], 0, -yN - c[2]];
  return { lx: d[0] * ex[0] + d[2] * ex[2], lz: d[0] * ez[0] + d[2] * ez[2] };
}
function toWorld(h: House, lx: number, y: number, lz: number): V3 {
  const { ex, ez, c } = houseAxes(h);
  return add(add([c[0], y, c[2]], mul(ex, lx)), mul(ez, lz));
}
const halfDims = (h: House) => {
  const o = h.techo === 'plano' ? 0 : h.alero;
  return { Wh: h.ancho / 2 + o, Dh: h.fondo / 2 + o, o };
};
/** Altura del techo en un punto de planta; null si el punto no está sobre el techo. */
export function roofHeightAt(h: House, x: number, yN: number): number | null {
  if (!h.enabled) return null;
  const { lx, lz } = toLocal(h, x, yN), { Wh, Dh, o } = halfDims(h);
  if (Math.abs(lx) > Wh || Math.abs(lz) > Dh) return null;
  const H = eaveHeight(h), tp = Math.tan(h.pendiente * D2R), H0 = H - o * tp;
  switch (h.techo) {
    case 'plano': return H;
    case 'una_agua': return H0 + (lz + Dh) * tp;
    case 'dos_aguas': return H0 + (Dh - Math.abs(lz)) * tp;
    case 'cuatro_aguas': return H0 + Math.min(Dh - Math.abs(lz), Wh - Math.abs(lx)) * tp;
  }
}
/** Faldón del techo en un punto: inclinación y azimut de la superficie. */
export function roofFaceAt(h: House, x: number, yN: number): { tilt: number; azim: number; nombre: string } | null {
  if (roofHeightAt(h, x, yN) == null) return null;
  const { lx, lz } = toLocal(h, x, yN), { Wh, Dh } = halfDims(h), az = (d: number) => ((h.rot + d) % 360 + 360) % 360;
  switch (h.techo) {
    case 'plano': return { tilt: 0, azim: h.rot, nombre: 'techo plano' };
    case 'una_agua': return { tilt: h.pendiente, azim: az(0), nombre: 'faldón único' };
    case 'dos_aguas': return lz < 0 ? { tilt: h.pendiente, azim: az(0), nombre: 'faldón frontal' } : { tilt: h.pendiente, azim: az(180), nombre: 'faldón trasero' };
    case 'cuatro_aguas':
      if (Wh - Math.abs(lx) < Dh - Math.abs(lz)) return lx > 0 ? { tilt: h.pendiente, azim: az(90), nombre: 'faldón lateral der.' } : { tilt: h.pendiente, azim: az(270), nombre: 'faldón lateral izq.' };
      return lz < 0 ? { tilt: h.pendiente, azim: az(0), nombre: 'faldón frontal' } : { tilt: h.pendiente, azim: az(180), nombre: 'faldón trasero' };
  }
}
export const surfaceHeight = (p: Project, x: number, yN: number) => roofHeightAt(p.house, x, yN) ?? 0;

/** Triángulos del techo (y muros piñón) + caja de muros. Se usan para el cálculo y para dibujar. */
export function housePrims(h: House): Prim[] {
  if (!h.enabled) return [];
  const H = eaveHeight(h), tp = Math.tan(h.pendiente * D2R), { Wh, Dh, o } = halfDims(h), H0 = H - o * tp;
  const W2 = h.ancho / 2, D2 = h.fondo / 2;
  const P = (lx: number, y: number, lz: number) => toWorld(h, lx, y, lz);
  const out: Prim[] = [boxPrim(toWorld(h, 0, H / 2, 0), [W2, H / 2, D2], h.rot, 'muros')];
  const T = (a: V3, b: V3, c: V3, k = 'techo') => out.push(triPrim(a, b, c, k));
  const Q = (a: V3, b: V3, c: V3, d: V3, k = 'techo') => { T(a, b, c, k); T(a, c, d, k); };
  if (h.techo === 'plano') {
    if (h.parapeto > 0) {
      const t = 0.1, py = H + h.parapeto / 2, hy = h.parapeto / 2;
      out.push(boxPrim(toWorld(h, 0, py, -(D2 - t)), [W2, hy, t], h.rot, 'parapeto'));
      out.push(boxPrim(toWorld(h, 0, py, D2 - t), [W2, hy, t], h.rot, 'parapeto'));
      out.push(boxPrim(toWorld(h, -(W2 - t), py, 0), [t, hy, D2], h.rot, 'parapeto'));
      out.push(boxPrim(toWorld(h, W2 - t, py, 0), [t, hy, D2], h.rot, 'parapeto'));
    }
  } else if (h.techo === 'una_agua') {
    const yb = H0 + 2 * Dh * tp, yw = H0 + (D2 + Dh) * tp; // cumbrera (con alero) y altura en muro trasero
    Q(P(-Wh, H0, -Dh), P(Wh, H0, -Dh), P(Wh, yb, Dh), P(-Wh, yb, Dh));
    for (const s of [-1, 1]) T(P(s * W2, H, -D2), P(s * W2, H, D2), P(s * W2, yw, D2), 'muros');
    Q(P(-W2, H, D2), P(W2, H, D2), P(W2, yw, D2), P(-W2, yw, D2), 'muros');
  } else if (h.techo === 'dos_aguas') {
    const yr = H0 + Dh * tp;
    Q(P(-Wh, H0, -Dh), P(Wh, H0, -Dh), P(Wh, yr, 0), P(-Wh, yr, 0));
    Q(P(-Wh, H0, Dh), P(Wh, H0, Dh), P(Wh, yr, 0), P(-Wh, yr, 0));
    for (const s of [-1, 1]) T(P(s * W2, H, -D2), P(s * W2, H, D2), P(s * W2, yr, 0), 'muros');
  } else {
    // cuatro aguas: cumbrera a lo largo del lado más largo
    if (Wh >= Dh) {
      const yr = H0 + Dh * tp, rx = Wh - Dh;
      Q(P(-Wh, H0, -Dh), P(Wh, H0, -Dh), P(rx, yr, 0), P(-rx, yr, 0));
      Q(P(-Wh, H0, Dh), P(Wh, H0, Dh), P(rx, yr, 0), P(-rx, yr, 0));
      T(P(Wh, H0, -Dh), P(Wh, H0, Dh), P(rx, yr, 0)); T(P(-Wh, H0, -Dh), P(-Wh, H0, Dh), P(-rx, yr, 0));
    } else {
      const yr = H0 + Wh * tp, rz = Dh - Wh;
      Q(P(-Wh, H0, -Dh), P(-Wh, H0, Dh), P(0, yr, rz), P(0, yr, -rz));
      Q(P(Wh, H0, -Dh), P(Wh, H0, Dh), P(0, yr, rz), P(0, yr, -rz));
      T(P(-Wh, H0, -Dh), P(Wh, H0, -Dh), P(0, yr, -rz)); T(P(-Wh, H0, Dh), P(Wh, H0, Dh), P(0, yr, rz));
    }
  }
  return out;
}

// ---------- Campos de paneles ----------
/** Inclinación y azimut efectivos del campo (coplanar toma los del faldón donde está su centro). */
export function fieldOrientation(p: Project, f: Field) {
  const face = roofFaceAt(p.house, f.x, f.y);
  if (f.montaje === 'coplanar') {
    if (face && face.tilt > 0) return { tilt: face.tilt, azim: face.azim, superficie: face.nombre };
    return { tilt: 0, azim: f.azim, superficie: face ? face.nombre : 'suelo' };
  }
  return { tilt: f.tilt, azim: f.azim, superficie: face ? face.nombre : 'suelo' };
}

export interface FieldInfo { id: string; superficie: string; tilt: number; azim: number; avisos: string[]; corners: V3[] }

export function buildLayout(p: Project): { lay: Layout; fieldInfo: FieldInfo[] } {
  const tables: Table[] = [], modules: Module[] = [], fieldInfo: FieldInfo[] = [];
  const { largo, ancho, gap } = p.modulo;
  p.fields.forEach((f, fi) => {
    const o = fieldOrientation(p, f), beta = o.tilt * D2R, gam = o.azim * D2R;
    const fdir: V3 = [Math.sin(gam), 0, -Math.cos(gam)], u: V3 = [Math.cos(gam), 0, Math.sin(gam)];
    const v: V3 = add(mul(fdir, -Math.cos(beta)), [0, Math.sin(beta), 0]);
    const n: V3 = add(mul(fdir, Math.sin(beta)), [0, Math.cos(beta), 0]);
    const portrait = f.orient === 'V', mw = portrait ? ancho : largo, ml = portrait ? largo : ancho;
    const nLong = (p.modulo.celdas ?? 72) / 6;
    const nu = portrait ? 6 : nLong, nv = portrait ? nLong : 6;
    const W = f.mods * mw + (f.mods - 1) * gap, L = f.enAlto * ml + (f.enAlto - 1) * gap;
    const coplanar = f.montaje === 'coplanar';
    const pitch = coplanar ? (L + 0.05) * Math.cos(beta) : f.pitch;
    const depth = (f.filas - 1) * pitch + L * Math.cos(beta);
    const center: V3 = [f.x, 0, -f.y];
    const avisos: string[] = [], corners: V3[] = [];
    let onRoof = 0, offRoof = 0;
    for (let i = 0; i < f.filas; i++) {
      const lc = add(center, mul(fdir, depth / 2 - i * pitch));
      // altura: superficie bajo el borde inferior (coplanar: bajo el centro de la mesa, ajustado a la pendiente)
      let y: number;
      if (coplanar) {
        const mid = add(lc, mul(fdir, -L * Math.cos(beta) / 2));
        y = surfaceHeight(p, mid[0], -mid[2]) - (L / 2) * Math.sin(beta) + f.altura;
      } else y = surfaceHeight(p, lc[0], -lc[2]) + f.altura;
      const P = sub([lc[0], y, lc[2]], mul(u, W / 2));
      const id = tables.length;
      tables.push({ id, field: fi, P, u, v, n, W, L });
      for (const [a, b] of [[0, 0], [W, 0], [W, L], [0, L]]) {
        const c = add(add(P, mul(u, a)), mul(v, b)); corners.push(c);
        if (roofHeightAt(p.house, c[0], -c[2]) != null) onRoof++; else offRoof++;
      }
      for (let k = 0; k < f.enAlto; k++) for (let c = 0; c < f.mods; c++) {
        modules.push({
          id: `${fi + 1}.${i + 1}${f.enAlto > 1 ? String.fromCharCode(97 + k) : ''}.${c + 1}`,
          key: `${f.id}|${i}|${k}|${c}`,
          field: fi, table: id, a0: c * (mw + gap), b0: k * (ml + gap), mw, ml, nu, nv, portrait,
        });
      }
    }
    if (onRoof && offRoof) avisos.push('El campo sobresale del borde del techo');
    if (coplanar && o.superficie !== 'suelo' && onRoof) {
      // ¿cruza a otro faldón?
      const names = new Set(corners.map(c => roofFaceAt(p.house, c[0], -c[2])?.nombre).filter(Boolean));
      if (names.size > 1) avisos.push('El campo cruza la cumbrera / otro faldón');
    }
    if (f.montaje === 'inclinada') {
      const [a, b] = TILT_RANGES[f.rango];
      if (f.tilt < a || f.tilt > b) avisos.push(`Inclinación fuera del rango de la base (${a}–${b}°)`);
      const shadowFree = (L * Math.sin(beta)) / Math.tan(25 * D2R) + L * Math.cos(beta);
      if (f.filas > 1 && f.pitch < L * Math.cos(beta) + 0.05) avisos.push('Pitch menor que la proyección de la mesa (filas se traslapan)');
      else if (f.filas > 1 && f.pitch < shadowFree * 0.8) avisos.push('Pitch corto: habrá sombra entre filas en invierno');
    }
    fieldInfo.push({ id: f.id, superficie: o.superficie, tilt: o.tilt, azim: o.azim, avisos, corners });
  });

  const prims: Prim[] = [...housePrims(p.house)];
  for (const ob of p.obstacles) prims.push(...obstaclePrims(p, ob));
  return { lay: { tables, modules, prims }, fieldInfo };
}

export function obstacleBase(p: Project, ob: Obstacle) { return surfaceHeight(p, ob.x, ob.y); }
export function obstaclePrims(p: Project, ob: Obstacle): Prim[] {
  const x = ob.x, z = -ob.y, y0 = obstacleBase(p, ob);
  switch (ob.tipo) {
    case 'edificio': case 'muro': case 'chimenea':
      return [boxPrim([x, y0 + ob.alto / 2, z], [ob.ancho / 2, ob.alto / 2, ob.largo / 2], ob.rot, ob.tipo)];
    case 'arbol': {
      const r = ob.copa / 2, cy = y0 + ob.alto - r;
      return [{ type: 'sph', c: [x, cy, z], r, kind: 'copa' }, { type: 'cyl', c: [x, z], r: 0.15, y0, y1: Math.max(y0 + 0.1, cy - r * 0.5), kind: 'tronco' }];
    }
    case 'poste':
      return [{ type: 'cyl', c: [x, z], r: Math.max(0.05, ob.ancho / 2), y0, y1: y0 + ob.alto, kind: 'poste' }];
  }
}

// ---------- Distancias (planta) ----------
/** Distancia horizontal borde a borde entre un obstáculo y los muros de la casa, con los puntos más cercanos. */
export function distanceToHouse(p: Project, ob: Obstacle): { d: number; a: [number, number]; b: [number, number]; inside: boolean } | null {
  const h = p.house; if (!h.enabled) return null;
  const { lx, lz } = toLocal(h, ob.x, ob.y), W2 = h.ancho / 2, D2 = h.fondo / 2;
  const cx = Math.max(-W2, Math.min(W2, lx)), cz = Math.max(-D2, Math.min(D2, lz));
  const inside = Math.abs(lx) <= W2 && Math.abs(lz) <= D2;
  const rad = ob.tipo === 'arbol' ? ob.copa / 2 : ob.tipo === 'poste' ? ob.ancho / 2 : Math.hypot(ob.ancho, ob.largo) / 2 * 0.75;
  const dc = Math.hypot(lx - cx, lz - cz);
  const w = toWorld(h, cx, 0, cz);
  return { d: inside ? 0 : Math.max(0, dc - rad), a: [ob.x, ob.y], b: [w[0], -w[2]], inside };
}

// ---------- Strings ----------
export interface ResolvedStrings { strings: { name: string; mppt: number; mods: number[] }[]; optimized: number[]; excluded: number[]; avisos: string[]; stringOf: number[] }
/** Convierte la configuración eléctrica (auto o manual) en índices de módulos. */
export function resolveStrings(p: Project, lay: Layout): ResolvedStrings {
  const e = p.elec, idx = new Map(lay.modules.map((m, i) => [m.key, i]));
  const excluded = e.excluidos.map(k => idx.get(k)).filter((i): i is number => i != null);
  const exSet = new Set(excluded);
  const optimized = e.optimizados.map(k => idx.get(k)).filter((i): i is number => i != null && !exSet.has(i));
  const strings: ResolvedStrings['strings'] = [], avisos: string[] = [];
  if (e.modo === 'auto') {
    const n = Math.max(1, Math.round(e.modsPorString));
    p.fields.forEach((_, fi) => {
      // orden en serpentina por fila (como se cablea en terreno)
      const mods = lay.modules.map((m, i) => ({ m, i })).filter(x => x.m.field === fi && !exSet.has(x.i));
      const rows = new Map<string, typeof mods>();
      for (const x of mods) { const k = `${x.m.table}|${x.m.b0}`; if (!rows.has(k)) rows.set(k, []); rows.get(k)!.push(x); }
      const order: number[] = [];
      [...rows.values()].forEach((r, ri) => { r.sort((a, b) => a.m.a0 - b.m.a0); if (ri % 2) r.reverse(); order.push(...r.map(x => x.i)); });
      for (let s = 0; s < order.length; s += n) strings.push({ name: `S${strings.length + 1}`, mppt: 0, mods: order.slice(s, s + n) });
    });
    strings.forEach((s, i) => { s.mppt = i % Math.max(1, e.nMppt); });
  } else {
    for (const sc of e.strings) {
      const mods = sc.mods.map(k => idx.get(k)).filter((i): i is number => i != null && !exSet.has(i));
      if (mods.length) strings.push({ name: sc.nombre, mppt: Math.min(sc.mppt, e.nMppt - 1), mods });
    }
  }
  const stringOf = lay.modules.map(() => -1);
  strings.forEach((s, si) => s.mods.forEach(mi => { stringOf[mi] = si; }));
  const sinString = lay.modules.filter((_, i) => stringOf[i] < 0 && !exSet.has(i)).length;
  if (sinString) avisos.push(`${sinString} módulo(s) sin string asignado: no se cuentan en la energía`);
  const vmp = p.modulo.vmp, voc = p.modulo.voc;
  for (const s of strings) {
    if (s.mods.length * vmp < e.mpptMin) avisos.push(`${s.name}: Vmp ≈ ${(s.mods.length * vmp).toFixed(0)} V bajo el mínimo MPPT (${e.mpptMin} V)`);
    if (s.mods.length * voc * 1.12 > e.mpptMax * 1.1) avisos.push(`${s.name}: Voc en frío ≈ ${(s.mods.length * voc * 1.12).toFixed(0)} V, revisa el máximo del inversor`);
  }
  const byM = new Map<number, number[]>();
  strings.forEach(s => { if (!byM.has(s.mppt)) byM.set(s.mppt, []); byM.get(s.mppt)!.push(s.mods.length); });
  for (const [mp, ls] of byM) if (new Set(ls).size > 1) avisos.push(`MPPT ${mp + 1}: strings en paralelo con distinto número de módulos`);
  return { strings, optimized, excluded, avisos, stringOf };
}
