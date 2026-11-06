import type { ProvenanceMeta, ProvenanceStatus } from '../types/osint';

/**
 * Provenance is the core evidentiary primitive of info9: every intelligence
 * value must be traceable to the source that produced it and the moment it
 * was fetched. A datum without provenance is not evidence and must never be
 * presented to an analyst as if it were.
 *
 * - LIVE       — returned by the named upstream for this exact query.
 * - DERIVED    — computed locally from LIVE inputs (e.g. a risk score whose
 *                factors are each shown to the analyst).
 * - UNAVAILABLE — the upstream failed or was never queried. No value is
 *                substituted. UI must render an explicit gap, never filler.
 */

export function makeLiveProvenance(
  source: string,
  nowIso: string = new Date().toISOString()
): ProvenanceMeta {
  return { status: 'LIVE', source, fetchedAtUtc: nowIso };
}

export function makeDerivedProvenance(
  source: string,
  note: string,
  nowIso: string = new Date().toISOString()
): ProvenanceMeta {
  return { status: 'DERIVED', source, fetchedAtUtc: nowIso, note };
}

export function makeUnavailableProvenance(
  source: string,
  reason: string,
  nowIso: string = new Date().toISOString()
): ProvenanceMeta {
  return { status: 'UNAVAILABLE', source, fetchedAtUtc: nowIso, note: reason };
}

/** '2026-11-07T14:02:11.482Z' -> '2026-11-07 14:02 UTC' (lossy, for display). */
export function formatFetchedAt(isoUtc: string): string {
  const m = isoUtc.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]} UTC` : isoUtc;
}

/** One-line human-readable provenance string, e.g.
 *  'LIVE · Open-Meteo ERA5 Archive · 2026-11-07 14:02 UTC'. */
export function summarizeProvenance(meta: ProvenanceMeta): string {
  const parts = [meta.status, meta.source];
  if (meta.note) parts.push(meta.note);
  parts.push(formatFetchedAt(meta.fetchedAtUtc));
  return parts.join(' · ');
}

/**
 * True when a value marked with this provenance may be shown as fact.
 * UNAVAILABLE provenance must always render as an explicit gap in the UI.
 */
export function isVerifiable(meta: ProvenanceMeta): boolean {
  return meta.status !== 'UNAVAILABLE';
}

export type { ProvenanceStatus };
