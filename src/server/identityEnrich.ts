import type { EnrichedSocialProfile } from '../types/osint';

const UA = 'info9/2.0 (OSINT Workbench; +https://github.com/ARYAN007H/info9)';

async function fetchJsonSafe(
  url: string,
  timeoutMs = 7000,
  headers: Record<string, string> = {}
): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
        ...headers,
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextSafe(url: string, timeoutMs = 7000): Promise<{ status: number; text: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA },
    });
    const text = (await res.text()).slice(0, 100_000);
    return { status: res.status, text };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Enriches a username/handle across public developer & social APIs in parallel,
 * harvesting real names, bios, locations, linked domains, GitHub public commit emails,
 * avatars (ready for 1-click Face Recon), and activity timestamps (ready for Behavioral Heatmap).
 */
export async function enrichUsernameProfiles(
  rawHandle: string
): Promise<EnrichedSocialProfile[]> {
  const handle = rawHandle.trim().replace(/^@/, '');
  if (!/^[a-zA-Z0-9._-]{2,40}$/.test(handle)) {
    throw new Error('Invalid handle format');
  }

  const now = new Date().toISOString();
  const enc = encodeURIComponent(handle);

  const [ghUser, ghEvents, glUsers, redditAbout, redditPosts, hnUser, keybase, bsky, masto, devto] =
    await Promise.all([
      fetchJsonSafe(`https://api.github.com/users/${enc}`, 7000, {
        Accept: 'application/vnd.github+json',
      }),
      fetchJsonSafe(`https://api.github.com/users/${enc}/events/public?per_page=30`, 7000, {
        Accept: 'application/vnd.github+json',
      }),
      fetchJsonSafe(`https://gitlab.com/api/v4/users?username=${enc}`),
      fetchJsonSafe(`https://www.reddit.com/user/${enc}/about.json`),
      fetchJsonSafe(`https://www.reddit.com/user/${enc}/submitted.json?limit=25`),
      fetchJsonSafe(`https://hacker-news.firebaseio.com/v0/user/${enc}.json`),
      fetchJsonSafe(`https://keybase.io/_/api/1.0/user/lookup.json?usernames=${enc}`),
      fetchJsonSafe(
        `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(
          handle.includes('.') ? handle : `${handle}.bsky.social`
        )}`
      ),
      fetchJsonSafe(`https://mastodon.social/api/v1/accounts/lookup?acct=${enc}`),
      fetchJsonSafe(`https://dev.to/api/users/by_username?url=${enc}`),
    ]);

  const profiles: EnrichedSocialProfile[] = [];

  // 1. GitHub (+ public PushEvent commit emails & timestamps!)
  if (ghUser && typeof ghUser === 'object' && 'login' in ghUser) {
    const u = ghUser as Record<string, unknown>;
    const timestamps: string[] = [];
    const emails = new Set<string>();
    if (typeof u.email === 'string' && u.email.includes('@')) {
      emails.add(u.email.toLowerCase());
    }
    if (Array.isArray(ghEvents)) {
      for (const ev of ghEvents) {
        if (ev?.created_at) timestamps.push(String(ev.created_at));
        const commits = ev?.payload?.commits;
        if (Array.isArray(commits)) {
          for (const c of commits) {
            const em = c?.author?.email;
            if (
              typeof em === 'string' &&
              em.includes('@') &&
              !em.endsWith('users.noreply.github.com')
            ) {
              emails.add(em.toLowerCase());
            }
          }
        }
      }
    }
    profiles.push({
      platform: 'GitHub',
      handle: String(u.login),
      profileUrl: String(u.html_url || `https://github.com/${u.login}`),
      displayName: u.name ? String(u.name) : null,
      bio: u.bio ? String(u.bio) : null,
      location: u.location ? String(u.location) : null,
      company: u.company ? String(u.company) : null,
      websiteUrl: u.blog ? String(u.blog) : null,
      avatarUrl: u.avatar_url ? String(u.avatar_url) : null,
      createdAtUtc: u.created_at ? String(u.created_at) : null,
      followersCount: typeof u.followers === 'number' ? u.followers : null,
      activityTimestampsUtc: timestamps.slice(0, 40),
      discoveredEmails: Array.from(emails),
      provenance: {
        status: 'LIVE',
        source: 'GitHub REST API (Profile + Public Events)',
        fetchedAtUtc: now,
      },
    });
  }

  // 2. GitLab
  if (Array.isArray(glUsers) && glUsers.length > 0 && glUsers[0]?.username) {
    const u = glUsers[0] as Record<string, unknown>;
    profiles.push({
      platform: 'GitLab',
      handle: String(u.username),
      profileUrl: String(u.web_url || `https://gitlab.com/${u.username}`),
      displayName: u.name ? String(u.name) : null,
      bio: u.bio ? String(u.bio) : null,
      location: u.location ? String(u.location) : null,
      company: u.organization ? String(u.organization) : null,
      websiteUrl: u.website_url ? String(u.website_url) : null,
      avatarUrl: u.avatar_url ? String(u.avatar_url) : null,
      createdAtUtc: u.created_at ? String(u.created_at) : null,
      followersCount: null,
      activityTimestampsUtc: [],
      discoveredEmails: [],
      provenance: {
        status: 'LIVE',
        source: 'GitLab Public API v4',
        fetchedAtUtc: now,
      },
    });
  }

  // 3. Reddit
  if (redditAbout && typeof redditAbout === 'object' && 'data' in redditAbout) {
    const d = (redditAbout as { data?: Record<string, unknown> }).data;
    if (d && d.name && !d.is_suspended) {
      const timestamps: string[] = [];
      const children = (
        redditPosts as { data?: { children?: Array<{ data?: { created_utc?: number } }> } }
      )?.data?.children;
      if (Array.isArray(children)) {
        for (const ch of children) {
          if (ch.data?.created_utc) {
            timestamps.push(new Date(ch.data.created_utc * 1000).toISOString());
          }
        }
      }
      const iconRaw = String(d.icon_img || '').split('?')[0];
      profiles.push({
        platform: 'Reddit',
        handle: String(d.name),
        profileUrl: `https://www.reddit.com/user/${encodeURIComponent(String(d.name))}`,
        displayName:
          (d.subreddit as { title?: string } | undefined)?.title || String(d.name),
        bio:
          (d.subreddit as { public_description?: string } | undefined)
            ?.public_description || null,
        location: null,
        company: null,
        websiteUrl: null,
        avatarUrl: iconRaw.startsWith('http') ? iconRaw : null,
        createdAtUtc:
          typeof d.created_utc === 'number'
            ? new Date(d.created_utc * 1000).toISOString()
            : null,
        followersCount:
          typeof d.total_karma === 'number' ? d.total_karma : null,
        activityTimestampsUtc: timestamps,
        discoveredEmails: [],
        provenance: {
          status: 'LIVE',
          source: 'Reddit Public User JSON',
          fetchedAtUtc: now,
        },
      });
    }
  }

  // 4. Hacker News
  if (hnUser && typeof hnUser === 'object' && 'id' in hnUser) {
    const u = hnUser as Record<string, unknown>;
    profiles.push({
      platform: 'Hacker News',
      handle: String(u.id),
      profileUrl: `https://news.ycombinator.com/user?id=${encodeURIComponent(String(u.id))}`,
      displayName: String(u.id),
      bio: u.about ? String(u.about).replace(/<[^>]+>/g, ' ').trim() : null,
      location: null,
      company: null,
      websiteUrl: null,
      avatarUrl: null,
      createdAtUtc:
        typeof u.created === 'number'
          ? new Date(u.created * 1000).toISOString()
          : null,
      followersCount: typeof u.karma === 'number' ? u.karma : null,
      activityTimestampsUtc: [],
      discoveredEmails: [],
      provenance: {
        status: 'LIVE',
        source: 'Hacker News Firebase API',
        fetchedAtUtc: now,
      },
    });
  }

  // 5. Keybase
  if (keybase && typeof keybase === 'object' && 'them' in keybase) {
    const them = (keybase as { them?: Array<Record<string, unknown>> }).them;
    const kb = Array.isArray(them) ? them[0] : null;
    if (kb && kb.basics) {
      const basics = kb.basics as Record<string, unknown>;
      const profile = (kb.profile || {}) as Record<string, unknown>;
      const pics = (kb.pictures as { primary?: { url?: string } } | undefined)?.primary;
      profiles.push({
        platform: 'Keybase',
        handle: String(basics.username || handle),
        profileUrl: `https://keybase.io/${encodeURIComponent(String(basics.username || handle))}`,
        displayName: profile.full_name ? String(profile.full_name) : null,
        bio: profile.bio ? String(profile.bio) : null,
        location: profile.location ? String(profile.location) : null,
        company: null,
        websiteUrl: null,
        avatarUrl: pics?.url ? String(pics.url) : null,
        createdAtUtc:
          typeof basics.ctime === 'number'
            ? new Date(basics.ctime * 1000).toISOString()
            : null,
        followersCount: null,
        activityTimestampsUtc: [],
        discoveredEmails: [],
        provenance: {
          status: 'LIVE',
          source: 'Keybase Public User Lookup',
          fetchedAtUtc: now,
        },
      });
    }
  }

  // 6. Bluesky
  if (bsky && typeof bsky === 'object' && 'handle' in bsky) {
    const u = bsky as Record<string, unknown>;
    profiles.push({
      platform: 'Bluesky',
      handle: String(u.handle),
      profileUrl: `https://bsky.app/profile/${encodeURIComponent(String(u.handle))}`,
      displayName: u.displayName ? String(u.displayName) : null,
      bio: u.description ? String(u.description) : null,
      location: null,
      company: null,
      websiteUrl: null,
      avatarUrl: u.avatar ? String(u.avatar) : null,
      createdAtUtc: u.createdAt ? String(u.createdAt) : null,
      followersCount: typeof u.followersCount === 'number' ? u.followersCount : null,
      activityTimestampsUtc: [],
      discoveredEmails: [],
      provenance: {
        status: 'LIVE',
        source: 'Bluesky Public AppView API',
        fetchedAtUtc: now,
      },
    });
  }

  // 7. Mastodon
  if (masto && typeof masto === 'object' && 'acct' in masto) {
    const u = masto as Record<string, unknown>;
    profiles.push({
      platform: 'Mastodon',
      handle: String(u.acct),
      profileUrl: String(u.url || `https://mastodon.social/@${u.acct}`),
      displayName: u.display_name ? String(u.display_name) : null,
      bio: u.note ? String(u.note).replace(/<[^>]+>/g, ' ').trim() : null,
      location: null,
      company: null,
      websiteUrl: null,
      avatarUrl: u.avatar ? String(u.avatar) : null,
      createdAtUtc: u.created_at ? String(u.created_at) : null,
      followersCount: typeof u.followers_count === 'number' ? u.followers_count : null,
      activityTimestampsUtc: [],
      discoveredEmails: [],
      provenance: {
        status: 'LIVE',
        source: 'Mastodon Public Account Lookup',
        fetchedAtUtc: now,
      },
    });
  }

  // 8. Dev.to
  if (devto && typeof devto === 'object' && 'username' in devto) {
    const u = devto as Record<string, unknown>;
    profiles.push({
      platform: 'Dev.to',
      handle: String(u.username),
      profileUrl: `https://dev.to/${encodeURIComponent(String(u.username))}`,
      displayName: u.name ? String(u.name) : null,
      bio: u.summary ? String(u.summary) : null,
      location: u.location ? String(u.location) : null,
      company: null,
      websiteUrl: u.website_url ? String(u.website_url) : null,
      avatarUrl: u.profile_image ? String(u.profile_image) : null,
      createdAtUtc: u.joined_at ? String(u.joined_at) : null,
      followersCount: null,
      activityTimestampsUtc: [],
      discoveredEmails: [],
      provenance: {
        status: 'LIVE',
        source: 'Dev.to Public API',
        fetchedAtUtc: now,
      },
    });
  }

  return profiles;
}

export interface DeepEmailReconPayload {
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

/**
 * Upgraded zero-key Email OSINT Recon:
 * Gravatar full JSON + avatar, OpenPGP keyserver, ProtonMail public HKP/PGP
 * creation timestamp, XposedOrNot public breach metadata (names only),
 * GitHub account + public commit-email attribution.
 */
export async function runDeepEmailRecon(
  email: string,
  md5: string
): Promise<DeepEmailReconPayload> {
  const encEmail = encodeURIComponent(email);

  const [
    gravatarHead,
    gravatarJson,
    openPgpRes,
    protonPgpRes,
    xposedRes,
    ghUsersRes,
    ghCommitsRes,
  ] = await Promise.all([
    fetch(`https://www.gravatar.com/avatar/${md5}?d=404`, {
      method: 'HEAD',
      headers: { 'User-Agent': UA },
    }).catch(() => null),
    fetchJsonSafe(`https://www.gravatar.com/${md5}.json`),
    fetchTextSafe(`https://keys.openpgp.org/vks/v1/by-email/${encEmail}`),
    fetchTextSafe(`https://api.protonmail.ch/pks/lookup?op=index&search=${encEmail}`),
    fetchJsonSafe(`https://api.xposedornot.com/v1/check-email/${encEmail}`),
    fetchJsonSafe(
      `https://api.github.com/search/users?q=${encodeURIComponent(`${email} in:email`)}`,
      7000,
      { Accept: 'application/vnd.github+json' }
    ),
    fetchJsonSafe(
      `https://api.github.com/search/commits?q=${encodeURIComponent(`author-email:${email}`)}&per_page=5`,
      7000,
      { Accept: 'application/vnd.github+json' }
    ),
  ]);

  const hasGravatar = Boolean(gravatarHead && gravatarHead.status === 200);
  let gravatarProfile: DeepEmailReconPayload['gravatarProfile'] = null;
  if (gravatarJson && typeof gravatarJson === 'object' && 'entry' in gravatarJson) {
    const entry = (gravatarJson as { entry?: Array<Record<string, unknown>> }).entry?.[0];
    if (entry) {
      const accounts = Array.isArray(entry.accounts)
        ? entry.accounts.map((a: Record<string, unknown>) => ({
            shortname: String(a.shortname || a.domain || 'account'),
            url: String(a.url || ''),
            display: String(a.display || a.username || ''),
          }))
        : [];
      gravatarProfile = {
        displayName: entry.displayName ? String(entry.displayName) : null,
        aboutMe: entry.aboutMe ? String(entry.aboutMe) : null,
        location: entry.currentLocation ? String(entry.currentLocation) : null,
        accounts,
      };
    }
  }

  const hasOpenPgpKey = Boolean(openPgpRes && openPgpRes.status === 200);

  // Parse ProtonMail public HKP machine-readable index: pub:<fingerprint>:<algo>:<bits>:<creation_epoch>:...
  let protonFound = false;
  let protonFingerprint: string | null = null;
  let protonCreatedAtUtc: string | null = null;
  if (protonPgpRes && protonPgpRes.status === 200 && protonPgpRes.text.includes('pub:')) {
    const pubLine = protonPgpRes.text
      .split('\n')
      .find((line) => line.startsWith('pub:'));
    if (pubLine) {
      const cols = pubLine.split(':');
      if (cols[1]) {
        protonFound = true;
        protonFingerprint = cols[1].trim();
        const epochSec = Number(cols[4]);
        if (Number.isFinite(epochSec) && epochSec > 946684800) {
          protonCreatedAtUtc = new Date(epochSec * 1000).toISOString();
        }
      }
    }
  }

  // Parse XposedOrNot public breach metadata (breach names only)
  let breaches: string[] = [];
  let breachChecked = false;
  let breachNote: string | undefined;
  if (xposedRes && typeof xposedRes === 'object') {
    breachChecked = true;
    const xr = xposedRes as { breaches?: unknown; Error?: string };
    if (Array.isArray(xr.breaches)) {
      const flat = Array.isArray(xr.breaches[0]) ? xr.breaches[0] : xr.breaches;
      breaches = flat.map((b: unknown) => String(b)).filter(Boolean);
    } else if (xr.Error === 'Not found') {
      breachNote = 'Not listed in XposedOrNot public breach index';
    }
  } else {
    breachNote = 'XposedOrNot API unreachable or rate-limited';
  }

  // GitHub logins & commit repos
  const githubLogins: string[] = [];
  if (ghUsersRes && typeof ghUsersRes === 'object' && 'items' in ghUsersRes) {
    const items = (ghUsersRes as { items?: Array<{ login?: string }> }).items ?? [];
    for (const i of items.slice(0, 5)) {
      if (i.login) githubLogins.push(String(i.login));
    }
  }
  const githubCommitRepos: string[] = [];
  if (ghCommitsRes && typeof ghCommitsRes === 'object' && 'items' in ghCommitsRes) {
    const items =
      (
        ghCommitsRes as {
          items?: Array<{
            author?: { login?: string };
            repository?: { full_name?: string };
          }>;
        }
      ).items ?? [];
    for (const it of items.slice(0, 5)) {
      if (it.author?.login && !githubLogins.includes(it.author.login)) {
        githubLogins.push(it.author.login);
      }
      if (it.repository?.full_name && !githubCommitRepos.includes(it.repository.full_name)) {
        githubCommitRepos.push(it.repository.full_name);
      }
    }
  }

  return {
    email,
    md5,
    hasGravatar,
    gravatarUrl: hasGravatar
      ? `https://www.gravatar.com/avatar/${md5}?s=240&d=404`
      : null,
    gravatarProfile,
    hasOpenPgpKey,
    openPgpUrl: hasOpenPgpKey
      ? `https://keys.openpgp.org/vks/v1/by-email/${encEmail}`
      : null,
    protonPgp: {
      found: protonFound,
      keyFingerprint: protonFingerprint,
      createdAtUtc: protonCreatedAtUtc,
      isProtonDomain: /@(proton\.me|protonmail\.com|pm\.me|protonmail\.ch)$/i.test(email),
    },
    breachExposure: {
      source: 'XposedOrNot Public Breach Metadata',
      checked: breachChecked,
      breachCount: breaches.length,
      breaches: breaches.slice(0, 30),
      note: breachNote,
    },
    githubLogins,
    githubCommitRepos,
    fetchedAtUtc: new Date().toISOString(),
  };
}
