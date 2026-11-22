import { z } from 'zod';
import { isValidIdentityNumber, optionalText } from '../../lib/validation.js';

const base = {
  customer_type: z.enum(['private', 'company']),
  name: z.string().trim().min(1, 'Namn krävs').max(200),
  identity_number: optionalText.refine((v) => v == null || isValidIdentityNumber(v), {
    message: 'Ogiltigt person- eller organisationsnummer',
  }),
  email: optionalText.refine((v) => v == null || z.string().email().safeParse(v).success, {
    message: 'Ogiltig e-postadress',
  }),
  phone: optionalText,
  street: optionalText,
  postal_code: optionalText,
  city: optionalText,
  notes: z.string().max(5000).nullish(),
};

export const customerCreate = z.object(base).strict();
export const customerUpdate = z.object(base).partial().strict();

export type CustomerCreate = z.infer<typeof customerCreate>;
export type CustomerUpdate = z.infer<typeof customerUpdate>;

export const CUSTOMER_FIELDS = Object.keys(base) as (keyof CustomerCreate)[];
