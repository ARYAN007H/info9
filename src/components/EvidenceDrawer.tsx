import { useMemo, useState } from 'react';
import { ChevronUp, Download, FileWarning, Link2, ShieldCheck } from 'lucide-react';
import type { EvidenceLedgerEntry } from '../types/osint';
import { verifyEvidenceLedgerChain } from '../utils/osintForensics';
import { MODULE_CATALOG } from './moduleCatalog';
import { Button, EmptyState } from './ui';

interface EvidenceDrawerProps {
  entries: EvidenceLedgerEntry[];
  onExport: () => void;
  onExportMisp?: () => void;
}

/**
 * The evidence drawer: the hash-chained ledger, always one click away from
 * any module. Findings pinned anywhere on the bench land here with a
 * verifiable receipt.
 */
export function EvidenceDrawer({ entries, onExport, onExportMisp }: EvidenceDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const chain = useMemo(() => verifyEvidenceLedgerChain(entries), [entries]);

  const chainChip = (() => {
    if (entries.length === 0) {
      return (
        <span className="hidden rounded border border-line px-1.5 py-0.5 text-[10px] font-semibold text-ink-3 sm:inline">
          Chain empty
        </span>
      );
    }
    if (chain.isValid) {
      return (
        <span
          title={chain.reason}
          className="hidden items-center gap-1 rounded border border-live/35 bg-live/10 px-1.5 py-0.5 text-[10px] font-semibold text-live sm:inline-flex"
        >
          <ShieldCheck className="h-3 w-3" />
          Chain verified
        </span>
      );
    }
    return (
      <span
        title={chain.reason}
        className="hidden items-center gap-1 rounded border border-danger/40 bg-danger/10 px-1.5 py-0.5 text-[10px] font-semibold text-danger sm:inline-flex"
      >
        <FileWarning className="h-3 w-3" />
        Chain broken
      </span>
    );
  })();

  return (
    <section
      aria-label="Evidence ledger"
      className="shrink-0 border-t border-line bg-panel"
    >
      <div className="flex h-11 items-center gap-3 px-4">
        <button
          type="button"
          onClick={() => setIsOpen((o) => !o)}
          aria-expanded={isOpen}
          className="flex items-center gap-2 text-xs font-semibold text-ink"
        >
          <ChevronUp
            className={`h-3.5 w-3.5 text-ink-3 transition-transform ${
              isOpen ? '' : 'rotate-180'
            }`}
          />
          Evidence ledger
          <span className="font-mono text-[11px] font-normal tabular-nums text-ink-3">
            {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          </span>
        </button>
        {chainChip}
        <div className="ml-auto flex items-center gap-2">
          {onExportMisp && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Download className="h-3.5 w-3.5" />}
              onClick={onExportMisp}
              title="MISP 2.4 event JSON built from this case's recorded artifacts"
            >
              MISP
            </Button>
          )}
          <Button size="sm" variant="solid" icon={<Download className="h-3.5 w-3.5" />} onClick={onExport}>
            Export case report
          </Button>
        </div>
      </div>

      {isOpen && (
        <div className="drawer-enter border-t border-line bg-app">
          {entries.length === 0 ? (
            <EmptyState
              className="py-8"
              title="No findings recorded yet"
              hint="Findings you pin from any module land here as hash-chained ledger blocks, exportable with the case report."
            />
          ) : (
            <div className="max-h-56 overflow-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-line text-[10px] font-semibold text-ink-3">
                    <th scope="col" className="px-4 py-1.5 font-semibold">
                      Block
                    </th>
                    <th scope="col" className="px-3 py-1.5 font-semibold">
                      Recorded
                    </th>
                    <th scope="col" className="px-3 py-1.5 font-semibold">
                      Module
                    </th>
                    <th scope="col" className="px-3 py-1.5 font-semibold">
                      Target
                    </th>
                    <th scope="col" className="px-3 py-1.5 font-semibold">
                      Finding
                    </th>
                    <th scope="col" className="px-3 py-1.5 font-semibold">
                      SHA-256
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => {
                    const mod = MODULE_CATALOG[entry.module];
                    return (
                      <tr
                        key={entry.id}
                        className="border-b border-line/60 last:border-b-0 hover:bg-well/60"
                      >
                        <td className="px-4 py-1.5 font-mono tabular-nums text-ink-3">
                          #{String(entry.index).padStart(3, '0')}
                        </td>
                        <td
                          className="px-3 py-1.5 font-mono tabular-nums text-ink-3"
                          title={entry.timestampUtc}
                        >
                          {entry.timestampUtc.slice(11, 19)} UTC
                        </td>
                        <td className="px-3 py-1.5">
                          <span className="signage text-[9px] font-semibold text-ink-2">
                            {mod.num} · {mod.shortName}
                          </span>
                        </td>
                        <td className="max-w-[180px] truncate px-3 py-1.5 font-medium text-ink" title={entry.targetLabel}>
                          {entry.sourceUrl ? (
                            <a
                              href={entry.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 hover:text-accent"
                            >
                              <Link2 className="h-3 w-3 shrink-0 text-ink-3" />
                              {entry.targetLabel}
                            </a>
                          ) : (
                            entry.targetLabel
                          )}
                        </td>
                        <td
                          className="max-w-[340px] truncate px-3 py-1.5 text-ink-2"
                          title={entry.findingSummary}
                        >
                          {entry.findingSummary}
                        </td>
                        <td
                          className="px-3 py-1.5 font-mono text-[11px] text-ink-3"
                          title={`prev ${entry.previousHash.slice(0, 16)}… · ${entry.sha256Hash}`}
                        >
                          {entry.sha256Hash.slice(0, 10)}…
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
