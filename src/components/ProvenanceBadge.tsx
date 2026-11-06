import { ShieldCheck, ShieldQuestion, ShieldX } from 'lucide-react';
import type { ProvenanceMeta } from '../types/osint';
import { formatFetchedAt } from '../utils/provenance';

const STATUS_STYLES: Record<
  ProvenanceMeta['status'],
  { chip: string; label: string; Icon: typeof ShieldCheck }
> = {
  LIVE: {
    chip: 'border-live/35 bg-live/10 text-live',
    label: 'LIVE',
    Icon: ShieldCheck,
  },
  DERIVED: {
    chip: 'border-derived/35 bg-derived/10 text-derived',
    label: 'DERIVED',
    Icon: ShieldQuestion,
  },
  UNAVAILABLE: {
    chip: 'border-gap/40 bg-gap/10 text-gap',
    label: 'NO DATA',
    Icon: ShieldX,
  },
};

/**
 * Evidentiary badge shown next to intelligence values. Tells the analyst
 * whether a value came live from the named source, was derived locally, or
 * is an explicit data gap — a missing answer is never dressed up as data.
 */
export default function ProvenanceBadge({
  meta,
  compact = false,
}: {
  meta: ProvenanceMeta;
  compact?: boolean;
}) {
  const style = STATUS_STYLES[meta.status];
  const title =
    meta.status === 'UNAVAILABLE'
      ? `Data gap — ${meta.note || meta.source}`
      : `${meta.status} from ${meta.source} at ${formatFetchedAt(meta.fetchedAtUtc)}${
          meta.note ? ` (${meta.note})` : ''
        }`;

  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${style.chip}`}
    >
      <style.Icon className="h-3 w-3 shrink-0" />
      <span>{style.label}</span>
      {!compact && (
        <span className="font-medium normal-case tracking-normal opacity-80">
          {meta.status === 'UNAVAILABLE' ? meta.note || meta.source : meta.source}
        </span>
      )}
    </span>
  );
}
