import { z } from 'zod';
import type { Q } from '../../db.js';
import { AppError, conflict, notFound } from '../../lib/errors.js';
import { lineStore, resolveLine, type LineCreate, type LineUpdate } from '../../lib/lines.js';
import { computeTotals } from '../../lib/money.js';
import { moveStock } from '../articles/routes.js';

export const STATUSES = ['open', 'in_progress', 'done', 'invoiced', 'cancelled'] as const;
export type Status = (typeof STATUSES)[number];

/** Tillåtna statusbyten som kan göras direkt. 'invoiced' sätts bara av fakturamodulen. */
const TRANSITIONS: Record<Status, Status[]> = {
  open: ['in_progress', 'done', 'cancelled'],
  in_progress: ['open', 'done', 'cancelled'],
  done: ['in_progress', 'cancelled'],
  invoiced: [],
  cancelled: [],
};
const EDITABLE: Status[] = ['open', 'in_progress', 'done'];

export const workOrderCreate = z
  .object({
    vehicle_id: z.number().int().positive(),
    customer_id: z.number().int().positive().optional(),
    mechanic_id: z.number().int().positive().nullish(),
    description: z.string().max(5000).nullish(),
    internal_notes: z.string().max(5000).nullish(),
    mileage_km: z.number().int().min(0).nullish(),
    promised_at: z.string().datetime({ offset: true }).nullish(),
  })
  .strict();

export const workOrderUpdate = z
  .object({
    status: z.enum(STATUSES).optional(),
    mechanic_id: z.number().int().positive().nullish(),
    description: z.string().max(5000).nullish(),
    internal_notes: z.string().max(5000).nullish(),
    mileage_km: z.number().int().min(0).nullish(),
    promised_at: z.string().datetime({ offset: true }).nullish(),
  })
  .strict();

export const lines = lineStore('work_order_lines', 'work_order_id');

const SELECT = `
  SELECT w.*, v.registration_number, v.make, v.model, c.name AS customer_name, m.name AS mechanic_name
  FROM work_orders w
  JOIN vehicles v ON v.id = w.vehicle_id
  JOIN customers c ON c.id = w.customer_id
  LEFT JOIN mechanics m ON m.id = w.mechanic_id`;

export interface WorkOrderRow {
  id: number;
  vehicle_id: number;
  customer_id: number;
  mechanic_id: number | null;
  status: Status;
  description: string | null;
  mileage_km: number | null;
  registration_number: string;
  customer_name: string;
}

async function lockOrder(q: Q, id: number) {
  const row = (await q.query<WorkOrderRow>('SELECT * FROM work_orders WHERE id = $1 FOR UPDATE', [id])).rows[0];
  if (!row) throw notFound('Arbetsordern');
  return row;
}

async function lockEditable(q: Q, id: number) {
  const row = await lockOrder(q, id);
  if (!EDITABLE.includes(row.status)) {
    throw conflict(row.status === 'invoiced' ? 'Arbetsordern är fakturerad och kan inte ändras' : 'Arbetsordern är makulerad');
  }
  return row;
}

export async function getWorkOrder(q: Q, id: number) {
  const row = (await q.query(`${SELECT} WHERE w.id = $1`, [id])).rows[0];
  if (!row) return undefined;
  const items = await lines.list(q, id);
  const invoice = (
    await q.query(
      `SELECT id, invoice_number, status FROM invoices
       WHERE work_order_id = $1 AND invoice_type = 'invoice' ORDER BY id DESC LIMIT 1`,
      [id],
    )
  ).rows[0];
  return { ...row, lines: items, totals: computeTotals(items), invoice: invoice ?? null };
}

export async function listWorkOrders(
  q: Q,
  opts: { search?: string; status?: Status[]; vehicle_id?: number; customer_id?: number; limit: number; offset: number },
) {
  const params: unknown[] = [];
  const conds: string[] = [];
  if (opts.search) {
    params.push(`%${opts.search.toLowerCase().replace(/[\s-]/g, '')}%`, `%${opts.search.toLowerCase()}%`);
    conds.push(`(lower(v.registration_number) LIKE $${params.length - 1} OR lower(c.name) LIKE $${params.length}
                 OR lower(w.description) LIKE $${params.length} OR w.id::text = $${params.length + 1})`);
    params.push(opts.search.trim());
  }
  if (opts.status?.length) {
    params.push(opts.status);
    conds.push(`w.status = ANY($${params.length})`);
  }
  if (opts.vehicle_id) {
    params.push(opts.vehicle_id);
    conds.push(`w.vehicle_id = $${params.length}`);
  }
  if (opts.customer_id) {
    params.push(opts.customer_id);
    conds.push(`w.customer_id = $${params.length}`);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const from = `FROM work_orders w JOIN vehicles v ON v.id = w.vehicle_id JOIN customers c ON c.id = w.customer_id`;
  const total = (await q.query<{ n: number }>(`SELECT count(*)::int AS n ${from} ${where}`, params)).rows[0].n;
  params.push(opts.limit, opts.offset);
  const rows = await q.query(
    `SELECT w.id, w.status, w.description, w.created_at, w.promised_at, w.completed_at, w.vehicle_id, w.customer_id,
            v.registration_number, v.make, v.model, c.name AS customer_name, m.name AS mechanic_name,
            COALESCE((SELECT sum(round(l.quantity * l.unit_price * (1 - l.discount_percent / 100), 2))
                      FROM work_order_lines l WHERE l.work_order_id = w.id), 0) AS net_amount
     ${from} LEFT JOIN mechanics m ON m.id = w.mechanic_id
     ${where} ORDER BY w.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items: rows.rows, total };
}

export async function createWorkOrder(q: Q, data: z.infer<typeof workOrderCreate>): Promise<number> {
  const vehicle = (
    await q.query<{ customer_id: number | null; mileage_km: number | null }>(
      'SELECT customer_id, mileage_km FROM vehicles WHERE id = $1',
      [data.vehicle_id],
    )
  ).rows[0];
  if (!vehicle) throw notFound('Fordonet');
  const customerId = data.customer_id ?? vehicle.customer_id;
  if (!customerId) {
    throw new AppError(400, 'validation_error', 'Fordonet saknar ägare. Ange kund.', [
      { field: 'customer_id', message: 'Kund krävs' },
    ]);
  }
  const res = await q.query<{ id: number }>(
    `INSERT INTO work_orders (vehicle_id, customer_id, mechanic_id, description, internal_notes, mileage_km, promised_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      data.vehicle_id,
      customerId,
      data.mechanic_id ?? null,
      data.description ?? null,
      data.internal_notes ?? null,
      data.mileage_km ?? null,
      data.promised_at ?? null,
    ],
  );
  if (data.mileage_km != null) await bumpMileage(q, data.vehicle_id, data.mileage_km);
  return res.rows[0].id;
}

async function bumpMileage(q: Q, vehicleId: number, km: number) {
  await q.query(
    `UPDATE vehicles SET mileage_km = $2, updated_at = now() WHERE id = $1 AND (mileage_km IS NULL OR mileage_km < $2)`,
    [vehicleId, km],
  );
}

export async function updateWorkOrder(q: Q, id: number, data: z.infer<typeof workOrderUpdate>) {
  const current = await lockOrder(q, id);
  const { status, ...fields } = data;
  const hasFieldChanges = Object.values(fields).some((v) => v !== undefined);
  if (hasFieldChanges && !EDITABLE.includes(current.status)) {
    throw conflict('Arbetsordern kan inte ändras i nuvarande status');
  }
  if (status && status !== current.status) {
    if (!TRANSITIONS[current.status].includes(status)) {
      throw conflict(`Kan inte byta status från ${current.status} till ${status}`);
    }
    if (status === 'cancelled') {
      for (const l of await lines.list(q, id)) {
        if (l.article_id) await moveStock(q, l.article_id, l.quantity, 'work_order', { workOrderId: id, note: 'Makulerad order' });
      }
    }
    await q.query(
      `UPDATE work_orders SET status = $2, completed_at = CASE WHEN $2 = 'done' THEN now() ELSE completed_at END,
       updated_at = now() WHERE id = $1`,
      [id, status],
    );
  }
  const cols = (Object.keys(fields) as (keyof typeof fields)[]).filter((k) => fields[k] !== undefined);
  if (cols.length) {
    await q.query(
      `UPDATE work_orders SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`,
      [id, ...cols.map((c) => fields[c] ?? null)],
    );
  }
  if (fields.mileage_km != null) await bumpMileage(q, current.vehicle_id, fields.mileage_km);
}

export async function deleteWorkOrder(q: Q, id: number) {
  const row = await lockOrder(q, id);
  if (row.status === 'invoiced') throw conflict('En fakturerad arbetsorder kan inte tas bort');
  const hasInvoice = (await q.query('SELECT 1 FROM invoices WHERE work_order_id = $1 LIMIT 1', [id])).rowCount;
  if (hasInvoice) throw conflict('Arbetsordern har fakturahistorik. Makulera den i stället.');
  if (row.status !== 'cancelled') {
    for (const l of await lines.list(q, id)) {
      if (l.article_id) await moveStock(q, l.article_id, l.quantity, 'work_order', { note: `Borttagen order ${id}` });
    }
  }
  await q.query('DELETE FROM work_orders WHERE id = $1', [id]);
}

export async function addLine(q: Q, workOrderId: number, input: LineCreate) {
  await lockEditable(q, workOrderId);
  const line = await resolveLine(q, input);
  const lineId = await lines.insert(q, workOrderId, line);
  if (line.article_id) await moveStock(q, line.article_id, -line.quantity, 'work_order', { workOrderId });
  return lineId;
}

export async function updateLine(q: Q, workOrderId: number, lineId: number, data: LineUpdate) {
  await lockEditable(q, workOrderId);
  const existing = await lines.get(q, workOrderId, lineId);
  if (!existing) throw notFound('Raden');
  await lines.update(q, lineId, data);
  if (existing.article_id && data.quantity !== undefined && data.quantity !== existing.quantity) {
    await moveStock(q, existing.article_id, existing.quantity - data.quantity, 'work_order', { workOrderId });
  }
}

export async function deleteLine(q: Q, workOrderId: number, lineId: number) {
  await lockEditable(q, workOrderId);
  const existing = await lines.get(q, workOrderId, lineId);
  if (!existing) throw notFound('Raden');
  await lines.delete(q, lineId);
  if (existing.article_id) await moveStock(q, existing.article_id, existing.quantity, 'work_order', { workOrderId });
}

/** Används av fakturamodulen. */
export async function setInvoiced(q: Q, id: number, invoiced: boolean) {
  await q.query(`UPDATE work_orders SET status = $2, updated_at = now() WHERE id = $1`, [id, invoiced ? 'invoiced' : 'done']);
}
export { lockOrder };
