import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import {
  buildGeminiRequestBody,
  extractGeminiText,
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

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

  // AI photo geolocation (optional — needs a free Gemini key in GEMINI_API_KEY).
  // The model output is a DERIVED hypothesis; corroboration stays zero-key.
  app.post('/api/osint/vision-geolocate', async (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(501).json({
        error:
          'GEMINI_API_KEY is not configured on this server. Add it to your .env (free key at aistudio.google.com/apikey) to enable AI photo geolocation. All other info9 features work without it.',
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

    const model = String(process.env.GEMINI_MODEL || 'gemini-2.5-flash');
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45000);
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify(buildGeminiRequestBody(imageBase64, mimeType)),
        }
      );
      clearTimeout(timeout);

      const json = await geminiRes.json().catch(() => null);
      if (!geminiRes.ok) {
        const msg = json?.error?.message || `Gemini returned HTTP ${geminiRes.status}`;
        res.status(502).json({ error: `Vision upstream error: ${msg}` });
        return;
      }

      const candidates = parseVisionGeolocationPayload(extractGeminiText(json));
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
  const OFAC_SDN_URL = 'https://www.treasury.gov/ofac/downloads/sdn.csv';
  let ofacCache: {
    candidates: ReturnType<typeof toSanctionsCandidates>;
    rawCount: number;
    fetchedAt: string;
  } | null = null;
  app.get('/api/osint/sanctions/ofac', async (_req, res) => {
    if (!ofacCache) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);
        const upstream = await fetch(OFAC_SDN_URL, {
          signal: controller.signal,
          headers: { 'User-Agent': 'info9/0.1 (+https://github.com/ARYAN007H/info9)' },
        });
        clearTimeout(timeout);
        if (!upstream.ok) {
          res.status(502).json({ error: `OFAC SDN download returned HTTP ${upstream.status}` });
          return;
        }
        const text = await upstream.text();
        const records = parseOfacSdnCsv(text);
        if (records.length === 0) {
          res.status(502).json({ error: 'OFAC SDN CSV parsed to zero records' });
          return;
        }
        ofacCache = {
          candidates: toSanctionsCandidates(records, 20000),
          rawCount: records.length,
          fetchedAt: new Date().toISOString(),
        };
      } catch (err) {
        res.status(502).json({
          error: `Could not load OFAC SDN list: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }
    }
    res.json({
      candidates: ofacCache.candidates,
      count: ofacCache.candidates.length,
      rawCount: ofacCache.rawCount,
      fetchedAt: ofacCache.fetchedAt,
      sourceUrl: OFAC_SDN_URL,
    });
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
