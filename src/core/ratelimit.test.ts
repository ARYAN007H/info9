import test from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter } from './ratelimit';

const NO_LIMIT = { maxPerWindow: 0, windowMs: 60_000 };

test('hosts without a rule or with maxPerWindow 0 are never delayed', () => {
  const limiter = new RateLimiter(NO_LIMIT, {
    'api.example.com': { maxPerWindow: 0, windowMs: 60_000 },
  });
  assert.equal(limiter.nextAllowedDelayMs('api.example.com', 1_000_000), 0);
  assert.equal(limiter.nextAllowedDelayMs('unknown.host', 1_000_000), 0);
});

test('limiter allows exactly maxPerWindow hits then reports the wait', async () => {
  let t = 1_000_000;
  const clock = () => t;
  const limiter = new RateLimiter(NO_LIMIT, {
    'nominatim.openstreetmap.org': { maxPerWindow: 2, windowMs: 60_000 },
  });
  const noSleep = async () => {};
  assert.equal(limiter.nextAllowedDelayMs('nominatim.openstreetmap.org', t), 0);
  await limiter.acquire('nominatim.openstreetmap.org', { sleep: noSleep, now: clock });
  await limiter.acquire('nominatim.openstreetmap.org', { sleep: noSleep, now: clock });
  const delay = limiter.nextAllowedDelayMs('nominatim.openstreetmap.org', t + 1);
  assert.ok(delay > 0 && delay <= 60_000, `delay should be within window, got ${delay}`);
  // after the window elapses, the host is free again
  t += 60_001;
  assert.equal(limiter.nextAllowedDelayMs('nominatim.openstreetmap.org', t), 0);
});

test('a host-specific rule does not leak into other hosts', async () => {
  const limiter = new RateLimiter(NO_LIMIT, {
    'a.com': { maxPerWindow: 1, windowMs: 60_000 },
  });
  await limiter.acquire('a.com', { sleep: async () => {} });
  assert.ok(limiter.nextAllowedDelayMs('a.com', Date.now()) >= 0);
  assert.equal(limiter.nextAllowedDelayMs('b.com', Date.now()), 0);
});
