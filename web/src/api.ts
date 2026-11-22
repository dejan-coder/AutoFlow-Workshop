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

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json();
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
