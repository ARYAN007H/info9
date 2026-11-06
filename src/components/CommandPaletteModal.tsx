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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Quick Jump and Search"
      className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-start justify-center pt-20 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center gap-3">
          <Search className="w-4 h-4 text-sky-500 shrink-0" />
          <input
            type="text"
            autoFocus
            aria-label="Quick jump search input"
            placeholder="Jump to a tool, enter coordinates (e.g. 51.5074, -0.1278), or screen a name..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full text-sm bg-transparent text-slate-900 dark:text-slate-100 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Quick Jump"
            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 max-h-[400px] overflow-y-auto space-y-5 text-xs">
          {coordMatch && (
            <div>
              <div className="text-[11px] font-semibold text-sky-500 mb-1.5">
                Jump to Map Coordinates
              </div>
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
                className="w-full p-2.5 bg-sky-500/10 border border-sky-500/30 rounded-lg text-left flex items-center justify-between text-sky-700 dark:text-sky-300 font-mono"
              >
                <span>
                  Pin Map at {coordMatch[1]}°, {coordMatch[2]}°
                </span>
                <span>Enter ↵</span>
              </button>
            </div>
          )}

          {q.length >= 3 && !coordMatch && (
            <div>
              <div className="text-[11px] font-semibold text-amber-500 mb-1.5">
                Quick Watchlist Screening
              </div>
              <button
                type="button"
                onClick={() => {
                  onQuickSanctionsScreen(query.trim());
                  onClose();
                }}
                className="w-full p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg text-left flex items-center justify-between text-amber-700 dark:text-amber-300"
              >
                <span className="flex items-center gap-2 font-medium">
                  <ShieldAlert className="w-4 h-4" />
                  <span>
                    Screen &ldquo;{query.trim()}&rdquo; in Watchlist Tool
                  </span>
                </span>
                <span className="font-mono">Go →</span>
              </button>
            </div>
          )}

          <div>
            <div className="text-[11px] font-semibold text-slate-400 mb-2">
              Investigation Tools
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {(
                [
                  {
                    id: 'geolocation',
                    label: 'Geolocate (Photo, Phone, IP, Place)',
                    icon: Compass,
                  },
                  {
                    id: 'dossier',
                    label: 'People & Companies Lookup',
                    icon: Building2,
                  },
                  {
                    id: 'infra',
                    label: 'Website & IP Scanner',
                    icon: Globe,
                  },
                  {
                    id: 'forensics',
                    label: 'Photo Authenticity & EXIF',
                    icon: ScanEye,
                  },
                  {
                    id: 'sanctions',
                    label: 'Watchlist & Saved Notes',
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
                    className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 hover:border-sky-500 text-left flex items-center gap-2.5 text-slate-800 dark:text-slate-200 transition-colors"
                  >
                    <Icon className="w-4 h-4 text-sky-500 shrink-0" />
                    <span className="font-medium">{mod.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {(matchingEntities.length > 0 || matchingDomains.length > 0) && (
            <div>
              <div className="text-[11px] font-semibold text-slate-400 mb-2">
                Saved in Your Workspace
              </div>
              <div className="space-y-1.5">
                {matchingEntities.slice(0, 3).map((ent) => (
                  <button
                    key={ent.id}
                    type="button"
                    onClick={() => {
                      onSelectModule('dossier');
                      onClose();
                    }}
                    className="w-full p-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 hover:border-sky-500 text-left flex items-center justify-between"
                  >
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {ent.label}
                    </span>
                    <span className="font-mono text-[11px] text-sky-500">
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
                    className="w-full p-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 hover:border-sky-500 text-left flex items-center justify-between font-mono"
                  >
                    <span className="text-slate-900 dark:text-slate-100">
                      {dom.domain}
                    </span>
                    <span className="text-[11px] text-sky-500">
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
