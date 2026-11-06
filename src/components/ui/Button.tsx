import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'solid' | 'ghost' | 'chip' | 'danger';
type ButtonSize = 'sm' | 'md';

const BASE =
  'inline-flex items-center justify-center gap-1.5 rounded font-medium transition-colors select-none whitespace-nowrap shrink-0 disabled:opacity-45 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const VARIANTS: Record<ButtonVariant, string> = {
  /* The one loud element on the bench: the region's main action. */
  primary: 'bg-accent text-on-accent hover:bg-accent-strong',
  solid: 'border border-line bg-well text-ink hover:border-line-strong',
  ghost: 'border border-transparent text-ink-2 hover:text-ink hover:bg-well',
  chip:
    'border border-line bg-well px-2.5 py-1 font-mono text-[11px] text-ink-2 hover:border-accent hover:text-ink',
  danger: 'border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-9 px-3.5 text-[13px]',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
}

export function Button({
  variant = 'solid',
  size = 'md',
  icon,
  className = '',
  type = 'button',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${BASE} ${VARIANTS[variant]} ${
        variant === 'chip' ? '' : SIZES[size]
      } ${className}`}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
