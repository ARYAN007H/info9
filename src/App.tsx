import React, { useEffect, useState } from 'react';
import { Download, Moon, RotateCcw, Sun } from 'lucide-react';
import type {
  InfraDomainRecord,
  InvestigationCase,
  ModuleId,
  OsintEntity,
  OwnershipEdge,
} from './types/osint';
import { DEFAULT_WORKSPACE_CASE } from './data/seedCases';
import { createLinkedLedgerEntry } from './utils/osintForensics';
import { TopNavBar } from './components/TopNavBar';
import { GeolocationModule } from './components/GeolocationModule';
import { DossierShellModule } from './components/DossierShellModule';
import { InfraClusterModule } from './components/InfraClusterModule';
import { MediaForensicsModule } from './components/MediaForensicsModule';
import { SanctionsLedgerModule } from './components/SanctionsLedgerModule';
import { CommandPaletteModal } from './components/CommandPaletteModal';

const STORAGE_KEY = 'argon_osint_workspace_v2';

export function App() {
  const [workspaceCase, setWorkspaceCase] = useState<InvestigationCase>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object' && parsed.id) {
          return parsed;
        }
      }
    } catch {
      // Ignore storage parse error
    }
    return DEFAULT_WORKSPACE_CASE;
  });

  const [activeModule, setActiveModule] = useState<ModuleId>('geolocation');
  const [selectedEntity, setSelectedEntity] = useState<OsintEntity | null>(
    null
  );
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isDark, setIsDark] = useState(true);
  const [exportBanner, setExportBanner] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(workspaceCase));
    } catch {
      // Ignore quota exceeded
    }
  }, [workspaceCase]);

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [isDark]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      } else if (e.key === 'Escape') {
        setIsCommandPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleAppendLedger = (entryInput: {
    module: ModuleId;
    targetLabel: string;
    findingSummary: string;
    sourceUrl: string;
  }) => {
    setWorkspaceCase((prev) => {
      const nextBlock = createLinkedLedgerEntry(
        prev.evidenceLedger,
        entryInput
      );
      return {
        ...prev,
        updatedAtUtc: new Date().toISOString(),
        evidenceLedger: [...prev.evidenceLedger, nextBlock],
      };
    });
  };

  const handleAddEntity = (newEntity: OsintEntity) => {
    setWorkspaceCase((prev) => {
      if (prev.entities.some((e) => e.id === newEntity.id)) {
        return prev;
      }
      return {
        ...prev,
        entities: [newEntity, ...prev.entities],
      };
    });
  };

  const handleRemoveEntity = (entityId: string) => {
    setWorkspaceCase((prev) => ({
      ...prev,
      entities: prev.entities.filter((e) => e.id !== entityId),
      ownershipEdges: prev.ownershipEdges.filter(
        (edge) => edge.sourceId !== entityId && edge.targetId !== entityId
      ),
    }));
    if (selectedEntity?.id === entityId) {
      setSelectedEntity(null);
    }
  };

  const handleAddOwnershipEdge = (edge: OwnershipEdge) => {
    setWorkspaceCase((prev) => ({
      ...prev,
      ownershipEdges: [...prev.ownershipEdges, edge],
    }));
  };

  const handleAddInfraRecord = (record: InfraDomainRecord) => {
    setWorkspaceCase((prev) => {
      const filtered = prev.infraRecords.filter(
        (r) => r.domain !== record.domain
      );
      return {
        ...prev,
        infraRecords: [record, ...filtered],
      };
    });
  };

  const handleResetWorkspace = () => {
    localStorage.removeItem(STORAGE_KEY);
    setWorkspaceCase(DEFAULT_WORKSPACE_CASE);
    setSelectedEntity(null);
    setExportBanner('Cleared workspace and reset to a fresh state.');
  };

  const handleExportSignedDossier = () => {
    const lines: string[] = [
      `# OSINT INVESTIGATION REPORT`,
      `**Generated (UTC):** ${new Date().toISOString()}`,
      '',
      `## 1. Pinned Map Location`,
      `- **Location:** ${workspaceCase.geoState.locationLabel} (${workspaceCase.geoState.lat}, ${workspaceCase.geoState.lon})`,
      `- **Date & Elevation:** ${workspaceCase.geoState.dateIso} · ${
        workspaceCase.geoState.weatherVerification?.elevationMeters != null
          ? `${workspaceCase.geoState.weatherVerification.elevationMeters}m ASL`
          : 'elevation not verified (no weather data recorded)'
      }`,
      '',
      `## 2. Saved People & Companies (${workspaceCase.entities.length})`,
      ...(workspaceCase.entities.length === 0
        ? ['- None saved yet']
        : workspaceCase.entities.map(
            (e) =>
              `- **${e.label}** [${e.type.toUpperCase()} · ${e.jurisdiction} · ${e.identifier}] — ${e.summary}`
          )),
      '',
      `## 3. Scanned Websites & Domains (${workspaceCase.infraRecords.length})`,
      ...(workspaceCase.infraRecords.length === 0
        ? ['- None scanned yet']
        : workspaceCase.infraRecords.map(
            (d) =>
              `- **${d.domain}** · IP: ${d.aRecords.join(', ') || 'none'} · Host: ${d.asn ?? 'unknown'} (${d.asnOrg ?? 'unknown'}) · SSL: ${d.tlsIssuer ?? 'unknown'}${
                d.dataGaps.length > 0 ? ` · Data gaps: ${d.dataGaps.join('; ')}` : ''
              }`
          )),
      '',
      `## 4. Saved Investigation Notes (${workspaceCase.evidenceLedger.length})`,
      ...(workspaceCase.evidenceLedger.length === 0
        ? ['- No notes recorded yet']
        : workspaceCase.evidenceLedger.map(
            (b) =>
              `- **Note #${b.index}** [${b.timestampUtc}] (${b.module.toUpperCase()}) **${b.targetLabel}**: ${b.findingSummary}\n  - SHA-256 Verification Hash: \`${b.sha256Hash}\``
          )),
    ];

    const blob = new Blob([lines.join('\n')], {
      type: 'text/markdown;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `osint-investigation-report.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setExportBanner(
      `Downloaded Markdown report (osint-investigation-report.md).`
    );
  };

  return (
    <div
      id="top"
      className="min-h-screen flex flex-col bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100"
    >
      {/* Strict 3-Zone Top Bar Contract */}
      <TopNavBar
        activeModule={activeModule}
        onSelectModule={setActiveModule}
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
      />

      {/* Clean Full-Width Workspace Container (No Cluttered Demo Case Sidebar) */}
      <main className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-[1240px] mx-auto space-y-5">
          {/* Sleek Workspace Status & Utility Bar */}
          <div className="px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl flex flex-wrap items-center justify-between gap-4 text-xs">
            <div className="flex flex-wrap items-center gap-3 text-slate-600 dark:text-slate-400">
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                Your Investigation Workspace
              </span>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                onClick={() => setActiveModule('dossier')}
                className="hover:text-sky-500 transition-colors font-mono tabular-nums"
              >
                {workspaceCase.entities.length} Saved Profiles
              </button>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                onClick={() => setActiveModule('infra')}
                className="hover:text-sky-500 transition-colors font-mono tabular-nums"
              >
                {workspaceCase.infraRecords.length} Scanned Domains
              </button>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                onClick={() => setActiveModule('sanctions')}
                className="hover:text-sky-500 transition-colors font-mono tabular-nums"
              >
                {workspaceCase.evidenceLedger.length} Saved Notes
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleExportSignedDossier}
                className="flex items-center gap-1.5 px-3 py-1.5 font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5 text-sky-500" />
                <span>Download Report (.MD)</span>
              </button>

              <button
                type="button"
                onClick={handleResetWorkspace}
                className="flex items-center gap-1.5 px-3 py-1.5 font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 bg-slate-100 dark:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>

              <button
                type="button"
                onClick={() => setIsDark((d) => !d)}
                aria-label={
                  isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'
                }
                className="flex items-center gap-1.5 px-3 py-1.5 font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                {isDark ? (
                  <>
                    <Sun className="w-3.5 h-3.5 text-amber-400" />
                    <span>Light</span>
                  </>
                ) : (
                  <>
                    <Moon className="w-3.5 h-3.5 text-slate-700" />
                    <span>Dark</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {exportBanner && (
            <div
              role="status"
              className="px-4 py-2.5 text-xs bg-emerald-500/15 border border-emerald-500/30 text-emerald-800 dark:text-emerald-200 rounded-lg flex items-center justify-between"
            >
              <span>{exportBanner}</span>
              <button
                type="button"
                onClick={() => setExportBanner(null)}
                className="underline ml-4"
              >
                Dismiss
              </button>
            </div>
          )}

          {activeModule === 'geolocation' && (
            <GeolocationModule
              activeCase={workspaceCase}
              onUpdateGeoState={(geoUpdater) =>
                setWorkspaceCase((prev) => ({
                  ...prev,
                  geoState: geoUpdater(prev.geoState),
                }))
              }
              onAppendLedger={handleAppendLedger}
            />
          )}

          {activeModule === 'dossier' && (
            <DossierShellModule
              activeCase={workspaceCase}
              selectedEntity={selectedEntity}
              onSelectEntity={setSelectedEntity}
              onAddEntity={handleAddEntity}
              onRemoveEntity={handleRemoveEntity}
              onAddOwnershipEdge={handleAddOwnershipEdge}
              onPivotToSanctions={(entityName, jurisdiction) => {
                setWorkspaceCase((prev) => ({
                  ...prev,
                  sanctionsQuery: {
                    ...prev.sanctionsQuery,
                    targetName: entityName,
                    targetJurisdiction: jurisdiction,
                  },
                }));
                setActiveModule('sanctions');
              }}
              onAppendLedger={handleAppendLedger}
            />
          )}

          {activeModule === 'infra' && (
            <InfraClusterModule
              activeCase={workspaceCase}
              onAddInfraRecord={handleAddInfraRecord}
              onAppendLedger={handleAppendLedger}
            />
          )}

          {activeModule === 'forensics' && (
            <MediaForensicsModule
              activeCase={workspaceCase}
              onAppendLedger={handleAppendLedger}
            />
          )}

          {activeModule === 'sanctions' && (
            <SanctionsLedgerModule
              activeCase={workspaceCase}
              onUpdateSanctionsQuery={(newQuery) =>
                setWorkspaceCase((prev) => ({
                  ...prev,
                  sanctionsQuery: {
                    ...prev.sanctionsQuery,
                    ...newQuery,
                  },
                }))
              }
              onAppendLedger={handleAppendLedger}
              onExportMarkdown={handleExportSignedDossier}
            />
          )}
        </div>
      </main>

      {/* Global Quick Jump Modal (⌘K) */}
      <CommandPaletteModal
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        activeCase={workspaceCase}
        onSelectModule={setActiveModule}
        onQuickCoordinateJump={(lat, lon, label) => {
          setWorkspaceCase((prev) => ({
            ...prev,
            geoState: {
              ...prev.geoState,
              lat,
              lon,
              locationLabel: label,
            },
          }));
          setActiveModule('geolocation');
        }}
        onQuickSanctionsScreen={(name) => {
          setWorkspaceCase((prev) => ({
            ...prev,
            sanctionsQuery: {
              ...prev.sanctionsQuery,
              targetName: name,
            },
          }));
          setActiveModule('sanctions');
        }}
      />
    </div>
  );
}

export default App;
