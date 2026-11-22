import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Q } from '../../db.js';
import { notFound } from '../../lib/errors.js';
import { idParam, optionalText } from '../../lib/validation.js';

const account = z.string().trim().regex(/^\d{4}$/, 'Kontot ska vara fyra siffror');
export const ACCOUNT_FIELDS = [
  'acc_receivable', 'acc_bank', 'acc_sales_25', 'acc_sales_12', 'acc_sales_6', 'acc_sales_0',
  'acc_vat_25', 'acc_vat_12', 'acc_vat_6', 'acc_rounding',
] as const;

export const settingsUpdate = z
  .object({
    company_name: z.string().trim().min(1).max(200),
    org_number: optionalText,
    vat_number: optionalText,
    street: optionalText,
    postal_code: optionalText,
    city: optionalText,
    phone: optionalText,
    email: optionalText,
    bankgiro: optionalText,
    default_hourly_rate: z.number().min(0).max(100000),
    payment_terms_days: z.number().int().min(0).max(120),
    quote_valid_days: z.number().int().min(1).max(365),
    invoice_footer: z.string().max(2000).nullish(),
    sms_sender: z.string().trim().min(1).max(11),
    sms_booking_template: z.string().trim().min(1).max(612),
    sms_reminder_template: z.string().trim().min(1).max(612),
    sms_ready_template: z.string().trim().min(1).max(612),
    sms_service_template: z.string().trim().min(1).max(612),
    ...Object.fromEntries(ACCOUNT_FIELDS.map((f) => [f, account])),
  })
  .partial()
  .strict();

export interface Settings {
  company_name: string;
  org_number: string | null;
  vat_number: string | null;
  street: string | null;
  postal_code: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  bankgiro: string | null;
  default_hourly_rate: number;
  payment_terms_days: number;
  quote_valid_days: number;
  invoice_footer: string | null;
  sms_sender: string;
  sms_booking_template: string;
  sms_reminder_template: string;
  sms_ready_template: string;
  sms_service_template: string;
  acc_receivable: string;
  acc_bank: string;
  acc_sales_25: string;
  acc_sales_12: string;
  acc_sales_6: string;
  acc_sales_0: string;
  acc_vat_25: string;
  acc_vat_12: string;
  acc_vat_6: string;
  acc_rounding: string;
}

export async function getSettings(q: Q): Promise<Settings> {
  const { id: _id, ...s } = (await q.query('SELECT * FROM workshop_settings WHERE id = 1')).rows[0];
  return s;
}

const mechanicCreate = z.object({ name: z.string().trim().min(1).max(100), active: z.boolean().optional() }).strict();
const mechanicUpdate = mechanicCreate.partial().strict();

export async function settingsRoutes(app: FastifyInstance) {
  const { db } = app;

  app.get('/api/settings', async () => getSettings(db));

  app.put('/api/settings', async (req) => {
    const data = settingsUpdate.parse(req.body);
    const cols = (Object.keys(data) as (keyof typeof data)[]).filter((k) => data[k] !== undefined);
    if (cols.length) {
      await db.query(`UPDATE workshop_settings SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')} WHERE id = 1`, [
        ...cols.map((c) => data[c] ?? null),
      ]);
    }
    return getSettings(db);
  });

  app.get('/api/mechanics', async (req) => {
    const { include_inactive } = z.object({ include_inactive: z.coerce.boolean().optional() }).parse(req.query);
    const rows = await db.query(
      `SELECT id, name, active FROM mechanics ${include_inactive ? '' : 'WHERE active'} ORDER BY name`,
    );
    return { items: rows.rows, total: rows.rowCount };
  });

  app.post('/api/mechanics', async (req, reply) => {
    const m = mechanicCreate.parse(req.body);
    const res = await db.query('INSERT INTO mechanics (name, active) VALUES ($1, $2) RETURNING id, name, active', [
      m.name,
      m.active ?? true,
    ]);
    return reply.code(201).send(res.rows[0]);
  });

  app.patch('/api/mechanics/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const m = mechanicUpdate.parse(req.body);
    const res = await db.query(
      `UPDATE mechanics SET name = COALESCE($2, name), active = COALESCE($3, active) WHERE id = $1
       RETURNING id, name, active`,
      [id, m.name ?? null, m.active ?? null],
    );
    if (!res.rows[0]) throw notFound('Mekanikern');
    return res.rows[0];
  });
}
