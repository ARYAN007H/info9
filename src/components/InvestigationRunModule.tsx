import React, { useEffect, useMemo, useState } from 'react';
import {
  BookmarkPlus,
  Loader2,
  Network,
  Play,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import type { InfraDomainRecord, InvestigationCase, ModuleId } from '../types/osint';
import type { EntityKind } from '../connectors/types';
import {
  CHAIN_RECIPES,
  runChain,
  type ChainRecipe,
  type ChainRun,
  type StepStatus,
} from '../core/pivotChains';
import { listConnectors } from '../connectors';
import type { SmartRouteAction } from '../utils/smartIntake';
import type { AutoLinkSuggestion } from '../utils/autoLinks';
import ProvenanceBadge from './ProvenanceBadge';
import { CaseGraphView } from './CaseGraphView';
import { Button, NoticeBanner, Panel, PivotChip, SegmentedTabs } from './ui';

interface InvestigationRunModuleProps {
  activeCase: InvestigationCase;
  onAddInfraRecord: (record: InfraDomainRecord) => void;
  onAppendLedger: (entry: {
    module: 'dossier';
    targetLabel: string;
    findingSummary: string;
    sourceUrl: string;
    snapshotDataUrl?: string;
  }) => void;
  initialTarget?: string;
  initialKind?: EntityKind;
  onRouteSmartClue?: (action: SmartRouteAction) => void;
  onSelectModule?: (moduleId: ModuleId) => void;
  onAcceptAutoLink?: (suggestion: AutoLinkSuggestion) => void;
  onDismissAutoLink?: (id: string) => void;
}

const STATUS_STYLES: Record<StepStatus, { chip: string; label: string }> = {
  ok: {
    chip: 'border-live/35 bg-live/10 text-live',
    label: 'OK',
  },
  empty: {
    chip: 'border-line bg-well text-ink-3',
    label: 'empty',
  },
  error: {
    chip: 'border-danger/40 bg-danger/10 text-danger',
    label: 'failed',
  },
  skipped: {
    chip: 'border-line bg-well text-ink-3',
    label: 'skipped',
  },
};

const KIND_OPTIONS: Array<{ id: EntityKind; label: string }> = [
  { id: 'domain', label: 'Domain' },
  { id: 'ip', label: 'IP address' },
  { id: 'place', label: 'Place' },
  { id: 'entity-name', label: 'Entity / handle' },
];

export function InvestigationRunModule({
  activeCase,
  onAddInfraRecord,
  onAppendLedger,
  initialTarget,
  initialKind,
  onRouteSmartClue,
  onSelectModule,
  onAcceptAutoLink,
  onDismissAutoLink,
}: InvestigationRunModuleProps) {
  const [viewMode, setViewMode] = useState<'chains' | 'graph'>('chains');
  const [inputKind, setInputKind] = useState<EntityKind>(
    initialKind || 'domain'
  );
  const [target, setTarget] = useState(initialTarget || '');
  const [isRunning, setIsRunning] = useState(false);
  const [run, setRun] = useState<ChainRun | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  useEffect(() => {
    if (initialTarget) setTarget(initialTarget);
    if (initialKind) setInputKind(initialKind);
  }, [initialTarget, initialKind]);

  const recipe: ChainRecipe = useMemo(() => {
    return (
      CHAIN_RECIPES.find((r) => r.inputKind === inputKind) ?? CHAIN_RECIPES[0]
    );
  }, [inputKind]);

  const registry = useMemo(() => {
    const map: Record<string, { id: string; run: (t: string) => Promise<unknown> }> =
      {};
    for (const c of listConnectors()) map[c.id] = c;
    return map as never;
  }, []);

  const handleRun = async () => {
    const cleaned = target.trim();
    if (!cleaned || isRunning) return;
    setIsRunning(true);
    setRun(null);
    setSavedNote(null);
    try {
      const result = await runChain(recipe, cleaned, registry);
      setRun(result);
    } finally {
      setIsRunning(false);
    }
  };

  const domainRecord = useMemo(() => {
    if (!run) return null;
    const step = run.steps.find(
      (s) => s.connectorId === 'domain-recon' && s.status === 'ok'
    );
    return (step?.data as InfraDomainRecord | undefined) ?? null;
  }, [run]);

  const okCount = run?.steps.filter((s) => s.status === 'ok').length ?? 0;
  const gapCount =
    run?.steps.reduce(
      (sum, s) => sum + s.dataGaps.length + (s.error ? 1 : 0),
      0
    ) ?? 0;

  const handleSaveDomainRecord = () => {
    if (!domainRecord) return;
    onAddInfraRecord(domainRecord);
    setSavedNote(
      `Saved ${domainRecord.domain} to the case's Infrastructure records.`
    );
  };

  const handleSaveRunToLedger = () => {
    if (!run) return;
    const lines = run.steps
      .map((s) => `${s.label}: ${s.status.toUpperCase()} — ${s.summary}`)
      .join('; ');
    onAppendLedger({
      module: 'dossier',
      targetLabel: `Pivot chain (${recipe.title}): ${run.target}`,
      findingSummary: `Automated run — ${okCount}/${run.steps.length} steps returned data. ${lines}`,
      sourceUrl: 'info9 pivot chain (multi-source)',
    });
    setSavedNote(
      'Run summary appended to the evidence ledger with a fresh chain hash.'
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedTabs
          ariaLabel="Pivot console view mode"
          tabs={[
            { id: 'chains', label: '1. Automated Pivot Chains' },
            { id: 'graph', label: '2. Interactive Case Link Graph' },
          ]}
          active={viewMode}
          onChange={(id) => setViewMode(id)}
        />
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-ink-3">
          <Network className="h-3.5 w-3.5 text-accent" />
          Click any emitted chip to pivot across instruments
        </span>
      </div>

      {viewMode === 'graph' ? (
        <CaseGraphView
          activeCase={activeCase}
          onRouteClue={onRouteSmartClue}
          onSelectModule={onSelectModule}
          onAcceptAutoLink={onAcceptAutoLink}
          onDismissAutoLink={onDismissAutoLink}
        />
      ) : (
        <>
          <Panel
            tag="06"
            title="Pivot chain — one input, full recon"
            description={recipe.description}
          >
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {KIND_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setInputKind(opt.id);
                      setRun(null);
                      setSavedNote(null);
                    }}
                    className={`rounded border px-3 py-1.5 text-xs font-medium transition-colors ${
                      inputKind === opt.id
                        ? 'border-accent bg-well font-semibold text-ink'
                        : 'border-line bg-well/60 text-ink-2 hover:text-ink'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
                <input
                  type="text"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRun();
                  }}
                  placeholder={recipe.inputPlaceholder}
                  className="rounded border border-line bg-well px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-3"
                />
                <Button
                  variant="primary"
                  onClick={handleRun}
                  disabled={!target.trim() || isRunning}
                >
                  {isRunning ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  {isRunning ? 'Running chain...' : 'Run chain'}
                </Button>
              </div>

              <div className="font-mono text-[11px] text-ink-3">
                {recipe.steps.length} steps ·{' '}
                {recipe.steps.map((s) => s.connectorId).join(' → ')}
              </div>
            </div>
          </Panel>

          {run && (
            <Panel
              tag={`${okCount}/${run.steps.length}`}
              title={`Run: ${recipe.title} — ${run.target}`}
              actions={
                <div className="flex gap-1.5">
                  {domainRecord && (
                    <Button size="sm" onClick={handleSaveDomainRecord}>
                      Save domain record
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={handleSaveRunToLedger}
                  >
                    <BookmarkPlus className="h-3.5 w-3.5" />
                    Save to ledger
                  </Button>
                </div>
              }
            >
              <div className="space-y-2">
                {savedNote && (
                  <NoticeBanner tone="info" title="Saved">
                    {savedNote}
                  </NoticeBanner>
                )}
                {gapCount > 0 && (
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-gap">
                    <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                    {gapCount} named gap(s) in this run — shown as gaps, never
                    filled.
                  </div>
                )}
                {run.steps.map((step, idx) => {
                  const style = STATUS_STYLES[step.status];
                  return (
                    <div
                      key={`${step.connectorId}-${idx}`}
                      className="rounded border border-line bg-well/50 px-3.5 py-2.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="font-mono text-[10px] text-ink-3">
                            {String(idx + 1).padStart(2, '0')}
                          </span>
                          <span className="min-w-0 truncate text-[13px] font-semibold text-ink">
                            {step.label}
                          </span>
                          <span
                            className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold ${style.chip}`}
                          >
                            {style.label}
                          </span>
                        </div>
                        <span className="font-mono text-[10px] tabular-nums text-ink-3">
                          {step.connectorId} · {step.durationMs}ms
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-ink-2">
                        {step.summary}
                      </div>
                      {step.error && (
                        <div className="mt-0.5 font-mono text-[11px] text-danger">
                          {step.error}
                        </div>
                      )}
                      {step.dataGaps.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {step.dataGaps.map((gap) => (
                            <span
                              key={gap}
                              className="rounded border border-line bg-well px-1.5 py-0.5 font-mono text-[10px] text-ink-3"
                            >
                              gap: {gap}
                            </span>
                          ))}
                        </div>
                      )}
                      {step.emitted.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {step.emitted.slice(0, 6).map((e, i) => (
                            <PivotChip
                              key={`${e.kind}-${e.value}-${i}`}
                              value={e.value}
                              label={`${e.kind}: ${e.value}`}
                              onSelectAction={onRouteSmartClue}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className="flex items-center gap-2 pt-1 text-[11px] text-ink-3">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Chain run {run.startedAtUtc.slice(0, 16).replace('T', ' ')} UTC
                  — every value above is traceable to its source connector.
                </div>
              </div>
            </Panel>
          )}

          {!run && !isRunning && (
            <div className="flex items-center gap-2 px-1 text-[11px] text-ink-3">
              <ProvenanceBadge
                meta={{
                  status: 'DERIVED',
                  source: 'info9 pivot engine',
                  fetchedAtUtc: new Date().toISOString(),
                  note: 'Runs on demand; no data is fetched until you press Run.',
                }}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
