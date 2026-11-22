export type CustomerType = 'private' | 'company';
export type Fuel = 'petrol' | 'diesel' | 'electric' | 'hybrid' | 'plugin_hybrid' | 'gas' | 'other';

export interface Customer {
  id: number;
  customer_type: CustomerType;
  name: string;
  identity_number: string | null;
  email: string | null;
  phone: string | null;
  street: string | null;
  postal_code: string | null;
  city: string | null;
  notes: string | null;
}
export interface Vehicle {
  id: number;
  registration_number: string;
  customer_id: number | null;
  customer_name: string | null;
  make: string | null;
  model: string | null;
  model_year: number | null;
  vin: string | null;
  fuel: Fuel | null;
  mileage_km: number | null;
  notes: string | null;
  next_service_date?: string | null;
  next_service_km?: number | null;
  inspection_due?: string | null;
}
export interface Page<T> {
  items: T[];
  total: number;
}

export class ApiError extends Error {
  constructor(message: string, public fields: Record<string, string> = {}) {
    super(message);
  }
}

export async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  if (res.status === 401 && !url.startsWith('/api/auth/')) dispatchEvent(new Event('af:unauthorized'));
  const data = await res.json().catch(() => ({ message: `Fel ${res.status}` }));
  if (!res.ok) {
    const fields: Record<string, string> = {};
    for (const d of data.details ?? []) fields[d.field] = d.message;
    throw new ApiError(data.message ?? 'Något gick fel', fields);
  }
  return data as T;
}

const qs = (p: Record<string, string | number | undefined>) =>
  new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined && v !== '') as [string, string][]).toString();

export const api = {
  listCustomers: (search?: string) => request<Page<Customer>>('GET', `/api/customers?${qs({ search })}`),
  getCustomer: (id: number) => request<Customer & { vehicles: Vehicle[] }>('GET', `/api/customers/${id}`),
  createCustomer: (c: Partial<Customer>) => request<Customer>('POST', '/api/customers', c),
  updateCustomer: (id: number, c: Partial<Customer>) => request<Customer>('PATCH', `/api/customers/${id}`, c),
  deleteCustomer: (id: number) => request<void>('DELETE', `/api/customers/${id}`),
  listVehicles: (search?: string) => request<Page<Vehicle>>('GET', `/api/vehicles?${qs({ search })}`),
  createVehicle: (v: Partial<Vehicle>) => request<Vehicle>('POST', '/api/vehicles', v),
  updateVehicle: (id: number, v: Partial<Vehicle>) => request<Vehicle>('PATCH', `/api/vehicles/${id}`, v),
  deleteVehicle: (id: number) => request<void>('DELETE', `/api/vehicles/${id}`),
};

export const FUEL_LABELS: Record<Fuel, string> = {
  petrol: 'Bensin',
  diesel: 'Diesel',
  electric: 'El',
  hybrid: 'Hybrid',
  plugin_hybrid: 'Laddhybrid',
  gas: 'Gas',
  other: 'Annat',
};

export const get = <T,>(url: string) => request<T>('GET', url);
export const post = <T,>(url: string, body?: unknown) => request<T>('POST', url, body ?? {});
export const patch = <T,>(url: string, body: unknown) => request<T>('PATCH', url, body);
export const put = <T,>(url: string, body: unknown) => request<T>('PUT', url, body);
export const del = (url: string) => request<void>('DELETE', url);
export { qs };

export type LineType = 'labor' | 'article' | 'other';
export interface Line {
  id: number;
  line_type: LineType;
  article_id: number | null;
  article_number: string | null;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  discount_percent: number;
  vat_rate: number;
  net_amount: number;
}
export interface Totals {
  net_amount: number;
  vat_amount: number;
  vat_by_rate: { vat_rate: number; net_amount: number; vat_amount: number }[];
  rounding: number;
  total_amount: number;
}
export type WorkOrderStatus = 'open' | 'in_progress' | 'done' | 'invoiced' | 'cancelled';
export interface WorkOrder {
  id: number;
  status: WorkOrderStatus;
  vehicle_id: number;
  customer_id: number;
  mechanic_id: number | null;
  mechanic_name: string | null;
  description: string | null;
  internal_notes: string | null;
  mileage_km: number | null;
  promised_at: string | null;
  completed_at: string | null;
  created_at: string;
  registration_number: string;
  make: string | null;
  model: string | null;
  customer_name: string;
  net_amount?: number;
  lines: Line[];
  totals: Totals;
  invoice: { id: number; invoice_number: number; status: string } | null;
}
export interface Mechanic {
  id: number;
  name: string;
  active: boolean;
}
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
export interface Booking {
  id: number;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  mechanic_id: number | null;
  mechanic_name: string | null;
  vehicle_id: number | null;
  registration_number: string | null;
  make: string | null;
  model: string | null;
  customer_id: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  description: string | null;
  status: 'booked' | 'arrived' | 'cancelled' | 'no_show';
  work_order_id: number | null;
}
export interface Quote {
  id: number;
  status: 'draft' | 'sent' | 'accepted' | 'rejected';
  customer_id: number;
  customer_name: string;
  vehicle_id: number | null;
  registration_number: string | null;
  make: string | null;
  model: string | null;
  description: string | null;
  valid_until: string;
  created_at: string;
  work_order_id: number | null;
  net_amount?: number;
  lines: Line[];
  totals: Totals;
}
export interface Invoice {
  id: number;
  invoice_number: number;
  invoice_type: 'invoice' | 'credit';
  credited_invoice_id: number | null;
  credited_invoice_number: number | null;
  work_order_id: number | null;
  customer_id: number;
  customer_name: string;
  customer_identity_number: string | null;
  customer_address: string | null;
  registration_number: string | null;
  mileage_km: number | null;
  invoice_date: string;
  due_date: string;
  status: 'unpaid' | 'paid' | 'credited';
  paid_at: string | null;
  net_amount: number;
  vat_amount: number;
  rounding: number;
  total_amount: number;
  lines: Line[];
  totals: Totals;
}
export interface Settings {
  company_name: string;
  org_number: string | null;
  vat_number: string | null;
  street: string | null;
  postal_code: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  bankgiro: string | null;
  default_hourly_rate: number;
  payment_terms_days: number;
  quote_valid_days: number;
  invoice_footer: string | null;
  sms_sender: string;
  sms_booking_template: string;
  sms_reminder_template: string;
  sms_ready_template: string;
  sms_service_template: string;
  acc_receivable: string;
  acc_bank: string;
  acc_sales_25: string;
  acc_sales_12: string;
  acc_sales_6: string;
  acc_sales_0: string;
  acc_vat_25: string;
  acc_vat_12: string;
  acc_vat_6: string;
  acc_rounding: string;
}

export type Role = 'admin' | 'office' | 'mechanic';
export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  mechanic_id: number | null;
  active?: boolean;
  last_login_at?: string | null;
}
export const ROLE_LABELS: Record<Role, string> = { admin: 'Administratör', office: 'Kontor', mechanic: 'Mekaniker' };

export interface Message {
  id: number;
  kind: string;
  to_phone: string;
  body: string;
  status: 'sent' | 'failed' | 'logged';
  error: string | null;
  customer_name: string | null;
  sent_by_name: string | null;
  created_at: string;
}

export interface TireStorage {
  id: number;
  customer_id: number;
  customer_name: string;
  customer_phone: string | null;
  vehicle_id: number | null;
  registration_number: string | null;
  location: string;
  season: 'summer' | 'winter' | 'all_season';
  tire_size: string | null;
  brand: string | null;
  tread_depth_mm: number | null;
  with_rims: boolean;
  quantity: number;
  stored_at: string;
  retrieved_at: string | null;
  notes: string | null;
}
