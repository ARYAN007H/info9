import React, { useEffect, useMemo, useState } from 'react';
import {
  BookmarkPlus,
  Building2,
  ExternalLink,
  GitBranch,
  Inbox,
  Network,
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
import type { SmartRouteAction } from '../utils/smartIntake';
import {
  expandGleifParentTransform,
  searchCorporateAndPublicEntities,
} from '../services/osintApis';
import { analyzeCorporateGraphTopology } from '../utils/osintForensics';
import { MODULE_CATALOG } from './moduleCatalog';
import {
  Button,
  DataValue,
  EmptyState,
  KeyValueTable,
  NoticeBanner,
  Panel,
  PivotChip,
  SelectField,
  TextField,
  Well,
} from './ui';

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
  initialQuery?: string;
  onPivot?: (action: SmartRouteAction) => void;
}

/** Screening actions keep the watchlist's amber voice everywhere. */
const WATCHLIST_ACTION =
  'border-gap/40 bg-gap/10 text-gap hover:bg-gap/20';

export const DossierShellModule: React.FC<DossierShellModuleProps> = ({
  activeCase,
  selectedEntity,
  onSelectEntity,
  onAddEntity,
  onRemoveEntity,
  onAddOwnershipEdge,
  onPivotToSanctions,
  onAppendLedger,
  initialQuery,
  onPivot,
}) => {
  const [searchQuery, setSearchQuery] = useState(initialQuery || '');
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
      `Searching GLEIF, Wikidata and OpenAlex for "${clean}"…`
    );
    try {
      const results = await searchCorporateAndPublicEntities(clean);
      setApiResults(results);
      if (results.length > 0) {
        setStatusMessage(
          `Found ${results.length} public records for "${clean}". Save a record to inspect it or map its ownership.`
        );
      } else {
        setStatusMessage(
          `No public records matched "${clean}". Try a company legal name or a public figure.`
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

  useEffect(() => {
    if (initialQuery && initialQuery.trim()) {
      setSearchQuery(initialQuery.trim());
      void runRegistrySearch(initialQuery.trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await runRegistrySearch(searchQuery);
  };

  const handleFindParentCompany = async (ent: OsintEntity) => {
    setIsRunningTransform(true);
    setStatusMessage(
      `Checking the GLEIF registry for parent companies of "${ent.label}"…`
    );
    try {
      const result = await expandGleifParentTransform(ent);
      if (result.found) {
        onAddEntity(result.discoveredEntity);
        onAddOwnershipEdge(result.discoveredEdge);
        onSelectEntity(result.discoveredEntity);
        setStatusMessage(
          `Found parent entity "${result.discoveredEntity.label}" (${result.discoveredEntity.jurisdiction}) and added the ownership link.`
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
    setStatusMessage('Connection added between the selected entities.');
  };

  const handleSaveEntityToNotes = (ent: OsintEntity) => {
    onAppendLedger({
      module: 'dossier',
      targetLabel: `${ent.label} (${ent.identifier})`,
      findingSummary: `Public Record Verified [${ent.jurisdiction}]: ${ent.summary}`,
      sourceUrl: ent.sourceUrl || 'https://search.gleif.org',
    });
    setStatusMessage(`"${ent.label}" recorded to the evidence ledger.`);
  };

  const isErrorMessage =
    statusMessage?.startsWith('Search error') ||
    statusMessage?.startsWith('Parent lookup failed');

  return (
    <div className="space-y-4">
      <Panel
        tag={MODULE_CATALOG.dossier.num}
        title={MODULE_CATALOG.dossier.name}
        description={`${MODULE_CATALOG.dossier.job} Sources: GLEIF LEI registry, Wikidata, OpenAlex.`}
      >
        <form onSubmit={handleSearchSubmit} className="space-y-3">
          <div className="flex items-center gap-2">
            <TextField
              type="text"
              aria-label="Search company, organization, or person name"
              placeholder="Company, bank, institution, or public figure (e.g. Maersk, Cloudflare, Trafigura, CERN)…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              icon={<Search />}
              className="flex-1"
            />
            <Button type="submit" variant="primary" disabled={isSearchingApi}>
              {isSearchingApi ? 'Searching…' : 'Search public records'}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
            <span>Try:</span>
            {['Maersk', 'Cloudflare', 'Trafigura', 'CERN'].map((sample) => (
              <Button
                key={sample}
                variant="chip"
                onClick={() => {
                  setSearchQuery(sample);
                  runRegistrySearch(sample);
                }}
              >
                {sample}
              </Button>
            ))}
          </div>
        </form>

        {statusMessage && (
          <NoticeBanner
            className="mt-3"
            tone={isErrorMessage ? 'danger' : 'info'}
            onDismiss={() => setStatusMessage(null)}
          >
            {statusMessage}
          </NoticeBanner>
        )}
      </Panel>

      {apiResults.length > 0 && (
        <Panel
          title={`Search results (${apiResults.length})`}
          description="Records returned live from GLEIF, Wikidata and OpenAlex for this query."
          actions={
            <Button variant="ghost" size="sm" onClick={() => setApiResults([])}>
              Clear results
            </Button>
          }
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {apiResults.map((res) => {
              const isAlreadySaved = activeCase.entities.some(
                (e) => e.id === res.id
              );
              return (
                <Well key={res.id} className="flex flex-col justify-between p-3">
                  <div>
                    <div className="font-mono text-[11px] tabular-nums text-ink-3">
                      {res.type.toUpperCase()} · {res.jurisdiction}
                    </div>
                    <h3 className="mt-1 text-sm font-semibold text-ink">
                      {res.label}
                    </h3>
                    <div className="mt-0.5 font-mono text-xs text-ink-2">
                      {res.identifier}
                    </div>
                    <p className="mt-2 text-xs leading-5 text-ink-2">
                      {res.summary}
                    </p>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
                    {res.sourceUrl ? (
                      <a
                        href={res.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 whitespace-nowrap text-xs text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-accent"
                      >
                        <span>Official record</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span />
                    )}

                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        className={WATCHLIST_ACTION}
                        onClick={() =>
                          onPivotToSanctions(res.label, res.jurisdiction)
                        }
                      >
                        Screen
                      </Button>
                      <Button
                        variant={isAlreadySaved ? 'solid' : 'primary'}
                        size="sm"
                        disabled={isAlreadySaved}
                        onClick={() => {
                          onAddEntity(res);
                          onSelectEntity(res);
                          setStatusMessage(
                            `"${res.label}" added to your workspace below.`
                          );
                        }}
                      >
                        {isAlreadySaved ? 'In workspace' : 'Save to workspace'}
                      </Button>
                    </div>
                  </div>
                </Well>
              );
            })}
          </div>
        </Panel>
      )}

      {activeCase.entities.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Building2 />}
            title="No profiles saved yet"
            hint="Search above, then save a record to inspect its full registration profile and trace its parent company."
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
          <Panel
            title={`Saved profiles (${activeCase.entities.length})`}
            actions={
              <DataValue className="text-ink-3">
                {activeCase.ownershipEdges.length} links
              </DataValue>
            }
            bodyClassName="space-y-2"
          >
            {activeCase.entities.map((ent) => {
              const isSelected = currentEntity?.id === ent.id;
              return (
                <div
                  key={ent.id}
                  className={`flex items-center justify-between gap-2 rounded border p-2.5 transition-colors ${
                    isSelected
                      ? 'border-accent/40 bg-accent/10'
                      : 'border-line bg-well'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectEntity(ent)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="truncate text-xs font-semibold text-ink">
                      {ent.label}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-ink-3">
                      {ent.type.toUpperCase()} · {ent.jurisdiction} ·{' '}
                      {ent.identifier}
                    </div>
                  </button>
                  {onRemoveEntity && (
                    <button
                      type="button"
                      aria-label={`Remove ${ent.label}`}
                      onClick={() => onRemoveEntity(ent.id)}
                      className="shrink-0 p-1.5 text-ink-3 transition-colors hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              );
            })}

            {activeCase.ownershipEdges.length > 0 && (
              <div className="space-y-2 border-t border-line pt-3">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-2">
                  <Network className="h-3.5 w-3.5 text-ink-3" />
                  <span>Ownership &amp; parent links</span>
                </div>
                {activeCase.ownershipEdges.map((edge) => {
                  const srcName =
                    activeCase.entities.find((e) => e.id === edge.sourceId)
                      ?.label || edge.sourceId;
                  const tgtName =
                    activeCase.entities.find((e) => e.id === edge.targetId)
                      ?.label || edge.targetId;
                  return (
                    <Well key={edge.id} className="p-2.5 text-xs">
                      <div className="font-semibold text-ink">
                        {srcName} → {tgtName}
                      </div>
                      <DataValue className="mt-0.5 text-ink-2">
                        {edge.relationship} ({edge.ownershipPercent ?? 100}%)
                      </DataValue>
                    </Well>
                  );
                })}
              </div>
            )}

            {activeCase.entities.length >= 2 && (
              <form
                onSubmit={handleAddConnection}
                className="space-y-2 border-t border-line pt-3 text-xs"
              >
                <div className="flex items-center gap-1 font-semibold text-ink-2">
                  <GitBranch className="h-3.5 w-3.5 text-ink-3" />
                  <span>Link two saved profiles</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <SelectField
                    aria-label="Source entity"
                    className="h-8 text-xs"
                    value={sourceId || activeCase.entities[0]?.id}
                    onChange={(e) => setSourceId(e.target.value)}
                  >
                    {activeCase.entities.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.label}
                      </option>
                    ))}
                  </SelectField>
                  <SelectField
                    aria-label="Target entity"
                    className="h-8 text-xs"
                    value={targetId || activeCase.entities[1]?.id}
                    onChange={(e) => setTargetId(e.target.value)}
                  >
                    {activeCase.entities.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.label}
                      </option>
                    ))}
                  </SelectField>
                </div>
                <div className="flex items-center gap-2">
                  <TextField
                    type="text"
                    className="h-8 flex-1 text-xs"
                    value={relLabel}
                    onChange={(e) => setRelLabel(e.target.value)}
                    placeholder="Relationship (e.g. Parent Company)"
                  />
                  <TextField
                    type="text"
                    inputMode="numeric"
                    aria-label="Ownership percentage"
                    className="h-8 w-16 shrink-0 text-center font-mono text-xs"
                    value={ownershipPct}
                    onChange={(e) => setOwnershipPct(e.target.value)}
                    placeholder="%"
                  />
                  <Button type="submit" variant="primary" size="sm">
                    Link
                  </Button>
                </div>
              </form>
            )}
          </Panel>

          <Panel bodyClassName="space-y-5">
            {currentEntity && (
              <>
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
                  <div className="min-w-0">
                    <div className="font-mono text-[11px] uppercase tracking-wide text-ink-3">
                      {currentEntity.type} · {currentEntity.jurisdiction}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold text-ink">
                        {currentEntity.label}
                      </h2>
                      <PivotChip value={currentEntity.label} onSelectAction={onPivot} />
                    </div>
                    <DataValue className="mt-0.5 text-ink-2">
                      {currentEntity.identifier}
                    </DataValue>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="solid"
                      size="sm"
                      icon={<Workflow className="h-3.5 w-3.5" />}
                      onClick={() => handleFindParentCompany(currentEntity)}
                      disabled={isRunningTransform}
                    >
                      {isRunningTransform
                        ? 'Looking up parent…'
                        : 'Find parent company'}
                    </Button>

                    <Button
                      variant="primary"
                      size="sm"
                      icon={<BookmarkPlus className="h-3.5 w-3.5" />}
                      onClick={() => handleSaveEntityToNotes(currentEntity)}
                    >
                      Record finding
                    </Button>
                  </div>
                </div>

                <div>
                  <h3 className="mb-1 text-[11px] font-semibold text-ink-2">
                    Summary
                  </h3>
                  <p className="text-sm leading-6 text-ink-2">
                    {currentEntity.summary}
                  </p>
                </div>

                <div>
                  <h3 className="mb-2 text-[11px] font-semibold text-ink-2">
                    Official registry details
                  </h3>
                  <KeyValueTable
                    rows={Object.entries(currentEntity.attributes).map(
                      ([k, v]) => ({ label: k, value: v })
                    )}
                  />
                </div>

                {topologyAnalysis.effectiveOwnershipPaths.length > 0 && (
                  <div className="pt-1">
                    <h3 className="mb-2 text-[11px] font-semibold text-ink-2">
                      Calculated ownership chain
                    </h3>
                    <div className="space-y-1.5">
                      {topologyAnalysis.effectiveOwnershipPaths.map((p, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between gap-3 rounded border border-line bg-well p-2.5 font-mono text-xs tabular-nums"
                        >
                          <span className="min-w-0 text-ink-2">
                            {p.pathLabels.join(' → ')}
                          </span>
                          <DataValue className="shrink-0 font-semibold">
                            {p.effectiveEquityPercent}% stake
                          </DataValue>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between border-t border-line pt-3">
                  {currentEntity.sourceUrl ? (
                    <a
                      href={currentEntity.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-xs text-ink-2 underline decoration-line-strong underline-offset-2 hover:text-accent"
                    >
                      <span>Open registry page</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : (
                    <span />
                  )}

                  <Button
                    variant="ghost"
                    size="sm"
                    className={WATCHLIST_ACTION}
                    icon={<ShieldAlert className="h-3.5 w-3.5" />}
                    onClick={() =>
                      onPivotToSanctions(
                        currentEntity.label,
                        currentEntity.jurisdiction
                      )
                    }
                  >
                    Screen in watchlist
                  </Button>
                </div>
              </>
            )}
            {!currentEntity && (
              <EmptyState
                icon={<Inbox />}
                title="Select a profile"
                hint="Choose a saved profile on the left to inspect its registry details and ownership chain."
              />
            )}
          </Panel>
        </div>
      )}
    </div>
  );
};
