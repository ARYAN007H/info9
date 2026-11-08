import { parsePhoneNumberClue, type ParsedPhoneClue } from './clueParser';

/**
 * Pure, RFC 1321 synchronous MD5 hex digest implementation.
 * Used exclusively to compute deterministic Gravatar avatar hashes
 * (`md5(email.trim().toLowerCase())`) in the browser and CLI without external dependencies.
 */
export function md5HexSync(input: string): string {
  const encoder = new TextEncoder();
  const msg = encoder.encode(input);
  const bitLen = msg.length * 8;
  const padLen = (((msg.length + 8) >>> 6) + 1) << 6;
  const buf = new Uint8Array(padLen);
  buf.set(msg);
  buf[msg.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(padLen - 8, bitLen >>> 0, true);
  view.setUint32(padLen - 4, Math.floor(bitLen / 0x100000000), true);

  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) {
    K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
  }

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const rotl = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0;

  for (let offset = 0; offset < padLen; offset += 64) {
    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;

    for (let i = 0; i < 64; i++) {
      let F = 0;
      let g = 0;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      const word = view.getUint32(offset + g * 4, true);
      const sum = (A + F + K[i] + word) >>> 0;
      A = D;
      D = C;
      C = B;
      B = (B + rotl(sum, S[i])) >>> 0;
    }

    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const out = new Uint8Array(16);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, a0, true);
  outView.setUint32(4, b0, true);
  outView.setUint32(8, c0, true);
  outView.setUint32(12, d0, true);
  return Array.from(out)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const FREE_PROVIDERS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'icloud.com',
  'proton.me',
  'protonmail.com',
  'tutanota.com',
  'tutamail.com',
  'yandex.ru',
  'yandex.com',
  'mail.ru',
  'gmx.com',
  'gmx.de',
  'aol.com',
  'zoho.com',
  'fastmail.com',
]);

const DISPOSABLE_PROVIDERS = new Set([
  'mailinator.com',
  'guerrillamail.com',
  '10minutemail.com',
  'tempmail.com',
  'yopmail.com',
  'sharklasers.com',
  'trashmail.com',
  'getnada.com',
]);

export interface EmailReconProfile {
  email: string;
  localPart: string;
  domain: string;
  subaddressTag: string | null;
  canonicalLocalPart: string;
  providerClass: 'corporate_custom' | 'free_webmail' | 'privacy_encrypted' | 'disposable_temp';
  gravatarMd5: string;
  gravatarAvatarUrl: string;
  openPgpLookupUrl: string;
  githubSearchUrl: string;
  pivotHandles: string[];
}

export function analyzeEmailClue(rawEmail: string): EmailReconProfile | null {
  const cleaned = rawEmail.trim().toLowerCase();
  const m = cleaned.match(/^([^\s@]+)@((?:[a-z0-9-]+\.)+[a-z]{2,})$/i);
  if (!m) return null;

  const localPart = m[1];
  const domain = m[2];
  const plusIndex = localPart.indexOf('+');
  const subaddressTag = plusIndex >= 0 ? localPart.slice(plusIndex + 1) : null;
  const baseLocal = plusIndex >= 0 ? localPart.slice(0, plusIndex) : localPart;
  const canonicalLocalPart =
    domain === 'gmail.com' || domain === 'googlemail.com'
      ? baseLocal.replace(/\./g, '')
      : baseLocal;

  let providerClass: EmailReconProfile['providerClass'] = 'corporate_custom';
  if (DISPOSABLE_PROVIDERS.has(domain)) {
    providerClass = 'disposable_temp';
  } else if (
    domain === 'proton.me' ||
    domain === 'protonmail.com' ||
    domain === 'tutanota.com' ||
    domain === 'tutamail.com'
  ) {
    providerClass = 'privacy_encrypted';
  } else if (FREE_PROVIDERS.has(domain)) {
    providerClass = 'free_webmail';
  }

  const gravatarMd5 = md5HexSync(cleaned);
  const gravatarAvatarUrl = `https://www.gravatar.com/avatar/${gravatarMd5}?d=404&s=240`;
  const openPgpLookupUrl = `https://keys.openpgp.org/vks/v1/by-email/${encodeURIComponent(
    cleaned
  )}`;
  const githubSearchUrl = `https://api.github.com/search/users?q=${encodeURIComponent(
    `${cleaned} in:email`
  )}`;

  const handles = new Set<string>();
  handles.add(baseLocal);
  if (canonicalLocalPart !== baseLocal) handles.add(canonicalLocalPart);
  if (baseLocal.includes('.')) handles.add(baseLocal.replace(/\./g, '_'));

  return {
    email: cleaned,
    localPart,
    domain,
    subaddressTag,
    canonicalLocalPart,
    providerClass,
    gravatarMd5,
    gravatarAvatarUrl,
    openPgpLookupUrl,
    githubSearchUrl,
    pivotHandles: Array.from(handles),
  };
}

/**
 * Extracts numeric UTC offset hours from a timezone string like "UTC-5", "UTC+5:30 (IST)", "UTC+0 / BST".
 */
export function parseUtcOffsetHours(tzString: string): number {
  const m = tzString.match(/UTC([+-]\d{1,2})(?::(\d{2}))?/i);
  if (!m) return 0;
  const sign = m[1].startsWith('-') ? -1 : 1;
  const hours = Math.abs(parseInt(m[1], 10));
  const mins = m[2] ? parseInt(m[2], 10) / 60 : 0;
  return sign * (hours + mins);
}

export interface PhoneTimezoneOverlap {
  primaryPhone: ParsedPhoneClue;
  secondaryPhone: ParsedPhoneClue | null;
  primaryUtcOffset: number;
  secondaryUtcOffset: number | null;
  /** UTC hours (0..23) where both parties are within normal waking hours (08:00–22:00 local) */
  overlappingWakingUtcHours: number[];
  /** UTC hours (0..23) where both parties are within standard business hours (09:00–18:00 local) */
  overlappingBusinessUtcHours: number[];
  verificationLinks: Array<{ label: string; url: string }>;
}

/**
 * Computes waking-hour (08:00–22:00 local) and business-hour (09:00–18:00 local)
 * UTC windows for one or two international phone numbers.
 */
export function analyzePhoneTimezoneOverlap(
  primaryRaw: string,
  secondaryRaw?: string
): PhoneTimezoneOverlap | null {
  const p1 = parsePhoneNumberClue(primaryRaw);
  if (!p1) return null;
  const p2 = secondaryRaw?.trim() ? parsePhoneNumberClue(secondaryRaw) : null;

  const off1 = parseUtcOffsetHours(p1.timezoneUtc);
  const off2 = p2 ? parseUtcOffsetHours(p2.timezoneUtc) : null;

  const inLocalWindow = (utcHour: number, offset: number, start: number, end: number) => {
    const local = (((utcHour + offset) % 24) + 24) % 24;
    return local >= start && local < end;
  };

  const overlappingWakingUtcHours: number[] = [];
  const overlappingBusinessUtcHours: number[] = [];

  for (let h = 0; h < 24; h++) {
    const w1 = inLocalWindow(h, off1, 8, 22);
    const w2 = off2 === null ? true : inLocalWindow(h, off2, 8, 22);
    if (w1 && w2) overlappingWakingUtcHours.push(h);

    const b1 = inLocalWindow(h, off1, 9, 18);
    const b2 = off2 === null ? true : inLocalWindow(h, off2, 9, 18);
    if (b1 && b2) overlappingBusinessUtcHours.push(h);
  }

  const digitsOnly = p1.normalizedDigits.replace(/^\+/, '');
  return {
    primaryPhone: p1,
    secondaryPhone: p2,
    primaryUtcOffset: off1,
    secondaryUtcOffset: off2,
    overlappingWakingUtcHours,
    overlappingBusinessUtcHours,
    verificationLinks: [
      {
        label: 'WhatsApp direct check',
        url: `https://wa.me/${digitsOnly}`,
      },
      {
        label: 'Telegram phone link',
        url: `https://t.me/+${digitsOnly}`,
      },
    ],
  };
}
