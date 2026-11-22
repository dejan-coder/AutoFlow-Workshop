import { useState } from 'react';
import { get, qs } from '../api';
import { useLoad } from '../components/common';
import { addDays, kr, today } from '../format';

interface Summary {
  invoice_count: number;
  invoiced_total: number;
  payment_count: number;
  paid_total: number;
}
interface Receivables {
  date: string;
  items: { id: number; invoice_number: number; customer_id: number; customer_name: string; invoice_date: string; due_date: string; total_amount: number; days_overdue: number }[];
  totals: { not_due: number; d1_30: number; d31_60: number; d60_plus: number; total: number };
}

function lastMonth() {
  const t = today();
  const firstThis = `${t.slice(0, 8)}01`;
  const lastPrev = addDays(firstThis, -1);
  return { from: `${lastPrev.slice(0, 8)}01`, to: lastPrev };
}

export function Accounting() {
  const [range, setRange] = useState(lastMonth());
  const { data: summary } = useLoad(() => get<Summary>(`/api/accounting/summary?${qs(range)}`), [range.from, range.to]);
  const { data: rec } = useLoad(() => get<Receivables>('/api/accounting/receivables'), []);

  return (
    <>
      <header className="page-head"><h1>Bokföring</h1></header>
      <section className="card">
        <h2>Export till bokföringsprogram (SIE 4)</h2>
        <p className="muted">
          Filen innehåller fakturor, kreditfakturor och inbetalningar som verifikationer och kan läsas in i bland annat Fortnox,
          Visma och Bokio. Kontona ställer du in under Inställningar.
        </p>
        <div className="toolbar">
          <label className="field"><span>Från</span><input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
          <label className="field"><span>Till</span><input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
          <button className="ghost" onClick={() => setRange(lastMonth())}>Förra månaden</button>
          <button className="ghost" onClick={() => setRange({ from: `${today().slice(0, 8)}01`, to: today() })}>Denna månad</button>
        </div>
        {summary && (
          <p>
            {summary.invoice_count} fakturor på totalt {kr(summary.invoiced_total)} och {summary.payment_count} inbetalningar på{' '}
            {kr(summary.paid_total)}.
          </p>
        )}
        <a className="button" href={`/api/accounting/sie?${qs(range)}`} download>Ladda ned SIE-fil</a>
      </section>

      <section className="card">
        <h2>Kundreskontra</h2>
        {rec && (
          <div className="stats">
            <div className="stat"><span>Ej förfallet</span><strong>{kr(rec.totals.not_due)}</strong></div>
            <div className="stat"><span>1–30 dagar</span><strong>{kr(rec.totals.d1_30)}</strong></div>
            <div className="stat"><span>31–60 dagar</span><strong className={rec.totals.d31_60 ? 'warn' : ''}>{kr(rec.totals.d31_60)}</strong></div>
            <div className="stat"><span>Över 60 dagar</span><strong className={rec.totals.d60_plus ? 'warn' : ''}>{kr(rec.totals.d60_plus)}</strong></div>
            <div className="stat"><span>Totalt obetalt</span><strong>{kr(rec.totals.total)}</strong></div>
          </div>
        )}
        <table>
          <thead><tr><th>Faktura</th><th>Kund</th><th>Fakturadatum</th><th>Förfaller</th><th className="num">Dagar sen</th><th className="num">Belopp</th></tr></thead>
          <tbody>
            {rec?.items.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => (location.hash = `#/fakturor/${r.id}`)}>
                <td>{r.invoice_number}</td>
                <td>{r.customer_name}</td>
                <td>{r.invoice_date}</td>
                <td>{r.due_date}</td>
                <td className={`num${r.days_overdue > 0 ? ' warn' : ''}`}>{r.days_overdue || ''}</td>
                <td className="num">{kr(r.total_amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rec?.items.length === 0 && <p className="empty">Inga obetalda fakturor.</p>}
      </section>
    </>
  );
}
