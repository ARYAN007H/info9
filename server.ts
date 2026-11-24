import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import {
  VISION_GEO_PROMPT,
  parseVisionGeolocationPayload,
} from './src/utils/visionGeolocate';
import {
  buildCheckUrl,
  interpretCheckResult,
  normalizeWnnSites,
} from './src/utils/wnn';
import {
  parseOfacSdnCsv,
  toSanctionsCandidates,
} from './src/utils/sanctionsData';
import { Info9Database, getConnectorStatusMatrix } from './src/server/database';
import {
  extractLivePageIntelligence,
  runUniversalWebSearch,
} from './src/server/webHunter';
import {
  enrichUsernameProfiles,
  runDeepEmailRecon,
} from './src/server/identityEnrich';
import {
  lookupCryptoWallet,
  lookupMaritimeVessel,
  runInfraAttribution,
  searchGlobalPublicRecords,
} from './src/server/recordsAndIntel';
import {
  executeRecursivePivotSpider,
  normalizeSpiderSeedKind,
} from './src/server/recursivePivot';
import {
  runEvidenceCopilotAnalysis,
  type CopilotMode,
} from './src/server/aiCopilot';
import type { InvestigationCase } from './src/types/osint';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const db = new Info9Database(process.env.INFO9_DB_PATH || undefined);

  app.use(express.json({ limit: '10mb' }));

  // Health check endpoint
  app.get('/api/osint/health', (_req, res) => {
    res.json({
      status: 'ok',
      engine: 'Argon OSINT v2.0 Specialist Zero-Key Proxy',
      timestamp: new Date().toISOString(),
    });
  });

  // Shodan InternetDB Free Zero-Key API Proxy (Open Ports, CPEs, Hostnames, CVEs)
  app.get('/api/osint/internetdb', async (req, res) => {
    const ip = String(req.query.ip || '').trim();
    if (!ip || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
      res.status(400).json({ error: 'Valid IPv4 address required' });
      return;
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const response = await fetch(`https://internetdb.shodan.io/${encodeURIComponent(ip)}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timeout);
      if (!response.ok) {
        res.status(response.status).json({ error: `InternetDB returned ${response.status}` });
        return;
      }
      const data = await response.json();
      res.json(data);
    } catch (err) {
      res.status(502).json({
        error: 'Shodan InternetDB upstream unreachable',
        details: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // Certificate Transparency (crt.sh) proxy
  app.get('/api/osint/crt', async (req, res) => {
    const domain = String(req.query.domain || '').trim().toLowerCase();
    if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
      res.status(400).json({ error: 'Valid domain parameter required' });
      return;
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(
        `https://crt.sh/?q=${encodeURIComponent(domain)}&output=json`,
        {
          signal: controller.signal,
          headers: { 'User-Agent': 'Argon-OSINT-Workbench/2.0' },
        }
      );
      clearTimeout(timeout);
      if (!response.ok) {
        res.status(response.status).json({ error: `crt.sh returned ${response.status}` });
        return;
      }
      const data = await response.json();
      res.json(Array.isArray(data) ? data.slice(0, 60) : []);
    } catch (err) {
      res.status(502).json({
        error: 'Certificate Transparency upstream timeout or unreachable',
        details: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // Wayback Machine CDX proxy for archival verification
  app.get('/api/osint/wayback', async (req, res) => {
    const targetUrl = String(req.query.url || '').trim();
    if (!targetUrl) {
      res.status(400).json({ error: 'Valid url parameter required' });
      return;
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(
        targetUrl
      )}&output=json&limit=25&fl=timestamp,original,mimetype,statuscode,digest`;
      const response = await fetch(cdxUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Argon-OSINT-Workbench/2.0' },
      });
      clearTimeout(timeout);
      if (!response.ok) {
        res.status(response.status).json({ error: `Wayback CDX returned ${response.status}` });
        return;
      }
      const data = await response.json();
      res.json(data);
    } catch (err) {
      res.status(502).json({
        error: 'Wayback Machine CDX upstream unreachable',
        details: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // RDAP Domain Registration proxy fallback
  app.get('/api/osint/rdap', async (req, res) => {
    const domain = String(req.query.domain || '').trim().toLowerCase();
    if (!domain) {
      res.status(400).json({ error: 'Valid domain parameter required' });
      return;
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
        signal: controller.signal,
        headers: { Accept: 'application/rdap+json, application/json' },
      });
      clearTimeout(timeout);
      if (!response.ok) {
        res.status(response.status).json({ error: `RDAP returned ${response.status}` });
        return;
      }
      const data = await response.json();
      res.json(data);
    } catch (err) {
      res.status(502).json({
        error: 'RDAP lookup failed',
        details: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // AI photo geolocation (optional — uses server-side @google/genai when GEMINI_API_KEY is set).
  // The model output is a DERIVED hypothesis; corroboration stays zero-key.
  app.post('/api/osint/vision-geolocate', async (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      res.status(501).json({
        error:
          'GEMINI_API_KEY is not configured on this server. Configure GEMINI_API_KEY in the server environment to enable AI photo geolocation. All other info9 features work without it.',
      });
      return;
    }

    const imageBase64 = String(req.body?.imageBase64 || '').replace(
      /^data:[^;]+;base64,/,
      ''
    );
    const mimeType = String(req.body?.mimeType || '');
    if (!imageBase64 || !/^image\/(jpeg|png|webp|heic|heif)$/i.test(mimeType)) {
      res.status(400).json({ error: 'imageBase64 and a supported image mimeType are required' });
      return;
    }

    const model = String(process.env.GEMINI_MODEL || 'gemini-4-hydrogen');
    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: { 'User-Agent': 'aistudio-build' },
        },
      });
      const response = await ai.models.generateContent({
        model,
        contents: {
          parts: [
            { inlineData: { mimeType, data: imageBase64 } },
            { text: VISION_GEO_PROMPT },
          ],
        },
        config: {
          responseMimeType: 'application/json',
        },
      });

      const candidates = parseVisionGeolocationPayload(response.text ?? '');
      res.json({
        candidates,
        model,
        provenance: {
          status: 'DERIVED',
          source: `Google ${model} vision (AI hypothesis)`,
          fetchedAtUtc: new Date().toISOString(),
          note: candidates.length
            ? 'Corroborate via Street View, satellite imagery, or reverse image search before recording.'
            : 'The model found no usable geographic signal in this image.',
        },
      });
    } catch (err) {
      res.status(502).json({
        error: `Vision geolocation failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  // ---- WhatsMyName username sweep (free community dataset, zero key) ----
  const WNN_DATASET_URL =
    'https://raw.githubusercontent.com/WebBreacher/WhatsMyName/main/wmn-data.json';

  let wnnCache: { sites: ReturnType<typeof normalizeWnnSites>; fetchedAt: string } | null =
    null;
  app.get('/api/osint/wnn/dataset', async (_req, res) => {
    if (!wnnCache) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const upstream = await fetch(WNN_DATASET_URL, { signal: controller.signal });
        clearTimeout(timeout);
        if (!upstream.ok) {
          res.status(502).json({ error: `WhatsMyName dataset returned HTTP ${upstream.status}` });
          return;
        }
        const raw = (await upstream.json()) as { sites?: unknown };
        const sites = normalizeWnnSites(raw?.sites ?? raw);
        if (sites.length === 0) {
          res.status(502).json({ error: 'WhatsMyName dataset parsed to zero usable probes' });
          return;
        }
        wnnCache = { sites, fetchedAt: new Date().toISOString() };
      } catch (err) {
        res.status(502).json({
          error: `Could not load WhatsMyName dataset: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }
    }
    res.json({
      sites: wnnCache.sites,
      count: wnnCache.sites.length,
      fetchedAt: wnnCache.fetchedAt,
    });
  });

  app.post('/api/osint/wnn/check', async (req, res) => {
    const uriTemplate = String(req.body?.uriCheck ?? '');
    const username = String(req.body?.username ?? '');
    const eCode = Number(req.body?.eCode ?? 200);
    const eString = String(req.body?.eString ?? '');
    const mCode = Number(req.body?.mCode ?? 0);
    const mString = String(req.body?.mString ?? '');
    if (!uriTemplate) {
      res.status(400).json({ error: 'uriCheck required' });
      return;
    }
    let url: string;
    try {
      // SSRF/injection guard: username allowlist + scheme + private-host block.
      url = buildCheckUrl(uriTemplate, username);
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Invalid probe request',
      });
      return;
    }
    const started = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 9000);
      const upstream = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; info9 username sweep; +https://github.com/ARYAN007H/info9)',
          Accept: 'text/html,application/xhtml+xml',
        },
      });
      const body = (await upstream.text()).slice(0, 200_000);
      clearTimeout(timeout);
      const verdict = interpretCheckResult(
        { eCode, eString, mCode, mString },
        upstream.status,
        body
      );
      res.json({
        verdict,
        httpStatus: upstream.status,
        elapsedMs: Date.now() - started,
        checkedUrlHost: new URL(url).host,
      });
    } catch (err) {
      res.json({
        verdict: 'UNKNOWN',
        httpStatus: 0,
        elapsedMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // ---- Live OFAC SDN screening list (free public data, zero key) ----
  const OFAC_SDN_URLS = [
    'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV',
    'https://www.treasury.gov/ofac/downloads/sdn.csv',
  ];
  type OfacCacheEntry = {
    candidates: ReturnType<typeof toSanctionsCandidates>;
    rawCount: number;
    fetchedAt: string;
    sourceUrl: string;
  };
  let ofacCache: OfacCacheEntry | null = null;
  let ofacInflight: Promise<OfacCacheEntry> | null = null;

  async function getOrLoadOfacCandidates(timeoutMs = 25000): Promise<OfacCacheEntry> {
    if (ofacCache) return ofacCache;
    if (!ofacInflight) {
      ofacInflight = (async () => {
        let lastErr: unknown = new Error('OFAC SDN download failed');
        for (const url of OFAC_SDN_URLS) {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          try {
            const upstream = await fetch(url, {
              signal: controller.signal,
              headers: { 'User-Agent': 'info9/0.1 (+https://github.com/ARYAN007H/info9)' },
            });
            if (!upstream.ok) {
              throw new Error(`OFAC SDN download returned HTTP ${upstream.status}`);
            }
            const text = await upstream.text();
            const records = parseOfacSdnCsv(text);
            if (records.length === 0) {
              throw new Error('OFAC SDN CSV parsed to zero records');
            }
            ofacCache = {
              candidates: toSanctionsCandidates(records, 20000),
              rawCount: records.length,
              fetchedAt: new Date().toISOString(),
              sourceUrl: url,
            };
            return ofacCache;
          } catch (err) {
            lastErr = err;
          } finally {
            clearTimeout(timer);
          }
        }
        throw lastErr;
      })().finally(() => {
        ofacInflight = null;
      });
    }
    return ofacInflight;
  }

  // Warm the live OFAC SDN corpus in the background so Watchlist, Crypto, and Maritime checks are instant.
  void getOrLoadOfacCandidates(30000).catch(() => {
    // Will retry on demand if startup warm-up failed.
  });

  app.get('/api/osint/sanctions/ofac', async (_req, res) => {
    try {
      const loaded = await getOrLoadOfacCandidates(60000);
      res.json({
        candidates: loaded.candidates,
        count: loaded.candidates.length,
        rawCount: loaded.rawCount,
        fetchedAt: loaded.fetchedAt,
        sourceUrl: loaded.sourceUrl,
      });
    } catch (err) {
      res.status(502).json({
        error: `Could not load OFAC SDN list: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  // URLScan.io public search proxy (browser CORS blocked on some origins)
  app.get('/api/osint/urlscan', async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q || q.length > 200) {
      res.status(400).json({ error: 'Valid q parameter required' });
      return;
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      const upstream = await fetch(
        `https://urlscan.io/api/v1/search/?q=${encodeURIComponent(q)}&size=12`,
        { signal: controller.signal, headers: { 'User-Agent': 'info9/0.1 (+https://github.com/ARYAN007H/info9)' } }
      );
      clearTimeout(timeout);
      if (!upstream.ok) {
        res.status(upstream.status).json({ error: `urlscan.io returned ${upstream.status}` });
        return;
      }
      res.json(await upstream.json());
    } catch (err) {
      res.status(502).json({
        error: `urlscan.io unreachable: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  // Wayback CDX proxy (CORS blocked from browsers on some deployments)
  app.get('/api/osint/wayback-cdx', async (req, res) => {
    const targetUrl = String(req.query.url || '').trim();
    if (!targetUrl || targetUrl.length > 300) {
      res.status(400).json({ error: 'Valid url parameter required' });
      return;
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      const upstream = await fetch(
        `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(
          targetUrl
        )}&output=json&limit=25&fl=timestamp,original,mimetype,statuscode,digest`,
        { signal: controller.signal, headers: { 'User-Agent': 'info9/0.1 (+https://github.com/ARYAN007H/info9)' } }
      );
      clearTimeout(timeout);
      if (!upstream.ok) {
        res.status(upstream.status).json({ error: `Wayback CDX returned ${upstream.status}` });
        return;
      }
      res.json(await upstream.json());
    } catch (err) {
      res.status(502).json({
        error: `Wayback CDX unreachable: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  // Image proxy for the Face Recon bench: reference portraits (avatars,
  // Wikidata P18 renders) whose origins don't send CORS headers. SSRF-guarded:
  // http(s) only, private/loopback hosts blocked, images only, hard size cap.
  const FORBIDDEN_IMAGE_HOSTS =
    /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[::1\]|\[fc|\[fd)/i;
  app.get('/api/osint/image-proxy', async (req, res) => {
    const targetUrl = String(req.query.url || '').trim();
    if (!targetUrl || targetUrl.length > 600) {
      res.status(400).json({ error: 'Valid url parameter required' });
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      res.status(400).json({ error: 'Malformed url parameter' });
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      res.status(400).json({ error: 'Only http(s) URLs are proxied' });
      return;
    }
    if (FORBIDDEN_IMAGE_HOSTS.test(parsed.hostname)) {
      res.status(400).json({ error: 'Private network hosts are not proxied' });
      return;
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const upstream = await fetch(parsed.toString(), {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'info9/0.1 (+https://github.com/ARYAN007H/info9)',
          Accept: 'image/*',
        },
      });
      const contentType = upstream.headers.get('content-type') ?? '';
      if (!upstream.ok || !contentType.startsWith('image/')) {
        clearTimeout(timeout);
        res
          .status(502)
          .json({ error: `Upstream did not return an image (HTTP ${upstream.status}, ${contentType || 'no type'})` });
        return;
      }
      const buffer = Buffer.from(await upstream.arrayBuffer());
      clearTimeout(timeout);
      if (buffer.byteLength > 8 * 1024 * 1024) {
        res.status(413).json({ error: 'Image exceeds the 8 MB proxy cap' });
        return;
      }
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'private, max-age=600');
      res.send(buffer);
    } catch (err) {
      res.status(502).json({
        error: `Image fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  // adsb.lol current-states proxy for the Acoustic module's live sky-watch.
  // Free public endpoint, no key; short cache so rapid polls stay polite.
  // NOTE (honest constraint): this returns CURRENT positions — a single
  // snapshot cannot constrain a recorder position; the sky-watch mode is for
  // clips captured while polling. Historical tracks stay import-first.
  let adsbCache: { at: number; body: unknown } | null = null;
  app.get('/api/osint/adsb', async (req, res) => {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    const radiusKm = Number(req.query.radiusKm ?? 50);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      res.status(400).json({ error: 'Valid lat/lon required' });
      return;
    }
    if (!Number.isFinite(radiusKm) || radiusKm < 1 || radiusKm > 400) {
      res.status(400).json({ error: 'radiusKm must be 1..400' });
      return;
    }
    if (adsbCache && Date.now() - adsbCache.at < 5000) {
      res.json(adsbCache.body);
      return;
    }
    const radiusNm = Math.min(250, Math.max(1, Math.round(radiusKm / 1.852)));
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      const upstream = await fetch(
        `https://api.adsb.lol/v2/point/${lat.toFixed(4)}/${lon.toFixed(4)}/${radiusNm}`,
        {
          signal: controller.signal,
          headers: { 'User-Agent': 'info9/0.1 (+https://github.com/ARYAN007H/info9)' },
        }
      );
      clearTimeout(timeout);
      if (!upstream.ok) {
        res.status(502).json({ error: `adsb.lol returned HTTP ${upstream.status}` });
        return;
      }
      const body = await upstream.json();
      adsbCache = { at: Date.now(), body };
      res.json(body);
    } catch (err) {
      res.status(502).json({
        error: `adsb.lol unreachable: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  // Zero-key Email OSINT Recon proxy (Gravatar HEAD check, keys.openpgp.org, GitHub user search)
  app.get('/api/osint/email-recon', async (req, res) => {
    const email = String(req.query.email || '').trim().toLowerCase();
    const md5 = String(req.query.md5 || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@([a-z0-9-]+\.)+[a-z]{2,}$/i.test(email) || !/^[a-f0-9]{32}$/.test(md5)) {
      res.status(400).json({ error: 'Valid email and 32-char md5 query parameters required' });
      return;
    }

    const ua = 'info9/0.1 (+https://github.com/ARYAN007H/info9)';
    const [gravatarRes, pgpRes, githubRes] = await Promise.allSettled([
      fetch(`https://www.gravatar.com/avatar/${md5}?d=404`, {
        method: 'HEAD',
        headers: { 'User-Agent': ua },
      }),
      fetch(`https://keys.openpgp.org/vks/v1/by-email/${encodeURIComponent(email)}`, {
        method: 'GET',
        headers: { 'User-Agent': ua },
      }),
      fetch(
        `https://api.github.com/search/users?q=${encodeURIComponent(`${email} in:email`)}`,
        {
          headers: { 'User-Agent': ua, Accept: 'application/vnd.github+json' },
        }
      ),
    ]);

    const hasGravatar =
      gravatarRes.status === 'fulfilled' && gravatarRes.value.status === 200;
    const hasOpenPgpKey =
      pgpRes.status === 'fulfilled' && pgpRes.value.status === 200;

    let githubLogins: string[] = [];
    if (githubRes.status === 'fulfilled' && githubRes.value.ok) {
      try {
        const ghJson = (await githubRes.value.json()) as {
          items?: Array<{ login?: string }>;
        };
        if (Array.isArray(ghJson?.items)) {
          githubLogins = ghJson.items
            .map((i) => String(i.login || ''))
            .filter(Boolean)
            .slice(0, 5);
        }
      } catch {
        // ignore parse error
      }
    }

    res.json({
      email,
      md5,
      hasGravatar,
      gravatarUrl: hasGravatar
        ? `https://www.gravatar.com/avatar/${md5}?s=240&d=404`
        : null,
      hasOpenPgpKey,
      openPgpUrl: hasOpenPgpKey
        ? `https://keys.openpgp.org/vks/v1/by-email/${encodeURIComponent(email)}`
        : null,
      githubLogins,
      fetchedAtUtc: new Date().toISOString(),
    });
  });

  // =========================================================================
  // PHASE 1–3 INTELLIGENCE ENDPOINTS (Universal Web Discovery, Deep Identity,
  // Public Records, Infra Attribution, Crypto/Maritime, SSE Spider, SQLite, AI)
  // =========================================================================

  // Phase 1: Universal Multi-Source Open-Web Search Aggregator
  app.get('/api/osint/web-search', async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q || q.length > 240) {
      res.status(400).json({ error: 'Search query (1..240 chars) required' });
      return;
    }
    const sourcesRaw = String(req.query.sources || '').trim();
    const sources = sourcesRaw
      ? sourcesRaw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    try {
      const result = await runUniversalWebSearch(q, sources);
      res.json(result);
    } catch (err) {
      res.status(502).json({
        error: `Universal search failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  // Phase 1: SSRF-Guarded Live Page Intelligence Extractor + SQLite FTS5 Archive
  app.post('/api/osint/web-extract', async (req, res) => {
    const url = String(req.body?.url || '').trim();
    const caseId = String(req.body?.caseId || '').trim();
    if (!url || url.length > 800) {
      res.status(400).json({ error: 'Valid public http(s) URL required' });
      return;
    }
    try {
      const { page, fullText, headers } = await extractLivePageIntelligence(url);
      if (caseId) {
        db.saveCollectedPage(caseId, page, fullText);
      }
      res.json({
        page,
        archivedToSqlite: Boolean(caseId),
        headers: {
          server: headers['server'] || null,
          poweredBy: headers['x-powered-by'] || null,
          contentType: headers['content-type'] || null,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = /blocked|not permitted|malformed|only http/i.test(msg) ? 400 : 502;
      res.status(status).json({ error: msg });
    }
  });

  // Phase 1: Deep Username Profile Enrichment (GitHub + commit emails, GitLab, Reddit, HN, Keybase, Bluesky, Mastodon, Dev.to)
  app.get('/api/osint/identity/enrich', async (req, res) => {
    const handle = String(req.query.handle || '').trim();
    if (!handle) {
      res.status(400).json({ error: 'handle query parameter required' });
      return;
    }
    try {
      const profiles = await enrichUsernameProfiles(handle);
      res.json({
        handle,
        count: profiles.length,
        profiles,
        fetchedAtUtc: new Date().toISOString(),
      });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Profile enrichment failed',
      });
    }
  });

  // Phase 1: Deep Email Recon (Gravatar JSON, OpenPGP, ProtonMail HKP creation date, XposedOrNot breaches, GitHub commits)
  app.get('/api/osint/email-recon-deep', async (req, res) => {
    const email = String(req.query.email || '').trim().toLowerCase();
    const md5 = String(req.query.md5 || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@([a-z0-9-]+\.)+[a-z]{2,}$/i.test(email) || !/^[a-f0-9]{32}$/.test(md5)) {
      res.status(400).json({ error: 'Valid email and 32-char md5 query parameters required' });
      return;
    }
    try {
      const data = await runDeepEmailRecon(email, md5);
      res.json(data);
    } catch (err) {
      res.status(502).json({
        error: `Deep email recon failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  // Phase 2: Global Public Records (SEC EDGAR, CourtListener, OpenSanctions, ICIJ, optional UK Companies House)
  app.get('/api/osint/public-records', async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q || q.length > 200) {
      res.status(400).json({ error: 'Query parameter q required' });
      return;
    }
    try {
      const data = await searchGlobalPublicRecords(q);
      res.json(data);
    } catch (err) {
      res.status(502).json({
        error: `Public records search failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  // Phase 2: Deep Infrastructure Attribution (URLScan Reverse-IP, OTX Passive DNS/Pulses, URLhaus, ThreatFox, BGPView, Favicon Hash)
  app.get('/api/osint/infra/attribution', async (req, res) => {
    const domain = String(req.query.domain || '').trim();
    const ip = req.query.ip ? String(req.query.ip).trim() : undefined;
    if (!domain || domain.length > 253) {
      res.status(400).json({ error: 'Valid domain parameter required' });
      return;
    }
    try {
      const data = await runInfraAttribution(domain, ip);
      res.json(data);
    } catch (err) {
      res.status(502).json({
        error: `Infrastructure attribution failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  // Phase 2: Crypto Wallet Intelligence + Live OFAC SDN Cross-Check
  app.get('/api/osint/crypto/wallet', async (req, res) => {
    const address = String(req.query.address || '').trim();
    if (!address) {
      res.status(400).json({ error: 'Wallet address parameter required' });
      return;
    }
    try {
      const ofacLoaded = await getOrLoadOfacCandidates(12000).catch(() => null);
      const data = await lookupCryptoWallet(address, ofacLoaded?.candidates ?? []);
      res.json(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(/enter a valid/i.test(msg) ? 400 : 502).json({ error: msg });
    }
  });

  // Phase 2: Maritime Vessel Lookup + Live OFAC SDN Vessel Cross-Check
  app.get('/api/osint/maritime/vessel', async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q || q.length > 140) {
      res.status(400).json({ error: 'Vessel name, IMO, or MMSI required' });
      return;
    }
    try {
      const ofacLoaded = await getOrLoadOfacCandidates(12000).catch(() => null);
      const data = await lookupMaritimeVessel(q, ofacLoaded?.candidates ?? []);
      res.json(data);
    } catch (err) {
      res.status(502).json({
        error: `Maritime lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  // Phase 2: Recursive Multi-Hop Pivot Spider (SSE Stream, Depth 1-3)
  app.get('/api/osint/pivot-spider', async (req, res) => {
    const target = String(req.query.target || '').trim();
    const kind = normalizeSpiderSeedKind(String(req.query.kind || 'domain'));
    const depth = Number(req.query.depth || 2);
    const caseId = String(req.query.caseId || 'default-case').trim();

    if (!target || target.length > 200) {
      res.status(400).json({ error: 'Valid target query parameter required' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    let closed = false;
    req.on('close', () => {
      closed = true;
    });

    const emit = (event: unknown) => {
      if (closed) return;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      await executeRecursivePivotSpider(
        { caseId, seedKind: kind, seedValue: target, maxDepth: depth },
        db,
        emit
      );
    } catch (err) {
      emit({
        type: 'error',
        jobId: 'error',
        message: err instanceof Error ? err.message : 'Spider error',
      });
    } finally {
      if (!closed) {
        res.end();
      }
    }
  });

  // Phase 3: Evidence-Grounded AI Analyst Copilot (Gemini when GEMINI_API_KEY is set, zero-key Local Evidence Engine otherwise)
  app.post('/api/osint/copilot/analyze', async (req, res) => {
    const mode = String(req.body?.mode || 'briefing_qa') as CopilotMode;
    const caseData = req.body?.caseData as InvestigationCase | undefined;
    const question = req.body?.question ? String(req.body.question) : undefined;
    const rawText = req.body?.rawText ? String(req.body.rawText) : undefined;

    if (!caseData || !caseData.id) {
      res.status(400).json({ error: 'Valid caseData payload required' });
      return;
    }
    if (!['ner_extract', 'ach_matrix', 'next_pivots', 'briefing_qa'].includes(mode)) {
      res.status(400).json({ error: 'Invalid copilot analysis mode' });
      return;
    }

    try {
      const result = await runEvidenceCopilotAnalysis({
        mode,
        caseData,
        question,
        rawText,
      });
      res.json(result);
    } catch (err) {
      res.status(502).json({
        error: `AI Copilot analysis failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  // Phase 3: SQLite Case Persistence, FTS5 Search, Scan Jobs & Connector Matrix
  app.get('/api/db/cases', (_req, res) => {
    try {
      res.json({
        cases: db.listCases(),
        stats: db.getStats(),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'DB read failed' });
    }
  });

  app.put('/api/db/cases/:id', (req, res) => {
    const caseData = req.body as InvestigationCase | undefined;
    if (!caseData || !caseData.id || caseData.id !== req.params.id) {
      res.status(400).json({ error: 'Case payload id must match route parameter' });
      return;
    }
    try {
      db.upsertCase(caseData);
      res.json({ ok: true, id: caseData.id, stats: db.getStats() });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'DB save failed' });
    }
  });

  app.delete('/api/db/cases/:id', (req, res) => {
    try {
      db.deleteCase(req.params.id);
      res.json({ ok: true, id: req.params.id });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'DB delete failed' });
    }
  });

  app.get('/api/db/search', (req, res) => {
    const q = String(req.query.q || '').trim();
    const caseId = req.query.caseId ? String(req.query.caseId).trim() : undefined;
    if (!q) {
      res.json({ hits: [] });
      return;
    }
    try {
      res.json({ hits: db.searchArchivedPages(q, caseId) });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'FTS5 search failed' });
    }
  });

  app.get('/api/db/jobs', (req, res) => {
    const caseId = req.query.caseId ? String(req.query.caseId).trim() : undefined;
    try {
      res.json({ jobs: db.listScanJobs(caseId) });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Job listing failed' });
    }
  });

  app.get('/api/db/stats', (_req, res) => {
    try {
      res.json({
        stats: db.getStats(),
        connectors: getConnectorStatusMatrix(),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Stats failed' });
    }
  });

  app.post('/api/db/reset', (_req, res) => {
    try {
      db.clearAllData();
      res.json({ ok: true, stats: db.getStats() });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Reset failed' });
    }
  });

  // Catch-all for unknown /api/* routes so dev/prod never returns HTML 200 on missing API paths.
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    // SPA fallback: any non-API GET without a static file match serves index.html.
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/')) {
        next();
        return;
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Argon OSINT v2.0 Workbench running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
