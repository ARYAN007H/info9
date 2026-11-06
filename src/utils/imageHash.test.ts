import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dHashSimilarityPercent,
  grayscaleToDHash,
  hammingDistanceHex,
} from './imageHash';

const flatGrid = (value: number) => new Array(72).fill(value);

test('flat grayscale grid hashes to all-zero dHash', () => {
  assert.equal(grayscaleToDHash(flatGrid(128)), '0000000000000000');
});

test('left-to-right gradient sets all bits (each pixel brighter than previous)', () => {
  const gradient: number[] = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 9; x++) gradient.push(x * 28);
  }
  assert.equal(grayscaleToDHash(gradient), 'ffffffffffffffff');
});

test('dHash is stable under global brightness shift (invariance property)', () => {
  const base: number[] = [];
  const shifted: number[] = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 9; x++) {
      const v = 30 + ((x * 20 + y * 7) % 170); // stays <= 199, +40 never saturates
      base.push(v);
      shifted.push(v + 40);
    }
  }
  assert.equal(grayscaleToDHash(base), grayscaleToDHash(shifted));
});

test('dHash rejects wrong-size input', () => {
  assert.throws(() => grayscaleToDHash(new Array(71).fill(0)), /exactly 72/);
});

test('hammingDistanceHex counts differing bits correctly', () => {
  assert.equal(hammingDistanceHex('0000000000000000', '0000000000000000'), 0);
  assert.equal(hammingDistanceHex('0000000000000000', 'ffffffffffffffff'), 64);
  assert.equal(hammingDistanceHex('ffffffffffffffff', 'ffffffffffffffff'), 0);
  // 'f' vs '0' in one nibble = 4 bits
  assert.equal(hammingDistanceHex('000000000000000f', '0000000000000000'), 4);
  assert.equal(hammingDistanceHex('0f00000000000000', '0000000000000000'), 4);
});

test('hammingDistanceHex rejects mismatched lengths', () => {
  assert.throws(() => hammingDistanceHex('abc', 'abcd'), /length mismatch/);
});

test('dHashSimilarityPercent maps distances to the 0-100 scale', () => {
  assert.equal(dHashSimilarityPercent('ffffffffffffffff', 'ffffffffffffffff'), 100);
  assert.equal(dHashSimilarityPercent('0000000000000000', 'ffffffffffffffff'), 0);
  assert.equal(dHashSimilarityPercent('0000000000000000', '000000000000000f'), 94); // 4/64 differ
});
