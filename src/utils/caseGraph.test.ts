import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCaseInvestigationGraph } from './caseGraph';
import { createBlankInvestigationCase } from './caseBundle';

describe('buildCaseInvestigationGraph', () => {
  it('builds a connected graph with shared ASN/IP bridges across domains and entities', () => {
    const c = createBlankInvestigationCase('Graph Test', 'GRAPH-01');
    c.entities.push(
      {
        id: 'e1',
        label: 'Alpha Maritime Ltd',
        type: 'company',
        jurisdiction: 'CY',
        identifier: 'LEI-111',
        riskLevel: 'medium',
        summary: 'Parent holding',
        attributes: {},
      },
      {
        id: 'e2',
        label: 'Beta Tankers SA',
        type: 'company',
        jurisdiction: 'PA',
        identifier: 'LEI-222',
        riskLevel: 'high',
        summary: 'Subsidiary',
        attributes: {},
      }
    );
    c.ownershipEdges.push({
      id: 'edge-1',
      sourceId: 'e1',
      targetId: 'e2',
      relationship: 'Parent',
      ownershipPercent: 75,
      verifiedSource: 'GLEIF',
    });
    c.infraRecords.push(
      {
        id: 'd1',
        domain: 'alpha-ship.com',
        aRecords: ['198.51.100.10'],
        aaaaRecords: [],
        mxRecords: [],
        nsRecords: [],
        txtRecords: [],
        dmarcPolicy: null,
        asn: 'AS13335',
        asnOrg: 'Cloudflare',
        ipCountry: 'US',
        registrar: 'Namecheap',
        createdAt: '2024-01-01',
        tlsIssuer: 'LetsEncrypt',
        ctSubdomainsCount: 4,
        ctSubdomainsSample: [],
        dataGaps: [],
        riskAssessment: { score: 20, factors: [] },
        provenance: { status: 'LIVE', source: 'DoH', fetchedAtUtc: '2026-11-08T00:00:00Z' },
      },
      {
        id: 'd2',
        domain: 'beta-tankers.com',
        aRecords: ['198.51.100.10'],
        aaaaRecords: [],
        mxRecords: [],
        nsRecords: [],
        txtRecords: [],
        dmarcPolicy: null,
        asn: 'AS13335',
        asnOrg: 'Cloudflare',
        ipCountry: 'US',
        registrar: 'Namecheap',
        createdAt: '2024-02-01',
        tlsIssuer: 'LetsEncrypt',
        ctSubdomainsCount: 2,
        ctSubdomainsSample: [],
        dataGaps: [],
        riskAssessment: { score: 25, factors: [] },
        provenance: { status: 'LIVE', source: 'DoH', fetchedAtUtc: '2026-11-08T00:00:00Z' },
      }
    );

    const model = buildCaseInvestigationGraph(c);
    assert.ok(model.nodes.length >= 7);
    assert.ok(model.edges.length >= 6);
    assert.ok(model.stats.sharedInfraBridges >= 1);
  });
});
