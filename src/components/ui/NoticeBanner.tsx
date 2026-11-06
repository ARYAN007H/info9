import type { ReactNode } from 'react';

type NoticeTone = 'info' | 'hypothesis' | 'warn' | 'danger';

const TONE_STYLES: Record<
  NoticeTone,
  { bar: string; text: string }
> = {
  info: { bar: 'border-l-derived', text: 'text-derived' },
  hypothesis: { bar: 'border-l-accent', text: 'text-accent' },
  warn: { bar: 'border-l-gap', text: 'text-gap' },
  danger: { bar: 'border-l-danger', text: 'text-danger' },
};

interface NoticeBannerProps {
  tone?: NoticeTone;
  title?: string;
  icon?: ReactNode;
  onDismiss?: () => void;
  className?: string;
  children: ReactNode;
}

/**
 * Status notice: what happened, and how to fix it. A 2px tone bar carries
 * the severity; body text stays quiet and readable.
 */
export function NoticeBanner({
  tone = 'info',
  title,
  icon,
  onDismiss,
  className = '',
  children,
}: NoticeBannerProps) {
  const styles = TONE_STYLES[tone];
  return (
    <div
      role="status"
      className={`flex items-start justify-between gap-3 rounded border border-line border-l-2 bg-well px-3.5 py-2 text-xs leading-5 text-ink-2 ${styles.bar} ${className}`}
    >
      <div className="flex min-w-0 items-start gap-2">
        {icon && (
          <span className={`mt-0.5 shrink-0 [&>svg]:h-4 [&>svg]:w-4 ${styles.text}`}>
            {icon}
          </span>
        )}
        <div className="min-w-0">
          {title && (
            <span className={`mr-1.5 font-semibold ${styles.text}`}>
              {title}
            </span>
          )}
          {children}
        </div>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-ink-3 underline underline-offset-2 hover:text-ink"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}
