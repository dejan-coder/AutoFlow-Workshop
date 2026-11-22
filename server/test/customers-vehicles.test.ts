import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup } from './helpers.js';

let ctx: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => ctx.close());

const post = (url: string, payload: unknown) => ctx.app.inject({ method: 'POST', url, payload: payload as object });

describe('kunder och fordon', () => {
  let customerId: number;

  it('skapar en kund', async () => {
    const res = await post('/api/customers', {
      customer_type: 'private',
      name: 'Anna Andersson',
      identity_number: '811218-9876',
      email: 'anna@example.com',
      phone: '070-123 45 67',
      city: 'Göteborg',
    });
    expect(res.statusCode).toBe(201);
    customerId = res.json().id;
    expect(res.json().name).toBe('Anna Andersson');
  });

  it('avvisar ogiltiga kunduppgifter', async () => {
    const res = await post('/api/customers', { customer_type: 'private', name: '', email: 'fel' });
    expect(res.statusCode).toBe(400);
    const fields = res.json().details.map((d: { field: string }) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['name', 'email']));
  });

  it('skapar fordon med normaliserat regnummer kopplat till kunden', async () => {
    const res = await post('/api/vehicles', {
      registration_number: 'abc 123',
      customer_id: customerId,
      make: 'Volvo',
      model: 'V70',
      model_year: 2012,
      fuel: 'diesel',
      mileage_km: 215000,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().registration_number).toBe('ABC123');
    expect(res.json().customer_name).toBe('Anna Andersson');
  });

  it('nekar dubbletter av regnummer', async () => {
    const res = await post('/api/vehicles', { registration_number: 'ABC123' });
    expect(res.statusCode).toBe(409);
  });

  it('hittar fordon på regnummer', async () => {
    const res = await ctx.app.inject({ url: '/api/vehicles/by-registration/abc-123' });
    expect(res.statusCode).toBe(200);
    expect(res.json().make).toBe('Volvo');
  });

  it('söker kund på regnummer och visar kundens fordon', async () => {
    const list = await ctx.app.inject({ url: '/api/customers?search=abc1' });
    expect(list.json().total).toBe(1);
    const detail = await ctx.app.inject({ url: `/api/customers/${customerId}` });
    expect(detail.json().vehicles).toHaveLength(1);
  });

  it('uppdaterar mätarställning', async () => {
    const v = await ctx.app.inject({ url: '/api/vehicles/by-registration/ABC123' });
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/vehicles/${v.json().id}`,
      payload: { mileage_km: 216500 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().mileage_km).toBe(216500);
  });

  it('nekar borttagning av kund som har fordon', async () => {
    const res = await ctx.app.inject({ method: 'DELETE', url: `/api/customers/${customerId}` });
    expect(res.statusCode).toBe(409);
  });

  it('tar bort fordon och sedan kund', async () => {
    const v = await ctx.app.inject({ url: '/api/vehicles/by-registration/ABC123' });
    expect((await ctx.app.inject({ method: 'DELETE', url: `/api/vehicles/${v.json().id}` })).statusCode).toBe(204);
    expect((await ctx.app.inject({ method: 'DELETE', url: `/api/customers/${customerId}` })).statusCode).toBe(204);
    expect((await ctx.app.inject({ url: `/api/customers/${customerId}` })).statusCode).toBe(404);
  });
});
