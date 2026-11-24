import React, { useEffect, useState } from 'react';
import {
  Brain,
  CheckCircle2,
  Database,
  FileText,
  GitBranch,
  Loader2,
  Plus,
  RefreshCw,
  Scale,
  Server,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type {
  EntityType,
  InvestigationCase,
  ModuleId,
  OsintEntity,
  ProvenanceMeta,
} from '../types/osint';
import { ProvenanceBadge } from './ProvenanceBadge';
import {
  Button,
  FieldLabel,
  NoticeBanner,
  Panel,
  PivotChip,
  SegmentedTabs,
  TextField,
  Well,
} from './ui';

type CopilotMode = 'ner_extract' | 'ach_matrix' | 'next_pivots' | 'briefing_qa';

interface CopilotAnalysisResponse {
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

interface ConnectorStatusEntry {
  id: string;
  name: string;
  category: string;
  mode: 'zero-key' | 'optional-env-key';
  envVar: string | null;
  active: boolean;
  note: string;
}

interface ScanJobRecord {
  id: string;
  caseId: string;
  kind: string;
  target: string;
  depth: number;
  status: 'running' | 'completed' | 'failed';
  entitiesFound: number;
  edgesFound: number;
  stepsCompleted: number;
  createdAtUtc: string;
  updatedAtUtc: string;
}

interface CopilotVaultModuleProps {
  activeCase: InvestigationCase;
  onAddEntity: (entity: OsintEntity) => void;
  onCommitLedger: (entry: {
    module: ModuleId;
    targetLabel: string;
    sourceUrl: string;
    findingSummary: string;
    provenance: ProvenanceMeta;
  }) => void;
  onPivotToModule: (moduleId: ModuleId, targetValue: string, subMode?: string) => void;
}

function mapNerTypeToEntityType(raw: string): EntityType {
  const t = raw.toLowerCase();
  if (t.includes('person') || t.includes('individual')) return 'person';
  if (t.includes('domain') || t.includes('host')) return 'domain';
  if (t.includes('ip') || t.includes('asn')) return 'ip_asn';
  if (t.includes('loc') || t.includes('city') || t.includes('country')) return 'location';
  if (t.includes('wallet') || t.includes('crypto')) return 'wallet';
  if (t.includes('handle') || t.includes('user')) return 'handle';
  if (t.includes('email')) return 'email';
  return 'company';
}

export const CopilotVaultModule: React.FC<CopilotVaultModuleProps> = ({
  activeCase,
  onAddEntity,
  onCommitLedger,
  onPivotToModule,
}) => {
  const [section, setSection] = useState<'copilot' | 'vault'>('copilot');
  const [mode, setMode] = useState<CopilotMode>('ach_matrix');
  const [question, setQuestion] = useState(
    'What are the strongest corroborated links, timeline anomalies, and missing verification steps in this case?'
  );
  const [rawText, setRawText] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CopilotAnalysisResponse | null>(null);

  // SQLite stats + connector matrix + scan jobs
  const [dbStats, setDbStats] = useState<{
    caseCount: number;
    archivedPageCount: number;
    scanJobCount: number;
    dbPath: string;
  } | null>(null);
  const [connectors, setConnectors] = useState<ConnectorStatusEntry[]>([]);
  const [jobs, setJobs] = useState<ScanJobRecord[]>([]);
  const [loadingVault, setLoadingVault] = useState(false);

  const refreshVault = async () => {
    setLoadingVault(true);
    try {
      const [statsRes, jobsRes] = await Promise.all([
        fetch('/api/db/stats'),
        fetch(`/api/db/jobs?caseId=${encodeURIComponent(activeCase.id)}`),
      ]);
      if (statsRes.ok) {
        const sData = await statsRes.json();
        setDbStats(sData.stats || null);
        setConnectors(Array.isArray(sData.connectors) ? sData.connectors : []);
      }
      if (jobsRes.ok) {
        const jData = await jobsRes.json();
        setJobs(Array.isArray(jData.jobs) ? jData.jobs : []);
      }
    } catch {
      // Ignore network hiccup
    } finally {
      setLoadingVault(false);
    }
  };

  useEffect(() => {
    void refreshVault();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCase.id]);

  const runCopilot = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch('/api/osint/copilot/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          caseData: activeCase,
          question: mode === 'briefing_qa' ? question : undefined,
          rawText: mode === 'ner_extract' && rawText.trim() ? rawText.trim() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setResult(data as CopilotAnalysisResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Copilot request failed');
    } finally {
      setRunning(false);
    }
  };

  const validModules = new Set<ModuleId>([
    'geolocation',
    'dossier',
    'infra',
    'forensics',
    'identity',
    'investigate',
    'sanctions',
    'face',
    'acoustic',
    'webhunter',
    'timeline',
    'copilot',
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="signage text-[10px] font-semibold text-accent">12</span>
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">
              AI Copilot &amp; Case Vault
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-muted">
            Evidence-grounded analysis over recorded case artifacts, plus local SQLite and connector status.
          </p>
        </div>
        <SegmentedTabs
          value={section}
          onChange={(v) => setSection(v as 'copilot' | 'vault')}
          items={[
            { id: 'copilot', label: 'AI Investigator Copilot' },
            { id: 'vault', label: 'SQLite · Jobs · Connectors' },
          ]}
        />
      </div>

      {section === 'copilot' && (
        <div className="space-y-4">
          <Panel title="Analyst Workflow Selection">
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                {(
                  [
                    {
                      id: 'ach_matrix',
                      title: 'ACH Matrix',
                      desc: 'Weigh competing hypotheses against recorded evidence',
                      icon: <Scale className="w-3.5 h-3.5" />,
                    },
                    {
                      id: 'ner_extract',
                      title: 'Verbatim-Quote NER',
                      desc: 'Extract entities & links with exact source quotes',
                      icon: <FileText className="w-3.5 h-3.5" />,
                    },
                    {
                      id: 'next_pivots',
                      title: 'Next-Pivot Planner',
                      desc: 'Highest-yield follow-up pivots by module',
                      icon: <GitBranch className="w-3.5 h-3.5" />,
                    },
                    {
                      id: 'briefing_qa',
                      title: 'Grounded Q&A',
                      desc: 'Ask case questions with strict artifact citations',
                      icon: <Brain className="w-3.5 h-3.5" />,
                    },
                  ] as const
                ).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setMode(item.id)}
                    className={`p-3 rounded-[2px] border text-left transition-colors ${
                      mode === item.id
                        ? 'border-accent bg-accent/10'
                        : 'border-rule bg-well hover:border-ink/30'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                      <span className="text-accent">{item.icon}</span>
                      {item.title}
                    </div>
                    <p className="text-[11px] text-muted mt-1 leading-snug">{item.desc}</p>
                  </button>
                ))}
              </div>

              {mode === 'ner_extract' && (
                <div>
                  <FieldLabel htmlFor="cop-ner-text">
                    Optional Additional Document / Filing Excerpt (in addition to active case artifacts)
                  </FieldLabel>
                  <textarea
                    id="cop-ner-text"
                    rows={4}
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                    placeholder="Paste a corporate filing, court docket excerpt, or scraped article text to extract verbatim-cited entities & relationships…"
                    className="w-full px-2.5 py-2 rounded-[2px] bg-surface border border-rule text-xs text-ink font-mono focus:outline-none focus:border-accent"
                  />
                </div>
              )}

              {mode === 'briefing_qa' && (
                <div>
                  <FieldLabel htmlFor="cop-question">Analyst Question</FieldLabel>
                  <TextField
                    id="cop-question"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="Ask a question grounded strictly in recorded evidence…"
                  />
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-[10px] text-muted">
                  Evidence payload: {activeCase.entities.length} entities · {activeCase.infraRecords.length} infra scans · {(activeCase.collectedPages ?? []).length} archived pages · {(activeCase.enrichedProfiles ?? []).length} enriched profiles · {activeCase.evidenceLedger.length} ledger blocks
                </span>
                <Button variant="primary" onClick={runCopilot} disabled={running}>
                  {running ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Synthesizing…
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      Run Grounded Analysis
                    </>
                  )}
                </Button>
              </div>

              {error && <NoticeBanner tone="warn">{error}</NoticeBanner>}
            </div>
          </Panel>

          {result && (
            <Panel
              title={`Analyst Output — ${result.mode.toUpperCase()}`}
              actions={
                <div className="flex items-center gap-2">
                  <ProvenanceBadge provenance={result.provenance} />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      onCommitLedger({
                        module: 'copilot',
                        targetLabel: `AI ${result.mode}`,
                        sourceUrl: 'local://info9-copilot',
                        findingSummary: result.summary,
                        provenance: result.provenance,
                      })
                    }
                  >
                    <Plus className="w-3 h-3" />
                    Log Synthesis
                  </Button>
                </div>
              }
            >
              <div className="space-y-4">
                <Well className="p-3">
                  <div className="font-mono text-[10px] uppercase text-accent mb-1">
                    Executive Synthesis ({result.model})
                  </div>
                  <p className="text-xs text-ink leading-relaxed">{result.summary}</p>
                </Well>

                {/* ACH MATRIX */}
                {result.achHypotheses && result.achHypotheses.length > 0 && (
                  <div className="grid grid-cols-1 gap-3">
                    {result.achHypotheses.map((h, idx) => (
                      <Well key={idx} className="p-3 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs font-semibold text-ink">
                            H{idx + 1}: {h.hypothesis}
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded-[2px] border font-mono text-[10px] ${
                              h.likelihood === 'HIGH'
                                ? 'border-live/50 bg-live/10 text-live'
                                : h.likelihood === 'MEDIUM'
                                ? 'border-derived/50 bg-derived/10 text-derived'
                                : 'border-rule bg-surface text-muted'
                            }`}
                          >
                            {h.likelihood}
                          </span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px]">
                          <div className="p-2 rounded-[2px] bg-surface border border-rule">
                            <div className="font-mono text-[10px] text-live uppercase mb-1">
                              Supporting Evidence
                            </div>
                            <ul className="space-y-1 text-muted list-disc pl-3.5">
                              {h.supportingEvidence.map((s, i) => (
                                <li key={i}>{s}</li>
                              ))}
                            </ul>
                          </div>
                          <div className="p-2 rounded-[2px] bg-surface border border-rule">
                            <div className="font-mono text-[10px] text-danger uppercase mb-1">
                              Contradicting / Anomalous
                            </div>
                            <ul className="space-y-1 text-muted list-disc pl-3.5">
                              {h.contradictingEvidence.map((s, i) => (
                                <li key={i}>{s}</li>
                              ))}
                            </ul>
                          </div>
                          <div className="p-2 rounded-[2px] bg-surface border border-rule">
                            <div className="font-mono text-[10px] text-gap uppercase mb-1">
                              Missing Gaps to Test
                            </div>
                            <ul className="space-y-1 text-muted list-disc pl-3.5">
                              {h.missingEvidenceGaps.map((s, i) => (
                                <li key={i}>{s}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </Well>
                    ))}
                  </div>
                )}

                {/* VERBATIM NER ENTITIES */}
                {result.nerEntities && result.nerEntities.length > 0 && (
                  <div className="space-y-2">
                    <div className="font-mono text-[10px] uppercase text-muted">
                      Extracted Entities with Verbatim Source Quotes ({result.nerEntities.length})
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {result.nerEntities.map((ent, idx) => (
                        <Well key={idx} className="p-3 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <span className="text-xs font-semibold text-ink">{ent.label}</span>
                              <span className="ml-2 font-mono text-[10px] uppercase text-accent">
                                {ent.type}
                              </span>
                            </div>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() =>
                                onAddEntity({
                                  id: `ner-${Date.now()}-${idx}`,
                                  label: ent.label,
                                  type: mapNerTypeToEntityType(ent.type),
                                  jurisdiction: 'UNKNOWN',
                                  identifier: `NER:${ent.sourceRef.slice(0, 24)}`,
                                  summary: `Verbatim quote: "${ent.verbatimQuote}"`,
                                  riskLevel: 'medium',
                                  attributes: {
                                    'Source Ref': ent.sourceRef,
                                    'Verbatim Quote': ent.verbatimQuote,
                                  },
                                  provenance: result.provenance,
                                })
                              }
                            >
                              <Plus className="w-3 h-3" />
                              Add to Case
                            </Button>
                          </div>
                          <blockquote className="text-[11px] font-mono text-muted border-l-2 border-accent/50 pl-2 italic">
                            “{ent.verbatimQuote}”
                          </blockquote>
                          <div className="font-mono text-[10px] text-muted">Ref: {ent.sourceRef}</div>
                        </Well>
                      ))}
                    </div>
                  </div>
                )}

                {/* RECOMMENDED NEXT PIVOTS */}
                {result.recommendedPivots && result.recommendedPivots.length > 0 && (
                  <div className="space-y-2">
                    <div className="font-mono text-[10px] uppercase text-muted">
                      Recommended Investigative Pivots
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {result.recommendedPivots.map((p, idx) => {
                        const targetMod = validModules.has(p.moduleId as ModuleId)
                          ? (p.moduleId as ModuleId)
                          : 'webhunter';
                        return (
                          <Well key={idx} className="p-3 space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold text-ink">{p.title}</span>
                              <span className="font-mono text-[10px] text-accent">{p.priority}</span>
                            </div>
                            <p className="text-[11px] text-muted">{p.rationale}</p>
                            <PivotChip
                              label={`${targetMod}: ${p.targetValue}`}
                              hint="Launch Pivot"
                              onClick={() => onPivotToModule(targetMod, p.targetValue)}
                            />
                          </Well>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* GROUNDED BRIEFING Q&A */}
                {result.answer && (
                  <Well className="p-3 space-y-2">
                    <div className="text-xs text-ink whitespace-pre-wrap leading-relaxed">
                      {result.answer}
                    </div>
                    {result.citations && result.citations.length > 0 && (
                      <div className="pt-2 border-t border-rule">
                        <div className="font-mono text-[10px] uppercase text-muted mb-1">
                          Cited Case Artifacts
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {result.citations.map((c, i) => (
                            <span
                              key={i}
                              className="px-2 py-0.5 rounded-[2px] bg-surface border border-rule font-mono text-[10px] text-ink"
                            >
                              {c}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </Well>
                )}
              </div>
            </Panel>
          )}
        </div>
      )}

      {/* SECTION 2: LOCAL SQLITE STORAGE, SCAN JOBS & SERVER CONNECTOR MATRIX */}
      {section === 'vault' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <Well className="p-3">
              <div className="font-mono text-[10px] uppercase text-muted flex items-center gap-1">
                <Database className="w-3 h-3 text-live" />
                SQLite Cases Stored
              </div>
              <div className="text-lg font-semibold font-mono text-ink tnum mt-1">
                {dbStats?.caseCount ?? '—'}
              </div>
            </Well>
            <Well className="p-3">
              <div className="font-mono text-[10px] uppercase text-muted">
                FTS5 Archived Pages
              </div>
              <div className="text-lg font-semibold font-mono text-ink tnum mt-1">
                {dbStats?.archivedPageCount ?? '—'}
              </div>
            </Well>
            <Well className="p-3">
              <div className="font-mono text-[10px] uppercase text-muted">
                Recursive Spider Jobs
              </div>
              <div className="text-lg font-semibold font-mono text-ink tnum mt-1">
                {dbStats?.scanJobCount ?? '—'}
              </div>
            </Well>
            <Well className="p-3">
              <div className="font-mono text-[10px] uppercase text-muted">
                Active Connectors
              </div>
              <div className="text-lg font-semibold font-mono text-live tnum mt-1">
                {connectors.filter((c) => c.active).length} / {connectors.length}
              </div>
            </Well>
          </div>

          <Panel
            title="Server Connectors"
            description="Zero-key feeds work immediately; optional API keys are read server-side from .env."
            actions={
              <Button size="sm" variant="ghost" onClick={refreshVault} disabled={loadingVault}>
                <RefreshCw className={`w-3.5 h-3.5 ${loadingVault ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            }
            flush
          >
            <div className="divide-y divide-rule">
              {connectors.map((c) => (
                <div
                  key={c.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {c.active ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-live shrink-0" />
                    ) : (
                      <Server className="w-3.5 h-3.5 text-muted shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-xs font-semibold text-ink">{c.name}</span>
                        <span className="font-mono text-[10px] text-muted">{c.category}</span>
                      </div>
                      <div className="text-[11px] text-muted truncate">{c.note}</div>
                    </div>
                  </div>
                  <span
                    className={`font-mono text-[10px] uppercase shrink-0 ${
                      c.active ? 'text-live font-semibold' : 'text-muted'
                    }`}
                  >
                    {c.active
                      ? c.mode === 'zero-key'
                        ? 'Zero-Key Live'
                        : 'Env Active'
                      : `Env: ${c.envVar || 'Optional'}`}
                  </span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title={`SQLite Recursive Spider Job History (${jobs.length})`}>
            {jobs.length === 0 ? (
              <div className="text-xs text-muted py-4 text-center">
                No recursive spider jobs recorded for this case yet. Launch a multi-hop scan in Module 06 (Investigate).
              </div>
            ) : (
              <div className="space-y-2">
                {jobs.map((j) => (
                  <Well key={j.id} className="p-2.5 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-3.5 h-3.5 text-accent" />
                      <span className="text-ink font-semibold">{j.target}</span>
                      <span className="text-muted">({j.kind} · depth {j.depth})</span>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-muted">
                      <span>{j.entitiesFound} entities · {j.edgesFound} edges · {j.stepsCompleted} steps</span>
                      <span className={j.status === 'completed' ? 'text-live' : 'text-gap'}>
                        {j.status.toUpperCase()}
                      </span>
                    </div>
                  </Well>
                ))}
              </div>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
};
