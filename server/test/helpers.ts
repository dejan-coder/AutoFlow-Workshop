import { buildApp } from '../src/app.js';
import { createDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://autoflow:autoflow@localhost:5432/autoflow_test';

export async function setup() {
  const db = createDb(url);
  await migrate(db);
  await db.query(
    `TRUNCATE invoice_lines, invoices, quote_lines, quotes, bookings, stock_movements, work_order_lines, work_orders,
              articles, mechanics, vehicles, customers RESTART IDENTITY CASCADE`,
  );
  await db.query(`ALTER SEQUENCE invoice_number_seq RESTART WITH 1001`);
  await db.query(`UPDATE workshop_settings SET default_hourly_rate = 950, payment_terms_days = 30, quote_valid_days = 30`);
  const app = await buildApp(db);
  return {
    app,
    db,
    close: async () => {
      await app.close();
      await db.end();
    },
  };
}
