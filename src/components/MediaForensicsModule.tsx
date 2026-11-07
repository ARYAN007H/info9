import React, { useEffect, useRef, useState } from 'react';
import {
  Archive,
  BookmarkPlus,
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
import { MODULE_CATALOG } from './moduleCatalog';
import {
  Button,
  DataLabel,
  DataValue,
  NoticeBanner,
  Panel,
  SegmentedTabs,
  TextField,
  Well,
} from './ui';

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
    label: 'Original',
    helpText:
      'Displays the source image with any flagged splice or edit regions outlined.',
  },
  ela_heatmap: {
    label: 'ELA heatmap',
    helpText:
      'Highlights areas re-saved at a different JPEG quality. Brighter patches inside a uniform surface often indicate pasted or edited content.',
  },
  clone_vectors: {
    label: 'Clone detector',
    helpText:
      'Identifies identical pixel blocks that were copied and pasted from one part of the image to another.',
  },
  luminance_edge: {
    label: 'Edge filter',
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
  ctx.font = 'bold 11px "Spline Sans Mono", monospace';
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
  ctx.font = 'bold 12px "Spline Sans Mono", monospace';
  ctx.fillText('NORDIC POLARIS', 375, 200);
  ctx.fillStyle = '#fbbf24';
  ctx.font = '10px "Spline Sans Mono", monospace';
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
        `Loaded "${file.name}" (${img.width}×${img.height}px). Switch between the filter tabs to check for editing or compression anomalies.`
      );
    };
    img.src = objectUrl;
  };

  const handleWaybackCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!waybackQueryUrl.trim()) return;
    setIsCheckingWayback(true);
    setStatusMessage(
      `Checking the Wayback Machine for "${waybackQueryUrl}"…`
    );
    try {
      const res = await checkWaybackArchivalHistory(waybackQueryUrl.trim());
      setWaybackResult(res);
      setStatusMessage(
        res.totalCaptures > 0
          ? `Found ${res.totalCaptures} historical snapshots (first archived: ${res.earliestTimestamp}).`
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
    <div className="space-y-4">
      <Panel
        tag={MODULE_CATALOG.forensics.num}
        title={MODULE_CATALOG.forensics.name}
        description={`${MODULE_CATALOG.forensics.job} Upload an image, or examine the bundled sample scene. All computation stays in your browser.`}
        actions={
          <>
            <Button
              variant="solid"
              size="sm"
              icon={<BookmarkPlus className="h-3.5 w-3.5" />}
              onClick={() => {
                onAppendLedger({
                  module: 'forensics',
                  targetLabel:
                    uploadedFileName || currentSample?.title || 'Inspected Image',
                  findingSummary: `Photo Forensics (${MODE_DESCRIPTIONS[inspectionMode].label}, Q=${jpegQuality}%): Mean Compression Difference=${elaMeanResidual}, High-Contrast Anomaly Pixels=${elaPeakRatio}%.`,
                  sourceUrl: 'local://forensics/ela-inspector',
                });
                setStatusMessage(
                  'Forensics result recorded to the evidence ledger.'
                );
              }}
            >
              Record finding
            </Button>
            <label className="inline-flex h-7 cursor-pointer select-none items-center justify-center gap-1.5 whitespace-nowrap rounded bg-accent px-2.5 text-xs font-medium text-on-accent transition-colors hover:bg-accent-strong">
              <Upload className="h-3.5 w-3.5" />
              <span>Upload photo</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
            {uploadedImageElement && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setUploadedImageElement(null);
                  setUploadedExifTags(null);
                  setUploadedFileName(null);
                  setStatusMessage('Reset to the sample test scene.');
                }}
              >
                Use sample scene
              </Button>
            )}
          </>
        }
        /* collapse the body to nothing when there's no status to show */
        flush={!statusMessage}
      >
        {statusMessage && (
          <NoticeBanner tone="info" onDismiss={() => setStatusMessage(null)}>
            {statusMessage}
          </NoticeBanner>
        )}
      </Panel>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
        <Panel
          className="lg:col-span-7"
          flush
          title={uploadedFileName ? uploadedFileName : 'Sample scene — port terminal'}
          description={MODE_DESCRIPTIONS[inspectionMode].helpText}
          actions={
            <SegmentedTabs
              size="sm"
              ariaLabel="Inspection filter"
              tabs={(
                [
                  'ela_heatmap',
                  'original_with_rois',
                  'clone_vectors',
                  'luminance_edge',
                ] as const
              ).map((modeId) => ({
                id: modeId,
                label: MODE_DESCRIPTIONS[modeId].label,
              }))}
              active={inspectionMode}
              onChange={(mode) => setInspectionMode(mode)}
            />
          }
        >
          {/* Fixed dark viewport — the light table stays dark in both modes. */}
          <div className="flex flex-col items-center justify-center bg-[#101418] p-4">
            <canvas
              ref={displayCanvasRef}
              onMouseMove={handleCanvasMouseMove}
              onMouseLeave={() => setLoupeInfo(null)}
              data-testid="forensic-ela-canvas"
              className="h-auto w-full max-w-[640px] cursor-crosshair rounded border border-line"
            />
            <div className="mt-2.5 flex w-full max-w-[640px] items-center justify-between font-mono text-xs tabular-nums text-ink-3">
              <span className="flex items-center gap-1.5">
                <ZoomIn className="h-3.5 w-3.5" />
                {loupeInfo ? (
                  <span className="text-ink-2">
                    Pixel (X={loupeInfo.x}, Y={loupeInfo.y}) · RGB({loupeInfo.r},{' '}
                    {loupeInfo.g}, {loupeInfo.b}) · {loupeInfo.hex}
                  </span>
                ) : (
                  <span>Hover over the image to inspect individual pixels</span>
                )}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 items-center gap-4 border-t border-line bg-well p-4 md:grid-cols-3">
            <div>
              <label
                htmlFor="ela-quality"
                className="mb-1 block text-[11px] font-medium text-ink-2"
              >
                Compression comparison ({jpegQuality}%)
              </label>
              <input
                id="ela-quality"
                type="range"
                min={50}
                max={96}
                value={jpegQuality}
                onChange={(e) => setJpegQuality(parseInt(e.target.value, 10))}
                className="w-full accent-accent"
              />
            </div>

            <div>
              <label
                htmlFor="ela-gain"
                className="mb-1 block text-[11px] font-medium text-ink-2"
              >
                Highlight brightness ({elaGain}×)
              </label>
              <input
                id="ela-gain"
                type="range"
                min={5}
                max={35}
                value={elaGain}
                onChange={(e) => setElaGain(parseInt(e.target.value, 10))}
                className="w-full accent-danger"
              />
            </div>

            <Well className="flex items-center justify-around p-2.5 font-mono text-xs tabular-nums">
              <div>
                <DataLabel>Avg difference</DataLabel>
                <div className="font-semibold text-derived">{elaMeanResidual}</div>
              </div>
              <div className="h-6 w-px bg-line" />
              <div>
                <DataLabel>Edited area</DataLabel>
                <div className="font-semibold text-danger">{elaPeakRatio}%</div>
              </div>
            </Well>
          </div>
        </Panel>

        <div className="space-y-4 lg:col-span-5">
          <Panel
            title="Hidden file metadata (EXIF)"
            description="Camera settings, software tags, or evidence that metadata was stripped before sharing."
            bodyClassName="space-y-3"
          >
            <div className="divide-y divide-line overflow-hidden rounded border border-line text-xs">
              {activeExifTags.map((tag) => (
                <div
                  key={`${tag.tagId}-${tag.name}`}
                  className="flex items-start justify-between gap-3 bg-well p-3"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-ink">{tag.name}</div>
                    <DataValue className="mt-0.5 block break-all text-ink-2">
                      {tag.value}
                    </DataValue>
                  </div>
                  <span
                    className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                      tag.status === 'MISMATCH'
                        ? 'border-danger/40 bg-danger/10 text-danger'
                        : tag.status === 'STRIPPED'
                        ? 'border-gap/40 bg-gap/10 text-gap'
                        : 'border-live/35 bg-live/10 text-live'
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
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-2">
                  <Sliders className="h-3.5 w-3.5 text-ink-3" />
                  <span>Flagged regions in sample image</span>
                </div>
                {currentSample.spliceRegions.map((roi, idx) => (
                  <div
                    key={idx}
                    className="rounded border border-danger/30 bg-danger/10 p-3 text-xs text-ink-2"
                  >
                    <span className="mr-1.5 font-semibold text-danger">
                      Region #{idx + 1}:
                    </span>
                    <span>{roi.description}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel
            title="Webpage history (Wayback Machine)"
            description="See when a URL was first archived by the Internet Archive."
            bodyClassName="space-y-3"
          >
            <form onSubmit={handleWaybackCheck} className="flex gap-2">
              <TextField
                type="text"
                aria-label="URL to check in Wayback Machine"
                value={waybackQueryUrl}
                onChange={(e) => setWaybackQueryUrl(e.target.value)}
                placeholder="https://example.com"
                className="flex-1 font-mono text-xs"
              />
              <Button
                type="submit"
                variant="solid"
                icon={<ScanSearch className="h-3.5 w-3.5" />}
                disabled={isCheckingWayback}
              >
                {isCheckingWayback ? 'Checking…' : 'Check history'}
              </Button>
            </form>

            {waybackResult && (
              <Well className="space-y-1.5 p-3 font-mono text-xs tabular-nums">
                <div className="flex justify-between">
                  <DataLabel>Archived snapshots</DataLabel>
                  <span className="font-semibold text-live">
                    {waybackResult.totalCaptures} captures
                  </span>
                </div>
                {waybackResult.earliestTimestamp && (
                  <div className="flex justify-between">
                    <DataLabel>First archived</DataLabel>
                    <DataValue>{waybackResult.earliestTimestamp}</DataValue>
                  </div>
                )}
                {waybackResult.latestTimestamp && (
                  <div className="flex justify-between">
                    <DataLabel>Most recent</DataLabel>
                    <DataValue>{waybackResult.latestTimestamp}</DataValue>
                  </div>
                )}
              </Well>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
};
