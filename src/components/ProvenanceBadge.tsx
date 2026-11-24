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
export function ProvenanceBadge({
  meta,
  provenance,
  compact = false,
}: {
  meta?: ProvenanceMeta;
  provenance?: ProvenanceMeta;
  compact?: boolean;
}) {
  const resolved = meta ?? provenance;
  if (!resolved) return null;
  const style = STATUS_STYLES[resolved.status];
  const title =
    resolved.status === 'UNAVAILABLE'
      ? `Data gap — ${resolved.note || resolved.source}`
      : `${resolved.status} from ${resolved.source} at ${formatFetchedAt(resolved.fetchedAtUtc)}${
          resolved.note ? ` (${resolved.note})` : ''
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
          {resolved.status === 'UNAVAILABLE' ? resolved.note || resolved.source : resolved.source}
        </span>
      )}
    </span>
  );
}

export default ProvenanceBadge;
