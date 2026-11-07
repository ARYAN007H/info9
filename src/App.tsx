import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type {
  InfraDomainRecord,
  InvestigationCase,
  ModuleId,
  OsintEntity,
  OwnershipEdge,
} from './types/osint';
import { DEFAULT_WORKSPACE_CASE } from './data/seedCases';
import { createLinkedLedgerEntry, exportMispJson } from './utils/osintForensics';
import { buildPrintableReportHtml } from './utils/reportGenerator';
import { TopNavBar, type ProvenanceTally } from './components/TopNavBar';
import { CaseSpine } from './components/CaseSpine';
import { EvidenceDrawer } from './components/EvidenceDrawer';
import { GeolocationModule } from './components/GeolocationModule';
import { DossierShellModule } from './components/DossierShellModule';
import { InfraClusterModule } from './components/InfraClusterModule';
import { MediaForensicsModule } from './components/MediaForensicsModule';
import { IdentitySweepModule } from './components/IdentitySweepModule';
import { InvestigationRunModule } from './components/InvestigationRunModule';
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
  const [toast, setToast] = useState<string | null>(null);

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
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

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

  /**
   * Case-wide provenance headline: counts every recorded provenance envelope
   * and every named data gap, so the bench states what is known and what is
   * missing before the analyst reads a single panel.
   */
  const provenanceTally: ProvenanceTally = useMemo(() => {
    let live = 0;
    let derived = 0;
    let gap = 0;
    for (const rec of workspaceCase.infraRecords as InfraDomainRecord[]) {
      if (rec.provenance?.status === 'LIVE') live += 1;
      else if (rec.provenance?.status === 'DERIVED') derived += 1;
      gap += rec.dataGaps.length;
    }
    const weather = workspaceCase.geoState.weatherVerification;
    if (weather) {
      if (weather.provenance?.status === 'LIVE') live += 1;
      else if (weather.provenance?.status === 'DERIVED') derived += 1;
      else gap += 1;
      if (weather.elevationMeters == null) gap += 1;
    }
    return { live, derived, gap };
  }, [workspaceCase]);

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
    setToast('Workspace cleared. A fresh case file has been started.');
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

    setToast('Case report downloaded as osint-investigation-report.md.');
  };

  return (
    <div
      id="top"
      className="flex h-dvh flex-col overflow-hidden bg-app text-ink"
    >
      <TopNavBar
        provenanceTally={provenanceTally}
        isDark={isDark}
        onToggleTheme={() => setIsDark((d) => !d)}
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
      />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <CaseSpine
          activeCase={workspaceCase}
          activeModule={activeModule}
          onSelectModule={setActiveModule}
          onResetWorkspace={handleResetWorkspace}
        />

        <main className="min-w-0 flex-1 overflow-y-auto">
          {/* Remounting on module switch gives the single orchestrated
              motion moment: the instrument's panels resolve in. */}
          <div
            key={activeModule}
            className="panel-enter mx-auto max-w-[1500px] space-y-4 px-4 py-5 sm:px-5"
          >
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

            {activeModule === 'identity' && (
              <IdentitySweepModule
                activeCase={workspaceCase}
                onAppendLedger={handleAppendLedger}
              />
            )}

            {activeModule === 'investigate' && (
              <InvestigationRunModule
                activeCase={workspaceCase}
                onAddInfraRecord={handleAddInfraRecord}
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
      </div>

      <EvidenceDrawer
        entries={workspaceCase.evidenceLedger}
        onExport={handleExportSignedDossier}
        onPrintReport={() => {
          const html = buildPrintableReportHtml(workspaceCase);
          const iframe = document.createElement('iframe');
          iframe.setAttribute('aria-hidden', 'true');
          iframe.style.position = 'fixed';
          iframe.style.right = '0';
          iframe.style.bottom = '0';
          iframe.style.width = '0';
          iframe.style.height = '0';
          iframe.style.border = '0';
          iframe.srcdoc = html;
          iframe.onload = () => {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
          };
          document.body.appendChild(iframe);
          setToast('Dossier ready — choose "Save as PDF" in the print dialog.');
          window.setTimeout(() => iframe.remove(), 60_000);
        }}
        onExportMisp={() => {
          const jsonString = exportMispJson(workspaceCase);
          const blob = new Blob([jsonString], {
            type: 'application/json;charset=utf-8',
          });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = 'osint-investigation-misp-event.json';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
          setToast('MISP 2.4 event JSON downloaded (built from recorded artifacts only).');
        }}
      />

      {toast && (
        <div
          role="status"
          className="panel-enter fixed right-4 top-16 z-40 flex max-w-md items-center gap-3 rounded-md border border-line bg-panel px-3.5 py-2.5 text-xs text-ink shadow-xl"
        >
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-live"
          />
          {toast}
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Dismiss notification"
            className="text-ink-3 hover:text-ink"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

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
