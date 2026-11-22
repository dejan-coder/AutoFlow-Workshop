import type { InjectOptions } from 'fastify';
import { buildApp } from '../src/app.js';
import { createDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import type { SmsProvider } from '../src/modules/messages/sms.js';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://autoflow:autoflow@localhost:5432/autoflow_test';

/** SMS-leverantör som bara sparar det som skickas, för att testerna ska kunna kontrollera innehållet. */
export function fakeSms() {
  const sent: { to: string; body: string; sender: string }[] = [];
  const provider: SmsProvider = {
    name: 'test',
    async send(to, body, sender) {
      sent.push({ to, body, sender });
      return { status: 'sent', provider: 'test' };
    },
  };
  return { provider, sent };
}

export async function resetDb(db: ReturnType<typeof createDb>) {
  await db.query(
    `TRUNCATE messages, tire_storage, sessions, users, invoice_lines, invoices, quote_lines, quotes, bookings,
              stock_movements, work_order_lines, work_orders, articles, mechanics, vehicles, customers RESTART IDENTITY CASCADE`,
  );
  await db.query(`ALTER SEQUENCE invoice_number_seq RESTART WITH 1001`);
  await db.query(`UPDATE workshop_settings SET default_hourly_rate = 950, payment_terms_days = 30, quote_valid_days = 30`);
}

/**
 * Startar appen mot testdatabasen och loggar in som administratör.
 * app.inject skickar automatiskt med inloggningskakan (sätt headers.cookie = '' för att testa utan inloggning).
 */
export async function setup(opts: { login?: boolean } = {}) {
  const db = createDb(url);
  await migrate(db);
  await resetDb(db);
  const sms = fakeSms();
  const app = await buildApp(db, { smsProvider: sms.provider });
  let cookie = '';
  if (opts.login !== false) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { email: 'admin@test.se', name: 'Admin', password: 'hemligt123' },
    });
    cookie = `af_session=${res.cookies.find((c) => c.name === 'af_session')!.value}`;
  }
  const rawInject = app.inject.bind(app);
  const withCookie = (o: InjectOptions) => rawInject({ ...o, headers: { cookie, ...(o.headers ?? {}) } });
  (app as unknown as { inject: typeof withCookie }).inject = withCookie;
  return {
    app,
    db,
    sms,
    cookie,
    rawInject,
    close: async () => {
      await app.close();
      await db.end();
    },
  };
}
