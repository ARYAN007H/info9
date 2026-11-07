import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSpectrogram,
  fftInPlace,
  nextPowerOfTwo,
  trackPeakFrequency,
} from './fft';

test('nextPowerOfTwo rounds up correctly', () => {
  assert.equal(nextPowerOfTwo(1), 1);
  assert.equal(nextPowerOfTwo(1000), 1024);
  assert.equal(nextPowerOfTwo(1024), 1024);
});

test('FFT matches the naive DFT on a small complex input', () => {
  const n = 8;
  const re = Float64Array.from([1, 0, 2, 0, -1, 0, 0.5, 0]);
  const im = new Float64Array(n);
  const origRe = Float64Array.from(re);
  const origIm = Float64Array.from(im);
  fftInPlace(re, im);

  // naive O(n^2) DFT over the exact same interleaved complex signal
  const refRe = new Float64Array(n);
  const refIm = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) {
      const ang = (-2 * Math.PI * i * k) / n;
      refRe[k] += origRe[i] * Math.cos(ang) - origIm[i] * Math.sin(ang);
      refIm[k] += origRe[i] * Math.sin(ang) + origIm[i] * Math.cos(ang);
    }
  }
  for (let k = 0; k < n; k++) {
    assert.ok(Math.abs(re[k] - refRe[k]) < 1e-9, `re[${k}] ${re[k]} vs ${refRe[k]}`);
    assert.ok(Math.abs(im[k] - refIm[k]) < 1e-9, `im[${k}] ${im[k]} vs ${refIm[k]}`);
  }
});

test('fftInPlace rejects non-power-of-two and mismatched lengths', () => {
  assert.throws(() => fftInPlace(new Float64Array(3), new Float64Array(3)), /power of two/);
  assert.throws(
    () => fftInPlace(new Float64Array(4), new Float64Array(8)),
    /length mismatch/
  );
});

test('peak tracker follows a linear chirp within a few Hz', () => {
  const sampleRate = 8000;
  const duration = 4;
  const n = sampleRate * duration;
  const samples = new Float32Array(n);
  // NOTE: sin(2π·f(t)·t) integrates phase 2π·(500t + 50t²) → instantaneous
  // frequency is 500 + 50t (500→700 Hz), not 500 + 25t.
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const f = 500 + (100 * t) / duration;
    samples[i] = Math.sin(2 * Math.PI * f * t) * 0.8;
  }
  const spec = computeSpectrogram(samples, sampleRate, 1024, 256);
  const curve = trackPeakFrequency(spec, 400, 750);
  assert.ok(curve.length >= 100, `expected many frames, got ${curve.length}`);
  // instantaneous frequency at t=2s is 600 Hz
  const mid = curve[Math.floor(curve.length / 2)];
  assert.ok(Math.abs(mid.freqHz - 600) < 8, `mid freq ${mid.freqHz} not ~600`);
  const last = curve[curve.length - 2];
  assert.ok(Math.abs(last.freqHz - 700) < 10, `end freq ${last.freqHz} not ~700`);
});
