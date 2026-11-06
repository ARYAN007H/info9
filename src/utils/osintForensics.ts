import type {
  DnsTwistPermutation,
  EvidenceLedgerEntry,
  InfraDomainRecord,
  InfraThreatCluster,
  InvestigationCase,
  OsintEntity,
  OwnershipEdge,
  SanctionsCandidate,
  SanctionsMatchWeights,
  SanctionsScoredResult,
} from '../types/osint';

/**
 * Normalizes and transliterates Cyrillic, Greek, and common diacritic characters to ASCII Latin
 * for cross-script sanctions & entity resolution.
 */
export function transliterateAndNormalizeName(input: string): string {
  const cyrillicMap: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh',
    з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
    п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts',
    ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  };

  let out = '';
  for (const ch of input.toLowerCase()) {
    out += cyrillicMap[ch] !== undefined ? cyrillicMap[ch] : ch;
  }

  return out
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Computes Jaro-Winkler similarity (0.0 to 1.0) between two strings.
 */
export function jaroWinklerSimilarity(rawA: string, rawB: string): number {
  const s1 = transliterateAndNormalizeName(rawA);
  const s2 = transliterateAndNormalizeName(rawB);
  if (s1 === s2) return 1.0;
  if (s1.length === 0 || s2.length === 0) return 0.0;

  const matchWindow = Math.max(
    0,
    Math.floor(Math.max(s1.length, s2.length) / 2) - 1
  );
  const s1Matches = new Array<boolean>(s1.length).fill(false);
  const s2Matches = new Array<boolean>(s2.length).fill(false);

  let matches = 0;
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (s2Matches[j]) continue;
      if (s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0.0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const m = matches;
  const jaro =
    (m / s1.length + m / s2.length + (m - transpositions / 2) / m) / 3;

  let prefix = 0;
  const maxPrefix = Math.min(4, Math.min(s1.length, s2.length));
  for (let i = 0; i < maxPrefix; i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  const jaroWinkler = jaro + prefix * 0.1 * (1 - jaro);
  return Number(Math.min(1, Math.max(0, jaroWinkler)).toFixed(4));
}

/**
 * Token-Set Similarity: handles reordered surname/given/patronymic tokens
 * (e.g. "MOROZOV, Viktor Alekseevich" vs "Viktor Alekseyevich Morozov" -> ~0.98)
 */
export function tokenSetSimilarity(rawA: string, rawB: string): number {
  const tokensA = transliterateAndNormalizeName(rawA)
    .split(' ')
    .filter(Boolean)
    .sort();
  const tokensB = transliterateAndNormalizeName(rawB)
    .split(' ')
    .filter(Boolean)
    .sort();
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  return jaroWinklerSimilarity(tokensA.join(' '), tokensB.join(' '));
}

/**
 * Generates standard American Soundex phonetic code for cross-transliteration matching.
 */
export function soundexCode(input: string): string {
  const cleaned = transliterateAndNormalizeName(input)
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  if (!cleaned) return '0000';
  const firstLetter = cleaned[0];
  const map: Record<string, string> = {
    B: '1', F: '1', P: '1', V: '1',
    C: '2', G: '2', J: '2', K: '2', Q: '2', S: '2', X: '2', Z: '2',
    D: '3', T: '3',
    L: '4',
    M: '5', N: '5',
    R: '6',
  };

  let code = firstLetter;
  let prevDigit = map[firstLetter] || '';

  for (let i = 1; i < cleaned.length && code.length < 4; i++) {
    const ch = cleaned[i];
    const digit = map[ch] || '';
    if (digit && digit !== prevDigit) {
      code += digit;
    }
    prevDigit = digit || prevDigit;
  }

  return code.padEnd(4, '0');
}

/**
 * Multi-attribute Sanctions & PEP False-Positive Reducer with Cross-Script Transliteration,
 * Token-Set Reordering, and Bayesian Posterior Probability calculation.
 */
export function scoreSanctionsCandidate(
  query: {
    targetName: string;
    targetDob: string;
    targetJurisdiction: string;
  },
  candidate: SanctionsCandidate,
  weights: SanctionsMatchWeights
): SanctionsScoredResult {
  const qName = query.targetName.trim();
  const transliteratedQuery = transliterateAndNormalizeName(qName);

  const primaryJW = jaroWinklerSimilarity(qName, candidate.listedName);
  const primaryTokenSet = tokenSetSimilarity(qName, candidate.listedName);
  const aliasSims = candidate.aliases.map((al) =>
    Math.max(jaroWinklerSimilarity(qName, al), tokenSetSimilarity(qName, al))
  );
  const bestAliasSim = aliasSims.length > 0 ? Math.max(...aliasSims) : 0;
  const bestNameSim = Math.max(primaryJW, primaryTokenSet, bestAliasSim);

  const qTokens = transliteratedQuery.split(/\s+/).filter(Boolean);
  const cTokens = transliterateAndNormalizeName(candidate.listedName)
    .split(/\s+/)
    .filter(Boolean);
  const phoneticMatch =
    qTokens.length > 0 &&
    cTokens.length > 0 &&
    qTokens.some((qt) =>
      cTokens.some((ct) => soundexCode(qt) === soundexCode(ct))
    );

  const qDob = query.targetDob.trim();
  const cDob = candidate.dobOrIncorporation.trim();
  let dobScore = 0.5;
  if (qDob && cDob) {
    if (qDob === cDob) {
      dobScore = 1.0;
    } else if (qDob.slice(0, 4) === cDob.slice(0, 4)) {
      dobScore = 0.72;
    } else {
      const yearA = parseInt(qDob.slice(0, 4), 10);
      const yearB = parseInt(cDob.slice(0, 4), 10);
      if (!isNaN(yearA) && !isNaN(yearB) && Math.abs(yearA - yearB) >= 3) {
        dobScore = 0.05;
      } else {
        dobScore = 0.25;
      }
    }
  }

  const qJur = query.targetJurisdiction.trim().toLowerCase();
  const cJur = candidate.citizenshipOrJurisdiction.trim().toLowerCase();
  let jurisdictionScore = 0.5;
  if (qJur && cJur) {
    if (cJur.includes(qJur) || qJur.includes(cJur)) {
      jurisdictionScore = 1.0;
    } else {
      jurisdictionScore = 0.1;
    }
  }

  const totalWeight =
    weights.namePhoneticWeight +
      weights.dobExactWeight +
      weights.jurisdictionWeight +
      weights.aliasOverlapWeight || 1;

  const effectiveNameScore = phoneticMatch
    ? Math.min(1, bestNameSim + 0.04)
    : bestNameSim;

  const weightedSum =
    effectiveNameScore * weights.namePhoneticWeight +
    dobScore * weights.dobExactWeight +
    jurisdictionScore * weights.jurisdictionWeight +
    bestAliasSim * weights.aliasOverlapWeight;

  const compositeScore = Number(((weightedSum / totalWeight) * 100).toFixed(1));

  // Compute Bayesian Posterior Probability using likelihood ratios for Name, DOB, and Jurisdiction
  const priorOdds = 0.15;
  const lrName = bestNameSim >= 0.88 ? 8.5 : bestNameSim >= 0.75 ? 1.8 : 0.12;
  const lrDob = dobScore >= 0.9 ? 14.0 : dobScore >= 0.65 ? 3.2 : 0.04;
  const lrJur = jurisdictionScore >= 0.9 ? 3.5 : 0.25;
  const posteriorOdds = priorOdds * lrName * lrDob * lrJur;
  const bayesianPosteriorPercent = Number(
    ((posteriorOdds / (1 + posteriorOdds)) * 100).toFixed(1)
  );

  const eliminationReasons: string[] = [];
  if (dobScore <= 0.15) {
    eliminationReasons.push(
      `Chronological mismatch: Query DOB/Year (${query.targetDob}) conflicts with listed record (${candidate.dobOrIncorporation}).`
    );
  }
  if (jurisdictionScore <= 0.15) {
    eliminationReasons.push(
      `Jurisdiction divergence: Query (${query.targetJurisdiction}) does not match sanction nexus (${candidate.citizenshipOrJurisdiction}).`
    );
  }
  if (bestNameSim < 0.78) {
    eliminationReasons.push(
      `Low lexical similarity (${(bestNameSim * 100).toFixed(1)}% Jaro-Winkler) across primary name and ${candidate.aliases.length} aliases.`
    );
  }

  let disposition: SanctionsScoredResult['disposition'] =
    'POTENTIAL_MATCH_REVIEW';
  if (compositeScore >= 78 && dobScore >= 0.65) {
    disposition = 'CONFIRMED_TARGET';
  } else if (compositeScore < 55 || dobScore <= 0.15) {
    disposition = 'FALSE_POSITIVE_ELIMINATED';
  }

  return {
    candidate,
    nameSimilarityScore: Number((bestNameSim * 100).toFixed(1)),
    tokenSetScore: Number((primaryTokenSet * 100).toFixed(1)),
    phoneticMatch,
    transliteratedQuery,
    dobScore: Number((dobScore * 100).toFixed(1)),
    jurisdictionScore: Number((jurisdictionScore * 100).toFixed(1)),
    bayesianPosteriorPercent,
    compositeScore,
    disposition,
    eliminationReasons,
  };
}

/**
 * Corporate Shell Topology & Multi-Hop Effective Beneficial Ownership Analyzer.
 * Computes effective equity paths E_eff = prod(p_i), identifies circular ownership loops,
 * and scores intermediary conduit centrality.
 */
export function analyzeCorporateGraphTopology(
  entities: OsintEntity[],
  edges: OwnershipEdge[]
): {
  effectiveOwnershipPaths: Array<{
    fromEntity: string;
    toEntity: string;
    hops: number;
    effectiveEquityPercent: number;
    pathLabels: string[];
    involvesOffshoreConduit: boolean;
  }>;
  circularLoops: string[][];
  conduitCentrality: Array<{
    entityId: string;
    label: string;
    jurisdiction: string;
    inDegree: number;
    outDegree: number;
    isConduitHub: boolean;
  }>;
} {
  const entMap = new Map(entities.map((e) => [e.id, e]));
  const adj = new Map<string, OwnershipEdge[]>();
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();

  for (const e of entities) {
    adj.set(e.id, []);
    inDeg.set(e.id, 0);
    outDeg.set(e.id, 0);
  }

  for (const edge of edges) {
    adj.get(edge.sourceId)?.push(edge);
    outDeg.set(edge.sourceId, (outDeg.get(edge.sourceId) || 0) + 1);
    inDeg.set(edge.targetId, (inDeg.get(edge.targetId) || 0) + 1);
  }

  const effectiveOwnershipPaths: Array<{
    fromEntity: string;
    toEntity: string;
    hops: number;
    effectiveEquityPercent: number;
    pathLabels: string[];
    involvesOffshoreConduit: boolean;
  }> = [];

  const circularLoops: string[][] = [];

  // DFS from every entity to compute multi-hop effective equity & detect circular loops
  for (const startEnt of entities) {
    const dfs = (
      currId: string,
      visitedIds: string[],
      equityProduct: number,
      hasOffshore: boolean
    ) => {
      const outgoing = adj.get(currId) || [];
      for (const edge of outgoing) {
        const pct = (edge.ownershipPercent ?? 100) / 100;
        const nextEquity = equityProduct * pct;
        const nextOffshore = hasOffshore || Boolean(edge.isOffshoreConduit);

        if (edge.targetId === startEnt.id && visitedIds.length >= 2) {
          const cycleNames = [...visitedIds, startEnt.id].map(
            (id) => entMap.get(id)?.label || id
          );
          if (
            !circularLoops.some((c) => c.join('->') === cycleNames.join('->'))
          ) {
            circularLoops.push(cycleNames);
          }
          continue;
        }

        if (visitedIds.includes(edge.targetId)) continue;

        const targetEnt = entMap.get(edge.targetId);
        if (targetEnt) {
          const newPath = [...visitedIds, edge.targetId];
          effectiveOwnershipPaths.push({
            fromEntity: startEnt.label,
            toEntity: targetEnt.label,
            hops: newPath.length - 1,
            effectiveEquityPercent: Number((nextEquity * 100).toFixed(1)),
            pathLabels: newPath.map((id) => entMap.get(id)?.label || id),
            involvesOffshoreConduit: nextOffshore,
          });
          if (newPath.length <= 5) {
            dfs(edge.targetId, newPath, nextEquity, nextOffshore);
          }
        }
      }
    };

    dfs(startEnt.id, [startEnt.id], 1.0, false);
  }

  effectiveOwnershipPaths.sort(
    (a, b) => b.hops - a.hops || b.effectiveEquityPercent - a.effectiveEquityPercent
  );

  const conduitCentrality = entities.map((e) => {
    const iDeg = inDeg.get(e.id) || 0;
    const oDeg = outDeg.get(e.id) || 0;
    return {
      entityId: e.id,
      label: e.label,
      jurisdiction: e.jurisdiction,
      inDegree: iDeg,
      outDegree: oDeg,
      isConduitHub: iDeg >= 1 && oDeg >= 1,
    };
  });

  return {
    effectiveOwnershipPaths: effectiveOwnershipPaths.slice(0, 8),
    circularLoops,
    conduitCentrality,
  };
}

/**
 * DNSTwist-style Domain Permutation & Lookalike Typosquatting Fuzzer.
 * Generates homograph, vowel-swap, transposition, hyphenation, bitsquatting, and TLD-swap candidates.
 */
export function generateDnsTwistPermutations(
  rawDomain: string
): DnsTwistPermutation[] {
  const clean = rawDomain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  const parts = clean.split('.');
  const tld = parts.length > 1 ? parts.slice(1).join('.') : 'com';
  const sld = parts[0] || 'example';

  const results = new Map<string, DnsTwistPermutation>();
  const addPerm = (
    permDomain: string,
    fuzzerType: DnsTwistPermutation['fuzzerType']
  ) => {
    if (permDomain === clean || permDomain.length < 4) return;
    if (!results.has(permDomain)) {
      const sim = Math.round(jaroWinklerSimilarity(clean, permDomain) * 100);
      results.set(permDomain, {
        domain: permDomain,
        fuzzerType,
        similarityPercent: sim,
      });
    }
  };

  // 1. Homograph ASCII / IDN lookalikes
  const homographPairs: Array<[string, string]> = [
    ['o', '0'],
    ['l', '1'],
    ['i', 'l'],
    ['m', 'rn'],
    ['vv', 'w'],
    ['a', 'e'],
  ];
  for (const [src, rep] of homographPairs) {
    if (sld.includes(src)) {
      addPerm(`${sld.replace(src, rep)}.${tld}`, 'homograph');
    }
  }

  // 2. Adjacent character transposition
  for (let i = 0; i < Math.min(sld.length - 1, 6); i++) {
    if (sld[i] !== sld[i + 1]) {
      const transposed =
        sld.slice(0, i) + sld[i + 1] + sld[i] + sld.slice(i + 2);
      addPerm(`${transposed}.${tld}`, 'transposition');
    }
  }

  // 3. Vowel swaps
  const vowels = ['a', 'e', 'i', 'o', 'u'];
  for (let i = 0; i < sld.length; i++) {
    if (vowels.includes(sld[i])) {
      const nextVowel = vowels[(vowels.indexOf(sld[i]) + 1) % vowels.length];
      addPerm(
        `${sld.slice(0, i)}${nextVowel}${sld.slice(i + 1)}.${tld}`,
        'vowel-swap'
      );
      break;
    }
  }

  // 4. Phishing suffix / hyphenation lures
  for (const suffix of ['-portal', '-auth', '-verify', '-escrow']) {
    addPerm(`${sld}${suffix}.${tld}`, 'hyphenation');
  }

  // 5. Bitsquatting (single-bit flip on 2nd char)
  if (sld.length >= 3) {
    const code = sld.charCodeAt(1) ^ 1;
    const ch = String.fromCharCode(code);
    if (/[a-z0-9]/.test(ch)) {
      addPerm(`${sld[0]}${ch}${sld.slice(2)}.${tld}`, 'bitsquatting');
    }
  }

  // 6. TLD swaps
  for (const altTld of ['net', 'org', 'io', 'co', 'eu']) {
    if (altTld !== tld) {
      addPerm(`${sld}.${altTld}`, 'tld-swap');
    }
  }

  return Array.from(results.values()).slice(0, 14);
}

/**
 * Extracts character 3-gram shingles from a domain name for lookalike/typosquatting clustering.
 */
export function domainShingleSimilarity(domA: string, domB: string): number {
  const cleanA = domA
    .toLowerCase()
    .replace(/\.[a-z0-9.]+$/, '')
    .replace(/[^a-z0-9]/g, '');
  const cleanB = domB
    .toLowerCase()
    .replace(/\.[a-z0-9.]+$/, '')
    .replace(/[^a-z0-9]/g, '');
  if (cleanA === cleanB) return 1.0;
  if (cleanA.length < 3 || cleanB.length < 3) {
    return jaroWinklerSimilarity(cleanA, cleanB);
  }
  const gramsA = new Set<string>();
  const gramsB = new Set<string>();
  for (let i = 0; i <= cleanA.length - 3; i++)
    gramsA.add(cleanA.slice(i, i + 3));
  for (let i = 0; i <= cleanB.length - 3; i++)
    gramsB.add(cleanB.slice(i, i + 3));

  let intersection = 0;
  for (const g of gramsA) {
    if (gramsB.has(g)) intersection++;
  }
  const union = gramsA.size + gramsB.size - intersection;
  return union === 0 ? 0 : Number((intersection / union).toFixed(4));
}

/**
 * Clusters infrastructure domain records by shared ASN, shared Nameservers, shared TLS Issuer,
 * and lexical 3-gram shingle similarity to uncover coordinated phishing / C2 campaigns.
 */
export function clusterInfrastructureDomains(
  records: InfraDomainRecord[]
): InfraThreatCluster[] {
  if (records.length === 0) return [];

  const visited = new Set<string>();
  const clusters: InfraThreatCluster[] = [];

  for (let i = 0; i < records.length; i++) {
    const seed = records[i];
    if (visited.has(seed.domain)) continue;

    const group: InfraDomainRecord[] = [seed];
    visited.add(seed.domain);
    const sharedSignalsSet = new Set<string>();
    const pairScores: number[] = [];

    for (let j = i + 1; j < records.length; j++) {
      const other = records[j];
      if (visited.has(other.domain)) continue;

      let score = 0;
      const signals: string[] = [];

      if (seed.asn && seed.asn === other.asn) {
        score += 0.45;
        signals.push(`Shared BGP ASN (${seed.asn} · ${seed.asnOrg ?? 'unknown org'})`);
      }

      const commonNs = seed.nsRecords.filter((ns) =>
        other.nsRecords.includes(ns)
      );
      if (commonNs.length > 0) {
        score += 0.35;
        signals.push(`Shared Nameserver (${commonNs[0]})`);
      }

      if (seed.tlsIssuer && seed.tlsIssuer === other.tlsIssuer) {
        score += 0.15;
        signals.push(`Identical TLS CA Profile (${seed.tlsIssuer})`);
      }

      const shingleSim = domainShingleSimilarity(seed.domain, other.domain);
      if (shingleSim >= 0.25) {
        score += shingleSim * 0.4;
        signals.push(
          `Lexical Lookalike Shingle Match (${Math.round(shingleSim * 100)}%)`
        );
      }

      if (score >= 0.45) {
        group.push(other);
        visited.add(other.domain);
        pairScores.push(Math.min(0.99, score));
        signals.forEach((s) => sharedSignalsSet.add(s));
      }
    }

    const avgSim =
      pairScores.length > 0
        ? Math.round(
            (pairScores.reduce((acc, v) => acc + v, 0) / pairScores.length) *
              100
          )
        : 100;

    const maxRisk = Math.max(...group.map((g) => g.riskAssessment.score));
    const severity: InfraThreatCluster['severity'] =
      maxRisk >= 85
        ? 'critical'
        : maxRisk >= 70
        ? 'high'
        : maxRisk >= 45
        ? 'medium'
        : 'low';

    if (sharedSignalsSet.size === 0) {
      sharedSignalsSet.add(
        `Standalone Infrastructure Node (${seed.asn ?? 'unknown ASN'})`
      );
    }

    clusters.push({
      clusterId: `CL-${String(clusters.length + 1).padStart(2, '0')}`,
      label:
        group.length > 1
          ? `Coordinated Infrastructure Cluster (${
              seed.asnOrg ?? seed.asn ?? 'unknown network'
            })`
          : `Isolated Domain Node (${seed.domain})`,
      domains: group.map((g) => g.domain),
      sharedSignals: Array.from(sharedSignalsSet),
      averageSimilarity: avgSim,
      severity,
    });
  }

  return clusters;
}

/**
 * Pure synchronous SHA-256 implementation (FIPS 180-4).
 */
export function sha256HexSync(asciiMessage: string): string {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  const H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];

  const encoder = new TextEncoder();
  const msgBytes = encoder.encode(asciiMessage);
  const bitLen = msgBytes.length * 8;

  const totalLen = Math.ceil((msgBytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(totalLen);
  padded.set(msgBytes);
  padded[msgBytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(totalLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(totalLen - 4, bitLen >>> 0, false);

  const W = new Uint32Array(64);
  const rotr = (n: number, x: number) => (x >>> n) | (x << (32 - n));

  for (let offset = 0; offset < totalLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      W[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(7, W[i - 15]) ^ rotr(18, W[i - 15]) ^ (W[i - 15] >>> 3);
      const s1 = rotr(17, W[i - 2]) ^ rotr(19, W[i - 2]) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = H;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  return H.map((word) => word.toString(16).padStart(8, '0')).join('');
}

export function computeLedgerEntryHash(entry: {
  index: number;
  timestampUtc: string;
  module: string;
  targetLabel: string;
  findingSummary: string;
  sourceUrl: string;
  previousHash: string;
}): string {
  const canonicalPayload = [
    entry.index,
    entry.timestampUtc,
    entry.module,
    entry.targetLabel,
    entry.findingSummary,
    entry.sourceUrl,
    entry.previousHash,
  ].join('|');
  return sha256HexSync(canonicalPayload);
}

export function createLinkedLedgerEntry(
  existingLedger: EvidenceLedgerEntry[],
  input: {
    module: EvidenceLedgerEntry['module'];
    targetLabel: string;
    findingSummary: string;
    sourceUrl: string;
    timestampUtc?: string;
  }
): EvidenceLedgerEntry {
  const index = existingLedger.length + 1;
  const previousHash =
    existingLedger.length > 0
      ? existingLedger[existingLedger.length - 1].sha256Hash
      : '0000000000000000000000000000000000000000000000000000000000000000';
  const timestampUtc = input.timestampUtc || new Date().toISOString();

  const sha256Hash = computeLedgerEntryHash({
    index,
    timestampUtc,
    module: input.module,
    targetLabel: input.targetLabel,
    findingSummary: input.findingSummary,
    sourceUrl: input.sourceUrl,
    previousHash,
  });

  return {
    index,
    id: `ev-${index}-${sha256Hash.slice(0, 8)}`,
    timestampUtc,
    module: input.module,
    targetLabel: input.targetLabel,
    findingSummary: input.findingSummary,
    sourceUrl: input.sourceUrl,
    previousHash,
    sha256Hash,
  };
}

export function verifyEvidenceLedgerChain(entries: EvidenceLedgerEntry[]): {
  isValid: boolean;
  verifiedCount: number;
  tamperedIndex: number | null;
  reason: string;
  merkleRoot: string;
} {
  const genesisPrev =
    '0000000000000000000000000000000000000000000000000000000000000000';

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const expectedPrev = i === 0 ? genesisPrev : entries[i - 1].sha256Hash;
    if (entry.previousHash !== expectedPrev) {
      return {
        isValid: false,
        verifiedCount: i,
        tamperedIndex: entry.index,
        reason: `Broken chain link at block #${entry.index}: previousHash does not match prior block digest.`,
        merkleRoot: computeMerkleRoot(entries),
      };
    }

    const recomputed = computeLedgerEntryHash(entry);
    if (recomputed !== entry.sha256Hash) {
      return {
        isValid: false,
        verifiedCount: i,
        tamperedIndex: entry.index,
        reason: `Payload hash mismatch at block #${entry.index}: computed ${recomputed.slice(0, 12)}... vs stored ${entry.sha256Hash.slice(0, 12)}...`,
        merkleRoot: computeMerkleRoot(entries),
      };
    }
  }

  return {
    isValid: true,
    verifiedCount: entries.length,
    tamperedIndex: null,
    reason: `All ${entries.length} blocks cryptographically verified via FIPS 180-4 SHA-256 chain.`,
    merkleRoot: computeMerkleRoot(entries),
  };
}

/**
 * Computes binary RFC 6962 style Merkle Tree Root over all ledger block hashes.
 */
export function computeMerkleRoot(entries: EvidenceLedgerEntry[]): string {
  if (entries.length === 0) {
    return sha256HexSync('ARGON_EMPTY_MERKLE_TREE');
  }
  let layer = entries.map((e) => e.sha256Hash);
  while (layer.length > 1) {
    const nextLayer: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = i + 1 < layer.length ? layer[i + 1] : left;
      nextLayer.push(sha256HexSync(`${left}:${right}`));
    }
    layer = nextLayer;
  }
  return layer[0];
}

/**
 * Serializes an InvestigationCase into an OASIS STIX 2.1 Cyber Threat & OSINT Intelligence Bundle (.json)
 * compatible with OpenCTI and MISP.
 */
export function exportStix21Bundle(activeCase: InvestigationCase): string {
  const now = new Date().toISOString();
  const objects: Array<Record<string, unknown>> = [
    {
      type: 'report',
      spec_version: '2.1',
      id: `report--${sha256HexSync(activeCase.id).slice(0, 32)}`,
      created: now,
      modified: now,
      name: `${activeCase.codeName}: ${activeCase.title}`,
      description: activeCase.summary,
      report_types: ['threat-actor', 'infrastructure', 'intrusion-set'],
      published: now,
    },
  ];

  for (const ent of activeCase.entities) {
    objects.push({
      type: ent.type === 'person' ? 'threat-actor' : 'identity',
      spec_version: '2.1',
      id: `${ent.type === 'person' ? 'threat-actor' : 'identity'}--${sha256HexSync(
        ent.id
      ).slice(0, 32)}`,
      created: now,
      modified: now,
      name: ent.label,
      description: `${ent.summary} [Identifier: ${ent.identifier}, Jurisdiction: ${ent.jurisdiction}]`,
    });
  }

  for (const dom of activeCase.infraRecords) {
    objects.push({
      type: 'indicator',
      spec_version: '2.1',
      id: `indicator--${sha256HexSync(dom.domain).slice(0, 32)}`,
      created: now,
      modified: now,
      name: `Domain Infrastructure: ${dom.domain}`,
      pattern: `[domain-name:value = '${dom.domain}']`,
      pattern_type: 'stix',
      valid_from: now,
      confidence: dom.riskAssessment.score,
    });
  }

  return JSON.stringify(
    {
      type: 'bundle',
      id: `bundle--${sha256HexSync(activeCase.codeName).slice(0, 32)}`,
      objects,
    },
    null,
    2
  );
}

/**
 * Computes 64-bin luminance & RGB distribution histogram from Canvas ImageData for forensic inspection.
 */
export function computeRgbHistogram(imageData: Uint8ClampedArray): {
  rBins: number[];
  gBins: number[];
  bBins: number[];
  lumaBins: number[];
} {
  const numBins = 48;
  const rBins = new Array<number>(numBins).fill(0);
  const gBins = new Array<number>(numBins).fill(0);
  const bBins = new Array<number>(numBins).fill(0);
  const lumaBins = new Array<number>(numBins).fill(0);

  const step = 4 * 4; // Sample every 4th pixel for <2ms speed
  for (let i = 0; i < imageData.length; i += step) {
    const r = imageData[i];
    const g = imageData[i + 1];
    const b = imageData[i + 2];
    const luma = Math.round(0.299 * r + 0.587 * g + 0.114 * b);

    rBins[Math.min(numBins - 1, Math.floor((r / 256) * numBins))]++;
    gBins[Math.min(numBins - 1, Math.floor((g / 256) * numBins))]++;
    bBins[Math.min(numBins - 1, Math.floor((b / 256) * numBins))]++;
    lumaBins[Math.min(numBins - 1, Math.floor((luma / 256) * numBins))]++;
  }

  const normalize = (arr: number[]) => {
    const max = Math.max(...arr, 1);
    return arr.map((v) => Math.round((v / max) * 100));
  };

  return {
    rBins: normalize(rBins),
    gBins: normalize(gBins),
    bBins: normalize(bBins),
    lumaBins: normalize(lumaBins),
  };
}

/**
 * Lightweight binary JPEG/EXIF header scanner for user-uploaded photos.
 */
export function parseUploadedBinaryMetadata(
  fileName: string,
  fileSize: number,
  mimeType: string,
  arrayBuffer: ArrayBuffer
): Array<{
  tagId: string;
  name: string;
  value: string;
  status: 'NOMINAL' | 'MISMATCH' | 'STRIPPED';
}> {
  const bytes = new Uint8Array(arrayBuffer);
  const tags: Array<{
    tagId: string;
    name: string;
    value: string;
    status: 'NOMINAL' | 'MISMATCH' | 'STRIPPED';
  }> = [
    {
      tagId: '0x0001',
      name: 'FileName / Container',
      value: `${fileName} (${mimeType || 'binary/octet-stream'})`,
      status: 'NOMINAL',
    },
    {
      tagId: '0x0002',
      name: 'Payload Byte Length',
      value: `${fileSize.toLocaleString()} bytes`,
      status: 'NOMINAL',
    },
  ];

  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    tags.push({
      tagId: '0xFFD8',
      name: 'SOI Magic Header',
      value: '0xFFD8FFE0 / Valid JPEG Stream',
      status: 'NOMINAL',
    });

    let hasExif = false;
    for (let i = 2; i < Math.min(bytes.length - 10, 4096); i++) {
      if (
        bytes[i] === 0xff &&
        bytes[i + 1] === 0xe1 &&
        bytes[i + 4] === 0x45 &&
        bytes[i + 5] === 0x78 &&
        bytes[i + 6] === 0x69 &&
        bytes[i + 7] === 0x66
      ) {
        hasExif = true;
        const endian =
          bytes[i + 10] === 0x49 && bytes[i + 11] === 0x49
            ? 'Little-Endian (II / 0x4949)'
            : 'Big-Endian (MM / 0x4D4D)';
        tags.push({
          tagId: '0xFFE1',
          name: 'APP1 EXIF Segment',
          value: `Present · TIFF Byte Order: ${endian}`,
          status: 'NOMINAL',
        });
        break;
      }
    }

    if (!hasExif) {
      tags.push({
        tagId: '0xFFE1',
        name: 'APP1 EXIF / GPS IFD',
        value: 'Stripped (Social Media / Sanitized Re-encode Detected)',
        status: 'STRIPPED',
      });
    }
  } else if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    const view = new DataView(arrayBuffer);
    const width = bytes.length >= 24 ? view.getUint32(16, false) : 0;
    const height = bytes.length >= 24 ? view.getUint32(20, false) : 0;
    tags.push({
      tagId: '0x8950',
      name: 'PNG IHDR Geometry',
      value: `${width} × ${height} px · Lossless RGBA`,
      status: 'NOMINAL',
    });
    tags.push({
      tagId: '0x8825',
      name: 'GPSInfoIFD Pointer',
      value: 'Absent in PNG Container',
      status: 'STRIPPED',
    });
  }

  return tags;
}

/**
 * Serializes an InvestigationCase into a minimal MISP 2.4 JSON event,
 * compatible with "Add event via JSON upload". Attributes are drawn from
 * saved infrastructure records, entities and ledger targets so the export
 * only contains what the analyst actually recorded — nothing invented.
 */
export function exportMispJson(activeCase: InvestigationCase): string {
  const now = new Date().toISOString();
  const attributes: Array<Record<string, unknown>> = [];

  const pushAttribute = (
    value: string,
    type: string,
    category: string,
    comment: string
  ) => {
    if (!value) return;
    attributes.push({
      type,
      category,
      to_ids: false,
      uuid: `${sha256HexSync(`${activeCase.id}:${type}:${value}`).slice(0, 8)}-${sha256HexSync(
        value
      ).slice(0, 4)}-4${sha256HexSync(value).slice(4, 7)}-8${sha256HexSync(
        `${value}y`
      ).slice(4, 7)}-${sha256HexSync(`${value}z`).slice(0, 12)}`,
      value,
      comment,
      timestamp: Math.floor(Date.parse(now) / 1000),
    });
  };

  for (const record of activeCase.infraRecords) {
    for (const ip of record.aRecords) {
      pushAttribute(ip, 'ip-dst', 'Network activity', `${record.domain} A record`);
    }
    for (const ns of record.nsRecords) {
      pushAttribute(ns, 'domain', 'Network activity', `${record.domain} nameserver`);
    }
    pushAttribute(record.domain, 'domain', 'Network activity', `Domain investigated in ${activeCase.codeName}`);
  }
  for (const entity of activeCase.entities) {
    if (entity.type === 'person') {
      pushAttribute(entity.label, 'text', 'Person', `Entity: ${entity.identifier}`);
    } else if (entity.type === 'company') {
      pushAttribute(entity.label, 'text', 'Attribution', `Entity: ${entity.identifier}`);
    }
  }

  const event = {
    Event: {
      date: now.slice(0, 10),
      info: `info9 investigation ${activeCase.codeName} — ${activeCase.title}`,
      threat_level_id: '3',
      published: false,
      analysis: '1',
      distribution: '0',
      uuid: `${sha256HexSync(activeCase.id).slice(0, 8)}-${sha256HexSync(
        activeCase.codeName
      ).slice(0, 4)}-4${sha256HexSync(activeCase.id).slice(4, 7)}-8${sha256HexSync(
        activeCase.title
      ).slice(4, 7)}-${sha256HexSync(activeCase.updatedAtUtc).slice(0, 12)}`,
      Attribute: attributes,
    },
  };
  return JSON.stringify(event, null, 2);
}
