import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBlankInvestigationCase,
  parseAndVerifyCaseBundle,
  serializeCaseBundle,
} from './caseBundle';
import { createLinkedLedgerEntry } from './osintForensics';

describe('caseBundle serialization and verification', () => {
  it('creates a clean investigation case with normalized codename', () => {
    const c = createBlankInvestigationCase('Operation Baltic Shield');
    assert.equal(c.codeName, 'OPERATION-BALTIC-SHIELD');
    assert.equal(c.entities.length, 0);
    assert.equal(c.evidenceLedger.length, 0);
  });

  it('round-trips a case bundle with verified SHA-256 chain and checksum', () => {
    const base = createBlankInvestigationCase('Test Case Alpha', 'ALPHA-01');
    const b1 = createLinkedLedgerEntry(base.evidenceLedger, {
      module: 'infra',
      targetLabel: 'example.com',
      findingSummary: 'Resolved A record 93.184.216.34',
      sourceUrl: 'https://example.com',
      timestampUtc: '2026-11-08T00:00:00.000Z',
    });
    const withEntry = { ...base, evidenceLedger: [b1] };

    const json = serializeCaseBundle(withEntry, '2026-11-08T01:00:00.000Z');
    const verified = parseAndVerifyCaseBundle(json);

    assert.equal(verified.chainValid, true);
    assert.equal(verified.checksumVerified, true);
    assert.equal(verified.warnings.length, 0);
    assert.equal(verified.caseData.codeName, 'ALPHA-01');
    assert.equal(verified.caseData.evidenceLedger.length, 1);
  });

  it('detects tampered ledger entries on bundle import', () => {
    const base = createBlankInvestigationCase('Tamper Test', 'TAMPER-01');
    const b1 = createLinkedLedgerEntry(base.evidenceLedger, {
      module: 'dossier',
      targetLabel: 'Acme Holdings',
      findingSummary: 'Original verified finding',
      sourceUrl: 'https://api.gleif.org',
    });
    const json = serializeCaseBundle({ ...base, evidenceLedger: [b1] });
    const mutated = json.replace('Original verified finding', 'Forged finding');

    const res = parseAndVerifyCaseBundle(mutated);
    assert.equal(res.chainValid, false);
    assert.equal(res.checksumVerified, false);
    assert.equal(res.tamperedIndex, 1);
    assert.ok(res.warnings.length >= 1);
  });
});
