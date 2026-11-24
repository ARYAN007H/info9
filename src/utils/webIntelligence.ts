import type { ExtractedPageArtifacts } from '../types/osint';

/**
 * Pure web intelligence extraction, Shodan-compatible MurmurHash3-32 favicon
 * hashing, and automated OSINT Dork Matrix generation.
 */

const EMAIL_RE = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,18}\b/gi;
const PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s.-]\d{3,4}[\s.-]\d{3,4}\b/g;
const BTC_RE = /\b(?:bc1[a-z0-9]{25,59}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/g;
const ETH_RE = /\b0x[a-fA-F0-9]{40}\b/g;
const TRC20_RE = /\bT[A-Za-z1-9]{33}\b/g;
const GA4_RE = /\bG-[A-Z0-9]{7,12}\b/g;
const UA_RE = /\bUA-\d{4,10}-\d{1,4}\b/g;
const GTM_RE = /\bGTM-[A-Z0-9]{5,10}\b/g;
const ADSENSE_RE = /\b(?:ca-)?pub-\d{10,18}\b/gi;
const HREF_RE = /\b(?:href|src)\s*=\s*["']([^"'#]+)["']/gi;
const HANDLE_RE = /(?:^|[\s(])@([a-z0-9_][a-z0-9._-]{2,29})\b/gi;

const IGNORED_EMAIL_EXTENSIONS = /\.(png|jpg|jpeg|gif|svg|webp|css|js|woff2?)$/i;

const SOCIAL_PATTERNS: Array<{ platform: string; regex: RegExp }> = [
  { platform: 'GitHub', regex: /^https?:\/\/(?:www\.)?github\.com\/([a-z0-9_-]{1,39})(?:\/|$)/i },
  { platform: 'GitLab', regex: /^https?:\/\/(?:www\.)?gitlab\.com\/([a-z0-9._-]{1,40})(?:\/|$)/i },
  { platform: 'X / Twitter', regex: /^https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/([a-z0-9_]{1,20})(?:\/|$)/i },
  { platform: 'LinkedIn', regex: /^https?:\/\/(?:www\.)?linkedin\.com\/(?:in|company)\/([a-z0-9._%-]+)(?:\/|$)/i },
  { platform: 'Telegram', regex: /^https?:\/\/(?:t\.me|telegram\.me)\/(?:s\/)?([a-z0-9_]{3,32})(?:\/|$)/i },
  { platform: 'Bluesky', regex: /^https?:\/\/bsky\.app\/profile\/([a-z0-9._-]+)(?:\/|$)/i },
  { platform: 'Reddit', regex: /^https?:\/\/(?:www\.)?reddit\.com\/(?:u|user|r)\/([a-z0-9_-]+)(?:\/|$)/i },
  { platform: 'YouTube', regex: /^https?:\/\/(?:www\.)?youtube\.com\/(?:@|c\/|channel\/)([a-z0-9._-]+)(?:\/|$)/i },
  { platform: 'Mastodon', regex: /^https?:\/\/[a-z0-9.-]+\/@([a-z0-9_]+)(?:\/|$)/i },
];

const RESERVED_HANDLES = new Set([
  'import',
  'media',
  'keyframes',
  'font-face',
  'supports',
  'charset',
  'layer',
  'context',
  'type',
  'id',
  'graph',
  'param',
  'return',
]);

export function stripHtmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMetaContent(html: string, nameOrProp: string): string | null {
  const escaped = nameOrProp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re1 = new RegExp(
    `<meta[^>]+(?:name|property)\\s*=\\s*["']${escaped}["'][^>]+content\\s*=\\s*["']([^"']+)["']`,
    'i'
  );
  const re2 = new RegExp(
    `<meta[^>]+content\\s*=\\s*["']([^"']+)["'][^>]+(?:name|property)\\s*=\\s*["']${escaped}["']`,
    'i'
  );
  const m = html.match(re1) || html.match(re2);
  return m ? m[1].trim() : null;
}

export function extractFaviconHref(html: string, baseUrl: string): string | null {
  const linkMatch =
    html.match(
      /<link[^>]+rel\s*=\s*["'][^"']*icon[^"']*["'][^>]+href\s*=\s*["']([^"']+)["']/i
    ) ||
    html.match(
      /<link[^>]+href\s*=\s*["']([^"']+)["'][^>]+rel\s*=\s*["'][^"']*icon[^"']*["']/i
    );
  try {
    if (linkMatch?.[1]) {
      return new URL(linkMatch[1].trim(), baseUrl).toString();
    }
    return new URL('/favicon.ico', baseUrl).toString();
  } catch {
    return null;
  }
}

export function extractHtmlMetadata(html: string): {
  title: string;
  description: string;
  metaAuthor: string | null;
  metaGenerator: string | null;
} {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch
    ? stripHtmlToText(titleMatch[1]).slice(0, 220)
    : extractMetaContent(html, 'og:title') || '';
  const description =
    extractMetaContent(html, 'description') ||
    extractMetaContent(html, 'og:description') ||
    '';
  const metaAuthor =
    extractMetaContent(html, 'author') ||
    extractMetaContent(html, 'article:author') ||
    null;
  const metaGenerator = extractMetaContent(html, 'generator') || null;
  return { title, description, metaAuthor, metaGenerator };
}

export function extractPageArtifacts(
  html: string,
  baseUrl: string,
  faviconHash: number | null = null,
  faviconUrl: string | null = null
): ExtractedPageArtifacts {
  let baseDomain = '';
  try {
    baseDomain = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    // keep empty
  }

  const text = stripHtmlToText(html);
  const meta = extractHtmlMetadata(html);

  const emailSet = new Set<string>();
  for (const m of (html + ' ' + text).match(EMAIL_RE) || []) {
    const clean = m.toLowerCase();
    if (!IGNORED_EMAIL_EXTENSIONS.test(clean) && clean.length <= 120) {
      emailSet.add(clean);
    }
  }

  const phoneSet = new Set<string>();
  for (const m of text.match(PHONE_RE) || []) {
    const digits = m.replace(/\D/g, '');
    if (digits.length >= 9 && digits.length <= 15 && !/^(19|20)\d{2}/.test(digits)) {
      phoneSet.add(m.trim());
    }
  }

  const handleSet = new Set<string>();
  let hm: RegExpExecArray | null;
  HANDLE_RE.lastIndex = 0;
  while ((hm = HANDLE_RE.exec(text)) !== null) {
    const candidate = hm[1].toLowerCase();
    if (!RESERVED_HANDLES.has(candidate) && !candidate.includes('..')) {
      handleSet.add(candidate);
    }
  }

  const walletsMap = new Map<string, { chain: 'BTC' | 'ETH' | 'TRC20'; address: string }>();
  for (const m of text.match(ETH_RE) || []) {
    walletsMap.set(`ETH:${m.toLowerCase()}`, { chain: 'ETH', address: m });
  }
  for (const m of text.match(BTC_RE) || []) {
    // Avoid matching hex hashes or long numeric strings
    if (!/^[0-9]+$/.test(m) && !/^[a-f0-9]+$/i.test(m)) {
      walletsMap.set(`BTC:${m}`, { chain: 'BTC', address: m });
    }
  }
  for (const m of text.match(TRC20_RE) || []) {
    if (/[a-z]/.test(m) && /[0-9]/.test(m)) {
      walletsMap.set(`TRC20:${m}`, { chain: 'TRC20', address: m });
    }
  }

  const analyticsMap = new Map<
    string,
    { kind: 'GA4' | 'UA' | 'GTM' | 'ADSENSE'; id: string }
  >();
  for (const m of html.match(GA4_RE) || []) {
    analyticsMap.set(`GA4:${m}`, { kind: 'GA4', id: m });
  }
  for (const m of html.match(UA_RE) || []) {
    analyticsMap.set(`UA:${m}`, { kind: 'UA', id: m });
  }
  for (const m of html.match(GTM_RE) || []) {
    analyticsMap.set(`GTM:${m}`, { kind: 'GTM', id: m });
  }
  for (const m of html.match(ADSENSE_RE) || []) {
    const clean = m.toLowerCase();
    analyticsMap.set(`ADSENSE:${clean}`, { kind: 'ADSENSE', id: clean });
  }

  const outboundDomains = new Set<string>();
  const socialLinksMap = new Map<
    string,
    { platform: string; url: string; handle?: string }
  >();

  HREF_RE.lastIndex = 0;
  let lm: RegExpExecArray | null;
  while ((lm = HREF_RE.exec(html)) !== null) {
    const rawLink = lm[1].trim();
    if (!rawLink || /^(javascript|data|mailto|tel):/i.test(rawLink)) continue;
    try {
      const resolved = new URL(rawLink, baseUrl);
      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') continue;
      const host = resolved.hostname.toLowerCase();
      if (host && host !== baseDomain && !host.endsWith(`.${baseDomain}`)) {
        outboundDomains.add(host);
      }
      const hrefStr = resolved.toString();
      for (const sp of SOCIAL_PATTERNS) {
        const sm = hrefStr.match(sp.regex);
        if (sm) {
          const handle = sm[1];
          if (
            handle &&
            !['share', 'intent', 'sharer', 'home', 'search', 'login', 'signup', 'about', 'features'].includes(
              handle.toLowerCase()
            )
          ) {
            socialLinksMap.set(`${sp.platform}:${handle.toLowerCase()}`, {
              platform: sp.platform,
              url: hrefStr,
              handle,
            });
            handleSet.add(handle.toLowerCase());
          }
          break;
        }
      }
    } catch {
      // Ignore invalid relative URLs
    }
  }

  return {
    emails: Array.from(emailSet).slice(0, 30),
    phones: Array.from(phoneSet).slice(0, 20),
    handles: Array.from(handleSet).slice(0, 25),
    cryptoWallets: Array.from(walletsMap.values()).slice(0, 20),
    analyticsIds: Array.from(analyticsMap.values()).slice(0, 20),
    outboundDomains: Array.from(outboundDomains).slice(0, 40),
    socialLinks: Array.from(socialLinksMap.values()).slice(0, 20),
    metaAuthor: meta.metaAuthor,
    metaGenerator: meta.metaGenerator,
    faviconHash,
    faviconUrl: faviconUrl ?? extractFaviconHref(html, baseUrl),
  };
}

/**
 * Pure 32-bit MurmurHash3 (x86_32) returning a signed 32-bit integer,
 * matching Python mmh3.hash() used by Shodan's `http.favicon.hash`.
 */
export function murmurHash3_32(data: Uint8Array, seed = 0): number {
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
  const len = data.length;
  let h1 = seed >>> 0;
  const nblocks = Math.floor(len / 4);

  for (let i = 0; i < nblocks; i++) {
    const idx = i * 4;
    let k1 =
      (data[idx] & 0xff) |
      ((data[idx + 1] & 0xff) << 8) |
      ((data[idx + 2] & 0xff) << 16) |
      ((data[idx + 3] & 0xff) << 24);

    k1 = Math.imul(k1, c1);
    k1 = (k1 << 15) | (k1 >>> 17);
    k1 = Math.imul(k1, c2);

    h1 ^= k1;
    h1 = (h1 << 13) | (h1 >>> 19);
    h1 = (Math.imul(h1, 5) + 0xe6546b64) | 0;
  }

  let k1 = 0;
  const tail = nblocks * 4;
  switch (len & 3) {
    case 3:
      k1 ^= (data[tail + 2] & 0xff) << 16;
    // falls through
    case 2:
      k1 ^= (data[tail + 1] & 0xff) << 8;
    // falls through
    case 1:
      k1 ^= data[tail] & 0xff;
      k1 = Math.imul(k1, c1);
      k1 = (k1 << 15) | (k1 >>> 17);
      k1 = Math.imul(k1, c2);
      h1 ^= k1;
  }

  h1 ^= len;
  h1 ^= h1 >>> 16;
  h1 = Math.imul(h1, 0x85ebca6b);
  h1 ^= h1 >>> 13;
  h1 = Math.imul(h1, 0xc2b2ae35);
  h1 ^= h1 >>> 16;

  // Return signed 32-bit integer to match Shodan http.favicon.hash
  return h1 | 0;
}

/**
 * Computes Shodan-compatible `http.favicon.hash`:
 * Base64 encodes raw bytes with RFC 2045 76-char line breaks + trailing `\n`
 * (matching Python `codecs.encode(raw, "base64")`), then runs MurmurHash3_32.
 */
export function computeShodanFaviconHash(rawBytes: Uint8Array): number {
  let binary = '';
  for (let i = 0; i < rawBytes.length; i++) {
    binary += String.fromCharCode(rawBytes[i]);
  }
  const b64 =
    typeof Buffer !== 'undefined'
      ? Buffer.from(rawBytes).toString('base64')
      : btoa(binary);
  const wrapped = b64.replace(/.{1,76}/g, '$&\n');
  const encoded = new TextEncoder().encode(wrapped);
  return murmurHash3_32(encoded, 0);
}

export interface DorkEntry {
  id: string;
  category:
    | 'Documents & Filings'
    | 'Exposed Directories'
    | 'Paste & Leak Mentions'
    | 'Courts & Government'
    | 'Code & Repositories'
    | 'Social & Messaging';
  label: string;
  query: string;
  duckDuckGoUrl: string;
  googleUrl: string;
}

export function buildDorkMatrix(rawTarget: string): DorkEntry[] {
  const clean = rawTarget.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (!clean) return [];

  const isDomain = /^[a-z0-9.-]+\.[a-z]{2,18}$/i.test(clean) && !clean.includes(' ');
  const quoted = `"${clean}"`;

  const rawDorks: Array<{
    id: string;
    category: DorkEntry['category'];
    label: string;
    query: string;
  }> = isDomain
    ? [
        {
          id: 'doc-office',
          category: 'Documents & Filings',
          label: 'PDF, Excel & Word documents on domain',
          query: `site:${clean} (filetype:pdf OR filetype:xlsx OR filetype:docx OR filetype:csv)`,
        },
        {
          id: 'doc-presentations',
          category: 'Documents & Filings',
          label: 'Presentations & financial reports',
          query: `site:${clean} (filetype:pptx OR filetype:ppt OR "annual report" OR "financial statement")`,
        },
        {
          id: 'dir-index',
          category: 'Exposed Directories',
          label: 'Open directory listings & backups',
          query: `site:${clean} ("index of /" OR intitle:"index of" OR filetype:log OR filetype:sql)`,
        },
        {
          id: 'dir-subdomains',
          category: 'Exposed Directories',
          label: 'Non-www subdomains & staging hosts',
          query: `site:*.${clean} -site:www.${clean}`,
        },
        {
          id: 'paste-mentions',
          category: 'Paste & Leak Mentions',
          label: 'Paste sites & public snippet mentions',
          query: `(site:pastebin.com OR site:ghostbin.co OR site:dpaste.org OR site:rentry.co) ${quoted}`,
        },
        {
          id: 'gov-courts',
          category: 'Courts & Government',
          label: 'Government, SEC & court docket mentions',
          query: `(site:gov OR site:courtlistener.com OR site:sec.gov OR site:europa.eu) ${quoted}`,
        },
        {
          id: 'code-repos',
          category: 'Code & Repositories',
          label: 'GitHub / GitLab public code references',
          query: `(site:github.com OR site:gitlab.com OR site:gist.github.com) ${quoted}`,
        },
        {
          id: 'social-tg',
          category: 'Social & Messaging',
          label: 'Telegram public channels & Reddit mentions',
          query: `(site:t.me/s OR site:reddit.com OR site:news.ycombinator.com) ${quoted}`,
        },
      ]
    : [
        {
          id: 'doc-person',
          category: 'Documents & Filings',
          label: 'Public PDFs, spreadsheets & memos',
          query: `${quoted} (filetype:pdf OR filetype:xlsx OR filetype:docx)`,
        },
        {
          id: 'gov-filings',
          category: 'Courts & Government',
          label: 'Regulatory filings, courts & sanctions notices',
          query: `${quoted} (site:sec.gov OR site:courtlistener.com OR site:justice.gov OR site:treasury.gov OR site:gov.uk)`,
        },
        {
          id: 'offshore-corp',
          category: 'Courts & Government',
          label: 'Corporate registries & offshore leak indexes',
          query: `${quoted} (site:offshoreleaks.icij.org OR site:opencorporates.com OR site:find-and-update.company-information.service.gov.uk)`,
        },
        {
          id: 'paste-mentions',
          category: 'Paste & Leak Mentions',
          label: 'Paste sites & public dumps',
          query: `${quoted} (site:pastebin.com OR site:gist.github.com OR site:archive.org)`,
        },
        {
          id: 'code-mentions',
          category: 'Code & Repositories',
          label: 'GitHub / GitLab commits & profiles',
          query: `${quoted} (site:github.com OR site:gitlab.com)`,
        },
        {
          id: 'social-channels',
          category: 'Social & Messaging',
          label: 'Telegram previews, Reddit, Bluesky & LinkedIn',
          query: `${quoted} (site:t.me/s OR site:reddit.com OR site:bsky.app OR site:linkedin.com)`,
        },
      ];

  return rawDorks.map((d) => ({
    ...d,
    duckDuckGoUrl: `https://duckduckgo.com/?q=${encodeURIComponent(d.query)}`,
    googleUrl: `https://www.google.com/search?q=${encodeURIComponent(d.query)}`,
  }));
}
