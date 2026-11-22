import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { notFound } from '../../lib/errors.js';
import { idParam, normalizeRegistration, pagination } from '../../lib/validation.js';
import * as repo from './repo.js';
import { vehicleCreate, vehicleUpdate } from './schemas.js';

export async function vehicleRoutes(app: FastifyInstance) {
  const { db } = app;

  app.get('/api/vehicles', async (req) => {
    const q = pagination.extend({ customer_id: z.coerce.number().int().positive().optional() }).parse(req.query);
    return repo.listVehicles(db, { ...q, customerId: q.customer_id });
  });

  app.post('/api/vehicles', async (req, reply) => {
    const vehicle = await repo.createVehicle(db, vehicleCreate.parse(req.body));
    return reply.code(201).send(vehicle);
  });

  app.get('/api/vehicles/by-registration/:reg', async (req) => {
    const { reg } = z.object({ reg: z.string() }).parse(req.params);
    const vehicle = await repo.getVehicleByRegistration(db, normalizeRegistration(reg));
    if (!vehicle) throw notFound('Fordonet');
    return vehicle;
  });

  app.get('/api/vehicles/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const vehicle = await repo.getVehicle(db, id);
    if (!vehicle) throw notFound('Fordonet');
    return vehicle;
  });

  app.patch('/api/vehicles/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const vehicle = await repo.updateVehicle(db, id, vehicleUpdate.parse(req.body));
    if (!vehicle) throw notFound('Fordonet');
    return vehicle;
  });

  app.delete('/api/vehicles/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    if (!(await repo.deleteVehicle(db, id))) throw notFound('Fordonet');
    return reply.code(204).send();
  });
}
