import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateSolarElevationFromShadow,
  solveChronolocationWindow,
  jaroWinklerSimilarity,
  scoreSanctionsCandidate,
  clusterInfrastructureDomains,
  computeDHashFromGrayscale,
  hammingDistanceHex,
  computeDeterministicLedgerHash,
  verifyEvidenceChain,
} from './osintEngine';
import { DomainIntelRecord, EvidenceLedgerEntry, SanctionsCandidate } from '../types/osint';

test('calculateSolarElevationFromShadow returns 45 degrees when height equals shadow length', () => {
  const elevation = calculateSolarElevationFromShadow(10, 10);
  assert.equal(elevation, 45);
});

test('solveChronolocationWindow identifies morning vs afternoon UTC window from shadow azimuth', () => {
  // In Northern Hemisphere (e.g. Tallinn 59.437, 24.753), a shadow pointing West-Northwest (295 deg)
  // means the Sun is in the East-Southeast (115 deg), which occurs in the morning UTC.
  const morningResult = solveChronolocationWindow({
    lat: 59.437,
    lon: 24.753,
    dateUtc: '2026-06-21',
    objectHeightMeters: 12,
    shadowLengthMeters: 14,
    measuredShadowAzimuthDeg: 295,
  });

  assert.ok(morningResult.bestMatch.utcMinutes < 11 * 60, 'Expected morning UTC match for westward shadow');
  assert.ok(morningResult.confidencePercent > 60);
});

test('jaroWinklerSimilarity and scoreSanctionsCandidate suppress false positives when DOB and jurisdiction diverge', () => {
  const candidate: SanctionsCandidate = {
    id: 'sdn-101',
    listedName: 'Viktor Volodymyrovych Medvedchuk',
    aliases: ['Viktor Medvedchuk'],
    listSource: 'OFAC SDN',
    program: 'UKRAINE-EO13660',
    dob: '1954-08-07',
    nationality: 'Ukraine',
    passportOrTaxId: 'UA-8839201',
    entityKind: 'Individual',
    remarks: 'Designated oligarch and beneficial owner of offshore holding shells.',
  };

  const weights = { nameWeight: 40, dobWeight: 30, jurisdictionWeight: 20, idWeight: 10 };

  // 1. True positive match
  const trueMatch = scoreSanctionsCandidate(
    {
      subjectName: 'Viktor Medvedchuk',
      dob: '1954-08-07',
      nationality: 'Ukraine',
      idNumber: 'UA-8839201',
    },
    candidate,
    weights
  );
  assert.equal(trueMatch.disposition, 'CONFIRMED_MATCH');
  assert.ok(trueMatch.compositeScore >= 85);

  // 2. Common-name false positive (different DOB, different nationality, different ID)
  const falsePositive = scoreSanctionsCandidate(
    {
      subjectName: 'Viktor Medvedchuk',
      dob: '1992-03-19',
      nationality: 'Canada',
      idNumber: 'CA-994120',
    },
    candidate,
    weights
  );
  assert.equal(falsePositive.disposition, 'FALSE_POSITIVE_SUPPRESSED');
  assert.ok(falsePositive.discrepancyNotes.length >= 2);
});

test('clusterInfrastructureDomains groups domains sharing /24 subnet and TLS certificate', () => {
  const records: DomainIntelRecord[] = [
    {
      id: 'd1',
      domain: 'baltic-maritime-auth.com',
      ipAddress: '185.215.113.42',
      asn: 'AS49870',
      asnOrg: 'Alsycon B.V.',
      nameservers: ['ns1.mal-dns.org'],
      tlsIssuer: 'Let\'s Encrypt E5',
      tlsFingerprint: 'sha256:9f86d081884c7d659a2feaa0c55ad015',
      registrar: 'NameCheap',
      createdAt: '2026-10-12',
      mxRecords: [],
      txtRecords: [],
      riskRole: 'Typosquat Phish',
    },
    {
      id: 'd2',
      domain: 'baltic-maritime-login.net',
      ipAddress: '185.215.113.88',
      asn: 'AS49870',
      asnOrg: 'Alsycon B.V.',
      nameservers: ['ns1.mal-dns.org'],
      tlsIssuer: 'Let\'s Encrypt E5',
      tlsFingerprint: 'sha256:9f86d081884c7d659a2feaa0c55ad015',
      registrar: 'NameCheap',
      createdAt: '2026-10-13',
      mxRecords: [],
      txtRecords: [],
      riskRole: 'C2 Relay',
    },
  ];

  const clusters = clusterInfrastructureDomains(records);
  assert.ok(clusters.length >= 2);
  assert.ok(clusters.some((c) => c.pivotType === 'Shared /24 Subnet & ASN'));
  assert.ok(clusters.some((c) => c.pivotType === 'Shared TLS Certificate Serial'));
});

test('perceptual dHash and Merkle Evidence Chain detect tampering', () => {
  const rampA = Array.from({ length: 72 }, (_, i) => i * 3);
  const rampB = Array.from({ length: 72 }, (_, i) => i * 3);
  const hashA = computeDHashFromGrayscale(rampA);
  const hashB = computeDHashFromGrayscale(rampB);
  assert.equal(hammingDistanceHex(hashA, hashB), 0);

  const genesisPrev = '0'.repeat(64);
  const h1 = computeDeterministicLedgerHash(
    {
      index: 1,
      timestampUtc: '2026-11-03T04:00:00Z',
      module: 'geolocation',
      targetSubject: '59.4370, 24.7536',
      claimSummary: 'Verified solar azimuth matches 08:25 UTC capture window',
      sourceUrlOrMethod: 'NOAA Solar Solver',
    },
    genesisPrev
  );

  const entries: EvidenceLedgerEntry[] = [
    {
      id: 'e1',
      index: 1,
      timestampUtc: '2026-11-03T04:00:00Z',
      module: 'geolocation',
      targetSubject: '59.4370, 24.7536',
      claimSummary: 'Verified solar azimuth matches 08:25 UTC capture window',
      sourceUrlOrMethod: 'NOAA Solar Solver',
      confidenceLevel: 'High',
      previousHash: genesisPrev,
      sha256Hash: h1,
    },
  ];

  assert.equal(verifyEvidenceChain(entries).isValid, true);

  // Tamper with claimSummary
  entries[0].claimSummary = 'Tampered claim';
  const tamperedCheck = verifyEvidenceChain(entries);
  assert.equal(tamperedCheck.isValid, false);
  assert.equal(tamperedCheck.brokenAtIndex, 1);
});
