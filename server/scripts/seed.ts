/**
 * Fyller en tom databas med exempeldata så att man kan prova programmet.
 * Kör: npm run seed (efter att servern körts en gång eller npm run migrate)
 */
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';
import { createDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { addDays, todayStockholm } from '../src/lib/dates.js';

const db = createDb(config.databaseUrl);
await migrate(db);
const existing = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM customers')).rows[0].n;
if (existing > 0) {
  console.log('Databasen innehåller redan kunder. Ingen exempeldata lades till.');
  await db.end();
  process.exit(0);
}
const app = await buildApp(db);

async function api<T = { id: number }>(method: 'POST' | 'PUT' | 'PATCH', url: string, payload: object = {}): Promise<T> {
  const res = await app.inject({ method, url, payload });
  if (res.statusCode >= 400) throw new Error(`${method} ${url}: ${res.body}`);
  return res.json();
}

await api('PUT', '/api/settings', {
  company_name: 'Exempelverkstaden AB',
  org_number: '556677-8899',
  vat_number: 'SE556677889901',
  street: 'Verkstadsvägen 12',
  postal_code: '123 45',
  city: 'Exempelstad',
  phone: '010-123 45 67',
  email: 'info@exempelverkstaden.se',
  bankgiro: '123-4567',
  default_hourly_rate: 895,
  invoice_footer: 'Tack för att du valde oss! Vid frågor, ring 010-123 45 67.',
});

const sara = await api('POST', '/api/mechanics', { name: 'Sara Lind' });
const ali = await api('POST', '/api/mechanics', { name: 'Ali Hassan' });

const customers = [
  { customer_type: 'private', name: 'Anna Andersson', phone: '070-123 45 67', email: 'anna@example.com', street: 'Björkgatan 3', postal_code: '123 45', city: 'Exempelstad' },
  { customer_type: 'private', name: 'Johan Berg', phone: '073-555 12 34', street: 'Ekvägen 8', postal_code: '123 46', city: 'Exempelstad' },
  { customer_type: 'company', name: 'Berg Bygg AB', identity_number: '556036-0793', phone: '031-12 34 56', email: 'ekonomi@bergbygg.example', street: 'Industrigatan 4', postal_code: '123 50', city: 'Exempelstad' },
];
const c: { id: number }[] = [];
for (const cu of customers) c.push(await api('POST', '/api/customers', cu));

const vehicles = [
  { registration_number: 'ABC123', customer_id: c[0].id, make: 'Volvo', model: 'V70', model_year: 2012, fuel: 'diesel', mileage_km: 215000 },
  { registration_number: 'DEF45G', customer_id: c[1].id, make: 'Toyota', model: 'Corolla', model_year: 2019, fuel: 'hybrid', mileage_km: 78000 },
  { registration_number: 'XYZ45B', customer_id: c[2].id, make: 'Volkswagen', model: 'Transporter', model_year: 2021, fuel: 'diesel', mileage_km: 88000 },
  { registration_number: 'JKL789', customer_id: c[2].id, make: 'Ford', model: 'Transit', model_year: 2018, fuel: 'diesel', mileage_km: 164000 },
];
const v: { id: number }[] = [];
for (const ve of vehicles) v.push(await api('POST', '/api/vehicles', ve));

const articles = [
  { article_number: 'OL-5W30', name: 'Motorolja 5W-30', unit: 'l', purchase_price: 55, sale_price: 129, stock_quantity: 60, reorder_level: 15, location: 'A1' },
  { article_number: 'OF-100', name: 'Oljefilter', purchase_price: 68, sale_price: 189, stock_quantity: 12, reorder_level: 5, location: 'B2', supplier: 'Reservdelar AB' },
  { article_number: 'LF-200', name: 'Luftfilter', purchase_price: 95, sale_price: 249, stock_quantity: 4, reorder_level: 5, location: 'B3', supplier: 'Reservdelar AB' },
  { article_number: 'BK-FR', name: 'Bromsklossar fram', unit: 'sats', purchase_price: 390, sale_price: 895, stock_quantity: 6, reorder_level: 2, location: 'C1' },
  { article_number: 'BS-FR', name: 'Bromsskivor fram', unit: 'par', purchase_price: 720, sale_price: 1590, stock_quantity: 3, reorder_level: 2, location: 'C2' },
  { article_number: 'TV-5L', name: 'Spolarvätska 5 l', purchase_price: 30, sale_price: 79, stock_quantity: 25, reorder_level: 10, location: 'A3' },
  { article_number: 'MILJO', name: 'Miljöavgift', purchase_price: 0, sale_price: 49, track_stock: false },
];
const a: { id: number }[] = [];
for (const ar of articles) a.push(await api('POST', '/api/articles', ar));

// Avslutad och fakturerad service
const wo1 = await api('POST', '/api/work-orders', { vehicle_id: v[0].id, mechanic_id: sara.id, description: 'Service och oljebyte', mileage_km: 215400 });
await api('POST', `/api/work-orders/${wo1.id}/lines`, { line_type: 'labor', description: 'Service enligt schema', quantity: 1.5 });
await api('POST', `/api/work-orders/${wo1.id}/lines`, { line_type: 'article', article_id: a[0].id, quantity: 5.5 });
await api('POST', `/api/work-orders/${wo1.id}/lines`, { line_type: 'article', article_id: a[1].id, quantity: 1 });
await api('POST', `/api/work-orders/${wo1.id}/lines`, { line_type: 'article', article_id: a[6].id, quantity: 1 });
await api('PATCH', `/api/work-orders/${wo1.id}`, { status: 'done' });
await api('POST', '/api/invoices', { work_order_id: wo1.id, invoice_date: addDays(todayStockholm(), -3) });

// Pågående bromsjobb
const wo2 = await api('POST', '/api/work-orders', { vehicle_id: v[2].id, mechanic_id: ali.id, description: 'Gnisslar vid inbromsning', mileage_km: 88600 });
await api('POST', `/api/work-orders/${wo2.id}/lines`, { line_type: 'labor', description: 'Byte bromsklossar och skivor fram', quantity: 2 });
await api('POST', `/api/work-orders/${wo2.id}/lines`, { line_type: 'article', article_id: a[3].id, quantity: 1 });
await api('POST', `/api/work-orders/${wo2.id}/lines`, { line_type: 'article', article_id: a[4].id, quantity: 1 });
await api('PATCH', `/api/work-orders/${wo2.id}`, { status: 'in_progress' });

// Offert
const q = await api('POST', '/api/quotes', { vehicle_id: v[3].id, description: 'Byte av luftfilter och service' });
await api('POST', `/api/quotes/${q.id}/lines`, { line_type: 'labor', description: 'Service', quantity: 2 });
await api('POST', `/api/quotes/${q.id}/lines`, { line_type: 'article', article_id: a[2].id, quantity: 1 });

// Bokningar i dag och i morgon
const today = todayStockholm();
const at = (d: string, hhmm: string) => {
  const probe = new Date(`${d}T12:00:00Z`);
  const offset = new Intl.DateTimeFormat('en', { timeZone: 'Europe/Stockholm', timeZoneName: 'shortOffset' })
    .formatToParts(probe).find((p) => p.type === 'timeZoneName')!.value.replace('GMT', '') || '+0';
  const [h, m = '0'] = offset.replace('+', '').split(':');
  const sign = offset.startsWith('-') ? '-' : '+';
  return `${d}T${hhmm}:00${sign}${String(Math.abs(Number(h))).padStart(2, '0')}:${m.padStart(2, '0')}`;
};
await api('POST', '/api/bookings', { starts_at: at(today, '08:00'), duration_minutes: 60, mechanic_id: sara.id, vehicle_id: v[1].id, description: 'Däckbyte' });
await api('POST', '/api/bookings', { starts_at: at(today, '10:00'), duration_minutes: 120, mechanic_id: ali.id, vehicle_id: v[3].id, description: 'Service' });
await api('POST', '/api/bookings', { starts_at: at(addDays(today, 1), '09:00'), duration_minutes: 90, mechanic_id: sara.id, vehicle_id: v[0].id, description: 'Felsökning motorlampa' });

console.log('Exempeldata tillagd.');
await app.close();
await db.end();
