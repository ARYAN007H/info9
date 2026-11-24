import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  GitBranch,
  Loader2,
  Play,
  Plus,
  Square,
} from 'lucide-react';
import type {
  EntityType,
  ModuleId,
  OsintEntity,
  ProvenanceMeta,
} from '../types/osint';
import {
  Button,
  FieldLabel,
  NoticeBanner,
  Panel,
  PivotChip,
  TextField,
  Well,
} from './ui';

type SeedKind = 'domain' | 'ip' | 'email' | 'username' | 'entity-name';

interface SpiderEntity {
  id: string;
  kind: SeedKind | 'asn' | 'url' | 'wallet';
  value: string;
  label: string;
  hop: number;
  source: string;
}

interface SpiderEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relation: string;
  source: string;
}

interface SpiderEvent {
  type: 'start' | 'hop_start' | 'step_result' | 'entity' | 'edge' | 'complete' | 'error';
  jobId: string;
  hop?: number;
  message: string;
  entity?: SpiderEntity;
  edge?: SpiderEdge;
  step?: {
    connector: string;
    target: string;
    status: 'ok' | 'empty' | 'error';
    durationMs: number;
    summary: string;
  };
  stats?: {
    entitiesFound: number;
    edgesFound: number;
    stepsCompleted: number;
  };
}

interface RecursiveSpiderPanelProps {
  caseId: string;
  initialKind?: SeedKind;
  initialTarget?: string;
  onAddEntities?: (entities: OsintEntity[]) => void;
  onCommitLedger: (entry: {
    module: ModuleId;
    targetLabel: string;
    sourceUrl: string;
    findingSummary: string;
    provenance: ProvenanceMeta;
  }) => void;
  onPivotToModule?: (moduleId: ModuleId, targetValue: string, subMode?: string) => void;
}

function mapSpiderKindToEntityType(kind: SpiderEntity['kind']): EntityType {
  if (kind === 'domain' || kind === 'url') return 'domain';
  if (kind === 'ip' || kind === 'asn') return 'ip_asn';
  if (kind === 'email') return 'email';
  if (kind === 'username') return 'handle';
  if (kind === 'wallet') return 'wallet';
  return 'company';
}

export const RecursiveSpiderPanel: React.FC<RecursiveSpiderPanelProps> = ({
  caseId,
  initialKind,
  initialTarget,
  onAddEntities,
  onCommitLedger,
  onPivotToModule,
}) => {
  const [seedKind, setSeedKind] = useState<SeedKind>(initialKind || 'domain');
  const [seedValue, setSeedValue] = useState(initialTarget || '');
  const [depth, setDepth] = useState<number>(2);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<SpiderEvent[]>([]);
  const [entities, setEntities] = useState<SpiderEntity[]>([]);
  const [edges, setEdges] = useState<SpiderEdge[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [committed, setCommitted] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (initialKind) setSeedKind(initialKind);
    if (initialTarget) setSeedValue(initialTarget);
  }, [initialKind, initialTarget]);

  useEffect(() => {
    return () => {
      esRef.current?.close();
    };
  }, []);

  const stopSpider = () => {
    esRef.current?.close();
    esRef.current = null;
    setRunning(false);
  };

  const startSpider = (
    e?: React.FormEvent,
    override?: { kind: SeedKind; target: string }
  ) => {
    e?.preventDefault();
    const activeKind = override?.kind ?? seedKind;
    const target = (override?.target ?? seedValue).trim();
    if (!target) return;
    if (override) {
      setSeedKind(override.kind);
      setSeedValue(override.target);
    }

    esRef.current?.close();
    setRunning(true);
    setError(null);
    setEvents([]);
    setEntities([]);
    setEdges([]);
    setJobId(null);
    setCommitted(false);

    const qs = new URLSearchParams({
      caseId,
      kind: activeKind,
      target,
      depth: String(depth),
    });
    const es = new EventSource(`/api/osint/pivot-spider?${qs.toString()}`);
    esRef.current = es;

    es.onmessage = (msg) => {
      try {
        const ev = JSON.parse(msg.data) as SpiderEvent;
        if (ev.jobId) setJobId(ev.jobId);
        if (ev.type === 'entity' && ev.entity) {
          setEntities((prev) =>
            prev.some((x) => x.id === ev.entity!.id) ? prev : [...prev, ev.entity!]
          );
        } else if (ev.type === 'edge' && ev.edge) {
          setEdges((prev) => [...prev, ev.edge!]);
        } else {
          setEvents((prev) => [...prev, ev]);
        }
        if (ev.type === 'complete') {
          es.close();
          esRef.current = null;
          setRunning(false);
        } else if (ev.type === 'error') {
          setError(ev.message);
          es.close();
          esRef.current = null;
          setRunning(false);
        }
      } catch {
        // ignore malformed SSE chunk
      }
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;
      setRunning(false);
    };
  };

  const commitDiscoveredSubgraph = () => {
    const now = new Date().toISOString();
    const prov: ProvenanceMeta = {
      status: 'LIVE',
      source: `Recursive Pivot Spider (Depth ${depth}${jobId ? ` · ${jobId}` : ''})`,
      fetchedAtUtc: now,
    };
    if (onAddEntities && entities.length > 0) {
      const mapped: OsintEntity[] = entities.slice(0, 20).map((ent, idx) => ({
        id: `spider-${Date.now()}-${idx}`,
        label: ent.label,
        type: mapSpiderKindToEntityType(ent.kind),
        jurisdiction: 'DISCOVERED',
        identifier: `${ent.kind.toUpperCase()}:${ent.value}`,
        summary: `Hop ${ent.hop} discovery via ${ent.source}`,
        riskLevel: 'medium',
        attributes: {
          'Spider Hop': String(ent.hop),
          'Discovery Source': ent.source,
          'Seed Value': seedValue,
        },
        provenance: prov,
      }));
      onAddEntities(mapped);
    }
    onCommitLedger({
      module: 'investigate',
      targetLabel: `Spider: ${seedValue} (D${depth})`,
      sourceUrl: 'local://recursive-pivot-spider',
      findingSummary: `Recursive depth-${depth} spider on ${seedKind} "${seedValue}" discovered ${entities.length} entities and ${edges.length} links across live connectors.`,
      provenance: prov,
    });
    setCommitted(true);
  };

  return (
    <Panel
      title="Recursive Pivot Spider"
      actions={
        entities.length > 0 ? (
          <Button
            size="sm"
            variant="primary"
            disabled={committed}
            onClick={commitDiscoveredSubgraph}
          >
            <Plus className="w-3.5 h-3.5" />
            {committed ? 'Committed to Case & Graph' : `Commit ${entities.length} Entities`}
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-3">
        <form onSubmit={startSpider} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
          <div className="sm:col-span-3">
            <FieldLabel htmlFor="sp-kind">Seed Type</FieldLabel>
            <select
              id="sp-kind"
              value={seedKind}
              onChange={(e) => setSeedKind(e.target.value as SeedKind)}
              className="w-full h-9 px-2.5 rounded-[2px] border border-rule bg-surface text-xs text-ink font-mono"
            >
              <option value="domain">Domain (DNS → IP → BGP)</option>
              <option value="email">Email (PGP → GitHub)</option>
              <option value="username">Username (8 Platforms)</option>
              <option value="ip">IPv4 (Geo → ASN)</option>
              <option value="entity-name">Org / Person (Registries)</option>
            </select>
          </div>
          <div className="sm:col-span-5">
            <FieldLabel htmlFor="sp-target">Starting Pivot Target</FieldLabel>
            <TextField
              id="sp-target"
              value={seedValue}
              onChange={(e) => setSeedValue(e.target.value)}
              placeholder="e.g. bellingcat.com, torvalds, or user@domain.com"
            />
          </div>
          <div className="sm:col-span-2">
            <FieldLabel htmlFor="sp-depth">Max Depth</FieldLabel>
            <select
              id="sp-depth"
              value={depth}
              onChange={(e) => setDepth(Number(e.target.value))}
              className="w-full h-9 px-2.5 rounded-[2px] border border-rule bg-surface text-xs text-ink font-mono"
            >
              <option value={1}>Depth 1 (Direct)</option>
              <option value={2}>Depth 2 (2-Hop)</option>
              <option value={3}>Depth 3 (Deep)</option>
            </select>
          </div>
          <div className="sm:col-span-2 flex gap-1.5">
            {running ? (
              <Button type="button" variant="secondary" className="w-full" onClick={stopSpider}>
                <Square className="w-3.5 h-3.5" />
                Stop
              </Button>
            ) : (
              <Button
                type="submit"
                variant="primary"
                className="w-full"
                disabled={!seedValue.trim()}
              >
                <Play className="w-3.5 h-3.5" />
                Launch Spider
              </Button>
            )}
          </div>
        </form>

        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <span className="font-mono text-[10px] uppercase">Try:</span>
          {(
            [
              { kind: 'domain', target: 'cloudflare.com' },
              { kind: 'username', target: 'torvalds' },
              { kind: 'ip', target: '1.1.1.1' },
            ] as const
          ).map((s) => (
            <Button
              key={`${s.kind}:${s.target}`}
              type="button"
              variant="chip"
              onClick={() => startSpider(undefined, s)}
            >
              {s.target}
            </Button>
          ))}
        </div>

        {error && <NoticeBanner tone="danger">{error}</NoticeBanner>}

        {(running || events.length > 0 || entities.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 pt-1">
            {/* Discovered Entities & Relationships — primary */}
            <Well className="p-3 space-y-2 max-h-80 overflow-y-auto">
              <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-live flex items-center gap-1.5">
                <GitBranch className="w-3 h-3" />
                Discovered Entities ({entities.length}) · Links ({edges.length})
              </div>
              {entities.length === 0 ? (
                <div className="text-xs text-muted py-4">
                  {running ? 'Discovering linked entities…' : 'No linked entities returned.'}
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {entities.map((ent) => (
                    <PivotChip
                      key={ent.id}
                      label={`H${ent.hop} [${ent.kind}] ${ent.label}`}
                      hint={ent.source}
                      onClick={() => {
                        if (!onPivotToModule) return;
                        if (ent.kind === 'domain') onPivotToModule('infra', ent.value);
                        else if (ent.kind === 'username') onPivotToModule('identity', ent.value, 'username');
                        else if (ent.kind === 'email') onPivotToModule('identity', ent.value, 'email');
                        else if (ent.kind === 'url') onPivotToModule('webhunter', ent.value, 'extract');
                        else onPivotToModule('webhunter', ent.value, 'search');
                      }}
                    />
                  ))}
                </div>
              )}
              {edges.length > 0 && (
                <div className="pt-2 border-t border-rule space-y-1 font-mono text-[10px] text-muted">
                  {edges.slice(0, 18).map((ed) => (
                    <div key={ed.id} className="truncate">
                      {ed.sourceId} <span className="text-accent">—[{ed.relation}]→</span> {ed.targetId}
                    </div>
                  ))}
                </div>
              )}
            </Well>

            {/* Live Execution Stream — secondary */}
            <Well className="p-3 space-y-2 max-h-80 overflow-y-auto">
              <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-accent flex items-center gap-1.5">
                {running ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Activity className="w-3 h-3" />
                )}
                Execution Stream ({events.length})
              </div>
              <div className="divide-y divide-rule font-mono text-[11px]">
                {events.map((ev, idx) => (
                  <div key={idx} className="py-1.5 space-y-0.5 first:pt-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-ink font-semibold">
                        {ev.hop !== undefined ? `[HOP ${ev.hop}] ` : ''}
                        {ev.step ? ev.step.connector : ev.type.toUpperCase()}
                      </span>
                      {ev.step && (
                        <span
                          className={
                            ev.step.status === 'ok'
                              ? 'text-live text-[10px]'
                              : ev.step.status === 'empty'
                              ? 'text-muted text-[10px]'
                              : 'text-danger text-[10px]'
                          }
                        >
                          {ev.step.status.toUpperCase()} · {ev.step.durationMs}ms
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-muted">
                      {ev.step ? `${ev.step.target} → ${ev.step.summary}` : ev.message}
                    </div>
                  </div>
                ))}
              </div>
            </Well>
          </div>
        )}
      </div>
    </Panel>
  );
};
