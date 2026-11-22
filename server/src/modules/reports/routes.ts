import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { todayStockholm } from '../../lib/dates.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function reportRoutes(app: FastifyInstance) {
  const { db } = app;

  // Översikt för startsidan
  app.get('/api/dashboard', async () => {
    const today = todayStockholm();
    const [orders, bookings, overdue, lowStock] = await Promise.all([
      db.query<{ status: string; n: number }>(
        `SELECT status, count(*)::int AS n FROM work_orders WHERE status IN ('open', 'in_progress', 'done') GROUP BY status`,
      ),
      db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM bookings WHERE status IN ('booked', 'arrived')
         AND (starts_at AT TIME ZONE 'Europe/Stockholm')::date = $1`,
        [today],
      ),
      db.query<{ n: number; amount: number }>(
        `SELECT count(*)::int AS n, COALESCE(sum(total_amount), 0) AS amount FROM invoices
         WHERE status = 'unpaid' AND invoice_type = 'invoice' AND due_date < $1`,
        [today],
      ),
      db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM articles
         WHERE active AND track_stock AND reorder_level IS NOT NULL AND stock_quantity <= reorder_level`,
      ),
    ]);
    const byStatus = Object.fromEntries(orders.rows.map((r) => [r.status, r.n]));
    return {
      work_orders: { open: byStatus.open ?? 0, in_progress: byStatus.in_progress ?? 0, done: byStatus.done ?? 0 },
      bookings_today: bookings.rows[0].n,
      overdue_invoices: overdue.rows[0],
      low_stock_articles: lowStock.rows[0].n,
    };
  });

  // Försäljning per period: fakturor minus kreditfakturor
  app.get('/api/reports/sales', async (req) => {
    const q = z.object({ from: isoDate, to: isoDate }).parse(req.query);
    const totals = await db.query(
      `SELECT count(*) FILTER (WHERE invoice_type = 'invoice')::int AS invoice_count,
              COALESCE(sum(net_amount), 0) AS net_amount,
              COALESCE(sum(vat_amount), 0) AS vat_amount,
              COALESCE(sum(total_amount), 0) AS total_amount
       FROM invoices WHERE invoice_date BETWEEN $1 AND $2`,
      [q.from, q.to],
    );
    const byType = await db.query<{ line_type: string; net_amount: number; quantity: number }>(
      `SELECT l.line_type, COALESCE(sum(l.net_amount), 0) AS net_amount, COALESCE(sum(l.quantity), 0) AS quantity
       FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
       WHERE i.invoice_date BETWEEN $1 AND $2 GROUP BY l.line_type`,
      [q.from, q.to],
    );
    const byMechanic = await db.query(
      `SELECT COALESCE(m.name, 'Ingen mekaniker') AS mechanic, COALESCE(sum(l.quantity), 0) AS hours,
              COALESCE(sum(l.net_amount), 0) AS net_amount
       FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
       LEFT JOIN work_orders w ON w.id = i.work_order_id LEFT JOIN mechanics m ON m.id = w.mechanic_id
       WHERE i.invoice_date BETWEEN $1 AND $2 AND l.line_type = 'labor'
       GROUP BY 1 ORDER BY 3 DESC`,
      [q.from, q.to],
    );
    return { ...q, ...totals.rows[0], by_line_type: byType.rows, labor_by_mechanic: byMechanic.rows };
  });
}
