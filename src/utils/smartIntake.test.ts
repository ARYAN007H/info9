import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyUniversalIntake } from './smartIntake';

describe('classifyUniversalIntake', () => {
  it('returns null for empty or whitespace input', () => {
    assert.equal(classifyUniversalIntake('   '), null);
  });

  it('classifies decimal WGS84 coordinates and routes to geolocation', () => {
    const res = classifyUniversalIntake('51.5074, -0.1278');
    assert.ok(res);
    assert.equal(res.kind, 'coordinates');
    assert.equal(res.recommendedActions[0].moduleId, 'geolocation');
  });

  it('classifies IPv4 addresses and routes to investigate and geolocation', () => {
    const res = classifyUniversalIntake('185.215.113.42');
    assert.ok(res);
    assert.equal(res.kind, 'ipv4');
    assert.equal(res.normalizedValue, '185.215.113.42');
    assert.equal(res.recommendedActions[0].moduleId, 'investigate');
  });

  it('classifies email addresses and splits handle + domain pivot actions', () => {
    const res = classifyUniversalIntake('Analyst.Zero@Cloudflare.com');
    assert.ok(res);
    assert.equal(res.kind, 'email');
    assert.equal(res.normalizedValue, 'analyst.zero@cloudflare.com');
    assert.equal(res.recommendedActions.length, 3);
    assert.equal(res.recommendedActions[0].moduleId, 'identity');
    assert.equal(res.recommendedActions[2].moduleId, 'infra');
    assert.equal(res.recommendedActions[2].targetValue, 'cloudflare.com');
  });

  it('classifies international phone numbers via dialing directory', () => {
    const res = classifyUniversalIntake('+44 20 7946 0921');
    assert.ok(res);
    assert.equal(res.kind, 'phone');
    assert.equal(res.recommendedActions[0].moduleId, 'geolocation');
    assert.equal(res.recommendedActions[1].moduleId, 'identity');
  });

  it('classifies domains and URLs accurately', () => {
    const dom = classifyUniversalIntake('wikipedia.org');
    assert.ok(dom);
    assert.equal(dom.kind, 'domain');
    assert.equal(dom.recommendedActions[0].moduleId, 'infra');

    const url = classifyUniversalIntake('https://web.example.org/report/2025');
    assert.ok(url);
    assert.equal(url.kind, 'url');
    assert.equal(url.recommendedActions[0].moduleId, 'forensics');
  });

  it('classifies @handles and routes to identity and face recon', () => {
    const handle = classifyUniversalIntake('@torvalds_dev');
    assert.ok(handle);
    assert.equal(handle.kind, 'username');
    assert.equal(handle.normalizedValue, 'torvalds_dev');
    assert.equal(handle.recommendedActions[0].moduleId, 'identity');
  });

  it('falls back to entity_or_place for company/person/place names', () => {
    const ent = classifyUniversalIntake('Trafigura Group Pte Ltd');
    assert.ok(ent);
    assert.equal(ent.kind, 'entity_or_place');
    assert.equal(ent.recommendedActions[0].moduleId, 'dossier');
    assert.equal(ent.recommendedActions[1].moduleId, 'sanctions');
  });
});
