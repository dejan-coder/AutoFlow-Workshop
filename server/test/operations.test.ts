import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSie, toCp437 } from '../src/modules/accounting/sie.js';
import { fillTemplate, normalizePhone } from '../src/modules/messages/sms.js';
import { mapExternal } from '../src/modules/vehicle-lookup/routes.js';
import { addDays, todayStockholm } from '../src/lib/dates.js';
import { setup } from './helpers.js';

let ctx: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  ctx = await setup();
});
afterAll(() => ctx.close());

const call = async (method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: object, headers?: Record<string, string>) => {
  const res = await ctx.app.inject({ method, url, payload, headers });
  const json = res.headers['content-type']?.includes('json') ? res.json() : null;
  return { status: res.statusCode, body: json, res };
};

describe('inloggning och behörighet', () => {
  it('kräver inloggning för API:t', async () => {
    const res = await call('GET', '/api/customers', undefined, { cookie: '' });
    expect(res.status).toBe(401);
  });

  it('visar att administratör redan finns och nekar ny första-start', async () => {
    const s = await call('GET', '/api/auth/status');
    expect(s.body.setup_required).toBe(false);
    expect(s.body.user.role).toBe('admin');
    const again = await call('POST', '/api/auth/setup', { email: 'x@test.se', name: 'X', password: 'hemligt123' });
    expect(again.status).toBe(409);
  });

  it('låter admin skapa en mekaniker som kan logga in men inte se fakturor', async () => {
    const created = await call('POST', '/api/users', { email: 'Mek@Test.se', name: 'Mek', password: 'skruvnyckel', role: 'mechanic' });
    expect(created.status).toBe(201);
    expect(created.body.email).toBe('mek@test.se');
    expect(created.body.password_hash).toBeUndefined();

    expect((await call('POST', '/api/auth/login', { email: 'mek@test.se', password: 'fel' }, { cookie: '' })).status).toBe(401);
    const login = await call('POST', '/api/auth/login', { email: 'MEK@test.se', password: 'skruvnyckel' }, { cookie: '' });
    expect(login.status).toBe(200);
    const mechCookie = `af_session=${login.res.cookies.find((c) => c.name === 'af_session')!.value}`;

    expect((await call('GET', '/api/work-orders', undefined, { cookie: mechCookie })).status).toBe(200);
    expect((await call('GET', '/api/invoices', undefined, { cookie: mechCookie })).status).toBe(403);
    expect((await call('GET', '/api/users', undefined, { cookie: mechCookie })).status).toBe(403);
    expect((await call('PUT', '/api/settings', { company_name: 'X' }, { cookie: mechCookie })).status).toBe(403);

    // Utloggning gör kakan ogiltig
    await call('POST', '/api/auth/logout', {}, { cookie: mechCookie });
    expect((await call('GET', '/api/work-orders', undefined, { cookie: mechCookie })).status).toBe(401);
  });

  it('inaktiverad användare kan inte logga in', async () => {
    const users = (await call('GET', '/api/users')).body.items;
    const mek = users.find((u: { email: string }) => u.email === 'mek@test.se');
    await call('PATCH', `/api/users/${mek.id}`, { active: false });
    expect((await call('POST', '/api/auth/login', { email: 'mek@test.se', password: 'skruvnyckel' }, { cookie: '' })).status).toBe(401);
  });

  it('admin kan inte ta bort sin egen behörighet', async () => {
    const me = (await call('GET', '/api/auth/status')).body.user;
    expect((await call('PATCH', `/api/users/${me.id}`, { role: 'office' })).status).toBe(409);
  });

  it('byter lösenord', async () => {
    expect((await call('POST', '/api/auth/password', { current_password: 'fel', new_password: 'nyttlosen1' })).status).toBe(400);
    expect((await call('POST', '/api/auth/password', { current_password: 'hemligt123', new_password: 'nyttlosen1' })).status).toBe(200);
    expect((await call('POST', '/api/auth/login', { email: 'admin@test.se', password: 'nyttlosen1' }, { cookie: '' })).status).toBe(200);
  });
});

describe('SMS', () => {
  it('normaliserar telefonnummer och fyller mallar', () => {
    expect(normalizePhone('070-123 45 67')).toBe('+46701234567');
    expect(normalizePhone('0046 70 123 45 67')).toBe('+46701234567');
    expect(normalizePhone('123')).toBeNull();
    expect(fillTemplate('Hej {kund}! {regnr} {okänd}', { kund: 'Anna', regnr: 'ABC123' })).toBe('Hej Anna! ABC123');
  });

  it('skickar bokningsbekräftelse, påminnelse och "bilen är klar"', async () => {
    await call('PUT', '/api/settings', { company_name: 'Testverkstan', phone: '010-111 22 33', sms_sender: 'Testverk' });
    const c = (await call('POST', '/api/customers', { customer_type: 'private', name: 'Lisa Larsson', phone: '070-555 66 77' })).body;
    const v = (await call('POST', '/api/vehicles', { registration_number: 'SMS123', customer_id: c.id })).body;
    const tomorrow = addDays(todayStockholm(), 1);
    const b = (await call('POST', '/api/bookings', { starts_at: `${tomorrow}T09:30:00+01:00`, duration_minutes: 60, vehicle_id: v.id })).body;

    const confirm = await call('POST', `/api/bookings/${b.id}/notify`, { kind: 'confirmation' });
    expect(confirm.status).toBe(201);
    expect(confirm.body.to_phone).toBe('+46705556677');
    expect(confirm.body.body).toContain('Hej Lisa!');
    expect(confirm.body.body).toContain('SMS123');
    expect(confirm.body.body).toContain('09:30');
    expect(ctx.sms.sent.at(-1)!.sender).toBe('Testverk');

    const reminders = await call('POST', '/api/messages/booking-reminders', {});
    expect(reminders.body.count).toBe(1);
    expect((await call('POST', '/api/messages/booking-reminders', {})).body.count).toBe(0); // inte två gånger

    const wo = (await call('POST', '/api/work-orders', { vehicle_id: v.id })).body;
    await call('POST', `/api/work-orders/${wo.id}/lines`, { line_type: 'other', description: 'Test', quantity: 1, unit_price: 100 });
    const ready = await call('POST', `/api/work-orders/${wo.id}/notify-ready`, {});
    expect(ready.body.body).toContain('125 kr');
    expect(ready.body.kind).toBe('vehicle_ready');

    const history = await call('GET', `/api/messages?customer_id=${c.id}`);
    expect(history.body.items).toHaveLength(3);
    expect(history.body.items[0].sent_by_name).toBe('Admin');
  });

  it('nekar SMS till kund utan mobilnummer', async () => {
    const c = (await call('POST', '/api/customers', { customer_type: 'private', name: 'Utan Nummer' })).body;
    expect((await call('POST', '/api/messages', { customer_id: c.id, body: 'Hej' })).status).toBe(400);
  });
});

describe('bokföringsexport', () => {
  it('bygger balanserade SIE-verifikationer', () => {
    const settings = {
      company_name: 'Åkes Bil AB', org_number: '556036-0793', acc_receivable: '1510', acc_bank: '1930',
      acc_sales_25: '3001', acc_sales_12: '3002', acc_sales_6: '3003', acc_sales_0: '3004',
      acc_vat_25: '2611', acc_vat_12: '2621', acc_vat_6: '2631', acc_rounding: '3740',
    } as never;
    const sie = buildSie({
      settings,
      from: '2026-11-01',
      to: '2026-11-30',
      generatedAt: new Date('2026-12-01T10:00:00Z'),
      invoices: [{
        invoice_number: 1001, invoice_type: 'invoice', invoice_date: '2026-11-24', customer_name: 'Erik', rounding: -0.39, total_amount: 147,
        lines: [
          { quantity: 1, unit_price: 99.9, discount_percent: 0, vat_rate: 25 },
          { quantity: 2, unit_price: 10.05, discount_percent: 0, vat_rate: 12 },
        ],
      }],
      payments: [{ invoice_number: 1001, paid_at: '2026-11-30', customer_name: 'Erik', total_amount: 147 }],
    });
    expect(sie).toContain('#SIETYP 4');
    expect(sie).toContain('#ORGNR 556036-0793');
    expect(sie).toContain('#VER "A" 1 20261124 "Faktura 1001 Erik"');
    // Varje verifikation ska summera till 0
    for (const block of sie.split('{').slice(1)) {
      const sum = [...block.split('}')[0].matchAll(/#TRANS \d+ \{\} (-?[\d.]+)/g)].reduce((s, m) => s + Number(m[1]), 0);
      expect(Math.abs(sum)).toBeLessThan(0.001);
    }
    expect(sie).toContain('#TRANS 3740 {} 0.39');
    expect(toCp437('Åke')[0]).toBe(0x8f);
  });

  it('exporterar SIE-fil och visar kundreskontra', async () => {
    const c = (await call('POST', '/api/customers', { customer_type: 'company', name: 'Bokför AB' })).body;
    const v = (await call('POST', '/api/vehicles', { registration_number: 'BOK001', customer_id: c.id })).body;
    const wo = (await call('POST', '/api/work-orders', { vehicle_id: v.id })).body;
    await call('POST', `/api/work-orders/${wo.id}/lines`, { line_type: 'labor', quantity: 1, unit_price: 1000 });
    await call('PATCH', `/api/work-orders/${wo.id}`, { status: 'done' });
    const inv = (await call('POST', '/api/invoices', { work_order_id: wo.id, invoice_date: '2026-10-01' })).body;

    const sie = await call('GET', '/api/accounting/sie?from=2026-10-01&to=2026-10-31');
    expect(sie.status).toBe(200);
    expect(sie.res.headers['content-disposition']).toContain('.se');
    const text = sie.res.body;
    expect(text).toContain(`Faktura ${inv.invoice_number}`);
    expect(text).toContain('#TRANS 1510 {} 1250.00');
    expect(text).toContain('#TRANS 3001 {} -1000.00');
    expect(text).toContain('#TRANS 2611 {} -250.00');

    const rec = await call('GET', '/api/accounting/receivables');
    const row = rec.body.items.find((i: { invoice_number: number }) => i.invoice_number === inv.invoice_number);
    expect(row.days_overdue).toBeGreaterThan(0);
    expect(rec.body.totals.total).toBeGreaterThanOrEqual(1250);
  });
});

describe('fordonsuppslag, däckhotell och service', () => {
  it('mappar svar från extern fordonsdatatjänst', () => {
    expect(mapExternal('ABC123', { brand: 'Volvo', modell: 'XC60', year: '2019', drivmedel: 'Diesel', vin: 'YV1ABC' })).toMatchObject({
      make: 'Volvo', model: 'XC60', model_year: 2019, fuel: 'diesel', vin: 'YV1ABC',
    });
  });

  it('hittar fordon i det egna registret och säger till när externt uppslag saknas', async () => {
    const local = await call('GET', '/api/vehicle-lookup/bok 001');
    expect(local.body.source).toBe('local');
    expect(local.body.existing_vehicle_id).toBeTruthy();
    expect((await call('GET', '/api/vehicle-lookup/NEW99X')).status).toBe(404);
    expect((await call('GET', '/api/vehicle-lookup/fel')).status).toBe(400);
  });

  it('lagrar däck på hyllplats och lämnar ut dem', async () => {
    const v = (await call('GET', '/api/vehicles/by-registration/SMS123')).body;
    const t = await call('POST', '/api/tire-storage', { vehicle_id: v.id, location: 'A-12', season: 'summer', tire_size: '205/55 R16', tread_depth_mm: 5.5, with_rims: true });
    expect(t.status).toBe(201);
    expect(t.body.customer_id).toBe(v.customer_id);
    expect((await call('POST', '/api/tire-storage', { vehicle_id: v.id, location: 'a-12', season: 'winter' })).status).toBe(409);
    expect((await call('GET', '/api/tire-storage?search=sms123')).body.items).toHaveLength(1);
    const out = await call('POST', `/api/tire-storage/${t.body.id}/retrieve`, {});
    expect(out.body.retrieved_at).toBe(todayStockholm());
    // Platsen är ledig igen
    expect((await call('POST', '/api/tire-storage', { vehicle_id: v.id, location: 'A-12', season: 'winter' })).status).toBe(201);
  });

  it('listar fordon med kommande service och skickar påminnelse', async () => {
    const v = (await call('GET', '/api/vehicles/by-registration/SMS123')).body;
    await call('PATCH', `/api/vehicles/${v.id}`, { next_service_date: addDays(todayStockholm(), 10), inspection_due: addDays(todayStockholm(), 20) });
    const due = await call('GET', '/api/service-due?days=30');
    expect(due.body.items.map((x: { id: number }) => x.id)).toContain(v.id);
    const msg = await call('POST', `/api/vehicles/${v.id}/service-reminder`, {});
    expect(msg.body.body).toContain('service och besiktning');
  });
});
