import React, { useMemo, useState } from 'react';
import { BookmarkPlus, Download, ListChecks, Search, ShieldCheck } from 'lucide-react';
import {
  Button,
  NoticeBanner,
  Panel,
  SegmentedTabs,
  TextField,
  Well,
} from './ui';
import ProvenanceBadge from './ProvenanceBadge';
import { MODULE_CATALOG } from './moduleCatalog';
import { fetchOfacSdnList } from '../services/osintApis';
import { scoreSanctionsCandidate } from '../utils/osintForensics';
import {
  buildTrigramCandidateIndex,
  parseBatchScreeningInput,
  queryTrigramIndex,
} from '../utils/sanctionsData';
import type { SanctionsMatchWeights } from '../types/osint';

const DEFAULT_WEIGHTS: SanctionsMatchWeights = {
  namePhoneticWeight: 40,
  dobExactWeight: 30,
  jurisdictionWeight: 20,
  aliasOverlapWeight: 10,
};

interface ScoredHit {
  queryTarget?: string;
  listedName: string;
  identifierCode: string;
  program: string;
  entityType: string;
  dobOrIncorporation: string;
  compositeScore: number;
  disposition: string;
}

interface OfacLiveScreeningProps {
  onRecordHit?: (hit: ScoredHit) => void;
}

export function OfacLiveScreening({ onRecordHit }: OfacLiveScreeningProps) {
  const [mode, setMode] = useState<'single' | 'batch'>('single');
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [batchText, setBatchText] = useState(
    'Viktor Alekseyevich Morozov, 1968-04-14, Russia\nVega Maritime Holdings, , Marshall Islands'
  );
  const [isScreening, setIsScreening] = useState(false);
  const [progressNote, setProgressNote] = useState<string | null>(null);
  const [hits, setHits] = useState<ScoredHit[] | null>(null);
  const [listInfo, setListInfo] = useState<{
    count: number;
    fetchedAt: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleScreen = async () => {
    if (isScreening) return;
    if (mode === 'single' && !name.trim()) return;
    const batchRows =
      mode === 'batch'
        ? parseBatchScreeningInput(batchText)
        : [
            {
              targetName: name.trim(),
              targetDob: dob.trim(),
              targetJurisdiction: '',
            },
          ];
    if (batchRows.length === 0) return;

    setIsScreening(true);
    setError(null);
    setProgressNote('Downloading live OFAC SDN list (~6 MB, cached after first run)...');
    try {
      const list = await fetchOfacSdnList();
      setListInfo({ count: list.count, fetchedAt: list.fetchedAt });
      setProgressNote(
        `Indexing ${list.count.toLocaleString()} live records with 3-gram trigram index & scoring ${batchRows.length} target(s)...`
      );
      await new Promise((r) => setTimeout(r, 20));

      const trigramIdx = buildTrigramCandidateIndex(list.candidates);
      const aggregated: ScoredHit[] = [];

      for (const row of batchRows) {
        const shortlist =
          batchRows.length > 1
            ? queryTrigramIndex(trigramIdx, row.targetName, 300)
            : list.candidates;

        const rowHits = shortlist
          .map((candidate) => {
            const res = scoreSanctionsCandidate(
              {
                targetName: row.targetName,
                targetDob: row.targetDob,
                targetJurisdiction: row.targetJurisdiction,
              },
              candidate,
              DEFAULT_WEIGHTS
            );
            return {
              queryTarget: row.targetName,
              listedName: candidate.listedName,
              identifierCode: candidate.identifierCode,
              program: candidate.program,
              entityType: candidate.entityType,
              dobOrIncorporation: candidate.dobOrIncorporation,
              compositeScore: res.compositeScore,
              disposition: res.disposition,
            };
          })
          .filter((h) => h.compositeScore >= 38)
          .sort((a, b) => b.compositeScore - a.compositeScore)
          .slice(0, mode === 'batch' ? 3 : 25);

        aggregated.push(...rowHits);
      }

      aggregated.sort((a, b) => b.compositeScore - a.compositeScore);
      setHits(aggregated.slice(0, 40));
      setProgressNote(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Live screening failed');
      setProgressNote(null);
    } finally {
      setIsScreening(false);
    }
  };

  const listProvenance = useMemo(
    () =>
      listInfo
        ? {
            status: 'LIVE' as const,
            source: `OFAC SDN CSV · ${listInfo.count.toLocaleString()} records (Trigram-indexed)`,
            fetchedAtUtc: listInfo.fetchedAt,
            note: 'Screened locally; name+DOB heuristic.',
          }
        : null,
    [listInfo]
  );

  return (
    <Panel
      tag={MODULE_CATALOG.sanctions.num}
      title="Watchlist — live OFAC SDN & batch CSV screening"
      description="Score a single name or a batch CSV list of up to 100 entities/directors against the real U.S. Treasury SDN list — zero keys."
      actions={
        <SegmentedTabs
          size="sm"
          ariaLabel="Screening input mode"
          tabs={[
            { id: 'single', label: 'Single target' },
            { id: 'batch', label: 'Batch CSV / multi-line' },
          ]}
          active={mode}
          onChange={(id) => {
            setMode(id);
            setHits(null);
          }}
        />
      }
    >
      <div className="space-y-3">
        {mode === 'single' ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_160px_auto]">
            <TextField
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleScreen();
              }}
              placeholder="Full name as it might be listed (any script)"
              className="font-mono"
            />
            <TextField
              type="text"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              placeholder="DOB (optional)"
              className="font-mono"
            />
            <Button
              variant="primary"
              icon={<Search className="h-4 w-4" />}
              onClick={handleScreen}
              disabled={!name.trim() || isScreening}
            >
              {isScreening ? 'Screening…' : 'Screen live list'}
            </Button>
          </div>
        ) : (
          <Well className="space-y-2.5 p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-ink">
                Paste one entity or person per line (`Name, DOB, Country` or just `Name`)
              </span>
              <span className="font-mono text-[11px] text-ink-3">
                {parseBatchScreeningInput(batchText).length} row(s) ready
              </span>
            </div>
            <textarea
              rows={4}
              value={batchText}
              onChange={(e) => setBatchText(e.target.value)}
              placeholder="Name, YYYY-MM-DD, Country"
              className="w-full rounded border border-line bg-panel p-2.5 font-mono text-xs text-ink focus:border-accent focus:outline-none"
            />
            <div className="flex justify-end">
              <Button
                variant="primary"
                icon={<ListChecks className="h-4 w-4" />}
                onClick={handleScreen}
                disabled={
                  parseBatchScreeningInput(batchText).length === 0 || isScreening
                }
              >
                {isScreening
                  ? 'Batch screening…'
                  : `Screen ${parseBatchScreeningInput(batchText).length} target(s)`}
              </Button>
            </div>
          </Well>
        )}

        {error && (
          <NoticeBanner tone="danger" title="Live screening unavailable">
            {error}
          </NoticeBanner>
        )}

        {progressNote && (
          <div className="font-mono text-[11px] text-ink-3">{progressNote}</div>
        )}

        {listProvenance && !progressNote && (
          <div className="flex flex-wrap items-center gap-2">
            <ProvenanceBadge meta={listProvenance} />
            {hits && (
              <span className="font-mono text-[11px] text-ink-3">
                {hits.length} candidate hit(s) above threshold
              </span>
            )}
          </div>
        )}

        {hits && hits.length > 0 && (
          <div className="overflow-x-auto rounded border border-line">
            <table className="w-full text-left text-xs">
              <thead className="bg-well font-mono text-[10px] uppercase tracking-wide text-ink-3">
                <tr>
                  <th className="px-3 py-2">Score</th>
                  {mode === 'batch' && <th className="px-3 py-2">Query</th>}
                  <th className="px-3 py-2">Listed name</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Program</th>
                  <th className="px-3 py-2">DOB/Incorp.</th>
                  <th className="px-3 py-2">Entry</th>
                  {onRecordHit && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-line font-mono tabular-nums">
                {hits.map((hit, idx) => (
                  <tr
                    key={`${hit.identifierCode}-${idx}`}
                    className="text-ink-2 hover:bg-well/50"
                  >
                    <td className="px-3 py-2 font-bold text-ink">
                      {hit.compositeScore.toFixed(0)}%
                    </td>
                    {mode === 'batch' && (
                      <td className="px-3 py-2 text-accent">
                        {hit.queryTarget}
                      </td>
                    )}
                    <td className="px-3 py-2 text-ink">{hit.listedName}</td>
                    <td className="px-3 py-2">{hit.entityType}</td>
                    <td className="px-3 py-2">{hit.program}</td>
                    <td className="px-3 py-2">
                      {hit.dobOrIncorporation || '—'}
                    </td>
                    <td className="px-3 py-2">{hit.identifierCode}</td>
                    {onRecordHit && (
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onRecordHit(hit)}
                        >
                          <BookmarkPlus className="h-3 w-3" /> Record
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {hits && hits.length === 0 && !progressNote && (
          <div className="font-mono text-[11px] text-ink-3">
            No records scored above the display threshold. Near-miss spelling
            variants are worth a manual check on the Treasury site.
          </div>
        )}

        <div className="flex items-start gap-2 text-[11px] text-ink-3">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Screening runs entirely against the official{' '}
            <a
              href="https://ofac.treasury.gov/specially-designated-nationals-and-blocked-persons-list-sdn-human-readable-lists"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-ink"
            >
              OFAC SDN publication <Download className="inline h-3 w-3" />
            </a>
            . A high score is a lead, not a determination — confirm against the
            official entry before acting on it.
          </span>
        </div>
      </div>
    </Panel>
  );
}
