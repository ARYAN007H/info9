import { listConnectors } from '../connectors';
import type { EntityKind } from '../connectors/types';
import { enrichUsernameProfiles, runDeepEmailRecon } from './identityEnrich';
import { runInfraAttribution, searchGlobalPublicRecords } from './recordsAndIntel';
import { md5HexSync, analyzeEmailClue } from '../utils/contactRecon';
import type { Info9Database } from './database';

export type SpiderSeedKind = 'domain' | 'ip' | 'email' | 'username' | 'entity-name';

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`));
    }, ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export interface SpiderEntity {
  id: string;
  kind: SpiderSeedKind | 'asn' | 'url' | 'wallet';
  value: string;
  label: string;
  hop: number;
  source: string;
}

export interface SpiderEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relation: string;
  source: string;
}

export interface SpiderEvent {
  type: 'start' | 'hop_start' | 'step_result' | 'entity' | 'edge' | 'complete' | 'error';
  jobId: string;
  hop?: number;
  message: string;
  entity?: SpiderEntity;
  edge?: SpiderEdge;
  step?: {
    connector: string;
    target: string;
    status: 'ok' | 'empty' | 'error';
    durationMs: number;
    summary: string;
  };
  stats?: {
    entitiesFound: number;
    edgesFound: number;
    stepsCompleted: number;
  };
}

/**
 * Parallel Recursive Multi-Hop Pivot Engine (Depth 1-3) with cycle protection,
 * live SSE streaming callbacks, and SQLite scan_jobs persistence.
 */
export async function executeRecursivePivotSpider(
  params: {
    caseId: string;
    seedKind: SpiderSeedKind;
    seedValue: string;
    maxDepth: number;
  },
  db: Info9Database,
  emit: (event: SpiderEvent) => void
): Promise<{
  jobId: string;
  entities: SpiderEntity[];
  edges: SpiderEdge[];
  stepsCompleted: number;
}> {
  const depth = Math.max(1, Math.min(3, Math.round(params.maxDepth)));
  const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const startedAt = new Date().toISOString();

  const visitedNodes = new Map<string, SpiderEntity>();
  const edges: SpiderEdge[] = [];
  const edgeKeys = new Set<string>();
  let stepsCompleted = 0;

  const connectorsById = new Map(listConnectors().map((c) => [c.id, c]));

  const normKey = (kind: string, val: string) => `${kind}:${val.trim().toLowerCase()}`;

  const addEntity = (
    kind: SpiderEntity['kind'],
    value: string,
    label: string,
    hop: number,
    source: string
  ): SpiderEntity => {
    const clean = value.trim();
    const id = normKey(kind, clean);
    const existing = visitedNodes.get(id);
    if (existing) return existing;
    const entity: SpiderEntity = { id, kind, value: clean, label, hop, source };
    visitedNodes.set(id, entity);
    emit({ type: 'entity', jobId, hop, message: `Discovered ${kind}: ${clean}`, entity });
    return entity;
  };

  const addEdge = (sourceId: string, targetId: string, relation: string, source: string) => {
    if (sourceId === targetId) return;
    const k = `${sourceId}->${targetId}:${relation}`;
    if (edgeKeys.has(k)) return;
    edgeKeys.add(k);
    const edge: SpiderEdge = {
      id: `se-${edges.length + 1}`,
      sourceId,
      targetId,
      relation,
      source,
    };
    edges.push(edge);
    emit({ type: 'edge', jobId, message: `${relation}`, edge });
  };

  db.upsertScanJob({
    id: jobId,
    caseId: params.caseId,
    kind: params.seedKind,
    target: params.seedValue,
    depth,
    status: 'running',
    entitiesFound: 1,
    edgesFound: 0,
    stepsCompleted: 0,
    resultJson: null,
    createdAtUtc: startedAt,
    updatedAtUtc: startedAt,
  });

  emit({
    type: 'start',
    jobId,
    hop: 0,
    message: `Starting depth-${depth} recursive spider on ${params.seedKind}: ${params.seedValue}`,
  });

  const root = addEntity(
    params.seedKind,
    params.seedValue,
    params.seedValue,
    0,
    'Analyst Seed'
  );

  let frontier: SpiderEntity[] = [root];
  const expanded = new Set<string>();
  const MAX_ENTITIES_PER_HOP = 6;

  try {
    for (let hop = 1; hop <= depth; hop++) {
      const toExpand = frontier
        .filter((e) => !expanded.has(e.id))
        .slice(0, MAX_ENTITIES_PER_HOP);
      if (toExpand.length === 0) break;

      emit({
        type: 'hop_start',
        jobId,
        hop,
        message: `Hop ${hop}/${depth}: expanding ${toExpand.length} node(s) in parallel`,
      });

      const nextFrontier: SpiderEntity[] = [];

      await Promise.all(
        toExpand.map(async (node) => {
          expanded.add(node.id);

          // Dispatch parallel transforms based on entity kind
          if (node.kind === 'email') {
            const t0 = Date.now();
            try {
              const profile = analyzeEmailClue(node.value);
              const md5 = md5HexSync(node.value.toLowerCase());
              const recon = await runDeepEmailRecon(node.value.toLowerCase(), md5);
              stepsCompleted++;

              if (profile) {
                const domEnt = addEntity('domain', profile.domain, profile.domain, hop, 'Email Domain Pivot');
                addEdge(node.id, domEnt.id, 'mail domain', 'Email Parser');
                nextFrontier.push(domEnt);
                for (const h of profile.pivotHandles.slice(0, 1)) {
                  const hEnt = addEntity('username', h, `@${h}`, hop, 'Email Handle Derivation');
                  addEdge(node.id, hEnt.id, 'candidate handle', 'Email Parser');
                  nextFrontier.push(hEnt);
                }
              }
              for (const login of recon.githubLogins.slice(0, 2)) {
                const ghEnt = addEntity('username', login, `@${login} (GitHub)`, hop, 'GitHub Email Match');
                addEdge(node.id, ghEnt.id, 'github account', 'GitHub API');
                nextFrontier.push(ghEnt);
              }

              emit({
                type: 'step_result',
                jobId,
                hop,
                message: `Email recon on ${node.value}`,
                step: {
                  connector: 'deep-email-recon',
                  target: node.value,
                  status: 'ok',
                  durationMs: Date.now() - t0,
                  summary: `Gravatar=${recon.hasGravatar ? 'yes' : 'no'}, ProtonPGP=${recon.protonPgp.found ? 'yes' : 'no'}, Breaches=${recon.breachExposure.breachCount}, GitHub=${recon.githubLogins.length}`,
                },
              });
            } catch (err) {
              stepsCompleted++;
              emit({
                type: 'step_result',
                jobId,
                hop,
                message: `Email recon failed on ${node.value}`,
                step: {
                  connector: 'deep-email-recon',
                  target: node.value,
                  status: 'error',
                  durationMs: Date.now() - t0,
                  summary: err instanceof Error ? err.message : 'failed',
                },
              });
            }
          } else if (node.kind === 'username') {
            const t0 = Date.now();
            try {
              const profiles = await enrichUsernameProfiles(node.value);
              stepsCompleted++;
              for (const p of profiles) {
                if (p.displayName && p.displayName.includes(' ')) {
                  const nameEnt = addEntity(
                    'entity-name',
                    p.displayName,
                    `${p.displayName} (${p.platform})`,
                    hop,
                    p.provenance.source
                  );
                  addEdge(node.id, nameEnt.id, `${p.platform} display name`, p.provenance.source);
                  nextFrontier.push(nameEnt);
                }
                for (const em of p.discoveredEmails.slice(0, 2)) {
                  const emEnt = addEntity('email', em, em, hop, p.provenance.source);
                  addEdge(node.id, emEnt.id, 'public commit email', p.provenance.source);
                  nextFrontier.push(emEnt);
                }
                if (p.websiteUrl) {
                  try {
                    const host = new URL(
                      p.websiteUrl.startsWith('http') ? p.websiteUrl : `https://${p.websiteUrl}`
                    ).hostname.toLowerCase();
                    if (host && host.includes('.')) {
                      const dEnt = addEntity('domain', host, host, hop, p.provenance.source);
                      addEdge(node.id, dEnt.id, 'profile website', p.provenance.source);
                      nextFrontier.push(dEnt);
                    }
                  } catch {
                    // ignore malformed profile website
                  }
                }
              }
              emit({
                type: 'step_result',
                jobId,
                hop,
                message: `Profile enrichment for @${node.value}`,
                step: {
                  connector: 'profile-enrichment',
                  target: node.value,
                  status: profiles.length > 0 ? 'ok' : 'empty',
                  durationMs: Date.now() - t0,
                  summary:
                    profiles.length > 0
                      ? `Matched ${profiles.map((p) => p.platform).join(', ')}`
                      : 'No public API profiles found',
                },
              });
            } catch (err) {
              stepsCompleted++;
              emit({
                type: 'step_result',
                jobId,
                hop,
                message: `Profile enrichment error for ${node.value}`,
                step: {
                  connector: 'profile-enrichment',
                  target: node.value,
                  status: 'error',
                  durationMs: Date.now() - t0,
                  summary: err instanceof Error ? err.message : 'failed',
                },
              });
            }
          } else if (node.kind === 'domain') {
            const domainConn = connectorsById.get('domain-recon');
            const t0 = Date.now();
            let primaryIp: string | undefined;

            const domainTask = domainConn
              ? withTimeout(domainConn.run(node.value), 9000, 'domain-recon')
                  .then((res) => {
                    stepsCompleted++;
                    const ipEmitted = res.emitted.find((e) => e.kind === 'ip');
                    if (ipEmitted) {
                      primaryIp = ipEmitted.value;
                      const ipEnt = addEntity(
                        'ip',
                        ipEmitted.value,
                        `${ipEmitted.value} (${ipEmitted.label || 'IPv4'})`,
                        hop,
                        res.provenance.source
                      );
                      addEdge(node.id, ipEnt.id, 'A record', 'Cloudflare DoH');
                      nextFrontier.push(ipEnt);
                    }
                    emit({
                      type: 'step_result',
                      jobId,
                      hop,
                      message: `Passive domain recon for ${node.value}`,
                      step: {
                        connector: 'domain-recon',
                        target: node.value,
                        status: 'ok',
                        durationMs: Date.now() - t0,
                        summary: res.emitted.map((e) => `${e.kind}:${e.value}`).join(' · ') || 'Resolved',
                      },
                    });
                  })
                  .catch((err) => {
                    stepsCompleted++;
                    emit({
                      type: 'step_result',
                      jobId,
                      hop,
                      message: `Domain recon failed for ${node.value}`,
                      step: {
                        connector: 'domain-recon',
                        target: node.value,
                        status: 'error',
                        durationMs: Date.now() - t0,
                        summary: err instanceof Error ? err.message : 'failed',
                      },
                    });
                  })
              : Promise.resolve();

            const t1 = Date.now();
            const attrTask = withTimeout(runInfraAttribution(node.value), 9000, 'infra-attribution')
              .then((attr) => {
                stepsCompleted++;
                for (const co of attr.reverseIpDomains.slice(0, 3)) {
                  if (co.domain !== node.value) {
                    const coEnt = addEntity(
                      'domain',
                      co.domain,
                      co.domain,
                      hop,
                      'URLScan Reverse-IP'
                    );
                    addEdge(
                      primaryIp ? normKey('ip', primaryIp) : node.id,
                      coEnt.id,
                      'co-hosted domain',
                      'URLScan.io'
                    );
                    if (hop < depth) nextFrontier.push(coEnt);
                  }
                }
                emit({
                  type: 'step_result',
                  jobId,
                  hop,
                  message: `Attribution scan for ${node.value}`,
                  step: {
                    connector: 'infra-attribution',
                    target: node.value,
                    status: 'ok',
                    durationMs: Date.now() - t1,
                    summary: `${attr.reverseIpDomains.length} co-hosted · OTX pulses: ${attr.otx.pulseCount} · Favicon hash: ${attr.webFingerprint?.faviconHash ?? 'n/a'}`,
                  },
                });
              })
              .catch((err) => {
                stepsCompleted++;
                emit({
                  type: 'step_result',
                  jobId,
                  hop,
                  message: `Attribution scan failed for ${node.value}`,
                  step: {
                    connector: 'infra-attribution',
                    target: node.value,
                    status: 'error',
                    durationMs: Date.now() - t1,
                    summary: err instanceof Error ? err.message : 'failed',
                  },
                });
              });

            await Promise.all([domainTask, attrTask]);
          } else if (node.kind === 'ip') {
            const ipSteps = ['ip-geolocation', 'shodan-internetdb', 'ripestat-bgp'];
            await Promise.all(
              ipSteps.map(async (cid) => {
                const c = connectorsById.get(cid);
                if (!c) return;
                const t0 = Date.now();
                try {
                  const res = await c.run(node.value);
                  stepsCompleted++;
                  if (cid === 'ripestat-bgp' && res.data && typeof res.data === 'object') {
                    const bgp = res.data as { holderName?: string; upstreamPeers?: string[] };
                    const asnCode = bgp.upstreamPeers?.[0];
                    if (asnCode) {
                      const asnEnt = addEntity(
                        'asn',
                        asnCode,
                        `${asnCode} (${bgp.holderName || 'BGP Holder'})`,
                        hop,
                        'RIPEstat'
                      );
                      addEdge(node.id, asnEnt.id, 'announced by', 'RIPEstat');
                    }
                  }
                  emit({
                    type: 'step_result',
                    jobId,
                    hop,
                    message: `${cid} on ${node.value}`,
                    step: {
                      connector: cid,
                      target: node.value,
                      status: res.emitted.length > 0 ? 'ok' : 'empty',
                      durationMs: Date.now() - t0,
                      summary: res.emitted[0]?.label || res.dataGaps[0] || 'checked',
                    },
                  });
                } catch (err) {
                  stepsCompleted++;
                  emit({
                    type: 'step_result',
                    jobId,
                    hop,
                    message: `${cid} error on ${node.value}`,
                    step: {
                      connector: cid,
                      target: node.value,
                      status: 'error',
                      durationMs: Date.now() - t0,
                      summary: err instanceof Error ? err.message : 'failed',
                    },
                  });
                }
              })
            );
          } else if (node.kind === 'entity-name') {
            const t0 = Date.now();
            try {
              const [gleifRes, recordsRes] = await Promise.all([
                connectorsById.get('gleif-entity-search')?.run(node.value).catch(() => null),
                searchGlobalPublicRecords(node.value).catch(() => null),
              ]);
              stepsCompleted += 2;
              if (gleifRes) {
                for (const em of gleifRes.emitted.slice(0, 2)) {
                  const ent = addEntity(
                    'entity-name',
                    em.label || em.value,
                    `${em.label || em.value} (LEI ${em.value})`,
                    hop,
                    'GLEIF'
                  );
                  addEdge(node.id, ent.id, 'GLEIF legal entity', 'GLEIF');
                }
              }
              if (recordsRes) {
                for (const h of recordsRes.hits.slice(0, 4)) {
                  const urlEnt = addEntity('url', h.url, `${h.source}: ${h.title.slice(0, 40)}`, hop, h.source);
                  addEdge(node.id, urlEnt.id, h.source.toLowerCase(), h.source);
                }
              }
              emit({
                type: 'step_result',
                jobId,
                hop,
                message: `Registry & public record sweep for "${node.value}"`,
                step: {
                  connector: 'public-records-sweep',
                  target: node.value,
                  status:
                    (gleifRes?.emitted.length || 0) + (recordsRes?.hits.length || 0) > 0
                      ? 'ok'
                      : 'empty',
                  durationMs: Date.now() - t0,
                  summary: `GLEIF: ${gleifRes?.emitted.length ?? 0} · SEC/Courts/Watchlists: ${recordsRes?.hits.length ?? 0}`,
                },
              });
            } catch (err) {
              stepsCompleted++;
              emit({
                type: 'step_result',
                jobId,
                hop,
                message: `Registry sweep failed for "${node.value}"`,
                step: {
                  connector: 'public-records-sweep',
                  target: node.value,
                  status: 'error',
                  durationMs: Date.now() - t0,
                  summary: err instanceof Error ? err.message : 'failed',
                },
              });
            }
          }
        })
      );

      frontier = nextFrontier;
    }

    const entities = Array.from(visitedNodes.values());
    const finishedAt = new Date().toISOString();

    db.upsertScanJob({
      id: jobId,
      caseId: params.caseId,
      kind: params.seedKind,
      target: params.seedValue,
      depth,
      status: 'completed',
      entitiesFound: entities.length,
      edgesFound: edges.length,
      stepsCompleted,
      resultJson: JSON.stringify({ entities, edges }),
      createdAtUtc: startedAt,
      updatedAtUtc: finishedAt,
    });

    emit({
      type: 'complete',
      jobId,
      message: `Recursive spider finished: ${entities.length} entities, ${edges.length} edges across ${stepsCompleted} live checks.`,
      stats: {
        entitiesFound: entities.length,
        edgesFound: edges.length,
        stepsCompleted,
      },
    });

    return { jobId, entities, edges, stepsCompleted };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Spider execution failed';
    db.upsertScanJob({
      id: jobId,
      caseId: params.caseId,
      kind: params.seedKind,
      target: params.seedValue,
      depth,
      status: 'failed',
      entitiesFound: visitedNodes.size,
      edgesFound: edges.length,
      stepsCompleted,
      resultJson: null,
      createdAtUtc: startedAt,
      updatedAtUtc: new Date().toISOString(),
    });
    emit({ type: 'error', jobId, message: msg });
    throw err;
  }
}

export function normalizeSpiderSeedKind(raw: string): SpiderSeedKind {
  const k = raw.trim().toLowerCase() as EntityKind | SpiderSeedKind;
  if (k === 'domain' || k === 'ip' || k === 'email' || k === 'username' || k === 'entity-name') {
    return k;
  }
  return 'entity-name';
}
