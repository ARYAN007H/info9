/**
 * Acoustic Doppler geolocation — the "aircraft noise leaks your position"
 * technique (see Colsto's 2026 demonstration): the frequency-vs-time
 * (Doppler) curve of a passing aircraft, measured from a recording, is a
 * geometric fingerprint. Matched against the aircraft's ADS-B track, each
 * curve constrains the recorder's position; several aircraft on DIFFERENT
 * headings triangulate it to street level.
 *
 * A single straight-line pass has a fundamental mirror ambiguity (the curve
 * is symmetric about the flight track), so the joint multi-aircraft fit is
 * the honest default — per-aircraft fits are two-sided and must not be
 * presented as unique positions.
 *
 * Every function here is pure and unit-tested. Provenance contract: outputs
 * are DERIVED from user-supplied measurements + imported flight tracks;
 * high RMS residuals are reported as-is — never polished into confidence.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrackPoint {
  /** Seconds; epoch-based for real tracks, relative for synthetic ones. */
  tSec: number;
  lat: number;
  lon: number;
  /** Meters above sea level. */
  altM: number;
}

export interface AircraftTrack {
  icao: string;
  callsign?: string;
  points: TrackPoint[];
}

export interface MeasuredSample {
  /** Seconds from the start of the recording. */
  tSec: number;
  /** Measured tone frequency, Hz. */
  freqHz: number;
}

export interface LatLngAlt {
  lat: number;
  lon: number;
  altM: number;
}

export interface PositionFit {
  lat: number;
  lon: number;
  altM: number;
  /** Estimated tone base frequency (Hz) at rest. */
  f0Hz: number;
  /** Time offset (s) applied to the recording timeline during the fit. */
  timeOffsetSec: number;
  /** Mean RMS residual across contributing aircraft, Hz. */
  rmsHz: number;
  /** Total measured samples used. */
  samples: number;
  /** Aircraft that contributed (their icao ids). */
  icaos: string[];
}

// ---------------------------------------------------------------------------
// Physical primitives
// ---------------------------------------------------------------------------

/** Speed of sound in dry air, m/s, from temperature (°C): 331.3·√(1+T/273.15). */
export function speedOfSound(temperatureC: number = 15): number {
  return 331.3 * Math.sqrt(1 + temperatureC / 273.15);
}

const EARTH_R_M = 6_371_000;

/** Local-plane 3D distance between two lat/lon/alt points, in meters. */
export function distanceMeters(
  a: { lat: number; lon: number; altM: number },
  b: { lat: number; lon: number; altM: number }
): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const latM = dLat * EARTH_R_M;
  const lonM =
    dLon * EARTH_R_M * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  const dAlt = b.altM - a.altM;
  return Math.sqrt(latM * latM + lonM * lonM + dAlt * dAlt);
}

/** Predicted received frequency of a tone of f0 from a source with range rate v_r. */
export function dopplerFrequency(f0Hz: number, rangeRateMs: number, cMs: number): number {
  // rangeRate positive = receding → lower pitch.
  return (f0Hz * cMs) / (cMs + rangeRateMs);
}

/** Range-rate (m/s, positive = receding) at each track point via range differences. */
export function rangeRates(track: AircraftTrack, recorder: LatLngAlt): number[] {
  const ranges = track.points.map((p) =>
    distanceMeters({ lat: p.lat, lon: p.lon, altM: p.altM }, recorder)
  );
  const rates: number[] = new Array(track.points.length).fill(0);
  for (let i = 1; i < track.points.length; i++) {
    const dt = track.points[i].tSec - track.points[i - 1].tSec;
    if (dt <= 0) throw new Error('track points must be strictly increasing in time');
    rates[i] = (ranges[i] - ranges[i - 1]) / dt;
  }
  if (track.points.length > 1) rates[0] = rates[1];
  return rates;
}

// ---------------------------------------------------------------------------
// Track parsers (import-first, zero-key)
// ---------------------------------------------------------------------------

/** adsb.lol / tar1090-style v2 snapshot: one position per aircraft, anchored "now". */
export function parseAdsbLolStates(json: unknown, baseTimeSec: number): AircraftTrack[] {
  const aircraft = (json as { ac?: Array<Record<string, unknown>> })?.ac;
  if (!Array.isArray(aircraft)) return [];
  const byIcao = new Map<string, AircraftTrack>();
  for (const ac of aircraft) {
    const icao = String(ac.hex ?? '');
    const lat = Number(ac.lat);
    const lon = Number(ac.lon);
    if (!icao || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const alt = Number(ac.alt_geom ?? ac.alt_baro ?? 0);
    const track: AircraftTrack = {
      icao,
      callsign: typeof ac.flight === 'string' ? ac.flight.trim() : undefined,
      points: [
        { tSec: baseTimeSec, lat, lon, altM: Number.isFinite(alt) && alt !== 0 ? alt : 0 },
      ],
    };
    const existing = byIcao.get(icao);
    if (!existing) byIcao.set(icao, track);
    else existing.points.push(...track.points);
  }
  return [...byIcao.values()];
}

/** OpenSky /api/states/all anonymous response. */
export function parseOpenSkyStates(json: unknown, baseTimeSec: number): AircraftTrack[] {
  const states = (json as { states?: unknown[] })?.states;
  if (!Array.isArray(states)) return [];
  const byIcao = new Map<string, AircraftTrack>();
  for (const s of states as Array<unknown[]>) {
    const icao = String(s[0] ?? '');
    const callsign = typeof s[1] === 'string' ? s[1].trim() : undefined;
    const lon = Number(s[5]);
    const lat = Number(s[6]);
    const alt = Number(s[13] ?? s[7] ?? 0);
    const onGround = s[8] === true;
    if (!icao || onGround || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const track: AircraftTrack = {
      icao,
      callsign: callsign || undefined,
      points: [{ tSec: baseTimeSec, lat, lon, altM: Number.isFinite(alt) ? alt : 0 }],
    };
    const existing = byIcao.get(icao);
    if (!existing) byIcao.set(icao, track);
    else existing.points.push(...track.points);
  }
  return [...byIcao.values()];
}

/** Generic CSV track import (OpenSky exports, adsb history dumps). */
export function parseTrackCsv(text: string): AircraftTrack[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const idx = (names: string[]) =>
    header.findIndex((h) => names.some((n) => h === n || h.endsWith(n)));
  const iT = idx(['t', 'time', 'epoch', 'timestamp']);
  const iLat = idx(['lat', 'latitude']);
  const iLon = idx(['lon', 'lng', 'longitude']);
  const iAlt = idx(['alt', 'altitude', 'baro_altitude', 'alt_geom']);
  const iIcao = idx(['icao', 'icao24', 'hex']);
  const iCs = idx(['callsign', 'flight']);
  if (iT === -1 || iLat === -1 || iLon === -1) return [];
  const byIcao = new Map<string, AircraftTrack>();
  for (let i = 1; i < lines.length; i++) {
    const fields = lines[i].split(',').map((f) => f.trim());
    const t = Number(fields[iT]);
    const lat = Number(fields[iLat]);
    const lon = Number(fields[iLon]);
    const alt = iAlt === -1 ? 0 : Number(fields[iAlt]) || 0;
    const icao = iIcao === -1 ? 'unknown' : fields[iIcao] || 'unknown';
    if (!Number.isFinite(t) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const callsign = iCs === -1 ? undefined : fields[iCs] || undefined;
    const track = byIcao.get(icao) ?? { icao, callsign, points: [] };
    track.points.push({ tSec: t, lat, lon, altM: alt });
    byIcao.set(icao, track);
  }
  return [...byIcao.values()].map((t) => ({
    ...t,
    points: t.points.sort((a, b) => a.tSec - b.tSec),
  }));
}

// ---------------------------------------------------------------------------
// Curve synthesis & prediction
// ---------------------------------------------------------------------------

/** Predicted received tone curve for a candidate recorder position. */
export function predictDopplerCurve(
  track: AircraftTrack,
  recorder: LatLngAlt,
  f0Hz: number,
  cMs: number
): MeasuredSample[] {
  const rates = rangeRates(track, recorder);
  return track.points
    .map((p, i) => ({ tSec: p.tSec, freqHz: dopplerFrequency(f0Hz, rates[i], cMs) }))
    .filter((s) => s.freqHz > 0);
}

/** Linear interpolation of a predicted curve at arbitrary times. */
function sampleCurveAt(curve: MeasuredSample[], tSec: number): number | null {
  if (curve.length === 0) return null;
  if (tSec <= curve[0].tSec || tSec >= curve[curve.length - 1].tSec) return null;
  let lo = 0;
  let hi = curve.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (curve[mid].tSec <= tSec) lo = mid;
    else hi = mid;
  }
  const a = curve[lo];
  const b = curve[hi];
  const frac = (tSec - a.tSec) / (b.tSec - a.tSec);
  return a.freqHz + frac * (b.freqHz - a.freqHz);
}

/** Deterministic synthetic-measurement generator for tests and calibration. */
export function synthesizeMeasuredCurve(
  track: AircraftTrack,
  trueRecorder: LatLngAlt,
  f0Hz: number,
  cMs: number,
  sampleHz: number,
  noiseHz: number,
  rng: () => number = Math.random
): MeasuredSample[] {
  const curve = predictDopplerCurve(track, trueRecorder, f0Hz, cMs);
  const t0 = curve[0]?.tSec ?? 0;
  const tEnd = curve[curve.length - 1]?.tSec ?? t0;
  const out: MeasuredSample[] = [];
  for (let t = t0; t <= tEnd; t += 1 / sampleHz) {
    const f = sampleCurveAt(curve, t);
    if (f === null) continue;
    const noise = noiseHz === 0 ? 0 : (rng() * 2 - 1) * noiseHz;
    out.push({ tSec: t, freqHz: f + noise });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The fit: shared-grid joint estimation
// ---------------------------------------------------------------------------

export interface FitOptions {
  /** Lat/lon center of the candidate grid (rough prior, or track centroid). */
  center: { lat: number; lon: number };
  /** Grid radius in km. */
  radiusKm: number;
  /** Grid step in km (coarse pass). */
  stepKm: number;
  /** Timeline offset search window, ± seconds (default 30). */
  offsetWindowSec?: number;
  /** Offset step (default 1 s). */
  offsetStepSec?: number;
  /** Altitude candidates in meters (defaults to a small ground-level set). */
  altCandidatesM?: number[];
  temperatureC?: number;
}

interface GridSpec {
  lats: number[];
  lons: number[];
  rows: number;
  cols: number;
}

function squareGrid(
  center: { lat: number; lon: number },
  radiusKm: number,
  stepKm: number
): GridSpec {
  const rows = Math.max(3, Math.ceil((radiusKm * 2) / stepKm) + 1);
  const cols = rows;
  const lats: number[] = [];
  const lons: number[] = [];
  for (let r = 0; r < rows; r++) {
    lats.push(center.lat + ((r / (rows - 1)) * 2 - 1) * (radiusKm / 111.32));
  }
  const lonScale = 111.32 * Math.cos((center.lat * Math.PI) / 180) || 1;
  for (let col = 0; col < cols; col++) {
    lons.push(center.lon + ((col / (cols - 1)) * 2 - 1) * (radiusKm / lonScale));
  }
  return { lats, lons, rows, cols };
}

interface FieldResult {
  grid: GridSpec;
  /** RMS field normalized so the best cell is exactly 1.0 (dimensionless). */
  field: Float64Array;
  bestLat: number;
  bestLon: number;
  bestRmsHz: number;
  bestF0Hz: number;
  offsetSec: number;
  missing: number;
}

function buildField(
  track: AircraftTrack,
  measured: MeasuredSample[],
  grid: GridSpec,
  offsets: number[],
  altCandidatesM: number[],
  cMs: number
): FieldResult {
  let bestOffset = 0;
  let bestOffsetCost = Infinity;
  let best: Omit<FieldResult, 'grid' | 'offsetSec' | 'missing'> | null = null;

  for (const offset of offsets) {
    const shifted = measured.map((m) => ({ tSec: m.tSec + offset, freqHz: m.freqHz }));
    const field = new Float64Array(grid.rows * grid.cols).fill(Infinity);
    let minCost = Infinity;
    let minLat = grid.lats[0];
    let minLon = grid.lons[0];
    let minF0 = 0;
    let minRms = Infinity;

    for (let r = 0; r < grid.rows; r++) {
      for (let col = 0; col < grid.cols; col++) {
        let cellBest = Infinity;
        for (const altM of altCandidatesM) {
          const predicted = predictDopplerCurve(
            track,
            { lat: grid.lats[r], lon: grid.lons[col], altM },
            1,
            cMs
          );
          let sumFR = 0;
          let sumRR = 0;
          let used = 0;
          for (const m of shifted) {
            const ratio = sampleCurveAt(predicted, m.tSec);
            if (ratio === null) continue;
            sumFR += m.freqHz * ratio;
            sumRR += ratio * ratio;
            used++;
          }
          if (used < 8 || sumRR <= 0) continue;
          const f0 = sumFR / sumRR;
          let sse = 0;
          for (const m of shifted) {
            const ratio = sampleCurveAt(predicted, m.tSec);
            if (ratio === null) continue;
            const err = m.freqHz - f0 * ratio;
            sse += err * err;
          }
          const rms = Math.sqrt(sse / used);
          if (rms < cellBest) {
            cellBest = rms;
            if (rms < minCost) {
              minCost = rms;
              minLat = grid.lats[r];
              minLon = grid.lons[col];
              minF0 = f0;
              minRms = rms;
            }
          }
        }
        field[r * grid.cols + col] = cellBest;
      }
    }
    if (minCost < bestOffsetCost) {
      bestOffsetCost = minCost;
      bestOffset = offset;
      best = {
        bestLat: minLat,
        bestLon: minLon,
        bestRmsHz: minRms,
        bestF0Hz: minF0,
        field,
      };
    }
  }

  const field = best!.field;
  // normalize by the best cost so fields from different aircraft sum fairly
  let missing = 0;
  for (let i = 0; i < field.length; i++) {
    if (!Number.isFinite(field[i])) {
      field[i] = 1e6;
      missing++;
    } else {
      field[i] = field[i] / best!.bestRmsHz;
    }
  }
  return {
    grid,
    field,
    bestLat: best!.bestLat,
    bestLon: best!.bestLon,
    bestRmsHz: best!.bestRmsHz,
    bestF0Hz: best!.bestF0Hz,
    offsetSec: bestOffset,
    missing,
  };
}

function argminField(field: Float64Array): number {
  let bi = 0;
  for (let i = 1; i < field.length; i++) {
    if (field[i] < field[bi]) bi = i;
  }
  return bi;
}

interface Pair {
  track: AircraftTrack;
  measured: MeasuredSample[];
}

function evaluateJoint(
  pairs: Pair[],
  grid: GridSpec,
  offsets: number[],
  altCandidatesM: number[],
  cMs: number
): { lat: number; lon: number; offsetSec: number; rmsHz: number; f0Hz: number; perAircraft: Array<{ icao: string; rmsHz: number; f0Hz: number }> } {
  const fields = pairs.map((p) => buildField(p.track, p.measured, grid, offsets, altCandidatesM, cMs));
  const joint = new Float64Array(grid.rows * grid.cols);
  for (const f of fields) {
    for (let i = 0; i < joint.length; i++) joint[i] += f.field[i];
  }
  const bi = argminField(joint);
  const row = Math.floor(bi / grid.cols);
  const col = bi % grid.cols;
  const lat = grid.lats[row];
  const lon = grid.lons[col];
  // per-aircraft RMS at the joint solution
  let bestOffset = 0;
  let jointRmsAtSolution = Infinity;
  for (const f of fields) {
    if (f.offsetSec !== offsets[0]) bestOffset = f.offsetSec;
  }
  // use the offset of the aircraft field whose best offset is most common
  const offsetCounts = new Map<number, number>();
  for (const f of fields) {
    offsetCounts.set(f.offsetSec, (offsetCounts.get(f.offsetSec) ?? 0) + 1);
  }
  bestOffset = [...offsetCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];

  const perAircraft = pairs.map((p, i) => {
    const shifted = p.measured.map((m) => ({ tSec: m.tSec + bestOffset, freqHz: m.freqHz }));
    let best = { rms: Infinity, f0: 0 };
    for (const altM of altCandidatesM) {
      const predicted = predictDopplerCurve(p.track, { lat, lon, altM }, 1, cMs);
      let sumFR = 0;
      let sumRR = 0;
      let used = 0;
      for (const m of shifted) {
        const ratio = sampleCurveAt(predicted, m.tSec);
        if (ratio === null) continue;
        sumFR += m.freqHz * ratio;
        sumRR += ratio * ratio;
        used++;
      }
      if (used < 8 || sumRR <= 0) continue;
      const f0 = sumFR / sumRR;
      let sse = 0;
      for (const m of shifted) {
        const ratio = sampleCurveAt(predicted, m.tSec);
        if (ratio === null) continue;
        const err = m.freqHz - f0 * ratio;
        sse += err * err;
      }
      const rms = Math.sqrt(sse / used);
      if (rms < best.rms) best = { rms, f0 };
    }
    return { icao: p.track.icao, rmsHz: best.rms, f0Hz: best.f0 };
  });
  const finite = perAircraft.filter((p) => Number.isFinite(p.rmsHz));
  jointRmsAtSolution = Math.sqrt(
    finite.reduce((s, p) => s + p.rmsHz * p.rmsHz, 0) / Math.max(1, finite.length)
  );
  return {
    lat,
    lon,
    offsetSec: bestOffset,
    rmsHz: jointRmsAtSolution,
    f0Hz: perAircraft[0]?.f0Hz ?? 0,
    perAircraft,
  };
}

/**
 * Joint fit of a recorder position from ONE aircraft's measured curve.
 * WARNING: a single straight-line pass has a mirror ambiguity about the
 * flight track — use fitRecorderPositionMulti when possible.
 */
export function fitRecorderPosition(
  track: AircraftTrack,
  measured: MeasuredSample[],
  opts: FitOptions
): PositionFit {
  const result = fitRecorderPositionMulti([{ track, measured }], opts);
  return result;
}

/**
 * Joint multi-aircraft fit: one shared candidate grid, each aircraft's RMS
 * field normalized by its own best cost, summed. Different flight headings
 * collapse the single-pass mirror ambiguity — this is the honest default.
 */
export function fitRecorderPositionMulti(
  pairs: Pair[],
  opts: FitOptions
): PositionFit {
  if (pairs.length === 0) throw new Error('no aircraft pairs to fit');
  const full = {
    radiusKm: opts.radiusKm,
    stepKm: opts.stepKm ?? 1,
    offsetWindowSec: opts.offsetWindowSec ?? 30,
    offsetStepSec: opts.offsetStepSec ?? 1,
    altCandidatesM: opts.altCandidatesM ?? [0, 10, 25, 50, 100],
    temperatureC: opts.temperatureC ?? 15,
  };
  const c = speedOfSound(full.temperatureC);
  const center =
    opts.center.lat === 0 && opts.center.lon === 0
      ? centroidOf(pairs.map((p) => p.track))
      : opts.center;
  const offsets: number[] = [];
  for (
    let o = -full.offsetWindowSec;
    o <= full.offsetWindowSec + 1e-9;
    o += full.offsetStepSec
  ) {
    offsets.push(Number(o.toFixed(3)));
  }

  // coarse pass
  const coarseGrid = squareGrid(center, full.radiusKm, full.stepKm);
  const coarse = evaluateJoint(pairs, coarseGrid, offsets, full.altCandidatesM, c);

  // Progressive refinement. Each stage tightens the spatial grid AND re-opens
  // the timeline-offset search around the previous best. The offset window per
  // stage scales with the stage's spatial radius: on a single straight pass,
  // along-track position and the timeline offset are jointly weakly
  // constrained (offset ≈ Δalong/v_ref), so a narrow offset window would
  // freeze the coarse grid's quantization into the final answer instead of
  // letting the fit walk down the degeneracy valley. Never searched beyond
  // the analyst's declared window.
  let current = coarse;
  const refineStages = [
    { radiusKm: full.stepKm * 1.5, stepKm: full.stepKm / 5 },
    { radiusKm: full.stepKm * 0.3, stepKm: Math.max(0.05, full.stepKm / 25) },
  ];
  for (const stage of refineStages) {
    const offsetSpread = Math.min(
      full.offsetWindowSec,
      Math.max(full.offsetStepSec, (stage.radiusKm * 1000) / 250)
    );
    const stageOffsets: number[] = [];
    for (
      let o = Math.max(-full.offsetWindowSec, current.offsetSec - offsetSpread);
      o <= Math.min(full.offsetWindowSec, current.offsetSec + offsetSpread) + 1e-9;
      o += Math.max(0.25, full.offsetStepSec / 4)
    ) {
      stageOffsets.push(Number(o.toFixed(3)));
    }
    current = evaluateJoint(
      pairs,
      squareGrid({ lat: current.lat, lon: current.lon }, stage.radiusKm, stage.stepKm),
      stageOffsets,
      full.altCandidatesM,
      c
    );
  }

  return {
    lat: current.lat,
    lon: current.lon,
    altM: 0,
    f0Hz: current.f0Hz,
    timeOffsetSec: current.offsetSec,
    rmsHz: current.rmsHz,
    samples: pairs.reduce((s, p) => s + p.measured.length, 0),
    icaos: pairs.map((p) => p.track.icao),
  };
}

/** Weighted centroid helper kept for UI summaries (1/RMS² weighting). */
export function combineFits(fits: PositionFit[]): PositionFit {
  const usable = fits.filter(
    (f) => Number.isFinite(f.rmsHz) && f.rmsHz > 0 && f.samples >= 8
  );
  if (usable.length === 0) throw new Error('no usable fits to combine');
  let wSum = 0;
  let lat = 0;
  let lon = 0;
  for (const f of usable) {
    const w = 1 / (f.rmsHz * f.rmsHz);
    wSum += w;
    lat += f.lat * w;
    lon += f.lon * w;
  }
  return {
    lat: lat / wSum,
    lon: lon / wSum,
    altM: 0,
    f0Hz: usable[0].f0Hz,
    timeOffsetSec: usable[0].timeOffsetSec,
    rmsHz: Math.sqrt(usable.reduce((s, f) => s + f.rmsHz * f.rmsHz, 0) / usable.length),
    samples: usable.reduce((s, f) => s + f.samples, 0),
    icaos: usable.flatMap((f) => f.icaos),
  };
}

export function trackCentroid(track: AircraftTrack): { lat: number; lon: number } {
  let lat = 0;
  let lon = 0;
  for (const p of track.points) {
    lat += p.lat;
    lon += p.lon;
  }
  const n = Math.max(1, track.points.length);
  return { lat: lat / n, lon: lon / n };
}

function centroidOf(tracks: AircraftTrack[]): { lat: number; lon: number } {
  const centroids = tracks.map(trackCentroid);
  return {
    lat: centroids.reduce((s, c) => s + c.lat, 0) / centroids.length,
    lon: centroids.reduce((s, c) => s + c.lon, 0) / centroids.length,
  };
}

// ---------------------------------------------------------------------------
// UI-session helpers: live sky-watch accumulation & curve curation
// ---------------------------------------------------------------------------

/**
 * Merges a fresh snapshot of per-aircraft single points (e.g. successive
 * adsb.lol polls during a live capture) into the accumulated track set.
 * Points are appended only when strictly newer than the track's last point
 * (poll clocks can jitter), and each track stays sorted by time. New
 * aircraft are appended as fresh tracks; a later snapshot's callsign is
 * adopted when the existing track has none.
 */
export function mergeTracks(
  existing: AircraftTrack[],
  incoming: AircraftTrack[]
): AircraftTrack[] {
  const byIcao = new Map<string, AircraftTrack>();
  for (const track of existing) byIcao.set(track.icao, { ...track, points: [...track.points] });
  for (const snap of incoming) {
    const current = byIcao.get(snap.icao);
    if (!current) {
      byIcao.set(snap.icao, { ...snap, points: [...snap.points] });
      continue;
    }
    if (!current.callsign && snap.callsign) current.callsign = snap.callsign;
    for (const point of snap.points) {
      const last = current.points[current.points.length - 1];
      if (last && point.tSec <= last.tSec) continue;
      current.points.push(point);
    }
    current.points.sort((a, b) => a.tSec - b.tSec);
  }
  return [...byIcao.values()];
}

/** A measured curve sample that also carries its spectral magnitude. */
export interface MagnitudeSample extends MeasuredSample {
  magnitude: number;
}

/**
 * Keeps only samples whose spectral magnitude clears `minFraction` of the
 * curve's strongest sample — drops silence/noise frames the peak tracker
 * would otherwise feed to the fit as fake data. Empty curves stay empty.
 */
export function filterCurveByMagnitude(
  curve: MagnitudeSample[],
  minFraction: number
): MagnitudeSample[] {
  if (curve.length === 0) return [];
  const maxMag = curve.reduce((m, s) => Math.max(m, s.magnitude), 0);
  if (maxMag <= 0) return [];
  return curve.filter((s) => s.magnitude >= minFraction * maxMag);
}

/**
 * Uniform stride decimation of a measured curve down to at most `maxHz`
 * samples per second — bounds the fit's cost without biasing it (stride
 * sampling preserves the sweep shape for quasi-stationary tones).
 */
export function decimateCurve<T extends MeasuredSample>(
  curve: T[],
  maxHz: number,
  sampleRateHintHz = 1 / Math.max(1e-6, (curve[1]?.tSec ?? curve[0]?.tSec ?? 0) - (curve[0]?.tSec ?? 0))
): T[] {
  if (curve.length <= 2) return curve;
  const spacingHz = 1 / Math.max(1e-6, sampleRateHintHz);
  if (spacingHz >= 1 / maxHz) return curve;
  const stride = Math.max(1, Math.floor(1 / (maxHz * spacingHz)));
  if (stride <= 1) return curve;
  return curve.filter((_, i) => i % stride === 0 || i === curve.length - 1);
}
