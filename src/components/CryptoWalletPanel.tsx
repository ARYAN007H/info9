import React, { useEffect, useState } from 'react';
import {
  ExternalLink,
  Loader2,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import type { ModuleId, ProvenanceMeta } from '../types/osint';
import { Button, FieldLabel, NoticeBanner, Panel, TextField, Well } from './ui';

interface CryptoWalletIntel {
  chain: 'BTC' | 'ETH' | 'TRC20';
  address: string;
  balanceFormatted: string;
  txCount: number;
  fundedTotal: string | null;
  spentTotal: string | null;
  isContract: boolean;
  ofacSanctionedMatch: {
    matched: boolean;
    listedName?: string;
    program?: string;
    identifierCode?: string;
  };
  ofacCheckedCount?: number;
  recentTransactions: Array<{
    hash: string;
    timestampUtc: string | null;
    counterparties: string[];
    valueDisplay: string;
  }>;
  explorerUrl: string;
  provenanceSource: string;
  fetchedAtUtc: string;
}

interface CryptoWalletPanelProps {
  initialAddress?: string;
  onCommitLedger: (entry: {
    module: ModuleId;
    targetLabel: string;
    sourceUrl: string;
    findingSummary: string;
    provenance: ProvenanceMeta;
  }) => void;
}

export const CryptoWalletPanel: React.FC<CryptoWalletPanelProps> = ({
  initialAddress,
  onCommitLedger,
}) => {
  const [address, setAddress] = useState(initialAddress || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wallet, setWallet] = useState<CryptoWalletIntel | null>(null);

  const traceWallet = async (addrOverride?: string) => {
    const clean = (addrOverride ?? address).trim();
    if (!clean) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/osint/crypto/wallet?address=${encodeURIComponent(clean)}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setWallet(data as CryptoWalletIntel);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Wallet lookup failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialAddress) {
      setAddress(initialAddress);
      void traceWallet(initialAddress);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAddress]);

  return (
    <Panel title="Crypto Wallet Forensics & OFAC Check">
      <div className="space-y-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void traceWallet();
          }}
          className="flex flex-col sm:flex-row gap-2"
        >
          <div className="flex-1">
            <FieldLabel htmlFor="cw-address">Bitcoin, Ethereum (0x…), or Tron (T…) Address</FieldLabel>
            <TextField
              id="cw-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="e.g. 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa or 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
            />
          </div>
          <div className="flex items-end">
            <Button type="submit" variant="primary" disabled={loading || !address.trim()}>
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wallet className="w-3.5 h-3.5" />}
              Trace &amp; Screen
            </Button>
          </div>
        </form>

        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <span className="font-mono text-[10px] uppercase">Try:</span>
          {[
            { label: 'BTC Genesis (1A1zP1…)', addr: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa' },
            { label: 'ETH Vitalik (0xd8dA…)', addr: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' },
          ].map((s) => (
            <Button
              key={s.addr}
              type="button"
              variant="chip"
              onClick={() => {
                setAddress(s.addr);
                void traceWallet(s.addr);
              }}
            >
              {s.label}
            </Button>
          ))}
        </div>

        {error && <NoticeBanner tone="danger">{error}</NoticeBanner>}

        {wallet && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-mono text-[11px]">
                <span className="font-semibold text-accent">{wallet.chain}</span>
                <span className="text-muted">·</span>
                {wallet.ofacSanctionedMatch.matched ? (
                  <span className="font-semibold text-danger inline-flex items-center gap-1">
                    <ShieldAlert className="w-3.5 h-3.5" />
                    OFAC SDN MATCH: {wallet.ofacSanctionedMatch.listedName} ({wallet.ofacSanctionedMatch.program})
                  </span>
                ) : (
                  <span className="font-semibold text-live inline-flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    No OFAC SDN Wallet Match
                    {typeof wallet.ofacCheckedCount === 'number' && wallet.ofacCheckedCount > 0
                      ? ` (${wallet.ofacCheckedCount.toLocaleString()} live records checked)`
                      : ''}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={wallet.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[11px] text-accent hover:underline inline-flex items-center gap-1"
                >
                  Block Explorer <ExternalLink className="w-3 h-3" />
                </a>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    onCommitLedger({
                      module: 'sanctions',
                      targetLabel: `${wallet.chain} ${wallet.address.slice(0, 14)}…`,
                      sourceUrl: wallet.explorerUrl,
                      findingSummary: `Balance ${wallet.balanceFormatted} · ${wallet.txCount} tx(s) · OFAC match: ${
                        wallet.ofacSanctionedMatch.matched
                          ? wallet.ofacSanctionedMatch.listedName
                          : 'none'
                      }`,
                      provenance: {
                        status: 'LIVE',
                        source: wallet.provenanceSource,
                        fetchedAtUtc: wallet.fetchedAtUtc,
                      },
                    })
                  }
                >
                  <Plus className="w-3 h-3" />
                  Log Wallet
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-xs">
              <Well className="p-2.5">
                <div className="text-[10px] text-muted uppercase">Balance</div>
                <div className="text-ink font-semibold mt-0.5 tnum">{wallet.balanceFormatted}</div>
              </Well>
              <Well className="p-2.5">
                <div className="text-[10px] text-muted uppercase">Transactions</div>
                <div className="text-ink font-semibold mt-0.5 tnum">{wallet.txCount}</div>
              </Well>
              <Well className="p-2.5">
                <div className="text-[10px] text-muted uppercase">Total Funded</div>
                <div className="text-ink font-semibold mt-0.5 tnum">{wallet.fundedTotal ?? '—'}</div>
              </Well>
              <Well className="p-2.5">
                <div className="text-[10px] text-muted uppercase">Address Kind</div>
                <div className="text-ink font-semibold mt-0.5">
                  {wallet.isContract ? 'Smart Contract' : 'Externally Owned'}
                </div>
              </Well>
            </div>

            {wallet.recentTransactions.length > 0 && (
              <Well className="p-3 space-y-1.5">
                <div className="font-mono text-[10px] uppercase text-muted">
                  Recent On-Chain Counterparties ({wallet.recentTransactions.length})
                </div>
                <div className="space-y-1 font-mono text-[10px]">
                  {wallet.recentTransactions.map((tx) => (
                    <div
                      key={tx.hash}
                      className="flex flex-wrap items-center justify-between gap-2 p-1.5 rounded-[2px] bg-surface border border-rule"
                    >
                      <span className="text-ink truncate max-w-[180px]" title={tx.hash}>
                        {tx.hash.slice(0, 18)}…
                      </span>
                      <span className="text-accent tnum">{tx.valueDisplay}</span>
                      <span className="text-muted">
                        {tx.timestampUtc ? tx.timestampUtc.slice(0, 16).replace('T', ' ') : 'pending'}
                      </span>
                      {tx.counterparties[0] && (
                        <button
                          type="button"
                          onClick={() => {
                            setAddress(tx.counterparties[0]);
                            void traceWallet(tx.counterparties[0]);
                          }}
                          className="text-accent hover:underline truncate max-w-[150px]"
                          title={`Pivot to counterparty ${tx.counterparties[0]}`}
                        >
                          → {tx.counterparties[0].slice(0, 14)}…
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </Well>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
};
