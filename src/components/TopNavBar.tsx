import { Moon, Search, Sun } from 'lucide-react';

export interface ProvenanceTally {
  live: number;
  derived: number;
  gap: number;
}

interface TopNavBarProps {
  provenanceTally: ProvenanceTally;
  isDark: boolean;
  onToggleTheme: () => void;
  onOpenCommandPalette: () => void;
}

/**
 * Instrument strip: wordmark, case-wide provenance tally, search.
 * Module navigation lives in the case spine, not here.
 */
export function TopNavBar({
  provenanceTally,
  isDark,
  onToggleTheme,
  onOpenCommandPalette,
}: TopNavBarProps) {
  const { live, derived, gap } = provenanceTally;
  const tallyEntries = [
    { value: live, label: 'live', dot: 'bg-live' },
    { value: derived, label: 'derived', dot: 'bg-derived' },
    { value: gap, label: 'gaps', dot: 'bg-gap' },
  ].filter((entry) => entry.value > 0);
  const hasTally = tallyEntries.length > 0;

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line bg-panel px-4 sm:px-5">
      <a
        href="#top"
        onClick={(e) => e.preventDefault()}
        className="flex shrink-0 items-center gap-2.5"
        aria-label="info9 home"
      >
        <span aria-hidden="true" className="h-2 w-2 bg-accent" />
        <span className="font-display text-lg font-bold tracking-tight text-ink">
          info9
        </span>
        <span className="signage hidden text-[10px] font-semibold text-ink-3 sm:inline">
          Argon workbench
        </span>
      </a>

      {hasTally && (
        <div
          className="hidden items-center gap-4 font-mono text-[11px] tabular-nums text-ink-3 md:flex"
          title="Provenance across the case: values fetched live from sources, values derived locally, and named data gaps"
        >
          {tallyEntries.map((entry) => (
            <span key={entry.label} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${entry.dot}`}
              />
              {entry.value} {entry.label}
            </span>
          ))}
        </div>
      )}

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          className="flex h-9 w-9 items-center justify-center rounded text-ink-2 transition-colors hover:bg-well hover:text-ink"
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={onOpenCommandPalette}
          className="flex h-9 items-center gap-2 rounded border border-line bg-well px-3 text-[13px] font-medium text-ink transition-colors hover:border-line-strong"
        >
          <Search className="h-4 w-4 text-ink-3" />
          <span>Search</span>
          <span className="hidden rounded border border-line bg-app px-1.5 py-0.5 font-mono text-[10px] text-ink-3 sm:inline">
            ⌘K
          </span>
        </button>
      </div>
    </header>
  );
}
