import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { existsSync } from 'node:fs';
import { ZodError } from 'zod';
import type { Db } from './db.js';
import { AppError } from './lib/errors.js';
import { accountingRoutes } from './modules/accounting/routes.js';
import { articleRoutes } from './modules/articles/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { bookingRoutes } from './modules/bookings/routes.js';
import { customerRoutes } from './modules/customers/routes.js';
import { invoiceRoutes } from './modules/invoices/routes.js';
import { messageRoutes } from './modules/messages/routes.js';
import type { SmsProvider } from './modules/messages/sms.js';
import { quoteRoutes } from './modules/quotes/routes.js';
import { reportRoutes } from './modules/reports/routes.js';
import { settingsRoutes } from './modules/settings/routes.js';
import { serviceDueRoutes, tireRoutes } from './modules/tires/routes.js';
import { vehicleLookupRoutes } from './modules/vehicle-lookup/routes.js';
import { vehicleRoutes } from './modules/vehicles/routes.js';
import { workOrderRoutes } from './modules/work-orders/routes.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
  }
}

const UNIQUE_MESSAGES: Record<string, string> = {
  vehicles_registration_number_key: 'Ett fordon med det regnumret finns redan',
  articles_article_number_key: 'Artikelnumret finns redan',
  users_email_idx: 'E-postadressen används redan av en annan användare',
};

export interface AppOptions {
  logger?: boolean;
  smsProvider?: SmsProvider;
  /** Mapp med byggd webb (web/dist) som servern ska visa. */
  webDir?: string;
}

export async function buildApp(db: Db, opts: AppOptions = {}) {
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: true });
  app.decorate('db', db);
  await app.register(cookie);

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
      return reply.code(409).send({ error: 'conflict', message: UNIQUE_MESSAGES[pgErr.constraint ?? ''] ?? 'Posten finns redan' });
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

  // Inloggningskontrollen registreras direkt på appen så att den gäller alla API-vägar
  await authRoutes(app);

  await app.register(customerRoutes);
  await app.register(vehicleRoutes);
  await app.register(vehicleLookupRoutes);
  await app.register(settingsRoutes);
  await app.register(articleRoutes);
  await app.register(workOrderRoutes);
  await app.register(bookingRoutes);
  await app.register(quoteRoutes);
  await app.register(invoiceRoutes);
  await app.register(reportRoutes);
  await app.register(messageRoutes, { provider: opts.smsProvider });
  await app.register(accountingRoutes);
  await app.register(tireRoutes);
  await app.register(serviceDueRoutes);

  // I drift visar samma server även webbgränssnittet
  if (opts.webDir && existsSync(opts.webDir)) {
    await app.register(fastifyStatic, { root: opts.webDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'not_found', message: 'Sidan finns inte' });
    });
  }
  return app;
}
