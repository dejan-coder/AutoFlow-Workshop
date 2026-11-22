import { useEffect, useState, type FormEvent } from 'react';
import { get, patch, post, qs, type Article } from '../api';
import { ErrorText, useAction, useLoad } from '../components/common';
import { Field } from '../components/Field';
import { kr, num } from '../format';

export function Articles() {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Article | null>(null);
  const [stockFor, setStockFor] = useState<Article | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 200);
    return () => clearTimeout(t);
  }, [search]);
  const { data, reload } = useLoad(
    () => get<{ items: Article[]; total: number }>(`/api/articles?${qs({ search: debounced, low_stock: lowOnly ? 'true' : undefined, limit: 200 })}`),
    [debounced, lowOnly],
  );

  return (
    <>
      <header className="page-head">
        <h1>Artiklar och lager</h1>
        <button onClick={() => { setEditing(null); setCreating(true); }}>Ny artikel</button>
      </header>
      {(creating || editing) && (
        <section className="card">
          <h2>{editing ? `Ändra ${editing.article_number}` : 'Ny artikel'}</h2>
          <ArticleForm
            key={editing?.id ?? 'new'}
            initial={editing ?? undefined}
            onCancel={() => { setCreating(false); setEditing(null); }}
            onSaved={() => { setCreating(false); setEditing(null); reload(); }}
          />
        </section>
      )}
      {stockFor && <StockForm article={stockFor} onDone={() => { setStockFor(null); reload(); }} />}
      <section className="card">
        <div className="toolbar">
          <input className="search grow" placeholder="Sök artikelnummer, benämning eller leverantör" value={search} onChange={(e) => setSearch(e.target.value)} />
          <label className="check"><input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Bara under beställningspunkt</label>
        </div>
        <table>
          <thead>
            <tr><th>Art.nr</th><th>Benämning</th><th className="num">Inpris</th><th className="num">Utpris</th><th className="num">I lager</th><th>Plats</th><th>Leverantör</th><th /></tr>
          </thead>
          <tbody>
            {data?.items.map((a) => {
              const low = a.track_stock && a.reorder_level != null && a.stock_quantity <= a.reorder_level;
              return (
                <tr key={a.id}>
                  <td><strong>{a.article_number}</strong></td>
                  <td>{a.name}</td>
                  <td className="num">{kr(a.purchase_price)}</td>
                  <td className="num">{kr(a.sale_price)}</td>
                  <td className={`num${low ? ' warn' : ''}`}>{a.track_stock ? `${num(a.stock_quantity)} ${a.unit}` : <span className="muted">ej lagerförd</span>}</td>
                  <td>{a.location}</td>
                  <td>{a.supplier}</td>
                  <td className="num nowrap">
                    {a.track_stock && <button className="link" onClick={() => setStockFor(a)}>Lager</button>}{' '}
                    <button className="link" onClick={() => { setCreating(false); setEditing(a); }}>Ändra</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {data && data.items.length === 0 && <p className="empty">Inga artiklar.</p>}
        {data && <p className="muted">{data.total} artiklar</p>}
      </section>
    </>
  );
}

function ArticleForm({ initial, onCancel, onSaved }: { initial?: Article; onCancel: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Record<string, string>>(() => ({
    article_number: initial?.article_number ?? '',
    name: initial?.name ?? '',
    unit: initial?.unit ?? 'st',
    purchase_price: initial?.purchase_price?.toString() ?? '',
    sale_price: initial?.sale_price?.toString() ?? '',
    vat_rate: initial?.vat_rate?.toString() ?? '25',
    stock_quantity: '',
    reorder_level: initial?.reorder_level?.toString() ?? '',
    supplier: initial?.supplier ?? '',
    location: initial?.location ?? '',
    track_stock: initial ? String(initial.track_stock) : 'true',
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const action = useAction();
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const n = (s: string) => (s.trim() === '' ? undefined : Number(s.replace(',', '.')));

  function submit(e: FormEvent) {
    e.preventDefault();
    action.run(async () => {
      const body: Record<string, unknown> = {
        article_number: f.article_number,
        name: f.name,
        unit: f.unit || 'st',
        purchase_price: n(f.purchase_price) ?? 0,
        sale_price: n(f.sale_price) ?? 0,
        vat_rate: Number(f.vat_rate),
        reorder_level: n(f.reorder_level) ?? null,
        supplier: f.supplier,
        location: f.location,
        track_stock: f.track_stock === 'true',
      };
      if (!initial && n(f.stock_quantity)) body.stock_quantity = n(f.stock_quantity);
      try {
        if (initial) await patch(`/api/articles/${initial.id}`, body);
        else await post('/api/articles', body);
        onSaved();
      } catch (err) {
        if (err && typeof err === 'object' && 'fields' in err) setErrors((err as { fields: Record<string, string> }).fields);
        throw err;
      }
    });
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="row">
        <Field label="Artikelnummer" error={errors.article_number}><input value={f.article_number} onChange={set('article_number')} autoFocus /></Field>
        <Field label="Benämning" error={errors.name}><input value={f.name} onChange={set('name')} /></Field>
        <Field label="Enhet"><input value={f.unit} onChange={set('unit')} placeholder="st, l, m" /></Field>
      </div>
      <div className="row">
        <Field label="Inpris (exkl. moms)"><input value={f.purchase_price} onChange={set('purchase_price')} inputMode="decimal" /></Field>
        <Field label="Utpris (exkl. moms)"><input value={f.sale_price} onChange={set('sale_price')} inputMode="decimal" /></Field>
        <Field label="Moms">
          <select value={f.vat_rate} onChange={set('vat_rate')}>
            {['25', '12', '6', '0'].map((v) => <option key={v} value={v}>{v} %</option>)}
          </select>
        </Field>
      </div>
      <div className="row">
        <Field label="Lagerförs">
          <select value={f.track_stock} onChange={set('track_stock')}>
            <option value="true">Ja</option>
            <option value="false">Nej</option>
          </select>
        </Field>
        {!initial && <Field label="Startsaldo"><input value={f.stock_quantity} onChange={set('stock_quantity')} inputMode="decimal" /></Field>}
        <Field label="Beställningspunkt"><input value={f.reorder_level} onChange={set('reorder_level')} inputMode="decimal" /></Field>
        <Field label="Lagerplats"><input value={f.location} onChange={set('location')} /></Field>
        <Field label="Leverantör"><input value={f.supplier} onChange={set('supplier')} /></Field>
      </div>
      <ErrorText error={action.error} />
      <div className="actions">
        <button type="button" className="ghost" onClick={onCancel}>Avbryt</button>
        <button type="submit" disabled={action.busy}>Spara artikel</button>
      </div>
    </form>
  );
}

function StockForm({ article, onDone }: { article: Article; onDone: () => void }) {
  const [mode, setMode] = useState<'purchase' | 'count'>('purchase');
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const action = useAction();
  const { data: moves } = useLoad(
    () => get<{ items: { id: number; quantity: number; reason: string; work_order_id: number | null; note: string | null; created_at: string }[] }>(`/api/articles/${article.id}/movements`),
    [article.id],
  );
  const REASON: Record<string, string> = { purchase: 'Inleverans', adjustment: 'Justering', work_order: 'Arbetsorder', count: 'Inventering' };
  return (
    <section className="card">
      <header className="section-head">
        <h2>{article.article_number} · {article.name} · {num(article.stock_quantity)} {article.unit} i lager</h2>
        <button className="ghost" onClick={onDone}>Stäng</button>
      </header>
      <div className="add-line">
        <select value={mode} onChange={(e) => setMode(e.target.value as 'purchase' | 'count')}>
          <option value="purchase">Inleverans (lägg till)</option>
          <option value="count">Inventering (nytt saldo)</option>
        </select>
        <input className="small" placeholder={mode === 'purchase' ? 'Antal' : 'Räknat antal'} value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" />
        <input className="grow" placeholder="Notering, t.ex. följesedel" value={note} onChange={(e) => setNote(e.target.value)} />
        <button disabled={action.busy} onClick={() => action.run(async () => {
          const q = Number(value.replace(',', '.'));
          await post(`/api/articles/${article.id}/stock`, mode === 'purchase'
            ? { reason: 'purchase', quantity: q, note: note || null }
            : { reason: 'count', counted_quantity: q, note: note || null });
          onDone();
        })}>Spara</button>
      </div>
      <ErrorText error={action.error} />
      <table>
        <thead><tr><th>Datum</th><th>Händelse</th><th className="num">Antal</th><th>Notering</th></tr></thead>
        <tbody>
          {moves?.items.map((m) => (
            <tr key={m.id}>
              <td>{new Date(m.created_at).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' })}</td>
              <td>{REASON[m.reason]}{m.work_order_id && <> · <a href={`#/arbetsordrar/${m.work_order_id}`}>order {m.work_order_id}</a></>}</td>
              <td className="num">{m.quantity > 0 ? '+' : ''}{num(m.quantity)}</td>
              <td>{m.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
