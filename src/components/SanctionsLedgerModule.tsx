import React, { useMemo, useState } from 'react';
import {
  BookmarkPlus,
  Download,
  FilePlus2,
  Filter,
  Lock,
  Scale,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import type {
  InvestigationCase,
  SanctionsMatchWeights,
} from '../types/osint';
import {
  computeMerkleRoot,
  exportStix21Bundle,
  scoreSanctionsCandidate,
  transliterateAndNormalizeName,
  verifyEvidenceLedgerChain,
} from '../utils/osintForensics';
import { OfacLiveScreening } from './OfacLiveScreening';
import { MODULE_CATALOG } from './moduleCatalog';
import {
  Button,
  DataValue,
  EmptyState,
  FieldLabel,
  NoticeBanner,
  Panel,
  SegmentedTabs,
  TextField,
  Well,
} from './ui';

interface SanctionsLedgerModuleProps {
  activeCase: InvestigationCase;
  onUpdateSanctionsQuery: (query: {
    targetName: string;
    targetDob: string;
    targetJurisdiction: string;
  }) => void;
  onAppendLedger: (entry: {
    module: 'sanctions';
    targetLabel: string;
    findingSummary: string;
    sourceUrl: string;
  }) => void;
  onExportMarkdown?: () => void;
}

const DISPOSITION_STYLES: Record<
  string,
  { score: string; label: string; text: string }
> = {
  CONFIRMED_TARGET: {
    score: 'text-danger',
    label: 'Likely match',
    text: 'text-danger',
  },
  FALSE_POSITIVE_ELIMINATED: {
    score: 'text-live',
    label: 'False positive',
    text: 'text-live',
  },
  POTENTIAL_MATCH_REVIEW: {
    score: 'text-gap',
    label: 'Needs review',
    text: 'text-gap',
  },
};

export const SanctionsLedgerModule: React.FC<SanctionsLedgerModuleProps> = ({
  activeCase,
  onUpdateSanctionsQuery,
  onAppendLedger,
  onExportMarkdown,
}) => {
  const { sanctionsQuery, evidenceLedger } = activeCase;

  const [weights] = useState<SanctionsMatchWeights>({
    namePhoneticWeight: 40,
    dobExactWeight: 30,
    jurisdictionWeight: 20,
    aliasOverlapWeight: 10,
  });

  const [dispositionFilter, setDispositionFilter] = useState<
    'ALL' | 'CONFIRMED_TARGET' | 'FALSE_POSITIVE_ELIMINATED'
  >('ALL');

  const [customTarget, setCustomTarget] = useState('');
  const [customFinding, setCustomFinding] = useState('');
  const [customSourceUrl, setCustomSourceUrl] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const hasActiveQuery = sanctionsQuery.targetName.trim().length > 0;

  const scoredCandidates = useMemo(() => {
    if (!hasActiveQuery) return [];
    const list = sanctionsQuery.candidates.map((cand) =>
      scoreSanctionsCandidate(
        {
          targetName: sanctionsQuery.targetName,
          targetDob: sanctionsQuery.targetDob,
          targetJurisdiction: sanctionsQuery.targetJurisdiction,
        },
        cand,
        weights
      )
    );
    list.sort((a, b) => b.compositeScore - a.compositeScore);
    return list;
  }, [sanctionsQuery, weights, hasActiveQuery]);

  const filteredResults = scoredCandidates.filter((res) =>
    dispositionFilter === 'ALL' ? true : res.disposition === dispositionFilter
  );

  const chainVerification = useMemo(
    () => verifyEvidenceLedgerChain(evidenceLedger),
    [evidenceLedger]
  );

  const merkleRootHash = useMemo(
    () => computeMerkleRoot(evidenceLedger),
    [evidenceLedger]
  );

  const handleExportStixBundle = () => {
    const jsonString = exportStix21Bundle(activeCase);
    const blob = new Blob([jsonString], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `osint-investigation-report.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setStatusMessage('Downloaded structured JSON report bundle.');
  };

  const handleAddManualNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customTarget.trim() || !customFinding.trim()) {
      setStatusMessage('Enter both a subject and the finding note.');
      return;
    }
    onAppendLedger({
      module: 'sanctions',
      targetLabel: customTarget.trim(),
      findingSummary: customFinding.trim(),
      sourceUrl: customSourceUrl.trim() || 'User Investigation Note',
    });
    setCustomTarget('');
    setCustomFinding('');
    setCustomSourceUrl('');
    setStatusMessage('Finding recorded to the evidence ledger.');
  };

  return (
    <div className="space-y-4">
      {/* Live OFAC SDN screening — the real Treasury list, zero keys */}
      <OfacLiveScreening />

      <Panel
        title={`${MODULE_CATALOG.sanctions.name} screening — sample dataset`}
        description={`${MODULE_CATALOG.sanctions.job} The bundled candidate list is a small synthetic demonstration set (5 fictional records), so the matcher can be exercised end-to-end — it is not the OFAC / EU / UN / UK lists.`}
        actions={
          <>
            {onExportMarkdown && (
              <Button variant="solid" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={onExportMarkdown}>
                Export case report
              </Button>
            )}
            <Button variant="solid" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={handleExportStixBundle}>
              Export JSON
            </Button>
          </>
        }
      >
        {statusMessage && (
          <NoticeBanner
            className="mb-3"
            tone={
              statusMessage.startsWith('Enter both') ? 'danger' : 'info'
            }
            onDismiss={() => setStatusMessage(null)}
          >
            {statusMessage}
          </NoticeBanner>
        )}

        <Well className="p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="md:col-span-6">
              <FieldLabel htmlFor="sanctions-name">
                Person or company name (English or Cyrillic)
              </FieldLabel>
              <TextField
                id="sanctions-name"
                type="text"
                placeholder="e.g. Viktor Morozov or Vega Maritime Holdings"
                value={sanctionsQuery.targetName}
                onChange={(e) =>
                  onUpdateSanctionsQuery({
                    ...sanctionsQuery,
                    targetName: e.target.value,
                  })
                }
              />
            </div>

            <div className="md:col-span-3">
              <FieldLabel htmlFor="sanctions-dob">
                Birth / incorporation date (optional)
              </FieldLabel>
              <TextField
                id="sanctions-dob"
                type="text"
                placeholder="YYYY-MM-DD"
                className="font-mono"
                value={sanctionsQuery.targetDob}
                onChange={(e) =>
                  onUpdateSanctionsQuery({
                    ...sanctionsQuery,
                    targetDob: e.target.value,
                  })
                }
              />
            </div>

            <div className="md:col-span-3">
              <FieldLabel htmlFor="sanctions-jur">
                Country / jurisdiction (optional)
              </FieldLabel>
              <TextField
                id="sanctions-jur"
                type="text"
                placeholder="e.g. Russian Federation, Cyprus"
                value={sanctionsQuery.targetJurisdiction}
                onChange={(e) =>
                  onUpdateSanctionsQuery({
                    ...sanctionsQuery,
                    targetJurisdiction: e.target.value,
                  })
                }
              />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-3">
            <div className="flex flex-wrap items-center gap-2">
              <span>Try:</span>
              <Button
                variant="chip"
                onClick={() =>
                  onUpdateSanctionsQuery({
                    targetName: 'Viktor Alekseyevich Morozov',
                    targetDob: '1968-04-14',
                    targetJurisdiction: 'Russian Federation',
                  })
                }
              >
                Viktor Morozov (DOB 1968-04-14)
              </Button>
              <Button
                variant="chip"
                onClick={() =>
                  onUpdateSanctionsQuery({
                    targetName: 'Vega Maritime Holdings Ltd',
                    targetDob: '2025-11-04',
                    targetJurisdiction: 'Marshall Islands',
                  })
                }
              >
                Vega Maritime Holdings
              </Button>
            </div>

            {hasActiveQuery && (
              <DataValue className="text-ink-3">
                Normalized: {transliterateAndNormalizeName(sanctionsQuery.targetName)}
              </DataValue>
            )}
          </div>
        </Well>

        {hasActiveQuery && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Scale className="h-4 w-4 text-ink-3" />
                <span>Comparison results ({filteredResults.length})</span>
              </h3>

              <SegmentedTabs
                size="sm"
                ariaLabel="Disposition filter"
                tabs={[
                  { id: 'ALL', label: 'All matches' },
                  { id: 'CONFIRMED_TARGET', label: 'High-confidence hits' },
                  {
                    id: 'FALSE_POSITIVE_ELIMINATED',
                    label: 'Filtered false positives',
                  },
                ]}
                active={dispositionFilter}
                onChange={(id) => setDispositionFilter(id)}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {filteredResults.map((res) => {
                const disposition =
                  DISPOSITION_STYLES[res.disposition] ??
                  DISPOSITION_STYLES.POTENTIAL_MATCH_REVIEW;
                return (
                  <Well key={res.candidate.id} className="flex flex-col justify-between p-4">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <DataValue className="text-[11px] text-ink-3">
                            {res.candidate.listSource} · {res.candidate.identifierCode}
                          </DataValue>
                          <h4 className="mt-0.5 text-sm font-semibold text-ink">
                            {res.candidate.listedName}
                          </h4>
                          <DataValue className="mt-0.5 block text-ink-3">
                            DOB/inc: {res.candidate.dobOrIncorporation} ·{' '}
                            {res.candidate.citizenshipOrJurisdiction}
                          </DataValue>
                        </div>

                        <div className="shrink-0 text-right font-mono tabular-nums">
                          <div className={`text-sm font-semibold ${disposition.score}`}>
                            {res.compositeScore}% match
                          </div>
                          <div className={`text-[10px] font-semibold ${disposition.text}`}>
                            {disposition.label}
                          </div>
                        </div>
                      </div>

                      <p className="mt-2 text-xs leading-5 text-ink-2">
                        {res.candidate.program} — {res.candidate.notes}
                      </p>

                      {res.eliminationReasons.length > 0 && (
                        <div className="mt-2.5 space-y-1 rounded border border-live/25 bg-live/10 p-2 text-xs text-ink-2">
                          {res.eliminationReasons.map((reason, idx) => (
                            <div key={idx} className="flex items-center gap-1.5">
                              <Filter className="h-3 w-3 shrink-0 text-live" />
                              <span>{reason}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-line pt-2.5 text-xs">
                      <DataValue className="text-ink-3">
                        Name similarity: {res.nameSimilarityScore}%
                      </DataValue>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<BookmarkPlus className="h-3.5 w-3.5" />}
                        onClick={() => {
                          onAppendLedger({
                            module: 'sanctions',
                            targetLabel: `${res.candidate.listedName} (${res.candidate.identifierCode})`,
                            findingSummary: `Watchlist Screening: ${res.disposition} (${res.compositeScore}% match).`,
                            sourceUrl: 'https://sanctionssearch.ofac.treas.gov/',
                          });
                          setStatusMessage(
                            `${res.candidate.listedName} screening result recorded to the evidence ledger.`
                          );
                        }}
                      >
                        Record
                      </Button>
                    </div>
                  </Well>
                );
              })}
            </div>
          </div>
        )}
      </Panel>

      <Panel
        title={`Saved findings (${evidenceLedger.length})`}
        description="Every finding recorded across the bench lands in the hash-chained ledger — also available in the drawer at the bottom of the workspace."
        actions={
          <span
            className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-[11px] tabular-nums ${
              evidenceLedger.length === 0
                ? 'border-line text-ink-3'
                : chainVerification.isValid
                ? 'border-live/35 bg-live/10 text-live'
                : 'border-danger/40 bg-danger/10 text-danger'
            }`}
            title={chainVerification.reason}
          >
            {evidenceLedger.length === 0 ? (
              <Lock className="h-3.5 w-3.5" />
            ) : chainVerification.isValid ? (
              <ShieldCheck className="h-3.5 w-3.5" />
            ) : (
              <ShieldAlert className="h-3.5 w-3.5" />
            )}
            {evidenceLedger.length === 0
              ? 'Ready to record'
              : `Merkle ${merkleRootHash.slice(0, 12)}…`}
          </span>
        }
        bodyClassName="space-y-3"
      >
        <form
          onSubmit={handleAddManualNote}
          className="grid grid-cols-1 gap-2 rounded border border-line bg-well p-3 md:grid-cols-12"
        >
          <div className="md:col-span-3">
            <TextField
              type="text"
              aria-label="Note subject or target"
              placeholder="Subject (e.g. phone, domain)"
              className="h-8 text-xs"
              value={customTarget}
              onChange={(e) => setCustomTarget(e.target.value)}
            />
          </div>
          <div className="md:col-span-5">
            <TextField
              type="text"
              aria-label="Finding summary note"
              placeholder="Write what you found…"
              className="h-8 text-xs"
              value={customFinding}
              onChange={(e) => setCustomFinding(e.target.value)}
            />
          </div>
          <div className="md:col-span-2">
            <TextField
              type="text"
              aria-label="Optional source URL"
              placeholder="Source link (optional)"
              className="h-8 font-mono text-xs"
              value={customSourceUrl}
              onChange={(e) => setCustomSourceUrl(e.target.value)}
            />
          </div>
          <div className="md:col-span-2">
            <Button
              type="submit"
              variant="primary"
              size="sm"
              className="h-8 w-full"
              icon={<FilePlus2 className="h-3.5 w-3.5" />}
            >
              Record note
            </Button>
          </div>
        </form>

        {evidenceLedger.length === 0 ? (
          <EmptyState
            title="No findings recorded yet"
            hint='Use "Record" in any module — or the form above — to add a hash-chained entry to the case report.'
          />
        ) : (
          <div className="space-y-2.5">
            {evidenceLedger.map((entry) => (
              <Well key={entry.id} className="p-4 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] tabular-nums text-ink-3">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-ink">
                      #{String(entry.index).padStart(3, '0')}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="signage text-[9px] font-semibold text-ink-2">
                      {entry.module}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{entry.timestampUtc}</span>
                  </div>
                  <DataValue className="text-ink-3" >
                    SHA-256: {entry.sha256Hash.slice(0, 16)}…
                  </DataValue>
                </div>

                <div className="mt-1.5 text-sm font-semibold text-ink">
                  {entry.targetLabel}
                </div>
                <p className="mt-1 leading-5 text-ink-2">
                  {entry.findingSummary}
                </p>
              </Well>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
};
