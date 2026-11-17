import { Html, Line, OrbitControls, TransformControls } from '@react-three/drei';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Box, Module, Prim, Table } from '../engine/engine';
import { distanceToHouse, housePrims, obstacleBase, obstaclePrims, surfaceHeight, type FieldInfo, type Obstacle, type Project } from '../engine/project';
import { useStore, type Sel } from '../store';
import { parseFecha, useSim } from '../sim/useSim';
import { drawModule, drawModuleElec, pct, PX } from '../sim/viz';
import { sunPosition, sunVector } from '../engine/engine';

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
type DownFn = (e: ThreeEvent<PointerEvent>) => void;

function PrimMesh({ p, selected, onClick, onPointerDown }: { p: Prim; selected?: boolean; onClick?: ClickFn; onPointerDown?: DownFn }) {
  const mat = useMemo(() => {
    const base = (MAT as Record<string, THREE.MeshStandardMaterial>)[p.kind] ?? MAT.edificio;
    if (!selected) return base;
    const m = base.clone(); m.emissive = SEL_EMISSIVE; m.emissiveIntensity = 0.25; return m;
  }, [p.kind, selected]);
  if (p.type === 'box') return (
    <mesh position={p.c} rotation={[0, -(p as Box).rot * Math.PI / 180, 0]} castShadow receiveShadow material={mat} onClick={onClick} onPointerDown={onPointerDown}>
      <boxGeometry args={[p.h[0] * 2, p.h[1] * 2, p.h[2] * 2]} />
    </mesh>);
  if (p.type === 'sph') return <mesh position={p.c} castShadow receiveShadow material={mat} onClick={onClick} onPointerDown={onPointerDown}><sphereGeometry args={[p.r, 24, 16]} /></mesh>;
  if (p.type === 'cyl') return (
    <mesh position={[p.c[0], (p.y0 + p.y1) / 2, p.c[1]]} castShadow material={mat} onClick={onClick} onPointerDown={onPointerDown}>
      <cylinderGeometry args={[p.r, p.r, p.y1 - p.y0, 14]} />
    </mesh>);
  return null;
}

function TriMesh({ tris, material, onClick, onPointerDown }: { tris: Prim[]; material: THREE.Material; onClick?: ClickFn; onPointerDown?: DownFn }) {
  const geo = useMemo(() => {
    const pos: number[] = [];
    for (const t of tris) if (t.type === 'tri') {
      const b = [t.a[0] + t.e1[0], t.a[1] + t.e1[1], t.a[2] + t.e1[2]], c = [t.a[0] + t.e2[0], t.a[1] + t.e2[1], t.a[2] + t.e2[2]];
      pos.push(...t.a, ...b, ...c);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g;
  }, [tris]);
  useEffect(() => () => geo.dispose(), [geo]);
  return <mesh geometry={geo} material={material} castShadow receiveShadow onClick={onClick} onPointerDown={onPointerDown} />;
}

// ---------- casa ----------
function HouseMesh() {
  const house = useStore(s => s.project.house), sel = useStore(s => s.sel), set = useStore(s => s.set);
  const prims = useMemo(() => housePrims(house), [house]);
  const selected = sel?.kind === 'house';
  const click = (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); set({ sel: { kind: 'house' }, tab: 'casa' }); };
  const down = useDragStart()({ kind: 'house' });
  const roofMat = useMemo(() => {
    const m = MAT.techo.clone(); if (selected) { m.emissive = SEL_EMISSIVE; m.emissiveIntensity = 0.2; } return m;
  }, [selected]);
  const wallTris = prims.filter(p => p.type === 'tri' && p.kind === 'muros'), roofTris = prims.filter(p => p.type === 'tri' && p.kind === 'techo');
  if (!house.enabled) return null;
  return (
    <group>
      {prims.filter(p => p.type === 'box').map((p, i) => <PrimMesh key={i} p={p} selected={selected} onClick={click} onPointerDown={down} />)}
      {roofTris.length > 0 && <TriMesh tris={roofTris} material={roofMat} onClick={click} onPointerDown={down} />}
      {wallTris.length > 0 && <TriMesh tris={wallTris} material={MAT.muros} onClick={click} onPointerDown={down} />}
      {house.techo === 'plano' && (() => {
        const b = prims[0] as Box;
        return <mesh position={[b.c[0], b.h[1] * 2 + 0.01, b.c[2]]} rotation={[-Math.PI / 2, 0, b.rot * Math.PI / 180]} receiveShadow material={MAT.techoPlano} onClick={click} onPointerDown={down}>
          <planeGeometry args={[b.h[0] * 2, b.h[2] * 2]} /></mesh>;
      })()}
    </group>
  );
}

// ---------- módulos ----------
function ModuleMesh({ m, t, idx }: { m: Module; t: Table; idx: number }) {
  const { instant, rs } = useSim();
  const elecView = useStore(s => s.tab === 'electrico'), clickElec = useStore(s => s.clickModuleElec);
  const sIdx = rs.stringOf[idx], isOpt = rs.optimized.includes(idx), isEx = rs.excluded.includes(idx);
  const mode = useStore(s => s.mode), day = useStore(s => s.day), yearRes = useStore(s => s.yearRes);
  const selModule = useStore(s => s.selModule), set = useStore(s => s.set), showLabels = useStore(s => s.showLabels), fields = useStore(s => s.project.fields);
  const dragStart = useDragStart(), fieldId = fields[m.field]?.id;
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
  const heatMode = mode !== 'instante' && !!R;
  const cells = heatMode ? R!.mods[idx]?.cell : instant?.[idx]?.cells ?? null;
  useEffect(() => {
    if (elecView) drawModuleElec(cv, m, sIdx, isOpt, isEx, idx === selModule);
    else drawModule(cv, m, cells, heatMode, !instant && !heatMode, idx === selModule);
    tex.needsUpdate = true;
  }, [cv, tex, m, cells, heatMode, instant, idx, selModule, elecView, sIdx, isOpt, isEx]);
  const metric = heatMode ? R!.mods[idx]?.perdElec : instant ? instant[idx].geom : undefined;
  return (
    <>
      <mesh geometry={geo} castShadow onClick={e => {
        e.stopPropagation();
        if (elecView) { clickElec(m.key); set({ selModule: idx }); return; }
        set({ selModule: idx, sel: { kind: 'field', id: fieldId }, tab: 'paneles' });
      }} onPointerDown={elecView || !fieldId ? undefined : dragStart({ kind: 'field', id: fieldId })}>
        <meshStandardMaterial map={tex} roughness={0.35} metalness={0.1} side={THREE.DoubleSide} />
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
  const sel = useStore(s => s.sel), fields = useStore(s => s.project.fields), project = useStore(s => s.project), set = useStore(s => s.set);
  const dragStart = useDragStart();
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
            <mesh position={c} quaternion={q} castShadow receiveShadow onClick={e => { e.stopPropagation(); set({ sel: { kind: 'field', id: f.id }, tab: 'paneles' }); }}
              onPointerDown={f ? dragStart({ kind: 'field', id: f.id }) : undefined}>
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
  const project = useStore(s => s.project), sel = useStore(s => s.sel), set = useStore(s => s.set), showDims = useStore(s => s.showDims);
  const dragStart = useDragStart();
  return (
    <group>
      {project.obstacles.map(ob => {
        const selected = sel?.kind === 'obs' && sel.id === ob.id;
        const click = (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); set({ sel: { kind: 'obs', id: ob.id }, tab: 'objetos' }); };
        const down = dragStart({ kind: 'obs', id: ob.id });
        const dist = showDims || selected ? distanceToHouse(project, ob) : null;
        return (
          <group key={ob.id}>
            {obstaclePrims(project, ob).map((p, i) => <PrimMesh key={i} p={p} selected={selected} onClick={click} onPointerDown={down} />)}
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

// ---------- arrastre ----------
type Target = NonNullable<Sel>;
const D2R = Math.PI / 180;
const snap = (v: number) => Math.round(v * 20) / 20; // 0,05 m
const TAB_OF = { house: 'casa', field: 'paneles', obs: 'objetos' } as const;

/** Posición en planta (X Este, Y Norte) del objeto. */
function targetXY(p: Project, t: Target): [number, number] | null {
  if (t.kind === 'house') return p.house.enabled ? [p.house.x, p.house.y] : null;
  const o = t.kind === 'field' ? p.fields.find(f => f.id === t.id) : p.obstacles.find(o => o.id === t.id);
  return o ? [o.x, o.y] : null;
}
/** Altura de la base del objeto: plano horizontal sobre el que se proyecta el puntero. */
function targetBase(p: Project, t: Target, xy: [number, number]): number {
  if (t.kind === 'house') return 0;
  if (t.kind === 'obs') { const o = p.obstacles.find(o => o.id === t.id); return o ? obstacleBase(p, o) : 0; }
  return surfaceHeight(p, xy[0], xy[1]);
}
function setTargetXY(t: Target, x: number, y: number) {
  const s = useStore.getState();
  if (t.kind === 'house') s.setHouse({ x, y });
  else if (t.kind === 'field') s.setField(t.id, { x, y });
  else s.setObs(t.id, { x, y });
}

/**
 * Arrastre directo con mouse o dedo (pointer events): pointerdown sobre el objeto desactiva
 * OrbitControls, el puntero se proyecta sobre un plano horizontal a la altura de la base y se
 * actualizan x, y (Y Norte = −z) con snap de 0,05 m. Bajo 4 px de movimiento es un clic.
 */
function useDragStart() {
  const camera = useThree(s => s.camera), gl = useThree(s => s.gl);
  const controls = useThree(s => s.controls) as unknown as { enabled: boolean } | null;
  return useCallback((target: Target) => (e: ThreeEvent<PointerEvent>) => {
    const st = useStore.getState();
    if (st.tab === 'electrico') return; // ahí el clic asigna string / optimizador / excluir
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const xy = targetXY(st.project, target); if (!xy) return;
    e.stopPropagation();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -targetBase(st.project, target, xy));
    const rc = new THREE.Raycaster(), ndc = new THREE.Vector2(), hit = new THREE.Vector3();
    const toPlane = (cx: number, cy: number): [number, number] | null => {
      const r = gl.domElement.getBoundingClientRect();
      ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      rc.setFromCamera(ndc, camera);
      return rc.ray.intersectPlane(plane, hit) ? [hit.x, -hit.z] : null;
    };
    const h0 = toPlane(e.clientX, e.clientY); if (!h0) return;
    const off = [xy[0] - h0[0], xy[1] - h0[1]], id = e.pointerId, sx = e.clientX, sy = e.clientY;
    let dragging = false, raf = 0, pending: [number, number] | null = null, last = xy.join();
    if (controls) controls.enabled = false;
    // como mucho una actualización del store por frame
    const apply = () => {
      raf = 0; if (!pending) return;
      const k = pending.join(); if (k !== last) { last = k; setTargetXY(target, pending[0], pending[1]); }
      pending = null;
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      if (!dragging) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
        dragging = true; useStore.getState().set({ dragging: target, sel: target, tab: TAB_OF[target.kind] });
      }
      const p = toPlane(ev.clientX, ev.clientY); if (!p) return;
      pending = [snap(p[0] + off[0]), snap(p[1] + off[1])];
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end);
      if (raf) { cancelAnimationFrame(raf); apply(); }
      if (controls) controls.enabled = true;
      if (dragging) useStore.getState().set({ dragging: null });
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
  }, [camera, gl, controls]);
}

// ---------- rotación ----------
const ROT_OBS = new Set(['edificio', 'muro', 'chimenea']);
/** Rotación editable del objeto seleccionado: casa → house.rot, campo inclinado → field.azim, edificio/muro → obs.rot. */
function rotTarget(p: Project, sel: Sel, info: FieldInfo[]): { rot: number; xy: [number, number]; base: number; set: (deg: number) => void } | null {
  const s = useStore.getState();
  if (sel?.kind === 'house' && p.house.enabled) return { rot: p.house.rot, xy: [p.house.x, p.house.y], base: 0.6, set: d => s.setHouse({ rot: ((d % 360) + 360) % 360 }) };
  if (sel?.kind === 'field') {
    const i = p.fields.findIndex(f => f.id === sel.id), f = p.fields[i];
    if (!f || !(f.montaje === 'inclinada' || info[i]?.tilt === 0)) return null; // coplanar: sigue al faldón
    return { rot: f.azim, xy: [f.x, f.y], base: surfaceHeight(p, f.x, f.y) + 0.2, set: d => s.setField(f.id, { azim: ((((d + 180) % 360) + 360) % 360) - 180 }) };
  }
  if (sel?.kind === 'obs') {
    const o = p.obstacles.find(o => o.id === sel.id);
    if (!o || !ROT_OBS.has(o.tipo)) return null;
    return { rot: o.rot, xy: [o.x, o.y], base: obstacleBase(p, o) + 0.2, set: d => s.setObs(o.id, { rot: ((d % 360) + 360) % 360 }) };
  }
  return null;
}

/** Anillo de rotación (solo eje vertical) + atajos R / Shift+R (±15°). */
function RotateHandle() {
  const { fieldInfo } = useSim();
  const sel = useStore(s => s.sel), project = useStore(s => s.project), elecView = useStore(s => s.tab === 'electrico');
  const [obj, setObj] = useState<THREE.Group | null>(null);
  const rt = elecView ? null : rotTarget(project, sel, fieldInfo);
  const rtRef = useRef(rt); rtRef.current = rt;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.code !== 'KeyR' || e.ctrlKey || e.metaKey || e.altKey || t?.closest('input,select,textarea')) return;
      const r = rtRef.current; if (!r) return;
      e.preventDefault(); r.set(Math.round(r.rot + (e.shiftKey ? -15 : 15)));
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (!rt) return null;
  return (
    <>
      {/* rotation.y positiva gira antihorario visto desde arriba; el azimut crece en sentido horario */}
      <group ref={setObj} position={[rt.xy[0], rt.base, -rt.xy[1]]} rotation={[0, -rt.rot * D2R, 0]} />
      {obj && (
        <TransformControls object={obj} mode="rotate" showX={false} showZ={false} size={0.8} rotationSnap={5 * D2R}
          onObjectChange={() => {
            // se lee el giro desde el cuaternión (la descomposición de Euler XYZ salta pasado ±90°)
            const v = new THREE.Vector3(1, 0, 0).applyQuaternion(obj.quaternion), ang = Math.atan2(-v.z, v.x);
            const deg = Math.round(-ang / D2R * 10) / 10;
            if (Math.abs(deg - rt.rot) > 0.05) rt.set(deg);
          }} />
      )}
    </>
  );
}

// ---------- cota y coordenadas en vivo mientras se arrastra ----------
function DragInfo() {
  const dragging = useStore(s => s.dragging), project = useStore(s => s.project);
  const { fieldInfo } = useSim();
  if (!dragging) return null;
  const xy = targetXY(project, dragging); if (!xy) return null;
  let dist: ReturnType<typeof distanceToHouse> = null;
  if (dragging.kind === 'obs') { const o = project.obstacles.find(o => o.id === dragging.id); if (o) dist = distanceToHouse(project, o); }
  else if (dragging.kind === 'field') {
    // distancia más corta desde las esquinas del campo a los muros de la casa
    const i = project.fields.findIndex(f => f.id === dragging.id), corners = fieldInfo[i]?.corners ?? [];
    for (const c of corners) {
      const d = distanceToHouse(project, { id: '', tipo: 'poste', x: c[0], y: -c[2], alto: 0, ancho: 0, largo: 0, rot: 0, copa: 0 } as Obstacle);
      if (d && (!dist || d.inside || (!dist.inside && d.d < dist.d))) dist = d;
      if (d?.inside) break;
    }
  }
  const base = targetBase(project, dragging, xy);
  return (
    <>
      {dragging.kind === 'field' && dist && !dist.inside && (
        <Line points={[[dist.a[0], base + 0.06, -dist.a[1]], [dist.b[0], 0.06, -dist.b[1]]]} color="#FAB704" lineWidth={2.5} dashed dashSize={0.3} gapSize={0.2} />
      )}
      <Html position={[xy[0], base + 2.2, -xy[1]]} center style={{ pointerEvents: 'none' }} zIndexRange={[30, 20]}>
        <div className="dragtip">X {xy[0].toFixed(2)} · Y {xy[1].toFixed(2)} m
          {dist && <><br />{dist.inside ? 'sobre la casa' : `a la casa ${dist.d.toFixed(2)} m`}</>}</div>
      </Html>
    </>
  );
}

// ---------- sol, cámara, escena ----------
function Sun() {
  const { sun } = useSim();
  const fecha = useStore(s => s.fecha), site = useStore(s => s.project.site);
  const light = useRef<THREE.DirectionalLight>(null!);
  const path = useMemo(() => {
    const { y, m, d } = parseFecha(fecha), pts: [number, number, number][] = [];
    for (let h = 0; h <= 24; h += 0.1) {
      const p = sunPosition(site.lat, site.lon, site.tz, y, m, d, h);
      if (p.el > 0) pts.push(sunVector(p.el, p.az).map(c => c * 60) as [number, number, number]);
    }
    return pts;
  }, [fecha, site]);
  const above = sun.el > 0, dir = v3(sun.vec);
  useEffect(() => { if (light.current) light.current.target.position.set(0, 0, 0); }, []);
  return (
    <>
      <directionalLight ref={light} position={dir.clone().multiplyScalar(100)} intensity={above ? 0.6 + 2 * Math.sin(sun.el * Math.PI / 180) : 0}
        castShadow shadow-mapSize={[4096, 4096]} shadow-bias={-0.0004} shadow-normalBias={0.02}
        shadow-camera-left={-45} shadow-camera-right={45} shadow-camera-top={45} shadow-camera-bottom={-45} shadow-camera-far={400} />
      {above && <mesh position={dir.clone().multiplyScalar(60)}><sphereGeometry args={[1.4, 24, 16]} /><meshBasicMaterial color="#FAB704" /></mesh>}
      {path.length > 1 && <Line points={path} color="#FAB704" lineWidth={1.5} dashed dashSize={1} gapSize={0.6} />}
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
      const span = Math.max(house.ancho, house.fondo, 14), c = new THREE.Vector3(house.x, 2, -house.y);
      if (k === 'top') camera.position.set(c.x, span * 2.6, c.z + 0.001); // norte arriba
      else if (k === 'sun') { if (sun.el <= 0) return; camera.position.copy(v3(sun.vec).multiplyScalar(span * 2.4)).add(c); }
      else camera.position.set(c.x - span * 0.9, span * 1.0, c.z - span * 1.5); // desde el norte (paneles mirando al norte)
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
  const set = useStore(s => s.set);
  return (
    <Canvas shadows camera={{ position: [-13, 14, -22], fov: 45, near: 0.1, far: 2000 }} onPointerMissed={() => set({ sel: null, selModule: -1 })}>
      <color attach="background" args={['#cfdbe3']} />
      <hemisphereLight args={['#ffffff', '#8a8a7a', 0.9]} />
      <Sun />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[400, 400]} /><meshStandardMaterial color="#d8d2c2" roughness={1} /></mesh>
      <gridHelper args={[200, 200, '#b8b2a2', '#c9c3b3']} position={[0, 0.005, 0]} />
      <Compass />
      <HouseMesh />
      <Fields />
      <Obstacles />
      <RotateHandle />
      <DragInfo />
      <OrbitControls makeDefault maxPolarAngle={Math.PI / 2 - 0.02} enableDamping />
      <CamRig />
    </Canvas>
  );
}
