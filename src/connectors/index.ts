import { TtlCache } from '../core/cache';
import { RateLimiter } from '../core/ratelimit';
import type {
  CommonsGeoPhoto,
  RipeBgpOverviewData,
  ShodanInternetDbData,
} from '../types/osint';
import {
  parseCommonsGeoPhotoResponse,
  queryOverpassLandmarks,
} from '../services/osintApis';
import type { Connector, ConnectorResult, EntityKind } from './types';
import { INFO9_USER_AGENT } from './types';

/**
 * Zero-key connector registry. Every run() works in the browser AND in
 * Node (CLI) — all upstreams are called with absolute URLs and a
 * descriptive User-Agent, honoring per-host rate limits with caching.
 */

const sharedRateLimiter = new RateLimiter(
  { maxPerWindow: 0, windowMs: 60_000 },
  {
    // Published upstream policies (per minute).
    'nominatim.openstreetmap.org': { maxPerWindow: 60, windowMs: 60_000 },
    'overpass-api.de': { maxPerWindow: 30, windowMs: 60_000 },
    'commons.wikimedia.org': { maxPerWindow: 200, windowMs: 60_000 },
    'api.gleif.org': { maxPerWindow: 60, windowMs: 60_000 },
    'www.wikidata.org': { maxPerWindow: 200, windowMs: 60_000 },
  }
);
const sharedCache = new TtlCache<unknown>(10 * 60_000);

const JSON_CACHE = sharedCache;
/**
 * Proxy-aware JSON fetch: in the browser some upstreams (urlscan, Wayback
 * CDX) block CORS — try the local proxy path first, fall back to direct.
 * In Node (CLI) there is no CORS, so go straight to the upstream with UA.
 */
async function fetchJsonCached(
  url: string,
  init?: RequestInit,
  proxyPath?: string
): Promise<unknown> {
  const host = new URL(url).host;
  await sharedRateLimiter.acquire(host);
  const key = url;
  const hit = JSON_CACHE.get(key);
  if (hit !== undefined) return hit;

  let res: Response;
  if (proxyPath && typeof window !== 'undefined') {
    try {
      const viaProxy = await fetch(proxyPath);
      if (viaProxy.ok) {
        const json = (await viaProxy.json()) as unknown;
        JSON_CACHE.set(key, json);
        return json;
      }
    } catch {
      // proxy unavailable — fall through to direct
    }
    res = await fetch(url, {
      ...init,
      headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
    });
  } else {
    res = await fetch(url, {
      ...init,
      headers: {
        'User-Agent': INFO9_USER_AGENT,
        Accept: 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  }
  if (!res.ok) {
    throw new Error(`${host} returned HTTP ${res.status}`);
  }
  const json = (await res.json()) as unknown;
  JSON_CACHE.set(key, json);
  return json;
}

function result(
  connectorId: string,
  target: string,
  data: unknown,
  emitted: ConnectorResult['emitted'],
  source: string,
  dataGaps: string[] = []
): ConnectorResult {
  return {
    connectorId,
    target,
    emitted,
    data,
    provenance: {
      status: 'LIVE',
      source,
      fetchedAtUtc: new Date().toISOString(),
      note:
        dataGaps.length > 0
          ? `Partial: ${dataGaps.join('; ')}`
          : undefined,
    },
    dataGaps,
  };
}

// ---------------------------------------------------------------------------
// Connectors
// ---------------------------------------------------------------------------

const nominatimGeocode: Connector = {
  id: 'nominatim-geocode',
  label: 'Nominatim Forward Geocoding',
  description: 'Resolve a place name to WGS84 coordinates via OpenStreetMap.',
  category: 'geolocation',
  accepts: 'place',
  emits: ['coordinates'],
  policy: {
    requiresKey: false,
    docsUrl: 'https://nominatim.org/release-docs/latest/api/Search/',
    rateLimitPerMinute: 60,
  },
  async run(target) {
    const json = (await fetchJsonCached(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
        target
      )}&limit=5&addressdetails=1`
    )) as Array<Record<string, unknown>>;
    const results = Array.isArray(json) ? json : [];
    const emitted = results.slice(0, 5).map((r) => ({
      kind: 'coordinates' as EntityKind,
      value: `${Number(r.lat).toFixed(6)},${Number(r.lon).toFixed(6)}`,
      label: String(r.display_name || target),
    }));
    return result(
      this.id,
      target,
      results,
      emitted,
      'OpenStreetMap Nominatim',
      emitted.length === 0 ? ['No geocoding results for this query'] : []
    );
  },
};

const overpassLandmarks: Connector = {
  id: 'overpass-landmarks',
  label: 'Overpass QL Landmark Scan',
  description: 'List infrastructure landmarks within 2.5 km of coordinates.',
  category: 'geolocation',
  accepts: 'coordinates',
  emits: ['coordinates'],
  policy: {
    requiresKey: false,
    docsUrl: 'https://wiki.openstreetmap.org/wiki/Overpass_API',
    rateLimitPerMinute: 30,
  },
  async run(target) {
    const m = target.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!m) throw new Error('Overpass connector expects "lat,lon" input');
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    const landmarks = await queryOverpassLandmarks(lat, lon);
    return result(
      this.id,
      target,
      landmarks,
      landmarks.slice(0, 10).map((l) => ({
        kind: 'coordinates' as EntityKind,
        value: `${l.lat},${l.lon}`,
        label: l.name,
      })),
      'OpenStreetMap Overpass API',
      landmarks.length === 0 ? ['No landmarks returned in radius'] : []
    );
  },
};

const openMeteoWeather: Connector = {
  id: 'open-meteo-verification',
  label: 'Open-Meteo Elevation & Historical Weather',
  description: 'Terrain elevation and ERA5 archive weather for coordinates (today).',
  category: 'geolocation',
  accepts: 'coordinates',
  emits: ['coordinates'],
  policy: {
    requiresKey: false,
    docsUrl: 'https://open-meteo.com/en/docs',
    rateLimitPerMinute: 600,
  },
  async run(target) {
    const m = target.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!m) throw new Error('Open-Meteo connector expects "lat,lon" input');
    const lat = m[1];
    const lon = m[2];
    const date = new Date().toISOString().slice(0, 10);
    const json = (await fetchJsonCached(
      `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${date}&end_date=${date}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&hourly=cloud_cover&timezone=UTC`
    )) as Record<string, unknown>;
    const daily = json?.daily as Record<string, unknown[]> | undefined;
    if (!daily?.temperature_2m_max?.[0]) {
      return result(this.id, target, null, [], 'Open-Meteo ERA5', [
        'No archive weather available for this date/location',
      ]);
    }
    return result(
      this.id,
      target,
      json,
      [
        {
          kind: 'coordinates' as EntityKind,
          value: `${lat},${lon}`,
          label: 'Weather-verified coordinates',
        },
      ],
      'Open-Meteo ERA5 Archive'
    );
  },
};

const shodanInternetDb: Connector = {
  id: 'shodan-internetdb',
  label: 'Shodan InternetDB Exposure Scan',
  description: 'Open ports, software CPEs and CVEs for an IPv4 address (zero-key).',
  category: 'infra',
  accepts: 'ip',
  emits: ['ip'],
  policy: {
    requiresKey: false,
    docsUrl: 'https://internetdb.shodan.io/',
    rateLimitPerMinute: 0,
  },
  async run(target) {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(target)) {
      throw new Error(`"${target}" is not a valid IPv4 address`);
    }
    let data: ShodanInternetDbData | undefined;
    try {
      data = (await fetchJsonCached(
        `https://internetdb.shodan.io/${encodeURIComponent(target)}`
      )) as ShodanInternetDbData;
    } catch (err) {
      return result(this.id, target, null, [], 'Shodan InternetDB', [
        `Shodan InternetDB unavailable: ${err instanceof Error ? err.message : String(err)}`,
      ]);
    }
    if (!Array.isArray(data?.ports)) {
      return result(this.id, target, data ?? null, [], 'Shodan InternetDB', [
        'IP not in Shodan InternetDB dataset (no open services observed)',
      ]);
    }
    return result(
      this.id,
      target,
      data,
      [{ kind: 'ip', value: target, label: `${data.ports.length} open ports` }],
      'Shodan InternetDB'
    );
  },
};

const ripestatBgp: Connector = {
  id: 'ripestat-bgp',
  label: 'RIPEstat BGP Prefix Overview',
  description: 'Announced prefix, holder ASN and peers for an IPv4 address.',
  category: 'infra',
  accepts: 'ip',
  emits: ['ip'],
  policy: {
    requiresKey: false,
    docsUrl: 'https://stat.ripe.net/docs/02.data-api/',
    rateLimitPerMinute: 0,
  },
  async run(target) {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(target)) {
      throw new Error(`"${target}" is not a valid IPv4 address`);
    }
    let data: RipeBgpOverviewData | undefined;
    try {
      const json = (await fetchJsonCached(
        `https://stat.ripe.net/data/prefix-overview/data.json?resource=${encodeURIComponent(target)}`
      )) as { data?: RipeBgpOverviewData & { asns?: Array<{ asn?: number; holder?: string }> } };
      if (json?.data) {
        data = {
          resource: String(json.data.resource ?? target),
          announcedPrefix: String(json.data.resource ?? target),
          holderName: String(json.data.asns?.[0]?.holder ?? 'Unknown holder'),
          asnCount: json.data.asns?.length ?? 0,
          upstreamPeers: (json.data.asns ?? []).map((a) => `AS${a.asn}`),
        };
      }
    } catch (err) {
      return result(this.id, target, null, [], 'RIPEstat', [
        `RIPEstat unavailable: ${err instanceof Error ? err.message : String(err)}`,
      ]);
    }
    if (!data) {
      return result(this.id, target, null, [], 'RIPEstat', [
        'No BGP announcement found for this IP',
      ]);
    }
    return result(
      this.id,
      target,
      data,
      [{ kind: 'ip', value: target, label: data.holderName }],
      'RIPEstat'
    );
  },
};

const gleifEntitySearch: Connector = {
  id: 'gleif-entity-search',
  label: 'GLEIF Legal Entity Search',
  description: 'Find LEI-registered legal entities by name worldwide.',
  category: 'corporate',
  accepts: 'entity-name',
  emits: ['entity-name'],
  policy: {
    requiresKey: false,
    docsUrl: 'https://api.gleif.org/api/v1/lei-records',
    rateLimitPerMinute: 60,
  },
  async run(target) {
    const json = (await fetchJsonCached(
      `https://api.gleif.org/api/v1/lei-records?filter[entity.legalName]=${encodeURIComponent(
        target
      )}&page[size]=5`
    )) as { data?: Array<{ id?: string; attributes?: Record<string, unknown> }> };
    const records = Array.isArray(json?.data) ? json.data : [];
    return result(
      this.id,
      target,
      records,
      records
        .filter((r) => r.id)
        .map((r) => ({
          kind: 'entity-name' as EntityKind,
          value: String(r.id),
          label: String(
            (r.attributes?.entity as { legalName?: { name?: string } } | undefined)?.legalName?.name ?? r.id
          ),
        })),
      'GLEIF',
      records.length === 0 ? ['No GLEIF records matched this name'] : []
    );
  },
};

const wikidataSearch: Connector = {
  id: 'wikidata-search',
  label: 'Wikidata Knowledge Graph Search',
  description: 'Search Wikidata entities by name with descriptions.',
  category: 'corporate',
  accepts: 'entity-name',
  emits: ['entity-name'],
  policy: {
    requiresKey: false,
    docsUrl: 'https://www.wikidata.org/w/api.php',
    rateLimitPerMinute: 200,
  },
  async run(target) {
    const json = (await fetchJsonCached(
      `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(
        target
      )}&language=en&limit=5&format=json&origin=*`
    )) as { search?: Array<{ id?: string; label?: string; description?: string }> };
    const items = Array.isArray(json?.search) ? json.search : [];
    return result(
      this.id,
      target,
      items,
      items
        .filter((i) => i.id)
        .map((i) => ({
          kind: 'entity-name' as EntityKind,
          value: String(i.id),
          label: String(i.label ?? i.id),
        })),
      'Wikidata',
      items.length === 0 ? ['No Wikidata entities matched'] : []
    );
  },
};

const commonsGeoPhotos: Connector = {
  id: 'commons-geophoto',
  label: 'Wikimedia Commons Geolocated Photo Search',
  description: 'Find GPS-tagged Commons photos matching scene keywords.',
  category: 'photo',
  accepts: 'place',
  emits: ['coordinates'],
  policy: {
    requiresKey: false,
    docsUrl: 'https://commons.wikimedia.org/w/api.php',
    rateLimitPerMinute: 200,
  },
  async run(target) {
    const json = await fetchJsonCached(
      `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*` +
        `&generator=search&gsrsearch=${encodeURIComponent(target)}` +
        `&gsrnamespace=6&gsrlimit=30&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=420`
    );
    const photos: CommonsGeoPhoto[] = parseCommonsGeoPhotoResponse(json);
    return result(
      this.id,
      target,
      photos,
      photos.slice(0, 10).map((p) => ({
        kind: 'coordinates' as EntityKind,
        value: `${p.lat},${p.lon}`,
        label: p.title,
      })),
      'Wikimedia Commons',
      photos.length === 0
        ? ['No GPS-tagged Commons files matched these keywords']
        : []
    );
  },
};

const urlscanSearch: Connector = {
  id: 'urlscan-search',
  label: 'URLScan.io Public Search',
  description: 'Recent public scans of a domain: pages, IPs, technologies.',
  category: 'infra',
  accepts: 'domain',
  emits: ['domain', 'ip'],
  policy: {
    requiresKey: false,
    docsUrl: 'https://urlscan.io/docs/api/',
    rateLimitPerMinute: 0,
  },
  async run(target) {
    const clean = target.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(clean)) {
      throw new Error(`"${target}" is not a valid domain`);
    }
    const json = (await fetchJsonCached(
      `https://urlscan.io/api/v1/search/?q=domain:${encodeURIComponent(clean)}&size=12`,
      undefined,
      `/api/osint/urlscan?q=${encodeURIComponent(`domain:${clean}`)}&size=12`
    )) as { results?: Array<Record<string, unknown>> };
    const results = Array.isArray(json?.results) ? json.results : [];
    return result(
      this.id,
      clean,
      results,
      results
        .map((r) => {
          const page = r.page as { ip?: string; url?: string } | undefined;
          return {
            kind: (page?.ip ? 'ip' : 'domain') as EntityKind,
            value: String(page?.ip ?? clean),
            label: String(page?.url ?? ''),
          };
        })
        .slice(0, 10),
      'URLScan.io public search',
      results.length === 0
        ? ['No public scans indexed for this domain']
        : []
    );
  },
};

const githubUserRecon: Connector = {
  id: 'github-user-recon',
  label: 'GitHub Public Account Recon',
  description: 'Resolve a GitHub handle: profile, bio, orgs, repo/activity counts.',
  category: 'corporate',
  accepts: 'entity-name',
  emits: ['entity-name'],
  policy: {
    requiresKey: false,
    docsUrl: 'https://docs.github.com/en/rest',
    rateLimitPerMinute: 10,
  },
  async run(target) {
    const handle = target.trim().replace(/^@/, '');
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(handle)) {
      throw new Error(`"${target}" is not a valid GitHub handle`);
    }
    let profile: Record<string, unknown>;
    try {
      profile = (await fetchJsonCached(
        `https://api.github.com/users/${encodeURIComponent(handle)}`
      )) as Record<string, unknown>;
    } catch (err) {
      return result(this.id, handle, null, [], 'GitHub REST API', [
        `GitHub lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      ]);
    }
    if (!profile || Object.keys(profile).length === 0 || profile.message === 'Not Found') {
      return result(this.id, handle, null, [], 'GitHub REST API', [
        'No GitHub account with this handle',
      ]);
    }
    return result(
      this.id,
      handle,
      profile,
      [
        {
          kind: 'entity-name',
          value: String(profile.login ?? handle),
          label: `${profile.public_repos ?? '?'} public repos · created ${String(profile.created_at ?? '?').slice(0, 10)}`,
        },
      ],
      'GitHub REST API'
    );
  },
};

const ipGeolocation: Connector = {
  id: 'ip-geolocation',
  label: 'IP Geolocation (ipwho.is)',
  description: 'City/country/ASN/timezone attribution for an IPv4 address.',
  category: 'infra',
  accepts: 'ip',
  emits: ['ip', 'coordinates'],
  policy: {
    requiresKey: false,
    docsUrl: 'https://ipwho.is/',
    rateLimitPerMinute: 0,
  },
  async run(target) {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(target)) {
      throw new Error(`"${target}" is not a valid IPv4 address`);
    }
    const json = (await fetchJsonCached(
      `https://ipwho.is/${encodeURIComponent(target)}`
    )) as Record<string, unknown>;
    if (json.success === false) {
      return result(this.id, target, json, [], 'ipwho.is', [
        'ipwho.is could not attribute this IP',
      ]);
    }
    const connection = json.connection as { asn?: number; org?: string } | undefined;
    return result(
      this.id,
      target,
      json,
      [
        { kind: 'ip', value: target, label: String(json.country ?? '') },
        {
          kind: 'coordinates',
          value: `${json.latitude},${json.longitude}`,
          label: String(json.city ?? json.country ?? ''),
        },
      ],
      'ipwho.is',
      connection?.asn ? [] : ['ASN attribution missing']
    );
  },
};

const waybackHistory: Connector = {
  id: 'wayback-history',
  label: 'Wayback Machine CDX History',
  description: 'Archival capture history and earliest appearance of a URL.',
  category: 'archive',
  accepts: 'domain',
  emits: ['domain'],
  policy: {
    requiresKey: false,
    docsUrl: 'https://github.com/internetarchive/wayback/tree/master/wayback-cdx-server',
    rateLimitPerMinute: 0,
  },
  async run(target) {
    const clean = target.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(clean)) {
      throw new Error(`"${target}" is not a valid domain`);
    }
    const json = (await fetchJsonCached(
      `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(
        clean
      )}&output=json&limit=25&fl=timestamp,original,mimetype,statuscode,digest`,
      undefined,
      `/api/osint/wayback-cdx?url=${encodeURIComponent(clean)}`
    )) as unknown[];
    const rows = Array.isArray(json) ? json.slice(1) : [];
    return result(
      this.id,
      clean,
      rows,
      [{ kind: 'domain', value: clean, label: `${rows.length} archival captures` }],
      'Internet Archive Wayback CDX',
      rows.length === 0 ? ['No archival captures found (never archived or too new)'] : []
    );
  },
};

const domainRecon: Connector = {
  id: 'domain-recon',
  label: 'Domain Passive Recon',
  description:
    'Composite: DNS (DoH), RDAP registration, crt.sh certificates, Shodan exposure, RIPEstat BGP, transparent risk scoring.',
  category: 'infra',
  accepts: 'domain',
  emits: ['domain', 'ip'],
  policy: {
    requiresKey: false,
    docsUrl: 'https://github.com/ARYAN007H/info9#the-five-modules',
    rateLimitPerMinute: 0,
  },
  async run(target) {
    const clean = target.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(clean)) {
      throw new Error(`"${target}" is not a valid domain`);
    }
    const { scanDomainInfrastructureLive } = await import('../services/osintApis');
    const record = await scanDomainInfrastructureLive(clean);
    const primaryIp = record.aRecords[0];
    return result(
      this.id,
      clean,
      record,
      [
        { kind: 'domain', value: clean, label: `${record.ctSubdomainsCount} CT subdomains` },
        ...(primaryIp
          ? [{ kind: 'ip' as EntityKind, value: primaryIp, label: `${record.asnOrg ?? 'unknown'} (${record.asn ?? 'unknown ASN'})` }]
          : []),
      ],
      'Cloudflare DoH · RDAP · crt.sh · Shodan · RIPEstat',
      record.dataGaps
    );
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const REGISTRY: Connector[] = [
  nominatimGeocode,
  overpassLandmarks,
  openMeteoWeather,
  shodanInternetDb,
  ripestatBgp,
  gleifEntitySearch,
  wikidataSearch,
  commonsGeoPhotos,
  urlscanSearch,
  githubUserRecon,
  ipGeolocation,
  waybackHistory,
  domainRecon,
];

export function listConnectors(): Connector[] {
  return [...REGISTRY];
}

export function getConnector(id: string): Connector | undefined {
  return REGISTRY.find((c) => c.id === id);
}

/** Suggest connectors whose `accepts` matches any of the given kinds. */
export function suggestPivots(kinds: EntityKind[]): Connector[] {
  const kindSet = new Set(kinds);
  return REGISTRY.filter((c) => kindSet.has(c.accepts));
}

/** Registry integrity checks — exported for tests and CI. */
export function validateRegistry(): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const c of REGISTRY) {
    if (ids.has(c.id)) problems.push(`duplicate connector id: ${c.id}`);
    ids.add(c.id);
    if (c.policy.requiresKey !== false) {
      problems.push(`${c.id}: requiresKey must be false (zero-key policy)`);
    }
    if (!/^https:\/\//.test(c.policy.docsUrl)) {
      problems.push(`${c.id}: docsUrl must be https`);
    }
  }
  return problems;
}
