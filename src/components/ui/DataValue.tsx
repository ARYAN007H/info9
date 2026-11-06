import type { ReactNode } from 'react';

/** A measured value — always in the data face, always tabular. */
export function DataValue({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`font-mono text-xs tabular-nums text-ink ${className}`}>
      {children}
    </span>
  );
}

/** Micro label above or beside a data value. Sentence case, quiet. */
export function DataLabel({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`text-[11px] font-medium text-ink-3 ${className}`}>
      {children}
    </span>
  );
}
