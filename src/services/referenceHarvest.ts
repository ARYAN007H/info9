/**
 * Zero-key reference harvesting for the Face Recon bench.
 *
 * Gathers candidate portraits the analyst can match against:
 *  - username avatar sweep (unavatar.io + GitHub's keyless avatar endpoint)
 *  - Wikidata portrait verification (named person → P18 image on Commons)
 *
 * Every image is fetched as a blob (direct fetch first, local server proxy as
 * CORS fallback) and embedded locally — the reference image is never uploaded
 * anywhere; only our own proxy ever sees the download request.
 */

import {
  commonsPortraitUrl,
  githubAvatarUrl,
  unavatarUrl,
  WIKIDATA_ENTITIES_URL,
  WIKIDATA_SEARCH_URL,
} from '../utils/faceMatch';
import { detectFaces } from './faceEngine';
import type { FaceCandidate } from '../utils/faceMatch';

const PROXY_PREFIX = '/api/osint/image-proxy?url=';

/**
 * Fetches an image as a Blob: direct first (Wikimedia/GitHub/unavatar all
 * send CORS headers), then through the local SSRF-guarded proxy.
 */
export async function fetchImageBlob(url: string): Promise<Blob> {
  try {
    const direct = await fetch(url, { mode: 'cors', redirect: 'follow' });
    if (direct.ok) {
      const blob = await direct.blob();
      if (blob.size > 0 && blob.type.startsWith('image/')) return blob;
      throw new Error(`not an image (${blob.type || 'unknown type'})`);
    }
    throw new Error(`HTTP ${direct.status}`);
  } catch {
    const proxied = await fetch(`${PROXY_PREFIX}${encodeURIComponent(url)}`);
    if (!proxied.ok) {
      throw new Error(`HTTP ${proxied.status} (direct + proxy)`);
    }
    const blob = await proxied.blob();
    if (blob.size === 0 || !blob.type.startsWith('image/')) {
      throw new Error(`proxy returned ${blob.type || 'unknown type'}`);
    }
    return blob;
  }
}

/** Builds an object URL for display from a fetched blob (caller revokes). */
export async function fetchImageObjectUrl(url: string): Promise<string> {
  const blob = await fetchImageBlob(url);
  return URL.createObjectURL(blob);
}

export interface HarvestedCandidate extends FaceCandidate {
  /** Populated when embedding failed — rendered as an explicit gap, not dropped silently. */
  embedError?: string;
}

interface HumanCand {
  candidate: FaceCandidate;
  error?: string;
}

/**
 * Picks the highest-confidence face with an embedding from an image; a photo
 * with no detectable face is reported as such (honest gap), not skipped.
 */
async function embedBestFace(
  blob: Blob,
  meta: Pick<FaceCandidate, 'id' | 'label' | 'sourceType' | 'sourceUrl'>,
  thumbnailUrl: string | null
): Promise<HumanCand> {
  try {
    const faces = await detectFaces(blob);
    const best =
      faces
        .filter((f) => f.embedding && f.embedding.length > 0)
        .sort((a, b) => b.score - a.score)[0] ?? null;
    if (!best || !best.embedding) {
      return {
        candidate: { ...meta, embedding: [], ageEstimate: null, genderEstimate: null, thumbnailUrl },
        error: 'no detectable face in reference image',
      };
    }
    return {
      candidate: {
        ...meta,
        embedding: best.embedding,
        ageEstimate: best.ageEstimate,
        genderEstimate: best.genderEstimate,
        thumbnailUrl: best.thumbnailDataUrl ?? thumbnailUrl,
      },
    };
  } catch (err) {
    return {
      candidate: { ...meta, embedding: [], ageEstimate: null, genderEstimate: null, thumbnailUrl },
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface AvatarHarvestResult {
  candidates: HarvestedCandidate[];
  /** Per-source failures, kept visible — no silent dropping. */
  gaps: Array<{ source: string; error: string }>;
}

/**
 * Sweeps avatar sources for one username. unavatar aggregates GitHub, X,
 * Gravatar and ~20 more providers behind one keyless URL; the GitHub avatar
 * endpoint is queried directly as a second source. Nothing fabricates an
 * image: failed sources land in `gaps`.
 */
export async function harvestAvatars(username: string): Promise<AvatarHarvestResult> {
  const handle = username.trim().replace(/^@/, '');
  if (!/^[\w.\-]{1,64}$/.test(handle)) {
    throw new Error('Username must be 1-64 chars of letters, digits, dot, dash, underscore');
  }
  const sources = [
    { name: `unavatar (@${handle})`, url: unavatarUrl(handle) },
    { name: `github (@${handle})`, url: githubAvatarUrl(handle) },
  ];
  const candidates: HarvestedCandidate[] = [];
  const gaps: Array<{ source: string; error: string }> = [];
  await Promise.all(
    sources.map(async (src) => {
      try {
        const blob = await fetchImageBlob(src.url);
        const objectUrl = URL.createObjectURL(blob);
        const res = await embedBestFace(
          blob,
          {
            id: `avatar:${src.name}`,
            label: `@${handle} — ${src.name.split(' (')[0]}`,
            sourceType: 'AVATAR_HARVEST',
            sourceUrl: src.url,
          },
          objectUrl
        );
        candidates.push(res.candidate);
        if (res.error) gaps.push({ source: src.name, error: res.error });
      } catch (err) {
        gaps.push({
          source: src.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })
  );
  return { candidates, gaps };
}

export interface WikidataPortrait {
  qid: string;
  label: string;
  description: string | null;
  imageUrl: string;
}

/**
 * Named-person portrait lookup: Wikidata entity search → P18 claim →
 * Commons render URL. Returns null when the entity has no P18 — callers
 * must surface that as a data gap (many entities legitimately lack one).
 */
export async function findWikidataPortrait(
  name: string
): Promise<WikidataPortrait | null> {
  const searchRes = await fetch(WIKIDATA_SEARCH_URL(name));
  if (!searchRes.ok) throw new Error(`Wikidata search HTTP ${searchRes.status}`);
  const searchJson = (await searchRes.json()) as {
    search?: Array<{ id: string; label?: string; description?: string }>;
  };
  const hit = searchJson.search?.[0];
  if (!hit) return null;

  const entityRes = await fetch(WIKIDATA_ENTITIES_URL([hit.id]));
  if (!entityRes.ok) throw new Error(`Wikidata entities HTTP ${entityRes.status}`);
  const entityJson = (await entityRes.json()) as {
    entities?: Record<
      string,
      { claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>> }
    >;
  };
  const p18 = entityJson.entities?.[hit.id]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  if (typeof p18 !== 'string' || p18.length === 0) return null;
  return {
    qid: hit.id,
    label: hit.label ?? name,
    description: hit.description ?? null,
    imageUrl: commonsPortraitUrl(p18),
  };
}

/**
 * Verifies the query face against a named person's Wikidata portrait.
 * Returns the candidate with embedding, or a structured miss when the
 * person/portrait can't be resolved.
 */
export async function harvestWikidataPortrait(name: string): Promise<{
  ok: true;
  candidate: HarvestedCandidate;
} | { ok: false; reason: 'NO_ENTITY' | 'NO_P18' | 'FETCH_FAILED'; detail: string }> {
  let portrait: WikidataPortrait | null;
  try {
    portrait = await findWikidataPortrait(name);
  } catch (err) {
    return {
      ok: false,
      reason: 'FETCH_FAILED',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  if (!portrait) return { ok: false, reason: 'NO_ENTITY', detail: `No Wikidata entity found for “${name}”` };
  try {
    const blob = await fetchImageBlob(portrait.imageUrl);
    const objectUrl = URL.createObjectURL(blob);
    const res = await embedBestFace(
      blob,
      {
        id: `wikidata:${portrait.qid}`,
        label: `${portrait.label} (${portrait.qid})`,
        sourceType: 'WIKIDATA_PORTRAIT',
        sourceUrl: `https://www.wikidata.org/wiki/${portrait.qid}`,
      },
      objectUrl
    );
    if (res.error) {
      return { ok: false, reason: 'FETCH_FAILED', detail: res.error };
    }
    return { ok: true, candidate: res.candidate };
  } catch (err) {
    return {
      ok: false,
      reason: 'FETCH_FAILED',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
