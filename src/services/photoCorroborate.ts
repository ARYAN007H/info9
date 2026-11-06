import { dHashSimilarityPercent, grayscaleToDHash } from '../utils/imageHash';
import { searchCommonsGeolocatedPhotos } from './osintApis';
import type { CommonsGeoPhoto } from '../types/osint';

/**
 * Browser-side perceptual hash helpers for zero-key photo corroboration.
 * Wikimedia's upload.wikimedia.org sends permissive CORS headers, so
 * thumbnails can be drawn to a canvas and hashed without any server round-trip.
 */

function drawToGrayscaleGrid(img: HTMLImageElement): number[] {
  const W = 9;
  const H = 8;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(img, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H).data;
  const gray: number[] = [];
  for (let i = 0; i < W * H; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    gray.push(Math.round(0.299 * r + 0.587 * g + 0.114 * b));
  }
  return gray;
}

function loadImage(url: string, crossOrigin: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load image for hashing: ${url}`));
    img.src = url;
  });
}

export async function dHashFromImageUrl(
  url: string,
  crossOrigin = false
): Promise<string> {
  const img = await loadImage(url, crossOrigin);
  return grayscaleToDHash(drawToGrayscaleGrid(img));
}

export interface CommonsCorroborationMatch {
  photo: CommonsGeoPhoto;
  similarityPercent: number;
}

export interface CommonsCorroborationResult {
  queryHash: string;
  candidatesExamined: number;
  matches: CommonsCorroborationMatch[];
}

/**
 * Automated, zero-key, no-redirect geolocation corroboration:
 * hash the uploaded photo, search Commons for keyword-matched geolocated
 * photos, hash their thumbnails, and rank by perceptual similarity.
 */
export async function corroborateWithCommons(
  query: string,
  queryImageUrl: string
): Promise<CommonsCorroborationResult> {
  const queryHash = await dHashFromImageUrl(queryImageUrl, false);
  const { results, candidatesExamined } = await searchCommonsGeolocatedPhotos(query);

  const matches: CommonsCorroborationMatch[] = [];
  for (const photo of results) {
    try {
      const hash = await dHashFromImageUrl(photo.thumbUrl, true);
      const similarityPercent = dHashSimilarityPercent(queryHash, hash);
      matches.push({ photo, similarityPercent });
    } catch {
      // Thumb failed to load/hash (CORS or decode) — skip, don't fabricate.
    }
  }
  matches.sort((a, b) => b.similarityPercent - a.similarityPercent);
  return { queryHash, candidatesExamined, matches };
}
