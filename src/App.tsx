import { useEffect, useRef, useState } from 'react';
import Logo from './components/Logo';
import Results, { rowsToCsv, useRows } from './components/Results';
import Sidebar from './components/Sidebar';
import Viewer, { camBus } from './components/Viewer';
import type { Project } from './engine/project';
import { SimContext, useSim, useSimState } from './sim/useSim';
import { useStore } from './store';

function SunInfo() {
  const { sun } = useSim();
  return <div className="ov suninfo">{sun.el > 0
    ? <><div>Elevación <b>{sun.el.toFixed(1)}°</b> · Azimut <b>{sun.az.toFixed(1)}°</b></div><div>DNI {sun.dni.toFixed(0)} · GHI {sun.ghi.toFixed(0)} W/m² (despejado)</div></>
    : <div><b>Sol bajo el horizonte</b></div>}</div>;
}

function TimeBar() {
  const fecha = useStore(s => s.fecha), hora = useStore(s => s.hora), set = useStore(s => s.set);
  const [play, setPlay] = useState(false);
  useEffect(() => {
    if (!play) return;
    const t = setInterval(() => { const h = useStore.getState().hora + 1 / 12; set({ hora: h > 21 ? 5 : h }); }, 90);
    return () => clearInterval(t);
  }, [play, set]);
  const hh = Math.floor(hora), mm = Math.round((hora - hh) * 60) % 60;
  return (
    <div className="ov timebar">
      <input type="date" value={fecha} onChange={e => e.target.value && set({ fecha: e.target.value, day: null })} />
      <button className="play" onClick={() => setPlay(p => !p)} title="Animar el día">{play ? '❚❚' : '▶'}</button>
      <input type="range" min={5} max={21} step={1 / 12} value={hora} onChange={e => set({ hora: +e.target.value })} />
      <span className="hr">{String(hh).padStart(2, '0')}:{String(mm).padStart(2, '0')}</span>
    </div>
  );
}

function Legend() {
  const mode = useStore(s => s.mode);
  return mode === 'instante'
    ? <div className="ov legend"><div>Celdas sombreadas en este instante</div><div className="bar inst" /><div className="ticks"><span>Iluminada</span><span>Sombreada</span></div></div>
    : <div className="ov legend"><div>Sombra directa por celda ({mode === 'dia' ? 'día' : 'año'})</div><div className="bar" /><div className="ticks"><span>0%</span><span>10%</span><span>20%</span><span>≥30%</span></div></div>;
}

function ViewButtons() {
  const showLabels = useStore(s => s.showLabels), showDims = useStore(s => s.showDims), set = useStore(s => s.set);
  const hideSide = useStore(s => s.hideSide), hideRes = useStore(s => s.hideRes), full = hideSide && hideRes;
  // Esc sale de la pantalla completa 3D (si el foco no está en un campo de texto)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== 'Escape' || t?.closest('input,select,textarea')) return;
      const s = useStore.getState(); if (s.hideSide && s.hideRes) s.set({ hideSide: false, hideRes: false });
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="ov viewbtns">
      <button onClick={() => camBus.fn('3d')}>Vista 3D</button>
      <button onClick={() => camBus.fn('top')}>Planta</button>
      <button onClick={() => camBus.fn('sun')}>Desde el sol</button>
      <button className={showLabels ? 'on' : ''} onClick={() => set({ showLabels: !showLabels })}>Etiquetas</button>
      <button className={showDims ? 'on' : ''} onClick={() => set({ showDims: !showDims })}>Cotas</button>
      <span className="sep" />
      <button className={hideSide ? 'on' : ''} onClick={() => set({ hideSide: !hideSide })} title="Colapsa la barra lateral; el visor 3D ocupa su espacio">{hideSide ? 'Mostrar panel lateral' : 'Ocultar panel lateral'}</button>
      <button className={hideRes ? 'on' : ''} onClick={() => set({ hideRes: !hideRes })} title="Colapsa el panel de resultados">{hideRes ? 'Mostrar resultados' : 'Ocultar resultados'}</button>
      <button className={full ? 'on' : ''} onClick={() => set({ hideSide: !full, hideRes: !full })} title="Oculta ambos paneles (Esc para salir)">{full ? 'Salir de pantalla completa' : 'Pantalla completa 3D'}</button>
    </div>
  );
}

function Header() {
  const project = useStore(s => s.project), { setProject } = useStore.getState(), mode = useStore(s => s.mode);
  const { rows } = useRows();
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 1800); };
  const download = (name: string, text: string, type: string) => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); URL.revokeObjectURL(a.href);
  };
  const safe = project.nombre.replace(/[^\w\-áéíóúñ ]/gi, '').trim() || 'proyecto';
  return (
    <header>
      <Logo />
      <div className="ttl"><div className="lbl">SIMULADOR DE SOMBRAS FV · v0.3</div>
        <input className="pname" value={project.nombre} onChange={e => setProject({ ...project, nombre: e.target.value })} /></div>
      <div className="sp" />
      {msg && <span className="flash">{msg}</span>}
      <button className="btn sec sm" onClick={() => file.current?.click()}>Abrir</button>
      <button className="btn sec sm" onClick={() => download(`${safe}.sombras.json`, JSON.stringify(project, null, 2), 'application/json')}>Guardar</button>
      <button className="btn sec sm" onClick={() => download(`${safe}-${mode}.csv`, rowsToCsv(mode, rows), 'text/csv')}>Exportar CSV</button>
      <button className="btn pri sm" onClick={() => { if (confirm('¿Crear un proyecto nuevo? Se perderán los cambios no guardados.')) { useStore.getState().resetStorage(); location.reload(); } }}>Nuevo</button>
      <input ref={file} type="file" accept=".json" hidden onChange={async e => {
        const f = e.target.files?.[0]; if (!f) return;
        try { const p = JSON.parse(await f.text()) as Project; if (p.version !== 2) throw new Error(); setProject(p); flash('Proyecto cargado'); }
        catch { flash('Archivo no válido'); }
        e.target.value = '';
      }} />
    </header>
  );
}

export default function App() {
  const sim = useSimState();
  const hideSide = useStore(s => s.hideSide), hideRes = useStore(s => s.hideRes);
  return (
    <SimContext.Provider value={sim}>
      <Header />
      <div className={'app' + (hideSide ? ' noside' : '')}>
        <Sidebar />
        <main className={hideRes ? 'nores' : ''}>
          <div className="view">
            <Viewer />
            <ViewButtons /><SunInfo /><TimeBar /><Legend />
          </div>
          <Results />
        </main>
      </div>
    </SimContext.Provider>
  );
}
