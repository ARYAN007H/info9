import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatFetchedAt,
  isVerifiable,
  makeDerivedProvenance,
  makeLiveProvenance,
  makeUnavailableProvenance,
  summarizeProvenance,
} from './provenance';

const T0 = '2026-11-07T14:02:11.482Z';

test('makeLiveProvenance stamps LIVE status with source and injectable clock', () => {
  const meta = makeLiveProvenance('Open-Meteo ERA5 Archive', T0);
  assert.equal(meta.status, 'LIVE');
  assert.equal(meta.source, 'Open-Meteo ERA5 Archive');
  assert.equal(meta.fetchedAtUtc, T0);
  assert.equal(meta.note, undefined);
});

test('makeDerivedProvenance and makeUnavailableProvenance carry an explanatory note', () => {
  const derived = makeDerivedProvenance('info9 risk model', 'additive rule table', T0);
  assert.equal(derived.status, 'DERIVED');
  assert.equal(derived.note, 'additive rule table');

  const unavail = makeUnavailableProvenance('RDAP', 'upstream timeout', T0);
  assert.equal(unavail.status, 'UNAVAILABLE');
  assert.equal(unavail.note, 'upstream timeout');
});

test('formatFetchedAt renders display form or echoes unparseable input', () => {
  assert.equal(formatFetchedAt(T0), '2026-11-07 14:02 UTC');
  assert.equal(formatFetchedAt('not-a-date'), 'not-a-date');
});

test('summarizeProvenance joins status, source, optional note, and timestamp', () => {
  assert.equal(
    summarizeProvenance(makeLiveProvenance('GLEIF API', T0)),
    'LIVE · GLEIF API · 2026-11-07 14:02 UTC'
  );
  assert.equal(
    summarizeProvenance(makeUnavailableProvenance('crt.sh', 'HTTP 503', T0)),
    'UNAVAILABLE · crt.sh · HTTP 503 · 2026-11-07 14:02 UTC'
  );
});

test('isVerifiable rejects UNAVAILABLE provenance only', () => {
  assert.equal(isVerifiable(makeLiveProvenance('x', T0)), true);
  assert.equal(isVerifiable(makeDerivedProvenance('x', 'y', T0)), true);
  assert.equal(isVerifiable(makeUnavailableProvenance('x', 'y', T0)), false);
});
