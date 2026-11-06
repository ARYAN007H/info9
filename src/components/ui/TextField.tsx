import type {
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';

const FIELD =
  'w-full h-9 rounded border border-line bg-well px-3 text-[13px] text-ink placeholder:text-ink-3 transition-colors focus:outline-none focus:border-accent disabled:opacity-50';

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: ReactNode;
}

export function TextField({ icon, className = '', ...props }: TextFieldProps) {
  if (!icon) {
    return <input {...props} className={`${FIELD} ${className}`} />;
  }
  return (
    <div className="relative w-full">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 [&>svg]:h-4 [&>svg]:w-4">
        {icon}
      </span>
      <input {...props} className={`${FIELD} pl-9 ${className}`} />
    </div>
  );
}

export function SelectField({
  className = '',
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={`${FIELD} ${className}`}>
      {children}
    </select>
  );
}

export function FieldLabel({
  className = '',
  children,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      {...props}
      className={`mb-1.5 block text-[11px] font-medium text-ink-3 ${className}`}
    >
      {children}
    </label>
  );
}
