import type {
  DemRadialPoint,
  DnsTwistPermutation,
  GleifParentTransformResult,
  InfraDomainRecord,
  OsintEntity,
  OverpassConstraintClause,
  OverpassLandmark,
  OwnershipEdge,
  RipeBgpOverviewData,
  ShodanInternetDbData,
  WeatherVerificationData,
} from '../types/osint';
import { makeLiveProvenance } from '../utils/provenance';
import { computeDomainRiskScore } from '../utils/riskScore';
import {
  buildOverpassIntersectionQuery,
  haversineDistanceKm,
  projectBearingCoordinate,
} from '../utils/solarMath';

/**
 * 1. Nominatim OpenStreetMap Forward Geocoding (Zero API Key)
 */
export async function geocodeLocationNominatim(query: string): Promise<
  Array<{
    displayName: string;
    lat: number;
    lon: number;
    type: string;
  }>
> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
    query
  )}&limit=5&addressdetails=1`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Nominatim geocoder returned HTTP ${res.status}`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data.map((item: Record<string, unknown>) => ({
    displayName: String(item.display_name || query),
    lat: Number(parseFloat(String(item.lat)).toFixed(6)),
    lon: Number(parseFloat(String(item.lon)).toFixed(6)),
    type: String(item.type || item.class || 'landmark'),
  }));
}

/**
 * 1B. Nominatim OpenStreetMap Reverse Geocoding (Coordinates -> Human-Readable Address)
 */
export async function reverseGeocodeNominatim(
  lat: number,
  lon: number
): Promise<string> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(
      lat
    )}&lon=${encodeURIComponent(lon)}&zoom=14`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.display_name) {
        return String(data.display_name);
      }
    }
  } catch {
    // Fallback
  }
  return `Pinned Location (${lat.toFixed(4)}, ${lon.toFixed(4)})`;
}

/**
 * 1C. Live IP Address Geolocation (ipwho.is Zero-Key API)
 */
export async function geolocateIpAddress(ip: string): Promise<{
  ip: string;
  city: string;
  region: string;
  country: string;
  lat: number;
  lon: number;
  isp: string;
  asn: string;
  timezone: string;
}> {
  const res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`);
  if (res.ok) {
    const data = await res.json();
    if (data && data.success !== false && typeof data.latitude === 'number') {
      return {
        ip,
        city: String(data.city || 'Unknown City'),
        region: String(data.region || ''),
        country: String(data.country || 'Unknown Country'),
        lat: Number(Number(data.latitude).toFixed(6)),
        lon: Number(Number(data.longitude).toFixed(6)),
        isp: String(data.connection?.org || data.connection?.isp || 'Network Provider'),
        asn: data.connection?.asn ? `AS${data.connection.asn}` : 'ASN',
        timezone: String(data.timezone?.utc || 'UTC'),
      };
    }
  }
  throw new Error(`Could not resolve geographic location for IP ${ip}`);
}

/**
 * 2A. OpenStreetMap Overpass QL Spatial Infrastructure Triangulator (Zero API Key)
 */
export async function queryOverpassLandmarks(
  lat: number,
  lon: number,
  radiusMeters = 2500
): Promise<OverpassLandmark[]> {
  const overpassQuery = `
    [out:json][timeout:10];
    (
      node["power"~"substation|tower|generator"](around:${radiusMeters},${lat},${lon});
      way["power"="substation"](around:${radiusMeters},${lat},${lon});
      node["man_made"~"storage_tank|crane|communications_tower|lighthouse|chimney|water_tower"](around:${radiusMeters},${lat},${lon});
      way["man_made"~"storage_tank|pier"](around:${radiusMeters},${lat},${lon});
      node["railway"="level_crossing"](around:${radiusMeters},${lat},${lon});
    );
    out center 25;
  `.trim();

  return runOverpassRawQuery(overpassQuery, lat, lon);
}

/**
 * 2B. Bellingcat-Style Multi-Clause Overpass Spatial Intersection Solver
 */
export async function executeOverpassIntersectionQuery(
  clauses: OverpassConstraintClause[],
  centerLat: number,
  centerLon: number,
  searchRadiusMeters = 5000
): Promise<{
  compiledQl: string;
  landmarks: OverpassLandmark[];
}> {
  const compiledQl = buildOverpassIntersectionQuery(
    clauses,
    centerLat,
    centerLon,
    searchRadiusMeters
  );
  const landmarks = await runOverpassRawQuery(compiledQl, centerLat, centerLon);
  return { compiledQl, landmarks };
}

async function runOverpassRawQuery(
  overpassQuery: string,
  refLat: number,
  refLon: number
): Promise<OverpassLandmark[]> {
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(overpassQuery)}`,
  });

  if (!res.ok) {
    throw new Error(`Overpass QL API returned HTTP ${res.status}`);
  }

  const data = await res.json();
  const elements = Array.isArray(data?.elements) ? data.elements : [];

  const landmarks: OverpassLandmark[] = [];
  for (const el of elements) {
    const elLat = Number(el.lat ?? el.center?.lat);
    const elLon = Number(el.lon ?? el.center?.lon);
    if (isNaN(elLat) || isNaN(elLon)) continue;

    const tags: Record<string, string> = el.tags || {};
    const category =
      tags.power ||
      tags.man_made ||
      tags.railway ||
      tags.waterway ||
      tags.industrial ||
      'infrastructure';
    const name =
      tags.name ||
      tags['name:en'] ||
      tags.operator ||
      `${category.replace(/_/g, ' ').toUpperCase()} #${el.id}`;

    const distKm = haversineDistanceKm(refLat, refLon, elLat, elLon);

    landmarks.push({
      id: `osm-${el.id}`,
      name,
      category,
      lat: Number(elLat.toFixed(6)),
      lon: Number(elLon.toFixed(6)),
      distanceMeters: Math.round(distKm * 1000),
      tags,
    });
  }

  landmarks.sort((a, b) => a.distanceMeters - b.distanceMeters);
  return landmarks.slice(0, 25);
}

/**
 * 3A. Open-Meteo Terrain Elevation & Historical Weather / Cloud Cover Verification (Zero API Key)
 *
 * Evidentiary contract: returns null when the upstream is unreachable or
 * returns unusable data. Callers must render an explicit gap — this function
 * NEVER returns placeholder weather.
 */
export async function fetchElevationAndWeatherVerification(
  lat: number,
  lon: number,
  dateIso: string
): Promise<WeatherVerificationData | null> {
  const todayIso = new Date().toISOString().slice(0, 10);
  const queryDate = dateIso <= todayIso ? dateIso : todayIso;

  let elevationMeters: number | null = null;
  try {
    const elevRes = await fetch(
      `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`
    );
    if (elevRes.ok) {
      const elevJson = await elevRes.json();
      if (Array.isArray(elevJson?.elevation) && elevJson.elevation.length > 0) {
        const parsed = Number(elevJson.elevation[0]);
        if (Number.isFinite(parsed)) elevationMeters = Math.round(parsed);
      }
    }
  } catch {
    // Elevation stays null — surfaced as a data gap, never defaulted.
  }

  try {
    const weatherUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${queryDate}&end_date=${queryDate}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,shortwave_radiation_sum&hourly=cloud_cover&timezone=UTC`;
    const wRes = await fetch(weatherUrl);
    if (!wRes.ok) return null;
    const wJson = await wRes.json();
    const maxTempC = wJson?.daily?.temperature_2m_max?.[0];
    const minTempC = wJson?.daily?.temperature_2m_min?.[0];
    const precipitationMm = wJson?.daily?.precipitation_sum?.[0];
    const shortwaveRadiationSum = wJson?.daily?.shortwave_radiation_sum?.[0];
    if (
      typeof maxTempC !== 'number' ||
      typeof minTempC !== 'number' ||
      typeof precipitationMm !== 'number' ||
      typeof shortwaveRadiationSum !== 'number'
    ) {
      return null;
    }

    const hourlyClouds: number[] = Array.isArray(wJson?.hourly?.cloud_cover)
      ? wJson.hourly.cloud_cover.filter((v: unknown) => typeof v === 'number')
      : [];
    if (hourlyClouds.length === 0) return null;
    const cloudCoverMeanPercent = Math.round(
      hourlyClouds.reduce((a, b) => a + b, 0) / hourlyClouds.length
    );

    const shadowPlausibility: WeatherVerificationData['shadowPlausibility'] =
      cloudCoverMeanPercent <= 45
        ? 'CONFIRMED_CLEAR_SKY'
        : cloudCoverMeanPercent <= 78
        ? 'PARTIAL_CLOUD_COVER'
        : 'OVERCAST_ANOMALY';

    return {
      elevationMeters,
      date: dateIso,
      maxTempC,
      minTempC,
      cloudCoverMeanPercent,
      shortwaveRadiationSum,
      precipitationMm,
      shadowPlausibility,
      provenance: makeLiveProvenance('Open-Meteo ERA5 Archive'),
    };
  } catch {
    return null;
  }
}

/**
 * 3B. PeakFinder-Style 8-Radial DEM Terrain Viewshed & Horizon Angle Profiler (Open-Meteo DEM API)
 *
 * Evidentiary contract: on any upstream failure the profile is empty and
 * center elevation null. No synthetic terrain is ever produced.
 */
export async function fetchDemRadialHorizonProfile(
  centerLat: number,
  centerLon: number,
  radiusKm = 1.5
): Promise<{
  centerElevationMeters: number | null;
  radials: DemRadialPoint[];
}> {
  const compassDirs: Array<{ label: string; deg: number }> = [
    { label: 'N', deg: 0 },
    { label: 'NE', deg: 45 },
    { label: 'E', deg: 90 },
    { label: 'SE', deg: 135 },
    { label: 'S', deg: 180 },
    { label: 'SW', deg: 225 },
    { label: 'W', deg: 270 },
    { label: 'NW', deg: 315 },
  ];

  const coords: Array<[number, number]> = [[centerLat, centerLon]];
  for (const dir of compassDirs) {
    coords.push(
      projectBearingCoordinate(centerLat, centerLon, dir.deg, radiusKm)
    );
  }

  const lats = coords.map((c) => c[0]).join(',');
  const lons = coords.map((c) => c[1]).join(',');

  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`
    );
    if (!res.ok) return { centerElevationMeters: null, radials: [] };
    const data = await res.json();
    const elevations: number[] = Array.isArray(data?.elevation)
      ? data.elevation.map(Number)
      : [];
    if (elevations.length !== 9 || elevations.some((e) => !Number.isFinite(e))) {
      return { centerElevationMeters: null, radials: [] };
    }
    const centerElev = elevations[0];
    const distMeters = radiusKm * 1000;
    const radials: DemRadialPoint[] = compassDirs.map((dir, idx) => {
      const el = elevations[idx + 1];
      const deltaH = el - centerElev;
      const horizonAngleDeg = Number(
        ((Math.atan2(deltaH, distMeters) * 180) / Math.PI).toFixed(2)
      );
      return {
        compassBearing: dir.label,
        bearingDeg: dir.deg,
        lat: coords[idx + 1][0],
        lon: coords[idx + 1][1],
        elevationMeters: Math.round(el),
        horizonAngleDeg,
      };
    });
    return { centerElevationMeters: Math.round(centerElev), radials };
  } catch {
    return { centerElevationMeters: null, radials: [] };
  }
}

/**
 * 4. Cloudflare DNS-over-HTTPS (DoH) + Shodan InternetDB + RIPE Stat BGP + RDAP + crt.sh
 */
async function queryCloudflareDoh(
  domain: string,
  type: string
): Promise<string[]> {
  try {
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(
        domain
      )}&type=${encodeURIComponent(type)}`,
      {
        headers: { Accept: 'application/dns-json' },
      }
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data?.Answer)) return [];
    return data.Answer.map((ans: { data?: string }) =>
      String(ans.data || '').replace(/\.$/, '')
    ).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Queries Shodan InternetDB Free Zero-Key API for open ports, CPEs, hostnames, and CVEs.
 */
export async function queryShodanInternetDb(
  ip: string
): Promise<ShodanInternetDbData | undefined> {
  if (!ip || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return undefined;
  try {
    const res = await fetch(
      `https://internetdb.shodan.io/${encodeURIComponent(ip)}`
    );
    const data = res.ok
      ? await res.json()
      : await fetch(`/api/osint/internetdb?ip=${encodeURIComponent(ip)}`).then(
          (r) => (r.ok ? r.json() : null)
        );
    if (data && Array.isArray(data.ports)) {
      return {
        ip,
        ports: data.ports,
        cpes: Array.isArray(data.cpes) ? data.cpes : [],
        hostnames: Array.isArray(data.hostnames) ? data.hostnames : [],
        tags: Array.isArray(data.tags) ? data.tags : [],
        vulns: Array.isArray(data.vulns) ? data.vulns : [],
      };
    }
  } catch {
    // Fallback
  }
  return undefined;
}

/**
 * Queries RIPE Stat Public BGP Prefix Overview API (Zero API Key)
 */
export async function queryRipeBgpOverview(
  ipOrAsn: string
): Promise<RipeBgpOverviewData | undefined> {
  try {
    const res = await fetch(
      `https://stat.ripe.net/data/prefix-overview/data.json?resource=${encodeURIComponent(
        ipOrAsn
      )}`
    );
    if (res.ok) {
      const json = await res.json();
      const d = json?.data;
      if (d) {
        const asns = Array.isArray(d.asns) ? d.asns : [];
        return {
          resource: String(d.resource || ipOrAsn),
          announcedPrefix: String(d.resource || ipOrAsn),
          holderName: String(asns[0]?.holder || 'Autonomous System Operator'),
          asnCount: asns.length || 1,
          upstreamPeers: asns.map((a: { asn?: number }) => `AS${a.asn}`),
        };
      }
    }
  } catch {
    // Ignore
  }
  return undefined;
}

/**
 * Full passive recon on a domain. Evidentiary contract:
 *  - Throws when the domain resolves no DNS records at all (probably nonexistent).
 *  - Every field that could not be verified is null and is named in `dataGaps`.
 *  - No placeholder IP, registrar, date, port list, or vulnerability set is
 *    ever substituted for a failed lookup.
 */
export async function scanDomainInfrastructureLive(
  rawDomain: string
): Promise<InfraDomainRecord> {
  const domain = rawDomain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');

  const [
    aRecords,
    aaaaRecords,
    mxRecords,
    nsRecords,
    txtRecords,
    caaRecords,
    dmarcTxt,
  ] = await Promise.all([
    queryCloudflareDoh(domain, 'A'),
    queryCloudflareDoh(domain, 'AAAA'),
    queryCloudflareDoh(domain, 'MX'),
    queryCloudflareDoh(domain, 'NS'),
    queryCloudflareDoh(domain, 'TXT'),
    queryCloudflareDoh(domain, 'CAA'),
    queryCloudflareDoh(`_dmarc.${domain}`, 'TXT'),
  ]);

  if (
    aRecords.length === 0 &&
    aaaaRecords.length === 0 &&
    nsRecords.length === 0
  ) {
    throw new Error(
      `"${domain}" resolved no DNS records — domain may not exist or DNS is down`
    );
  }

  const dataGaps: string[] = [];
  const primaryIp = aRecords.find((r) => /^\d+\.\d+\.\d+\.\d+$/.test(r));

  const [ipWhoResult, shodanData, ripeBgpData] = await Promise.all([
    primaryIp
      ? fetch(`https://ipwho.is/${encodeURIComponent(primaryIp)}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
      : Promise.resolve(null),
    primaryIp ? queryShodanInternetDb(primaryIp) : Promise.resolve(undefined),
    primaryIp ? queryRipeBgpOverview(primaryIp) : Promise.resolve(undefined),
  ]);

  let asn: string | null = null;
  let asnOrg: string | null = null;
  if (ipWhoResult && ipWhoResult.success !== false) {
    asn = ipWhoResult.connection?.asn ? `AS${ipWhoResult.connection.asn}` : null;
    asnOrg = ipWhoResult.connection?.org || ipWhoResult.connection?.isp || null;
  } else {
    dataGaps.push('ipwho.is network attribution unavailable');
  }
  // RIPEstat holder is an independent second source for the operating org.
  if (!asnOrg && ripeBgpData?.holderName) {
    asnOrg = ripeBgpData.holderName;
  }
  if (!primaryIp) {
    dataGaps.push('No IPv4 A record — Shodan/BGP/IP-geo skipped');
  }

  let registrar: string | null = null;
  let createdAt: string | null = null;
  try {
    const rdapRes = await fetch(
      `/api/osint/rdap?domain=${encodeURIComponent(domain)}`
    );
    const rdapData = rdapRes.ok
      ? await rdapRes.json()
      : await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`).then(
          (r) => (r.ok ? r.json() : null)
        );
    if (rdapData) {
      const events = Array.isArray(rdapData.events) ? rdapData.events : [];
      const regEvent = events.find(
        (e: { eventAction?: string }) =>
          e.eventAction === 'registration' || e.eventAction === 'created'
      );
      if (regEvent?.eventDate) {
        createdAt = String(regEvent.eventDate).slice(0, 10);
      }
      const entities = Array.isArray(rdapData.entities)
        ? rdapData.entities
        : [];
      for (const ent of entities) {
        const vcard = ent?.vcardArray?.[1];
        if (Array.isArray(vcard)) {
          const fnEntry = vcard.find((row: unknown[]) => row[0] === 'fn');
          if (fnEntry && fnEntry[3]) {
            registrar = String(fnEntry[3]);
            break;
          }
        }
      }
    }
  } catch {
    // Keep nulls — recorded as data gaps below.
  }
  if (registrar === null || createdAt === null) {
    dataGaps.push('RDAP registration data unavailable');
  }

  let tlsIssuer: string | null = null;
  const ctSubdomains = new Set<string>();
  try {
    const crtRes = await fetch(
      `/api/osint/crt?domain=${encodeURIComponent(domain)}`
    );
    if (crtRes.ok) {
      const crtData = await crtRes.json();
      if (Array.isArray(crtData) && crtData.length > 0) {
        const firstIssuer = String(crtData[0].issuer_name || '');
        const cnMatch =
          firstIssuer.match(/CN=([^,]+)/) || firstIssuer.match(/O=([^,]+)/);
        if (cnMatch) {
          tlsIssuer = cnMatch[1].trim();
        }
        for (const row of crtData) {
          const names = String(row.name_value || '').split('\n');
          for (const n of names) {
            const clean = n.trim().toLowerCase();
            if (clean && !clean.includes('*')) {
              ctSubdomains.add(clean);
            }
          }
        }
      }
    }
  } catch {
    // Keep null/empty — recorded as data gaps below.
  }
  if (tlsIssuer === null) {
    dataGaps.push('crt.sh certificate data unavailable');
  }
  if (!shodanData) {
    dataGaps.push('Shodan InternetDB exposure data unavailable');
  }
  if (!ripeBgpData) {
    dataGaps.push('RIPEstat BGP data unavailable');
  }

  const hasSpf = txtRecords.some((t) => t.includes('v=spf1'));
  const dmarcPolicy = dmarcTxt.length > 0 ? dmarcTxt[0] : null;

  const riskAssessment = computeDomainRiskScore({
    createdAt,
    hasDmarc: dmarcPolicy !== null,
    hasSpf,
    hasCaa: caaRecords.length > 0,
    shodanVulnCount: shodanData ? shodanData.vulns.length : null,
  });

  return {
    id: `dom-${Date.now()}`,
    domain,
    aRecords,
    aaaaRecords,
    mxRecords,
    nsRecords,
    txtRecords: txtRecords.slice(0, 4),
    dmarcPolicy,
    caaRecords,
    asn,
    asnOrg,
    ipCountry: ipWhoResult?.country_code || 'UNKNOWN',
    registrar,
    createdAt,
    tlsIssuer,
    ctSubdomainsCount: ctSubdomains.size,
    ctSubdomainsSample: Array.from(ctSubdomains).slice(0, 8),
    dataGaps,
    riskAssessment,
    provenance: makeLiveProvenance(
      'Cloudflare DoH · RDAP · crt.sh · Shodan InternetDB · RIPEstat'
    ),
    ...(shodanData ? { shodanData } : {}),
    ...(ripeBgpData ? { ripeBgpData } : {}),
  };
}

/**
 * Probes generated DNSTwist lookalike permutations in parallel via Cloudflare DoH
 * to see which typosquatted domains are actually registered & resolving on the live internet!
 */
export async function probeDnsTwistPermutationsLive(
  permutations: DnsTwistPermutation[]
): Promise<DnsTwistPermutation[]> {
  const probed = await Promise.all(
    permutations.map(async (perm) => {
      const aRecs = await queryCloudflareDoh(perm.domain, 'A');
      return {
        ...perm,
        isRegisteredLive: aRecs.length > 0,
        resolvedIp: aRecs[0] || undefined,
      };
    })
  );
  // Sort registered/active threats to the top
  probed.sort(
    (a, b) =>
      Number(Boolean(b.isRegisteredLive)) - Number(Boolean(a.isRegisteredLive)) ||
      b.similarityPercent - a.similarityPercent
  );
  return probed;
}

/**
 * 5A. GLEIF Global Legal Entity Identifier (LEI) + Wikidata + OpenAlex Institutional Graph Search
 */
export async function searchCorporateAndPublicEntities(
  query: string
): Promise<OsintEntity[]> {
  const results: OsintEntity[] = [];

  // 1. GLEIF Legal Entity Registry
  try {
    const gleifUrl = `https://api.gleif.org/api/v1/lei-records?filter[entity.legalName]=${encodeURIComponent(
      query
    )}&page[size]=4`;
    const gleifRes = await fetch(gleifUrl, {
      headers: { Accept: 'application/vnd.api+json' },
    });
    if (gleifRes.ok) {
      const gleifJson = await gleifRes.json();
      const records = Array.isArray(gleifJson?.data) ? gleifJson.data : [];
      for (const rec of records) {
        const lei = String(rec.id || rec.attributes?.lei || '');
        const entityAttr = rec.attributes?.entity || {};
        const regAttr = rec.attributes?.registration || {};
        const legalName = String(entityAttr.legalName?.name || query);
        const jurisdiction = String(
          entityAttr.jurisdiction ||
            entityAttr.legalAddress?.country ||
            'GLOBAL'
        );
        const city = String(entityAttr.legalAddress?.city || 'Registered HQ');
        const status = String(entityAttr.status || 'ACTIVE');
        const regStatus = String(regAttr.status || 'ISSUED');

        const highRiskJurisdictions = [
          'VG',
          'KY',
          'PA',
          'MH',
          'SC',
          'BZ',
          'CY',
        ];
        const riskLevel = highRiskJurisdictions.includes(jurisdiction)
          ? 'high'
          : 'low';

        results.push({
          id: `lei-${lei}`,
          label: legalName,
          type: 'company',
          jurisdiction,
          identifier: `LEI: ${lei}`,
          riskLevel,
          summary: `Official GLEIF Registered Legal Entity headquartered in ${city}, ${jurisdiction}. Entity Status: ${status} (${regStatus}).`,
          attributes: {
            'LEI Code': lei,
            'Legal Jurisdiction': jurisdiction,
            'HQ City': city,
            'Entity Status': status,
            'Registration Status': regStatus,
          },
          sourceUrl: `https://search.gleif.org/#/record/${lei}`,
        });
      }
    }
  } catch {
    // Continue
  }

  // 2. Wikidata Knowledge Graph
  try {
    const wdUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(
      query
    )}&language=en&limit=3&format=json&origin=*`;
    const wdRes = await fetch(wdUrl);
    if (wdRes.ok) {
      const wdJson = await wdRes.json();
      const searchItems = Array.isArray(wdJson?.search) ? wdJson.search : [];
      for (const item of searchItems) {
        const qid = String(item.id || '');
        const label = String(item.label || query);
        const desc = String(
          item.description || 'Public record entity in Wikidata knowledge graph'
        );
        const lowerDesc = desc.toLowerCase();
        const type: OsintEntity['type'] =
          lowerDesc.includes('ship') ||
          lowerDesc.includes('tanker') ||
          lowerDesc.includes('vessel')
            ? 'vessel'
            : lowerDesc.includes('politician') ||
              lowerDesc.includes('businessperson') ||
              lowerDesc.includes('oligarch') ||
              lowerDesc.includes('minister')
            ? 'person'
            : 'company';

        results.push({
          id: `wd-${qid}`,
          label,
          type,
          jurisdiction: 'INTL',
          identifier: `WIKIDATA: ${qid}`,
          riskLevel: 'medium',
          summary: `${desc} (Verified via Wikidata Open Knowledge Graph ${qid}).`,
          attributes: {
            'Wikidata QID': qid,
            Classification: desc,
            'Canonical URI': String(
              item.concepturi || `https://www.wikidata.org/wiki/${qid}`
            ),
          },
          sourceUrl: `https://www.wikidata.org/wiki/${qid}`,
        });
      }
    }
  } catch {
    // Continue
  }

  // 3. OpenAlex Global Research & Institutional Graph API (Zero API Key)
  try {
    const oaUrl = `https://api.openalex.org/institutions?search=${encodeURIComponent(
      query
    )}&per-page=2`;
    const oaRes = await fetch(oaUrl);
    if (oaRes.ok) {
      const oaJson = await oaRes.json();
      const insts = Array.isArray(oaJson?.results) ? oaJson.results : [];
      for (const inst of insts) {
        const oaId = String(inst.id || '').replace('https://openalex.org/', '');
        const ror = String(inst.ror || 'N/A');
        const country = String(inst.country_code || 'INTL');
        results.push({
          id: `oa-${oaId}`,
          label: String(inst.display_name || query),
          type: 'company',
          jurisdiction: country,
          identifier: `OPENALEX: ${oaId} · ROR: ${ror.slice(-9)}`,
          riskLevel: 'low',
          summary: `Research & Dual-Use Institutional Node (${inst.type || 'Facility'}) with ${Number(inst.works_count || 0).toLocaleString()} indexed technical publications.`,
          attributes: {
            'OpenAlex ID': oaId,
            'ROR Identifier': ror,
            'Publication Count': String(inst.works_count || 0),
            'Citations Count': String(inst.cited_by_count || 0),
          },
          sourceUrl: String(inst.id || 'https://openalex.org'),
        });
      }
    }
  } catch {
    // Ignore
  }

  return results;
}

/**
 * 5B. Maltego-Style 1-Click Transform: Crawl GLEIF Level-2 Direct & Ultimate Parent Corporate Entities
 *
 * Evidentiary contract: if GLEIF has no parent on record, or is unreachable,
 * the result says exactly that. This function NEVER invents a placeholder
 * parent entity — fabricated ownership is worse than no ownership.
 */
export async function expandGleifParentTransform(
  entity: OsintEntity
): Promise<GleifParentTransformResult> {
  const leiMatch = entity.identifier.match(/([A-Z0-9]{20})/);
  if (!leiMatch) {
    return {
      found: false,
      reason: 'NOT_A_GLEIF_ENTITY',
      detail: `"${entity.label}" has no GLEIF identifier — corporate parent pivots need a LEI (search the GLEIF registry first, or use a national registry such as OpenCorporates / Companies House).`,
    };
  }

  const lei = leiMatch[1];
  let res: Response;
  try {
    res = await fetch(
      `https://api.gleif.org/api/v1/lei-records/${encodeURIComponent(
        lei
      )}/ultimate-parent`
    );
  } catch {
    return {
      found: false,
      reason: 'GLEIF_UNAVAILABLE',
      detail: 'GLEIF upstream unreachable — retry when the registry is reachable.',
    };
  }

  if (!res.ok) {
    return {
      found: false,
      reason: 'GLEIF_ERROR',
      detail: `GLEIF API returned HTTP ${res.status} for LEI ${lei}.`,
    };
  }

  let json: {
    data?: { id?: string; attributes?: { entity?: { legalName?: { name?: string }; jurisdiction?: string } } };
  };
  try {
    json = await res.json();
  } catch {
    return {
      found: false,
      reason: 'GLEIF_ERROR',
      detail: `GLEIF returned a malformed payload for LEI ${lei}.`,
    };
  }

  const d = json?.data;
  if (!d || !d.id || d.id === lei) {
    return {
      found: false,
      reason: 'NO_PARENT_ON_RECORD',
      detail: `GLEIF has no Level-2 ultimate parent for ${entity.label} (LEI ${lei}) — it is either a standalone entity or reports a reporting exception.`,
    };
  }

  const parentLei = String(d.id);
  const parentName = String(
    d.attributes?.entity?.legalName?.name || `LEI ${parentLei}`
  );
  const parentJur = String(d.attributes?.entity?.jurisdiction || 'GLOBAL');
  const discoveredEntity: OsintEntity = {
    id: `lei-${parentLei}`,
    label: parentName,
    type: 'company',
    jurisdiction: parentJur,
    identifier: `LEI: ${parentLei}`,
    riskLevel: ['VG', 'KY', 'MH', 'CY', 'PA'].includes(parentJur)
      ? 'high'
      : 'low',
    summary: `GLEIF Level-2 ultimate parent of ${entity.label}, discovered from the official relationship record.`,
    attributes: {
      'LEI Code': parentLei,
      'Legal Jurisdiction': parentJur,
      'Discovery Transform': 'GLEIF L2 Ultimate Parent Relationship',
    },
    sourceUrl: `https://search.gleif.org/#/record/${parentLei}`,
  };
  const discoveredEdge: OwnershipEdge = {
    id: `edge-gleif-${Date.now()}`,
    sourceId: discoveredEntity.id,
    targetId: entity.id,
    relationship: 'Consolidating Ultimate Parent (GLEIF L2)',
    isOffshoreConduit: ['VG', 'KY', 'MH', 'CY', 'PA'].includes(parentJur),
    verifiedSource: 'GLEIF Level-2 Relationship Record',
  };

  return {
    found: true,
    discoveredEntity,
    discoveredEdge,
    provenance: makeLiveProvenance('GLEIF Level-2 Relationship Record'),
  };
}

/**
 * 6. Internet Archive Wayback Machine CDX Prior-Appearance Verifier
 */
export async function checkWaybackArchivalHistory(targetUrl: string): Promise<{
  totalCaptures: number;
  earliestTimestamp: string | null;
  latestTimestamp: string | null;
  captures: Array<{
    timestamp: string;
    formattedDate: string;
    originalUrl: string;
    mimeType: string;
    statusCode: string;
    digest: string;
  }>;
}> {
  try {
    const res = await fetch(
      `/api/osint/wayback?url=${encodeURIComponent(targetUrl)}`
    );
    if (res.ok) {
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length > 1) {
        const dataRows = rows.slice(1);
        const captures = dataRows.map((r: string[]) => {
          const ts = String(r[0] || '');
          const formattedDate =
            ts.length >= 8
              ? `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(
                  6,
                  8
                )} ${ts.slice(8, 10)}:${ts.slice(10, 12)} UTC`
              : ts;
          return {
            timestamp: ts,
            formattedDate,
            originalUrl: String(r[1] || targetUrl),
            mimeType: String(r[2] || 'text/html'),
            statusCode: String(r[3] || '200'),
            digest: String(r[4] || ''),
          };
        });

        return {
          totalCaptures: captures.length,
          earliestTimestamp: captures[0]?.formattedDate || null,
          latestTimestamp:
            captures[captures.length - 1]?.formattedDate || null,
          captures,
        };
      }
    }
  } catch {
    // Fallback
  }

  return {
    totalCaptures: 0,
    earliestTimestamp: null,
    latestTimestamp: null,
    captures: [],
  };
}
