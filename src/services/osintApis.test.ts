import test from 'node:test';
import assert from 'node:assert/strict';
import {
  expandGleifParentTransform,
  fetchElevationAndWeatherVerification,
  scanDomainInfrastructureLive,
} from './osintApis';
import type { OsintEntity } from '../types/osint';

/**
 * These tests are regression fences around info9's evidentiary contract:
 * when an upstream fails, the API surfaces a gap (null / thrown / found:false)
 * — it must NEVER return plausible fabricated data again.
 */

type FetchHandler = (url: string) => Response | Promise<Response>;

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function withFetchMock(handler: FetchHandler): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    void init;
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.href
        : input.url;
    return handler(url);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

/** Routes Cloudflare DoH queries (name=...&type=...) to a canned answer map. */
function dohRouter(answers: Record<string, string[]>): FetchHandler {
  return (url) => {
    const m = url.match(/[?&]name=([^&]+)&type=([^&]+)/);
    if (url.includes('cloudflare-dns.com') && m) {
      const name = decodeURIComponent(m[1]);
      const type = decodeURIComponent(m[2]);
      const data = answers[`${name}|${type}`] ?? [];
      return jsonResponse({
        Status: 0,
        Answer: data.map((d) => ({ name, type: 1, data: d })),
      });
    }
    return jsonResponse({ error: 'unrouted' }, 404);
  };
}

const LEI_ENTITY: OsintEntity = {
  id: 'lei-5493001KJTIIGC8Y1R12',
  label: 'Test ParentCo GmbH',
  type: 'company',
  jurisdiction: 'DE',
  identifier: 'LEI: 5493001KJTIIGC8Y1R12',
  riskLevel: 'low',
  summary: 'test entity',
  attributes: {},
};

// ---------------------------------------------------------------------------
// Weather verification
// ---------------------------------------------------------------------------

test('weather verification returns null (not fake data) when Open-Meteo is down', async () => {
  const restore = withFetchMock(() => jsonResponse({ error: 'boom' }, 500));
  try {
    const result = await fetchElevationAndWeatherVerification(
      51.5074,
      -0.1278,
      '2026-06-01'
    );
    assert.equal(result, null);
  } finally {
    restore();
  }
});

test('weather verification returns LIVE-provenanced real values on success', async () => {
  const restore = withFetchMock((url) => {
    if (url.includes('/v1/elevation')) {
      return jsonResponse({ elevation: [11.4] });
    }
    if (url.includes('archive-api.open-meteo.com')) {
      return jsonResponse({
        daily: {
          temperature_2m_max: [21.5],
          temperature_2m_min: [12.3],
          precipitation_sum: [0.4],
          shortwave_radiation_sum: [23.1],
        },
        hourly: { cloud_cover: [20, 40, 60, 80, 100] },
      });
    }
    return jsonResponse({ error: 'unrouted' }, 404);
  });
  try {
    const result = await fetchElevationAndWeatherVerification(
      51.5074,
      -0.1278,
      '2026-06-01'
    );
    assert.ok(result);
    assert.equal(result.elevationMeters, 11);
    assert.equal(result.maxTempC, 21.5);
    assert.equal(result.minTempC, 12.3);
    assert.equal(result.cloudCoverMeanPercent, 60);
    assert.equal(result.shadowPlausibility, 'PARTIAL_CLOUD_COVER');
    assert.equal(result.provenance.status, 'LIVE');
    assert.match(result.provenance.source, /Open-Meteo/);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// GLEIF parent transform — the former fabrication site
// ---------------------------------------------------------------------------

test('parent transform refuses non-GLEIF entities instead of inventing an owner', async () => {
  const restore = withFetchMock(() => {
    throw new Error('fetch must not be called for non-LEI entities');
  });
  try {
    const result = await expandGleifParentTransform({
      ...LEI_ENTITY,
      identifier: 'WIKIDATA: Q42',
    });
    assert.equal(result.found, false);
    if (!result.found) {
      assert.equal(result.reason, 'NOT_A_GLEIF_ENTITY');
    }
  } finally {
    restore();
  }
});

test('parent transform returns found:false on GLEIF failure — no synthetic BVI trust', async () => {
  const restore = withFetchMock(() => jsonResponse({ error: 'upstream' }, 500));
  try {
    const result = await expandGleifParentTransform(LEI_ENTITY);
    assert.equal(result.found, false);
    const serialized = JSON.stringify(result).toLowerCase();
    assert.ok(!serialized.includes('nominee trust'), 'fabricated entity leaked!');
    assert.ok(!serialized.includes('bvi'), 'fabricated jurisdiction leaked!');
  } finally {
    restore();
  }
});

test('parent transform returns found:false when GLEIF has no parent on record', async () => {
  const restore = withFetchMock((url) => {
    if (url.includes('/ultimate-parent')) {
      // GLEIF returns 200 with no parent relationship for standalone entities.
      return jsonResponse({ data: { id: '5493001KJTIIGC8Y1R12' } });
    }
    return jsonResponse({ error: 'unrouted' }, 404);
  });
  try {
    const result = await expandGleifParentTransform(LEI_ENTITY);
    assert.equal(result.found, false);
    if (!result.found) assert.equal(result.reason, 'NO_PARENT_ON_RECORD');
  } finally {
    restore();
  }
});

test('parent transform returns the real GLEIF parent with provenance on success', async () => {
  const restore = withFetchMock((url) => {
    if (url.includes('/ultimate-parent')) {
      return jsonResponse({
        data: {
          id: '549300ABCD1234EFGH56',
          attributes: {
            entity: {
              legalName: { name: 'Real Holding AG' },
              jurisdiction: 'CH',
            },
          },
        },
      });
    }
    return jsonResponse({ error: 'unrouted' }, 404);
  });
  try {
    const result = await expandGleifParentTransform(LEI_ENTITY);
    assert.equal(result.found, true);
    if (result.found) {
      assert.equal(result.discoveredEntity.label, 'Real Holding AG');
      assert.equal(result.discoveredEntity.jurisdiction, 'CH');
      assert.equal(result.discoveredEdge.sourceId, result.discoveredEntity.id);
      assert.equal(result.discoveredEdge.targetId, LEI_ENTITY.id);
      assert.equal(result.provenance.status, 'LIVE');
    }
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Domain infrastructure scan
// ---------------------------------------------------------------------------

test('domain scan throws when the domain resolves no DNS records at all', async () => {
  const restore = withFetchMock(dohRouter({}));
  try {
    await assert.rejects(
      () => scanDomainInfrastructureLive('this-domain-does-not-exist.example'),
      /resolved no DNS records/
    );
  } finally {
    restore();
  }
});

test('domain scan records data gaps instead of fabricated defaults when upstreams fail', async () => {
  const restore = withFetchMock((url) => {
    if (url.includes('cloudflare-dns.com')) {
      return dohRouter({ 'example.com|A': ['1.2.3.4'] })(url);
    }
    // Every other upstream (ipwho.is, Shodan, RIPEstat, RDAP, crt.sh) fails.
    return jsonResponse({ error: 'down' }, 500);
  });
  try {
    const record = await scanDomainInfrastructureLive('example.com');
    assert.deepEqual(record.aRecords, ['1.2.3.4']);
    assert.equal(record.asn, null);
    assert.equal(record.asnOrg, null);
    assert.equal(record.registrar, null);
    assert.equal(record.createdAt, null);
    assert.equal(record.tlsIssuer, null);
    assert.equal(record.shodanData, undefined);
    assert.equal(record.ripeBgpData, undefined);
    assert.equal(record.dataGaps.length, 5);

    const serialized = JSON.stringify(record);
    assert.ok(!serialized.includes('104.21'), 'fabricated Cloudflare IP leaked!');
    assert.ok(!serialized.includes('nginx'), 'fabricated CPE leaked!');
    assert.ok(!serialized.includes('2024-03-19'), 'fabricated registration date leaked!');
    assert.ok(!serialized.includes('"ports"'), 'fabricated ports leaked!');

    const factorLabels = record.riskAssessment.factors.map((f) => f.label).join('; ');
    assert.match(factorLabels, /Registration date unknown/);
    assert.match(factorLabels, /Shodan exposure unknown/);
    assert.equal(record.provenance.status, 'LIVE');
  } finally {
    restore();
  }
});

test('domain scan populates every field from real upstream responses when available', async () => {
  const restore = withFetchMock((url) => {
    if (url.includes('cloudflare-dns.com')) {
      return dohRouter({
        'example.com|A': ['1.2.3.4'],
        'example.com|NS': ['ns1.example-dns.net', 'ns2.example-dns.net'],
        'example.com|TXT': ['"v=spf1 -all"'],
        'example.com|CAA': ['0 issue "letsencrypt.org"'],
        '_dmarc.example.com|TXT': ['"v=DMARC1; p=reject"'],
      })(url);
    }
    if (url.includes('ipwho.is')) {
      return jsonResponse({
        success: true,
        country_code: 'DE',
        connection: { asn: 64496, org: 'Example Hosting GmbH' },
      });
    }
    if (url.includes('internetdb.shodan.io')) {
      return jsonResponse({
        ports: [443],
        cpes: [],
        hostnames: [],
        tags: [],
        vulns: [],
      });
    }
    if (url.includes('stat.ripe.net')) {
      return jsonResponse({
        data: {
          resource: '1.2.3.0/24',
          asns: [{ asn: 64496, holder: 'Example Hosting GmbH' }],
        },
      });
    }
    if (url.includes('/api/osint/rdap') || url.includes('rdap.org')) {
      return jsonResponse({
        events: [{ eventAction: 'registration', eventDate: '2020-01-01T00:00:00Z' }],
        entities: [
          { vcardArray: ['vcard', [['fn', {}, 'text', 'Example Registrar Inc.']]] },
        ],
      });
    }
    if (url.includes('/api/osint/crt') || url.includes('crt.sh')) {
      return jsonResponse([
        {
          issuer_name: "CN=Let's Encrypt R3, O=Let's Encrypt",
          name_value: 'example.com\nwww.example.com',
        },
      ]);
    }
    return jsonResponse({ error: 'unrouted' }, 404);
  });
  try {
    const record = await scanDomainInfrastructureLive('example.com');
    assert.deepEqual(record.aRecords, ['1.2.3.4']);
    assert.equal(record.asn, 'AS64496');
    assert.equal(record.asnOrg, 'Example Hosting GmbH');
    assert.equal(record.ipCountry, 'DE');
    assert.equal(record.registrar, 'Example Registrar Inc.');
    assert.equal(record.createdAt, '2020-01-01');
    assert.equal(record.tlsIssuer, "Let's Encrypt R3");
    assert.equal(record.ctSubdomainsCount, 2);
    assert.equal(record.dmarcPolicy, '"v=DMARC1; p=reject"');
    assert.ok(record.shodanData, 'shodanData should be populated on full success');
    assert.equal(record.shodanData.ports.length, 1);
    assert.equal(record.ripeBgpData!.announcedPrefix, '1.2.3.0/24');
    assert.deepEqual(record.dataGaps, []);
    // Old domain (2020) + DMARC + SPF + CAA + zero CVEs -> no factors, score 0.
    assert.equal(record.riskAssessment.score, 0);
    assert.deepEqual(record.riskAssessment.factors, []);
  } finally {
    restore();
  }
});
