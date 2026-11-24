import test from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateOrReservedIp, validatePublicUrlSyntax } from './ssrfGuard';

test('isPrivateOrReservedIp blocks loopback, RFC1918, cloud metadata, CGNAT, and IPv6 ULA', () => {
  assert.equal(isPrivateOrReservedIp('127.0.0.1'), true);
  assert.equal(isPrivateOrReservedIp('10.0.0.5'), true);
  assert.equal(isPrivateOrReservedIp('172.16.4.1'), true);
  assert.equal(isPrivateOrReservedIp('192.168.1.10'), true);
  assert.equal(isPrivateOrReservedIp('169.254.169.254'), true);
  assert.equal(isPrivateOrReservedIp('100.64.0.1'), true);
  assert.equal(isPrivateOrReservedIp('::1'), true);
  assert.equal(isPrivateOrReservedIp('::ffff:127.0.0.1'), true);
  assert.equal(isPrivateOrReservedIp('fc00::1'), true);

  assert.equal(isPrivateOrReservedIp('1.1.1.1'), false);
  assert.equal(isPrivateOrReservedIp('8.8.8.8'), false);
  assert.equal(isPrivateOrReservedIp('93.184.216.34'), false);
});

test('validatePublicUrlSyntax rejects internal hosts, bad schemes, and credentials in URL', () => {
  assert.throws(() => validatePublicUrlSyntax('file:///etc/passwd'));
  assert.throws(() => validatePublicUrlSyntax('http://localhost:3000'));
  assert.throws(() => validatePublicUrlSyntax('http://169.254.169.254/latest/meta-data/'));
  assert.throws(() => validatePublicUrlSyntax('http://metadata.google.internal/'));
  assert.throws(() => validatePublicUrlSyntax('https://user:pass@example.com/'));

  const ok = validatePublicUrlSyntax('https://example.org/report');
  assert.equal(ok.hostname, 'example.org');
});
