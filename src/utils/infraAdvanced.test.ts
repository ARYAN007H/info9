import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectSubdomainTakeoverRisk,
  groupSubdomainsBySubnet24,
  ipv4ToSubnet24,
} from './infraAdvanced';

describe('infraAdvanced utilities', () => {
  it('flags dangling CNAME pointing to GitHub Pages or S3 with no A records', () => {
    const risk = detectSubdomainTakeoverRisk(
      'docs.example.com',
      'abandoned-org.github.io.',
      []
    );
    assert.equal(risk.vulnerable, true);
    assert.equal(risk.provider, 'GitHub Pages');
  });

  it('does not flag active CNAME that resolves to an IPv4 address', () => {
    const risk = detectSubdomainTakeoverRisk(
      'shop.example.com',
      'stores.myshopify.com',
      ['23.227.38.65']
    );
    assert.equal(risk.vulnerable, false);
    assert.equal(risk.provider, 'Shopify');
  });

  it('groups resolved subdomains into /24 IPv4 subnets', () => {
    assert.equal(ipv4ToSubnet24('104.16.132.229'), '104.16.132.0/24');
    const groups = groupSubdomainsBySubnet24([
      {
        subdomain: 'api.example.com',
        aRecords: ['104.16.132.10'],
        cnameTarget: null,
        subnet24: '104.16.132.0/24',
        takeoverRisk: { vulnerable: false, provider: null, reason: 'ok' },
      },
      {
        subdomain: 'cdn.example.com',
        aRecords: ['104.16.132.99'],
        cnameTarget: null,
        subnet24: '104.16.132.0/24',
        takeoverRisk: { vulnerable: false, provider: null, reason: 'ok' },
      },
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].subdomains.length, 2);
  });
});
