import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCameraFovCone,
  buildStreetLevelVerificationLinks,
  computePhotoFeatureBearing,
} from './cameraBearing';

describe('cameraBearing utilities', () => {
  it('computes exact center, left, and right bearings for rectilinear FOV', () => {
    assert.equal(computePhotoFeatureBearing(90, 60, 0.5), 90);
    assert.equal(computePhotoFeatureBearing(90, 60, 0), 60);
    assert.equal(computePhotoFeatureBearing(90, 60, 1), 120);
    // Wrap around North (0 deg)
    assert.equal(computePhotoFeatureBearing(10, 60, 0), 340);
  });

  it('projects FOV cone and feature rays onto WGS84 coordinates', () => {
    const cone = buildCameraFovCone(
      51.5074,
      -0.1278,
      180,
      70,
      [
        {
          id: 'p1',
          label: 'Tower #1',
          xRatio: 0.25,
          yRatio: 0.4,
          computedBearingDeg: 0,
          color: '#FF6B2C',
        },
      ],
      2.0
    );
    assert.equal(cone.leftBearingDeg, 145);
    assert.equal(cone.rightBearingDeg, 215);
    assert.equal(cone.featureRays.length, 1);
    assert.ok(cone.featureRays[0].bearingDeg > 145 && cone.featureRays[0].bearingDeg < 180);
  });

  it('builds Mapillary, Panoramax, and Street View links with heading', () => {
    const links = buildStreetLevelVerificationLinks(48.8584, 2.2945, 275);
    assert.equal(links.length, 3);
    assert.ok(links[0].url.includes('mapillary.com'));
    assert.ok(links[2].url.includes('heading=275'));
  });
});
