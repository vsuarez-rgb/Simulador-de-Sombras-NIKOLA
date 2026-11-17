import { accumulate, arrayStats, clearSky, computeStep, newAcc, summarize, sunPosition, sunVector, type Layout, type ModSummary } from './engine';

export interface SimParams { lat: number; lon: number; tz: number; albedo: number; sub: number }
export interface TmyHour { m: number; d: number; h: number; ghi: number; dni: number; dhi: number } // h = hora UTC decimal
export interface DayProfile { h: number; sombra: number; perdElec: number; poa: number }
export interface MonthStat { sombra: number; perdElec: number; perdIrr: number }
export interface DayResult { kind: 'dia'; mods: ModSummary[]; prof: DayProfile[] }
export interface YearResult { kind: 'anio'; mods: ModSummary[]; months: MonthStat[]; fuente: string }

export function simulateDay(lay: Layout, fdiff: number[], sp: SimParams, y: number, m: number, d: number, dtMin = 5): DayResult {
  const acc = newAcc(lay), prof: DayProfile[] = [];
  for (let h = 0; h < 24; h += dtMin / 60) {
    const hc = h + dtMin / 120, pos = sunPosition(sp.lat, sp.lon, sp.tz, y, m, d, hc);
    if (pos.el <= 0.5) continue;
    const res = computeStep(lay, sunVector(pos.el, pos.az), clearSky(pos.el), fdiff, sp.albedo, sp.sub);
    accumulate(acc, res, dtMin / 60);
    prof.push({ h: hc, ...arrayStats(res) });
  }
  return { kind: 'dia', mods: summarize(acc), prof };
}

function monthStat(lay: Layout, accM: ReturnType<typeof newAcc>): MonthStat {
  const gb = accM.reduce((s, a) => s + a.Gb, 0), gbs = accM.reduce((s, a) => s + a.GbSh, 0);
  const gt = accM.reduce((s, a) => s + a.Gtot, 0), ps = accM.reduce((s, a) => s + a.Psh, 0), gl = accM.reduce((s, a) => s + a.GdLost, 0);
  void lay;
  return { sombra: gb > 0 ? gbs / gb : 0, perdElec: gt > 0 ? 1 - ps / gt : 0, perdIrr: gt > 0 ? (gbs + gl) / gt : 0 };
}
function merge(acc: ReturnType<typeof newAcc>, accM: ReturnType<typeof newAcc>) {
  accM.forEach((a, i) => {
    const t = acc[i]; t.Gb += a.Gb; t.GbSh += a.GbSh; t.GdLost += a.GdLost; t.Gtot += a.Gtot; t.Psh += a.Psh;
    for (let c = 0; c < a.cell.length; c++) t.cell[c] += a.cell[c];
  });
}

/** Año con cielo despejado: 3 días representativos por mes, paso 15 min. */
export function simulateYearClear(lay: Layout, fdiff: number[], sp: SimParams, y: number, onProgress?: (f: number) => void): YearResult {
  const dim = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31], acc = newAcc(lay), months: MonthStat[] = [];
  for (let mo = 1; mo <= 12; mo++) {
    const accM = newAcc(lay);
    for (const dd of [5, 15, 25]) for (let h = 0; h < 24; h += 0.25) {
      const pos = sunPosition(sp.lat, sp.lon, sp.tz, y, mo, dd, h + 0.125);
      if (pos.el <= 0.5) continue;
      accumulate(accM, computeStep(lay, sunVector(pos.el, pos.az), clearSky(pos.el), fdiff, sp.albedo, sp.sub), 0.25 * dim[mo - 1] / 3);
    }
    months.push(monthStat(lay, accM)); merge(acc, accM); onProgress?.(mo / 12);
  }
  return { kind: 'anio', mods: summarize(acc), months, fuente: 'Cielo despejado' };
}

/** Año con clima típico (TMY de PVGIS), 8760 horas. */
export function simulateYearTmy(lay: Layout, fdiff: number[], sp: SimParams, tmy: TmyHour[], onProgress?: (f: number) => void): YearResult {
  const acc = newAcc(lay), months: MonthStat[] = [];
  let accM = newAcc(lay), cur = tmy[0]?.m ?? 1;
  tmy.forEach((r, i) => {
    if (r.m !== cur) { months.push(monthStat(lay, accM)); merge(acc, accM); accM = newAcc(lay); cur = r.m; onProgress?.(i / tmy.length); }
    if (r.ghi <= 0) return;
    // año fijo no bisiesto; hora UTC → tz = 0. Se evalúa en el centro de la hora.
    const pos = sunPosition(sp.lat, sp.lon, 0, 2023, r.m, r.d, r.h + 0.5);
    if (pos.el <= 0.5) return;
    accumulate(accM, computeStep(lay, sunVector(pos.el, pos.az), { ghi: r.ghi, dni: r.dni, dhi: r.dhi }, fdiff, sp.albedo, sp.sub), 1);
  });
  months.push(monthStat(lay, accM)); merge(acc, accM);
  return { kind: 'anio', mods: summarize(acc), months, fuente: 'PVGIS TMY' };
}
