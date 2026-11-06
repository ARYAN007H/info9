import type { ProvenanceMeta } from '../types/osint';

/**
 * The info9 connector contract. One file of logic per data source; the
 * registry uses the declared input/output kinds to auto-suggest pivots —
 * the Maltego-style transform graph, but over free public sources only.
 */

export type EntityKind =
  | 'domain'
  | 'ip'
  | 'coordinates'
  | 'place'
  | 'entity-name'
  | 'photo';

export type ConnectorCategory =
  | 'infra'
  | 'geolocation'
  | 'corporate'
  | 'archive'
  | 'photo';

export interface ConnectorPolicy {
  requiresKey: false;
  docsUrl: string;
  /** Upstream-tolerated requests per minute (0 = no published limit). */
  rateLimitPerMinute: number;
}

export interface PivotedEntity {
  kind: EntityKind;
  value: string;
  label?: string;
}

export interface ConnectorResult {
  connectorId: string;
  target: string;
  /** Entities emitted for pivoting (subset of what `data` contains). */
  emitted: PivotedEntity[];
  /** Full connector payload. */
  data: unknown;
  provenance: ProvenanceMeta;
  /** Named upstreams that failed or contributed nothing. */
  dataGaps: string[];
}

export interface Connector {
  id: string;
  label: string;
  description: string;
  category: ConnectorCategory;
  /** The entity kind this connector accepts as input. */
  accepts: EntityKind;
  /** Entity kinds present in the result's emitted entities. */
  emits: EntityKind[];
  policy: ConnectorPolicy;
  run(target: string): Promise<ConnectorResult>;
}

export const INFO9_USER_AGENT =
  'info9/0.1 (zero-key OSINT workbench; +https://github.com/ARYAN007H/info9)';
