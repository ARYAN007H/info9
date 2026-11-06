import test from 'node:test';
import assert from 'node:assert/strict';
import {
  arrayBufferToBase64,
  buildGeminiRequestBody,
  extractGeminiText,
  parseVisionGeolocationPayload,
  REVERSE_IMAGE_SEARCH_LINKS,
  satelliteLink,
  streetViewLink,
  VISION_GEO_PROMPT,
} from './visionGeolocate';

const VALID_JSON = `{
  "candidates": [
    {
      "label": "Gyoko-dori Avenue, Marunouchi, Tokyo, Japan",
      "lat": 35.68406,
      "lon": 139.76271,
      "confidencePercent": 72.4,
      "reasoning": "Ginkgo avenue with Marunouchi towers.",
      "landmarks": ["ginkgo trees", "glass towers", "red crane"]
    },
    {
      "label": "Jingu Gaien, Tokyo, Japan",
      "lat": 35.6742,
      "lon": 139.7177,
      "confidencePercent": 21,
      "reasoning": "Alternative ginkgo avenue.",
      "landmarks": []
    }
  ]
}`;

test('parseVisionGeolocationPayload accepts a clean candidates array', () => {
  const candidates = parseVisionGeolocationPayload(VALID_JSON);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].label, 'Gyoko-dori Avenue, Marunouchi, Tokyo, Japan');
  assert.equal(candidates[0].lat, 35.68406);
  assert.equal(candidates[0].lon, 139.76271);
  assert.equal(candidates[0].confidencePercent, 72);
  assert.deepEqual(candidates[0].landmarks, ['ginkgo trees', 'glass towers', 'red crane']);
});

test('parser strips markdown fences and surrounding prose', () => {
  const wrapped = 'Here is my analysis:\n```json\n' + VALID_JSON + '\n```\nHope that helps!';
  const candidates = parseVisionGeolocationPayload(wrapped);
  assert.equal(candidates.length, 2);
});

test('parser drops out-of-range and non-numeric coordinates (hallucination fence)', () => {
  const hostile = JSON.stringify({
    candidates: [
      { label: 'bad lat', lat: 999, lon: 0, confidencePercent: 90, reasoning: '', landmarks: [] },
      { label: 'bad lon', lat: 0, lon: '139.76', confidencePercent: 90, reasoning: '', landmarks: [] },
      { label: 'NaN', lat: Number.NaN, lon: 0, confidencePercent: 90, reasoning: '', landmarks: [] },
      { label: 'ok', lat: 35.68, lon: 139.76, confidencePercent: 55, reasoning: '', landmarks: [] },
    ],
  });
  const candidates = parseVisionGeolocationPayload(hostile);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].label, 'ok');
});

test('parser clamps confidence to 0-100 and caps candidates at 5', () => {
  const many = Array.from({ length: 8 }, (_, i) => ({
    label: `c${i}`,
    lat: 10 + i,
    lon: 20 + i,
    confidencePercent: 150,
    reasoning: '',
    landmarks: [],
  }));
  const candidates = parseVisionGeolocationPayload(JSON.stringify({ candidates: many }));
  assert.equal(candidates.length, 5);
  candidates.forEach((c) => assert.equal(c.confidencePercent, 100));
});

test('parser throws with a clear message on garbage and missing candidates', () => {
  assert.throws(() => parseVisionGeolocationPayload('no json here at all'), /no JSON object/);
  assert.throws(() => parseVisionGeolocationPayload('{"foo": 1}'), /missing candidates/);
  assert.throws(() => parseVisionGeolocationPayload('{"candidates": "not an array"}'), /missing candidates/);
});

test('extractGeminiText joins text parts and explains blocked/empty responses', () => {
  assert.equal(
    extractGeminiText({
      candidates: [{ content: { parts: [{ text: '{"candidates":[]}' }] } }],
    }),
    '{"candidates":[]}'
  );
  assert.throws(
    () => extractGeminiText({ promptFeedback: { blockReason: 'SAFETY' } }),
    /blocked the request \(SAFETY\)/
  );
  assert.throws(
    () => extractGeminiText({ candidates: [{ finishReason: 'RECITATION' }] }),
    /finishReason: RECITATION/
  );
  assert.throws(() => extractGeminiText({}), /no candidates/);
});

test('buildGeminiRequestBody embeds inline image data and strict JSON config', () => {
  const body = buildGeminiRequestBody('QUJD', 'image/jpeg') as {
    contents: Array<{ parts: Array<Record<string, unknown>> }>;
    generationConfig: Record<string, unknown>;
  };
  const parts = body.contents[0].parts;
  assert.deepEqual(parts[0].inline_data, { mime_type: 'image/jpeg', data: 'QUJD' });
  assert.equal(parts[1].text, VISION_GEO_PROMPT);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
});

test('verification links and coordinate links are well-formed', () => {
  assert.ok(REVERSE_IMAGE_SEARCH_LINKS.length >= 3);
  for (const engine of REVERSE_IMAGE_SEARCH_LINKS) {
    assert.match(engine.url, /^https:\/\//);
    assert.ok(engine.name.length > 0);
  }
  assert.equal(streetViewLink(35.68406, 139.76271), 'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=35.68406,139.76271');
  assert.match(satelliteLink(35.68406, 139.76271), /^https:\/\/www\.google\.com\/maps\/@35\.68406,139\.76271,17z/);
});

test('arrayBufferToBase64 round-trips binary data', () => {
  const bytes = new Uint8Array(256);
  for (let i = 0; i < 256; i++) bytes[i] = i;
  const encoded = arrayBufferToBase64(bytes.buffer);
  const decoded = Buffer.from(encoded, 'base64');
  assert.equal(decoded.length, 256);
  assert.deepEqual(Array.from(decoded), Array.from(bytes));
});
