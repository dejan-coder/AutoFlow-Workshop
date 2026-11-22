import { useEffect, useState, type FormEvent } from 'react';
import { get, qs, type Article, type Line, type LineType, type Totals } from '../api';
import { kr, num } from '../format';
import { ErrorText, useAction } from './common';

export interface NewLine {
  line_type: LineType;
  article_id?: number;
  description?: string;
  quantity: number;
  unit_price?: number;
  discount_percent?: number;
}

const TYPE_LABEL: Record<LineType, string> = { labor: 'Arbete', article: 'Artikel', other: 'Övrigt' };

export function LinesEditor({
  lines,
  totals,
  editable,
  onAdd,
  onUpdate,
  onDelete,
}: {
  lines: Line[];
  totals: Totals;
  editable: boolean;
  onAdd?: (l: NewLine) => Promise<void>;
  onUpdate?: (id: number, changes: Partial<Line>) => Promise<void>;
  onDelete?: (id: number) => Promise<void>;
}) {
  const action = useAction();
  return (
    <>
      <table className="lines">
        <thead>
          <tr>
            <th>Typ</th>
            <th>Beskrivning</th>
            <th className="num">Antal</th>
            <th className="num">À-pris</th>
            <th className="num">Rabatt</th>
            <th className="num">Moms</th>
            <th className="num">Belopp</th>
            {editable && <th />}
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id}>
              <td>
                <span className={`line-type lt-${l.line_type}`}>{TYPE_LABEL[l.line_type]}</span>
              </td>
              <td>
                {l.description}
                {l.article_number && <span className="muted"> · {l.article_number}</span>}
              </td>
              <td className="num">
                {editable && onUpdate ? (
                  <input
                    className="qty-input"
                    defaultValue={l.quantity}
                    inputMode="decimal"
                    onBlur={(e) => {
                      const q = Number(e.target.value.replace(',', '.'));
                      if (q > 0 && q !== l.quantity) action.run(() => onUpdate(l.id, { quantity: q }));
                    }}
                  />
                ) : (
                  num(l.quantity)
                )}{' '}
                {l.unit}
              </td>
              <td className="num">{kr(l.unit_price)}</td>
              <td className="num">{l.discount_percent ? `${num(l.discount_percent)} %` : ''}</td>
              <td className="num">{num(l.vat_rate)} %</td>
              <td className="num">{kr(l.net_amount)}</td>
              {editable && (
                <td className="num">
                  {onDelete && (
                    <button type="button" className="icon" title="Ta bort rad" onClick={() => action.run(() => onDelete(l.id))}>
                      ×
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {lines.length === 0 && <p className="empty">Inga rader ännu.</p>}
      <ErrorText error={action.error} />
      {editable && onAdd && <AddLineForm onAdd={onAdd} />}
      <TotalsBox totals={totals} />
    </>
  );
}

export function TotalsBox({ totals }: { totals: Totals }) {
  return (
    <dl className="totals">
      <dt>Summa exkl. moms</dt>
      <dd>{kr(totals.net_amount)}</dd>
      {totals.vat_by_rate.map((r) => (
        <div key={r.vat_rate} className="totals-row">
          <dt>Moms {num(r.vat_rate)} %</dt>
          <dd>{kr(r.vat_amount)}</dd>
        </div>
      ))}
      {totals.rounding !== 0 && (
        <>
          <dt>Öresavrundning</dt>
          <dd>{kr(totals.rounding)}</dd>
        </>
      )}
      <dt className="grand">Att betala</dt>
      <dd className="grand">{kr(totals.total_amount)}</dd>
    </dl>
  );
}

function AddLineForm({ onAdd }: { onAdd: (l: NewLine) => Promise<void> }) {
  const [type, setType] = useState<LineType>('labor');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [price, setPrice] = useState('');
  const [discount, setDiscount] = useState('');
  const [article, setArticle] = useState<Article | null>(null);
  const [search, setSearch] = useState('');
  const [hits, setHits] = useState<Article[]>([]);
  const action = useAction();

  useEffect(() => {
    if (type !== 'article' || search.trim().length < 1) return setHits([]);
    const t = setTimeout(() => get<{ items: Article[] }>(`/api/articles?${qs({ search, limit: 8 })}`).then((r) => setHits(r.items)), 200);
    return () => clearTimeout(t);
  }, [search, type]);

  const toNum = (s: string) => (s.trim() === '' ? undefined : Number(s.replace(',', '.')));

  function submit(e: FormEvent) {
    e.preventDefault();
    action.run(async () => {
      if (type === 'article' && !article) throw new Error('Välj en artikel');
      await onAdd({
        line_type: type,
        article_id: article?.id,
        description: description.trim() || undefined,
        quantity: toNum(quantity) ?? 1,
        unit_price: toNum(price),
        discount_percent: toNum(discount),
      });
      setDescription('');
      setQuantity('1');
      setPrice('');
      setDiscount('');
      setArticle(null);
      setSearch('');
    });
  }

  return (
    <form className="add-line" onSubmit={submit}>
      <select value={type} onChange={(e) => setType(e.target.value as LineType)} aria-label="Radtyp">
        <option value="labor">Arbete</option>
        <option value="article">Artikel</option>
        <option value="other">Övrigt</option>
      </select>
      {type === 'article' ? (
        <div className="picker grow">
          {article ? (
            <button type="button" className="ghost chosen" onClick={() => setArticle(null)}>
              {article.article_number} · {article.name} ({num(article.stock_quantity)} {article.unit} i lager) ×
            </button>
          ) : (
            <input placeholder="Sök artikelnummer eller benämning" value={search} onChange={(e) => setSearch(e.target.value)} />
          )}
          {!article && hits.length > 0 && (
            <ul className="picker-list">
              {hits.map((a) => (
                <li key={a.id}>
                  <button type="button" className="picker-item" onClick={() => { setArticle(a); setHits([]); }}>
                    <strong>{a.article_number}</strong> {a.name}
                    <span className="muted"> · {kr(a.sale_price)} · {a.track_stock ? `${num(a.stock_quantity)} ${a.unit} i lager` : 'ej lagerförd'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <input
          className="grow"
          placeholder={type === 'labor' ? 'Beskrivning av arbetet' : 'Beskrivning'}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      )}
      <input className="small" aria-label="Antal" placeholder={type === 'labor' ? 'Timmar' : 'Antal'} value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="decimal" />
      <input className="small" aria-label="Pris" placeholder={type === 'labor' ? 'Timpris' : 'À-pris'} value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" />
      <input className="small" aria-label="Rabatt" placeholder="Rabatt %" value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" />
      <button type="submit" disabled={action.busy}>Lägg till</button>
      <ErrorText error={action.error} />
    </form>
  );
}
