import { useEffect, useState } from 'react';
import { del, get, patch, post, qs, type Mechanic, type Vehicle, type WorkOrder, type WorkOrderStatus } from '../api';
import { Badge, ErrorText, Plate, StatusTabs, useAction, useLoad, VehiclePicker } from '../components/common';
import { LinesEditor } from '../components/LinesEditor';
import { date, dateTime, kr, WO_STATUS } from '../format';

type Filter = 'active' | 'done' | 'invoiced' | 'all';
const FILTER_STATUS: Record<Filter, string | undefined> = {
  active: 'open,in_progress',
  done: 'done',
  invoiced: 'invoiced',
  all: undefined,
};

export function WorkOrders() {
  const [filter, setFilter] = useState<Filter>('active');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 200);
    return () => clearTimeout(t);
  }, [search]);
  const { data } = useLoad(
    () => get<{ items: WorkOrder[]; total: number }>(`/api/work-orders?${qs({ status: FILTER_STATUS[filter], search: debounced })}`),
    [filter, debounced],
  );

  return (
    <>
      <header className="page-head">
        <h1>Arbetsordrar</h1>
        <button onClick={() => setCreating(true)}>Ny arbetsorder</button>
      </header>
      {creating && <NewWorkOrder onCancel={() => setCreating(false)} />}
      <section className="card">
        <div className="toolbar">
          <StatusTabs
            value={filter}
            onChange={setFilter}
            options={[
              ['active', 'Pågående'],
              ['done', 'Klara att fakturera'],
              ['invoiced', 'Fakturerade'],
              ['all', 'Alla'],
            ]}
          />
          <input className="search grow" placeholder="Sök ordernummer, regnummer, kund eller beskrivning" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <table>
          <thead>
            <tr><th>Nr</th><th>Regnummer</th><th>Kund</th><th>Beskrivning</th><th>Mekaniker</th><th>Status</th><th>Skapad</th><th className="num">Belopp exkl. moms</th></tr>
          </thead>
          <tbody>
            {data?.items.map((w) => (
              <tr key={w.id} className="clickable" onClick={() => (location.hash = `#/arbetsordrar/${w.id}`)}>
                <td>{w.id}</td>
                <td><Plate reg={w.registration_number} /></td>
                <td>{w.customer_name}</td>
                <td className="clip">{w.description}</td>
                <td>{w.mechanic_name}</td>
                <td><Badge kind={w.status}>{WO_STATUS[w.status]}</Badge></td>
                <td>{date(w.created_at)}</td>
                <td className="num">{kr(w.net_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.items.length === 0 && <p className="empty">Inga arbetsordrar.</p>}
        {data && <p className="muted">{data.total} arbetsordrar</p>}
      </section>
    </>
  );
}

function NewWorkOrder({ onCancel }: { onCancel: () => void }) {
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [description, setDescription] = useState('');
  const [mileage, setMileage] = useState('');
  const action = useAction();
  return (
    <section className="card">
      <h2>Ny arbetsorder</h2>
      {vehicle ? (
        <p>
          <Plate reg={vehicle.registration_number} /> {[vehicle.make, vehicle.model].filter(Boolean).join(' ')} ·{' '}
          {vehicle.customer_name ?? <span className="error">Fordonet saknar ägare. Koppla det till en kund först.</span>}{' '}
          <button className="link" onClick={() => setVehicle(null)}>Byt fordon</button>
        </p>
      ) : (
        <VehiclePicker onSelect={setVehicle} autoFocus />
      )}
      <div className="form">
        <label className="field">
          <span>Kundens beskrivning / åtgärd</span>
          <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="field narrow">
          <span>Mätarställning (km)</span>
          <input value={mileage} onChange={(e) => setMileage(e.target.value)} inputMode="numeric" placeholder={vehicle?.mileage_km?.toString()} />
        </label>
      </div>
      <ErrorText error={action.error} />
      <div className="actions">
        <button className="ghost" onClick={onCancel}>Avbryt</button>
        <button
          disabled={!vehicle || action.busy}
          onClick={() =>
            action.run(async () => {
              const wo = await post<WorkOrder>('/api/work-orders', {
                vehicle_id: vehicle!.id,
                description: description || null,
                mileage_km: mileage ? Number(mileage) : null,
              });
              location.hash = `#/arbetsordrar/${wo.id}`;
            })
          }
        >
          Skapa arbetsorder
        </button>
      </div>
    </section>
  );
}

const NEXT: Partial<Record<WorkOrderStatus, [WorkOrderStatus, string][]>> = {
  open: [['in_progress', 'Påbörja']],
  in_progress: [['done', 'Markera klar']],
  done: [['in_progress', 'Öppna igen']],
};

export function WorkOrderDetail({ id }: { id: number }) {
  const { data: wo, error, setData } = useLoad(() => get<WorkOrder>(`/api/work-orders/${id}`), [id]);
  const { data: mechanics } = useLoad(() => get<{ items: Mechanic[] }>('/api/mechanics'), []);
  const action = useAction();

  if (error) return <div className="card error">{error}</div>;
  if (!wo) return <div className="card">Laddar…</div>;
  const editable = ['open', 'in_progress', 'done'].includes(wo.status);
  const update = (body: object) => action.run(async () => setData(await patch<WorkOrder>(`/api/work-orders/${id}`, body)));

  return (
    <>
      <header className="page-head">
        <div>
          <a href="#/arbetsordrar" className="back">‹ Arbetsordrar</a>
          <h1>
            Arbetsorder {wo.id} <Badge kind={wo.status}>{WO_STATUS[wo.status]}</Badge>
          </h1>
        </div>
        <div className="actions">
          {NEXT[wo.status]?.map(([s, label]) => (
            <button key={s} className={s === 'done' ? '' : 'ghost'} onClick={() => update({ status: s })}>{label}</button>
          ))}
          {wo.status === 'done' && (
            <button
              onClick={() =>
                action.run(async () => {
                  const inv = await post<{ id: number }>('/api/invoices', { work_order_id: id });
                  location.hash = `#/fakturor/${inv.id}`;
                })
              }
            >
              Fakturera
            </button>
          )}
          {wo.invoice && <a className="button ghost" href={`#/fakturor/${wo.invoice.id}`}>Faktura {wo.invoice.invoice_number}</a>}
          {editable && (
            <button className="danger" onClick={() => confirm('Makulera arbetsordern? Artiklar läggs tillbaka i lager.') && update({ status: 'cancelled' })}>
              Makulera
            </button>
          )}
          {wo.status === 'cancelled' && (
            <button className="danger" onClick={() => action.run(async () => { await del(`/api/work-orders/${id}`); location.hash = '#/arbetsordrar'; })}>
              Ta bort
            </button>
          )}
        </div>
      </header>
      <ErrorText error={action.error} />
      <div className="grid-2">
        <section className="card">
          <h2>Fordon och kund</h2>
          <dl className="facts">
            <dt>Fordon</dt>
            <dd><Plate reg={wo.registration_number} /> {[wo.make, wo.model].filter(Boolean).join(' ')}</dd>
            <dt>Kund</dt>
            <dd><a href={`#/kunder/${wo.customer_id}`}>{wo.customer_name}</a></dd>
            <dt>Skapad</dt>
            <dd>{dateTime(wo.created_at)}</dd>
            {wo.completed_at && (<><dt>Klar</dt><dd>{dateTime(wo.completed_at)}</dd></>)}
          </dl>
        </section>
        <section className="card">
          <h2>Uppgifter</h2>
          <div className="form compact">
            <label className="field">
              <span>Mekaniker</span>
              <select disabled={!editable} value={wo.mechanic_id ?? ''} onChange={(e) => update({ mechanic_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Ingen vald</option>
                {mechanics?.items.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Mätarställning (km)</span>
              <input disabled={!editable} defaultValue={wo.mileage_km ?? ''} inputMode="numeric" onBlur={(e) => {
                const v = e.target.value ? Number(e.target.value) : null;
                if (v !== wo.mileage_km) update({ mileage_km: v });
              }} />
            </label>
          </div>
        </section>
      </div>
      <section className="card">
        <div className="form">
          <label className="field">
            <span>Kundens beskrivning / åtgärd</span>
            <textarea rows={2} disabled={!editable} defaultValue={wo.description ?? ''} onBlur={(e) => e.target.value !== (wo.description ?? '') && update({ description: e.target.value })} />
          </label>
          <label className="field">
            <span>Interna anteckningar (syns inte på faktura)</span>
            <textarea rows={2} disabled={!editable} defaultValue={wo.internal_notes ?? ''} onBlur={(e) => e.target.value !== (wo.internal_notes ?? '') && update({ internal_notes: e.target.value })} />
          </label>
        </div>
      </section>
      <section className="card">
        <h2>Arbete och artiklar</h2>
        <LinesEditor
          lines={wo.lines}
          totals={wo.totals}
          editable={editable}
          onAdd={async (l) => setData(await post<WorkOrder>(`/api/work-orders/${id}/lines`, l))}
          onUpdate={async (lineId, c) => setData(await patch<WorkOrder>(`/api/work-orders/${id}/lines/${lineId}`, c))}
          onDelete={async (lineId) => setData(await del(`/api/work-orders/${id}/lines/${lineId}`).then(() => get<WorkOrder>(`/api/work-orders/${id}`)))}
        />
      </section>
    </>
  );
}
