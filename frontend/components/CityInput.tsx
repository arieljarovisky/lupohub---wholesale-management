import React, { useId } from 'react';
import { canonicalizeCityInput, CITY_QUICK_PICKS, isCabaCity } from '../utils/cityNormalize';

type CityInputProps = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  /** Input compacto (sucursales de entrega). */
  compact?: boolean;
};

const DATALIST_CITIES = [
  'CABA',
  'Capital Federal',
  'GBA',
  'La Plata',
  'Avellaneda',
  'Rosario',
  'Córdoba',
  'Mendoza',
  'Mar del Plata',
  'Tigre',
  'San Isidro',
];

export const CityInput: React.FC<CityInputProps> = ({
  value,
  onChange,
  className = '',
  placeholder = 'CABA o Capital Federal',
  compact = false,
}) => {
  const listId = useId().replace(/:/g, '');
  const inputClass =
    className ||
    (compact
      ? 'w-full p-2 bg-slate-900 border border-slate-800 rounded-lg text-white text-sm outline-none focus:border-blue-500'
      : 'w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all');

  const handleBlur = () => {
    const next = canonicalizeCityInput(value);
    if (next !== value) onChange(next);
  };

  return (
    <div className="space-y-2">
      <input
        type="text"
        list={listId}
        className={inputClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={handleBlur}
        placeholder={placeholder}
        autoComplete="address-level2"
      />
      <datalist id={listId}>
        {DATALIST_CITIES.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      {!compact && (
        <div className="flex flex-wrap gap-1.5">
          {CITY_QUICK_PICKS.map((pick) => (
            <button
              key={pick.label}
              type="button"
              onClick={() => onChange(pick.canonical)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition ${
                (pick.canonical === 'CABA' && isCabaCity(value)) || value.trim() === pick.canonical
                  ? 'bg-blue-600/30 border-blue-500/60 text-blue-100'
                  : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'
              }`}
            >
              {pick.label}
            </button>
          ))}
        </div>
      )}
      {!compact && isCabaCity(value) && value.trim().toUpperCase() !== 'CABA' && (
        <p className="text-[10px] text-emerald-400/90 ml-1">Se guardará como CABA (equivale a Capital Federal).</p>
      )}
    </div>
  );
};
