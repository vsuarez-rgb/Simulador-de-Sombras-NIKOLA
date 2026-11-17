import { useEffect, useMemo, useRef, useState } from 'react';
import type { ElecResult } from '../engine/sim';
import { analyzeDay, analyzeYear } from '../sim/analyze';
import { useSim } from '../sim/useSim';
import { heat, pct } from '../sim/viz';
import { DESIGN_STEPS, useStore, type Mode } from '../store';
import SunChart from './SunChart';
import { Seg } from './ui';

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
      series = [{ n: 'Sombra directa', c: '#698090', v: yearRes.months.map(m => m.sombra) }, { n: 'Pérdida por módulo', c: '#F5CC5A', v: yearRes.months.map(m => m.perdElec) }, { n: 'Pérdida string', c: '#D2402E', v: yearRes.months.map(m => m.perdString) }];
    } else if (day) {
      xs = day.prof.map(p => p.h);
      series = [{ n: 'Sombra directa', c: '#698090', v: day.prof.map(p => p.sombra) }, { n: 'Pérdida por módulo', c: '#F5CC5A', v: day.prof.map(p => p.perdElec) }, { n: 'Pérdida string', c: '#D2402E', v: day.prof.map(p => p.perdString) }];
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
        series.forEach((s, j) => { const bh = (ph * s.v[i]) / nice; g.fillStyle = s.c; g.fillRect(L + bw * i + bw * 0.1 + j * bw * 0.27, T + ph - bh, bw * 0.25, bh); });
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
      {r && <><br />Instante: substrings al {r.Isub.map(I => Math.round((100 * I) / Math.max(1e-9, r.Gref)) + '%').join(' / ')} de su corriente sin sombra</>}
      {day && day.mods[selModule] && <><br />Día: pérdida eléctrica {pct(day.mods[selModule].perdElec)}</>}
      {yearRes && yearRes.mods[selModule] && <> · Año ({yearRes.fuente}): {pct(yearRes.mods[selModule].perdElec)}</>}
    </p>
  );
}

export default function Results() {
  const { lay, fdiff, es } = useSim();
  const mode = useStore(s => s.mode), set = useStore(s => s.set), busy = useStore(s => s.busy), error = useStore(s => s.error), stale = useStore(s => s.stale);
  const selModule = useStore(s => s.selModule), tab = useStore(s => s.tab), yearRes = useStore(s => s.yearRes), day = useStore(s => s.day);
  const { rows, have } = useRows();
  const [sort, setSort] = useState<{ k: keyof RowT; d: number } | null>(null);
  const list = useMemo(() => {
    if (!sort) return rows;
    return [...rows].sort((x, y) => (sort.k === 'id' ? sort.d * (x.i - y.i) : sort.d * ((x[sort.k] as number) - (y[sort.k] as number))));
  }, [rows, sort]);

  const ctx = { lay, fdiff, es };

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
  // En los pasos de diseño (1–4) solo se muestra el diagrama solar; los resultados aparecen al simular.
  if (DESIGN_STEPS.includes(tab)) return (
    <section className="res solo">
      <div className="col"><div className="tabs"><span className="lbl">Diagrama solar · trayectorias del sol y lo que lo tapa</span><BigSunChart /></div><SunChart height={168} /></div>
    </section>
  );
  const run = () => (mode === 'anio' ? analyzeYear(ctx) : analyzeDay(ctx));
  return (
    <section className="res">
      <div className="col">
        <div className="tabs">
          <Seg value={mode} options={[['instante', 'Instante'], ['dia', 'Día'], ['anio', 'Año']]} onChange={m => set({ mode: m })} />
          {mode !== 'instante' && <button className="btn pri sm" onClick={run} disabled={busy != null}>{have ? 'Volver a simular' : 'Simular'} {mode === 'dia' ? 'día' : 'año'}</button>}
        </div>
        {busy != null && <div className="prog"><div style={{ width: `${Math.round(busy * 100)}%` }} /></div>}
        {error && <div className="warn">⚠ {error}</div>}
        {!have && <div className="stale">Aún no hay resultados del {mode === 'dia' ? 'día' : 'año'}: presiona “Simular”.</div>}
        {have && stale && mode !== 'instante' && <div className="warn">⚠ Resultados desactualizados: la geometría o la configuración cambió desde la última simulación. Vuelve a simular el {mode === 'dia' ? 'día' : 'año'}.</div>}
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
      <div className="col"><RightPanel elec={(mode === 'dia' ? day?.elec : mode === 'anio' ? yearRes?.elec : null) ?? null} periodo={mode === 'dia' ? 'día' : 'año'} /></div>
    </section>
  );
}

const kwh = (x: number) => (x >= 100 ? x.toFixed(0) : x.toFixed(1));
function RightPanel({ elec, periodo }: { elec: ElecResult | null; periodo: string }) {
  const [tab, setTab] = useState<'grafico' | 'strings' | 'solar'>('grafico');
  return (
    <>
      <div className="tabs">
        <Seg value={tab} options={[['grafico', 'Gráfico'], ['strings', 'Strings y optimizadores'], ['solar', 'Diagrama solar']]} onChange={setTab} />
        {tab === 'solar' && <BigSunChart />}
      </div>
      {tab === 'solar' ? <SunChart /> : tab === 'grafico' ? <><Chart /><Detail /></> : <ElecPanel elec={elec} periodo={periodo} />}
    </>
  );
}

/** Botón "Ampliar" que abre el diagrama solar grande en una ventana (Esc o clic fuera para cerrar). */
function BigSunChart() {
  const [big, setBig] = useState(false);
  useEffect(() => {
    if (!big) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setBig(false); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [big]);
  return (
    <>
      <button className="btn ter sm" onClick={() => setBig(true)}>Ampliar</button>
      {big && (
        <div className="modal" onClick={() => setBig(false)}>
          <div className="modalbox" onClick={e => e.stopPropagation()}>
            <div className="modalhead"><span className="lbl">Diagrama solar · trayectorias del sol y sombras</span><button className="btn sec sm" onClick={() => setBig(false)}>Cerrar</button></div>
            <SunChart height={420} />
            <p className="note">Cada curva es la trayectoria del sol el día 21 del mes; las líneas punteadas unen la misma hora a lo largo del año. La zona gris es lo que tapa el sol (casa, objetos y otros campos) visto desde el módulo indicado: cuando la curva del sol pasa por la zona gris, ese módulo queda a la sombra.</p>
          </div>
        </div>
      )}
    </>
  );
}

function ElecPanel({ elec, periodo }: { elec: ElecResult | null; periodo: string }) {
  const { lay, rs } = useSim();
  const optimizados = useStore(s => s.project.elec.optimizados), { setElec } = useStore.getState(), set = useStore(s => s.set);
  if (!elec) return <p className="note">Ejecuta “Analizar día” o “Analizar año” para comparar configuraciones: string, optimizadores y eliminar módulos.</p>;
  const ref = elec.ref || 1, nOpt = rs.optimized.length;
  const scen: [string, number, string][] = [
    ['Sin sombra (referencia)', elec.ref, ''],
    [nOpt ? `Configuración actual (${nOpt} optimizador${nOpt > 1 ? 'es' : ''})` : 'Configuración actual (string)', elec.actual, 'act'],
    ['Inversor string, sin optimizadores', elec.noOpt, ''],
    ['Optimizadores en todos los módulos', elec.allOpt, ''],
  ];
  const lossMod = 1 - elec.modMpp / ref, lossMis = (elec.modMpp - elec.noOpt) / ref;
  const recOpt = elec.mods.map((m, i) => ({ i, g: m.optGain })).filter(x => x.g > 0.002 * elec.actual).sort((a, b) => b.g - a.g).slice(0, 5);
  const recRem = elec.mods.map((m, i) => ({ i, g: m.removeGain, own: m.ref })).filter(x => rs.stringOf[x.i] >= 0 && x.own > 0)
    .map(x => ({ ...x, frac: -x.g / x.own })).filter(x => x.frac < 0.6).sort((a, b) => a.frac - b.frac).slice(0, 5);
  const key = (i: number) => lay.modules[i]?.key;
  return (
    <div className="elec">
      <div className="lbl">Energía DC del {periodo} por configuración</div>
      <table className="scen"><tbody>
        {scen.map(([n, e, c]) => <tr key={n} className={c}><td>{n}</td><td>{kwh(e)} kWh</td><td>{e === elec.ref ? '—' : `−${pct(1 - e / ref)}`}</td></tr>)}
      </tbody></table>
      <p className="note">Pérdida por sombra a nivel módulo (lo que ningún optimizador recupera): <b>{pct(lossMod)}</b> · Pérdida por mismatch del string (lo que un optimizador sí puede recuperar): <b className="am">{pct(lossMis)}</b>
        {lossMis < 1 - 0.99 ? ' → menor que la pérdida propia de los optimizadores (~1%): no se justifican en todos los módulos.' : ''}</p>
      <div className="lbl" style={{ marginTop: 10 }}>Strings</div>
      <table><thead><tr><th>String</th><th>Mód.</th><th>MPPT</th><th>kWh</th><th>Pérd. total</th><th>Mismatch</th><th>Vmp pico</th></tr></thead>
        <tbody>{elec.strings.map(s => <tr key={s.name}><td>{s.name}</td><td>{s.n}</td><td>{s.mppt + 1}</td><td>{kwh(s.actual)}</td><td>{pct(1 - s.actual / (s.ref || 1))}</td><td>{pct((s.modMpp - s.actual) / (s.ref || 1))}</td><td>{s.vmpMax.toFixed(0)} V</td></tr>)}</tbody></table>
      {rs.avisos.map(a => <div key={a} className="warn">⚠ {a}</div>)}
      <div className="lbl" style={{ marginTop: 10 }}>Recomendaciones</div>
      {!recOpt.length && !recRem.length && <p className="note">No hay módulos donde un optimizador o eliminar el módulo mejore de forma relevante.</p>}
      {recOpt.map(x => (
        <div className="rec" key={'o' + x.i}><span><b>Optimizador en {lay.modules[x.i].id}</b>: +{kwh(x.g)} kWh/{periodo} (+{pct(x.g / (elec.actual || 1))} del total)</span>
          <button className="btn ter" onClick={() => { setElec({ optimizados: [...optimizados, key(x.i)] }); set({ selModule: x.i }); }}>Agregar</button></div>))}
      {recRem.map(x => (
        <div className="rec" key={'r' + x.i}><span><b>{x.g > 0 ? 'Eliminar' : 'Evaluar eliminar'} {lay.modules[x.i].id}</b>: {x.g > 0 ? '+' : '−'}{kwh(Math.abs(x.g))} kWh/{periodo} — aporta solo {pct(Math.max(0, x.frac))} de lo que daría sin sombra</span>
          <button className="btn ter" onClick={() => { setElec({ excluidos: [...useStore.getState().project.elec.excluidos, key(x.i)] }); set({ selModule: x.i }); }}>Excluir</button></div>))}
      <p className="note">Recomendaciones calculadas para strings con MPPT propio. Optimizador modelado tipo “buck” (selectivo, ej. Tigo TS4) con eficiencia configurable; “Optimizadores en todos” equivale a un sistema tipo SolarEdge o microinversores (sin contar la conversión AC).</p>
    </div>
  );
}
