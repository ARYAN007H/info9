import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Database,
  ExternalLink,
  FileSearch,
  Globe,
  Hash,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Wallet,
} from 'lucide-react';
import type {
  CollectedWebPage,
  InvestigationCase,
  ModuleId,
  ProvenanceMeta,
} from '../types/osint';
import { buildDorkMatrix } from '../utils/webIntelligence';
import { ProvenanceBadge } from './ProvenanceBadge';
import {
  Button,
  EmptyState,
  FieldLabel,
  NoticeBanner,
  Panel,
  PivotChip,
  SegmentedTabs,
  TextField,
  Well,
} from './ui';

interface WebSearchHit {
  id: string;
  source: string;
  title: string;
  url: string;
  snippet: string;
  publishedAtUtc: string | null;
  author: string | null;
  domain: string;
}

interface UniversalSearchResponse {
  query: string;
  hits: WebSearchHit[];
  sourceSummary: Array<{
    source: string;
    count: number;
    status: 'ok' | 'empty' | 'error';
    note?: string;
  }>;
  fetchedAtUtc: string;
}

interface FtsSearchHit {
  id: string;
  caseId: string;
  url: string;
  domain: string;
  title: string;
  sha256: string;
  fetchedAtUtc: string;
  snippet: string;
}

interface WebHunterModuleProps {
  activeCase: InvestigationCase;
  pendingAction?: {
    targetValue: string;
    subMode?: string;
    nonce: number;
  } | null;
  onCommitCollectedPage: (page: CollectedWebPage) => void;
  onCommitLedger: (entry: {
    module: ModuleId;
    targetLabel: string;
    sourceUrl: string;
    findingSummary: string;
    provenance: ProvenanceMeta;
  }) => void;
  onPivotToModule: (moduleId: ModuleId, targetValue: string, subMode?: string) => void;
}

type HunterTab = 'search' | 'extract' | 'dorks' | 'archive';

const ALL_SOURCES = [
  'GDELT',
  'HackerNews',
  'Reddit',
  'Bluesky',
  'Mastodon',
  'GitHub',
  'InternetArchive',
  'CommonCrawl',
];

export const WebHunterModule: React.FC<WebHunterModuleProps> = ({
  activeCase,
  pendingAction,
  onCommitCollectedPage,
  onCommitLedger,
  onPivotToModule,
}) => {
  const [tab, setTab] = useState<HunterTab>('search');

  // Universal Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [enabledSources, setEnabledSources] = useState<string[]>(ALL_SOURCES);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResult, setSearchResult] = useState<UniversalSearchResponse | null>(null);

  // Live Page Extractor state
  const [extractUrl, setExtractUrl] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractedPage, setExtractedPage] = useState<CollectedWebPage | null>(null);
  const [extractHeaders, setExtractHeaders] = useState<{
    server: string | null;
    poweredBy: string | null;
    contentType: string | null;
  } | null>(null);

  // Dork Matrix state
  const [dorkTarget, setDorkTarget] = useState('');

  // Local SQLite FTS5 Archive Search state
  const [ftsQuery, setFtsQuery] = useState('');
  const [ftsLoading, setFtsLoading] = useState(false);
  const [ftsHits, setFtsHits] = useState<FtsSearchHit[] | null>(null);

  const dorks = useMemo(() => buildDorkMatrix(dorkTarget), [dorkTarget]);

  const runSearch = async (queryOverride?: string) => {
    const q = (queryOverride ?? searchQuery).trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    try {
      const qs = new URLSearchParams({
        q,
        sources: enabledSources.join(','),
      });
      const res = await fetch(`/api/osint/web-search?${qs.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setSearchResult(data as UniversalSearchResponse);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const runExtract = async (urlOverride?: string) => {
    const raw = (urlOverride ?? extractUrl).trim();
    if (!raw) return;
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    setExtractUrl(normalized);
    setExtracting(true);
    setExtractError(null);
    try {
      const res = await fetch('/api/osint/web-extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: normalized, caseId: activeCase.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setExtractedPage(data.page as CollectedWebPage);
      setExtractHeaders(data.headers || null);
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : 'Extraction failed');
    } finally {
      setExtracting(false);
    }
  };

  const runFtsSearch = async () => {
    const q = ftsQuery.trim();
    if (!q) {
      setFtsHits([]);
      return;
    }
    setFtsLoading(true);
    try {
      const qs = new URLSearchParams({ q, caseId: activeCase.id });
      const res = await fetch(`/api/db/search?${qs.toString()}`);
      const data = await res.json();
      setFtsHits(Array.isArray(data.hits) ? data.hits : []);
    } catch {
      setFtsHits([]);
    } finally {
      setFtsLoading(false);
    }
  };

  useEffect(() => {
    if (!pendingAction?.targetValue) return;
    const target = pendingAction.targetValue;
    if (pendingAction.subMode === 'extract') {
      setTab('extract');
      setExtractUrl(target);
      void runExtract(target);
    } else if (pendingAction.subMode === 'dorks') {
      setTab('dorks');
      setDorkTarget(target);
    } else {
      setTab('search');
      setSearchQuery(target);
      setDorkTarget(target);
      void runSearch(target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAction?.nonce]);

  const toggleSource = (src: string) => {
    setEnabledSources((prev) =>
      prev.includes(src)
        ? prev.length > 1
          ? prev.filter((s) => s !== src)
          : prev
        : [...prev, src]
    );
  };

  const commitPageToCase = (page: CollectedWebPage) => {
    onCommitCollectedPage(page);
    onCommitLedger({
      module: 'webhunter',
      targetLabel: page.domain || page.url,
      sourceUrl: page.url,
      findingSummary: `Archived page "${page.title}" (SHA-256 ${page.sha256.slice(0, 12)}…) · ${page.artifacts.emails.length} email(s), ${page.artifacts.analyticsIds.length} tracker(s), ${page.artifacts.cryptoWallets.length} wallet(s), favicon hash ${page.artifacts.faviconHash ?? 'n/a'}.`,
      provenance: page.provenance,
    });
  };

  const savedPages = activeCase.collectedPages ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="signage text-[10px] font-semibold text-accent">10</span>
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">
              Web Hunter — Universal Discovery &amp; Live Page Intelligence
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-muted">
            Zero-key multi-source open-web search, automated Dork Matrix, SSRF-guarded artifact &amp; MurmurHash3 favicon extractor, and SQLite FTS5 case archive.
          </p>
        </div>
        <SegmentedTabs
          value={tab}
          onChange={(v) => setTab(v as HunterTab)}
          items={[
            { id: 'search', label: 'Universal Search' },
            { id: 'extract', label: 'Live Page Extractor' },
            { id: 'dorks', label: 'Dork Matrix' },
            { id: 'archive', label: `FTS5 Archive (${savedPages.length})` },
          ]}
        />
      </div>

      {/* TAB 1: UNIVERSAL MULTI-SOURCE SEARCH */}
      {tab === 'search' && (
        <div className="space-y-4">
          <Panel title="Multi-Source Open-Web Aggregator">
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void runSearch();
              }}
            >
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1">
                  <FieldLabel htmlFor="wh-search-input">
                    Target Keyword, Domain, Person, Wallet, or Organization
                  </FieldLabel>
                  <TextField
                    id="wh-search-input"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder='e.g. "bellingcat", "example.org", "0x742d35..."'
                  />
                </div>
                <div className="flex items-end">
                  <Button type="submit" variant="primary" disabled={searching || !searchQuery.trim()}>
                    {searching ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Hunting…
                      </>
                    ) : (
                      <>
                        <Search className="w-3.5 h-3.5" />
                        Run Universal Hunt
                      </>
                    )}
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted mr-1">
                  Sources:
                </span>
                {ALL_SOURCES.map((src) => {
                  const active = enabledSources.includes(src);
                  return (
                    <button
                      key={src}
                      type="button"
                      onClick={() => toggleSource(src)}
                      className={`px-2 py-0.5 rounded-[2px] border font-mono text-[10px] transition-colors ${
                        active
                          ? 'bg-accent/15 border-accent/50 text-accent'
                          : 'bg-well border-rule text-muted hover:text-ink'
                      }`}
                    >
                      {src}
                    </button>
                  );
                })}
              </div>
            </form>

            {searchError && (
              <div className="mt-3">
                <NoticeBanner tone="danger">{searchError}</NoticeBanner>
              </div>
            )}
          </Panel>

          {searchResult && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5">
                  {searchResult.sourceSummary.map((s) => (
                    <span
                      key={s.source}
                      className={`px-2 py-0.5 rounded-[2px] border font-mono text-[10px] ${
                        s.status === 'ok'
                          ? 'border-live/40 bg-live/10 text-live'
                          : s.status === 'empty'
                          ? 'border-rule bg-well text-muted'
                          : 'border-gap/40 bg-gap/10 text-gap'
                      }`}
                      title={s.note}
                    >
                      {s.source}: {s.status === 'error' ? 'gap' : s.count}
                    </span>
                  ))}
                </div>
                <ProvenanceBadge
                  provenance={{
                    status: 'LIVE',
                    source: `Universal Aggregator (${searchResult.hits.length} hits)`,
                    fetchedAtUtc: searchResult.fetchedAtUtc,
                  }}
                />
              </div>

              {searchResult.hits.length === 0 ? (
                <EmptyState
                  icon={<Globe className="w-5 h-5" />}
                  title="No public hits returned across selected feeds"
                  body="Try broadening the query or pivoting into the Dork Matrix tab for targeted search-engine operators."
                />
              ) : (
                <div className="grid grid-cols-1 gap-2">
                  {searchResult.hits.map((hit) => (
                    <Well key={hit.id} className="p-3 space-y-1.5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="px-1.5 py-0.5 rounded-[2px] bg-surface border border-rule font-mono text-[10px] text-accent">
                              {hit.source}
                            </span>
                            <a
                              href={hit.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs font-semibold text-ink hover:text-accent underline-offset-2 hover:underline inline-flex items-center gap-1"
                            >
                              {hit.title}
                              <ExternalLink className="w-3 h-3 shrink-0" />
                            </a>
                          </div>
                          <div className="font-mono text-[10px] text-muted truncate mt-0.5">
                            {hit.url}
                            {hit.publishedAtUtc ? ` · ${hit.publishedAtUtc.slice(0, 10)}` : ''}
                            {hit.author ? ` · ${hit.author}` : ''}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setTab('extract');
                              setExtractUrl(hit.url);
                              void runExtract(hit.url);
                            }}
                          >
                            <FileSearch className="w-3 h-3" />
                            Extract Intel
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              onCommitLedger({
                                module: 'webhunter',
                                targetLabel: hit.title.slice(0, 60),
                                sourceUrl: hit.url,
                                findingSummary: `[${hit.source}] ${hit.snippet || hit.title}`,
                                provenance: {
                                  status: 'LIVE',
                                  source: `Web Hunter (${hit.source})`,
                                  fetchedAtUtc: searchResult.fetchedAtUtc,
                                },
                              })
                            }
                          >
                            <Plus className="w-3 h-3" />
                            Log
                          </Button>
                        </div>
                      </div>
                      {hit.snippet && (
                        <p className="text-[11px] text-muted leading-relaxed">{hit.snippet}</p>
                      )}
                    </Well>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: LIVE PAGE INTELLIGENCE EXTRACTOR */}
      {tab === 'extract' && (
        <div className="space-y-4">
          <Panel title="SSRF-Guarded Live Page Intelligence Extractor">
            <form
              className="flex flex-col sm:flex-row gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void runExtract();
              }}
            >
              <div className="flex-1">
                <FieldLabel htmlFor="wh-extract-url">Public Target URL (http/https)</FieldLabel>
                <TextField
                  id="wh-extract-url"
                  value={extractUrl}
                  onChange={(e) => setExtractUrl(e.target.value)}
                  placeholder="https://example.org"
                />
              </div>
              <div className="flex items-end">
                <Button type="submit" variant="primary" disabled={extracting || !extractUrl.trim()}>
                  {extracting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Extracting…
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      Fetch &amp; Extract Artifacts
                    </>
                  )}
                </Button>
              </div>
            </form>
            <p className="mt-2 font-mono text-[10px] text-muted">
              Server-side DNS + IP SSRF guard blocks loopback, RFC1918, and cloud metadata. Extracts emails, phones, handles, BTC/ETH/TRC20 wallets, GA4/UA/GTM/AdSense IDs, outbound domains, Shodan MurmurHash3 favicon hash, and archives SHA-256 + full text to SQLite FTS5.
            </p>
            {extractError && (
              <div className="mt-3">
                <NoticeBanner tone="danger">{extractError}</NoticeBanner>
              </div>
            )}
          </Panel>

          {extractedPage && (
            <Panel
              title={extractedPage.title || extractedPage.domain}
              actions={
                <div className="flex items-center gap-2">
                  <ProvenanceBadge provenance={extractedPage.provenance} />
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => commitPageToCase(extractedPage)}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Commit Page &amp; Graph Links
                  </Button>
                </div>
              }
            >
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2 font-mono text-[11px]">
                  <Well className="p-2.5">
                    <div className="text-[10px] text-muted uppercase">SHA-256 Digest</div>
                    <div className="text-ink truncate mt-0.5" title={extractedPage.sha256}>
                      {extractedPage.sha256.slice(0, 20)}…
                    </div>
                  </Well>
                  <Well className="p-2.5">
                    <div className="text-[10px] text-muted uppercase">HTTP / Server</div>
                    <div className="text-ink truncate mt-0.5">
                      {extractedPage.httpStatus} · {extractHeaders?.server || 'undisclosed'}
                    </div>
                  </Well>
                  <Well className="p-2.5">
                    <div className="text-[10px] text-muted uppercase">Shodan Favicon Hash</div>
                    <div className="text-accent mt-0.5 flex items-center gap-1.5">
                      <Hash className="w-3 h-3" />
                      {extractedPage.artifacts.faviconHash !== null ? (
                        <a
                          href={`https://www.shodan.io/search?query=http.favicon.hash:${extractedPage.artifacts.faviconHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline hover:text-ink"
                        >
                          {extractedPage.artifacts.faviconHash}
                        </a>
                      ) : (
                        <span className="text-muted">Not detected</span>
                      )}
                    </div>
                  </Well>
                  <Well className="p-2.5">
                    <div className="text-[10px] text-muted uppercase">Meta Author / Tech</div>
                    <div className="text-ink truncate mt-0.5">
                      {[extractedPage.artifacts.metaAuthor, extractedPage.artifacts.metaGenerator]
                        .filter(Boolean)
                        .join(' · ') || 'None disclosed'}
                    </div>
                  </Well>
                </div>

                {/* Pivotable extracted artifact chips */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Well className="p-3 space-y-2">
                    <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted">
                      Emails ({extractedPage.artifacts.emails.length}) · Phones ({extractedPage.artifacts.phones.length}) · Handles ({extractedPage.artifacts.handles.length})
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {extractedPage.artifacts.emails.map((em) => (
                        <PivotChip
                          key={em}
                          label={em}
                          hint="Email Recon"
                          onClick={() => onPivotToModule('identity', em, 'email')}
                        />
                      ))}
                      {extractedPage.artifacts.phones.map((ph) => (
                        <PivotChip
                          key={ph}
                          label={ph}
                          hint="Phone Recon"
                          onClick={() => onPivotToModule('identity', ph, 'phone')}
                        />
                      ))}
                      {extractedPage.artifacts.handles.slice(0, 12).map((h) => (
                        <PivotChip
                          key={h}
                          label={`@${h}`}
                          hint="Profile Enrich"
                          onClick={() => onPivotToModule('identity', h, 'username')}
                        />
                      ))}
                      {extractedPage.artifacts.emails.length === 0 &&
                        extractedPage.artifacts.phones.length === 0 &&
                        extractedPage.artifacts.handles.length === 0 && (
                          <span className="text-xs text-muted">No contact identifiers found on page.</span>
                        )}
                    </div>
                  </Well>

                  <Well className="p-3 space-y-2">
                    <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted">
                      Analytics Trackers ({extractedPage.artifacts.analyticsIds.length}) · Crypto Wallets ({extractedPage.artifacts.cryptoWallets.length})
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {extractedPage.artifacts.analyticsIds.map((t) => (
                        <a
                          key={`${t.kind}:${t.id}`}
                          href={`https://dnslytics.com/reverse-analytics/${encodeURIComponent(t.id)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2 py-0.5 rounded-[2px] border border-accent/40 bg-accent/10 font-mono text-[11px] text-accent inline-flex items-center gap-1 hover:bg-accent/20"
                        >
                          {t.kind}: {t.id}
                          <ArrowUpRight className="w-3 h-3" />
                        </a>
                      ))}
                      {extractedPage.artifacts.cryptoWallets.map((w) => (
                        <PivotChip
                          key={`${w.chain}:${w.address}`}
                          label={`${w.chain}: ${w.address.slice(0, 14)}…`}
                          hint="Trace Wallet"
                          onClick={() => onPivotToModule('sanctions', w.address, 'crypto')}
                        />
                      ))}
                      {extractedPage.artifacts.analyticsIds.length === 0 &&
                        extractedPage.artifacts.cryptoWallets.length === 0 && (
                          <span className="text-xs text-muted">No tracking IDs or wallet addresses detected.</span>
                        )}
                    </div>
                  </Well>
                </div>

                {extractedPage.artifacts.outboundDomains.length > 0 && (
                  <Well className="p-3 space-y-2">
                    <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted">
                      Outbound Linked Domains ({extractedPage.artifacts.outboundDomains.length})
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {extractedPage.artifacts.outboundDomains.slice(0, 20).map((dom) => (
                        <PivotChip
                          key={dom}
                          label={dom}
                          hint="Infra Scan"
                          onClick={() => onPivotToModule('infra', dom)}
                        />
                      ))}
                    </div>
                  </Well>
                )}

                <Well className="p-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted mb-1">
                    Extracted Text Excerpt (Indexed in SQLite FTS5)
                  </div>
                  <p className="text-xs text-muted leading-relaxed">{extractedPage.excerpt}</p>
                </Well>
              </div>
            </Panel>
          )}
        </div>
      )}

      {/* TAB 3: AUTOMATED DORK MATRIX */}
      {tab === 'dorks' && (
        <div className="space-y-4">
          <Panel title="Automated OSINT Dork Matrix">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1">
                <FieldLabel htmlFor="wh-dork-target">Target Domain, Person, or Organization</FieldLabel>
                <TextField
                  id="wh-dork-target"
                  value={dorkTarget}
                  onChange={(e) => setDorkTarget(e.target.value)}
                  placeholder="e.g. example.org or Meridian Maritime Holdings"
                />
              </div>
            </div>
          </Panel>

          {dorks.length === 0 ? (
            <EmptyState
              icon={<Search className="w-5 h-5" />}
              title="Enter a domain or entity name to build a Dork Matrix"
              body="Generates categorized filetype, open directory, paste/leak, court/SEC, code repository, and Telegram/Reddit dork queries ready to launch."
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {dorks.map((d) => (
                <Well key={d.id} className="p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-accent">
                      {d.category}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <a
                        href={d.duckDuckGoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2 py-0.5 rounded-[2px] border border-rule bg-surface font-mono text-[10px] text-ink hover:border-accent"
                      >
                        DuckDuckGo ↗
                      </a>
                      <a
                        href={d.googleUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2 py-0.5 rounded-[2px] border border-rule bg-surface font-mono text-[10px] text-ink hover:border-accent"
                      >
                        Google ↗
                      </a>
                    </div>
                  </div>
                  <div className="text-xs font-medium text-ink">{d.label}</div>
                  <code className="block p-2 rounded-[2px] bg-surface border border-rule font-mono text-[11px] text-muted break-all">
                    {d.query}
                  </code>
                </Well>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: SQLITE FTS5 CASE ARCHIVE */}
      {tab === 'archive' && (
        <div className="space-y-4">
          <Panel title="SQLite FTS5 Full-Text Search Across Captured Pages">
            <form
              className="flex flex-col sm:flex-row gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void runFtsSearch();
              }}
            >
              <div className="flex-1">
                <FieldLabel htmlFor="wh-fts-query">Full-Text Query (titles, page text, emails, trackers, wallets)</FieldLabel>
                <TextField
                  id="wh-fts-query"
                  value={ftsQuery}
                  onChange={(e) => setFtsQuery(e.target.value)}
                  placeholder="Search captured pages in this case…"
                />
              </div>
              <div className="flex items-end">
                <Button type="submit" variant="primary" disabled={ftsLoading || !ftsQuery.trim()}>
                  {ftsLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
                  Search FTS5
                </Button>
              </div>
            </form>

            {ftsHits !== null && (
              <div className="mt-3 space-y-2">
                <div className="font-mono text-[10px] uppercase text-muted">
                  {ftsHits.length} FTS5 match(es)
                </div>
                {ftsHits.map((h) => (
                  <Well key={h.id} className="p-2.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <a
                        href={h.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-semibold text-ink hover:text-accent"
                      >
                        {h.title}
                      </a>
                      <span className="font-mono text-[10px] text-muted">
                        SHA-256 {h.sha256.slice(0, 10)}…
                      </span>
                    </div>
                    <p className="text-[11px] text-muted font-mono">{h.snippet}</p>
                  </Well>
                ))}
              </div>
            )}
          </Panel>

          <Panel title={`Committed Pages in Active Case (${savedPages.length})`}>
            {savedPages.length === 0 ? (
              <EmptyState
                icon={<Wallet className="w-5 h-5" />}
                title="No web pages archived in this case yet"
                body="Use the Live Page Extractor tab to capture any URL, hash it with SHA-256, index it in SQLite FTS5, and wire its extracted emails/trackers/wallets into the entity graph."
              />
            ) : (
              <div className="space-y-2">
                {savedPages.map((pg) => (
                  <Well key={pg.id} className="p-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-ink truncate">{pg.title}</div>
                      <div className="font-mono text-[10px] text-muted truncate">
                        {pg.url} · SHA-256 {pg.sha256.slice(0, 12)}… · {pg.artifacts.emails.length} emails · {pg.artifacts.analyticsIds.length} trackers · {pg.artifacts.cryptoWallets.length} wallets
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setExtractedPage(pg);
                        setTab('extract');
                      }}
                    >
                      Inspect
                    </Button>
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
