/**
 * Perceptual image hashing (64-bit difference hash) for zero-key photo
 * matching. Used to compare an uploaded photo against geolocated public
 * photos (Wikimedia Commons) so the engine can propose coordinates itself.
 *
 * Pure functions only — DOM/canvas callers feed us the 9x8 grayscale grid.
 */

export const DHASH_WIDTH = 9;
export const DHASH_HEIGHT = 8;

/**
 * Computes the 64-bit dHash of a row-major 9x8 grayscale grid (values 0-255).
 * Bit order: for each of the 8 rows, bit is set when pixel[x] > pixel[x+1].
 * Returned as 16 hex chars.
 */
export function grayscaleToDHash(gray: number[]): string {
  if (gray.length !== DHASH_WIDTH * DHASH_HEIGHT) {
    throw new Error(
      `dHash input must be exactly ${DHASH_WIDTH * DHASH_HEIGHT} values (got ${gray.length})`
    );
  }
  let bits = '';
  for (let y = 0; y < DHASH_HEIGHT; y++) {
    const row = y * DHASH_WIDTH;
    for (let x = 0; x < DHASH_WIDTH - 1; x++) {
      bits += gray[row + x] < gray[row + x + 1] ? '1' : '0';
    }
  }
  // 64 bits -> 16 hex chars
  let hex = '';
  for (let i = 0; i < 64; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

/** Number of differing bits between two hex hashes. */
export function hammingDistanceHex(hashA: string, hashB: string): number {
  if (hashA.length !== hashB.length) {
    throw new Error(`hash length mismatch: ${hashA.length} vs ${hashB.length}`);
  }
  let distance = 0;
  for (let i = 0; i < hashA.length; i++) {
    const diff = parseInt(hashA[i], 16) ^ parseInt(hashB[i], 16);
    distance += (diff & 1) + ((diff >> 1) & 1) + ((diff >> 2) & 1) + ((diff >> 3) & 1);
  }
  return distance;
}

/** 0-100 perceptual similarity between two dHash hex strings. */
export function dHashSimilarityPercent(hashA: string, hashB: string): number {
  const distance = hammingDistanceHex(hashA, hashB);
  return Math.round(((64 - distance) / 64) * 100);
}
