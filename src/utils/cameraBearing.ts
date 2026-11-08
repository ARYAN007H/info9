import type { CameraFeaturePin } from '../types/osint';
import { projectBearingCoordinate } from './solarMath';

export interface CameraRayGeometry {
  pinId: string;
  label: string;
  bearingDeg: number;
  color: string;
  endCoord: [number, number];
}

export interface CameraFovCone {
  centerBearingDeg: number;
  fovDeg: number;
  leftBearingDeg: number;
  rightBearingDeg: number;
  leftEdgeCoord: [number, number];
  rightEdgeCoord: [number, number];
  centerRayCoord: [number, number];
  featureRays: CameraRayGeometry[];
}

/**
 * Normalizes any angle to [0, 360).
 */
export function normalizeAzimuth(deg: number): number {
  return Number((((deg % 360) + 360) % 360).toFixed(2));
}

/**
 * Computes the compass bearing of a horizontal pixel coordinate (`xRatio` in [0, 1])
 * inside a photo given the camera's center compass azimuth and horizontal FOV.
 * Uses rectilinear pinhole tangent projection:
 *   offsetDeg = atan((2 * xRatio - 1) * tan(fovRad / 2)) * (180 / pi)
 */
export function computePhotoFeatureBearing(
  centerAzimuthDeg: number,
  horizontalFovDeg: number,
  xRatio: number
): number {
  const clampedX = Math.max(0, Math.min(1, xRatio));
  const clampedFov = Math.max(10, Math.min(150, horizontalFovDeg));
  const halfFovRad = ((clampedFov / 2) * Math.PI) / 180;
  const normalizedX = 2 * clampedX - 1; // -1 at left edge, 0 at center, +1 at right edge
  const offsetRad = Math.atan(normalizedX * Math.tan(halfFovRad));
  const offsetDeg = (offsetRad * 180) / Math.PI;
  return normalizeAzimuth(centerAzimuthDeg + offsetDeg);
}

/**
 * Projects the camera FOV cone and any clicked photo feature bearing rays
 * outward from `(lat, lon)` to `rangeKm` on the map.
 */
export function buildCameraFovCone(
  lat: number,
  lon: number,
  centerAzimuthDeg: number,
  horizontalFovDeg: number,
  pins: CameraFeaturePin[],
  rangeKm = 1.8
): CameraFovCone {
  const leftBearingDeg = normalizeAzimuth(centerAzimuthDeg - horizontalFovDeg / 2);
  const rightBearingDeg = normalizeAzimuth(centerAzimuthDeg + horizontalFovDeg / 2);
  const centerNorm = normalizeAzimuth(centerAzimuthDeg);

  const leftEdgeCoord = projectBearingCoordinate(lat, lon, leftBearingDeg, rangeKm);
  const rightEdgeCoord = projectBearingCoordinate(lat, lon, rightBearingDeg, rangeKm);
  const centerRayCoord = projectBearingCoordinate(lat, lon, centerNorm, rangeKm);

  const featureRays: CameraRayGeometry[] = pins.map((pin) => {
    const bearingDeg = computePhotoFeatureBearing(
      centerAzimuthDeg,
      horizontalFovDeg,
      pin.xRatio
    );
    return {
      pinId: pin.id,
      label: pin.label,
      bearingDeg,
      color: pin.color,
      endCoord: projectBearingCoordinate(lat, lon, bearingDeg, rangeKm),
    };
  });

  return {
    centerBearingDeg: centerNorm,
    fovDeg: horizontalFovDeg,
    leftBearingDeg,
    rightBearingDeg,
    leftEdgeCoord,
    rightEdgeCoord,
    centerRayCoord,
    featureRays,
  };
}

/**
 * Builds zero-key street-level & satellite verification deep links for a coordinate and bearing.
 */
export function buildStreetLevelVerificationLinks(
  lat: number,
  lon: number,
  bearingDeg: number
): Array<{ id: string; label: string; url: string }> {
  const latStr = lat.toFixed(6);
  const lonStr = lon.toFixed(6);
  const hdg = Math.round(normalizeAzimuth(bearingDeg));
  return [
    {
      id: 'mapillary',
      label: 'Mapillary street photos',
      url: `https://www.mapillary.com/app/?lat=${latStr}&lng=${lonStr}&z=17`,
    },
    {
      id: 'panoramax',
      label: 'Panoramax open street view',
      url: `https://api.panoramax.xyz/#focus=map&map=17/${latStr}/${lonStr}`,
    },
    {
      id: 'streetview',
      label: `Google Street View (${hdg}°)`,
      url: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${latStr},${lonStr}&heading=${hdg}&pitch=0&fov=80`,
    },
  ];
}
