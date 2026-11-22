import { buildApp } from '../src/app.js';
import { createDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';

const url = process.env.TEST_DATABASE_URL ?? 'postgres://autoflow:autoflow@localhost:5432/autoflow_test';

export async function setup() {
  const db = createDb(url);
  await migrate(db);
  await db.query('TRUNCATE vehicles, customers RESTART IDENTITY CASCADE');
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
