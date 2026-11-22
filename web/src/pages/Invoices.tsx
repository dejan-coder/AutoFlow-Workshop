import { useEffect, useState } from 'react';
import { get, post, qs, type Invoice } from '../api';
import { Badge, ErrorText, Plate, StatusTabs, useAction, useLoad } from '../components/common';
import { LinesEditor } from '../components/LinesEditor';
import { INVOICE_STATUS, kr, num, today } from '../format';

type Filter = '' | 'unpaid' | 'overdue' | 'paid' | 'credited';

function statusOf(i: Pick<Invoice, 'status' | 'invoice_type' | 'due_date'>) {
  if (i.invoice_type === 'credit') return { kind: 'credit', label: 'Kreditfaktura' };
  if (i.status === 'unpaid' && i.due_date < today()) return { kind: 'overdue', label: 'Förfallen' };
  return { kind: i.status, label: INVOICE_STATUS[i.status] };
}

export function Invoices() {
  const [filter, setFilter] = useState<Filter>('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 200);
    return () => clearTimeout(t);
  }, [search]);
  const { data } = useLoad(
    () => get<{ items: Invoice[]; total: number }>(`/api/invoices?${qs({ status: filter || undefined, search: debounced })}`),
    [filter, debounced],
  );
  return (
    <>
      <header className="page-head">
        <h1>Fakturor</h1>
      </header>
      <section className="card">
        <div className="toolbar">
          <StatusTabs value={filter} onChange={setFilter} options={[['', 'Alla'], ['unpaid', 'Obetalda'], ['overdue', 'Förfallna'], ['paid', 'Betalda'], ['credited', 'Krediterade']]} />
          <input className="search grow" placeholder="Sök fakturanummer, kund eller regnummer" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <table>
          <thead><tr><th>Nr</th><th>Kund</th><th>Regnummer</th><th>Datum</th><th>Förfaller</th><th>Status</th><th className="num">Att betala</th></tr></thead>
          <tbody>
            {data?.items.map((i) => {
              const s = statusOf(i);
              return (
                <tr key={i.id} className="clickable" onClick={() => (location.hash = `#/fakturor/${i.id}`)}>
                  <td>{i.invoice_number}</td>
                  <td>{i.customer_name}</td>
                  <td><Plate reg={i.registration_number} /></td>
                  <td>{i.invoice_date}</td>
                  <td>{i.due_date}</td>
                  <td><Badge kind={s.kind}>{s.label}</Badge></td>
                  <td className="num">{kr(i.total_amount)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {data && data.items.length === 0 && <p className="empty">Inga fakturor. Fakturor skapas från en klar arbetsorder.</p>}
      </section>
    </>
  );
}

export function InvoiceDetail({ id }: { id: number }) {
  const { data: inv, error, setData } = useLoad(() => get<Invoice>(`/api/invoices/${id}`), [id]);
  const action = useAction();
  if (error) return <div className="card error">{error}</div>;
  if (!inv) return <div className="card">Laddar…</div>;
  const s = statusOf(inv);
  const title = inv.invoice_type === 'credit' ? 'Kreditfaktura' : 'Faktura';

  return (
    <>
      <header className="page-head">
        <div>
          <a href="#/fakturor" className="back">‹ Fakturor</a>
          <h1>{title} {inv.invoice_number} <Badge kind={s.kind}>{s.label}</Badge></h1>
        </div>
        <div className="actions">
          <a className="button ghost" href={`/api/invoices/${id}/pdf`} target="_blank" rel="noreferrer">Visa PDF</a>
          {inv.status === 'unpaid' && inv.invoice_type === 'invoice' && (
            <button onClick={() => action.run(async () => setData(await post<Invoice>(`/api/invoices/${id}/pay`, {})))}>Markera betald</button>
          )}
          {inv.invoice_type === 'invoice' && inv.status !== 'credited' && (
            <button className="danger" onClick={() => confirm('Kreditera fakturan? Arbetsordern öppnas igen.') && action.run(async () => {
              const c = await post<Invoice>(`/api/invoices/${id}/credit`);
              location.hash = `#/fakturor/${c.id}`;
            })}>Kreditera</button>
          )}
        </div>
      </header>
      <ErrorText error={action.error} />
      <section className="card">
        <dl className="facts">
          <dt>Kund</dt><dd><a href={`#/kunder/${inv.customer_id}`}>{inv.customer_name}</a>{inv.customer_address && <div className="muted pre">{inv.customer_address}</div>}</dd>
          {inv.registration_number && (<><dt>Fordon</dt><dd><Plate reg={inv.registration_number} />{inv.mileage_km != null && <span className="muted"> · {num(inv.mileage_km)} km</span>}</dd></>)}
          <dt>Fakturadatum</dt><dd>{inv.invoice_date}</dd>
          <dt>Förfallodatum</dt><dd>{inv.due_date}</dd>
          {inv.paid_at && (<><dt>Betald</dt><dd>{inv.paid_at}</dd></>)}
          {inv.work_order_id && (<><dt>Arbetsorder</dt><dd><a href={`#/arbetsordrar/${inv.work_order_id}`}>{inv.work_order_id}</a></dd></>)}
          {inv.credited_invoice_id && (<><dt>Krediterar</dt><dd><a href={`#/fakturor/${inv.credited_invoice_id}`}>Faktura {inv.credited_invoice_number}</a></dd></>)}
        </dl>
      </section>
      <section className="card">
        <LinesEditor lines={inv.lines} totals={inv.totals} editable={false} />
      </section>
    </>
  );
}
