import PDFDocument from 'pdfkit';
import type { Totals } from '../../lib/money.js';
import type { Settings } from '../settings/routes.js';

export interface PdfLine {
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  discount_percent: number;
  vat_rate: number;
  net_amount: number;
}

export interface PdfInput {
  kind: 'invoice' | 'credit' | 'quote';
  number: number;
  date: string;
  secondaryDate: string; // förfallodag eller giltig till
  customer: { name: string; identity_number?: string | null; address?: string | null };
  registration_number?: string | null;
  mileage_km?: number | null;
  description?: string | null;
  lines: PdfLine[];
  totals: Totals;
  settings: Settings;
  creditedNumber?: number | null;
}

const kr = (n: number) =>
  new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const qty = (n: number) => new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 2 }).format(n);

const TITLES = { invoice: 'Faktura', credit: 'Kreditfaktura', quote: 'Offert' };

/** Skapar en enkel A4-PDF för faktura, kreditfaktura eller offert. */
export function renderDocumentPdf(d: PdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `${TITLES[d.kind]} ${d.number}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const s = d.settings;
    const left = 50;
    const right = 545;

    // Sidhuvud
    doc.font('Helvetica-Bold').fontSize(16).text(s.company_name, left, 50);
    doc.font('Helvetica').fontSize(9).fillColor('#444');
    const companyLines = [s.street, [s.postal_code, s.city].filter(Boolean).join(' '), s.phone, s.email].filter(Boolean);
    doc.text(companyLines.join('\n'), left, 72);

    doc.fillColor('#000').font('Helvetica-Bold').fontSize(20).text(TITLES[d.kind], 330, 50, { width: 215, align: 'right' });
    doc.font('Helvetica').fontSize(10);
    const meta: [string, string][] = [
      [d.kind === 'quote' ? 'Offertnummer' : 'Fakturanummer', String(d.number)],
      [d.kind === 'quote' ? 'Datum' : 'Fakturadatum', d.date],
      [d.kind === 'quote' ? 'Giltig till' : 'Förfallodatum', d.secondaryDate],
    ];
    if (d.creditedNumber) meta.push(['Krediterar faktura', String(d.creditedNumber)]);
    if (d.registration_number) meta.push(['Regnummer', d.registration_number]);
    if (d.mileage_km != null) meta.push(['Mätarställning', `${qty(d.mileage_km)} km`]);
    let y = 80;
    for (const [k, v] of meta) {
      doc.fillColor('#555').text(k, 330, y, { width: 110 });
      doc.fillColor('#000').text(v, 440, y, { width: 105, align: 'right' });
      y += 14;
    }

    // Kund
    const custTop = Math.max(y, 140) + 10;
    doc.font('Helvetica-Bold').fontSize(10).text('Kund', left, custTop);
    doc.font('Helvetica').text(
      [d.customer.name, d.customer.address, d.customer.identity_number].filter(Boolean).join('\n'),
      left,
      custTop + 14,
    );
    y = doc.y + 10;
    if (d.description) {
      doc.font('Helvetica-Oblique').fillColor('#333').text(d.description, left, y, { width: right - left });
      y = doc.y + 10;
    }

    // Rader
    const cols = { desc: left, qty: 300, price: 370, disc: 440, sum: 470 };
    const header = () => {
      doc.fillColor('#000').font('Helvetica-Bold').fontSize(9);
      doc.text('Beskrivning', cols.desc, y);
      doc.text('Antal', cols.qty, y, { width: 60, align: 'right' });
      doc.text('À-pris', cols.price, y, { width: 65, align: 'right' });
      doc.text('Rab.', cols.disc, y, { width: 30, align: 'right' });
      doc.text('Belopp', cols.sum, y, { width: right - cols.sum, align: 'right' });
      y += 14;
      doc.moveTo(left, y - 3).lineTo(right, y - 3).strokeColor('#999').stroke();
    };
    header();
    doc.font('Helvetica').fontSize(9);
    for (const l of d.lines) {
      const h = doc.heightOfString(l.description, { width: 240 });
      if (y + h > 720) {
        doc.addPage();
        y = 50;
        header();
        doc.font('Helvetica').fontSize(9);
      }
      doc.text(l.description, cols.desc, y, { width: 240 });
      doc.text(`${qty(l.quantity)} ${l.unit}`, cols.qty, y, { width: 60, align: 'right' });
      doc.text(kr(l.unit_price), cols.price, y, { width: 65, align: 'right' });
      doc.text(l.discount_percent ? `${qty(l.discount_percent)}%` : '', cols.disc, y, { width: 30, align: 'right' });
      doc.text(kr(l.net_amount), cols.sum, y, { width: right - cols.sum, align: 'right' });
      y += Math.max(h, 12) + 4;
    }

    // Summering
    y += 6;
    doc.moveTo(330, y).lineTo(right, y).strokeColor('#999').stroke();
    y += 8;
    const sumRow = (label: string, value: string, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9);
      doc.text(label, 330, y, { width: 120 });
      doc.text(value, 450, y, { width: right - 450, align: 'right' });
      y += bold ? 18 : 13;
    };
    sumRow('Summa exkl. moms', kr(d.totals.net_amount));
    for (const r of d.totals.vat_by_rate) sumRow(`Moms ${qty(r.vat_rate)}% på ${kr(r.net_amount)}`, kr(r.vat_amount));
    if (d.totals.rounding) sumRow('Öresavrundning', kr(d.totals.rounding));
    sumRow(d.kind === 'quote' ? 'Totalt inkl. moms' : 'Att betala', `${kr(d.totals.total_amount)} kr`, true);

    // Sidfot
    const footer = [
      [s.company_name, s.org_number && `Org.nr ${s.org_number}`, s.vat_number && `Momsreg.nr ${s.vat_number}`]
        .filter(Boolean)
        .join('  ·  '),
      s.bankgiro ? `Bankgiro ${s.bankgiro}` : '',
      s.invoice_footer ?? '',
    ]
      .filter(Boolean)
      .join('\n');
    doc.font('Helvetica').fontSize(8).fillColor('#555').text(footer, left, 760, { width: right - left, align: 'center' });

    doc.end();
  });
}
