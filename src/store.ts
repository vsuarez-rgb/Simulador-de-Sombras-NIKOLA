import { create } from 'zustand';
import { defaultProject, uid, type Field, type House, type Obstacle, type ObsType, type Project, type Site, type ModuleSpec } from './engine/project';
import type { DayResult, TmyHour, YearResult } from './engine/sim';

export type Sel = { kind: 'house' } | { kind: 'field'; id: string } | { kind: 'obs'; id: string } | null;
export type Mode = 'instante' | 'dia' | 'anio';
export type Tab = 'sitio' | 'casa' | 'paneles' | 'objetos';

const KEY = 'nikola-sombras-v2';
function load(): Project {
  try { const s = localStorage.getItem(KEY); if (s) { const p = JSON.parse(s); if (p.version === 2) return p; } } catch { /* sin almacenamiento */ }
  return defaultProject();
}
const year = new Date().getFullYear();

interface State {
  project: Project;
  sel: Sel; tab: Tab; mode: Mode;
  fecha: string; hora: number; sub: number; clima: 'despejado' | 'pvgis';
  showLabels: boolean; showDims: boolean; selModule: number;
  day: DayResult | null; yearRes: YearResult | null; busy: number | null; error: string | null;
  tmy: { key: string; hours: TmyHour[] } | null;
  setProject: (p: Project) => void;
  setSite: (s: Partial<Site>) => void;
  setModulo: (m: Partial<ModuleSpec>) => void;
  setHouse: (h: Partial<House>) => void;
  setField: (id: string, f: Partial<Field>) => void;
  addField: (where: 'techo' | 'suelo') => void;
  removeField: (id: string) => void;
  setObs: (id: string, o: Partial<Obstacle>) => void;
  addObs: (t: ObsType) => void;
  removeObs: (id: string) => void;
  set: (s: Partial<State>) => void;
}

const OBS_NEW: Record<ObsType, Omit<Obstacle, 'id'>> = {
  arbol: { tipo: 'arbol', x: -8, y: 10, alto: 7, ancho: 0, largo: 0, rot: 0, copa: 4 },
  poste: { tipo: 'poste', x: 6, y: 9, alto: 8, ancho: 0.3, largo: 0.3, rot: 0, copa: 0 },
  edificio: { tipo: 'edificio', x: 0, y: 16, alto: 7, ancho: 8, largo: 6, rot: 0, copa: 0 },
  muro: { tipo: 'muro', x: 0, y: 9, alto: 2.5, ancho: 10, largo: 0.2, rot: 0, copa: 0 },
  chimenea: { tipo: 'chimenea', x: 0, y: 0, alto: 1.2, ancho: 0.6, largo: 0.6, rot: 0, copa: 0 },
};

export const useStore = create<State>((set, get) => {
  const touch = (project: Project) => {
    try { localStorage.setItem(KEY, JSON.stringify(project)); } catch { /* */ }
    set({ project, day: null, yearRes: null });
  };
  return {
    project: load(),
    sel: null, tab: 'casa', mode: 'instante',
    fecha: `${year}-06-21`, hora: 15, sub: 2, clima: 'despejado',
    showLabels: true, showDims: true, selModule: -1,
    day: null, yearRes: null, busy: null, error: null, tmy: null,
    setProject: p => { touch(p); set({ sel: null, selModule: -1 }); },
    setSite: s => touch({ ...get().project, site: { ...get().project.site, ...s } }),
    setModulo: m => touch({ ...get().project, modulo: { ...get().project.modulo, ...m } }),
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
    set: s => set(s as Partial<State>),
  };
});
