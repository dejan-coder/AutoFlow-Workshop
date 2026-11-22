import { z } from 'zod';
import { normalizeRegistration, optionalText, SWEDISH_REG } from '../../lib/validation.js';

const base = {
  registration_number: z
    .string()
    .transform(normalizeRegistration)
    .refine((v) => SWEDISH_REG.test(v), { message: 'Ogiltigt regnummer (t.ex. ABC123 eller ABC12A)' }),
  customer_id: z.number().int().positive().nullish(),
  make: optionalText,
  model: optionalText,
  model_year: z.number().int().min(1900).max(2100).nullish(),
  vin: optionalText.refine((v) => v == null || /^[A-HJ-NPR-Z0-9]{17}$/i.test(v), {
    message: 'Chassinummer (VIN) ska vara 17 tecken',
  }),
  fuel: z.enum(['petrol', 'diesel', 'electric', 'hybrid', 'plugin_hybrid', 'gas', 'other']).nullish(),
  mileage_km: z.number().int().min(0).nullish(),
  notes: z.string().max(5000).nullish(),
};

export const vehicleCreate = z.object(base).strict();
export const vehicleUpdate = z.object(base).partial().strict();

export type VehicleCreate = z.infer<typeof vehicleCreate>;
export type VehicleUpdate = z.infer<typeof vehicleUpdate>;

export const VEHICLE_FIELDS = Object.keys(base) as (keyof VehicleCreate)[];
