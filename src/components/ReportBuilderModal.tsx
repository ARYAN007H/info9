import React, { useMemo, useState } from 'react';
import { Download, EyeOff, Printer, ShieldCheck, X } from 'lucide-react';
import type { InvestigationCase } from '../types/osint';
import {
  buildRedactedCaseClone,
  type RedactionConfig,
} from '../utils/reportRedactor';
import { buildPrintableReportHtml } from '../utils/reportGenerator';
import { Button, DataLabel, DataValue, FieldLabel, TextField, Well } from './ui';

interface ReportBuilderModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeCase: InvestigationCase;
}

export const ReportBuilderModal: React.FC<ReportBuilderModalProps> = ({
  isOpen,
  onClose,
  activeCase,
}) => {
  const [redactEmails, setRedactEmails] = useState(false);
  const [redactPhones, setRedactPhones] = useState(false);
  const [redactIps, setRedactIps] = useState(false);
  const [customTermsRaw, setCustomTermsRaw] = useState('');
  const [executiveNote, setExecutiveNote] = useState('');

  const config: RedactionConfig = useMemo(
    () => ({
      redactEmails,
      redactPhones,
      redactIps,
      customTerms: customTermsRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      executiveNote,
    }),
    [redactEmails, redactPhones, redactIps, customTermsRaw, executiveNote]
  );

  const redactedCase = useMemo(
    () => buildRedactedCaseClone(activeCase, config),
    [activeCase, config]
  );

  if (!isOpen) return null;

  const snapshotCount = activeCase.evidenceLedger.filter(
    (e) => Boolean(e.snapshotDataUrl)
  ).length;

  const handlePrintRedactedPdf = () => {
    const html = buildPrintableReportHtml(redactedCase);
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
    window.setTimeout(() => iframe.remove(), 60_000);
    onClose();
  };

  const handleExportRedactedMarkdown = () => {
    const lines: string[] = [
      `# OSINT INVESTIGATION DOSSIER — ${redactedCase.codeName}`,
      `**Title:** ${redactedCase.title}`,
      `**Classification:** ${redactedCase.classification}`,
      `**Generated (UTC):** ${new Date().toISOString()}`,
      `**Executive Summary:** ${redactedCase.summary}`,
      '',
      `## 1. Geolocation Pin`,
      `- **Location:** ${redactedCase.geoState.locationLabel} (${redactedCase.geoState.lat}, ${redactedCase.geoState.lon})`,
      '',
      `## 2. Entities (${redactedCase.entities.length})`,
      ...(redactedCase.entities.length === 0
        ? ['- None recorded']
        : redactedCase.entities.map(
            (e) =>
              `- **${e.label}** [${e.type.toUpperCase()} · ${e.jurisdiction} · ${e.identifier}] — ${e.summary}`
          )),
      '',
      `## 3. Infrastructure (${redactedCase.infraRecords.length})`,
      ...(redactedCase.infraRecords.length === 0
        ? ['- None recorded']
        : redactedCase.infraRecords.map(
            (d) =>
              `- **${d.domain}** · IPs: ${d.aRecords.join(', ') || 'none'} · ASN: ${d.asn ?? '—'} (${d.asnOrg ?? '—'})`
          )),
      '',
      `## 4. Hash-Chained Evidence Ledger (${redactedCase.evidenceLedger.length})`,
      ...(redactedCase.evidenceLedger.length === 0
        ? ['- Empty']
        : redactedCase.evidenceLedger.map(
            (b) =>
              `- **#${b.index}** [${b.timestampUtc}] (${b.module.toUpperCase()}) **${b.targetLabel}**: ${b.findingSummary} \`SHA-256: ${b.sha256Hash}\``
          )),
    ];

    const blob = new Blob([lines.join('\n')], {
      type: 'text/markdown;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${redactedCase.codeName.toLowerCase()}-dossier.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Dossier Report Builder and Redaction"
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="panel-enter w-full max-w-2xl overflow-hidden rounded-md border border-line bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <EyeOff className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-semibold text-ink">
              Dossier Report Builder &amp; PII Redaction
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close report builder"
            className="rounded p-1 text-ink-3 hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[75vh] space-y-4 overflow-y-auto p-4 text-xs">
          <div>
            <FieldLabel htmlFor="exec-note">
              Executive commentary / release note (prepended to report)
            </FieldLabel>
            <TextField
              id="exec-note"
              type="text"
              placeholder="e.g. Prepared for editorial verification — sensitive source names redacted."
              value={executiveNote}
              onChange={(e) => setExecutiveNote(e.target.value)}
            />
          </div>

          <Well className="space-y-3 p-3.5">
            <div className="font-semibold text-ink">
              Automatic PII &amp; Source Protection Redaction Masks
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <label className="flex cursor-pointer items-center gap-2 rounded border border-line bg-panel px-2.5 py-2">
                <input
                  type="checkbox"
                  checked={redactEmails}
                  onChange={(e) => setRedactEmails(e.target.checked)}
                  className="accent-accent"
                />
                <span>Mask email addresses</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 rounded border border-line bg-panel px-2.5 py-2">
                <input
                  type="checkbox"
                  checked={redactPhones}
                  onChange={(e) => setRedactPhones(e.target.checked)}
                  className="accent-accent"
                />
                <span>Mask phone numbers</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 rounded border border-line bg-panel px-2.5 py-2">
                <input
                  type="checkbox"
                  checked={redactIps}
                  onChange={(e) => setRedactIps(e.target.checked)}
                  className="accent-accent"
                />
                <span>Mask IPv4 addresses</span>
              </label>
            </div>

            <div>
              <FieldLabel htmlFor="redact-terms">
                Custom keywords or names to redact (comma-separated)
              </FieldLabel>
              <TextField
                id="redact-terms"
                type="text"
                placeholder="e.g. John Witness, Project Helios, internal-host.local"
                value={customTermsRaw}
                onChange={(e) => setCustomTermsRaw(e.target.value)}
                className="font-mono"
              />
            </div>
          </Well>

          <Well className="space-y-2 p-3.5">
            <div className="flex items-center justify-between">
              <DataLabel>Live redaction preview (does not alter workspace)</DataLabel>
              <DataValue className="text-[11px] text-live">
                {snapshotCount} visual snapshot(s) embedded
              </DataValue>
            </div>
            <div className="max-h-36 space-y-1.5 overflow-y-auto rounded border border-line bg-app p-2.5 font-mono text-[11px] text-ink-2">
              <div>
                <span className="text-ink-3">Summary:</span> {redactedCase.summary}
              </div>
              {redactedCase.evidenceLedger.slice(0, 4).map((b) => (
                <div key={b.id} className="truncate">
                  <span className="text-accent">#{b.index}</span> {b.targetLabel} —{' '}
                  {b.findingSummary}
                </div>
              ))}
              {redactedCase.evidenceLedger.length === 0 && (
                <div className="text-ink-3">
                  No ledger entries recorded yet — findings you pin will appear here.
                </div>
              )}
            </div>
          </Well>

          <div className="flex items-center justify-between border-t border-line pt-3">
            <span className="flex items-center gap-1.5 text-[11px] text-ink-3">
              <ShieldCheck className="h-3.5 w-3.5 text-live" />
              Original SHA-256 hashes &amp; methodology links preserved
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="solid"
                size="sm"
                icon={<Download className="h-3.5 w-3.5" />}
                onClick={handleExportRedactedMarkdown}
              >
                Download Markdown (.md)
              </Button>
              <Button
                variant="primary"
                size="sm"
                icon={<Printer className="h-3.5 w-3.5" />}
                onClick={handlePrintRedactedPdf}
              >
                Print / Save PDF Dossier
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
