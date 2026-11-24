import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDorkMatrix,
  computeShodanFaviconHash,
  extractFaviconHref,
  extractPageArtifacts,
  murmurHash3_32,
  stripHtmlToText,
} from './webIntelligence';

test('extractPageArtifacts extracts emails, wallets, trackers, handles, and social links', () => {
  const html = `
    <html>
      <head>
        <title>Test Intel Portal</title>
        <meta name="author" content="Elena Vance" />
        <meta name="generator" content="WordPress 6.6" />
        <link rel="shortcut icon" href="/assets/fav.ico" />
        <script async src="https://www.googletagmanager.com/gtag/js?id=G-9988AABB11"></script>
        <script>/* UA-12345678-2 GTM-ABC1234 ca-pub-1234567890123456 */</script>
      </head>
      <body>
        <p>Contact ops@meridian-maritime.example or +44 20 7946 0958 or ping @osint_alpha.</p>
        <p>Donations: 0x742d35Cc6634C0532925a3b844Bc454e4438f44e and bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh</p>
        <a href="https://github.com/meridianops">GitHub</a>
        <a href="https://external-partner.org/report.pdf">Report</a>
      </body>
    </html>
  `;

  const artifacts = extractPageArtifacts(html, 'https://meridian-maritime.example/about');
  assert.ok(artifacts.emails.includes('ops@meridian-maritime.example'));
  assert.ok(artifacts.phones.length >= 1);
  assert.ok(artifacts.handles.includes('osint_alpha'));
  assert.ok(artifacts.handles.includes('meridianops'));
  assert.equal(artifacts.cryptoWallets.length, 2);
  assert.ok(artifacts.cryptoWallets.some((w) => w.chain === 'ETH'));
  assert.ok(artifacts.cryptoWallets.some((w) => w.chain === 'BTC'));
  assert.ok(artifacts.analyticsIds.some((a) => a.kind === 'GA4' && a.id === 'G-9988AABB11'));
  assert.ok(artifacts.analyticsIds.some((a) => a.kind === 'UA' && a.id === 'UA-12345678-2'));
  assert.ok(artifacts.analyticsIds.some((a) => a.kind === 'GTM' && a.id === 'GTM-ABC1234'));
  assert.ok(artifacts.analyticsIds.some((a) => a.kind === 'ADSENSE'));
  assert.ok(artifacts.outboundDomains.includes('external-partner.org'));
  assert.ok(!artifacts.outboundDomains.includes('meridian-maritime.example'));
  assert.equal(artifacts.metaAuthor, 'Elena Vance');
  assert.equal(artifacts.metaGenerator, 'WordPress 6.6');
  assert.equal(artifacts.faviconUrl, 'https://meridian-maritime.example/assets/fav.ico');
});

test('murmurHash3_32 and computeShodanFaviconHash produce deterministic signed 32-bit integers', () => {
  const bytes = new TextEncoder().encode('hello');
  const h = murmurHash3_32(bytes, 0);
  assert.equal(h, 613153351);

  const favHash = computeShodanFaviconHash(new Uint8Array([0, 0, 1, 0, 1, 0, 16, 16]));
  assert.equal(typeof favHash, 'number');
  assert.equal(Number.isInteger(favHash), true);
  assert.equal(favHash, computeShodanFaviconHash(new Uint8Array([0, 0, 1, 0, 1, 0, 16, 16])));
});

test('buildDorkMatrix adapts queries for domains vs person/entity names', () => {
  const domDorks = buildDorkMatrix('https://example.org/path');
  assert.ok(domDorks.length >= 6);
  assert.ok(domDorks.some((d) => d.query.includes('site:example.org')));

  const entDorks = buildDorkMatrix('Meridian Logistics');
  assert.ok(entDorks.length >= 5);
  assert.ok(entDorks.some((d) => d.query.includes('offshoreleaks.icij.org')));
});

test('stripHtmlToText removes scripts/styles and normalizes whitespace', () => {
  const cleaned = stripHtmlToText('<style>.x{color:red}</style><script>alert(1)</script><p>Hello &amp; World</p>');
  assert.equal(cleaned, 'Hello & World');
  assert.equal(extractFaviconHref('<html></html>', 'https://example.com/a/b'), 'https://example.com/favicon.ico');
});
