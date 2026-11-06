import type {
  VisionGeolocationCandidate,
  VisionGeolocationResult,
} from '../types/osint';

export type { VisionGeolocationResult };

/**
 * AI-assisted photo geolocation.
 *
 * Evidentiary contract: the vision model produces a HYPOTHESIS, never a
 * fact. Every candidate carries its own confidence and reasoning and is
 * marked DERIVED; analysts must corroborate via the bundled zero-key
 * verification links (Street View, satellite, reverse image search) and the
 * Overpass/Nominatim tools before recording anything in the evidence ledger.
 */

export const VISION_GEO_PROMPT = `You are an expert photo-geolocation analyst (GeoEstimation). Identify where this photograph was most likely taken.

Analyze: architecture style, signage/scripts and language, vegetation species, road markings, vehicle types, sky/sun quality, camera perspective.

Return STRICT JSON only (no markdown, no prose) matching exactly:
{"candidates":[{"label":"<place, city, country>","lat":<number>,"lon":<number>,"confidencePercent":<0-100>,"reasoning":"<max 2 sentences citing the visible evidence>","landmarks":["<visible clue 1>","<visible clue 2>"]}]}

Rules:
- 1 to 3 candidates, most likely first.
- lat/lon must be WGS84 decimal degrees pointing at the exact street or viewpoint, not the city center.
- confidencePercent must reflect genuine uncertainty. Below 20% say so.
- If the photo gives no geographic signal at all, return {"candidates":[]} and nothing else.`;

/** Builds the Gemini generateContent REST body (pure, unit-tested). */
export function buildGeminiRequestBody(
  imageBase64: string,
  mimeType: string
): Record<string, unknown> {
  return {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: mimeType, data: imageBase64 } },
          { text: VISION_GEO_PROMPT },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json',
    },
  };
}

/** Extracts the concatenated text of a Gemini generateContent response. */
export function extractGeminiText(responseJson: unknown): string {
  const candidates = (responseJson as { candidates?: unknown })?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    const blockReason = (responseJson as { promptFeedback?: { blockReason?: string } })
      ?.promptFeedback?.blockReason;
    throw new Error(
      blockReason
        ? `Vision model blocked the request (${blockReason})`
        : 'Vision model returned no candidates'
    );
  }
  const first = candidates[0] as {
    content?: { parts?: Array<{ text?: unknown }> };
    finishReason?: string;
  };
  const parts = first?.content?.parts;
  if (!Array.isArray(parts)) {
    throw new Error(
      first?.finishReason
        ? `Vision model produced no text (finishReason: ${first.finishReason})`
        : 'Vision model response missing content parts'
    );
  }
  return parts
    .map((p) => (typeof p.text === 'string' ? p.text : ''))
    .join('')
    .trim();
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Parses and validates the model's JSON payload. Defensive by design:
 * malformed, out-of-range, or non-numeric fields are dropped — an analyst
 * must never see a hallucinated coordinate dressed up as valid.
 */
export function parseVisionGeolocationPayload(rawText: string): VisionGeolocationCandidate[] {
  const stripped = rawText
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('AI response contained no JSON object');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped.slice(start, end + 1));
  } catch {
    throw new Error('AI response was not valid JSON');
  }

  const rawCandidates = (parsed as { candidates?: unknown })?.candidates;
  if (!Array.isArray(rawCandidates)) {
    throw new Error('AI response JSON missing candidates array');
  }

  const valid: VisionGeolocationCandidate[] = [];
  for (const item of rawCandidates) {
    if (typeof item !== 'object' || item === null) continue;
    const c = item as Record<string, unknown>;
    if (!isFiniteNumber(c.lat) || Math.abs(c.lat) > 90) continue;
    if (!isFiniteNumber(c.lon) || Math.abs(c.lon) > 180) continue;
    const confidence =
      isFiniteNumber(c.confidencePercent) && c.confidencePercent >= 0
        ? Math.min(100, Math.round(c.confidencePercent))
        : 0;
    valid.push({
      label: typeof c.label === 'string' && c.label.trim() ? c.label.trim() : 'Unnamed candidate',
      lat: Number(c.lat.toFixed(6)),
      lon: Number(c.lon.toFixed(6)),
      confidencePercent: confidence,
      reasoning:
        typeof c.reasoning === 'string' ? c.reasoning.slice(0, 600) : '',
      landmarks: Array.isArray(c.landmarks)
        ? c.landmarks.filter((l): l is string => typeof l === 'string').slice(0, 8)
        : [],
    });
    if (valid.length >= 5) break;
  }
  return valid;
}

/** Free human-verification entry points (upload pages — no API exists). */
export const REVERSE_IMAGE_SEARCH_LINKS: Array<{ name: string; url: string; note: string }> = [
  { name: 'Google Lens', url: 'https://lens.google.com/upload', note: 'strongest for landmarks' },
  { name: 'Yandex Images', url: 'https://yandex.com/images/search', note: 'strongest for places/faces' },
  { name: 'TinEye', url: 'https://tineye.com/', note: 'finds earliest appearance' },
  { name: 'Bing Visual', url: 'https://www.bing.com/visualsearch', note: 'cross-check' },
];

export function streetViewLink(lat: number, lon: number): string {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}`;
}

export function satelliteLink(lat: number, lon: number): string {
  return `https://www.google.com/maps/@${lat},${lon},17z/data=!3m1!1e3`;
}

/** ArrayBuffer -> base64 (no data: prefix), for the vision endpoint. */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
