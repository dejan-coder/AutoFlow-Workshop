import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { config } from './config.js';
import { createDb } from './db.js';
import { migrate } from './migrate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const db = createDb(config.databaseUrl);
await migrate(db);
const app = await buildApp(db, {
  logger: true,
  webDir: process.env.WEB_DIR ?? path.resolve(here, '../../web/dist'),
});
await app.listen({ port: config.port, host: '0.0.0.0' });
