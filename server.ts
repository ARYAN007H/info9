import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import {
  buildGeminiRequestBody,
  extractGeminiText,
  parseVisionGeolocationPayload,
} from './src/utils/visionGeolocate';

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
