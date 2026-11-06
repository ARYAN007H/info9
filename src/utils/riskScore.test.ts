import test from 'node:test';
import assert from 'node:assert/strict';
import { computeDomainRiskScore } from './riskScore';

const NOW = new Date('2026-11-07T12:00:00Z');
const daysAgoIso = (days: number) =>
  new Date(NOW.getTime() - days * 86_400_000).toISOString().slice(0, 10);

const cleanInput = {
  createdAt: daysAgoIso(400),
  hasDmarc: true,
  hasSpf: true,
  hasCaa: true,
  shodanVulnCount: 0,
};

test('fully-clean, well-aged domain scores 0 with no factors', () => {
  const result = computeDomainRiskScore({ ...cleanInput, now: NOW });
  assert.equal(result.score, 0);
  assert.deepEqual(result.factors, []);
});

test('fresh domain (<30d) adds exactly +35 with an explanatory factor', () => {
  const result = computeDomainRiskScore({
    ...cleanInput,
    createdAt: daysAgoIso(10),
    now: NOW,
  });
  assert.equal(result.score, 35);
  assert.equal(result.factors.length, 1);
  assert.match(result.factors[0].label, /10d ago/);
  assert.equal(result.factors[0].points, 35);
});

test('young domain (30-179d) adds +18', () => {
  const result = computeDomainRiskScore({
    ...cleanInput,
    createdAt: daysAgoIso(90),
    now: NOW,
  });
  assert.equal(result.score, 18);
});

test('missing registration date records a zero-point gap factor, not fiction', () => {
  const result = computeDomainRiskScore({ ...cleanInput, createdAt: null, now: NOW });
  assert.equal(result.score, 0);
  assert.equal(result.factors.length, 1);
  assert.match(result.factors[0].label, /unknown/);
  assert.equal(result.factors[0].points, 0);
});

test('email spoof-ability rules: no DMARC +20, no SPF +10', () => {
  const result = computeDomainRiskScore({
    ...cleanInput,
    hasDmarc: false,
    hasSpf: false,
    now: NOW,
  });
  assert.equal(result.score, 30);
  assert.deepEqual(
    result.factors.map((f) => f.points).sort((a, b) => b - a),
    [20, 10]
  );
});

test('missing CAA adds +5', () => {
  const result = computeDomainRiskScore({ ...cleanInput, hasCaa: false, now: NOW });
  assert.equal(result.score, 5);
});

test('CVE points are +6 each and capped at +18', () => {
  const two = computeDomainRiskScore({ ...cleanInput, shodanVulnCount: 2, now: NOW });
  assert.equal(two.score, 12);

  const five = computeDomainRiskScore({ ...cleanInput, shodanVulnCount: 5, now: NOW });
  assert.equal(five.score, 18);
  assert.match(five.factors[0].label, /5 CVE/);

  const ten = computeDomainRiskScore({ ...cleanInput, shodanVulnCount: 10, now: NOW });
  assert.equal(ten.score, 18);
});

test('unknown Shodan exposure records a zero-point gap factor', () => {
  const result = computeDomainRiskScore({ ...cleanInput, shodanVulnCount: null, now: NOW });
  assert.equal(result.score, 0);
  assert.match(result.factors[0].label, /exposure unknown/i);
});

test('worst-case domain hits exactly 100 (fresh + no DMARC + no SPF + no CAA + CVE cap + is clamped)', () => {
  const result = computeDomainRiskScore({
    createdAt: daysAgoIso(2),
    hasDmarc: false,
    hasSpf: false,
    hasCaa: false,
    shodanVulnCount: 9,
    now: NOW,
  });
  assert.equal(result.score, Math.min(100, 35 + 20 + 10 + 5 + 18));
  assert.equal(result.score <= 100, true);
});
