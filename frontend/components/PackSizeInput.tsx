import React, { useEffect, useState } from 'react';

type PackSizeInputProps = {
  value: number;
  onChange: (packSize: number) => void;
  /** amber = Mercado Libre, cyan = Tienda Nube */
  tone?: 'amber' | 'cyan';
  compact?: boolean;
};

function wholePack(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

const PackSizeInput: React.FC<PackSizeInputProps> = ({ value, onChange, tone = 'amber', compact = false }) => {
  const safe = Math.max(1, Math.floor(Number(value) || 1));
  const [draft, setDraft] = useState(String(safe));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(String(safe));
  }, [safe, focused]);

  const commit = (raw: string) => {
    const n = wholePack(raw);
    if (n == null) {
      setDraft(String(safe));
      return;
    }
    setDraft(String(n));
    if (n !== safe) onChange(n);
  };

  const focusBorder = tone === 'cyan' ? 'focus:border-cyan-500' : 'focus:border-amber-500';
  const sizeClass = compact ? 'w-14 px-1 py-0.5 text-[11px] rounded' : 'w-20 px-2 py-1 text-xs rounded-md';

  return (
    <label className="inline-flex items-center gap-1 shrink-0" title="Unidades por venta">
      <span className={`font-bold text-slate-400 ${compact ? 'text-[10px]' : 'text-xs'}`}>x</span>
      <input
        type="number"
        min={1}
        step={1}
        inputMode="numeric"
        value={draft}
        aria-label="Cantidad del pack"
        onFocus={(e) => {
          setFocused(true);
          e.target.select();
        }}
        onChange={(e) => {
          const raw = e.target.value;
          setDraft(raw);
          const n = wholePack(raw);
          if (n != null) onChange(n);
        }}
        onBlur={(e) => {
          setFocused(false);
          commit(e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        className={`${sizeClass} bg-slate-800 border border-slate-600 text-white font-bold text-center outline-none ${focusBorder} [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
      />
    </label>
  );
};

export default PackSizeInput;
