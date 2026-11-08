import React, { useEffect, useMemo, useState } from 'react';
import {
  BookmarkPlus,
  CheckCircle2,
  CircleSlash,
  Clock,
  ExternalLink,
  HelpCircle,
  KeyRound,
  Mail,
  Phone,
  Search,
  UserSearch,
} from 'lucide-react';
import type { InvestigationCase } from '../types/osint';
import type { WnnSite } from '../utils/wnn';
import {
  fetchWnnDataset,
  probeEmailOsintLive,
  type LiveEmailReconResult,
} from '../services/osintApis';
import {
  type SweepSiteResult,
  sweepUsername,
} from '../services/usernameSweep';
import {
  analyzePhoneTimezoneOverlap,
  type PhoneTimezoneOverlap,
} from '../utils/contactRecon';
import type { SmartRouteAction } from '../utils/smartIntake';
import { MODULE_CATALOG } from './moduleCatalog';
import {
  Button,
  DataLabel,
  DataValue,
  EmptyState,
  FieldLabel,
  NoticeBanner,
  Panel,
  PivotChip,
  SegmentedTabs,
  SelectField,
  TextField,
  Well,
} from './ui';

interface IdentitySweepModuleProps {
  activeCase: InvestigationCase;
  onAppendLedger: (entry: {
    module: 'identity';
    targetLabel: string;
    findingSummary: string;
    sourceUrl: string;
  }) => void;
  initialValue?: string;
  initialSubMode?: 'username' | 'email' | 'phone';
  onRouteSmartClue?: (action: SmartRouteAction) => void;
}

const VERDICT_STYLES: Record<string, { chip: string; label: string }> = {
  FOUND: {
    chip: 'border-live/35 bg-live/10 text-live',
    label: 'FOUND',
  },
  NOT_FOUND: {
    chip: 'border-line bg-well text-ink-3',
    label: 'not found',
  },
  UNKNOWN: {
    chip: 'border-gap/40 bg-gap/10 text-gap',
    label: 'unknown',
  },
};

export const IdentitySweepModule: React.FC<IdentitySweepModuleProps> = ({
  onAppendLedger,
  initialValue,
  initialSubMode,
  onRouteSmartClue,
}) => {
  const [subMode, setSubMode] = useState<'username' | 'email' | 'phone'>(
    initialSubMode || 'username'
  );

  // Username sweep state
  const [username, setUsername] = useState('');
  const [sites, setSites] = useState<WnnSite[] | null>(null);
  const [datasetInfo, setDatasetInfo] = useState<{
    count: number;
    fetchedAt: string;
  } | null>(null);
  const [category, setCategory] = useState('all');
  const [isSweeping, setIsSweeping] = useState(false);
  const [progress, setProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const [results, setResults] = useState<SweepSiteResult[] | null>(null);

  // Email recon state
  const [emailInput, setEmailInput] = useState('');
  const [isProbingEmail, setIsProbingEmail] = useState(false);
  const [emailResult, setEmailResult] = useState<LiveEmailReconResult | null>(
    null
  );

  // Phone & timezone overlap state
  const [primaryPhoneInput, setPrimaryPhoneInput] = useState('+44 20 7946 0921');
  const [secondaryPhoneInput, setSecondaryPhoneInput] = useState(
    '+1 (212) 555-0143'
  );
  const [phoneOverlap, setPhoneOverlap] = useState<PhoneTimezoneOverlap | null>(
    () => analyzePhoneTimezoneOverlap('+44 20 7946 0921', '+1 (212) 555-0143')
  );

  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (initialSubMode) setSubMode(initialSubMode);
    if (initialValue) {
      if (initialSubMode === 'email' || initialValue.includes('@')) {
        setEmailInput(initialValue);
        setSubMode('email');
      } else if (initialSubMode === 'phone' || /^\+|\(\d{3}\)/.test(initialValue)) {
        setPrimaryPhoneInput(initialValue);
        setSubMode('phone');
        setPhoneOverlap(
          analyzePhoneTimezoneOverlap(initialValue, secondaryPhoneInput)
        );
      } else {
        setUsername(initialValue);
        setSubMode('username');
      }
    }
  }, [initialValue, initialSubMode]);

  const categories = useMemo(() => {
    if (!sites) return [] as string[];
    return Array.from(new Set(sites.map((s) => s.category))).sort();
  }, [sites]);

  const loadDataset = async () => {
    setError(null);
    try {
      const data = await fetchWnnDataset();
      setSites(data.sites);
      setDatasetInfo({ count: data.count, fetchedAt: data.fetchedAt });
      return data.sites;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dataset load failed');
      return null;
    }
  };

  const handleSweep = async () => {
    const cleaned = username.trim();
    if (!cleaned || isSweeping) return;
    setIsSweeping(true);
    setError(null);
    setStatusMessage(null);
    let currentSites = sites;
    if (!currentSites) {
      setStatusMessage('Loading the WhatsMyName community dataset…');
      currentSites = await loadDataset();
      if (!currentSites) {
        setIsSweeping(false);
        return;
      }
    }
    const filtered =
      category === 'all'
        ? currentSites
        : currentSites.filter((s) => s.category === category);
    if (filtered.length === 0) {
      setError('No sites in that category');
      setIsSweeping(false);
      return;
    }
    setResults(null);
    setProgress({ completed: 0, total: filtered.length });
    setStatusMessage(`Sweeping "${cleaned}" across ${filtered.length} sites…`);
    try {
      const all = await sweepUsername(cleaned, filtered, (p) =>
        setProgress({ completed: p.completed, total: p.total })
      );
      const sorted = [...all].sort((a, b) => {
        const rank = (v: string) =>
          v === 'FOUND' ? 0 : v === 'UNKNOWN' ? 1 : 2;
        return (
          rank(a.verdict) - rank(b.verdict) ||
          a.site.name.localeCompare(b.site.name)
        );
      });
      setResults(sorted);
      const found = sorted.filter((r) => r.verdict === 'FOUND');
      const unknown = sorted.filter((r) => r.verdict === 'UNKNOWN');
      setStatusMessage(
        `Sweep complete: ${found.length} account(s) found, ${unknown.length} unknown (blocked/captcha), ${sorted.length - found.length - unknown.length} not found.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sweep failed');
    } finally {
      setIsSweeping(false);
      setProgress(null);
    }
  };

  const handleSaveSweepToNotes = () => {
    if (!results) return;
    const found = results.filter((r) => r.verdict === 'FOUND');
    onAppendLedger({
      module: 'identity',
      targetLabel: `Username: ${username.trim()}`,
      findingSummary:
        found.length > 0
          ? `WhatsMyName sweep (${results.length} sites checked): profiles found on ${found
              .slice(0, 20)
              .map((r) => r.site.name)
              .join(', ')}${found.length > 20 ? ` +${found.length - 20} more` : ''}.`
          : `WhatsMyName sweep (${results.length} sites checked): no profiles found.`,
      sourceUrl: 'https://github.com/WebBreacher/WhatsMyName',
    });
    setStatusMessage('Sweep result recorded to the evidence ledger.');
  };

  const handleEmailProbe = async (raw = emailInput) => {
    const cleaned = raw.trim();
    if (!cleaned || isProbingEmail) return;
    setIsProbingEmail(true);
    setError(null);
    setStatusMessage(
      `Inspecting "${cleaned}" — Gravatar MD5 hash, OpenPGP keyserver, GitHub accounts, and domain mail posture…`
    );
    try {
      const res = await probeEmailOsintLive(cleaned);
      setEmailResult(res);
      setStatusMessage(
        `Email recon complete for ${res.profile.email}: Gravatar=${res.hasGravatar ? 'ACTIVE' : 'none'}, OpenPGP=${res.hasOpenPgpKey ? 'FOUND' : 'none'}, MX servers=${res.mxRecords.length}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Email recon failed');
      setStatusMessage(null);
    } finally {
      setIsProbingEmail(false);
    }
  };

  const handlePhoneAnalyze = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const res = analyzePhoneTimezoneOverlap(
      primaryPhoneInput,
      secondaryPhoneInput
    );
    if (!res) {
      setError(
        'Enter a valid international phone number starting with + (e.g. +44 20 7946 0921)'
      );
      return;
    }
    setPhoneOverlap(res);
    setStatusMessage(
      `Computed timezone activity window for ${res.primaryPhone.normalizedDigits} (${res.primaryPhone.cityOrRegion}).`
    );
  };

  const foundResults = results?.filter((r) => r.verdict === 'FOUND') ?? [];
  const unknownCount =
    results?.filter((r) => r.verdict === 'UNKNOWN').length ?? 0;

  return (
    <div className="space-y-4">
      <Panel
        tag={MODULE_CATALOG.identity.num}
        title={`${MODULE_CATALOG.identity.name} — Handle, Email & Phone Recon`}
        description="Sweep handles across ~700 community-indexed sites, run zero-key Email & Gravatar/PGP recon, or analyze international phone numbers & timezone overlap."
        actions={
          <SegmentedTabs
            size="sm"
            ariaLabel="Identity recon mode"
            tabs={[
              { id: 'username', label: '1. Username Sweep' },
              { id: 'email', label: '2. Email & Gravatar' },
              { id: 'phone', label: '3. Phone & Timezone' },
            ]}
            active={subMode}
            onChange={(id) => {
              setSubMode(id);
              setError(null);
              setStatusMessage(null);
            }}
          />
        }
      >
        {subMode === 'username' && (
          <div className="space-y-2.5">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]">
              <TextField
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSweep();
                }}
                placeholder="Username or handle (letters, digits, dot, underscore, hyphen)"
                className="font-mono"
              />
              <SelectField
                aria-label="Site category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="all">All categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </SelectField>
              <Button
                variant="primary"
                icon={<Search className="h-4 w-4" />}
                onClick={handleSweep}
                disabled={!username.trim() || isSweeping}
              >
                {isSweeping
                  ? progress
                    ? `Sweeping ${progress.completed}/${progress.total}…`
                    : 'Sweeping…'
                  : 'Sweep username'}
              </Button>
            </div>
            {datasetInfo && (
              <DataValue className="block text-[11px] text-ink-3">
                {datasetInfo.count} WhatsMyName probes loaded · fetched{' '}
                {datasetInfo.fetchedAt.slice(0, 10)}
              </DataValue>
            )}
          </div>
        )}

        {subMode === 'email' && (
          <div className="space-y-2.5">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
              <TextField
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleEmailProbe();
                }}
                icon={<Mail />}
                placeholder="Email address (e.g. security@cloudflare.com or user.name+tag@gmail.com)"
                className="font-mono"
              />
              <Button
                variant="primary"
                icon={<Search className="h-4 w-4" />}
                onClick={() => handleEmailProbe()}
                disabled={!emailInput.trim() || isProbingEmail}
              >
                {isProbingEmail ? 'Probing email…' : 'Run Email Recon'}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
              <span>Try:</span>
              {['security@cloudflare.com', 'press@wikimedia.org'].map((sample) => (
                <Button
                  key={sample}
                  variant="chip"
                  onClick={() => {
                    setEmailInput(sample);
                    handleEmailProbe(sample);
                  }}
                >
                  {sample}
                </Button>
              ))}
            </div>
          </div>
        )}

        {subMode === 'phone' && (
          <form onSubmit={handlePhoneAnalyze} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
              <div className="sm:col-span-5">
                <FieldLabel htmlFor="phone-primary">
                  Primary international phone number
                </FieldLabel>
                <TextField
                  id="phone-primary"
                  type="text"
                  icon={<Phone />}
                  value={primaryPhoneInput}
                  onChange={(e) => setPrimaryPhoneInput(e.target.value)}
                  placeholder="+44 20 7946 0921"
                  className="font-mono"
                />
              </div>
              <div className="sm:col-span-5">
                <FieldLabel htmlFor="phone-secondary">
                  Second phone number (optional — for timezone overlap)
                </FieldLabel>
                <TextField
                  id="phone-secondary"
                  type="text"
                  icon={<Clock />}
                  value={secondaryPhoneInput}
                  onChange={(e) => setSecondaryPhoneInput(e.target.value)}
                  placeholder="+1 (212) 555-0143"
                  className="font-mono"
                />
              </div>
              <div className="flex items-end sm:col-span-2">
                <Button type="submit" variant="primary" className="w-full">
                  Analyze
                </Button>
              </div>
            </div>
          </form>
        )}

        {error && (
          <NoticeBanner className="mt-3" tone="danger" title="Error:">
            {error}
          </NoticeBanner>
        )}

        {statusMessage && (
          <NoticeBanner
            className="mt-3"
            tone="info"
            onDismiss={() => setStatusMessage(null)}
          >
            {statusMessage}
          </NoticeBanner>
        )}
      </Panel>

      {/* TAB 1: USERNAME SWEEP */}
      {subMode === 'username' && !results && !isSweeping && (
        <Panel>
          <EmptyState
            icon={<UserSearch className="h-5 w-5" />}
            title="No sweep run yet"
            hint="Enter a handle above and sweep. Each probe visits the site's own page and looks for the profile's detection signature."
          />
        </Panel>
      )}

      {subMode === 'username' && results && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Well className="p-3 text-center">
              <div className="font-mono text-2xl font-semibold tabular-nums text-live">
                {foundResults.length}
              </div>
              <DataLabel>Found</DataLabel>
            </Well>
            <Well className="p-3 text-center">
              <div className="font-mono text-2xl font-semibold tabular-nums text-gap">
                {unknownCount}
              </div>
              <DataLabel>Unknown (blocked/captcha)</DataLabel>
            </Well>
            <Well className="p-3 text-center">
              <div className="font-mono text-2xl font-semibold tabular-nums text-ink-2">
                {results.length - foundResults.length - unknownCount}
              </div>
              <DataLabel>Not found</DataLabel>
            </Well>
          </div>

          <Panel
            title={`Sweep results — ${username.trim()}`}
            actions={
              <Button
                variant="primary"
                size="sm"
                icon={<BookmarkPlus className="h-3.5 w-3.5" />}
                onClick={handleSaveSweepToNotes}
              >
                Record finding
              </Button>
            }
            flush
          >
            <div className="max-h-[560px] divide-y divide-line overflow-y-auto">
              {results.map((r) => {
                const style =
                  VERDICT_STYLES[r.verdict] ?? VERDICT_STYLES.UNKNOWN;
                const profileUrl = r.site.uriCheck
                  .replace('{account}', encodeURIComponent(username.trim()))
                  .replace('{username}', encodeURIComponent(username.trim()));
                return (
                  <div
                    key={r.site.name + r.site.uriCheck}
                    className="flex items-center justify-between gap-3 px-4 py-2.5"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      {r.verdict === 'FOUND' ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-live" />
                      ) : r.verdict === 'NOT_FOUND' ? (
                        <CircleSlash className="h-4 w-4 shrink-0 text-line-strong" />
                      ) : (
                        <HelpCircle className="h-4 w-4 shrink-0 text-gap" />
                      )}
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-ink">
                          {r.site.name}
                        </div>
                        <DataValue className="block truncate text-[11px] text-ink-3">
                          {r.site.category} · HTTP {r.httpStatus} ·{' '}
                          {r.elapsedMs}ms
                          {r.error ? ` · ${r.error}` : ''}
                        </DataValue>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={`rounded border px-2 py-0.5 text-[10px] font-semibold ${style.chip}`}
                      >
                        {style.label}
                      </span>
                      {(r.verdict === 'FOUND' || r.verdict === 'UNKNOWN') && (
                        <a
                          href={profileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-ink-3 transition-colors hover:text-accent"
                          title="Open profile for visual verification"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>
      )}

      {/* TAB 2: EMAIL & GRAVATAR RECON */}
      {subMode === 'email' && emailResult && (
        <Panel
          title={`Email OSINT Report — ${emailResult.profile.email}`}
          description={`Gravatar MD5: ${emailResult.profile.gravatarMd5} · Provider class: ${emailResult.profile.providerClass}`}
          actions={
            <Button
              size="sm"
              variant="primary"
              icon={<BookmarkPlus className="h-3.5 w-3.5" />}
              onClick={() => {
                onAppendLedger({
                  module: 'identity',
                  targetLabel: `Email: ${emailResult.profile.email}`,
                  findingSummary: `Email OSINT Recon: Gravatar=${emailResult.hasGravatar ? 'Present' : 'Absent'} (MD5 ${emailResult.profile.gravatarMd5}), OpenPGP Key=${emailResult.hasOpenPgpKey ? 'Found' : 'None'}, GitHub Logins=[${emailResult.githubLogins.join(', ') || 'none'}], Domain MX=[${emailResult.mxRecords.slice(0, 3).join(', ') || 'none'}].`,
                  sourceUrl: `https://www.gravatar.com/${emailResult.profile.gravatarMd5}`,
                });
                setStatusMessage('Email recon finding recorded to the evidence ledger.');
              }}
            >
              Record finding
            </Button>
          }
          bodyClassName="space-y-4"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Well className="p-3">
              <DataLabel>Gravatar profile &amp; avatar</DataLabel>
              <div className="mt-1.5 flex items-center gap-2.5">
                {emailResult.hasGravatar && emailResult.gravatarUrl ? (
                  <img
                    src={emailResult.gravatarUrl}
                    alt="Gravatar portrait"
                    className="h-10 w-10 rounded border border-live object-cover"
                  />
                ) : null}
                <div>
                  <DataValue
                    className={`block font-semibold ${
                      emailResult.hasGravatar ? 'text-live' : 'text-ink-2'
                    }`}
                  >
                    {emailResult.hasGravatar
                      ? 'Active Gravatar found'
                      : 'No public Gravatar'}
                  </DataValue>
                  <DataValue className="text-[10px] text-ink-3">
                    MD5 {emailResult.profile.gravatarMd5.slice(0, 12)}…
                  </DataValue>
                </div>
              </div>
            </Well>

            <Well className="p-3">
              <DataLabel>OpenPGP public keyserver</DataLabel>
              <DataValue
                className={`mt-1 block text-sm font-semibold ${
                  emailResult.hasOpenPgpKey ? 'text-live' : 'text-ink-2'
                }`}
              >
                {emailResult.hasOpenPgpKey
                  ? 'PGP Key Published'
                  : 'No key on keys.openpgp.org'}
              </DataValue>
              {emailResult.openPgpUrl && (
                <a
                  href={emailResult.openPgpUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-[11px] text-accent underline"
                >
                  <KeyRound className="h-3 w-3" /> Download public key
                </a>
              )}
            </Well>

            <Well className="p-3">
              <DataLabel>GitHub public account match</DataLabel>
              <DataValue className="mt-1 block text-sm font-semibold">
                {emailResult.githubLogins.length > 0
                  ? emailResult.githubLogins.join(', ')
                  : 'No public email match'}
              </DataValue>
              <div className="mt-1 text-[11px] text-ink-3">
                Provider: {emailResult.profile.providerClass.replace('_', ' ')}
              </div>
            </Well>

            <Well className="p-3">
              <DataLabel>Domain mail security (MX / SPF / DMARC)</DataLabel>
              <DataValue className="mt-1 block text-sm font-semibold">
                {emailResult.mxRecords.length} MX · SPF:{' '}
                {emailResult.hasSpf ? 'YES' : 'NO'}
              </DataValue>
              <div className="mt-1 truncate font-mono text-[11px] text-ink-3">
                DMARC: {emailResult.dmarcPolicy || 'Not configured'}
              </div>
            </Well>
          </div>

          <Well className="space-y-2 p-3.5">
            <DataLabel>
              Extracted candidate handles &amp; domain pivots (click to pivot)
            </DataLabel>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <PivotChip
                value={emailResult.profile.domain}
                label={`Domain: ${emailResult.profile.domain}`}
                onSelectAction={onRouteSmartClue}
              />
              {emailResult.profile.pivotHandles.map((h) => (
                <PivotChip
                  key={h}
                  value={`@${h}`}
                  label={`Handle: @${h}`}
                  onSelectAction={(act) => {
                    if (act.moduleId === 'identity') {
                      setUsername(h);
                      setSubMode('username');
                    } else {
                      onRouteSmartClue?.(act);
                    }
                  }}
                />
              ))}
            </div>
          </Well>
        </Panel>
      )}

      {/* TAB 3: PHONE & TIMEZONE OVERLAP */}
      {subMode === 'phone' && phoneOverlap && (
        <Panel
          title={`Phone Attribution & Timezone Overlap`}
          description="Compares international dialing prefixes, city area codes, and 24-hour UTC waking/business hour overlap."
          actions={
            <Button
              size="sm"
              variant="primary"
              icon={<BookmarkPlus className="h-3.5 w-3.5" />}
              onClick={() => {
                onAppendLedger({
                  module: 'identity',
                  targetLabel: `Phone: ${phoneOverlap.primaryPhone.normalizedDigits}`,
                  findingSummary: `Phone & Timezone Recon: ${phoneOverlap.primaryPhone.countryName} (${phoneOverlap.primaryPhone.cityOrRegion}, ${phoneOverlap.primaryPhone.timezoneUtc}).${
                    phoneOverlap.secondaryPhone
                      ? ` Compared with ${phoneOverlap.secondaryPhone.normalizedDigits} (${phoneOverlap.secondaryPhone.cityOrRegion}): ${phoneOverlap.overlappingBusinessUtcHours.length} overlapping business hours/day.`
                      : ''
                  }`,
                  sourceUrl: 'info9://identity/phone-overlap',
                });
                setStatusMessage('Phone attribution recorded to the evidence ledger.');
              }}
            >
              Record finding
            </Button>
          }
          bodyClassName="space-y-4"
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Well className="space-y-1.5 p-3.5">
              <DataLabel>Primary Phone Number</DataLabel>
              <div className="font-mono text-sm font-semibold text-ink">
                {phoneOverlap.primaryPhone.normalizedDigits}
              </div>
              <div className="text-xs text-ink-2">
                {phoneOverlap.primaryPhone.cityOrRegion} ·{' '}
                {phoneOverlap.primaryPhone.countryName}
              </div>
              <DataValue className="block text-[11px] text-ink-3">
                Timezone: {phoneOverlap.primaryPhone.timezoneUtc} · Center:{' '}
                {phoneOverlap.primaryPhone.lat.toFixed(4)},{' '}
                {phoneOverlap.primaryPhone.lon.toFixed(4)}
              </DataValue>
              <div className="flex flex-wrap gap-2 pt-2">
                <PivotChip
                  value={`${phoneOverlap.primaryPhone.lat}, ${phoneOverlap.primaryPhone.lon}`}
                  label="Pin on Geolocation Map"
                  onSelectAction={onRouteSmartClue}
                />
                {phoneOverlap.verificationLinks.map((lnk) => (
                  <a
                    key={lnk.label}
                    href={lnk.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded border border-line bg-panel px-2 py-0.5 text-[11px] text-ink-2 hover:border-accent hover:text-ink"
                  >
                    <span>{lnk.label}</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ))}
              </div>
            </Well>

            {phoneOverlap.secondaryPhone ? (
              <Well className="space-y-1.5 p-3.5">
                <DataLabel>Secondary Phone Number (Comparison)</DataLabel>
                <div className="font-mono text-sm font-semibold text-ink">
                  {phoneOverlap.secondaryPhone.normalizedDigits}
                </div>
                <div className="text-xs text-ink-2">
                  {phoneOverlap.secondaryPhone.cityOrRegion} ·{' '}
                  {phoneOverlap.secondaryPhone.countryName}
                </div>
                <DataValue className="block text-[11px] text-ink-3">
                  Timezone: {phoneOverlap.secondaryPhone.timezoneUtc} ·{' '}
                  {phoneOverlap.overlappingBusinessUtcHours.length}h business
                  overlap / {phoneOverlap.overlappingWakingUtcHours.length}h
                  waking overlap
                </DataValue>
              </Well>
            ) : (
              <Well className="flex items-center justify-center p-3.5 text-xs text-ink-3">
                Enter a second phone number above to calculate mutual waking &amp;
                business hour overlap.
              </Well>
            )}
          </div>

          <Well className="space-y-2 p-3.5">
            <div className="flex items-center justify-between">
              <DataLabel>
                24-Hour UTC Activity &amp; Overlap Matrix (Green = Mutual Business Hours 09:00–18:00 Local)
              </DataLabel>
              <DataValue className="text-[11px] text-live">
                {phoneOverlap.overlappingBusinessUtcHours.length} mutual business
                hours
              </DataValue>
            </div>
            <div className="grid grid-cols-12 gap-1 pt-1 sm:grid-cols-24">
              {Array.from({ length: 24 }, (_, utcHour) => {
                const isBiz =
                  phoneOverlap.overlappingBusinessUtcHours.includes(utcHour);
                const isWake =
                  phoneOverlap.overlappingWakingUtcHours.includes(utcHour);
                return (
                  <div
                    key={utcHour}
                    className={`rounded border py-1.5 text-center font-mono text-[10px] tabular-nums ${
                      isBiz
                        ? 'border-live/50 bg-live/20 font-bold text-live'
                        : isWake
                        ? 'border-derived/40 bg-derived/10 text-derived'
                        : 'border-line bg-app text-ink-3'
                    }`}
                    title={`${String(utcHour).padStart(2, '0')}:00 UTC — ${
                      isBiz
                        ? 'Mutual business hours (09:00–18:00 local)'
                        : isWake
                        ? 'Mutual waking hours (08:00–22:00 local)'
                        : 'Off-hours / sleeping in at least one location'
                    }`}
                  >
                    {String(utcHour).padStart(2, '0')}
                  </div>
                );
              })}
            </div>
          </Well>
        </Panel>
      )}
    </div>
  );
};
