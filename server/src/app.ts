import cors from '@fastify/cors';
import Fastify from 'fastify';
import { ZodError } from 'zod';
import type { Db } from './db.js';
import { AppError } from './lib/errors.js';
import { customerRoutes } from './modules/customers/routes.js';
import { vehicleRoutes } from './modules/vehicles/routes.js';
import { settingsRoutes } from './modules/settings/routes.js';
import { articleRoutes } from './modules/articles/routes.js';
import { workOrderRoutes } from './modules/work-orders/routes.js';
import { bookingRoutes } from './modules/bookings/routes.js';
import { quoteRoutes } from './modules/quotes/routes.js';
import { invoiceRoutes } from './modules/invoices/routes.js';
import { reportRoutes } from './modules/reports/routes.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
  }
}

export async function buildApp(db: Db, opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? false });
  app.decorate('db', db);
  await app.register(cors);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: 'validation_error',
        message: 'Felaktiga uppgifter',
        details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message, details: err.details });
    }
    const pgErr = err as { code?: string; constraint?: string };
    if (pgErr.code === '23505') {
      const message = pgErr.constraint === 'vehicles_registration_number_key'
        ? 'Ett fordon med det regnumret finns redan'
        : 'Posten finns redan';
      return reply.code(409).send({ error: 'conflict', message });
    }
    if (pgErr.code === '23503') {
      return reply.code(409).send({ error: 'conflict', message: 'Kopplad post saknas eller används' });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.code(status).send({ error: 'bad_request', message: (err as Error).message });
    }
    req.log.error(err);
    return reply.code(500).send({ error: 'internal_error', message: 'Något gick fel' });
  });

  app.get('/health', async () => ({ status: 'ok' }));
  await app.register(customerRoutes);
  await app.register(vehicleRoutes);
  await app.register(settingsRoutes);
  await app.register(articleRoutes);
  await app.register(workOrderRoutes);
  await app.register(bookingRoutes);
  await app.register(quoteRoutes);
  await app.register(invoiceRoutes);
  await app.register(reportRoutes);
  return app;
}
