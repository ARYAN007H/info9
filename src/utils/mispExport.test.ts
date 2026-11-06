import test from 'node:test';
import assert from 'node:assert/strict';
import { exportMispJson } from './osintForensics';
import { DEFAULT_WORKSPACE_CASE } from '../data/seedCases';

test('exportMispJson emits a valid MISP event with only recorded artifacts', () => {
  const withData = {
    ...DEFAULT_WORKSPACE_CASE,
    infraRecords: [
      {
        ...DEFAULT_WORKSPACE_CASE,
        id: 'dom-1',
        domain: 'example.com',
        aRecords: ['1.2.3.4'],
        aaaaRecords: [],
        mxRecords: [],
        nsRecords: ['ns1.example.com'],
        txtRecords: [],
        dmarcPolicy: null,
        asn: 'AS64496',
        asnOrg: 'Example Hosting',
        ipCountry: 'US',
        registrar: null,
        createdAt: '2020-01-01',
        tlsIssuer: null,
        ctSubdomainsCount: 0,
        ctSubdomainsSample: [],
        dataGaps: [],
        riskAssessment: { score: 0, factors: [] },
        provenance: {
          status: 'LIVE' as const,
          source: 'test',
          fetchedAtUtc: '2026-01-01T00:00:00Z',
        },
      },
    ],
    entities: [
      {
        id: 'ent-1',
        label: 'Test Person',
        type: 'person' as const,
        jurisdiction: 'DE',
        identifier: 'WIKIDATA: Q42',
        riskLevel: 'low' as const,
        summary: '',
        attributes: {},
      },
    ],
    evidenceLedger: [],
  };

  const parsed = JSON.parse(exportMispJson(withData));
  const event = parsed.Event;
  assert.ok(event);
  assert.match(event.info, /info9 investigation/);
  assert.equal(event.Attribute.length, 4); // 1 ip + 1 ns + 1 domain + 1 person text

  const types = event.Attribute.map((a: { type: string }) => a.type);
  assert.ok(types.includes('ip-dst'));
  assert.ok(types.includes('domain'));
  assert.equal(
    event.Attribute.filter((a: { type: string }) => a.type === 'ip-dst')[0].value,
    '1.2.3.4'
  );

  // empty case -> valid event with zero attributes
  const empty = JSON.parse(exportMispJson(DEFAULT_WORKSPACE_CASE));
  assert.equal(empty.Event.Attribute.length, 0);
});
