import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Moon, Search, Sparkles, Sun } from 'lucide-react';
import {
  classifyUniversalIntake,
  type SmartRouteAction,
} from '../utils/smartIntake';

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
  onRouteSmartClue?: (action: SmartRouteAction) => void;
}

/**
 * Instrument strip: wordmark, Universal Smart Intake Omnibar, case-wide
 * provenance tally, theme toggle, and ⌘K search.
 */
export function TopNavBar({
  provenanceTally,
  isDark,
  onToggleTheme,
  onOpenCommandPalette,
  onRouteSmartClue,
}: TopNavBarProps) {
  const [omnibarInput, setOmnibarInput] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const omnibarRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (omnibarRef.current && !omnibarRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [dropdownOpen]);

  const classified = classifyUniversalIntake(omnibarInput);

  const handleTriggerAction = (act: SmartRouteAction) => {
    setDropdownOpen(false);
    setOmnibarInput('');
    onRouteSmartClue?.(act);
  };

  const { live, derived, gap } = provenanceTally;
  const tallyEntries = [
    { value: live, label: 'live', dot: 'bg-live' },
    { value: derived, label: 'derived', dot: 'bg-derived' },
    { value: gap, label: 'gaps', dot: 'bg-gap' },
  ].filter((entry) => entry.value > 0);
  const hasTally = tallyEntries.length > 0;

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-panel px-4 sm:px-5">
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
        <span className="signage hidden text-[10px] font-semibold text-ink-3 lg:inline">
          Argon workbench
        </span>
      </a>

      {/* Universal Smart Intake Omnibar */}
      <div ref={omnibarRef} className="relative flex-1 max-w-xl">
        <div className="flex h-9 items-center gap-2 rounded border border-line bg-well px-3 transition-colors focus-within:border-accent">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent" />
          <input
            type="text"
            aria-label="Smart Intake Omnibar — enter any clue to auto-detect and route"
            placeholder="Smart intake: paste any domain, IP, @handle, email, phone, coords, or name…"
            value={omnibarInput}
            onFocus={() => setDropdownOpen(true)}
            onChange={(e) => {
              setOmnibarInput(e.target.value);
              setDropdownOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && classified?.recommendedActions[0]) {
                e.preventDefault();
                handleTriggerAction(classified.recommendedActions[0]);
              } else if (e.key === 'Escape') {
                setDropdownOpen(false);
              }
            }}
            className="w-full bg-transparent font-mono text-xs text-ink placeholder:font-sans placeholder:text-ink-3 focus:outline-none"
          />
          {classified && (
            <span className="hidden shrink-0 rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-accent sm:inline">
              {classified.badgeLabel}
            </span>
          )}
        </div>

        {dropdownOpen && classified && (
          <div
            role="listbox"
            aria-label="Recommended OSINT actions for detected clue"
            className="panel-enter absolute left-0 right-0 top-full z-50 mt-1 rounded-md border border-line-strong bg-panel p-2 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-line px-2 pb-1.5 text-[11px]">
              <span className="font-medium text-ink-2">{classified.summary}</span>
              <span className="font-mono text-[10px] text-accent">
                {classified.badgeLabel}
              </span>
            </div>
            <div className="mt-1.5 space-y-1">
              {classified.recommendedActions.map((act, idx) => (
                <button
                  key={act.id}
                  type="button"
                  onClick={() => handleTriggerAction(act)}
                  className="flex w-full items-center justify-between gap-2 rounded px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-well"
                >
                  <span className="flex items-center gap-2 truncate">
                    <span className="font-mono text-[10px] text-ink-3">
                      {idx === 0 ? '↵' : `${idx + 1}.`}
                    </span>
                    <span className="font-medium">{act.label}</span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] uppercase text-accent">
                    {act.moduleId}
                    <ArrowUpRight className="h-3 w-3" />
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {hasTally && (
          <div
            className="hidden items-center gap-3 font-mono text-[11px] tabular-nums text-ink-3 xl:flex"
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
          <span className="hidden sm:inline">Search</span>
          <span className="hidden rounded border border-line bg-app px-1.5 py-0.5 font-mono text-[10px] text-ink-3 sm:inline">
            ⌘K
          </span>
        </button>
      </div>
    </header>
  );
}
