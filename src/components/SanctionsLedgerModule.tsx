import React, { useMemo, useState } from 'react';
import {
  BookmarkPlus,
  CheckCircle2,
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
      setStatusMessage('Please enter both a Subject/Title and your Finding Note.');
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
    setStatusMessage('Added note to your saved investigation findings.');
  };

  return (
    <div className="space-y-6">
      {/* Step 1: Watchlist & Name Screening Card */}
      <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 font-display">
              Watchlist Screening &amp; Saved Investigation Notes
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Screen any person or company name against international sanctions
              lists (automatically filtering out false positives with different
              birth years or countries), and export your saved findings.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {onExportMarkdown && (
              <button
                type="button"
                onClick={onExportMarkdown}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5 text-sky-500" />
                <span>Download Report (.MD)</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleExportStixBundle}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-500 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export JSON (.json)</span>
            </button>
          </div>
        </div>

        {statusMessage && (
          <div
            role="status"
            className="px-4 py-2.5 text-xs bg-sky-500/10 border border-sky-500/30 text-sky-800 dark:text-sky-200 rounded-lg flex items-center justify-between"
          >
            <span>{statusMessage}</span>
            <button
              type="button"
              onClick={() => setStatusMessage(null)}
              className="text-xs underline ml-4 whitespace-nowrap shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Watchlist Input Grid */}
        <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <div className="md:col-span-6">
              <label
                htmlFor="sanctions-name"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
              >
                Person or Company Name (English or Cyrillic)
              </label>
              <input
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
                className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="md:col-span-3">
              <label
                htmlFor="sanctions-dob"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
              >
                Birth / Incorporation Date (Optional)
              </label>
              <input
                id="sanctions-dob"
                type="text"
                placeholder="YYYY-MM-DD"
                value={sanctionsQuery.targetDob}
                onChange={(e) =>
                  onUpdateSanctionsQuery({
                    ...sanctionsQuery,
                    targetDob: e.target.value,
                  })
                }
                className="w-full px-3 py-2 text-sm font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="md:col-span-3">
              <label
                htmlFor="sanctions-jur"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
              >
                Country / Jurisdiction (Optional)
              </label>
              <input
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
                className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
            <div className="flex flex-wrap items-center gap-2">
              <span>Try an example screening:</span>
              <button
                type="button"
                onClick={() =>
                  onUpdateSanctionsQuery({
                    targetName: 'Viktor Alekseyevich Morozov',
                    targetDob: '1968-04-14',
                    targetJurisdiction: 'Russian Federation',
                  })
                }
                className="px-2.5 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-sky-500 rounded-md text-slate-700 dark:text-slate-300 font-medium transition-colors"
              >
                Viktor Morozov (DOB: 1968-04-14)
              </button>
              <button
                type="button"
                onClick={() =>
                  onUpdateSanctionsQuery({
                    targetName: 'Vega Maritime Holdings Ltd',
                    targetDob: '2025-11-04',
                    targetJurisdiction: 'Marshall Islands',
                  })
                }
                className="px-2.5 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-sky-500 rounded-md text-slate-700 dark:text-slate-300 font-medium transition-colors"
              >
                Vega Maritime Holdings
              </button>
            </div>

            {hasActiveQuery && (
              <span className="font-mono text-sky-600 dark:text-sky-400">
                Normalized: {transliterateAndNormalizeName(sanctionsQuery.targetName)}
              </span>
            )}
          </div>
        </div>

        {/* Watchlist Screening Results */}
        {hasActiveQuery && (
          <div className="space-y-3 pt-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 font-display">
                <Scale className="w-4 h-4 text-emerald-500" />
                <span>Watchlist Comparison Results ({filteredResults.length})</span>
              </h2>

              <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-950 rounded-lg">
                {(
                  [
                    { id: 'ALL', label: 'All Matches' },
                    { id: 'CONFIRMED_TARGET', label: 'High-Confidence Hits' },
                    {
                      id: 'FALSE_POSITIVE_ELIMINATED',
                      label: 'Filtered False Positives',
                    },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setDispositionFilter(tab.id)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      dispositionFilter === tab.id
                        ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-2xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredResults.map((res) => (
                <div
                  key={res.candidate.id}
                  className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg flex flex-col justify-between space-y-3"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs font-mono text-sky-600 dark:text-sky-400">
                          {res.candidate.listSource} · {res.candidate.identifierCode}
                        </div>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                          {res.candidate.listedName}
                        </h3>
                        <div className="text-xs text-slate-500 font-mono mt-0.5">
                          DOB/Inc: {res.candidate.dobOrIncorporation} · Country:{' '}
                          {res.candidate.citizenshipOrJurisdiction}
                        </div>
                      </div>

                      <div className="text-right font-mono tabular-nums shrink-0">
                        <div
                          className={`text-sm font-bold ${
                            res.disposition === 'CONFIRMED_TARGET'
                              ? 'text-rose-600 dark:text-rose-400'
                              : res.disposition === 'FALSE_POSITIVE_ELIMINATED'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          {res.compositeScore}% Match
                        </div>
                        <div className="text-[10px] font-semibold text-slate-500">
                          {res.disposition === 'CONFIRMED_TARGET'
                            ? 'LIKELY MATCH'
                            : res.disposition === 'FALSE_POSITIVE_ELIMINATED'
                            ? 'FALSE POSITIVE'
                            : 'NEEDS REVIEW'}
                        </div>
                      </div>
                    </div>

                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-2">
                      {res.candidate.program} — {res.candidate.notes}
                    </p>

                    {res.eliminationReasons.length > 0 && (
                      <div className="mt-2.5 p-2 bg-emerald-500/10 border border-emerald-500/20 rounded text-xs text-emerald-800 dark:text-emerald-300 space-y-1">
                        {res.eliminationReasons.map((reason, idx) => (
                          <div key={idx} className="flex items-center gap-1.5">
                            <Filter className="w-3 h-3 shrink-0" />
                            <span>{reason}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
                    <span className="font-mono text-slate-500">
                      Name Similarity: {res.nameSimilarityScore}%
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        onAppendLedger({
                          module: 'sanctions',
                          targetLabel: `${res.candidate.listedName} (${res.candidate.identifierCode})`,
                          findingSummary: `Watchlist Screening: ${res.disposition} (${res.compositeScore}% match).`,
                          sourceUrl: 'https://sanctionssearch.ofac.treas.gov/',
                        });
                        setStatusMessage(
                          `Saved ${res.candidate.listedName} screening result to Notes.`
                        );
                      }}
                      className="text-sky-600 dark:text-sky-400 hover:underline font-semibold flex items-center gap-1"
                    >
                      <BookmarkPlus className="w-3.5 h-3.5" />
                      <span>Save to Notes</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Step 2: Saved Investigation Notes & Evidence Log */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 font-display">
              <Lock className="w-4 h-4 text-sky-500" />
              <span>
                Saved Investigation Notes ({evidenceLedger.length})
              </span>
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Every finding you save across the tools is recorded here with a
              timestamp and SHA-256 verification hash for your report.
            </p>
          </div>

          <div className="px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 flex items-center gap-2 text-xs font-mono tabular-nums">
            {chainVerification.isValid ? (
              <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
            ) : (
              <ShieldAlert className="w-4 h-4 text-rose-500 shrink-0" />
            )}
            <span>
              {evidenceLedger.length === 0
                ? 'Ready to record findings'
                : `Verified (${merkleRootHash.slice(0, 12)}...)`}
            </span>
          </div>
        </div>

        {/* Add Custom Note Form */}
        <form
          onSubmit={handleAddManualNote}
          className="grid grid-cols-1 md:grid-cols-12 gap-3 bg-slate-50 dark:bg-slate-950 p-4 rounded-lg border border-slate-200 dark:border-slate-800"
        >
          <div className="md:col-span-3">
            <input
              type="text"
              aria-label="Note Subject or Target"
              placeholder="Subject (e.g. Phone +44 20... or Domain)"
              value={customTarget}
              onChange={(e) => setCustomTarget(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
            />
          </div>
          <div className="md:col-span-5">
            <input
              type="text"
              aria-label="Finding Summary Note"
              placeholder="Write what you found..."
              value={customFinding}
              onChange={(e) => setCustomFinding(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
            />
          </div>
          <div className="md:col-span-2">
            <input
              type="text"
              aria-label="Optional Source URL"
              placeholder="Source link (optional)"
              value={customSourceUrl}
              onChange={(e) => setCustomSourceUrl(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
            />
          </div>
          <div className="md:col-span-2">
            <button
              type="submit"
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-500 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <FilePlus2 className="w-3.5 h-3.5" />
              <span>Add Note</span>
            </button>
          </div>
        </form>

        {/* Saved Notes List */}
        {evidenceLedger.length === 0 ? (
          <div className="p-8 text-center bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-xs text-slate-500 dark:text-slate-400">
            No findings saved yet. Click <strong>&ldquo;Save to Notes&rdquo;</strong>{' '}
            in any tool (or add a note above) to build your investigation report.
          </div>
        ) : (
          <div className="space-y-2.5">
            {evidenceLedger.map((entry) => (
              <div
                key={entry.id}
                className="p-4 rounded-lg border bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 dark:text-slate-100">
                      NOTE #{String(entry.index).padStart(2, '0')}
                    </span>
                    <span>·</span>
                    <span className="uppercase text-sky-600 dark:text-sky-400 font-semibold">
                      {entry.module}
                    </span>
                    <span>·</span>
                    <span>{entry.timestampUtc}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    <span>SHA-256: {entry.sha256Hash.slice(0, 16)}...</span>
                  </div>
                </div>

                <div className="mt-1.5 font-semibold text-slate-900 dark:text-slate-100 text-sm">
                  {entry.targetLabel}
                </div>
                <p className="mt-1 text-slate-600 dark:text-slate-400 leading-relaxed">
                  {entry.findingSummary}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
