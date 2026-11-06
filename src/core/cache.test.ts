import test from 'node:test';
import assert from 'node:assert/strict';
import { TtlCache } from './cache';

test('TtlCache returns stored values within the TTL window', () => {
  let t = 1000;
  const cache = new TtlCache<string>(500, () => t);
  cache.set('k', 'v');
  assert.equal(cache.get('k'), 'v');
  t += 499;
  assert.equal(cache.get('k'), 'v');
});

test('TtlCache drops values after expiry and reports honest size', () => {
  let t = 1000;
  const cache = new TtlCache<number>(500, () => t);
  cache.set('a', 1);
  cache.set('b', 2);
  assert.equal(cache.size, 2);
  t += 501;
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.size, 1); // lazy eviction removes only the read entry
  cache.clear();
  assert.equal(cache.size, 0);
});
