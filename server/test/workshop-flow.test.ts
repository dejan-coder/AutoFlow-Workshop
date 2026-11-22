import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup } from './helpers.js';

let ctx: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => ctx.close());

async function call(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: object) {
  const res = await ctx.app.inject({ method, url, payload });
  return { status: res.statusCode, body: res.body ? (res.headers['content-type']?.includes('json') ? res.json() : res.body) : null, res };
}

describe('verkstadsflöde: bokning → arbetsorder → lager → faktura', () => {
  let customerId: number;
  let vehicleId: number;
  let mechanicId: number;
  let oilId: number;
  let filterId: number;
  let workOrderId: number;
  let invoiceId: number;

  it('förbereder kund, fordon, mekaniker, inställningar och artiklar', async () => {
    customerId = (await call('POST', '/api/customers', { customer_type: 'private', name: 'Erik Ek', street: 'Storgatan 1', postal_code: '411 01', city: 'Göteborg' })).body.id;
    vehicleId = (await call('POST', '/api/vehicles', { registration_number: 'KLM456', customer_id: customerId, make: 'Saab', model: '9-3', mileage_km: 150000 })).body.id;
    mechanicId = (await call('POST', '/api/mechanics', { name: 'Sara' })).body.id;

    const s = await call('PUT', '/api/settings', { company_name: 'Testverkstan AB', default_hourly_rate: 800, bankgiro: '123-4567' });
    expect(s.status).toBe(200);
    expect(s.body.default_hourly_rate).toBe(800);

    const oil = await call('POST', '/api/articles', { article_number: 'OL-5W30', name: 'Motorolja 5W-30', unit: 'l', purchase_price: 60, sale_price: 120, stock_quantity: 50, reorder_level: 10 });
    expect(oil.status).toBe(201);
    expect(oil.body.stock_quantity).toBe(50);
    oilId = oil.body.id;
    filterId = (await call('POST', '/api/articles', { article_number: 'OF-100', name: 'Oljefilter', sale_price: 189, stock_quantity: 3, reorder_level: 2 })).body.id;
  });

  it('nekar dubbla artikelnummer', async () => {
    expect((await call('POST', '/api/articles', { article_number: 'OF-100', name: 'Kopia' })).status).toBe(409);
  });

  it('bokar tid och nekar dubbelbokning av samma mekaniker', async () => {
    const b = await call('POST', '/api/bookings', { starts_at: '2026-11-24T08:00:00+01:00', duration_minutes: 90, mechanic_id: mechanicId, vehicle_id: vehicleId, description: 'Service' });
    expect(b.status).toBe(201);
    expect(b.body.customer_id).toBe(customerId);
    const clash = await call('POST', '/api/bookings', { starts_at: '2026-11-24T09:00:00+01:00', duration_minutes: 60, mechanic_id: mechanicId });
    expect(clash.status).toBe(409);
    const ok = await call('POST', '/api/bookings', { starts_at: '2026-11-24T09:30:00+01:00', duration_minutes: 60, mechanic_id: mechanicId });
    expect(ok.status).toBe(201);

    const day = await call('GET', '/api/bookings?from=2026-11-24&to=2026-11-24');
    expect(day.body.items).toHaveLength(2);

    const wo = await call('POST', `/api/bookings/${b.body.id}/work-order`);
    expect(wo.status).toBe(201);
    expect(wo.body.mechanic_id).toBe(mechanicId);
    expect(wo.body.description).toBe('Service');
    workOrderId = wo.body.id;
    expect((await call('POST', `/api/bookings/${b.body.id}/work-order`)).status).toBe(409);
  });

  it('lägger till arbete och artiklar och drar från lagret', async () => {
    const labor = await call('POST', `/api/work-orders/${workOrderId}/lines`, { line_type: 'labor', description: 'Service enligt schema', quantity: 1.5 });
    expect(labor.status).toBe(201);
    expect(labor.body.lines[0].unit_price).toBe(800);
    expect(labor.body.lines[0].unit).toBe('tim');

    await call('POST', `/api/work-orders/${workOrderId}/lines`, { line_type: 'article', article_id: oilId, quantity: 4.5 });
    const wo = await call('POST', `/api/work-orders/${workOrderId}/lines`, { line_type: 'article', article_id: filterId, quantity: 1, discount_percent: 10 });
    expect(wo.body.lines).toHaveLength(3);
    // 1,5 × 800 + 4,5 × 120 + 189 × 0,9 = 1200 + 540 + 170,10
    expect(wo.body.totals.net_amount).toBe(1910.1);
    expect(wo.body.totals.vat_amount).toBe(477.53);
    expect(wo.body.totals.total_amount).toBe(2388);

    expect((await call('GET', `/api/articles/${oilId}`)).body.stock_quantity).toBe(45.5);
    expect((await call('GET', `/api/articles/${filterId}`)).body.stock_quantity).toBe(2);
  });

  it('justerar lagret när en rad ändras eller tas bort', async () => {
    const wo = (await call('GET', `/api/work-orders/${workOrderId}`)).body;
    const oilLine = wo.lines.find((l: { article_id: number }) => l.article_id === oilId);
    await call('PATCH', `/api/work-orders/${workOrderId}/lines/${oilLine.id}`, { quantity: 5 });
    expect((await call('GET', `/api/articles/${oilId}`)).body.stock_quantity).toBe(45);

    const extra = await call('POST', `/api/work-orders/${workOrderId}/lines`, { line_type: 'article', article_id: filterId, quantity: 1 });
    expect((await call('GET', `/api/articles/${filterId}`)).body.stock_quantity).toBe(1);
    const low = await call('GET', '/api/articles?low_stock=true');
    expect(low.body.items.map((a: { id: number }) => a.id)).toEqual([filterId]);
    const extraLine = extra.body.lines[extra.body.lines.length - 1];
    await call('DELETE', `/api/work-orders/${workOrderId}/lines/${extraLine.id}`);
    expect((await call('GET', `/api/articles/${filterId}`)).body.stock_quantity).toBe(2);

    const moves = await call('GET', `/api/articles/${filterId}/movements`);
    expect(moves.body.items.length).toBeGreaterThanOrEqual(3);
  });

  it('inventerar och tar emot leverans', async () => {
    const counted = await call('POST', `/api/articles/${oilId}/stock`, { reason: 'count', counted_quantity: 44 });
    expect(counted.body.stock_quantity).toBe(44);
    const received = await call('POST', `/api/articles/${oilId}/stock`, { reason: 'purchase', quantity: 20 });
    expect(received.body.stock_quantity).toBe(64);
  });

  it('följer statusflödet och uppdaterar mätarställningen', async () => {
    expect((await call('PATCH', `/api/work-orders/${workOrderId}`, { status: 'in_progress', mileage_km: 151200 })).status).toBe(200);
    expect((await call('GET', `/api/vehicles/${vehicleId}`)).body.mileage_km).toBe(151200);
    expect((await call('PATCH', `/api/work-orders/${workOrderId}`, { status: 'invoiced' })).status).toBe(409);
    const done = await call('PATCH', `/api/work-orders/${workOrderId}`, { status: 'done' });
    expect(done.body.status).toBe('done');
    expect(done.body.completed_at).toBeTruthy();
  });

  it('fakturerar arbetsordern och låser den', async () => {
    const inv = await call('POST', '/api/invoices', { work_order_id: workOrderId, invoice_date: '2026-11-24' });
    expect(inv.status).toBe(201);
    invoiceId = inv.body.id;
    expect(inv.body.invoice_number).toBe(1001);
    expect(inv.body.due_date).toBe('2026-12-24');
    expect(inv.body.customer_name).toBe('Erik Ek');
    expect(inv.body.registration_number).toBe('KLM456');
    expect(inv.body.mileage_km).toBe(151200);
    expect(inv.body.net_amount).toBe(1970.1);
    expect(inv.body.total_amount).toBe(2463);

    const wo = await call('GET', `/api/work-orders/${workOrderId}`);
    expect(wo.body.status).toBe('invoiced');
    expect(wo.body.invoice.invoice_number).toBe(1001);
    expect((await call('POST', `/api/work-orders/${workOrderId}/lines`, { line_type: 'other', quantity: 1, unit_price: 10 })).status).toBe(409);
    expect((await call('POST', '/api/invoices', { work_order_id: workOrderId })).status).toBe(409);
  });

  it('skapar en PDF av fakturan', async () => {
    const pdf = await call('GET', `/api/invoices/${invoiceId}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.res.headers['content-type']).toBe('application/pdf');
    expect(pdf.res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('krediterar fakturan, öppnar ordern igen och kan fakturera på nytt', async () => {
    const credit = await call('POST', `/api/invoices/${invoiceId}/credit`);
    expect(credit.status).toBe(201);
    expect(credit.body.invoice_type).toBe('credit');
    expect(credit.body.total_amount).toBe(-2463);
    expect(credit.body.credited_invoice_number).toBe(1001);
    expect((await call('GET', `/api/invoices/${invoiceId}`)).body.status).toBe('credited');
    expect((await call('GET', `/api/work-orders/${workOrderId}`)).body.status).toBe('done');

    const again = await call('POST', '/api/invoices', { work_order_id: workOrderId, invoice_date: '2026-11-25' });
    expect(again.status).toBe(201);
    expect(again.body.invoice_number).toBe(1003);
    const paid = await call('POST', `/api/invoices/${again.body.id}/pay`, { paid_at: '2026-11-30' });
    expect(paid.body.status).toBe('paid');
    expect((await call('POST', `/api/invoices/${again.body.id}/pay`, {})).status).toBe(409);
  });

  it('visar försäljningsrapport och översikt', async () => {
    const r = await call('GET', '/api/reports/sales?from=2026-11-01&to=2026-11-30');
    expect(r.body.invoice_count).toBe(2);
    expect(r.body.net_amount).toBe(1970.1); // faktura + kredit + ny faktura
    expect(r.body.labor_by_mechanic[0]).toMatchObject({ mechanic: 'Sara', hours: 1.5, net_amount: 1200 });
    const d = await call('GET', '/api/dashboard');
    expect(d.status).toBe(200);
    expect(d.body.work_orders).toBeDefined();
  });

  it('listar fordonets historik', async () => {
    const h = await call('GET', `/api/work-orders?vehicle_id=${vehicleId}`);
    expect(h.body.total).toBe(1);
    expect(h.body.items[0].net_amount).toBe(1970.1);
  });
});

describe('offert → arbetsorder', () => {
  it('skapar offert, godkänner den och får en arbetsorder med samma rader', async () => {
    const vehicle = (await call('GET', '/api/vehicles/by-registration/KLM456')).body;
    const filter = (await call('GET', '/api/articles?search=OF-100')).body.items[0];
    const q = await call('POST', '/api/quotes', { vehicle_id: vehicle.id, description: 'Byte av bromsar' });
    expect(q.status).toBe(201);
    expect(q.body.customer_id).toBe(vehicle.customer_id);
    expect(q.body.valid_until).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await call('POST', `/api/quotes/${q.body.id}/lines`, { line_type: 'labor', quantity: 2 });
    const withLines = await call('POST', `/api/quotes/${q.body.id}/lines`, { line_type: 'article', article_id: filter.id, quantity: 1 });
    expect(withLines.body.totals.net_amount).toBe(1789);
    expect((await call('GET', `/api/articles/${filter.id}`)).body.stock_quantity).toBe(2); // offert drar inte lager

    const pdf = await call('GET', `/api/quotes/${q.body.id}/pdf`);
    expect(pdf.res.headers['content-type']).toBe('application/pdf');

    const accepted = await call('POST', `/api/quotes/${q.body.id}/accept`);
    expect(accepted.status).toBe(201);
    expect(accepted.body.quote.status).toBe('accepted');
    const wo = (await call('GET', `/api/work-orders/${accepted.body.work_order_id}`)).body;
    expect(wo.lines).toHaveLength(2);
    expect(wo.totals.net_amount).toBe(1789);
    expect((await call('GET', `/api/articles/${filter.id}`)).body.stock_quantity).toBe(1);

    expect((await call('POST', `/api/quotes/${q.body.id}/lines`, { line_type: 'labor', quantity: 1 })).status).toBe(409);
  });

  it('makulerad arbetsorder lämnar tillbaka artiklar till lagret', async () => {
    const list = (await call('GET', '/api/work-orders?status=open')).body;
    const wo = list.items[0];
    const filter = (await call('GET', '/api/articles?search=OF-100')).body.items[0];
    const res = await call('PATCH', `/api/work-orders/${wo.id}`, { status: 'cancelled' });
    expect(res.body.status).toBe('cancelled');
    expect((await call('GET', `/api/articles/${filter.id}`)).body.stock_quantity).toBe(filter.stock_quantity + 1);
  });

  it('kräver kund när fordonet saknar ägare', async () => {
    const v = (await call('POST', '/api/vehicles', { registration_number: 'NOP78Q' })).body;
    const res = await call('POST', '/api/work-orders', { vehicle_id: v.id });
    expect(res.status).toBe(400);
    expect(res.body.details[0].field).toBe('customer_id');
  });
});
