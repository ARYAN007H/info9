import type { OverpassConstraintClause } from '../types/osint';

export interface SolarPositionResult {
  elevationDeg: number;
  azimuthDeg: number;
  shadowAzimuthDeg: number;
  declinationDeg: number;
  equationOfTimeMin: number;
  solarNoonUtcHours: number;
  isDaylight: boolean;
}

export interface ChronolocationCandidateWindow {
  utcTimeFormatted: string;
  utcHoursDecimal: number;
  localSolarTimeFormatted: string;
  predictedElevationDeg: number;
  predictedShadowAzimuthDeg: number;
  angularErrorDeg: number;
  confidencePercent: number;
}

export interface DiurnalSolarPoint {
  utcHour: number;
  label: string;
  elevationDeg: number;
  azimuthDeg: number;
  shadowAzimuthDeg: number;
}

export interface BlindGeolocationCandidate {
  lat: number;
  lon: number;
  predictedElevationDeg: number;
  predictedShadowAzimuthDeg: number;
  residualErrorDeg: number;
  confidencePercent: number;
  regionHint: string;
}

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/**
 * Calculates solar elevation angle (altitude) from vertical object height and horizontal shadow length.
 * Formula: alpha = arctan(H / L)
 */
export function calculateShadowElevation(
  objectHeightMeters: number,
  shadowLengthMeters: number
): {
  elevationDeg: number;
  ratio: number;
  uncertaintyDeg: number;
} {
  if (objectHeightMeters <= 0 || shadowLengthMeters < 0) {
    return { elevationDeg: 0, ratio: 0, uncertaintyDeg: 0 };
  }
  if (shadowLengthMeters === 0) {
    return { elevationDeg: 90, ratio: Infinity, uncertaintyDeg: 0.5 };
  }
  const ratio = objectHeightMeters / shadowLengthMeters;
  const elevationDeg = Number((Math.atan(ratio) * RAD_TO_DEG).toFixed(2));
  const relError = 0.025;
  const dRatio = ratio * relError;
  const uncertaintyDeg = Number(
    (Math.abs(dRatio / (1 + ratio * ratio)) * RAD_TO_DEG).toFixed(2)
  );
  return {
    elevationDeg,
    ratio: Number(ratio.toFixed(4)),
    uncertaintyDeg: Math.max(0.2, uncertaintyDeg),
  };
}

/**
 * Computes exact NOAA solar position (elevation, azimuth, shadow bearing, declination, EoT)
 * for any latitude, longitude, and UTC Date.
 */
export function calculateSolarPosition(
  latDeg: number,
  lonDeg: number,
  dateUtc: Date
): SolarPositionResult {
  const year = dateUtc.getUTCFullYear();
  const startOfYear = Date.UTC(year, 0, 1, 0, 0, 0);
  const diffMs = dateUtc.getTime() - startOfYear;
  const dayOfYear = Math.floor(diffMs / 86400000) + 1;

  const utcHours =
    dateUtc.getUTCHours() +
    dateUtc.getUTCMinutes() / 60 +
    dateUtc.getUTCSeconds() / 3600;

  const gamma =
    ((2 * Math.PI) / 365.25) * (dayOfYear - 1 + (utcHours - 12) / 24);

  const eqTimeMin =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));

  const declRad =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  const declDeg = declRad * RAD_TO_DEG;

  const timeOffsetMin = eqTimeMin + 4 * lonDeg;
  const trueSolarTimeMin = ((utcHours * 60 + timeOffsetMin) % 1440 + 1440) % 1440;

  const hourAngleDeg = trueSolarTimeMin / 4 - 180;
  const hourAngleRad = hourAngleDeg * DEG_TO_RAD;
  const latRad = latDeg * DEG_TO_RAD;

  const sinElevation =
    Math.sin(latRad) * Math.sin(declRad) +
    Math.cos(latRad) * Math.cos(declRad) * Math.cos(hourAngleRad);
  const clampedSinEl = Math.max(-1, Math.min(1, sinElevation));
  const elevationRad = Math.asin(clampedSinEl);
  const zenithRad = Math.PI / 2 - elevationRad;

  const rawElevationDeg = elevationRad * RAD_TO_DEG;
  let refractionCorrectionDeg = 0;
  if (rawElevationDeg > 85) {
    refractionCorrectionDeg = 0;
  } else if (rawElevationDeg > 5) {
    const tanEl = Math.tan(elevationRad);
    refractionCorrectionDeg =
      (58.1 / tanEl -
        0.07 / Math.pow(tanEl, 3) +
        0.000086 / Math.pow(tanEl, 5)) /
      3600;
  } else if (rawElevationDeg > -0.575) {
    refractionCorrectionDeg =
      (1735 +
        rawElevationDeg *
          (-518.2 +
            rawElevationDeg *
              (103.4 + rawElevationDeg * (-12.79 + rawElevationDeg * 0.711)))) /
      3600;
  }
  const elevationDeg = Number((rawElevationDeg + refractionCorrectionDeg).toFixed(2));

  const denom = Math.cos(latRad) * Math.sin(zenithRad);
  let azimuthDeg = 180;
  if (Math.abs(denom) > 1e-6) {
    const cosAz =
      (Math.sin(declRad) - Math.sin(latRad) * Math.cos(zenithRad)) / denom;
    const clampedCosAz = Math.max(-1, Math.min(1, cosAz));
    const acosDeg = Math.acos(clampedCosAz) * RAD_TO_DEG;
    azimuthDeg = hourAngleDeg > 0 ? (360 - acosDeg) % 360 : acosDeg;
  }

  const normalizedAzimuth = Number(((azimuthDeg + 360) % 360).toFixed(2));
  const shadowAzimuthDeg = Number(((normalizedAzimuth + 180) % 360).toFixed(2));
  const solarNoonUtcHours = Number(
    (((720 - 4 * lonDeg - eqTimeMin) / 60 + 24) % 24).toFixed(2)
  );

  return {
    elevationDeg,
    azimuthDeg: normalizedAzimuth,
    shadowAzimuthDeg,
    declinationDeg: Number(declDeg.toFixed(2)),
    equationOfTimeMin: Number(eqTimeMin.toFixed(2)),
    solarNoonUtcHours,
    isDaylight: elevationDeg > -0.833,
  };
}

/**
 * Computes smallest angular difference between two compass bearings (0-180 deg)
 */
export function angularDifferenceDeg(angleA: number, angleB: number): number {
  const diff = Math.abs(((angleA - angleB) % 360 + 540) % 360 - 180);
  return Number(diff.toFixed(2));
}

/**
 * Sweeps the 24-hour UTC period on `dateIso` (YYYY-MM-DD) for a target (lat, lon)
 * to find exact chronolocation time windows matching measured shadow elevation and shadow azimuth.
 */
export function solveChronolocationTimeWindow(
  latDeg: number,
  lonDeg: number,
  dateIso: string,
  measuredElevationDeg: number,
  measuredShadowAzimuthDeg: number | null,
  toleranceDeg = 8
): {
  bestMatches: ChronolocationCandidateWindow[];
  diurnalCurve: DiurnalSolarPoint[];
  maxElevationDeg: number;
} {
  const baseDateParts = dateIso.split('-').map(Number);
  const year = baseDateParts[0] || 2026;
  const month = (baseDateParts[1] || 1) - 1;
  const day = baseDateParts[2] || 1;

  const diurnalCurve: DiurnalSolarPoint[] = [];
  let maxElevationDeg = -90;

  for (let minutes = 0; minutes < 1440; minutes += 30) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const d = new Date(Date.UTC(year, month, day, h, m, 0));
    const pos = calculateSolarPosition(latDeg, lonDeg, d);
    if (pos.elevationDeg > maxElevationDeg) {
      maxElevationDeg = pos.elevationDeg;
    }
    diurnalCurve.push({
      utcHour: Number((minutes / 60).toFixed(2)),
      label: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} UTC`,
      elevationDeg: pos.elevationDeg,
      azimuthDeg: pos.azimuthDeg,
      shadowAzimuthDeg: pos.shadowAzimuthDeg,
    });
  }

  const rawCandidates: ChronolocationCandidateWindow[] = [];
  for (let minutes = 0; minutes < 1440; minutes += 2) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const d = new Date(Date.UTC(year, month, day, h, m, 0));
    const pos = calculateSolarPosition(latDeg, lonDeg, d);
    if (!pos.isDaylight) continue;

    const elError = Math.abs(pos.elevationDeg - measuredElevationDeg);
    const azError =
      measuredShadowAzimuthDeg !== null
        ? angularDifferenceDeg(pos.shadowAzimuthDeg, measuredShadowAzimuthDeg)
        : 0;

    const combinedError =
      measuredShadowAzimuthDeg !== null
        ? Math.sqrt(elError * elError + Math.pow(azError * 0.65, 2))
        : elError;

    if (combinedError <= toleranceDeg) {
      const localSolarMinutes =
        ((minutes + pos.equationOfTimeMin + 4 * lonDeg) % 1440 + 1440) % 1440;
      const lh = Math.floor(localSolarMinutes / 60);
      const lm = Math.round(localSolarMinutes % 60);
      const confidencePercent = Math.max(
        5,
        Math.min(99.4, Number((100 - (combinedError / toleranceDeg) * 45).toFixed(1)))
      );

      rawCandidates.push({
        utcTimeFormatted: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} UTC`,
        utcHoursDecimal: Number((minutes / 60).toFixed(3)),
        localSolarTimeFormatted: `${String(lh).padStart(2, '0')}:${String(
          lm % 60
        ).padStart(2, '0')} LST`,
        predictedElevationDeg: pos.elevationDeg,
        predictedShadowAzimuthDeg: pos.shadowAzimuthDeg,
        angularErrorDeg: Number(combinedError.toFixed(2)),
        confidencePercent,
      });
    }
  }

  rawCandidates.sort((a, b) => a.angularErrorDeg - b.angularErrorDeg);
  const bestMatches: ChronolocationCandidateWindow[] = [];
  for (const cand of rawCandidates) {
    const tooClose = bestMatches.some(
      (existing) => Math.abs(existing.utcHoursDecimal - cand.utcHoursDecimal) < 0.75
    );
    if (!tooClose) {
      bestMatches.push(cand);
    }
    if (bestMatches.length >= 4) break;
  }

  return {
    bestMatches,
    diurnalCurve,
    maxElevationDeg: Number(maxElevationDeg.toFixed(2)),
  };
}

/**
 * Inverse Blind Solar Geolocation Solver:
 * Given a known UTC Date + UTC Time + Measured Solar Elevation + Measured Shadow Azimuth,
 * solves for the exact geographic (lat, lon) on Earth where the sun matches those angles!
 */
export function solveBlindSolarCoordinates(
  dateIso: string,
  utcHourDecimal: number,
  measuredElevationDeg: number,
  measuredShadowAzimuthDeg: number
): BlindGeolocationCandidate[] {
  const parts = dateIso.split('-').map(Number);
  const year = parts[0] || 2026;
  const month = (parts[1] || 1) - 1;
  const day = parts[2] || 1;
  const hours = Math.floor(utcHourDecimal);
  const minutes = Math.round((utcHourDecimal - hours) * 60);
  const targetDate = new Date(Date.UTC(year, month, day, hours, minutes, 0));

  // Coarse 4-degree global grid search followed by fine 0.25-degree local refinement
  let bestCoarse: Array<{ lat: number; lon: number; err: number }> = [];
  for (let lat = -64; lat <= 72; lat += 4) {
    for (let lon = -180; lon < 180; lon += 4) {
      const pos = calculateSolarPosition(lat, lon, targetDate);
      if (!pos.isDaylight) continue;
      const elErr = Math.abs(pos.elevationDeg - measuredElevationDeg);
      const azErr = angularDifferenceDeg(
        pos.shadowAzimuthDeg,
        measuredShadowAzimuthDeg
      );
      const err = Math.sqrt(elErr * elErr + azErr * azErr);
      if (err < 18) {
        bestCoarse.push({ lat, lon, err });
      }
    }
  }

  bestCoarse.sort((a, b) => a.err - b.err);
  bestCoarse = bestCoarse.slice(0, 6);

  const refined: BlindGeolocationCandidate[] = [];
  for (const seed of bestCoarse) {
    let bestLat = seed.lat;
    let bestLon = seed.lon;
    let minErr = seed.err;
    let bestEl = 0;
    let bestShAz = 0;

    for (let dLat = -3.5; dLat <= 3.5; dLat += 0.25) {
      for (let dLon = -3.5; dLon <= 3.5; dLon += 0.25) {
        const candLat = Math.max(-85, Math.min(85, seed.lat + dLat));
        const candLon = ((seed.lon + dLon + 540) % 360) - 180;
        const pos = calculateSolarPosition(candLat, candLon, targetDate);
        const elErr = Math.abs(pos.elevationDeg - measuredElevationDeg);
        const azErr = angularDifferenceDeg(
          pos.shadowAzimuthDeg,
          measuredShadowAzimuthDeg
        );
        const err = Math.sqrt(elErr * elErr + azErr * azErr);
        if (err < minErr) {
          minErr = err;
          bestLat = candLat;
          bestLon = candLon;
          bestEl = pos.elevationDeg;
          bestShAz = pos.shadowAzimuthDeg;
        }
      }
    }

    const duplicate = refined.some(
      (r) => Math.hypot(r.lat - bestLat, r.lon - bestLon) < 3.0
    );
    if (!duplicate && minErr <= 8.0) {
      const regionHint =
        bestLat > 48 && bestLon > 10 && bestLon < 40
          ? 'Northern / Eastern Europe & Baltic Basin'
          : bestLat > 35 && bestLon >= -10 && bestLon <= 45
          ? 'Mediterranean / Central & Balkan Europe'
          : bestLat > 15 && bestLon > 40 && bestLon < 145
          ? 'Asia-Pacific / Middle East Corridor'
          : bestLat > 20 && bestLon < -50
          ? 'North America / Atlantic Sector'
          : 'Global Maritime / Continental Sector';

      refined.push({
        lat: Number(bestLat.toFixed(4)),
        lon: Number(bestLon.toFixed(4)),
        predictedElevationDeg: bestEl,
        predictedShadowAzimuthDeg: bestShAz,
        residualErrorDeg: Number(minErr.toFixed(2)),
        confidencePercent: Number(
          Math.max(10, Math.min(99.5, 100 - minErr * 9.5)).toFixed(1)
        ),
        regionHint,
      });
    }
  }

  refined.sort((a, b) => a.residualErrorDeg - b.residualErrorDeg);
  return refined.slice(0, 3);
}

/**
 * Compiles a Bellingcat-style Multi-Clause Overpass QL Spatial Intersection query
 * that finds features matching Clause 1 which also lie within `maxDistanceMeters` of Clause 2, etc.
 */
export function buildOverpassIntersectionQuery(
  clauses: OverpassConstraintClause[],
  centerLat: number,
  centerLon: number,
  searchRadiusMeters = 5000
): string {
  const tagMap: Record<OverpassConstraintClause['featureType'], string> = {
    power_substation: '["power"="substation"]',
    power_tower: '["power"="tower"]',
    storage_tank: '["man_made"="storage_tank"]',
    railway_crossing: '["railway"="level_crossing"]',
    port_crane: '["man_made"="crane"]',
    communications_tower: '["man_made"="communications_tower"]',
    waterway_dock: '["waterway"~"dock|canal"]',
  };

  if (clauses.length === 0) {
    return `[out:json][timeout:12];node["power"="substation"](around:${searchRadiusMeters},${centerLat},${centerLon});out center 20;`;
  }

  const lines: string[] = [`[out:json][timeout:12];`];
  const firstTag = tagMap[clauses[0].featureType] || '["power"="substation"]';
  lines.push(
    `(node${firstTag}(around:${searchRadiusMeters},${centerLat},${centerLon});way${firstTag}(around:${searchRadiusMeters},${centerLat},${centerLon});)->.set0;`
  );

  for (let i = 1; i < clauses.length; i++) {
    const clause = clauses[i];
    const selector = tagMap[clause.featureType] || '["man_made"]';
    const prevSet = `.set${i - 1}`;
    const currSet = `.set${i}`;
    lines.push(
      `(node${selector}(around${prevSet}:${clause.maxDistanceMeters});way${selector}(around${prevSet}:${clause.maxDistanceMeters});)->${currSet};`
    );
  }

  const finalSet = `.set${clauses.length - 1}`;
  lines.push(`${finalSet} out center 25;`);
  return lines.join('\n');
}

/**
 * Great-circle Haversine distance in kilometers between two coordinates.
 */
export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * DEG_TO_RAD) *
      Math.cos(lat2 * DEG_TO_RAD) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(3));
}

/**
 * Projects a destination coordinate from a start point given compass bearing (deg) and distance (km).
 */
export function projectBearingCoordinate(
  latDeg: number,
  lonDeg: number,
  bearingDeg: number,
  distanceKm: number
): [number, number] {
  const R = 6371;
  const angularDist = distanceKm / R;
  const brng = bearingDeg * DEG_TO_RAD;
  const lat1 = latDeg * DEG_TO_RAD;
  const lon1 = lonDeg * DEG_TO_RAD;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDist) +
      Math.cos(lat1) * Math.sin(angularDist) * Math.cos(brng)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(angularDist) * Math.cos(lat1),
      Math.cos(angularDist) - Math.sin(lat1) * Math.sin(lat2)
    );

  return [
    Number((lat2 * RAD_TO_DEG).toFixed(6)),
    Number((lon2 * RAD_TO_DEG).toFixed(6)),
  ];
}
