// Motor de cálculo de sombras. Sin dependencias: se usa en el hilo principal y en el Web Worker.
// Coordenadas: x = Este, y = arriba, z = Sur (Norte = -z). Azimut: 0 = Norte, 90 = Este (sentido horario).
export type V3 = [number, number, number];
export const D2R = Math.PI / 180, R2D = 180 / Math.PI;
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export interface Table { id: number; field: number; P: V3; u: V3; v: V3; n: V3; W: number; L: number }
export interface Module { id: string; field: number; table: number; a0: number; b0: number; mw: number; ml: number; nu: number; nv: number; portrait: boolean }
export interface Box { type: 'box'; c: V3; h: V3; ex: V3; ez: V3; rot: number; kind: string }
export interface Sph { type: 'sph'; c: V3; r: number; kind: string }
export interface Cyl { type: 'cyl'; c: [number, number]; r: number; y0: number; y1: number; kind: string }
export interface Tri { type: 'tri'; a: V3; e1: V3; e2: V3; kind: string; min: V3; max: V3 }
export type Prim = Box | Sph | Cyl | Tri;
export interface Layout { tables: Table[]; modules: Module[]; prims: Prim[] }

export function boxPrim(c: V3, h: V3, rotDeg: number, kind: string): Box {
  const r = rotDeg * D2R;
  return { type: 'box', c, h, ex: [Math.cos(r), 0, Math.sin(r)], ez: [-Math.sin(r), 0, Math.cos(r)], rot: rotDeg, kind };
}
export function triPrim(a: V3, b: V3, c: V3, kind: string): Tri {
  const min: V3 = [0, 1, 2].map(i => Math.min(a[i], b[i], c[i])) as V3;
  const max: V3 = [0, 1, 2].map(i => Math.max(a[i], b[i], c[i])) as V3;
  return { type: 'tri', a, e1: sub(b, a), e2: sub(c, a), kind, min, max };
}

// ---------- Sol ----------
export function dayOfYear(y: number, m: number, d: number) {
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 864e5) + 1;
}
/** Posición solar NOAA (precisión ~0.1°). hourLocal en horas decimales; tz = offset UTC (ej. -3). */
export function sunPosition(lat: number, lon: number, tz: number, y: number, m: number, d: number, hourLocal: number) {
  const doy = dayOfYear(y, m, d);
  const g = 2 * Math.PI / 365 * (doy - 1 + (hourLocal - tz - 12) / 24);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
    + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const tst = hourLocal * 60 + eqt + 4 * lon - 60 * tz;
  const ha = (tst / 4 - 180) * D2R, la = lat * D2R;
  const cz = Math.max(-1, Math.min(1, Math.sin(la) * Math.sin(decl) + Math.cos(la) * Math.cos(decl) * Math.cos(ha)));
  let el = 90 - Math.acos(cz) * R2D;
  if (el > -0.575) el += 1.02 / Math.tan((el + 10.3 / (el + 5.11)) * D2R) / 60; // refracción
  const az = ((Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(la) - Math.tan(decl) * Math.cos(la)) + Math.PI) * R2D + 360) % 360;
  return { el, az };
}
export function sunVector(el: number, az: number): V3 {
  const e = el * D2R, a = az * D2R;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
}
export interface Irr { dni: number; ghi: number; dhi: number }
/** Cielo despejado: DNI Meinel, GHI Haurwitz, DHI por diferencia. */
export function clearSky(el: number): Irr {
  if (el <= 0) return { dni: 0, ghi: 0, dhi: 0 };
  const zen = 90 - el, cz = Math.cos(zen * D2R);
  const am = 1 / (cz + 0.50572 * Math.pow(96.07995 - zen, -1.6364));
  const dni = 1353 * Math.pow(0.7, Math.pow(am, 0.678));
  const ghi = 1098 * cz * Math.exp(-0.057 / cz);
  return { dni, ghi, dhi: Math.max(0, ghi - dni * cz) };
}

// ---------- Intersecciones (rayo semi-infinito hacia el sol) ----------
const EPS = 1e-6;
function hitBox(p: V3, s: V3, b: Box) {
  const d = sub(p, b.c);
  const o = [dot(d, b.ex), d[1], dot(d, b.ez)], r = [dot(s, b.ex), s[1], dot(s, b.ez)];
  let t0 = EPS, t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(r[i]) < 1e-12) { if (Math.abs(o[i]) > b.h[i]) return false; continue; }
    let ta = (-b.h[i] - o[i]) / r[i], tb = (b.h[i] - o[i]) / r[i];
    if (ta > tb) [ta, tb] = [tb, ta];
    if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
    if (t0 > t1) return false;
  }
  return true;
}
function hitSph(p: V3, s: V3, c: Sph) {
  const oc = sub(p, c.c), b = dot(oc, s), disc = b * b - (dot(oc, oc) - c.r * c.r);
  return disc >= 0 && -b + Math.sqrt(disc) > EPS;
}
function hitCyl(p: V3, s: V3, c: Cyl) {
  const ox = p[0] - c.c[0], oz = p[2] - c.c[1], a = s[0] * s[0] + s[2] * s[2];
  let t0: number, t1: number;
  if (a < 1e-12) { if (ox * ox + oz * oz > c.r * c.r) return false; t0 = -Infinity; t1 = Infinity; }
  else {
    const b = ox * s[0] + oz * s[2], disc = b * b - a * (ox * ox + oz * oz - c.r * c.r);
    if (disc < 0) return false;
    const sq = Math.sqrt(disc); t0 = (-b - sq) / a; t1 = (-b + sq) / a;
  }
  if (s[1] > 1e-12) { t0 = Math.max(t0, (c.y0 - p[1]) / s[1]); t1 = Math.min(t1, (c.y1 - p[1]) / s[1]); }
  else if (p[1] < c.y0 || p[1] > c.y1) return false;
  return Math.max(t0, EPS) <= t1;
}
function hitTri(p: V3, s: V3, t: Tri) {
  // descarte rápido: el rayo sube y el triángulo está completamente bajo el punto
  if (s[1] > 0 && t.max[1] < p[1]) return false;
  const pv = cross(s, t.e2), det = dot(t.e1, pv);
  if (Math.abs(det) < 1e-12) return false;
  const inv = 1 / det, tv = sub(p, t.a), uu = dot(tv, pv) * inv;
  if (uu < 0 || uu > 1) return false;
  const qv = cross(tv, t.e1), vv = dot(s, qv) * inv;
  if (vv < 0 || uu + vv > 1) return false;
  return dot(t.e2, qv) * inv > EPS;
}
function hitTable(p: V3, s: V3, t: Table) {
  const den = dot(s, t.n);
  if (Math.abs(den) < 1e-12) return false;
  const tt = dot(sub(t.P, p), t.n) / den;
  if (tt <= EPS) return false;
  const q = sub(add(p, mul(s, tt)), t.P), a = dot(q, t.u), b = dot(q, t.v);
  return a >= 0 && a <= t.W && b >= 0 && b <= t.L;
}
export function occluded(p: V3, s: V3, lay: Layout, ownTable: number) {
  for (const t of lay.tables) if (t.id !== ownTable && hitTable(p, s, t)) return true;
  for (const pr of lay.prims) {
    if (pr.type === 'tri' ? hitTri(p, s, pr) : pr.type === 'box' ? hitBox(p, s, pr) : pr.type === 'sph' ? hitSph(p, s, pr) : hitCyl(p, s, pr)) return true;
  }
  return false;
}

export function cellPoint(lay: Layout, m: Module, iu: number, iv: number, fu = 0.5, fv = 0.5): V3 {
  const t = lay.tables[m.table];
  const a = m.a0 + (iu + fu) * m.mw / m.nu, b = m.b0 + (iv + fv) * m.ml / m.nv;
  return add(add(add(t.P, mul(t.u, a)), mul(t.v, b)), mul(t.n, 0.005));
}
const substringOf = (m: Module, iu: number, iv: number) => (m.portrait ? Math.floor(iu / 2) : Math.floor(iv / 2));

/** Fracción de la difusa isotrópica bloqueada para cada módulo (ponderada por coseno). */
export function diffuseShading(lay: Layout): number[] {
  const dirs: [V3, number][] = [];
  for (let el = 3; el < 90; el += 6) for (let az = 0; az < 360; az += 10) dirs.push([sunVector(el, az), Math.cos(el * D2R)]);
  return lay.modules.map(m => {
    const n = lay.tables[m.table].n;
    const pts = [[m.nu / 2 - 0.5, m.nv / 2 - 0.5], [0, 0], [m.nu - 1, 0], [0, m.nv - 1], [m.nu - 1, m.nv - 1]];
    let tot = 0, blk = 0;
    for (const [iu, iv] of pts) {
      const p = cellPoint(lay, m, iu, iv);
      for (const [s, w0] of dirs) {
        const w = w0 * dot(s, n); if (w <= 0) continue;
        tot += w; if (occluded(p, s, lay, m.table)) blk += w;
      }
    }
    return tot > 0 ? blk / tot : 0;
  });
}

export interface ModStep { geom: number; Gb: number; Gd: number; Gd0: number; Gr: number; Gtot: number; Psh: number; cells: Float32Array; Isub: number[] }
/** Un instante: sombra por celda (sub×sub puntos) y pérdida eléctrica con 3 diodos bypass. */
export function computeStep(lay: Layout, sv: V3, irr: Irr, fdiff: number[], albedo = 0.2, sub = 2): ModStep[] {
  const offs: number[] = []; for (let i = 0; i < sub; i++) offs.push((i + 0.5) / sub);
  const ns = sub * sub;
  return lay.modules.map((m, mi) => {
    const t = lay.tables[m.table], cb = t.n[1];
    const cosAOI = dot(sv, t.n);
    const Gb = sv[1] > 0 ? irr.dni * Math.max(0, cosAOI) : 0;
    const Gd0 = irr.dhi * (1 + cb) / 2, Gr = irr.ghi * albedo * (1 - cb) / 2;
    const nc = m.nu * m.nv, cells = new Float32Array(nc);
    let shaded = 0;
    if (Gb > 0) for (let iv = 0; iv < m.nv; iv++) for (let iu = 0; iu < m.nu; iu++) {
      let k = 0;
      for (const fu of offs) for (const fv of offs) if (occluded(cellPoint(lay, m, iu, iv, fu, fv), sv, lay, m.table)) k++;
      if (k) { cells[iv * m.nu + iu] = k / ns; shaded += k / ns; }
    }
    const Gd = Gd0 * (1 - fdiff[mi]), Gtot = Gb + Gd0 + Gr;
    const Isub = [Infinity, Infinity, Infinity];
    for (let iv = 0; iv < m.nv; iv++) for (let iu = 0; iu < m.nu; iu++) {
      const g = Gb * (1 - cells[iv * m.nu + iu]) + Gd + Gr, s = substringOf(m, iu, iv);
      if (g < Isub[s]) Isub[s] = g;
    }
    let best = 0;
    for (const I of Isub) { let c = 0; for (const J of Isub) if (J >= I - 1e-9) c++; best = Math.max(best, I * c); }
    return { geom: Gb > 0 ? shaded / nc : 0, Gb, Gd, Gd0, Gr, Gtot, Psh: best / 3, cells, Isub };
  });
}

// ---------- Acumulación ----------
export interface Acc { Gb: number; GbSh: number; GdLost: number; Gtot: number; Psh: number; cell: Float64Array }
export interface ModSummary { sombraDirecta: number; perdIrr: number; perdElec: number; cell: number[]; Gtot: number }
export const newAcc = (lay: Layout): Acc[] => lay.modules.map(m => ({ Gb: 0, GbSh: 0, GdLost: 0, Gtot: 0, Psh: 0, cell: new Float64Array(m.nu * m.nv) }));
export function accumulate(acc: Acc[], res: ModStep[], w: number) {
  res.forEach((r, i) => {
    const a = acc[i];
    a.Gb += r.Gb * w; a.GbSh += r.Gb * r.geom * w; a.GdLost += (r.Gd0 - r.Gd) * w; a.Gtot += r.Gtot * w; a.Psh += r.Psh * w;
    if (r.Gb > 0) for (let c = 0; c < r.cells.length; c++) if (r.cells[c]) a.cell[c] += r.Gb * r.cells[c] * w;
  });
}
export const summarize = (acc: Acc[]): ModSummary[] => acc.map(a => ({
  sombraDirecta: a.Gb > 0 ? a.GbSh / a.Gb : 0,
  perdIrr: a.Gtot > 0 ? (a.GbSh + a.GdLost) / a.Gtot : 0,
  perdElec: a.Gtot > 0 ? 1 - a.Psh / a.Gtot : 0,
  cell: Array.from(a.cell, x => (a.Gb > 0 ? x / a.Gb : 0)),
  Gtot: a.Gtot,
}));
export function arrayStats(res: ModStep[]) {
  let gb = 0, gbs = 0, gt = 0, ps = 0;
  res.forEach(r => { gb += r.Gb; gbs += r.Gb * r.geom; gt += r.Gtot; ps += r.Psh; });
  return { sombra: gb > 0 ? gbs / gb : 0, perdElec: gt > 0 ? 1 - ps / gt : 0, poa: gt / Math.max(1, res.length) };
}
