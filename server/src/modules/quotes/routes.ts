import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTx, type Q } from '../../db.js';
import { AppError, conflict, notFound } from '../../lib/errors.js';
import { addDays, todayStockholm } from '../../lib/dates.js';
import { lineCreate, lineStore, lineUpdate, resolveLine } from '../../lib/lines.js';
import { computeTotals } from '../../lib/money.js';
import { idParam, pagination } from '../../lib/validation.js';
import { getSettings } from '../settings/routes.js';
import { addLine, createWorkOrder } from '../work-orders/service.js';
import { renderDocumentPdf } from '../invoices/pdf.js';

const STATUSES = ['draft', 'sent', 'accepted', 'rejected'] as const;
export const quoteLines = lineStore('quote_lines', 'quote_id');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum ska vara ÅÅÅÅ-MM-DD');

const quoteCreate = z
  .object({
    customer_id: z.number().int().positive().optional(),
    vehicle_id: z.number().int().positive().nullish(),
    description: z.string().max(5000).nullish(),
    valid_until: isoDate.optional(),
  })
  .strict();
const quoteUpdate = z
  .object({
    vehicle_id: z.number().int().positive().nullish(),
    description: z.string().max(5000).nullish(),
    valid_until: isoDate,
    status: z.enum(['draft', 'sent', 'rejected']),
  })
  .partial()
  .strict();

const SELECT = `
  SELECT q.*, c.name AS customer_name, v.registration_number, v.make, v.model
  FROM quotes q JOIN customers c ON c.id = q.customer_id LEFT JOIN vehicles v ON v.id = q.vehicle_id`;

export async function getQuote(q: Q, id: number) {
  const row = (await q.query(`${SELECT} WHERE q.id = $1`, [id])).rows[0];
  if (!row) return undefined;
  const lines = await quoteLines.list(q, id);
  return { ...row, lines, totals: computeTotals(lines) };
}

async function lockDraft(q: Q, id: number) {
  const row = (await q.query<{ status: string }>('SELECT * FROM quotes WHERE id = $1 FOR UPDATE', [id])).rows[0];
  if (!row) throw notFound('Offerten');
  if (row.status === 'accepted') throw conflict('Offerten är godkänd och kan inte ändras');
  return row;
}

export async function quoteRoutes(app: FastifyInstance) {
  const { db } = app;
  const load = async (id: number) => {
    const quote = await getQuote(db, id);
    if (!quote) throw notFound('Offerten');
    return quote;
  };

  app.get('/api/quotes', async (req) => {
    const q = pagination
      .extend({ status: z.enum(STATUSES).optional(), customer_id: z.coerce.number().int().positive().optional() })
      .parse(req.query);
    const params: unknown[] = [];
    const conds: string[] = [];
    if (q.search) {
      params.push(`%${q.search.toLowerCase()}%`);
      conds.push(`(lower(c.name) LIKE $1 OR lower(v.registration_number) LIKE $1 OR lower(q.description) LIKE $1)`);
    }
    if (q.status) {
      params.push(q.status);
      conds.push(`q.status = $${params.length}`);
    }
    if (q.customer_id) {
      params.push(q.customer_id);
      conds.push(`q.customer_id = $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const from = 'FROM quotes q JOIN customers c ON c.id = q.customer_id LEFT JOIN vehicles v ON v.id = q.vehicle_id';
    const total = (await db.query<{ n: number }>(`SELECT count(*)::int AS n ${from} ${where}`, params)).rows[0].n;
    params.push(q.limit, q.offset);
    const rows = await db.query(
      `SELECT q.id, q.status, q.description, q.valid_until, q.created_at, q.work_order_id, q.customer_id,
              c.name AS customer_name, v.registration_number,
              COALESCE((SELECT sum(round(l.quantity * l.unit_price * (1 - l.discount_percent / 100), 2))
                        FROM quote_lines l WHERE l.quote_id = q.id), 0) AS net_amount
       ${from} ${where} ORDER BY q.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: rows.rows, total };
  });

  app.post('/api/quotes', async (req, reply) => {
    const data = quoteCreate.parse(req.body);
    const id = await withTx(db, async (c) => {
      let customerId = data.customer_id;
      if (!customerId && data.vehicle_id) {
        customerId = (await c.query('SELECT customer_id FROM vehicles WHERE id = $1', [data.vehicle_id])).rows[0]?.customer_id;
      }
      if (!customerId) {
        throw new AppError(400, 'validation_error', 'Kund krävs', [{ field: 'customer_id', message: 'Kund krävs' }]);
      }
      const settings = await getSettings(c);
      const res = await c.query<{ id: number }>(
        `INSERT INTO quotes (customer_id, vehicle_id, description, valid_until) VALUES ($1, $2, $3, $4) RETURNING id`,
        [customerId, data.vehicle_id ?? null, data.description ?? null, data.valid_until ?? addDays(todayStockholm(), settings.quote_valid_days)],
      );
      return res.rows[0].id;
    });
    return reply.code(201).send(await load(id));
  });

  app.get('/api/quotes/:id', async (req) => load(idParam.parse(req.params).id));

  app.patch('/api/quotes/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const data = quoteUpdate.parse(req.body);
    await withTx(db, async (c) => {
      await lockDraft(c, id);
      const cols = (Object.keys(data) as (keyof typeof data)[]).filter((k) => data[k] !== undefined);
      if (cols.length) {
        await c.query(
          `UPDATE quotes SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`,
          [id, ...cols.map((k) => data[k] ?? null)],
        );
      }
    });
    return load(id);
  });

  app.delete('/api/quotes/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    await withTx(db, async (c) => {
      await lockDraft(c, id);
      await c.query('DELETE FROM quotes WHERE id = $1', [id]);
    });
    return reply.code(204).send();
  });

  app.post('/api/quotes/:id/lines', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const data = lineCreate.parse(req.body);
    await withTx(db, async (c) => {
      await lockDraft(c, id);
      await quoteLines.insert(c, id, await resolveLine(c, data));
    });
    return reply.code(201).send(await load(id));
  });

  app.patch('/api/quotes/:id/lines/:lineId', async (req) => {
    const { id, lineId } = z.object({ id: z.coerce.number(), lineId: z.coerce.number() }).parse(req.params);
    const data = lineUpdate.parse(req.body);
    await withTx(db, async (c) => {
      await lockDraft(c, id);
      if (!(await quoteLines.get(c, id, lineId))) throw notFound('Raden');
      await quoteLines.update(c, lineId, data);
    });
    return load(id);
  });

  app.delete('/api/quotes/:id/lines/:lineId', async (req) => {
    const { id, lineId } = z.object({ id: z.coerce.number(), lineId: z.coerce.number() }).parse(req.params);
    await withTx(db, async (c) => {
      await lockDraft(c, id);
      if (!(await quoteLines.get(c, id, lineId))) throw notFound('Raden');
      await quoteLines.delete(c, lineId);
    });
    return load(id);
  });

  // Kunden har godkänt: skapa arbetsorder med offertens rader
  app.post('/api/quotes/:id/accept', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const woId = await withTx(db, async (c) => {
      const quote = await lockDraft(c, id);
      const row = quote as unknown as { customer_id: number; vehicle_id: number | null; description: string | null };
      if (!row.vehicle_id) {
        throw new AppError(400, 'validation_error', 'Offerten saknar fordon', [{ field: 'vehicle_id', message: 'Fordon krävs' }]);
      }
      const newId = await createWorkOrder(c, {
        vehicle_id: row.vehicle_id,
        customer_id: row.customer_id,
        description: row.description,
      });
      for (const l of await quoteLines.list(c, id)) {
        await addLine(c, newId, {
          line_type: l.article_id ? 'article' : l.line_type === 'article' ? 'other' : l.line_type,
          article_id: l.article_id,
          description: l.description,
          quantity: l.quantity,
          unit: l.unit,
          unit_price: l.unit_price,
          discount_percent: l.discount_percent,
          vat_rate: l.vat_rate as 0 | 6 | 12 | 25,
          sort_order: l.sort_order,
        });
      }
      await c.query(`UPDATE quotes SET status = 'accepted', work_order_id = $2, updated_at = now() WHERE id = $1`, [id, newId]);
      return newId;
    });
    return reply.code(201).send({ work_order_id: woId, quote: await load(id) });
  });

  app.get('/api/quotes/:id/pdf', async (req, reply) => {
    const quote = await load(idParam.parse(req.params).id);
    const customer = (await db.query('SELECT * FROM customers WHERE id = $1', [quote.customer_id])).rows[0];
    const settings = await getSettings(db);
    const pdf = await renderDocumentPdf({
      kind: 'quote',
      number: quote.id,
      date: new Date(quote.created_at).toISOString().slice(0, 10),
      secondaryDate: quote.valid_until,
      customer: {
        name: customer.name,
        identity_number: customer.identity_number,
        address: [customer.street, [customer.postal_code, customer.city].filter(Boolean).join(' ')].filter(Boolean).join('\n'),
      },
      registration_number: quote.registration_number,
      description: quote.description,
      lines: quote.lines,
      totals: quote.totals,
      settings,
    });
    return reply.type('application/pdf').header('content-disposition', `inline; filename="offert-${quote.id}.pdf"`).send(pdf);
  });
}
