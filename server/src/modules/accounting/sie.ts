import { computeTotals, round2 } from '../../lib/money.js';
import type { Settings } from '../settings/routes.js';

export interface SieInvoice {
  invoice_number: number;
  invoice_type: 'invoice' | 'credit';
  invoice_date: string;
  customer_name: string;
  rounding: number;
  total_amount: number;
  lines: { quantity: number; unit_price: number; discount_percent: number; vat_rate: number }[];
}
export interface SiePayment {
  invoice_number: number;
  paid_at: string;
  customer_name: string;
  total_amount: number;
}

const ACCOUNT_NAMES: Record<string, string> = {
  acc_receivable: 'Kundfordringar',
  acc_bank: 'Företagskonto',
  acc_sales_25: 'Försäljning 25 % moms',
  acc_sales_12: 'Försäljning 12 % moms',
  acc_sales_6: 'Försäljning 6 % moms',
  acc_sales_0: 'Försäljning momsfri',
  acc_vat_25: 'Utgående moms 25 %',
  acc_vat_12: 'Utgående moms 12 %',
  acc_vat_6: 'Utgående moms 6 %',
  acc_rounding: 'Öres- och kronutjämning',
};

const amount = (n: number) => round2(n).toFixed(2);
const quote = (s: string) => `"${s.replace(/["\\]/g, '').replace(/[\r\n]+/g, ' ')}"`;
const ymd = (iso: string) => iso.replace(/-/g, '');

function salesAccount(s: Settings, rate: number) {
  return ({ 25: s.acc_sales_25, 12: s.acc_sales_12, 6: s.acc_sales_6, 0: s.acc_sales_0 } as Record<number, string>)[rate] ?? s.acc_sales_25;
}
function vatAccount(s: Settings, rate: number) {
  return ({ 25: s.acc_vat_25, 12: s.acc_vat_12, 6: s.acc_vat_6 } as Record<number, string>)[rate];
}

/**
 * Bygger en SIE 4-fil (typ 4I, verifikationer) med kundfakturor och inbetalningar.
 * Varje verifikation balanserar: kundfordran = försäljning + moms + öresavrundning.
 */
export function buildSie(opts: {
  settings: Settings;
  from: string;
  to: string;
  invoices: SieInvoice[];
  payments: SiePayment[];
  generatedAt?: Date;
}): string {
  const s = opts.settings;
  const now = opts.generatedAt ?? new Date();
  const out: string[] = [];
  out.push('#FLAGGA 0');
  out.push('#FORMAT PC8');
  out.push('#SIETYP 4');
  out.push(`#PROGRAM ${quote('AutoFlow Workshop')} 0.3`);
  out.push(`#GEN ${ymd(now.toISOString().slice(0, 10))}`);
  out.push(`#FNAMN ${quote(s.company_name)}`);
  if (s.org_number) out.push(`#ORGNR ${s.org_number.replace(/\s/g, '')}`);
  out.push(`#RAR 0 ${opts.from.slice(0, 4)}0101 ${opts.from.slice(0, 4)}1231`);
  out.push('#KPTYP BAS2014');
  const seen = new Set<string>();
  for (const [field, name] of Object.entries(ACCOUNT_NAMES)) {
    const acc = s[field as keyof Settings] as string;
    if (seen.has(acc)) continue;
    seen.add(acc);
    out.push(`#KONTO ${acc} ${quote(name)}`);
  }

  let ver = 1;
  for (const inv of opts.invoices) {
    const t = computeTotals(inv.lines);
    const label = `${inv.invoice_type === 'credit' ? 'Kreditfaktura' : 'Faktura'} ${inv.invoice_number} ${inv.customer_name}`;
    out.push(`#VER "A" ${ver++} ${ymd(inv.invoice_date)} ${quote(label)}`);
    out.push('{');
    out.push(`   #TRANS ${s.acc_receivable} {} ${amount(inv.total_amount)}`);
    for (const r of t.vat_by_rate) {
      out.push(`   #TRANS ${salesAccount(s, r.vat_rate)} {} ${amount(-r.net_amount)}`);
      const vatAcc = vatAccount(s, r.vat_rate);
      if (vatAcc && r.vat_amount) out.push(`   #TRANS ${vatAcc} {} ${amount(-r.vat_amount)}`);
    }
    if (inv.rounding) out.push(`   #TRANS ${s.acc_rounding} {} ${amount(-inv.rounding)}`);
    out.push('}');
  }
  for (const p of opts.payments) {
    out.push(`#VER "B" ${ver++} ${ymd(p.paid_at)} ${quote(`Inbetalning faktura ${p.invoice_number} ${p.customer_name}`)}`);
    out.push('{');
    out.push(`   #TRANS ${s.acc_bank} {} ${amount(p.total_amount)}`);
    out.push(`   #TRANS ${s.acc_receivable} {} ${amount(-p.total_amount)}`);
    out.push('}');
  }
  return out.join('\r\n') + '\r\n';
}

// SIE-filer ska vara kodade i IBM PC 8-bitars teckentabell (CP437)
const CP437: Record<string, number> = {
  Ç: 0x80, ü: 0x81, é: 0x82, â: 0x83, ä: 0x84, à: 0x85, å: 0x86, ç: 0x87, ê: 0x88, ë: 0x89, è: 0x8a,
  ï: 0x8b, î: 0x8c, ì: 0x8d, Ä: 0x8e, Å: 0x8f, É: 0x90, æ: 0x91, Æ: 0x92, ô: 0x93, ö: 0x94, ò: 0x95,
  û: 0x96, ù: 0x97, ÿ: 0x98, Ö: 0x99, Ü: 0x9a, á: 0xa0, í: 0xa1, ó: 0xa2, ú: 0xa3, ñ: 0xa4, Ñ: 0xa5,
};
export function toCp437(text: string): Buffer {
  const bytes: number[] = [];
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 0x80) bytes.push(code);
    else bytes.push(CP437[ch] ?? 0x3f); // '?' för tecken som saknas
  }
  return Buffer.from(bytes);
}
