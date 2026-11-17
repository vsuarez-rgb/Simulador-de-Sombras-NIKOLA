import { useRef, useState } from 'react';
import { distanceToHouse, eaveHeight, TILT_RANGES, uid, type ElecTool, type ObsType, type RoofType, type TiltRange } from '../engine/project';
import { parseWeather, weatherSummary } from '../engine/weather';
import { STRING_COLORS } from '../sim/viz';
import { useStore, type Tab } from '../store';
import { useSim } from '../sim/useSim';
import { H3, Num, Row, Seg } from './ui';

const CIUDADES: [string, number, number][] = [
  ['Arica', -18.48, -70.31], ['Iquique', -20.21, -70.15], ['Antofagasta', -23.65, -70.4], ['Calama', -22.46, -68.93],
  ['Copiapó', -27.37, -70.33], ['La Serena', -29.9, -71.25], ['Valparaíso', -33.05, -71.61], ['Santiago', -33.45, -70.66],
  ['Rancagua', -34.17, -70.74], ['Talca', -35.43, -71.66], ['Concepción', -36.83, -73.05], ['Temuco', -38.74, -72.6],
  ['Puerto Montt', -41.47, -72.94], ['Punta Arenas', -53.16, -70.92],
];
const OBS_LBL: Record<ObsType, string> = { arbol: 'Árbol', poste: 'Poste', edificio: 'Edificio vecino', muro: 'Muro', chimenea: 'Chimenea / ducto' };
const ROOF: [RoofType, string][] = [['plano', 'Plano'], ['una_agua', '1 agua'], ['dos_aguas', '2 aguas'], ['cuatro_aguas', '4 aguas']];

function Sitio() {
  const p = useStore(s => s.project), { setSite, setModulo, set } = useStore.getState(), sub = useStore(s => s.sub);
  return (
    <>
      <H3>Ubicación</H3>
      <label className="mb">Ciudad
        <select value={p.site.nombre} onChange={e => { const c = CIUDADES.find(c => c[0] === e.target.value); if (c) setSite({ nombre: c[0], lat: c[1], lon: c[2] }); }}>
          <option value="">— personalizada —</option>
          {CIUDADES.map(c => <option key={c[0]}>{c[0]}</option>)}
        </select>
      </label>
      <Row cols={3}>
        <Num label="Latitud" value={p.site.lat} step={0.01} onChange={lat => setSite({ lat, nombre: '' })} />
        <Num label="Longitud" value={p.site.lon} step={0.01} onChange={lon => setSite({ lon, nombre: '' })} />
        <label>UTC<select value={p.site.tz} onChange={e => setSite({ tz: +e.target.value })}>{[-3, -4, -5, -6].map(t => <option key={t} value={t}>{t}</option>)}</select></label>
      </Row>
      <Row><Num label="Albedo suelo" value={p.site.albedo} step={0.05} min={0} max={1} onChange={albedo => setSite({ albedo })} /></Row>
      <ClimaBox />
      <H3>Módulo FV</H3>
      <Row cols={3}>
        <Num label="Largo" unit="m" value={p.modulo.largo} step={0.001} min={0.5} onChange={largo => setModulo({ largo })} />
        <Num label="Ancho" unit="m" value={p.modulo.ancho} step={0.001} min={0.3} onChange={ancho => setModulo({ ancho })} />
        <Num label="Separación" unit="m" value={p.modulo.gap} step={0.01} min={0} onChange={gap => setModulo({ gap })} />
      </Row>
      <p className="note">Datos eléctricos del módulo en la pestaña Eléctrico.</p>
      <H3>Precisión del cálculo</H3>
      <label>Puntos por celda<select value={sub} onChange={e => set({ sub: +e.target.value, day: null, yearRes: null })}>
        <option value={1}>1 (rápido)</option><option value={2}>4 (recomendado)</option><option value={3}>9 (fino)</option></select></label>
    </>
  );
}

function ClimaBox() {
  const clima = useStore(s => s.project.clima), site = useStore(s => s.project.site), { setClimaData, setSite } = useStore.getState();
  const file = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState('');
  const sum = clima ? weatherSummary(clima) : null;
  return (
    <>
      <H3>Clima (año típico)</H3>
      <p className="note">Carga el archivo horario del <a href="https://solarexplorer.minenergia.cl/" target="_blank" rel="noreferrer">Explorador Solar</a> (Descargas → “Datos Horarios TMY SAM” o “Datos Horarios PVsyst”), o un EPW / CSV de PVGIS, Meteonorm, SAM.</p>
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
        <p className="note">{sum.n} horas · GHI {sum.ghi.toFixed(0)} kWh/m²·año · DNI {sum.dni.toFixed(0)} · DHI {sum.dhi.toFixed(0)} · T media {sum.tmed.toFixed(1)} °C<br />
          Zona horaria del archivo UTC{clima.tz >= 0 ? '+' : ''}{clima.tz} · ajuste horario detectado {clima.offset >= 0 ? '+' : ''}{clima.offset} h{clima.lat != null ? ` · ${clima.lat.toFixed(3)}, ${clima.lon?.toFixed(3)}` : ''}</p>
      </div>}
    </>
  );
}

function Electrico() {
  const p = useStore(s => s.project), tool = useStore(s => s.tool), active = useStore(s => s.activeString);
  const { setModulo, setElec, set } = useStore.getState(), { rs, lay } = useSim();
  const m = p.modulo, e = p.elec;
  const toManual = () => {
    // parte desde la asignación automática actual
    const strings = rs.strings.map(s => ({ id: uid(), nombre: s.name, mppt: s.mppt, mods: s.mods.map(mi => lay.modules[mi].key) }));
    setElec({ modo: 'manual', strings }); set({ activeString: strings[0]?.id ?? null, tool: 'string' });
  };
  const TOOLS: [ElecTool, string][] = [['string', 'Asignar string'], ['optimizador', 'Optimizador'], ['excluir', 'Excluir módulo']];
  return (
    <>
      <H3>Módulo (ficha técnica, STC)</H3>
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
      </Row>
      <p className="note">Vmp×Imp = {(m.vmp * m.imp).toFixed(0)} W{Math.abs(m.vmp * m.imp - m.pmax) > m.pmax * 0.03 ? ' ⚠ no coincide con Pmax' : ''}. Half-cut se modela como celdas completas equivalentes (resultado conservador ante sombra en la fila inferior).</p>
      <H3>Inversor</H3>
      <Row cols={3}>
        <Num label="MPPT mín." unit="V" value={e.mpptMin} step={5} min={0} onChange={mpptMin => setElec({ mpptMin })} />
        <Num label="MPPT máx." unit="V" value={e.mpptMax} step={5} min={10} onChange={mpptMax => setElec({ mpptMax })} />
        <Num label="N° MPPT" value={e.nMppt} step={1} min={1} max={12} onChange={v => setElec({ nMppt: Math.round(v) })} />
      </Row>
      <Row cols={3}><Num label="Efic. optimizador" unit="%" value={+(e.optEff * 100).toFixed(1)} step={0.1} min={90} max={100} onChange={v => setElec({ optEff: v / 100 })} /></Row>
      <H3>Strings</H3>
      <Seg value={e.modo} options={[['auto', 'Automático'], ['manual', 'Manual']]} onChange={v => (v === 'manual' ? toManual() : setElec({ modo: 'auto' }))} />
      {e.modo === 'auto' && <Row cols={3}><Num label="Módulos por string" value={e.modsPorString} step={1} min={1} max={40} onChange={v => setElec({ modsPorString: Math.round(v) })} /></Row>}
      {e.modo === 'auto' && <p className="note">Se cablea por campo, fila por fila en serpentina, y los strings se reparten entre los MPPT.</p>}
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
      <H3>Herramienta en 3D</H3>
      <Seg value={tool} options={TOOLS} onChange={t => set({ tool: t })} />
      <p className="note">{tool === 'string' ? (e.modo === 'manual' ? 'Haz clic en los módulos para agregarlos o quitarlos del string activo (en el orden de conexión).' : 'Cambia a modo Manual para armar los strings a mano.') : tool === 'optimizador' ? 'Haz clic en un módulo para ponerle o quitarle un optimizador (marcado en amarillo).' : 'Haz clic en un módulo para sacarlo del sistema (queda en gris; sigue dando sombra).'}</p>
      <p className="note">{rs.optimized.length} optimizador(es) · {rs.excluded.length} módulo(s) excluido(s) · {rs.strings.length} string(s)</p>
      {rs.avisos.map(a => <div key={a} className="warn">⚠ {a}</div>)}
    </>
  );
}

function Casa() {
  const h = useStore(s => s.project.house), { setHouse } = useStore.getState();
  return (
    <>
      <H3>Casa / edificio</H3>
      <label className="check"><input type="checkbox" checked={h.enabled} onChange={e => setHouse({ enabled: e.target.checked })} /> Incluir casa en el proyecto</label>
      {h.enabled && <>
        <Row cols={3}>
          <Num label="Centro X" unit="m" value={h.x} onChange={x => setHouse({ x })} />
          <Num label="Centro Y" unit="m" value={h.y} onChange={y => setHouse({ y })} />
          <Num label="Azimut frente" unit="°" value={h.rot} step={1} onChange={rot => setHouse({ rot })} />
        </Row>
        <Row cols={3}>
          <Num label="Ancho" unit="m" value={h.ancho} min={2} onChange={ancho => setHouse({ ancho })} />
          <Num label="Fondo" unit="m" value={h.fondo} min={2} onChange={fondo => setHouse({ fondo })} />
          <Num label="Pisos" value={h.pisos} step={1} min={1} max={30} onChange={pisos => setHouse({ pisos: Math.round(pisos) })} />
        </Row>
        <Row cols={3}>
          <Num label="Alto por piso" unit="m" value={h.altoPiso} min={2} onChange={altoPiso => setHouse({ altoPiso })} />
        </Row>
        <H3>Techo</H3>
        <Seg value={h.techo} options={ROOF} onChange={techo => setHouse({ techo })} />
        <Row cols={3}>
          {h.techo !== 'plano' && <Num label="Pendiente" unit="°" value={h.pendiente} step={1} min={1} max={60} onChange={pendiente => setHouse({ pendiente })} />}
          {h.techo !== 'plano' && <Num label="Alero" unit="m" value={h.alero} min={0} max={2} onChange={alero => setHouse({ alero })} />}
          {h.techo === 'plano' && <Num label="Parapeto" unit="m" value={h.parapeto} min={0} onChange={parapeto => setHouse({ parapeto })} />}
        </Row>
        <p className="note">Altura de aleros {eaveHeight(h).toFixed(1)} m. El azimut del frente define hacia dónde cae el faldón frontal (0° = Norte). Arrastra la casa con las flechas al seleccionarla.</p>
      </>}
    </>
  );
}

function Paneles() {
  const p = useStore(s => s.project), sel = useStore(s => s.sel), { setField, addField, removeField, set } = useStore.getState();
  const { fieldInfo, lay } = useSim();
  const f = sel?.kind === 'field' ? p.fields.find(x => x.id === sel.id) : undefined;
  const info = f ? fieldInfo.find(i => i.id === f.id) : undefined;
  return (
    <>
      <H3>Campos de paneles</H3>
      <div className="list">
        {p.fields.map((x, i) => {
          const fi = fieldInfo[i], n = lay.modules.filter(m => m.field === i).length;
          return <button key={x.id} className={'item' + (f?.id === x.id ? ' on' : '')} onClick={() => set({ sel: { kind: 'field', id: x.id } })}>
            <b>{i + 1}. {x.nombre}</b><span>{n} mód. · {fi?.superficie} · {fi?.tilt.toFixed(0)}°{fi?.avisos.length ? ' · ⚠' : ''}</span></button>;
        })}
      </div>
      <div className="addrow">
        <button className="btn ter" onClick={() => addField('techo')} disabled={!p.house.enabled}>+ Campo en techo</button>
        <button className="btn ter" onClick={() => addField('suelo')}>+ Campo en suelo / carport</button>
      </div>
      {f && info && <div className="card">
        <Row><label>Nombre<input value={f.nombre} onChange={e => setField(f.id, { nombre: e.target.value })} /></label>
          <div className="eff"><span>Superficie</span><b>{info.superficie}</b></div></Row>
        <Row cols={3}>
          <Num label="Centro X" unit="m" value={f.x} onChange={x => setField(f.id, { x })} />
          <Num label="Centro Y" unit="m" value={f.y} onChange={y => setField(f.id, { y })} />
          <Num label="Altura" unit="m" value={f.altura} min={0} onChange={altura => setField(f.id, { altura })} />
        </Row>
        <label className="lblsm">Montaje</label>
        <Seg value={f.montaje} options={[['coplanar', 'Coplanar al techo'], ['inclinada', 'Base inclinable']]} onChange={montaje => setField(f.id, { montaje })} />
        {f.montaje === 'inclinada' && <>
          <label className="lblsm">Rango de la base</label>
          <Seg value={f.rango} options={(Object.keys(TILT_RANGES) as TiltRange[]).map(r => [r, `${r}°`])}
            onChange={rango => { const [a, b] = TILT_RANGES[rango]; setField(f.id, { rango, tilt: Math.min(b, Math.max(a, f.tilt)) }); }} />
          <label>Inclinación: <b className="am">{f.tilt}°</b>
            <input type="range" min={TILT_RANGES[f.rango][0]} max={TILT_RANGES[f.rango][1]} step={1} value={f.tilt} onChange={e => setField(f.id, { tilt: +e.target.value })} />
          </label>
        </>}
        <Row cols={3}>
          {(f.montaje === 'inclinada' || info.tilt === 0) && <Num label="Azimut" unit="°" value={f.azim} step={1} onChange={azim => setField(f.id, { azim })} />}
          {f.montaje === 'inclinada' && <Num label="Pitch filas" unit="m" value={f.pitch} min={0.5} onChange={pitch => setField(f.id, { pitch })} />}
        </Row>
        <Row cols={3}>
          <Num label="Filas" value={f.filas} step={1} min={1} max={50} onChange={v => setField(f.id, { filas: Math.round(v) })} />
          <Num label="Mód. por fila" value={f.mods} step={1} min={1} max={100} onChange={v => setField(f.id, { mods: Math.round(v) })} />
          <Num label="En alto" value={f.enAlto} step={1} min={1} max={4} onChange={v => setField(f.id, { enAlto: Math.round(v) })} />
        </Row>
        <label className="lblsm">Orientación del módulo</label>
        <Seg value={f.orient} options={[['V', 'Vertical'], ['H', 'Horizontal']]} onChange={orient => setField(f.id, { orient })} />
        <p className="note">Efectivo: inclinación {info.tilt.toFixed(1)}° · azimut {info.azim.toFixed(0)}°{f.montaje === 'coplanar' && info.tilt > 0 ? ' (del faldón)' : ''}</p>
        {info.avisos.map(a => <div key={a} className="warn">⚠ {a}</div>)}
        <button className="btn sec sm" onClick={() => removeField(f.id)}>Eliminar campo</button>
      </div>}
      {!f && <p className="note">Selecciona un campo en la lista o haz clic en él en 3D para editarlo y moverlo con las flechas.</p>}
    </>
  );
}

function Objetos() {
  const p = useStore(s => s.project), sel = useStore(s => s.sel), { setObs, addObs, removeObs, set } = useStore.getState();
  const o = sel?.kind === 'obs' ? p.obstacles.find(x => x.id === sel.id) : undefined;
  const dist = o ? distanceToHouse(p, o) : null;
  return (
    <>
      <H3>Objetos que dan sombra</H3>
      <div className="addrow">
        {(Object.keys(OBS_LBL) as ObsType[]).map(t => <button key={t} className="btn ter" onClick={() => addObs(t)}>+ {OBS_LBL[t]}</button>)}
      </div>
      <div className="list">
        {p.obstacles.map((x, i) => {
          const d = distanceToHouse(p, x);
          return <button key={x.id} className={'item' + (o?.id === x.id ? ' on' : '')} onClick={() => set({ sel: { kind: 'obs', id: x.id } })}>
            <b>{i + 1}. {OBS_LBL[x.tipo]}</b><span>{x.alto} m alto{d ? (d.inside ? ' · sobre la casa' : ` · ${d.d.toFixed(2)} m de la casa`) : ''}</span></button>;
        })}
      </div>
      {o && <div className="card">
        <div className="eff"><span>Distancia a la casa</span><b>{dist ? (dist.inside ? 'sobre la casa' : `${dist.d.toFixed(2)} m`) : '—'}</b></div>
        <Row cols={3}>
          <Num label="X (Este)" unit="m" value={o.x} onChange={x => setObs(o.id, { x })} />
          <Num label="Y (Norte)" unit="m" value={o.y} onChange={y => setObs(o.id, { y })} />
          <Num label={o.tipo === 'chimenea' ? 'Alto sobre techo' : 'Alto'} unit="m" value={o.alto} min={0.1} onChange={alto => setObs(o.id, { alto })} />
        </Row>
        <Row cols={3}>
          {o.tipo === 'arbol' && <Num label="Diámetro copa" unit="m" value={o.copa} min={0.5} onChange={copa => setObs(o.id, { copa })} />}
          {o.tipo === 'poste' && <Num label="Diámetro" unit="m" value={o.ancho} min={0.05} onChange={ancho => setObs(o.id, { ancho })} />}
          {['edificio', 'muro', 'chimenea'].includes(o.tipo) && <>
            <Num label={o.tipo === 'muro' ? 'Largo' : 'Ancho'} unit="m" value={o.ancho} min={0.1} onChange={ancho => setObs(o.id, { ancho })} />
            <Num label={o.tipo === 'muro' ? 'Espesor' : 'Fondo'} unit="m" value={o.largo} min={0.05} onChange={largo => setObs(o.id, { largo })} />
            <Num label="Rotación" unit="°" value={o.rot} step={1} onChange={rot => setObs(o.id, { rot })} />
          </>}
        </Row>
        <p className="note">Arrastra el objeto con las flechas en 3D. La cota punteada muestra la distancia libre hasta el muro de la casa más cercano.</p>
        <button className="btn sec sm" onClick={() => removeObs(o.id)}>Eliminar objeto</button>
      </div>}
    </>
  );
}

export default function Sidebar() {
  const tab = useStore(s => s.tab), set = useStore(s => s.set);
  const TABS: [Tab, string][] = [['sitio', 'Sitio'], ['casa', 'Casa'], ['paneles', 'Paneles'], ['objetos', 'Objetos'], ['electrico', 'Eléctrico']];
  return (
    <aside>
      <div className="tabsbar">{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => set({ tab: k })}>{l}</button>)}</div>
      <div className="pane">
        {tab === 'sitio' && <Sitio />}{tab === 'casa' && <Casa />}{tab === 'paneles' && <Paneles />}{tab === 'objetos' && <Objetos />}{tab === 'electrico' && <Electrico />}
      </div>
    </aside>
  );
}
