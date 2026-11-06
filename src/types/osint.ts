export type ModuleId =
  | 'geolocation'
  | 'dossier'
  | 'infra'
  | 'forensics'
  | 'sanctions';

export type EntityType =
  | 'company'
  | 'person'
  | 'vessel'
  | 'domain'
  | 'ip_asn'
  | 'location'
  | 'media';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Evidentiary provenance attached to intelligence values.
 * See src/utils/provenance.ts for constructor helpers and the contract.
 * - LIVE: returned by the named upstream for this exact query.
 * - DERIVED: computed locally from LIVE inputs.
 * - UNAVAILABLE: upstream failed or was never queried — no value may be
 *   substituted, and the UI must render an explicit gap.
 */
export type ProvenanceStatus = 'LIVE' | 'DERIVED' | 'UNAVAILABLE';

export interface ProvenanceMeta {
  status: ProvenanceStatus;
  source: string;
  fetchedAtUtc: string;
  note?: string;
}

/** One transparent, auditable contribution to a heuristic score. */
export interface RiskFactor {
  label: string;
  points: number;
}

/**
 * A heuristic score whose every contributing factor is disclosed.
 * Computed by src/utils/riskScore.ts — a triage aid, not a verdict.
 */
export interface DomainRiskAssessment {
  score: number;
  factors: RiskFactor[];
}

export interface OsintEntity {
  id: string;
  label: string;
  type: EntityType;
  jurisdiction: string;
  identifier: string; // LEI, IMO, Domain, Coordinate, or Passport/ID
  riskLevel: RiskLevel;
  summary: string;
  attributes: Record<string, string>;
  sourceUrl?: string;
}

export interface OwnershipEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relationship: string;
  ownershipPercent?: number;
  isOffshoreConduit?: boolean;
  isCircular?: boolean;
  verifiedSource: string;
}

/**
 * Result of a GLEIF Level-2 parent transform. When no parent is found, the
 * tool says so — it NEVER invents a placeholder entity.
 */
export type GleifParentTransformResult =
  | {
      found: true;
      discoveredEntity: OsintEntity;
      discoveredEdge: OwnershipEdge;
      provenance: ProvenanceMeta;
    }
  | {
      found: false;
      reason:
        | 'NOT_A_GLEIF_ENTITY'
        | 'NO_PARENT_ON_RECORD'
        | 'GLEIF_UNAVAILABLE'
        | 'GLEIF_ERROR';
      detail: string;
    };

export interface OverpassLandmark {
  id: string;
  name: string;
  category: string;
  lat: number;
  lon: number;
  distanceMeters: number;
  tags: Record<string, string>;
}

export interface OverpassConstraintClause {
  id: string;
  featureType:
    | 'power_substation'
    | 'power_tower'
    | 'storage_tank'
    | 'railway_crossing'
    | 'port_crane'
    | 'communications_tower'
    | 'waterway_dock';
  maxDistanceMeters: number;
  label: string;
}

export interface DemRadialPoint {
  compassBearing: string;
  bearingDeg: number;
  lat: number;
  lon: number;
  elevationMeters: number;
  horizonAngleDeg: number;
}

export interface WeatherVerificationData {
  /** null when the Open-Meteo elevation endpoint failed — never a guess. */
  elevationMeters: number | null;
  date: string;
  maxTempC: number;
  minTempC: number;
  cloudCoverMeanPercent: number;
  shortwaveRadiationSum: number;
  precipitationMm: number;
  shadowPlausibility:
    | 'CONFIRMED_CLEAR_SKY'
    | 'PARTIAL_CLOUD_COVER'
    | 'OVERCAST_ANOMALY';
  provenance: ProvenanceMeta;
}

export interface ShodanInternetDbData {
  ip: string;
  ports: number[];
  cpes: string[];
  hostnames: string[];
  tags: string[];
  vulns: string[];
}

export interface RipeBgpOverviewData {
  resource: string;
  announcedPrefix: string;
  holderName: string;
  asnCount: number;
  upstreamPeers: string[];
}

export interface DnsTwistPermutation {
  domain: string;
  fuzzerType:
    | 'homograph'
    | 'vowel-swap'
    | 'transposition'
    | 'hyphenation'
    | 'bitsquatting'
    | 'tld-swap';
  similarityPercent: number;
  isRegisteredLive?: boolean;
  resolvedIp?: string;
}

export interface InfraDomainRecord {
  id: string;
  domain: string;
  aRecords: string[];
  aaaaRecords: string[];
  mxRecords: string[];
  nsRecords: string[];
  txtRecords: string[];
  /** null = no DMARC record found (spoofing possible) or lookup failed. */
  dmarcPolicy: string | null;
  caaRecords?: string[];
  /** null when neither ipwho.is nor RIPEstat could attribute the IP. */
  asn: string | null;
  asnOrg: string | null;
  ipCountry: string;
  /** null when RDAP did not return the registrar — never a placeholder. */
  registrar: string | null;
  /** null when RDAP did not return a registration event. */
  createdAt: string | null;
  /** null when crt.sh returned nothing usable. */
  tlsIssuer: string | null;
  ctSubdomainsCount: number;
  ctSubdomainsSample: string[];
  /** Named list of upstreams that failed or were unavailable during the scan. */
  dataGaps: string[];
  /** Transparent heuristic with all factors disclosed. */
  riskAssessment: DomainRiskAssessment;
  provenance: ProvenanceMeta;
  shodanData?: ShodanInternetDbData;
  ripeBgpData?: RipeBgpOverviewData;
}

export interface InfraThreatCluster {
  clusterId: string;
  label: string;
  domains: string[];
  sharedSignals: string[];
  averageSimilarity: number;
  severity: RiskLevel;
}

export interface ForensicTargetSample {
  id: string;
  title: string;
  subtitle: string;
  sourceType: 'SYNTHETIC_SPLICE_SCENE' | 'UPLOADED_ARTIFACT';
  claimedDateUtc: string;
  claimedLocation: string;
  claimedCoords: [number, number];
  scenePreset: 'port_terminal' | 'substation_tower' | 'maritime_vessel';
  exifTags: Array<{
    tagId: string;
    name: string;
    value: string;
    status: 'NOMINAL' | 'MISMATCH' | 'STRIPPED';
  }>;
  spliceRegions: Array<{
    xRatio: number;
    yRatio: number;
    wRatio: number;
    hRatio: number;
    description: string;
  }>;
  dHashHex: string;
  waybackUrl: string;
}

export interface SanctionsCandidate {
  id: string;
  listedName: string;
  aliases: string[];
  listSource: 'OFAC_SDN' | 'EU_FSF' | 'UN_SC' | 'UK_OFSI' | 'WIKIDATA_PEP';
  program: string;
  entityType: 'INDIVIDUAL' | 'ENTITY' | 'VESSEL';
  dobOrIncorporation: string;
  citizenshipOrJurisdiction: string;
  identifierCode: string;
  notes: string;
}

export interface SanctionsMatchWeights {
  namePhoneticWeight: number;
  dobExactWeight: number;
  jurisdictionWeight: number;
  aliasOverlapWeight: number;
}

export interface SanctionsScoredResult {
  candidate: SanctionsCandidate;
  nameSimilarityScore: number;
  tokenSetScore: number;
  phoneticMatch: boolean;
  transliteratedQuery: string;
  dobScore: number;
  jurisdictionScore: number;
  bayesianPosteriorPercent: number;
  compositeScore: number;
  disposition:
    | 'CONFIRMED_TARGET'
    | 'POTENTIAL_MATCH_REVIEW'
    | 'FALSE_POSITIVE_ELIMINATED';
  eliminationReasons: string[];
}

export interface EvidenceLedgerEntry {
  index: number;
  id: string;
  timestampUtc: string;
  module: ModuleId;
  targetLabel: string;
  findingSummary: string;
  sourceUrl: string;
  previousHash: string;
  sha256Hash: string;
}

export interface InvestigationCase {
  id: string;
  codeName: string;
  title: string;
  classification: string;
  summary: string;
  updatedAtUtc: string;
  geoState: {
    lat: number;
    lon: number;
    zoom: number;
    locationLabel: string;
    dateIso: string;
    objectHeightMeters: number;
    shadowLengthMeters: number;
    measuredShadowAzimuthDeg: number;
    landmarks: OverpassLandmark[];
    /** null = never queried or upstream unavailable. Never pre-filled with guesses. */
    weatherVerification: WeatherVerificationData | null;
  };
  entities: OsintEntity[];
  ownershipEdges: OwnershipEdge[];
  infraRecords: InfraDomainRecord[];
  forensicSamples: ForensicTargetSample[];
  sanctionsQuery: {
    targetName: string;
    targetDob: string;
    targetJurisdiction: string;
    candidates: SanctionsCandidate[];
  };
  evidenceLedger: EvidenceLedgerEntry[];
}
