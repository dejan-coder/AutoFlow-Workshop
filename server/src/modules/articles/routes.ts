import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTx, type Q } from '../../db.js';
import { conflict, notFound } from '../../lib/errors.js';
import { idParam, optionalText, pagination } from '../../lib/validation.js';

const base = {
  article_number: z.string().trim().min(1, 'Artikelnummer krävs').max(50),
  name: z.string().trim().min(1, 'Benämning krävs').max(200),
  unit: z.string().trim().min(1).max(20).optional(),
  purchase_price: z.number().min(0).max(10_000_000).optional(),
  sale_price: z.number().min(0).max(10_000_000).optional(),
  vat_rate: z.union([z.literal(0), z.literal(6), z.literal(12), z.literal(25)]).optional(),
  track_stock: z.boolean().optional(),
  reorder_level: z.number().min(0).nullish(),
  supplier: optionalText,
  location: optionalText,
  active: z.boolean().optional(),
};
export const articleCreate = z
  .object({ ...base, stock_quantity: z.number().min(0).optional() })
  .strict();
export const articleUpdate = z.object(base).partial().strict();
const FIELDS = Object.keys(base) as (keyof typeof base)[];

export interface Article {
  id: number;
  article_number: string;
  name: string;
  unit: string;
  purchase_price: number;
  sale_price: number;
  vat_rate: number;
  track_stock: boolean;
  stock_quantity: number;
  reorder_level: number | null;
  supplier: string | null;
  location: string | null;
  active: boolean;
}

export async function getArticle(q: Q, id: number): Promise<Article | undefined> {
  return (await q.query<Article>('SELECT * FROM articles WHERE id = $1', [id])).rows[0];
}

/** Ändrar lagersaldo och loggar rörelsen. Gör inget för artiklar utan lagerföring. */
export async function moveStock(
  q: Q,
  articleId: number,
  delta: number,
  reason: 'purchase' | 'adjustment' | 'work_order' | 'count',
  opts: { workOrderId?: number | null; note?: string | null } = {},
) {
  if (delta === 0) return;
  const res = await q.query(
    'UPDATE articles SET stock_quantity = stock_quantity + $2, updated_at = now() WHERE id = $1 AND track_stock',
    [articleId, delta],
  );
  if (res.rowCount === 0) return;
  await q.query(
    'INSERT INTO stock_movements (article_id, quantity, reason, work_order_id, note) VALUES ($1, $2, $3, $4, $5)',
    [articleId, delta, reason, opts.workOrderId ?? null, opts.note ?? null],
  );
}

export async function articleRoutes(app: FastifyInstance) {
  const { db } = app;

  app.get('/api/articles', async (req) => {
    const q = pagination
      .extend({
        low_stock: z.coerce.boolean().optional(),
        include_inactive: z.coerce.boolean().optional(),
      })
      .parse(req.query);
    const params: unknown[] = [];
    const conds: string[] = [];
    if (!q.include_inactive) conds.push('active');
    if (q.search) {
      params.push(`%${q.search.toLowerCase()}%`);
      conds.push(`(lower(name) LIKE $${params.length} OR lower(article_number) LIKE $${params.length}
                   OR lower(supplier) LIKE $${params.length})`);
    }
    if (q.low_stock) conds.push('track_stock AND reorder_level IS NOT NULL AND stock_quantity <= reorder_level');
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const total = await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM articles ${where}`, params);
    params.push(q.limit, q.offset);
    const rows = await db.query<Article>(
      `SELECT * FROM articles ${where} ORDER BY article_number LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: rows.rows, total: total.rows[0].count };
  });

  app.post('/api/articles', async (req, reply) => {
    const data = articleCreate.parse(req.body);
    const article = await withTx(db, async (c) => {
      const cols = FIELDS.filter((f) => data[f] !== undefined);
      const res = await c.query<{ id: number }>(
        `INSERT INTO articles (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
        cols.map((k) => data[k] ?? null),
      );
      const id = res.rows[0].id;
      if (data.stock_quantity) await moveStock(c, id, data.stock_quantity, 'count', { note: 'Startsaldo' });
      return getArticle(c, id);
    });
    return reply.code(201).send(article);
  });

  app.get('/api/articles/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const article = await getArticle(db, id);
    if (!article) throw notFound('Artikeln');
    return article;
  });

  app.patch('/api/articles/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const data = articleUpdate.parse(req.body);
    const cols = FIELDS.filter((f) => data[f] !== undefined);
    if (cols.length) {
      await db.query(
        `UPDATE articles SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`,
        [id, ...cols.map((c) => data[c] ?? null)],
      );
    }
    const article = await getArticle(db, id);
    if (!article) throw notFound('Artikeln');
    return article;
  });

  app.delete('/api/articles/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const used = await db.query(
      `SELECT 1 FROM work_order_lines WHERE article_id = $1 UNION ALL SELECT 1 FROM quote_lines WHERE article_id = $1 LIMIT 1`,
      [id],
    );
    if (used.rowCount) throw conflict('Artikeln används på arbetsorder eller offert. Gör den inaktiv i stället.');
    const res = await db.query('DELETE FROM articles WHERE id = $1', [id]);
    if (!res.rowCount) throw notFound('Artikeln');
    return reply.code(204).send();
  });

  // Inleverans, justering eller inventering
  app.post('/api/articles/:id/stock', async (req) => {
    const { id } = idParam.parse(req.params);
    const body = z
      .discriminatedUnion('reason', [
        z.object({ reason: z.literal('purchase'), quantity: z.number().positive(), note: z.string().max(500).nullish() }),
        z.object({ reason: z.literal('adjustment'), quantity: z.number().refine((n) => n !== 0), note: z.string().max(500).nullish() }),
        z.object({ reason: z.literal('count'), counted_quantity: z.number().min(0), note: z.string().max(500).nullish() }),
      ])
      .parse(req.body);
    return withTx(db, async (c) => {
      const article = (await c.query<Article>('SELECT * FROM articles WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!article) throw notFound('Artikeln');
      if (!article.track_stock) throw conflict('Artikeln lagerförs inte');
      const delta = body.reason === 'count' ? body.counted_quantity - article.stock_quantity : body.quantity;
      await moveStock(c, id, delta, body.reason, { note: body.note });
      return getArticle(c, id);
    });
  });

  app.get('/api/articles/:id/movements', async (req) => {
    const { id } = idParam.parse(req.params);
    const rows = await db.query(
      `SELECT id, quantity, reason, work_order_id, note, created_at FROM stock_movements
       WHERE article_id = $1 ORDER BY created_at DESC, id DESC LIMIT 200`,
      [id],
    );
    return { items: rows.rows };
  });
}
