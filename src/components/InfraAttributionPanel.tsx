import React, { useState } from 'react';
import {
  AlertTriangle,
  ExternalLink,
  Hash,
  Loader2,
  Network,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import type { ModuleId, ProvenanceMeta } from '../types/osint';
import { Button, NoticeBanner, Panel, PivotChip, Well } from './ui';

interface InfraAttributionResult {
  domain: string;
  ip: string | null;
  reverseIpDomains: Array<{ domain: string; pageTitle: string; url: string; asn?: string }>;
  otx: {
    pulseCount: number;
    pulses: Array<{ name: string; tags: string[]; modified: string }>;
    passiveDns: Array<{ address: string; recordType: string; last: string }>;
    available: boolean;
  };
  threatIntel: {
    urlhausStatus: string;
    urlhausUrlsCount: number;
    threatfoxMatches: Array<{ malware: string; threatType: string; confidence: number; ioc: string }>;
  };
  bgpView: {
    prefixes: Array<{ prefix: string; asn: string; name: string; countryCode: string }>;
    rirAllocation: string | null;
  } | null;
  webFingerprint: {
    serverHeader: string | null;
    poweredBy: string | null;
    strictTransportSecurity: boolean;
    contentSecurityPolicy: boolean;
    faviconHash: number | null;
    analyticsIds: Array<{ kind: string; id: string }>;
    shodanFaviconPivotUrl: string | null;
  } | null;
  dataGaps: string[];
  fetchedAtUtc: string;
}

interface InfraAttributionPanelProps {
  domain: string;
  ipHint?: string;
  onScanDomain: (domain: string) => void;
  onCommitLedger: (entry: {
    module: ModuleId;
    targetLabel: string;
    sourceUrl: string;
    findingSummary: string;
    provenance: ProvenanceMeta;
  }) => void;
}

export const InfraAttributionPanel: React.FC<InfraAttributionPanelProps> = ({
  domain,
  ipHint,
  onScanDomain,
  onCommitLedger,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<InfraAttributionResult | null>(null);

  const runDeepAttribution = async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ domain });
      if (ipHint) qs.set('ip', ipHint);
      const res = await fetch(`/api/osint/infra/attribution?${qs.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json as InfraAttributionResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deep attribution failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Panel
      title={`Deep Attribution & Threat Intel — ${domain}`}
      actions={
        <div className="flex items-center gap-2">
          <Button size="sm" variant="primary" onClick={runDeepAttribution} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Probing 6 Feeds…
              </>
            ) : (
              <>
                <Network className="w-3.5 h-3.5" />
                Run Deep Attribution
              </>
            )}
          </Button>
          {data && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                onCommitLedger({
                  module: 'infra',
                  targetLabel: `${domain} Attribution`,
                  sourceUrl: `https://urlscan.io/search/#domain:${domain}`,
                  findingSummary: `Reverse-IP: ${data.reverseIpDomains.length} co-hosted · OTX pulses: ${data.otx.pulseCount} · URLhaus: ${data.threatIntel.urlhausStatus} · ThreatFox: ${data.threatIntel.threatfoxMatches.length} IOC(s) · Favicon hash: ${data.webFingerprint?.faviconHash ?? 'n/a'}`,
                  provenance: {
                    status: 'LIVE',
                    source: 'URLScan + AlienVault OTX + abuse.ch + BGPView + Favicon MMH3',
                    fetchedAtUtc: data.fetchedAtUtc,
                  },
                })
              }
            >
              Log Findings
            </Button>
          )}
        </div>
      }
    >
      {!data && !loading && !error && (
        <p className="text-xs text-muted">
          Run zero-key deep attribution on <span className="font-mono text-ink">{domain}</span>
          {ipHint ? ` (${ipHint})` : ''}: URLScan reverse-IP co-hosted domains, AlienVault OTX passive DNS &amp; threat pulses, abuse.ch URLhaus &amp; ThreatFox IOCs, BGPView prefix allocation, HTTP security headers, Analytics IDs, and Shodan MurmurHash3 favicon hash.
        </p>
      )}
      {error && <NoticeBanner tone="danger">{error}</NoticeBanner>}

      {data && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <Well className="p-2.5 space-y-1">
              <div className="font-mono text-[10px] uppercase text-muted flex items-center gap-1">
                {data.threatIntel.threatfoxMatches.length > 0 || data.otx.pulseCount > 0 ? (
                  <ShieldAlert className="w-3.5 h-3.5 text-danger" />
                ) : (
                  <ShieldCheck className="w-3.5 h-3.5 text-live" />
                )}
                Threat Intel (OTX · URLhaus · ThreatFox)
              </div>
              <div className="font-mono text-xs text-ink">
                OTX Pulses: <span className="font-semibold">{data.otx.pulseCount}</span> · URLhaus:{' '}
                <span>{data.threatIntel.urlhausStatus}</span> ({data.threatIntel.urlhausUrlsCount})
              </div>
              <div className="font-mono text-[10px] text-muted">
                ThreatFox IOCs: {data.threatIntel.threatfoxMatches.length} · Passive DNS rows:{' '}
                {data.otx.passiveDns.length}
              </div>
            </Well>

            <Well className="p-2.5 space-y-1">
              <div className="font-mono text-[10px] uppercase text-muted flex items-center gap-1">
                <Hash className="w-3.5 h-3.5 text-accent" />
                HTTP &amp; Shodan Favicon Fingerprint
              </div>
              {data.webFingerprint ? (
                <>
                  <div className="font-mono text-xs text-ink">
                    Favicon MMH3:{' '}
                    {data.webFingerprint.shodanFaviconPivotUrl ? (
                      <a
                        href={data.webFingerprint.shodanFaviconPivotUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent underline inline-flex items-center gap-0.5"
                      >
                        {data.webFingerprint.faviconHash}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : (
                      <span className="text-muted">n/a</span>
                    )}
                  </div>
                  <div className="font-mono text-[10px] text-muted">
                    Server: {data.webFingerprint.serverHeader || 'hidden'} · HSTS:{' '}
                    {data.webFingerprint.strictTransportSecurity ? 'YES' : 'NO'} · CSP:{' '}
                    {data.webFingerprint.contentSecurityPolicy ? 'YES' : 'NO'}
                  </div>
                </>
              ) : (
                <div className="text-[11px] text-muted">HTTPS fingerprint unreachable</div>
              )}
            </Well>

            <Well className="p-2.5 space-y-1">
              <div className="font-mono text-[10px] uppercase text-muted">
                BGPView Prefix &amp; RIR
              </div>
              {data.bgpView ? (
                <>
                  <div className="font-mono text-xs text-ink truncate">
                    {data.bgpView.rirAllocation || 'RIR unlisted'}
                  </div>
                  <div className="font-mono text-[10px] text-muted truncate">
                    {data.bgpView.prefixes
                      .slice(0, 2)
                      .map((p) => `${p.prefix} (${p.asn})`)
                      .join(' · ') || 'No BGP prefixes'}
                  </div>
                </>
              ) : (
                <div className="text-[11px] text-muted">No IPv4 prefix data</div>
              )}
            </Well>
          </div>

          {data.reverseIpDomains.length > 0 && (
            <Well className="p-3 space-y-2">
              <div className="font-mono text-[10px] uppercase text-muted">
                URLScan Reverse-IP / Co-Hosted Domains ({data.reverseIpDomains.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {data.reverseIpDomains.map((co) => (
                  <PivotChip
                    key={co.domain}
                    label={co.domain}
                    hint={co.pageTitle ? co.pageTitle.slice(0, 22) : 'Scan host'}
                    onClick={() => onScanDomain(co.domain)}
                  />
                ))}
              </div>
            </Well>
          )}

          {data.webFingerprint && data.webFingerprint.analyticsIds.length > 0 && (
            <Well className="p-3 space-y-1.5">
              <div className="font-mono text-[10px] uppercase text-muted">
                Shared Tracking / Analytics IDs (Pivot for Common Ownership)
              </div>
              <div className="flex flex-wrap gap-1.5">
                {data.webFingerprint.analyticsIds.map((t) => (
                  <a
                    key={`${t.kind}:${t.id}`}
                    href={`https://dnslytics.com/reverse-analytics/${encodeURIComponent(t.id)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2 py-0.5 rounded-[2px] border border-accent/40 bg-accent/10 font-mono text-[11px] text-accent hover:bg-accent/20"
                  >
                    {t.kind}: {t.id} ↗
                  </a>
                ))}
              </div>
            </Well>
          )}

          {data.otx.passiveDns.length > 0 && (
            <Well className="p-3 space-y-1.5">
              <div className="font-mono text-[10px] uppercase text-muted">
                AlienVault OTX Historical Passive DNS ({data.otx.passiveDns.length})
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 font-mono text-[10px]">
                {data.otx.passiveDns.slice(0, 9).map((d, i) => (
                  <div key={i} className="p-1.5 rounded-[2px] bg-surface border border-rule">
                    <span className="text-ink">{d.address}</span>{' '}
                    <span className="text-muted">({d.recordType} · {d.last})</span>
                  </div>
                ))}
              </div>
            </Well>
          )}

          {data.dataGaps.length > 0 && (
            <div className="flex items-start gap-1.5 font-mono text-[10px] text-gap">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>Data gaps: {data.dataGaps.join(' · ')}</span>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
};
