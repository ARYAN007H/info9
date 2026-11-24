import React, { useState } from 'react';
import {
  Anchor,
  Building2,
  ExternalLink,
  Loader2,
  Plus,
  Scale,
  Search,
  ShieldAlert,
} from 'lucide-react';
import type { ModuleId, ProvenanceMeta } from '../types/osint';
import {
  Button,
  FieldLabel,
  NoticeBanner,
  Panel,
  SegmentedTabs,
  TextField,
  Well,
} from './ui';

interface PublicRecordHit {
  id: string;
  source: string;
  title: string;
  subtitle: string;
  dateUtc: string | null;
  jurisdiction: string;
  url: string;
  identifiers: string[];
  snippet: string;
}

interface PublicRecordsSearchResult {
  query: string;
  hits: PublicRecordHit[];
  sourceSummary: Array<{
    source: string;
    count: number;
    status: 'ok' | 'empty' | 'gap';
    note?: string;
  }>;
  icijDirectSearchUrl: string;
  fetchedAtUtc: string;
}

interface MaritimeVesselResult {
  query: string;
  normalizedImo: string | null;
  normalizedMmsi: string | null;
  wikidataMatches: Array<{ qid: string; label: string; description: string; url: string }>;
  ofacVesselMatches: Array<{
    listedName: string;
    program: string;
    identifierCode: string;
    notes: string;
  }>;
  verificationLinks: Array<{ label: string; url: string }>;
  fetchedAtUtc: string;
}

interface PublicRecordsMaritimePanelProps {
  onCommitLedger: (entry: {
    module: ModuleId;
    targetLabel: string;
    sourceUrl: string;
    findingSummary: string;
    provenance: ProvenanceMeta;
  }) => void;
}

export const PublicRecordsMaritimePanel: React.FC<PublicRecordsMaritimePanelProps> = ({
  onCommitLedger,
}) => {
  const [subTab, setSubTab] = useState<'records' | 'maritime'>('records');

  // Public Records state
  const [recQuery, setRecQuery] = useState('');
  const [recLoading, setRecLoading] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
  const [recResult, setRecResult] = useState<PublicRecordsSearchResult | null>(null);

  // Maritime Vessel state
  const [vesselQuery, setVesselQuery] = useState('');
  const [vesselLoading, setVesselLoading] = useState(false);
  const [vesselError, setVesselError] = useState<string | null>(null);
  const [vesselResult, setVesselResult] = useState<MaritimeVesselResult | null>(null);

  const runPublicRecords = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recQuery.trim()) return;
    setRecLoading(true);
    setRecError(null);
    try {
      const res = await fetch(
        `/api/osint/public-records?q=${encodeURIComponent(recQuery.trim())}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setRecResult(data as PublicRecordsSearchResult);
    } catch (err) {
      setRecError(err instanceof Error ? err.message : 'Public records query failed');
    } finally {
      setRecLoading(false);
    }
  };

  const runVesselLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vesselQuery.trim()) return;
    setVesselLoading(true);
    setVesselError(null);
    try {
      const res = await fetch(
        `/api/osint/maritime/vessel?q=${encodeURIComponent(vesselQuery.trim())}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setVesselResult(data as MaritimeVesselResult);
    } catch (err) {
      setVesselError(err instanceof Error ? err.message : 'Vessel lookup failed');
    } finally {
      setVesselLoading(false);
    }
  };

  return (
    <Panel
      title="Global Public Records (SEC EDGAR · CourtListener · OpenSanctions · ICIJ) & Maritime AIS"
      actions={
        <SegmentedTabs
          value={subTab}
          onChange={(v) => setSubTab(v as 'records' | 'maritime')}
          items={[
            { id: 'records', label: 'Filings, Courts & Offshore' },
            { id: 'maritime', label: 'Maritime Vessel / IMO' },
          ]}
        />
      }
    >
      {subTab === 'records' && (
        <div className="space-y-3">
          <form onSubmit={runPublicRecords} className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1">
              <FieldLabel htmlFor="pr-query">
                Company, Executive, or Shell Name
              </FieldLabel>
              <TextField
                id="pr-query"
                value={recQuery}
                onChange={(e) => setRecQuery(e.target.value)}
                placeholder="e.g. Palantir, Gazprom, or offshore holding name"
              />
            </div>
            <div className="flex items-end">
              <Button type="submit" variant="primary" disabled={recLoading || !recQuery.trim()}>
                {recLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Scale className="w-3.5 h-3.5" />}
                Search Registries
              </Button>
            </div>
          </form>

          {recError && <NoticeBanner tone="danger">{recError}</NoticeBanner>}

          {recResult && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5">
                  {recResult.sourceSummary.map((s) => (
                    <span
                      key={s.source}
                      title={s.note}
                      className={`px-2 py-0.5 rounded-[2px] border font-mono text-[10px] ${
                        s.status === 'ok'
                          ? 'border-live/40 bg-live/10 text-live'
                          : s.status === 'empty'
                          ? 'border-rule bg-well text-muted'
                          : 'border-gap/40 bg-gap/10 text-gap'
                      }`}
                    >
                      {s.source}: {s.status === 'gap' ? 'gap' : s.count}
                    </span>
                  ))}
                </div>
                <a
                  href={recResult.icijDirectSearchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2 py-1 rounded-[2px] border border-accent/50 bg-accent/10 font-mono text-[10px] text-accent inline-flex items-center gap-1 hover:bg-accent/20"
                >
                  Search ICIJ Offshore Leaks (Panama/Pandora)
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              {recResult.hits.length === 0 ? (
                <div className="text-xs text-muted py-3">
                  No direct matches returned across SEC EDGAR, CourtListener, or OpenSanctions for "{recResult.query}".
                </div>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                  {recResult.hits.map((h) => (
                    <Well key={h.id} className="p-2.5 flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="px-1.5 py-0.5 rounded-[2px] bg-surface border border-rule font-mono text-[9px] text-accent">
                            {h.source}
                          </span>
                          <a
                            href={h.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-semibold text-ink hover:text-accent inline-flex items-center gap-1"
                          >
                            {h.title}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                        <div className="font-mono text-[10px] text-muted">
                          {h.subtitle}
                          {h.dateUtc ? ` · ${h.dateUtc}` : ''} · {h.jurisdiction}
                          {h.identifiers.length ? ` · ${h.identifiers.join(' / ')}` : ''}
                        </div>
                        <div className="text-[11px] text-muted">{h.snippet}</div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          onCommitLedger({
                            module: 'dossier',
                            targetLabel: h.title.slice(0, 60),
                            sourceUrl: h.url,
                            findingSummary: `[${h.source}] ${h.subtitle} — ${h.snippet}`,
                            provenance: {
                              status: 'LIVE',
                              source: h.source,
                              fetchedAtUtc: recResult.fetchedAtUtc,
                            },
                          })
                        }
                      >
                        <Plus className="w-3 h-3" />
                        Log
                      </Button>
                    </Well>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {subTab === 'maritime' && (
        <div className="space-y-3">
          <form onSubmit={runVesselLookup} className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1">
              <FieldLabel htmlFor="mv-query">Vessel Name, 7-Digit IMO, or 9-Digit MMSI</FieldLabel>
              <TextField
                id="mv-query"
                value={vesselQuery}
                onChange={(e) => setVesselQuery(e.target.value)}
                placeholder="e.g. IMO 9811000 or Ever Given"
              />
            </div>
            <div className="flex items-end">
              <Button type="submit" variant="primary" disabled={vesselLoading || !vesselQuery.trim()}>
                {vesselLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Anchor className="w-3.5 h-3.5" />}
                Screen Vessel
              </Button>
            </div>
          </form>

          {vesselError && <NoticeBanner tone="danger">{vesselError}</NoticeBanner>}

          {vesselResult && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 font-mono text-[11px]">
                <span className="px-2 py-0.5 rounded-[2px] bg-well border border-rule text-ink">
                  IMO: {vesselResult.normalizedImo ?? 'not detected'}
                </span>
                <span className="px-2 py-0.5 rounded-[2px] bg-well border border-rule text-ink">
                  MMSI: {vesselResult.normalizedMmsi ?? 'not detected'}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-[2px] border ${
                    vesselResult.ofacVesselMatches.length > 0
                      ? 'border-danger/50 bg-danger/10 text-danger'
                      : 'border-live/40 bg-live/10 text-live'
                  }`}
                >
                  OFAC SDN Vessel Hits: {vesselResult.ofacVesselMatches.length}
                </span>
              </div>

              {vesselResult.ofacVesselMatches.length > 0 && (
                <Well className="p-3 border-danger/50 space-y-1.5">
                  <div className="font-mono text-[10px] uppercase text-danger flex items-center gap-1">
                    <ShieldAlert className="w-3.5 h-3.5" />
                    OFAC Sanctioned Vessel Match(es)
                  </div>
                  {vesselResult.ofacVesselMatches.map((m, idx) => (
                    <div key={idx} className="text-xs text-ink">
                      <span className="font-semibold">{m.listedName}</span> ({m.program} · {m.identifierCode}) —{' '}
                      <span className="text-muted">{m.notes}</span>
                    </div>
                  ))}
                </Well>
              )}

              {vesselResult.wikidataMatches.length > 0 && (
                <div className="space-y-1.5">
                  <div className="font-mono text-[10px] uppercase text-muted">
                    Wikidata Maritime Records
                  </div>
                  {vesselResult.wikidataMatches.map((w) => (
                    <Well key={w.qid} className="p-2.5 flex items-center justify-between gap-2">
                      <div>
                        <a
                          href={w.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-semibold text-ink hover:text-accent inline-flex items-center gap-1"
                        >
                          <Building2 className="w-3 h-3" />
                          {w.label} ({w.qid})
                          <ExternalLink className="w-3 h-3" />
                        </a>
                        <div className="text-[11px] text-muted">{w.description}</div>
                      </div>
                    </Well>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-1.5">
                {vesselResult.verificationLinks.map((lnk) => (
                  <a
                    key={lnk.label}
                    href={lnk.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2.5 py-1 rounded-[2px] border border-rule bg-well font-mono text-[11px] text-ink hover:border-accent inline-flex items-center gap-1"
                  >
                    <Search className="w-3 h-3 text-accent" />
                    {lnk.label} ↗
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
};
