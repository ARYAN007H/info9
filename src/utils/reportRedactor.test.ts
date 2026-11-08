import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildRedactedCaseClone, redactText } from './reportRedactor';
import { createBlankInvestigationCase } from './caseBundle';

describe('reportRedactor utilities', () => {
  it('redacts emails, IPv4s, phones, and custom keywords in text', () => {
    const raw =
      'Contact informant@example.org at +44 20 7946 0921 on host 185.220.101.5 regarding Project Helios.';
    const scrubbed = redactText(raw, {
      redactEmails: true,
      redactPhones: true,
      redactIps: true,
      customTerms: ['Project Helios'],
      executiveNote: '',
    });
    assert.ok(!scrubbed.includes('informant@example.org'));
    assert.ok(!scrubbed.includes('185.220.101.5'));
    assert.ok(!scrubbed.includes('Project Helios'));
    assert.ok(scrubbed.includes('[REDACTED-EMAIL]'));
    assert.ok(scrubbed.includes('[REDACTED-IP]'));
    assert.ok(scrubbed.includes('[REDACTED]'));
  });

  it('clones and redacts an InvestigationCase without mutating the original', () => {
    const orig = createBlankInvestigationCase('Source Protection Case');
    orig.entities.push({
      id: '1',
      label: 'John Witness',
      type: 'person',
      jurisdiction: 'UK',
      identifier: 'witness@example.com',
      riskLevel: 'low',
      summary: 'Reached via 192.0.2.44',
      attributes: {},
    });

    const redacted = buildRedactedCaseClone(orig, {
      redactEmails: true,
      redactPhones: false,
      redactIps: true,
      customTerms: ['John Witness'],
      executiveNote: 'Public release copy',
    });

    assert.equal(orig.entities[0].label, 'John Witness');
    assert.equal(redacted.entities[0].label, '[REDACTED]');
    assert.equal(redacted.entities[0].identifier, '[REDACTED-EMAIL]');
    assert.ok(redacted.summary.startsWith('Public release copy'));
  });
});
