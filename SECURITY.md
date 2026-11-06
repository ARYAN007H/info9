# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| `main` branch | ✅ |

info9 is a young project; security fixes land on `main` and are released promptly.

## Reporting a vulnerability

**Do not open a public issue for security vulnerabilities.**

Use GitHub's [private vulnerability reporting](https://github.com/ARYAN007H/info9/security/advisories/new) for this repository, or contact the maintainer directly. Include:

- affected component (proxy endpoints in `server.ts`, browser code, build),
- reproduction steps,
- impact assessment.

You can expect an initial response within 7 days. We will credit reporters in the release notes unless you prefer to remain anonymous.

## Scope notes specific to an OSINT tool

- **The proxy server (`server.ts`)** fetches arbitrary user-supplied IPs/domains/URLs against a fixed allowlist of upstream hosts. SSRF hardening is reviewed carefully — report anything that lets a request escape that allowlist.
- **This tool is not a weapon.** Reports about "the tool can be used to look up information about someone" are out of scope; that is its purpose, and the [responsible-use policy](README.md#responsible-use) governs it. Vulnerabilities in data *handling, storage, or the server* are in scope.
- Deployers who expose info9 publicly should put it behind their own auth and rate limiting; the bundled server assumes a trusted operator or private network.
