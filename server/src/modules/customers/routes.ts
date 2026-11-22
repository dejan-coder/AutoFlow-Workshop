import type { FastifyInstance } from 'fastify';
import { conflict, notFound } from '../../lib/errors.js';
import { idParam, pagination } from '../../lib/validation.js';
import { listVehicles } from '../vehicles/repo.js';
import * as repo from './repo.js';
import { customerCreate, customerUpdate } from './schemas.js';

export async function customerRoutes(app: FastifyInstance) {
  const { db } = app;

  app.get('/api/customers', async (req) => {
    const q = pagination.parse(req.query);
    return repo.listCustomers(db, q);
  });

  app.post('/api/customers', async (req, reply) => {
    const customer = await repo.createCustomer(db, customerCreate.parse(req.body));
    return reply.code(201).send(customer);
  });

  app.get('/api/customers/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const customer = await repo.getCustomer(db, id);
    if (!customer) throw notFound('Kunden');
    const vehicles = await listVehicles(db, { customerId: id, limit: 200, offset: 0 });
    return { ...customer, vehicles: vehicles.items };
  });

  app.patch('/api/customers/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const customer = await repo.updateCustomer(db, id, customerUpdate.parse(req.body));
    if (!customer) throw notFound('Kunden');
    return customer;
  });

  app.delete('/api/customers/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const vehicles = await listVehicles(db, { customerId: id, limit: 1, offset: 0 });
    if (vehicles.total > 0) throw conflict('Kunden har fordon kopplade. Flytta eller ta bort fordonen först.');
    if (!(await repo.deleteCustomer(db, id))) throw notFound('Kunden');
    return reply.code(204).send();
  });
}
