import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  CircleAlert,
  Download,
  Loader2,
  MapPin,
  Plane,
  RadioTower,
  Save,
  Waves,
} from 'lucide-react';
import type { InvestigationCase } from '../types/osint';
import {
  computeSpectrogram,
  trackPeakFrequency,
  type Spectrogram,
} from '../utils/fft';
import {
  decimateCurve,
  filterCurveByMagnitude,
  fitRecorderPositionMulti,
  mergeTracks,
  parseAdsbLolStates,
  parseOpenSkyStates,
  parseTrackCsv,
  trackCentroid,
  type AircraftTrack,
  type MagnitudeSample,
  type MeasuredSample,
  type PositionFit,
} from '../utils/doppler';
import { decodeAudioFile } from '../services/audioAnalysis';
import { Panel, Well, Button, TextField, FieldLabel, NoticeBanner, EmptyState } from './ui';

interface AcousticDopplerModuleProps {
  activeCase: InvestigationCase;
  onUpdateGeoState: (
    updater: (geo: InvestigationCase['geoState']) => InvestigationCase['geoState']
  ) => void;
  onAppendLedger: (entry: {
    module: 'acoustic';
    targetLabel: string;
    findingSummary: string;
    sourceUrl: string;
    snapshotDataUrl?: string;
  }) => void;
}

/** One imported aircraft track, with its extracted audio curve if any. */
interface TrackEntry {
  icao: string;
  track: AircraftTrack;
  /** Recording-relative measured Doppler curve, when captured. */
  measured: MeasuredSample[] | null;
  bandLow: number | null;
  bandHigh: number | null;
  include: boolean;
}

const SPEC_HEIGHT = 300;

const GRADIENT_STOPS: Array<[number, [number, number, number]]> = [
  [0.0, [10, 12, 20]],
  [0.3, [46, 32, 88]],
  [0.55, [150, 55, 60]],
  [0.75, [225, 140, 70]],
  [0.9, [248, 220, 150]],
  [1.0, [253, 250, 240]],
];

function gradientColor(v: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, v));
  for (let i = 1; i < GRADIENT_STOPS.length; i++) {
    const [p1, c1] = GRADIENT_STOPS[i];
    const [p0, c0] = GRADIENT_STOPS[i - 1];
    if (t <= p1) {
      const f = (t - p0) / (p1 - p0 || 1);
      return [
        Math.round(c0[0] + f * (c1[0] - c0[0])),
        Math.round(c0[1] + f * (c1[1] - c0[1])),
        Math.round(c0[2] + f * (c1[2] - c0[2])),
      ];
    }
  }
  return GRADIENT_STOPS[GRADIENT_STOPS.length - 1][1];
}

/**
 * Renders the spectrogram into a fixed-size pixel buffer (dB scale, max-pooled),
 * returned as an ImageData-ready base. Kept pure of React state so overlay
 * redraws are cheap.
 */
function renderSpecBase(spec: Spectrogram, width: number, height: number): ImageData {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');
  const image = ctx.createImageData(width, height);
  const half = spec.fftSize >> 1;
  const nyquist = spec.sampleRate / 2;
  // max-pool frames→columns and bins→rows in dB space
  const db = new Float32Array(width * height).fill(-Infinity);
  for (let f = 0; f < spec.frames.length; f++) {
    const x = Math.min(width - 1, Math.floor((f / spec.frames.length) * width));
    const mags = spec.frames[f].magnitudes;
    for (let b = 1; b < half; b++) {
      const y = height - 1 - Math.min(height - 1, Math.floor((b / half) * height));
      const mag = mags[b];
      const val = 20 * Math.log10(mag + 1e-12);
      const idx = y * width + x;
      if (val > db[idx]) db[idx] = val;
    }
  }
  let maxDb = -Infinity;
  for (let i = 0; i < db.length; i++) if (db[i] > maxDb) maxDb = db[i];
  const floorDb = maxDb - 78;
  for (let i = 0; i < db.length; i++) {
    const v = Math.max(0, Math.min(1, (db[i] - floorDb) / 78));
    const [r, g, b] = gradientColor(v);
    image.data[i * 4] = r;
    image.data[i * 4 + 1] = g;
    image.data[i * 4 + 2] = b;
    image.data[i * 4 + 3] = 255;
  }
  void nyquist;
  return image;
}

/**
 * Acoustic Doppler bench: aircraft tones in a recording's spectrogram are
 * matched against ADS-B flight tracks to triangulate the recorder. Math core
 * is src/utils/doppler.ts (tested); this bench is its analyst surface.
 */
export const AcousticDopplerModule: React.FC<AcousticDopplerModuleProps> = ({
  activeCase,
  onUpdateGeoState,
  onAppendLedger,
}) => {
  const [audioName, setAudioName] = useState<string | null>(null);
  const [spec, setSpec] = useState<Spectrogram | null>(null);
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  const [bandLow, setBandLow] = useState(400);
  const [bandHigh, setBandHigh] = useState(900);
  const [magThreshold, setMagThreshold] = useState(0.15);

  const [curve, setCurve] = useState<MagnitudeSample[] | null>(null);
  const [curveBusy, setCurveBusy] = useState(false);

  const [trackEntries, setTrackEntries] = useState<TrackEntry[]>([]);
  const [pasteText, setPasteText] = useState('');
  const [trackError, setTrackError] = useState<string | null>(null);
  const [recStartLocal, setRecStartLocal] = useState<string>('');

  const [watchRunning, setWatchRunning] = useState(false);
  const [watchStatus, setWatchStatus] = useState<string | null>(null);
  const watchAbortRef = useRef(false);
  const watchStartRef = useRef<number | null>(null);

  const [fitRadiusKm, setFitRadiusKm] = useState(15);
  const [fitStepKm, setFitStepKm] = useState(2);
  const [fitOffsetWindow, setFitOffsetWindow] = useState(30);
  const [temperatureC, setTemperatureC] = useState(15);
  const [fit, setFit] = useState<PositionFit | null>(null);
  const [fitBusy, setFitBusy] = useState(false);
  const [fitError, setFitError] = useState<string | null>(null);

  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const specCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const curveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ startY: number; currentY: number } | null>(null);

  const nyquist = spec ? spec.sampleRate / 2 : 1;

  const redrawSpectrogram = useCallback(
    (bandLo: number, bandHi: number) => {
      const base = baseCanvasRef.current;
      const display = specCanvasRef.current;
      if (!base || !display || !spec) return;
      const ctx = display.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(base, 0, 0);
      const h = display.height;
      // band overlay
      const yLo = h - (bandHi / nyquist) * h;
      const yHi = h - (bandLo / nyquist) * h;
      ctx.fillStyle = 'rgba(240, 170, 60, 0.12)';
      ctx.fillRect(0, yLo, display.width, yHi - yLo);
      ctx.strokeStyle = 'rgba(240, 170, 60, 0.85)';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, yLo + 0.5, display.width - 1, yHi - yLo - 1);
      // axes: time ticks every ~10s and frequency lines every 1 kHz
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.font = '10px monospace';
      const dur = spec.frames.length > 0 ? spec.frames[spec.frames.length - 1].timeSec : 0;
      const tickStep = dur > 240 ? 60 : dur > 90 ? 30 : 10;
      for (let t = 0; t <= dur; t += tickStep) {
        const x = (t / dur) * display.width;
        ctx.fillRect(x, h - 8, 1, 8);
        ctx.fillText(`${t}s`, Math.min(display.width - 24, x + 2), h - 1);
      }
      for (let fK = 1; fK * 1000 < nyquist; fK++) {
        const y = h - (fK * 1000 / nyquist) * h;
        ctx.fillRect(0, y, 6, 1);
        if (fK % 2 === 0) ctx.fillText(`${fK}k`, 8, y + 3);
      }
    },
    [spec, nyquist]
  );

  const loadAudio = useCallback(async (file: File) => {
    setAudioBusy(true);
    setAudioError(null);
    setCurve(null);
    setFit(null);
    try {
      const decoded = await decodeAudioFile(file);
      // FFT 4096 @ hop 1024: ~1.1 Hz bins at 44.1k — enough for a 600 Hz sweep,
      // and hop gives ~43 frames/s.
      const computed = computeSpectrogram(decoded.samples, decoded.sampleRate, 4096, 1024);
      setSpec(computed);
      setAudioName(file.name);
    } catch (err) {
      setAudioError(err instanceof Error ? err.message : String(err));
    } finally {
      setAudioBusy(false);
    }
  }, []);

  // Canvas rendering happens in effects: refs are null in the same tick as
  // the state that mounts them, so draw-after-paint is the only correct place.
  useEffect(() => {
    if (!spec) return;
    const display = specCanvasRef.current;
    if (!display) return;
    const width = Math.max(64, Math.min(1800, spec.frames.length));
    display.width = width;
    display.height = SPEC_HEIGHT;
    const base = document.createElement('canvas');
    base.width = width;
    base.height = SPEC_HEIGHT;
    base.getContext('2d')?.putImageData(renderSpecBase(spec, width, SPEC_HEIGHT), 0, 0);
    baseCanvasRef.current = base;
    redrawSpectrogram(bandLow, bandHigh);
    // rebuild the pixel base only when the spectrogram itself changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec]);

  useEffect(() => {
    if (spec && baseCanvasRef.current) redrawSpectrogram(bandLow, bandHigh);
  }, [bandLow, bandHigh, spec, redrawSpectrogram]);

  /** Drag on the spectrogram sets the analysis band. */
  const pointerFreq = (e: React.PointerEvent<HTMLCanvasElement>): number => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    return Math.max(0, Math.min(nyquist - 1, (1 - y) * nyquist));
  };

  const onSpecPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = { startY: pointerFreq(e), currentY: pointerFreq(e) };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onSpecPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return;
    dragRef.current.currentY = pointerFreq(e);
    const lo = Math.min(dragRef.current.startY, dragRef.current.currentY);
    const hi = Math.max(dragRef.current.startY, dragRef.current.currentY);
    if (hi - lo >= 15) {
      setBandLow(Math.round(lo));
      setBandHigh(Math.round(hi));
    }
  };
  const onSpecPointerUp = () => {
    dragRef.current = null;
  };

  const extractCurve = useCallback(
    (bandLo = bandLow, bandHi = bandHigh): MagnitudeSample[] | null => {
      if (!spec) return null;
      const raw = trackPeakFrequency(spec, bandLo, bandHi).map((s) => ({
        tSec: s.timeSec,
        freqHz: s.freqHz,
        magnitude: s.magnitude,
      }));
      const filtered = filterCurveByMagnitude(raw, magThreshold);
      return decimateCurve(filtered, 4);
    },
    [spec, bandLow, bandHigh, magThreshold]
  );

  const runExtract = useCallback(() => {
    setCurveBusy(true);
    setFit(null);
    try {
      const result = extractCurve();
      setCurve(result);
    } finally {
      setCurveBusy(false);
    }
  }, [extractCurve]);

  // Curve plot, drawn after paint (the canvas mounts with the curve state).
  useEffect(() => {
    const canvas = curveCanvasRef.current;
    if (!curve || !canvas || curve.length < 2) return;
    canvas.width = 900;
    canvas.height = 180;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const t0 = curve[0].tSec;
    const t1 = curve[curve.length - 1].tSec;
    const fLo = Math.min(...curve.map((s) => s.freqHz));
    const fHi = Math.max(...curve.map((s) => s.freqHz));
    ctx.strokeStyle = '#e0a050';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < curve.length; i++) {
      const s = curve[i];
      const x = ((s.tSec - t0) / (t1 - t0 || 1)) * (canvas.width - 8) + 4;
      const y = canvas.height - 8 - ((s.freqHz - fLo) / (fHi - fLo || 1)) * (canvas.height - 20);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '10px monospace';
    ctx.fillText(`${fLo.toFixed(0)} Hz`, 6, 12);
    ctx.fillText(`${fHi.toFixed(0)} Hz`, 6, canvas.height - 12);
    ctx.fillText(`${t0.toFixed(0)} s`, 6, canvas.height - 1);
    ctx.fillText(`${t1.toFixed(0)} s`, canvas.width - 30, canvas.height - 1);
  }, [curve]);

  /** Anchors epoch-based track data onto the recording timeline. */
  const recStartEpochSec = (): number | null => {
    if (!recStartLocal) return null;
    const epoch = Date.parse(`${recStartLocal}:00Z`);
    return Number.isFinite(epoch) ? epoch / 1000 : null;
  };

  const addTracks = useCallback(
    (incoming: AircraftTrack[], anchored: boolean) => {
      if (anchored && recStartEpochSec() == null) {
        setTrackError('Set the recording start time first — epoch-based track data must be anchored to the recording timeline.');
        return;
      }
      const base = recStartEpochSec();
      const normalized = anchored && base != null
        ? incoming.map((t) => ({
            ...t,
            points: t.points.map((p) => ({ ...p, tSec: p.tSec - base })),
          }))
        : incoming;
      const usable = normalized.filter((t) => t.points.length >= 2);
      if (usable.length === 0) {
        setTrackError('Import parsed to zero multi-point tracks — a fit needs each aircraft to have ≥2 positions.');
        return;
      }
      setTrackError(null);
      setFit(null);
      setTrackEntries((prev) => {
        const next = new Map(prev.map((e) => [e.icao, e]));
        for (const t of usable) {
          const existing = next.get(t.icao);
          if (existing) {
            next.set(t.icao, {
              ...existing,
              track: mergeTracks([existing.track], [t])[0],
            });
          } else {
            next.set(t.icao, {
              icao: t.icao,
              track: t,
              measured: null,
              bandLow: null,
              bandHigh: null,
              include: true,
            });
          }
        }
        return [...next.values()];
      });
    },
    [recStartLocal]
  );

  const importPasted = useCallback(() => {
    const text = pasteText.trim();
    if (!text) return;
    try {
      if (text.startsWith('{')) {
        const json = JSON.parse(text) as unknown;
        if ((json as { ac?: unknown }).ac) {
          addTracks(parseAdsbLolStates(json, recStartEpochSec() ?? Date.now() / 1000), true);
        } else if ((json as { states?: unknown }).states) {
          addTracks(parseOpenSkyStates(json, recStartEpochSec() ?? Date.now() / 1000), true);
        } else {
          setTrackError('JSON recognized as neither adsb.lol ({ac:[…]}) nor OpenSky ({states:[…]}) format.');
        }
      } else {
        addTracks(parseTrackCsv(text), false);
        setTrackError(null);
      }
    } catch (err) {
      setTrackError(err instanceof Error ? err.message : String(err));
    }
  }, [pasteText, addTracks]);

  /** Live sky-watch: poll adsb.lol every 5s while the clip is being captured. */
  const runSkyWatch = useCallback(async () => {
    if (watchRunning) return;
    const lat = activeCase.geoState.lat;
    const lon = activeCase.geoState.lon;
    setWatchRunning(true);
    watchAbortRef.current = false;
    const startMs = Date.now();
    watchStartRef.current = startMs;
    const started = new Date(startMs);
    setRecStartLocal(
      `${started.getUTCFullYear()}-${String(started.getUTCMonth() + 1).padStart(2, '0')}-${String(started.getUTCDate()).padStart(2, '0')}T${String(started.getUTCHours()).padStart(2, '0')}:${String(started.getUTCMinutes()).padStart(2, '0')}`
    );
    let tracks: AircraftTrack[] = [];
    let polls = 0;
    const poll = async (): Promise<void> => {
      if (watchAbortRef.current) return;
      try {
        const res = await fetch(`/api/osint/adsb?lat=${lat}&lon=${lon}&radiusKm=60`);
        if (res.ok) {
          const json = await res.json();
          const rel = (Date.now() - startMs) / 1000;
          tracks = mergeTracks(tracks, parseAdsbLolStates(json, rel));
          polls += 1;
          setTrackError(null);
          addTracksToState(tracks);
          setWatchStatus(`Poll ${polls} · ${tracks.length} aircraft · ${(rel).toFixed(0)}s elapsed`);
        } else {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          setWatchStatus(`Poll ${polls + 1} failed: ${body?.error ?? `HTTP ${res.status}`}`);
        }
      } catch (err) {
        setWatchStatus(`Poll failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (!watchAbortRef.current && Date.now() - startMs < 90_000) {
        setTimeout(poll, 5000);
      } else {
        setWatchRunning(false);
        setWatchStatus((s) => `${s ?? ''} — watch complete`);
      }
    };
    const addTracksToState = (current: AircraftTrack[]) => {
      setTrackEntries((prev) => {
        const next = new Map(prev.map((e) => [e.icao, e]));
        for (const t of current) {
          const existing = next.get(t.icao);
          if (existing) {
            next.set(t.icao, { ...existing, track: t });
          } else {
            next.set(t.icao, {
              icao: t.icao,
              track: t,
              measured: null,
              bandLow: null,
              bandHigh: null,
              include: true,
            });
          }
        }
        return [...next.values()];
      });
    };
    await poll();
  }, [watchRunning, activeCase.geoState.lat, activeCase.geoState.lon]);

  const captureCurveForTrack = useCallback(
    (icao: string) => {
      const measured = extractCurve();
      if (!measured || measured.length < 8) {
        setTrackError(`Extracted curve for band ${bandLow}–${bandHigh} Hz has ${measured?.length ?? 0} usable samples — need ≥8 to fit.`);
        return;
      }
      setTrackError(null);
      setFit(null);
      setTrackEntries((prev) =>
        prev.map((e) =>
          e.icao === icao
            ? { ...e, measured, bandLow, bandHigh }
            : e
        )
      );
    },
    [extractCurve, bandLow, bandHigh]
  );

  const runFit = useCallback(async () => {
    const pairs = trackEntries
      .filter((e) => e.include && e.measured && e.measured.length >= 8)
      .map((e) => ({ track: e.track, measured: e.measured as MeasuredSample[] }));
    if (pairs.length === 0) {
      setFitError('No fit ran: assign an extracted curve to at least one track (checkbox + “Capture curve” for the aircraft’s band).');
      return;
    }
    setFitError(null);
    setFitBusy(true);
    setFit(null);
    // let the busy state paint before the synchronous grid search
    await new Promise((r) => setTimeout(r, 40));
    try {
      const centroid =
        pairs.length > 0 ? trackCentroid(pairs[0].track) : { lat: 0, lon: 0 };
      const result = fitRecorderPositionMulti(pairs, {
        center: centroid, // rough prior; the grid search does the real work
        radiusKm: fitRadiusKm,
        stepKm: fitStepKm,
        offsetWindowSec: fitOffsetWindow,
        offsetStepSec: 2,
        temperatureC,
      });
      setFit(result);
    } catch (err) {
      setFitError(err instanceof Error ? err.message : String(err));
    } finally {
      setFitBusy(false);
    }
  }, [trackEntries, fitRadiusKm, fitStepKm, fitOffsetWindow, temperatureC]);

  const pinOnMap = useCallback(() => {
    if (!fit) return;
    onUpdateGeoState((geo) => ({
      ...geo,
      lat: fit.lat,
      lon: fit.lon,
      locationLabel: `Doppler fit · RMS ${fit.rmsHz.toFixed(1)} Hz (${fit.icaos.length} aircraft)`,
    }));
  }, [fit, onUpdateGeoState]);

  const saveToCase = useCallback(() => {
    if (!fit || !audioName) return;
    let snapshotDataUrl: string | undefined;
    try {
      snapshotDataUrl =
        specCanvasRef.current?.toDataURL('image/webp', 0.75) ?? undefined;
    } catch {
      snapshotDataUrl = undefined;
    }
    onAppendLedger({
      module: 'acoustic',
      targetLabel: audioName,
      findingSummary: `Acoustic Doppler fit from ${fit.icaos.length} aircraft track(s) [${fit.icaos.join(', ')}]: recorder at ${fit.lat.toFixed(5)}, ${fit.lon.toFixed(5)} · f0 ${fit.f0Hz.toFixed(1)} Hz · timeline offset ${fit.timeOffsetSec.toFixed(2)} s · RMS residual ${fit.rmsHz.toFixed(2)} Hz over ${fit.samples} samples. ${fit.icaos.length === 1 ? 'SINGLE-AIRCRAFT FIT — the position has a mirror ambiguity about the flight track; treat as two-sided.' : 'Joint fit — independent headings collapse the single-pass mirror ambiguity, but corroborate before treating as unique.'} Heuristic estimate, not evidence — corroborate with ground truth.`,
      sourceUrl: 'local://acoustic-doppler',
      snapshotDataUrl,
    });
  }, [fit, audioName, onAppendLedger]);

  const fittableCount = trackEntries.filter(
    (e) => e.include && e.measured && e.measured.length >= 8
  ).length;

  return (
    <div className="space-y-4">
      <Panel
        tag="09"
        title="Acoustic Doppler Geolocation"
        description="Aircraft audio leaves Doppler curves on a recording's spectrogram. Matched against flight tracks, those curves triangulate where the clip was recorded — the Colsto technique, math core unit-tested in src/utils/doppler.ts."
      >
        <div className="space-y-2">
          <NoticeBanner tone="hypothesis" icon={<Activity />}>
            <span className="font-semibold">Requirements, honestly:</span> the
            aircraft track must cover the recording window (import a CSV/JSON
            export, or use sky-watch for clips captured live); the tone must be
            a quasi-stable harmonic (propeller/turbine whine — not broadband
            roar); aircraft must actually be overhead. The result is a
            heuristic fit with disclosed RMS — corroborate it.
          </NoticeBanner>
          <NoticeBanner tone="warn" icon={<CircleAlert />}>
            <span className="font-semibold">Mirror ambiguity:</span> a single
            straight pass constrains distance to the flight track, not which
            side you're on. A one-aircraft fit is two-sided by physics; only
            aircraft on different headings collapse it (joint fit). Never
            treat a single-aircraft fit as unique.
          </NoticeBanner>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* ---- Left: audio + spectrogram + curve ---- */}
        <div className="space-y-4">
          <Panel
            tag="A"
            title="Recording"
            description="Upload an audio or video clip — decode, STFT and fitting all run locally; nothing is uploaded."
            actions={
              <label>
                <input
                  type="file"
                  accept="audio/*,video/*,.wav,.mp3,.m4a,.ogg,.webm,.mp4,.mov"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void loadAudio(f);
                    e.currentTarget.value = '';
                  }}
                />
                <span className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded border border-line bg-well px-2.5 text-xs font-medium text-ink hover:border-accent">
                  {audioBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Waves className="h-3.5 w-3.5" />}
                  Upload audio / video
                </span>
              </label>
            }
          >
            {!spec && !audioBusy && !audioError && (
              <EmptyState
                icon={<Waves className="h-5 w-5" />}
                title="No recording loaded"
                hint="Drop a WAV/MP3/M4A/OGG (or a video's audio track), up to 5 minutes. ~60 s with aircraft overhead is the sweet spot."
              />
            )}
            {audioBusy && (
              <NoticeBanner tone="info" icon={<Loader2 className="animate-spin" />}>
                Decoding + computing STFT (4096-point FFT, Hann window) — a minute-long clip takes a few seconds.
              </NoticeBanner>
            )}
            {audioError && (
              <NoticeBanner tone="danger" icon={<CircleAlert />}>
                {audioError}
              </NoticeBanner>
            )}
            {spec && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-3 text-xs text-ink-3">
                  <span className="font-mono text-ink-2">{audioName}</span>
                  <span>{(spec.sampleRate / 1000).toFixed(1)} kHz</span>
                  <span>
                    {spec.frames.length > 0
                      ? `${spec.frames[spec.frames.length - 1].timeSec.toFixed(0)} s`
                      : 'empty'}
                  </span>
                  <span className="ml-auto text-[11px]">drag vertically on the plot to set the band</span>
                </div>
                <canvas
                  ref={specCanvasRef}
                  className="w-full rounded border border-line bg-black"
                  onPointerDown={onSpecPointerDown}
                  onPointerMove={onSpecPointerMove}
                  onPointerUp={onSpecPointerUp}
                />
                <div className="flex flex-wrap items-end gap-2">
                  <div className="w-28">
                    <FieldLabel htmlFor="band-low">Band low (Hz)</FieldLabel>
                    <TextField
                      id="band-low"
                      type="number"
                      value={bandLow}
                      min={1}
                      max={Math.round(nyquist - 15)}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v)) {
                          setBandLow(v);
                          redrawSpectrogram(v, bandHigh);
                        }
                      }}
                    />
                  </div>
                  <div className="w-28">
                    <FieldLabel htmlFor="band-high">Band high (Hz)</FieldLabel>
                    <TextField
                      id="band-high"
                      type="number"
                      value={bandHigh}
                      min={16}
                      max={Math.round(nyquist)}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v)) {
                          setBandHigh(v);
                          redrawSpectrogram(bandLow, v);
                        }
                      }}
                    />
                  </div>
                  <div className="w-36">
                    <FieldLabel htmlFor="mag-threshold">Min magnitude {(magThreshold * 100).toFixed(0)}%</FieldLabel>
                    <input
                      id="mag-threshold"
                      type="range"
                      min={0}
                      max={0.9}
                      step={0.05}
                      value={magThreshold}
                      onChange={(e) => setMagThreshold(Number(e.target.value))}
                      className="h-9 w-full accent-[var(--color-accent,#e0a050)]"
                    />
                  </div>
                  <Button variant="primary" onClick={runExtract} disabled={curveBusy || !spec}>
                    {curveBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
                    Extract curve
                  </Button>
                </div>
                {curve && (
                  <Well label={`Extracted curve — ${curve.length} samples in band ${bandLow}–${bandHigh} Hz`}>
                    <canvas ref={curveCanvasRef} className="w-full" />
                  </Well>
                )}
                {curve && curve.length < 8 && (
                  <NoticeBanner tone="warn" icon={<CircleAlert />}>
                    Only {curve.length} usable samples — widen the band or lower the magnitude floor; a fit needs ≥8 (ideally hundreds).
                  </NoticeBanner>
                )}
              </div>
            )}
          </Panel>

          <Panel
            tag="T"
            title={`Aircraft tracks (${trackEntries.length})`}
            description="Import-first: provider CSV/JSON exports, or a live sky-watch for clips captured while polling. Epoch-based formats are anchored to the recording start you set."
          >
            <div className="space-y-3">
              <Well label="Recording start (UTC — anchors epoch-based tracks)" className="p-3">
                <TextField
                  type="datetime-local"
                  value={recStartLocal}
                  onChange={(e) => setRecStartLocal(e.target.value)}
                  aria-label="Recording start (UTC)"
                />
              </Well>
              <Well label="Paste track data (adsb.lol JSON · OpenSky JSON · CSV: time,icao24,lat,lon,baro_altitude)" className="p-3">
                <textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  rows={4}
                  placeholder='{"ac":[…]}  ·  {"states":[[…]]}  ·  time,icao24,lat,lon,baro_altitude…'
                  className="w-full rounded border border-line bg-well p-2 font-mono text-[11px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
                />
                <div className="mt-2 flex items-center gap-2">
                  <Button onClick={importPasted} disabled={!pasteText.trim()}>
                    <Download className="h-4 w-4" /> Parse & import
                  </Button>
                </div>
              </Well>
              <Well label="Live sky-watch (zero-key, adsb.lol)" className="p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant={watchRunning ? 'danger' : 'solid'}
                    onClick={() => {
                      if (watchRunning) {
                        watchAbortRef.current = true;
                        setWatchStatus('watch aborted');
                        setWatchRunning(false);
                      } else {
                        void runSkyWatch();
                      }
                    }}
                  >
                    <RadioTower className="h-4 w-4" />
                    {watchRunning ? 'Stop watch' : `Watch sky 90 s @ map pin`}
                  </Button>
                  <span className="text-[11px] leading-4 text-ink-3">
                    Polls aircraft within 60 km of the map pin every 5 s and builds tracks. For clips
                    recorded during the watch; recording start is set automatically.
                  </span>
                </div>
                {watchStatus && <div className="mt-1.5 font-mono text-[11px] text-ink-2">{watchStatus}</div>}
              </Well>

              {trackError && (
                <NoticeBanner tone="warn" icon={<CircleAlert />}>
                  {trackError}
                </NoticeBanner>
              )}

              {trackEntries.length === 0 ? (
                <EmptyState
                  icon={<Plane className="h-5 w-5" />}
                  title="No aircraft tracks yet"
                  hint="A fit needs each aircraft's positions covering the recording window, plus that aircraft's tone curve captured from its own frequency band."
                />
              ) : (
                <Well label="Tracks" actions={<span className="text-[11px] text-ink-3">{fittableCount} fittable</span>} className="p-3">
                  <ul className="space-y-2">
                    {trackEntries.map((entry) => {
                      const first = entry.track.points[0];
                      const last = entry.track.points[entry.track.points.length - 1];
                      return (
                        <li key={entry.icao} className="flex flex-wrap items-center gap-2 rounded border border-line px-2.5 py-2">
                          <input
                            type="checkbox"
                            checked={entry.include}
                            onChange={(e) =>
                              setTrackEntries((prev) =>
                                prev.map((x) => (x.icao === entry.icao ? { ...x, include: e.target.checked } : x))
                              )
                            }
                            aria-label={`Include ${entry.icao} in fit`}
                            className="accent-[var(--color-accent,#e0a050)]"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-mono text-xs text-ink">
                              {entry.track.callsign || '—'} <span className="text-ink-3">({entry.icao})</span>
                            </div>
                            <div className="font-mono text-[10px] text-ink-3">
                              {entry.track.points.length} pts · {first.tSec.toFixed(0)}s→{last.tSec.toFixed(0)}s ·{' '}
                              {entry.measured
                                ? `curve ${entry.measured.length} samples @ ${entry.bandLow}–${entry.bandHigh} Hz`
                                : 'no curve captured'}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant={entry.measured ? 'ghost' : 'solid'}
                            disabled={!spec || curveBusy || !entry.include}
                            onClick={() => captureCurveForTrack(entry.icao)}
                          >
                            {entry.measured ? 'Recapture curve' : 'Capture curve (current band)'}
                          </Button>
                          <button
                            type="button"
                            aria-label={`Remove track ${entry.icao}`}
                            onClick={() => {
                              setTrackEntries((prev) => prev.filter((x) => x.icao !== entry.icao));
                              setFit(null);
                            }}
                            className="text-ink-3 hover:text-danger"
                          >
                            ×
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="mt-2 text-[11px] leading-4 text-ink-3">
                    Each aircraft's tone sits in its own band: set the band, extract, then hit
                    “Capture curve” for that aircraft. Two+ aircraft on different headings is what
                    collapses the mirror ambiguity.
                  </p>
                </Well>
              )}
            </div>
          </Panel>
        </div>

        {/* ---- Right: fit ---- */}
        <div className="space-y-4">
          <Panel
            tag="F"
            title="Position fit"
            description="Shared-grid joint estimation with closed-form f0 and timeline-offset search (coarse → refine)."
            actions={
              <div className="flex items-center gap-1.5">
                <Button variant="primary" size="sm" onClick={() => void runFit()} disabled={fitBusy || fittableCount === 0}>
                  {fitBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MapPin className="h-3.5 w-3.5" />}
                  Run fit
                </Button>
                {fit && (
                  <>
                    <Button size="sm" onClick={pinOnMap}>
                      Pin on map
                    </Button>
                    <Button size="sm" variant="ghost" onClick={saveToCase}>
                      <Save className="h-3.5 w-3.5" /> Save
                    </Button>
                  </>
                )}
              </div>
            }
          >
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div>
                  <FieldLabel htmlFor="fit-radius">Radius km</FieldLabel>
                  <TextField id="fit-radius" type="number" min={1} max={200} value={fitRadiusKm} onChange={(e) => setFitRadiusKm(Number(e.target.value) || 15)} />
                </div>
                <div>
                  <FieldLabel htmlFor="fit-step">Step km</FieldLabel>
                  <TextField id="fit-step" type="number" min={0.5} max={20} step={0.5} value={fitStepKm} onChange={(e) => setFitStepKm(Number(e.target.value) || 2)} />
                </div>
                <div>
                  <FieldLabel htmlFor="fit-offset">Offset ±s</FieldLabel>
                  <TextField id="fit-offset" type="number" min={0} max={600} value={fitOffsetWindow} onChange={(e) => setFitOffsetWindow(Number(e.target.value) || 30)} />
                </div>
                <div>
                  <FieldLabel htmlFor="fit-temp">Temp °C</FieldLabel>
                  <TextField id="fit-temp" type="number" min={-30} max={50} value={temperatureC} onChange={(e) => setTemperatureC(Number(e.target.value))} />
                </div>
              </div>

              {fitError && (
                <NoticeBanner tone="warn" icon={<CircleAlert />}>
                  {fitError}
                </NoticeBanner>
              )}

              {!fit && !fitBusy && !fitError && (
                <EmptyState
                  icon={<MapPin className="h-5 w-5" />}
                  title={fittableCount === 0 ? 'Nothing to fit yet' : 'Ready to fit'}
                  hint={
                    fittableCount === 0
                      ? 'Import tracks, capture each aircraft’s curve from its band, then run the fit.'
                      : `${fittableCount} aircraft ready — the joint fit searches the shared grid and reports RMS, never certainty.`
                  }
                />
              )}
              {fitBusy && (
                <NoticeBanner tone="info" icon={<Loader2 className="animate-spin" />}>
                  Grid search running ({fittableCount} aircraft × timeline offsets × altitudes)…
                </NoticeBanner>
              )}
              {fit && (
                <div className="space-y-2.5">
                  <Well label="Fitted recorder position">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 p-3 font-mono text-xs text-ink-2 sm:grid-cols-3">
                      <div>
                        <div className="text-[10px] uppercase text-ink-3">Lat</div>
                        {fit.lat.toFixed(6)}
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-ink-3">Lon</div>
                        {fit.lon.toFixed(6)}
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-ink-3">RMS residual</div>
                        {fit.rmsHz.toFixed(2)} Hz
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-ink-3">Tone f0</div>
                        {fit.f0Hz.toFixed(1)} Hz
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-ink-3">Timeline offset</div>
                        {fit.timeOffsetSec.toFixed(2)} s
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-ink-3">Samples / aircraft</div>
                        {fit.samples} / {fit.icaos.length}
                      </div>
                    </div>
                  </Well>
                  {fit.icaos.length === 1 ? (
                    <NoticeBanner tone="warn" icon={<CircleAlert />}>
                      <span className="font-semibold">Two-sided result:</span> one aircraft cannot
                      tell which side of the track the recorder was on. The true position is
                      mirrored across the flight path — treat this pin as one of two candidates, and
                      prefer a joint fit with a second heading.
                    </NoticeBanner>
                  ) : (
                    <NoticeBanner tone="info" icon={<Activity />}>
                      Joint fit across {fit.icaos.length} aircraft — independent headings collapse
                      the single-pass mirror ambiguity. RMS is the residual of the sweep match, not
                      a confidence in meters.
                    </NoticeBanner>
                  )}
                </div>
              )}
            </div>
          </Panel>

          <Panel tag="i" title="How this works">
            <ul className="space-y-1.5 text-xs leading-5 text-ink-2">
              <li>• STFT (4096-point FFT, Hann window, ~43 frames/s) tracks the dominant peak in your selected band with parabolic sub-bin interpolation — that's the measured curve f(t).</li>
              <li>• For each candidate position the model predicts f(t) from the track's range-rate; the tone's f0 has a closed-form least-squares solution, so the grid search only hunts position + timeline offset.</li>
              <li>• Each aircraft's cost field is normalized by its own best, then summed on the shared grid (joint fit). Refine pass tightens the coarse minimum.</li>
              <li>• Tracks: adsb.lol snapshot API (live watch) or any provider's CSV/JSON export (OpenSky history, tar1090 dumps). Historic recordings need historic tracks — that's physics, not a limitation of the tool.</li>
              <li>• Prior art: the technique was demonstrated publicly by Colsto (Nov 2026); Doppler positioning is the same principle COSPAS-SARSAT uses for distress beacons. See docs/methodology/acoustic-doppler.md.</li>
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
};
