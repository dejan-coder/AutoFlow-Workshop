import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { todayStockholm, addDays } from '../../lib/dates.js';
import { AppError, conflict, notFound } from '../../lib/errors.js';
import { idParam, optionalText, pagination } from '../../lib/validation.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum ska vara ÅÅÅÅ-MM-DD');
const base = {
  customer_id: z.number().int().positive().optional(),
  vehicle_id: z.number().int().positive().nullish(),
  location: z.string().trim().min(1, 'Ange hyllplats').max(30),
  season: z.enum(['summer', 'winter', 'all_season']),
  tire_size: optionalText,
  brand: optionalText,
  tread_depth_mm: z.number().min(0).max(20).nullish(),
  with_rims: z.boolean().optional(),
  quantity: z.number().int().min(1).max(10).optional(),
  stored_at: isoDate.optional(),
  notes: z.string().max(2000).nullish(),
};
const tireCreate = z.object(base).strict();
const tireUpdate = z.object({ ...base, retrieved_at: isoDate.nullish() }).partial().strict();
const FIELDS = [...Object.keys(base), 'retrieved_at'];

const SELECT = `SELECT t.*, c.name AS customer_name, c.phone AS customer_phone, v.registration_number
  FROM tire_storage t JOIN customers c ON c.id = t.customer_id LEFT JOIN vehicles v ON v.id = t.vehicle_id`;

export async function tireRoutes(app: FastifyInstance) {
  const { db } = app;
  const load = async (id: number) => {
    const row = (await db.query(`${SELECT} WHERE t.id = $1`, [id])).rows[0];
    if (!row) throw notFound('Däckförvaringen');
    return row;
  };

  app.get('/api/tire-storage', async (req) => {
    const q = pagination
      .extend({
        include_retrieved: z.coerce.boolean().optional(),
        vehicle_id: z.coerce.number().int().positive().optional(),
        customer_id: z.coerce.number().int().positive().optional(),
      })
      .parse(req.query);
    const params: unknown[] = [];
    const conds: string[] = [];
    if (!q.include_retrieved) conds.push('t.retrieved_at IS NULL');
    if (q.search) {
      params.push(`%${q.search.toLowerCase().replace(/[\s-]/g, '')}%`, `%${q.search.toLowerCase()}%`);
      conds.push(`(lower(v.registration_number) LIKE $${params.length - 1} OR lower(c.name) LIKE $${params.length}
                   OR lower(t.location) LIKE $${params.length} OR lower(t.brand) LIKE $${params.length})`);
    }
    if (q.vehicle_id) {
      params.push(q.vehicle_id);
      conds.push(`t.vehicle_id = $${params.length}`);
    }
    if (q.customer_id) {
      params.push(q.customer_id);
      conds.push(`t.customer_id = $${params.length}`);
    }
    params.push(q.limit, q.offset);
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const rows = await db.query(`${SELECT} ${where} ORDER BY t.location LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    return { items: rows.rows };
  });

  app.post('/api/tire-storage', async (req, reply) => {
    const d = tireCreate.parse(req.body);
    if (!d.customer_id && d.vehicle_id) {
      d.customer_id = (await db.query('SELECT customer_id FROM vehicles WHERE id = $1', [d.vehicle_id])).rows[0]?.customer_id;
    }
    if (!d.customer_id) throw new AppError(400, 'validation_error', 'Kund krävs', [{ field: 'customer_id', message: 'Kund krävs' }]);
    const cols = Object.keys(base).filter((k) => d[k as keyof typeof d] !== undefined);
    try {
      const res = await db.query<{ id: number }>(
        `INSERT INTO tire_storage (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
        cols.map((k) => d[k as keyof typeof d] ?? null),
      );
      return reply.code(201).send(await load(res.rows[0].id));
    } catch (err) {
      if ((err as { constraint?: string }).constraint === 'tire_storage_location_active') throw conflict('Hyllplatsen är redan upptagen');
      throw err;
    }
  });

  app.patch('/api/tire-storage/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const d = tireUpdate.parse(req.body);
    const cols = FIELDS.filter((k) => d[k as keyof typeof d] !== undefined);
    if (cols.length) {
      try {
        await db.query(`UPDATE tire_storage SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`, [
          id,
          ...cols.map((k) => d[k as keyof typeof d] ?? null),
        ]);
      } catch (err) {
        if ((err as { constraint?: string }).constraint === 'tire_storage_location_active') throw conflict('Hyllplatsen är redan upptagen');
        throw err;
      }
    }
    return load(id);
  });

  // Kunden hämtar sina däck
  app.post('/api/tire-storage/:id/retrieve', async (req) => {
    const { id } = idParam.parse(req.params);
    const res = await db.query('UPDATE tire_storage SET retrieved_at = $2 WHERE id = $1 AND retrieved_at IS NULL', [id, todayStockholm()]);
    if (!res.rowCount) {
      await load(id);
      throw conflict('Däcken är redan uthämtade');
    }
    return load(id);
  });
}

/** Fordon där service eller besiktning närmar sig. */
export async function serviceDueRoutes(app: FastifyInstance) {
  const { db } = app;
  app.get('/api/service-due', async (req) => {
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }).parse(req.query);
    const today = todayStockholm();
    const until = addDays(today, days);
    const rows = await db.query(
      `SELECT v.id, v.registration_number, v.make, v.model, v.next_service_date, v.next_service_km, v.mileage_km,
              v.inspection_due, v.service_reminder_sent_at, v.customer_id, c.name AS customer_name, c.phone AS customer_phone
       FROM vehicles v LEFT JOIN customers c ON c.id = v.customer_id
       WHERE (v.next_service_date IS NOT NULL AND v.next_service_date <= $1)
          OR (v.inspection_due IS NOT NULL AND v.inspection_due <= $1)
          OR (v.next_service_km IS NOT NULL AND v.mileage_km IS NOT NULL AND v.mileage_km >= v.next_service_km - 1000)
       ORDER BY LEAST(COALESCE(v.next_service_date, '9999-12-31'), COALESCE(v.inspection_due, '9999-12-31'))`,
      [until],
    );
    return { today, until, items: rows.rows };
  });
}
