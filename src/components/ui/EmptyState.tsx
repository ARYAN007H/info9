import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}

/** Empty screens are invitations to act: state what's missing, point at the fix. */
export function EmptyState({
  icon,
  title,
  hint,
  action,
  className = '',
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center px-8 py-12 text-center ${className}`}
    >
      {icon && (
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded border border-line bg-well text-ink-3 [&>svg]:h-5 [&>svg]:w-5">
          {icon}
        </div>
      )}
      <p className="text-sm font-semibold text-ink">{title}</p>
      {hint && (
        <p className="mt-1 max-w-sm text-xs leading-5 text-ink-3">{hint}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
