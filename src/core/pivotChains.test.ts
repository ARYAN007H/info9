import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAIN_RECIPES,
  resolveStepInput,
  runChain,
  type ChainRecipe,
  type ChainRegistry,
} from './pivotChains';
import { getConnector, validateRegistry } from '../connectors';
import type { ConnectorResult } from '../connectors/types';

test('every recipe step references a registered connector with compatible inputs', () => {
  const problems: string[] = [];
  for (const recipe of CHAIN_RECIPES) {
    const entry = getConnector(recipe.steps[0].connectorId);
    if (!entry) {
      problems.push(`${recipe.id}: entry connector missing`);
      continue;
    }
    if (entry.accepts !== recipe.inputKind) {
      problems.push(
        `${recipe.id}: entry connector accepts ${entry.accepts}, recipe expects ${recipe.inputKind}`
      );
    }
    for (const step of recipe.steps.slice(1)) {
      const connector = getConnector(step.connectorId);
      if (!connector) {
        problems.push(`${recipe.id}: unknown connector ${step.connectorId}`);
      } else if (step.inputFrom !== 'input' && step.inputFrom.kind !== connector.accepts) {
        problems.push(
          `${recipe.id}/${step.connectorId}: pivot kind ${step.inputFrom.kind} != connector input ${connector.accepts}`
        );
      }
    }
  }
  assert.deepEqual(problems, [], problems.join('; '));
  assert.deepEqual(validateRegistry(), []);
});

test('resolveStepInput picks the Nth emitted entity of the requested kind', () => {
  const emitted = [
    { kind: 'ip' as const, value: '1.1.1.1' },
    { kind: 'coordinates' as const, value: '35.0,139.0' },
    { kind: 'ip' as const, value: '8.8.8.8' },
  ];
  assert.equal(
    resolveStepInput({ connectorId: 'x', label: '', inputFrom: 'input' }, 'example.com', emitted),
    'example.com'
  );
  assert.equal(
    resolveStepInput({ connectorId: 'x', label: '', inputFrom: { kind: 'ip', index: 0 } }, 't', emitted),
    '1.1.1.1'
  );
  assert.equal(
    resolveStepInput({ connectorId: 'x', label: '', inputFrom: { kind: 'ip', index: 1 } }, 't', emitted),
    '8.8.8.8'
  );
  assert.equal(
    resolveStepInput({ connectorId: 'x', label: '', inputFrom: { kind: 'ip', index: 5 } }, 't', emitted),
    null
  );
});

test('runChain pivots off real upstream output and logs honest statuses', async () => {
  const calls: string[] = [];
  const okResult = (emitted: ConnectorResult['emitted']): ConnectorResult => ({
    connectorId: 'test',
    target: '',
    emitted,
    data: null,
    provenance: { status: 'LIVE', source: 'test', fetchedAtUtc: '2026-01-01T00:00:00Z' },
    dataGaps: [],
  });

  const registry: ChainRegistry = {
    'source-a': {
      id: 'source-a',
      run: async (input) => {
        calls.push(`a:${input}`);
        return okResult([{ kind: 'ip', value: '203.0.113.7' }]);
      },
    },
    'source-b': {
      id: 'source-b',
      run: async (input) => {
        calls.push(`b:${input}`);
        return {
          ...okResult([]),
          connectorId: 'source-b',
          dataGaps: ['nothing indexed'],
        };
      },
    },
    'source-boom': {
      id: 'source-boom',
      run: async (input) => {
        calls.push(`boom:${input}`);
        throw new Error('upstream 500');
      },
    },
  };

  const recipe: ChainRecipe = {
    id: 'test-chain',
    inputKind: 'domain',
    title: 'Test',
    inputPlaceholder: '',
    description: '',
    steps: [
      { connectorId: 'source-a', label: 'A', inputFrom: 'input' },
      { connectorId: 'source-b', label: 'B from ip', inputFrom: { kind: 'ip', index: 0 } },
      { connectorId: 'source-boom', label: 'Boom', inputFrom: 'input' },
      { connectorId: 'missing-connector', label: 'Missing', inputFrom: 'input' },
      { connectorId: 'source-a', label: 'Needs coordinates — none emitted', inputFrom: { kind: 'coordinates', index: 0 } },
    ],
  };

  const run = await runChain(recipe, 'example.com', registry, () => 'T0');
  assert.equal(run.startedAtUtc, 'T0');
  assert.deepEqual(calls, ['a:example.com', 'b:203.0.113.7', 'boom:example.com']);
  assert.equal(run.steps[0].status, 'ok');
  assert.equal(run.steps[1].status, 'empty');
  assert.equal(run.steps[1].summary, 'nothing indexed');
  assert.equal(run.steps[2].status, 'error');
  assert.match(run.steps[2].error ?? '', /upstream 500/);
  assert.equal(run.steps[3].status, 'skipped');
  assert.equal(run.steps[4].status, 'skipped');
});
