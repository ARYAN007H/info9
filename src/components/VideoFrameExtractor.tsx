import React, { useRef, useState } from 'react';
import { Camera, Film, SkipBack, SkipForward } from 'lucide-react';
import { Button, DataLabel, DataValue, Well } from './ui';

interface VideoFrameExtractorProps {
  videoUrl: string;
  fileName: string;
  onExtractFrameToForensics: (img: HTMLImageElement, frameLabel: string) => void;
  onClearVideo: () => void;
}

/**
 * In-browser video frame scrubber and keyframe extractor for 04 · Forensics.
 * Lets the analyst step frame-by-frame (-1f, +1f, -1s, +1s) through any uploaded
 * MP4/WebM/MOV clip and send the exact frame into the ELA / Clone / Edge canvas.
 */
export const VideoFrameExtractor: React.FC<VideoFrameExtractorProps> = ({
  videoUrl,
  fileName,
  onExtractFrameToForensics,
  onClearVideo,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [dimensions, setDimensions] = useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  });

  const seekRelative = (deltaSec: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    const next = Math.max(0, Math.min(v.duration || 0, v.currentTime + deltaSec));
    v.currentTime = next;
    setCurrentTime(next);
  };

  const captureCurrentFrame = () => {
    const v = videoRef.current;
    if (!v || v.videoWidth === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/png');
    const img = new Image();
    const tsLabel = `${currentTime.toFixed(2)}s`;
    img.onload = () => {
      onExtractFrameToForensics(img, `${fileName} @ ${tsLabel}`);
    };
    img.src = dataUrl;
  };

  return (
    <Well className="space-y-3 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Film className="h-4 w-4 text-accent" />
          <span className="text-xs font-semibold text-ink">
            Video keyframe scrubber — {fileName}
          </span>
          {dimensions.w > 0 && (
            <DataValue className="text-[11px] text-ink-3">
              {dimensions.w}×{dimensions.h}px · {duration.toFixed(2)}s
            </DataValue>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="primary"
            icon={<Camera className="h-3.5 w-3.5" />}
            onClick={captureCurrentFrame}
          >
            Inspect frame @ {currentTime.toFixed(2)}s in ELA lab
          </Button>
          <Button size="sm" variant="ghost" onClick={onClearVideo}>
            Close video
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 items-center gap-3 md:grid-cols-12">
        <div className="overflow-hidden rounded border border-line bg-[#0E1113] md:col-span-7">
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            crossOrigin="anonymous"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              setDuration(v.duration || 0);
              setDimensions({ w: v.videoWidth, h: v.videoHeight });
            }}
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            className="max-h-56 w-full object-contain"
          />
        </div>

        <div className="space-y-2.5 md:col-span-5">
          <div>
            <DataLabel>Precise frame stepping (~30 fps)</DataLabel>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Button size="sm" variant="solid" onClick={() => seekRelative(-1)}>
                <SkipBack className="h-3 w-3" /> -1.0s
              </Button>
              <Button
                size="sm"
                variant="solid"
                onClick={() => seekRelative(-1 / 30)}
              >
                -1 frame
              </Button>
              <Button
                size="sm"
                variant="solid"
                onClick={() => seekRelative(1 / 30)}
              >
                +1 frame
              </Button>
              <Button size="sm" variant="solid" onClick={() => seekRelative(1)}>
                +1.0s <SkipForward className="h-3 w-3" />
              </Button>
            </div>
          </div>

          <p className="text-[11px] leading-4 text-ink-3">
            Scrub or step to any keyframe in your video clip, then click{' '}
            <strong className="text-ink-2">Inspect frame in ELA lab</strong> to
            run Error Level Analysis, Clone Detection, and Edge filtering on
            that exact frame.
          </p>
        </div>
      </div>
    </Well>
  );
};
