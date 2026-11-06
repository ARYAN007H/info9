import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCheckUrl,
  interpretCheckResult,
  normalizeWnnSites,
} from './wnn';

// Matches the real wmn-data.json schema (cat, {account}, m_code, known list).
const DATASET = [
  { name: 'GitHub', uri_check: 'https://github.com/{account}/', e_code: 200, e_string: 'staff-header-container', m_string: '', cat: 'coding' },
  { name: 'X', uri_check: 'https://x.com/{account}', e_code: 200, e_string: '', m_string: 'Yes, view any profile', m_code: 200, cat: 'social' },
  { name: 'Invalid', uri_check: 'https://broken.example/{account}', e_code: 200, valid: false, cat: 'x' },
  { name: 'NoTemplate', uri_check: 'https://nope.example/static', e_code: 200, cat: 'x' },
  { name: 'Private', uri_check: 'http://192.168.1.1/{account}', e_code: 200, cat: 'x' },
  { name: 'KnownOnly', uri_check: 'https://k.example/{account}', e_code: 200, known: ['someuser'], cat: 'x' },
];

test('normalizeWnnSites keeps usable probes and drops invalid/private ones', () => {
  const sites = normalizeWnnSites(DATASET);
  assert.equal(sites.length, 3);
  assert.ok(sites.some((s) => s.name === 'GitHub' && s.category === 'coding'));
  assert.ok(sites.some((s) => s.name === 'X' && s.mCode === 200));
  // known: [...] arrays are exemplar usernames in the real dataset — kept.
  assert.ok(sites.some((s) => s.name === 'KnownOnly'));
});

test('buildCheckUrl substitutes the {account} placeholder and validates', () => {
  assert.equal(
    buildCheckUrl('https://github.com/{account}/', 'aryan.dev_x'),
    'https://github.com/aryan.dev_x/'
  );
  assert.equal(buildCheckUrl('https://legacy.com/{username}', 'ok'), 'https://legacy.com/ok');
});

test('buildCheckUrl rejects injection, junk usernames, and private hosts', () => {
  assert.throws(() => buildCheckUrl('https://github.com/{account}', '../../admin'), /unsupported characters/);
  assert.throws(() => buildCheckUrl('https://github.com/{account}', 'a b'), /unsupported characters/);
  assert.throws(() => buildCheckUrl('https://github.com/{account}', 'x'.repeat(80)), /unsupported characters/);
  assert.throws(() => buildCheckUrl('http://192.168.1.1/{account}', 'ok'), /private network/);
  assert.throws(() => buildCheckUrl('file:///etc/{account}', 'ok'), /http\(s\)/);
});

test('interpretCheckResult applies e_code/e_string/m_string/m_code correctly', () => {
  const github = { eCode: 200, eString: 'staff-header-container', mCode: 0, mString: '' };
  assert.equal(interpretCheckResult(github, 200, 'staff-header-container ...'), 'FOUND');
  assert.equal(interpretCheckResult(github, 200, 'unrelated page'), 'UNKNOWN');
  assert.equal(interpretCheckResult(github, 404, ''), 'NOT_FOUND');

  const withMissing = { eCode: 200, eString: '', mCode: 200, mString: 'Yes, view any profile' };
  assert.equal(interpretCheckResult(withMissing, 200, 'profile page'), 'FOUND');
  assert.equal(interpretCheckResult(withMissing, 200, 'Yes, view any profile'), 'NOT_FOUND');
});
