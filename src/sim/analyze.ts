// Lanzar los análisis de Día / Año en el Web Worker (lo usan el paso "Simular" y el panel de resultados).
import type { Weather } from '../engine/project';
import type { DayResult, YearResult } from '../engine/sim';
import { parseWeather } from '../engine/weather';
import { useStore, type Mode } from '../store';
import { parseFecha, type SimCtx } from './useSim';

let worker: Worker | null = null;
function runWorker(msg: unknown, onProgress: (f: number) => void): Promise<DayResult | YearResult> {
  worker?.terminate();
  worker = new Worker(new URL('../engine/worker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    worker!.onmessage = e => {
      if (e.data.type === 'progress') onProgress(e.data.f);
      else if (e.data.type === 'done') resolve(e.data.result);
      else reject(new Error(e.data.message));
    };
    worker!.postMessage(msg);
  });
}

async function fetchPvgis(lat: number, lon: number, tz: number): Promise<Weather> {
  const r = await fetch(`/api/pvgis?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`);
  if (!r.ok) throw new Error(`No se pudo obtener PVGIS (${r.status}). En desarrollo local usa "vercel dev".`);
  const w = parseWeather(await r.text(), 'PVGIS', { lat, lon, tz });
  return { ...w, nombre: `PVGIS ${lat.toFixed(2)}, ${lon.toFixed(2)}`, fuente: 'PVGIS TMY' };
}

type Ctx = Pick<SimCtx, 'lay' | 'fdiff' | 'es'>;

function params() {
  const s = useStore.getState(), site = s.project.site;
  return { sp: { lat: site.lat, lon: site.lon, tz: site.tz, albedo: site.albedo, sub: s.sub }, ...parseFecha(s.fecha) };
}

// Al terminar, el visor pasa solo al mapa de color del análisis. Si la geometría cambió mientras se
// calculaba, el resultado nace desactualizado; el otro análisis, si estaba desactualizado, se descarta.
function done(patch: { day: DayResult } | { yearRes: YearResult }, mode: Mode, p0: unknown) {
  const st = useStore.getState(), other = mode === 'dia' ? { yearRes: null } : { day: null };
  st.set({ ...patch, ...(st.stale ? other : {}), mode, stale: st.project !== p0 });
}

export async function analyzeDay({ lay, fdiff, es }: Ctx) {
  const set = useStore.getState().set, { sp, y, m, d } = params(), p0 = useStore.getState().project;
  set({ busy: 0.3, error: null });
  try { const res = await runWorker({ job: 'dia', lay, fdiff, sp, es, y, m, d }, f => set({ busy: f })); done({ day: res as DayResult }, 'dia', p0); }
  catch (e) { set({ error: String((e as Error).message) }); } finally { set({ busy: null }); }
}

export async function analyzeYear({ lay, fdiff, es }: Ctx) {
  const st = useStore.getState(), set = st.set, { sp, y } = params(), p0 = st.project;
  set({ busy: 0.02, error: null });
  try {
    let clima: Weather | null = null;
    if (st.clima === 'archivo') {
      clima = st.project.clima ?? null;
      if (!clima) throw new Error('Carga primero un archivo de clima (paso Simular → Datos de clima).');
    } else if (st.clima === 'pvgis') {
      const key = `${sp.lat.toFixed(3)},${sp.lon.toFixed(3)}`;
      clima = st.pvgisCache?.key === key ? st.pvgisCache.w : await fetchPvgis(sp.lat, sp.lon, sp.tz);
      set({ pvgisCache: { key, w: clima } });
    }
    const res = await runWorker({ job: 'anio', lay, fdiff, sp, es, y, clima }, f => set({ busy: f }));
    done({ yearRes: res as YearResult }, 'anio', p0);
  } catch (e) { set({ error: String((e as Error).message) }); } finally { set({ busy: null }); }
}
