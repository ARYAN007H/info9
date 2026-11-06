import React, { useMemo, useState } from 'react';
import {
  BookmarkPlus,
  Building2,
  ExternalLink,
  GitBranch,
  Network,
  Plus,
  Search,
  ShieldAlert,
  Trash2,
  Workflow,
} from 'lucide-react';
import type {
  InvestigationCase,
  OsintEntity,
  OwnershipEdge,
} from '../types/osint';
import {
  expandGleifParentTransform,
  searchCorporateAndPublicEntities,
} from '../services/osintApis';
import { analyzeCorporateGraphTopology } from '../utils/osintForensics';

interface DossierShellModuleProps {
  activeCase: InvestigationCase;
  selectedEntity: OsintEntity | null;
  onSelectEntity: (entity: OsintEntity | null) => void;
  onAddEntity: (entity: OsintEntity) => void;
  onRemoveEntity?: (entityId: string) => void;
  onAddOwnershipEdge: (edge: OwnershipEdge) => void;
  onPivotToSanctions: (entityName: string, jurisdiction: string) => void;
  onAppendLedger: (entry: {
    module: 'dossier';
    targetLabel: string;
    findingSummary: string;
    sourceUrl: string;
  }) => void;
}

export const DossierShellModule: React.FC<DossierShellModuleProps> = ({
  activeCase,
  selectedEntity,
  onSelectEntity,
  onAddEntity,
  onRemoveEntity,
  onAddOwnershipEdge,
  onPivotToSanctions,
  onAppendLedger,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchingApi, setIsSearchingApi] = useState(false);
  const [isRunningTransform, setIsRunningTransform] = useState(false);
  const [apiResults, setApiResults] = useState<OsintEntity[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Manual connection form state
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [relLabel, setRelLabel] = useState('Parent Company');
  const [ownershipPct, setOwnershipPct] = useState('100');

  const currentEntity =
    selectedEntity &&
    activeCase.entities.some((e) => e.id === selectedEntity.id)
      ? selectedEntity
      : activeCase.entities[0] || null;

  const topologyAnalysis = useMemo(
    () =>
      analyzeCorporateGraphTopology(
        activeCase.entities,
        activeCase.ownershipEdges
      ),
    [activeCase.entities, activeCase.ownershipEdges]
  );

  const runRegistrySearch = async (q: string) => {
    const clean = q.trim();
    if (!clean) return;

    setIsSearchingApi(true);
    setStatusMessage(
      `Searching GLEIF Corporate Registry, Wikidata, and OpenAlex for "${clean}"...`
    );
    try {
      const results = await searchCorporateAndPublicEntities(clean);
      setApiResults(results);
      if (results.length > 0) {
        setStatusMessage(
          `Found ${results.length} public records for "${clean}". Click "Save to Workspace" on any record to inspect or map ownership.`
        );
      } else {
        setStatusMessage(
          `No public records matched "${clean}". Try searching a company legal name or public figure.`
        );
      }
    } catch (err) {
      setStatusMessage(
        `Search error: ${err instanceof Error ? err.message : 'Network error'}`
      );
    } finally {
      setIsSearchingApi(false);
    }
  };

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await runRegistrySearch(searchQuery);
  };

  const handleFindParentCompany = async (ent: OsintEntity) => {
    setIsRunningTransform(true);
    setStatusMessage(
      `Checking GLEIF corporate registry for parent companies of "${ent.label}"...`
    );
    try {
      const result = await expandGleifParentTransform(ent);
      if (result.found) {
        onAddEntity(result.discoveredEntity);
        onAddOwnershipEdge(result.discoveredEdge);
        onSelectEntity(result.discoveredEntity);
        setStatusMessage(
          `Found parent entity "${result.discoveredEntity.label}" (${result.discoveredEntity.jurisdiction}) and added ownership link.`
        );
      } else {
        const reasonText: Record<typeof result.reason, string> = {
          NOT_A_GLEIF_ENTITY: 'the saved entity has no GLEIF identifier',
          NO_PARENT_ON_RECORD:
            'GLEIF records no Level-2 ultimate parent (standalone entity or reporting exception)',
          GLEIF_UNAVAILABLE: 'the GLEIF registry is unreachable right now',
          GLEIF_ERROR: 'the GLEIF registry returned an error',
        };
        setStatusMessage(
          `No parent discovered — ${reasonText[result.reason]}. info9 does not invent placeholder owners.`
        );
      }
    } catch (err) {
      setStatusMessage(
        `Parent lookup failed: ${err instanceof Error ? err.message : 'network error'}`
      );
    } finally {
      setIsRunningTransform(false);
    }
  };

  const handleAddConnection = (e: React.FormEvent) => {
    e.preventDefault();
    const src = sourceId || activeCase.entities[0]?.id;
    const tgt = targetId || activeCase.entities[1]?.id;
    if (!src || !tgt || src === tgt) {
      setStatusMessage('Select two different saved entities to connect.');
      return;
    }

    const newEdge: OwnershipEdge = {
      id: `edge-${Date.now()}`,
      sourceId: src,
      targetId: tgt,
      relationship: relLabel.trim() || 'Ownership / Affiliation',
      ownershipPercent: Math.min(
        100,
        Math.max(1, parseInt(ownershipPct, 10) || 100)
      ),
      isOffshoreConduit: false,
      verifiedSource: 'User Investigation Link',
    };
    onAddOwnershipEdge(newEdge);
    setStatusMessage('Added connection between the selected entities.');
  };

  const handleSaveEntityToNotes = (ent: OsintEntity) => {
    onAppendLedger({
      module: 'dossier',
      targetLabel: `${ent.label} (${ent.identifier})`,
      findingSummary: `Public Record Verified [${ent.jurisdiction}]: ${ent.summary}`,
      sourceUrl: ent.sourceUrl || 'https://search.gleif.org',
    });
    setStatusMessage(`Saved "${ent.label}" to your Watchlist & Notes report.`);
  };

  return (
    <div className="space-y-6">
      {/* Step 1: Clean Search Hero Card */}
      <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 font-display">
            People, Companies &amp; Public Records Lookup
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Search global corporate registries (GLEIF LEI), public knowledge
            graphs (Wikidata), and institutions (OpenAlex) to find official
            registration details, headquarters, and parent companies.
          </p>
        </div>

        <form onSubmit={handleSearchSubmit} className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                aria-label="Search company, organization, or person name"
                placeholder="Enter a company, bank, institution, or public figure (e.g. Maersk, Cloudflare, Trafigura, CERN)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>
            <button
              type="submit"
              disabled={isSearchingApi}
              className="px-5 py-2.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-500 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              {isSearchingApi ? 'Searching...' : 'Search Public Records'}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>Quick search examples:</span>
            {['Maersk', 'Cloudflare', 'Trafigura', 'CERN'].map((sample) => (
              <button
                key={sample}
                type="button"
                onClick={() => {
                  setSearchQuery(sample);
                  runRegistrySearch(sample);
                }}
                className="px-2.5 py-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 hover:border-sky-500 rounded-md text-slate-700 dark:text-slate-300 font-medium transition-colors whitespace-nowrap shrink-0"
              >
                {sample}
              </button>
            ))}
          </div>
        </form>

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
      </div>

      {/* Step 2: Live Search Results Grid */}
      {apiResults.length > 0 && (
        <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
                Search Results ({apiResults.length})
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Verified records from GLEIF Global LEI Registry, Wikidata, and
                OpenAlex
              </p>
            </div>
            <button
              type="button"
              onClick={() => setApiResults([])}
              className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            >
              Clear Results
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {apiResults.map((res) => {
              const isAlreadySaved = activeCase.entities.some(
                (e) => e.id === res.id
              );
              return (
                <div
                  key={res.id}
                  className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg flex flex-col justify-between space-y-3"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                      <span>{res.type.toUpperCase()}</span>
                      <span>·</span>
                      <span>Country: {res.jurisdiction}</span>
                    </div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-1">
                      {res.label}
                    </h3>
                    <div className="text-xs font-mono text-sky-600 dark:text-sky-400 mt-0.5">
                      {res.identifier}
                    </div>
                    <p className="mt-2 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      {res.summary}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                    {res.sourceUrl ? (
                      <a
                        href={res.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-slate-500 hover:text-sky-500 flex items-center gap-1 whitespace-nowrap"
                      >
                        <span>Official Record</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : (
                      <span />
                    )}

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          onPivotToSanctions(res.label, res.jurisdiction)
                        }
                        className="px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-amber-500 rounded-md transition-colors whitespace-nowrap shrink-0"
                      >
                        Check Watchlist
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onAddEntity(res);
                          onSelectEntity(res);
                          setStatusMessage(
                            `Added "${res.label}" to your workspace below.`
                          );
                        }}
                        className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-md transition-colors whitespace-nowrap shrink-0"
                      >
                        {isAlreadySaved ? 'Selected' : '+ Save to Workspace'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Step 3: Saved Entities & Ownership Inspector */}
      {activeCase.entities.length === 0 ? (
        <div className="p-10 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-center max-w-2xl mx-auto space-y-3">
          <Building2 className="w-8 h-8 text-sky-500 mx-auto" />
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
            No Companies or People Saved Yet
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Use the search bar above to look up any company, institution, or
            public figure. Click <strong>&ldquo;+ Save to Workspace&rdquo;</strong>{' '}
            on any result to inspect its full registration profile and trace its
            parent company.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left 5 Cols: Saved Entities List & Connections */}
          <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 font-display">
                Saved Workspace Profiles ({activeCase.entities.length})
              </h2>
              <span className="text-xs text-slate-500 font-mono tabular-nums">
                {activeCase.ownershipEdges.length} links
              </span>
            </div>

            <div className="space-y-2">
              {activeCase.entities.map((ent) => {
                const isSelected = currentEntity?.id === ent.id;
                return (
                  <div
                    key={ent.id}
                    className={`p-3 rounded-lg border transition-colors flex items-center justify-between gap-2 ${
                      isSelected
                        ? 'bg-sky-500/10 border-sky-500/50'
                        : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectEntity(ent)}
                      className="flex-1 text-left min-w-0"
                    >
                      <div className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                        {ent.label}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 truncate mt-0.5">
                        {ent.type.toUpperCase()} · {ent.jurisdiction} ·{' '}
                        {ent.identifier}
                      </div>
                    </button>
                    {onRemoveEntity && (
                      <button
                        type="button"
                        aria-label={`Remove ${ent.label}`}
                        onClick={() => onRemoveEntity(ent.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-500 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Ownership Links List */}
            {activeCase.ownershipEdges.length > 0 && (
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Network className="w-3.5 h-3.5 text-sky-500" />
                  <span>Ownership &amp; Parent Links</span>
                </div>
                {activeCase.ownershipEdges.map((edge) => {
                  const srcName =
                    activeCase.entities.find((e) => e.id === edge.sourceId)
                      ?.label || edge.sourceId;
                  const tgtName =
                    activeCase.entities.find((e) => e.id === edge.targetId)
                      ?.label || edge.targetId;
                  return (
                    <div
                      key={edge.id}
                      className="p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-xs"
                    >
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {srcName} → {tgtName}
                      </div>
                      <div className="text-[11px] text-sky-600 dark:text-sky-400 font-mono mt-0.5">
                        {edge.relationship} ({edge.ownershipPercent ?? 100}%)
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Simple Add Link Form when 2+ entities exist */}
            {activeCase.entities.length >= 2 && (
              <form
                onSubmit={handleAddConnection}
                className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2 text-xs"
              >
                <div className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                  <GitBranch className="w-3.5 h-3.5 text-sky-500" />
                  <span>Link Two Saved Profiles</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    aria-label="Source entity"
                    value={sourceId || activeCase.entities[0]?.id}
                    onChange={(e) => setSourceId(e.target.value)}
                    className="px-2 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded text-slate-900 dark:text-slate-100"
                  >
                    {activeCase.entities.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.label}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Target entity"
                    value={targetId || activeCase.entities[1]?.id}
                    onChange={(e) => setTargetId(e.target.value)}
                    className="px-2 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded text-slate-900 dark:text-slate-100"
                  >
                    {activeCase.entities.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={relLabel}
                    onChange={(e) => setRelLabel(e.target.value)}
                    placeholder="Relationship (e.g. Parent Company)"
                    className="flex-1 px-2.5 py-1.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded text-slate-900 dark:text-slate-100"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1.5 font-semibold text-white bg-sky-600 hover:bg-sky-500 rounded whitespace-nowrap shrink-0"
                  >
                    + Link
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Right 7 Cols: Detailed Entity Profile Card */}
          <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
            {currentEntity && (
              <>
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
                  <div>
                    <div className="text-xs font-mono text-sky-600 dark:text-sky-400">
                      {currentEntity.type.toUpperCase()} · COUNTRY:{' '}
                      {currentEntity.jurisdiction}
                    </div>
                    <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mt-0.5 font-display">
                      {currentEntity.label}
                    </h2>
                    <div className="text-xs font-mono text-slate-500 mt-0.5">
                      {currentEntity.identifier}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleFindParentCompany(currentEntity)}
                      disabled={isRunningTransform}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-sky-700 dark:text-sky-300 bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      <Workflow className="w-3.5 h-3.5" />
                      <span>
                        {isRunningTransform
                          ? 'Looking up Parent...'
                          : 'Find Parent Company'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSaveEntityToNotes(currentEntity)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      <BookmarkPlus className="w-3.5 h-3.5" />
                      <span>Save to Notes</span>
                    </button>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Summary
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                    {currentEntity.summary}
                  </p>
                </div>

                <div>
                  <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                    Official Registry Details
                  </h3>
                  <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden text-xs">
                    {Object.entries(currentEntity.attributes).map(([k, v]) => (
                      <div
                        key={k}
                        className="px-3.5 py-2.5 bg-slate-50/60 dark:bg-slate-950/60 flex items-center justify-between gap-4"
                      >
                        <span className="text-slate-500 dark:text-slate-400">
                          {k}
                        </span>
                        <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100 text-right">
                          {v}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {topologyAnalysis.effectiveOwnershipPaths.length > 0 && (
                  <div className="pt-2">
                    <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                      Calculated Ownership Chain
                    </h3>
                    <div className="space-y-1.5">
                      {topologyAnalysis.effectiveOwnershipPaths.map((p, idx) => (
                        <div
                          key={idx}
                          className="p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg flex items-center justify-between text-xs font-mono tabular-nums"
                        >
                          <span>{p.pathLabels.join(' → ')}</span>
                          <span className="font-bold text-sky-600 dark:text-sky-400">
                            {p.effectiveEquityPercent}% Stake
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  {currentEntity.sourceUrl ? (
                    <a
                      href={currentEntity.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-sky-600 dark:text-sky-400 hover:underline flex items-center gap-1"
                    >
                      <span>Open Source Registry Page</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  ) : (
                    <span />
                  )}

                  <button
                    type="button"
                    onClick={() =>
                      onPivotToSanctions(
                        currentEntity.label,
                        currentEntity.jurisdiction
                      )
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-500/15 border border-amber-500/30 hover:bg-amber-500/25 rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    <ShieldAlert className="w-3.5 h-3.5" />
                    <span>Screen in Watchlist Tool</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
