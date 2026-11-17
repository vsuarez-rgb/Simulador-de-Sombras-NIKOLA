import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { clearSky, computeStep, diffuseShading, sunPosition, sunVector, type Layout, type ModStep } from '../engine/engine';
import { buildLayout, type FieldInfo } from '../engine/project';
import { useStore } from '../store';

export interface SimCtx {
  lay: Layout; fieldInfo: FieldInfo[]; fdiff: number[];
  sun: { el: number; az: number; vec: [number, number, number]; dni: number; ghi: number };
  instant: ModStep[] | null;
}
export const SimContext = createContext<SimCtx | null>(null);
export const useSim = () => useContext(SimContext)!;

export function parseFecha(f: string) { const [y, m, d] = f.split('-').map(Number); return { y, m, d }; }

export function useSimState(): SimCtx {
  const project = useStore(s => s.project), fecha = useStore(s => s.fecha), hora = useStore(s => s.hora), sub = useStore(s => s.sub);
  const { lay, fieldInfo } = useMemo(() => buildLayout(project), [project]);
  // El factor de difusa es caro: se recalcula con un pequeño retardo tras cada cambio
  const [fdiff, setFdiff] = useState<number[]>(() => diffuseShading(lay));
  useEffect(() => {
    if (fdiff.length !== lay.modules.length) setFdiff(lay.modules.map(() => 0));
    const t = setTimeout(() => setFdiff(diffuseShading(lay)), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lay]);
  const sun = useMemo(() => {
    const { y, m, d } = parseFecha(fecha), s = project.site;
    const pos = sunPosition(s.lat, s.lon, s.tz, y, m, d, hora), irr = clearSky(pos.el);
    return { el: pos.el, az: pos.az, vec: sunVector(pos.el, pos.az), dni: irr.dni, ghi: irr.ghi, irr };
  }, [fecha, hora, project.site]);
  const instant = useMemo(() => {
    if (sun.el <= 0 || fdiff.length !== lay.modules.length) return null;
    return computeStep(lay, sun.vec, sun.irr, fdiff, project.site.albedo, sub);
  }, [lay, fdiff, sun, sub, project.site.albedo]);
  return { lay, fieldInfo, fdiff, sun, instant };
}
