import { useEffect, useState } from 'react';
import { get, post, qs, type TireStorage, type Vehicle } from '../api';
import { ErrorText, Plate, useAction, useLoad, VehiclePicker } from '../components/common';
import { Field } from '../components/Field';
import { num } from '../format';

export const SEASON: Record<string, string> = { summer: 'Sommar', winter: 'Vinter', all_season: 'Året runt' };

export function Tires() {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [showRetrieved, setShowRetrieved] = useState(false);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 200);
    return () => clearTimeout(t);
  }, [search]);
  const { data, reload } = useLoad(
    () => get<{ items: TireStorage[] }>(`/api/tire-storage?${qs({ search: debounced, include_retrieved: showRetrieved ? 'true' : undefined, limit: 200 })}`),
    [debounced, showRetrieved],
  );
  const action = useAction();
  return (
    <>
      <header className="page-head">
        <h1>Däckhotell</h1>
        <button onClick={() => setCreating(true)}>Lägg in däck</button>
      </header>
      {creating && <NewTires onDone={() => { setCreating(false); reload(); }} />}
      <ErrorText error={action.error} />
      <section className="card">
        <div className="toolbar">
          <input className="search grow" placeholder="Sök regnummer, kund, hyllplats eller märke" value={search} onChange={(e) => setSearch(e.target.value)} />
          <label className="check"><input type="checkbox" checked={showRetrieved} onChange={(e) => setShowRetrieved(e.target.checked)} /> Visa uthämtade</label>
        </div>
        <table>
          <thead><tr><th>Plats</th><th>Regnummer</th><th>Kund</th><th>Säsong</th><th>Dimension</th><th>Märke</th><th className="num">Mönsterdjup</th><th>Fälg</th><th>Inlagd</th><th /></tr></thead>
          <tbody>
            {data?.items.map((t) => (
              <tr key={t.id} className={t.retrieved_at ? 'muted' : ''}>
                <td><strong>{t.location}</strong></td>
                <td><Plate reg={t.registration_number} /></td>
                <td><a href={`#/kunder/${t.customer_id}`}>{t.customer_name}</a></td>
                <td>{SEASON[t.season]}</td>
                <td>{t.tire_size}</td>
                <td>{t.brand}</td>
                <td className={`num${t.tread_depth_mm != null && t.tread_depth_mm < (t.season === 'winter' ? 4 : 3) ? ' warn' : ''}`}>
                  {t.tread_depth_mm != null ? `${num(t.tread_depth_mm)} mm` : ''}
                </td>
                <td>{t.with_rims ? 'Ja' : 'Nej'}</td>
                <td>{t.stored_at}</td>
                <td className="num nowrap">
                  {t.retrieved_at ? (
                    <span className="small">Uthämtad {t.retrieved_at}</span>
                  ) : (
                    <button className="link" onClick={() => action.run(async () => { await post(`/api/tire-storage/${t.id}/retrieve`); reload(); })}>Lämna ut</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.items.length === 0 && <p className="empty">Inga däck i lager.</p>}
        <p className="muted small">Röd siffra = under rekommenderat mönsterdjup (3 mm sommar, 4 mm vinter).</p>
      </section>
    </>
  );
}

function NewTires({ onDone }: { onDone: () => void }) {
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [f, setF] = useState({ location: '', season: 'summer', tire_size: '', brand: '', tread_depth_mm: '', with_rims: 'false', quantity: '4', notes: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const action = useAction();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <section className="card">
      <h2>Lägg in däck</h2>
      {vehicle ? (
        <p><Plate reg={vehicle.registration_number} /> {vehicle.customer_name ?? <span className="error">Fordonet saknar ägare</span>} <button className="link" onClick={() => setVehicle(null)}>Byt</button></p>
      ) : (
        <VehiclePicker onSelect={setVehicle} autoFocus />
      )}
      <div className="form">
        <div className="row">
          <Field label="Hyllplats" error={errors.location}><input value={f.location} onChange={set('location')} placeholder="t.ex. A-12" /></Field>
          <Field label="Säsong">
            <select value={f.season} onChange={set('season')}>
              {Object.entries(SEASON).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="Dimension"><input value={f.tire_size} onChange={set('tire_size')} placeholder="205/55 R16" /></Field>
          <Field label="Märke"><input value={f.brand} onChange={set('brand')} /></Field>
        </div>
        <div className="row">
          <Field label="Mönsterdjup (mm)" error={errors.tread_depth_mm}><input value={f.tread_depth_mm} onChange={set('tread_depth_mm')} inputMode="decimal" /></Field>
          <Field label="Antal"><input value={f.quantity} onChange={set('quantity')} inputMode="numeric" /></Field>
          <Field label="Med fälg">
            <select value={f.with_rims} onChange={set('with_rims')}><option value="false">Nej</option><option value="true">Ja</option></select>
          </Field>
          <Field label="Anteckning"><input value={f.notes} onChange={set('notes')} /></Field>
        </div>
      </div>
      <ErrorText error={action.error} />
      <div className="actions">
        <button className="ghost" onClick={onDone}>Avbryt</button>
        <button disabled={!vehicle || action.busy} onClick={() => action.run(async () => {
          try {
            await post('/api/tire-storage', {
              vehicle_id: vehicle!.id,
              location: f.location,
              season: f.season,
              tire_size: f.tire_size,
              brand: f.brand,
              tread_depth_mm: f.tread_depth_mm ? Number(f.tread_depth_mm.replace(',', '.')) : null,
              quantity: Number(f.quantity) || 4,
              with_rims: f.with_rims === 'true',
              notes: f.notes || null,
            });
            onDone();
          } catch (err) {
            if (err && typeof err === 'object' && 'fields' in err) setErrors((err as { fields: Record<string, string> }).fields);
            throw err;
          }
        })}>Spara</button>
      </div>
    </section>
  );
}

/** Däck i förvar för ett fordon eller en kund, visas på kundkortet. */
export function TiresFor({ customerId }: { customerId: number }) {
  const { data } = useLoad(() => get<{ items: TireStorage[] }>(`/api/tire-storage?customer_id=${customerId}`), [customerId]);
  if (!data?.items.length) return null;
  return (
    <section className="card">
      <h2>Däck i däckhotellet</h2>
      <ul className="plain">
        {data.items.map((t) => (
          <li key={t.id}>
            <strong>{t.location}</strong> <Plate reg={t.registration_number} /> {SEASON[t.season]} {t.tire_size} {t.brand}
            {t.tread_depth_mm != null && <span className="muted"> · {num(t.tread_depth_mm)} mm</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

