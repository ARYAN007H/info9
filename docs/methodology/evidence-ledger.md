# Methodology: Evidence Ledger & Export Formats

All modules · Code: `src/utils/osintForensics.ts` (ledger, STIX, MISP), `src/utils/reportGenerator.ts` (dossier) · Tests: `src/utils/osintCore.test.ts`, `src/utils/mispExport.test.ts`, `src/utils/reportGenerator.test.ts`

## The hash chain

Every finding saved anywhere on the bench becomes a ledger entry:

```
entry_i.sha256 = SHA-256( index ‖ timestampUtc ‖ module ‖ target ‖ finding ‖ sourceUrl ‖ entry_{i-1}.sha256 )
```

- The first entry chains from a fixed genesis constant, so the chain verifies even at length 1.
- `verifyEvidenceLedgerChain` recomputes every link and reports `isValid` plus the exact tampered index — editing one summary after the fact breaks the chain from that point forward, visibly.
- `computeMerkleRoot` folds all entry hashes into a single root for spot-verification.
- The dossier header prints the verification status and the Merkle root, so a PDF report is self-certifying.

## Export formats

| Export | Where | What it contains |
|---|---|---|
| **Markdown dossier** | Evidence drawer | All case sections with SHA-256 receipts per finding |
| **PDF dossier** | Evidence drawer → "PDF report" | Print-optimized, self-contained HTML through the browser's print pipeline; provenance badges, named gaps, methodology citations, ledger table |
| **STIX 2.1 bundle** | Watchlist module | Indicators for every saved artifact, OpenCTI-compatible |
| **MISP 2.4 event** | Evidence drawer → "MISP" | Attributes built **only from recorded artifacts** (ip-dst, domain, text) with deterministic UUIDs |

The MISP/STIX exports never invent indicators: an attribute exists only if the analyst saved the underlying record.

## Provenance vocabulary (used across every export)

- **LIVE** — returned by the named upstream for this exact query.
- **DERIVED** — computed locally from live inputs (risk scores, solar windows, similarity matches).
- **NO DATA** — upstream failed or was never queried; rendered as an explicit gap, never substituted.

## References

- STIX 2.1 spec — https://oasis-open.github.io/cti-documentation/stix/stix_2_1/overview
- MISP core format — https://www.misp-project.org/datamodel/
- Merkle tree — https://en.wikipedia.org/wiki/Merkle_tree
