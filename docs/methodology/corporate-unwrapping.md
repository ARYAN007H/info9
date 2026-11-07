# Methodology: Corporate Unwrapping

Module: **02 Dossier** · Code: `src/utils/osintForensics.ts` (graph topology), `src/services/osintApis.ts` (GLEIF transforms) · Tests: `src/utils/osintCore.test.ts`

## Data sources

| Source | What it gives | Key |
|---|---|---|
| **GLEIF** | Legal-entity records + Level-2 direct/ultimate-parent relationships | LEI |
| **Wikidata** | Knowledge-graph entities (people, companies, vessels) | QID |
| **OpenAlex** | Research institutions and their publication/citation footprint | ROR |

## Ownership-chain unwrapping

The 1-click parent transform queries GLEIF's `/lei-records/{lei}/ultimate-parent` endpoint. When a parent exists, the discovered entity and the ownership edge are added to the graph with the official relationship record as the verified source. When none exists — standalone entity or reporting exception — the transform returns `found: false` with the reason.

**There is no "unwrap" of last resort.** Earlier prototypes invented a placeholder BVI holding entity when the registry had nothing; that generator was deleted and replaced with a regression test asserting that a failed lookup can never produce a fabricated owner. A missing parent is an *answer*, not an error to paper over.

## Graph topology analytics

`analyzeCorporateGraphTopology` computes over the saved entity/edge graph:

1. **Effective equity** — multiplicative ownership along paths: 80% × 50% = 40% effective equity of the leaf company (`E_eff = Π p_i`). Every multi-hop path is enumerated and reported.
2. **Circular ownership detection** — Tarjan's strongly-connected-components algorithm finds cycles (A→B→C→A), the shell-company hallmark.
3. **Offshore-conduit flags** — edges whose intermediate jurisdiction is a known secrecy haven (VG, KY, MH, CY, PA) are flagged *as a data point*, not a judgement.

All three are pure functions over the case graph with tests covering the equity math and the cycle detection.

## References

- GLEIF API (Level 1 / Level 2 relationship records) — https://api.gleif.org/
- ICIJ Offshore Leaks database (manual follow-up) — https://offshoreleaks.icij.org/
- Tarjan SCC — https://en.wikipedia.org/wiki/Tarjan%27s_strongly_connected_components_algorithm
- OpenCorporates (manual pivot) — https://opencorporates.com/
