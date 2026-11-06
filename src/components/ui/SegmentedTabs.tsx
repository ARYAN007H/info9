interface SegmentedTab<T extends string> {
  id: T;
  label: string;
}

interface SegmentedTabsProps<T extends string> {
  tabs: ReadonlyArray<SegmentedTab<T>>;
  active: T;
  onChange: (id: T) => void;
  size?: 'sm' | 'md';
  ariaLabel: string;
  className?: string;
}

/** Inset instrument switcher — the one segmented control on the bench. */
export function SegmentedTabs<T extends string>({
  tabs,
  active,
  onChange,
  size = 'md',
  ariaLabel,
  className = '',
}: SegmentedTabsProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`inline-flex items-center gap-0.5 rounded border border-line bg-app p-0.5 ${
        size === 'sm' ? 'text-[11px]' : 'text-xs'
      } ${className}`}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={`rounded border px-3 py-1 font-medium transition-colors whitespace-nowrap ${
              size === 'sm' ? 'px-2 py-0.5' : ''
            } ${
              isActive
                ? 'border-line bg-well text-ink'
                : 'border-transparent text-ink-3 hover:text-ink'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
