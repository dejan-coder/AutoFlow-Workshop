/**
 * SMS-leverantörer. Välj med miljövariabeln SMS_PROVIDER:
 * - "log" (standard): inget skickas, meddelandet sparas bara i historiken. Bra för test och demo.
 * - "46elks": skickar via 46elks (svensk leverantör). Kräver SMS_46ELKS_USERNAME och SMS_46ELKS_PASSWORD.
 */
export interface SmsResult {
  status: 'sent' | 'failed' | 'logged';
  provider: string;
  error?: string;
}

export interface SmsProvider {
  name: string;
  send(to: string, body: string, sender: string): Promise<SmsResult>;
}

const logProvider: SmsProvider = {
  name: 'log',
  async send() {
    return { status: 'logged', provider: 'log' };
  },
};

function elksProvider(username: string, password: string): SmsProvider {
  return {
    name: '46elks',
    async send(to, body, sender) {
      try {
        const res = await fetch('https://api.46elks.com/a1/sms', {
          method: 'POST',
          headers: {
            authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
            'content-type': 'application/x-www-form-urlencoded',
          },
          // Avsändarnamn: max 11 tecken, bokstäver och siffror
          body: new URLSearchParams({ from: sender.replace(/[^A-Za-z0-9]/g, '').slice(0, 11) || 'Verkstad', to, message: body }),
        });
        if (!res.ok) return { status: 'failed', provider: '46elks', error: `${res.status} ${await res.text()}`.slice(0, 500) };
        return { status: 'sent', provider: '46elks' };
      } catch (err) {
        return { status: 'failed', provider: '46elks', error: (err as Error).message };
      }
    },
  };
}

export function smsProviderFromEnv(env = process.env): SmsProvider {
  if (env.SMS_PROVIDER === '46elks' && env.SMS_46ELKS_USERNAME && env.SMS_46ELKS_PASSWORD) {
    return elksProvider(env.SMS_46ELKS_USERNAME, env.SMS_46ELKS_PASSWORD);
  }
  return logProvider;
}

/** 070-123 45 67 → +46701234567. Returnerar null om numret inte ser ut som ett mobilnummer. */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let p = input.replace(/[\s\-()]/g, '');
  if (p.startsWith('00')) p = `+${p.slice(2)}`;
  if (p.startsWith('0')) p = `+46${p.slice(1)}`;
  if (!/^\+\d{8,15}$/.test(p)) return null;
  return p;
}

/** Ersätter {nyckel} i en mall. Okända nycklar lämnas tomma. */
export function fillTemplate(template: string, values: Record<string, string | number | null | undefined>) {
  return template.replace(/\{([\p{L}\d_]+)\}/gu, (_, k: string) => String(values[k] ?? '')).replace(/\s{2,}/g, ' ').trim();
}
