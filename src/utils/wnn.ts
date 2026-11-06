/**
 * WhatsMyName (WebBreacher) username-sweep primitives.
 *
 * The free community dataset (wmn-data.json, ~700 site probes) has entries:
 *   { uri_check: "https://site.tld/{account}/", e_code, e_string,
 *     m_code, m_string, cat, known: [...] }
 * Detection:
 *   FOUND     — status == e_code, e_string (if any) IS present, m_string
 *               (if any) is NOT present.
 *   NOT_FOUND — status == m_code with m_string present, or plain 404/301-style
 *               missing markers. Anything else is UNKNOWN and reported as such.
 * These functions are pure so the logic is testable without network.
 */

export type WnnVerdict = 'FOUND' | 'NOT_FOUND' | 'UNKNOWN';

export interface WnnSite {
  name: string;
  uriCheck: string;
  eCode: number;
  eString: string;
  mCode: number;
  mString: string;
  category: string;
}

const USERNAME_ALLOWED = /^[\w.\-]{1,64}$/;
const FORBIDDEN_HOSTS =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.)/i;

/** Normalizes the raw community dataset defensively; drops unusable probes. */
export function normalizeWnnSites(raw: unknown): WnnSite[] {
  if (!Array.isArray(raw)) return [];
  const sites: WnnSite[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const e = item as Record<string, unknown>;
    if (typeof e.uri_check !== 'string') continue;
    if (!e.uri_check.includes('{account}') && !e.uri_check.includes('{username}')) continue;
    if (typeof e.name !== 'string' || !e.name) continue;
    if (e.valid === false) continue;
    if (typeof e.known === 'string') continue; // 'known' usernames are exemplars
    // Defense in depth: drop probe templates aimed at private/loopback hosts.
    // (buildCheckUrl re-validates after substitution.)
    let host = '';
    try {
      host = new URL(e.uri_check.replace('{account}', 'probe').replace('{username}', 'probe')).hostname;
    } catch {
      continue;
    }
    if (FORBIDDEN_HOSTS.test(host)) continue;
    const eCode = typeof e.e_code === 'number' ? e.e_code : 200;
    sites.push({
      name: e.name,
      uriCheck: e.uri_check,
      eCode,
      eString: typeof e.e_string === 'string' ? e.e_string : '',
      mCode: typeof e.m_code === 'number' ? e.m_code : 0,
      mString: typeof e.m_string === 'string' ? e.m_string : '',
      category: typeof e.cat === 'string' && e.cat ? e.cat : 'other',
    });
  }
  return sites;
}

/**
 * Substitutes the account placeholder into a probe template with strict
 * allowlisting. The username is user input and the URL comes from a
 * community dataset — both untrusted, so this is where SSRF/injection dies.
 */
export function buildCheckUrl(uriTemplate: string, username: string): string {
  if (!USERNAME_ALLOWED.test(username)) {
    throw new Error(
      'Username contains unsupported characters (allowed: letters, digits, dot, underscore, hyphen)'
    );
  }
  const candidate = uriTemplate.includes('{account}')
    ? uriTemplate.replace('{account}', username)
    : uriTemplate.replace('{username}', username);
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('Invalid probe URL for this site');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Probe URL must be http(s)');
  }
  if (FORBIDDEN_HOSTS.test(parsed.hostname)) {
    throw new Error('Probe URL points at a private network host (blocked)');
  }
  return parsed.toString();
}

/** Pure verdict for one probe response. */
export function interpretCheckResult(
  site: Pick<WnnSite, 'eCode' | 'eString' | 'mCode' | 'mString'>,
  httpStatus: number,
  body: string
): WnnVerdict {
  if (httpStatus === site.eCode) {
    const eOk = !site.eString || body.includes(site.eString);
    const mOk = !site.mString || !body.includes(site.mString);
    if (eOk && mOk) return 'FOUND';
  }
  if (site.mCode !== 0 && httpStatus === site.mCode) {
    const missing = !site.mString || body.includes(site.mString);
    if (missing) return 'NOT_FOUND';
  }
  if (httpStatus === 404 || httpStatus === 410) return 'NOT_FOUND';
  return 'UNKNOWN';
}
