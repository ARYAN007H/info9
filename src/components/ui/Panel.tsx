import type { ReactNode } from 'react';

interface PanelProps {
  /** Equipment tag — the module catalogue number, e.g. "01". */
  tag?: string;
  title?: ReactNode;
  description?: string;
  actions?: ReactNode;
  /** No body padding — for map/canvas bodies that manage their own chrome. */
  flush?: boolean;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}

/**
 * Bench panel: hairline border, 6px radius, header plate with optional
 * equipment tag + one-line job description + right-side actions.
 */
export function Panel({
  tag,
  title,
  description,
  actions,
  flush = false,
  className = '',
  bodyClassName = '',
  children,
}: PanelProps) {
  const hasHeader = Boolean(tag || title || description || actions);
  return (
    <section className={`border border-line bg-panel rounded-md ${className}`}>
      {hasHeader && (
        <header className="flex items-start justify-between gap-x-3 gap-y-2 border-b border-line px-4 py-2.5">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2.5">
              {tag && (
                <span className="signage text-[10px] font-semibold text-accent">
                  {tag}
                </span>
              )}
              {title && (
                <h2 className="truncate text-[15px] font-semibold text-ink">
                  {title}
                </h2>
              )}
            </div>
            {description && (
              <p className="mt-0.5 text-xs leading-5 text-ink-3">
                {description}
              </p>
            )}
          </div>
          {actions && (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {actions}
            </div>
          )}
        </header>
      )}
      <div className={flush ? bodyClassName : `p-4 ${bodyClassName}`}>
        {children}
      </div>
    </section>
  );
}

interface WellProps {
  label?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Inset data well used inside panels — the recessed instrument area. */
export function Well({ label, actions, className = '', children }: WellProps) {
  return (
    <div className={`border border-line bg-well rounded ${className}`}>
      {(label || actions) && (
        <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5">
          <span className="text-[11px] font-semibold text-ink-2">{label}</span>
          {actions && <div className="flex items-center gap-1.5">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
