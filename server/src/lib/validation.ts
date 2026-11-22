import { z } from 'zod';

/** Svenska regnummer: ABC123 eller ABC12A. Mellanslag och bindestreck tas bort. */
export function normalizeRegistration(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}
export const SWEDISH_REG = /^[A-Z]{3}[0-9]{2}[A-Z0-9]$/;

/** Luhn-kontroll för personnummer (ÅÅMMDD-NNNN / ÅÅÅÅMMDDNNNN) och organisationsnummer. */
export function isValidIdentityNumber(input: string): boolean {
  let digits = input.replace(/[\s+-]/g, '');
  if (!/^\d{10}$|^\d{12}$/.test(digits)) return false;
  if (digits.length === 12) digits = digits.slice(2);
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let d = Number(digits[i]) * (i % 2 === 0 ? 2 : 1);
    if (d > 9) d -= 9;
    sum += d;
  }
  return sum % 10 === 0;
}

export const optionalText = z
  .string()
  .trim()
  .max(500)
  .transform((v) => (v === '' ? null : v))
  .nullish();

export const idParam = z.object({ id: z.coerce.number().int().positive() });

export const pagination = z.object({
  search: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
