import type { Db } from '../../db.js';
import { CUSTOMER_FIELDS, type CustomerCreate, type CustomerUpdate } from './schemas.js';

export interface Customer extends Required<{ [K in keyof CustomerCreate]: CustomerCreate[K] | null }> {
  id: number;
  created_at: string;
  updated_at: string;
}

export async function listCustomers(db: Db, opts: { search?: string; limit: number; offset: number }) {
  const params: unknown[] = [];
  let where = '';
  if (opts.search) {
    params.push(`%${opts.search.toLowerCase()}%`);
    where = `WHERE lower(c.name) LIKE $1 OR c.phone LIKE $1 OR lower(c.email) LIKE $1
             OR c.identity_number LIKE $1
             OR EXISTS (SELECT 1 FROM vehicles v WHERE v.customer_id = c.id AND lower(v.registration_number) LIKE $1)`;
  }
  const total = await db.query<{ count: string }>(`SELECT count(*) FROM customers c ${where}`, params);
  params.push(opts.limit, opts.offset);
  const rows = await db.query<Customer>(
    `SELECT c.* FROM customers c ${where} ORDER BY c.name, c.id LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items: rows.rows, total: Number(total.rows[0].count) };
}

export async function getCustomer(db: Db, id: number): Promise<Customer | undefined> {
  return (await db.query<Customer>('SELECT * FROM customers WHERE id = $1', [id])).rows[0];
}

export async function createCustomer(db: Db, data: CustomerCreate): Promise<Customer> {
  const cols = CUSTOMER_FIELDS.filter((f) => data[f] !== undefined);
  const res = await db.query<Customer>(
    `INSERT INTO customers (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
    cols.map((c) => data[c] ?? null),
  );
  return res.rows[0];
}

export async function updateCustomer(db: Db, id: number, data: CustomerUpdate): Promise<Customer | undefined> {
  const cols = CUSTOMER_FIELDS.filter((f) => data[f] !== undefined);
  if (cols.length === 0) return getCustomer(db, id);
  const res = await db.query<Customer>(
    `UPDATE customers SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, ...cols.map((c) => data[c] ?? null)],
  );
  return res.rows[0];
}

export async function deleteCustomer(db: Db, id: number): Promise<boolean> {
  const res = await db.query('DELETE FROM customers WHERE id = $1', [id]);
  return (res.rowCount ?? 0) > 0;
}
