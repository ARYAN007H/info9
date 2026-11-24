import React, { useMemo, useState } from 'react';
import { Clock, Compass, Filter, Flame, Globe } from 'lucide-react';
import type { InvestigationCase, ModuleId } from '../types/osint';
import {
  buildBehavioralHeatmap,
  buildUnifiedTimeline,
  type TimelineSourceKind,
} from '../utils/timelineEngine';
import { Button, EmptyState, Panel, PivotChip, Well } from './ui';

interface TimelineHeatmapModuleProps {
  activeCase: InvestigationCase;
  onPivotToModule: (moduleId: ModuleId, targetValue: string, subMode?: string) => void;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

const KIND_LABELS: Record<TimelineSourceKind, string> = {
  domain_registration: 'Domain Reg',
  infra_scan: 'Infra Scan',
  ledger_entry: 'Ledger',
  web_capture: 'Web Capture',
  social_activity: 'Social Post/Commit',
  social_created: 'Account Created',
  media_exif: 'Media EXIF',
  weather_date: 'Weather Check',
};

export const TimelineHeatmapModule: React.FC<TimelineHeatmapModuleProps> = ({
  activeCase,
  onPivotToModule,
}) => {
  const [kindFilter, setKindFilter] = useState<TimelineSourceKind | 'ALL'>('ALL');
  const [profileFilter, setProfileFilter] = useState<string>('ALL');

  const allEvents = useMemo(() => buildUnifiedTimeline(activeCase), [activeCase]);

  const filteredEvents = useMemo(
    () =>
      kindFilter === 'ALL'
        ? allEvents
        : allEvents.filter((e) => e.kind === kindFilter),
    [allEvents, kindFilter]
  );

  const enrichedProfiles = activeCase.enrichedProfiles ?? [];

  const heatmapTimestamps = useMemo(() => {
    if (profileFilter !== 'ALL') {
      const target = enrichedProfiles.find(
        (p) => `${p.platform}:${p.handle}` === profileFilter
      );
      if (!target) return [];
      return [
        ...target.activityTimestampsUtc,
        ...(target.createdAtUtc ? [target.createdAtUtc] : []),
      ];
    }
    return allEvents.map((e) => e.timestampUtc);
  }, [allEvents, enrichedProfiles, profileFilter]);

  const heatmap = useMemo(
    () => buildBehavioralHeatmap(heatmapTimestamps),
    [heatmapTimestamps]
  );

  const cellColor = (count: number, max: number): string => {
    if (count === 0 || max === 0) return 'bg-well border-rule/60';
    const ratio = count / max;
    if (ratio >= 0.75) return 'bg-accent border-accent text-white';
    if (ratio >= 0.45) return 'bg-accent/65 border-accent/70 text-white';
    if (ratio >= 0.2) return 'bg-accent/35 border-accent/40 text-ink';
    return 'bg-accent/18 border-accent/25 text-ink';
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="signage text-[10px] font-semibold text-accent">11</span>
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">
              Unified Timeline &amp; Timezone Heatmap
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-muted">
            Master chronology and 24×7 UTC sleep-window estimator across all case artifacts.
          </p>
        </div>
        <div className="flex items-center gap-2 font-mono text-[11px] text-muted">
          <Clock className="w-3.5 h-3.5 text-accent" />
          <span className="tnum">{allEvents.length} timestamped artifact(s)</span>
        </div>
      </div>

      {/* BEHAVIORAL 24x7 UTC HEATMAP */}
      <Panel
        title="24×7 UTC Activity Heatmap"
        actions={
          enrichedProfiles.length > 0 ? (
            <div className="flex items-center gap-1.5">
              <label htmlFor="hm-profile-select" className="font-mono text-[10px] text-muted uppercase">
                Subject:
              </label>
              <select
                id="hm-profile-select"
                value={profileFilter}
                onChange={(e) => setProfileFilter(e.target.value)}
                className="px-2 py-1 rounded-[2px] border border-rule bg-surface text-xs text-ink font-mono"
              >
                <option value="ALL">All Case Artifacts ({allEvents.length})</option>
                {enrichedProfiles.map((p) => (
                  <option key={`${p.platform}:${p.handle}`} value={`${p.platform}:${p.handle}`}>
                    {p.platform} @{p.handle} ({p.activityTimestampsUtc.length} events)
                  </option>
                ))}
              </select>
            </div>
          ) : undefined
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Well className="p-2.5">
              <div className="font-mono text-[10px] uppercase text-muted flex items-center gap-1">
                <Globe className="w-3 h-3 text-accent" />
                Inferred Timezone Band
              </div>
              <div className="text-xs font-semibold text-ink mt-1">
                {heatmap.inferredTimezoneLabel}
              </div>
            </Well>
            <Well className="p-2.5">
              <div className="font-mono text-[10px] uppercase text-muted flex items-center gap-1">
                <Compass className="w-3 h-3 text-live" />
                Probable Sleep Trough (UTC)
              </div>
              <div className="font-mono text-xs font-semibold text-ink mt-1 tnum">
                {heatmap.sleepWindowUtc
                  ? `${String(heatmap.sleepWindowUtc.startHour).padStart(2, '0')}:00 – ${String(
                      heatmap.sleepWindowUtc.endHour
                    ).padStart(2, '0')}:00 UTC (${heatmap.sleepWindowUtc.lengthHours}h quiet)`
                  : 'No data yet'}
              </div>
            </Well>
            <Well className="p-2.5">
              <div className="font-mono text-[10px] uppercase text-muted flex items-center gap-1">
                <Flame className="w-3 h-3 text-derived" />
                Peak Active Hour (UTC)
              </div>
              <div className="font-mono text-xs font-semibold text-ink mt-1 tnum">
                {heatmap.peakUtcHour !== null
                  ? `${String(heatmap.peakUtcHour).padStart(2, '0')}:00 UTC (${heatmap.hourlyTotals[heatmap.peakUtcHour]} hits)`
                  : 'No data yet'}
              </div>
            </Well>
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[660px] space-y-1">
              <div className="grid grid-cols-[44px_repeat(24,minmax(0,1fr))] gap-1">
                <div className="font-mono text-[9px] text-muted uppercase self-end">UTC</div>
                {HOURS.map((hr) => (
                  <div
                    key={hr}
                    className="font-mono text-[9px] text-muted text-center tnum"
                  >
                    {String(hr).padStart(2, '0')}
                  </div>
                ))}
              </div>
              {WEEKDAYS.map((day, dow) => (
                <div
                  key={day}
                  className="grid grid-cols-[44px_repeat(24,minmax(0,1fr))] gap-1 items-center"
                >
                  <div className="font-mono text-[10px] text-muted">{day}</div>
                  {HOURS.map((hr) => {
                    const count = heatmap.matrix[dow][hr];
                    return (
                      <div
                        key={hr}
                        title={`${day} ${String(hr).padStart(2, '0')}:00 UTC — ${count} event(s)`}
                        className={`h-6 rounded-[2px] border flex items-center justify-center font-mono text-[9px] tnum ${cellColor(
                          count,
                          heatmap.maxCellCount
                        )}`}
                      >
                        {count > 0 ? count : ''}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {allEvents.length < 3 && (
            <p className="font-mono text-[10px] text-muted">
              Tip: Enrich a handle in Module 05 (Identity) and commit it to plot real commit/post timestamps here.
            </p>
          )}
        </div>
      </Panel>

      {/* MASTER CHRONOLOGICAL TIMELINE */}
      <Panel
        title={`Master Case Chronology (${filteredEvents.length})`}
        actions={
          <div className="flex flex-wrap items-center gap-1">
            <Filter className="w-3 h-3 text-muted mr-1" />
            <Button
              size="sm"
              variant={kindFilter === 'ALL' ? 'primary' : 'ghost'}
              onClick={() => setKindFilter('ALL')}
            >
              All
            </Button>
            {(Object.keys(KIND_LABELS) as TimelineSourceKind[]).map((k) => {
              const count = allEvents.filter((e) => e.kind === k).length;
              if (count === 0) return null;
              return (
                <Button
                  key={k}
                  size="sm"
                  variant={kindFilter === k ? 'primary' : 'ghost'}
                  onClick={() => setKindFilter(k)}
                >
                  {KIND_LABELS[k]} ({count})
                </Button>
              );
            })}
          </div>
        }
      >
        {filteredEvents.length === 0 ? (
          <EmptyState
            icon={<Clock className="w-5 h-5" />}
            title="No timestamped artifacts recorded in this case yet"
            body="Scan domains in Infra, enrich handles in Identity, capture pages in Web Hunter, or log evidence blocks to automatically populate the unified timeline."
          />
        ) : (
          <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
            {filteredEvents.map((ev) => (
              <Well
                key={ev.id}
                className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-l-2 border-l-accent"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[11px] font-semibold text-accent tnum">
                      {ev.timestampUtc.replace('T', ' ').slice(0, 19)} UTC
                    </span>
                    <span className="text-muted">·</span>
                    <span className="font-mono text-[10px] uppercase text-muted">
                      {KIND_LABELS[ev.kind]}
                    </span>
                    <span className="text-muted">·</span>
                    <span className="text-xs font-semibold text-ink">{ev.title}</span>
                  </div>
                  <div className="text-[11px] text-muted">{ev.detail}</div>
                  <div className="font-mono text-[10px] text-muted">Source: {ev.source}</div>
                </div>
                {ev.pivotValue && (
                  <div className="shrink-0">
                    <PivotChip
                      label={ev.pivotValue}
                      hint="Open Module"
                      onClick={() => onPivotToModule(ev.module, ev.pivotValue!)}
                    />
                  </div>
                )}
              </Well>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
};
