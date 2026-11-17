// Lectura de archivos de clima horario: Explorador Solar (TMY SAM CSV y formato PVsyst), EPW, PVGIS (CSV/JSON)
// y CSV genéricos con columnas Año/Mes/Día/Hora + GHI/DNI/DHI. Detecta automáticamente el desfase horario.
import { D2R, sunPosition } from './engine';
import type { Weather } from './project';

const norm = (s: string) => s.toLowerCase().replace(/["'\s_]/g, '').replace(/\[.*?\]/g, '');
const ALIAS: Record<string, string[]> = {
  year: ['year', 'año', 'ano', 'yr'], month: ['month', 'mes', 'mo'], day: ['day', 'dia', 'día', 'dy'],
  hour: ['hour', 'hora', 'hr', 'hh'], minute: ['minute', 'minuto', 'min', 'mm'],
  ghi: ['ghi', 'g(h)', 'globhor', 'globalhorizontal', 'gh', 'ghi(w/m2)', 'radiacionglobal', 'globalhorizontalirradiance'],
  dni: ['dni', 'gb(n)', 'beamnor', 'directnormal', 'bn', 'dirnor', 'dni(w/m2)', 'directnormalirradiance'],
  dhi: ['dhi', 'gd(h)', 'diffhor', 'diffusehorizontal', 'dh', 'dhi(w/m2)', 'diffusehorizontalirradiance'],
  ta: ['temperature', 'tdry', 'tamb', 't2m', 'temp', 'drybulb', 'temperatura', 'ta', 'airtemperature', 't'],
  time: ['time(utc)', 'time', 'date', 'fecha', 'datetime', 'timestamp'],
};
function findCol(cols: string[], key: string) {
  const al = ALIAS[key];
  let i = cols.findIndex(c => al.includes(c)); if (i >= 0) return i;
  if (key === 'ta' || key === 'minute' || key === 'time') return -1;
  i = cols.findIndex(c => al.some(a => a.length > 3 && c.startsWith(a))); return i;
}
const num = (s: string | undefined) => { const v = parseFloat((s ?? '').replace(',', '.')); return isFinite(v) ? v : NaN; };

interface Raw { m: number; d: number; h: number; ghi: number; dni: number; dhi: number; ta: number }
interface Parsed { rows: Raw[]; tz: number | null; lat?: number; lon?: number; nombre?: string; fuente: string; utc?: boolean }

function parseEpw(lines: string[]): Parsed {
  const loc = lines[0].split(',');
  const rows: Raw[] = [];
  for (const ln of lines.slice(8)) {
    const f = ln.split(','); if (f.length < 16) continue;
    rows.push({ m: +f[1], d: +f[2], h: +f[3] + (+f[4] || 0) / 60 - 1, ghi: +f[13], dni: +f[14], dhi: +f[15], ta: +f[6] });
  }
  return { rows, tz: num(loc[8]), lat: num(loc[6]), lon: num(loc[7]), nombre: loc[1], fuente: 'EPW' };
}

function parseTable(lines: string[], fileName: string): Parsed {
  const sample = lines.slice(0, 40).join('\n');
  const delim = [';', '\t', ','].map(d => [d, (sample.match(new RegExp(d === '\t' ? '\t' : d, 'g')) ?? []).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const split = (l: string) => l.split(delim).map(x => x.trim());
  // fila de encabezados: la primera que tenga columnas de radiación global
  let hi = -1;
  for (let i = 0; i < Math.min(lines.length, 80); i++) {
    const cols = split(lines[i].replace(/^#/, '')).map(norm);
    if (findCol(cols, 'ghi') >= 0 && (findCol(cols, 'dni') >= 0 || findCol(cols, 'dhi') >= 0)) { hi = i; break; }
  }
  if (hi < 0) throw new Error('No encontré columnas de radiación (GHI y DNI/DHI) en el archivo.');
  const cols = split(lines[hi].replace(/^#/, '')).map(norm);
  const C = Object.fromEntries(Object.keys(ALIAS).map(k => [k, findCol(cols, k)])) as Record<string, number>;
  // metadatos antes del encabezado (zona horaria, lat/lon), en formato "clave: valor" o fila de nombres + fila de valores
  const head = lines.slice(0, hi);
  let tz: number | null = null, lat: number | undefined, lon: number | undefined, nombre: string | undefined;
  const pick = (re: RegExp) => { for (const l of head) { const m = l.match(re); if (m) return num(m[1]); } return NaN; };
  for (let i = 0; i + 1 < head.length; i++) {
    const k = split(head[i]).map(norm), v = split(head[i + 1]);
    const at = (names: string[]) => k.findIndex(x => names.includes(x));
    const iTz = at(['timezone', 'tz', 'zonahoraria']), iLa = at(['latitude', 'latitud', 'lat']), iLo = at(['longitude', 'longitud', 'lon']), iC = at(['city', 'ciudad', 'site', 'sitio', 'location']);
    if (iTz >= 0 && isFinite(num(v[iTz]))) tz = num(v[iTz]);
    if (iLa >= 0 && isFinite(num(v[iLa]))) lat = num(v[iLa]);
    if (iLo >= 0 && isFinite(num(v[iLo]))) lon = num(v[iLo]);
    if (iC >= 0 && v[iC]) nombre = v[iC];
  }
  if (tz == null) { const t = pick(/time\s*zone[^-\d]*(-?\d+(?:[.,]\d+)?)/i); if (isFinite(t)) tz = t; }
  if (lat == null) { const t = pick(/latitud[e]?[^-\d]*(-?\d+(?:[.,]\d+)?)/i); if (isFinite(t)) lat = t; }
  if (lon == null) { const t = pick(/longitud[e]?[^-\d]*(-?\d+(?:[.,]\d+)?)/i); if (isFinite(t)) lon = t; }
  const isPvgis = C.time >= 0 && cols[C.time] === 'time(utc)';
  const rows: Raw[] = [];
  for (const ln of lines.slice(hi + 1)) {
    const f = split(ln); if (f.length < 3) continue;
    let m: number, d: number, h: number;
    if (C.month >= 0 && C.day >= 0 && C.hour >= 0) {
      m = num(f[C.month]); d = num(f[C.day]); h = num(f[C.hour]) + (C.minute >= 0 ? num(f[C.minute]) || 0 : 0) / 60;
    } else if (C.time >= 0) {
      const t = f[C.time];
      let mt = t.match(/^(\d{4})(\d{2})(\d{2}):(\d{2})(\d{2})/);                       // PVGIS 20070101:0010
      if (mt) { m = +mt[2]; d = +mt[3]; h = +mt[4] + +mt[5] / 60; }
      else if ((mt = t.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/))) { m = +mt[2]; d = +mt[3]; h = +mt[4] + +mt[5] / 60; }
      else if ((mt = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\s+(\d{1,2}):(\d{2})/))) { d = +mt[1]; m = +mt[2]; h = +mt[4] + +mt[5] / 60; }
      else continue;
    } else throw new Error('No encontré columnas de fecha/hora (Mes, Día, Hora) en el archivo.');
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && isFinite(h))) continue;
    rows.push({ m, d, h, ghi: num(f[C.ghi]), dni: C.dni >= 0 ? num(f[C.dni]) : NaN, dhi: C.dhi >= 0 ? num(f[C.dhi]) : NaN, ta: C.ta >= 0 ? num(f[C.ta]) : NaN });
  }
  const fuente = isPvgis ? 'PVGIS' : /sam|tmy/i.test(fileName) ? 'TMY (SAM CSV)' : /pvsyst/i.test(sample) ? 'PVsyst CSV' : 'CSV';
  return { rows, tz: isPvgis ? 0 : tz, lat, lon, nombre, fuente, utc: isPvgis };
}

/** Lee un archivo de clima y lo deja como horas UTC centradas, listo para simular. */
export function parseWeather(text: string, fileName: string, fallback: { lat: number; lon: number; tz: number }): Weather {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim().length);
  let P: Parsed;
  if (/^\s*\{/.test(text)) {
    const j = JSON.parse(text), hrs = j.hours ?? j.outputs?.tmy_hourly;
    if (!hrs) throw new Error('JSON sin datos horarios reconocibles.');
    P = {
      rows: hrs.map((r: Record<string, number | string>) => r.m != null ? { m: +r.m, d: +r.d, h: +r.h, ghi: +r.ghi, dni: +r.dni, dhi: +r.dhi, ta: +(r.ta ?? NaN) } : (() => {
        const t = String(r['time(UTC)']); return { m: +t.slice(4, 6), d: +t.slice(6, 8), h: +t.slice(9, 11) + +t.slice(11, 13) / 60, ghi: +r['G(h)'], dni: +r['Gb(n)'], dhi: +r['Gd(h)'], ta: +r['T2m'] };
      })()),
      tz: 0, fuente: 'PVGIS (JSON)', utc: true,
    };
  } else if (/^LOCATION,/i.test(lines[0])) P = parseEpw(lines);
  else P = parseTable(lines, fileName);

  const rows = P.rows.filter(r => !(r.m === 2 && r.d === 29) && isFinite(r.ghi));
  if (rows.length < 8000) throw new Error(`El archivo tiene ${rows.length} horas válidas; se esperan ~8760 (un año horario).`);
  const lat = P.lat ?? fallback.lat, lon = P.lon ?? fallback.lon, tz = P.tz ?? fallback.tz;

  // desfase: se elige el corrimiento que mejor alinea la GHI medida con la altura solar calculada
  let best = -Infinity, offset = 0;
  for (const o of [-1, -0.5, 0, 0.5, 1]) {
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < rows.length; i += 3) {
      const r = rows[i], el = sunPosition(lat, lon, tz, 2023, r.m, r.d, r.h + o).el, s = Math.max(0, Math.sin(el * D2R));
      sxy += r.ghi * s; sxx += r.ghi * r.ghi; syy += s * s;
    }
    const score = sxy / Math.sqrt(sxx * syy || 1);
    if (score > best) { best = score; offset = o; }
  }
  const W: Weather = { nombre: P.nombre || fileName, fuente: P.fuente, tz, offset, lat, lon, m: [], d: [], h: [], ghi: [], dni: [], dhi: [], ta: [] };
  for (const r of rows) {
    const hLocal = r.h + offset, pos = sunPosition(lat, lon, tz, 2023, r.m, r.d, hLocal), cz = Math.sin(Math.max(0, pos.el) * D2R);
    let { dni, dhi } = r; const ghi = Math.max(0, r.ghi);
    if (!isFinite(dhi) && isFinite(dni)) dhi = Math.max(0, ghi - dni * cz);
    if (!isFinite(dni) && isFinite(dhi)) dni = cz > 0.05 ? Math.max(0, (ghi - dhi) / cz) : 0;
    if (!isFinite(dni) || !isFinite(dhi)) { dni = 0; dhi = ghi; }
    W.m.push(r.m); W.d.push(r.d); W.h.push(hLocal - tz); W.ghi.push(ghi); W.dni.push(Math.max(0, dni)); W.dhi.push(Math.max(0, dhi)); W.ta.push(isFinite(r.ta) ? r.ta : 20);
  }
  return W;
}

export function weatherSummary(w: Weather) {
  const sum = (a: number[]) => a.reduce((s, x) => s + x, 0) / 1000;
  return { ghi: sum(w.ghi), dni: sum(w.dni), dhi: sum(w.dhi), tmed: w.ta.reduce((s, x) => s + x, 0) / w.ta.length, n: w.ghi.length };
}
