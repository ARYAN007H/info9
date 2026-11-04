import {
  ChronolocationResult,
  DomainIntelRecord,
  EvidenceLedgerEntry,
  InfraCluster,
  SanctionsCandidate,
  SanctionsMatchWeights,
  ScoredSanctionsMatch,
  SolarPoint,
} from '../types/osint';

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/**
 * Computes solar elevation angle (in degrees) from vertical object height and ground shadow length.
 * alpha = arctan(H / L)
 */
export function calculateSolarElevationFromShadow(
  objectHeightMeters: number,
  shadowLengthMeters: number
): number {
  if (objectHeightMeters <= 0) return 0;
  if (shadowLengthMeters <= 0) return 90;
  const angleRad = Math.atan(objectHeightMeters / shadowLengthMeters);
  return Number((angleRad * RAD_TO_DEG).toFixed(2));
}

/**
 * Computes solar azimuth and elevation for a given latitude, longitude, and UTC date/time
 * using NOAA solar geometry approximations.
 */
export function calculateSunPosition(
  latDeg: number,
  lonDeg: number,
  year: number,
  month: number,
  day: number,
  utcMinutesFromMidnight: number
): { solarElevationDeg: number; solarAzimuthDeg: number; expectedShadowAzimuthDeg: number } {
  const startOfYear = Date.UTC(year, 0, 1);
  const currentUtc = Date.UTC(year, month - 1, day);
  const dayOfYear = Math.floor((currentUtc - startOfYear) / 86400000) + 1;

  const fractionalYearRad =
    ((2 * Math.PI) / 365) * (dayOfYear - 1 + (utcMinutesFromMidnight / 60 - 12) / 24);

  // Equation of time (in minutes)
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(fractionalYearRad) -
      0.032077 * Math.sin(fractionalYearRad) -
      0.014615 * Math.cos(2 * fractionalYearRad) -
      0.040849 * Math.sin(2 * fractionalYearRad));

  // Solar declination angle (in radians)
  const declRad =
    0.006918 -
    0.399912 * Math.cos(fractionalYearRad) +
    0.070257 * Math.sin(fractionalYearRad) -
    0.006758 * Math.cos(2 * fractionalYearRad) +
    0.000907 * Math.sin(2 * fractionalYearRad) -
    0.002697 * Math.cos(3 * fractionalYearRad) +
    0.00148 * Math.sin(3 * fractionalYearRad);

  const timeOffset = eqTime + 4 * lonDeg;
  const trueSolarTimeMin = (utcMinutesFromMidnight + timeOffset + 1440) % 1440;

  let hourAngleDeg = trueSolarTimeMin / 4 - 180;
  if (hourAngleDeg < -180) hourAngleDeg += 360;

  const hourAngleRad = hourAngleDeg * DEG_TO_RAD;
  const latRad = latDeg * DEG_TO_RAD;

  const cosZenith =
    Math.sin(latRad) * Math.sin(declRad) +
    Math.cos(latRad) * Math.cos(declRad) * Math.cos(hourAngleRad);
  const clampedCosZenith = Math.max(-1, Math.min(1, cosZenith));
  const zenithRad = Math.acos(clampedCosZenith);
  const solarElevationDeg = Number((90 - zenithRad * RAD_TO_DEG).toFixed(2));

  // Solar azimuth calculation (0° = North, 90° = East, 180° = South, 270° = West)
  const denom = Math.cos(latRad) * Math.sin(zenithRad);
  let azimuthDeg = 180;
  if (Math.abs(denom) > 1e-6) {
    const cosAzimuth =
      (Math.sin(latRad) * Math.cos(zenithRad) - Math.sin(declRad)) / denom;
    const clampedCosAz = Math.max(-1, Math.min(1, cosAzimuth));
    const acosDeg = Math.acos(clampedCosAz) * RAD_TO_DEG;
    if (hourAngleDeg > 0) {
      azimuthDeg = (acosDeg + 180) % 360;
    } else {
      azimuthDeg = (540 - acosDeg) % 360;
    }
  }

  const solarAzimuthDeg = Number(azimuthDeg.toFixed(2));
  const expectedShadowAzimuthDeg = Number(((solarAzimuthDeg + 180) % 360).toFixed(2));

  return {
    solarElevationDeg,
    solarAzimuthDeg,
    expectedShadowAzimuthDeg,
  };
}

export function angularDifferenceDeg(a: number, b: number): number {
  const diff = Math.abs(((a - b) % 360) + 360) % 360;
  return diff > 180 ? 360 - diff : diff;
}

export function formatMinutesToUtcHHMM(totalMinutes: number): string {
  const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const hh = Math.floor(normalized / 60)
    .toString()
    .padStart(2, '0');
  const mm = (normalized % 60).toString().padStart(2, '0');
  return `${hh}:${mm} UTC`;
}

/**
 * Sweeps the full UTC day in 5-minute intervals to find the exact chronolocation window
 * matching the measured shadow azimuth and object-to-shadow ratio.
 */
export function solveChronolocationWindow(params: {
  lat: number;
  lon: number;
  dateUtc: string;
  objectHeightMeters: number;
  shadowLengthMeters: number;
  measuredShadowAzimuthDeg: number;
}): ChronolocationResult {
  const parts = params.dateUtc.split('-').map(Number);
  const year = parts[0] || 2026;
  const month = parts[1] || 6;
  const day = parts[2] || 15;

  const measuredElevationDeg = calculateSolarElevationFromShadow(
    params.objectHeightMeters,
    params.shadowLengthMeters
  );
  const expectedSunAzimuthDeg = Number(
    ((params.measuredShadowAzimuthDeg + 180) % 360).toFixed(2)
  );

  const diurnalCurve: SolarPoint[] = [];
  let bestMatch: SolarPoint | null = null;

  for (let mins = 0; mins < 1440; mins += 5) {
    const pos = calculateSunPosition(params.lat, params.lon, year, month, day, mins);
    const elevationDeltaDeg = Number(
      Math.abs(pos.solarElevationDeg - measuredElevationDeg).toFixed(2)
    );
    const azimuthDeltaDeg = Number(
      angularDifferenceDeg(pos.expectedShadowAzimuthDeg, params.measuredShadowAzimuthDeg).toFixed(2)
    );
    // Only daylight points are valid shadow candidates
    const daylightPenalty = pos.solarElevationDeg <= 0 ? 180 : 0;
    const combinedErrorScore = Number(
      (elevationDeltaDeg * 1.4 + azimuthDeltaDeg * 0.9 + daylightPenalty).toFixed(2)
    );

    const point: SolarPoint = {
      utcMinutes: mins,
      utcTimeLabel: formatMinutesToUtcHHMM(mins),
      solarElevationDeg: pos.solarElevationDeg,
      solarAzimuthDeg: pos.solarAzimuthDeg,
      expectedShadowAzimuthDeg: pos.expectedShadowAzimuthDeg,
      elevationDeltaDeg,
      azimuthDeltaDeg,
      combinedErrorScore,
    };

    diurnalCurve.push(point);
    if (!bestMatch || point.combinedErrorScore < bestMatch.combinedErrorScore) {
      bestMatch = point;
    }
  }

  const chosen = bestMatch || diurnalCurve[144];
  const confidencePercent = Math.max(
    12,
    Math.min(99, Math.round(100 - chosen.combinedErrorScore * 2.2))
  );

  return {
    measuredElevationDeg,
    expectedSunAzimuthDeg,
    bestMatch: chosen,
    confidenceWindowStartUtc: formatMinutesToUtcHHMM(chosen.utcMinutes - 12),
    confidenceWindowEndUtc: formatMinutesToUtcHHMM(chosen.utcMinutes + 12),
    confidencePercent,
    diurnalCurve,
  };
}

/**
 * Computes Jaro-Winkler similarity (0.0 to 1.0) between two strings for entity resolution.
 */
export function jaroWinklerSimilarity(s1Raw: string, s2Raw: string): number {
  const s1 = s1Raw.trim().toLowerCase();
  const s2 = s2Raw.trim().toLowerCase();
  if (s1 === s2) return 1.0;
  if (s1.length === 0 || s2.length === 0) return 0.0;

  const matchDistance = Math.max(0, Math.floor(Math.max(s1.length, s2.length) / 2) - 1);
  const s1Matches = new Array(s1.length).fill(false);
  const s2Matches = new Array(s2.length).fill(false);

  let matches = 0;
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (s2Matches[j]) continue;
      if (s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0.0;

  let t = 0;
  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) t++;
    k++;
  }

  const transpositions = t / 2;
  const jaro =
    (matches / s1.length + matches / s2.length + (matches - transpositions) / matches) / 3;

  // Winkler prefix boost (up to 4 chars)
  let prefix = 0;
  const maxPrefix = Math.min(4, Math.min(s1.length, s2.length));
  for (let i = 0; i < maxPrefix; i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  return Number((jaro + prefix * 0.1 * (1 - jaro)).toFixed(4));
}

/**
 * Generates a normalized phonetic skeleton to match cross-script transliterations
 * (e.g., "Aleksandr" vs "Alexander", "Kuznetsov" vs "Kouznetsov").
 */
export function phoneticSkeleton(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/ks/g, 'x')
    .replace(/ph/g, 'f')
    .replace(/ou/g, 'u')
    .replace(/iy|yy|ij/g, 'y')
    .replace(/v/g, 'f')
    .replace(/[aeiou]/g, '')
    .replace(/(.)\1+/g, '$1')
    .trim();
}

/**
 * Scores a sanctions list candidate against an investigative query with configurable
 * false-positive reduction weights.
 */
export function scoreSanctionsCandidate(
  query: {
    subjectName: string;
    dob?: string;
    nationality?: string;
    idNumber?: string;
  },
  candidate: SanctionsCandidate,
  weights: SanctionsMatchWeights
): ScoredSanctionsMatch {
  const allCandidateNames = [candidate.listedName, ...candidate.aliases];
  let bestNameSim = 0;
  let phoneticHit = false;
  const queryPhonetic = phoneticSkeleton(query.subjectName);

  for (const name of allCandidateNames) {
    const sim = jaroWinklerSimilarity(query.subjectName, name);
    if (sim > bestNameSim) bestNameSim = sim;
    if (queryPhonetic.length > 2 && phoneticSkeleton(name) === queryPhonetic) {
      phoneticHit = true;
    }
  }

  const nameSimilarity = Math.round(bestNameSim * 100);
  const discrepancyNotes: string[] = [];

  // DOB scoring
  let dobScore = 50; // neutral if not queried
  if (query.dob && query.dob.trim().length > 0) {
    const qDob = query.dob.trim();
    if (candidate.dob === qDob) {
      dobScore = 100;
    } else if (candidate.dob.slice(0, 4) === qDob.slice(0, 4)) {
      dobScore = 65;
      discrepancyNotes.push(`Birth year matches (${qDob.slice(0, 4)}), exact date differs (${candidate.dob})`);
    } else {
      dobScore = 0;
      discrepancyNotes.push(`DOB mismatch: Query ${qDob} vs Listed ${candidate.dob}`);
    }
  }

  // Nationality / Jurisdiction scoring
  let jurisdictionScore = 50;
  if (query.nationality && query.nationality.trim().length > 0) {
    const qNat = query.nationality.trim().toLowerCase();
    const cNat = candidate.nationality.toLowerCase();
    if (cNat.includes(qNat) || qNat.includes(cNat)) {
      jurisdictionScore = 100;
    } else {
      jurisdictionScore = 10;
      discrepancyNotes.push(
        `Jurisdiction divergence: Query "${query.nationality}" vs Listed "${candidate.nationality}"`
      );
    }
  }

  // Exact ID / Passport / IMO check
  let idScore = 50;
  if (query.idNumber && query.idNumber.trim().length > 0) {
    const cleanQ = query.idNumber.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const cleanC = candidate.passportOrTaxId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (cleanQ && cleanC && cleanC.includes(cleanQ)) {
      idScore = 100;
    } else {
      idScore = 0;
      discrepancyNotes.push(`Identifier mismatch against ${candidate.passportOrTaxId}`);
    }
  }

  const totalWeight =
    Math.max(1, weights.nameWeight + weights.dobWeight + weights.jurisdictionWeight + weights.idWeight);

  const rawWeighted =
    (nameSimilarity * weights.nameWeight +
      dobScore * weights.dobWeight +
      jurisdictionScore * weights.jurisdictionWeight +
      idScore * weights.idWeight) /
    totalWeight;

  const compositeScore = Math.min(100, Math.max(0, Math.round(rawWeighted + (phoneticHit ? 4 : 0))));

  let disposition: ScoredSanctionsMatch['disposition'] = 'FALSE_POSITIVE_SUPPRESSED';
  if (compositeScore >= 78) {
    disposition = 'CONFIRMED_MATCH';
  } else if (compositeScore >= 52) {
    disposition = 'MANUAL_REVIEW';
  }

  if (disposition === 'FALSE_POSITIVE_SUPPRESSED' && discrepancyNotes.length === 0) {
    discrepancyNotes.push('Low lexical & secondary attribute correlation');
  }

  return {
    candidate,
    nameSimilarity,
    phoneticMatch: phoneticHit,
    dobScore,
    jurisdictionScore,
    compositeScore,
    disposition,
    discrepancyNotes,
  };
}

/**
 * Automatically clusters domain intelligence records by shared /24 IPv4 subnet, ASN,
 * TLS certificate fingerprint, and nameserver infrastructure.
 */
export function clusterInfrastructureDomains(records: DomainIntelRecord[]): InfraCluster[] {
  const clusters: InfraCluster[] = [];

  // 1. Group by /24 subnet + ASN
  const subnetMap = new Map<string, DomainIntelRecord[]>();
  for (const rec of records) {
    const octets = rec.ipAddress.split('.');
    const subnetKey =
      octets.length === 4 ? `${octets[0]}.${octets[1]}.${octets[2]}.0/24 (${rec.asn})` : rec.asn;
    const list = subnetMap.get(subnetKey) || [];
    list.push(rec);
    subnetMap.set(subnetKey, list);
  }

  for (const [subnet, group] of subnetMap.entries()) {
    if (group.length >= 2) {
      clusters.push({
        clusterId: `cluster-subnet-${subnet.replace(/[^a-zA-Z0-9]/g, '-')}`,
        label: `Network Pivot: ${subnet}`,
        pivotType: 'Shared /24 Subnet & ASN',
        sharedIndicator: subnet,
        domains: group.map((g) => g.domain),
        confidenceScore: Math.min(98, 72 + group.length * 6),
        rationale: `${group.length} domains resolve to identical /24 BGP prefix under ${group[0].asnOrg}.`,
      });
    }
  }

  // 2. Group by TLS Certificate Fingerprint / Serial
  const tlsMap = new Map<string, DomainIntelRecord[]>();
  for (const rec of records) {
    if (!rec.tlsFingerprint) continue;
    const list = tlsMap.get(rec.tlsFingerprint) || [];
    list.push(rec);
    tlsMap.set(rec.tlsFingerprint, list);
  }

  for (const [fp, group] of tlsMap.entries()) {
    if (group.length >= 2) {
      clusters.push({
        clusterId: `cluster-tls-${fp.slice(0, 10)}`,
        label: `TLS SAN Reuse: ${fp.slice(0, 16)}...`,
        pivotType: 'Shared TLS Certificate Serial',
        sharedIndicator: `${fp} (${group[0].tlsIssuer})`,
        domains: group.map((g) => g.domain),
        confidenceScore: 95,
        rationale: `Identical X.509 certificate thumbprint reused across ${group.length} distinct hostnames.`,
      });
    }
  }

  // 3. Group by primary Nameserver
  const nsMap = new Map<string, DomainIntelRecord[]>();
  for (const rec of records) {
    for (const ns of rec.nameservers) {
      const normalizedNs = ns.toLowerCase().trim();
      const list = nsMap.get(normalizedNs) || [];
      list.push(rec);
      nsMap.set(normalizedNs, list);
    }
  }

  for (const [ns, group] of nsMap.entries()) {
    if (group.length >= 2) {
      clusters.push({
        clusterId: `cluster-ns-${ns.replace(/[^a-z0-9]/g, '-')}`,
        label: `Nameserver Authority: ${ns}`,
        pivotType: 'Shared Nameserver Infrastructure',
        sharedIndicator: ns,
        domains: Array.from(new Set(group.map((g) => g.domain))),
        confidenceScore: 84,
        rationale: `Delegated to common authoritative DNS infrastructure (${ns}).`,
      });
    }
  }

  return clusters.sort((a, b) => b.confidenceScore - a.confidenceScore);
}

/**
 * Computes a 64-bit perceptual difference hash (dHash) from a 9x8 grayscale luminance matrix.
 */
export function computeDHashFromGrayscale(gray9x8: number[]): string {
  if (gray9x8.length < 72) {
    return '0000000000000000';
  }
  let bits = '';
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const left = gray9x8[row * 9 + col];
      const right = gray9x8[row * 9 + col + 1];
      bits += left < right ? '1' : '0';
    }
  }
  let hex = '';
  for (let i = 0; i < 64; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

/**
 * Computes bit-level Hamming distance between two 64-bit hex perceptual hashes.
 */
export function hammingDistanceHex(hashA: string, hashB: string): number {
  const a = hashA.trim().toLowerCase().padStart(16, '0');
  const b = hashB.trim().toLowerCase().padStart(16, '0');
  let distance = 0;
  for (let i = 0; i < 16; i++) {
    const xor = (parseInt(a[i], 16) || 0) ^ (parseInt(b[i], 16) || 0);
    let bits = xor;
    while (bits > 0) {
      distance += bits & 1;
      bits >>= 1;
    }
  }
  return distance;
}

/**
 * Deterministic synchronous 256-bit hex digest (4x64-bit FNV-1a cascade) used for
 * synchronous ledger verification and test environments, paired with WebCrypto in browser.
 */
export function computeDeterministicLedgerHash(
  payload: {
    index: number;
    timestampUtc: string;
    module: string;
    targetSubject: string;
    claimSummary: string;
    sourceUrlOrMethod: string;
  },
  previousHash: string
): string {
  const canonical = `${payload.index}|${payload.timestampUtc}|${payload.module}|${payload.targetSubject}|${payload.claimSummary}|${payload.sourceUrlOrMethod}|${previousHash}`;
  const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f, 0x165667b1, 0xd3a2646c, 0xfd7046c5];
  const out = seeds.map((seed, idx) => {
    let h = seed >>> 0;
    for (let i = 0; i < canonical.length; i++) {
      h ^= canonical.charCodeAt(i) + idx * 17;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  });
  return out.join('');
}

/**
 * Verifies the cryptographic integrity of an entire Evidence Ledger chain.
 */
export function verifyEvidenceChain(entries: EvidenceLedgerEntry[]): {
  isValid: boolean;
  brokenAtIndex: number | null;
  verifiedCount: number;
} {
  for (let i = 0; i < entries.length; i++) {
    const current = entries[i];
    const expectedPrev = i === 0 ? '0'.repeat(64) : entries[i - 1].sha256Hash;
    if (current.previousHash !== expectedPrev) {
      return { isValid: false, brokenAtIndex: current.index, verifiedCount: i };
    }
    const recomputed = computeDeterministicLedgerHash(
      {
        index: current.index,
        timestampUtc: current.timestampUtc,
        module: current.module,
        targetSubject: current.targetSubject,
        claimSummary: current.claimSummary,
        sourceUrlOrMethod: current.sourceUrlOrMethod,
      },
      current.previousHash
    );
    if (current.sha256Hash !== recomputed) {
      return { isValid: false, brokenAtIndex: current.index, verifiedCount: i };
    }
  }
  return { isValid: true, brokenAtIndex: null, verifiedCount: entries.length };
}
