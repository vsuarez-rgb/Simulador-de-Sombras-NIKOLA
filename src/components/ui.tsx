import { useEffect, useState, type ReactNode } from 'react';

export function Num({ label, value, onChange, step = 0.1, min, max, unit }: {
  label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; unit?: string;
}) {
  const [txt, setTxt] = useState(String(value));
  useEffect(() => { if (parseFloat(txt) !== value) setTxt(String(+value.toFixed(3))); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label><span>{label}{unit ? <span className="unit"> ({unit})</span> : null}</span>
      <input type="number" value={txt} step={step} min={min} max={max}
        onChange={e => {
          setTxt(e.target.value);
          let v = parseFloat(e.target.value); if (!isFinite(v)) return;
          if (min != null) v = Math.max(min, v); if (max != null) v = Math.min(max, v);
          onChange(v);
        }} />
    </label>
  );
}
export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return <div className="seg">{options.map(([v, l]) => <button key={v} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}</div>;
}
export const Row = ({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 }) => <div className={'row' + (cols === 3 ? ' three' : '')}>{children}</div>;
export const H3 = ({ children }: { children: ReactNode }) => <h3>{children}</h3>;
