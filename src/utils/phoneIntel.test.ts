import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeEnhancedPhone } from './phoneIntel';

test('analyzeEnhancedPhone parses E.164 UK number and builds multi-format dorks + messaging links', () => {
  const res = analyzeEnhancedPhone('+44 20 7946 0958');
  assert.ok(res);
  assert.equal(res.e164, '+442079460958');
  assert.equal(res.countryCode, 'GB');
  assert.equal(res.callingCode, '+44');
  assert.equal(res.isPossible, true);
  assert.ok(res.dorkQueries.length >= 3);
  assert.ok(res.dorkQueries[0].query.includes('+442079460958'));
  assert.equal(res.messagingLinks.length, 3);
  assert.equal(res.messagingLinks[0].url, 'https://wa.me/442079460958');
});

test('analyzeEnhancedPhone parses US number with default country fallback', () => {
  const res = analyzeEnhancedPhone('(415) 555-2671', 'US');
  assert.ok(res);
  assert.equal(res.e164, '+14155552671');
  assert.equal(res.countryCode, 'US');
});

test('analyzeEnhancedPhone returns null for invalid/empty inputs', () => {
  assert.equal(analyzeEnhancedPhone(''), null);
  assert.equal(analyzeEnhancedPhone('not-a-phone'), null);
});
