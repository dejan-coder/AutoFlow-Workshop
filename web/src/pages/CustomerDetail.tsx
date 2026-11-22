import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, FUEL_LABELS, type Customer, type Vehicle } from '../api';
import { CustomerForm } from './CustomerForm';
import { VehicleForm } from './VehicleForm';

type Detail = Customer & { vehicles: Vehicle[] };

export function CustomerDetail({ id }: { id: number }) {
  const [customer, setCustomer] = useState<Detail | null>(null);
  const [editing, setEditing] = useState(false);
  const [addingVehicle, setAddingVehicle] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => api.getCustomer(id).then(setCustomer).catch((e) => setError(e.message)), [id]);
  useEffect(() => {
    load();
  }, [load]);

  if (error && !customer) return <div className="card error">{error}</div>;
  if (!customer) return <div className="card">Laddar…</div>;

  async function remove() {
    if (!confirm(`Ta bort ${customer!.name}?`)) return;
    try {
      await api.deleteCustomer(id);
      location.hash = '#/kunder';
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
    }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <a href="#/kunder" className="back">‹ Kunder</a>
          <h1>{customer.name}</h1>
        </div>
        <div className="actions">
          <button className="ghost" onClick={() => setEditing(!editing)}>{editing ? 'Stäng' : 'Ändra'}</button>
          <button className="danger" onClick={remove}>Ta bort</button>
        </div>
      </header>
      {error && <p className="card error">{error}</p>}
      <section className="card">
        {editing ? (
          <CustomerForm
            initial={customer}
            onCancel={() => setEditing(false)}
            onSubmit={async (c) => {
              await api.updateCustomer(id, c);
              setEditing(false);
              await load();
            }}
          />
        ) : (
          <dl className="facts">
            <dt>Typ</dt><dd>{customer.customer_type === 'company' ? 'Företag' : 'Privatperson'}</dd>
            <dt>{customer.customer_type === 'company' ? 'Org.nr' : 'Personnr'}</dt><dd>{customer.identity_number ?? '–'}</dd>
            <dt>Telefon</dt><dd>{customer.phone ?? '–'}</dd>
            <dt>E-post</dt><dd>{customer.email ?? '–'}</dd>
            <dt>Adress</dt><dd>{[customer.street, [customer.postal_code, customer.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '–'}</dd>
            {customer.notes && (<><dt>Anteckningar</dt><dd>{customer.notes}</dd></>)}
          </dl>
        )}
      </section>
      <section className="card">
        <header className="section-head">
          <h2>Fordon</h2>
          <button onClick={() => setAddingVehicle(true)}>Lägg till fordon</button>
        </header>
        {addingVehicle && (
          <VehicleForm
            initial={{ customer_id: id }}
            onCancel={() => setAddingVehicle(false)}
            onSubmit={async (v) => {
              await api.createVehicle({ ...v, customer_id: id });
              setAddingVehicle(false);
              await load();
            }}
          />
        )}
        <table>
          <thead><tr><th>Regnummer</th><th>Fordon</th><th>År</th><th>Drivmedel</th><th>Mätare</th></tr></thead>
          <tbody>
            {customer.vehicles.map((v) => (
              <tr key={v.id}>
                <td><span className="plate-tag">{v.registration_number}</span></td>
                <td>{[v.make, v.model].filter(Boolean).join(' ')}</td>
                <td>{v.model_year}</td>
                <td>{v.fuel ? FUEL_LABELS[v.fuel] : ''}</td>
                <td>{v.mileage_km != null ? `${v.mileage_km.toLocaleString('sv-SE')} km` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {customer.vehicles.length === 0 && !addingVehicle && <p className="empty">Inga fordon kopplade ännu.</p>}
      </section>
    </>
  );
}
