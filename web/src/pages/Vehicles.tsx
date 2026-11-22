import { useEffect, useState } from 'react';
import { api, FUEL_LABELS, type Vehicle } from '../api';
import { VehicleForm } from './VehicleForm';

export function Vehicles() {
  const [search, setSearch] = useState('');
  const [data, setData] = useState<{ items: Vehicle[]; total: number }>({ items: [], total: 0 });
  const [creating, setCreating] = useState(false);
  const reload = () => api.listVehicles(search).then(setData);

  useEffect(() => {
    const t = setTimeout(reload, 200);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <>
      <header className="page-head">
        <h1>Fordon</h1>
        <button onClick={() => setCreating(true)}>Nytt fordon</button>
      </header>
      {creating && (
        <section className="card">
          <h2>Nytt fordon</h2>
          <VehicleForm
            onCancel={() => setCreating(false)}
            onSubmit={async (v) => {
              await api.createVehicle(v);
              setCreating(false);
              await reload();
            }}
          />
        </section>
      )}
      <section className="card">
        <input className="search plate-search" placeholder="Sök regnummer, märke, modell eller ägare" value={search} onChange={(e) => setSearch(e.target.value)} />
        <table>
          <thead><tr><th>Regnummer</th><th>Fordon</th><th>År</th><th>Drivmedel</th><th>Mätare</th><th>Ägare</th></tr></thead>
          <tbody>
            {data.items.map((v) => (
              <tr key={v.id} className={v.customer_id ? 'clickable' : ''} onClick={() => v.customer_id && (location.hash = `#/kunder/${v.customer_id}`)}>
                <td><span className="plate-tag">{v.registration_number}</span></td>
                <td>{[v.make, v.model].filter(Boolean).join(' ')}</td>
                <td>{v.model_year}</td>
                <td>{v.fuel ? FUEL_LABELS[v.fuel] : ''}</td>
                <td>{v.mileage_km != null ? `${v.mileage_km.toLocaleString('sv-SE')} km` : ''}</td>
                <td>{v.customer_name ?? <span className="muted">Ingen ägare</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.items.length === 0 && <p className="empty">Inga fordon hittades.</p>}
        <p className="muted">{data.total} fordon</p>
      </section>
    </>
  );
}
