import test from 'node:test';
import assert from 'node:assert/strict';
import { Info9Database, getConnectorStatusMatrix } from './database';
import { DEFAULT_WORKSPACE_CASE } from '../data/seedCases';

test('Info9Database persists cases, indexes pages with FTS5, and stores scan jobs', () => {
  const db = new Info9Database(':memory:');
  try {
    const sampleCase = DEFAULT_WORKSPACE_CASE;
    db.upsertCase(sampleCase);
    const loaded = db.listCases();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].id, sampleCase.id);

    db.saveCollectedPage(
      sampleCase.id,
      {
        id: 'page-test1',
        url: 'https://example.org/maritime-filing',
        domain: 'example.org',
        title: 'Meridian Maritime Beneficial Ownership Filing',
        description: 'Public registry filing',
        httpStatus: 200,
        contentType: 'text/html',
        sha256: 'abc123def456',
        fetchedAtUtc: '2026-03-01T12:00:00Z',
        excerpt: 'Beneficial owner recorded in Limassol Cyprus registry',
        artifacts: {
          emails: ['registry@example.org'],
          phones: [],
          handles: [],
          cryptoWallets: [],
          analyticsIds: [],
          outboundDomains: [],
          socialLinks: [],
          metaAuthor: null,
          metaGenerator: null,
          faviconHash: 12345,
          faviconUrl: null,
        },
        provenance: {
          status: 'LIVE',
          source: 'Web Hunter',
          fetchedAtUtc: '2026-03-01T12:00:00Z',
        },
      },
      'Meridian Maritime Beneficial Ownership Filing recorded in Limassol Cyprus registry with contact registry@example.org'
    );

    const hits = db.searchArchivedPages('Limassol Cyprus', sampleCase.id);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].domain, 'example.org');

    db.upsertScanJob({
      id: 'job-1',
      caseId: sampleCase.id,
      kind: 'domain',
      target: 'example.org',
      depth: 2,
      status: 'completed',
      entitiesFound: 5,
      edgesFound: 4,
      stepsCompleted: 6,
      resultJson: '{}',
      createdAtUtc: '2026-03-01T12:00:00Z',
      updatedAtUtc: '2026-03-01T12:01:00Z',
    });

    const jobs = db.listScanJobs(sampleCase.id);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].entitiesFound, 5);

    const stats = db.getStats();
    assert.equal(stats.caseCount, 1);
    assert.equal(stats.archivedPageCount, 1);
    assert.equal(stats.scanJobCount, 1);

    db.deleteCase(sampleCase.id);
    assert.equal(db.listCases().length, 0);
  } finally {
    db.close();
  }
});

test('getConnectorStatusMatrix lists zero-key active connectors and optional env connectors', () => {
  const matrix = getConnectorStatusMatrix();
  assert.ok(matrix.length >= 10);
  assert.ok(matrix.some((c) => c.mode === 'zero-key' && c.active));
  assert.ok(matrix.some((c) => c.envVar === 'GEMINI_API_KEY'));
});
