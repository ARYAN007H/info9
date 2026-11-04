import React from 'react';
import type { ModuleId } from '../types/osint';

interface TopNavBarProps {
  activeModule: ModuleId;
  onSelectModule: (moduleId: ModuleId) => void;
  onOpenCommandPalette: () => void;
}

const NAV_ITEMS: Array<{ id: ModuleId; label: string }> = [
  { id: 'geolocation', label: 'Geolocate' },
  { id: 'dossier', label: 'People & Companies' },
  { id: 'infra', label: 'Website & IP' },
  { id: 'forensics', label: 'Photo Forensics' },
  { id: 'sanctions', label: 'Watchlist & Notes' },
];

export const TopNavBar: React.FC<TopNavBarProps> = ({
  activeModule,
  onSelectModule,
  onOpenCommandPalette,
}) => {
  return (
    <header className="flex items-center justify-between gap-8 px-6 py-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shrink-0">
      {/* Zone 1: Single text element wordmark */}
      <a
        href="#top"
        onClick={(e) => {
          e.preventDefault();
          onSelectModule('geolocation');
        }}
        className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0 font-display"
      >
        Argon OSINT
      </a>

      {/* Zone 2: 5 clean single-line text navigation links */}
      <nav
        aria-label="OSINT Investigation Tools"
        className="flex items-center gap-7 text-sm font-medium text-slate-600 dark:text-slate-400 overflow-x-auto"
      >
        {NAV_ITEMS.map((item) => {
          const isActive = activeModule === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectModule(item.id)}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                isActive
                  ? 'text-sky-600 dark:text-sky-400 border-sky-500 font-semibold'
                  : 'border-transparent hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Zone 3: 1 primary action */}
      <div className="flex items-center shrink-0">
        <button
          type="button"
          onClick={onOpenCommandPalette}
          className="px-4 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-500 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          Quick Jump ⌘K
        </button>
      </div>
    </header>
  );
};
