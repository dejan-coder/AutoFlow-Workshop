import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiError, get, qs, type Vehicle } from '../api';

export function Badge({ kind, children }: { kind: string; children: ReactNode }) {
  return <span className={`badge badge-${kind}`}>{children}</span>;
}

export function Plate({ reg }: { reg: string | null | undefined }) {
  return reg ? <span className="plate-tag">{reg}</span> : null;
}

/** Hämtar data och laddar om när beroenden ändras. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(() => fn().then(setData).catch((e) => setError(e.message)), deps);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, error, reload, setData };
}

/** Kör en åtgärd och visar felmeddelandet om den misslyckas. */
export function useAction() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'Något gick fel');
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, run, setError };
}

export function ErrorText({ error }: { error?: string }) {
  return error ? <p className="error">{error}</p> : null;
}

/** Sök fordon på regnummer, märke eller ägare och välj ett. */
export function VehiclePicker({ onSelect, autoFocus }: { onSelect: (v: Vehicle) => void; autoFocus?: boolean }) {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<Vehicle[]>([]);
  useEffect(() => {
    if (search.trim().length < 2) return setItems([]);
    const t = setTimeout(() => get<{ items: Vehicle[] }>(`/api/vehicles?${qs({ search, limit: 8 })}`).then((r) => setItems(r.items)), 200);
    return () => clearTimeout(t);
  }, [search]);
  return (
    <div className="picker">
      <input
        className="plate-search"
        placeholder="Sök regnummer, märke eller ägare"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus={autoFocus}
      />
      {items.length > 0 && (
        <ul className="picker-list">
          {items.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                className="picker-item"
                onClick={() => {
                  onSelect(v);
                  setSearch('');
                  setItems([]);
                }}
              >
                <Plate reg={v.registration_number} /> {[v.make, v.model].filter(Boolean).join(' ')}
                <span className="muted"> {v.customer_name ?? 'Ingen ägare'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function StatusTabs<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div className="tabs">
      {options.map(([v, label]) => (
        <button key={v} type="button" className={v === value ? 'tab active' : 'tab'} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}
