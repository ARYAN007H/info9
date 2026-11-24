import React, { useState } from 'react';
import {
  Camera,
  ExternalLink,
  KeyRound,
  Loader2,
  Mail,
  Phone,
  Plus,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import type {
  EnrichedSocialProfile,
  ModuleId,
  ProvenanceMeta,
} from '../types/osint';
import { md5HexSync } from '../utils/contactRecon';
import { analyzeEnhancedPhone } from '../utils/phoneIntel';
import { ProvenanceBadge } from './ProvenanceBadge';
import {
  Button,
  FieldLabel,
  NoticeBanner,
  Panel,
  PivotChip,
  TextField,
  Well,
} from './ui';

interface DeepEmailReconPayload {
  email: string;
  md5: string;
  hasGravatar: boolean;
  gravatarUrl: string | null;
  gravatarProfile: {
    displayName: string | null;
    aboutMe: string | null;
    location: string | null;
    accounts: Array<{ shortname: string; url: string; display: string }>;
  } | null;
  hasOpenPgpKey: boolean;
  openPgpUrl: string | null;
  protonPgp: {
    found: boolean;
    keyFingerprint: string | null;
    createdAtUtc: string | null;
    isProtonDomain: boolean;
  };
  breachExposure: {
    source: string;
    checked: boolean;
    breachCount: number;
    breaches: string[];
    note?: string;
  };
  githubLogins: string[];
  githubCommitRepos: string[];
  fetchedAtUtc: string;
}

interface DeepIdentityPanelsProps {
  activeHandle: string;
  activeEmail: string;
  activePhone: string;
  onCommitProfile: (profile: EnrichedSocialProfile) => void;
  onCommitLedger: (entry: {
    module: ModuleId;
    targetLabel: string;
    sourceUrl: string;
    findingSummary: string;
    provenance: ProvenanceMeta;
  }) => void;
  onPivotToModule: (moduleId: ModuleId, targetValue: string, subMode?: string) => void;
}

export const DeepProfileEnrichPanel: React.FC<
  Pick<
    DeepIdentityPanelsProps,
    'activeHandle' | 'onCommitProfile' | 'onCommitLedger' | 'onPivotToModule'
  >
> = ({ activeHandle, onCommitProfile, onCommitLedger, onPivotToModule }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<EnrichedSocialProfile[]>([]);
  const [ranFor, setRanFor] = useState<string | null>(null);

  const runEnrich = async () => {
    const clean = activeHandle.trim().replace(/^@/, '');
    if (!clean) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/osint/identity/enrich?handle=${encodeURIComponent(clean)}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setProfiles(Array.isArray(data.profiles) ? data.profiles : []);
      setRanFor(clean);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Profile enrichment failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Panel
      title="Profile Enricher (8 Platforms)"
      actions={
        <Button
          size="sm"
          variant="primary"
          onClick={runEnrich}
          disabled={loading || !activeHandle.trim()}
        >
          {loading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Enriching…
            </>
          ) : (
            <>
              <UserCheck className="w-3.5 h-3.5" />
              Enrich @{activeHandle.replace(/^@/, '') || 'handle'}
            </>
          )}
        </Button>
      }
    >
      <div className="space-y-3">
        {!ranFor && !error && (
          <p className="text-xs text-muted">
            Pulls bios, locations, commit emails, avatars, and activity timestamps from GitHub, GitLab, Reddit, HN, Keybase, Bluesky, Mastodon &amp; Dev.to.
          </p>
        )}
        {error && <NoticeBanner tone="danger">{error}</NoticeBanner>}

        {ranFor && profiles.length === 0 && !loading && (
          <div className="text-xs text-muted">
            No public API profiles matched <span className="font-mono text-ink">@{ranFor}</span> across the 8 direct platforms.
          </div>
        )}

        {profiles.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {profiles.map((p) => (
              <Well key={`${p.platform}:${p.handle}`} className="p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {p.avatarUrl && (
                      <img
                        src={`/api/osint/image-proxy?url=${encodeURIComponent(p.avatarUrl)}`}
                        alt={`${p.platform} avatar for ${p.handle}`}
                        className="w-10 h-10 rounded-[2px] object-cover border border-rule shrink-0 bg-surface"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[10px] font-semibold uppercase text-accent shrink-0">
                          {p.platform}
                        </span>
                        <span className="text-muted">·</span>
                        <a
                          href={p.profileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-semibold text-ink hover:text-accent truncate inline-flex items-center gap-1"
                        >
                          {p.displayName || `@${p.handle}`}
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      </div>
                      <div className="font-mono text-[10px] text-muted truncate">
                        @{p.handle}
                        {p.location ? ` · ${p.location}` : ''}
                        {p.company ? ` · ${p.company}` : ''}
                        {p.createdAtUtc ? ` · joined ${p.createdAtUtc.slice(0, 10)}` : ''}
                      </div>
                    </div>
                  </div>
                  <ProvenanceBadge provenance={p.provenance} />
                </div>

                {p.bio && <p className="text-[11px] text-muted leading-snug">{p.bio}</p>}

                <div className="flex flex-wrap gap-1.5">
                  {p.discoveredEmails.map((em) => (
                    <PivotChip
                      key={em}
                      label={em}
                      hint="Commit Email"
                      onClick={() => onPivotToModule('identity', em, 'email')}
                    />
                  ))}
                  {p.websiteUrl && (
                    <PivotChip
                      label={p.websiteUrl.replace(/^https?:\/\//, '')}
                      hint="Scan Site"
                      onClick={() => onPivotToModule('webhunter', p.websiteUrl!, 'extract')}
                    />
                  )}
                  {p.activityTimestampsUtc.length > 0 && (
                    <span className="font-mono text-[10px] text-live self-center">
                      {p.activityTimestampsUtc.length} activity timestamps
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-rule">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      onCommitProfile(p);
                      onCommitLedger({
                        module: 'identity',
                        targetLabel: `${p.platform} @${p.handle}`,
                        sourceUrl: p.profileUrl,
                        findingSummary: `Enriched ${p.platform} profile: ${p.displayName || p.handle}${
                          p.location ? ` (${p.location})` : ''
                        } · ${p.discoveredEmails.length} email(s) · ${p.activityTimestampsUtc.length} activity timestamps.`,
                        provenance: p.provenance,
                      });
                    }}
                  >
                    <Plus className="w-3 h-3" />
                    Commit to Graph &amp; Heatmap
                  </Button>
                  {p.avatarUrl && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => onPivotToModule('face', p.handle)}
                    >
                      <Camera className="w-3 h-3" />
                      Face Recon
                    </Button>
                  )}
                </div>
              </Well>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
};

export const DeepEmailIntelPanel: React.FC<
  Pick<DeepIdentityPanelsProps, 'activeEmail' | 'onCommitLedger' | 'onPivotToModule'>
> = ({ activeEmail, onCommitLedger, onPivotToModule }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DeepEmailReconPayload | null>(null);

  const runDeepEmail = async () => {
    const clean = activeEmail.trim().toLowerCase();
    if (!clean || !clean.includes('@')) return;
    setLoading(true);
    setError(null);
    try {
      const md5 = md5HexSync(clean);
      const res = await fetch(
        `/api/osint/email-recon-deep?email=${encodeURIComponent(clean)}&md5=${md5}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json as DeepEmailReconPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deep email recon failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Panel
      title="Deep Email Intelligence"
      actions={
        <Button
          size="sm"
          variant="primary"
          onClick={runDeepEmail}
          disabled={loading || !activeEmail.includes('@')}
        >
          {loading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Checking…
            </>
          ) : (
            <>
              <Mail className="w-3.5 h-3.5" />
              Deep Email Check
            </>
          )}
        </Button>
      }
    >
      <div className="space-y-3">
        {!data && !error && (
          <p className="text-xs text-muted">
            Checks ProtonMail HKP key creation date, XposedOrNot breaches, Gravatar JSON accounts, OpenPGP &amp; GitHub commits.
          </p>
        )}
        {error && <NoticeBanner tone="danger">{error}</NoticeBanner>}

        {data && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <Well className="p-2.5 space-y-1">
                <div className="font-mono text-[10px] uppercase text-muted flex items-center gap-1">
                  <KeyRound className="w-3.5 h-3.5 text-accent" />
                  PGP &amp; ProtonMail Creation
                </div>
                <div className="font-mono text-xs text-ink">
                  Proton PGP:{' '}
                  <span className={data.protonPgp.found ? 'text-live font-semibold' : 'text-muted'}>
                    {data.protonPgp.found ? 'FOUND' : 'None'}
                  </span>
                </div>
                {data.protonPgp.createdAtUtc && (
                  <div className="font-mono text-[10px] text-accent">
                    Key created: {data.protonPgp.createdAtUtc.slice(0, 19).replace('T', ' ')} UTC
                  </div>
                )}
                <div className="font-mono text-[10px] text-muted">
                  OpenPGP.org: {data.hasOpenPgpKey ? 'Key published' : 'None'}
                </div>
              </Well>

              <Well className="p-2.5 space-y-1">
                <div className="font-mono text-[10px] uppercase text-muted flex items-center gap-1">
                  {data.breachExposure.breachCount > 0 ? (
                    <ShieldAlert className="w-3.5 h-3.5 text-danger" />
                  ) : (
                    <ShieldCheck className="w-3.5 h-3.5 text-live" />
                  )}
                  Breach Exposure (XposedOrNot)
                </div>
                <div className="font-mono text-xs text-ink font-semibold">
                  {data.breachExposure.breachCount} breach(es) listed
                </div>
                <div className="font-mono text-[10px] text-muted">
                  {data.breachExposure.breaches.slice(0, 5).join(', ') ||
                    data.breachExposure.note ||
                    'Clean'}
                </div>
              </Well>

              <Well className="p-2.5 space-y-1">
                <div className="font-mono text-[10px] uppercase text-muted">
                  Gravatar &amp; GitHub Identity
                </div>
                <div className="font-mono text-xs text-ink">
                  Gravatar: {data.hasGravatar ? data.gravatarProfile?.displayName || 'Active Avatar' : 'None'}
                </div>
                <div className="font-mono text-[10px] text-muted">
                  GitHub Handles: {data.githubLogins.join(', ') || 'None'}
                </div>
                {data.githubCommitRepos.length > 0 && (
                  <div className="font-mono text-[10px] text-accent truncate">
                    Repos: {data.githubCommitRepos.join(', ')}
                  </div>
                )}
              </Well>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1.5">
                {data.githubLogins.map((login) => (
                  <PivotChip
                    key={login}
                    label={`@${login}`}
                    hint="Enrich Handle"
                    onClick={() => onPivotToModule('identity', login, 'username')}
                  />
                ))}
                {data.gravatarProfile?.accounts.map((acc, i) => (
                  <a
                    key={i}
                    href={acc.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2 py-0.5 rounded-[2px] border border-rule bg-well font-mono text-[10px] text-ink hover:border-accent"
                  >
                    {acc.shortname}: {acc.display} ↗
                  </a>
                ))}
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  onCommitLedger({
                    module: 'identity',
                    targetLabel: data.email,
                    sourceUrl: `mailto:${data.email}`,
                    findingSummary: `Deep Email Recon: Gravatar=${data.hasGravatar}, ProtonPGP=${data.protonPgp.found}${
                      data.protonPgp.createdAtUtc ? ` (${data.protonPgp.createdAtUtc.slice(0, 10)})` : ''
                    }, Breaches=${data.breachExposure.breachCount}, GitHub=[${data.githubLogins.join(',')}]`,
                    provenance: {
                      status: 'LIVE',
                      source: 'Gravatar + Proton HKP + OpenPGP + XposedOrNot + GitHub',
                      fetchedAtUtc: data.fetchedAtUtc,
                    },
                  })
                }
              >
                <Plus className="w-3 h-3" />
                Log Deep Email Intel
              </Button>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
};

export const EnhancedPhoneIntelPanel: React.FC<{
  activePhone: string;
  onPivotToModule: (moduleId: ModuleId, targetValue: string, subMode?: string) => void;
}> = ({ activePhone, onPivotToModule }) => {
  const [defaultCountry, setDefaultCountry] = useState('US');
  const intel = analyzeEnhancedPhone(activePhone, defaultCountry);

  if (!activePhone.trim()) return null;

  return (
    <Panel
      title="Phone Parser & Web Dorks"
      actions={
        <div className="flex items-center gap-1.5">
          <FieldLabel htmlFor="ph-country" className="mb-0">
            Fallback Region
          </FieldLabel>
          <TextField
            id="ph-country"
            value={defaultCountry}
            onChange={(e) => setDefaultCountry(e.target.value.toUpperCase().slice(0, 2))}
            className="w-14 h-7 text-center font-mono text-xs"
          />
        </div>
      }
    >
      {!intel ? (
        <div className="text-xs text-muted">
          Enter an international number (e.g. <code className="font-mono text-ink">+44 20 7946 0958</code>) to run libphonenumber-js validation and build multi-format OSINT dorks.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-xs">
            <Well className="p-2.5">
              <div className="text-[10px] text-muted uppercase">E.164 Canonical</div>
              <div className="text-ink font-semibold mt-0.5">{intel.e164}</div>
            </Well>
            <Well className="p-2.5">
              <div className="text-[10px] text-muted uppercase">Validity / Region</div>
              <div className={`font-semibold mt-0.5 ${intel.isValid ? 'text-live' : 'text-gap'}`}>
                {intel.isValid ? 'VALID' : intel.isPossible ? 'POSSIBLE' : 'INVALID'} ·{' '}
                {intel.countryCode || 'INTL'} ({intel.callingCode || '—'})
              </div>
            </Well>
            <Well className="p-2.5">
              <div className="text-[10px] text-muted uppercase">International</div>
              <div className="text-ink mt-0.5">{intel.international}</div>
            </Well>
            <Well className="p-2.5">
              <div className="text-[10px] text-muted uppercase">National Format</div>
              <div className="text-ink mt-0.5">{intel.national}</div>
            </Well>
          </div>

          <div className="flex flex-wrap gap-2">
            {intel.messagingLinks.map((m) => (
              <a
                key={m.platform}
                href={m.url}
                target="_blank"
                rel="noopener noreferrer"
                className="px-2.5 py-1 rounded-[2px] border border-rule bg-well font-mono text-[11px] text-ink hover:border-accent inline-flex items-center gap-1"
                title={m.note}
              >
                <Phone className="w-3 h-3 text-accent" />
                {m.platform} Lookup ↗
              </a>
            ))}
            <PivotChip
              label={`Web Hunt ${intel.e164}`}
              hint="Universal Search"
              onClick={() => onPivotToModule('webhunter', intel.e164, 'search')}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {intel.dorkQueries.map((d) => (
              <Well key={d.label} className="p-2.5 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-ink">{d.label}</span>
                  <div className="flex gap-1.5 font-mono text-[10px]">
                    <a
                      href={d.duckDuckGoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline"
                    >
                      DDG ↗
                    </a>
                    <a
                      href={d.googleUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline"
                    >
                      Google ↗
                    </a>
                  </div>
                </div>
                <code className="block text-[10px] font-mono text-muted break-all">{d.query}</code>
              </Well>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
};
