# Methodology: Infrastructure Recon

Module: **03 Infrastructure** · Code: `src/services/osintApis.ts`, `src/utils/osintForensics.ts`, `src/utils/riskScore.ts` · Tests: `src/utils/osintCore.test.ts`, `src/utils/riskScore.test.ts`

## Passive-only discipline

Every probe in this module is **passive**: we query third-party databases that have already observed the target. info9 never port-scans, never touches the target's servers, and never sends traffic the target can attribute to the analyst. Sources:

| Signal | Source | Why it's passive |
|---|---|---|
| DNS records (A/AAAA/MX/NS/TXT/CAA/DMARC) | Cloudflare DNS-over-HTTPS | Public zone data |
| Registration date & registrar | RDAP (rdap.org bootstrap) | Public registry data |
| Subdomains & issuing CA | crt.sh (Certificate Transparency) | Public CT logs |
| Open ports, software, CVEs | Shodan InternetDB | Shodan's prior scan archive |
| BGP origin, ASN holder | RIPEstat | Public routing data |
| Public scan history | urlscan.io public search | Community-submitted scans |
| Archival appearances | Wayback CDX | Internet Archive |

## The transparent risk rule table

`computeDomainRiskScore` is a **fully disclosed additive heuristic** — the UI renders every contributing factor next to the score, and the constants live in one tested function:

| Rule | Points | Rationale |
|---|---|---|
| Registered < 30 days | +35 | Fresh registrations dominate phishing/malware infrastructure |
| Registered < 180 days | +18 | Young domains warrant scrutiny |
| No DMARC | +20 | Receivers cannot block spoofed mail from the domain |
| No SPF | +10 | SMTP envelope sender unconstrained |
| No CAA | +5 | Any CA may issue certificates |
| CVEs on exposed services | +6 each, cap +18 | Known-vulnerable software reachable from the internet |

Score is clamped to 0–100. **It is a triage aid, not a verdict.** Missing inputs (unknown registration date, unknown exposure) add zero points but are listed as factors so the analyst sees what the number *doesn't* know.

## Typosquat permutation fuzzer

`generateDnsTwistPermutations` produces homograph (Unicode look-alikes), transposition, vowel-swap, hyphenation, bitsquatting and TLD-swap candidates (DNSTwist's model). Each candidate is then resolved through DoH — only *registered, resolving* lookalikes are surfaced, sorted by registration status and similarity.

## Clustering

`clusterInfrastructureDomains` links scanned domains that share a BGP ASN, nameservers, a TLS issuer, or lexical shingles — the standard coordinated-infrastructure discovery pattern. Signals are emitted per pair so the analyst can audit every link.

## Fabrication policy

There is **none**. A failed RDAP lookup yields `registrar: null` and a named data gap — never a placeholder registrar, never a default date. Ports are shown only when Shodan actually returned them.

## References

- Shodan InternetDB — https://internetdb.shodan.io/
- RIPEstat Data API — https://stat.ripe.net/docs/02.data-api/
- DNSTwist (original tool) — https://github.com/elceef/dnstwist
- Certificate Transparency at crt.sh — https://crt.sh/
- RDAP bootstrap — https://rdap.org
