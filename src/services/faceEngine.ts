/**
 * In-browser face engine: detection + landmarks + deep embeddings via
 * @vladmandic/human (FaceRes). Privacy property: pixels never leave the
 * machine — inference runs locally (WebGL, with vendored model weights from
 * /models/human), and only numeric descriptors enter the match math.
 *
 * This module is browser-only and dynamically imported by FaceReconModule so
 * the ML runtime never enters the main bundle.
 */

// Interfaces mirror the shape of human's FaceResult so the component never
// needs to import the (large) human types.

export interface DetectedFace {
  index: number;
  /** Confidence 0..1 from the detector. */
  score: number;
  box: { x: number; y: number; width: number; height: number };
  /** FaceRes descriptor (1024-d in human 3.3). Missing if the model failed. */
  embedding: number[] | null;
  ageEstimate: number | null;
  genderEstimate: 'male' | 'female' | null;
  genderScore: number | null;
  /** Cropped face thumbnail (data URL) rendered client-side. */
  thumbnailDataUrl: string | null;
  /** Dimensions of the analyzed source canvas. */
  sourceWidth: number;
  sourceHeight: number;
}

type HumanLike = {
  detect: (input: HTMLCanvasElement | OffscreenCanvas) => Promise<{
    face: Array<{
      /** [x, y, width, height] in pixels of the input — `boxRaw` is the normalized variant. */
      box: [number, number, number, number];
      score: number;
      age?: number;
      gender?: string;
      genderScore?: number;
      embedding?: number[];
    }>;
  }>;
};

let humanPromise: Promise<HumanLike> | null = null;

async function loadHuman(): Promise<HumanLike> {
  if (!humanPromise) {
    humanPromise = (async () => {
      const { default: Human } = await import('@vladmandic/human');
      const human = new Human({
        debug: false,
        backend: 'webgl',
        modelBasePath: '/models/human/',
        // Only the face pipeline runs: detector + mesh + faceres
        // (faceres = embedding + age + gender in one network).
        face: {
          enabled: true,
          // human 3.x validates that modelPath values end in '.json'; the
          // .bin payloads are resolved relative to the json automatically.
          detector: { enabled: true, modelPath: 'blazeface.json', maxDetected: 20, minConfidence: 0.35 },
          mesh: { enabled: true, modelPath: 'facemesh.json' },
          description: { enabled: true, modelPath: 'faceres.json' },
          iris: { enabled: false },
          emotion: { enabled: false },
          antispoof: { enabled: false },
          liveness: { enabled: false },
          gear: { enabled: false },
        },
        body: { enabled: false },
        hand: { enabled: false },
        gesture: { enabled: false },
        segmentation: { enabled: false },
        object: { enabled: false },
      });
      await human.init();
      return human as unknown as HumanLike;
    })();
    humanPromise.catch(() => {
      // Allow a retry after a failed load instead of caching the rejection.
      humanPromise = null;
    });
  }
  return humanPromise;
}

function cropThumbnail(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  box: { x: number; y: number; width: number; height: number }
): string | null {
  try {
    const pad = Math.round(Math.max(box.width, box.height) * 0.12);
    const cx = Math.max(0, Math.round(box.x - pad));
    const cy = Math.max(0, Math.round(box.y - pad));
    const cw = Math.min(sourceWidth - cx, Math.round(box.width + pad * 2));
    const ch = Math.min(sourceHeight - cy, Math.round(box.height + pad * 2));
    if (cw <= 0 || ch <= 0) return null;
    const thumb = document.createElement('canvas');
    const size = 96;
    thumb.width = size;
    thumb.height = size;
    const ctx = thumb.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(source, cx, cy, cw, ch, 0, 0, size, size);
    return thumb.toDataURL('image/jpeg', 0.75);
  } catch {
    return null;
  }
}

async function toCanvas(
  source: HTMLImageElement | HTMLCanvasElement | ImageBitmap | Blob | File
): Promise<{
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** Immutable pixel source for cropping — human resizes (and thereby
   *  clears) whatever canvas it is handed, so crops must not read from it. */
  cropSource: CanvasImageSource;
  closeCropSource: () => void;
}> {
  let bitmap: ImageBitmap;
  if (source instanceof Blob) {
    bitmap = await createImageBitmap(source);
  } else if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) {
    bitmap = source;
  } else if (source instanceof HTMLImageElement) {
    if (!source.complete || source.naturalWidth === 0) {
      throw new Error('Image not loaded yet');
    }
    bitmap = await createImageBitmap(source);
  } else {
    // HTMLCanvasElement — crop from a defensive clone; the engine may resize
    // (and clear) the canvas it is given, and the caller owns the original.
    const canvas = source as HTMLCanvasElement;
    const clone = document.createElement('canvas');
    clone.width = canvas.width;
    clone.height = canvas.height;
    const cloneCtx = clone.getContext('2d');
    if (!cloneCtx) throw new Error('Canvas 2D context unavailable');
    cloneCtx.drawImage(canvas, 0, 0);
    return {
      canvas,
      width: canvas.width,
      height: canvas.height,
      cropSource: clone,
      closeCropSource: () => {},
    };
  }
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(bitmap, 0, 0);
  return {
    canvas,
    width: canvas.width,
    height: canvas.height,
    cropSource: bitmap,
    closeCropSource: () => bitmap.close(),
  };
}

/**
 * Detects faces in an image and computes local embeddings.
 * Returns every detected face (the analyst picks which one is the subject);
 * an image with no detectable face yields an empty array — never a guess.
 */
export async function detectFaces(
  source: HTMLImageElement | HTMLCanvasElement | ImageBitmap | Blob | File
): Promise<DetectedFace[]> {
  const human = await loadHuman();
  const { canvas, width, height, cropSource, closeCropSource } =
    await toCanvas(source);
  try {
    const result = await human.detect(canvas);
    return (result.face ?? []).map((face, index) => {
      const box = {
        x: face.box[0],
        y: face.box[1],
        width: face.box[2],
        height: face.box[3],
      };
      return {
        index,
        score: face.score ?? 0,
        box,
        embedding:
          face.embedding && face.embedding.length > 0 ? face.embedding : null,
        ageEstimate:
          typeof face.age === 'number' && Number.isFinite(face.age)
            ? face.age
            : null,
        genderEstimate:
          face.gender === 'male' || face.gender === 'female'
            ? face.gender
            : null,
        genderScore:
          typeof face.genderScore === 'number' &&
          Number.isFinite(face.genderScore)
            ? face.genderScore
            : null,
        thumbnailDataUrl: cropThumbnail(cropSource, width, height, box),
        sourceWidth: width,
        sourceHeight: height,
      };
    });
  } finally {
    closeCropSource();
  }
}

/** True once the ML runtime + models are loaded and ready to detect. */
export async function isEngineReady(): Promise<boolean> {
  try {
    await loadHuman();
    return true;
  } catch {
    return false;
  }
}
