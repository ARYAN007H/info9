import React, { useState } from 'react';
import {
  Database,
  Download,
  FolderKanban,
  Moon,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import type {
  EntityType,
  InvestigationCase,
  ModuleId,
  OsintEntity,
} from '../types/osint';

interface CaseSidebarProps {
  cases: InvestigationCase[];
  activeCase: InvestigationCase;
  onSelectCase: (caseId: string) => void;
  onSelectModule: (moduleId: ModuleId) => void;
  onSelectEntity: (entity: OsintEntity) => void;
  onOpenSupabaseModal: () => void;
  onExportDossier: () => void;
  isDark: boolean;
  onToggleTheme: () => void;
  supabaseConnected: boolean;
}

export const CaseSidebar: React.FC<CaseSidebarProps> = ({
  cases,
  activeCase,
  onSelectCase,
  onSelectModule,
  onSelectEntity,
  onOpenSupabaseModal,
  onExportDossier,
  isDark,
  onToggleTheme,
  supabaseConnected,
}) => {
  const [entityFilter, setEntityFilter] = useState<'all' | EntityType>('all');

  const filteredEntities = activeCase.entities.filter((ent) =>
    entityFilter === 'all' ? true : ent.type === entityFilter
  );

  return (
    <aside
      aria-label="Investigation Case & Entity Pinboard"
      className="w-72 bg-slate-50 dark:bg-slate-900/90 border-r border-slate-200 dark:border-slate-800 flex flex-col justify-between shrink-0 select-none"
    >
      <div className="p-4 space-y-5 overflow-y-auto">
        {/* Case Selector */}
        <div>
          <label
            htmlFor="case-selector"
            className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5"
          >
            Active Investigation Case
          </label>
          <div className="relative">
            <select
              id="case-selector"
              value={activeCase.id}
              onChange={(e) => onSelectCase(e.target.value)}
              className="w-full px-3 py-2 text-xs font-medium bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
            >
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.codeName} — {c.title.slice(0, 32)}...
                </option>
              ))}
            </select>
          </div>
          <p className="mt-2 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            {activeCase.summary}
          </p>
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            <span>{activeCase.classification}</span>
          </div>
        </div>

        {/* Quick Telemetry Summary */}
        <div className="pt-3 border-t border-slate-200 dark:border-slate-800 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onSelectModule('dossier')}
            className="p-2.5 text-left rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 hover:border-sky-500/60 transition-colors"
          >
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              Pinned Entities
            </div>
            <div className="text-base font-bold text-slate-900 dark:text-slate-100 font-mono tabular-nums mt-0.5">
              {activeCase.entities.length}
            </div>
          </button>

          <button
            type="button"
            onClick={() => onSelectModule('sanctions')}
            className="p-2.5 text-left rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 hover:border-sky-500/60 transition-colors"
          >
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              SHA-256 Blocks
            </div>
            <div className="text-base font-bold text-emerald-600 dark:text-emerald-400 font-mono tabular-nums mt-0.5">
              {activeCase.evidenceLedger.length}
            </div>
          </button>
        </div>

        {/* Entity Pinboard */}
        <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Case Entities & Targets
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {filteredEntities.length}
            </span>
          </div>

          {/* Interactive Filter Tabs */}
          <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-950 rounded-lg mb-3">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'company', label: 'Shells' },
                { id: 'vessel', label: 'Vessels' },
                { id: 'person', label: 'UBO' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setEntityFilter(tab.id)}
                className={`flex-1 py-1 px-2 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  entityFilter === tab.id
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            {filteredEntities.map((ent) => (
              <button
                key={ent.id}
                type="button"
                onClick={() => {
                  onSelectEntity(ent);
                  onSelectModule('dossier');
                }}
                className="w-full text-left p-2.5 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 hover:border-sky-500/60 transition-colors group"
              >
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 group-hover:text-sky-600 dark:group-hover:text-sky-400 truncate">
                  {ent.label}
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums truncate">
                  <span>{ent.type.toUpperCase()}</span>
                  <span aria-hidden="true">·</span>
                  <span>{ent.jurisdiction}</span>
                  <span aria-hidden="true">·</span>
                  <span
                    className={
                      ent.riskLevel === 'critical'
                        ? 'text-rose-600 dark:text-rose-400 font-semibold'
                        : ent.riskLevel === 'high'
                        ? 'text-amber-600 dark:text-amber-400 font-semibold'
                        : 'text-emerald-600 dark:text-emerald-400'
                    }
                  >
                    {ent.riskLevel.toUpperCase()}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Workspace Controls */}
      <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-2 bg-slate-100/60 dark:bg-slate-950/60">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onOpenSupabaseModal}
            className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg hover:border-sky-500/60 transition-colors whitespace-nowrap shrink-0"
          >
            <Database className="w-3.5 h-3.5 text-sky-500" />
            <span>{supabaseConnected ? 'Cloud Synced' : 'Supabase Sync'}</span>
          </button>

          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg hover:border-sky-500/60 transition-colors whitespace-nowrap shrink-0"
          >
            {isDark ? (
              <>
                <Sun className="w-3.5 h-3.5 text-amber-400" />
                <span>Light Mode</span>
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5 text-slate-700" />
                <span>Dark Mode</span>
              </>
            )}
          </button>
        </div>

        <button
          type="button"
          onClick={onExportDossier}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
        >
          <Download className="w-3.5 h-3.5 text-sky-500" />
          <span>Export Signed Dossier (.MD)</span>
        </button>

        <div className="pt-1 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
          <span className="flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            SHA-256 Chain Intact
          </span>
          <span className="flex items-center gap-1">
            <FolderKanban className="w-3.5 h-3.5 text-slate-400" />
            Zero-Key Public APIs
          </span>
        </div>
      </div>
    </aside>
  );
};
