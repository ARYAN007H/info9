import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  createBlankInvestigationCase,
  parseAndVerifyCaseBundle,
  serializeCaseBundle,
} from './utils/caseBundle';
import type { SmartRouteAction } from './utils/smartIntake';
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
import { FaceReconModule } from './components/FaceReconModule';
import { AcousticDopplerModule } from './components/AcousticDopplerModule';
import { CommandPaletteModal } from './components/CommandPaletteModal';
import { ReportBuilderModal } from './components/ReportBuilderModal';

const STORAGE_KEY = 'argon_osint_workspace_v2';
const MULTI_CASES_KEY = 'argon_osint_cases_multi_v1';

interface MultiCaseStore {
  activeCaseId: string;
  cases: InvestigationCase[];
}

function loadInitialMultiCaseStore(): MultiCaseStore {
  try {
    const multiRaw = localStorage.getItem(MULTI_CASES_KEY);
    if (multiRaw) {
      const parsed = JSON.parse(multiRaw) as MultiCaseStore;
      if (
        parsed &&
        Array.isArray(parsed.cases) &&
        parsed.cases.length > 0 &&
        typeof parsed.activeCaseId === 'string'
      ) {
        return parsed;
      }
    }
    const singleRaw = localStorage.getItem(STORAGE_KEY);
    if (singleRaw) {
      const single = JSON.parse(singleRaw) as InvestigationCase;
      if (single && typeof single === 'object' && single.id) {
        return {
          activeCaseId: single.id,
          cases: [single],
        };
      }
    }
  } catch {
    // Ignore storage parse error
  }
  return {
    activeCaseId: DEFAULT_WORKSPACE_CASE.id,
    cases: [DEFAULT_WORKSPACE_CASE],
  };
}

export function App() {
  const [caseStore, setCaseStore] = useState<MultiCaseStore>(
    loadInitialMultiCaseStore
  );

  const workspaceCase = useMemo(() => {
    return (
      caseStore.cases.find((c) => c.id === caseStore.activeCaseId) ||
      caseStore.cases[0] ||
      DEFAULT_WORKSPACE_CASE
    );
  }, [caseStore]);

  const setWorkspaceCase = useCallback(
    (
      updater:
        | InvestigationCase
        | ((prev: InvestigationCase) => InvestigationCase)
    ) => {
      setCaseStore((prevStore) => {
        const current =
          prevStore.cases.find((c) => c.id === prevStore.activeCaseId) ||
          prevStore.cases[0] ||
          DEFAULT_WORKSPACE_CASE;
        const nextCase =
          typeof updater === 'function' ? updater(current) : updater;
        const exists = prevStore.cases.some((c) => c.id === nextCase.id);
        const nextCases = exists
          ? prevStore.cases.map((c) => (c.id === nextCase.id ? nextCase : c))
          : [nextCase, ...prevStore.cases];
        return {
          activeCaseId: nextCase.id,
          cases: nextCases,
        };
      });
    },
    []
  );

  const [activeModule, setActiveModule] = useState<ModuleId>('geolocation');
  const [selectedEntity, setSelectedEntity] = useState<OsintEntity | null>(
    null
  );
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isReportBuilderOpen, setIsReportBuilderOpen] = useState(false);
  const [isDark, setIsDark] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  // Cross-module Smart Intake & Pivot routing payloads
  const [routedGeoClue, setRoutedGeoClue] = useState<string | undefined>(
    undefined
  );
  const [routedDossierQuery, setRoutedDossierQuery] = useState<
    string | undefined
  >(undefined);
  const [routedInfraDomain, setRoutedInfraDomain] = useState<
    string | undefined
  >(undefined);
  const [routedWaybackUrl, setRoutedWaybackUrl] = useState<string | undefined>(
    undefined
  );
  const [routedIdentityPayload, setRoutedIdentityPayload] = useState<{
    tab: 'username' | 'email' | 'phone';
    value: string;
  } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(MULTI_CASES_KEY, JSON.stringify(caseStore));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(workspaceCase));
    } catch {
      // Ignore quota exceeded
    }
  }, [caseStore, workspaceCase]);

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
        setIsReportBuilderOpen(false);
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
    snapshotDataUrl?: string;
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
        updatedAtUtc: new Date().toISOString(),
        entities: [newEntity, ...prev.entities],
      };
    });
  };

  const handleRemoveEntity = (entityId: string) => {
    setWorkspaceCase((prev) => ({
      ...prev,
      updatedAtUtc: new Date().toISOString(),
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
      updatedAtUtc: new Date().toISOString(),
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
        updatedAtUtc: new Date().toISOString(),
        infraRecords: [record, ...filtered],
      };
    });
  };

  const handleResetWorkspace = () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(MULTI_CASES_KEY);
    setCaseStore({
      activeCaseId: DEFAULT_WORKSPACE_CASE.id,
      cases: [DEFAULT_WORKSPACE_CASE],
    });
    setSelectedEntity(null);
    setToast('Workspace cleared. A fresh case file has been started.');
  };

  const handleSwitchCase = (caseId: string) => {
    setCaseStore((prev) => ({
      ...prev,
      activeCaseId: caseId,
    }));
    setSelectedEntity(null);
  };

  const handleCreateCase = (title?: string) => {
    const cleanTitle =
      title && title.trim().length > 0
        ? title.trim()
        : `Case #${caseStore.cases.length + 1}`;
    const newCase = createBlankInvestigationCase(cleanTitle);
    setCaseStore((prev) => ({
      activeCaseId: newCase.id,
      cases: [newCase, ...prev.cases],
    }));
    setSelectedEntity(null);
    setToast(`Created and switched to "${cleanTitle}".`);
  };

  const handleExportBundle = () => {
    const jsonString = serializeCaseBundle(workspaceCase);
    const blob = new Blob([jsonString], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeSlug = (workspaceCase.title || workspaceCase.id)
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/^-|-$/g, '');
    a.download = `${safeSlug || 'case'}.info9.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setToast(
      `Exported signed case bundle (${workspaceCase.evidenceLedger.length} hash-chained ledger entries).`
    );
  };

  const handleImportBundleFile = async (file: File) => {
    try {
      const rawText = await file.text();
      const verified = parseAndVerifyCaseBundle(rawText);
      const importedCase = verified.caseData;
      setCaseStore((prev) => {
        const filtered = prev.cases.filter((c) => c.id !== importedCase.id);
        return {
          activeCaseId: importedCase.id,
          cases: [importedCase, ...filtered],
        };
      });
      setSelectedEntity(null);
      const statusMsg =
        verified.chainValid && verified.checksumVerified
          ? `Imported "${importedCase.title}" — SHA-256 Merkle chain verified.`
          : `Imported "${importedCase.title}" (${verified.warnings.join('; ') || 'unverified'}).`;
      setToast(statusMsg);
    } catch (err) {
      setToast(
        `Failed to read case bundle: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    }
  };

  const handleRouteSmartClue = useCallback(
    (action: SmartRouteAction) => {
      const val = action.targetValue.trim();
      if (action.moduleId === 'geolocation') {
        const parts = val.split(',').map((s) => Number(s.trim()));
        if (
          parts.length === 2 &&
          Number.isFinite(parts[0]) &&
          Number.isFinite(parts[1])
        ) {
          const [lat, lon] = parts;
          setWorkspaceCase((prev) => ({
            ...prev,
            geoState: {
              ...prev.geoState,
              lat,
              lon,
              locationLabel: `Pinned (${lat.toFixed(5)}, ${lon.toFixed(5)})`,
            },
          }));
        }
        setRoutedGeoClue(val);
      } else if (action.moduleId === 'infra') {
        setRoutedInfraDomain(val);
      } else if (action.moduleId === 'dossier') {
        setRoutedDossierQuery(val);
      } else if (action.moduleId === 'sanctions') {
        setWorkspaceCase((prev) => ({
          ...prev,
          sanctionsQuery: {
            ...prev.sanctionsQuery,
            targetName: val,
          },
        }));
      } else if (action.moduleId === 'forensics') {
        setRoutedWaybackUrl(val);
      } else if (action.moduleId === 'identity') {
        if (action.subMode === 'email' || (val.includes('@') && val.includes('.'))) {
          setRoutedIdentityPayload({ tab: 'email', value: val });
        } else if (
          action.subMode === 'phone' ||
          /^\+?\d[\d\s().-]{5,}$/.test(val)
        ) {
          setRoutedIdentityPayload({ tab: 'phone', value: val });
        } else {
          setRoutedIdentityPayload({
            tab: 'username',
            value: val.replace(/^@/, ''),
          });
        }
      }
      setActiveModule(action.moduleId);
      setToast(`${action.label}: ${val}`);
    },
    [setWorkspaceCase]
  );

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
        onRouteSmartClue={handleRouteSmartClue}
      />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <CaseSpine
          activeCase={workspaceCase}
          cases={caseStore.cases}
          activeModule={activeModule}
          onSelectModule={setActiveModule}
          onResetWorkspace={handleResetWorkspace}
          onSwitchCase={handleSwitchCase}
          onCreateCase={handleCreateCase}
          onExportBundle={handleExportBundle}
          onImportBundleFile={handleImportBundleFile}
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
                initialClue={routedGeoClue}
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
                initialQuery={routedDossierQuery}
                onPivot={handleRouteSmartClue}
              />
            )}

            {activeModule === 'infra' && (
              <InfraClusterModule
                activeCase={workspaceCase}
                onAddInfraRecord={handleAddInfraRecord}
                onAppendLedger={handleAppendLedger}
                initialDomain={routedInfraDomain}
                onRouteSmartClue={handleRouteSmartClue}
              />
            )}

            {activeModule === 'forensics' && (
              <MediaForensicsModule
                activeCase={workspaceCase}
                onAppendLedger={handleAppendLedger}
                initialWaybackUrl={routedWaybackUrl}
              />
            )}

            {activeModule === 'identity' && (
              <IdentitySweepModule
                activeCase={workspaceCase}
                onAppendLedger={handleAppendLedger}
                initialSubMode={routedIdentityPayload?.tab}
                initialValue={routedIdentityPayload?.value}
                onRouteSmartClue={handleRouteSmartClue}
              />
            )}

            {activeModule === 'investigate' && (
              <InvestigationRunModule
                activeCase={workspaceCase}
                onAddInfraRecord={handleAddInfraRecord}
                onAppendLedger={handleAppendLedger}
                onRouteSmartClue={handleRouteSmartClue}
                onSelectModule={setActiveModule}
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
                onPivot={handleRouteSmartClue}
              />
            )}

            {activeModule === 'face' && (
              <FaceReconModule
                activeCase={workspaceCase}
                onAppendLedger={handleAppendLedger}
              />
            )}

            {activeModule === 'acoustic' && (
              <AcousticDopplerModule
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
          </div>
        </main>
      </div>

      <EvidenceDrawer
        entries={workspaceCase.evidenceLedger}
        onExport={handleExportSignedDossier}
        onOpenReportBuilder={() => setIsReportBuilderOpen(true)}
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
        onRouteSmartClue={handleRouteSmartClue}
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

      <ReportBuilderModal
        isOpen={isReportBuilderOpen}
        onClose={() => setIsReportBuilderOpen(false)}
        activeCase={workspaceCase}
      />
    </div>
  );
}

export default App;
