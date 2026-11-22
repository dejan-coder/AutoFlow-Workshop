import { describe, expect, it } from 'vitest';
import { addDays } from '../src/lib/dates.js';
import { computeTotals, lineNet } from '../src/lib/money.js';

describe('belopp', () => {
  it('räknar radbelopp med rabatt', () => {
    expect(lineNet({ quantity: 1.5, unit_price: 950, discount_percent: 10, vat_rate: 25 })).toBe(1282.5);
  });

  it('summerar moms per momssats och öresavrundar', () => {
    const t = computeTotals([
      { quantity: 1, unit_price: 99.9, discount_percent: 0, vat_rate: 25 },
      { quantity: 2, unit_price: 10.05, discount_percent: 0, vat_rate: 12 },
    ]);
    expect(t.net_amount).toBe(120);
    expect(t.vat_by_rate).toEqual([
      { vat_rate: 25, net_amount: 99.9, vat_amount: 24.98 },
      { vat_rate: 12, net_amount: 20.1, vat_amount: 2.41 },
    ]);
    expect(t.vat_amount).toBe(27.39);
    expect(t.total_amount).toBe(147);
    expect(t.rounding).toBe(-0.39);
  });

  it('lägger till dagar över månadsskifte', () => {
    expect(addDays('2026-11-22', 30)).toBe('2026-12-22');
    expect(addDays('2026-12-15', 30)).toBe('2027-01-14');
  });
});
