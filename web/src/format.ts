const krFmt = new Intl.NumberFormat('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numFmt = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 2 });

export const kr = (n: number | null | undefined) => (n == null ? '' : `${krFmt.format(n)} kr`);
export const num = (n: number | null | undefined) => (n == null ? '' : numFmt.format(n));
export const date = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date(iso)) : '';
export const time = (iso: string) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
export const dateTime = (iso: string | null | undefined) => (iso ? `${date(iso)} ${time(iso)}` : '');

export const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date());

export function addDays(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Måndag i samma vecka som datumet. */
export function mondayOf(isoDate: string) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(isoDate, -dow);
}

/** ISO-tid med Stockholms offset för ett lokalt datum och klockslag. */
export function stockholmIso(isoDate: string, hhmm: string) {
  const guess = new Date(`${isoDate}T${hhmm}:00Z`);
  const local = new Date(guess.toLocaleString('en-US', { timeZone: 'Europe/Stockholm' }));
  const utc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  const offsetMin = Math.round((local.getTime() - utc.getTime()) / 60000);
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  return `${isoDate}T${hhmm}:00${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

export const WO_STATUS: Record<string, string> = {
  open: 'Inkommen',
  in_progress: 'Pågår',
  done: 'Klar',
  invoiced: 'Fakturerad',
  cancelled: 'Makulerad',
};
export const QUOTE_STATUS: Record<string, string> = {
  draft: 'Utkast',
  sent: 'Skickad',
  accepted: 'Godkänd',
  rejected: 'Nekad',
};
export const INVOICE_STATUS: Record<string, string> = {
  unpaid: 'Obetald',
  paid: 'Betald',
  credited: 'Krediterad',
};
export const BOOKING_STATUS: Record<string, string> = {
  booked: 'Bokad',
  arrived: 'Ankommen',
  cancelled: 'Avbokad',
  no_show: 'Uteblev',
};
