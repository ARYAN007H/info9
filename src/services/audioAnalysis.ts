/**
 * Audio decoding for the Acoustic bench: File/Blob → mono Float32 samples
 * + sample rate via the browser's decodeAudioData. Browser-only.
 *
 * The recording never leaves the machine — decoding and the subsequent FFT
 * run locally, same privacy property as the rest of the workbench.
 */

export interface DecodedAudio {
  samples: Float32Array;
  sampleRate: number;
  durationSec: number;
  channels: number;
}

/** Hard cap: a 5-minute clip at 48 kHz is ~14M floats — plenty, and bounded. */
export const MAX_AUDIO_SECONDS = 300;

export async function decodeAudioFile(file: Blob): Promise<DecodedAudio> {
  const arrayBuffer = await file.arrayBuffer();
  const AudioCtx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioCtx) throw new Error('This browser has no AudioContext — audio analysis unavailable');
  const ctx = new AudioCtx();
  try {
    const buffer = await ctx.decodeAudioData(arrayBuffer);
    const durationSec = buffer.duration;
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      throw new Error('Decoded audio has no duration');
    }
    if (durationSec > MAX_AUDIO_SECONDS) {
      throw new Error(
        `Clip is ${durationSec.toFixed(0)}s — the bench analyzes up to ${MAX_AUDIO_SECONDS}s. Trim the clip and retry.`
      );
    }
    // Mono mixdown: average all channels (Doppler tone is identical across them).
    const chCount = buffer.numberOfChannels;
    let mono: Float32Array;
    if (chCount === 1) {
      mono = buffer.getChannelData(0).slice();
    } else {
      const chans: Float32Array[] = [];
      for (let c = 0; c < chCount; c++) chans.push(buffer.getChannelData(c));
      mono = new Float32Array(buffer.length);
      for (let i = 0; i < buffer.length; i++) {
        let sum = 0;
        for (let c = 0; c < chCount; c++) sum += chans[c][i];
        mono[i] = sum / chCount;
      }
    }
    return {
      samples: mono,
      sampleRate: buffer.sampleRate,
      durationSec,
      channels: chCount,
    };
  } finally {
    void ctx.close();
  }
}
