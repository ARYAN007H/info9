import { ShieldCheck, ShieldQuestion, ShieldX } from 'lucide-react';
import type { ProvenanceMeta } from '../types/osint';
import { formatFetchedAt } from '../utils/provenance';

const STATUS_STYLES: Record<
  ProvenanceMeta['status'],
  { chip: string; label: string; Icon: typeof ShieldCheck }
> = {
  LIVE: {
    chip: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900',
    label: 'LIVE',
    Icon: ShieldCheck,
  },
  DERIVED: {
    chip: 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-900',
    label: 'DERIVED',
    Icon: ShieldQuestion,
  },
  UNAVAILABLE: {
    chip: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900',
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
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 border rounded text-[10px] font-bold tracking-wide ${style.chip}`}
    >
      <style.Icon className="w-3 h-3 shrink-0" />
      <span>{style.label}</span>
      {!compact && (
        <span className="font-medium opacity-80 normal-case tracking-normal">
          {meta.status === 'UNAVAILABLE' ? meta.note || meta.source : meta.source}
        </span>
      )}
    </span>
  );
}
