// Trayectorias solares para el visor 3D y el diagrama solar 2D (solo lectura del motor).
import { sunPosition } from '../engine/engine';
import type { Site } from '../engine/project';

export interface SunPt { h: number; el: number; az: number }

export const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

/** Posiciones del sol sobre el horizonte a lo largo de un día (hora local del sitio). */
export function sunArc(site: Site, y: number, m: number, d: number, step = 0.1): SunPt[] {
  const out: SunPt[] = [];
  for (let h = 0; h <= 24 + 1e-9; h += step) {
    const p = sunPosition(site.lat, site.lon, site.tz, y, m, d, h);
    if (p.el > 0) out.push({ h, el: p.el, az: p.az });
  }
  return out;
}

/** Posición del sol a cada hora en punto con el sol sobre el horizonte. */
export function sunHours(site: Site, y: number, m: number, d: number): SunPt[] {
  const out: SunPt[] = [];
  for (let h = 0; h <= 24; h++) {
    const p = sunPosition(site.lat, site.lon, site.tz, y, m, d, h);
    if (p.el > 0) out.push({ h, el: p.el, az: p.az });
  }
  return out;
}

/** Resumen del día: elevación máxima y horas de sol. */
export function daySummary(site: Site, y: number, m: number, d: number) {
  const a = sunArc(site, y, m, d, 1 / 30);
  if (!a.length) return { maxEl: 0, horas: 0, sale: null as number | null, pone: null as number | null };
  return { maxEl: Math.max(...a.map(p => p.el)), horas: a[a.length - 1].h - a[0].h, sale: a[0].h, pone: a[a.length - 1].h };
}

export const hhmm = (h: number) => { const hh = Math.floor(h), mm = Math.round((h - hh) * 60); return `${String(mm === 60 ? hh + 1 : hh).padStart(2, '0')}:${String(mm === 60 ? 0 : mm).padStart(2, '0')}`; };

/** Fechas de referencia: solsticios y equinoccio, con la estación según el hemisferio. */
export function refDays(lat: number) {
  const sur = lat < 0;
  return [
    { m: 6, d: 21, label: `21 jun · ${sur ? 'invierno' : 'verano'}`, color: sur ? '#5aa9e6' : '#e8743b' },
    { m: 3, d: 21, label: '21 mar / 21 sep · equinoccio', color: '#9aa4ab' },
    { m: 12, d: 21, label: `21 dic · ${sur ? 'verano' : 'invierno'}`, color: sur ? '#e8743b' : '#5aa9e6' },
  ];
}
