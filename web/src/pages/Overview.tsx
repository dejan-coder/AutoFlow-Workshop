import { useState } from 'react';
import { get, put, post, patch, qs, type Booking, type Mechanic, type Settings, type WorkOrder } from '../api';
import { Badge, ErrorText, Plate, useAction, useLoad } from '../components/common';
import { Field } from '../components/Field';
import { addDays, kr, num, time, today, WO_STATUS } from '../format';

interface Dashboard {
  work_orders: { open: number; in_progress: number; done: number };
  bookings_today: number;
  overdue_invoices: { n: number; amount: number };
  low_stock_articles: number;
}

export function Overview() {
  const { data: d } = useLoad(() => get<Dashboard>('/api/dashboard'), []);
  const { data: bookings } = useLoad(() => get<{ items: Booking[] }>(`/api/bookings?${qs({ from: today(), to: today() })}`), []);
  const { data: orders } = useLoad(() => get<{ items: WorkOrder[] }>('/api/work-orders?status=open,in_progress,done&limit=10'), []);
  return (
    <>
      <header className="page-head"><h1>Översikt</h1></header>
      <div className="stats">
        <a className="stat card" href="#/tidbok"><span>Bokningar idag</span><strong>{d?.bookings_today ?? '–'}</strong></a>
        <a className="stat card" href="#/arbetsordrar"><span>Pågående ordrar</span><strong>{d ? d.work_orders.open + d.work_orders.in_progress : '–'}</strong></a>
        <a className="stat card" href="#/arbetsordrar"><span>Klara att fakturera</span><strong>{d?.work_orders.done ?? '–'}</strong></a>
        <a className="stat card" href="#/fakturor"><span>Förfallna fakturor</span><strong className={d?.overdue_invoices.n ? 'warn' : ''}>{d?.overdue_invoices.n ?? '–'}</strong>{d?.overdue_invoices.n ? <small>{kr(d.overdue_invoices.amount)}</small> : null}</a>
        <a className="stat card" href="#/lager"><span>Artiklar att beställa</span><strong className={d?.low_stock_articles ? 'warn' : ''}>{d?.low_stock_articles ?? '–'}</strong></a>
      </div>
      <div className="grid-2">
        <section className="card">
          <h2>Dagens bokningar</h2>
          {bookings?.items.length === 0 && <p className="empty">Inga bokningar idag.</p>}
          <ul className="plain">
            {bookings?.items.map((b) => (
              <li key={b.id}>
                <strong>{time(b.starts_at)}</strong> <Plate reg={b.registration_number} /> {b.customer_name} <span className="muted">{b.description} · {b.mechanic_name}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="card">
          <h2>Arbetsordrar i verkstaden</h2>
          {orders?.items.length === 0 && <p className="empty">Inga öppna arbetsordrar.</p>}
          <ul className="plain">
            {orders?.items.map((w) => (
              <li key={w.id}>
                <a href={`#/arbetsordrar/${w.id}`}>#{w.id}</a> <Plate reg={w.registration_number} /> {w.customer_name} <Badge kind={w.status}>{WO_STATUS[w.status]}</Badge>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}

interface Sales {
  invoice_count: number;
  net_amount: number;
  vat_amount: number;
  total_amount: number;
  by_line_type: { line_type: string; net_amount: number; quantity: number }[];
  labor_by_mechanic: { mechanic: string; hours: number; net_amount: number }[];
}

export function Reports() {
  const [from, setFrom] = useState(today().slice(0, 8) + '01');
  const [to, setTo] = useState(today());
  const { data } = useLoad(() => get<Sales>(`/api/reports/sales?${qs({ from, to })}`), [from, to]);
  const typeLabel: Record<string, string> = { labor: 'Arbete', article: 'Artiklar', other: 'Övrigt' };
  return (
    <>
      <header className="page-head">
        <h1>Rapporter</h1>
        <div className="actions">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Från" />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Till" />
          <button className="ghost" onClick={() => { setFrom(addDays(today(), -30)); setTo(today()); }}>Senaste 30 dagar</button>
        </div>
      </header>
      {data && (
        <>
          <div className="stats">
            <div className="stat card"><span>Fakturor</span><strong>{data.invoice_count}</strong></div>
            <div className="stat card"><span>Försäljning exkl. moms</span><strong>{kr(data.net_amount)}</strong></div>
            <div className="stat card"><span>Moms</span><strong>{kr(data.vat_amount)}</strong></div>
            <div className="stat card"><span>Totalt inkl. moms</span><strong>{kr(data.total_amount)}</strong></div>
          </div>
          <div className="grid-2">
            <section className="card">
              <h2>Fördelning</h2>
              <table>
                <thead><tr><th>Typ</th><th className="num">Belopp exkl. moms</th></tr></thead>
                <tbody>{data.by_line_type.map((r) => <tr key={r.line_type}><td>{typeLabel[r.line_type] ?? r.line_type}</td><td className="num">{kr(r.net_amount)}</td></tr>)}</tbody>
              </table>
            </section>
            <section className="card">
              <h2>Debiterade timmar per mekaniker</h2>
              <table>
                <thead><tr><th>Mekaniker</th><th className="num">Timmar</th><th className="num">Belopp</th></tr></thead>
                <tbody>{data.labor_by_mechanic.map((r) => <tr key={r.mechanic}><td>{r.mechanic}</td><td className="num">{num(r.hours)}</td><td className="num">{kr(r.net_amount)}</td></tr>)}</tbody>
              </table>
              {data.labor_by_mechanic.length === 0 && <p className="empty">Inga debiterade timmar under perioden.</p>}
            </section>
          </div>
          <p className="muted">Krediterade fakturor räknas av i summorna.</p>
        </>
      )}
    </>
  );
}

export function SettingsPage() {
  const { data: s, setData } = useLoad(() => get<Settings>('/api/settings'), []);
  const { data: mechanics, reload } = useLoad(() => get<{ items: Mechanic[] }>('/api/mechanics?include_inactive=true'), []);
  const [newMechanic, setNewMechanic] = useState('');
  const action = useAction();
  const mAction = useAction();
  if (!s) return <div className="card">Laddar…</div>;
  const text = (k: keyof Settings, label: string) => (
    <Field label={label}><input value={(s[k] as string | null) ?? ''} onChange={(e) => setData({ ...s, [k]: e.target.value })} /></Field>
  );
  const number = (k: keyof Settings, label: string) => (
    <Field label={label}><input value={String(s[k] ?? '')} inputMode="decimal" onChange={(e) => setData({ ...s, [k]: e.target.value as unknown as number })} /></Field>
  );
  return (
    <>
      <header className="page-head"><h1>Inställningar</h1></header>
      <section className="card">
        <h2>Verkstaden</h2>
        <p className="muted">Uppgifterna visas på offerter och fakturor.</p>
        <form className="form" onSubmit={(e) => {
          e.preventDefault();
          action.run(async () => setData(await put<Settings>('/api/settings', {
            ...s,
            default_hourly_rate: Number(String(s.default_hourly_rate).replace(',', '.')),
            payment_terms_days: Number(s.payment_terms_days),
            quote_valid_days: Number(s.quote_valid_days),
          })));
        }}>
          <div className="row">{text('company_name', 'Företagsnamn')}{text('org_number', 'Organisationsnummer')}{text('vat_number', 'Momsregistreringsnummer')}</div>
          <div className="row">{text('street', 'Gatuadress')}{text('postal_code', 'Postnummer')}{text('city', 'Ort')}</div>
          <div className="row">{text('phone', 'Telefon')}{text('email', 'E-post')}{text('bankgiro', 'Bankgiro')}</div>
          <div className="row">{number('default_hourly_rate', 'Timpris exkl. moms')}{number('payment_terms_days', 'Betalningsvillkor (dagar)')}{number('quote_valid_days', 'Offert giltig (dagar)')}</div>
          <Field label="Text längst ned på fakturan"><textarea rows={2} value={s.invoice_footer ?? ''} onChange={(e) => setData({ ...s, invoice_footer: e.target.value })} /></Field>
          <ErrorText error={action.error} />
          <div className="actions"><button type="submit" disabled={action.busy}>Spara inställningar</button></div>
        </form>
      </section>
      <section className="card">
        <h2>Mekaniker</h2>
        <ul className="plain">
          {mechanics?.items.map((m) => (
            <li key={m.id} className={m.active ? '' : 'muted'}>
              {m.name} {!m.active && '(inaktiv)'}{' '}
              <button className="link" onClick={() => mAction.run(async () => { await patch(`/api/mechanics/${m.id}`, { active: !m.active }); reload(); })}>
                {m.active ? 'Inaktivera' : 'Aktivera'}
              </button>
            </li>
          ))}
        </ul>
        <form className="add-line" onSubmit={(e) => {
          e.preventDefault();
          mAction.run(async () => { await post('/api/mechanics', { name: newMechanic }); setNewMechanic(''); reload(); });
        }}>
          <input className="grow" placeholder="Namn på mekaniker" value={newMechanic} onChange={(e) => setNewMechanic(e.target.value)} />
          <button type="submit" disabled={!newMechanic.trim()}>Lägg till</button>
        </form>
        <ErrorText error={mAction.error} />
      </section>
    </>
  );
}
