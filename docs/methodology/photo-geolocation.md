# Methodology: Photo Geolocation (AI hypothesis + zero-key matching)

Module: **01 Geolocate** (photo panel) · Code: `src/utils/visionGeolocate.ts`, `src/utils/imageHash.ts`, `src/services/photoCorroborate.ts` · Tests: `src/utils/visionGeolocate.test.ts`, `src/utils/imageHash.test.ts`

## The pipeline

1. **EXIF** is parsed locally. GPS present → the pin is set directly (LIVE, done). Stripped (typical for re-shared images) → continue.
2. **AI hypothesis (optional)** — with a free `GEMINI_API_KEY`, the vision model proposes ranked candidate locations (coordinates, confidence, reasoning, visible landmarks). Every candidate is rendered as **HYPOTHESIS — NOT EVIDENCE** with DERIVED provenance. The response parser **drops out-of-range or non-numeric coordinates** and clamps confidences — a hallucinated coordinate can never reach the map.
3. **Automated zero-key matching** — no key, no redirect: the engine computes a 64-bit dHash of the upload, searches Wikimedia Commons for GPS-tagged photos of the described scene, hashes their thumbnails, and ranks them by perceptual similarity. A strong match pins **real coordinates** sourced from Commons metadata (LIVE provenance, reverse-geocoded).
4. **Human corroboration** — one-click Street View / satellite deep links and reverse-image-search entry points (Google Lens, Yandex, TinEye, Bing). Nothing is auto-published; the analyst compares the photos side by side.

## Why dHash works here

dHash downscales to 9×8 grayscale and encodes horizontal gradient signs — it's stable under brightness shifts, rescaling and moderate re-compression, so the same *scene* photographed from a similar vantage hashes close together. Similarity = (64 − Hamming distance)/64. It is deliberately cheap and explainable rather than state-of-the-art; for popular landmark scenes (avenues, squares, stations) Commons coverage does the heavy lifting.

**Provenance rule:** Commons GPS metadata is LIVE; the visual-similarity judgement is DERIVED; the AI candidate is an unverified hypothesis. The dossier shows which is which.

## Failure behaviour

- Vision model unavailable / no key → explicit panel with setup instructions; the zero-key path stays fully usable.
- Commons match with no GPS → excluded from results (count reported honestly).
- Model returns `{"candidates":[]}` → reported as "no usable geographic signal", not guessed.

## References

- WhatsMyName-style dataset discipline (community probe lists) — https://github.com/WebBreacher/WhatsMyName
- Wikimedia Commons API — https://commons.wikimedia.org/w/api.php
- dHash (Hacker Factor) — https://www.hackerfactor.com/blog/index.php?/archives/529-Kind-of-Like-That.html
- Google Gemini API (free tier) — https://ai.google.dev/
- Bellingcat photo geolocation techniques — https://www.bellingcat.com/category/resources/how-tos/
