import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { todayStockholm } from '../../lib/dates.js';
import { getSettings } from '../settings/routes.js';
import { buildSie, toCp437, type SieInvoice, type SiePayment } from './sie.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum ska vara ÅÅÅÅ-MM-DD');

export async function accountingRoutes(app: FastifyInstance) {
  const { db } = app;

  async function collect(from: string, to: string) {
    const invoices = (
      await db.query<Omit<SieInvoice, 'lines'> & { id: number }>(
        `SELECT id, invoice_number, invoice_type, invoice_date, customer_name, rounding, total_amount
         FROM invoices WHERE invoice_date BETWEEN $1 AND $2 ORDER BY invoice_number`,
        [from, to],
      )
    ).rows;
    const lines = (
      await db.query<SieInvoice['lines'][number] & { invoice_id: number }>(
        `SELECT invoice_id, quantity, unit_price, discount_percent, vat_rate FROM invoice_lines
         WHERE invoice_id = ANY($1)`,
        [invoices.map((i) => i.id)],
      )
    ).rows;
    const withLines: SieInvoice[] = invoices.map((i) => ({ ...i, lines: lines.filter((l) => l.invoice_id === i.id) }));
    const payments = (
      await db.query<SiePayment>(
        `SELECT invoice_number, paid_at, customer_name, total_amount FROM invoices
         WHERE invoice_type = 'invoice' AND paid_at BETWEEN $1 AND $2 ORDER BY paid_at, invoice_number`,
        [from, to],
      )
    ).rows;
    return { invoices: withLines, payments };
  }

  // Bokföringsexport som SIE 4 (kan läsas in i t.ex. Fortnox, Visma och Bokio)
  app.get('/api/accounting/sie', async (req, reply) => {
    const { from, to } = z.object({ from: isoDate, to: isoDate }).parse(req.query);
    const data = await collect(from, to);
    const sie = buildSie({ settings: await getSettings(db), from, to, ...data });
    return reply
      .type('text/plain; charset=ibm437')
      .header('content-disposition', `attachment; filename="autoflow-${from}-${to}.se"`)
      .send(toCp437(sie));
  });

  // Förhandsvisning av vad exporten innehåller
  app.get('/api/accounting/summary', async (req) => {
    const { from, to } = z.object({ from: isoDate, to: isoDate }).parse(req.query);
    const { invoices, payments } = await collect(from, to);
    return {
      from,
      to,
      invoice_count: invoices.length,
      invoiced_total: invoices.reduce((s, i) => s + i.total_amount, 0),
      payment_count: payments.length,
      paid_total: payments.reduce((s, p) => s + p.total_amount, 0),
    };
  });

  // Kundreskontra: obetalda fakturor med åldersanalys
  app.get('/api/accounting/receivables', async () => {
    const today = todayStockholm();
    const rows = (
      await db.query<{
        id: number;
        invoice_number: number;
        customer_id: number;
        customer_name: string;
        invoice_date: string;
        due_date: string;
        total_amount: number;
        days_overdue: number;
      }>(
        `SELECT id, invoice_number, customer_id, customer_name, invoice_date, due_date, total_amount,
                GREATEST(0, $1::date - due_date) AS days_overdue
         FROM invoices WHERE invoice_type = 'invoice' AND status = 'unpaid' ORDER BY due_date, invoice_number`,
        [today],
      )
    ).rows;
    const bucket = (d: number) => (d === 0 ? 'not_due' : d <= 30 ? 'd1_30' : d <= 60 ? 'd31_60' : 'd60_plus');
    const totals = { not_due: 0, d1_30: 0, d31_60: 0, d60_plus: 0, total: 0 };
    for (const r of rows) {
      totals[bucket(r.days_overdue)] += r.total_amount;
      totals.total += r.total_amount;
    }
    return { date: today, items: rows, totals };
  });
}
