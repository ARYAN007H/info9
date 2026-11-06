import React, { useEffect, useState } from 'react';
import {
  Building2,
  Compass,
  Globe,
  ScanEye,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';
import type { InvestigationCase, ModuleId } from '../types/osint';

interface CommandPaletteModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeCase: InvestigationCase;
  onSelectModule: (moduleId: ModuleId) => void;
  onQuickCoordinateJump: (lat: number, lon: number, label: string) => void;
  onQuickSanctionsScreen: (name: string) => void;
}

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = ({
  isOpen,
  onClose,
  activeCase,
  onSelectModule,
  onQuickCoordinateJump,
  onQuickSanctionsScreen,
}) => {
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (isOpen) {
      setQuery('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const q = query.trim().toLowerCase();

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

  const coordMatch = query
    .trim()
    .match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);

  const sectionLabel =
    'mb-2 text-[11px] font-semibold text-ink-3';
  const kbd =
    'shrink-0 rounded border border-line bg-app px-1.5 py-0.5 font-mono text-[10px] text-ink-3';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Quick Jump and Search"
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
            placeholder="Jump to a tool, enter coordinates (e.g. 51.5074, -0.1278), or screen a name..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-transparent text-sm text-ink focus:outline-none placeholder:text-ink-3"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Quick Jump"
            className="rounded p-1 text-ink-3 hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[400px] space-y-5 overflow-y-auto p-4 text-xs">
          {coordMatch && (
            <div>
              <div className={sectionLabel}>Jump to map coordinates</div>
              <button
                type="button"
                onClick={() => {
                  const lat = parseFloat(coordMatch[1]);
                  const lon = parseFloat(coordMatch[2]);
                  onQuickCoordinateJump(
                    lat,
                    lon,
                    `Pinned Coordinates (${lat}, ${lon})`
                  );
                  onClose();
                }}
                className="flex w-full items-center justify-between rounded border border-accent/35 bg-accent/10 p-2.5 text-left font-mono text-accent transition-colors hover:bg-accent/15"
              >
                <span>
                  Pin map at {coordMatch[1]}°, {coordMatch[2]}°
                </span>
                <span className={kbd}>↵</span>
              </button>
            </div>
          )}

          {q.length >= 3 && !coordMatch && (
            <div>
              <div className={sectionLabel}>Quick watchlist screening</div>
              <button
                type="button"
                onClick={() => {
                  onQuickSanctionsScreen(query.trim());
                  onClose();
                }}
                className="flex w-full items-center justify-between rounded border border-gap/35 bg-gap/10 p-2.5 text-left transition-colors hover:bg-gap/15"
              >
                <span className="flex items-center gap-2 font-medium text-gap">
                  <ShieldAlert className="h-4 w-4 shrink-0" />
                  <span>
                    Screen &ldquo;{query.trim()}&rdquo; in watchlist tool
                  </span>
                </span>
                <span className={kbd}>Go →</span>
              </button>
            </div>
          )}

          <div>
            <div className={sectionLabel}>Investigation tools</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(
                [
                  {
                    id: 'geolocation',
                    label: 'Geolocate (photo, phone, IP, place)',
                    icon: Compass,
                  },
                  {
                    id: 'dossier',
                    label: 'People & companies lookup',
                    icon: Building2,
                  },
                  {
                    id: 'infra',
                    label: 'Website & IP scanner',
                    icon: Globe,
                  },
                  {
                    id: 'forensics',
                    label: 'Photo authenticity & EXIF',
                    icon: ScanEye,
                  },
                  {
                    id: 'sanctions',
                    label: 'Watchlist & saved notes',
                    icon: ShieldAlert,
                  },
                ] as const
              ).map((mod) => {
                const Icon = mod.icon;
                return (
                  <button
                    key={mod.id}
                    type="button"
                    onClick={() => {
                      onSelectModule(mod.id);
                      onClose();
                    }}
                    className="flex items-center gap-2.5 rounded border border-line bg-well p-2.5 text-left text-ink transition-colors hover:border-accent/60"
                  >
                    <Icon className="h-4 w-4 shrink-0 text-ink-3" />
                    <span className="font-medium">{mod.label}</span>
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
