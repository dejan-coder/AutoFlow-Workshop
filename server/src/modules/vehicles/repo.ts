import type { Db } from '../../db.js';
import { VEHICLE_FIELDS, type VehicleCreate, type VehicleUpdate } from './schemas.js';

export interface Vehicle {
  id: number;
  registration_number: string;
  customer_id: number | null;
  customer_name: string | null;
  make: string | null;
  model: string | null;
  model_year: number | null;
  vin: string | null;
  fuel: string | null;
  mileage_km: number | null;
  notes: string | null;
  next_service_date: string | null;
  next_service_km: number | null;
  inspection_due: string | null;
  created_at: string;
  updated_at: string;
}

const SELECT = `SELECT v.*, c.name AS customer_name FROM vehicles v LEFT JOIN customers c ON c.id = v.customer_id`;

export async function listVehicles(
  db: Db,
  opts: { search?: string; customerId?: number; limit: number; offset: number },
) {
  const params: unknown[] = [];
  const conds: string[] = [];
  if (opts.search) {
    params.push(`%${opts.search.toLowerCase().replace(/[\s-]/g, '')}%`);
    const p = `$${params.length}`;
    conds.push(`(lower(v.registration_number) LIKE ${p} OR lower(v.make) LIKE ${p} OR lower(v.model) LIKE ${p}
                 OR lower(v.vin) LIKE ${p} OR lower(c.name) LIKE ${p})`);
  }
  if (opts.customerId !== undefined) {
    params.push(opts.customerId);
    conds.push(`v.customer_id = $${params.length}`);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const total = await db.query<{ count: string }>(
    `SELECT count(*) FROM vehicles v LEFT JOIN customers c ON c.id = v.customer_id ${where}`,
    params,
  );
  params.push(opts.limit, opts.offset);
  const rows = await db.query<Vehicle>(
    `${SELECT} ${where} ORDER BY v.registration_number LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items: rows.rows, total: Number(total.rows[0].count) };
}

export async function getVehicle(db: Db, id: number) {
  return (await db.query<Vehicle>(`${SELECT} WHERE v.id = $1`, [id])).rows[0];
}

export async function getVehicleByRegistration(db: Db, reg: string) {
  return (await db.query<Vehicle>(`${SELECT} WHERE v.registration_number = $1`, [reg])).rows[0];
}

export async function createVehicle(db: Db, data: VehicleCreate) {
  const cols = VEHICLE_FIELDS.filter((f) => data[f] !== undefined);
  const res = await db.query<{ id: number }>(
    `INSERT INTO vehicles (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    cols.map((c) => data[c] ?? null),
  );
  return (await getVehicle(db, res.rows[0].id))!;
}

export async function updateVehicle(db: Db, id: number, data: VehicleUpdate) {
  const cols = VEHICLE_FIELDS.filter((f) => data[f] !== undefined);
  if (cols.length > 0) {
    const res = await db.query(
      `UPDATE vehicles SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`,
      [id, ...cols.map((c) => data[c] ?? null)],
    );
    if (res.rowCount === 0) return undefined;
  }
  return getVehicle(db, id);
}

export async function deleteVehicle(db: Db, id: number) {
  const res = await db.query('DELETE FROM vehicles WHERE id = $1', [id]);
  return (res.rowCount ?? 0) > 0;
}
