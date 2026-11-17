import { create } from 'zustand';
import { defaultProject, distanceToHouse, migrate, uid, type ElecConfig, type ElecTool, type Field, type House, type ModuleSpec, type Obstacle, type ObsType, type Project, type Site, type Weather } from './engine/project';
import type { DayResult, YearResult } from './engine/sim';

export type Sel = { kind: 'house' } | { kind: 'field'; id: string } | { kind: 'obs'; id: string } | null;
export type Mode = 'instante' | 'dia' | 'anio';
export type Tab = 'sitio' | 'casa' | 'paneles' | 'objetos' | 'simular' | 'electrico';
/** Pasos del asistente, en orden. Los cuatro primeros son de diseño (sin resultados en pantalla). */
export const STEPS: Tab[] = ['sitio', 'casa', 'paneles', 'objetos', 'simular', 'electrico'];
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
  setHouse: (h: Partial<House>) => void;
  setField: (id: string, f: Partial<Field>) => void;
  addField: (where: 'techo' | 'suelo') => void;
  removeField: (id: string) => void;
  setObs: (id: string, o: Partial<Obstacle>) => void;
  addObs: (t: ObsType) => void;
  removeObs: (id: string) => void;
  /** Tamaño del paso de los botones mover/girar: 0 fino, 1 normal, 2 grande. */
  nudge: 0 | 1 | 2;
  /** Mueve el objeto seleccionado dx metros al Este y dy al Norte (la casa arrastra lo que está sobre su techo). */
  moveSel: (dx: number, dy: number) => void;
  /** Gira el objeto seleccionado d grados en sentido horario visto desde arriba. */
  rotateSel: (d: number) => void;
  set: (s: Partial<State>) => void;
}

export const NUDGE: [number, number][] = [[0.1, 1], [0.5, 5], [1, 15]];
const r2 = (v: number) => Math.round(v * 100) / 100;
const norm360 = (a: number) => r2(((a % 360) + 360) % 360);
const norm180 = (a: number) => { const v = norm360(a); return v > 180 ? r2(v - 360) : v; };
/** ¿El punto (x, y) cae sobre la planta de la casa? */
function onHouse(p: Project, x: number, y: number) {
  return !!p.house.enabled && !!distanceToHouse(p, { id: '', tipo: 'poste', x, y, alto: 0, ancho: 0, largo: 0, rot: 0, copa: 0 })?.inside;
}

const OBS_NEW: Record<ObsType, Omit<Obstacle, 'id'>> = {
  arbol: { tipo: 'arbol', x: -8, y: 10, alto: 7, ancho: 0, largo: 0, rot: 0, copa: 4 },
  poste: { tipo: 'poste', x: 6, y: 9, alto: 8, ancho: 0.3, largo: 0.3, rot: 0, copa: 0 },
  edificio: { tipo: 'edificio', x: 0, y: 16, alto: 7, ancho: 8, largo: 6, rot: 0, copa: 0 },
  muro: { tipo: 'muro', x: 0, y: 9, alto: 2.5, ancho: 10, largo: 0.2, rot: 0, copa: 0 },
  chimenea: { tipo: 'chimenea', x: 0, y: 0, alto: 1.2, ancho: 0.6, largo: 0.6, rot: 0, copa: 0 },
};

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
  return {
    project: load(),
    sel: null, tab: 'sitio', mode: 'instante',
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
    setHouse: h => touch({ ...get().project, house: { ...get().project.house, ...h } }),
    setField: (id, f) => touch({ ...get().project, fields: get().project.fields.map(x => (x.id === id ? { ...x, ...f } : x)) }),
    addField: where => {
      const p = get().project, h = p.house;
      const onRoof = where === 'techo' && h.enabled;
      const f: Field = {
        id: uid(), nombre: `Campo ${p.fields.length + 1}`,
        x: onRoof ? h.x : h.x, y: onRoof ? h.y + h.fondo / 4 : h.y + h.fondo / 2 + 6,
        montaje: onRoof ? 'coplanar' : 'inclinada', rango: '15-30', tilt: 20, azim: 0,
        filas: 2, mods: 5, enAlto: 1, orient: 'V', pitch: 4.5, altura: onRoof ? 0.12 : 0.6,
      };
      touch({ ...p, fields: [...p.fields, f] }); set({ sel: { kind: 'field', id: f.id }, tab: 'paneles' });
    },
    removeField: id => { touch({ ...get().project, fields: get().project.fields.filter(x => x.id !== id) }); set({ sel: null, selModule: -1 }); },
    setObs: (id, o) => touch({ ...get().project, obstacles: get().project.obstacles.map(x => (x.id === id ? { ...x, ...o } : x)) }),
    addObs: t => {
      const p = get().project, o: Obstacle = { ...OBS_NEW[t], id: uid() };
      if (t === 'chimenea') { o.x = p.house.x + 1; o.y = p.house.y - 1; }
      touch({ ...p, obstacles: [...p.obstacles, o] }); set({ sel: { kind: 'obs', id: o.id }, tab: 'objetos' });
    },
    removeObs: id => { touch({ ...get().project, obstacles: get().project.obstacles.filter(x => x.id !== id) }); set({ sel: null }); },
    nudge: 1,
    moveSel: (dx, dy) => {
      const { sel, project: p } = get(); if (!sel) return;
      const mv = <T extends { x: number; y: number }>(o: T): T => ({ ...o, x: r2(o.x + dx), y: r2(o.y + dy) });
      if (sel.kind === 'house') {
        if (!p.house.enabled) return;
        // lo que está sobre el techo (campos, chimeneas) se mueve con la casa
        touch({
          ...p, house: mv(p.house),
          fields: p.fields.map(f => (onHouse(p, f.x, f.y) ? mv(f) : f)),
          obstacles: p.obstacles.map(o => (onHouse(p, o.x, o.y) ? mv(o) : o)),
        });
      } else if (sel.kind === 'field') touch({ ...p, fields: p.fields.map(f => (f.id === sel.id ? mv(f) : f)) });
      else touch({ ...p, obstacles: p.obstacles.map(o => (o.id === sel.id ? mv(o) : o)) });
    },
    rotateSel: d => {
      const { sel, project: p } = get(); if (!sel) return;
      if (sel.kind === 'house') {
        if (!p.house.enabled) return;
        // gira en sentido horario alrededor del centro de la casa, junto con lo que está sobre el techo
        const h = p.house, t = d * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
        const rot = <T extends { x: number; y: number }>(o: T): T => {
          const ex = o.x - h.x, ny = o.y - h.y;
          return { ...o, x: r2(h.x + ex * c + ny * s), y: r2(h.y - ex * s + ny * c) };
        };
        touch({
          ...p, house: { ...h, rot: norm360(h.rot + d) },
          fields: p.fields.map(f => (onHouse(p, f.x, f.y) ? { ...rot(f), azim: f.montaje === 'inclinada' ? norm180(f.azim + d) : f.azim } : f)),
          obstacles: p.obstacles.map(o => (onHouse(p, o.x, o.y) ? { ...rot(o), rot: norm360(o.rot + d) } : o)),
        });
      } else if (sel.kind === 'field') touch({ ...p, fields: p.fields.map(f => (f.id === sel.id ? { ...f, azim: norm180(f.azim + d) } : f)) });
      else touch({ ...p, obstacles: p.obstacles.map(o => (o.id === sel.id ? { ...o, rot: norm360(o.rot + d) } : o)) });
    },
    set: s => set(s as Partial<State>),
  };
});

// la preferencia de mostrar la trayectoria del sol se recuerda entre sesiones
useStore.subscribe((s, prev) => { if (s.showSunPath !== prev.showSunPath) try { localStorage.setItem('nikola-sombras-sol', s.showSunPath ? '1' : '0'); } catch { /* */ } });

/** Navegar a un paso: al entrar a Paneles se selecciona el primer campo si no hay uno elegido. */
export function goStep(t: Tab) {
  const st = useStore.getState(), p = st.project;
  const patch: Partial<State> = { tab: t };
  if (t === 'paneles' && st.sel?.kind !== 'field' && p.fields[0]) patch.sel = { kind: 'field', id: p.fields[0].id };
  if (t === 'objetos' && st.sel?.kind !== 'obs') patch.sel = p.obstacles[0] ? { kind: 'obs', id: p.obstacles[0].id } : null;
  if (t === 'casa') patch.sel = p.house.enabled ? { kind: 'house' } : null;
  if (t === 'sitio' || t === 'simular' || t === 'electrico') patch.sel = null;
  st.set(patch);
}

