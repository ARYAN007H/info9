import type { SubdomainProbeResult } from '../types/osint';

interface TakeoverFingerprint {
  provider: string;
  cnameSuffixes: string[];
}

const TAKEOVER_FINGERPRINTS: TakeoverFingerprint[] = [
  { provider: 'GitHub Pages', cnameSuffixes: ['.github.io'] },
  { provider: 'AWS S3 Bucket', cnameSuffixes: ['.s3.amazonaws.com', '.s3-website'] },
  { provider: 'Heroku', cnameSuffixes: ['.herokuapp.com', '.herokudns.com'] },
  {
    provider: 'Microsoft Azure',
    cnameSuffixes: [
      '.azurewebsites.net',
      '.cloudapp.net',
      '.trafficmanager.net',
      '.blob.core.windows.net',
    ],
  },
  { provider: 'Fastly CDN', cnameSuffixes: ['.fastly.net'] },
  { provider: 'Shopify', cnameSuffixes: ['.myshopify.com'] },
  { provider: 'Pantheon', cnameSuffixes: ['.pantheonsite.io'] },
  { provider: 'Ghost.io', cnameSuffixes: ['.ghost.io'] },
  { provider: 'Surge.sh', cnameSuffixes: ['.surge.sh'] },
  { provider: 'Fly.io', cnameSuffixes: ['.fly.dev'] },
];

/**
 * Evaluates whether a subdomain with a CNAME record and no resolving A/AAAA
 * records points at a cloud provider susceptible to dangling-CNAME takeover.
 */
export function detectSubdomainTakeoverRisk(
  subdomain: string,
  cnameTarget: string | null,
  aRecords: string[]
): SubdomainProbeResult['takeoverRisk'] {
  if (!cnameTarget) {
    return {
      vulnerable: false,
      provider: null,
      reason: aRecords.length > 0 ? 'Resolves directly to IPv4' : 'No CNAME record',
    };
  }

  const normalizedCname = cnameTarget.trim().toLowerCase().replace(/\.$/, '');
  const matchedProvider = TAKEOVER_FINGERPRINTS.find((fp) =>
    fp.cnameSuffixes.some((suffix) => normalizedCname.endsWith(suffix))
  );

  if (aRecords.length === 0 && matchedProvider) {
    return {
      vulnerable: true,
      provider: matchedProvider.provider,
      reason: `Dangling CNAME -> ${normalizedCname} (${matchedProvider.provider}) with no resolving A record`,
    };
  }

  if (aRecords.length === 0) {
    return {
      vulnerable: false,
      provider: null,
      reason: `Unresolved CNAME -> ${normalizedCname} (verify target registration)`,
    };
  }

  return {
    vulnerable: false,
    provider: matchedProvider?.provider ?? null,
    reason: matchedProvider
      ? `Active ${matchedProvider.provider} CNAME (${aRecords[0]})`
      : `Active CNAME -> ${normalizedCname}`,
  };
}

/**
 * Extracts the `/24` IPv4 prefix (e.g., `198.51.100.0/24`) for subnet grouping.
 */
export function ipv4ToSubnet24(ip: string | undefined): string | null {
  if (!ip) return null;
  const m = ip.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  return `${m[1]}.${m[2]}.${m[3]}.0/24`;
}

export interface SubnetGroupSummary {
  subnet24: string;
  subdomains: string[];
  ips: string[];
}

/**
 * Groups probed subdomains by `/24` IPv4 subnet to highlight shared hosting blocks.
 */
export function groupSubdomainsBySubnet24(
  probes: SubdomainProbeResult[]
): SubnetGroupSummary[] {
  const map = new Map<string, { subdomains: Set<string>; ips: Set<string> }>();
  for (const p of probes) {
    if (!p.subnet24) continue;
    let bucket = map.get(p.subnet24);
    if (!bucket) {
      bucket = { subdomains: new Set(), ips: new Set() };
      map.set(p.subnet24, bucket);
    }
    bucket.subdomains.add(p.subdomain);
    p.aRecords.forEach((ip) => bucket!.ips.add(ip));
  }

  return Array.from(map.entries())
    .map(([subnet24, b]) => ({
      subnet24,
      subdomains: Array.from(b.subdomains),
      ips: Array.from(b.ips),
    }))
    .sort((a, b) => b.subdomains.length - a.subdomains.length);
}
