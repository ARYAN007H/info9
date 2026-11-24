import type { InvestigationCase, ModuleId } from '../types/osint';

export type TimelineSourceKind =
  | 'domain_registration'
  | 'infra_scan'
  | 'ledger_entry'
  | 'web_capture'
  | 'social_activity'
  | 'social_created'
  | 'media_exif'
  | 'weather_date';

export interface UnifiedTimelineEvent {
  id: string;
  timestampUtc: string;
  epochMs: number;
  kind: TimelineSourceKind;
  module: ModuleId;
  title: string;
  detail: string;
  source: string;
  pivotValue?: string;
}

export interface BehavioralHeatmapResult {
  /** 7 rows (0=Sun..6=Sat) x 24 columns (0..23 UTC) */
  matrix: number[][];
  hourlyTotals: number[];
  weekdayTotals: number[];
  maxCellCount: number;
  totalEvents: number;
  /** Longest quiet contiguous UTC block (inferred sleep trough) */
  sleepWindowUtc: { startHour: number; endHour: number; lengthHours: number } | null;
  /** Peak active UTC hour (0..23) */
  peakUtcHour: number | null;
  /** Inferred UTC offset (assuming typical local sleep center at 04:00 local) */
  inferredUtcOffsetHours: number | null;
  inferredTimezoneLabel: string;
}

function parseTimestampSafe(raw: string | null | undefined): {
  iso: string;
  epochMs: number;
} | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Normalize "YYYY-MM-DD HH:mm:ss UTC" or "YYYY-MM-DD"
  let candidate = trimmed;
  if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    candidate = `${candidate}T00:00:00Z`;
  } else if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?\s*UTC$/i.test(candidate)) {
    candidate = candidate.replace(/\s+/, 'T').replace(/\s*UTC$/i, 'Z');
  }

  const ms = Date.parse(candidate);
  if (!Number.isFinite(ms)) return null;
  return { iso: new Date(ms).toISOString(), epochMs: ms };
}

/**
 * Aggregates every timestamped artifact across all modules of an InvestigationCase
 * into a single chronological master timeline.
 */
export function buildUnifiedTimeline(
  activeCase: InvestigationCase
): UnifiedTimelineEvent[] {
  const events: UnifiedTimelineEvent[] = [];

  // 1. Infrastructure domain registrations & scan timestamps
  for (const rec of activeCase.infraRecords) {
    const regTs = parseTimestampSafe(rec.createdAt);
    if (regTs) {
      events.push({
        id: `tl-dom-reg-${rec.id}`,
        timestampUtc: regTs.iso,
        epochMs: regTs.epochMs,
        kind: 'domain_registration',
        module: 'infra',
        title: `Domain registered: ${rec.domain}`,
        detail: `Registrar: ${rec.registrar ?? 'unavailable'} · Primary IP: ${rec.aRecords[0] ?? 'none'} (${rec.asnOrg ?? 'ASN unknown'})`,
        source: 'RDAP Registration',
        pivotValue: rec.domain,
      });
    }
    const scanTs = parseTimestampSafe(rec.provenance?.fetchedAtUtc);
    if (scanTs) {
      events.push({
        id: `tl-dom-scan-${rec.id}`,
        timestampUtc: scanTs.iso,
        epochMs: scanTs.epochMs,
        kind: 'infra_scan',
        module: 'infra',
        title: `Passive infra scan: ${rec.domain}`,
        detail: `${rec.ctSubdomainsCount} CT subdomains · Risk ${rec.riskAssessment.score}/100`,
        source: rec.provenance.source,
        pivotValue: rec.domain,
      });
    }
  }

  // 2. Evidence Ledger entries
  for (const entry of activeCase.evidenceLedger) {
    const ts = parseTimestampSafe(entry.timestampUtc);
    if (!ts) continue;
    events.push({
      id: `tl-led-${entry.id}`,
      timestampUtc: ts.iso,
      epochMs: ts.epochMs,
      kind: 'ledger_entry',
      module: entry.module,
      title: `Ledger #${entry.index}: ${entry.targetLabel}`,
      detail: entry.findingSummary,
      source: entry.sourceUrl || 'Evidence Ledger',
    });
  }

  // 3. Collected & extracted Web Hunter pages
  for (const page of activeCase.collectedPages ?? []) {
    const ts = parseTimestampSafe(page.fetchedAtUtc);
    if (!ts) continue;
    events.push({
      id: `tl-web-${page.id}`,
      timestampUtc: ts.iso,
      epochMs: ts.epochMs,
      kind: 'web_capture',
      module: 'webhunter',
      title: `Captured page: ${page.title || page.domain}`,
      detail: `${page.url} · ${page.artifacts.emails.length} email(s), ${page.artifacts.analyticsIds.length} tracker(s), SHA-256 ${page.sha256.slice(0, 12)}…`,
      source: 'Web Hunter Extractor',
      pivotValue: page.domain,
    });
  }

  // 4. Enriched social profiles (account creation + all post/commit activity timestamps)
  for (const prof of activeCase.enrichedProfiles ?? []) {
    const createdTs = parseTimestampSafe(prof.createdAtUtc);
    if (createdTs) {
      events.push({
        id: `tl-prof-created-${prof.platform}-${prof.handle}`,
        timestampUtc: createdTs.iso,
        epochMs: createdTs.epochMs,
        kind: 'social_created',
        module: 'identity',
        title: `${prof.platform} account created: @${prof.handle}`,
        detail: [prof.displayName, prof.location, prof.company].filter(Boolean).join(' · ') || prof.profileUrl,
        source: prof.provenance.source,
        pivotValue: `@${prof.handle}`,
      });
    }
    prof.activityTimestampsUtc.forEach((rawTs, idx) => {
      const ts = parseTimestampSafe(rawTs);
      if (!ts) return;
      events.push({
        id: `tl-prof-act-${prof.platform}-${prof.handle}-${idx}`,
        timestampUtc: ts.iso,
        epochMs: ts.epochMs,
        kind: 'social_activity',
        module: 'identity',
        title: `${prof.platform} activity by @${prof.handle}`,
        detail: `Public commit/post timestamp observed on ${prof.platform}`,
        source: prof.provenance.source,
        pivotValue: `@${prof.handle}`,
      });
    });
  }

  // 5. Media Forensics EXIF timestamps
  for (const sample of activeCase.forensicSamples) {
    const ts = parseTimestampSafe(sample.claimedDateUtc);
    if (!ts) continue;
    events.push({
      id: `tl-media-${sample.id}`,
      timestampUtc: ts.iso,
      epochMs: ts.epochMs,
      kind: 'media_exif',
      module: 'forensics',
      title: `Media artifact: ${sample.title}`,
      detail: `Claimed location: ${sample.claimedLocation} · dHash ${sample.dHashHex}`,
      source: 'Media Forensics Lab',
    });
  }

  // 6. Geolocation weather verification date
  if (activeCase.geoState.weatherVerification) {
    const w = activeCase.geoState.weatherVerification;
    const ts = parseTimestampSafe(w.date);
    if (ts) {
      events.push({
        id: `tl-geo-weather-${w.date}`,
        timestampUtc: ts.iso,
        epochMs: ts.epochMs,
        kind: 'weather_date',
        module: 'geolocation',
        title: `Weather & shadow check: ${activeCase.geoState.locationLabel}`,
        detail: `${w.shadowPlausibility} · Cloud cover ${w.cloudCoverMeanPercent}% · Temp ${w.minTempC}–${w.maxTempC}°C`,
        source: w.provenance.source,
        pivotValue: `${activeCase.geoState.lat}, ${activeCase.geoState.lon}`,
      });
    }
  }

  events.sort((a, b) => b.epochMs - a.epochMs);
  return events;
}

/**
 * Builds a 7x24 (Day-of-Week x Hour-of-Day UTC) behavioral activity heatmap
 * and infers the subject's probable sleep window & UTC timezone offset.
 */
export function buildBehavioralHeatmap(
  timestampsUtc: string[]
): BehavioralHeatmapResult {
  const matrix: number[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => 0)
  );
  const hourlyTotals = Array.from({ length: 24 }, () => 0);
  const weekdayTotals = Array.from({ length: 7 }, () => 0);

  let totalEvents = 0;
  let maxCellCount = 0;

  for (const raw of timestampsUtc) {
    const parsed = parseTimestampSafe(raw);
    if (!parsed) continue;
    const d = new Date(parsed.epochMs);
    const dow = d.getUTCDay(); // 0=Sun..6=Sat
    const hour = d.getUTCHours(); // 0..23
    matrix[dow][hour] += 1;
    hourlyTotals[hour] += 1;
    weekdayTotals[dow] += 1;
    totalEvents += 1;
    if (matrix[dow][hour] > maxCellCount) {
      maxCellCount = matrix[dow][hour];
    }
  }

  if (totalEvents === 0) {
    return {
      matrix,
      hourlyTotals,
      weekdayTotals,
      maxCellCount: 0,
      totalEvents: 0,
      sleepWindowUtc: null,
      peakUtcHour: null,
      inferredUtcOffsetHours: null,
      inferredTimezoneLabel: 'Insufficient timestamped activity',
    };
  }

  // Peak hour
  let peakUtcHour = 0;
  for (let h = 1; h < 24; h++) {
    if (hourlyTotals[h] > hourlyTotals[peakUtcHour]) peakUtcHour = h;
  }

  // Find minimum-activity 7-hour sliding window across the circular 24-hour clock
  // to robustly locate the sleep trough even with occasional noise.
  const WINDOW = 7;
  let bestStart = 0;
  let bestSum = Infinity;
  for (let start = 0; start < 24; start++) {
    let sum = 0;
    for (let k = 0; k < WINDOW; k++) {
      sum += hourlyTotals[(start + k) % 24];
    }
    if (sum < bestSum) {
      bestSum = sum;
      bestStart = start;
    }
  }
  const endHour = (bestStart + WINDOW) % 24;
  // Center of inferred sleep window in UTC
  const sleepCenterUtc = (bestStart + WINDOW / 2) % 24;
  // Assume average human sleep midpoint is ~04:00 local time -> local = utc + offset => offset = 4 - sleepCenterUtc
  let offset = Math.round(4 - sleepCenterUtc);
  while (offset > 12) offset -= 24;
  while (offset < -12) offset += 24;

  const sign = offset >= 0 ? '+' : '';
  const regionHint =
    offset >= -8 && offset <= -4
      ? 'Americas (UTC-8 to UTC-4)'
      : offset >= -1 && offset <= 3
      ? 'Europe / Africa / Middle East (UTC-1 to UTC+3)'
      : offset >= 4 && offset <= 10
      ? 'Asia / Oceania (UTC+4 to UTC+10)'
      : 'Pacific / Atlantic belt';

  return {
    matrix,
    hourlyTotals,
    weekdayTotals,
    maxCellCount,
    totalEvents,
    sleepWindowUtc: {
      startHour: bestStart,
      endHour,
      lengthHours: WINDOW,
    },
    peakUtcHour,
    inferredUtcOffsetHours: offset,
    inferredTimezoneLabel:
      totalEvents >= 4
        ? `Estimated UTC${sign}${offset} (${regionHint})`
        : `Low sample (${totalEvents} pts) — tentative UTC${sign}${offset}`,
  };
}
