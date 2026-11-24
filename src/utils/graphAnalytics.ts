import type { InvestigationCase } from '../types/osint';
import type { CaseGraphEdge, CaseGraphNode } from './caseGraph';

export interface ShortestPathResult {
  nodeIds: string[];
  edgeIds: string[];
  hops: number;
}

/**
 * Unweighted undirected BFS shortest-path finder between any two nodes
 * in the investigation link graph.
 */
export function findShortestPath(
  nodes: Pick<CaseGraphNode, 'id'>[],
  edges: Pick<CaseGraphEdge, 'id' | 'sourceId' | 'targetId'>[],
  sourceId: string,
  targetId: string
): ShortestPathResult | null {
  const nodeSet = new Set(nodes.map((n) => n.id));
  if (!nodeSet.has(sourceId) || !nodeSet.has(targetId)) return null;
  if (sourceId === targetId) {
    return { nodeIds: [sourceId], edgeIds: [], hops: 0 };
  }

  const adj = new Map<string, Array<{ nextId: string; edgeId: string }>>();
  for (const e of edges) {
    if (!nodeSet.has(e.sourceId) || !nodeSet.has(e.targetId)) continue;
    const listA = adj.get(e.sourceId) ?? [];
    listA.push({ nextId: e.targetId, edgeId: e.id });
    adj.set(e.sourceId, listA);

    const listB = adj.get(e.targetId) ?? [];
    listB.push({ nextId: e.sourceId, edgeId: e.id });
    adj.set(e.targetId, listB);
  }

  const visited = new Set<string>([sourceId]);
  const parent = new Map<string, { prevId: string; edgeId: string }>();
  const queue: string[] = [sourceId];

  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (curr === targetId) break;
    for (const neighbor of adj.get(curr) ?? []) {
      if (visited.has(neighbor.nextId)) continue;
      visited.add(neighbor.nextId);
      parent.set(neighbor.nextId, { prevId: curr, edgeId: neighbor.edgeId });
      queue.push(neighbor.nextId);
    }
  }

  if (!visited.has(targetId)) return null;

  const nodeIds: string[] = [];
  const edgeIds: string[] = [];
  let cursor = targetId;
  while (cursor !== sourceId) {
    nodeIds.push(cursor);
    const step = parent.get(cursor)!;
    edgeIds.push(step.edgeId);
    cursor = step.prevId;
  }
  nodeIds.push(sourceId);
  nodeIds.reverse();
  edgeIds.reverse();

  return {
    nodeIds,
    edgeIds,
    hops: edgeIds.length,
  };
}

export interface GraphCommunityAssignment {
  /** Maps nodeId -> 0-based cluster index */
  clusterByNode: Record<string, number>;
  clusterCount: number;
  clusters: Array<{ clusterId: number; nodeIds: string[] }>;
}

/**
 * Deterministic label-propagation community detection (excluding the
 * star-hub `case_center` node so real infrastructure/entity sub-clusters
 * emerge instead of collapsing into a single giant component).
 */
export function detectGraphCommunities(
  nodes: Pick<CaseGraphNode, 'id' | 'kind'>[],
  edges: Pick<CaseGraphEdge, 'sourceId' | 'targetId'>[]
): GraphCommunityAssignment {
  const activeNodes = nodes.filter((n) => n.kind !== 'case_center');
  const activeSet = new Set(activeNodes.map((n) => n.id));
  const adj = new Map<string, string[]>();
  for (const n of activeNodes) adj.set(n.id, []);

  for (const e of edges) {
    if (!activeSet.has(e.sourceId) || !activeSet.has(e.targetId)) continue;
    adj.get(e.sourceId)!.push(e.targetId);
    adj.get(e.targetId)!.push(e.sourceId);
  }

  // Initialize every node with its own label
  const labels = new Map<string, string>();
  for (const n of activeNodes) labels.set(n.id, n.id);

  // Run 8 synchronous deterministic iterations of label propagation
  for (let iter = 0; iter < 8; iter++) {
    let changed = false;
    for (const n of activeNodes) {
      const neighbors = adj.get(n.id) ?? [];
      if (neighbors.length === 0) continue;
      const counts = new Map<string, number>();
      for (const nb of neighbors) {
        const lbl = labels.get(nb)!;
        counts.set(lbl, (counts.get(lbl) ?? 0) + 1);
      }
      let bestLabel = labels.get(n.id)!;
      let bestCount = -1;
      for (const [lbl, cnt] of Array.from(counts.entries()).sort((a, b) =>
        a[0].localeCompare(b[0])
      )) {
        if (cnt > bestCount) {
          bestCount = cnt;
          bestLabel = lbl;
        }
      }
      if (bestLabel !== labels.get(n.id)) {
        labels.set(n.id, bestLabel);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Group into compact 0..K-1 clusters ordered by cluster size descending
  const groups = new Map<string, string[]>();
  for (const n of activeNodes) {
    const lbl = labels.get(n.id)!;
    const arr = groups.get(lbl) ?? [];
    arr.push(n.id);
    groups.set(lbl, arr);
  }

  const sortedGroups = Array.from(groups.values()).sort(
    (a, b) => b.length - a.length || a[0].localeCompare(b[0])
  );

  const clusterByNode: Record<string, number> = {};
  const clusters: Array<{ clusterId: number; nodeIds: string[] }> = [];
  sortedGroups.forEach((nodeIds, idx) => {
    clusters.push({ clusterId: idx, nodeIds });
    for (const nid of nodeIds) {
      clusterByNode[nid] = idx;
    }
  });

  // Assign case_center to cluster 0 if present
  for (const n of nodes) {
    if (n.kind === 'case_center') {
      clusterByNode[n.id] = 0;
    }
  }

  return {
    clusterByNode,
    clusterCount: clusters.length,
    clusters,
  };
}

/**
 * Pure entity merge / deduplication: merges `duplicateEntityId` into
 * `primaryEntityId`, preserving merged attributes/aliases and rewiring
 * all ownershipEdges without creating self-loops or duplicates.
 */
export function mergeCaseEntities(
  activeCase: InvestigationCase,
  primaryEntityId: string,
  duplicateEntityId: string
): InvestigationCase {
  if (primaryEntityId === duplicateEntityId) return activeCase;
  const primary = activeCase.entities.find((e) => e.id === primaryEntityId);
  const duplicate = activeCase.entities.find((e) => e.id === duplicateEntityId);
  if (!primary || !duplicate) return activeCase;

  const mergedAttrs: Record<string, string> = {
    ...duplicate.attributes,
    ...primary.attributes,
    'Merged Alias': [
      primary.attributes['Merged Alias'],
      duplicate.label,
      duplicate.identifier,
    ]
      .filter(Boolean)
      .join(' · '),
  };

  const mergedSummary =
    primary.summary.includes(duplicate.label)
      ? primary.summary
      : `${primary.summary} [Merged with ${duplicate.label} (${duplicate.identifier})]`;

  const updatedEntities = activeCase.entities
    .filter((e) => e.id !== duplicateEntityId)
    .map((e) =>
      e.id === primaryEntityId
        ? {
            ...e,
            attributes: mergedAttrs,
            summary: mergedSummary,
          }
        : e
    );

  const seenEdgeKey = new Set<string>();
  const updatedEdges = activeCase.ownershipEdges
    .map((edge) => ({
      ...edge,
      sourceId:
        edge.sourceId === duplicateEntityId ? primaryEntityId : edge.sourceId,
      targetId:
        edge.targetId === duplicateEntityId ? primaryEntityId : edge.targetId,
    }))
    .filter((edge) => {
      if (edge.sourceId === edge.targetId) return false;
      const key = `${edge.sourceId}->${edge.targetId}:${edge.relationship}`;
      if (seenEdgeKey.has(key)) return false;
      seenEdgeKey.add(key);
      return true;
    });

  return {
    ...activeCase,
    updatedAtUtc: new Date().toISOString(),
    entities: updatedEntities,
    ownershipEdges: updatedEdges,
  };
}
