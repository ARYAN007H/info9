import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBehavioralHeatmap, buildUnifiedTimeline } from './timelineEngine';
import { DEFAULT_WORKSPACE_CASE } from '../data/seedCases';

test('buildUnifiedTimeline aggregates domain registrations, ledger, media, and enriched social timestamps in descending order', () => {
  const base = DEFAULT_WORKSPACE_CASE;
  const enrichedCase = {
    ...base,
    evidenceLedger: [
      {
        id: 'led-1',
        index: 1,
        timestampUtc: '2026-01-10T08:00:00Z',
        module: 'webhunter' as const,
        targetLabel: 'example.org',
        sourceUrl: 'https://example.org',
        findingSummary: 'Initial archival capture',
        previousHash: 'GENESIS',
        sha256Hash: 'abc123',
        provenance: { status: 'LIVE' as const, source: 'Web Hunter', fetchedAtUtc: '2026-01-10T08:00:00Z' },
      },
    ],
    enrichedProfiles: [
      {
        platform: 'GitHub',
        handle: 'demo_analyst',
        profileUrl: 'https://github.com/demo_analyst',
        displayName: 'Demo Analyst',
        bio: null,
        location: 'London',
        company: null,
        websiteUrl: null,
        avatarUrl: null,
        createdAtUtc: '2021-05-10T10:00:00Z',
        followersCount: 12,
        activityTimestampsUtc: ['2026-01-12T14:30:00Z', '2026-01-13T16:15:00Z'],
        discoveredEmails: [],
        provenance: { status: 'LIVE' as const, source: 'GitHub', fetchedAtUtc: '2026-01-14T00:00:00Z' },
      },
    ],
  };

  const timeline = buildUnifiedTimeline(enrichedCase);
  assert.ok(timeline.length >= 4);
  for (let i = 1; i < timeline.length; i++) {
    assert.ok(timeline[i - 1].epochMs >= timeline[i].epochMs);
  }
  assert.ok(timeline.some((e) => e.kind === 'social_created'));
  assert.ok(timeline.some((e) => e.kind === 'social_activity'));
});

test('buildBehavioralHeatmap computes 7x24 matrix and infers UTC timezone offset from sleep trough', () => {
  // Active strictly during 09:00–22:00 UTC -> sleep trough around 00:00–07:00 UTC (center 03:30 UTC -> UTC+0 / UTC+1)
  const timestamps: string[] = [];
  for (let day = 1; day <= 7; day++) {
    for (let hr = 9; hr <= 22; hr++) {
      timestamps.push(`2026-02-0${day}T${String(hr).padStart(2, '0')}:15:00Z`);
    }
  }
  const hm = buildBehavioralHeatmap(timestamps);
  assert.equal(hm.totalEvents, timestamps.length);
  assert.equal(hm.matrix.length, 7);
  assert.equal(hm.matrix[0].length, 24);
  assert.ok(hm.sleepWindowUtc !== null);
  assert.ok(hm.inferredUtcOffsetHours !== null);
  assert.ok(hm.inferredUtcOffsetHours >= -1 && hm.inferredUtcOffsetHours <= 2);
});

test('buildBehavioralHeatmap handles empty input gracefully', () => {
  const hm = buildBehavioralHeatmap([]);
  assert.equal(hm.totalEvents, 0);
  assert.equal(hm.sleepWindowUtc, null);
  assert.equal(hm.inferredUtcOffsetHours, null);
});
