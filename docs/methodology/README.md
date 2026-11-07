# info9 Methodology Library

Every conclusion class in info9 comes from a documented, unit-tested method. These pages explain **how** each module reaches its outputs, where the constants live, what the honest limitations are, and what to read next.

A reviewer's rule of thumb that this project follows: *a tool that can't explain how it reached a number has no business showing the number.*

| Page | Module |
|---|---|
| [Geolocation & chronolocation](geolocation.md) | Shadow math, Overpass intersection, ERA5 verification |
| [Photo geolocation](photo-geolocation.md) | AI hypothesis + Commons dHash matching pipeline |
| [Corporate unwrapping](corporate-unwrapping.md) | GLEIF L2 chains, effective equity, Tarjan cycles |
| [Infrastructure recon](infrastructure-recon.md) | Passive-only discipline + the transparent risk rule table |
| [Media forensics](media-forensics.md) | ELA, copy-move, noise maps, JPEG ghosts, EXIF review |
| [Identity resolution](identity.md) | ~700-site username sweep, SSRF hardening |
| [Sanctions screening](sanctions-screening.md) | Live OFAC SDN, transliteration + Jaro-Winkler scoring |
| [Evidence ledger & exports](evidence-ledger.md) | SHA-256 chain, Merkle root, STIX 2.1, MISP 2.4 |

Cross-cutting contracts (enforced in code and CI):

- **Zero keys.** Every data source is a free public endpoint. Optional capabilities (Gemini vision) are disclosed, degrade gracefully, and mark their output as hypotheses.
- **No fabricated data.** Failed lookups render as named gaps — never plausible filler. This is tested: regression tests assert that fabrication patterns stay dead.
- **Provenance on every value.** LIVE / DERIVED / NO DATA, with source and timestamp, carried through to the PDF dossier.
- **Disclosed heuristics.** Any score (domain risk, sanctions match) renders every contributing factor so the analyst can audit the number.
