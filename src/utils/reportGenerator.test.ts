import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrintableReportHtml, escapeHtml } from './reportGenerator';
import { DEFAULT_WORKSPACE_CASE } from '../data/seedCases';
import { createLinkedLedgerEntry } from './osintForensics';

test('escapeHtml neutralizes markup in user-supplied strings', () => {
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(escapeHtml('"x"&\'y\''), '&quot;x&quot;&amp;&#39;y&#39;');
});

test('report contains provenance, gaps, hashes and methodology citations — never injected markup', () => {
  const hostile = '<img src=x onerror=alert(1)>';
  const base = {
    ...DEFAULT_WORKSPACE_CASE,
    forensicSamples: [],
    geoState: { ...DEFAULT_WORKSPACE_CASE.geoState, weatherVerification: null },
    infraRecords: [
      {
        ...DEFAULT_WORKSPACE_CASE,
        id: 'dom-1',
        domain: hostile,
        aRecords: ['1.2.3.4'],
        aaaaRecords: [],
        mxRecords: [],
        nsRecords: [],
        txtRecords: [],
        dmarcPolicy: null,
        asn: null,
        asnOrg: null,
        ipCountry: 'US',
        registrar: null,
        createdAt: null,
        tlsIssuer: null,
        ctSubdomainsCount: 0,
        ctSubdomainsSample: [],
        dataGaps: ['RDAP registration data unavailable'],
        riskAssessment: {
          score: 40,
          factors: [{ label: 'No DMARC record — email spoofing possible', points: 20 }],
        },
        provenance: {
          status: 'LIVE' as const,
          source: 'test',
          fetchedAtUtc: '2026-01-01T00:00:00Z',
        },
      },
    ],
    evidenceLedger: [],
  };
  const entry = createLinkedLedgerEntry(base.evidenceLedger, {
    module: 'identity',
    targetLabel: 'torvalds',
    findingSummary: '91 profiles found in sweep',
    sourceUrl: 'https://github.com/WebBreacher/WhatsMyName',
    timestampUtc: '2026-01-01T00:00:00.000Z',
  });
  const html = buildPrintableReportHtml(
    { ...base, evidenceLedger: [entry] },
    '2026-01-01T00:00:00.000Z'
  );

  // hostile domain must be escaped everywhere it appears
  assert.ok(!html.includes('<img src=x'), 'unescaped user content leaked into report!');
  assert.ok(html.includes('&lt;img src=x'), 'domain should appear escaped');

  // provenance and gaps are explicit
  assert.ok(html.includes('NO DATA'), 'missing weather must render as an explicit gap');
  assert.ok(html.includes('RDAP registration data unavailable'));
  assert.ok(html.includes('Heuristic risk'), 'transparent risk factor disclosure missing');
  assert.ok(html.includes('No DMARC record — email spoofing possible'));

  // ledger verification + hash
  assert.ok(html.includes('VERIFIED (1 blocks)'));
  assert.ok(html.includes(entry.sha256Hash));

  // methodology citations for the modules that have data
  assert.ok(html.includes('methodology/infrastructure-recon.md'));
  assert.ok(html.includes('methodology/identity.md'));
  assert.ok(html.includes('NOAA Solar Calculator'));

  // empty sections must not render
  assert.ok(!html.includes('Ownership links'));
  assert.ok(!html.includes('Media forensics samples'));
});
