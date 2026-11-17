import { useRef, useState, type ReactNode } from 'react';
import { distanceToHouse, eaveHeight, TILT_RANGES, uid, type ElecTool, type ObsType, type RoofType, type TiltRange, type VolTipo } from '../engine/project';
import { parseWeather, weatherSummary } from '../engine/weather';
import { analyzeDay, analyzeYear } from '../sim/analyze';
import { daySummary, hhmm } from '../sim/sunpath';
import { STRING_COLORS, pct } from '../sim/viz';
import { goStep, NUDGE, STEPS, useStore, type Clima, type Sel, type Tab } from '../store';
import { parseFecha, useSim } from '../sim/useSim';
import { H3, Num, Row, Seg } from './ui';

const CIUDADES: [string, number, number][] = [
  ['Arica', -18.48, -70.31], ['Iquique', -20.21, -70.15], ['Antofagasta', -23.65, -70.4], ['Calama', -22.46, -68.93],
  ['Copiapó', -27.37, -70.33], ['La Serena', -29.9, -71.25], ['Valparaíso', -33.05, -71.61], ['Santiago', -33.45, -70.66],
  ['Rancagua', -34.17, -70.74], ['Talca', -35.43, -71.66], ['Concepción', -36.83, -73.05], ['Temuco', -38.74, -72.6],
  ['Puerto Montt', -41.47, -72.94], ['Punta Arenas', -53.16, -70.92],
];
const OBS_LBL: Record<ObsType, string> = { arbol: 'Árbol', poste: 'Poste', edificio: 'Edificio vecino', muro: 'Muro', chimenea: 'Chimenea / ducto' };
const ico = (d: ReactNode) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>;
const OBS_ICON: Record<ObsType, ReactNode> = {
  arbol: ico(<><circle cx="12" cy="9" r="6" /><path d="M12 15v7M9 22h6" /></>),
  poste: ico(<><path d="M12 2v20M7 5h10M8 22h8" /></>),
  edificio: ico(<><rect x="5" y="3" width="14" height="19" rx="1" /><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M11 22v-3h2v3" /></>),
  muro: ico(<><rect x="2" y="8" width="20" height="10" rx="1" /><path d="M2 13h20M8 8v5M16 8v5M12 13v5" /></>),
  chimenea: ico(<><path d="M3 21l9-8 9 8" /><rect x="14" y="7" width="4" height="9" /><path d="M15 4c0 1 1 1 1 2" /></>),
};
const ROOF: [RoofType, string][] = [['plano', 'Plano'], ['una_agua', '1 agua'], ['dos_aguas', '2 aguas'], ['cuatro_aguas', '4 aguas']];

/** Nombre del punto cardinal más cercano a un azimut (0 = Norte, sentido horario). */
const rumbo = (az: number) => ['Norte', 'Noreste', 'Este', 'Sureste', 'Sur', 'Suroeste', 'Oeste', 'Noroeste'][Math.round((((az % 360) + 360) % 360) / 45) % 8];

/** Opciones avanzadas plegadas: lo esencial queda a la vista, el resto a un clic. */
const More = ({ children, label = 'Más opciones' }: { children: ReactNode; label?: string }) => (
  <details className="more"><summary>{label}</summary><div>{children}</div></details>
);

/** Botón que repite la acción mientras se mantiene presionado (mouse o dedo). */
function HoldButton({ onStep, children, title, className }: { onStep: () => void; children: ReactNode; title?: string; className?: string }) {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const stop = () => { clearTimeout(timer.current); clearInterval(timer.current); };
  const start = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    onStep(); stop();
    timer.current = setTimeout(() => { timer.current = setInterval(onStep, 90); }, 400);
  };
  return <button type="button" className={className} title={title} onPointerDown={start} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onStep(); } }}>{children}</button>;
}

/**
 * Mover y girar el objeto seleccionado con botones: cruz con los puntos cardinales (N arriba),
 * giro horario/antihorario y tamaño del paso. Sin arrastrar en el 3D.
 */
function Mover({ target, x, y, rot, rotLabel = 'Giro' }: { target: Sel; x: number; y: number; rot?: number; rotLabel?: string }) {
  const nudge = useStore(s => s.nudge), st = useStore.getState(), set = st.set;
  // actúa siempre sobre el objeto de esta ficha (aunque se haya hecho clic en el vacío del 3D)
  const moveSel = (dx: number, dy: number) => { set({ sel: target }); st.moveSel(dx, dy); };
  const rotateSel = (d: number) => { set({ sel: target }); st.rotateSel(d); };
  const [m, deg] = NUDGE[nudge];
  const pos = (v: number, pos: string, neg: string) => (Math.abs(v) < 0.005 ? `0 m ${pos}` : `${Math.abs(v).toFixed(2)} m al ${v > 0 ? pos : neg}`);
  return (
    <div className="mover">
      <div className="pad">
        <span />
        <HoldButton className="arr" onStep={() => moveSel(0, m)} title={`Mover ${m} m al Norte`}>▲<i>N</i></HoldButton>
        <span />
        <HoldButton className="arr" onStep={() => moveSel(-m, 0)} title={`Mover ${m} m al Oeste`}>◀<i>O</i></HoldButton>
        <div className="mid"><b>{m} m</b></div>
        <HoldButton className="arr" onStep={() => moveSel(m, 0)} title={`Mover ${m} m al Este`}><i>E</i>▶</HoldButton>
        <span />
        <HoldButton className="arr" onStep={() => moveSel(0, -m)} title={`Mover ${m} m al Sur`}>▼<i>S</i></HoldButton>
        <span />
      </div>
      <div className="side">
        <div className="where"><span>Posición</span>{pos(x, 'Este', 'Oeste')}<br />{pos(y, 'Norte', 'Sur')}</div>
        {rot !== undefined && <div className="rot">
          <span>{rotLabel}: <b>{rot.toFixed(0)}°</b> ({rumbo(rot)})</span>
          <div>
            <HoldButton onStep={() => rotateSel(-deg)} title={`Girar ${deg}° a la izquierda`}>⟲ {deg}°</HoldButton>
            <HoldButton onStep={() => rotateSel(deg)} title={`Girar ${deg}° a la derecha`}>⟳ {deg}°</HoldButton>
          </div>
        </div>}
        <div className="steps">{(['Fino', 'Normal', 'Grande'] as const).map((n, k) => (
          <button key={n} className={nudge === k ? 'on' : ''} onClick={() => set({ nudge: k as 0 | 1 | 2 })} title={`${NUDGE[k][0]} m · ${NUDGE[k][1]}°`}>{n}</button>))}</div>
      </div>
    </div>
  );
}

const STEP_INFO: Record<Tab,{ t: string; short: string; d: string }> = {
  casa: { t: 'Diseño de la casa', short: 'Casa', d: 'Arma la casa con volúmenes: el cuerpo principal, ampliaciones de otro alto, un quincho o una bodega separada.' },
  sitio: { t: 'Ubicación', short: 'Lugar', d: 'Elige la ciudad del proyecto. La trayectoria del sol (3D y diagrama) cambia con la ubicación y el mes.' },
  objetos: { t: 'Sombras del entorno', short: 'Sombras', d: 'Agrega lo que puede dar sombra (árboles, vecinos, postes, muros, chimeneas) y arrástralo en el 3D a su lugar. Es opcional.' },
  paneles: { t: 'Paneles', short: 'Paneles', d: 'Agrega campos de paneles sobre los techos o el suelo y arrástralos en el 3D. Los módulos que chocan con un objeto se quitan solos.' },
  simular: { t: 'Simular', short: 'Simular', d: 'Calcula cuánto pierden los paneles por sombra en un día o en el año completo.' },
  electrico: { t: 'Eléctrico', short: 'Eléctrico', d: 'Ajusta inversor, strings y optimizadores, y compara cuánta energía se recupera.' },
};

// ---------- 2. Ubicación ----------
function Sitio() {
  const p = useStore(s => s.project), { setSite, set } = useStore.getState(), fecha = useStore(s => s.fecha), showSunPath = useStore(s => s.showSunPath);
  const { y } = parseFecha(fecha), inv = daySummary(p.site, y, 6, 21), ver = daySummary(p.site, y, 12, 21), sur = p.site.lat < 0;
  const [w, s] = sur ? [inv, ver] : [ver, inv];
  return (
    <>
      <label className="mb big">Ciudad
        <select value={p.site.nombre} onChange={e => { const c = CIUDADES.find(c => c[0] === e.target.value); if (c) setSite({ nombre: c[0], lat: c[1], lon: c[2] }); }}>
          <option value="">— otra ubicación (coordenadas) —</option>
          {CIUDADES.map(c => <option key={c[0]}>{c[0]}</option>)}
        </select>
      </label>
      <Row>
        <Num label="Latitud" value={p.site.lat} step={0.01} min={-89} max={89} onChange={lat => setSite({ lat, nombre: '' })} />
        <Num label="Longitud" value={p.site.lon} step={0.01} min={-180} max={180} onChange={lon => setSite({ lon, nombre: '' })} />
      </Row>
      <div className="card thin suncards">
        <div><span className="lbl">Invierno · 21 {sur ? 'jun' : 'dic'}</span><b>{w.horas.toFixed(1)} h de sol</b><span>sol máx. {w.maxEl.toFixed(0)}° · {w.sale !== null ? `${hhmm(w.sale)}–${hhmm(w.pone!)}` : '—'}</span></div>
        <div><span className="lbl">Verano · 21 {sur ? 'dic' : 'jun'}</span><b>{s.horas.toFixed(1)} h de sol</b><span>sol máx. {s.maxEl.toFixed(0)}° · {s.sale !== null ? `${hhmm(s.sale)}–${hhmm(s.pone!)}` : '—'}</span></div>
      </div>
      <label className="check"><input type="checkbox" checked={showSunPath} onChange={e => set({ showSunPath: e.target.checked })} /> Mostrar el recorrido del sol en el 3D</label>
      <p className="note">Con el recorrido visible, usa los botones <b>Ene … Dic</b> bajo el visor para ver cómo cambia durante el año. También se activa o desactiva con el botón “Trayectoria solar”.</p>
      <More>
        <Row>
          <label>Zona horaria (UTC)<select value={p.site.tz} onChange={e => setSite({ tz: +e.target.value })}>{[-3, -4, -5, -6].map(t => <option key={t} value={t}>{t}</option>)}</select></label>
          <Num label="Albedo del suelo" value={p.site.albedo} step={0.05} min={0} max={1} onChange={albedo => setSite({ albedo })} />
        </Row>
      </More>
    </>
  );
}

const VOL_ADD: [VolTipo, string, string, ReactNode][] = [
  ['casa', 'Casa', 'Cuerpo principal (1 o más pisos)', ico(<><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-5h4v5" /></>)],
  ['ampliacion', 'Ampliación', 'Cuerpo pegado al costado', ico(<><path d="M2 12l6-5 6 5" /><path d="M3 11v9h10v-9" /><path d="M13 14h8v6h-8" /></>)],
  ['quincho', 'Quincho', 'Construcción separada', ico(<><path d="M4 11l8-6 8 6" /><path d="M6 11v9M18 11v9" /><path d="M9 20v-4h6v4" /></>)],
  ['garage', 'Garage / bodega', 'Techo plano, 1 piso', ico(<><rect x="3" y="8" width="18" height="12" rx="1" /><path d="M6 20v-7h12v7M6 16h12" /></>)],
];

// ---------- 1. Diseño de la casa ----------
function Casa() {
  const vs = useStore(s => s.project.volumes), sel = useStore(s => s.sel), fields = useStore(s => s.project.fields);
  const { setVol, addVol, removeVol, dupVol, set } = useStore.getState();
  const v = sel?.kind === 'vol' ? vs.find(x => x.id === sel.id) : undefined;
  const mounted = v ? fields.filter(f => f.vol === v.id).length : 0;
  return (
    <>
      <p className="note">Dibuja cada volumen en el <b>plano del centro</b> con “✏ Dibujar volumen”: clic en las dos esquinas del frente y luego hacia el fondo. También puedes agregar uno con medidas típicas:</p>
      <div className="voladd">{VOL_ADD.map(([t, n, d, ic]) => (
        <button key={t} onClick={() => addVol(t)} title={d}>{ic}<span><b>+ {n}</b>{d}</span></button>))}</div>
      {vs.length > 1 && <div className="list">{vs.map(x => (
        <button key={x.id} className={'item' + (v?.id === x.id ? ' on' : '')} onClick={() => set({ sel: { kind: 'vol', id: x.id } })}>
          <b>{x.nombre}</b><span>{x.ancho} × {x.fondo} m · {x.pisos} piso{x.pisos > 1 ? 's' : ''} · techo {ROOF.find(r => r[0] === x.techo)?.[1].toLowerCase()}</span></button>))}</div>}
      {!v && vs.length > 0 && <p className="note">Elige un volumen en el plano (o en el 3D) para editarlo.</p>}
      {v && <div className="card">
        <label>Nombre<input value={v.nombre} onChange={e => setVol(v.id, { nombre: e.target.value })} /></label>
        <Row cols={3}>
          <Num label="Ancho" unit="m" value={v.ancho} min={1} onChange={ancho => setVol(v.id, { ancho })} />
          <Num label="Fondo" unit="m" value={v.fondo} min={1} onChange={fondo => setVol(v.id, { fondo })} />
          <Num label="Pisos" value={v.pisos} step={1} min={1} max={30} onChange={pisos => setVol(v.id, { pisos: Math.round(pisos) })} />
        </Row>
        <label className="lblsm">Techo</label>
        <Seg value={v.techo} options={ROOF} onChange={techo => setVol(v.id, { techo })} />
        {v.techo !== 'plano' && <label>Pendiente: <b className="am">{v.pendiente}°</b>
          <input type="range" min={5} max={60} step={1} value={v.pendiente} onChange={e => setVol(v.id, { pendiente: +e.target.value })} /></label>}
        <label className="lblsm">Posición y orientación</label>
        <Mover target={{ kind: 'vol', id: v.id }} x={v.x} y={v.y} rot={v.rot} rotLabel="El frente mira al" />
        <div className="quick"><span>Frente al:</span>{([['N', 0], ['E', 90], ['S', 180], ['O', 270]] as [string, number][]).map(([n, a]) => (
          <button key={n} className={v.rot === a ? 'on' : ''} onClick={() => { useStore.getState().set({ sel: { kind: 'vol', id: v.id } }); useStore.getState().rotateSel(a - v.rot); }}>{n}</button>))}</div>
        <p className="note">Altura de aleros {eaveHeight(v).toFixed(1)} m.{mounted ? ` Tiene ${mounted} campo(s) de paneles encima: se mueven con él.` : ''}</p>
        <More>
          <Row cols={3}>
            <Num label="Alto por piso" unit="m" value={v.altoPiso} min={2} onChange={altoPiso => setVol(v.id, { altoPiso })} />
            {v.techo !== 'plano' && <Num label="Alero" unit="m" value={v.alero} min={0} max={2} onChange={alero => setVol(v.id, { alero })} />}
            {v.techo === 'plano' && <Num label="Parapeto" unit="m" value={v.parapeto} min={0} onChange={parapeto => setVol(v.id, { parapeto })} />}
          </Row>
          <Row>
            <Num label="Centro X (Este)" unit="m" value={v.x} onChange={x => setVol(v.id, { x })} />
            <Num label="Centro Y (Norte)" unit="m" value={v.y} onChange={y => setVol(v.id, { y })} />
          </Row>
        </More>
        <div className="addrow">
          <button className="btn ter" onClick={() => dupVol(v.id)}>Duplicar</button>
          <button className="btn sec sm" onClick={() => removeVol(v.id)}>Eliminar</button>
        </div>
      </div>}
      <p className="note tip"><span className="tipl">Consejo</span>Una casa de dos pisos con una parte de un piso se arma con dos volúmenes pegados (Casa + Ampliación). Un quincho o una bodega es otro volumen separado. Si los paneles van solo en el suelo, puedes no agregar ninguno.</p>
    </>
  );
}

// ---------- 3. Paneles ----------
function Paneles() {
  const p = useStore(s => s.project), sel = useStore(s => s.sel), { setField, addField, mountField, removeField, setModulo, set } = useStore.getState();
  const { fieldInfo, lay } = useSim();
  const [roofVol, setRoofVol] = useState('');
  const f = sel?.kind === 'field' ? p.fields.find(x => x.id === sel.id) : undefined;
  const info = f ? fieldInfo.find(i => i.id === f.id) : undefined;
  const kwp = (lay.modules.length * p.modulo.pmax) / 1000;
  return (
    <>
      <div className="total"><b>{lay.modules.length}</b> módulos · <b>{kwp.toFixed(2)}</b> kWp</div>
      <div className="list">
        {p.fields.map((x, i) => {
          const fi = fieldInfo[i], n = lay.modules.filter(m => m.field === i).length;
          return <button key={x.id} className={'item' + (f?.id === x.id ? ' on' : '')} onClick={() => set({ sel: { kind: 'field', id: x.id } })}>
            <b>{x.nombre}</b><span>{n} mód. · {fi?.superficie} · {fi?.tilt.toFixed(0)}° hacia el {rumbo(fi?.azim ?? 0)}{fi?.avisos.length ? ' · ⚠' : ''}</span></button>;
        })}
      </div>
      <div className="addrow">
        {p.volumes.length > 1 && <select className="volsel" value={roofVol} onChange={e => setRoofVol(e.target.value)} title="Techo donde se agrega el campo">
          <option value="">Techo más grande</option>{p.volumes.map(v => <option key={v.id} value={v.id}>{v.nombre}</option>)}</select>}
        <button className="btn ter" onClick={() => addField('techo', roofVol || undefined)} disabled={!p.volumes.length}>+ Campo en el techo</button>
        <button className="btn ter" onClick={() => addField('suelo')}>+ Campo en el suelo / carport</button>
      </div>
      {f && info && <div className="card">
        <label>Nombre<input value={f.nombre} onChange={e => setField(f.id, { nombre: e.target.value })} /></label>
        <label>Va montado sobre
          <select value={f.vol ?? ''} onChange={e => mountField(f.id, e.target.value || null)}>
            {p.volumes.map(v => <option key={v.id} value={v.id}>Techo de: {v.nombre}</option>)}
            <option value="">Suelo / carport</option>
          </select></label>
        <Row>
          <Num label="Filas" value={f.filas} step={1} min={1} max={50} onChange={v => setField(f.id, { filas: Math.round(v) })} />
          <Num label="Módulos por fila" value={f.mods} step={1} min={1} max={100} onChange={v => setField(f.id, { mods: Math.round(v) })} />
        </Row>
        <label className="lblsm">Módulo</label>
        <Seg value={f.orient} options={[['V', 'Vertical'], ['H', 'Horizontal']]} onChange={orient => setField(f.id, { orient })} />
        <label className="lblsm">Montaje</label>
        <Seg value={f.montaje} options={[['coplanar', 'Pegado al techo'], ['inclinada', 'Con estructura']]} onChange={montaje => setField(f.id, { montaje })} />
        {f.montaje === 'inclinada' && <label>Inclinación: <b className="am">{f.tilt}°</b>
          <input type="range" min={TILT_RANGES[f.rango][0]} max={TILT_RANGES[f.rango][1]} step={1} value={f.tilt} onChange={e => setField(f.id, { tilt: +e.target.value })} /></label>}
        <label className="lblsm">Posición{(f.montaje === 'inclinada' || info.tilt === 0) ? ' y orientación' : ''}</label>
        <Mover target={{ kind: 'field', id: f.id }} x={f.x} y={f.y} rot={f.montaje === 'inclinada' || info.tilt === 0 ? f.azim : undefined} rotLabel="Miran al" />
        <p className="note">Resultado: inclinación {info.tilt.toFixed(1)}° hacia el {rumbo(info.azim)} ({info.azim.toFixed(0)}°){f.montaje === 'coplanar' && info.tilt > 0 ? ', igual que el faldón' : ''}.</p>
        {info.avisos.map(a => <div key={a} className="warn">⚠ {a}</div>)}
        <More>
          <Row cols={3}>
            <Num label="Centro X" unit="m" value={f.x} onChange={x => setField(f.id, { x })} />
            <Num label="Centro Y" unit="m" value={f.y} onChange={y => setField(f.id, { y })} />
            <Num label="Altura" unit="m" value={f.altura} min={0} onChange={altura => setField(f.id, { altura })} />
          </Row>
          <Row cols={3}>
            <Num label="En alto" value={f.enAlto} step={1} min={1} max={4} onChange={v => setField(f.id, { enAlto: Math.round(v) })} />
            {f.montaje === 'inclinada' && <Num label="Distancia filas" unit="m" value={f.pitch} min={0.5} onChange={pitch => setField(f.id, { pitch })} />}
            {f.montaje === 'inclinada' && <Num label="Azimut" unit="°" value={f.azim} step={1} onChange={azim => setField(f.id, { azim })} />}
          </Row>
          {f.montaje === 'inclinada' && <><label className="lblsm">Rango de la estructura</label>
            <Seg value={f.rango} options={(Object.keys(TILT_RANGES) as TiltRange[]).map(r => [r, `${r}°`])}
              onChange={rango => { const [a, b] = TILT_RANGES[rango]; setField(f.id, { rango, tilt: Math.min(b, Math.max(a, f.tilt)) }); }} /></>}
          <p className="note">X = metros hacia el Este, Y = metros hacia el Norte (0, 0 = centro de la casa por defecto).</p>
        </More>
        <div className="addrow">
          {f.vol && <button className="btn ter" onClick={() => mountField(f.id, f.vol!)} title="Vuelve a ubicar y dimensionar el campo para que llene el faldón que mira al norte">Ajustar al techo</button>}
          <button className="btn sec sm" onClick={() => removeField(f.id)}>Eliminar campo</button>
        </div>
      </div>}
      {!f && p.fields.length > 0 && <p className="note">Elige un campo de la lista (o haz clic en él en el 3D) para editarlo.</p>}
      <p className="note tip"><span className="tipl">Consejo</span><b>Arrastra</b> un campo en el 3D para moverlo; si lo sueltas sobre otro techo queda montado en ese techo. Los módulos que caen sobre una chimenea u otro objeto se quitan solos.</p>
      <More label="Medidas del módulo">
        <Row cols={3}>
          <Num label="Largo" unit="m" value={p.modulo.largo} step={0.001} min={0.5} onChange={largo => setModulo({ largo })} />
          <Num label="Ancho" unit="m" value={p.modulo.ancho} step={0.001} min={0.3} onChange={ancho => setModulo({ ancho })} />
          <Num label="Separación" unit="m" value={p.modulo.gap} step={0.01} min={0} onChange={gap => setModulo({ gap })} />
        </Row>
        <Row><Num label="Potencia" unit="W" value={p.modulo.pmax} step={5} min={50} onChange={pmax => setModulo({ pmax })} /></Row>
      </More>
    </>
  );
}

// ---------- 4. Sombras del entorno ----------
function Objetos() {
  const p = useStore(s => s.project), sel = useStore(s => s.sel), { setObs, addObs, removeObs, set } = useStore.getState();
  const o = sel?.kind === 'obs' ? p.obstacles.find(x => x.id === sel.id) : undefined;
  const dist = o ? distanceToHouse(p, o) : null;
  return (
    <>
      <div className="obsgrid">
        {(Object.keys(OBS_LBL) as ObsType[]).map(t => <button key={t} onClick={() => addObs(t)}>{OBS_ICON[t]}+ {OBS_LBL[t]}</button>)}
      </div>
      {p.obstacles.length === 0 && <p className="note">No hay objetos. Si nada da sombra, puedes pasar al siguiente paso.</p>}
      <div className="list">
        {p.obstacles.map(x => {
          const d = distanceToHouse(p, x);
          return <button key={x.id} className={'item' + (o?.id === x.id ? ' on' : '')} onClick={() => set({ sel: { kind: 'obs', id: x.id } })}>
            <b>{OBS_ICON[x.tipo]} {OBS_LBL[x.tipo]}</b><span>{x.alto} m de alto{d ? (d.inside ? ' · sobre la casa' : ` · a ${d.d.toFixed(1)} m de la casa`) : ''}</span></button>;
        })}
      </div>
      {o && <div className="card">
        <div className="eff"><span>Distancia a la casa</span><b>{dist ? (dist.inside ? 'sobre la casa' : `${dist.d.toFixed(2)} m`) : '—'}</b></div>
        <Row>
          <Num label={o.tipo === 'chimenea' ? 'Alto sobre techo' : 'Alto'} unit="m" value={o.alto} min={0.1} onChange={alto => setObs(o.id, { alto })} />
          {o.tipo === 'arbol' && <Num label="Diámetro copa" unit="m" value={o.copa} min={0.5} onChange={copa => setObs(o.id, { copa })} />}
          {o.tipo === 'poste' && <Num label="Diámetro" unit="m" value={o.ancho} min={0.05} onChange={ancho => setObs(o.id, { ancho })} />}
        </Row>
        <label className="lblsm">Posición{['edificio', 'muro', 'chimenea'].includes(o.tipo) ? ' y giro' : ''}</label>
        <Mover target={{ kind: 'obs', id: o.id }} x={o.x} y={o.y} rot={['edificio', 'muro', 'chimenea'].includes(o.tipo) ? o.rot : undefined} />
        <More label="Posición exacta (metros)">
          <Row>
            <Num label="X (Este)" unit="m" value={o.x} onChange={x => setObs(o.id, { x })} />
            <Num label="Y (Norte)" unit="m" value={o.y} onChange={y => setObs(o.id, { y })} />
          </Row>
        </More>
        {['edificio', 'muro', 'chimenea'].includes(o.tipo) && <More label="Medidas">
          <Row cols={3}>
            <Num label={o.tipo === 'muro' ? 'Largo' : 'Ancho'} unit="m" value={o.ancho} min={0.1} onChange={ancho => setObs(o.id, { ancho })} />
            <Num label={o.tipo === 'muro' ? 'Espesor' : 'Fondo'} unit="m" value={o.largo} min={0.05} onChange={largo => setObs(o.id, { largo })} />
          </Row>
        </More>}
        <p className="note"><b>Arrastra</b> el objeto en el 3D o usa las flechas. La línea punteada marca la distancia libre a la casa.</p>
        <button className="btn sec sm" onClick={() => removeObs(o.id)}>Eliminar objeto</button>
      </div>}
      <p className="note tip"><span className="tipl">Consejo</span>Abajo, en el <b>diagrama solar</b>, la zona gris es lo que tapa el sol: si la curva de un mes pasa por ahí, hay sombra en ese mes y hora.</p>
    </>
  );
}

// ---------- 5. Simular ----------
function ClimaBox() {
  const clima = useStore(s => s.project.clima), site = useStore(s => s.project.site), { setClimaData, setSite } = useStore.getState();
  const file = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState('');
  const sum = clima ? weatherSummary(clima) : null;
  return (
    <>
      <p className="note">Carga el archivo horario del <a href="https://solarexplorer.minenergia.cl/" target="_blank" rel="noreferrer">Explorador Solar</a> (Descargas → “Datos Horarios TMY SAM” o “PVsyst”), o un EPW / CSV de PVGIS, Meteonorm o SAM.</p>
      <div className="addrow">
        <button className="btn ter" onClick={() => file.current?.click()}>{clima ? 'Cambiar archivo' : 'Cargar archivo de clima'}</button>
        {clima && <button className="btn ter" onClick={() => setClimaData(null)}>Quitar</button>}
      </div>
      <input ref={file} type="file" accept=".csv,.epw,.txt,.json,.tm2" hidden onChange={async e => {
        const f = e.target.files?.[0]; if (!f) return; setErr('');
        try {
          const w = parseWeather(await f.text(), f.name, site);
          setClimaData(w);
          if (w.lat != null && w.lon != null && (Math.abs(w.lat - site.lat) > 0.05 || Math.abs(w.lon - site.lon) > 0.05)) setSite({ lat: +w.lat.toFixed(4), lon: +w.lon.toFixed(4), nombre: '' });
        } catch (x) { setErr((x as Error).message); }
        e.target.value = '';
      }} />
      {err && <div className="warn">⚠ {err}</div>}
      {clima && sum && <div className="card thin">
        <div className="eff"><span>{clima.fuente}</span><b>{clima.nombre}</b></div>
        <p className="note">{sum.n} horas · GHI {sum.ghi.toFixed(0)} kWh/m²·año · T media {sum.tmed.toFixed(1)} °C · UTC{clima.tz >= 0 ? '+' : ''}{clima.tz}</p>
      </div>}
    </>
  );
}

function Simular() {
  const sim = useSim();
  const mode = useStore(s => s.mode), clima = useStore(s => s.clima), sub = useStore(s => s.sub), fecha = useStore(s => s.fecha);
  const busy = useStore(s => s.busy), error = useStore(s => s.error), day = useStore(s => s.day), yearRes = useStore(s => s.yearRes), stale = useStore(s => s.stale);
  const set = useStore(s => s.set);
  const [periodo, setPeriodo] = useState<'dia' | 'anio'>(mode === 'dia' ? 'dia' : 'anio');
  const R = periodo === 'dia' ? day : yearRes, ok = !!R && R.mods.length === sim.lay.modules.length;
  const W = ok ? R!.mods.reduce((s, r) => s + r.Gtot, 0) || 1 : 1;
  const perd = ok ? R!.mods.reduce((s, r) => s + r.perdElec * r.Gtot, 0) / W : 0;
  const sombra = ok ? R!.mods.reduce((s, r) => s + r.sombraDirecta * r.Gtot, 0) / W : 0;
  if (!sim.lay.modules.length) return <div className="warn">⚠ Primero agrega paneles en el paso 3.</div>;
  return (
    <>
      <H3>¿Qué quieres simular?</H3>
      <div className="choice">
        <button className={periodo === 'anio' ? 'on' : ''} onClick={() => setPeriodo('anio')}><b>Año completo</b><span>Pérdida total por sombra en el año (recomendado)</span></button>
        <button className={periodo === 'dia' ? 'on' : ''} onClick={() => setPeriodo('dia')}><b>Un día</b><span>Ver hora a hora un día específico</span></button>
      </div>
      {periodo === 'dia' && <label>Día<input type="date" value={fecha} onChange={e => e.target.value && set({ fecha: e.target.value, day: null })} /></label>}
      {periodo === 'anio' && <>
        <H3>Datos de clima</H3>
        <Seg value={clima} options={[['despejado', 'Cielo despejado'], ['archivo', 'Archivo'], ['pvgis', 'PVGIS']] as [Clima, string][]} onChange={c => set({ clima: c })} />
        <p className="note">{clima === 'despejado' ? 'Supone sol todos los días: sirve para comparar sombras, no para estimar energía real.' : clima === 'pvgis' ? 'Año típico de PVGIS para estas coordenadas (requiere conexión a internet).' : 'Usa un año típico medido para tu ubicación.'}</p>
        {clima === 'archivo' && <ClimaBox />}
      </>}
      <button className="btn pri big" disabled={busy != null} onClick={() => (periodo === 'anio' ? analyzeYear(sim) : analyzeDay(sim))}>
        {busy != null ? `Calculando… ${Math.round(busy * 100)}%` : `▶ Simular ${periodo === 'anio' ? 'el año' : 'el día'}`}</button>
      {busy != null && <div className="prog"><div style={{ width: `${Math.round(busy * 100)}%` }} /></div>}
      {error && <div className="warn">⚠ {error}</div>}
      {ok && <div className="card result">
        <div className="eff"><span>Pérdida de energía por sombra {periodo === 'anio' ? 'en el año' : 'en el día'}</span><b className="xl">{pct(perd)}</b></div>
        <p className="note">Sombra directa sobre los paneles: {pct(sombra)}. El detalle por módulo está abajo y el color de cada panel en el 3D.</p>
        {stale && <div className="warn">⚠ Cambiaste algo después de simular: vuelve a simular.</div>}
      </div>}
      <More label="Precisión del cálculo">
        <label>Puntos por celda<select value={sub} onChange={e => set({ sub: +e.target.value, day: null, yearRes: null })}>
          <option value={1}>1 (rápido)</option><option value={2}>4 (recomendado)</option><option value={3}>9 (fino)</option></select></label>
      </More>
    </>
  );
}

// ---------- 6. Eléctrico ----------
function Electrico() {
  const p = useStore(s => s.project), tool = useStore(s => s.tool), active = useStore(s => s.activeString);
  const { setModulo, setElec, set } = useStore.getState(), { rs, lay } = useSim();
  const m = p.modulo, e = p.elec;
  const toManual = () => {
    // parte desde la asignación automática actual
    const strings = rs.strings.map(s => ({ id: uid(), nombre: s.name, mppt: s.mppt, mods: s.mods.map(mi => lay.modules[mi].key) }));
    setElec({ modo: 'manual', strings }); set({ activeString: strings[0]?.id ?? null, tool: 'string' });
  };
  const TOOLS: [ElecTool, string][] = [['string', 'Asignar string'], ['optimizador', 'Optimizador'], ['excluir', 'Excluir']];
  return (
    <>
      <div className="total"><b>{rs.strings.length}</b> string(s) · <b>{rs.optimized.length}</b> optimizador(es) · <b>{rs.excluded.length}</b> excluido(s)</div>
      {rs.avisos.map(a => <div key={a} className="warn">⚠ {a}</div>)}
      <H3>Strings</H3>
      <Seg value={e.modo} options={[['auto', 'Automático'], ['manual', 'Manual']]} onChange={v => (v === 'manual' ? toManual() : setElec({ modo: 'auto' }))} />
      {e.modo === 'auto' && <Row><Num label="Módulos por string" value={e.modsPorString} step={1} min={1} max={40} onChange={v => setElec({ modsPorString: Math.round(v) })} /></Row>}
      {e.modo === 'auto' && <p className="note">Se cablea por campo, fila por fila, y los strings se reparten entre los MPPT.</p>}
      {e.modo === 'manual' && <>
        <div className="list">{e.strings.map((s, i) => (
          <div key={s.id} className={'item row-item' + (active === s.id ? ' on' : '')} onClick={() => set({ activeString: s.id, tool: 'string' })}>
            <span className="chip" style={{ background: STRING_COLORS[i % STRING_COLORS.length] }} />
            <input className="sname" value={s.nombre} onChange={x => setElec({ strings: e.strings.map(t => (t.id === s.id ? { ...t, nombre: x.target.value } : t)) })} />
            <span>{s.mods.length} mód.</span>
            <select value={s.mppt} onClick={x => x.stopPropagation()} onChange={x => setElec({ strings: e.strings.map(t => (t.id === s.id ? { ...t, mppt: +x.target.value } : t)) })}>
              {Array.from({ length: e.nMppt }, (_, k) => <option key={k} value={k}>MPPT {k + 1}</option>)}</select>
            <button className="x" onClick={x => { x.stopPropagation(); setElec({ strings: e.strings.filter(t => t.id !== s.id) }); }}>✕</button>
          </div>))}
        </div>
        <button className="btn ter" onClick={() => { const id = uid(); setElec({ strings: [...e.strings, { id, nombre: `S${e.strings.length + 1}`, mppt: e.strings.length % e.nMppt, mods: [] }] }); set({ activeString: id, tool: 'string' }); }}>+ String</button>
      </>}
      <H3>Clic en un módulo del 3D para…</H3>
      <Seg value={tool} options={TOOLS} onChange={t => set({ tool: t })} />
      <p className="note">{tool === 'string' ? (e.modo === 'manual' ? 'Agregarlo o quitarlo del string activo (en el orden de conexión).' : 'Cambia a modo Manual para armar los strings a mano.') : tool === 'optimizador' ? 'Ponerle o quitarle un optimizador (marcado en amarillo).' : 'Sacarlo del sistema (queda en gris; sigue dando sombra).'}</p>
      <H3>Inversor</H3>
      <Row cols={3}>
        <Num label="MPPT mín." unit="V" value={e.mpptMin} step={5} min={0} onChange={mpptMin => setElec({ mpptMin })} />
        <Num label="MPPT máx." unit="V" value={e.mpptMax} step={5} min={10} onChange={mpptMax => setElec({ mpptMax })} />
        <Num label="N° MPPT" value={e.nMppt} step={1} min={1} max={12} onChange={v => setElec({ nMppt: Math.round(v) })} />
      </Row>
      <More label="Ficha técnica del módulo y optimizador">
        <Row cols={3}>
          <Num label="Pmax" unit="W" value={m.pmax} step={5} min={50} onChange={pmax => setModulo({ pmax })} />
          <Num label="Voc" unit="V" value={m.voc} min={5} onChange={voc => setModulo({ voc })} />
          <Num label="Isc" unit="A" value={m.isc} min={0.5} onChange={isc => setModulo({ isc })} />
        </Row>
        <Row cols={3}>
          <Num label="Vmp" unit="V" value={m.vmp} min={5} onChange={vmp => setModulo({ vmp })} />
          <Num label="Imp" unit="A" value={m.imp} min={0.5} onChange={imp => setModulo({ imp })} />
          <label>Celdas<select value={m.celdas} onChange={x => setModulo({ celdas: +x.target.value as 60 | 72 })}><option value={60}>60 (120 half-cut)</option><option value={72}>72 (144 half-cut)</option></select></label>
        </Row>
        <Row cols={3}>
          <Num label="Coef. Pmax" unit="%/°C" value={m.gammaP} step={0.01} onChange={gammaP => setModulo({ gammaP })} />
          <Num label="NOCT" unit="°C" value={m.noct} step={1} onChange={noct => setModulo({ noct })} />
          <Num label="Efic. optim." unit="%" value={+(e.optEff * 100).toFixed(1)} step={0.1} min={90} max={100} onChange={v => setElec({ optEff: v / 100 })} />
        </Row>
        <p className="note">Vmp×Imp = {(m.vmp * m.imp).toFixed(0)} W{Math.abs(m.vmp * m.imp - m.pmax) > m.pmax * 0.03 ? ' ⚠ no coincide con Pmax' : ''}. Half-cut se modela como celdas completas equivalentes (resultado conservador).</p>
      </More>
      <p className="note tip"><span className="tipl">Consejo</span>Después de cambiar strings u optimizadores, vuelve a simular (botón abajo) para comparar la energía recuperada.</p>
    </>
  );
}

// ---------- asistente ----------
function useStepDone(): Record<Tab, boolean> {
  const p = useStore(s => s.project), day = useStore(s => s.day), yearRes = useStore(s => s.yearRes), stale = useStore(s => s.stale);
  const { lay, rs } = useSim();
  return {
    sitio: true,
    casa: p.volumes.length > 0,
    paneles: lay.modules.length > 0,
    objetos: p.obstacles.length > 0,
    simular: !!(day || yearRes) && !stale,
    electrico: rs.strings.length > 0 && rs.avisos.length === 0,
  };
}

export default function Sidebar() {
  const tab = useStore(s => s.tab), done = useStepDone();
  const i = STEPS.indexOf(tab), info = STEP_INFO[tab], prev = STEPS[i - 1], next = STEPS[i + 1];
  return (
    <aside>
      <nav className="stepper">
        {STEPS.map((k, j) => (
          <button key={k} className={(k === tab ? 'on' : '') + (done[k] && k !== tab ? ' done' : '')} onClick={() => goStep(k)} title={STEP_INFO[k].t}>
            <span className="dot">{done[k] && k !== tab ? '✓' : j + 1}</span><span className="nm">{STEP_INFO[k].short}</span>
          </button>
        ))}
      </nav>
      <div className="stephead">
        <div className="lbl">Paso {i + 1} de {STEPS.length}</div>
        <h2>{info.t}</h2>
        <p>{info.d}</p>
      </div>
      <div className="pane">
        {tab === 'sitio' && <Sitio />}{tab === 'casa' && <Casa />}{tab === 'paneles' && <Paneles />}
        {tab === 'objetos' && <Objetos />}{tab === 'simular' && <Simular />}{tab === 'electrico' && <Electrico />}
      </div>
      <div className="stepnav">
        {prev ? <button className="btn sec sm" onClick={() => goStep(prev)}>← Atrás</button> : <span />}
        {next && <button className="btn pri sm" onClick={() => goStep(next)}>Siguiente: {STEP_INFO[next].short} →</button>}
      </div>
    </aside>
  );
}
