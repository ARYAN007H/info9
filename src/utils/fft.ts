/**
 * Minimal iterative radix-2 FFT for real-world audio analysis (STFT frames).
 * Pure functions — no Web Audio dependencies — so the math is testable.
 *
 * Convention: forward transform, unnormalized; input length must be a
 * power of two. Complex arrays are interleaved [re0, im0, re1, im1, ...].
 */

export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** In-place iterative Cooley–Tukey radix-2 FFT on interleaved complex data. */
export function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n !== im.length) throw new Error('re/im length mismatch');
  if ((n & (n - 1)) !== 0 || n === 0) throw new Error('length must be a power of two');

  // bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }

  // butterflies
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + half] * curRe - im[i + k + half] * curIm;
        const vIm = re[i + k + half] * curIm + im[i + k + half] * curRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + half] = uRe - vRe;
        im[i + k + half] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

/**
 * Computes magnitude spectrum frames over a real signal.
 * Returns frames of `fftSize/2` magnitudes (bins 0..N/2), each with its
 * center time (seconds from signal start) and per-bin frequency (Hz).
 */
export interface SpectrogramFrame {
  timeSec: number;
  magnitudes: Float64Array;
}

export interface Spectrogram {
  sampleRate: number;
  fftSize: number;
  hopSize: number;
  binHz: number;
  frames: SpectrogramFrame[];
}

export function computeSpectrogram(
  samples: Float32Array,
  sampleRate: number,
  fftSize: number,
  hopSize: number
): Spectrogram {
  if (fftSize < 64 || (fftSize & (fftSize - 1)) !== 0) {
    throw new Error('fftSize must be a power of two >= 64');
  }
  if (hopSize <= 0 || hopSize > fftSize) throw new Error('hopSize must be in (0, fftSize]');
  const binHz = sampleRate / fftSize;
  const frameCount = Math.max(0, Math.floor((samples.length - fftSize) / hopSize) + 1);
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  // Hann window precomputed
  const window = new Float64Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  }
  const frames: SpectrogramFrame[] = [];
  const half = fftSize >> 1;
  for (let f = 0; f < frameCount; f++) {
    const start = f * hopSize;
    for (let i = 0; i < fftSize; i++) {
      re[i] = samples[start + i] * window[i];
      im[i] = 0;
    }
    fftInPlace(re, im);
    const magnitudes = new Float64Array(half);
    for (let b = 0; b < half; b++) {
      magnitudes[b] = Math.hypot(re[b], im[b]);
    }
    frames.push({ timeSec: (start + fftSize / 2) / sampleRate, magnitudes });
  }
  return { sampleRate, fftSize, hopSize, binHz, frames };
}

/**
 * Tracks the dominant peak frequency inside a band for every frame —
 * the measured Doppler curve f(t). Band edges in Hz; parabolic
 * interpolation between bins for sub-bin accuracy.
 */
export function trackPeakFrequency(
  spectrogram: Spectrogram,
  bandLowHz: number,
  bandHighHz: number
): Array<{ timeSec: number; freqHz: number; magnitude: number }> {
  const lowBin = Math.max(1, Math.floor(bandLowHz / spectrogram.binHz));
  const highBin = Math.min(
    spectrogram.fftSize / 2 - 2,
    Math.ceil(bandHighHz / spectrogram.binHz)
  );
  if (highBin <= lowBin) throw new Error('band too narrow for this fftSize');
  const out: Array<{ timeSec: number; freqHz: number; magnitude: number }> = [];
  for (const frame of spectrogram.frames) {
    let bestBin = lowBin;
    let bestMag = frame.magnitudes[lowBin];
    for (let b = lowBin + 1; b <= highBin; b++) {
      if (frame.magnitudes[b] > bestMag) {
        bestMag = frame.magnitudes[b];
        bestBin = b;
      }
    }
    if (bestMag <= 0) continue;
    // parabolic interpolation around the peak
    const yPrev = frame.magnitudes[bestBin - 1];
    const yCur = frame.magnitudes[bestBin];
    const yNext = frame.magnitudes[bestBin + 1];
    const denom = yPrev - 2 * yCur + yNext;
    const delta = denom !== 0 ? (0.5 * (yPrev - yNext)) / denom : 0;
    const freqHz = (bestBin + delta) * spectrogram.binHz;
    out.push({ timeSec: frame.timeSec, freqHz, magnitude: bestMag });
  }
  return out;
}
