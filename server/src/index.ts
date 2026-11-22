import { buildApp } from './app.js';
import { config } from './config.js';
import { createDb } from './db.js';
import { migrate } from './migrate.js';

const db = createDb(config.databaseUrl);
await migrate(db);
const app = await buildApp(db, { logger: true });
await app.listen({ port: config.port, host: '0.0.0.0' });
