import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, FUEL_LABELS, get, post, type Customer, type Invoice, type Vehicle, type WorkOrder } from '../api';
import { Badge, Plate, useLoad } from '../components/common';
import { date, INVOICE_STATUS, kr, WO_STATUS } from '../format';
import { MessageHistory } from '../components/SmsButton';
import { TiresFor } from './Tires';
import { useAuth } from '../auth';
import { CustomerForm } from './CustomerForm';
import { VehicleForm } from './VehicleForm';

type Detail = Customer & { vehicles: Vehicle[] };

export function CustomerDetail({ id }: { id: number }) {
  const [customer, setCustomer] = useState<Detail | null>(null);
  const [editing, setEditing] = useState(false);
  const [addingVehicle, setAddingVehicle] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
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
        {editingVehicle && (
          <VehicleForm
            key={editingVehicle.id}
            initial={editingVehicle}
            onCancel={() => setEditingVehicle(null)}
            onSubmit={async (v) => {
              await api.updateVehicle(editingVehicle.id, v);
              setEditingVehicle(null);
              await load();
            }}
          />
        )}
        <table>
          <thead><tr><th>Regnummer</th><th>Fordon</th><th>År</th><th>Drivmedel</th><th>Mätare</th><th>Service / besiktning</th><th /></tr></thead>
          <tbody>
            {customer.vehicles.map((v) => (
              <tr key={v.id}>
                <td><span className="plate-tag">{v.registration_number}</span></td>
                <td>{[v.make, v.model].filter(Boolean).join(' ')}</td>
                <td>{v.model_year}</td>
                <td>{v.fuel ? FUEL_LABELS[v.fuel] : ''}</td>
                <td>{v.mileage_km != null ? `${v.mileage_km.toLocaleString('sv-SE')} km` : ''}</td>
                <td className="small">
                  {v.next_service_date && <div>Service {v.next_service_date}</div>}
                  {v.next_service_km != null && <div>Service vid {v.next_service_km.toLocaleString('sv-SE')} km</div>}
                  {v.inspection_due && <div>Besiktning {v.inspection_due}</div>}
                </td>
                <td className="num nowrap">
                  <button className="link" onClick={() => { setAddingVehicle(false); setEditingVehicle(v); }}>Ändra</button>{' '}
                  <button className="link" onClick={async () => {
                    const wo = await post<{ id: number }>('/api/work-orders', { vehicle_id: v.id, customer_id: id });
                    location.hash = `#/arbetsordrar/${wo.id}`;
                  }}>Ny arbetsorder</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {customer.vehicles.length === 0 && !addingVehicle && <p className="empty">Inga fordon kopplade ännu.</p>}
      </section>
      <TiresFor customerId={id} />
      <CustomerHistory customerId={id} />
      <MessageHistory customerId={id} />
    </>
  );
}

function CustomerHistory({ customerId }: { customerId: number }) {
  const { can } = useAuth();
  const { data: orders } = useLoad(() => get<{ items: WorkOrder[] }>(`/api/work-orders?customer_id=${customerId}&limit=20`), [customerId]);
  const { data: invoices } = useLoad(
    () => (can('admin', 'office') ? get<{ items: Invoice[] }>(`/api/invoices?customer_id=${customerId}&limit=20`) : Promise.resolve(null)),
    [customerId],
  );
  return (
    <div className="grid-2">
      <section className="card">
        <h2>Arbetsordrar</h2>
        {orders?.items.length === 0 && <p className="empty">Inga arbetsordrar.</p>}
        <table>
          <tbody>
            {orders?.items.map((w) => (
              <tr key={w.id} className="clickable" onClick={() => (location.hash = `#/arbetsordrar/${w.id}`)}>
                <td>#{w.id}</td>
                <td><Plate reg={w.registration_number} /></td>
                <td>{date(w.created_at)}</td>
                <td><Badge kind={w.status}>{WO_STATUS[w.status]}</Badge></td>
                <td className="num">{kr(w.net_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {invoices && <section className="card">
        <h2>Fakturor</h2>
        {invoices?.items.length === 0 && <p className="empty">Inga fakturor.</p>}
        <table>
          <tbody>
            {invoices?.items.map((i) => (
              <tr key={i.id} className="clickable" onClick={() => (location.hash = `#/fakturor/${i.id}`)}>
                <td>{i.invoice_number}</td>
                <td>{i.invoice_date}</td>
                <td><Badge kind={i.invoice_type === 'credit' ? 'credit' : i.status}>{i.invoice_type === 'credit' ? 'Kredit' : INVOICE_STATUS[i.status]}</Badge></td>
                <td className="num">{kr(i.total_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>}
    </div>
  );
}
