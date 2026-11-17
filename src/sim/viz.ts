import type { Module } from '../engine/engine';

/** Escala de pérdida 0–30 %: verde → amarillo Nikola → rojo. */
export function heat(t: number) {
  t = Math.max(0, Math.min(1, t / 0.3));
  const st: [number, number[]][] = [[0, [47, 163, 90]], [0.33, [250, 183, 4]], [1, [210, 64, 46]]];
  for (let i = 1; i < st.length; i++) if (t <= st[i][0]) {
    const [a, ca] = st[i - 1], [b, cb] = st[i], k = (t - a) / (b - a);
    return `rgb(${ca.map((c, j) => Math.round(c + (cb[j] - c) * k)).join(',')})`;
  }
  return 'rgb(210,64,46)';
}
export const pct = (x: number | undefined) => `${(100 * (x ?? 0)).toFixed(1)}%`;

export const PX = 16;
/** Dibuja el módulo en un canvas: celdas sombreadas (instante) o mapa de calor (día/año). */
export function drawModule(cv: HTMLCanvasElement, m: Module, cells: ArrayLike<number> | null, heatMode: boolean, night: boolean, selected: boolean) {
  const g = cv.getContext('2d')!;
  for (let iv = 0; iv < m.nv; iv++) for (let iu = 0; iu < m.nu; iu++) {
    const v = cells ? cells[iv * m.nu + iu] : 0;
    let col: string;
    if (heatMode) col = heat(v);
    else if (night) col = '#16293a';
    else col = `rgb(${Math.round(58 - 50 * v)},${Math.round(120 - 105 * v)},${Math.round(176 - 156 * v)})`;
    g.fillStyle = col;
    g.fillRect(iu * PX, (m.nv - 1 - iv) * PX, PX, PX);
  }
  g.strokeStyle = heatMode ? 'rgba(8,37,55,.45)' : 'rgba(200,215,225,.55)'; g.lineWidth = 1;
  for (let iu = 0; iu <= m.nu; iu++) { g.beginPath(); g.moveTo(iu * PX + 0.5, 0); g.lineTo(iu * PX + 0.5, cv.height); g.stroke(); }
  for (let iv = 0; iv <= m.nv; iv++) { g.beginPath(); g.moveTo(0, iv * PX + 0.5); g.lineTo(cv.width, iv * PX + 0.5); g.stroke(); }
  g.strokeStyle = selected ? '#FAB704' : '#d5dde3'; g.lineWidth = selected ? 6 : 3; g.strokeRect(0, 0, cv.width, cv.height);
}
