import { GoogleGenAI, Type } from '@google/genai';
import type { InvestigationCase, ProvenanceMeta } from '../types/osint';

export type CopilotMode = 'ner_extract' | 'ach_matrix' | 'next_pivots' | 'briefing_qa';

export interface CopilotAnalysisRequest {
  mode: CopilotMode;
  caseData: InvestigationCase;
  question?: string;
  rawText?: string;
}

export interface CopilotAnalysisResponse {
  mode: CopilotMode;
  model: string;
  provenance: ProvenanceMeta;
  summary: string;
  nerEntities?: Array<{
    label: string;
    type: string;
    verbatimQuote: string;
    sourceRef: string;
  }>;
  nerRelationships?: Array<{
    source: string;
    target: string;
    relation: string;
    verbatimQuote: string;
  }>;
  achHypotheses?: Array<{
    hypothesis: string;
    likelihood: 'HIGH' | 'MEDIUM' | 'LOW';
    supportingEvidence: string[];
    contradictingEvidence: string[];
    missingEvidenceGaps: string[];
  }>;
  recommendedPivots?: Array<{
    title: string;
    rationale: string;
    moduleId: string;
    targetValue: string;
    priority: 'HIGH' | 'MEDIUM' | 'LOW';
  }>;
  answer?: string;
  citations?: string[];
}

function getGenAiClient(): { ai: GoogleGenAI; model: string } | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  const model = process.env.GEMINI_MODEL?.trim() || 'gemini-4-hydrogen';
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
  return { ai, model };
}

function findVerbatimSnippet(source: string, needle: string): string {
  const idx = source.toLowerCase().indexOf(needle.toLowerCase());
  if (idx === -1) return needle;
  const start = Math.max(0, idx - 36);
  const end = Math.min(source.length, idx + needle.length + 44);
  return source.slice(start, end).replace(/\s+/g, ' ').trim();
}

/**
 * Deterministic, zero-key Evidence-Grounded Synthesis Engine.
 * Runs locally with zero external API keys and strictly derives every claim,
 * verbatim quote, hypothesis, and follow-up pivot from the recorded case artifacts
 * (and optional analyst-submitted document text). Never invents facts.
 */
export function runLocalEvidenceAnalysis(
  req: CopilotAnalysisRequest
): CopilotAnalysisResponse {
  const c = req.caseData;
  const fetchedAtUtc = new Date().toISOString();
  const model = 'local-evidence-engine (zero-key)';
  const provenance: ProvenanceMeta = {
    status: 'DERIVED',
    source: 'info9 Local Evidence Synthesis Engine',
    fetchedAtUtc,
    note: 'Deterministic synthesis derived strictly from recorded case artifacts (zero-key). Set GEMINI_API_KEY on the server to upgrade to Gemini reasoning.',
  };

  const pages = c.collectedPages ?? [];
  const profiles = c.enrichedProfiles ?? [];
  const totalArtifacts =
    c.entities.length +
    c.infraRecords.length +
    pages.length +
    profiles.length +
    c.evidenceLedger.length;

  if (req.mode === 'ner_extract') {
    const nerEntities: NonNullable<CopilotAnalysisResponse['nerEntities']> = [];
    const nerRelationships: NonNullable<CopilotAnalysisResponse['nerRelationships']> = [];
    const seen = new Set<string>();

    const pushEntity = (
      label: string,
      type: string,
      verbatimQuote: string,
      sourceRef: string
    ) => {
      const key = `${type}:${label.toLowerCase()}`;
      if (seen.has(key) || !label.trim()) return;
      seen.add(key);
      nerEntities.push({ label: label.trim(), type, verbatimQuote, sourceRef });
    };

    const scanTextBlock = (text: string, sourceRef: string) => {
      if (!text.trim()) return;
      const emailMatches = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? [];
      for (const em of emailMatches.slice(0, 8)) {
        pushEntity(em, 'email', findVerbatimSnippet(text, em), sourceRef);
      }

      const btcMatches = text.match(/\b(?:bc1[a-z0-9]{25,59}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/g) ?? [];
      for (const w of btcMatches.slice(0, 5)) {
        pushEntity(w, 'wallet', findVerbatimSnippet(text, w), sourceRef);
      }

      const ethMatches = text.match(/\b0x[a-fA-F0-9]{40}\b/g) ?? [];
      for (const w of ethMatches.slice(0, 5)) {
        pushEntity(w, 'wallet', findVerbatimSnippet(text, w), sourceRef);
      }

      const ipMatches = text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? [];
      for (const ip of ipMatches.slice(0, 6)) {
        pushEntity(ip, 'ip', findVerbatimSnippet(text, ip), sourceRef);
      }

      const domainMatches = text.match(/\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|org|net|io|gov|edu|uk|de|fr|nl|ch|sg|ai|co|ru|cn|info|biz)\b/gi) ?? [];
      for (const dom of domainMatches.slice(0, 8)) {
        if (!text.toLowerCase().includes(`@${dom.toLowerCase()}`)) {
          pushEntity(dom.toLowerCase(), 'domain', findVerbatimSnippet(text, dom), sourceRef);
        }
      }

      const handleMatches = text.match(/(?:^|\s)@([a-zA-Z0-9_.-]{3,30})\b/g) ?? [];
      for (const rawH of handleMatches.slice(0, 6)) {
        const h = rawH.trim();
        pushEntity(h, 'handle', findVerbatimSnippet(text, h), sourceRef);
      }

      const orgMatches =
        text.match(
          /\b[A-Z][A-Za-z0-9&.-]+(?:\s+[A-Z][A-Za-z0-9&.-]+){0,3}\s+(?:Ltd|LLC|Inc|Corp|GmbH|AG|SA|NV|BV|Holdings|Group|Foundation|Bank|Trust)\b/g
        ) ?? [];
      for (const org of orgMatches.slice(0, 6)) {
        pushEntity(org, 'company', findVerbatimSnippet(text, org), sourceRef);
      }
    };

    if (req.rawText?.trim()) {
      scanTextBlock(req.rawText.trim(), 'Analyst Submitted Excerpt');
    }

    for (const pg of pages.slice(0, 6)) {
      const ref = `Archived Page: ${pg.domain}`;
      for (const em of pg.artifacts.emails.slice(0, 4)) {
        pushEntity(em, 'email', findVerbatimSnippet(pg.excerpt || em, em), ref);
      }
      for (const w of pg.artifacts.cryptoWallets.slice(0, 3)) {
        pushEntity(w.address, 'wallet', findVerbatimSnippet(pg.excerpt || w.address, w.address), ref);
      }
      scanTextBlock(`${pg.title}. ${pg.excerpt}`, ref);
    }

    for (const p of profiles.slice(0, 8)) {
      const ref = `${p.platform} @${p.handle}`;
      if (p.displayName) {
        pushEntity(p.displayName, 'person', `${p.displayName} (@${p.handle} on ${p.platform})`, ref);
        nerRelationships.push({
          source: `@${p.handle}`,
          target: p.displayName,
          relation: `profile display name on ${p.platform}`,
          verbatimQuote: `${p.platform} @${p.handle}: ${p.displayName}`,
        });
      }
      for (const em of p.discoveredEmails.slice(0, 3)) {
        pushEntity(em, 'email', `${em} (public commit / profile email on ${p.platform})`, ref);
        nerRelationships.push({
          source: `@${p.handle}`,
          target: em,
          relation: 'discovered email',
          verbatimQuote: `${p.platform} @${p.handle} -> ${em}`,
        });
      }
    }

    for (const r of c.infraRecords.slice(0, 6)) {
      const ref = `Infra Scan: ${r.domain}`;
      pushEntity(r.domain, 'domain', `Domain ${r.domain} resolved to ${r.aRecords.join(', ') || 'no IPv4'}`, ref);
      if (r.aRecords[0]) {
        pushEntity(r.aRecords[0], 'ip', `${r.domain} A record ${r.aRecords[0]}`, ref);
        nerRelationships.push({
          source: r.domain,
          target: r.aRecords[0],
          relation: 'resolves to IPv4',
          verbatimQuote: `${r.domain} -> ${r.aRecords[0]} (${r.asnOrg ?? 'ASN unknown'})`,
        });
      }
    }

    for (const l of c.evidenceLedger.slice(-10)) {
      scanTextBlock(`${l.targetLabel}: ${l.findingSummary}`, `Ledger #${l.index}`);
    }

    return {
      mode: 'ner_extract',
      model,
      provenance,
      summary:
        nerEntities.length > 0
          ? `Extracted ${nerEntities.length} verbatim-cited entity reference(s) and ${nerRelationships.length} link(s) across ${req.rawText?.trim() ? 'submitted text and ' : ''}recorded case artifacts.`
          : 'No extractable entities found in the active case yet. Paste a document excerpt above or commit findings from Web Hunter, Identity, Infra, or Dossier first.',
      nerEntities: nerEntities.slice(0, 20),
      nerRelationships: nerRelationships.slice(0, 15),
    };
  }

  if (req.mode === 'ach_matrix') {
    const hypotheses: NonNullable<CopilotAnalysisResponse['achHypotheses']> = [];
    const allGaps = c.infraRecords.flatMap((r) =>
      r.dataGaps.map((g) => `${r.domain}: ${g}`)
    );

    const highRiskDomains = c.infraRecords.filter((r) => r.riskAssessment.score >= 55);
    const sharedAsns = new Map<string, string[]>();
    for (const r of c.infraRecords) {
      if (r.asn) {
        const list = sharedAsns.get(r.asn) ?? [];
        list.push(r.domain);
        sharedAsns.set(r.asn, list);
      }
    }
    const multiDomainAsns = Array.from(sharedAsns.entries()).filter(([, doms]) => doms.length > 1);

    if (c.infraRecords.length > 0 || pages.length > 0) {
      const supporting: string[] = [];
      const contradicting: string[] = [];
      const missing: string[] = [];

      if (multiDomainAsns.length > 0) {
        supporting.push(
          ...multiDomainAsns.map(([asn, doms]) => `Shared hosting ASN ${asn} observed across ${doms.join(', ')}`)
        );
      }
      if (highRiskDomains.length > 0) {
        supporting.push(
          ...highRiskDomains.map(
            (r) => `${r.domain} elevated risk score (${r.riskAssessment.score}/100; registrar=${r.registrar ?? 'unknown'})`
          )
        );
      }
      const trackers = pages.flatMap((p) => p.artifacts.analyticsIds.map((a) => `${a.id} on ${p.domain}`));
      if (trackers.length > 0) {
        supporting.push(`Tracking identifiers extracted: ${trackers.slice(0, 4).join(', ')}`);
      }
      if (supporting.length === 0) {
        supporting.push(
          `Infrastructure scanned (${c.infraRecords.map((r) => r.domain).join(', ') || pages.map((p) => p.domain).join(', ')}) shows baseline public configuration.`
        );
      }

      const establishedDomains = c.infraRecords.filter(
        (r) => r.riskAssessment.score < 35 && r.dmarcPolicy
      );
      if (establishedDomains.length > 0) {
        contradicting.push(
          ...establishedDomains.map(
            (r) => `${r.domain} has low risk score (${r.riskAssessment.score}/100) and enforced DMARC/email controls.`
          )
        );
      } else {
        contradicting.push('Shared cloud/CDN ASNs (e.g. Cloudflare, AWS) are common among unrelated organizations.');
      }

      if (allGaps.length > 0) {
        missing.push(...allGaps.slice(0, 3));
      }
      missing.push('Corroborate whether domains share unique favicon hashes, TLS certs, or analytics IDs rather than generic CDN IPs.');

      hypotheses.push({
        hypothesis: 'Scanned web infrastructure reflects coordinated or shared-operator hosting',
        likelihood: multiDomainAsns.length > 0 || trackers.length > 1 || highRiskDomains.length > 0 ? 'MEDIUM' : 'LOW',
        supportingEvidence: supporting,
        contradictingEvidence: contradicting,
        missingEvidenceGaps: missing,
      });
    }

    if (profiles.length > 0 || c.entities.length > 0) {
      const emails = Array.from(new Set(profiles.flatMap((p) => p.discoveredEmails)));
      const platforms = Array.from(new Set(profiles.map((p) => p.platform)));
      const supporting: string[] = [];
      if (profiles.length > 0) {
        supporting.push(
          `${profiles.length} enriched account(s) captured across ${platforms.join(', ')}`
        );
      }
      if (emails.length > 0) {
        supporting.push(`Public commit / profile emails recovered: ${emails.slice(0, 4).join(', ')}`);
      }
      if (c.entities.length > 0) {
        supporting.push(
          `${c.entities.length} dossier entity record(s) and ${c.ownershipEdges.length} ownership link(s) recorded`
        );
      }

      hypotheses.push({
        hypothesis: 'Recorded accounts and dossier entities belong to a single attributable operator or corporate group',
        likelihood: emails.length > 0 || c.ownershipEdges.length > 0 ? 'HIGH' : 'MEDIUM',
        supportingEvidence: supporting,
        contradictingEvidence: [
          'Identical usernames across platforms can represent unrelated squatters or name collisions unless linked by email, PGP key, avatar, or verified domain.',
        ],
        missingEvidenceGaps: [
          profiles.length > 0
            ? 'Cross-check activity timestamps in Module 11 (Timeline) and avatar similarity in Module 08 (Face Recon).'
            : 'Enrich discovered handles in Module 05 (Identity) to recover real names, commit emails, and linked domains.',
          'Screen all legal names and affiliates against live OFAC SDN & OpenSanctions in Module 07 (Watchlist).',
        ],
      });
    }

    hypotheses.push({
      hypothesis: 'Null hypothesis — observed signals are coincidental or public-infrastructure noise',
      likelihood: totalArtifacts < 3 ? 'HIGH' : 'LOW',
      supportingEvidence:
        totalArtifacts < 3
          ? [`Only ${totalArtifacts} recorded artifact(s) in the case so far; insufficient independent corroboration.`]
          : ['Public cloud/CDN reuse and generic directory hits require secondary corroboration before attribution.'],
      contradictingEvidence:
        c.evidenceLedger.length > 0
          ? [`${c.evidenceLedger.length} hash-chained ledger block(s) already log specific live-verified observations.`]
          : ['No ledger entries committed yet to test against the null hypothesis.'],
      missingEvidenceGaps: [
        'Collect at least two independent primary-source artifacts (e.g. corporate registry + technical fingerprint + archived page SHA-256) before concluding.',
      ],
    });

    return {
      mode: 'ach_matrix',
      model,
      provenance,
      summary: `Generated ${hypotheses.length} falsifiable ACH hypotheses from ${c.entities.length} entities, ${c.infraRecords.length} infra scans, ${profiles.length} enriched profiles, ${pages.length} archived pages, and ${c.evidenceLedger.length} ledger blocks.`,
      achHypotheses: hypotheses,
    };
  }

  if (req.mode === 'next_pivots') {
    const pivots: NonNullable<CopilotAnalysisResponse['recommendedPivots']> = [];
    const seenTargets = new Set<string>();
    const addPivot = (
      title: string,
      rationale: string,
      moduleId: string,
      targetValue: string,
      priority: 'HIGH' | 'MEDIUM' | 'LOW'
    ) => {
      const k = `${moduleId}:${targetValue.toLowerCase()}`;
      if (seenTargets.has(k) || !targetValue.trim()) return;
      seenTargets.add(k);
      pivots.push({ title, rationale, moduleId, targetValue: targetValue.trim(), priority });
    };

    for (const r of c.infraRecords.slice(0, 2)) {
      addPivot(
        `Recursive multi-hop spider on ${r.domain}`,
        `Expand A-records (${r.aRecords[0] ?? 'pending'}), URLScan co-hosted domains, and OTX passive DNS automatically.`,
        'investigate',
        r.domain,
        'HIGH'
      );
      addPivot(
        `Open-web & dork sweep for ${r.domain}`,
        'Search GDELT news, Common Crawl CDX, Reddit, GitHub code, and exposed document dorks referencing this domain.',
        'webhunter',
        r.domain,
        'MEDIUM'
      );
    }

    for (const p of profiles.slice(0, 2)) {
      for (const em of p.discoveredEmails.slice(0, 1)) {
        addPivot(
          `Deep email recon on ${em}`,
          `Check Gravatar JSON, OpenPGP, ProtonMail HKP creation timestamp, and XposedOrNot breaches for email recovered from ${p.platform}.`,
          'identity',
          em,
          'HIGH'
        );
      }
      if (p.websiteUrl) {
        try {
          const dom = new URL(p.websiteUrl.startsWith('http') ? p.websiteUrl : `https://${p.websiteUrl}`).hostname;
          if (dom) {
            addPivot(
              `Scan linked domain ${dom}`,
              `Run passive DNS, RDAP, Shodan InternetDB, and favicon attribution on website listed in @${p.handle}'s bio.`,
              'infra',
              dom,
              'HIGH'
            );
          }
        } catch {
          // ignore malformed url
        }
      }
    }

    for (const pg of pages.slice(0, 2)) {
      for (const w of pg.artifacts.cryptoWallets.slice(0, 1)) {
        addPivot(
          `Trace & OFAC-screen wallet ${w.address.slice(0, 14)}…`,
          `Wallet extracted from archived page ${pg.domain}; check balance, counterparties, and OFAC SDN match.`,
          'sanctions',
          w.address,
          'HIGH'
        );
      }
      for (const em of pg.artifacts.emails.slice(0, 1)) {
        addPivot(
          `Investigate extracted email ${em}`,
          `Email harvested from ${pg.url}; pivot to Gravatar, PGP keys, breach history, and GitHub commits.`,
          'identity',
          em,
          'HIGH'
        );
      }
    }

    for (const ent of c.entities.slice(0, 2)) {
      addPivot(
        `Screen "${ent.label}" in Watchlist & OFAC`,
        `Cross-check ${ent.label} (${ent.jurisdiction}) against live Treasury OFAC SDN and OpenSanctions.`,
        'sanctions',
        ent.label,
        'HIGH'
      );
      addPivot(
        `Search SEC EDGAR, Courts & Offshore Leaks for "${ent.label}"`,
        `Check federal filings, CourtListener dockets, and ICIJ Panama/Pandora disclosures.`,
        'dossier',
        ent.label,
        'MEDIUM'
      );
    }

    if (pivots.length === 0) {
      addPivot(
        'Run open-web discovery on your primary subject',
        'Start in Web Hunter to search GDELT, Reddit, HN, Bluesky, GitHub, and Common Crawl.',
        'webhunter',
        c.title || 'example.com',
        'HIGH'
      );
      addPivot(
        'Launch a Depth-2 recursive spider',
        'Seed a domain, IP, email, or handle in Pivot Console to build the entity graph automatically.',
        'investigate',
        'cloudflare.com',
        'MEDIUM'
      );
      addPivot(
        'Verify coordinates & landmarks on the map',
        'Anchor your case geographically with Nominatim, Overpass QL, and solar chronolocation.',
        'geolocation',
        `${c.geoState.lat.toFixed(4)},${c.geoState.lon.toFixed(4)}`,
        'LOW'
      );
    }

    return {
      mode: 'next_pivots',
      model,
      provenance,
      summary: `Identified ${pivots.length} grounded follow-up pivot(s) mapped directly to info9 modules from your recorded case artifacts.`,
      recommendedPivots: pivots.slice(0, 6),
    };
  }

  // briefing_qa
  const q = (req.question || '').trim();
  const qTokens = q
    .toLowerCase()
    .split(/[^a-z0-9@._-]+/)
    .filter((t) => t.length >= 3);

  const citations: string[] = [];
  const findings: string[] = [];

  for (const e of c.entities) {
    const blob = `${e.label} ${e.identifier} ${e.jurisdiction} ${e.summary}`.toLowerCase();
    if (qTokens.length === 0 || qTokens.some((t) => blob.includes(t))) {
      findings.push(`Entity: ${e.label} (${e.type}, ${e.jurisdiction}, ${e.identifier}) — ${e.summary}`);
      citations.push(`Entity: ${e.label}`);
    }
  }
  for (const r of c.infraRecords) {
    const blob = `${r.domain} ${r.aRecords.join(' ')} ${r.asnOrg ?? ''} ${r.registrar ?? ''}`.toLowerCase();
    if (qTokens.length === 0 || qTokens.some((t) => blob.includes(t))) {
      findings.push(
        `Domain ${r.domain}: IP=${r.aRecords.join(', ') || 'none'}, ASN=${r.asn ?? 'unknown'} (${r.asnOrg ?? 'unknown'}), Risk=${r.riskAssessment.score}/100${r.dataGaps.length ? `, Gaps=${r.dataGaps.join('; ')}` : ''}`
      );
      citations.push(`Infra: ${r.domain}`);
    }
  }
  for (const p of profiles) {
    const blob = `${p.platform} ${p.handle} ${p.displayName ?? ''} ${p.bio ?? ''} ${p.discoveredEmails.join(' ')}`.toLowerCase();
    if (qTokens.length === 0 || qTokens.some((t) => blob.includes(t))) {
      findings.push(
        `Profile ${p.platform} @${p.handle}: name=${p.displayName ?? 'n/a'}, emails=[${p.discoveredEmails.join(', ') || 'none'}], loc=${p.location ?? 'n/a'}`
      );
      citations.push(`Profile: ${p.platform} @${p.handle}`);
    }
  }
  for (const pg of pages) {
    const blob = `${pg.url} ${pg.title} ${pg.excerpt}`.toLowerCase();
    if (qTokens.length === 0 || qTokens.some((t) => blob.includes(t))) {
      findings.push(
        `Archived Page ${pg.url} (SHA-256 ${pg.sha256.slice(0, 12)}): "${pg.title}" — ${pg.artifacts.emails.length} email(s), ${pg.artifacts.cryptoWallets.length} wallet(s), ${pg.artifacts.analyticsIds.length} tracker(s).`
      );
      citations.push(`Page: ${pg.domain} (${pg.sha256.slice(0, 8)})`);
    }
  }
  for (const l of c.evidenceLedger.slice(-15)) {
    const blob = `${l.module} ${l.targetLabel} ${l.findingSummary}`.toLowerCase();
    if (qTokens.length === 0 || qTokens.some((t) => blob.includes(t))) {
      findings.push(`Ledger #${l.index} [${l.module}] ${l.targetLabel}: ${l.findingSummary}`);
      citations.push(`Ledger #${l.index}`);
    }
  }

  const answerLines: string[] = [];
  if (findings.length > 0) {
    answerLines.push(
      `Case "${c.title}" (${c.codeName}) currently contains ${c.entities.length} saved entities, ${c.infraRecords.length} scanned domains, ${profiles.length} enriched profiles, ${pages.length} archived pages, and ${c.evidenceLedger.length} hash-chained ledger entries.`
    );
    answerLines.push('');
    answerLines.push('Grounded Evidence Matching Your Query:');
    for (const f of findings.slice(0, 10)) {
      answerLines.push(`• ${f}`);
    }
  } else {
    answerLines.push(
      `No recorded artifacts in "${c.title}" directly matched "${q || 'your query'}".`
    );
    answerLines.push(
      `Currently indexed: ${c.entities.length} entities, ${c.infraRecords.length} infra scans, ${profiles.length} enriched profiles, ${pages.length} archived pages, and ${c.evidenceLedger.length} ledger blocks.`
    );
    answerLines.push(
      'Missing verification: run live collection in Web Hunter (10), Identity (05), Infrastructure (03), or Dossier (02) and commit findings to the case before re-running this briefing.'
    );
  }

  const uniqueCitations = Array.from(new Set(citations)).slice(0, 12);
  return {
    mode: 'briefing_qa',
    model,
    provenance,
    summary: `Briefing synthesized strictly from ${totalArtifacts} recorded case artifact(s) with ${uniqueCitations.length} citation(s).`,
    answer: answerLines.join('\n'),
    citations: uniqueCitations,
  };
}

function serializeCaseEvidenceContext(c: InvestigationCase, rawText?: string): string {
  const lines: string[] = [];
  lines.push(`CASE: ${c.codeName} — ${c.title} (${c.classification})`);
  lines.push(`SUMMARY: ${c.summary}`);

  if (c.entities.length > 0) {
    lines.push('\n[SAVED ENTITIES]');
    for (const e of c.entities.slice(0, 25)) {
      lines.push(`- ${e.label} (${e.type}, ${e.jurisdiction}, ${e.identifier}): ${e.summary}`);
    }
  }
  if (c.ownershipEdges.length > 0) {
    lines.push('\n[OWNERSHIP LINKS]');
    for (const edge of c.ownershipEdges.slice(0, 25)) {
      lines.push(
        `- ${edge.sourceId} -> ${edge.targetId}: ${edge.relationship} (${edge.ownershipPercent ?? '?'}%) [source: ${edge.verifiedSource}]`
      );
    }
  }
  if (c.infraRecords.length > 0) {
    lines.push('\n[INFRASTRUCTURE RECORDS]');
    for (const r of c.infraRecords.slice(0, 20)) {
      lines.push(
        `- Domain ${r.domain}: A=[${r.aRecords.join(',')}] ASN=${r.asn ?? 'unknown'} (${r.asnOrg ?? 'unknown'}) Registrar=${r.registrar ?? 'unknown'} Created=${r.createdAt ?? 'unknown'} Risk=${r.riskAssessment.score}/100 CT_Subs=${r.ctSubdomainsCount} DataGaps=[${r.dataGaps.join('; ')}]`
      );
    }
  }
  if ((c.enrichedProfiles ?? []).length > 0) {
    lines.push('\n[ENRICHED PROFILES]');
    for (const p of (c.enrichedProfiles ?? []).slice(0, 15)) {
      lines.push(
        `- ${p.platform} @${p.handle}: name=${p.displayName ?? 'n/a'} loc=${p.location ?? 'n/a'} company=${p.company ?? 'n/a'} emails=[${p.discoveredEmails.join(',')}] bio=${(p.bio ?? '').slice(0, 140)}`
      );
    }
  }
  if ((c.collectedPages ?? []).length > 0) {
    lines.push('\n[ARCHIVED WEB PAGES]');
    for (const pg of (c.collectedPages ?? []).slice(0, 10)) {
      lines.push(
        `- URL ${pg.url} (SHA-256 ${pg.sha256.slice(0, 12)}): title="${pg.title}" emails=[${pg.artifacts.emails.join(',')}] wallets=[${pg.artifacts.cryptoWallets.map((w) => w.address).join(',')}] trackers=[${pg.artifacts.analyticsIds.map((t) => t.id).join(',')}] excerpt="${pg.excerpt.slice(0, 280)}"`
      );
    }
  }
  if (c.evidenceLedger.length > 0) {
    lines.push('\n[HASH-CHAINED EVIDENCE LEDGER]');
    for (const l of c.evidenceLedger.slice(-25)) {
      lines.push(
        `- Ledger #${l.index} [${l.module}] (${l.timestampUtc}) ${l.targetLabel}: ${l.findingSummary} (source: ${l.sourceUrl})`
      );
    }
  }
  if (rawText?.trim()) {
    lines.push('\n[ANALYST-SUBMITTED DOCUMENT TEXT]');
    lines.push(rawText.trim().slice(0, 12_000));
  }

  return lines.join('\n').slice(0, 28_000);
}

/**
 * Runs Evidence-Grounded AI Analyst Copilot analysis.
 * Uses @google/genai when GEMINI_API_KEY is configured on the server; otherwise
 * serves deterministic zero-key local evidence synthesis seamlessly.
 */
export async function runEvidenceCopilotAnalysis(
  req: CopilotAnalysisRequest
): Promise<CopilotAnalysisResponse> {
  const client = getGenAiClient();
  if (!client) {
    return runLocalEvidenceAnalysis(req);
  }
  const { ai, model } = client;
  const context = serializeCaseEvidenceContext(req.caseData, req.rawText);
  const fetchedAtUtc = new Date().toISOString();
  const provenance: ProvenanceMeta = {
    status: 'DERIVED',
    source: `Gemini Case Analyst Copilot (${model})`,
    fetchedAtUtc,
    note: 'AI analytical synthesis derived strictly from recorded case evidence. Verify before publishing.',
  };

  if (req.mode === 'ner_extract') {
    const resp = await ai.models.generateContent({
      model,
      contents: `You are a forensic OSINT intelligence analyst. Extract all verifiable entities (person, company, domain, email, location, wallet, handle) and relationships from the evidence below.
CRITICAL RULE: Every extracted entity and relationship MUST include an exact verbatimQuote copied directly from the provided evidence text. Never invent facts not in the evidence.

EVIDENCE:
${context}`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            nerEntities: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  label: { type: Type.STRING },
                  type: { type: Type.STRING },
                  verbatimQuote: { type: Type.STRING },
                  sourceRef: { type: Type.STRING },
                },
                required: ['label', 'type', 'verbatimQuote', 'sourceRef'],
              },
            },
            nerRelationships: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  source: { type: Type.STRING },
                  target: { type: Type.STRING },
                  relation: { type: Type.STRING },
                  verbatimQuote: { type: Type.STRING },
                },
                required: ['source', 'target', 'relation', 'verbatimQuote'],
              },
            },
          },
          required: ['summary', 'nerEntities', 'nerRelationships'],
        },
      },
    });
    const parsed = JSON.parse(resp.text || '{}') as Partial<CopilotAnalysisResponse>;
    return {
      mode: 'ner_extract',
      model,
      provenance,
      summary: parsed.summary || 'Entity & relationship extraction complete.',
      nerEntities: parsed.nerEntities ?? [],
      nerRelationships: parsed.nerRelationships ?? [],
    };
  }

  if (req.mode === 'ach_matrix') {
    const resp = await ai.models.generateContent({
      model,
      contents: `You are an intelligence analyst trained in Richards Heuer's Analysis of Competing Hypotheses (ACH).
Evaluate the recorded OSINT case evidence below and generate 2 to 4 distinct, falsifiable competing hypotheses.
For each hypothesis, explicitly cite supporting evidence from the case, contradicting or anomalous evidence, and missing evidence gaps that would disconfirm it. Never fabricate evidence.

EVIDENCE:
${context}`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            achHypotheses: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  hypothesis: { type: Type.STRING },
                  likelihood: { type: Type.STRING, enum: ['HIGH', 'MEDIUM', 'LOW'] },
                  supportingEvidence: { type: Type.ARRAY, items: { type: Type.STRING } },
                  contradictingEvidence: { type: Type.ARRAY, items: { type: Type.STRING } },
                  missingEvidenceGaps: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: [
                  'hypothesis',
                  'likelihood',
                  'supportingEvidence',
                  'contradictingEvidence',
                  'missingEvidenceGaps',
                ],
              },
            },
          },
          required: ['summary', 'achHypotheses'],
        },
      },
    });
    const parsed = JSON.parse(resp.text || '{}') as Partial<CopilotAnalysisResponse>;
    return {
      mode: 'ach_matrix',
      model,
      provenance,
      summary: parsed.summary || 'Analysis of Competing Hypotheses generated.',
      achHypotheses: parsed.achHypotheses ?? [],
    };
  }

  if (req.mode === 'next_pivots') {
    const resp = await ai.models.generateContent({
      model,
      contents: `You are a senior Bellingcat-style open-source investigator.
Review the recorded case artifacts below and recommend the 4 to 6 highest-yield next investigative pivots using available info9 modules:
- webhunter (open web search, dorks, page extractor)
- dossier (GLEIF, SEC EDGAR, CourtListener, ICIJ, maritime vessels)
- infra (passive DNS, Shodan, URLScan reverse-IP, OTX, favicon hash)
- identity (username sweep, profile enrichment, email PGP/breach, phone dorks)
- sanctions (OFAC SDN, OpenSanctions, crypto wallet trace)
- geolocation (coordinates, Overpass landmarks, shadow chronolocation)
- investigate (recursive multi-hop spider)
Only propose targetValue strings that are grounded in the case evidence.

EVIDENCE:
${context}`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            recommendedPivots: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  rationale: { type: Type.STRING },
                  moduleId: { type: Type.STRING },
                  targetValue: { type: Type.STRING },
                  priority: { type: Type.STRING, enum: ['HIGH', 'MEDIUM', 'LOW'] },
                },
                required: ['title', 'rationale', 'moduleId', 'targetValue', 'priority'],
              },
            },
          },
          required: ['summary', 'recommendedPivots'],
        },
      },
    });
    const parsed = JSON.parse(resp.text || '{}') as Partial<CopilotAnalysisResponse>;
    return {
      mode: 'next_pivots',
      model,
      provenance,
      summary: parsed.summary || 'Next-pivot investigation plan ready.',
      recommendedPivots: parsed.recommendedPivots ?? [],
    };
  }

  // Grounded Evidence Briefing Q&A
  const question =
    req.question?.trim() ||
    'Summarize the strongest verified links, key intelligence gaps, and timeline anomalies in this case.';
  const resp = await ai.models.generateContent({
    model,
    contents: `You are an evidence-grounded OSINT case analyst. Answer the analyst's question strictly using ONLY the recorded case evidence below.
If the evidence does not contain the answer, explicitly state what is missing rather than guessing.
List exact citations (ledger index, domain name, entity ID, or archived URL).

QUESTION: ${question}

EVIDENCE:
${context}`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          answer: { type: Type.STRING },
          citations: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['summary', 'answer', 'citations'],
      },
    },
  });
  const parsed = JSON.parse(resp.text || '{}') as Partial<CopilotAnalysisResponse>;
  return {
    mode: 'briefing_qa',
    model,
    provenance,
    summary: parsed.summary || 'Grounded briefing generated.',
    answer: parsed.answer || '',
    citations: parsed.citations ?? [],
  };
}
