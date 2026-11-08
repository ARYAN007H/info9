import React, { useEffect, useState } from 'react';
import { Download, FolderPlus, Upload } from 'lucide-react';
import type { InvestigationCase, ModuleId } from '../types/osint';
import { MODULE_CATALOG, MODULE_ORDER } from './moduleCatalog';
import { formatFetchedAt } from '../utils/provenance';
import { Button, SelectField, TextField } from './ui';

interface CaseSpineProps {
  activeCase: InvestigationCase;
  cases?: InvestigationCase[];
  activeModule: ModuleId;
  onSelectModule: (moduleId: ModuleId) => void;
  onResetWorkspace: () => void;
  onSwitchCase?: (caseId: string) => void;
  onCreateCase?: (title: string) => void;
  onExportBundle?: () => void;
  onImportBundleFile?: (file: File) => void;
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
    investigate:
      activeCase.entities.length +
      activeCase.infraRecords.length +
      activeCase.evidenceLedger.length,
    sanctions: activeCase.evidenceLedger.filter(
      (entry) => entry.module === 'sanctions'
    ).length,
    face: activeCase.evidenceLedger.filter((entry) => entry.module === 'face')
      .length,
    acoustic: activeCase.evidenceLedger.filter(
      (entry) => entry.module === 'acoustic'
    ).length,
  };
}

/**
 * Case spine: multi-case switcher, portable .info9.json bundle import/export,
 * module index 01–09, and workspace reset.
 */
export function CaseSpine({
  activeCase,
  cases = [activeCase],
  activeModule,
  onSelectModule,
  onResetWorkspace,
  onSwitchCase,
  onCreateCase,
  onExportBundle,
  onImportBundleFile,
}: CaseSpineProps) {
  const [armReset, setArmReset] = useState(false);
  const [creatingNew, setCreatingNew] = useState(false);
  const [newCaseTitle, setNewCaseTitle] = useState('');
  const counts = moduleCounts(activeCase);

  useEffect(() => {
    if (!armReset) return;
    const t = setTimeout(() => setArmReset(false), 3000);
    return () => clearTimeout(t);
  }, [armReset]);

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCaseTitle.trim() || !onCreateCase) return;
    onCreateCase(newCaseTitle.trim());
    setNewCaseTitle('');
    setCreatingNew(false);
  };

  return (
    <aside className="flex shrink-0 flex-col border-b border-line bg-panel lg:w-64 lg:border-b-0 lg:border-r">
      <div className="hidden border-b border-line px-4 py-3.5 lg:block">
        <div className="flex items-center justify-between">
          <span className="signage text-[9px] font-semibold text-ink-3">
            Case file ({cases.length})
          </span>
          {onCreateCase && (
            <button
              type="button"
              onClick={() => setCreatingNew((v) => !v)}
              title="Create a new investigation case"
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-accent hover:bg-well"
            >
              <FolderPlus className="h-3 w-3" />
              <span>New</span>
            </button>
          )}
        </div>

        {creatingNew ? (
          <form onSubmit={handleCreateSubmit} className="mt-2 space-y-1.5">
            <TextField
              type="text"
              placeholder="Case name (e.g. Baltic Tankers)"
              value={newCaseTitle}
              onChange={(e) => setNewCaseTitle(e.target.value)}
              className="h-7 text-xs"
            />
            <div className="flex gap-1">
              <Button type="submit" size="sm" variant="primary" className="h-7 flex-1 text-[11px]">
                Create
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 text-[11px]"
                onClick={() => setCreatingNew(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : cases.length > 1 && onSwitchCase ? (
          <div className="mt-1.5">
            <SelectField
              aria-label="Switch active investigation case"
              value={activeCase.id}
              onChange={(e) => onSwitchCase(e.target.value)}
              className="h-8 w-full font-mono text-xs"
            >
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.codeName} — {c.title}
                </option>
              ))}
            </SelectField>
          </div>
        ) : (
          <div className="mt-1.5 font-mono text-sm font-semibold text-ink">
            {activeCase.codeName}
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center justify-between gap-1">
          <span className="inline-flex items-center rounded border border-line px-1.5 py-0.5 text-[10px] font-medium text-ink-2">
            {activeCase.classification}
          </span>
          <span
            className="font-mono text-[10px] tabular-nums text-ink-3"
            title={activeCase.updatedAtUtc}
          >
            {formatFetchedAt(activeCase.updatedAtUtc)}
          </span>
        </div>

        {(onExportBundle || onImportBundleFile) && (
          <div className="mt-2.5 grid grid-cols-2 gap-1.5 pt-1">
            {onExportBundle && (
              <Button
                size="sm"
                variant="solid"
                onClick={onExportBundle}
                title="Export signed .info9.json case bundle with SHA-256 Merkle root"
                className="h-7 justify-center text-[11px]"
              >
                <Download className="h-3 w-3" />
                <span>.info9 export</span>
              </Button>
            )}
            {onImportBundleFile && (
              <label
                title="Import and verify a .info9.json case bundle"
                className="inline-flex h-7 cursor-pointer items-center justify-center gap-1 rounded border border-line bg-well px-2 text-[11px] font-medium text-ink transition-colors hover:border-line-strong"
              >
                <Upload className="h-3 w-3 text-ink-3" />
                <span>Import</span>
                <input
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      onImportBundleFile(file);
                      e.target.value = '';
                    }
                  }}
                />
              </label>
            )}
          </div>
        )}
      </div>

      <nav
        aria-label="Investigation modules"
        className="flex gap-1 overflow-x-auto px-2 py-2 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-0 lg:py-2.5"
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
        <p className="px-1 pt-1 text-[10px] leading-4 text-ink-3">
          Zero-key · local-first · AGPL-3.0
        </p>
      </div>
    </aside>
  );
}
