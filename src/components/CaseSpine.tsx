import { useEffect, useState } from 'react';
import type { InvestigationCase, ModuleId } from '../types/osint';
import { MODULE_CATALOG, MODULE_ORDER } from './moduleCatalog';
import { formatFetchedAt } from '../utils/provenance';
import { Button } from './ui';

interface CaseSpineProps {
  activeCase: InvestigationCase;
  activeModule: ModuleId;
  onSelectModule: (moduleId: ModuleId) => void;
  onResetWorkspace: () => void;
}

/** Case tallies: what this case file currently holds, per instrument. */
function moduleCounts(activeCase: InvestigationCase): Record<ModuleId, number> {
  return {
    geolocation: activeCase.geoState.landmarks.length,
    dossier: activeCase.entities.length,
    infra: activeCase.infraRecords.length,
    forensics: activeCase.forensicSamples.length,
    identity: activeCase.evidenceLedger.filter(
      (entry) => entry.module === 'identity'
    ).length,
    investigate: 0,
    sanctions: activeCase.evidenceLedger.filter(
      (entry) => entry.module === 'sanctions'
    ).length,
  };
}

/**
 * Case spine: identity plate for the open case file, the module index and
 * the destructive controls. Collapses to a horizontal rail below lg.
 */
export function CaseSpine({
  activeCase,
  activeModule,
  onSelectModule,
  onResetWorkspace,
}: CaseSpineProps) {
  const [armReset, setArmReset] = useState(false);
  const counts = moduleCounts(activeCase);

  useEffect(() => {
    if (!armReset) return;
    const t = setTimeout(() => setArmReset(false), 3000);
    return () => clearTimeout(t);
  }, [armReset]);

  return (
    <aside className="flex shrink-0 flex-col border-b border-line bg-panel lg:w-60 lg:border-b-0 lg:border-r">
      <div className="hidden border-b border-line px-4 py-4 lg:block">
        <div className="signage text-[9px] font-semibold text-ink-3">
          Case file
        </div>
        <div className="mt-1.5 font-mono text-sm font-semibold text-ink">
          {activeCase.codeName}
        </div>
        <div className="mt-2 inline-flex items-center rounded border border-line px-1.5 py-0.5 text-[10px] font-medium text-ink-2">
          {activeCase.classification}
        </div>
        <div
          className="mt-2.5 font-mono text-[10px] tabular-nums text-ink-3"
          title={activeCase.updatedAtUtc}
        >
          Updated {formatFetchedAt(activeCase.updatedAtUtc)}
        </div>
      </div>

      <nav
        aria-label="Investigation modules"
        className="flex gap-1 overflow-x-auto px-2 py-2 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-0 lg:py-3"
      >
        {MODULE_ORDER.map((id) => {
          const mod = MODULE_CATALOG[id];
          const isActive = id === activeModule;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelectModule(id)}
              aria-current={isActive ? 'page' : undefined}
              className={`flex shrink-0 items-center gap-2.5 border-l-2 px-3 py-2 text-left text-[13px] transition-colors lg:shrink ${
                isActive
                  ? 'border-l-accent bg-well font-semibold text-ink'
                  : 'border-l-transparent font-medium text-ink-2 hover:bg-well/60 hover:text-ink'
              }`}
            >
              <span
                className={`signage w-5 shrink-0 text-[9px] font-semibold ${
                  isActive ? 'text-accent' : 'text-ink-3'
                }`}
              >
                {mod.num}
              </span>
              <span className="whitespace-nowrap">{mod.name}</span>
              <span
                className={`ml-auto hidden font-mono text-[11px] tabular-nums lg:inline ${
                  counts[id] > 0 ? 'text-ink-3' : 'text-ink-3/50'
                }`}
              >
                {counts[id]}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="mt-auto hidden flex-col gap-1 border-t border-line px-3 py-3 lg:flex">
        <Button
          variant={armReset ? 'danger' : 'ghost'}
          size="sm"
          onClick={() => (armReset ? onResetWorkspace() : setArmReset(true))}
          className="justify-start"
        >
          {armReset ? 'Confirm reset' : 'Reset workspace'}
        </Button>
        <p className="px-1 pt-1.5 text-[10px] leading-4 text-ink-3">
          Zero-key · local-first · AGPL-3.0
        </p>
      </div>
    </aside>
  );
}
