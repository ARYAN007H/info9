import React, { useState } from 'react';
import { CheckCircle2, CloudUpload, Database, RotateCcw, X } from 'lucide-react';
import type { InvestigationCase } from '../types/osint';

interface SupabaseSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  cases: InvestigationCase[];
  onResetCasesToDefault: () => void;
  onSupabaseStatusChange: (connected: boolean) => void;
}

export const SupabaseSyncModal: React.FC<SupabaseSyncModalProps> = ({
  isOpen,
  onClose,
  cases,
  onResetCasesToDefault,
  onSupabaseStatusChange,
}) => {
  const [supabaseUrl, setSupabaseUrl] = useState(
    () => localStorage.getItem('argon_supabase_url') || ''
  );
  const [supabaseAnonKey, setSupabaseAnonKey] = useState(
    () => localStorage.getItem('argon_supabase_key') || ''
  );
  const [tableName, setTableName] = useState('osint_cases');
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  if (!isOpen) return null;

  const handleSaveAndSync = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUrl = supabaseUrl.trim().replace(/\/$/, '');
    const cleanKey = supabaseAnonKey.trim();

    if (!cleanUrl || !cleanKey) {
      localStorage.removeItem('argon_supabase_url');
      localStorage.removeItem('argon_supabase_key');
      onSupabaseStatusChange(false);
      setSyncStatus(
        'Cleared cloud credentials. All case changes remain persisted in local browser storage.'
      );
      return;
    }

    localStorage.setItem('argon_supabase_url', cleanUrl);
    localStorage.setItem('argon_supabase_key', cleanKey);
    onSupabaseStatusChange(true);

    setIsSyncing(true);
    setSyncStatus(`Connecting to ${cleanUrl}/rest/v1/${tableName}...`);
    try {
      const res = await fetch(`${cleanUrl}/rest/v1/${tableName}`, {
        method: 'POST',
        headers: {
          apikey: cleanKey,
          Authorization: `Bearer ${cleanKey}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates',
        },
        body: JSON.stringify(
          cases.map((c) => ({
            id: c.id,
            code_name: c.codeName,
            title: c.title,
            payload: c,
            updated_at: new Date().toISOString(),
          }))
        ),
      });

      if (res.ok) {
        setSyncStatus(
          `Successfully synced ${cases.length} cases and SHA-256 ledgers to Supabase table "${tableName}".`
        );
      } else {
        setSyncStatus(
          `Saved credentials locally. Supabase responded HTTP ${res.status} (ensure table "${tableName}" exists with columns id, code_name, title, payload, updated_at).`
        );
      }
    } catch (err) {
      setSyncStatus(
        `Credentials saved. Network notice: ${
          err instanceof Error ? err.message : 'Check CORS/URL'
        }`
      );
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Supabase Cloud Sync & Storage Configuration"
      className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-sky-500" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 font-display">
              Local Persistence &amp; Optional Supabase Cloud Sync
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Supabase Modal"
            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs text-emerald-800 dark:text-emerald-300 flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
          <div>
            <strong>Zero-Setup Browser Storage Active:</strong> All cases,
            pinned entities, and SHA-256 ledger blocks are automatically saved
            in your browser&apos;s local storage so the workbench works
            immediately on Vercel. Connect your own Supabase project below if
            you want cloud table replication.
          </div>
        </div>

        <form onSubmit={handleSaveAndSync} className="space-y-3 text-xs">
          <div>
            <label
              htmlFor="sb-url"
              className="block font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Supabase Project URL (Optional)
            </label>
            <input
              id="sb-url"
              type="url"
              placeholder="https://xyzcompany.supabase.co"
              value={supabaseUrl}
              onChange={(e) => setSupabaseUrl(e.target.value)}
              className="w-full px-3 py-2 font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
            />
          </div>

          <div>
            <label
              htmlFor="sb-key"
              className="block font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Supabase Public Anon Key (Optional)
            </label>
            <input
              id="sb-key"
              type="password"
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              value={supabaseAnonKey}
              onChange={(e) => setSupabaseAnonKey(e.target.value)}
              className="w-full px-3 py-2 font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
            />
          </div>

          <div>
            <label
              htmlFor="sb-table"
              className="block font-medium text-slate-700 dark:text-slate-300 mb-1"
            >
              Target Table Name
            </label>
            <input
              id="sb-table"
              type="text"
              value={tableName}
              onChange={(e) => setTableName(e.target.value)}
              className="w-full px-3 py-2 font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
            />
          </div>

          {syncStatus && (
            <div className="p-2.5 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg font-mono text-[11px] text-slate-700 dark:text-slate-300">
              {syncStatus}
            </div>
          )}

          <div className="pt-2 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                onResetCasesToDefault();
                setSyncStatus(
                  'Restored default seed investigation cases and verified SHA-256 chains.'
                );
              }}
              className="flex items-center gap-1.5 px-3 py-2 font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 border border-slate-200 dark:border-slate-800 rounded-lg transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Seed Cases</span>
            </button>

            <button
              type="submit"
              disabled={isSyncing}
              className="flex items-center gap-1.5 px-4 py-2 font-semibold text-white bg-sky-600 hover:bg-sky-500 rounded-lg transition-colors"
            >
              <CloudUpload className="w-3.5 h-3.5" />
              <span>{isSyncing ? 'Syncing...' : 'Save & Sync Cases'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
