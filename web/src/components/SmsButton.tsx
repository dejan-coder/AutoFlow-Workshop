import { useState } from 'react';
import { post, type Message } from '../api';
import { useAction, useLoad } from './common';
import { get } from '../api';

/** Knapp som skickar ett SMS och visar resultatet. */
export function SmsButton({ label, url, body, className = 'ghost' }: { label: string; url: string; body?: object; className?: string }) {
  const action = useAction();
  const [result, setResult] = useState<Message | null>(null);
  return (
    <span className="sms-button">
      <button
        type="button"
        className={className}
        disabled={action.busy}
        onClick={() => action.run(async () => setResult(await post<Message>(url, body ?? {})))}
      >
        {label}
      </button>
      {result && <SmsResult m={result} />}
      {action.error && <span className="error small">{action.error}</span>}
    </span>
  );
}

export function SmsResult({ m }: { m: Message }) {
  if (m.status === 'sent') return <span className="ok small">Skickat till {m.to_phone}</span>;
  if (m.status === 'logged') return <span className="muted small" title={m.body}>Sparat (SMS-tjänst ej inställd)</span>;
  return <span className="error small">Misslyckades: {m.error}</span>;
}

const KIND: Record<string, string> = {
  manual: 'Meddelande',
  booking_confirmation: 'Bokningsbekräftelse',
  booking_reminder: 'Påminnelse',
  vehicle_ready: 'Bilen är klar',
  service_reminder: 'Servicepåminnelse',
};
const STATUS: Record<string, string> = { sent: 'Skickat', failed: 'Misslyckades', logged: 'Sparat' };

/** SMS-historik och fält för att skriva ett eget meddelande till kunden. */
export function MessageHistory({ customerId }: { customerId: number }) {
  const { data, reload } = useLoad(() => get<{ items: Message[] }>(`/api/messages?customer_id=${customerId}`), [customerId]);
  const [text, setText] = useState('');
  const action = useAction();
  return (
    <section className="card">
      <h2>SMS</h2>
      <form
        className="add-line"
        onSubmit={(e) => {
          e.preventDefault();
          action.run(async () => {
            await post('/api/messages', { customer_id: customerId, body: text });
            setText('');
            reload();
          });
        }}
      >
        <input className="grow" placeholder="Skriv ett SMS till kunden" value={text} onChange={(e) => setText(e.target.value)} maxLength={612} />
        <button type="submit" disabled={!text.trim() || action.busy}>Skicka</button>
        {action.error && <p className="error">{action.error}</p>}
      </form>
      {data?.items.length === 0 && <p className="empty">Inga SMS skickade.</p>}
      <ul className="plain">
        {data?.items.map((m) => (
          <li key={m.id} className="message">
            <div>
              <strong>{KIND[m.kind] ?? m.kind}</strong>{' '}
              <span className="muted small">
                {new Date(m.created_at).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' })} · {m.to_phone} · {STATUS[m.status]}
                {m.sent_by_name && ` · ${m.sent_by_name}`}
              </span>
            </div>
            <div className="message-body">{m.body}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
