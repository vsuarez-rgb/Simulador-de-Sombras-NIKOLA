import { Html, Line, OrbitControls } from '@react-three/drei';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Box, Module, Prim, Table } from '../engine/engine';
import { distanceToHouse, housePrims, obstaclePrims, surfaceHeight, type House } from '../engine/project';
import { DESIGN_STEPS, useStore, type Sel, type Tab } from '../store';

/** Selecciona un objeto; solo salta a su paso si se está diseñando (en Simular/Eléctrico se queda ahí). */
function pick(sel: Sel, tab: Tab, extra: { selModule?: number } = {}) {
  const st = useStore.getState();
  st.set(DESIGN_STEPS.includes(st.tab) ? { sel, tab, ...extra } : { sel, ...extra });
}
import { parseFecha, useSim } from '../sim/useSim';
import { drawModule, drawModuleElec, pct, PX } from '../sim/viz';
import { sunVector } from '../engine/engine';
import { refDays, sunArc, sunHours } from '../sim/sunpath';

const D2R = Math.PI / 180;
/** Tamaño de la casa en planta incluidas las alas (para cámara y bóveda solar). */
const houseSpan = (h: House) => Math.max(h.ancho, h.fondo) + (h.forma && h.forma !== 'rect' ? (h.alaLargo ?? 0) : 0);

const v3 = (a: number[]) => new THREE.Vector3(a[0], a[1], a[2]);
export type CamKind = '3d' | 'top' | 'sun';
export const camBus: { fn: (k: CamKind) => void } = { fn: () => { } };

// ---------- primitivas ----------
const MAT = {
  muros: new THREE.MeshStandardMaterial({ color: '#e6e1d6', roughness: 0.95 }),
  techo: new THREE.MeshStandardMaterial({ color: '#8f5a46', roughness: 0.8, side: THREE.DoubleSide }),
  techoPlano: new THREE.MeshStandardMaterial({ color: '#b9bec2', roughness: 0.9 }),
  parapeto: new THREE.MeshStandardMaterial({ color: '#cfc9bd', roughness: 0.9 }),
  edificio: new THREE.MeshStandardMaterial({ color: '#b3b8bd', roughness: 0.9 }),
  muro: new THREE.MeshStandardMaterial({ color: '#9ea6ad', roughness: 0.9 }),
  chimenea: new THREE.MeshStandardMaterial({ color: '#7a6a62', roughness: 0.9 }),
  tronco: new THREE.MeshStandardMaterial({ color: '#6b4f35', roughness: 1 }),
  copa: new THREE.MeshStandardMaterial({ color: '#4f7a46', roughness: 1 }),
  metal: new THREE.MeshStandardMaterial({ color: '#9aa4ab', metalness: 0.4, roughness: 0.6 }),
};
const SEL_EMISSIVE = new THREE.Color('#FAB704');

type ClickFn = (e: ThreeEvent<MouseEvent>) => void;

function PrimMesh({ p, selected, onClick }: { p: Prim; selected?: boolean; onClick?: ClickFn }) {
  const mat = useMemo(() => {
    const base = (MAT as Record<string, THREE.MeshStandardMaterial>)[p.kind] ?? MAT.edificio;
    if (!selected) return base;
    const m = base.clone(); m.emissive = SEL_EMISSIVE; m.emissiveIntensity = 0.25; return m;
  }, [p.kind, selected]);
  if (p.type === 'box') return (
    <mesh position={p.c} rotation={[0, -(p as Box).rot * Math.PI / 180, 0]} castShadow receiveShadow material={mat} onClick={onClick}>
      <boxGeometry args={[p.h[0] * 2, p.h[1] * 2, p.h[2] * 2]} />
    </mesh>);
  if (p.type === 'sph') return <mesh position={p.c} castShadow receiveShadow material={mat} onClick={onClick}><sphereGeometry args={[p.r, 24, 16]} /></mesh>;
  if (p.type === 'cyl') return (
    <mesh position={[p.c[0], (p.y0 + p.y1) / 2, p.c[1]]} castShadow material={mat} onClick={onClick}>
      <cylinderGeometry args={[p.r, p.r, p.y1 - p.y0, 14]} />
    </mesh>);
  return null;
}

function TriMesh({ tris, material, onClick }: { tris: Prim[]; material: THREE.Material; onClick?: ClickFn }) {
  const geo = useMemo(() => {
    const pos: number[] = [];
    for (const t of tris) if (t.type === 'tri') {
      const b = [t.a[0] + t.e1[0], t.a[1] + t.e1[1], t.a[2] + t.e1[2]], c = [t.a[0] + t.e2[0], t.a[1] + t.e2[1], t.a[2] + t.e2[2]];
      pos.push(...t.a, ...b, ...c);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g;
  }, [tris]);
  useEffect(() => () => geo.dispose(), [geo]);
  return <mesh geometry={geo} material={material} castShadow receiveShadow onClick={onClick} />;
}

// ---------- casa ----------
function HouseMesh() {
  const house = useStore(s => s.project.house), sel = useStore(s => s.sel);
  const prims = useMemo(() => housePrims(house), [house]);
  const selected = sel?.kind === 'house';
  const click = (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); pick({ kind: 'house' }, 'casa'); };
  const roofMat = useMemo(() => {
    const m = MAT.techo.clone(); if (selected) { m.emissive = SEL_EMISSIVE; m.emissiveIntensity = 0.2; } return m;
  }, [selected]);
  const wallTris = prims.filter(p => p.type === 'tri' && p.kind === 'muros'), roofTris = prims.filter(p => p.type === 'tri' && p.kind === 'techo');
  if (!house.enabled) return null;
  return (
    <group>
      {prims.filter(p => p.type === 'box').map((p, i) => <PrimMesh key={i} p={p} selected={selected} onClick={click} />)}
      {roofTris.length > 0 && <TriMesh tris={roofTris} material={roofMat} onClick={click} />}
      {wallTris.length > 0 && <TriMesh tris={wallTris} material={MAT.muros} onClick={click} />}
      {/* losa del techo plano de cada bloque: se gira igual que la caja de muros (−rot en Y) */}
      {house.techo === 'plano' && prims.filter((p): p is Box => p.type === 'box' && p.kind === 'muros').map((b, i) => (
        <group key={i} position={[b.c[0], b.h[1] * 2 + 0.01, b.c[2]]} rotation={[0, -b.rot * Math.PI / 180, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={MAT.techoPlano} onClick={click}><planeGeometry args={[b.h[0] * 2, b.h[2] * 2]} /></mesh>
        </group>
      ))}
    </group>
  );
}

// ---------- módulos ----------
function ModuleMesh({ m, t, idx }: { m: Module; t: Table; idx: number }) {
  const { instant, rs, lay } = useSim(), nMods = lay.modules.length;
  const colorBy = useStore(s => s.colorBy);
  const elecView = useStore(s => s.tab === 'electrico'), clickElec = useStore(s => s.clickModuleElec);
  const sIdx = rs.stringOf[idx], isOpt = rs.optimized.includes(idx), isEx = rs.excluded.includes(idx);
  const mode = useStore(s => s.mode), day = useStore(s => s.day), yearRes = useStore(s => s.yearRes);
  const selModule = useStore(s => s.selModule), set = useStore(s => s.set), showLabels = useStore(s => s.showLabels), fields = useStore(s => s.project.fields);
  const fieldId = fields[m.field]?.id;
  const { cv, tex, geo, center } = useMemo(() => {
    const cv = document.createElement('canvas'); cv.width = m.nu * PX; cv.height = m.nv * PX;
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const center = v3(t.P).addScaledVector(v3(t.u), m.a0 + m.mw / 2).addScaledVector(v3(t.v), m.b0 + m.ml / 2).addScaledVector(v3(t.n), 0.003);
    const geo = new THREE.PlaneGeometry(m.mw, m.ml);
    // (u, v, n) es una base con u×v = −n: se aplica a la geometría, no como rotación
    geo.applyMatrix4(new THREE.Matrix4().makeBasis(v3(t.u), v3(t.v), v3(t.n)).setPosition(center));
    return { cv, tex, geo, center };
  }, [m, t]);
  useEffect(() => () => { tex.dispose(); geo.dispose(); }, [tex, geo]);
  const R = mode === 'dia' ? day : mode === 'anio' ? yearRes : null;
  // si cambió la cantidad de módulos los resultados ya no se pueden asociar a cada módulo
  const heatMode = mode !== 'instante' && !!R && R.mods.length === nMods;
  const cells = heatMode ? R!.mods[idx]?.cell : instant?.[idx]?.cells ?? null;
  const panel = heatMode && colorBy === 'panel' ? R!.mods[idx]?.perdElec : undefined;
  useEffect(() => {
    if (elecView) drawModuleElec(cv, m, sIdx, isOpt, isEx, idx === selModule);
    else drawModule(cv, m, cells, heatMode, !instant && !heatMode, idx === selModule, panel);
    tex.needsUpdate = true;
  }, [cv, tex, m, cells, heatMode, instant, idx, selModule, elecView, sIdx, isOpt, isEx, panel]);
  const metric = heatMode ? R!.mods[idx]?.perdElec : instant ? instant[idx].geom : undefined;
  // En Día/Año el color es un dato: material sin iluminación ni tone mapping para que sea fiel a la leyenda
  const flat = heatMode && !elecView;
  return (
    <>
      <mesh geometry={geo} castShadow onClick={e => {
        e.stopPropagation();
        if (elecView) { clickElec(m.key); set({ selModule: idx }); return; }
        pick({ kind: 'field', id: fieldId }, 'paneles', { selModule: idx });
      }}>
        {flat
          ? <meshBasicMaterial key="flat" map={tex} toneMapped={false} side={THREE.DoubleSide} />
          : <meshStandardMaterial key="lit" map={tex} roughness={0.35} metalness={0.1} side={THREE.DoubleSide} />}
      </mesh>
      {showLabels && (
        <Html position={center.clone().addScaledVector(v3(t.n), 0.15)} center style={{ pointerEvents: 'none' }} zIndexRange={[10, 0]}>
          <div className={'lab' + (idx === selModule ? ' hi' : '')}>{m.id}{elecView ? (isEx ? ' · excluido' : sIdx >= 0 ? ` · ${rs.strings[sIdx].name}${isOpt ? ' · OPT' : ''}` : ' · sin string') : metric !== undefined ? ` · ${pct(metric)}` : ''}</div>
        </Html>
      )}
    </>
  );
}

function Fields() {
  const { lay } = useSim();
  const sel = useStore(s => s.sel), fields = useStore(s => s.project.fields), project = useStore(s => s.project);
  return (
    <group>
      {lay.tables.map(t => {
        const f = fields[t.field], selected = sel?.kind === 'field' && sel.id === f?.id;
        const basis = new THREE.Matrix4().makeBasis(v3(t.u), v3(t.n), v3(t.v));
        const q = new THREE.Quaternion().setFromRotationMatrix(basis);
        const c = v3(t.P).addScaledVector(v3(t.u), t.W / 2).addScaledVector(v3(t.v), t.L / 2).addScaledVector(v3(t.n), -0.035);
        // patas de la estructura
        const posts: JSX.Element[] = [];
        if (f && f.montaje === 'inclinada') {
          const n = Math.max(2, Math.ceil(t.W / 3) + 1);
          for (let i = 0; i < n; i++) for (const b of [0.15, t.L - 0.15]) {
            const top = v3(t.P).addScaledVector(v3(t.u), (t.W * i) / (n - 1)).addScaledVector(v3(t.v), b).addScaledVector(v3(t.n), -0.06);
            const base = surfaceHeight(project, top.x, -top.z), h = top.y - base;
            if (h > 0.03) posts.push(<mesh key={`${i}-${b}`} position={[top.x, base + h / 2, top.z]} castShadow material={MAT.metal}><cylinderGeometry args={[h > 2 ? 0.09 : 0.035, h > 2 ? 0.09 : 0.035, h, 8]} /></mesh>);
          }
        }
        return (
          <group key={t.id}>
            <mesh position={c} quaternion={q} castShadow receiveShadow onClick={e => { e.stopPropagation(); pick({ kind: 'field', id: f.id }, 'paneles'); }}>
              <boxGeometry args={[t.W + 0.04, 0.05, t.L + 0.04]} />
              <meshStandardMaterial color={selected ? '#FAB704' : '#9aa4ab'} metalness={0.4} roughness={0.6} />
            </mesh>
            {posts}
          </group>
        );
      })}
      {lay.modules.map((m, i) => <ModuleMesh key={`${m.field}-${m.id}-${m.table}`} m={m} t={lay.tables[m.table]} idx={i} />)}
    </group>
  );
}

// ---------- objetos ----------
function Obstacles() {
  const project = useStore(s => s.project), sel = useStore(s => s.sel), showDims = useStore(s => s.showDims);
  return (
    <group>
      {project.obstacles.map(ob => {
        const selected = sel?.kind === 'obs' && sel.id === ob.id;
        const click = (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); pick({ kind: 'obs', id: ob.id }, 'objetos'); };
        const dist = showDims || selected ? distanceToHouse(project, ob) : null;
        return (
          <group key={ob.id}>
            {obstaclePrims(project, ob).map((p, i) => <PrimMesh key={i} p={p} selected={selected} onClick={click} />)}
            {dist && !dist.inside && (
              <>
                <Line points={[[dist.a[0], 0.06, -dist.a[1]], [dist.b[0], 0.06, -dist.b[1]]]} color={selected ? '#FAB704' : '#082537'} lineWidth={selected ? 2.5 : 1.5} dashed dashSize={0.3} gapSize={0.2} />
                <Html position={[(dist.a[0] + dist.b[0]) / 2, 0.3, -(dist.a[1] + dist.b[1]) / 2]} center style={{ pointerEvents: 'none' }} zIndexRange={[20, 10]}>
                  <div className={'dim' + (selected ? ' hi' : '')}>{dist.d.toFixed(2)} m</div>
                </Html>
              </>
            )}
          </group>
        );
      })}
    </group>
  );
}

// ---------- sol, cámara, escena ----------
/** Centro y radio de la bóveda celeste dibujada alrededor del proyecto. */
function useDome() {
  const house = useStore(s => s.project.house);
  const c: [number, number, number] = house.enabled ? [house.x, 0, -house.y] : [0, 0, 0];
  const R = Math.min(35, Math.max(15, houseSpan(house) * 1.5));
  return { c, R };
}
type P3 = [number, number, number];
const onDome = (c: P3, R: number, el: number, az: number): P3 => { const v = sunVector(el, az); return [c[0] + v[0] * R, c[1] + v[1] * R, c[2] + v[2] * R]; };

/**
 * Trayectoria solar: arco del día elegido (con horas), arcos de referencia de solsticios y equinoccio,
 * y anillo del horizonte con los puntos cardinales. Cambia con la fecha y con la ubicación del sitio.
 */
function SunPath() {
  const fecha = useStore(s => s.fecha), site = useStore(s => s.project.site), showLabels = useStore(s => s.showLabels);
  const { c, R } = useDome();
  const { y, m, d } = parseFecha(fecha);
  const today = useMemo(() => sunArc(site, y, m, d).map(p => onDome(c, R, p.el, p.az)), [site, y, m, d, c[0], c[2], R]); // eslint-disable-line react-hooks/exhaustive-deps
  const hours = useMemo(() => sunHours(site, y, m, d), [site, y, m, d]);
  const refs = useMemo(() => refDays(site.lat).map(r => {
    const a = sunArc(site, y, r.m, r.d, 0.2);
    const top = a.reduce((b, p) => (p.el > b.el ? p : b), a[0] ?? { h: 12, el: 0, az: 0 });
    return { ...r, pts: a.map(p => onDome(c, R, p.el, p.az)), top: onDome(c, R * 1.04, top.el, top.az) };
  }), [site, y, c[0], c[2], R]); // eslint-disable-line react-hooks/exhaustive-deps
  const ring = useMemo(() => Array.from({ length: 73 }, (_, i) => [c[0] + Math.sin(i * 5 * D2R) * R, 0.04, c[2] - Math.cos(i * 5 * D2R) * R] as P3), [c[0], c[2], R]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <group>
      <Line points={ring} color="#082537" lineWidth={1} transparent opacity={0.45} />
      {(['N', 'E', 'S', 'O'] as const).map((k, i) => (
        <Html key={k} position={[c[0] + Math.sin(i * 90 * D2R) * R * 1.06, 0.2, c[2] - Math.cos(i * 90 * D2R) * R * 1.06]} center style={{ pointerEvents: 'none' }} zIndexRange={[5, 0]}>
          <div className={'lab card' + (k === 'N' ? ' n' : '')}>{k}</div>
        </Html>
      ))}
      {refs.map(r => r.pts.length > 1 && (
        <group key={r.label}>
          <Line points={r.pts} color={r.color} lineWidth={1.2} dashed dashSize={0.8} gapSize={0.5} transparent opacity={0.85} />
          {showLabels && <Html position={r.top} center style={{ pointerEvents: 'none' }} zIndexRange={[5, 0]}><div className="lab ref" style={{ borderColor: r.color }}>{r.label}</div></Html>}
        </group>
      ))}
      {today.length > 1 && <Line points={today} color="#FAB704" lineWidth={3} />}
      {hours.map(p => {
        const pos = onDome(c, R, p.el, p.az);
        return (
          <group key={p.h}>
            <mesh position={pos}><sphereGeometry args={[0.22, 12, 8]} /><meshBasicMaterial color="#FAB704" /></mesh>
            {showLabels && <Html position={onDome(c, R * 1.07, p.el, p.az)} center style={{ pointerEvents: 'none' }} zIndexRange={[6, 0]}><div className="lab hora">{p.h}h</div></Html>}
          </group>
        );
      })}
    </group>
  );
}

function Sun() {
  const { sun } = useSim();
  const showSunPath = useStore(s => s.showSunPath);
  const { c, R } = useDome();
  const light = useRef<THREE.DirectionalLight>(null!);
  const above = sun.el > 0, dir = v3(sun.vec);
  useEffect(() => { if (light.current) light.current.target.position.set(0, 0, 0); }, []);
  return (
    <>
      <directionalLight ref={light} position={dir.clone().multiplyScalar(100)} intensity={above ? 0.6 + 2 * Math.sin(sun.el * Math.PI / 180) : 0}
        castShadow shadow-mapSize={[4096, 4096]} shadow-bias={-0.0004} shadow-normalBias={0.02}
        shadow-camera-left={-45} shadow-camera-right={45} shadow-camera-top={45} shadow-camera-bottom={-45} shadow-camera-far={400} />
      {above && <mesh position={onDome(c, R, sun.el, sun.az)}><sphereGeometry args={[0.9, 24, 16]} /><meshBasicMaterial color="#FAB704" /></mesh>}
      {showSunPath && <SunPath />}
    </>
  );
}

function CamRig() {
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: { target: THREE.Vector3; update: () => void } | null };
  const { sun } = useSim();
  const house = useStore(s => s.project.house);
  useEffect(() => {
    camBus.fn = (k: CamKind) => {
      if (!controls) return;
      const span = Math.max(houseSpan(house), 14), c = new THREE.Vector3(house.x, 2, -house.y);
      if (k === 'top') camera.position.set(c.x, span * 2.6, c.z + 0.001); // norte arriba
      else if (k === 'sun') { if (sun.el <= 0) return; camera.position.copy(v3(sun.vec).multiplyScalar(span * 2.4)).add(c); }
      else camera.position.set(c.x + span * 0.4, span * 3.6, c.z + span * 2.6); // desde el sur y en alto: Norte al fondo, se ven los paneles del faldón norte
      controls.target.copy(c); controls.update();
    };
  }, [camera, controls, house, sun]);
  const first = useRef(true);
  useEffect(() => { if (controls && first.current) { first.current = false; camBus.fn('3d'); } }, [controls]);
  return null;
}

function Compass() {
  return (
    <group position={[-20, 0.02, -20]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -1]}><coneGeometry args={[0.6, 2, 3]} /><meshBasicMaterial color="#082537" /></mesh>
      <Html position={[0, 0.2, -2.8]} center style={{ pointerEvents: 'none' }}><div className="lab">N</div></Html>
    </group>
  );
}

export default function Viewer() {
  const set = useStore(s => s.set), showSunPath = useStore(s => s.showSunPath);
  return (
    <Canvas shadows camera={{ position: [-13, 14, -22], fov: 45, near: 0.1, far: 2000 }} onPointerMissed={() => set({ sel: null, selModule: -1 })}>
      <color attach="background" args={['#cfdbe3']} />
      <hemisphereLight args={['#ffffff', '#8a8a7a', 0.9]} />
      <Sun />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[400, 400]} /><meshStandardMaterial color="#d8d2c2" roughness={1} /></mesh>
      <gridHelper args={[200, 200, '#b8b2a2', '#c9c3b3']} position={[0, 0.005, 0]} />
      {!showSunPath && <Compass />}
      <HouseMesh />
      <Fields />
      <Obstacles />
      <OrbitControls makeDefault maxPolarAngle={Math.PI / 2 - 0.02} enableDamping />
      <CamRig />
    </Canvas>
  );
}
