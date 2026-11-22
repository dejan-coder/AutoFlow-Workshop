import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db, Q } from '../../db.js';
import { addDays, todayStockholm } from '../../lib/dates.js';
import { AppError, conflict, notFound } from '../../lib/errors.js';
import { idParam } from '../../lib/validation.js';
import { getSettings, type Settings } from '../settings/routes.js';
import { getWorkOrder } from '../work-orders/service.js';
import { fillTemplate, normalizePhone, smsProviderFromEnv, type SmsProvider } from './sms.js';

type Kind = 'manual' | 'booking_confirmation' | 'booking_reminder' | 'vehicle_ready' | 'service_reminder';

interface SendInput {
  kind: Kind;
  to: string | null | undefined;
  body: string;
  customer_id?: number | null;
  vehicle_id?: number | null;
  work_order_id?: number | null;
  booking_id?: number | null;
  sent_by?: number | null;
}

const fmtDate = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', day: 'numeric', month: 'long' }).format(d);
const fmtTime = (d: Date) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit' }).format(d);
const fmtKr = (n: number) => `${new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 }).format(n)} kr`;

export function messageService(db: Db, provider: SmsProvider) {
  async function send(q: Q, input: SendInput) {
    const to = normalizePhone(input.to);
    if (!to) {
      throw new AppError(400, 'validation_error', 'Kunden saknar ett giltigt mobilnummer', [{ field: 'to', message: 'Ogiltigt nummer' }]);
    }
    const settings = await getSettings(q);
    const result = await provider.send(to, input.body, settings.sms_sender);
    const res = await q.query(
      `INSERT INTO messages (kind, to_phone, body, status, provider, error, customer_id, vehicle_id, work_order_id, booking_id, sent_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [
        input.kind,
        to,
        input.body,
        result.status,
        result.provider,
        result.error ?? null,
        input.customer_id ?? null,
        input.vehicle_id ?? null,
        input.work_order_id ?? null,
        input.booking_id ?? null,
        input.sent_by ?? null,
      ],
    );
    return res.rows[0];
  }

  function common(s: Settings) {
    return { verkstad: s.company_name, telefon: s.phone ?? '' };
  }

  async function bookingMessage(bookingId: number, kind: 'booking_confirmation' | 'booking_reminder', sentBy?: number) {
    const b = (
      await db.query(
        `SELECT b.*, c.name AS customer_name, c.phone, v.registration_number FROM bookings b
         LEFT JOIN customers c ON c.id = b.customer_id LEFT JOIN vehicles v ON v.id = b.vehicle_id WHERE b.id = $1`,
        [bookingId],
      )
    ).rows[0];
    if (!b) throw notFound('Bokningen');
    if (b.status === 'cancelled') throw conflict('Bokningen är avbokad');
    const s = await getSettings(db);
    const body = fillTemplate(kind === 'booking_reminder' ? s.sms_reminder_template : s.sms_booking_template, {
      ...common(s),
      kund: b.customer_name?.split(' ')[0],
      regnr: b.registration_number,
      datum: fmtDate(b.starts_at),
      tid: fmtTime(b.starts_at),
    });
    const msg = await send(db, {
      kind,
      to: b.phone,
      body,
      customer_id: b.customer_id,
      vehicle_id: b.vehicle_id,
      booking_id: b.id,
      sent_by: sentBy,
    });
    if (kind === 'booking_reminder' && msg.status !== 'failed') {
      await db.query('UPDATE bookings SET reminder_sent_at = now() WHERE id = $1', [bookingId]);
    }
    return msg;
  }

  return {
    send,
    bookingMessage,

    async vehicleReady(workOrderId: number, sentBy?: number) {
      const wo = await getWorkOrder(db, workOrderId);
      if (!wo) throw notFound('Arbetsordern');
      const customer = (await db.query('SELECT name, phone FROM customers WHERE id = $1', [wo.customer_id])).rows[0];
      const s = await getSettings(db);
      const body = fillTemplate(s.sms_ready_template, {
        ...common(s),
        kund: customer.name.split(' ')[0],
        regnr: wo.registration_number,
        belopp: fmtKr(wo.totals.total_amount),
      });
      return send(db, {
        kind: 'vehicle_ready',
        to: customer.phone,
        body,
        customer_id: wo.customer_id,
        vehicle_id: wo.vehicle_id,
        work_order_id: wo.id,
        sent_by: sentBy,
      });
    },

    /** Skickar påminnelse till alla aktiva bokningar i morgon som inte redan fått en. */
    async sendTomorrowReminders(sentBy?: number) {
      const tomorrow = addDays(todayStockholm(), 1);
      const rows = (
        await db.query<{ id: number }>(
          `SELECT b.id FROM bookings b JOIN customers c ON c.id = b.customer_id
           WHERE b.status = 'booked' AND b.reminder_sent_at IS NULL AND c.phone IS NOT NULL
             AND (b.starts_at AT TIME ZONE 'Europe/Stockholm')::date = $1`,
          [tomorrow],
        )
      ).rows;
      const results = [];
      for (const r of rows) {
        try {
          results.push(await bookingMessage(r.id, 'booking_reminder', sentBy));
        } catch (err) {
          results.push({ booking_id: r.id, status: 'failed', error: (err as Error).message });
        }
      }
      return { date: tomorrow, count: results.length, results };
    },

    async serviceReminder(vehicleId: number, sentBy?: number) {
      const v = (
        await db.query(
          `SELECT v.*, c.name AS customer_name, c.phone FROM vehicles v JOIN customers c ON c.id = v.customer_id WHERE v.id = $1`,
          [vehicleId],
        )
      ).rows[0];
      if (!v) throw notFound('Fordonet eller dess ägare');
      const today = todayStockholm();
      const soon = addDays(today, 45);
      const what: string[] = [];
      if (v.next_service_date && v.next_service_date <= soon) what.push('service');
      if (v.inspection_due && v.inspection_due <= soon) what.push('besiktning');
      const s = await getSettings(db);
      const body = fillTemplate(s.sms_service_template, {
        ...common(s),
        kund: v.customer_name.split(' ')[0],
        regnr: v.registration_number,
        vad: what.length ? what.join(' och ') : 'service',
      });
      const msg = await send(db, { kind: 'service_reminder', to: v.phone, body, customer_id: v.customer_id, vehicle_id: v.id, sent_by: sentBy });
      if (msg.status !== 'failed') await db.query('UPDATE vehicles SET service_reminder_sent_at = now() WHERE id = $1', [vehicleId]);
      return msg;
    },
  };
}

export async function messageRoutes(app: FastifyInstance, opts: { provider?: SmsProvider }) {
  const { db } = app;
  const provider = opts.provider ?? smsProviderFromEnv();
  const svc = messageService(db, provider);

  app.get('/api/messages/status', async () => ({
    provider: provider.name,
    sends_for_real: provider.name !== 'log',
  }));

  app.get('/api/messages', async (req) => {
    const q = z
      .object({
        customer_id: z.coerce.number().int().positive().optional(),
        work_order_id: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(req.query);
    const params: unknown[] = [];
    const conds: string[] = [];
    if (q.customer_id) {
      params.push(q.customer_id);
      conds.push(`m.customer_id = $${params.length}`);
    }
    if (q.work_order_id) {
      params.push(q.work_order_id);
      conds.push(`m.work_order_id = $${params.length}`);
    }
    params.push(q.limit);
    const rows = await db.query(
      `SELECT m.*, c.name AS customer_name, u.name AS sent_by_name FROM messages m
       LEFT JOIN customers c ON c.id = m.customer_id LEFT JOIN users u ON u.id = m.sent_by
       ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''} ORDER BY m.id DESC LIMIT $${params.length}`,
      params,
    );
    return { items: rows.rows };
  });

  app.post('/api/messages', async (req, reply) => {
    const body = z
      .object({
        customer_id: z.number().int().positive().optional(),
        to: z.string().optional(),
        body: z.string().trim().min(1, 'Skriv ett meddelande').max(612),
      })
      .strict()
      .parse(req.body);
    let to = body.to;
    if (!to && body.customer_id) {
      to = (await db.query('SELECT phone FROM customers WHERE id = $1', [body.customer_id])).rows[0]?.phone;
    }
    const msg = await svc.send(db, { kind: 'manual', to, body: body.body, customer_id: body.customer_id, sent_by: req.user?.id });
    return reply.code(201).send(msg);
  });

  app.post('/api/work-orders/:id/notify-ready', async (req, reply) => {
    return reply.code(201).send(await svc.vehicleReady(idParam.parse(req.params).id, req.user?.id));
  });

  app.post('/api/bookings/:id/notify', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { kind } = z.object({ kind: z.enum(['confirmation', 'reminder']).default('confirmation') }).parse(req.body ?? {});
    const msg = await svc.bookingMessage(id, kind === 'reminder' ? 'booking_reminder' : 'booking_confirmation', req.user?.id);
    return reply.code(201).send(msg);
  });

  app.post('/api/messages/booking-reminders', async (req) => svc.sendTomorrowReminders(req.user?.id));

  app.post('/api/vehicles/:id/service-reminder', async (req, reply) => {
    return reply.code(201).send(await svc.serviceReminder(idParam.parse(req.params).id, req.user?.id));
  });
}
