// Editor de planta 2D (paso 1): se dibujan los volúmenes de la casa con líneas.
// Herramienta "Dibujar": clic donde empieza la fachada, clic donde termina, y clic hacia atrás para el fondo.
// Arrastrar el fondo desplaza la vista; la rueda hace zoom. Los objetos no se arrastran con el mouse:
// se mueven y giran desde la ficha del panel lateral.
import { useEffect, useMemo, useRef, useState } from 'react';
import { insideBlock, type Volume, type VolTipo } from '../engine/project';
import { useSim } from '../sim/useSim';
import { useStore } from '../store';

type P = [number, number]; // planta: X Este, Y Norte (m)
const TIPOS: [VolTipo, string][] = [['casa', 'Casa'], ['ampliacion', 'Ampliación'], ['quincho', 'Quincho'], ['garage', 'Garage / bodega']];
const D2R = Math.PI / 180;

/** Esquinas de un volumen en planta (frente primero). */
function volCorners(v: Pick<Volume, 'x' | 'y' | 'rot' | 'ancho' | 'fondo'>): P[] {
  const r = v.rot * D2R, ex: P = [Math.cos(r), -Math.sin(r)], ez: P = [-Math.sin(r), -Math.cos(r)], W = v.ancho / 2, D = v.fondo / 2;
  return ([[-W, -D], [W, -D], [W, D], [-W, D]] as P[]).map(([lx, lz]) => [v.x + lx * ex[0] + lz * ez[0], v.y + lx * ex[1] + lz * ez[1]]);
}
const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
const len = (a: P) => Math.hypot(a[0], a[1]);
const fmt = (m: number) => `${m.toFixed(m < 10 ? 2 : 1)} m`;

export default function PlanEditor() {
  const vs = useStore(s => s.project.volumes), obstacles = useStore(s => s.project.obstacles), sel = useStore(s => s.sel);
  const { addVolRect, set } = useStore.getState();
  const { fieldInfo } = useSim();
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [view, setView] = useState({ cx: 0, cy: 0, s: 22 }); // centro (m) y escala (px/m)
  const [tool, setTool] = useState<'sel' | 'draw'>(vs.length ? 'sel' : 'draw');
  const [tipo, setTipo] = useState<VolTipo>(vs.length ? 'ampliacion' : 'casa');
  const [pts, setPts] = useState<P[]>([]);           // puntos ya fijados (A, B)
  const [hover, setHover] = useState<{ p: P; corner: boolean } | null>(null);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean; id: number } | null>(null);

  useEffect(() => {
    const ro = new ResizeObserver(e => setSize({ w: e[0].contentRect.width, h: e[0].contentRect.height }));
    if (box.current) ro.observe(box.current); return () => ro.disconnect();
  }, []);

  const toS = (p: P): P => [size.w / 2 + (p[0] - view.cx) * view.s, size.h / 2 - (p[1] - view.cy) * view.s];
  const toW = (sx: number, sy: number): P => [view.cx + (sx - size.w / 2) / view.s, view.cy - (sy - size.h / 2) / view.s];

  /** Encuadra todos los volúmenes (o el origen si no hay). */
  const fit = () => {
    const all = vs.flatMap(v => volCorners(v));
    if (!all.length) { setView({ cx: 0, cy: 0, s: 22 }); return; }
    const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
    const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    const s = Math.max(4, Math.min(80, Math.min(size.w / (w + 10), size.h / (h + 10))));
    setView({ cx: (Math.max(...xs) + Math.min(...xs)) / 2, cy: (Math.max(...ys) + Math.min(...ys)) / 2, s });
  };
  // al abrir el plano (o cambiar el tamaño de la ventana) se encuadra lo que hay
  const fitted = useRef(false);
  useEffect(() => { if (!fitted.current && size.w > 100) { fitted.current = true; fit(); } });

  /** Punto con imán: esquinas de volúmenes (10 px), ángulos de 15° para la fachada, grilla de 0,5 m. */
  const snap = (sx: number, sy: number): { p: P; corner: boolean } => {
    const w = toW(sx, sy);
    for (const v of vs) for (const c of volCorners(v)) {
      const s = toS(c); if (Math.hypot(s[0] - sx, s[1] - sy) < 10) return { p: c, corner: true };
    }
    if (pts.length === 1) {
      // largo redondeado a 0,1 m y dirección con imán cada 15°
      const d = sub(w, pts[0]), L = Math.round(len(d) * 10) / 10; let az = Math.atan2(d[0], d[1]) / D2R;
      const near = Math.round(az / 15) * 15; if (Math.abs(near - az) < 4) az = near;
      return { p: [pts[0][0] + Math.sin(az * D2R) * L, pts[0][1] + Math.cos(az * D2R) * L], corner: false };
    }
    return { p: [Math.round(w[0] * 2) / 2, Math.round(w[1] * 2) / 2], corner: false };
  };

  /** Rectángulo en construcción a partir de A, B y la posición del puntero (fondo perpendicular). */
  const rectFrom = (A: P, B: P, C: P) => {
    const ab = sub(B, A), L = len(ab); if (L < 0.3) return null;
    const u: P = [ab[0] / L, ab[1] / L], n: P = [u[1], -u[0]];
    let d = (C[0] - A[0]) * n[0] + (C[1] - A[1]) * n[1];
    d = Math.round(d * 10) / 10; if (Math.abs(d) < 0.3) return null;
    const dir: P = [n[0] * Math.sign(d), n[1] * Math.sign(d)], D = Math.abs(d);
    const mid: P = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], c: P = [mid[0] + dir[0] * D / 2, mid[1] + dir[1] * D / 2];
    const rot = ((Math.atan2(-dir[0], -dir[1]) / D2R) % 360 + 360) % 360; // el frente mira al lado contrario del fondo
    return { x: c[0], y: c[1], rot, ancho: L, fondo: D, poly: [A, B, [B[0] + dir[0] * D, B[1] + dir[1] * D], [A[0] + dir[0] * D, A[1] + dir[1] * D]] as P[] };
  };

  const click = (sx: number, sy: number) => {
    const h = snap(sx, sy);
    if (tool === 'draw') {
      if (pts.length < 2) { if (pts.length === 1 && len(sub(h.p, pts[0])) < 0.3) return; setPts([...pts, h.p]); return; }
      const r = rectFrom(pts[0], pts[1], h.p); if (!r) return;
      addVolRect(tipo, r); setPts([]); setTool('sel'); setTipo('ampliacion');
      return;
    }
    const w = toW(sx, sy), hit = [...vs].reverse().find(v => insideBlock(v, w[0], w[1]));
    set({ sel: hit ? { kind: 'vol', id: hit.id } : null });
  };

  // teclado: Esc cancela el dibujo, Retroceso borra el último punto
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest('input,select,textarea')) return;
      if (e.key === 'Escape') { if (pts.length) setPts([]); else setTool('sel'); }
      if (e.key === 'Backspace' && pts.length) { e.preventDefault(); setPts(pts.slice(0, -1)); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [pts]);

  const rel = (e: React.PointerEvent | React.WheelEvent) => { const r = box.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as P; };
  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy, moved: false, id: e.pointerId };
  };
  const onMove = (e: React.PointerEvent) => {
    const [sx, sy] = rel(e); setHover(snap(sx, sy));
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    d.moved = true; setView(v => ({ ...v, cx: d.cx - dx / v.s, cy: d.cy + dy / v.s })); // arrastrar = desplazar la vista
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current; drag.current = null;
    if (d && !d.moved && d.id === e.pointerId && (e.pointerType !== 'mouse' || e.button === 0)) { const [sx, sy] = rel(e); click(sx, sy); }
  };
  const onWheel = (e: React.WheelEvent) => {
    const [sx, sy] = rel(e), w = toW(sx, sy), k = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setView(v => { const s = Math.max(3, Math.min(150, v.s * k)); return { s, cx: w[0] - (sx - size.w / 2) / s, cy: w[1] + (sy - size.h / 2) / s }; });
  };
  const zoom = (k: number) => setView(v => ({ ...v, s: Math.max(3, Math.min(150, v.s * k)) }));

  // grilla visible: 1 m (si se ve) y 5 m
  const grid = useMemo(() => {
    const lines: { a: P; b: P; major: boolean }[] = [];
    const [x0, y1] = toW(0, 0), [x1, y0] = toW(size.w, size.h), step = view.s >= 8 ? 1 : 5;
    for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) lines.push({ a: [x, y0], b: [x, y1], major: Math.round(x) % 5 === 0 });
    for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) lines.push({ a: [x0, y], b: [x1, y], major: Math.round(y) % 5 === 0 });
    return lines;
  }, [view, size]); // eslint-disable-line react-hooks/exhaustive-deps

  const poly = (ps: P[]) => ps.map(p => toS(p).join(',')).join(' ');
  const selV = sel?.kind === 'vol' ? vs.find(v => v.id === sel.id) : undefined;
  const preview = tool === 'draw' && pts.length === 2 && hover ? rectFrom(pts[0], pts[1], hover.p) : null;
  const scaleM = [1, 2, 5, 10, 20, 50].find(m => m * view.s >= 60) ?? 50;

  /** Cota de un lado: el texto va por fuera de la figura (lejos de `away`, su centro). */
  const dimLabel = (a: P, b: P, txt: string, away?: P, hi = true) => {
    const sa = toS(a), sb = toS(b), m: P = [(sa[0] + sb[0]) / 2, (sa[1] + sb[1]) / 2], d = sub(sb, sa), L = len(d) || 1;
    let nx = d[1] / L, ny = -d[0] / L;
    if (away) { const c = toS(away); if ((m[0] - c[0]) * nx + (m[1] - c[1]) * ny < 0) { nx = -nx; ny = -ny; } }
    const off = Math.abs(ny) > 0.7 ? 12 : 30; // en lados verticales el texto necesita más espacio
    return <text x={m[0] + nx * off} y={m[1] + ny * off + 4} className={'dimtxt' + (hi ? ' hi' : '')} textAnchor="middle">{txt}</text>;
  };
  const centroid = (ps: P[]): P => [ps.reduce((s, p) => s + p[0], 0) / ps.length, ps.reduce((s, p) => s + p[1], 0) / ps.length];

  const hint = tool !== 'draw'
    ? (vs.length ? 'Clic en un volumen para editarlo · arrastra el fondo para moverte · rueda para zoom' : 'Elige “Dibujar volumen” para empezar')
    : pts.length === 0 ? 'Clic donde EMPIEZA la fachada (el frente) del volumen'
      : pts.length === 1 ? `Clic donde TERMINA la fachada${hover ? ` · largo ${fmt(len(sub(hover.p, pts[0])))}` : ''} · Esc para cancelar`
        : `Mueve hacia el fondo y haz clic${preview ? ` · ${fmt(preview.ancho)} × ${fmt(preview.fondo)}` : ''} · Retroceso para corregir`;

  return (
    <div className="planed" ref={box}>
      <svg width={size.w} height={size.h} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => setHover(null)} onWheel={onWheel}
        style={{ cursor: tool === 'draw' ? 'crosshair' : 'default' }}>
        {grid.map((g, i) => { const a = toS(g.a), b = toS(g.b); return <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className={g.major ? 'gmaj' : 'gmin'} />; })}
        {/* obstáculos como referencia */}
        {obstacles.map(o => { const c = toS([o.x, o.y]); const r = Math.max(3, (o.tipo === 'arbol' ? o.copa / 2 : Math.max(o.ancho, o.largo) / 2) * view.s); return <circle key={o.id} cx={c[0]} cy={c[1]} r={r} className="pobs" />; })}
        {vs.map(v => {
          const cs = volCorners(v), on = selV?.id === v.id, c = toS([v.x, v.y]);
          const fm: P = [(cs[0][0] + cs[1][0]) / 2, (cs[0][1] + cs[1][1]) / 2], r = v.rot * D2R;
          const fa = toS(fm), fb = toS([fm[0] + Math.sin(r) * 1.4, fm[1] + Math.cos(r) * 1.4]);
          return (
            <g key={v.id}>
              <polygon points={poly(cs)} className={'pvol' + (on ? ' on' : '')} />
              <line x1={cs.length && toS(cs[0])[0]} y1={toS(cs[0])[1]} x2={toS(cs[1])[0]} y2={toS(cs[1])[1]} className="pfront" />
              <line x1={fa[0]} y1={fa[1]} x2={fb[0]} y2={fb[1]} className="parrow" markerEnd="url(#pa)" />
              <text x={c[0]} y={c[1] - 3} className="pname" textAnchor="middle">{v.nombre}</text>
              <text x={c[0]} y={c[1] + 11} className="psub" textAnchor="middle">{v.pisos} piso{v.pisos > 1 ? 's' : ''} · {v.ancho}×{v.fondo} m</text>
              {on && <>{dimLabel(cs[0], cs[1], fmt(v.ancho), [v.x, v.y])}{dimLabel(cs[1], cs[2], fmt(v.fondo), [v.x, v.y])}</>}
            </g>
          );
        })}
        {/* campos de paneles (mesas) */}
        {fieldInfo.map(fi => Array.from({ length: fi.corners.length / 4 }, (_, k) => (
          <polygon key={fi.id + k} points={poly(fi.corners.slice(k * 4, k * 4 + 4).map(c => [c[0], -c[2]] as P))} className="pfield" />)))}
        {/* dibujo en curso */}
        {tool === 'draw' && pts.length >= 1 && hover && pts.length === 1 && (() => {
          const a = toS(pts[0]), b = toS(hover.p);
          return <><line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="pdraw" />{dimLabel(pts[0], hover.p, fmt(len(sub(hover.p, pts[0]))))}</>;
        })()}
        {preview && <>
          <polygon points={poly(preview.poly)} className="pprev" />
          {dimLabel(preview.poly[0], preview.poly[1], `${fmt(preview.ancho)} · frente`, centroid(preview.poly))}
          {dimLabel(preview.poly[1], preview.poly[2], fmt(preview.fondo), centroid(preview.poly))}
        </>}
        {tool === 'draw' && pts.length === 2 && !preview && (() => { const a = toS(pts[0]), b = toS(pts[1]); return <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="pdraw" />; })()}
        {pts.map((p, i) => { const s = toS(p); return <circle key={i} cx={s[0]} cy={s[1]} r={4} className="ppt" />; })}
        {tool === 'draw' && hover && (() => { const s = toS(hover.p); return <circle cx={s[0]} cy={s[1]} r={hover.corner ? 7 : 4} className={'psnap' + (hover.corner ? ' corner' : '')} />; })()}
        <defs><marker id="pa" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="#fff" /></marker></defs>
        {/* norte y escala */}
        <g transform={`translate(${size.w - 34},${70})`}><path d="M0 -18 L7 6 L0 1 L-7 6 Z" className="pnorth" /><text y={20} textAnchor="middle" className="pname">N</text></g>
        <g transform={`translate(16,${size.h - 46})`}><line x1={0} y1={0} x2={scaleM * view.s} y2={0} className="pscale" /><line x1={0} y1={-4} x2={0} y2={4} className="pscale" /><line x1={scaleM * view.s} y1={-4} x2={scaleM * view.s} y2={4} className="pscale" /><text x={scaleM * view.s / 2} y={-6} textAnchor="middle" className="psub">{scaleM} m</text></g>
      </svg>
      <div className="ptools">
        <div className="seg"><button className={tool === 'sel' ? 'on' : ''} onClick={() => { setTool('sel'); setPts([]); }}>Seleccionar</button><button className={tool === 'draw' ? 'on' : ''} onClick={() => setTool('draw')}>✏ Dibujar volumen</button></div>
        {tool === 'draw' && <div className="seg">{TIPOS.map(([k, n]) => <button key={k} className={tipo === k ? 'on' : ''} onClick={() => setTipo(k)}>{n}</button>)}</div>}
        <span className="sp" />
        <button onClick={fit} title="Encuadrar todo">Encuadrar</button>
        <button onClick={() => zoom(1 / 1.25)} title="Alejar">−</button>
        <button onClick={() => zoom(1.25)} title="Acercar">+</button>
        <button className="pri" onClick={() => set({ casaView: '3d' })} title="Ver solo el 3D, en grande">Ampliar 3D</button>
      </div>
      <div className="phint">{hint}</div>
      {!vs.length && tool === 'draw' && pts.length === 0 && <div className="pempty">
        <b>Dibuja la casa</b>
        <span>1. Clic en una esquina del frente · 2. Clic en la otra esquina · 3. Clic hacia el fondo.</span>
        <span>Después agrega ampliaciones, un segundo cuerpo o un quincho de la misma forma.</span>
      </div>}
    </div>
  );
}
