import dns from 'node:dns/promises';
import net from 'node:net';

/**
 * Strict SSRF guard for server-side OSINT page fetchers.
 * Blocks non-http(s) schemes, credentials-in-URL, loopback, RFC1918,
 * link-local / cloud metadata (169.254.169.254), CGNAT, and IPv6 private space,
 * validating both hostnames AND resolved DNS IP addresses across redirects.
 */

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata',
  'instance-data',
]);

export function isPrivateOrReservedIp(ip: string): boolean {
  const clean = ip.trim().replace(/^\[|\]$/g, '').toLowerCase();
  if (!clean) return true;

  // Handle IPv4-mapped IPv6 addresses like ::ffff:127.0.0.1
  if (clean.startsWith('::ffff:')) {
    const v4 = clean.slice(7);
    if (net.isIPv4(v4)) return isPrivateOrReservedIp(v4);
  }

  if (net.isIPv4(clean)) {
    const parts = clean.split('.').map(Number);
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
      return true;
    }
    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local & cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }

  if (net.isIPv6(clean)) {
    if (clean === '::' || clean === '::1') return true;
    if (clean.startsWith('fc') || clean.startsWith('fd')) return true; // ULA fc00::/7
    if (clean.startsWith('fe8') || clean.startsWith('fe9') || clean.startsWith('fea') || clean.startsWith('feb')) {
      return true; // link-local fe80::/10
    }
    if (clean.startsWith('ff')) return true; // multicast
    return false;
  }

  return true;
}

export function validatePublicUrlSyntax(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('Malformed URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http:// and https:// URLs are permitted');
  }
  if (parsed.username || parsed.password) {
    throw new Error('URLs with embedded credentials are not permitted');
  }
  const host = parsed.hostname.toLowerCase();
  if (
    !host ||
    BLOCKED_HOSTNAMES.has(host) ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localhost')
  ) {
    throw new Error('Private or internal hostnames are blocked');
  }
  if (net.isIP(host) && isPrivateOrReservedIp(host)) {
    throw new Error('Private, loopback, or metadata IP addresses are blocked');
  }
  return parsed;
}

export async function assertSafePublicUrl(rawUrl: string): Promise<URL> {
  const parsed = validatePublicUrlSyntax(rawUrl);
  const host = parsed.hostname;

  if (net.isIP(host)) {
    if (isPrivateOrReservedIp(host)) {
      throw new Error('Private or reserved IP address blocked');
    }
    return parsed;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error(`DNS resolution failed for host "${host}"`);
  }

  if (!addresses || addresses.length === 0) {
    throw new Error(`Host "${host}" resolved to no IP addresses`);
  }
  for (const rec of addresses) {
    if (isPrivateOrReservedIp(rec.address)) {
      throw new Error(`Host "${host}" resolved to a private/reserved network address`);
    }
  }
  return parsed;
}

export interface SafeFetchResult {
  finalUrl: string;
  status: number;
  contentType: string;
  headers: Record<string, string>;
  body: Buffer;
}

/**
 * Fetches a public URL safely with per-redirect SSRF re-validation, timeout,
 * and strict maximum body byte cap.
 */
export async function safePublicFetch(
  rawUrl: string,
  options: {
    timeoutMs?: number;
    maxBytes?: number;
    accept?: string;
    maxRedirects?: number;
  } = {}
): Promise<SafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? 12_000;
  const maxBytes = options.maxBytes ?? 1_500_000;
  const maxRedirects = options.maxRedirects ?? 4;
  const accept =
    options.accept ?? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

  let currentUrl = rawUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const validated = await assertSafePublicUrl(currentUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(validated.toString(), {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; info9-OSINT-Workbench/2.0; +https://github.com/ARYAN007H/info9)',
          Accept: accept,
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        clearTimeout(timer);
        if (!location) {
          throw new Error(`HTTP ${res.status} redirect with no Location header`);
        }
        currentUrl = new URL(location, validated.toString()).toString();
        continue;
      }

      const chunks: Uint8Array[] = [];
      let total = 0;
      const reader = res.body?.getReader();
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            total += value.byteLength;
            if (total > maxBytes) {
              const allowed = maxBytes - (total - value.byteLength);
              if (allowed > 0) chunks.push(value.subarray(0, allowed));
              await reader.cancel().catch(() => {});
              break;
            }
            chunks.push(value);
          }
        }
      }
      clearTimeout(timer);

      const headerObj: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headerObj[k.toLowerCase()] = v;
      });

      return {
        finalUrl: validated.toString(),
        status: res.status,
        contentType: headerObj['content-type'] || '',
        headers: headerObj,
        body: Buffer.concat(chunks),
      };
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  throw new Error(`Exceeded maximum redirect depth (${maxRedirects})`);
}
