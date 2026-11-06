import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateShadowElevation,
  calculateSolarPosition,
  solveChronolocationTimeWindow,
  solveBlindSolarCoordinates,
  buildOverpassIntersectionQuery,
  haversineDistanceKm,
  projectBearingCoordinate,
} from './solarMath';
import {
  jaroWinklerSimilarity,
  tokenSetSimilarity,
  transliterateAndNormalizeName,
  soundexCode,
  scoreSanctionsCandidate,
  analyzeCorporateGraphTopology,
  generateDnsTwistPermutations,
  clusterInfrastructureDomains,
  createLinkedLedgerEntry,
  verifyEvidenceLedgerChain,
  computeMerkleRoot,
} from './osintForensics';
import type { EvidenceLedgerEntry } from '../types/osint';

test('calculateShadowElevation computes exact 45 degree solar elevation when height equals shadow length', () => {
  const res = calculateShadowElevation(12.5, 12.5);
  assert.equal(res.elevationDeg, 45);
  assert.equal(res.ratio, 1);
});

test('calculateSolarPosition and solveChronolocationTimeWindow pinpoint accurate UTC window', () => {
  const lat = 59.9343;
  const lon = 30.3351;
  const sampleUtc = new Date(Date.UTC(2026, 5, 15, 10, 0, 0));
  const pos = calculateSolarPosition(lat, lon, sampleUtc);
  assert.equal(pos.isDaylight, true);
  assert.ok(pos.elevationDeg > 40 && pos.elevationDeg < 60);

  const solved = solveChronolocationTimeWindow(
    lat,
    lon,
    '2026-06-15',
    pos.elevationDeg,
    pos.shadowAzimuthDeg,
    6
  );
  assert.ok(solved.bestMatches.length >= 1);
  assert.ok(Math.abs(solved.bestMatches[0].utcHoursDecimal - 10.0) <= 0.15);
});

test('solveBlindSolarCoordinates recovers candidate latitude/longitude from solar angles alone', () => {
  const trueLat = 54.7;
  const trueLon = 20.4;
  const dt = new Date(Date.UTC(2026, 5, 18, 12, 0, 0));
  const pos = calculateSolarPosition(trueLat, trueLon, dt);

  const blindHits = solveBlindSolarCoordinates(
    '2026-06-18',
    12.0,
    pos.elevationDeg,
    pos.shadowAzimuthDeg
  );
  assert.ok(blindHits.length >= 1);
  assert.ok(Math.abs(blindHits[0].lat - trueLat) <= 1.5);
  assert.ok(Math.abs(blindHits[0].lon - trueLon) <= 1.5);
});

test('buildOverpassIntersectionQuery compiles multi-clause around intersection script', () => {
  const ql = buildOverpassIntersectionQuery(
    [
      { id: 'c1', featureType: 'power_substation', maxDistanceMeters: 500, label: 'Substation' },
      { id: 'c2', featureType: 'railway_crossing', maxDistanceMeters: 350, label: 'Rail Crossing' },
    ],
    54.6968,
    20.3694,
    3000
  );
  assert.ok(ql.includes('around.set0:350'));
  assert.ok(ql.includes('.set1 out center'));
});

test('haversineDistanceKm and projectBearingCoordinate are mathematically consistent', () => {
  const [destLat, destLon] = projectBearingCoordinate(54.7104, 20.4522, 90, 5.0);
  const dist = haversineDistanceKm(54.7104, 20.4522, destLat, destLon);
  assert.ok(Math.abs(dist - 5.0) < 0.05);
});

test('transliterateAndNormalizeName and tokenSetSimilarity match Cyrillic and reordered names', () => {
  const translit = transliterateAndNormalizeName('В. А. Морозов');
  assert.ok(translit.includes('morozov'));
  const tokenSim = tokenSetSimilarity(
    'MOROZOV, Viktor Alekseevich',
    'Viktor Alekseyevich Morozov'
  );
  assert.ok(tokenSim > 0.94);
});

test('scoreSanctionsCandidate eliminates chronological false positives while confirming true matches', () => {
  const weights = {
    namePhoneticWeight: 40,
    dobExactWeight: 30,
    jurisdictionWeight: 20,
    aliasOverlapWeight: 10,
  };

  const trueHit = scoreSanctionsCandidate(
    {
      targetName: 'Viktor Alekseyevich Morozov',
      targetDob: '1968-04-14',
      targetJurisdiction: 'Russian Federation',
    },
    {
      id: 'sdn-1',
      listedName: 'MOROZOV, Viktor Alekseevich',
      aliases: ['Viktor Morozov'],
      listSource: 'OFAC_SDN',
      program: 'E.O. 14024',
      entityType: 'INDIVIDUAL',
      dobOrIncorporation: '1968-04-14',
      citizenshipOrJurisdiction: 'Russian Federation',
      identifierCode: 'OFAC-48291',
      notes: 'Maritime logistics director',
    },
    weights
  );

  assert.equal(trueHit.disposition, 'CONFIRMED_TARGET');
  assert.ok(trueHit.compositeScore >= 85);
  assert.ok(trueHit.bayesianPosteriorPercent >= 90);

  const falsePositive = scoreSanctionsCandidate(
    {
      targetName: 'Viktor Morozov',
      targetDob: '1994-11-02',
      targetJurisdiction: 'Estonia',
    },
    {
      id: 'sdn-1',
      listedName: 'MOROZOV, Viktor Alekseevich',
      aliases: ['Viktor Morozov'],
      listSource: 'OFAC_SDN',
      program: 'E.O. 14024',
      entityType: 'INDIVIDUAL',
      dobOrIncorporation: '1968-04-14',
      citizenshipOrJurisdiction: 'Russian Federation',
      identifierCode: 'OFAC-48291',
      notes: 'Maritime logistics director',
    },
    weights
  );

  assert.equal(falsePositive.disposition, 'FALSE_POSITIVE_ELIMINATED');
  assert.ok(falsePositive.eliminationReasons.length >= 2);
});

test('analyzeCorporateGraphTopology calculates multi-hop effective equity and detects circular loops', () => {
  const entities = [
    { id: 'e1', label: 'UBO Alpha', type: 'person' as const, jurisdiction: 'RU', identifier: '1', riskLevel: 'high' as const, summary: '', attributes: {} },
    { id: 'e2', label: 'Shell Beta', type: 'company' as const, jurisdiction: 'CY', identifier: '2', riskLevel: 'high' as const, summary: '', attributes: {} },
    { id: 'e3', label: 'Shell Gamma', type: 'company' as const, jurisdiction: 'MH', identifier: '3', riskLevel: 'critical' as const, summary: '', attributes: {} },
  ];
  const edges = [
    { id: 'ed1', sourceId: 'e1', targetId: 'e2', relationship: '80%', ownershipPercent: 80, verifiedSource: 'Reg' },
    { id: 'ed2', sourceId: 'e2', targetId: 'e3', relationship: '50%', ownershipPercent: 50, isOffshoreConduit: true, verifiedSource: 'Reg' },
    { id: 'ed3', sourceId: 'e3', targetId: 'e2', relationship: '25%', ownershipPercent: 25, isCircular: true, verifiedSource: 'Reg' },
  ];

  const topo = analyzeCorporateGraphTopology(entities, edges);
  const twoHop = topo.effectiveOwnershipPaths.find(
    (p) => p.fromEntity === 'UBO Alpha' && p.toEntity === 'Shell Gamma'
  );
  assert.ok(twoHop);
  assert.equal(twoHop.effectiveEquityPercent, 40.0); // 80% * 50% = 40%
  assert.ok(topo.circularLoops.length >= 1);
});

test('generateDnsTwistPermutations produces homograph, hyphenation, and tld-swap lookalikes', () => {
  const perms = generateDnsTwistPermutations('maersk.com');
  assert.ok(perms.length >= 8);
  assert.ok(perms.some((p) => p.fuzzerType === 'hyphenation'));
  assert.ok(perms.some((p) => p.fuzzerType === 'tld-swap'));
});

test('clusterInfrastructureDomains groups domains sharing ASN and nameservers', () => {
  const clusters = clusterInfrastructureDomains([
    {
      id: 'd1',
      domain: 'baltic-bunker-logistics.com',
      aRecords: ['185.215.113.42'],
      aaaaRecords: [],
      mxRecords: [],
      nsRecords: ['ns1.bulletproof-dns.net'],
      txtRecords: [],
      asn: 'AS204915',
      asnOrg: 'VegaTransit Telecom Ltd',
      ipCountry: 'SC',
      registrar: 'NameCheap',
      createdAt: '2026-01-12',
      tlsIssuer: "Let's Encrypt E5",
      dmarcPolicy: null,
      ctSubdomainsCount: 8,
      ctSubdomainsSample: ['auth.baltic-bunker-logistics.com'],
      dataGaps: [],
      riskAssessment: { score: 91, factors: [{ label: 'fixture', points: 91 }] },
      provenance: {
        status: 'LIVE',
        source: 'test fixture',
        fetchedAtUtc: '2026-11-01T00:00:00.000Z',
      },
    },
    {
      id: 'd2',
      domain: 'baltic-bunker-portal.net',
      aRecords: ['185.215.113.49'],
      aaaaRecords: [],
      mxRecords: [],
      nsRecords: ['ns1.bulletproof-dns.net'],
      txtRecords: [],
      asn: 'AS204915',
      asnOrg: 'VegaTransit Telecom Ltd',
      ipCountry: 'SC',
      registrar: 'NameCheap',
      createdAt: '2026-01-14',
      tlsIssuer: "Let's Encrypt E5",
      dmarcPolicy: null,
      ctSubdomainsCount: 5,
      ctSubdomainsSample: ['sso.baltic-bunker-portal.net'],
      dataGaps: [],
      riskAssessment: { score: 88, factors: [{ label: 'fixture', points: 88 }] },
      provenance: {
        status: 'LIVE',
        source: 'test fixture',
        fetchedAtUtc: '2026-11-01T00:00:00.000Z',
      },
    },
  ]);

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].domains.length, 2);
  assert.equal(clusters[0].severity, 'critical');
});

test('Evidence Ledger SHA-256 chain and Merkle Root detect tampering accurately', () => {
  const ledger: EvidenceLedgerEntry[] = [];
  const block1 = createLinkedLedgerEntry(ledger, {
    module: 'geolocation',
    targetLabel: '54.7104, 20.4522',
    findingSummary: 'Verified shadow azimuth 62.4 deg at Kaliningrad terminal',
    sourceUrl: 'https://overpass-api.de/api/interpreter',
    timestampUtc: '2026-11-01T12:00:00.000Z',
  });
  ledger.push(block1);

  const block2 = createLinkedLedgerEntry(ledger, {
    module: 'dossier',
    targetLabel: 'Vega Maritime Holdings Ltd',
    findingSummary: 'Identified 78% beneficial ownership via Marshall Islands shell',
    sourceUrl: 'https://api.gleif.org/api/v1/lei-records',
    timestampUtc: '2026-11-01T12:05:00.000Z',
  });
  ledger.push(block2);

  const validCheck = verifyEvidenceLedgerChain(ledger);
  assert.equal(validCheck.isValid, true);
  assert.equal(validCheck.verifiedCount, 2);
  assert.equal(validCheck.merkleRoot.length, 64);

  const tamperedLedger = [
    { ...block1, findingSummary: 'Altered summary string' },
    block2,
  ];
  const invalidCheck = verifyEvidenceLedgerChain(tamperedLedger);
  assert.equal(invalidCheck.isValid, false);
  assert.equal(invalidCheck.tamperedIndex, 1);
  assert.equal(computeMerkleRoot(ledger).length, 64);
});

test('jaroWinklerSimilarity and soundexCode handle transliteration variants', () => {
  assert.ok(jaroWinklerSimilarity('Morozov', 'Morosov') > 0.88);
  assert.equal(soundexCode('Morozov'), soundexCode('Morosov'));
});
