import { useEffect, useState } from 'react';
import { del, get, patch, post, qs, type Quote, type Vehicle } from '../api';
import { Badge, ErrorText, Plate, StatusTabs, useAction, useLoad, VehiclePicker } from '../components/common';
import { LinesEditor } from '../components/LinesEditor';
import { date, kr, QUOTE_STATUS } from '../format';

type Filter = '' | 'draft' | 'sent' | 'accepted' | 'rejected';

export function Quotes() {
  const [filter, setFilter] = useState<Filter>('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 200);
    return () => clearTimeout(t);
  }, [search]);
  const { data } = useLoad(
    () => get<{ items: Quote[]; total: number }>(`/api/quotes?${qs({ status: filter || undefined, search: debounced })}`),
    [filter, debounced],
  );
  return (
    <>
      <header className="page-head">
        <h1>Offerter</h1>
        <button onClick={() => setCreating(true)}>Ny offert</button>
      </header>
      {creating && <NewQuote onCancel={() => setCreating(false)} />}
      <section className="card">
        <div className="toolbar">
          <StatusTabs value={filter} onChange={setFilter} options={[['', 'Alla'], ['draft', 'Utkast'], ['sent', 'Skickade'], ['accepted', 'Godkända'], ['rejected', 'Nekade']]} />
          <input className="search grow" placeholder="Sök kund, regnummer eller beskrivning" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <table>
          <thead><tr><th>Nr</th><th>Kund</th><th>Regnummer</th><th>Beskrivning</th><th>Giltig till</th><th>Status</th><th className="num">Belopp exkl. moms</th></tr></thead>
          <tbody>
            {data?.items.map((q) => (
              <tr key={q.id} className="clickable" onClick={() => (location.hash = `#/offerter/${q.id}`)}>
                <td>{q.id}</td>
                <td>{q.customer_name}</td>
                <td><Plate reg={q.registration_number} /></td>
                <td className="clip">{q.description}</td>
                <td>{q.valid_until}</td>
                <td><Badge kind={q.status}>{QUOTE_STATUS[q.status]}</Badge></td>
                <td className="num">{kr(q.net_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.items.length === 0 && <p className="empty">Inga offerter.</p>}
      </section>
    </>
  );
}

function NewQuote({ onCancel }: { onCancel: () => void }) {
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [description, setDescription] = useState('');
  const action = useAction();
  return (
    <section className="card">
      <h2>Ny offert</h2>
      {vehicle ? (
        <p><Plate reg={vehicle.registration_number} /> {vehicle.customer_name ?? <span className="error">Fordonet saknar ägare</span>} <button className="link" onClick={() => setVehicle(null)}>Byt</button></p>
      ) : (
        <VehiclePicker onSelect={setVehicle} autoFocus />
      )}
      <label className="field"><span>Vad offerten gäller</span><input value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <ErrorText error={action.error} />
      <div className="actions">
        <button className="ghost" onClick={onCancel}>Avbryt</button>
        <button disabled={!vehicle || action.busy} onClick={() => action.run(async () => {
          const q = await post<Quote>('/api/quotes', { vehicle_id: vehicle!.id, description: description || null });
          location.hash = `#/offerter/${q.id}`;
        })}>Skapa offert</button>
      </div>
    </section>
  );
}

export function QuoteDetail({ id }: { id: number }) {
  const { data: q, error, setData } = useLoad(() => get<Quote>(`/api/quotes/${id}`), [id]);
  const action = useAction();
  if (error) return <div className="card error">{error}</div>;
  if (!q) return <div className="card">Laddar…</div>;
  const editable = q.status !== 'accepted';
  const update = (body: object) => action.run(async () => setData(await patch<Quote>(`/api/quotes/${id}`, body)));

  return (
    <>
      <header className="page-head">
        <div>
          <a href="#/offerter" className="back">‹ Offerter</a>
          <h1>Offert {q.id} <Badge kind={q.status}>{QUOTE_STATUS[q.status]}</Badge></h1>
        </div>
        <div className="actions">
          <a className="button ghost" href={`/api/quotes/${id}/pdf`} target="_blank" rel="noreferrer">Visa PDF</a>
          {q.status === 'draft' && <button className="ghost" onClick={() => update({ status: 'sent' })}>Markera skickad</button>}
          {editable && q.status !== 'rejected' && <button className="ghost" onClick={() => update({ status: 'rejected' })}>Kunden nekade</button>}
          {editable && (
            <button disabled={!q.lines.length} onClick={() => action.run(async () => {
              const r = await post<{ work_order_id: number }>(`/api/quotes/${id}/accept`);
              location.hash = `#/arbetsordrar/${r.work_order_id}`;
            })}>Godkänd: skapa arbetsorder</button>
          )}
          {q.work_order_id && <a className="button ghost" href={`#/arbetsordrar/${q.work_order_id}`}>Arbetsorder {q.work_order_id}</a>}
          {editable && <button className="danger" onClick={() => confirm('Ta bort offerten?') && action.run(async () => { await del(`/api/quotes/${id}`); location.hash = '#/offerter'; })}>Ta bort</button>}
        </div>
      </header>
      <ErrorText error={action.error} />
      <section className="card">
        <dl className="facts">
          <dt>Kund</dt><dd><a href={`#/kunder/${q.customer_id}`}>{q.customer_name}</a></dd>
          <dt>Fordon</dt><dd><Plate reg={q.registration_number} /> {[q.make, q.model].filter(Boolean).join(' ')}</dd>
          <dt>Skapad</dt><dd>{date(q.created_at)}</dd>
          <dt>Giltig till</dt>
          <dd>{editable ? <input type="date" className="inline-input" defaultValue={q.valid_until} onBlur={(e) => e.target.value !== q.valid_until && update({ valid_until: e.target.value })} /> : q.valid_until}</dd>
          <dt>Beskrivning</dt>
          <dd>{editable ? <input className="inline-input wide" defaultValue={q.description ?? ''} onBlur={(e) => e.target.value !== (q.description ?? '') && update({ description: e.target.value })} /> : q.description}</dd>
        </dl>
      </section>
      <section className="card">
        <h2>Rader</h2>
        <LinesEditor
          lines={q.lines}
          totals={q.totals}
          editable={editable}
          onAdd={async (l) => setData(await post<Quote>(`/api/quotes/${id}/lines`, l))}
          onUpdate={async (lineId, c) => setData(await patch<Quote>(`/api/quotes/${id}/lines/${lineId}`, c))}
          onDelete={async (lineId) => setData(await del(`/api/quotes/${id}/lines/${lineId}`).then(() => get<Quote>(`/api/quotes/${id}`)))}
        />
      </section>
    </>
  );
}
