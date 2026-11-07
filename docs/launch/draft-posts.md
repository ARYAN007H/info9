# Launch drafts (for the maintainer to review and post)

These are drafts. Nothing here is auto-posted. Update screenshots/stats before publishing.

---

## 1. r/OSINT post

**Title:** I built a zero-key OSINT workbench that runs entirely on free public sources — geolocation, photo forensics, username sweeps, live OFAC screening, and pivot chains (AGPL-3.0)

**Body:**

Frustrated that every OSINT "suite" is either a paid SaaS, an abandoned script collection, or a bookmark list, I spent the last months building **info9** — a self-hostable intelligence workbench that runs on nothing but free public endpoints and in-browser computation. No API keys. No accounts. No telemetry.

**What's inside (7 modules):**

- **Geolocate** — multi-clause Overpass intersection solving ("find me where a substation and a rail crossing co-occur"), shadow-based chronolocation via NOAA solar equations, historical weather plausibility from ERA5, DEM horizon profiles
- **Photo geolocation** — upload an EXIF-stripped photo: it hashes your image and matches it against geolocated Wikimedia Commons photos, pinning real coordinates with zero keys. Optional AI hypothesis pass (free Gemini key) is clearly labeled HYPOTHESIS — NOT EVIDENCE
- **Infrastructure** — passive domain recon: DNS/RDAP/CT logs/Shodan InternetDB/RIPEstat/URLScan/Wayback, typosquat fuzzing with live resolution, and a fully disclosed risk rule table (every point shown)
- **Identity** — username sweep across ~700 sites (WhatsMyName dataset) with SSRF-hardened probing and honest "unknown (blocked)" counting
- **Watchlist** — live screening against the real OFAC SDN list (the actual Treasury CSV, parsed server-side), scored locally with transliteration + Jaro-Winkler
- **Pivot Console** — one input runs a full multi-source recon chain; downstream steps only pivot on entities upstream *actually emitted* — no invented pivots
- **Evidence ledger** — every finding hash-chained (SHA-256 + Merkle root), exportable as Markdown, print-grade PDF, STIX 2.1, and MISP 2.4

**The design rule I refused to compromise:** no fabricated data. Every failed lookup renders as a named gap — never plausible filler. Every value carries provenance (LIVE / DERIVED / NO DATA). Screenshots in the README show gaps being gaps.

**Verify claims in 30 seconds:** `docker compose up --build` → localhost:3000. Or headless: `npm run cli -- recon example.com`.

Repo: https://github.com/ARYAN007H/info9 (AGPL-3.0, Node 22+, 78 tests, CI enforces typecheck+tests+build+docker on every push)

Methodology docs for every module: https://github.com/ARYAN007H/info9/tree/main/docs/methodology

Feedback welcome — especially on the sanctions scoring weights and additional zero-key sources (the connector SDK makes each new source ~100 lines).

---

## 2. Hacker News

**Title:** Show HN: Zero-key OSINT workbench – geolocation, forensics, OFAC, pivot chains (AGPL)

**Text:**

info9 is a self-hostable OSINT workbench built entirely on free public data sources (OSM/Overpass, ERA5, GLEIF, crt.sh, Shodan InternetDB, RIPEstat, Wayback, Commons, Treasury SDN CSV, WhatsMyName) plus in-browser DSP. No API keys anywhere; the one optional capability (Gemini vision for photo geolocation hypotheses) degrades gracefully and labels its output as hypotheses.

Two things I care about more than the feature list:

1. Evidentiary integrity — provenance metadata on every value, failed upstreams render as named gaps, and regression tests assert that fabrication patterns (which existed in early prototypes!) stay dead.
2. Disclosed heuristics — the domain risk score is an additive rule table whose every factor is shown next to the number.

Everything is unit-tested (node:test, no framework), CI runs typecheck+tests+build+docker on every push. The connector registry (src/connectors) declares input/output entity kinds so pivot chains auto-suggest; each new source is one small file.

https://github.com/ARYAN007H/info9

Happy to answer questions about the chronolocation math (NOAA solar equations), the Commons dHash matching, or the OFAC CSV parsing.

---

## 3. Bellingcat community / Discord short post

Built a FOSS workbench implementing several published verification techniques (shadow chronolocation, Overpass intersection solving, ERA5 date verification, CT-based recon, hash-chained evidence ledger). All zero-key, self-hostable, methodology documented per module. Looking for feedback from working verification journalists — especially on what's missing for real casework. https://github.com/ARYAN007H/info9

---

## 4. X/Twitter thread opener

Spent months building a free, self-hostable OSINT workbench.

No API keys. No cloud. No fabricated data — failed lookups show gaps, never filler.

- photo → coordinates via Commons matching
- 700-site username sweeps
- live OFAC screening
- hash-chained evidence ledger
- pivot chains

AGPL: github.com/ARYAN007H/info9
