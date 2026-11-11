import type { InvestigationCase } from '../types/osint';
import type { EntityKind } from '../connectors/types';

export type GraphNodeKind =
  | 'case_center'
  | 'entity'
  | 'domain'
  | 'ip'
  | 'asn'
  | 'coordinates'
  | 'ledger';

export interface CaseGraphNode {
  id: string;
  label: string;
  sublabel: string;
  kind: GraphNodeKind;
  pivotKind?: EntityKind;
  pivotValue?: string;
  x: number;
  y: number;
  degree: number;
}

export interface CaseGraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  label: string;
  isHighlight?: boolean;
}

export interface CaseGraphModel {
  nodes: CaseGraphNode[];
  edges: CaseGraphEdge[];
  stats: {
    totalNodes: number;
    totalEdges: number;
    sharedInfraBridges: number;
  };
}

/**
 * Synthesizes an interactive cross-module investigation link graph from all
 * artifacts recorded in an InvestigationCase (entities, ownership edges,
 * domains, resolved IPs, BGP ASNs, pinned coordinates, and ledger entries).
 */
export function buildCaseInvestigationGraph(
  activeCase: InvestigationCase,
  width = 880,
  height = 520
): CaseGraphModel {
  const nodesMap = new Map<string, Omit<CaseGraphNode, 'x' | 'y' | 'degree'>>();
  const edges: CaseGraphEdge[] = [];
  const edgeKeys = new Set<string>();

  const addNode = (node: Omit<CaseGraphNode, 'x' | 'y' | 'degree'>) => {
    if (!nodesMap.has(node.id)) {
      nodesMap.set(node.id, node);
    }
  };

  const addEdge = (
    sourceId: string,
    targetId: string,
    label: string,
    isHighlight = false
  ) => {
    if (sourceId === targetId) return;
    const key = `${sourceId}->${targetId}:${label}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({
      id: `e-${edges.length + 1}`,
      sourceId,
      targetId,
      label,
      isHighlight,
    });
  };

  const rootId = `case:${activeCase.id}`;
  addNode({
    id: rootId,
    label: activeCase.codeName,
    sublabel: activeCase.title,
    kind: 'case_center',
  });

  // 1. Pinned Geolocation coordinate node
  const geo = activeCase.geoState;
  if (geo.locationLabel) {
    const coordStr = `${geo.lat.toFixed(4)},${geo.lon.toFixed(4)}`;
    const geoNodeId = `coord:${coordStr}`;
    addNode({
      id: geoNodeId,
      label: geo.locationLabel.slice(0, 32),
      sublabel: `${geo.lat.toFixed(4)}, ${geo.lon.toFixed(4)} (${geo.landmarks.length} landmarks)`,
      kind: 'coordinates',
      pivotKind: 'coordinates',
      pivotValue: `${geo.lat},${geo.lon}`,
    });
    addEdge(rootId, geoNodeId, 'pinned location');
  }

  // 2. Corporate & Public Entities + Ownership Edges
  for (const ent of activeCase.entities) {
    const entNodeId = `ent:${ent.id}`;
    addNode({
      id: entNodeId,
      label: ent.label,
      sublabel: `${ent.type.toUpperCase()} · ${ent.jurisdiction} · ${ent.identifier}`,
      kind: 'entity',
      pivotKind: 'entity-name',
      pivotValue: ent.label,
    });
    addEdge(rootId, entNodeId, ent.type);
  }

  for (const own of activeCase.ownershipEdges) {
    const src = `ent:${own.sourceId}`;
    const tgt = `ent:${own.targetId}`;
    if (nodesMap.has(src) && nodesMap.has(tgt)) {
      addEdge(
        src,
        tgt,
        `${own.relationship}${own.ownershipPercent ? ` (${own.ownershipPercent}%)` : ''}`,
        true
      );
    }
  }

  // 3. Infrastructure Domains, Resolved IPs & BGP ASNs
  const ipUsageCount = new Map<string, number>();
  const asnUsageCount = new Map<string, number>();

  for (const rec of activeCase.infraRecords) {
    const domId = `dom:${rec.domain}`;
    addNode({
      id: domId,
      label: rec.domain,
      sublabel: `Risk ${rec.riskAssessment.score}/100 · ${rec.ctSubdomainsCount} CT subs`,
      kind: 'domain',
      pivotKind: 'domain',
      pivotValue: rec.domain,
    });
    addEdge(rootId, domId, 'scanned domain');

    for (const ip of rec.aRecords.slice(0, 3)) {
      const ipId = `ip:${ip}`;
      addNode({
        id: ipId,
        label: ip,
        sublabel: rec.ipCountry || 'IPv4 host',
        kind: 'ip',
        pivotKind: 'ip',
        pivotValue: ip,
      });
      addEdge(domId, ipId, 'A record');
      ipUsageCount.set(ipId, (ipUsageCount.get(ipId) || 0) + 1);

      if (rec.asn) {
        const asnId = `asn:${rec.asn}`;
        addNode({
          id: asnId,
          label: rec.asn,
          sublabel: rec.asnOrg || 'BGP Autonomous System',
          kind: 'asn',
        });
        addEdge(ipId, asnId, 'announced by');
        asnUsageCount.set(asnId, (asnUsageCount.get(asnId) || 0) + 1);
      }
    }
  }

  // 4. Recent Evidence Ledger Blocks (up to 8)
  for (const entry of activeCase.evidenceLedger.slice(-8)) {
    const ledId = `led:${entry.id}`;
    addNode({
      id: ledId,
      label: `#${entry.index} ${entry.targetLabel.slice(0, 26)}`,
      sublabel: `${entry.module.toUpperCase()} · ${entry.sha256Hash.slice(0, 8)}…`,
      kind: 'ledger',
    });
    addEdge(rootId, ledId, `ledger #${entry.index}`);
  }

  // 5. Analyst-accepted auto-links (src/utils/autoLinks.ts) — woven in as
  //    highlighted edges. Endpoints must exist in the current case state;
  //    stale links (e.g. a removed domain) drop out silently.
  for (const link of activeCase.autoLinkDecisions?.accepted ?? []) {
    if (!nodesMap.has(link.sourceNodeId) || !nodesMap.has(link.targetNodeId)) {
      continue;
    }
    addEdge(link.sourceNodeId, link.targetNodeId, link.edgeLabel || 'accepted link', true);
  }

  // Compute node degrees
  const degreeMap = new Map<string, number>();
  for (const e of edges) {
    degreeMap.set(e.sourceId, (degreeMap.get(e.sourceId) || 0) + 1);
    degreeMap.set(e.targetId, (degreeMap.get(e.targetId) || 0) + 1);
  }

  // Deterministic concentric ring layout grouped by node kind
  const cx = width / 2;
  const cy = height / 2;
  const rawNodes = Array.from(nodesMap.values());
  const nonCenter = rawNodes.filter((n) => n.kind !== 'case_center');

  const innerRing = nonCenter.filter(
    (n) => n.kind === 'entity' || n.kind === 'domain' || n.kind === 'coordinates'
  );
  const outerRing = nonCenter.filter(
    (n) => n.kind === 'ip' || n.kind === 'asn' || n.kind === 'ledger'
  );

  const positioned: CaseGraphNode[] = [];
  for (const n of rawNodes) {
    if (n.kind === 'case_center') {
      positioned.push({
        ...n,
        x: Math.round(cx),
        y: Math.round(cy),
        degree: degreeMap.get(n.id) || 0,
      });
    }
  }

  const placeRing = (
    items: Array<Omit<CaseGraphNode, 'x' | 'y' | 'degree'>>,
    rx: number,
    ry: number,
    phaseOffsetRad: number
  ) => {
    const count = Math.max(1, items.length);
    items.forEach((item, idx) => {
      const angle = phaseOffsetRad + (2 * Math.PI * idx) / count;
      positioned.push({
        ...item,
        x: Math.round(cx + rx * Math.cos(angle)),
        y: Math.round(cy + ry * Math.sin(angle)),
        degree: degreeMap.get(item.id) || 0,
      });
    });
  };

  placeRing(innerRing, Math.min(width, height) * 0.27, Math.min(width, height) * 0.25, -Math.PI / 2);
  placeRing(outerRing, Math.min(width, height) * 0.44, Math.min(width, height) * 0.40, -Math.PI / 3);

  let sharedInfraBridges = 0;
  for (const c of ipUsageCount.values()) if (c > 1) sharedInfraBridges++;
  for (const c of asnUsageCount.values()) if (c > 1) sharedInfraBridges++;

  return {
    nodes: positioned,
    edges,
    stats: {
      totalNodes: positioned.length,
      totalEdges: edges.length,
      sharedInfraBridges,
    },
  };
}
