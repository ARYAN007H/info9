import React, { useMemo, useState } from 'react';
import { Check, Network, Sparkles, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { InvestigationCase, ModuleId } from '../types/osint';
import {
  buildCaseInvestigationGraph,
  type CaseGraphNode,
  type GraphNodeKind,
} from '../utils/caseGraph';
import {
  pendingAutoLinks,
  suggestAutoLinks,
  type AutoLinkSuggestion,
} from '../utils/autoLinks';
import { classifyUniversalIntake, type SmartRouteAction } from '../utils/smartIntake';
import { Button, DataLabel, DataValue, EmptyState, Panel, Well } from './ui';

interface CaseGraphViewProps {
  activeCase: InvestigationCase;
  onRouteClue?: (action: SmartRouteAction) => void;
  onSelectModule?: (moduleId: ModuleId) => void;
  onAcceptAutoLink?: (suggestion: AutoLinkSuggestion) => void;
  onDismissAutoLink?: (id: string) => void;
}

const NODE_COLORS: Record<
  GraphNodeKind,
  { fill: string; stroke: string; label: string }
> = {
  case_center: { fill: '#FF6B2C', stroke: '#FF8350', label: 'Case Core' },
  entity: { fill: '#6FB7FF', stroke: '#9BCBFF', label: 'Entity / Org' },
  domain: { fill: '#3ECF8E', stroke: '#6EE7B7', label: 'Domain' },
  ip: { fill: '#E5B454', stroke: '#FCD34D', label: 'IPv4 Host' },
  asn: { fill: '#A78BFA', stroke: '#C4B5FD', label: 'BGP ASN' },
  coordinates: { fill: '#F472B6', stroke: '#F9A8D4', label: 'Location Pin' },
  ledger: { fill: '#9FAAB2', stroke: '#D3D7D4', label: 'Ledger Block' },
};

export const CaseGraphView: React.FC<CaseGraphViewProps> = ({
  activeCase,
  onRouteClue,
  onSelectModule,
  onAcceptAutoLink,
  onDismissAutoLink,
}) => {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<GraphNodeKind | 'all'>('all');
  const [zoom, setZoom] = useState<number>(1);

  const graph = useMemo(
    () => buildCaseInvestigationGraph(activeCase, 860, 460),
    [activeCase]
  );

  const autoLinkSuggestions = useMemo(
    () => suggestAutoLinks(activeCase, graph),
    [activeCase, graph]
  );
  const pendingSuggestions = useMemo(
    () => pendingAutoLinks(autoLinkSuggestions, activeCase.autoLinkDecisions),
    [autoLinkSuggestions, activeCase.autoLinkDecisions]
  );
  const acceptedCount = activeCase.autoLinkDecisions?.accepted.length ?? 0;

  const visibleNodes = useMemo(() => {
    if (kindFilter === 'all') return graph.nodes;
    return graph.nodes.filter(
      (n) => n.kind === 'case_center' || n.kind === kindFilter
    );
  }, [graph.nodes, kindFilter]);

  const visibleIdSet = useMemo(
    () => new Set(visibleNodes.map((n) => n.id)),
    [visibleNodes]
  );

  const visibleEdges = useMemo(
    () =>
      graph.edges.filter(
        (e) => visibleIdSet.has(e.sourceId) && visibleIdSet.has(e.targetId)
      ),
    [graph.edges, visibleIdSet]
  );

  const nodeById = useMemo(() => {
    const map = new Map<string, CaseGraphNode>();
    for (const n of graph.nodes) map.set(n.id, n);
    return map;
  }, [graph.nodes]);

  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) ?? null : null;
  const selectedPivots = useMemo(() => {
    if (!selectedNode?.pivotValue) return [];
    return (
      classifyUniversalIntake(selectedNode.pivotValue)?.recommendedActions ?? []
    );
  }, [selectedNode]);

  if (graph.nodes.length <= 2) {
    return (
      <Panel
        tag="GRAPH"
        title="Interactive Case Link Graph"
        description="Visualizes relationships across every entity, ownership link, scanned domain, server IP, BGP ASN, and ledger entry in your case."
      >
        <EmptyState
          icon={<Network className="h-5 w-5" />}
          title="Add entities or scan domains to populate the link graph"
          hint="Save a company in Dossier, scan a domain in Infrastructure, or record a finding to see how shared IPs, ASNs, and ownership paths connect."
        />
      </Panel>
    );
  }

  return (
    <Panel
      tag="GRAPH"
      title="Interactive Cross-Module Investigation Graph"
      description={`${graph.stats.totalNodes} nodes · ${graph.stats.totalEdges} edges · ${graph.stats.sharedInfraBridges} shared infrastructure bridge(s)`}
      actions={
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setZoom((z) => Math.max(0.75, Number((z - 0.15).toFixed(2))))}
            title="Zoom out"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <DataValue className="px-1 text-[11px]">
            {Math.round(zoom * 100)}%
          </DataValue>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setZoom((z) => Math.min(1.6, Number((z + 0.15).toFixed(2))))}
            title="Zoom in"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
        </div>
      }
      bodyClassName="space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: 'all', label: 'All nodes' },
              { id: 'entity', label: 'Entities' },
              { id: 'domain', label: 'Domains' },
              { id: 'ip', label: 'IPs' },
              { id: 'asn', label: 'ASNs' },
              { id: 'ledger', label: 'Ledger' },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setKindFilter(f.id)}
              className={`rounded border px-2.5 py-1 text-xs font-medium transition-colors ${
                kindFilter === f.id
                  ? 'border-accent bg-well font-semibold text-ink'
                  : 'border-line bg-well/60 text-ink-2 hover:text-ink'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-[11px] text-ink-3">
          {(Object.entries(NODE_COLORS) as Array<[GraphNodeKind, { fill: string; label: string }]>).map(
            ([k, v]) => (
              <span key={k} className="inline-flex items-center gap-1">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: v.fill }}
                />
                {v.label}
              </span>
            )
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className="overflow-hidden rounded border border-line bg-[#0E1113] lg:col-span-8">
          <svg
            viewBox="0 0 860 460"
            className="h-[380px] w-full select-none"
            role="img"
            aria-label="Investigation entity and infrastructure relationship graph"
          >
            <g
              transform={`translate(${430 * (1 - zoom)}, ${230 * (1 - zoom)}) scale(${zoom})`}
            >
              {visibleEdges.map((edge) => {
                const src = nodeById.get(edge.sourceId);
                const tgt = nodeById.get(edge.targetId);
                if (!src || !tgt) return null;
                const mx = (src.x + tgt.x) / 2;
                const my = (src.y + tgt.y) / 2;
                return (
                  <g key={edge.id}>
                    <line
                      x1={src.x}
                      y1={src.y}
                      x2={tgt.x}
                      y2={tgt.y}
                      stroke={edge.isHighlight ? '#FF6B2C' : '#39424A'}
                      strokeWidth={edge.isHighlight ? 2 : 1.2}
                      strokeDasharray={edge.isHighlight ? undefined : '3 2'}
                    />
                    <text
                      x={mx}
                      y={my - 4}
                      textAnchor="middle"
                      fill="#9FAAB2"
                      fontSize="9"
                      fontFamily="Spline Sans Mono, monospace"
                    >
                      {edge.label}
                    </text>
                  </g>
                );
              })}

              {visibleNodes.map((node) => {
                const palette = NODE_COLORS[node.kind];
                const isSelected = selectedNodeId === node.id;
                const radius =
                  node.kind === 'case_center'
                    ? 16
                    : Math.min(14, 8 + Math.min(5, node.degree));
                return (
                  <g
                    key={node.id}
                    transform={`translate(${node.x}, ${node.y})`}
                    onClick={() => setSelectedNodeId(node.id)}
                    className="cursor-pointer"
                  >
                    {isSelected && (
                      <circle
                        r={radius + 5}
                        fill="none"
                        stroke="#FF6B2C"
                        strokeWidth={2}
                      />
                    )}
                    <circle
                      r={radius}
                      fill={palette.fill}
                      stroke={palette.stroke}
                      strokeWidth={1.5}
                    />
                    <text
                      y={radius + 13}
                      textAnchor="middle"
                      fill="#E9EDEE"
                      fontSize="10.5"
                      fontWeight="600"
                      fontFamily="Spline Sans Mono, monospace"
                    >
                      {node.label.slice(0, 22)}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>

        <Well className="flex flex-col justify-between p-3.5 lg:col-span-4">
          {selectedNode ? (
            <div className="space-y-3">
              <div>
                <DataLabel>
                  {NODE_COLORS[selectedNode.kind].label} · {selectedNode.degree}{' '}
                  connection(s)
                </DataLabel>
                <div className="mt-1 font-mono text-sm font-semibold text-ink">
                  {selectedNode.label}
                </div>
                <div className="mt-0.5 text-xs text-ink-2">
                  {selectedNode.sublabel}
                </div>
              </div>

              {selectedPivots.length > 0 && (
                <div className="space-y-1.5 border-t border-line pt-2.5">
                  <DataLabel>One-click pivots for this node</DataLabel>
                  {selectedPivots.map((act) => (
                    <Button
                      key={act.id}
                      size="sm"
                      variant="solid"
                      className="w-full justify-between"
                      onClick={() => {
                        if (onRouteClue) onRouteClue(act);
                        else if (onSelectModule) onSelectModule(act.moduleId);
                      }}
                    >
                      <span className="truncate">{act.label}</span>
                      <span className="font-mono text-[10px] text-accent">→</span>
                    </Button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-ink-3">
              Click any node in the graph to inspect its connections and launch
              cross-module pivots.
            </div>
          )}

          <div className="border-t border-line pt-2.5 font-mono text-[11px] text-ink-3">
            Tip: Shared IPv4 or BGP ASN nodes between two domains reveal
            co-hosted infrastructure.
          </div>
        </Well>
      </div>

      {/* Auto-link suggestions: the engine mined every recorded artifact for
          cross-module signals; nothing enters the graph without a review. */}
      {(pendingSuggestions.length > 0 || acceptedCount > 0) && (
        <Well
          label={
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-accent" />
              Suggested cross-module links
              {pendingSuggestions.length > 0 && ` (${pendingSuggestions.length} pending)`}
            </span>
          }
          actions={
            acceptedCount > 0 ? (
              <span className="font-mono text-[10px] text-ink-3">
                {acceptedCount} accepted · woven into the graph
              </span>
            ) : undefined
          }
          className="p-3"
        >
          {pendingSuggestions.length === 0 ? (
            <div className="text-[11px] text-ink-3">
              No pending suggestions — accepted links already drawn.
            </div>
          ) : (
            <ul className="space-y-2">
              {pendingSuggestions.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center gap-2 rounded border border-line bg-panel px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-mono text-xs font-semibold text-ink">
                        {s.label}
                      </span>
                      <span
                        className={`shrink-0 rounded border px-1 py-px font-mono text-[9px] uppercase ${
                          s.confidence >= 0.85
                            ? 'border-live/40 bg-live/10 text-live'
                            : s.confidence >= 0.65
                              ? 'border-derived/40 bg-derived/10 text-derived'
                              : 'border-gap/40 bg-gap/10 text-gap'
                        }`}
                      >
                        {(s.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] leading-4 text-ink-2">
                      {s.rationale}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<Check className="h-3.5 w-3.5" />}
                      disabled={!onAcceptAutoLink}
                      onClick={() => onAcceptAutoLink?.(s)}
                    >
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<X className="h-3.5 w-3.5" />}
                      disabled={!onDismissAutoLink}
                      onClick={() => onDismissAutoLink?.(s.id)}
                    >
                      Dismiss
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[10px] leading-4 text-ink-3">
            Confidence is a labeled heuristic — the rationale names the shared
            signal exactly. Accept weaves the edge into the graph (highlighted);
            dismissed suggestions never return for this case.
          </p>
        </Well>
      )}
    </Panel>
  );
};
