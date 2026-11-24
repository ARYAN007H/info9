import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runLocalEvidenceAnalysis } from './aiCopilot';
import { createBlankInvestigationCase } from '../utils/caseBundle';
import { computeDomainRiskScore } from '../utils/riskScore';

function makeSampleCase() {
  const c = createBlankInvestigationCase('Alpha Maritime Probe');
  c.entities.push({
    id: 'ent-1',
    label: 'Vortex Shipping Holdings Ltd',
    type: 'company',
    jurisdiction: 'CY',
    identifier: 'LEI: 5493001KJTIIGC8Y1R12',
    riskLevel: 'high',
    summary: 'Cyprus holding vehicle linked to Baltic tanker operations.',
    attributes: {},
  });
  c.infraRecords.push({
    id: 'dom-1',
    domain: 'vortex-ops.example.com',
    aRecords: ['198.51.100.42'],
    aaaaRecords: [],
    mxRecords: [],
    nsRecords: ['ns1.example.com'],
    txtRecords: [],
    dmarcPolicy: null,
    caaRecords: [],
    asn: 'AS64500',
    asnOrg: 'Example Cloud Ltd',
    ipCountry: 'NL',
    registrar: 'Example Registrar',
    createdAt: '2026-01-12',
    tlsIssuer: "Let's Encrypt",
    ctSubdomainsCount: 4,
    ctSubdomainsSample: ['mail.vortex-ops.example.com'],
    dataGaps: ['Shodan InternetDB exposure data unavailable'],
    riskAssessment: computeDomainRiskScore({
      createdAt: '2026-01-12',
      hasDmarc: false,
      hasSpf: false,
      hasCaa: false,
      shodanVulnCount: 2,
    }),
    provenance: {
      status: 'LIVE',
      source: 'Cloudflare DoH',
      fetchedAtUtc: '2026-01-15T10:00:00.000Z',
    },
  });
  c.enrichedProfiles = [
    {
      platform: 'GitHub',
      handle: 'vortex_admin',
      profileUrl: 'https://github.com/vortex_admin',
      displayName: 'Alexei Novak',
      bio: 'Maritime telemetry tooling',
      location: 'Limassol',
      company: 'Vortex',
      websiteUrl: 'https://vortex-ops.example.com',
      avatarUrl: null,
      createdAtUtc: '2023-04-01T00:00:00.000Z',
      followersCount: 12,
      discoveredEmails: ['ops@vortex-ops.example.com'],
      activityTimestampsUtc: ['2026-01-15T09:12:00.000Z'],
      provenance: {
        status: 'LIVE',
        source: 'GitHub REST API',
        fetchedAtUtc: '2026-01-15T10:05:00.000Z',
      },
    },
  ];
  c.collectedPages = [
    {
      id: 'page-1',
      url: 'https://vortex-ops.example.com/contact',
      domain: 'vortex-ops.example.com',
      title: 'Vortex Operations Contact',
      description: 'Maritime charter contact page',
      fetchedAtUtc: '2026-01-15T10:10:00.000Z',
      httpStatus: 200,
      contentType: 'text/html',
      sha256: 'a'.repeat(64),
      excerpt: 'Send charter inquiries to ops@vortex-ops.example.com or BTC 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa.',
      artifacts: {
        emails: ['ops@vortex-ops.example.com'],
        phones: [],
        handles: ['@vortex_admin'],
        cryptoWallets: [
          { chain: 'BTC', address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa' },
        ],
        analyticsIds: [{ kind: 'GA4', id: 'G-ABCDEF1234' }],
        outboundDomains: [],
        socialLinks: [],
        metaAuthor: null,
        metaGenerator: null,
        faviconHash: -1234567,
        faviconUrl: null,
      },
      provenance: {
        status: 'LIVE',
        source: 'Live Page Extractor',
        fetchedAtUtc: '2026-01-15T10:10:00.000Z',
      },
    },
  ];
  return c;
}

describe('runLocalEvidenceAnalysis (zero-key copilot)', () => {
  it('produces falsifiable ACH hypotheses with supporting, contradicting, and gap sections', () => {
    const res = runLocalEvidenceAnalysis({
      mode: 'ach_matrix',
      caseData: makeSampleCase(),
    });
    assert.equal(res.mode, 'ach_matrix');
    assert.equal(res.provenance.status, 'DERIVED');
    assert.ok(res.achHypotheses && res.achHypotheses.length >= 2);
    for (const h of res.achHypotheses) {
      assert.ok(h.supportingEvidence.length > 0);
      assert.ok(h.contradictingEvidence.length > 0);
      assert.ok(h.missingEvidenceGaps.length > 0);
    }
  });

  it('extracts verbatim-quoted entities and relationships from rawText and case artifacts', () => {
    const raw =
      'Filing signed by Meridian Maritime Group Ltd, contact charter@meridian-ship.org and server 203.0.113.9.';
    const res = runLocalEvidenceAnalysis({
      mode: 'ner_extract',
      caseData: makeSampleCase(),
      rawText: raw,
    });
    assert.equal(res.mode, 'ner_extract');
    const labels = (res.nerEntities ?? []).map((e) => e.label);
    assert.ok(labels.includes('charter@meridian-ship.org'));
    assert.ok(labels.includes('203.0.113.9'));
    assert.ok(labels.includes('Meridian Maritime Group Ltd'));
    const emailEnt = res.nerEntities?.find((e) => e.label === 'charter@meridian-ship.org');
    assert.ok(emailEnt && emailEnt.verbatimQuote.includes('charter@meridian-ship.org'));
    assert.ok((res.nerRelationships ?? []).length > 0);
  });

  it('generates grounded next_pivots targeting real info9 modules', () => {
    const res = runLocalEvidenceAnalysis({
      mode: 'next_pivots',
      caseData: makeSampleCase(),
    });
    assert.equal(res.mode, 'next_pivots');
    assert.ok(res.recommendedPivots && res.recommendedPivots.length >= 3);
    const modules = new Set(res.recommendedPivots.map((p) => p.moduleId));
    assert.ok(modules.has('investigate') || modules.has('identity') || modules.has('sanctions'));
  });

  it('answers briefing_qa strictly from case evidence with explicit citations', () => {
    const res = runLocalEvidenceAnalysis({
      mode: 'briefing_qa',
      caseData: makeSampleCase(),
      question: 'What do we know about Vortex and ops@vortex-ops.example.com?',
    });
    assert.equal(res.mode, 'briefing_qa');
    assert.ok(res.answer && res.answer.includes('vortex-ops.example.com'));
    assert.ok(res.citations && res.citations.length >= 2);
  });
});
