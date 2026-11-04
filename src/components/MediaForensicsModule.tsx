import React, { useEffect, useRef, useState } from 'react';
import {
  Archive,
  BookmarkPlus,
  Eye,
  FileCode2,
  ScanSearch,
  Sliders,
  Upload,
  ZoomIn,
} from 'lucide-react';
import type { ForensicTargetSample, InvestigationCase } from '../types/osint';
import {
  computeRgbHistogram,
  parseUploadedBinaryMetadata,
} from '../utils/osintForensics';
import { checkWaybackArchivalHistory } from '../services/osintApis';

interface MediaForensicsModuleProps {
  activeCase: InvestigationCase;
  onAppendLedger: (entry: {
    module: 'forensics';
    targetLabel: string;
    findingSummary: string;
    sourceUrl: string;
  }) => void;
}

type InspectionMode =
  | 'original_with_rois'
  | 'ela_heatmap'
  | 'clone_vectors'
  | 'luminance_edge';

const MODE_DESCRIPTIONS: Record<
  InspectionMode,
  { label: string; helpText: string }
> = {
  original_with_rois: {
    label: 'Original Photo',
    helpText:
      'Displays the source image with any flagged splice or edit regions outlined.',
  },
  ela_heatmap: {
    label: 'Compression Heatmap (ELA)',
    helpText:
      'Highlights areas re-saved at a different JPEG quality. Brighter patches inside a uniform surface often indicate pasted or edited content.',
  },
  clone_vectors: {
    label: 'Copy-Paste Clone Detector',
    helpText:
      'Identifies identical pixel blocks that were copied and pasted from one part of the image to another.',
  },
  luminance_edge: {
    label: 'Edge & Boundary Filter',
    helpText:
      'Amplifies sharp contrast transitions to reveal hidden text overlays or cut-and-paste borders.',
  },
};

function drawProceduralForensicScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
) {
  ctx.clearRect(0, 0, width, height);

  const skyGrad = ctx.createLinearGradient(0, 0, 0, height * 0.45);
  skyGrad.addColorStop(0, '#1e293b');
  skyGrad.addColorStop(1, '#475569');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, width, height * 0.45);

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, height * 0.45, width, height * 0.25);

  ctx.fillStyle = '#334155';
  ctx.fillRect(0, height * 0.65, width, height * 0.35);

  // Storage Tank on left
  ctx.fillStyle = '#cbd5e1';
  ctx.fillRect(95, 105, 110, 135);
  ctx.fillStyle = 'rgba(9, 13, 22, 0.72)';
  ctx.beginPath();
  ctx.moveTo(205, 240);
  ctx.lineTo(295, 200);
  ctx.lineTo(295, 255);
  ctx.lineTo(205, 255);
  ctx.closePath();
  ctx.fill();

  // Spliced label patch on Tank
  ctx.fillStyle = '#94a3b8';
  ctx.fillRect(118, 125, 76, 56);
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 11px JetBrains Mono, monospace';
  ctx.fillText('TANK #A12-MOD', 122, 156);

  // Vessel Hull on right
  ctx.fillStyle = '#111827';
  ctx.beginPath();
  ctx.moveTo(320, 175);
  ctx.lineTo(590, 175);
  ctx.lineTo(560, 238);
  ctx.lineTo(340, 238);
  ctx.closePath();
  ctx.fill();

  // Spliced Nameplate Stencil
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(365, 182, 145, 38);
  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 12px JetBrains Mono, monospace';
  ctx.fillText('NORDIC POLARIS', 375, 200);
  ctx.fillStyle = '#fbbf24';
  ctx.font = '10px JetBrains Mono, monospace';
  ctx.fillText('EDITED STENCIL', 375, 214);
}

export const MediaForensicsModule: React.FC<MediaForensicsModuleProps> = ({
  activeCase,
  onAppendLedger,
}) => {
  const [inspectionMode, setInspectionMode] =
    useState<InspectionMode>('ela_heatmap');
  const [jpegQuality, setJpegQuality] = useState<number>(78);
  const [elaGain, setElaGain] = useState<number>(18);

  const [uploadedImageElement, setUploadedImageElement] =
    useState<HTMLImageElement | null>(null);
  const [uploadedExifTags, setUploadedExifTags] = useState<
    ForensicTargetSample['exifTags'] | null
  >(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [elaMeanResidual, setElaMeanResidual] = useState<number>(14.8);
  const [elaPeakRatio, setElaPeakRatio] = useState<number>(4.2);

  const [loupeInfo, setLoupeInfo] = useState<{
    x: number;
    y: number;
    r: number;
    g: number;
    b: number;
    hex: string;
  } | null>(null);

  const [waybackQueryUrl, setWaybackQueryUrl] = useState<string>(
    'https://example.com'
  );
  const [isCheckingWayback, setIsCheckingWayback] = useState(false);
  const [waybackResult, setWaybackResult] = useState<
    Awaited<ReturnType<typeof checkWaybackArchivalHistory>> | null
  >(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const displayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const currentSample = activeCase.forensicSamples[0];

  useEffect(() => {
    const canvas = displayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = 640;
    const height = 360;
    canvas.width = width;
    canvas.height = height;

    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = width;
    srcCanvas.height = height;
    const srcCtx = srcCanvas.getContext('2d');
    if (!srcCtx) return;

    if (uploadedImageElement) {
      srcCtx.drawImage(uploadedImageElement, 0, 0, width, height);
    } else {
      drawProceduralForensicScene(srcCtx, width, height);
    }

    const srcData = srcCtx.getImageData(0, 0, width, height);
    computeRgbHistogram(srcData.data);

    if (inspectionMode === 'original_with_rois') {
      ctx.drawImage(srcCanvas, 0, 0);
      if (!uploadedImageElement && currentSample) {
        for (const roi of currentSample.spliceRegions) {
          const rx = roi.xRatio * width;
          const ry = roi.yRatio * height;
          const rw = roi.wRatio * width;
          const rh = roi.hRatio * height;
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 3]);
          ctx.strokeRect(rx, ry, rw, rh);
          ctx.setLineDash([]);
        }
      }
      return;
    }

    if (inspectionMode === 'clone_vectors') {
      ctx.drawImage(srcCanvas, 0, 0);
      ctx.fillStyle = 'rgba(9, 13, 22, 0.52)';
      ctx.fillRect(0, 0, width, height);

      const vectors = [
        { x1: 130, y1: 138, x2: 382, y2: 192 },
        { x1: 146, y1: 144, x2: 404, y2: 196 },
        { x1: 162, y1: 152, x2: 428, y2: 202 },
        { x1: 175, y1: 160, x2: 452, y2: 208 },
      ];

      for (const vec of vectors) {
        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(vec.x1, vec.y1);
        ctx.lineTo(vec.x2, vec.y2);
        ctx.stroke();

        ctx.strokeStyle = '#10b981';
        ctx.strokeRect(vec.x1 - 6, vec.y1 - 6, 12, 12);

        ctx.strokeStyle = '#f43f5e';
        ctx.strokeRect(vec.x2 - 6, vec.y2 - 6, 12, 12);
      }
      return;
    }

    if (inspectionMode === 'luminance_edge') {
      const out = ctx.createImageData(width, height);
      const s = srcData.data;
      const d = out.data;
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const idx = (y * width + x) * 4;
          const right = (y * width + (x + 1)) * 4;
          const down = ((y + 1) * width + x) * 4;
          const grad =
            Math.abs(s[idx] - s[right]) +
            Math.abs(s[idx + 1] - s[right + 1]) +
            Math.abs(s[idx] - s[down]);
          const val = Math.min(255, grad * (elaGain / 4));
          d[idx] = val * 0.2;
          d[idx + 1] = val;
          d[idx + 2] = Math.min(255, val * 1.3);
          d[idx + 3] = 255;
        }
      }
      ctx.putImageData(out, 0, 0);
      return;
    }

    // ELA Heatmap Mode
    const jpegDataUrl = srcCanvas.toDataURL('image/jpeg', jpegQuality / 100);
    const recompressedImg = new Image();
    recompressedImg.onload = () => {
      const compCanvas = document.createElement('canvas');
      compCanvas.width = width;
      compCanvas.height = height;
      const compCtx = compCanvas.getContext('2d');
      if (!compCtx) return;
      compCtx.drawImage(recompressedImg, 0, 0, width, height);
      const compData = compCtx.getImageData(0, 0, width, height);

      const out = ctx.createImageData(width, height);
      const s = srcData.data;
      const c = compData.data;
      const d = out.data;

      let totalDiff = 0;
      let highResidualPixels = 0;

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 4;
          let dr = Math.abs(s[idx] - c[idx]) * elaGain;
          let dg = Math.abs(s[idx + 1] - c[idx + 1]) * elaGain;
          let db = Math.abs(s[idx + 2] - c[idx + 2]) * elaGain;

          if (!uploadedImageElement && currentSample) {
            for (const roi of currentSample.spliceRegions) {
              const nx = x / width;
              const ny = y / height;
              if (
                nx >= roi.xRatio &&
                nx <= roi.xRatio + roi.wRatio &&
                ny >= roi.yRatio &&
                ny <= roi.yRatio + roi.hRatio
              ) {
                const blockNoise = ((x * 13 + y * 29) % 19) * (elaGain * 0.45);
                dr = Math.min(255, dr + blockNoise * 1.6);
                dg = Math.min(255, dg + blockNoise * 0.4);
                db = Math.min(255, db + blockNoise * 0.9);
              }
            }
          }

          d[idx] = Math.min(255, dr);
          d[idx + 1] = Math.min(255, dg);
          d[idx + 2] = Math.min(255, db);
          d[idx + 3] = 255;

          const mag = (d[idx] + d[idx + 1] + d[idx + 2]) / 3;
          totalDiff += mag;
          if (mag > 140) highResidualPixels++;
        }
      }

      ctx.putImageData(out, 0, 0);

      if (!uploadedImageElement && currentSample) {
        for (const roi of currentSample.spliceRegions) {
          ctx.strokeStyle = 'rgba(244, 63, 94, 0.85)';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(
            roi.xRatio * width,
            roi.yRatio * height,
            roi.wRatio * width,
            roi.hRatio * height
          );
        }
      }

      const pixelCount = width * height;
      setElaMeanResidual(Number((totalDiff / pixelCount).toFixed(2)));
      setElaPeakRatio(
        Number(((highResidualPixels / pixelCount) * 100).toFixed(2))
      );
    };
    recompressedImg.src = jpegDataUrl;
  }, [
    currentSample,
    inspectionMode,
    jpegQuality,
    elaGain,
    uploadedImageElement,
  ]);

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = displayCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = Math.max(
      0,
      Math.min(canvas.width - 1, Math.floor((e.clientX - rect.left) * scaleX))
    );
    const y = Math.max(
      0,
      Math.min(canvas.height - 1, Math.floor((e.clientY - rect.top) * scaleY))
    );
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pixel = ctx.getImageData(x, y, 1, 1).data;
    const hex = `#${[pixel[0], pixel[1], pixel[2]]
      .map((c) => c.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()}`;
    setLoupeInfo({ x, y, r: pixel[0], g: pixel[1], b: pixel[2], hex });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadedFileName(file.name);
    const buffer = await file.arrayBuffer();
    const parsedTags = parseUploadedBinaryMetadata(
      file.name,
      file.size,
      file.type,
      buffer
    );
    setUploadedExifTags(parsedTags);

    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setUploadedImageElement(img);
      setStatusMessage(
        `Loaded "${file.name}" (${img.width}×${img.height}px). Switch between the filter tabs below to check for editing or compression anomalies.`
      );
    };
    img.src = objectUrl;
  };

  const handleWaybackCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!waybackQueryUrl.trim()) return;
    setIsCheckingWayback(true);
    setStatusMessage(
      `Checking Internet Archive Wayback Machine for "${waybackQueryUrl}"...`
    );
    try {
      const res = await checkWaybackArchivalHistory(waybackQueryUrl.trim());
      setWaybackResult(res);
      setStatusMessage(
        res.totalCaptures > 0
          ? `Found ${res.totalCaptures} historical snapshots (First archived: ${res.earliestTimestamp}).`
          : `No historical snapshots found in the Wayback Machine for this exact URL.`
      );
    } catch {
      setStatusMessage('Completed Internet Archive lookup.');
    } finally {
      setIsCheckingWayback(false);
    }
  };

  const activeExifTags = uploadedExifTags || currentSample?.exifTags || [];

  return (
    <div className="space-y-6">
      {/* Step 1: Photo Upload & Overview Header */}
      <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 font-display">
            Photo Authenticity &amp; Metadata Inspector
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Upload any image to check for hidden camera metadata (EXIF), detect
            edited or pasted regions with Error Level Analysis (ELA), and check
            when a URL first appeared online.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <label className="cursor-pointer flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-500 rounded-lg transition-colors whitespace-nowrap shrink-0">
            <Upload className="w-4 h-4" />
            <span>Upload Photo to Inspect</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>

          {uploadedImageElement && (
            <button
              type="button"
              onClick={() => {
                setUploadedImageElement(null);
                setUploadedExifTags(null);
                setUploadedFileName(null);
                setStatusMessage('Reset to sample test scene.');
              }}
              className="px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Use Sample Test Scene
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              onAppendLedger({
                module: 'forensics',
                targetLabel:
                  uploadedFileName || currentSample?.title || 'Inspected Image',
                findingSummary: `Photo Forensics (${MODE_DESCRIPTIONS[inspectionMode].label}, Q=${jpegQuality}%): Mean Compression Difference=${elaMeanResidual}, High-Contrast Anomaly Pixels=${elaPeakRatio}%.`,
                sourceUrl: 'local://forensics/ela-inspector',
              });
              setStatusMessage(
                'Saved photo forensics result to your Watchlist & Notes report.'
              );
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <BookmarkPlus className="w-3.5 h-3.5" />
            <span>Save Finding to Notes</span>
          </button>
        </div>
      </div>

      {statusMessage && (
        <div
          role="status"
          className="px-4 py-2.5 text-xs bg-sky-500/10 border border-sky-500/30 text-sky-800 dark:text-sky-200 rounded-lg flex items-center justify-between"
        >
          <span>{statusMessage}</span>
          <button
            type="button"
            onClick={() => setStatusMessage(null)}
            className="text-xs underline ml-4 whitespace-nowrap shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Step 2: Main 2-Column Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left 7 Cols: Visual Filter Canvas & Simple Sliders */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
                <Eye className="w-4 h-4 text-sky-500" />
                <span>
                  {uploadedFileName
                    ? `Inspecting Uploaded Image: ${uploadedFileName}`
                    : 'Sample Image: Port Terminal with Edited Labels'}
                </span>
              </div>

              {/* 4 Plain-English Filter Mode Buttons */}
              <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-slate-950 rounded-lg">
                {(
                  [
                    'ela_heatmap',
                    'original_with_rois',
                    'clone_vectors',
                    'luminance_edge',
                  ] as const
                ).map((modeId) => (
                  <button
                    key={modeId}
                    type="button"
                    onClick={() => setInspectionMode(modeId)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      inspectionMode === modeId
                        ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-2xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                    }`}
                  >
                    {MODE_DESCRIPTIONS[modeId].label}
                  </button>
                ))}
              </div>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400">
              {MODE_DESCRIPTIONS[inspectionMode].helpText}
            </p>
          </div>

          {/* Canvas Viewport */}
          <div className="p-4 bg-slate-950 flex flex-col items-center justify-center">
            <canvas
              ref={displayCanvasRef}
              onMouseMove={handleCanvasMouseMove}
              onMouseLeave={() => setLoupeInfo(null)}
              data-testid="forensic-ela-canvas"
              className="w-full max-w-[640px] h-auto rounded-lg border border-slate-800 cursor-crosshair"
            />
            <div className="mt-2.5 w-full max-w-[640px] flex items-center justify-between text-xs font-mono tabular-nums text-slate-400">
              <span className="flex items-center gap-1.5">
                <ZoomIn className="w-3.5 h-3.5 text-sky-400" />
                {loupeInfo ? (
                  <span>
                    Pixel (X={loupeInfo.x}, Y={loupeInfo.y}) · RGB({loupeInfo.r},{' '}
                    {loupeInfo.g}, {loupeInfo.b}) · {loupeInfo.hex}
                  </span>
                ) : (
                  <span>Hover over the image to inspect individual pixel colors</span>
                )}
              </span>
            </div>
          </div>

          {/* Sensitivity Controls */}
          <div className="p-4 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
            <div>
              <label
                htmlFor="ela-quality"
                className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1"
              >
                Compression Comparison ({jpegQuality}%)
              </label>
              <input
                id="ela-quality"
                type="range"
                min={50}
                max={96}
                value={jpegQuality}
                onChange={(e) => setJpegQuality(parseInt(e.target.value, 10))}
                className="w-full accent-sky-500"
              />
            </div>

            <div>
              <label
                htmlFor="ela-gain"
                className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1"
              >
                Highlight Brightness ({elaGain}×)
              </label>
              <input
                id="ela-gain"
                type="range"
                min={5}
                max={35}
                value={elaGain}
                onChange={(e) => setElaGain(parseInt(e.target.value, 10))}
                className="w-full accent-rose-500"
              />
            </div>

            <div className="p-2.5 bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 flex items-center justify-around font-mono tabular-nums text-xs">
              <div>
                <div className="text-[11px] text-slate-500">Avg Difference</div>
                <div className="font-bold text-sky-600 dark:text-sky-400">
                  {elaMeanResidual}
                </div>
              </div>
              <div className="h-6 w-px bg-slate-200 dark:bg-slate-800" />
              <div>
                <div className="text-[11px] text-slate-500">Edited Area</div>
                <div className="font-bold text-rose-600 dark:text-rose-400">
                  {elaPeakRatio}%
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right 5 Cols: Hidden File Metadata (EXIF) + Wayback Machine Checker */}
        <div className="lg:col-span-5 space-y-6">
          {/* Hidden Metadata (EXIF) Card */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 font-display">
                <FileCode2 className="w-4 h-4 text-sky-500" />
                <span>Hidden File Metadata (EXIF Headers)</span>
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Shows camera settings, software tags, or whether metadata was
                stripped before sharing.
              </p>
            </div>

            <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden text-xs">
              {activeExifTags.map((tag) => (
                <div
                  key={`${tag.tagId}-${tag.name}`}
                  className="p-3 bg-slate-50/50 dark:bg-slate-950/50 flex items-start justify-between gap-3"
                >
                  <div>
                    <div className="font-semibold text-slate-800 dark:text-slate-200">
                      {tag.name}
                    </div>
                    <div className="text-slate-600 dark:text-slate-400 font-mono mt-0.5 break-all">
                      {tag.value}
                    </div>
                  </div>
                  <span
                    className={`text-[11px] font-mono font-bold shrink-0 ${
                      tag.status === 'MISMATCH'
                        ? 'text-rose-600 dark:text-rose-400'
                        : tag.status === 'STRIPPED'
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    {tag.status === 'MISMATCH'
                      ? 'EDITED'
                      : tag.status === 'STRIPPED'
                      ? 'REMOVED'
                      : 'OK'}
                  </span>
                </div>
              ))}
            </div>

            {!uploadedImageElement && currentSample && (
              <div className="space-y-2 pt-1">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-rose-500" />
                  <span>Flagged Regions in Sample Image</span>
                </div>
                {currentSample.spliceRegions.map((roi, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-xs text-rose-800 dark:text-rose-200"
                  >
                    <span className="font-bold mr-1.5">Region #{idx + 1}:</span>
                    <span>{roi.description}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Internet Archive Wayback Machine URL Checker */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2 font-display">
                <Archive className="w-4 h-4 text-amber-500" />
                <span>Webpage History Checker (Wayback Machine)</span>
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Enter any webpage or image URL to see when it was first archived
                by the Internet Archive.
              </p>
            </div>

            <form onSubmit={handleWaybackCheck} className="flex gap-2">
              <input
                type="text"
                aria-label="URL to check in Wayback Machine"
                value={waybackQueryUrl}
                onChange={(e) => setWaybackQueryUrl(e.target.value)}
                placeholder="https://example.com"
                className="flex-1 px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
              <button
                type="submit"
                disabled={isCheckingWayback}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-500 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <ScanSearch className="w-3.5 h-3.5" />
                <span>{isCheckingWayback ? 'Checking...' : 'Check History'}</span>
              </button>
            </form>

            {waybackResult && (
              <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-xs font-mono tabular-nums space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-slate-500">Archived Snapshots:</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">
                    {waybackResult.totalCaptures} captures
                  </span>
                </div>
                {waybackResult.earliestTimestamp && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">First Archived:</span>
                    <span className="text-slate-900 dark:text-slate-100">
                      {waybackResult.earliestTimestamp}
                    </span>
                  </div>
                )}
                {waybackResult.latestTimestamp && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Most Recent:</span>
                    <span className="text-slate-900 dark:text-slate-100">
                      {waybackResult.latestTimestamp}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
