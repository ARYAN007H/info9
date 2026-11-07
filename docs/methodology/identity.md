# Methodology: Identity Resolution (Username Sweep)

Module: **05 Identity** · Code: `src/utils/wnn.ts`, `src/services/usernameSweep.ts`, `server.ts` (`/api/osint/wnn/*`) · Tests: `src/utils/wnn.test.ts`

## What it does

Sweeps a handle across ~700 community-indexed sites using the free [WhatsMyName](https://github.com/WebBreacher/WhatsMyName) dataset (`wmn-data.json`, auto-loaded and cached). Each probe substitutes the handle into the site's profile-URL template and classifies the response:

- **FOUND** — HTTP status matches the dataset's expected code, the expected string is present, and the "missing" string is absent.
- **NOT_FOUND** — the dataset's missing-code/string matched, or a plain 404/410.
- **UNKNOWN** — everything else (bot walls, captchas, rate limits). Reported as unknown, **never silently counted as "not found"** — that honesty is the difference between a tool and a toy.

The UI shows a tri-count summary, streams progress, and offers a "open profile" link per hit for visual verification before anything is recorded.

## Trust boundaries (SSRF hardening)

Both the username (user input) and the probe URL (community dataset) are untrusted:

1. **Username allowlist** — `[\w.\-]{1,64}` only; path traversal, spaces, and control characters rejected.
2. **Scheme enforcement** — http(s) only.
3. **Private-network block** — localhost, 127.x, 10.x, 192.168.x, 172.16–31.x, 169.254.x (link-local) hosts are refused.
4. **Defense in depth** — the dataset normalizer drops private-host templates at load time, and the request builder re-validates after substitution.
5. **Bounded work** — per-request timeout, capped response body, bounded client concurrency.

## Ethics

- Only profile URLs are fetched — the same request a browser would make.
- Use for lawful investigation of accounts you are authorized to research; the responsible-use policy in the README governs.
- A "FOUND" is an *indicator*: handles get reused. Confirm bio/photos before attributing an account to a person.

## References

- WebBreacher's WhatsMyName project (dataset and detection model) — https://github.com/WebBreacher/WhatsMyName
- OWASP SSRF prevention cheat sheet — https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
