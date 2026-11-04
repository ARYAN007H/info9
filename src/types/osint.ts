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
  elevationMeters: number;
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
  dmarcPolicy?: string;
  caaRecords?: string[];
  asn: string;
  asnOrg: string;
  ipCountry: string;
  registrar: string;
  createdAt: string;
  tlsIssuer: string;
  ctSubdomainsCount: number;
  ctSubdomainsSample: string[];
  riskScore: number;
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
    weatherVerification: WeatherVerificationData;
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
