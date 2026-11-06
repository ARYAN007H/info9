import React, { useMemo, useState } from 'react';
import { Download, Search, ShieldCheck } from 'lucide-react';
import { Panel, Button, NoticeBanner, TextField } from './ui';
import ProvenanceBadge from './ProvenanceBadge';
import { MODULE_CATALOG } from './moduleCatalog';
import { fetchOfacSdnList } from '../services/osintApis';
import { scoreSanctionsCandidate } from '../utils/osintForensics';
import type { SanctionsMatchWeights } from '../types/osint';

/**
 * LIVE OFAC SDN screening — the real U.S. Treasury Specially Designated
 * Nationals list (free public data), downloaded and parsed by the local
 * server, scored locally with the same disclosed matcher as the demo set.
 * Name-and-DOB matching against ~20k current records, zero API keys.
 */

const DEFAULT_WEIGHTS: SanctionsMatchWeights = {
  namePhoneticWeight: 40,
  dobExactWeight: 30,
  jurisdictionWeight: 20,
  aliasOverlapWeight: 10,
};

interface ScoredHit {
  listedName: string;
  identifierCode: string;
  program: string;
  entityType: string;
  dobOrIncorporation: string;
  compositeScore: number;
  disposition: string;
}

export function OfacLiveScreening() {
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [isScreening, setIsScreening] = useState(false);
  const [progressNote, setProgressNote] = useState<string | null>(null);
  const [hits, setHits] = useState<ScoredHit[] | null>(null);
  const [listInfo, setListInfo] = useState<{
    count: number;
    fetchedAt: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleScreen = async () => {
    const cleaned = name.trim();
    if (!cleaned || isScreening) return;
    setIsScreening(true);
    setError(null);
    setProgressNote('Downloading live OFAC SDN list (~6 MB, first run only)...');
    try {
      const list = await fetchOfacSdnList();
      setListInfo({ count: list.count, fetchedAt: list.fetchedAt });
      setProgressNote(
        `Scoring "${cleaned}" against ${list.count.toLocaleString()} live records...`
      );
      // Yield to the browser so the progress note paints before the heavy loop.
      await new Promise((r) => setTimeout(r, 30));
      const scored: ScoredHit[] = list.candidates
        .map((candidate) => {
          const res = scoreSanctionsCandidate(
            { targetName: cleaned, targetDob: dob.trim(), targetJurisdiction: '' },
            candidate,
            DEFAULT_WEIGHTS
          );
          return {
            listedName: candidate.listedName,
            identifierCode: candidate.identifierCode,
            program: candidate.program,
            entityType: candidate.entityType,
            dobOrIncorporation: candidate.dobOrIncorporation,
            compositeScore: res.compositeScore,
            disposition: res.disposition,
          };
        })
        .filter((h) => h.compositeScore >= 35)
        .sort((a, b) => b.compositeScore - a.compositeScore)
        .slice(0, 25);
      setHits(scored);
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
            source: `OFAC SDN CSV · ${listInfo.count.toLocaleString()} records`,
            fetchedAtUtc: listInfo.fetchedAt,
            note: 'Screened locally; name+DOB heuristic. Aliases file not parsed — check near-misses manually.',
          }
        : null,
    [listInfo]
  );

  return (
    <Panel
      tag={MODULE_CATALOG.sanctions.num}
      title="Live OFAC SDN screening"
      description="Score a name against the real U.S. Treasury SDN list — free public data, screened locally, zero keys."
    >
      <div className="space-y-3">
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
                {hits.length} candidate hit(s) above threshold (35)
              </span>
            )}
          </div>
        )}

        {hits && hits.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-left text-xs">
              <thead className="bg-well font-mono text-[10px] uppercase tracking-wide text-ink-3">
                <tr>
                  <th className="px-3 py-2">Score</th>
                  <th className="px-3 py-2">Listed name</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Program</th>
                  <th className="px-3 py-2">DOB/Incorp.</th>
                  <th className="px-3 py-2">Entry</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line font-mono tabular-nums">
                {hits.map((hit) => (
                  <tr key={hit.identifierCode} className="text-ink-2">
                    <td className="px-3 py-2 font-bold text-ink">
                      {hit.compositeScore.toFixed(0)}
                    </td>
                    <td className="px-3 py-2 text-ink">{hit.listedName}</td>
                    <td className="px-3 py-2">{hit.entityType}</td>
                    <td className="px-3 py-2">{hit.program}</td>
                    <td className="px-3 py-2">{hit.dobOrIncorporation || '—'}</td>
                    <td className="px-3 py-2">{hit.identifierCode}</td>
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
