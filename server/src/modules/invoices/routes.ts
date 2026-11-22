import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTx, type Q } from '../../db.js';
import { addDays, todayStockholm } from '../../lib/dates.js';
import { conflict, notFound } from '../../lib/errors.js';
import { computeTotals, lineNet } from '../../lib/money.js';
import { idParam, pagination } from '../../lib/validation.js';
import { getSettings } from '../settings/routes.js';
import { lines as workOrderLines, lockOrder, setInvoiced } from '../work-orders/service.js';
import { renderDocumentPdf } from './pdf.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum ska vara ÅÅÅÅ-MM-DD');

interface InvoiceLine {
  id: number;
  line_type: string;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  discount_percent: number;
  vat_rate: number;
  net_amount: number;
  sort_order: number;
}

export async function getInvoice(q: Q, id: number) {
  const inv = (
    await q.query(
      `SELECT i.*, ci.invoice_number AS credited_invoice_number
       FROM invoices i LEFT JOIN invoices ci ON ci.id = i.credited_invoice_id WHERE i.id = $1`,
      [id],
    )
  ).rows[0];
  if (!inv) return undefined;
  const lines = (
    await q.query<InvoiceLine>('SELECT * FROM invoice_lines WHERE invoice_id = $1 ORDER BY sort_order, id', [id])
  ).rows;
  return { ...inv, lines, totals: computeTotals(lines) };
}

async function insertInvoice(
  q: Q,
  data: {
    invoice_type: 'invoice' | 'credit';
    credited_invoice_id?: number | null;
    work_order_id: number | null;
    customer_id: number;
    customer_name: string;
    customer_identity_number: string | null;
    customer_address: string | null;
    registration_number: string | null;
    mileage_km: number | null;
    invoice_date: string;
    due_date: string;
    status?: 'unpaid' | 'paid';
  },
  lines: Omit<InvoiceLine, 'id' | 'net_amount'>[],
) {
  const t = computeTotals(lines);
  const res = await q.query<{ id: number }>(
    `INSERT INTO invoices (invoice_type, credited_invoice_id, work_order_id, customer_id, customer_name,
       customer_identity_number, customer_address, registration_number, mileage_km, invoice_date, due_date, status,
       net_amount, vat_amount, rounding, total_amount)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
    [
      data.invoice_type,
      data.credited_invoice_id ?? null,
      data.work_order_id,
      data.customer_id,
      data.customer_name,
      data.customer_identity_number,
      data.customer_address,
      data.registration_number,
      data.mileage_km,
      data.invoice_date,
      data.due_date,
      data.status ?? 'unpaid',
      t.net_amount,
      t.vat_amount,
      t.rounding,
      t.total_amount,
    ],
  );
  const id = res.rows[0].id;
  for (const l of lines) {
    await q.query(
      `INSERT INTO invoice_lines (invoice_id, line_type, description, quantity, unit, unit_price, discount_percent,
         vat_rate, net_amount, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, l.line_type, l.description, l.quantity, l.unit, l.unit_price, l.discount_percent, l.vat_rate, lineNet(l), l.sort_order],
    );
  }
  return id;
}

export async function invoiceRoutes(app: FastifyInstance) {
  const { db } = app;
  const load = async (id: number) => {
    const inv = await getInvoice(db, id);
    if (!inv) throw notFound('Fakturan');
    return inv;
  };

  app.get('/api/invoices', async (req) => {
    const q = pagination
      .extend({
        status: z.enum(['unpaid', 'paid', 'credited', 'overdue']).optional(),
        customer_id: z.coerce.number().int().positive().optional(),
        from: isoDate.optional(),
        to: isoDate.optional(),
      })
      .parse(req.query);
    const params: unknown[] = [];
    const conds: string[] = [];
    if (q.search) {
      params.push(`%${q.search.toLowerCase()}%`);
      conds.push(`(lower(customer_name) LIKE $1 OR lower(registration_number) LIKE $1 OR invoice_number::text LIKE $1)`);
    }
    if (q.status === 'overdue') {
      params.push(todayStockholm());
      conds.push(`status = 'unpaid' AND invoice_type = 'invoice' AND due_date < $${params.length}`);
    } else if (q.status) {
      params.push(q.status);
      conds.push(`status = $${params.length}`);
    }
    if (q.customer_id) {
      params.push(q.customer_id);
      conds.push(`customer_id = $${params.length}`);
    }
    if (q.from) {
      params.push(q.from);
      conds.push(`invoice_date >= $${params.length}`);
    }
    if (q.to) {
      params.push(q.to);
      conds.push(`invoice_date <= $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const total = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM invoices ${where}`, params)).rows[0].n;
    params.push(q.limit, q.offset);
    const rows = await db.query(
      `SELECT id, invoice_number, invoice_type, work_order_id, customer_id, customer_name, registration_number,
              invoice_date, due_date, status, paid_at, net_amount, vat_amount, total_amount
       FROM invoices ${where} ORDER BY invoice_number DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: rows.rows, total };
  });

  // Fakturera en arbetsorder
  app.post('/api/invoices', async (req, reply) => {
    const body = z
      .object({ work_order_id: z.number().int().positive(), invoice_date: isoDate.optional() })
      .strict()
      .parse(req.body);
    const id = await withTx(db, async (c) => {
      const wo = await lockOrder(c, body.work_order_id);
      if (wo.status === 'invoiced') throw conflict('Arbetsordern är redan fakturerad');
      if (wo.status === 'cancelled') throw conflict('Arbetsordern är makulerad');
      const lines = await workOrderLines.list(c, wo.id);
      if (!lines.length) throw conflict('Arbetsordern har inga rader att fakturera');
      const customer = (await c.query('SELECT * FROM customers WHERE id = $1', [wo.customer_id])).rows[0];
      const vehicle = (await c.query('SELECT registration_number FROM vehicles WHERE id = $1', [wo.vehicle_id])).rows[0];
      const settings = await getSettings(c);
      const invoiceDate = body.invoice_date ?? todayStockholm();
      const newId = await insertInvoice(
        c,
        {
          invoice_type: 'invoice',
          work_order_id: wo.id,
          customer_id: customer.id,
          customer_name: customer.name,
          customer_identity_number: customer.identity_number,
          customer_address:
            [customer.street, [customer.postal_code, customer.city].filter(Boolean).join(' ')].filter(Boolean).join('\n') || null,
          registration_number: vehicle.registration_number,
          mileage_km: wo.mileage_km,
          invoice_date: invoiceDate,
          due_date: addDays(invoiceDate, settings.payment_terms_days),
        },
        lines,
      );
      await setInvoiced(c, wo.id, true);
      return newId;
    });
    return reply.code(201).send(await load(id));
  });

  app.get('/api/invoices/:id', async (req) => load(idParam.parse(req.params).id));

  app.post('/api/invoices/:id/pay', async (req) => {
    const { id } = idParam.parse(req.params);
    const body = z.object({ paid_at: isoDate.optional() }).strict().parse(req.body ?? {});
    const res = await db.query(
      `UPDATE invoices SET status = 'paid', paid_at = $2 WHERE id = $1 AND status = 'unpaid' AND invoice_type = 'invoice'`,
      [id, body.paid_at ?? todayStockholm()],
    );
    if (!res.rowCount) {
      await load(id);
      throw conflict('Bara obetalda fakturor kan markeras som betalda');
    }
    return load(id);
  });

  // Kreditera: skapar kreditfaktura och öppnar arbetsordern igen
  app.post('/api/invoices/:id/credit', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const creditId = await withTx(db, async (c) => {
      const inv = (await c.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!inv) throw notFound('Fakturan');
      if (inv.invoice_type !== 'invoice') throw conflict('En kreditfaktura kan inte krediteras');
      if (inv.status === 'credited') throw conflict('Fakturan är redan krediterad');
      const lines = (await c.query<InvoiceLine>('SELECT * FROM invoice_lines WHERE invoice_id = $1 ORDER BY sort_order, id', [id]))
        .rows;
      const today = todayStockholm();
      const newId = await insertInvoice(
        c,
        {
          invoice_type: 'credit',
          credited_invoice_id: id,
          work_order_id: inv.work_order_id,
          customer_id: inv.customer_id,
          customer_name: inv.customer_name,
          customer_identity_number: inv.customer_identity_number,
          customer_address: inv.customer_address,
          registration_number: inv.registration_number,
          mileage_km: inv.mileage_km,
          invoice_date: today,
          due_date: today,
          status: 'paid',
        },
        lines.map((l) => ({ ...l, quantity: -l.quantity })),
      );
      await c.query(`UPDATE invoices SET status = 'credited' WHERE id = $1`, [id]);
      if (inv.work_order_id) await setInvoiced(c, inv.work_order_id, false);
      return newId;
    });
    return reply.code(201).send(await load(creditId));
  });

  app.get('/api/invoices/:id/pdf', async (req, reply) => {
    const inv = await load(idParam.parse(req.params).id);
    const pdf = await renderDocumentPdf({
      kind: inv.invoice_type,
      number: inv.invoice_number,
      date: inv.invoice_date,
      secondaryDate: inv.due_date,
      customer: { name: inv.customer_name, identity_number: inv.customer_identity_number, address: inv.customer_address },
      registration_number: inv.registration_number,
      mileage_km: inv.mileage_km,
      lines: inv.lines,
      totals: inv.totals,
      settings: await getSettings(db),
      creditedNumber: inv.credited_invoice_number,
    });
    return reply
      .type('application/pdf')
      .header('content-disposition', `inline; filename="faktura-${inv.invoice_number}.pdf"`)
      .send(pdf);
  });
}
