/**
 * Face match math — pure functions, no DOM, no ML runtime.
 *
 * Embeddings come from the in-browser FaceRes network (src/services/faceEngine.ts),
 * which never uploads the photo: the pixels are analyzed locally and only the
 * numeric descriptor is compared here.
 *
 * Evidentiary contract: a similarity score is a *heuristic triage signal*,
 * never proof of identity. Bands below are named honestly, and every result
 * carries its provenance so the ledger can audit where the descriptor came from.
 */

export interface FaceCandidate {
  id: string;
  /** Human-visible label, e.g. filename, "@handle (github avatar)", "Wikidata Q42". */
  label: string;
  /** Where the image came from — kept verbatim for the ledger. */
  sourceType: 'UPLOAD' | 'AVATAR_HARVEST' | 'WIKIDATA_PORTRAIT';
  sourceUrl: string;
  embedding: number[];
  /** null when the engine did not report one — never guessed. */
  ageEstimate: number | null;
  /** 'male' | 'female' | null — network estimate, not ground truth. */
  genderEstimate: 'male' | 'female' | null;
  thumbnailUrl: string | null;
}

export type SimilarityBand =
  | 'STRONG_SIMILARITY'
  | 'POSSIBLE_MATCH'
  | 'WEAK_SIGNAL'
  | 'NO_MATCH';

export const SIMILARITY_BANDS: Array<{
  band: SimilarityBand;
  minSimilarity: number;
  label: string;
  note: string;
}> = [
  {
    band: 'STRONG_SIMILARITY',
    minSimilarity: 0.55,
    label: 'Strong similarity',
    note: 'Descriptors are close — corroborate before treating as the same person.',
  },
  {
    band: 'POSSIBLE_MATCH',
    minSimilarity: 0.45,
    label: 'Possible match',
    note: 'Overlapping descriptors — review manually with more references.',
  },
  {
    band: 'WEAK_SIGNAL',
    minSimilarity: 0.3,
    label: 'Weak signal',
    note: 'Likely different people; kept only for analyst completeness.',
  },
  {
    band: 'NO_MATCH',
    minSimilarity: Number.NEGATIVE_INFINITY,
    label: 'No match',
    note: 'Descriptors are far apart.',
  },
];

/** 0.5 is the engine's documented "consider a match" line; bands bracket it. */
export function bandFor(similarity: number): SimilarityBand {
  for (const b of SIMILARITY_BANDS) {
    if (similarity >= b.minSimilarity) return b.band;
  }
  return 'NO_MATCH';
}

export function bandLabel(band: SimilarityBand): string {
  return SIMILARITY_BANDS.find((b) => b.band === band)?.label ?? band;
}

/**
 * Cosine similarity between two face embeddings. Returns null when either
 * descriptor is missing, empty, non-finite, or the lengths differ — the
 * match is then reported as UNAVAILABLE, not as a zero.
 */
export function cosineSimilarity(a: number[], b: number[]): number | null {
  if (
    !Array.isArray(a) ||
    !Array.isArray(b) ||
    a.length === 0 ||
    a.length !== b.length
  ) {
    return null;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return null;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface RankedFaceMatch {
  candidate: FaceCandidate;
  /** null when the descriptor pair could not be compared (length/finite mismatch). */
  similarity: number | null;
  band: SimilarityBand | null;
}

/** Ranks a corpus against a query descriptor, best first; incomparable entries sink ranked last with null scores. */
export function rankCandidates(
  queryEmbedding: number[],
  candidates: FaceCandidate[]
): RankedFaceMatch[] {
  return candidates
    .map((candidate) => {
      const similarity = cosineSimilarity(queryEmbedding, candidate.embedding);
      return {
        candidate,
        similarity,
        band: similarity == null ? null : bandFor(similarity),
      };
    })
    .sort((a, b) => {
      if (a.similarity == null && b.similarity == null) return 0;
      if (a.similarity == null) return 1;
      if (b.similarity == null) return -1;
      return b.similarity - a.similarity;
    });
}

/**
 * Clusters a corpus by descriptor similarity (union-find at `threshold`).
 * Returns groups of candidate ids; singletons are included as 1-element
 * groups so the analyst sees the full accounting, not just merged blobs.
 */
export function clusterFaces(
  candidates: FaceCandidate[],
  threshold = 0.5
): string[][] {
  const ids = candidates.map((c) => c.id);
  const parent = new Map<string, string>(ids.map((id) => [id, id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cur = id;
    while (parent.get(cur) !== cur) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const sim = cosineSimilarity(
        candidates[i].embedding,
        candidates[j].embedding
      );
      if (sim != null && sim >= threshold) union(candidates[i].id, candidates[j].id);
    }
  }
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const root = find(id);
    const list = groups.get(root) ?? [];
    list.push(id);
    groups.set(root, list);
  }
  return [...groups.values()].sort((a, b) => b.length - a.length);
}

// ---- Zero-key reference-source URL builders (pure, testable) ----

/**
 * unavatar.io — free, keyless public avatar aggregator. `fallback=false`
 * keeps a miss as a real 404 instead of a synthesized placeholder image.
 */
export function unavatarUrl(username: string, provider?: string): string {
  const handle = encodeURIComponent(username.trim().replace(/^@/, ''));
  return provider
    ? `https://unavatar.io/${encodeURIComponent(provider)}/${handle}?fallback=false`
    : `https://unavatar.io/${handle}?fallback=false`;
}

/** GitHub avatar via the official keyless endpoint (follows the user's set avatar). */
export function githubAvatarUrl(username: string): string {
  const handle = encodeURIComponent(username.trim().replace(/^@/, ''));
  return `https://avatars.githubusercontent.com/${handle}?size=256`;
}

/**
 * Wikimedia Commons file render (P18 portraits live here). Special:FilePath
 * redirects to the actual asset; a width cap keeps embeddings fast.
 */
export function commonsPortraitUrl(filename: string, width = 512): string {
  const clean = filename.trim().replace(/^File:/i, '');
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(
    clean
  )}?width=${width}`;
}

export const WIKIDATA_SEARCH_URL = (name: string): string =>
  `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(
    name
  )}&language=en&format=json&origin=*&limit=5`;

export const WIKIDATA_ENTITIES_URL = (ids: string[]): string =>
  `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids
    .map((id) => encodeURIComponent(id))
    .join('|')}&props=labels|claims&languages=en&format=json&origin=*`;
