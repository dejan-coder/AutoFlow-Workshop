import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTx, type Q } from '../../db.js';
import { AppError, conflict, notFound } from '../../lib/errors.js';
import { idParam } from '../../lib/validation.js';
import { createWorkOrder, getWorkOrder } from '../work-orders/service.js';

const STATUSES = ['booked', 'arrived', 'cancelled', 'no_show'] as const;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum ska vara ÅÅÅÅ-MM-DD');

const base = {
  starts_at: z.string().datetime({ offset: true, message: 'Ogiltig starttid' }),
  duration_minutes: z.number().int().min(15).max(1440),
  mechanic_id: z.number().int().positive().nullish(),
  vehicle_id: z.number().int().positive().nullish(),
  customer_id: z.number().int().positive().nullish(),
  description: z.string().max(2000).nullish(),
};
const bookingCreate = z.object(base).strict();
const bookingUpdate = z
  .object({ ...base, status: z.enum(STATUSES) })
  .partial()
  .strict();
const FIELDS = [...Object.keys(base), 'status'] as (keyof z.infer<typeof bookingUpdate>)[];

const SELECT = `
  SELECT b.*, b.starts_at + make_interval(mins => b.duration_minutes) AS ends_at,
         m.name AS mechanic_name, v.registration_number, v.make, v.model, c.name AS customer_name, c.phone AS customer_phone
  FROM bookings b
  LEFT JOIN mechanics m ON m.id = b.mechanic_id
  LEFT JOIN vehicles v ON v.id = b.vehicle_id
  LEFT JOIN customers c ON c.id = b.customer_id`;

async function getBooking(q: Q, id: number) {
  return (await q.query(`${SELECT} WHERE b.id = $1`, [id])).rows[0];
}

/** En mekaniker kan inte ha två bokningar som överlappar. */
async function assertNoOverlap(q: Q, b: { id?: number; starts_at: string; duration_minutes: number; mechanic_id?: number | null }) {
  if (!b.mechanic_id) return;
  const clash = await q.query<{ id: number }>(
    `SELECT id FROM bookings
     WHERE mechanic_id = $1 AND status IN ('booked', 'arrived') AND ($4::bigint IS NULL OR id <> $4)
       AND starts_at < $2::timestamptz + make_interval(mins => $3)
       AND starts_at + make_interval(mins => duration_minutes) > $2::timestamptz
     LIMIT 1`,
    [b.mechanic_id, b.starts_at, b.duration_minutes, b.id ?? null],
  );
  if (clash.rowCount) throw conflict('Mekanikern är redan bokad den tiden');
}

/** Om fordon anges utan kund används fordonets ägare. */
async function fillCustomer(q: Q, data: { vehicle_id?: number | null; customer_id?: number | null }) {
  if (data.vehicle_id && data.customer_id === undefined) {
    const v = (await q.query<{ customer_id: number | null }>('SELECT customer_id FROM vehicles WHERE id = $1', [data.vehicle_id]))
      .rows[0];
    if (!v) throw notFound('Fordonet');
    data.customer_id = v.customer_id;
  }
}

export async function bookingRoutes(app: FastifyInstance) {
  const { db } = app;

  app.get('/api/bookings', async (req) => {
    const q = z
      .object({
        from: isoDate,
        to: isoDate,
        mechanic_id: z.coerce.number().int().positive().optional(),
        include_cancelled: z.coerce.boolean().optional(),
      })
      .parse(req.query);
    const params: unknown[] = [q.from, q.to];
    let extra = '';
    if (q.mechanic_id) {
      params.push(q.mechanic_id);
      extra += ` AND b.mechanic_id = $${params.length}`;
    }
    if (!q.include_cancelled) extra += ` AND b.status <> 'cancelled'`;
    const rows = await db.query(
      `${SELECT}
       WHERE b.starts_at >= ($1::date)::timestamp AT TIME ZONE 'Europe/Stockholm'
         AND b.starts_at < ($2::date + 1)::timestamp AT TIME ZONE 'Europe/Stockholm' ${extra}
       ORDER BY b.starts_at, b.id`,
      params,
    );
    return { items: rows.rows };
  });

  app.post('/api/bookings', async (req, reply) => {
    const data = bookingCreate.parse(req.body);
    const id = await withTx(db, async (c) => {
      await fillCustomer(c, data);
      await assertNoOverlap(c, data);
      const cols = (Object.keys(base) as (keyof typeof data)[]).filter((k) => data[k] !== undefined);
      const res = await c.query<{ id: number }>(
        `INSERT INTO bookings (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
        cols.map((k) => data[k] ?? null),
      );
      return res.rows[0].id;
    });
    return reply.code(201).send(await getBooking(db, id));
  });

  app.get('/api/bookings/:id', async (req) => {
    const b = await getBooking(db, idParam.parse(req.params).id);
    if (!b) throw notFound('Bokningen');
    return b;
  });

  app.patch('/api/bookings/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const data = bookingUpdate.parse(req.body);
    await withTx(db, async (c) => {
      const cur = (await c.query('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!cur) throw notFound('Bokningen');
      await fillCustomer(c, data);
      const merged = { ...cur, ...data, starts_at: data.starts_at ?? cur.starts_at.toISOString() };
      if (['booked', 'arrived'].includes(merged.status)) await assertNoOverlap(c, { ...merged, id });
      const cols = FIELDS.filter((k) => data[k] !== undefined);
      if (cols.length) {
        await c.query(
          `UPDATE bookings SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`,
          [id, ...cols.map((k) => data[k] ?? null)],
        );
      }
    });
    return getBooking(db, id);
  });

  app.delete('/api/bookings/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const res = await db.query('DELETE FROM bookings WHERE id = $1', [id]);
    if (!res.rowCount) throw notFound('Bokningen');
    return reply.code(204).send();
  });

  // Kunden har kommit: skapa arbetsorder från bokningen
  app.post('/api/bookings/:id/work-order', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const woId = await withTx(db, async (c) => {
      const b = (await c.query('SELECT * FROM bookings WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!b) throw notFound('Bokningen');
      if (b.work_order_id) throw conflict('Bokningen har redan en arbetsorder');
      if (b.status === 'cancelled') throw conflict('Bokningen är avbokad');
      if (!b.vehicle_id) {
        throw new AppError(400, 'validation_error', 'Bokningen saknar fordon', [{ field: 'vehicle_id', message: 'Fordon krävs' }]);
      }
      const newId = await createWorkOrder(c, {
        vehicle_id: b.vehicle_id,
        customer_id: b.customer_id ?? undefined,
        mechanic_id: b.mechanic_id,
        description: b.description,
      });
      await c.query(`UPDATE bookings SET work_order_id = $2, status = 'arrived', updated_at = now() WHERE id = $1`, [id, newId]);
      return newId;
    });
    return reply.code(201).send(await getWorkOrder(db, woId));
  });
}
