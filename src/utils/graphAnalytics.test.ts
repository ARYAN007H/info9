import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectGraphCommunities,
  findShortestPath,
  mergeCaseEntities,
} from './graphAnalytics';
import { DEFAULT_WORKSPACE_CASE } from '../data/seedCases';

test('findShortestPath computes minimum-hop undirected BFS path', () => {
  const nodes = [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }, { id: 'E' }];
  const edges = [
    { id: 'e1', sourceId: 'A', targetId: 'B' },
    { id: 'e2', sourceId: 'B', targetId: 'C' },
    { id: 'e3', sourceId: 'C', targetId: 'D' },
    { id: 'e4', sourceId: 'A', targetId: 'D' }, // direct shortcut
  ];

  const shortest = findShortestPath(nodes, edges, 'A', 'D');
  assert.ok(shortest);
  assert.equal(shortest.hops, 1);
  assert.deepEqual(shortest.nodeIds, ['A', 'D']);

  const unreachable = findShortestPath(nodes, edges, 'A', 'E');
  assert.equal(unreachable, null);
});

test('detectGraphCommunities isolates disconnected sub-clusters while ignoring case_center hub', () => {
  const nodes = [
    { id: 'center', kind: 'case_center' as const },
    { id: 'n1', kind: 'domain' as const },
    { id: 'n2', kind: 'ip' as const },
    { id: 'n3', kind: 'entity' as const },
    { id: 'n4', kind: 'entity' as const },
  ];
  const edges = [
    { sourceId: 'center', targetId: 'n1' },
    { sourceId: 'center', targetId: 'n3' },
    { sourceId: 'n1', targetId: 'n2' },
    { sourceId: 'n3', targetId: 'n4' },
  ];

  const comm = detectGraphCommunities(nodes, edges);
  assert.equal(comm.clusterCount, 2);
  assert.equal(comm.clusterByNode['n1'], comm.clusterByNode['n2']);
  assert.equal(comm.clusterByNode['n3'], comm.clusterByNode['n4']);
  assert.notEqual(comm.clusterByNode['n1'], comm.clusterByNode['n3']);
});

test('mergeCaseEntities consolidates duplicate entity and rewires ownership edges without self-loops', () => {
  const prov = { status: 'LIVE' as const, source: 'Test', fetchedAtUtc: '2026-01-01T00:00:00Z' };
  const c = {
    ...DEFAULT_WORKSPACE_CASE,
    entities: [
      {
        id: 'ent-1',
        label: 'Meridian Holdings Ltd',
        type: 'company' as const,
        jurisdiction: 'CY',
        identifier: 'HE-101',
        summary: 'Primary entity',
        riskLevel: 'medium' as const,
        attributes: { Status: 'Active' } as Record<string, string>,
        provenance: prov,
      },
      {
        id: 'ent-2',
        label: 'Meridian Holdings Limited',
        type: 'company' as const,
        jurisdiction: 'CY',
        identifier: 'HE-101-DUP',
        summary: 'Duplicate alias',
        riskLevel: 'medium' as const,
        attributes: { Alias: 'MHL' } as Record<string, string>,
        provenance: prov,
      },
      {
        id: 'ent-3',
        label: 'Vega Shipping Corp',
        type: 'company' as const,
        jurisdiction: 'MH',
        identifier: 'MH-99',
        summary: 'Subsidiary',
        riskLevel: 'high' as const,
        attributes: {} as Record<string, string>,
        provenance: prov,
      },
    ],
    ownershipEdges: [
      {
        id: 'ow-1',
        sourceId: 'ent-2',
        targetId: 'ent-3',
        relationship: 'Beneficial Owner',
        ownershipPercent: 100,
        verifiedSource: 'GLEIF',
      },
      {
        id: 'ow-2',
        sourceId: 'ent-1',
        targetId: 'ent-2',
        relationship: 'Same Entity',
        verifiedSource: 'Analyst',
      },
    ],
  };

  const merged = mergeCaseEntities(c, 'ent-1', 'ent-2');
  assert.equal(merged.entities.length, 2);
  assert.ok(!merged.entities.some((e) => e.id === 'ent-2'));
  const updatedPrimary = merged.entities.find((e) => e.id === 'ent-1')!;
  assert.ok(updatedPrimary.attributes['Merged Alias'].includes('Meridian Holdings Limited'));
  assert.equal(merged.ownershipEdges.length, 1);
  assert.equal(merged.ownershipEdges[0].sourceId, 'ent-1');
  assert.equal(merged.ownershipEdges[0].targetId, 'ent-3');
});
