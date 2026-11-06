import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getConnector,
  listConnectors,
  suggestPivots,
  validateRegistry,
} from './index';

test('registry passes zero-key integrity checks', () => {
  const problems = validateRegistry();
  assert.deepEqual(problems, [], `registry problems: ${problems.join('; ')}`);
  assert.ok(listConnectors().length >= 12, 'expected at least 12 connectors');
});

test('connector ids are unique and lookups resolve', () => {
  const ids = listConnectors().map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(getConnector('shodan-internetdb')?.label, 'Shodan InternetDB Exposure Scan');
  assert.equal(getConnector('does-not-exist'), undefined);
});

test('pivot suggestions map emitted kinds to accepting connectors', () => {
  const afterIp = suggestPivots(['ip']);
  assert.ok(afterIp.some((c) => c.id === 'shodan-internetdb'));
  assert.ok(afterIp.some((c) => c.id === 'ripestat-bgp'));

  const afterPlace = suggestPivots(['place']);
  assert.ok(afterPlace.some((c) => c.id === 'nominatim-geocode'));
  assert.ok(afterPlace.some((c) => c.id === 'commons-geophoto'));

  const afterCoords = suggestPivots(['coordinates']);
  assert.ok(afterCoords.some((c) => c.id === 'overpass-landmarks'));
  assert.ok(afterCoords.some((c) => c.id === 'open-meteo-verification'));
});

test('shodan connector rejects non-IPv4 targets instead of guessing', async () => {
  const connector = getConnector('shodan-internetdb')!;
  await assert.rejects(
    () => connector.run('not-an-ip'),
    /not a valid IPv4 address/
  );
});

test('overpass connector rejects malformed coordinate input', async () => {
  const connector = getConnector('overpass-landmarks')!;
  await assert.rejects(() => connector.run('hello world'), /expects "lat,lon"/);
});
