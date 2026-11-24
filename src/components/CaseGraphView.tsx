import React, { useEffect, useMemo, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import {
  GitMerge,
  Maximize2,
  Network,
  Play,
  Route,
  Sparkles,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { EntityKind } from '../connectors/types';
import type { InvestigationCase, ModuleId } from '../types/osint';
import {
  buildCaseInvestigationGraph,
  type CaseGraphNode,
  type GraphNodeKind,
} from '../utils/caseGraph';
import {
  detectGraphCommunities,
  findShortestPath,
} from '../utils/graphAnalytics';
import { Button, Panel, Well } from './ui';

interface CaseGraphViewProps {
  activeCase: InvestigationCase;
  onPivotInvestigate: (kind: EntityKind, value: string) => void;
  onPivotToModule?: (moduleId: ModuleId, targetValue: string, subMode?: string) => void;
  onMergeEntities?: (primaryEntityId: string, duplicateEntityId: string) => void;
}

const NODE_COLORS: Record<GraphNodeKind, string> = {
  case_center: '#ff6b2c',
  entity: '#2f9e66',
  domain: '#3b82f6',
  ip: '#f59e0b',
  asn: '#a855f7',
  coordinates: '#14b8a6',
  ledger: '#71717a',
  profile: '#ec4899',
  tracker: '#ef4444',
  wallet: '#eab308',
  email: '#06b6d4',
};

const COMMUNITY_PALETTE = [
  '#ff6b2c',
  '#2f9e66',
  '#3b82f6',
  '#a855f7',
  '#eab308',
  '#ec4899',
  '#14b8a6',
  '#f97316',
];

type LayoutMode = 'cose' | 'concentric' | 'breadthfirst';

export const CaseGraphView: React.FC<CaseGraphViewProps> = ({
  activeCase,
  onPivotInvestigate,
  onPivotToModule,
  onMergeEntities,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  const [layoutMode, setLayoutMode] = useState<LayoutMode>('cose');
  const [colorByCommunity, setColorByCommunity] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Shortest path state
  const [pathStartId, setPathStartId] = useState<string>('');
  const [pathEndId, setPathEndId] = useState<string>('');

  // Entity merge / deduplication state
  const [mergePrimaryId, setMergePrimaryId] = useState<string>('');
  const [mergeDupId, setMergeDupId] = useState<string>('');

  const graph = useMemo(
    () => buildCaseInvestigationGraph(activeCase, 880, 520),
    [activeCase]
  );

  const communities = useMemo(
    () => detectGraphCommunities(graph.nodes, graph.edges),
    [graph.nodes, graph.edges]
  );

  const shortestPath = useMemo(() => {
    if (!pathStartId || !pathEndId) return null;
    return findShortestPath(graph.nodes, graph.edges, pathStartId, pathEndId);
  }, [graph.nodes, graph.edges, pathStartId, pathEndId]);

  const selectedNode: CaseGraphNode | null = useMemo(
    () => graph.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [graph.nodes, selectedNodeId]
  );

  // Mount / rebuild interactive Cytoscape.js canvas when graph, layout, or styling changes
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const pathNodeSet = new Set(shortestPath?.nodeIds ?? []);
    const pathEdgeSet = new Set(shortestPath?.edgeIds ?? []);

    const elements: cytoscape.ElementDefinition[] = [
      ...graph.nodes.map((n) => {
        const commIdx = communities.clusterByNode[n.id] ?? 0;
        const fill = colorByCommunity
          ? COMMUNITY_PALETTE[commIdx % COMMUNITY_PALETTE.length]
          : NODE_COLORS[n.kind] ?? '#3b82f6';
        return {
          data: {
            id: n.id,
            label: n.label.length > 26 ? `${n.label.slice(0, 24)}…` : n.label,
            kind: n.kind,
            fill,
            size: n.kind === 'case_center' ? 42 : Math.min(34, 20 + n.degree * 2.5),
            inPath: pathNodeSet.has(n.id) ? 'yes' : 'no',
          },
        };
      }),
      ...graph.edges.map((e) => ({
        data: {
          id: e.id,
          source: e.sourceId,
          target: e.targetId,
          label: e.label,
          isHighlight: e.isHighlight ? 'yes' : 'no',
          inPath: pathEdgeSet.has(e.id) ? 'yes' : 'no',
        },
      })),
    ];

    const cy = cytoscape({
      container: el,
      elements,
      minZoom: 0.25,
      maxZoom: 3,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(fill)',
            label: 'data(label)',
            color: '#e5e7eb',
            'font-family': 'Spline Sans Mono, monospace',
            'font-size': 10,
            'text-valign': 'bottom',
            'text-margin-y': 5,
            'text-background-color': '#0e1113',
            'text-background-opacity': 0.85,
            'text-background-padding': '2px',
            width: 'data(size)',
            height: 'data(size)',
            'border-width': 1.5,
            'border-color': '#1f2428',
          },
        },
        {
          selector: 'node[kind="case_center"]',
          style: {
            shape: 'hexagon',
            'border-width': 2.5,
            'border-color': '#ffffff',
            'font-weight': 'bold',
          },
        },
        {
          selector: 'node[inPath="yes"]',
          style: {
            'border-width': 3,
            'border-color': '#ff6b2c',
          },
        },
        {
          selector: 'node:selected',
          style: {
            'border-width': 3,
            'border-color': '#ffffff',
          },
        },
        {
          selector: 'edge',
          style: {
            width: 1.5,
            'line-color': '#4b5563',
            'target-arrow-color': '#4b5563',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            label: 'data(label)',
            'font-family': 'Spline Sans Mono, monospace',
            'font-size': 8,
            color: '#9ca3af',
            'text-rotation': 'autorotate',
            'text-background-color': '#0e1113',
            'text-background-opacity': 0.75,
            'text-background-padding': '1px',
          },
        },
        {
          selector: 'edge[isHighlight="yes"]',
          style: {
            width: 2.2,
            'line-color': '#2f9e66',
            'target-arrow-color': '#2f9e66',
          },
        },
        {
          selector: 'edge[inPath="yes"]',
          style: {
            width: 3.5,
            'line-color': '#ff6b2c',
            'target-arrow-color': '#ff6b2c',
            color: '#ff6b2c',
          },
        },
      ],
      layout:
        layoutMode === 'cose'
          ? {
              name: 'cose',
              animate: false,
              nodeRepulsion: () => 8000,
              idealEdgeLength: () => 95,
              padding: 28,
            }
          : layoutMode === 'concentric'
          ? {
              name: 'concentric',
              animate: false,
              padding: 28,
              minNodeSpacing: 40,
            }
          : {
              name: 'breadthfirst',
              directed: true,
              animate: false,
              padding: 28,
              spacingFactor: 1.15,
            },
    });

    cy.on('tap', 'node', (evt) => {
      const id = evt.target.id();
      setSelectedNodeId(id);
    });

    cy.on('cxttap', 'node', (evt) => {
      const id = evt.target.id();
      setSelectedNodeId(id);
    });

    cy.on('tap', (evt) => {
      if (evt.target === cy) setSelectedNodeId(null);
    });

    // Clamp zoom on sparse graphs so 2-4 nodes don't appear oversized
    cy.fit(undefined, 56);
    if (cy.zoom() > 1.25) {
      cy.zoom(1.25);
      cy.center();
    }

    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [graph, layoutMode, colorByCommunity, communities, shortestPath]);

  const handleMerge = () => {
    if (!onMergeEntities || !mergePrimaryId || !mergeDupId || mergePrimaryId === mergeDupId) {
      return;
    }
    onMergeEntities(mergePrimaryId, mergeDupId);
    setMergePrimaryId('');
    setMergeDupId('');
  };

  return (
    <Panel
      title="Interactive Force-Directed Investigation Link Graph (Cytoscape.js)"
      actions={
        <div className="flex flex-wrap items-center gap-1.5">
          {(['cose', 'concentric', 'breadthfirst'] as LayoutMode[]).map((m) => (
            <Button
              key={m}
              size="sm"
              variant={layoutMode === m ? 'primary' : 'ghost'}
              onClick={() => setLayoutMode(m)}
            >
              {m === 'cose' ? 'Force' : m === 'concentric' ? 'Rings' : 'Hierarchy'}
            </Button>
          ))}
          <Button
            size="sm"
            variant={colorByCommunity ? 'primary' : 'secondary'}
            onClick={() => setColorByCommunity((v) => !v)}
          >
            <Sparkles className="w-3 h-3" />
            Clusters ({communities.clusterCount})
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Zoom in graph"
            onClick={() => cyRef.current?.zoom((cyRef.current?.zoom() ?? 1) * 1.2)}
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Zoom out graph"
            onClick={() => cyRef.current?.zoom((cyRef.current?.zoom() ?? 1) * 0.8)}
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Fit graph to view"
            onClick={() => cyRef.current?.fit(undefined, 28)}
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {/* Stats + Legend */}
        <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-muted">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-ink font-semibold tnum">{graph.stats.totalNodes} nodes</span>
            <span className="text-ink font-semibold tnum">{graph.stats.totalEdges} edges</span>
            <span>{graph.stats.sharedInfraBridges} shared infra bridge(s)</span>
            <span>{communities.clusterCount} cluster(s)</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                ['entity', 'Entity'],
                ['domain', 'Domain'],
                ['ip', 'IP'],
                ['profile', 'Profile'],
                ['email', 'Email'],
                ['tracker', 'Tracker'],
                ['wallet', 'Wallet'],
              ] as Array<[GraphNodeKind, string]>
            ).map(([k, lbl]) => (
              <span key={k} className="inline-flex items-center gap-1">
                <span
                  className="inline-block w-2 h-2 rounded-[1px]"
                  style={{ backgroundColor: NODE_COLORS[k] }}
                />
                {lbl}
              </span>
            ))}
          </div>
        </div>

        {/* Main Interactive Canvas + Node Transform Inspector */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_290px] gap-3">
          <div
            ref={containerRef}
            data-testid="cytoscape-graph-canvas"
            className="h-[460px] w-full rounded-[2px] border border-rule bg-[#0b0e10] relative"
          />

          <div className="space-y-3">
            {/* Selected Node & Maltego-Style Run Transform Menu */}
            <Well className="p-3 space-y-2.5">
              <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-accent flex items-center gap-1.5">
                <Network className="w-3.5 h-3.5" />
                Node Inspector &amp; Transforms
              </div>
              {selectedNode ? (
                <div className="space-y-2">
                  <div>
                    <div className="text-xs font-semibold text-ink break-all">
                      {selectedNode.label}
                    </div>
                    <div className="font-mono text-[10px] text-muted mt-0.5 break-all">
                      {selectedNode.sublabel}
                    </div>
                    <div className="font-mono text-[10px] text-muted mt-1">
                      Kind: <span className="text-ink uppercase">{selectedNode.kind}</span> · Degree:{' '}
                      <span className="text-ink">{selectedNode.degree}</span> · Cluster #
                      {(communities.clusterByNode[selectedNode.id] ?? 0) + 1}
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-2 border-t border-rule">
                    <div className="font-mono text-[9px] uppercase text-muted">
                      Run Transform on Node
                    </div>
                    {selectedNode.pivotKind && selectedNode.pivotValue && (
                      <Button
                        size="sm"
                        variant="primary"
                        className="w-full justify-start"
                        onClick={() =>
                          onPivotInvestigate(selectedNode.pivotKind!, selectedNode.pivotValue!)
                        }
                      >
                        <Play className="w-3 h-3" />
                        Recursive Spider ({selectedNode.pivotKind})
                      </Button>
                    )}
                    {onPivotToModule && selectedNode.pivotValue && (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="w-full justify-start"
                          onClick={() =>
                            onPivotToModule('webhunter', selectedNode.pivotValue!, 'search')
                          }
                        >
                          Hunt Open Web &amp; Dorks
                        </Button>
                        {selectedNode.kind === 'domain' && (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="w-full justify-start"
                            onClick={() => onPivotToModule('infra', selectedNode.pivotValue!)}
                          >
                            Deep Infra &amp; Reverse-IP
                          </Button>
                        )}
                        {(selectedNode.kind === 'profile' || selectedNode.kind === 'email') && (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="w-full justify-start"
                            onClick={() =>
                              onPivotToModule(
                                'identity',
                                selectedNode.pivotValue!,
                                selectedNode.kind === 'email' ? 'email' : 'username'
                              )
                            }
                          >
                            Enrich Identity / Breaches
                          </Button>
                        )}
                        {selectedNode.kind === 'wallet' && (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="w-full justify-start"
                            onClick={() =>
                              onPivotToModule('sanctions', selectedNode.pivotValue!, 'crypto')
                            }
                          >
                            Trace Crypto Wallet &amp; OFAC
                          </Button>
                        )}
                        {selectedNode.kind === 'entity' && (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="w-full justify-start"
                            onClick={() => onPivotToModule('dossier', selectedNode.pivotValue!)}
                          >
                            SEC / Courts / GLEIF Lookup
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-muted">
                  Click or right-click any node on the canvas to inspect its cluster, degree, and launch live investigative transforms. Drag nodes to rearrange; scroll to zoom.
                </p>
              )}
            </Well>

            {/* Shortest-Path Finder */}
            <Well className="p-3 space-y-2">
              <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink flex items-center gap-1.5">
                <Route className="w-3.5 h-3.5 text-accent" />
                Shortest-Path Finder
              </div>
              <div className="space-y-1.5">
                <select
                  aria-label="Shortest path start node"
                  value={pathStartId}
                  onChange={(e) => setPathStartId(e.target.value)}
                  className="w-full px-2 py-1 rounded-[2px] border border-rule bg-surface text-[11px] text-ink font-mono"
                >
                  <option value="">Select Start Node…</option>
                  {graph.nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      [{n.kind}] {n.label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Shortest path end node"
                  value={pathEndId}
                  onChange={(e) => setPathEndId(e.target.value)}
                  className="w-full px-2 py-1 rounded-[2px] border border-rule bg-surface text-[11px] text-ink font-mono"
                >
                  <option value="">Select Target Node…</option>
                  {graph.nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      [{n.kind}] {n.label}
                    </option>
                  ))}
                </select>
              </div>
              {pathStartId && pathEndId && (
                <div className="font-mono text-[10px] pt-1">
                  {shortestPath ? (
                    <span className="text-accent">
                      Highlighted: {shortestPath.hops} hop(s) connecting{' '}
                      {shortestPath.nodeIds.length} node(s).
                    </span>
                  ) : (
                    <span className="text-gap">No undirected path connects these two nodes.</span>
                  )}
                </div>
              )}
            </Well>

            {/* Entity Merge / Deduplication */}
            {onMergeEntities && activeCase.entities.length >= 2 && (
              <Well className="p-3 space-y-2">
                <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink flex items-center gap-1.5">
                  <GitMerge className="w-3.5 h-3.5 text-live" />
                  Entity Merge / Deduplicate
                </div>
                <select
                  aria-label="Primary entity to keep"
                  value={mergePrimaryId}
                  onChange={(e) => setMergePrimaryId(e.target.value)}
                  className="w-full px-2 py-1 rounded-[2px] border border-rule bg-surface text-[11px] text-ink font-mono"
                >
                  <option value="">Keep Primary Entity…</option>
                  {activeCase.entities.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Duplicate entity to merge"
                  value={mergeDupId}
                  onChange={(e) => setMergeDupId(e.target.value)}
                  className="w-full px-2 py-1 rounded-[2px] border border-rule bg-surface text-[11px] text-ink font-mono"
                >
                  <option value="">Merge Duplicate Into Primary…</option>
                  {activeCase.entities
                    .filter((e) => e.id !== mergePrimaryId)
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.label}
                      </option>
                    ))}
                </select>
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full"
                  disabled={!mergePrimaryId || !mergeDupId || mergePrimaryId === mergeDupId}
                  onClick={handleMerge}
                >
                  Merge &amp; Rewire Links
                </Button>
              </Well>
            )}
          </div>
        </div>
      </div>
    </Panel>
  );
};
