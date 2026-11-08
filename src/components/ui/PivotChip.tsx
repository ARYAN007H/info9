import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { ModuleId } from '../../types/osint';
import { classifyUniversalIntake, type SmartRouteAction } from '../../utils/smartIntake';

export interface PivotChipProps {
  value: string;
  label?: string;
  onSelectAction?: (action: SmartRouteAction) => void;
  onSelectModule?: (moduleId: ModuleId, targetValue: string) => void;
  className?: string;
}

/**
 * Click-to-Pivot context chip: wraps any emitted data value (IP, domain,
 * coordinates, entity name, handle, email) with a 1-click popover menu
 * offering instant cross-module pivots.
 */
export const PivotChip: React.FC<PivotChipProps> = ({
  value,
  label,
  onSelectAction,
  onSelectModule,
  className = '',
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  const classified = classifyUniversalIntake(value);
  const actions = classified?.recommendedActions ?? [];

  if (!value.trim() || actions.length === 0) {
    return (
      <span className={`font-mono text-xs tabular-nums text-ink ${className}`}>
        {label ?? value}
      </span>
    );
  }

  return (
    <span ref={containerRef} className={`relative inline-flex items-center ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={`Pivot on ${value}`}
        className="group inline-flex items-center gap-1 rounded border border-line bg-well px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-ink transition-colors hover:border-accent/60 hover:text-accent"
      >
        <span className="truncate max-w-[220px]">{label ?? value}</span>
        <ArrowUpRight className="h-3 w-3 shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-accent" />
      </button>

      {open && (
        <div
          role="menu"
          className="panel-enter absolute left-0 top-full z-40 mt-1 w-64 rounded border border-line-strong bg-panel p-1.5 shadow-2xl"
        >
          <div className="border-b border-line px-2 py-1 font-mono text-[10px] font-semibold uppercase text-ink-3">
            Pivot · {classified?.badgeLabel}
          </div>
          <div className="mt-1 space-y-0.5">
            {actions.map((act) => (
              <button
                key={act.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  if (onSelectAction) {
                    onSelectAction(act);
                  } else if (onSelectModule) {
                    onSelectModule(act.moduleId, act.targetValue);
                  }
                }}
                className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs text-ink-2 transition-colors hover:bg-well hover:text-ink"
              >
                <span className="truncate">{act.label}</span>
                <ArrowUpRight className="h-3 w-3 shrink-0 text-accent" />
              </button>
            ))}
          </div>
        </div>
      )}
    </span>
  );
};
