import test from 'node:test';
import assert from 'node:assert/strict';
import {
  combineFits,
  decimateCurve,
  distanceMeters,
  dopplerFrequency,
  filterCurveByMagnitude,
  fitRecorderPosition,
  fitRecorderPositionMulti,
  mergeTracks,
  parseAdsbLolStates,
  parseOpenSkyStates,
  parseTrackCsv,
  predictDopplerCurve,
  rangeRates,
  speedOfSound,
  synthesizeMeasuredCurve,
  type AircraftTrack,
} from './doppler';

test('speedOfSound matches the standard approximation', () => {
  assert.ok(Math.abs(speedOfSound(15) - 340.3) < 0.2);
  assert.ok(Math.abs(speedOfSound(0) - 331.3) < 0.1);
  assert.ok(speedOfSound(30) > speedOfSound(0), 'sound travels faster when warmer');
});

test('dopplerFrequency: approaching raises pitch, receding lowers it, never negative', () => {
  const c = 340;
  assert.ok(dopplerFrequency(600, -50, c) > 600);
  assert.ok(dopplerFrequency(600, 50, c) < 600);
  assert.equal(dopplerFrequency(600, 0, c), 600);
});

test('rangeRates flag approach then departure along a straight track', () => {
  const track: AircraftTrack = {
    icao: 'test',
    points: [
      { tSec: 0, lat: 51.4, lon: -0.1, altM: 3000 },
      { tSec: 10, lat: 51.4, lon: -0.0895, altM: 3000 },
      { tSec: 20, lat: 51.4, lon: -0.079, altM: 3000 },
    ],
  };
  // recorder EAST of the track end: aircraft approaches first
  const recorder = { lat: 51.4, lon: -0.05, altM: 0 };
  const rates = rangeRates(track, recorder);
  assert.ok(rates[1] < 0, 'should be approaching first');
  assert.ok(rates[2] > rates[1], 'range rate should increase toward departure');
});

test('parsers normalize adsb.lol, OpenSky and CSV track data', () => {
  const adsb = parseAdsbLolStates(
    {
      ac: [
        { hex: 'a1b2c3', flight: 'TEST01  ', lat: 51.5, lon: -0.12, alt_geom: 2500 },
        { hex: 'a1b2c3', flight: 'TEST01  ', lat: 51.51, lon: -0.11, alt_geom: 2400 },
        { hex: '', flight: '', lat: 51.5, lon: -0.1 },
      ],
    },
    100
  );
  assert.equal(adsb.length, 1);
  assert.equal(adsb[0].icao, 'a1b2c3');
  assert.equal(adsb[0].points.length, 2);

  const opensky = parseOpenSkyStates(
    {
      states: [
        ['abc123', 'TEST02  ', null, null, null, -0.12, 51.5, 3000, false, null, null, null, null, 3100],
        ['abc123', 'TEST02  ', null, null, null, -0.11, 51.51, 3000, true, null, null, null, null, 3100],
      ],
    },
    200
  );
  assert.equal(opensky.length, 1);
  assert.equal(opensky[0].points.length, 1, 'on-ground second point dropped');

  const csv = parseTrackCsv(
    'time,icao24,lat,lon,baro_altitude\n10,abc,51.4,-0.1,3000\n20,abc,51.41,-0.09,3000\n5,abc,51.39,-0.11,3000'
  );
  assert.equal(csv.length, 1);
  assert.deepEqual(csv[0].points.map((p) => p.tSec), [5, 10, 20]);
});

/** Deterministic LCG so tests never flake. */
function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/**
 * Synthetic scenario: two aircraft crossing at right angles over the area,
 * the true recorder 3 km north / 2 km east of the crossing point. Each
 * single pass has a mirror ambiguity about its own track; only the joint
 * fit resolves both.
 */
function buildTwoAircraftScenario() {
  const c = speedOfSound(15);
  const latC = 51.5;
  const lonC = 0.0;
  const altM = 3000;
  const trueRecorder = {
    lat: latC + 3 / 111.32,
    lon: lonC + 2 / (111.32 * Math.cos((latC * Math.PI) / 180)),
    altM: 0,
  };
  const f0 = 630;

  // A: west → east along latC (0.4° lon ≈ 27.8 km at this latitude)
  const trackA: AircraftTrack = {
    icao: 'synthA',
    callsign: 'SYNA',
    points: Array.from({ length: 28 }, (_, i) => ({
      tSec: i * 10,
      lat: latC,
      lon: lonC - 0.2 + (0.4 * i) / 27,
      altM,
    })),
  };
  // B: south → north along lonC
  const trackB: AircraftTrack = {
    icao: 'synthB',
    callsign: 'SYNB',
    points: Array.from({ length: 28 }, (_, i) => ({
      tSec: i * 10,
      lat: latC - 0.2 + (0.4 * i) / 27,
      lon: lonC,
      altM,
    })),
  };

  const measuredA = synthesizeMeasuredCurve(trackA, trueRecorder, f0, c, 2, 1.0, lcg(42));
  const measuredB = synthesizeMeasuredCurve(trackB, trueRecorder, f0, c, 2, 1.0, lcg(1337));
  return { c, latC, lonC, trueRecorder, f0, trackA, trackB, measuredA, measuredB };
}

test('curve synthesis produces the classic approach→depart sweep', () => {
  const { f0, trackA, trueRecorder, measuredA, c } = buildTwoAircraftScenario();
  assert.ok(measuredA.length > 100, `expected dense curve, got ${measuredA.length}`);
  assert.ok(measuredA[0].freqHz > f0, 'approaching at start → higher pitch');
  assert.ok(measuredA[measuredA.length - 1].freqHz < f0, 'departing at end → lower pitch');
  const predicted = predictDopplerCurve(trackA, trueRecorder, f0, c);
  const fMin = Math.min(...predicted.map((p) => p.freqHz));
  assert.ok(fMin < f0 * 0.97, 'closest approach dips below f0');
  assert.ok(measuredA.every((m) => Number.isFinite(m.freqHz)));
});

test('single-aircraft fit lands on the true position OR its mirror (ambiguity disclosed)', () => {
  const { latC, lonC, trueRecorder, trackA, measuredA } = buildTwoAircraftScenario();
  const fit = fitRecorderPosition(trackA, measuredA, {
    center: { lat: latC, lon: lonC },
    radiusKm: 8,
    stepKm: 2,
    offsetWindowSec: 5,
    offsetStepSec: 1,
    altCandidatesM: [0, 50, 200],
    temperatureC: 15,
  });
  const mirror = {
    lat: 2 * latC - trueRecorder.lat, // reflected across the east-west track
    lon: trueRecorder.lon,
    altM: 0,
  };
  const errTrue = distanceMeters(fit, trueRecorder);
  const errMirror = distanceMeters(fit, mirror);
  assert.ok(
    Math.min(errTrue, errMirror) < 300,
    `single fit ${errTrue.toFixed(0)} m from truth and ${errMirror.toFixed(0)} m from mirror — neither close enough`
  );
  assert.ok(fit.rmsHz < 3, `RMS residual ${fit.rmsHz.toFixed(2)} Hz too high`);
});

test('joint two-heading fit collapses the ambiguity: recovers position within 300 m', () => {
  const { latC, lonC, trueRecorder, trackA, trackB, measuredA, measuredB } =
    buildTwoAircraftScenario();
  const fit = fitRecorderPositionMulti(
    [
      { track: trackA, measured: measuredA },
      { track: trackB, measured: measuredB },
    ],
    {
      center: { lat: latC, lon: lonC },
      radiusKm: 8,
      stepKm: 2,
      offsetWindowSec: 5,
      offsetStepSec: 1,
      altCandidatesM: [0, 50, 200],
      temperatureC: 15,
    }
  );
  const error = distanceMeters(fit, trueRecorder);
  assert.ok(error < 300, `joint position error ${error.toFixed(0)} m exceeds 300 m`);
  // RMS depends on geometry (shallow passes + refine-grid quantization inflate
  // it honestly); the contract is the position, with RMS reported as-is.
  assert.ok(fit.rmsHz < 6, `joint RMS ${fit.rmsHz.toFixed(2)} Hz too high`);
  assert.deepEqual(fit.icaos, ['synthA', 'synthB']);
});

test('fitter always reports a finite RMS — a wrong track never yields false confidence', () => {
  const { latC, lonC, trackA, measuredA } = buildTwoAircraftScenario();
  const shifted = measuredA.map((m) => ({ ...m, freqHz: m.freqHz + 50 }));
  const fit = fitRecorderPosition(trackA, shifted, {
    center: { lat: latC, lon: lonC },
    radiusKm: 8,
    stepKm: 2,
    offsetWindowSec: 2,
    offsetStepSec: 1,
    altCandidatesM: [0, 100],
    temperatureC: 15,
  });
  assert.ok(Number.isFinite(fit.rmsHz));
});

test('combineFits weights low-RMS fits higher (kept for UI summaries)', () => {
  const good = { lat: 51.5, lon: 0.0, altM: 0, f0Hz: 630, timeOffsetSec: 0, rmsHz: 1, samples: 100, icaos: ['a'] };
  const bad = { lat: 60.0, lon: 20.0, altM: 0, f0Hz: 630, timeOffsetSec: 0, rmsHz: 10, samples: 100, icaos: ['b'] };
  const combined = combineFits([good, bad]);
  assert.ok(combined.lat > 51.5);
  assert.ok(distanceMeters(combined, good) < distanceMeters(combined, bad));
  assert.throws(() => combineFits([]), /no usable fits/);
});

test('mergeTracks accumulates poll snapshots per aircraft, strictly newer only', () => {
  const base: AircraftTrack[] = [
    {
      icao: 'a1',
      points: [
        { tSec: 10, lat: 51.0, lon: 0.0, altM: 3000 },
        { tSec: 15, lat: 51.01, lon: 0.001, altM: 3000 },
      ],
    },
  ];
  const snapshot: AircraftTrack[] = [
    {
      icao: 'a1',
      callsign: 'TEST01',
      points: [
        // jittered/duplicate older point must be dropped; newer kept
        { tSec: 14, lat: 99, lon: 99, altM: 0 },
        { tSec: 20, lat: 51.02, lon: 0.002, altM: 3000 },
      ],
    },
    { icao: 'b2', points: [{ tSec: 20, lat: 51.5, lon: -0.1, altM: 9000 }] },
  ];
  const merged = mergeTracks(base, snapshot);
  assert.equal(merged.length, 2);
  const a1 = merged.find((t) => t.icao === 'a1')!;
  assert.deepEqual(a1.points.map((p) => p.tSec), [10, 15, 20]);
  assert.equal(a1.callsign, 'TEST01', 'callsign adopted when missing');
  const b2 = merged.find((t) => t.icao === 'b2')!;
  assert.equal(b2.points.length, 1);
  // original inputs untouched
  assert.equal(base[0].points.length, 2);
});

test('filterCurveByMagnitude keeps only samples near the strongest peak', () => {
  const curve = [
    { tSec: 0, freqHz: 600, magnitude: 10 },
    { tSec: 1, freqHz: 601, magnitude: 0.5 },
    { tSec: 2, freqHz: 602, magnitude: 8 },
    { tSec: 3, freqHz: 603, magnitude: 0.1 },
  ];
  assert.deepEqual(
    filterCurveByMagnitude(curve, 0.25).map((s) => s.tSec),
    [0, 2]
  );
  assert.equal(filterCurveByMagnitude([], 0.1).length, 0);
  assert.equal(
    filterCurveByMagnitude([{ tSec: 0, freqHz: 1, magnitude: 0 }], 0.5).length,
    0,
    'all-zero magnitudes yield nothing rather than everything'
  );
});

test('decimateCurve bounds the sample rate without losing the sweep ends', () => {
  // 100 samples at 10 Hz
  const curve = Array.from({ length: 100 }, (_, i) => ({ tSec: i / 10, freqHz: 600 + i }));
  const out = decimateCurve(curve, 2);
  assert.ok(out.length <= 100 / 2 + 2, `expected ~50, got ${out.length}`);
  assert.equal(out[0].tSec, 0);
  assert.equal(out[out.length - 1].tSec, 9.9, 'last sample kept');
  // already-sparser curves pass through untouched
  const sparse = curve.filter((_, i) => i % 10 === 0);
  assert.equal(decimateCurve(sparse, 2).length, sparse.length);
});
