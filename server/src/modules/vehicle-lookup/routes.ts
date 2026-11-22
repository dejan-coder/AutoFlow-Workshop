import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { normalizeRegistration, SWEDISH_REG } from '../../lib/validation.js';
import { AppError } from '../../lib/errors.js';
import { getVehicleByRegistration } from '../vehicles/repo.js';

/**
 * Fordonsuppslag på regnummer.
 *
 * Svenska fordonsuppgifter kommer från Transportstyrelsens register och säljs vidare av
 * dataleverantörer (abonnemang krävs). Programmet pratar med leverantören via en enkel adapter:
 *
 *   VEHICLE_LOOKUP_URL   t.ex. https://leverantor.example/api/vehicles/{reg}
 *   VEHICLE_LOOKUP_TOKEN skickas som "Authorization: Bearer <token>"
 *
 * Svaret mappas med fältnamnen nedan (vanliga engelska och svenska namn stöds).
 * Utan inställning letar uppslaget bara bland fordon som redan finns i registret.
 */
export interface LookupResult {
  registration_number: string;
  make: string | null;
  model: string | null;
  model_year: number | null;
  vin: string | null;
  fuel: string | null;
  source: 'local' | 'external';
  existing_vehicle_id?: number;
}

const FUEL_MAP: Record<string, string> = {
  bensin: 'petrol', petrol: 'petrol', gasoline: 'petrol',
  diesel: 'diesel',
  el: 'electric', electric: 'electric', electricity: 'electric',
  hybrid: 'hybrid', elhybrid: 'hybrid',
  laddhybrid: 'plugin_hybrid', 'plug-in hybrid': 'plugin_hybrid', plugin_hybrid: 'plugin_hybrid',
  gas: 'gas', etanol: 'other', ethanol: 'other',
};

function pick(obj: Record<string, unknown>, ...keys: string[]) {
  for (const k of keys) {
    const v = k.split('.').reduce<unknown>((o, part) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[part] : undefined), obj);
    if (v != null && v !== '') return v;
  }
  return null;
}

export function mapExternal(reg: string, data: Record<string, unknown>): LookupResult {
  const year = pick(data, 'model_year', 'modelYear', 'year', 'arsmodell', 'vehicle.model_year');
  const fuelRaw = pick(data, 'fuel', 'fuelType', 'drivmedel', 'vehicle.fuel');
  return {
    registration_number: reg,
    make: (pick(data, 'make', 'brand', 'manufacturer', 'marke', 'vehicle.make') as string) ?? null,
    model: (pick(data, 'model', 'modell', 'vehicle.model') as string) ?? null,
    model_year: year != null && !Number.isNaN(Number(year)) ? Number(year) : null,
    vin: (pick(data, 'vin', 'chassis_number', 'chassinummer', 'vehicle.vin') as string) ?? null,
    fuel: fuelRaw ? (FUEL_MAP[String(fuelRaw).toLowerCase()] ?? 'other') : null,
    source: 'external',
  };
}

export async function vehicleLookupRoutes(app: FastifyInstance) {
  const { db } = app;
  const url = process.env.VEHICLE_LOOKUP_URL;
  const token = process.env.VEHICLE_LOOKUP_TOKEN;

  app.get('/api/vehicle-lookup/status', async () => ({ external_configured: !!url }));

  app.get('/api/vehicle-lookup/:reg', async (req) => {
    const reg = normalizeRegistration(z.object({ reg: z.string() }).parse(req.params).reg);
    if (!SWEDISH_REG.test(reg)) {
      throw new AppError(400, 'validation_error', 'Ogiltigt regnummer', [{ field: 'registration_number', message: 'Ogiltigt regnummer' }]);
    }
    const local = await getVehicleByRegistration(db, reg);
    if (local) {
      return {
        registration_number: reg,
        make: local.make,
        model: local.model,
        model_year: local.model_year,
        vin: local.vin,
        fuel: local.fuel,
        source: 'local',
        existing_vehicle_id: local.id,
      } satisfies LookupResult;
    }
    if (!url) throw new AppError(404, 'not_found', 'Fordonet finns inte i registret och inget externt fordonsuppslag är inställt');
    const res = await fetch(url.replace('{reg}', encodeURIComponent(reg)), {
      headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(8000),
    }).catch((err: Error) => {
      throw new AppError(502, 'lookup_failed', `Fordonsuppslaget svarade inte: ${err.message}`);
    });
    if (res.status === 404) throw new AppError(404, 'not_found', 'Hittade inget fordon med det regnumret');
    if (!res.ok) throw new AppError(502, 'lookup_failed', `Fordonsuppslaget svarade med fel ${res.status}`);
    return mapExternal(reg, (await res.json()) as Record<string, unknown>);
  });
}
