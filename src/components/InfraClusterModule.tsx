import React, { useEffect, useMemo, useState } from 'react';
import {
  BookmarkPlus,
  Bug,
  Cpu,
  Globe,
  Lock,
  MailCheck,
  Network,
  Radar,
  Server,
  Sparkles,
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
      `Scanning "${cleaned}" — checking DNS records, hosting provider, Shodan open ports, and SSL subdomains...`
    );
    try {
      const record = await scanDomainInfrastructureLive(cleaned);
      onAddInfraRecord(record);
      setSelectedDomainId(record.id);
      setDomainInput('');
      setStatusMessage(
        `Scan complete for ${record.domain}: Hosted at ${record.aRecords[0] || '—'} (${record.asnOrg ?? 'network unknown'}), ${record.shodanData ? `${record.shodanData.ports.length} open ports` : 'exposure data unavailable'}, ${record.ctSubdomainsCount} subdomains found${record.dataGaps.length > 0 ? ` · ${record.dataGaps.length} data gap(s) flagged` : ''}.`
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
      `Checking which lookalike variations of ${selectedRecord.domain} are registered on the internet...`
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
      `Saved infrastructure report for ${selectedRecord.domain} to your Notes.`
    );
  };

  return (
    <div className="space-y-6">
      {/* Step 1: Clean Website & Domain Intake Card */}
      <div className="p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 font-display">
              Website, Domain &amp; Server Scanner
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Enter any website domain to uncover its server IP address, hosting
              provider, registration date, open ports (Shodan), subdomains, and
              lookalike phishing domains.
            </p>
          </div>

          {selectedRecord && (
            <button
              type="button"
              onClick={handleSaveScanToNotes}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <BookmarkPlus className="w-3.5 h-3.5" />
              <span>Save Scan to Notes</span>
            </button>
          )}
        </div>

        <form onSubmit={handleScanSubmit} className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Globe className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                aria-label="Enter website domain to scan"
                placeholder="Enter a website or domain (e.g. cloudflare.com, wikipedia.org, example.org)..."
                value={domainInput}
                onChange={(e) => setDomainInput(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 text-sm font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>
            <button
              type="submit"
              disabled={isScanning}
              className="flex items-center gap-1.5 px-5 py-2.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-500 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Radar className="w-4 h-4" />
              <span>{isScanning ? 'Scanning Website...' : 'Scan Domain'}</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>Try scanning an example:</span>
            {['cloudflare.com', 'wikipedia.org', 'example.org'].map((sample) => (
              <button
                key={sample}
                type="button"
                onClick={() => {
                  setDomainInput(sample);
                  runDomainScan(sample);
                }}
                className="px-2.5 py-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 hover:border-sky-500 rounded-md text-slate-700 dark:text-slate-300 font-mono transition-colors whitespace-nowrap shrink-0"
              >
                {sample}
              </button>
            ))}
          </div>
        </form>

        {statusMessage && (
          <div
            role="status"
            className="px-4 py-2.5 text-xs bg-sky-500/10 border border-sky-500/30 text-sky-800 dark:text-sky-200 rounded-lg flex items-center justify-between"
          >
            <span>{statusMessage}</span>
            <button
              type="button"
              onClick={() => setStatusMessage(null)}
              className="text-xs underline ml-4 whitespace-nowrap shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* Step 2: Empty State or Detailed Scan Breakdown */}
      {!selectedRecord ? (
        <div className="p-10 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-center max-w-2xl mx-auto space-y-3">
          <Server className="w-8 h-8 text-sky-500 mx-auto" />
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
            No Domains Scanned Yet
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Enter any website domain above (or click one of the example buttons)
            to inspect its live DNS records, server IP location, Shodan open
            ports, SSL certificate subdomains, and lookalike phishing domains.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Scanned Domains Switcher Bar (if user scanned multiple domains) */}
          {activeCase.infraRecords.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                Scanned Websites ({activeCase.infraRecords.length}):
              </span>
              {activeCase.infraRecords.map((rec) => (
                <button
                  key={rec.id}
                  type="button"
                  onClick={() => setSelectedDomainId(rec.id)}
                  className={`px-3 py-1.5 text-xs font-mono rounded-lg border transition-colors ${
                    selectedRecord.id === rec.id
                      ? 'bg-sky-600 text-white border-sky-500 font-semibold'
                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-sky-500'
                  }`}
                >
                  {rec.domain}
                </button>
              ))}
            </div>
          )}

          {/* 4-Card Summary Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Server IP &amp; Country
              </div>
              <div className="text-base font-bold text-slate-900 dark:text-slate-100 font-mono tabular-nums mt-1">
                {selectedRecord.aRecords[0] || '—'} ({selectedRecord.ipCountry})
              </div>
              <div className="text-xs text-slate-500 truncate mt-0.5">
                Prefix: {selectedRecord.ripeBgpData?.announcedPrefix || 'BGP data unavailable'}
              </div>
            </div>

            <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Hosting Network (ASN)
              </div>
              <div className="text-base font-bold text-sky-600 dark:text-sky-400 font-mono tabular-nums mt-1 truncate">
                {selectedRecord.asn ?? '—'}
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-400 truncate mt-0.5">
                {selectedRecord.asnOrg ?? 'Network attribution unavailable'}
              </div>
            </div>

            <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Domain Registration
              </div>
              <div className="text-base font-bold text-slate-900 dark:text-slate-100 font-mono tabular-nums mt-1">
                {selectedRecord.createdAt ?? 'unavailable'}
              </div>
              <div className="text-xs text-slate-500 truncate mt-0.5">
                Registrar: {selectedRecord.registrar ?? 'unavailable'}
              </div>
            </div>

            <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Shodan Open Ports &amp; CVEs
              </div>
              <div className="text-base font-bold text-slate-900 dark:text-slate-100 font-mono tabular-nums mt-1">
                {selectedRecord.shodanData
                  ? `${selectedRecord.shodanData.ports.length} Open Ports`
                  : 'N/A'}
              </div>
              <div className="text-xs font-mono mt-0.5">
                {!selectedRecord.shodanData ? (
                  <span className="text-amber-600 dark:text-amber-400">
                    Exposure data unavailable
                  </span>
                ) : selectedRecord.shodanData.vulns.length > 0 ? (
                  <span className="text-rose-600 dark:text-rose-400 font-semibold">
                    {selectedRecord.shodanData.vulns.length} CVEs Detected
                  </span>
                ) : (
                  <span className="text-emerald-600 dark:text-emerald-400">
                    0 Known CVEs Flagged
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Provenance, Data Gaps & Transparent Risk Assessment */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <ProvenanceBadge meta={selectedRecord.provenance} />
              <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                Scanned {selectedRecord.provenance.fetchedAtUtc.slice(0, 10)}
              </span>
            </div>
            {selectedRecord.dataGaps.length > 0 && (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-bold text-amber-700 dark:text-amber-300">
                  <TriangleAlert className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    Data Gaps ({selectedRecord.dataGaps.length}) — shown as gaps,
                    never filled with estimates
                  </span>
                </div>
                <ul className="text-[11px] text-amber-700/90 dark:text-amber-400/90 font-mono list-disc list-inside">
                  {selectedRecord.dataGaps.map((gap) => (
                    <li key={gap}>{gap}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Heuristic Risk Score
                </span>
                <span className="text-base font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {selectedRecord.riskAssessment.score}/100
                </span>
              </div>
              {selectedRecord.riskAssessment.factors.length > 0 ? (
                <ul className="mt-1.5 space-y-0.5">
                  {selectedRecord.riskAssessment.factors.map((f) => (
                    <li
                      key={f.label}
                      className="flex items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-400"
                    >
                      <span>{f.label}</span>
                      <span className="font-mono font-semibold shrink-0">
                        +{f.points}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                  No risk factors triggered by the documented rule table.
                </div>
              )}
              <div className="mt-1.5 text-[10px] text-slate-400 dark:text-slate-500">
                Transparent additive heuristic (see src/utils/riskScore.ts) — a
                triage aid, not a verdict.
              </div>
            </div>
          </div>

          {/* Main 2-Column Technical Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            {/* Left 6 Cols: Server Ports (Shodan), DNS Records & Email Security */}
            <div className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 font-display flex items-center gap-2">
                <Cpu className="w-4 h-4 text-sky-500" />
                <span>
                  Server Exposure, DNS Records &amp; Email Security (
                  {selectedRecord.domain})
                </span>
              </h2>

              {/* Shodan Open Ports & Software */}
              <div className="p-3.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg space-y-2 text-xs">
                <div className="font-semibold text-slate-800 dark:text-slate-200">
                  Open Network Ports (Shodan InternetDB)
                </div>
                <div className="font-mono text-sky-600 dark:text-sky-400 font-semibold">
                  Ports:{' '}
                  {selectedRecord.shodanData
                    ? selectedRecord.shodanData.ports.join(', ') || 'none observed'
                    : 'unavailable (Shodan data gap)'}
                </div>
                {selectedRecord.shodanData?.cpes &&
                  selectedRecord.shodanData.cpes.length > 0 && (
                    <div className="text-slate-500 font-mono text-[11px]">
                      Software: {selectedRecord.shodanData.cpes.join(' · ')}
                    </div>
                  )}
                {selectedRecord.shodanData?.vulns &&
                  selectedRecord.shodanData.vulns.length > 0 && (
                    <div className="pt-1 flex items-center gap-1.5 text-rose-600 dark:text-rose-400 font-mono font-bold">
                      <Bug className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        Vulnerabilities: {selectedRecord.shodanData.vulns.join(', ')}
                      </span>
                    </div>
                  )}
              </div>

              {/* DNS & Email Spoofing Protection */}
              <div className="p-3.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg space-y-2 text-xs">
                <div className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <MailCheck className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Nameservers &amp; Email Anti-Spoofing (DMARC)</span>
                </div>
                <div className="font-mono text-slate-600 dark:text-slate-400">
                  Nameservers: {selectedRecord.nsRecords.join(', ')}
                </div>
                <div className="font-mono text-slate-600 dark:text-slate-400">
                  DMARC Policy: {selectedRecord.dmarcPolicy || 'Not configured'}
                </div>
              </div>

              {/* SSL Certificate & Subdomains */}
              <div className="p-3.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-sky-500" />
                    <span>
                      Discovered Subdomains ({selectedRecord.ctSubdomainsCount})
                    </span>
                  </span>
                  <span className="text-[11px] font-mono text-slate-500">
                    SSL: {selectedRecord.tlsIssuer ?? 'unavailable'}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 font-mono text-sky-600 dark:text-sky-400 pt-1">
                  {selectedRecord.ctSubdomainsSample.map((sub) => (
                    <div key={sub} className="truncate">
                      • {sub}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right 6 Cols: Lookalike & Typosquatting Phishing Detector */}
            <div className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col justify-between space-y-4">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 font-display flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-amber-500" />
                      <span>Lookalike &amp; Phishing Domain Detector</span>
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Checks if attackers have registered similar-looking domains
                      (typos, swapped letters, or `-portal` / `-auth` suffixes).
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleProbeLookalikes}
                    disabled={isProbingTwist}
                    className="px-3 py-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    {isProbingTwist
                      ? 'Checking DNS...'
                      : 'Check Which Lookalikes Are Active'}
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {twistPermutations.slice(0, 10).map((perm) => (
                    <div
                      key={perm.domain}
                      className="p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg flex items-center justify-between gap-2 text-xs font-mono tabular-nums"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {perm.domain}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          Type: {perm.fuzzerType}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {perm.isRegisteredLive === true ? (
                          <span className="text-[11px] font-bold text-rose-600 dark:text-rose-400">
                            REGISTERED ({perm.resolvedIp})
                          </span>
                        ) : perm.isRegisteredLive === false ? (
                          <span className="text-[11px] text-emerald-600 dark:text-emerald-400">
                            Unregistered
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400">
                            {perm.similarityPercent}% Similar
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Shared Infrastructure Correlation if multiple domains scanned */}
              {clusters.length > 0 && activeCase.infraRecords.length > 1 && (
                <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 mb-2">
                    <Network className="w-3.5 h-3.5 text-sky-500" />
                    <span>Shared Hosting &amp; Nameserver Connections</span>
                  </div>
                  <div className="space-y-2">
                    {clusters.map((c) => (
                      <div
                        key={c.clusterId}
                        className="p-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-xs"
                      >
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {c.domains.join(' · ')}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                          {c.sharedSignals.join(' | ')}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
