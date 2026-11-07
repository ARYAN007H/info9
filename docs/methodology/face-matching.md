# Methodology: Face Recon (on-device face matching)

Code: `src/services/faceEngine.ts`, `src/services/referenceHarvest.ts`, `src/utils/faceMatch.ts` · Tests: `src/utils/faceMatch.test.ts`
Status: **shipped** — local embeddings, corpus ranking, avatar sweep, Wikidata portrait verification, clustering.

## What it is

A reverse-face workbench that runs **entirely in your browser**: face detection
(BlazeFace), landmarks (FaceMesh) and deep face descriptors (FaceRes, 1024-d in human 3.3) via
[`@vladmandic/human`](https://github.com/vladmandic/human). Model weights are
vendored into the repo (`public/models/human/`, ~9 MB) so the tool works from a
cold self-hosted clone with no CDN calls.

**Privacy property: pixels never leave the machine.** The probe photo is decoded
and embedded locally (WebGL); only numeric descriptors enter the match math.
Reference images are downloaded *to* you, never uploaded *from* you.

## What it is not (the honest boundary)

There is **no free public whole-web face index**. PimEyes / Clearview-style
"search the entire internet by this face" requires a proprietary multi-billion
face index that no open endpoint provides — any "free" tool claiming it is a
front-end to a commercial engine or a redirect. info9 therefore matches against
**corpora the analyst assembles**, which is both the zero-key reality and the
legally safer design (1:N matching *within your own corpus*, 1:1 verification
against a named public portrait — not dragnet biometric search).

## The three zero-key reference flows

1. **Avatar sweep** — `unavatar.io/{handle}` (aggregates GitHub, X, Gravatar and
   ~20 more providers) plus `avatars.githubusercontent.com/{handle}` directly.
   Failed sources are reported as named data gaps; `?fallback=false` prevents
   synthesized placeholder images from masquerading as matches.
2. **Named-person verification** — Wikidata `wbsearchentities` → `wbgetentities`
   → **P18 claim** → Commons `Special:FilePath` render (512 px cap). Entities
   without a P18 portrait are reported as a gap, never guessed.
3. **Local corpus** — analyst-supplied folders (profile-photo sets, scraped
   galleries). Each image's best face is embedded; images with no detectable
   face are kept but excluded from matching, explicitly.

## The math

- **Descriptor**: FaceRes embedding (1024-d in human 3.3), computed per detected face.
- **Match line**: the engine's documented guidance is that similarity above 0.5 can be considered a match; info9's bands bracket that line.
- **Similarity**: cosine similarity between descriptors. The engine's documented
  decision line is **0.5** ("above 0.5 can be considered a match" — human docs);
  info9 brackets it into disclosed heuristic bands:
  - **≥ 0.55** STRONG SIMILARITY — corroborate before treating as same person
  - **0.45–0.55** POSSIBLE MATCH — manual review
  - **0.30–0.45** WEAK SIGNAL — likely different people
  - **< 0.30** NO MATCH
- **Clustering**: union-find over all corpus pairs at threshold 0.50; singleton
  groups are kept visible so the accounting is complete.
- **Ranking**: best-first; descriptors that cannot be compared (length or
  finiteness mismatch) rank last with a `null` score — a broken reference is
  never silently scored as a zero.

## Limitations, disclosed

- **Heuristic, not proof.** Embedding distance confuses siblings, lookalikes,
  heavy angle/occlusion, and heavily compressed avatars. Every UI band says
  "triage signal — not proof of identity".
- **Age/gender estimates** are network outputs, not ground truth; shown as
  "est." only.
- **Quality floor**: tiny avatars (< 64 px faces) degrade descriptors; the
  detector's confidence is always shown next to the thumbnail.
- **Multi-face probe photos**: the analyst selects the subject face; the
  highest-confidence detection is preselected, not silently assumed.
- **CORS**: Wikimedia/GitHub/unavatar send CORS headers; anything that doesn't
  falls back to the local SSRF-guarded proxy (`/api/osint/image-proxy`:
  http(s) only, private-host blocklist, image content-type check, 8 MB cap).

## Privacy countermeasures (the mirror use)

The same technique that identifies also protects: face embeddings are
biometric data. If you publish photos, crop metadata *and* expect that faces in
them identify you — because they do, to anyone running this or any other tool.
There is no reliable consumer countermeasure once a photo is public; not
publishing is the only full defense.

## Legal note

Face matching law varies by jurisdiction (e.g. Illinois BIPA, GDPR Art. 9
special-category data). info9 ships the capability for authorized
investigations — journalists verifying a source, researchers, defenders
identifying impersonators — and discloses its method so outputs can be audited.
You are responsible for how you use it.

## References

- vladmandic/human — https://github.com/vladmandic/human (FaceRes embedding;
  similarity guidance: > 0.5 considered a match)
- FaceNet-style descriptor matching: Schroff et al., *FaceNet* (CVPR 2015)
- unavatar.io — keyless avatar aggregation
- Wikidata P18 (image property) — https://www.wikidata.org/wiki/Property:P18
