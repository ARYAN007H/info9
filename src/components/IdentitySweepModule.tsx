import React, { useMemo, useState } from 'react';
import {
  BookmarkPlus,
  CheckCircle2,
  CircleSlash,
  ExternalLink,
  HelpCircle,
  Search,
  UserSearch,
} from 'lucide-react';
import type { InvestigationCase } from '../types/osint';
import type { WnnSite } from '../utils/wnn';
import { fetchWnnDataset } from '../services/osintApis';
import {
  type SweepSiteResult,
  sweepUsername,
} from '../services/usernameSweep';
import { MODULE_CATALOG } from './moduleCatalog';
import {
  Button,
  DataLabel,
  DataValue,
  EmptyState,
  NoticeBanner,
  Panel,
  SelectField,
  TextField,
  Well,
} from './ui';

interface IdentitySweepModuleProps {
  activeCase: InvestigationCase;
  onAppendLedger: (entry: {
    module: 'identity';
    targetLabel: string;
    findingSummary: string;
    sourceUrl: string;
  }) => void;
}

const VERDICT_STYLES: Record<string, { chip: string; label: string }> = {
  FOUND: {
    chip: 'border-live/35 bg-live/10 text-live',
    label: 'FOUND',
  },
  NOT_FOUND: {
    chip: 'border-line bg-well text-ink-3',
    label: 'not found',
  },
  UNKNOWN: {
    chip: 'border-gap/40 bg-gap/10 text-gap',
    label: 'unknown',
  },
};

export const IdentitySweepModule: React.FC<IdentitySweepModuleProps> = ({
  activeCase,
  onAppendLedger,
}) => {
  const [username, setUsername] = useState('');
  const [sites, setSites] = useState<WnnSite[] | null>(null);
  const [datasetInfo, setDatasetInfo] = useState<{ count: number; fetchedAt: string } | null>(null);
  const [category, setCategory] = useState('all');
  const [isSweeping, setIsSweeping] = useState(false);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const [results, setResults] = useState<SweepSiteResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const categories = useMemo(() => {
    if (!sites) return [] as string[];
    return Array.from(new Set(sites.map((s) => s.category))).sort();
  }, [sites]);

  const loadDataset = async () => {
    setError(null);
    try {
      const data = await fetchWnnDataset();
      setSites(data.sites);
      setDatasetInfo({ count: data.count, fetchedAt: data.fetchedAt });
      return data.sites;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dataset load failed');
      return null;
    }
  };

  const handleSweep = async () => {
    const cleaned = username.trim();
    if (!cleaned || isSweeping) return;
    setIsSweeping(true);
    setError(null);
    setStatusMessage(null);
    let currentSites = sites;
    if (!currentSites) {
      setStatusMessage('Loading the WhatsMyName community dataset…');
      currentSites = await loadDataset();
      if (!currentSites) {
        setIsSweeping(false);
        return;
      }
    }
    const filtered =
      category === 'all'
        ? currentSites
        : currentSites.filter((s) => s.category === category);
    if (filtered.length === 0) {
      setError('No sites in that category');
      setIsSweeping(false);
      return;
    }
    setResults(null);
    setProgress({ completed: 0, total: filtered.length });
    setStatusMessage(`Sweeping "${cleaned}" across ${filtered.length} sites…`);
    try {
      const all = await sweepUsername(cleaned, filtered, (p) =>
        setProgress({ completed: p.completed, total: p.total })
      );
      const sorted = [...all].sort((a, b) => {
        const rank = (v: string) => (v === 'FOUND' ? 0 : v === 'UNKNOWN' ? 1 : 2);
        return rank(a.verdict) - rank(b.verdict) || a.site.name.localeCompare(b.site.name);
      });
      setResults(sorted);
      const found = sorted.filter((r) => r.verdict === 'FOUND');
      const unknown = sorted.filter((r) => r.verdict === 'UNKNOWN');
      setStatusMessage(
        `Sweep complete: ${found.length} account(s) found, ${unknown.length} unknown (blocked/captcha), ${sorted.length - found.length - unknown.length} not found. Verify each hit before recording it.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sweep failed');
    } finally {
      setIsSweeping(false);
      setProgress(null);
    }
  };

  const handleSaveSweepToNotes = () => {
    if (!results) return;
    const found = results.filter((r) => r.verdict === 'FOUND');
    onAppendLedger({
      module: 'identity',
      targetLabel: `Username: ${username.trim()}`,
      findingSummary:
        found.length > 0
          ? `WhatsMyName sweep (${results.length} sites checked): profiles found on ${found
              .slice(0, 20)
              .map((r) => r.site.name)
              .join(', ')}${found.length > 20 ? ` +${found.length - 20} more` : ''}.`
          : `WhatsMyName sweep (${results.length} sites checked): no profiles found.`,
      sourceUrl: 'https://github.com/WebBreacher/WhatsMyName',
    });
    setStatusMessage('Sweep result recorded to the evidence ledger.');
  };

  const foundResults = results?.filter((r) => r.verdict === 'FOUND') ?? [];
  const unknownCount = results?.filter((r) => r.verdict === 'UNKNOWN').length ?? 0;

  return (
    <div className="space-y-4">
      <Panel
        tag={MODULE_CATALOG.identity.num}
        title={MODULE_CATALOG.identity.name}
        description={`${MODULE_CATALOG.identity.job} Checks run through this server with per-probe detection strings; private-network and malformed probes are blocked.`}
        actions={
          datasetInfo ? (
            <DataValue className="text-right text-ink-3">
              {datasetInfo.count} probes loaded · dataset fetched{' '}
              {datasetInfo.fetchedAt.slice(0, 10)}
            </DataValue>
          ) : undefined
        }
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]">
          <TextField
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSweep();
            }}
            placeholder="Username or handle (letters, digits, dot, underscore, hyphen)"
            className="font-mono"
          />
          <SelectField
            aria-label="Site category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </SelectField>
          <Button
            variant="primary"
            icon={<Search className="h-4 w-4" />}
            onClick={handleSweep}
            disabled={!username.trim() || isSweeping}
          >
            {isSweeping
              ? progress
                ? `Sweeping ${progress.completed}/${progress.total}…`
                : 'Sweeping…'
              : 'Sweep username'}
          </Button>
        </div>

        {error && (
          <NoticeBanner className="mt-3" tone="danger" title="Error:">
            {error}
          </NoticeBanner>
        )}

        {statusMessage && (
          <NoticeBanner className="mt-3" tone="info" onDismiss={() => setStatusMessage(null)}>
            {statusMessage}
          </NoticeBanner>
        )}
      </Panel>

      {!results && !isSweeping && (
        <Panel>
          <EmptyState
            icon={<UserSearch className="h-5 w-5" />}
            title="No sweep run yet"
            hint="Enter a handle above and sweep. Each probe visits the site's own page and looks for the profile's detection signature — a full ~700-site sweep takes a minute or two, and hits are flagged for visual verification before you treat any as the same person."
          />
        </Panel>
      )}

      {results && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Well className="p-3 text-center">
              <div className="font-mono text-2xl font-semibold tabular-nums text-live">
                {foundResults.length}
              </div>
              <DataLabel>Found</DataLabel>
            </Well>
            <Well className="p-3 text-center">
              <div className="font-mono text-2xl font-semibold tabular-nums text-gap">
                {unknownCount}
              </div>
              <DataLabel>Unknown (blocked/captcha)</DataLabel>
            </Well>
            <Well className="p-3 text-center">
              <div className="font-mono text-2xl font-semibold tabular-nums text-ink-2">
                {results.length - foundResults.length - unknownCount}
              </div>
              <DataLabel>Not found</DataLabel>
            </Well>
          </div>

          <Panel
            title={`Sweep results — ${username.trim()}`}
            actions={
              <Button
                variant="primary"
                size="sm"
                icon={<BookmarkPlus className="h-3.5 w-3.5" />}
                onClick={handleSaveSweepToNotes}
              >
                Record finding
              </Button>
            }
            flush
          >
            <div className="max-h-[560px] divide-y divide-line overflow-y-auto">
              {results.map((r) => {
                const style = VERDICT_STYLES[r.verdict] ?? VERDICT_STYLES.UNKNOWN;
                const profileUrl = r.site.uriCheck
                  .replace('{account}', encodeURIComponent(username.trim()))
                  .replace('{username}', encodeURIComponent(username.trim()));
                return (
                  <div
                    key={r.site.name + r.site.uriCheck}
                    className="flex items-center justify-between gap-3 px-4 py-2.5"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      {r.verdict === 'FOUND' ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-live" />
                      ) : r.verdict === 'NOT_FOUND' ? (
                        <CircleSlash className="h-4 w-4 shrink-0 text-line-strong" />
                      ) : (
                        <HelpCircle className="h-4 w-4 shrink-0 text-gap" />
                      )}
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-ink">
                          {r.site.name}
                        </div>
                        <DataValue className="block truncate text-[11px] text-ink-3">
                          {r.site.category} · HTTP {r.httpStatus} · {r.elapsedMs}ms
                          {r.error ? ` · ${r.error}` : ''}
                        </DataValue>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${style.chip}`}>
                        {style.label}
                      </span>
                      {(r.verdict === 'FOUND' || r.verdict === 'UNKNOWN') && (
                        <a
                          href={profileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-ink-3 transition-colors hover:text-accent"
                          title="Open profile for visual verification"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>

          <NoticeBanner tone="warn" icon={<UserSearch />}>
            Sweep hits are indicators, not proof — handles can be reused by
            different people. Open each hit, confirm the bio/photos, then record
            it in the ledger.
          </NoticeBanner>
        </div>
      )}
    </div>
  );
};
