import { parsePhoneNumberFromString } from 'libphonenumber-js';

export interface EnhancedPhoneIntel {
  rawInput: string;
  isValid: boolean;
  isPossible: boolean;
  e164: string;
  international: string;
  national: string;
  rfc3966: string;
  countryCode: string | null;
  callingCode: string | null;
  numberType: string;
  dorkQueries: Array<{
    label: string;
    query: string;
    duckDuckGoUrl: string;
    googleUrl: string;
  }>;
  messagingLinks: Array<{
    platform: string;
    url: string;
    note: string;
  }>;
}

/**
 * Parses an international or local phone number via libphonenumber-js,
 * outputting exact formatting variants, validity, line-type metadata,
 * multi-format web dork sweeps, and messaging footprint links.
 */
export function analyzeEnhancedPhone(
  rawInput: string,
  defaultCountry?: string
): EnhancedPhoneIntel | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  const parsed = parsePhoneNumberFromString(
    trimmed,
    defaultCountry as Parameters<typeof parsePhoneNumberFromString>[1]
  );
  if (!parsed) return null;

  const e164 = parsed.number;
  const international = parsed.formatInternational();
  const national = parsed.formatNational();
  const rfc3966 = parsed.getURI();
  const digitsOnly = e164.replace(/^\+/, '');
  const nationalDigits = parsed.nationalNumber;
  const dashedIntl = international.replace(/\s+/g, '-');
  const dottedIntl = international.replace(/\s+/g, '.');

  const combinedFormats = Array.from(
    new Set([e164, international, national, dashedIntl, nationalDigits])
  )
    .filter((v) => v.length >= 6)
    .map((v) => `"${v}"`)
    .join(' OR ');

  const dorkQueries = [
    {
      label: 'Multi-format open-web sweep',
      query: combinedFormats,
      duckDuckGoUrl: `https://duckduckgo.com/?q=${encodeURIComponent(combinedFormats)}`,
      googleUrl: `https://www.google.com/search?q=${encodeURIComponent(combinedFormats)}`,
    },
    {
      label: 'Documents, PDFs & spreadsheets',
      query: `(${combinedFormats}) (filetype:pdf OR filetype:xlsx OR filetype:docx OR filetype:csv)`,
      duckDuckGoUrl: `https://duckduckgo.com/?q=${encodeURIComponent(
        `(${combinedFormats}) (filetype:pdf OR filetype:xlsx OR filetype:docx)`
      )}`,
      googleUrl: `https://www.google.com/search?q=${encodeURIComponent(
        `(${combinedFormats}) (filetype:pdf OR filetype:xlsx OR filetype:docx)`
      )}`,
    },
    {
      label: 'Social, Telegram & classifieds',
      query: `(${combinedFormats}) (site:facebook.com OR site:linkedin.com OR site:t.me OR site:instagram.com OR site:reddit.com)`,
      duckDuckGoUrl: `https://duckduckgo.com/?q=${encodeURIComponent(
        `(${combinedFormats}) (site:linkedin.com OR site:t.me OR site:reddit.com)`
      )}`,
      googleUrl: `https://www.google.com/search?q=${encodeURIComponent(
        `(${combinedFormats}) (site:facebook.com OR site:linkedin.com OR site:t.me OR site:instagram.com)`
      )}`,
    },
    {
      label: 'Dotted / dashed registry variant',
      query: `"${dashedIntl}" OR "${dottedIntl}"`,
      duckDuckGoUrl: `https://duckduckgo.com/?q=${encodeURIComponent(
        `"${dashedIntl}" OR "${dottedIntl}"`
      )}`,
      googleUrl: `https://www.google.com/search?q=${encodeURIComponent(
        `"${dashedIntl}" OR "${dottedIntl}"`
      )}`,
    },
  ];

  const messagingLinks = [
    {
      platform: 'WhatsApp',
      url: `https://wa.me/${digitsOnly}`,
      note: 'Opens WhatsApp profile check for this E.164 number',
    },
    {
      platform: 'Telegram',
      url: `https://t.me/+${digitsOnly}`,
      note: 'Resolves public Telegram account if phone discovery is enabled',
    },
    {
      platform: 'Signal',
      url: `https://signal.me/#p/+${digitsOnly}`,
      note: 'Direct Signal contact lookup link',
    },
  ];

  return {
    rawInput: trimmed,
    isValid: parsed.isValid(),
    isPossible: parsed.isPossible(),
    e164,
    international,
    national,
    rfc3966,
    countryCode: parsed.country ?? null,
    callingCode: parsed.countryCallingCode ? `+${parsed.countryCallingCode}` : null,
    numberType: parsed.getType() ?? 'UNKNOWN',
    dorkQueries,
    messagingLinks,
  };
}
