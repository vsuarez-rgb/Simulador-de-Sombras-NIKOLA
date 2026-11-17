/// <reference lib="webworker" />
import type { Layout } from './engine';
import { simulateDay, simulateYearClear, simulateYearTmy, type SimParams, type TmyHour } from './sim';

type Msg =
  | { job: 'dia'; lay: Layout; fdiff: number[]; sp: SimParams; y: number; m: number; d: number }
  | { job: 'anio'; lay: Layout; fdiff: number[]; sp: SimParams; y: number; tmy: TmyHour[] | null };

self.onmessage = (e: MessageEvent<Msg>) => {
  const q = e.data;
  const progress = (f: number) => self.postMessage({ type: 'progress', f });
  try {
    const result = q.job === 'dia'
      ? simulateDay(q.lay, q.fdiff, q.sp, q.y, q.m, q.d)
      : q.tmy ? simulateYearTmy(q.lay, q.fdiff, q.sp, q.tmy, progress) : simulateYearClear(q.lay, q.fdiff, q.sp, q.y, progress);
    self.postMessage({ type: 'done', result });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err) });
  }
};
