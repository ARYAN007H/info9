/**
 * Auto-link engine: mines everything already recorded in an InvestigationCase
 * for cross-module connections the analyst hasn't drawn yet, and proposes
 * typed graph edges with disclosed confidence.
 *
 * Design contract (matches the repo's evidentiary rules):
 *  - Deterministic: same case state → same suggestions, same ids.
 *  - Disclosed: every suggestion states exactly WHY (rationale carries the
 *    shared signal), and confidence is a labeled heuristic, never a verdict.
 *  - Reviewable: nothing enters the graph until the analyst accepts it;
 *    dismissals persist so a rejected hypothesis never nags again.
 *
 * Pure functions only — no network, no DOM.
 */

import type { InvestigationCase, OverpassLandmark } from '../types/osint';
import { jaroWinklerSimilarity } from './osintForensics';
import type { CaseGraphModel } from './caseGraph';

export type AutoLinkKind =
  | 'shared_host'
  | 'shared_asn'
  | 'ledger_domain'
  | 'ledger_location'
  | 'entity_brand_domain'
  | 'ledger_shared_signal'
  | 'similar_entity_names';

export interface AutoLinkSuggestion {
  /** Deterministic — persisted decisions survive re-computation. */
  id: string;
  kind: AutoLinkKind;
  /** "alpha-ship.com ↔ beta-tankers.com" style summary. */
  label: string;
  /** Disclosed reason: the shared signal itself, verbatim. */
  rationale: string;
  /** Labeled heuristic (see kind docs below) — triage signal, not proof. */
  confidence: number;
  /** Existing case-graph node ids (dom:, ip:, asn:, led:, ent:, coord:). */
  sourceNodeId: string;
  targetNodeId: string;
  /** Short label for the edge once accepted. */
  edgeLabel: string;
}

// ---------------------------------------------------------------------------
// Free-text signal extraction (ledger summaries, entity notes, source urls)
// ---------------------------------------------------------------------------

const FILE_EXT_DENYLIST = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'pdf', 'doc', 'docx', 'xls',
  'xlsx', 'csv', 'json', 'css', 'js', 'mjs', 'ts', 'tsx', 'html', 'htm',
  'mp4', 'mp3', 'wav', 'zip', 'gz', 'php', 'asp', 'aspx', 'jsp', 'cgi',
]);

const DOMAIN_RE = /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}\b/gi;
const IPV4_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const EMAIL_RE = /\b[a-z0-9._%+-]+@(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi;
const COORDS_RE = /(-?\d{1,2}\.\d{3,})[,\s\u00a0]+(-?\d{1,3}\.\d{3,})/g;

export function extractDomains(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.matchAll(DOMAIN_RE)) {
    const domain = raw[0].toLowerCase();
    const tld = domain.split('.').pop() as string;
    if (FILE_EXT_DENYLIST.has(tld)) continue;
    // version-like tokens (e.g. "3.2.1.test") and pure numerics are noise
    if (/^\d+\.\d+$/.test(domain)) continue;
    out.add(domain);
  }
  return [...out];
}

export function extractIps(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.matchAll(IPV4_RE)) {
    const octets = raw[0].split('.').map(Number);
    if (octets.every((o) => o >= 0 && o <= 255)) out.add(raw[0]);
  }
  return [...out];
}

export function extractEmails(text: string): string[] {
  return [...new Set((text.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()))];
}

export interface ExtractedCoord {
  lat: number;
  lon: number;
}

export function extractCoords(text: string): ExtractedCoord[] {
  const out: ExtractedCoord[] = [];
  for (const m of text.matchAll(COORDS_RE)) {
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat !== 0 || lon !== 0)) {
      out.push({ lat, lon });
    }
  }
  return out;
}

/** Lowercase [^a-z0-9]+ → space; drops jurisdiction suffixes like ltd/inc/gmbh. */
export function distinctiveNameTokens(label: string): string[] {
  const stop = new Set(['ltd', 'limited', 'llc', 'inc', 'gmbh', 'sa', 'nv', 'bv', 'ag', 'plc', 'the', 'and', 'co', 'corp', 'corporation', 'holdings', 'group']);
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length >= 4 && !stop.has(t));
}

/** FNV-1a 32-bit → 8-hex, for deterministic suggestion ids. */
export function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// Distance (same local-plane approximation the geo modules use)
// ---------------------------------------------------------------------------

const EARTH_R_M = 6_371_000;

export function approxDistanceMeters(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number
): number {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const latM = dLat * EARTH_R_M;
  const lonM = dLon * EARTH_R_M * Math.cos(((aLat + bLat) / 2) * (Math.PI) / 180);
  return Math.sqrt(latM * latM + lonM * lonM);
}

// ---------------------------------------------------------------------------
// The miner
// ---------------------------------------------------------------------------

/** Matches the node-id conventions of buildCaseInvestigationGraph. */
function graphIds(activeCase: InvestigationCase, graph: CaseGraphModel) {
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  // the graph renders only the last 8 ledger entries
  const ledgerNodes = new Map<string, string>(); // entryId → led node id
  for (const entry of activeCase.evidenceLedger.slice(-8)) {
    const id = `led:${entry.id}`;
    if (nodeIds.has(id)) ledgerNodes.set(entry.id, id);
  }
  const ledgerById = new Map(activeCase.evidenceLedger.map((e) => [e.id, e]));
  return { nodeIds, ledgerNodes, ledgerById };
}

function ledgerText(entry: { targetLabel: string; findingSummary: string; sourceUrl: string }): string {
  return `${entry.targetLabel} ${entry.findingSummary} ${entry.sourceUrl}`.toLowerCase();
}

const CONFIDENCE = {
  sharedHost: 0.95,
  sharedAsn: 0.6,
  ledgerDomain: 0.75,
  ledgerLocation: 0.8,
  entityBrand: 0.65,
  ledgerSharedSignal: 0.7,
  similarNamesMin: 0.55,
} as const;

/**
 * Proposes typed edges between nodes that already exist in the case graph.
 * Suggestions already accepted or dismissed stay out of the pending set.
 */
export function suggestAutoLinks(
  activeCase: InvestigationCase,
  graph: CaseGraphModel
): AutoLinkSuggestion[] {
  const { nodeIds, ledgerNodes, ledgerById } = graphIds(activeCase, graph);
  const suggestions: AutoLinkSuggestion[] = [];
  const seen = new Set<string>();

  const push = (s: Omit<AutoLinkSuggestion, 'id'> & { detail: string }) => {
    if (!nodeIds.has(s.sourceNodeId) || !nodeIds.has(s.targetNodeId)) return;
    if (s.sourceNodeId === s.targetNodeId) return;
    const key = `${s.kind}|${[s.sourceNodeId, s.targetNodeId].sort().join('~')}|${s.detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    suggestions.push({ ...s, id: shortHash(key) });
  };

  // 1. Two scanned domains resolving to the SAME IPv4 host — the classic
  //    infrastructure pivot the ring graph counts but never draws.
  for (let i = 0; i < activeCase.infraRecords.length; i++) {
    for (let j = i + 1; j < activeCase.infraRecords.length; j++) {
      const a = activeCase.infraRecords[i];
      const b = activeCase.infraRecords[j];
      const sharedIp = a.aRecords.find((ip) => b.aRecords.includes(ip));
      if (sharedIp) {
        push({
          kind: 'shared_host',
          detail: `ip:${sharedIp}`,
          label: `${a.domain} ↔ ${b.domain}`,
          rationale: `Both domains' A records resolve to ${sharedIp} — same server (exact match).`,
          confidence: CONFIDENCE.sharedHost,
          sourceNodeId: `dom:${a.domain}`,
          targetNodeId: `dom:${b.domain}`,
          edgeLabel: `same host ${sharedIp}`,
        });
      } else if (a.asn && a.asn === b.asn) {
        push({
          kind: 'shared_asn',
          detail: `asn:${a.asn}`,
          label: `${a.domain} ↔ ${b.domain}`,
          rationale: `Both announce from ${a.asn} (${a.asnOrg || 'unknown org'}) — shared network, weaker than an identical host.`,
          confidence: CONFIDENCE.sharedAsn,
          sourceNodeId: `dom:${a.domain}`,
          targetNodeId: `dom:${b.domain}`,
          edgeLabel: `same network ${a.asn}`,
        });
      }
    }
  }

  // 2. Ledger entries whose text mentions a scanned domain.
  const domainSet = new Set(activeCase.infraRecords.map((r) => r.domain.toLowerCase()));
  for (const [entryId, ledNodeId] of ledgerNodes) {
    const entry = ledgerById.get(entryId);
    if (!entry) continue;
    const text = ledgerText(entry);
    for (const domain of extractDomains(text)) {
      if (domainSet.has(domain)) {
        push({
          kind: 'ledger_domain',
          detail: domain,
          label: `#${entry.index} ${entry.targetLabel.slice(0, 24)} ↔ ${domain}`,
          rationale: `Ledger entry #${entry.index} (${entry.module.toUpperCase()}) references the scanned domain ${domain}.`,
          confidence: CONFIDENCE.ledgerDomain,
          sourceNodeId: ledNodeId,
          targetNodeId: `dom:${activeCase.infraRecords.find((r) => r.domain.toLowerCase() === domain)!.domain}`,
          edgeLabel: 'mentions domain',
        });
      }
    }
  }

  // 3. Ledger entries mentioning coordinates near the pinned location.
  const geo = activeCase.geoState;
  if (geo.locationLabel) {
    const coordNodeId = `coord:${geo.lat.toFixed(4)},${geo.lon.toFixed(4)}`;
    for (const [entryId, ledNodeId] of ledgerNodes) {
      const entry = ledgerById.get(entryId);
      if (!entry) continue;
      for (const coord of extractCoords(ledgerText(entry))) {
        const dist = approxDistanceMeters(coord.lat, coord.lon, geo.lat, geo.lon);
        if (dist <= 500) {
          push({
            kind: 'ledger_location',
            detail: `coord:${coord.lat.toFixed(4)},${coord.lon.toFixed(4)}`,
            label: `#${entry.index} ${entry.targetLabel.slice(0, 24)} ↔ pin`,
            rationale: `Ledger entry #${entry.index} cites coordinates ${coord.lat}, ${coord.lon} — ${Math.round(dist)} m from the pinned location.`,
            confidence: CONFIDENCE.ledgerLocation,
            sourceNodeId: ledNodeId,
            targetNodeId: coordNodeId,
            edgeLabel: `location ${Math.round(dist)} m`,
          });
          break;
        }
      }
    }
  }

  // 4. Entity name ↔ scanned domain (brand token in the domain or its TXT/SPF).
  for (const ent of activeCase.entities) {
    const tokens = distinctiveNameTokens(ent.label);
    if (tokens.length === 0) continue;
    // the most distinctive token is the longest one
    const token = tokens.sort((a, b) => b.length - a.length)[0];
    for (const rec of activeCase.infraRecords) {
      const haystacks = [
        rec.domain.toLowerCase(),
        ...rec.txtRecords.map((t) => t.toLowerCase()),
      ];
      if (haystacks.some((h) => h.includes(token))) {
        push({
          kind: 'entity_brand_domain',
          detail: `ent:${ent.id}|dom:${rec.domain}`,
          label: `${ent.label} ↔ ${rec.domain}`,
          rationale: `Entity name token “${token}” appears in ${rec.domain}${rec.txtRecords.length > 0 ? ' or its DNS TXT records' : ''}.`,
          confidence: CONFIDENCE.entityBrand,
          sourceNodeId: `ent:${ent.id}`,
          targetNodeId: `dom:${rec.domain}`,
          edgeLabel: 'brand match',
        });
      }
    }
  }

  // 5. Two ledger entries sharing the same signal (domain, IP, or email).
  const signalOwners = new Map<string, string[]>(); // signal → ledger node ids
  for (const [entryId, ledNodeId] of ledgerNodes) {
    const entry = ledgerById.get(entryId);
    if (!entry) continue;
    const text = ledgerText(entry);
    const signals = new Set<string>([
      ...extractDomains(text).filter((d) => !FILE_EXT_DENYLIST.has(d.split('.').pop() as string)),
      ...extractIps(text),
      ...extractEmails(text),
    ]);
    for (const sig of signals) {
      const owners = signalOwners.get(sig) ?? [];
      if (!owners.includes(ledNodeId)) owners.push(ledNodeId);
      signalOwners.set(sig, owners);
    }
  }
  for (const [signal, owners] of signalOwners) {
    for (let i = 0; i < owners.length; i++) {
      for (let j = i + 1; j < owners.length; j++) {
        const entryA = activeCase.evidenceLedger.find((e) => `led:${e.id}` === owners[i]);
        push({
          kind: 'ledger_shared_signal',
          detail: `${owners[i]}~${owners[j]}|${signal}`,
          label: `ledger #${entryA?.index ?? '?'} ↔ another entry`,
          rationale: `Both ledger entries reference ${signal}.`,
          confidence: CONFIDENCE.ledgerSharedSignal,
          sourceNodeId: owners[i],
          targetNodeId: owners[j],
          edgeLabel: `shared ${signal}`,
        });
      }
    }
  }

  // 6. Two entities with suspiciously similar names.
  for (let i = 0; i < activeCase.entities.length; i++) {
    for (let j = i + 1; j < activeCase.entities.length; j++) {
      const a = activeCase.entities[i];
      const b = activeCase.entities[j];
      const sim = jaroWinklerSimilarity(a.label, b.label);
      if (sim >= 0.85) {
        push({
          kind: 'similar_entity_names',
          detail: `ent:${a.id}|ent:${b.id}`,
          label: `${a.label} ↔ ${b.label}`,
          rationale: `Names score ${(sim * 100).toFixed(0)}% similar — possible same subject under a variant; verify before merging.`,
          confidence: Math.max(CONFIDENCE.similarNamesMin, sim),
          sourceNodeId: `ent:${a.id}`,
          targetNodeId: `ent:${b.id}`,
          edgeLabel: `name ${ (sim * 100).toFixed(0) }%`,
        });
      }
    }
  }

  return suggestions.sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id));
}

/** Pending = not yet accepted and not dismissed. */
export function pendingAutoLinks(
  suggestions: AutoLinkSuggestion[],
  decisions: InvestigationCase['autoLinkDecisions'] | undefined
): AutoLinkSuggestion[] {
  const accepted = new Set((decisions?.accepted ?? []).map((a) => a.id));
  const dismissed = new Set(decisions?.dismissedIds ?? []);
  return suggestions.filter((s) => !accepted.has(s.id) && !dismissed.has(s.id));
}

/** Landmark helper kept for future scene-match work (unused today). */
export function landmarkWithinRadius(
  landmarks: OverpassLandmark[],
  lat: number,
  lon: number,
  radiusM: number
): OverpassLandmark | null {
  for (const lm of landmarks) {
    if (approxDistanceMeters(lm.lat, lm.lon, lat, lon) <= radiusM) return lm;
  }
  return null;
}
