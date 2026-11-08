import React, { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import type { InvestigationCase, ModuleId } from '../types/osint';
import { MODULE_CATALOG, MODULE_ORDER } from './moduleCatalog';
import {
  classifyUniversalIntake,
  type SmartRouteAction,
} from '../utils/smartIntake';

interface CommandPaletteModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeCase: InvestigationCase;
  onSelectModule: (moduleId: ModuleId) => void;
  onQuickCoordinateJump: (lat: number, lon: number, label: string) => void;
  onQuickSanctionsScreen: (name: string) => void;
  onRouteSmartClue?: (action: SmartRouteAction) => void;
}

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = ({
  isOpen,
  onClose,
  activeCase,
  onSelectModule,
  onQuickCoordinateJump,
  onQuickSanctionsScreen,
  onRouteSmartClue,
}) => {
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (isOpen) {
      setQuery('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const q = query.trim().toLowerCase();
  const classified = classifyUniversalIntake(query);

  const matchingEntities = activeCase.entities.filter(
    (e) =>
      e.label.toLowerCase().includes(q) ||
      e.identifier.toLowerCase().includes(q) ||
      e.jurisdiction.toLowerCase().includes(q)
  );

  const matchingDomains = activeCase.infraRecords.filter(
    (d) =>
      d.domain.toLowerCase().includes(q) ||
      (d.asn ?? '').toLowerCase().includes(q) ||
      (d.asnOrg ?? '').toLowerCase().includes(q)
  );

  const sectionLabel = 'mb-2 text-[11px] font-semibold text-ink-3';
  const kbd =
    'shrink-0 rounded border border-line bg-app px-1.5 py-0.5 font-mono text-[10px] text-ink-3';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Quick Jump and Smart Intake Search"
      className="fixed inset-0 z-50 flex items-start justify-center bg-scrim px-4 pt-20 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="panel-enter w-full max-w-xl overflow-hidden rounded-md border border-line bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
          <Search className="h-4 w-4 shrink-0 text-ink-3" />
          <input
            type="text"
            autoFocus
            aria-label="Quick jump search input"
            placeholder="Paste any clue (domain, IP, email, @handle, phone, coords, name) or jump to a module..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && classified?.recommendedActions[0]) {
                const top = classified.recommendedActions[0];
                if (onRouteSmartClue) {
                  onRouteSmartClue(top);
                } else if (
                  classified.kind === 'coordinates' &&
                  top.targetValue.includes(',')
                ) {
                  const [lat, lon] = top.targetValue.split(',').map(Number);
                  onQuickCoordinateJump(
                    lat,
                    lon,
                    `Pinned Coordinates (${lat}, ${lon})`
                  );
                } else if (top.moduleId === 'sanctions') {
                  onQuickSanctionsScreen(top.targetValue);
                } else {
                  onSelectModule(top.moduleId);
                }
                onClose();
              }
            }}
            className="w-full bg-transparent text-sm text-ink placeholder:text-ink-3 focus:outline-none"
          />
          {classified && (
            <span className="shrink-0 rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-accent">
              {classified.badgeLabel}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Quick Jump"
            className="rounded p-1 text-ink-3 hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[420px] space-y-5 overflow-y-auto p-4 text-xs">
          {classified && (
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-accent">
                <Sparkles className="h-3.5 w-3.5" />
                <span>Smart Intake Actions — {classified.summary}</span>
              </div>
              <div className="space-y-1.5">
                {classified.recommendedActions.map((act, idx) => (
                  <button
                    key={act.id}
                    type="button"
                    onClick={() => {
                      if (onRouteSmartClue) {
                        onRouteSmartClue(act);
                      } else if (
                        classified.kind === 'coordinates' &&
                        act.targetValue.includes(',')
                      ) {
                        const [lat, lon] = act.targetValue.split(',').map(Number);
                        onQuickCoordinateJump(
                          lat,
                          lon,
                          `Pinned Coordinates (${lat}, ${lon})`
                        );
                      } else if (act.moduleId === 'sanctions') {
                        onQuickSanctionsScreen(act.targetValue);
                      } else {
                        onSelectModule(act.moduleId);
                      }
                      onClose();
                    }}
                    className="flex w-full items-center justify-between rounded border border-line bg-well p-2.5 text-left text-ink transition-colors hover:border-accent/60"
                  >
                    <span className="font-medium">{act.label}</span>
                    <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase text-accent">
                      {idx === 0 ? '↵ ' : ''}
                      {act.moduleId}
                      <ArrowUpRight className="h-3 w-3" />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className={sectionLabel}>All 9 Investigation Instruments</div>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {MODULE_ORDER.map((id) => {
                const mod = MODULE_CATALOG[id];
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      onSelectModule(id);
                      onClose();
                    }}
                    className="flex items-center justify-between gap-2 rounded border border-line bg-well p-2 text-left text-ink transition-colors hover:border-accent/60"
                  >
                    <span className="truncate font-medium">
                      <span className="mr-1.5 font-mono text-[10px] text-accent">
                        {mod.num}
                      </span>
                      {mod.name}
                    </span>
                    <span className={kbd}>{mod.shortName}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {(matchingEntities.length > 0 || matchingDomains.length > 0) && (
            <div>
              <div className={sectionLabel}>Saved in your workspace</div>
              <div className="space-y-1.5">
                {matchingEntities.slice(0, 3).map((ent) => (
                  <button
                    key={ent.id}
                    type="button"
                    onClick={() => {
                      onSelectModule('dossier');
                      onClose();
                    }}
                    className="flex w-full items-center justify-between rounded border border-line bg-well p-2 text-left transition-colors hover:border-accent/60"
                  >
                    <span className="font-medium text-ink">{ent.label}</span>
                    <span className="font-mono text-[11px] text-ink-3">
                      {ent.identifier}
                    </span>
                  </button>
                ))}
                {matchingDomains.slice(0, 3).map((dom) => (
                  <button
                    key={dom.id}
                    type="button"
                    onClick={() => {
                      onSelectModule('infra');
                      onClose();
                    }}
                    className="flex w-full items-center justify-between rounded border border-line bg-well p-2 text-left font-mono transition-colors hover:border-accent/60"
                  >
                    <span className="text-ink">{dom.domain}</span>
                    <span className="text-[11px] text-ink-3">
                      {dom.aRecords[0]}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
