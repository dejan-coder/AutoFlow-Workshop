import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTx } from '../../db.js';
import { notFound } from '../../lib/errors.js';
import { lineCreate, lineUpdate } from '../../lib/lines.js';
import { idParam, pagination } from '../../lib/validation.js';
import * as svc from './service.js';

const lineParams = z.object({ id: z.coerce.number().int().positive(), lineId: z.coerce.number().int().positive() });

export async function workOrderRoutes(app: FastifyInstance) {
  const { db } = app;

  const load = async (id: number) => {
    const wo = await svc.getWorkOrder(db, id);
    if (!wo) throw notFound('Arbetsordern');
    return wo;
  };

  app.get('/api/work-orders', async (req) => {
    const q = pagination
      .extend({
        status: z
          .string()
          .optional()
          .transform((s) => (s ? s.split(',') : undefined))
          .pipe(z.array(z.enum(svc.STATUSES)).optional()),
        vehicle_id: z.coerce.number().int().positive().optional(),
        customer_id: z.coerce.number().int().positive().optional(),
      })
      .parse(req.query);
    return svc.listWorkOrders(db, q);
  });

  app.post('/api/work-orders', async (req, reply) => {
    const data = svc.workOrderCreate.parse(req.body);
    const id = await withTx(db, (c) => svc.createWorkOrder(c, data));
    return reply.code(201).send(await load(id));
  });

  app.get('/api/work-orders/:id', async (req) => load(idParam.parse(req.params).id));

  app.patch('/api/work-orders/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const data = svc.workOrderUpdate.parse(req.body);
    await withTx(db, (c) => svc.updateWorkOrder(c, id, data));
    return load(id);
  });

  app.delete('/api/work-orders/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    await withTx(db, (c) => svc.deleteWorkOrder(c, id));
    return reply.code(204).send();
  });

  app.post('/api/work-orders/:id/lines', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const data = lineCreate.parse(req.body);
    await withTx(db, (c) => svc.addLine(c, id, data));
    return reply.code(201).send(await load(id));
  });

  app.patch('/api/work-orders/:id/lines/:lineId', async (req) => {
    const { id, lineId } = lineParams.parse(req.params);
    const data = lineUpdate.parse(req.body);
    await withTx(db, (c) => svc.updateLine(c, id, lineId, data));
    return load(id);
  });

  app.delete('/api/work-orders/:id/lines/:lineId', async (req) => {
    const { id, lineId } = lineParams.parse(req.params);
    await withTx(db, (c) => svc.deleteLine(c, id, lineId));
    return load(id);
  });
}
