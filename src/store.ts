import { create } from 'zustand';
import { defaultProject, exampleProject, insideBlock, volumeAt, migrate, roofSpot, toWorld, uid, VOL_TEMPLATES, type ElecConfig, type ElecTool, type Field, type ModuleSpec, type Obstacle, type ObsType, type Project, type Site, type Volume, type VolTipo, type Weather } from './engine/project';
import type { DayResult, YearResult } from './engine/sim';

export type Sel = { kind: 'vol'; id: string } | { kind: 'field'; id: string } | { kind: 'obs'; id: string } | null;
export type Mode = 'instante' | 'dia' | 'anio';
export type Tab = 'sitio' | 'casa' | 'paneles' | 'objetos' | 'simular' | 'electrico';
/** Pasos del asistente, en orden: primero se diseña la casa. Los cuatro primeros son de diseño (sin resultados en pantalla). */
export const STEPS: Tab[] = ['casa', 'sitio', 'objetos', 'paneles', 'simular', 'electrico'];
export const DESIGN_STEPS: Tab[] = STEPS.slice(0, 4);
export type Clima = 'despejado' | 'archivo' | 'pvgis';
export type ColorBy = 'celda' | 'panel';

const KEY = 'nikola-sombras-v2';
function load(): Project {
  try { const s = localStorage.getItem(KEY); if (s) { const p = JSON.parse(s); if (p.version === 2) return migrate(p); } } catch { /* sin almacenamiento */ }
  return defaultProject();
}
const year = new Date().getFullYear();

interface State {
  project: Project;
  sel: Sel; tab: Tab; mode: Mode;
  fecha: string; hora: number; sub: number; clima: Clima; tool: ElecTool; activeString: string | null;
  showLabels: boolean; showDims: boolean; showSunPath: boolean; selModule: number;
  hideSide: boolean; hideRes: boolean;
  /** Pantalla de bienvenida (se muestra la primera vez). */
  intro: boolean;
  /** Mapa de calor de Día/Año: detalle por celda o un color por panel (pérdida eléctrica). */
  colorBy: ColorBy;
  /** Los resultados de Día/Año ya no corresponden a la geometría/configuración actual. */
  stale: boolean;
  day: DayResult | null; yearRes: YearResult | null; busy: number | null; error: string | null;
  pvgisCache: { key: string; w: Weather } | null;
  resetStorage: () => void;
  setProject: (p: Project) => void;
  setNombre: (nombre: string) => void;
  setSite: (s: Partial<Site>) => void;
  setModulo: (m: Partial<ModuleSpec>) => void;
  setElec: (e: Partial<ElecConfig>) => void;
  setClimaData: (w: Weather | null) => void;
  clickModuleElec: (key: string) => void;
  /** Cambia medidas/techo de un volumen (los campos montados sobre él se reubican solos al recalcular). */
  setVol: (id: string, v: Partial<Volume>) => void;
  addVol: (t: VolTipo) => void;
  /** Volumen dibujado en el plano: rectángulo con centro, giro (azimut del frente) y medidas. */
  addVolRect: (t: VolTipo, r: { x: number; y: number; rot: number; ancho: number; fondo: number }) => void;
  /** Carga el proyecto de ejemplo. */
  loadExample: () => void;
  /** En el paso Casa: plano 2D para dibujar o vista 3D. */
  casaView: 'plano' | '3d';
  removeVol: (id: string) => void;
  dupVol: (id: string) => void;
  setField: (id: string, f: Partial<Field>) => void;
  /** Campo nuevo sobre el techo de un volumen (en el faldón que mira al ecuador) o en el suelo. */
  addField: (where: 'techo' | 'suelo', volId?: string) => void;
  /** Monta un campo existente sobre otro volumen (o en el suelo) y lo centra en el mejor faldón. */
  mountField: (id: string, volId: string | null) => void;
  removeField: (id: string) => void;
  setObs: (id: string, o: Partial<Obstacle>) => void;
  addObs: (t: ObsType) => void;
  /** Al soltar un campo arrastrado: se monta sobre el techo que quedó bajo su centro (o pasa al suelo). */
  dropField: (id: string) => void;
  removeObs: (id: string) => void;
  /** Tamaño del paso de los botones mover/girar: 0 fino, 1 normal, 2 grande. */
  nudge: 0 | 1 | 2;
  /** Mueve el objeto seleccionado dx metros al Este y dy al Norte (un volumen arrastra lo que está sobre su techo). */
  moveSel: (dx: number, dy: number) => void;
  /** Gira el objeto seleccionado d grados en sentido horario visto desde arriba. */
  rotateSel: (d: number) => void;
  set: (s: Partial<State>) => void;
}

export const NUDGE: [number, number][] = [[0.1, 1], [0.5, 5], [1, 15]];
const r2 = (v: number) => Math.round(v * 100) / 100;
const norm360 = (a: number) => r2(((a % 360) + 360) % 360);
const norm180 = (a: number) => { const v = norm360(a); return v > 180 ? r2(v - 360) : v; };

const OBS_NEW: Record<ObsType, Omit<Obstacle, 'id'>> = {
  arbol: { tipo: 'arbol', x: -8, y: 10, alto: 7, ancho: 0, largo: 0, rot: 0, copa: 4 },
  poste: { tipo: 'poste', x: 6, y: 9, alto: 8, ancho: 0.3, largo: 0.3, rot: 0, copa: 0 },
  edificio: { tipo: 'edificio', x: 0, y: 16, alto: 7, ancho: 8, largo: 6, rot: 0, copa: 0 },
  muro: { tipo: 'muro', x: 0, y: 9, alto: 2.5, ancho: 10, largo: 0.2, rot: 0, copa: 0 },
  chimenea: { tipo: 'chimenea', x: 0, y: 0, alto: 1.2, ancho: 0.6, largo: 0.6, rot: 0, copa: 0 },
};

/** Dónde aparece un volumen nuevo respecto del volumen de referencia (pegado al costado, quincho separado detrás). */
function placeVol(p: Project, t: VolTipo, base: Volume | undefined): { x: number; y: number; rot: number } {
  const tpl = VOL_TEMPLATES[t];
  if (!base) return { x: 0, y: 0, rot: 0 };
  const at = (lx: number, lz: number) => { const w = toWorld(base, lx, 0, lz); return { x: r2(w[0]), y: r2(-w[2]), rot: base.rot }; };
  switch (t) {
    case 'ampliacion': return at(base.ancho / 2 + tpl.ancho / 2, base.fondo / 2 - tpl.fondo / 2);
    case 'garage': return at(-(base.ancho / 2 + tpl.ancho / 2), base.fondo / 2 - tpl.fondo / 2);
    case 'quincho': return at(0, base.fondo / 2 + 4 + tpl.fondo / 2);
    case 'casa': {
      const maxX = Math.max(...p.volumes.map(v => v.x + Math.max(v.ancho, v.fondo) / 2));
      return { x: r2(maxX + 3 + tpl.ancho / 2), y: base.y, rot: base.rot };
    }
  }
}

export const useStore = create<State>((set, get) => {
  // Guardado diferido: al escribir en los campos el proyecto cambia muy seguido y serializarlo
  // (con el archivo de clima incluido) cada vez trabaría la interfaz.
  let saveT: ReturnType<typeof setTimeout> | undefined;
  const save = () => { clearTimeout(saveT); saveT = undefined; try { localStorage.setItem(KEY, JSON.stringify(get().project)); } catch { /* */ } };
  if (typeof window !== 'undefined') window.addEventListener('beforeunload', () => { if (saveT) save(); });
  // Los resultados de Día/Año se conservan (y el visor mantiene su mapa de color) hasta que se vuelva
  // a analizar; si la geometría o la configuración cambia quedan marcados como desactualizados.
  const touch = (project: Project, clear = false) => {
    clearTimeout(saveT); saveT = setTimeout(save, 400);
    const st = get();
    if (clear) set({ project, day: null, yearRes: null, stale: false });
    else set({ project, stale: st.stale || !!(st.day || st.yearRes) });
  };
  /** ¿El objeto va con este volumen? Campos montados en él y objetos (chimeneas) sobre su planta. */
  const rides = (v: Volume) => ({
    field: (f: Field) => f.vol === v.id || (!f.vol && insideBlock(v, f.x, f.y)),
    obs: (o: Obstacle) => insideBlock(v, o.x, o.y),
  });
  return {
    project: load(),
    sel: null, tab: 'casa', mode: 'instante',
    fecha: `${year}-06-21`, hora: 15, sub: 2, clima: 'despejado', tool: 'string', activeString: null,
    showLabels: true, showDims: true, showSunPath: (() => { try { return localStorage.getItem('nikola-sombras-sol') === '1'; } catch { return false; } })(), selModule: -1,
    hideSide: false, hideRes: false, intro: (() => { try { return !localStorage.getItem('nikola-sombras-intro'); } catch { return false; } })(), colorBy: 'celda', stale: false,
    day: null, yearRes: null, busy: null, error: null, pvgisCache: null,
    resetStorage: () => { clearTimeout(saveT); saveT = undefined; try { localStorage.removeItem(KEY); } catch { /* */ } },
    setProject: p => { touch(migrate(p), true); set({ sel: null, selModule: -1 }); },
    setNombre: nombre => { clearTimeout(saveT); saveT = setTimeout(save, 400); set({ project: { ...get().project, nombre } }); },
    setSite: s => touch({ ...get().project, site: { ...get().project.site, ...s } }),
    setModulo: m => touch({ ...get().project, modulo: { ...get().project.modulo, ...m } }),
    setElec: e => touch({ ...get().project, elec: { ...get().project.elec, ...e } }),
    setClimaData: w => { touch({ ...get().project, clima: w }); set({ clima: w ? 'archivo' : 'despejado' }); },
    clickModuleElec: key => {
      const st = get(), e = st.project.elec, toggle = (arr: string[]) => (arr.includes(key) ? arr.filter(k => k !== key) : [...arr, key]);
      if (st.tool === 'optimizador') return st.setElec({ optimizados: toggle(e.optimizados) });
      if (st.tool === 'excluir') return st.setElec({ excluidos: toggle(e.excluidos) });
      // herramienta string (modo manual): el módulo pasa al string activo, o sale de él
      if (e.modo !== 'manual' || !st.activeString) return;
      const strings = e.strings.map(s => {
        if (s.id === st.activeString) return { ...s, mods: s.mods.includes(key) ? s.mods.filter(k => k !== key) : [...s.mods, key] };
        return { ...s, mods: s.mods.filter(k => k !== key) };
      });
      st.setElec({ strings });
    },
    setVol: (id, v) => {
      const p = get().project, old = p.volumes.find(x => x.id === id); if (!old) return;
      const nv = { ...old, ...v };
      // si cambia la forma del techo, los campos montados se vuelven a centrar en el mejor faldón
      const reroof = v.techo !== undefined && v.techo !== old.techo;
      touch({
        ...p, volumes: p.volumes.map(x => (x.id === id ? nv : x)),
        fields: reroof ? p.fields.map(f => (f.vol === id ? { ...f, ...clean(spotFor(nv, p.site.lat, p.modulo, f.orient)) } : f)) : p.fields,
      });
    },
    casaView: 'plano',
    loadExample: () => { const st = get(); st.setProject(exampleProject()); goStep('casa'); },
    addVolRect: (t, r) => {
      const p = get().project, n = p.volumes.filter(v => v.tipo === t).length;
      const v: Volume = { ...VOL_TEMPLATES[t], id: uid(), x: r2(r.x), y: r2(r.y), rot: norm360(r.rot), ancho: r2(r.ancho), fondo: r2(r.fondo) };
      if (n > 0) v.nombre = `${v.nombre} ${n + 1}`;
      touch({ ...p, volumes: [...p.volumes, v] }); set({ sel: { kind: 'vol', id: v.id } });
    },
    addVol: t => {
      const p = get().project, st = get();
      const base = (st.sel?.kind === 'vol' && p.volumes.find(v => v.id === st.sel!.id)) || p.volumes[0];
      const n = p.volumes.filter(v => v.tipo === t).length;
      const v: Volume = { ...VOL_TEMPLATES[t], id: uid(), ...placeVol(p, t, base) };
      if (n > 0) v.nombre = `${v.nombre} ${n + 1}`;
      touch({ ...p, volumes: [...p.volumes, v] }); set({ sel: { kind: 'vol', id: v.id }, tab: 'casa' });
    },
    removeVol: id => {
      const p = get().project;
      // los campos que iban sobre el volumen quedan sin volumen (en el suelo)
      touch({ ...p, volumes: p.volumes.filter(v => v.id !== id), fields: p.fields.map(f => (f.vol === id ? { ...f, vol: undefined } : f)) });
      set({ sel: null });
    },
    dupVol: id => {
      const p = get().project, o = p.volumes.find(v => v.id === id); if (!o) return;
      const w = toWorld(o, o.ancho + 2, 0, 0);
      const v: Volume = { ...o, id: uid(), nombre: `${o.nombre} (copia)`, x: r2(w[0]), y: r2(-w[2]) };
      touch({ ...p, volumes: [...p.volumes, v] }); set({ sel: { kind: 'vol', id: v.id } });
    },
    setField: (id, f) => touch({ ...get().project, fields: get().project.fields.map(x => (x.id === id ? { ...x, ...f } : x)) }),
    addField: (where, volId) => {
      const p = get().project, st = get();
      const v = where === 'techo'
        ? p.volumes.find(x => x.id === volId) ?? (st.sel?.kind === 'vol' ? p.volumes.find(x => x.id === (st.sel as { id: string }).id) : undefined) ?? biggest(p.volumes)
        : undefined;
      const ground = { x: r2((p.volumes[0]?.x ?? 0)), y: r2((p.volumes[0]?.y ?? 0) + (p.volumes[0] ? p.volumes[0].fondo / 2 + 6 : 0)) };
      const f: Field = {
        id: uid(), nombre: `Campo ${p.fields.length + 1}`,
        ...ground, montaje: 'inclinada', rango: '15-30', tilt: 20, azim: p.site.lat < 0 ? 0 : 180,
        filas: 2, mods: 5, enAlto: 1, orient: 'V', pitch: 4.5, altura: 0.6,
        ...(v ? { vol: v.id, ...clean(spotFor(v, p.site.lat, p.modulo)) } : {}),
      };
      touch({ ...p, fields: [...p.fields, f] }); set({ sel: { kind: 'field', id: f.id }, tab: 'paneles' });
    },
    mountField: (id, volId) => {
      const p = get().project, v = volId ? p.volumes.find(x => x.id === volId) : undefined;
      touch({
        ...p, fields: p.fields.map(f => {
          if (f.id !== id) return f;
          if (!v) { const g = p.volumes[0]; return { ...f, vol: undefined, montaje: 'inclinada', altura: 0.6, x: r2(g ? g.x : 0), y: r2(g ? g.y + g.fondo / 2 + 6 : 0) }; }
          return { ...f, vol: v.id, ...clean(spotFor(v, p.site.lat, p.modulo)) };
        }),
      });
    },
    removeField: id => { touch({ ...get().project, fields: get().project.fields.filter(x => x.id !== id) }); set({ sel: null, selModule: -1 }); },
    setObs: (id, o) => touch({ ...get().project, obstacles: get().project.obstacles.map(x => (x.id === id ? { ...x, ...o } : x)) }),
    addObs: t => {
      const p = get().project, o: Obstacle = { ...OBS_NEW[t], id: uid() };
      // aparece alrededor de la casa (nunca encima), separado de los que ya hay del mismo tipo
      const cs = p.volumes.flatMap(v => [toWorld(v, -v.ancho / 2, 0, -v.fondo / 2), toWorld(v, v.ancho / 2, 0, v.fondo / 2), toWorld(v, -v.ancho / 2, 0, v.fondo / 2), toWorld(v, v.ancho / 2, 0, -v.fondo / 2)].map(w => [w[0], -w[2]]));
      const x0 = cs.length ? Math.min(...cs.map(c => c[0])) : -5, x1 = cs.length ? Math.max(...cs.map(c => c[0])) : 5;
      const y0 = cs.length ? Math.min(...cs.map(c => c[1])) : -4, y1 = cs.length ? Math.max(...cs.map(c => c[1])) : 4;
      const k = p.obstacles.filter(x => x.tipo === t).length * 3, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const at: Record<ObsType, [number, number]> = {
        arbol: [x0 - 3 - o.copa / 2 + k, y1 + 3 + o.copa / 2],     // al noroeste: el sol en Chile viene del norte
        poste: [x1 + 3 + k, y1 + 4],
        edificio: [x1 + 4 + o.ancho / 2 + k, cy],                   // vecino al oriente
        muro: [cx + k, y0 - 3],                                     // deslinde al sur
        chimenea: [0, 0],
      };
      [o.x, o.y] = at[t].map(r2) as [number, number];
      if (t === 'chimenea') {
        const v = (get().sel?.kind === 'vol' && p.volumes.find(x => x.id === (get().sel as { id: string }).id)) || biggest(p.volumes);
        if (v) { const w = toWorld(v, v.ancho / 4 - k / 3, 0, v.fondo / 4); o.x = r2(w[0]); o.y = r2(-w[2]); } else { o.x = 0; o.y = 0; }
      }
      touch({ ...p, obstacles: [...p.obstacles, o] }); set({ sel: { kind: 'obs', id: o.id }, tab: 'objetos' });
    },
    dropField: id => {
      const p = get().project, f = p.fields.find(x => x.id === id); if (!f) return;
      const v = volumeAt(p, f.x, f.y);
      if (v && v.id !== f.vol) touch({ ...p, fields: p.fields.map(x => (x.id === id ? { ...x, vol: v.id, montaje: v.techo === 'plano' ? 'inclinada' : x.montaje } : x)) });
      else if (!v && f.vol) touch({ ...p, fields: p.fields.map(x => (x.id === id ? { ...x, vol: undefined, montaje: 'inclinada', altura: 0.6, tilt: Math.max(x.tilt, 15) } : x)) });
    },
    removeObs: id => { touch({ ...get().project, obstacles: get().project.obstacles.filter(x => x.id !== id) }); set({ sel: null }); },
    nudge: 1,
    moveSel: (dx, dy) => {
      const { sel, project: p } = get(); if (!sel) return;
      const mv = <T extends { x: number; y: number }>(o: T): T => ({ ...o, x: r2(o.x + dx), y: r2(o.y + dy) });
      if (sel.kind === 'vol') {
        const v = p.volumes.find(x => x.id === sel.id); if (!v) return;
        // lo que está sobre el techo (campos montados, chimeneas) se mueve con el volumen
        const r = rides(v);
        touch({
          ...p, volumes: p.volumes.map(x => (x.id === v.id ? mv(x) : x)),
          fields: p.fields.map(f => (r.field(f) ? mv(f) : f)),
          obstacles: p.obstacles.map(o => (r.obs(o) ? mv(o) : o)),
        });
      } else if (sel.kind === 'field') touch({ ...p, fields: p.fields.map(f => (f.id === sel.id ? mv(f) : f)) });
      else touch({ ...p, obstacles: p.obstacles.map(o => (o.id === sel.id ? mv(o) : o)) });
    },
    rotateSel: d => {
      const { sel, project: p } = get(); if (!sel) return;
      if (sel.kind === 'vol') {
        const v = p.volumes.find(x => x.id === sel.id); if (!v) return;
        // gira en sentido horario alrededor de su centro, junto con lo que está sobre su techo
        const t = d * Math.PI / 180, c = Math.cos(t), s = Math.sin(t), r = rides(v);
        const rot = <T extends { x: number; y: number }>(o: T): T => {
          const ex = o.x - v.x, ny = o.y - v.y;
          return { ...o, x: r2(v.x + ex * c + ny * s), y: r2(v.y - ex * s + ny * c) };
        };
        touch({
          ...p, volumes: p.volumes.map(x => (x.id === v.id ? { ...x, rot: norm360(x.rot + d) } : x)),
          fields: p.fields.map(f => (r.field(f) ? { ...rot(f), azim: f.montaje === 'inclinada' ? norm180(f.azim + d) : f.azim } : f)),
          obstacles: p.obstacles.map(o => (r.obs(o) ? { ...rot(o), rot: norm360(o.rot + d) } : o)),
        });
      } else if (sel.kind === 'field') touch({ ...p, fields: p.fields.map(f => (f.id === sel.id ? { ...f, azim: norm180(f.azim + d) } : f)) });
      else touch({ ...p, obstacles: p.obstacles.map(o => (o.id === sel.id ? { ...o, rot: norm360(o.rot + d) } : o)) });
    },
    set: s => set(s as Partial<State>),
  };
});

const biggest = (vs: Volume[]) => vs.reduce<Volume | undefined>((a, b) => (!a || b.ancho * b.fondo > a.ancho * a.fondo ? b : a), undefined);
/** Posición y montaje de un campo sobre un volumen: centrado en el faldón que mira al ecuador. */
const clean = ({ fits: _f, ...rest }: Partial<Field> & { fits?: boolean }) => rest; // eslint-disable-line @typescript-eslint/no-unused-vars
function spotFor(v: Volume, lat: number, m: ModuleSpec, orient?: 'V' | 'H'): Partial<Field> & { fits?: boolean } {
  // sin orientación pedida, se prueba vertical y horizontal y se queda con la que entra más módulos
  if (!orient) {
    const V = spotFor(v, lat, m, 'V'), H = spotFor(v, lat, m, 'H');
    const n = (x: Partial<Field> & { fits?: boolean }) => (x.fits ? (x.filas ?? 0) * (x.mods ?? 0) : 0);
    const best = n(H) > n(V) ? H : V;
    return best;
  }
  const s = roofSpot(v, lat), D = Math.PI / 180;
  const mw = (orient === 'V' ? m.ancho : m.largo) + m.gap, ml = orient === 'V' ? m.largo : m.ancho;
  const fit = (len: number, size: number, max: number) => Math.max(1, Math.min(max, Math.floor(len / size)));
  if (s.plano) {
    // techo plano: estructura a 15° con distancia entre filas sin sombra a 25° de altura solar
    const pitch = r2(ml * Math.cos(15 * D) + (ml * Math.sin(15 * D)) / Math.tan(25 * D));
    const filas = fit(v.fondo - 0.6 - ml * Math.cos(15 * D) + pitch, pitch, 10), mods = fit(v.ancho - 0.6, mw, 30);
    const fits = v.fondo - 0.6 >= ml * Math.cos(15 * D) && v.ancho - 0.6 >= mw;
    return { x: s.x, y: s.y, montaje: 'inclinada', tilt: 15, rango: '10-15', azim: s.azim > 180 ? s.azim - 360 : s.azim, altura: 0.3, pitch, filas, mods, orient, fits };
  }
  // faldón: largo a lo largo de la cumbrera y largo en pendiente, con margen al borde
  const lateral = Math.abs(((s.azim - v.rot + 540) % 360) - 180) % 180 > 45;
  const al = v.alero, cosP = Math.cos(v.pendiente * D), margin = 0.2;
  const along = (lateral ? v.fondo : v.ancho) * (v.techo === 'cuatro_aguas' ? 0.7 : 1) + 2 * al;
  const slope = ((v.techo === 'una_agua' ? (lateral ? v.ancho : v.fondo) : (lateral ? v.ancho : v.fondo) / 2) + al) / cosP;
  const filas = fit(slope - 2 * margin + 0.05, ml + 0.05, 10), mods = fit(along - 0.6, mw, 30);
  const fits = slope - 2 * margin >= ml && along - 0.6 >= mw;
  // el campo parte un poco sobre el alero y sube por el faldón: su centro queda a esa distancia + media profundidad
  const depth = ((filas - 1) * (ml + 0.05) + ml) * cosP;
  const az = s.azim * D, n = [Math.sin(az), Math.cos(az)]; // dirección "hacia abajo" del faldón en planta (E, N)
  const toEave = (lateral ? v.ancho : v.fondo) / 2 + al; // del centro del volumen al borde del alero
  const back = toEave - margin * cosP - depth / 2;
  return {
    x: r2(v.x + n[0] * back), y: r2(v.y + n[1] * back), montaje: 'coplanar', azim: s.azim > 180 ? s.azim - 360 : s.azim, altura: 0.12,
    mods, filas, orient, fits,
  };
}

// la preferencia de mostrar la trayectoria del sol se recuerda entre sesiones
useStore.subscribe((s, prev) => { if (s.showSunPath !== prev.showSunPath) try { localStorage.setItem('nikola-sombras-sol', s.showSunPath ? '1' : '0'); } catch { /* */ } });

/** Navegar a un paso: al entrar a Paneles se selecciona el primer campo si no hay uno elegido. */
export function goStep(t: Tab) {
  const st = useStore.getState(), p = st.project;
  const patch: Partial<State> = { tab: t };
  if (t === 'paneles' && st.sel?.kind !== 'field' && p.fields[0]) patch.sel = { kind: 'field', id: p.fields[0].id };
  if (t === 'objetos' && st.sel?.kind !== 'obs') patch.sel = p.obstacles[0] ? { kind: 'obs', id: p.obstacles[0].id } : null;
  if (t === 'casa' && st.sel?.kind !== 'vol') patch.sel = p.volumes[0] ? { kind: 'vol', id: p.volumes[0].id } : null;
  if (t === 'sitio' || t === 'simular' || t === 'electrico') patch.sel = null;
  st.set(patch);
}
