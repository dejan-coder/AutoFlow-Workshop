import { describe, expect, it } from 'vitest';
import { isValidIdentityNumber, normalizeRegistration, SWEDISH_REG } from '../src/lib/validation.js';

describe('validering', () => {
  it('normaliserar regnummer', () => {
    expect(normalizeRegistration('abc 123')).toBe('ABC123');
    expect(normalizeRegistration('abc-12a')).toBe('ABC12A');
  });
  it('godkänner svenska regnummer', () => {
    expect(SWEDISH_REG.test('ABC123')).toBe(true);
    expect(SWEDISH_REG.test('ABC12A')).toBe(true);
    expect(SWEDISH_REG.test('AB1234')).toBe(false);
  });
  it('kontrollerar personnummer och organisationsnummer med Luhn', () => {
    expect(isValidIdentityNumber('811218-9876')).toBe(true);
    expect(isValidIdentityNumber('19811218-9876')).toBe(true);
    expect(isValidIdentityNumber('556036-0793')).toBe(true);
    expect(isValidIdentityNumber('811218-9877')).toBe(false);
  });
});
