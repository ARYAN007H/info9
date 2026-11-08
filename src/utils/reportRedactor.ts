import type { InvestigationCase } from '../types/osint';

export interface RedactionConfig {
  redactEmails: boolean;
  redactPhones: boolean;
  redactIps: boolean;
  customTerms: string[];
  executiveNote: string;
}

const EMAIL_GLOBAL_RE = /\b[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}\b/g;
const IPV4_GLOBAL_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const PHONE_GLOBAL_RE = /(?:\+|00)\d[\d\s().-]{7,16}\d/g;

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Scrubs sensitive PII/indicators from a string according to `RedactionConfig`.
 */
export function redactText(text: string, config: RedactionConfig): string {
  if (!text) return text;
  let out = text;
  if (config.redactEmails) {
    out = out.replace(EMAIL_GLOBAL_RE, '[REDACTED-EMAIL]');
  }
  if (config.redactIps) {
    out = out.replace(IPV4_GLOBAL_RE, '[REDACTED-IP]');
  }
  if (config.redactPhones) {
    out = out.replace(PHONE_GLOBAL_RE, '[REDACTED-PHONE]');
  }
  for (const rawTerm of config.customTerms) {
    const term = rawTerm.trim();
    if (term.length >= 2) {
      const re = new RegExp(escapeRegExp(term), 'gi');
      out = out.replace(re, '[REDACTED]');
    }
  }
  return out;
}

/**
 * Returns a redacted clone of an InvestigationCase ready for printable PDF or
 * Markdown export without mutating the analyst's live workspace.
 */
export function buildRedactedCaseClone(
  activeCase: InvestigationCase,
  config: RedactionConfig
): InvestigationCase {
  const scrub = (s: string) => redactText(s, config);
  const baseSummary = scrub(activeCase.summary);
  const fullSummary = config.executiveNote.trim()
    ? `${scrub(config.executiveNote.trim())} — ${baseSummary}`
    : baseSummary;

  return {
    ...activeCase,
    title: scrub(activeCase.title),
    summary: fullSummary,
    geoState: {
      ...activeCase.geoState,
      locationLabel: scrub(activeCase.geoState.locationLabel),
    },
    entities: activeCase.entities.map((e) => ({
      ...e,
      label: scrub(e.label),
      identifier: scrub(e.identifier),
      summary: scrub(e.summary),
    })),
    infraRecords: activeCase.infraRecords.map((d) => ({
      ...d,
      domain: scrub(d.domain),
      aRecords: d.aRecords.map(scrub),
      asnOrg: d.asnOrg ? scrub(d.asnOrg) : null,
    })),
    evidenceLedger: activeCase.evidenceLedger.map((entry) => ({
      ...entry,
      targetLabel: scrub(entry.targetLabel),
      findingSummary: scrub(entry.findingSummary),
    })),
  };
}
