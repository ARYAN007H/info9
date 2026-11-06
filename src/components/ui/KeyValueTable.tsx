import type { ReactNode } from 'react';

export interface KeyValueRow {
  label: string;
  value: ReactNode;
}

/** Attribute readout: inset key column, mono value column. */
export function KeyValueTable({
  rows,
  className = '',
}: {
  rows: KeyValueRow[];
  className?: string;
}) {
  return (
    <div
      className={`divide-y divide-line overflow-hidden rounded border border-line ${className}`}
    >
      {rows.map((row, i) => (
        <div
          key={`${row.label}-${i}`}
          className="grid grid-cols-[minmax(96px,140px)_1fr] items-baseline"
        >
          <div className="bg-app/60 px-3 py-1.5 text-[11px] font-medium text-ink-3">
            {row.label}
          </div>
          <div className="min-w-0 break-words px-3 py-1.5 font-mono text-xs text-ink">
            {row.value}
          </div>
        </div>
      ))}
    </div>
  );
}
