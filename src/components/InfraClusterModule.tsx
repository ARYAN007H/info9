import React, { useEffect, useMemo, useState } from 'react';
import {
  BookmarkPlus,
  Bug,
  Globe,
  MailCheck,
  Lock,
  Network,
  Radar,
  Server,
  TriangleAlert,
} from 'lucide-react';
import type {
  DnsTwistPermutation,
  InfraDomainRecord,
  InvestigationCase,
} from '../types/osint';
import ProvenanceBadge from './ProvenanceBadge';
import {
  clusterInfrastructureDomains,
  generateDnsTwistPermutations,
} from '../utils/osintForensics';
import {
  probeDnsTwistPermutationsLive,
  scanDomainInfrastructureLive,
} from '../services/osintApis';
import { MODULE_CATALOG } from './moduleCatalog';
import {
  Button,
  DataLabel,
  DataValue,
  EmptyState,
  NoticeBanner,
  Panel,
  TextField,
  Well,
} from './ui';

interface InfraClusterModuleProps {
  activeCase: InvestigationCase;
  onAddInfraRecord: (record: InfraDomainRecord) => void;
  onAppendLedger: (entry: {
    module: 'infra';
    targetLabel: string;
    findingSummary: string;
    sourceUrl: string;
  }) => void;
}

export const InfraClusterModule: React.FC<InfraClusterModuleProps> = ({
  activeCase,
  onAddInfraRecord,
  onAppendLedger,
}) => {
  const [domainInput, setDomainInput] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [isProbingTwist, setIsProbingTwist] = useState(false);
  const [selectedDomainId, setSelectedDomainId] = useState<string>(
    activeCase.infraRecords[0]?.id || ''
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [twistPermutations, setTwistPermutations] = useState<
    DnsTwistPermutation[]
  >([]);

  const clusters = useMemo(
    () => clusterInfrastructureDomains(activeCase.infraRecords),
    [activeCase.infraRecords]
  );

  const selectedRecord =
    activeCase.infraRecords.find((r) => r.id === selectedDomainId) ||
    activeCase.infraRecords[0] ||
    null;

  useEffect(() => {
    if (selectedRecord) {
      setTwistPermutations(generateDnsTwistPermutations(selectedRecord.domain));
    }
  }, [selectedRecord?.domain]);

  const runDomainScan = async (rawInput: string) => {
    const cleaned = rawInput.trim();
    if (!cleaned) return;

    setIsScanning(true);
    setStatusMessage(
      `Scanning "${cleaned}" — DNS records, hosting provider, open ports, subdomains…`
    );
    try {
      const record = await scanDomainInfrastructureLive(cleaned);
      onAddInfraRecord(record);
      setSelectedDomainId(record.id);
      setDomainInput('');
      setStatusMessage(
        `Scan complete for ${record.domain}: hosted at ${record.aRecords[0] || '—'} (${record.asnOrg ?? 'network unknown'}), ${record.shodanData ? `${record.shodanData.ports.length} open ports` : 'exposure data unavailable'}, ${record.ctSubdomainsCount} subdomains found${record.dataGaps.length > 0 ? ` · ${record.dataGaps.length} data gap(s) flagged` : ''}.`
      );
    } catch (err) {
      setStatusMessage(
        `Scan error: ${err instanceof Error ? err.message : 'Check domain name'}`
      );
    } finally {
      setIsScanning(false);
    }
  };

  const handleScanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await runDomainScan(domainInput);
  };

  const handleProbeLookalikes = async () => {
    if (!selectedRecord || twistPermutations.length === 0) return;
    setIsProbingTwist(true);
    setStatusMessage(
      `Checking which lookalike variations of ${selectedRecord.domain} are registered…`
    );
    try {
      const probed = await probeDnsTwistPermutationsLive(twistPermutations);
      setTwistPermutations(probed);
      const registeredCount = probed.filter((p) => p.isRegisteredLive).length;
      setStatusMessage(
        `Lookalike check complete: ${registeredCount} of ${probed.length} similar domains are currently active.`
      );
    } catch {
      setStatusMessage('Completed lookalike domain check.');
    } finally {
      setIsProbingTwist(false);
    }
  };

  const handleSaveScanToNotes = () => {
    if (!selectedRecord) return;
    const ports = selectedRecord.shodanData
      ? selectedRecord.shodanData.ports.join(', ')
      : 'unavailable';
    onAppendLedger({
      module: 'infra',
      targetLabel: `${selectedRecord.domain} (${selectedRecord.aRecords[0] || ''})`,
      findingSummary: `Website & IP Scan: IP=${selectedRecord.aRecords.join(', ')}, Host=${selectedRecord.asnOrg ?? 'unknown'} (${selectedRecord.asn ?? 'unknown'}), Open Ports=[${ports}], Subdomains=${selectedRecord.ctSubdomainsCount}.${
        selectedRecord.dataGaps.length > 0
          ? ` Data gaps: ${selectedRecord.dataGaps.join('; ')}.`
          : ''
      }`,
      sourceUrl: `https://internetdb.shodan.io/${encodeURIComponent(
        selectedRecord.aRecords[0] || ''
      )}`,
    });
    setStatusMessage(
      `Infrastructure finding for ${selectedRecord.domain} recorded to the evidence ledger.`
    );
  };

  const isErrorMessage = statusMessage?.startsWith('Scan error');

  return (
    <div className="space-y-4">
      <Panel
        tag={MODULE_CATALOG.infra.num}
        title={MODULE_CATALOG.infra.name}
        description={`${MODULE_CATALOG.infra.job} All lookups are passive — nothing touches the target's servers.`}
        actions={
          selectedRecord ? (
            <Button
              variant="primary"
              size="sm"
              icon={<BookmarkPlus className="h-3.5 w-3.5" />}
              onClick={handleSaveScanToNotes}
            >
              Record finding
            </Button>
          ) : undefined
        }
      >
        <form onSubmit={handleScanSubmit} className="space-y-3">
          <div className="flex items-center gap-2">
            <TextField
              type="text"
              aria-label="Enter website domain to scan"
              placeholder="Website or domain (e.g. cloudflare.com, wikipedia.org, example.org)…"
              value={domainInput}
              onChange={(e) => setDomainInput(e.target.value)}
              icon={<Globe />}
              className="flex-1 font-mono"
            />
            <Button type="submit" variant="primary" disabled={isScanning} icon={<Radar className="h-4 w-4" />}>
              {isScanning ? 'Scanning…' : 'Scan domain'}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
            <span>Try:</span>
            {['cloudflare.com', 'wikipedia.org', 'example.org'].map((sample) => (
              <Button
                key={sample}
                variant="chip"
                onClick={() => {
                  setDomainInput(sample);
                  runDomainScan(sample);
                }}
              >
                {sample}
              </Button>
            ))}
          </div>
        </form>

        {statusMessage && (
          <NoticeBanner
            className="mt-3"
            tone={isErrorMessage ? 'danger' : 'info'}
            onDismiss={() => setStatusMessage(null)}
          >
            {statusMessage}
          </NoticeBanner>
        )}
      </Panel>

      {!selectedRecord ? (
        <Panel>
          <EmptyState
            icon={<Server />}
            title="Nothing scanned yet"
            hint="Enter a domain above — info9 inspects its DNS records, server IP and hosting network, open ports, certificate subdomains, and registered lookalikes."
          />
        </Panel>
      ) : (
        <div className="space-y-4">
          {activeCase.infraRecords.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold text-ink-3">
                Scanned ({activeCase.infraRecords.length}):
              </span>
              {activeCase.infraRecords.map((rec) => {
                const isActive = selectedRecord.id === rec.id;
                return (
                  <button
                    key={rec.id}
                    type="button"
                    onClick={() => setSelectedDomainId(rec.id)}
                    aria-pressed={isActive}
                    className={`rounded border px-2.5 py-1 font-mono text-[11px] transition-colors ${
                      isActive
                        ? 'border-accent/60 bg-accent/10 font-semibold text-ink'
                        : 'border-line bg-well text-ink-2 hover:border-line-strong hover:text-ink'
                    }`}
                  >
                    {rec.domain}
                  </button>
                );
              })}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Well className="p-3">
              <DataLabel>Server IP &amp; country</DataLabel>
              <DataValue className="mt-1 block text-sm font-semibold">
                {selectedRecord.aRecords[0] || '—'} ({selectedRecord.ipCountry})
              </DataValue>
              <div className="mt-0.5 truncate text-[11px] text-ink-3">
                Prefix: {selectedRecord.ripeBgpData?.announcedPrefix || 'BGP data unavailable'}
              </div>
            </Well>

            <Well className="p-3">
              <DataLabel>Hosting network (ASN)</DataLabel>
              <DataValue className="mt-1 block truncate text-sm font-semibold">
                {selectedRecord.asn ?? '—'}
              </DataValue>
              <div className="mt-0.5 truncate text-[11px] text-ink-3">
                {selectedRecord.asnOrg ?? 'Network attribution unavailable'}
              </div>
            </Well>

            <Well className="p-3">
              <DataLabel>Domain registration</DataLabel>
              <DataValue className="mt-1 block text-sm font-semibold">
                {selectedRecord.createdAt ?? 'unavailable'}
              </DataValue>
              <div className="mt-0.5 truncate text-[11px] text-ink-3">
                Registrar: {selectedRecord.registrar ?? 'unavailable'}
              </div>
            </Well>

            <Well className="p-3">
              <DataLabel>Open ports &amp; CVEs</DataLabel>
              <DataValue className="mt-1 block text-sm font-semibold">
                {selectedRecord.shodanData
                  ? `${selectedRecord.shodanData.ports.length} open ports`
                  : 'no data'}
              </DataValue>
              <div className="mt-0.5 font-mono text-[11px]">
                {!selectedRecord.shodanData ? (
                  <span className="text-gap">Exposure data unavailable</span>
                ) : selectedRecord.shodanData.vulns.length > 0 ? (
                  <span className="font-semibold text-danger">
                    {selectedRecord.shodanData.vulns.length} CVEs detected
                  </span>
                ) : (
                  <span className="text-live">0 known CVEs flagged</span>
                )}
              </div>
            </Well>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <ProvenanceBadge meta={selectedRecord.provenance} />
              <DataValue className="text-ink-3">
                Scanned {selectedRecord.provenance.fetchedAtUtc.slice(0, 10)}
              </DataValue>
            </div>
            {selectedRecord.dataGaps.length > 0 && (
              <NoticeBanner
                tone="warn"
                title={`Data gaps (${selectedRecord.dataGaps.length}) —`}
                icon={<TriangleAlert />}
              >
                <span>shown as gaps, never filled with estimates:</span>
                <span className="mt-1 block font-mono text-[11px] text-ink-2">
                  {selectedRecord.dataGaps.join(' · ')}
                </span>
              </NoticeBanner>
            )}
            <Well className="p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-ink">
                  Heuristic risk score
                </span>
                <DataValue className="text-sm font-semibold">
                  {selectedRecord.riskAssessment.score}/100
                </DataValue>
              </div>
              {selectedRecord.riskAssessment.factors.length > 0 ? (
                <ul className="mt-1.5 space-y-0.5">
                  {selectedRecord.riskAssessment.factors.map((f) => (
                    <li
                      key={f.label}
                      className="flex items-center justify-between gap-2 text-[11px] text-ink-2"
                    >
                      <span>{f.label}</span>
                      <DataValue className="shrink-0 font-semibold">
                        +{f.points}
                      </DataValue>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-1 text-[11px] text-live">
                  No risk factors triggered by the documented rule table.
                </div>
              )}
              <div className="mt-1.5 text-[10px] text-ink-3">
                Transparent additive heuristic (see src/utils/riskScore.ts) — a
                triage aid, not a verdict.
              </div>
            </Well>
          </div>

          <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-12">
            <Panel
              className="lg:col-span-6"
              title="Server exposure, DNS & email security"
              bodyClassName="space-y-3"
            >
              <Well className="space-y-2 p-3 text-xs">
                <div className="font-semibold text-ink">
                  Open network ports (Shodan InternetDB)
                </div>
                <DataValue className="block font-semibold">
                  Ports:{' '}
                  {selectedRecord.shodanData
                    ? selectedRecord.shodanData.ports.join(', ') || 'none observed'
                    : 'unavailable (Shodan data gap)'}
                </DataValue>
                {selectedRecord.shodanData?.cpes &&
                  selectedRecord.shodanData.cpes.length > 0 && (
                    <DataValue className="block text-[11px] text-ink-3">
                      Software: {selectedRecord.shodanData.cpes.join(' · ')}
                    </DataValue>
                  )}
                {selectedRecord.shodanData?.vulns &&
                  selectedRecord.shodanData.vulns.length > 0 && (
                    <div className="flex items-center gap-1.5 pt-1 font-mono text-xs font-semibold text-danger">
                      <Bug className="h-3.5 w-3.5 shrink-0" />
                      <span>
                        Vulnerabilities: {selectedRecord.shodanData.vulns.join(', ')}
                      </span>
                    </div>
                  )}
              </Well>

              <Well className="space-y-2 p-3 text-xs">
                <div className="flex items-center gap-1.5 font-semibold text-ink">
                  <MailCheck className="h-3.5 w-3.5 text-ink-3" />
                  <span>Nameservers &amp; email anti-spoofing (DMARC)</span>
                </div>
                <DataValue className="block text-ink-2">
                  Nameservers: {selectedRecord.nsRecords.join(', ')}
                </DataValue>
                <DataValue className="block text-ink-2">
                  DMARC policy: {selectedRecord.dmarcPolicy || 'Not configured'}
                </DataValue>
              </Well>

              <Well className="space-y-2 p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-semibold text-ink">
                    <Lock className="h-3.5 w-3.5 text-ink-3" />
                    <span>
                      Discovered subdomains ({selectedRecord.ctSubdomainsCount})
                    </span>
                  </span>
                  <DataValue className="text-[11px] text-ink-3">
                    SSL: {selectedRecord.tlsIssuer ?? 'unavailable'}
                  </DataValue>
                </div>
                <div className="grid grid-cols-1 gap-1.5 pt-1 font-mono text-xs text-ink-2 sm:grid-cols-2">
                  {selectedRecord.ctSubdomainsSample.map((sub) => (
                    <div key={sub} className="truncate">
                      · {sub}
                    </div>
                  ))}
                </div>
              </Well>
            </Panel>

            <Panel
              className="flex flex-col justify-between lg:col-span-6"
              title="Lookalike & phishing domains"
              description="Checks whether attackers have registered similar-looking domains — typos, swapped letters, or -portal / -auth suffixes."
              actions={
                <Button
                  variant="ghost"
                  size="sm"
                  className="border-gap/40 bg-gap/10 text-gap hover:bg-gap/20"
                  onClick={handleProbeLookalikes}
                  disabled={isProbingTwist}
                >
                  {isProbingTwist ? 'Checking DNS…' : 'Check active lookalikes'}
                </Button>
              }
              bodyClassName="space-y-3"
            >
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {twistPermutations.slice(0, 10).map((perm) => (
                  <div
                    key={perm.domain}
                    className="flex items-center justify-between gap-2 rounded border border-line bg-well p-2.5 font-mono text-xs tabular-nums"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-ink">
                        {perm.domain}
                      </div>
                      <div className="text-[10px] text-ink-3">
                        {perm.fuzzerType}
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-[11px]">
                      {perm.isRegisteredLive === true ? (
                        <span className="font-semibold text-danger">
                          REGISTERED ({perm.resolvedIp})
                        </span>
                      ) : perm.isRegisteredLive === false ? (
                        <span className="text-live">Unregistered</span>
                      ) : (
                        <span className="text-ink-3">
                          {perm.similarityPercent}% similar
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {clusters.length > 0 && activeCase.infraRecords.length > 1 && (
                <div className="border-t border-line pt-3">
                  <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-ink-2">
                    <Network className="h-3.5 w-3.5 text-ink-3" />
                    <span>Shared hosting &amp; nameserver connections</span>
                  </div>
                  <div className="space-y-2">
                    {clusters.map((c) => (
                      <Well key={c.clusterId} className="p-2.5 text-xs">
                        <div className="font-semibold text-ink">
                          {c.domains.join(' · ')}
                        </div>
                        <DataValue className="mt-0.5 block text-[11px] text-ink-3">
                          {c.sharedSignals.join(' | ')}
                        </DataValue>
                      </Well>
                    ))}
                  </div>
                </div>
              )}
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
};
