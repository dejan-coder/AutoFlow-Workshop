import { z } from 'zod';
import type { Q } from '../db.js';
import { conflict, notFound } from './errors.js';
import { lineNet } from './money.js';

const vatRate = z.union([z.literal(0), z.literal(6), z.literal(12), z.literal(25)]);

const lineBase = {
  line_type: z.enum(['labor', 'article', 'other']),
  article_id: z.number().int().positive().nullish(),
  description: z.string().trim().min(1, 'Beskrivning krävs').max(500).optional(),
  quantity: z.number().positive('Antal måste vara större än 0').max(100000),
  unit: z.string().trim().min(1).max(20).optional(),
  unit_price: z.number().min(0).max(10_000_000).optional(),
  discount_percent: z.number().min(0).max(100).optional(),
  vat_rate: vatRate.optional(),
  sort_order: z.number().int().optional(),
};

export const lineCreate = z
  .object(lineBase)
  .strict()
  .refine((l) => l.line_type !== 'article' || l.article_id != null, {
    message: 'Artikelrad kräver artikel',
    path: ['article_id'],
  });

export const lineUpdate = z
  .object({
    description: lineBase.description,
    quantity: lineBase.quantity.optional(),
    unit: lineBase.unit,
    unit_price: lineBase.unit_price,
    discount_percent: lineBase.discount_percent,
    vat_rate: lineBase.vat_rate,
    sort_order: lineBase.sort_order,
  })
  .strict();

export type LineCreate = z.infer<typeof lineCreate>;
export type LineUpdate = z.infer<typeof lineUpdate>;

export interface Line {
  id: number;
  line_type: 'labor' | 'article' | 'other';
  article_id: number | null;
  article_number: string | null;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  discount_percent: number;
  vat_rate: number;
  sort_order: number;
  net_amount: number;
}

/** Fyller i standardvärden från artikeln eller verkstadens timpris. */
export async function resolveLine(q: Q, input: LineCreate) {
  if (input.line_type === 'article') {
    const a = (
      await q.query<{ name: string; unit: string; sale_price: number; vat_rate: number; active: boolean }>(
        'SELECT name, unit, sale_price, vat_rate, active FROM articles WHERE id = $1',
        [input.article_id],
      )
    ).rows[0];
    if (!a) throw notFound('Artikeln');
    if (!a.active) throw conflict('Artikeln är inaktiv');
    return {
      line_type: input.line_type,
      article_id: input.article_id ?? null,
      description: input.description ?? a.name,
      quantity: input.quantity,
      unit: input.unit ?? a.unit,
      unit_price: input.unit_price ?? a.sale_price,
      discount_percent: input.discount_percent ?? 0,
      vat_rate: input.vat_rate ?? a.vat_rate,
      sort_order: input.sort_order ?? 0,
    };
  }
  let unitPrice = input.unit_price;
  if (unitPrice === undefined && input.line_type === 'labor') {
    unitPrice = (await q.query<{ r: number }>('SELECT default_hourly_rate AS r FROM workshop_settings')).rows[0].r;
  }
  return {
    line_type: input.line_type,
    article_id: null as number | null,
    description: input.description ?? (input.line_type === 'labor' ? 'Arbete' : 'Övrigt'),
    quantity: input.quantity,
    unit: input.unit ?? (input.line_type === 'labor' ? 'tim' : 'st'),
    unit_price: unitPrice ?? 0,
    discount_percent: input.discount_percent ?? 0,
    vat_rate: input.vat_rate ?? 25,
    sort_order: input.sort_order ?? 0,
  };
}

export type ResolvedLine = Awaited<ReturnType<typeof resolveLine>>;

const COLS = [
  'line_type',
  'article_id',
  'description',
  'quantity',
  'unit',
  'unit_price',
  'discount_percent',
  'vat_rate',
  'sort_order',
] as const;

/** Rader för arbetsorder och offert hanteras likadant; bara tabell och ägarkolumn skiljer. */
export function lineStore(table: 'work_order_lines' | 'quote_lines', ownerCol: 'work_order_id' | 'quote_id') {
  return {
    async list(q: Q, ownerId: number): Promise<Line[]> {
      const rows = (
        await q.query<Omit<Line, 'net_amount'>>(
          `SELECT l.id, l.line_type, l.article_id, a.article_number, l.description, l.quantity, l.unit,
                  l.unit_price, l.discount_percent, l.vat_rate, l.sort_order
           FROM ${table} l LEFT JOIN articles a ON a.id = l.article_id
           WHERE l.${ownerCol} = $1 ORDER BY l.sort_order, l.id`,
          [ownerId],
        )
      ).rows;
      return rows.map((r) => ({ ...r, net_amount: lineNet(r) }));
    },
    async get(q: Q, ownerId: number, lineId: number) {
      return (
        await q.query<ResolvedLine & { id: number }>(`SELECT * FROM ${table} WHERE id = $1 AND ${ownerCol} = $2`, [
          lineId,
          ownerId,
        ])
      ).rows[0];
    },
    async insert(q: Q, ownerId: number, line: ResolvedLine): Promise<number> {
      const placeholders = COLS.map((_, i) => `$${i + 2}`).join(', ');
      const res = await q.query<{ id: number }>(
        `INSERT INTO ${table} (${ownerCol}, ${COLS.join(', ')}) VALUES ($1, ${placeholders}) RETURNING id`,
        [ownerId, ...COLS.map((c) => line[c])],
      );
      return res.rows[0].id;
    },
    async update(q: Q, lineId: number, data: LineUpdate) {
      const cols = (Object.keys(data) as (keyof LineUpdate)[]).filter((k) => data[k] !== undefined);
      if (!cols.length) return;
      await q.query(`UPDATE ${table} SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`, [
        lineId,
        ...cols.map((c) => data[c]),
      ]);
    },
    async delete(q: Q, lineId: number) {
      await q.query(`DELETE FROM ${table} WHERE id = $1`, [lineId]);
    },
  };
}
