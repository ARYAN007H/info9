import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  approxDistanceMeters,
  distinctiveNameTokens,
  extractCoords,
  extractDomains,
  extractEmails,
  extractIps,
  pendingAutoLinks,
  shortHash,
  suggestAutoLinks,
} from './autoLinks';
import { buildCaseInvestigationGraph } from './caseGraph';
import { createBlankInvestigationCase } from './caseBundle';
import type { InvestigationCase } from '../types/osint';

/** Deterministic fixture: a case whose modules already reference each other. */
function buildFixture(): InvestigationCase {
  const c = createBlankInvestigationCase('AutoLink Fixture', 'FIX-01');
  c.entities.push({
    id: 'ent-1',
    label: 'Alpha Maritime Ltd',
    type: 'company',
    jurisdiction: 'CY',
    identifier: 'LEI-111',
    riskLevel: 'medium',
    summary: 'Ship operator',
    attributes: {},
  });
  c.infraRecords.push(
    {
      id: 'd1',
      domain: 'alpha-maritime.com',
      aRecords: ['198.51.100.10'],
      aaaaRecords: [],
      mxRecords: [],
      nsRecords: [],
      txtRecords: ['v=spf1 include:_spf.alpha-maritime.com -all'],
      dmarcPolicy: null,
      asn: 'AS13335',
      asnOrg: 'Cloudflare',
      ipCountry: 'US',
      registrar: 'Namecheap',
      createdAt: '2024-01-01',
      tlsIssuer: 'LetsEncrypt',
      ctSubdomainsCount: 2,
      ctSubdomainsSample: [],
      dataGaps: [],
      riskAssessment: { score: 20, factors: [] },
      provenance: { status: 'LIVE', source: 'DoH', fetchedAtUtc: '2026-11-08T00:00:00Z' },
    },
    {
      id: 'd2',
      domain: 'beta-logistics.net',
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
      ctSubdomainsCount: 1,
      ctSubdomainsSample: [],
      dataGaps: [],
      riskAssessment: { score: 25, factors: [] },
      provenance: { status: 'LIVE', source: 'DoH', fetchedAtUtc: '2026-11-08T00:00:00Z' },
    },
    {
      id: 'd3',
      domain: 'unrelated-shop.io',
      aRecords: ['203.0.113.9'],
      aaaaRecords: [],
      mxRecords: [],
      nsRecords: [],
      txtRecords: [],
      dmarcPolicy: null,
      asn: 'AS13335',
      asnOrg: 'Cloudflare',
      ipCountry: 'DE',
      registrar: 'Gandi',
      createdAt: '2023-06-01',
      tlsIssuer: 'LetsEncrypt',
      ctSubdomainsCount: 0,
      ctSubdomainsSample: [],
      dataGaps: [],
      riskAssessment: { score: 10, factors: [] },
      provenance: { status: 'LIVE', source: 'DoH', fetchedAtUtc: '2026-11-08T00:00:00Z' },
    }
  );
  c.geoState = {
    ...c.geoState,
    lat: 51.47305,
    lon: 0.0,
    locationLabel: 'Greenwich Park',
  };
  const mkEntry = (
    id: string,
    index: number,
    module: InvestigationCase['evidenceLedger'][number]['module'],
    targetLabel: string,
    findingSummary: string
  ) => ({
    index,
    id,
    timestampUtc: '2026-11-08T00:00:00Z',
    module,
    targetLabel,
    findingSummary,
    sourceUrl: 'local://fixture',
    previousHash: '0'.repeat(64),
    sha256Hash: '1'.repeat(64),
  });
  c.evidenceLedger.push(
    mkEntry(
      'led-a',
      1,
      'geolocation',
      'Site visit pin',
      'Pinned the subject location at 51.4732, 0.0012 — matches the area.'
    ),
    mkEntry(
      'led-b',
      2,
      'infra',
      'Domain scan',
      'Scanned alpha-maritime.com — hosting 198.51.100.10, SPF confirmed.'
    ),
    mkEntry(
      'led-c',
      3,
      'identity',
      'Identity sweep',
      'Handle found on forums mentioning beta-logistics.net repeatedly.'
    ),
    mkEntry(
      'led-d',
      4,
      'dossier',
      'Contact card',
      'Operations contact email ops@alpha-maritime.com verified via PGP.'
    )
  );
  return c;
}

describe('signal extraction', () => {
  it('extracts domains but not file extensions or version strings', () => {
    const text = 'Scan beta-logistics.net plus cdn.beta-logistics.net; see report.png and chart.svg (3.2.1 release).';
    assert.deepEqual(extractDomains(text).sort(), [
      'beta-logistics.net',
      'cdn.beta-logistics.net',
    ]);
  });

  it('extracts valid IPv4s only', () => {
    assert.deepEqual(extractIps('host 198.51.100.10 and 999.1.1.1 and 203.0.113.9'), [
      '198.51.100.10',
      '203.0.113.9',
    ]);
  });

  it('extracts lowercased emails', () => {
    assert.deepEqual(extractEmails('Ops@Alpha-Maritime.com and bounce@nope.org'), [
      'ops@alpha-maritime.com',
      'bounce@nope.org',
    ]);
  });

  it('extracts coordinate pairs and rejects zero islands', () => {
    const coords = extractCoords('pin 51.4732, 0.0012 then 0.0000, 0.0000 and 89.123, -45.678');
    assert.deepEqual(coords, [
      { lat: 51.4732, lon: 0.0012 },
      { lat: 89.123, lon: -45.678 },
    ]);
  });

  it('strips jurisdiction suffixes for distinctive tokens', () => {
    assert.deepEqual(distinctiveNameTokens('Alpha Maritime Ltd'), ['alpha', 'maritime']);
    assert.deepEqual(distinctiveNameTokens('The Holdings Group'), [], 'stopwords and short tokens drop');
  });

  it('shortHash is deterministic and collision-light on distinct inputs', () => {
    assert.equal(shortHash('a|b|c'), shortHash('a|b|c'));
    assert.notEqual(shortHash('a|b|c'), shortHash('a|b|d'));
  });

  it('approxDistanceMeters matches the local-plane scale used elsewhere', () => {
    // Greenwich Park → ~1.4 km east along the parallel
    const d = approxDistanceMeters(51.47305, 0.0, 51.47305, 0.018);
    assert.ok(d > 1200 && d < 1600, `got ${d}`);
    assert.ok(approxDistanceMeters(51, 0, 51.001, 0) > 100);
  });
});

describe('suggestAutoLinks', () => {
  const c = buildFixture();
  const graph = buildCaseInvestigationGraph(c, 860, 460);
  const suggestions = suggestAutoLinks(c, graph);
  const byKind = (kind: string) => suggestions.filter((s) => s.kind === kind);

  it('draws the shared-host edge the ring graph only counts', () => {
    const hosts = byKind('shared_host');
    assert.equal(hosts.length, 1);
    const s = hosts[0];
    assert.match(s.rationale, /198\.51\.100\.10/);
    assert.equal(s.confidence, 0.95);
    assert.ok(graph.nodes.some((n) => n.id === s.sourceNodeId), 'endpoint exists in graph');
    assert.ok(graph.nodes.some((n) => n.id === s.targetNodeId));
  });

  it('offers the weaker shared-ASN signal for distinct-host pairs', () => {
    const asns = byKind('shared_asn');
    assert.ok(asns.length >= 1);
    assert.match(asns[0].rationale, /AS13335/);
    assert.ok(asns[0].confidence < 0.95);
  });

  it('links ledger entries to scanned domains they mention', () => {
    const links = byKind('ledger_domain');
    assert.ok(links.some((s) => s.rationale.includes('alpha-maritime.com')));
    assert.ok(links.some((s) => s.rationale.includes('beta-logistics.net')));
  });

  it('links a ledger coordinate mention to the pinned location within 500 m', () => {
    const locs = byKind('ledger_location');
    assert.equal(locs.length, 1);
    assert.match(locs[0].rationale, /m from the pinned location/);
    assert.ok(locs[0].targetNodeId.startsWith('coord:'));
  });

  it('matches entity brand tokens into scanned domains', () => {
    const brands = byKind('entity_brand_domain');
    assert.ok(brands.some((s) => s.label.includes('Alpha Maritime') && s.label.includes('alpha-maritime.com')));
  });

  it('finds ledger pairs sharing a signal (email or domain)', () => {
    const shared = byKind('ledger_shared_signal');
    assert.ok(
      shared.some((s) => s.rationale.includes('alpha-maritime.com')),
      'the contact-card email is a shared signal with the domain-scan entry'
    );
  });

  it('suggestions are deterministic and sorted best-first', () => {
    const again = suggestAutoLinks(c, graph);
    assert.deepEqual(again.map((s) => s.id), suggestions.map((s) => s.id));
    const confidences = suggestions.map((s) => s.confidence);
    const sorted = [...confidences].sort((a, b) => b - a);
    assert.deepEqual(confidences, sorted);
  });

  it('never proposes self-edges or edges to nodes outside the graph', () => {
    for (const s of suggestions) {
      assert.notEqual(s.sourceNodeId, s.targetNodeId);
      assert.ok(graph.nodes.some((n) => n.id === s.sourceNodeId));
      assert.ok(graph.nodes.some((n) => n.id === s.targetNodeId));
    }
  });

  it('pendingAutoLinks filters accepted and dismissed deterministically', () => {
    const first = suggestions[0];
    const decisions = {
      accepted: [{ id: first.id, kind: first.kind, sourceNodeId: first.sourceNodeId, targetNodeId: first.targetNodeId, edgeLabel: first.edgeLabel, rationale: first.rationale, confidence: first.confidence, acceptedAtUtc: '2026-11-08T00:00:00Z' }],
      dismissedIds: [suggestions[1].id],
    };
    const pending = pendingAutoLinks(suggestions, decisions);
    assert.equal(pending.length, suggestions.length - 2);
    assert.ok(!pending.some((s) => s.id === first.id));
    // undefined decisions (old cases) → everything pending
    assert.equal(pendingAutoLinks(suggestions, undefined).length, suggestions.length);
  });

  it('an unrelated case yields no fabricated suggestions', () => {
    const empty = createBlankInvestigationCase('Blank', 'EMPTY-01');
    const graphEmpty = buildCaseInvestigationGraph(empty, 860, 460);
    assert.deepEqual(suggestAutoLinks(empty, graphEmpty), []);
  });
});
