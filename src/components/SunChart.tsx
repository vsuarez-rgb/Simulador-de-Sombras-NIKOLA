// Diagrama solar 2D: trayectorias del sol (día 21 de cada mes) en azimut × elevación, líneas horarias,
// el día elegido y la silueta de lo que tapa el sol visto desde un módulo (casa, objetos, otros campos).
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { cellPoint, occluded, sunVector, type Layout } from '../engine/engine';
import { useStore } from '../store';
import { MESES, sunArc, sunHours, type SunPt } from '../sim/sunpath';
import { parseFecha, useSim } from '../sim/useSim';

const STEP = 2; // resolución de la silueta (grados)

/** Celdas (azimut, elevación) de STEP° en las que el sol queda tapado, vistas desde un punto del módulo. */
function horizonMask(lay: Layout, idx: number): Uint8Array | null {
  const m = lay.modules[idx]; if (!m) return null;
  const p = cellPoint(lay, m, Math.floor(m.nu / 2), Math.floor(m.nv / 2));
  const nA = 360 / STEP, nE = 90 / STEP, out = new Uint8Array(nA * nE);
  for (let i = 0; i < nA; i++) for (let j = 0; j < nE; j++) {
    if (occluded(p, sunVector((j + 0.5) * STEP, (i + 0.5) * STEP), lay, m.table)) out[i * nE + j] = 1;
  }
  return out;
}

/** Módulo más cercano al centro del conjunto: punto de vista por defecto. */
function centralModule(lay: Layout): number {
  if (!lay.modules.length) return -1;
  const pts = lay.modules.map(m => cellPoint(lay, m, Math.floor(m.nu / 2), Math.floor(m.nv / 2)));
  const c = pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length, a[2] + p[2] / pts.length], [0, 0, 0]);
  let best = 0, bd = Infinity;
  pts.forEach((p, i) => { const d = (p[0] - c[0]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; best = i; } });
  return best;
}

export default function SunChart({ height = 170 }: { height?: number }) {
  const { lay, sun } = useSim();
  const site = useStore(s => s.project.site), fecha = useStore(s => s.fecha), selModule = useStore(s => s.selModule);
  const ref = useRef<HTMLCanvasElement>(null);
  const [w, setW] = useState(400);
  useEffect(() => { const ro = new ResizeObserver(e => setW(e[0].contentRect.width)); if (ref.current) ro.observe(ref.current); return () => ro.disconnect(); }, []);
  const { y, m, d } = parseFecha(fecha);
  const sur = site.lat < 0;
  const viewIdx = selModule >= 0 && selModule < lay.modules.length ? selModule : centralModule(lay);
  // la silueta se recalcula con prioridad baja para no trabar la escritura en los campos
  const dLay = useDeferredValue(lay), dIdx = useDeferredValue(viewIdx);
  const mask = useMemo(() => (dIdx >= 0 ? horizonMask(dLay, dIdx) : null), [dLay, dIdx]);
  const curves = useMemo(() => Array.from({ length: 12 }, (_, i) => sunArc(site, y, i + 1, 21, 0.1)), [site, y]);
  const hourPts = useMemo(() => Array.from({ length: 12 }, (_, i) => sunHours(site, y, i + 1, 21)), [site, y]);
  const today = useMemo(() => sunArc(site, y, m, d, 0.1), [site, y, m, d]);

  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const dpr = window.devicePixelRatio || 1; cv.width = w * dpr; cv.height = height * dpr;
    const g = cv.getContext('2d')!; g.scale(dpr, dpr); g.clearRect(0, 0, w, height);
    const L = 30, T = 8, B = 18, Rm = 8, pw = w - L - Rm, ph = height - T - B;
    // Eje X centrado en el ecuador (N en el hemisferio sur, S en el norte), mañana a la izquierda
    const xr = (az: number) => { const a = sur ? -(((az + 180) % 360 + 360) % 360 - 180) : ((az % 360) + 360) % 360 - 180; return a; };
    const X = (az: number) => L + ((xr(az) + 180) / 360) * pw, Y = (el: number) => T + ph - (el / 90) * ph;
    // cuadrícula
    g.font = '9px Montserrat, Arial'; g.strokeStyle = '#1d4560'; g.lineWidth = 1; g.fillStyle = '#9fb0bd';
    for (let e = 0; e <= 90; e += 15) { const yy = Math.round(Y(e)) + 0.5; g.beginPath(); g.moveTo(L, yy); g.lineTo(L + pw, yy); g.stroke(); g.textAlign = 'right'; g.fillText(e + '°', L - 4, yy + 3); }
    const card: [number, string][] = sur ? [[90, 'E'], [45, 'NE'], [0, 'N'], [315, 'NO'], [270, 'O'], [180, 'S']] : [[90, 'E'], [135, 'SE'], [180, 'S'], [225, 'SO'], [270, 'O'], [0, 'N']];
    g.textAlign = 'center';
    const edge = sur ? 'S' : 'N'; // el punto opuesto al ecuador queda en ambos bordes
    for (const [az, n] of card) {
      const xs = n === edge ? [L, L + pw] : [X(az)];
      for (const xx of xs) { g.beginPath(); g.moveTo(Math.round(xx) + 0.5, T); g.lineTo(Math.round(xx) + 0.5, T + ph); g.stroke(); g.fillText(n, Math.min(Math.max(xx, L + 6), L + pw - 6), T + ph + 12); }
    }
    // silueta de obstáculos
    if (mask) {
      const nE = 90 / STEP; g.fillStyle = 'rgba(105,128,144,.85)';
      for (let i = 0; i < 360 / STEP; i++) for (let j = 0; j < nE; j++) if (mask[i * nE + j]) {
        const a0 = i * STEP, x0 = X(a0), x1 = X(a0 + STEP);
        if (Math.abs(x1 - x0) > pw / 2) continue; // celda que cruza el borde del gráfico
        g.fillRect(Math.min(x0, x1), Y((j + 1) * STEP), Math.abs(x1 - x0) + 0.6, ph / nE + 0.6);
      }
    }
    const path = (pts: SunPt[]) => { g.beginPath(); let prev: number | null = null; pts.forEach((p, k) => { const xx = X(p.az), yy = Y(p.el); if (k === 0 || (prev !== null && Math.abs(xx - prev) > pw / 2)) g.moveTo(xx, yy); else g.lineTo(xx, yy); prev = xx; }); g.stroke(); };
    // líneas horarias (misma hora a lo largo del año)
    g.strokeStyle = 'rgba(245,204,90,.35)'; g.lineWidth = 1; g.setLineDash([2, 3]);
    for (let h = 0; h <= 24; h++) {
      const pts = [5, 4, 3, 2, 1, 0, 11, 10, 9, 8, 7, 6].map(i => hourPts[i].find(p => p.h === h)).filter((p): p is SunPt => !!p);
      if (pts.length > 1) path(pts);
      const top = pts.reduce<SunPt | null>((b, p) => (!b || p.el > b.el ? p : b), null);
      if (top && top.el > 4) { g.fillStyle = 'rgba(245,204,90,.8)'; g.textAlign = 'center'; g.fillText(h + 'h', X(top.az), Y(top.el) - 4); }
    }
    g.setLineDash([]);
    // trayectorias del día 21 de cada mes: ene–jun y dic (jul–nov casi coinciden con su par simétrico)
    curves.forEach((c, i) => {
      if (i >= 6 && i <= 10) return;
      const winter = sur ? i === 5 : i === 11, summer = sur ? i === 11 : i === 5;
      g.strokeStyle = winter ? '#5aa9e6' : summer ? '#e8743b' : 'rgba(201,212,220,.55)'; g.lineWidth = winter || summer ? 1.6 : 1;
      path(c);
    });
    // etiquetas de meses en el borde izquierdo de cada curva
    g.textAlign = 'left'; g.fillStyle = '#c9d4dc';
    for (const [i, n] of [[5, 'jun'], [4, 'may/jul'], [3, 'abr/ago'], [2, 'mar/sep'], [1, 'feb/oct'], [0, 'ene/nov'], [11, 'dic']] as [number, string][]) {
      const c = curves[i], top = c.reduce<SunPt | null>((b, p) => (!b || p.el > b.el ? p : b), null);
      if (top) g.fillText(n, X(top.az) + 4, Y(top.el) + 3);
    }
    // día elegido y sol actual
    g.strokeStyle = '#FAB704'; g.lineWidth = 2.5; path(today);
    if (sun.el > 0) { g.fillStyle = '#FAB704'; g.strokeStyle = '#082537'; g.lineWidth = 1.5; g.beginPath(); g.arc(X(sun.az), Y(sun.el), 5, 0, Math.PI * 2); g.fill(); g.stroke(); }
  }, [w, height, sur, mask, curves, hourPts, today, sun]);

  const viewName = viewIdx >= 0 ? lay.modules[viewIdx].id : null;
  return (
    <div className="sunchart">
      <canvas ref={ref} style={{ height }} />
      <div className="sunleg">
        <span><i style={{ background: '#FAB704' }} />{d} {MESES[m - 1].toLowerCase()} (día elegido)</span>
        <span><i style={{ background: '#5aa9e6' }} />invierno</span>
        <span><i style={{ background: '#e8743b' }} />verano</span>
        <span><i style={{ background: 'rgba(105,128,144,.85)' }} />{viewName ? <>tapa el sol, visto desde el módulo <b>{viewName}</b>{selModule < 0 ? ' (centro; haz clic en otro módulo para cambiar)' : ''}</> : 'agrega paneles para ver la silueta de sombras'}</span>
      </div>
    </div>
  );
}
