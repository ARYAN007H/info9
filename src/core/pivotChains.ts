import type { Connector, ConnectorResult, EntityKind, PivotedEntity } from '../connectors/types';

/**
 * Automated pivot chains: one input, an orchestrated multi-source
 * investigation run. Every step is logged with status, provenance and data
 * gaps — a run reads like an analyst's notebook, and downstream inputs are
 * picked from what upstream steps actually emitted (no invented entities).
 *
 * The registry is injected so the scheduling logic is unit-testable with
 * fake connectors.
 */

export type ChainInputKind = EntityKind;

export interface ChainStep {
  connectorId: string;
  label: string;
  /** 'input' uses the raw target; otherwise take the Nth entity of `kind` emitted so far. */
  inputFrom: 'input' | { kind: EntityKind; index?: number };
}

export interface ChainRecipe {
  id: string;
  inputKind: ChainInputKind;
  title: string;
  inputPlaceholder: string;
  description: string;
  steps: ChainStep[];
}

export type StepStatus = 'ok' | 'empty' | 'error' | 'skipped';

export interface StepOutcome {
  connectorId: string;
  label: string;
  status: StepStatus;
  summary: string;
  durationMs: number;
  emitted: PivotedEntity[];
  dataGaps: string[];
  data?: unknown;
  error?: string;
}

export interface ChainRun {
  recipeId: string;
  target: string;
  startedAtUtc: string;
  finishedAtUtc: string;
  steps: StepOutcome[];
}

export type ChainRegistry = Record<
  string,
  Pick<Connector, 'id' | 'run'>
>;

export const CHAIN_RECIPES: ChainRecipe[] = [
  {
    id: 'domain-full-recon',
    inputKind: 'domain',
    title: 'Domain full recon',
    inputPlaceholder: 'example.com',
    description:
      'DNS + registration + certificates, then exposure (Shodan), routing (RIPEstat), public scan history (URLScan) and archival history (Wayback) — every step pivoting off real upstream output.',
    steps: [
      { connectorId: 'domain-recon', label: 'Passive domain recon', inputFrom: 'input' },
      { connectorId: 'shodan-internetdb', label: 'Exposure scan on primary IP', inputFrom: { kind: 'ip', index: 0 } },
      { connectorId: 'ripestat-bgp', label: 'BGP origin on primary IP', inputFrom: { kind: 'ip', index: 0 } },
      { connectorId: 'urlscan-search', label: 'URLScan public history', inputFrom: 'input' },
      { connectorId: 'wayback-history', label: 'Wayback capture history', inputFrom: 'input' },
    ],
  },
  {
    id: 'ip-full-attribution',
    inputKind: 'ip',
    title: 'IP full attribution',
    inputPlaceholder: '1.1.1.1',
    description:
      'Geolocate the address, then profile its exposure and BGP routing.',
    steps: [
      { connectorId: 'ip-geolocation', label: 'Geolocation + ASN', inputFrom: 'input' },
      { connectorId: 'shodan-internetdb', label: 'Open ports / CVEs', inputFrom: 'input' },
      { connectorId: 'ripestat-bgp', label: 'BGP prefix & holder', inputFrom: 'input' },
    ],
  },
  {
    id: 'place-multi-source',
    inputKind: 'place',
    title: 'Place multi-source pin',
    inputPlaceholder: 'Tower Bridge London',
    description:
      'Geocode the place, then scan landmarks, weather, and geolocated public photos around the resolved coordinates.',
    steps: [
      { connectorId: 'nominatim-geocode', label: 'Geocode', inputFrom: 'input' },
      { connectorId: 'overpass-landmarks', label: 'Landmark scan', inputFrom: { kind: 'coordinates', index: 0 } },
      { connectorId: 'open-meteo-verification', label: 'Weather verification', inputFrom: { kind: 'coordinates', index: 0 } },
      { connectorId: 'commons-geophoto', label: 'Geolocated Commons photos', inputFrom: 'input' },
    ],
  },
  {
    id: 'entity-cross-registry',
    inputKind: 'entity-name',
    title: 'Entity cross-registry sweep',
    inputPlaceholder: 'Siemens AG',
    description:
      'Search the name across GLEIF, Wikidata and GitHub in one pass.',
    steps: [
      { connectorId: 'gleif-entity-search', label: 'GLEIF registry', inputFrom: 'input' },
      { connectorId: 'wikidata-search', label: 'Wikidata knowledge graph', inputFrom: 'input' },
      { connectorId: 'github-user-recon', label: 'GitHub presence', inputFrom: 'input' },
    ],
  },
];

export function getChainRecipe(inputKind: ChainInputKind): ChainRecipe | undefined {
  return CHAIN_RECIPES.find((r) => r.inputKind === inputKind);
}

/** Resolves the input for a step from the run so far, or null if unavailable. */
export function resolveStepInput(
  step: ChainStep,
  target: string,
  emittedSoFar: PivotedEntity[]
): string | null {
  if (step.inputFrom === 'input') return target;
  const { kind, index = 0 } = step.inputFrom;
  const matches = emittedSoFar.filter((e) => e.kind === kind);
  const entity = matches[index];
  return entity ? entity.value : null;
}

function summarize(result: ConnectorResult): string {
  const entityCount = result.emitted.length;
  if (entityCount === 0) {
    return result.dataGaps.length > 0
      ? result.dataGaps.join('; ')
      : 'No entities emitted';
  }
  const first = result.emitted[0];
  const more = entityCount > 1 ? ` (+${entityCount - 1} more)` : '';
  return `${first.label ? `${first.label}` : first.value}${more}`;
}

/** Executes a recipe step by step, pivoting only on actually-emitted entities. */
export async function runChain(
  recipe: ChainRecipe,
  target: string,
  registry: ChainRegistry,
  now: () => string = () => new Date().toISOString()
): Promise<ChainRun> {
  const startedAtUtc = now();
  const steps: StepOutcome[] = [];
  const emittedSoFar: PivotedEntity[] = [];

  for (const step of recipe.steps) {
    const connector = registry[step.connectorId];
    if (!connector) {
      steps.push({
        connectorId: step.connectorId,
        label: step.label,
        status: 'skipped',
        summary: `Connector "${step.connectorId}" not in registry`,
        durationMs: 0,
        emitted: [],
        dataGaps: [],
      });
      continue;
    }
    const input = resolveStepInput(step, target, emittedSoFar);
    if (input === null) {
      steps.push({
        connectorId: step.connectorId,
        label: step.label,
        status: 'skipped',
        summary: 'No upstream entity of the required kind was emitted',
        durationMs: 0,
        emitted: [],
        dataGaps: [],
      });
      continue;
    }
    const t0 = Date.now();
    try {
      const result = await connector.run(input);
      const durationMs = Date.now() - t0;
      emittedSoFar.push(...result.emitted);
      steps.push({
        connectorId: step.connectorId,
        label: step.label,
        status: result.emitted.length > 0 ? 'ok' : 'empty',
        summary: summarize(result),
        durationMs,
        emitted: result.emitted,
        dataGaps: result.dataGaps,
        data: result.data,
      });
    } catch (err) {
      steps.push({
        connectorId: step.connectorId,
        label: step.label,
        status: 'error',
        summary: 'Step failed — recorded as a gap, never fabricated',
        durationMs: Date.now() - t0,
        emitted: [],
        dataGaps: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    recipeId: recipe.id,
    target,
    startedAtUtc,
    finishedAtUtc: now(),
    steps,
  };
}
