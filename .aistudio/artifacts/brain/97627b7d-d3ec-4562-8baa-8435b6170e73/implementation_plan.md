# Argon OSINT v2.0 — 15× Advanced Specialist-Grade Intelligence & Forensics Plan

This upgrade transforms **Argon OSINT** from a 5-module workbench into a deep, specialist-grade intelligence platform engineered to match or outperform the top dedicated tools in each domain (**Bellingcat OSM Search + SunCalc Pro**, **Maltego + ICIJ Offshore Graph**, **Shodan InternetDB + URLScan + DNSTwist**, **Amped Authenticate + Forensically + InVID**, and **LexisNexis Bridger + OpenCTI STIX 2.1**) — while keeping **100% zero paid API keys** and instant Vercel execution.

## User Review & Critical Decisions

> [!IMPORTANT]
> Review the 15× domain upgrades and new zero-key public intelligence integrations below. Click **Proceed** to execute the full upgrade across all five engines.

- **Zero-Cost Specialist API Expansion (14 Live Public Endpoints)**:
  - Adds **Shodan InternetDB** (`internetdb.shodan.io` — free zero-key open ports, CPEs, and CVEs per IP), **RIPE Stat BGP Intelligence** (`stat.ripe.net` — live BGP prefix peers & routing announcements), **URLScan.io Public Search API**, **GLEIF Level-2 Parent/Subsidiary Relationship API**, **Wikidata SPARQL**, and **OpenAlex Institutional Graph API** on top of Cloudflare DoH, RDAP, crt.sh, Nominatim, Overpass QL, Open-Meteo DEM/ERA5, and Wayback CDX.
- **Pure Client-Side DSP, Graph Theory & Astronomical Solvers**:
  - Adds **Blind Two-Shadow Inverse Geolocation**, **Overpass Multi-Clause Intersection Chaining**, **Copy-Move Block Clone Detection**, **JPEG Ghost Double-Quantization Curves**, **DNSTwist Live Typosquatting Permutation Fuzzing**, **Tarjan Cycle & Effective Equity Pathfinding**, and **STIX 2.1 + Merkle Root Cryptographic Bundles**.

---

## 1. Overview & Core Concept (Benchmark vs. Industry Leaders)

| Workbench Domain | Industry Benchmark Tools | 15× Advanced Capabilities Added in Argon OSINT v2.0 |
| :--- | :--- | :--- |
| **01. Geolocation & Chronolocation** | *Bellingcat OSM Search, SunCalc Pro, PeakFinder* | **Multi-Clause Overpass Spatial Intersection Solver** (find exact coordinates where e.g. `Substation` $\cap$ `Rail Crossing` $\cap$ `Storage Tank` co-occur within custom radii), **Blind Inverse Solar Geolocation** (solve unknown Lat/Lon from 2 shadow observations), **On-Photo 2-Point Pixel Photogrammetry Calibrator**, and **8-Radial DEM Terrain Horizon & Viewshed Profiler**. |
| **02. Dossier & Shell Topology** | *Maltego, Palantir Gotham, OpenCorporates* | **1-Click Automated Graph Transforms** (GLEIF Level-2 Parent/Ultimate Parent crawler, Wikidata SPARQL expansion, OpenAlex research nexus), **Effective Beneficial Equity Calculator** ($E_{\text{eff}} = \prod p_i$ across multi-hop shells), **Tarjan Circular Ownership Detector**, and **Shortest Conduit Path-Finder**. |
| **03. Threat Infra & Phishing** | *Shodan, Censys, DomainTools Iris, DNSTwist* | **Shodan InternetDB Port/CVE/CPE Scanner** (zero-key), **RIPE Stat BGP ASN Peer & Prefix Inspector**, **URLScan.io Live Snapshot Search**, **DMARC/SPF/CAA Security Grader**, and an interactive **DNSTwist Typosquatting & Homograph Permutation Fuzzer** with parallel live DoH probing. |
| **04. Media & Video Forensics** | *Amped Authenticate, Forensically (29a.ch), InVID* | **6-Mode DSP Canvas Lab**: (1) **Error Level Analysis (ELA)**, (2) **Copy-Move Clone Detector** (DCT patch matching with displacement vectors), (3) **Wavelet Noise Variance Map**, (4) **JPEG Ghost Quality Sweep Curve**, (5) **8× Interactive Pixel Loupe & Live 256-Bin RGB Histogram**, and (6) **Video Keyframe Scrubber & Perceptual `dHash`/`pHash` Hamming Comparator**. |
| **05. Sanctions & Audit Ledger** | *LexisNexis Bridger, OpenSanctions, OpenCTI* | **Cross-Script Transliteration Normalizer** (Cyrillic/Latin/Arabic phonetic mapping), **Double Metaphone + Token-Set Ratio + Bayesian Posterior Odds Breakdown**, **Binary Merkle Tree Root Calculator**, and **STIX 2.1 Threat Intelligence Bundle (.json) + Signed Dossier (.md) Export**. |

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Multi-Constraint Geolocation & Blind Solar Triangulation**: Analysts toggle between *Pinpoint Chronolocation Mode* and *Multi-Constraint Overpass Intersection Mode* (chaining up to 3 infrastructure constraints with distance sliders to highlight exact candidate intersections on the satellite map) or *Inverse Blind Solar Solver* (computing candidate latitude/longitude bands from shadow geometry alone).
  2. **Maltego-Style Graph Transforms**: Selecting any entity node in the Corporate Shell Canvas exposes a **Transform Action Bar** (*Expand GLEIF Parents*, *Calculate Effective UBO Equity*, *Detect Circular Conduits*, *Pivot to DNSTwist*), dynamically mutating the graph and calculating multi-hop equity percentages.
  3. **Live Shodan InternetDB + RIPE BGP + DNSTwist Recon**: Scanning a domain automatically enriches its IPv4 addresses with open ports, CPE banners, and CVEs from Shodan InternetDB, BGP prefix origin data from RIPE Stat, and allows launching a 1-click **DNSTwist Fuzzer** that generates 20+ lookalike permutations and resolves them live via Cloudflare DoH.
  4. **Amped/Forensically Multi-Filter Canvas & Loupe**: Analysts switch seamlessly between *ELA*, *Copy-Move Clone Vectors*, *Noise Variance*, and *JPEG Ghost*, hover over the canvas with an **8× Magnifier Loupe**, inspect the live **RGB/Luminance Histogram**, and scrub multi-frame video keyframes.

- **Visual Identity & Theme**:
  - Preserves the disciplined **60-30-10 Tactical Command Center** aesthetic (`#090D16` obsidian canvas, `#0F172A` single-elevation panels, `#1E293B` `1px` hairlines, `Plus Jakarta Sans` + `Public Sans` + `JetBrains Mono tabular-nums`) and strict **3-Zone Top Bar Contract**.
  - Adds high-precision scientific instrumentation widgets: interactive **Polar Solar Azimuth/Altitude Dome**, **360° DEM Horizon Radar**, **256-Bin Real-Time RGB Histogram SVG**, **Copy-Move Vector Overlays**, and **Merkle Tree Root Verification Badges**.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Zero-Key Shodan InternetDB + RIPE Stat + URLScan + GLEIF L2 Proxy & Client Orchestration**
  - *Chosen Approach*: Integrate Shodan's free public `internetdb.shodan.io/{ip}` endpoint, RIPE NCC's `stat.ripe.net` JSON APIs, URLScan's public search endpoint, and GLEIF's Level-2 relationship endpoints through both direct CORS requests and `server.ts` fallback routes.
  - *Why*: Delivers real open-port, CVE, BGP routing, and corporate parent-chain intelligence without requiring the user or site visitors to register for paid API keys.

- **Decision 2: Synchronous TypedArray DSP for Copy-Move, Noise Variance & RGB Histograms**
  - *Chosen Approach*: Implement block-based DCT/luminance quantization for Copy-Move clone detection, local Sobel/Laplacian variance maps, and 256-bin RGB histograms using pre-allocated `Uint8ClampedArray` and `Float32Array` buffers on a `640×360` forensic canvas.
  - *Why*: Guarantees sub-40ms frame updates at 60fps in any browser without server round-trips or GPU driver crashes.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Component Diagram

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        TOP NAVIGATION BAR (3-Zone Contract)                            │
│  [Argon OSINT]       [Geolocation · Dossier · Infrastructure · Forensics · Sanctions]  │
└─────────────────┬──────────────────────────────────────────────────────────────────────┘
                  │
┌─────────────────┴──────────────────────────────────────────────────────────────────────┐
│  CASE SIDEBAR   │  15× ADVANCED SPECIALIST MODULE ENGINES                              │
│  (288px)        ├──────────────────────────────────────────────────────────────────────┤
│                 │  01. GEOLOCATION, OVERPASS SOLVER & SOLAR EPHEMERIS                  │
│  • Case Select  │      ├─ Multi-Clause Overpass QL Spatial Intersection Engine         │
│  • Entity Graph │      ├─ NOAA Diurnal Curve + Polar Sun Dome + Blind Lat/Lon Solver   │
│    Pinboard     │      └─ 8-Radial Open-Meteo DEM Viewshed & Terrain Horizon Graph     │
│  • Effective    ├──────────────────────────────────────────────────────────────────────┤
│    Equity &     │  02. CORPORATE SHELL UNWRAPPER & LINK ANALYSIS                       │
│    SHA-256      │      ├─ GLEIF L1/L2 Parent Crawler + Wikidata + OpenAlex Harvester   │
│    Counters     │      ├─ Maltego-Style 1-Click Node Transforms                        │
│  • STIX 2.1 &   │      └─ Effective Equity (∏ p_i) & Tarjan Cycle Pathfinding Engine   │
│    Signed .MD   ├──────────────────────────────────────────────────────────────────────┤
│    Exporters    │  03. THREAT INFRASTRUCTURE, SHODAN CVE & DNSTWIST FUZZER             │
│  • Supabase     │      ├─ Cloudflare DoH (A/AAAA/MX/NS/TXT/CAA/DMARC) + RDAP + crt.sh  │
│    Cloud Sync   │      ├─ Shodan InternetDB (Open Ports, CPEs, CVEs) + RIPE Stat BGP   │
│                 │      └─ Live DNSTwist Permutation Generator & Parallel DoH Prober    │
│                 ├──────────────────────────────────────────────────────────────────────┤
│                 │  04. AMPED / FORENSICALLY 6-MODE MEDIA & VIDEO WORKSTATION           │
│                 │      ├─ ELA + Copy-Move Clone Vectors + Noise Variance + JPEG Ghost  │
│                 │      ├─ Interactive 8× Pixel Loupe + Live 256-Bin RGB Histogram      │
│                 │      └─ Video Keyframe Scrubber + Perceptual dHash + Wayback CDX     │
│                 ├──────────────────────────────────────────────────────────────────────┤
│                 │  05. CROSS-SCRIPT SANCTIONS REDUCER & MERKLE / STIX 2.1 LEDGER       │
│                 │      ├─ Jaro-Winkler + Double Metaphone + Cross-Script Normalizer    │
│                 │      ├─ Bayesian Likelihood Ratio & Homonym Disambiguation Matrix    │
│                 │      └─ Binary Merkle Tree Root Verifier + STIX 2.1 Bundle Exporter  │
└─────────────────┴──────────────────────────────────────────────────────────────────────┘
```

### New Pure Mathematical & Algorithmic Engines (`src/utils/`)
- **Spatial & Solar Ephemeris (`solarMath.ts`)**:
  - `solveBlindSolarCoordinates(dateIso, utcHour, measuredElevationDeg, measuredShadowAzimuthDeg)` — computes the geographic subsolar point $(\phi_s, \lambda_s)$ and solves the spherical trigonometry triangle for the exact candidate `(lat, lon)` on Earth where the sun has that elevation and azimuth at that UTC timestamp!
  - `buildOverpassIntersectionQuery(constraints, centerLat, centerLon, searchRadiusMeters)` — generates a chained Overpass QL spatial intersection script finding candidate structures that satisfy multiple proximity conditions simultaneously.
- **Graph Analytics & Threat Fuzzing (`osintForensics.ts`)**:
  - `analyzeCorporateGraphTopology(entities, edges)` — computes multi-hop Effective Beneficial Ownership percentages ($E_{\text{eff}}$), identifies circular ownership loops via depth-first cycle detection, and ranks high-centrality conduit nodes.
  - `generateDnsTwistPermutations(domain)` — produces homograph, vowel-swap, transposition, bitsquatting, hyphenation, and TLD lookalike candidates for live DoH probing.
  - `detectCopyMoveClones(imageData, width, height)` & `computeRgbHistogram(imageData)` — fast block-matching clone vector detector and 256-bin RGB/Luminance distribution analyzer.
  - `computeMerkleRoot(ledgerEntries)` & `exportStix21Bundle(activeCase)` — builds a cryptographic binary Merkle root over all evidence blocks and serializes entities, infrastructure indicators, and relationships into a standard OASIS **STIX 2.1 JSON Bundle**.
