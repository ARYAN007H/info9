# Methodology: Sanctions & Watchlist Screening

Module: **07 Watchlist** · Code: `src/utils/osintForensics.ts` (scoring), `src/utils/sanctionsData.ts` (CSV parsing) · Tests: `src/utils/osintCore.test.ts`, `src/utils/sanctionsData.test.ts`

## Data sources

- **Live OFAC SDN list** — the U.S. Treasury's official Specially Designated Nationals CSV, downloaded server-side (free public data), parsed with a proper RFC-4180 CSV reader, and scored locally. ~19.5k records. DOBs are extracted from the free-text remarks column (`DOB 05 Jan 1968; …`), and only trusted when the remark is explicit or short enough to be unambiguous.
- **Bundled demo set** — five synthetic records so the matcher can be exercised offline. The UI labels them as synthetic everywhere; the live panel always shows the record count and fetch timestamp.

## Cross-script name matching

Sanctions lists mix scripts and transliteration styles. The matcher normalizes before comparing:

1. **Transliteration** — Cyrillic → Latin (`В → v`, `Ж → zh`, …), diacritic folding (NFD strip), punctuation removal (`transliterateAndNormalizeName`).
2. **Jaro–Winkler similarity** on the normalized names — robust to transpositions and prefix variants.
3. **Token-set similarity** — sorts name tokens so `MOROZOV, Viktor` matches `Viktor Morozov`.
4. **Soundex / phonetic skeleton** — catches `Morosov` vs `Morozov`.
5. **DOB and jurisdiction gates** — exact DOB match strongly raises the posterior; a conflicting DOB is the classic false-positive killer.

## The scoring model

`scoreSanctionsCandidate` combines the signals into a composite score with **analyst-adjustable weights** (default: name-phonetic 40, DOB-exact 30, jurisdiction 20, alias-overlap 10) and emits one of three dispositions:

- `CONFIRMED_TARGET` — high name similarity plus corroborating DOB/jurisdiction.
- `POTENTIAL_MATCH_REVIEW` — plausible but unconfirmed; human decides.
- `FALSE_POSITIVE_ELIMINATED` — a gate failed (e.g. different birth year).

The disposition thresholds are in code, disclosed in the UI, and covered by tests — the eliminator test asserts the *same name* with a different birth year is filtered while the true match confirms.

## Honest limitations

- The live panel parses the SDN list only — **aliases (`add.csv`) are not yet parsed**, so near-miss spellings that only appear as aliases can be missed. The UI says so, and recommends a manual check of the Treasury entry for high-stakes decisions.
- A high score is a **lead, not a determination**. Screening output must never be published as "X is sanctioned" without confirming the official record.
- The demo set is synthetic by construction; its results are for matcher evaluation only.

## References

- OFAC SDN human-readable lists — https://ofac.treasury.gov/specially-designated-nationals-and-blocked-persons-list-sdn-human-readable-lists
- Jaro–Winkler — https://en.wikipedia.org/wiki/Jaro%E2%80%93Winkler_similarity
- Soundex — https://en.wikipedia.org/wiki/Soundex
- OpenSanctions (planned live feed) — https://www.opensanctions.org/
