# Contributing to info9

Thanks for your interest in making info9 sharper. This document gets you from clone to merged PR.

## Development setup

```bash
git clone https://github.com/ARYAN007H/info9.git
cd info9
npm install       # Node.js >= 22 required
npm run dev       # dev server on http://localhost:3000
```

Before opening a PR, make sure all three gates pass locally (CI runs the same):

```bash
npm run typecheck
npm test
npm run build
```

## Where things live

| Path | What it is |
|---|---|
| `src/utils/` | **The core.** Pure, dependency-free TypeScript (solar math, forensics, clustering, ledger). Every function here should have unit tests in `node:test`. |
| `src/services/osintApis.ts` | Client-side calls to public data sources. |
| `src/components/` | One React component per workbench module. |
| `server.ts` | Express proxy for upstreams that browsers can't call directly, plus production static serving. |

## Ground rules

1. **No paid or key-gated APIs.** A contribution that requires an API key to function will not be merged. Free-tier-with-key sources may be discussed in an issue first.
2. **No fabricated data.** If an upstream call fails, surface the failure. Never substitute plausible-looking placeholder values for real lookups — this is an intelligence tool and fabricated output is worse than no output.
3. **Prove the math.** New geometry, matching, clustering, or ledger logic ships with `node:test` cases, including edge cases.
4. **Respect upstream policies.** Honor rate limits; route browser-hostile upstreams through `server.ts` with a descriptive User-Agent.
5. **Match the house style.** TypeScript strict-ish, no new heavy dependencies without an issue discussion.

## Adding a data source (connector)

Until the formal connector SDK lands (roadmap Phase 2), follow the existing pattern in `src/services/osintApis.ts`:

- one exported async function per source,
- explicit TypeScript return types (no `any`),
- a documented upstream URL and its policy in a doc comment,
- errors that propagate — never silently defaulted.

## Commit style

Conventional Commits: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`. Keep commits atomic.

## Reporting issues

Use the issue templates. For security-sensitive matters (anything that could be a vulnerability in the proxy server or data handling), follow [SECURITY.md](SECURITY.md) instead of a public issue.

## Licensing

By contributing you agree that your contributions are licensed under the AGPL-3.0-or-later license of this repository.
