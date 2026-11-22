export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface PricedLine {
  quantity: number;
  unit_price: number;
  discount_percent: number;
  vat_rate: number;
}

export function lineNet(l: PricedLine): number {
  return round2(l.quantity * l.unit_price * (1 - l.discount_percent / 100));
}

export interface Totals {
  net_amount: number;
  vat_amount: number;
  vat_by_rate: { vat_rate: number; net_amount: number; vat_amount: number }[];
  rounding: number;
  total_amount: number;
}

/** Summerar rader. Moms räknas per momssats; totalen avrundas till hela kronor (öresavrundning). */
export function computeTotals(lines: PricedLine[]): Totals {
  const byRate = new Map<number, number>();
  for (const l of lines) byRate.set(l.vat_rate, round2((byRate.get(l.vat_rate) ?? 0) + lineNet(l)));
  const vat_by_rate = [...byRate.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([vat_rate, net]) => ({ vat_rate, net_amount: net, vat_amount: round2((net * vat_rate) / 100) }));
  const net_amount = round2(vat_by_rate.reduce((s, r) => s + r.net_amount, 0));
  const vat_amount = round2(vat_by_rate.reduce((s, r) => s + r.vat_amount, 0));
  const exact = round2(net_amount + vat_amount);
  const total_amount = Math.round(exact);
  return { net_amount, vat_amount, vat_by_rate, rounding: round2(total_amount - exact), total_amount };
}
