import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bandFor,
  clusterFaces,
  commonsPortraitUrl,
  cosineSimilarity,
  githubAvatarUrl,
  rankCandidates,
  unavatarUrl,
  WIKIDATA_ENTITIES_URL,
  WIKIDATA_SEARCH_URL,
  type FaceCandidate,
} from './faceMatch';

const embedding = (values: number[]): number[] => values;

const candidate = (over: Partial<FaceCandidate>): FaceCandidate => ({
  id: over.id ?? 'c1',
  label: over.label ?? 'Candidate 1',
  sourceType: over.sourceType ?? 'UPLOAD',
  sourceUrl: over.sourceUrl ?? 'file://local',
  embedding: over.embedding ?? embedding([1, 0, 0]),
  ageEstimate: over.ageEstimate ?? null,
  genderEstimate: over.genderEstimate ?? null,
  thumbnailUrl: over.thumbnailUrl ?? null,
});

test('cosineSimilarity: identical=1, orthogonal=0, opposite=-1, garbage=null', () => {
  assert.ok(Math.abs(cosineSimilarity([1, 2, 3], [2, 4, 6])! - 1) < 1e-9);
  assert.ok(Math.abs(cosineSimilarity([1, 0], [0, 1])!) < 1e-9);
  assert.ok(Math.abs(cosineSimilarity([1, 0], [-1, 0])! + 1) < 1e-9);
  assert.equal(cosineSimilarity([], [1]), null);
  assert.equal(cosineSimilarity([1, 2], [1, 2, 3]), null, 'length mismatch is not a zero score');
  assert.equal(cosineSimilarity([NaN, 1], [1, 1]), null, 'non-finite is not a zero score');
  assert.equal(cosineSimilarity([0, 0], [1, 1]), null, 'zero vector has no direction');
});

test('bandFor brackets the engine match line at 0.5 honestly', () => {
  assert.equal(bandFor(0.9), 'STRONG_SIMILARITY');
  assert.equal(bandFor(0.55), 'STRONG_SIMILARITY');
  assert.equal(bandFor(0.52), 'POSSIBLE_MATCH', '0.5 line alone is not strong');
  assert.equal(bandFor(0.45), 'POSSIBLE_MATCH');
  assert.equal(bandFor(0.31), 'WEAK_SIGNAL');
  assert.equal(bandFor(0.1), 'NO_MATCH');
  assert.equal(bandFor(-1), 'NO_MATCH');
});

test('rankCandidates sorts best-first and sinks incomparable entries with null scores', () => {
  const query = embedding([1, 0]);
  const matches = rankCandidates(query, [
    candidate({ id: 'weak', embedding: embedding([0, 1]) }),
    candidate({ id: 'strong', embedding: embedding([0.9, 0.1]) }),
    candidate({ id: 'broken', embedding: embedding([1, 2, 3]) }),
  ]);
  assert.equal(matches[0].candidate.id, 'strong');
  assert.equal(matches[0].band, 'STRONG_SIMILARITY');
  assert.equal(matches[1].candidate.id, 'weak');
  assert.equal(matches[2].candidate.id, 'broken');
  assert.equal(matches[2].similarity, null);
  assert.equal(matches[2].band, null);
});

test('clusterFaces unions only above threshold and keeps singletons visible', () => {
  // A/B point the same direction; C is orthogonal; D broken.
  const corpus = [
    candidate({ id: 'a', embedding: embedding([1, 0.05]) }),
    candidate({ id: 'b', embedding: embedding([1, 0.1]) }),
    candidate({ id: 'c', embedding: embedding([0, 1]) }),
    candidate({ id: 'd', embedding: embedding([1, 2, 3]) }),
  ];
  const groups = clusterFaces(corpus, 0.5);
  assert.equal(groups.length, 3, 'A+B merged, C singleton, D singleton');
  const ab = groups.find((g) => g.length === 2)!;
  assert.deepEqual([...ab].sort(), ['a', 'b']);
  assert.ok(groups.some((g) => g.length === 1 && g[0] === 'c'));
  assert.ok(groups.some((g) => g.length === 1 && g[0] === 'd'));
});

test('reference URL builders: unavatar, github, commons, wikidata', () => {
  assert.equal(
    unavatarUrl('@torvalds', 'github'),
    'https://unavatar.io/github/torvalds?fallback=false'
  );
  assert.equal(
    unavatarUrl('someone.else'),
    'https://unavatar.io/someone.else?fallback=false'
  );
  assert.equal(
    githubAvatarUrl('@some-user'),
    'https://avatars.githubusercontent.com/some-user?size=256'
  );
  assert.equal(
    commonsPortraitUrl('File:Ada Lovelace portrait.jpg', 256),
    'https://commons.wikimedia.org/wiki/Special:FilePath/Ada%20Lovelace%20portrait.jpg?width=256'
  );
  assert.ok(WIKIDATA_SEARCH_URL('angela merkel').includes('search=angela%20merkel'));
  assert.ok(WIKIDATA_SEARCH_URL('x').includes('origin=*'), 'browser CORS needs origin=*');
  assert.equal(
    WIKIDATA_ENTITIES_URL(['Q42', 'Q3605']),
    'https://www.wikidata.org/w/api.php?action=wbgetentities&ids=Q42|Q3605&props=labels|claims&languages=en&format=json&origin=*'
  );
});
