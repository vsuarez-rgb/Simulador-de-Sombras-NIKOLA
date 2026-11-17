/// <reference lib="webworker" />
import type { Layout } from './engine';
import type { ElecSetup } from './electrical';
import type { Weather } from './project';
import { simulateDay, simulateYearClear, simulateYearWeather, type SimParams } from './sim';

type Msg =
  | { job: 'dia'; lay: Layout; fdiff: number[]; sp: SimParams; es: ElecSetup | null; y: number; m: number; d: number }
  | { job: 'anio'; lay: Layout; fdiff: number[]; sp: SimParams; es: ElecSetup | null; y: number; clima: Weather | null };

self.onmessage = (e: MessageEvent<Msg>) => {
  const q = e.data;
  const progress = (f: number) => self.postMessage({ type: 'progress', f });
  try {
    const result = q.job === 'dia'
      ? simulateDay(q.lay, q.fdiff, q.sp, q.es, q.y, q.m, q.d)
      : q.clima ? simulateYearWeather(q.lay, q.fdiff, q.sp, q.es, q.clima, progress) : simulateYearClear(q.lay, q.fdiff, q.sp, q.es, q.y, progress);
    self.postMessage({ type: 'done', result });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err) });
  }
};
