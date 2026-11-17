import { useEffect, useMemo, useRef, useState } from 'react';
import type { DayResult, TmyHour, YearResult } from '../engine/sim';
import { parseFecha, useSim } from '../sim/useSim';
import { heat, pct } from '../sim/viz';
import { useStore, type Mode } from '../store';
import { Seg } from './ui';

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

async function fetchTmy(lat: number, lon: number): Promise<TmyHour[]> {
  const r = await fetch(`/api/pvgis?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`);
  if (!r.ok) throw new Error(`No se pudo obtener PVGIS (${r.status}). En desarrollo local usa "vercel dev".`);
  const j = await r.json(); return j.hours;
}

const COLS: Record<Mode, string[]> = {
  instante: ['Módulo', 'Área sombreada', 'Pérdida eléctrica', 'Difusa bloqueada'],
  dia: ['Módulo', 'Sombra directa', 'Pérdida irradiancia', 'Pérdida eléctrica'],
  anio: ['Módulo', 'Sombra directa', 'Pérdida irradiancia', 'Pérdida eléctrica'],
};
interface RowT { i: number; id: string; a: number; b: number; c: number }

export function useRows(): { rows: RowT[]; have: boolean } {
  const { lay, instant, fdiff } = useSim();
  const mode = useStore(s => s.mode), day = useStore(s => s.day), yearRes = useStore(s => s.yearRes);
  return useMemo(() => {
    if (mode === 'instante') return {
      have: true, rows: lay.modules.map((m, i) => {
        const r = instant?.[i];
        return { i, id: m.id, a: r ? r.geom : 0, b: r && r.Gtot > 0 ? 1 - r.Psh / r.Gtot : 0, c: fdiff[i] ?? 0 };
      }),
    };
    const R = mode === 'dia' ? day : yearRes;
    if (!R || R.mods.length !== lay.modules.length) return { have: false, rows: [] };
    return { have: true, rows: lay.modules.map((m, i) => ({ i, id: m.id, a: R.mods[i].sombraDirecta, b: R.mods[i].perdIrr, c: R.mods[i].perdElec })) };
  }, [mode, lay, instant, fdiff, day, yearRes]);
}
export function rowsToCsv(mode: Mode, rows: RowT[]) {
  return [COLS[mode].join(';'), ...rows.map(r => [r.id, r.a, r.b, r.c].map((v, j) => (j ? (100 * (v as number)).toFixed(2).replace('.', ',') : v)).join(';'))].join('\n');
}

function Chart() {
  const mode = useStore(s => s.mode), day = useStore(s => s.day), yearRes = useStore(s => s.yearRes), hora = useStore(s => s.hora), fecha = useStore(s => s.fecha);
  const ref = useRef<HTMLCanvasElement>(null);
  const [w, setW] = useState(400);
  useEffect(() => { const ro = new ResizeObserver(e => setW(e[0].contentRect.width)); if (ref.current) ro.observe(ref.current); return () => ro.disconnect(); }, []);
  const title = mode === 'anio' && yearRes ? `PÉRDIDA MENSUAL · ${yearRes.fuente}` : day ? `PERFIL DIARIO · ${fecha}` : 'PERFIL DIARIO';
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const dpr = window.devicePixelRatio || 1, h = cv.clientHeight; cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d')!; g.scale(dpr, dpr); g.clearRect(0, 0, w, h); g.font = '11px Poppins, Arial';
    const L = 40, T = 22, B = 24, pw = w - L - 12, ph = h - T - B;
    let series: { n: string; c: string; v: number[] }[], xs: (number | string)[], bars = false;
    if (mode === 'anio' && yearRes) {
      bars = true; xs = ['E', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
      series = [{ n: 'Sombra directa', c: '#698090', v: yearRes.months.map(m => m.sombra) }, { n: 'Pérdida eléctrica', c: '#FAB704', v: yearRes.months.map(m => m.perdElec) }];
    } else if (day) {
      xs = day.prof.map(p => p.h);
      series = [{ n: 'Sombra directa', c: '#698090', v: day.prof.map(p => p.sombra) }, { n: 'Pérdida eléctrica', c: '#FAB704', v: day.prof.map(p => p.perdElec) }];
    } else { g.fillStyle = '#9fb0bd'; g.fillText('Ejecuta “Analizar día” o “Analizar año” para ver gráficos.', L, h / 2); return; }
    const ymax = Math.max(0.05, ...series.flatMap(s => s.v)) * 1.1, nice = [0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1].find(x => x >= ymax) ?? 1;
    g.strokeStyle = '#1d4560';
    for (let i = 0; i <= 4; i++) {
      const y = T + ph - (ph * i) / 4; g.beginPath(); g.moveTo(L, y + 0.5); g.lineTo(L + pw, y + 0.5); g.stroke();
      g.fillStyle = '#9fb0bd'; g.textAlign = 'right'; g.fillText(Math.round((100 * nice * i) / 4) + '%', L - 6, y + 4);
    }
    g.textAlign = 'center';
    if (bars) {
      const bw = pw / 12;
      xs.forEach((x, i) => {
        g.fillStyle = '#9fb0bd'; g.fillText(String(x), L + bw * (i + 0.5), T + ph + 16);
        series.forEach((s, j) => { const bh = (ph * s.v[i]) / nice; g.fillStyle = s.c; g.fillRect(L + bw * i + bw * 0.15 + j * bw * 0.36, T + ph - bh, bw * 0.33, bh); });
      });
    } else {
      const nx = xs as number[], x0 = Math.floor(nx[0]), x1 = Math.ceil(nx[nx.length - 1]), X = (hr: number) => L + (pw * (hr - x0)) / Math.max(1, x1 - x0);
      for (let hr = x0; hr <= x1; hr += 2) { g.fillStyle = '#9fb0bd'; g.fillText(hr + 'h', X(hr), T + ph + 16); }
      series.forEach(s => { g.strokeStyle = s.c; g.lineWidth = 2; g.beginPath(); s.v.forEach((v, i) => { const x = X(nx[i]), y = T + ph - (ph * v) / nice; if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke(); });
      if (hora >= x0 && hora <= x1) { g.strokeStyle = 'rgba(255,255,255,.5)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(X(hora), T); g.lineTo(X(hora), T + ph); g.stroke(); g.setLineDash([]); }
    }
    g.textAlign = 'left'; let lx = L;
    series.forEach(s => { g.fillStyle = s.c; g.fillRect(lx, 4, 10, 10); g.fillStyle = '#fff'; g.fillText(s.n, lx + 14, 13); lx += g.measureText(s.n).width + 34; });
  }, [w, mode, day, yearRes, hora]);
  return <><div className="lbl">{title}</div><canvas ref={ref} className="chart" /></>;
}

function Detail() {
  const { lay, instant, fdiff } = useSim();
  const selModule = useStore(s => s.selModule), day = useStore(s => s.day), yearRes = useStore(s => s.yearRes);
  const m = lay.modules[selModule];
  if (!m) return <p className="note">Haz clic en un módulo (3D o tabla) para ver su detalle.</p>;
  const r = instant?.[selModule];
  return (
    <p className="note">
      <b className="am">Módulo {m.id}</b> · {m.portrait ? 'vertical' : 'horizontal'} · difusa bloqueada {pct(fdiff[selModule])}
      {r && <><br />Instante: substrings al {r.Isub.map(I => Math.round((100 * I) / Math.max(1e-9, r.Gb + r.Gd + r.Gr)) + '%').join(' / ')} de su corriente sin sombra</>}
      {day && day.mods[selModule] && <><br />Día: pérdida eléctrica {pct(day.mods[selModule].perdElec)}</>}
      {yearRes && yearRes.mods[selModule] && <> · Año ({yearRes.fuente}): {pct(yearRes.mods[selModule].perdElec)}</>}
    </p>
  );
}

export default function Results() {
  const { lay, fdiff } = useSim();
  const mode = useStore(s => s.mode), set = useStore(s => s.set), busy = useStore(s => s.busy), error = useStore(s => s.error);
  const selModule = useStore(s => s.selModule), clima = useStore(s => s.clima), yearRes = useStore(s => s.yearRes), day = useStore(s => s.day);
  const { rows, have } = useRows();
  const [sort, setSort] = useState<{ k: keyof RowT; d: number } | null>(null);
  const list = useMemo(() => {
    if (!sort) return rows;
    return [...rows].sort((x, y) => (sort.k === 'id' ? sort.d * (x.i - y.i) : sort.d * ((x[sort.k] as number) - (y[sort.k] as number))));
  }, [rows, sort]);

  const params = () => {
    const s = useStore.getState(), site = s.project.site;
    return { sp: { lat: site.lat, lon: site.lon, tz: site.tz, albedo: site.albedo, sub: s.sub }, ...parseFecha(s.fecha) };
  };
  const analyzeDay = async () => {
    const { sp, y, m, d } = params();
    set({ busy: 0.3, error: null });
    try { const res = await runWorker({ job: 'dia', lay, fdiff, sp, y, m, d }, f => set({ busy: f })); set({ day: res as DayResult, mode: 'dia' }); }
    catch (e) { set({ error: String((e as Error).message) }); } finally { set({ busy: null }); }
  };
  const analyzeYear = async () => {
    const { sp, y } = params(), st = useStore.getState();
    set({ busy: 0.02, error: null });
    try {
      let tmy: TmyHour[] | null = null;
      if (st.clima === 'pvgis') {
        const key = `${sp.lat.toFixed(3)},${sp.lon.toFixed(3)}`;
        tmy = st.tmy?.key === key ? st.tmy.hours : await fetchTmy(sp.lat, sp.lon);
        set({ tmy: { key, hours: tmy } });
      }
      const res = await runWorker({ job: 'anio', lay, fdiff, sp, y, tmy }, f => set({ busy: f }));
      set({ yearRes: res as YearResult, mode: 'anio' });
    } catch (e) { set({ error: String((e as Error).message) }); } finally { set({ busy: null }); }
  };

  let kpis: [string, string, string][] = [];
  if (have && rows.length) {
    if (mode === 'instante') {
      const avg = (k: 'a' | 'b') => rows.reduce((s, r) => s + r[k], 0) / rows.length, worst = rows.reduce((a, b) => (b.b > a.b ? b : a));
      kpis = [['Área sombreada', pct(avg('a')), 'promedio'], ['Pérdida eléctrica', pct(avg('b')), 'promedio'], ['Con sombra', `${rows.filter(r => r.a > 0).length}/${rows.length}`, 'módulos'], ['Peor módulo', worst.id, pct(worst.b)]];
    } else {
      const R = (mode === 'dia' ? day : yearRes)!, W = R.mods.reduce((s, r) => s + r.Gtot, 0) || 1;
      const wavg = (k: 'sombraDirecta' | 'perdIrr' | 'perdElec') => R.mods.reduce((s, r) => s + r[k] * r.Gtot, 0) / W;
      const worst = rows.reduce((a, b) => (b.c > a.c ? b : a));
      kpis = [['Sombra directa', pct(wavg('sombraDirecta')), 'ponderada'], ['Pérdida irradiancia', pct(wavg('perdIrr')), 'directa + difusa'], ['Pérdida eléctrica', pct(wavg('perdElec')), 'con bypass'], ['Peor módulo', worst.id, pct(worst.c)]];
    }
  }
  const colorKey = mode === 'instante' ? 'a' : 'c';
  return (
    <section className="res">
      <div className="col">
        <div className="tabs">
          <Seg value={mode} options={[['instante', 'Instante'], ['dia', 'Día'], ['anio', 'Año']]} onChange={m => set({ mode: m })} />
          <button className="btn pri sm" onClick={analyzeDay} disabled={busy != null}>Analizar día</button>
          <button className="btn sec sm" onClick={analyzeYear} disabled={busy != null}>Analizar año</button>
          <select className="clima" value={clima} onChange={e => set({ clima: e.target.value as 'despejado' | 'pvgis' })} title="Clima para el análisis anual">
            <option value="despejado">Año: cielo despejado</option><option value="pvgis">Año: clima PVGIS (TMY)</option>
          </select>
        </div>
        {busy != null && <div className="prog"><div style={{ width: `${Math.round(busy * 100)}%` }} /></div>}
        {error && <div className="warn">⚠ {error}</div>}
        {!have && <div className="stale">Presiona “Analizar {mode === 'dia' ? 'día' : 'año'}” para calcular.</div>}
        <div className="kpis">{kpis.map(([k, v, s]) => <div className="kpi" key={k}><div className="k">{k}</div><div className="v">{v}</div><div className="s">{s}</div></div>)}</div>
        {have && <table>
          <thead><tr>{COLS[mode].map((c, j) => {
            const k = (['id', 'a', 'b', 'c'] as const)[j];
            return <th key={c} onClick={() => setSort(s => (s?.k === k ? { k, d: -s.d } : { k, d: k === 'id' ? 1 : -1 }))}>{c}{sort?.k === k ? (sort.d > 0 ? ' ▲' : ' ▼') : ''}</th>;
          })}</tr></thead>
          <tbody>{list.map(r => (
            <tr key={r.i} className={r.i === selModule ? 'sel' : ''} onClick={() => set({ selModule: r.i })}>
              <td><span className="chip" style={{ background: heat(r[colorKey]) }} />{r.id}</td><td>{pct(r.a)}</td><td>{pct(r.b)}</td><td>{pct(r.c)}</td>
            </tr>))}</tbody>
        </table>}
      </div>
      <div className="col"><Chart /><Detail /></div>
    </section>
  );
}
