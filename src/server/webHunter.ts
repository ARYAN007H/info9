import crypto from 'node:crypto';
import type { CollectedWebPage } from '../types/osint';
import {
  computeShodanFaviconHash,
  extractFaviconHref,
  extractHtmlMetadata,
  extractPageArtifacts,
  stripHtmlToText,
} from '../utils/webIntelligence';
import { safePublicFetch } from './ssrfGuard';

export interface WebSearchHit {
  id: string;
  source:
    | 'GDELT'
    | 'CommonCrawl'
    | 'Reddit'
    | 'HackerNews'
    | 'Bluesky'
    | 'Mastodon'
    | 'GitHub'
    | 'InternetArchive'
    | 'SearXNG'
    | 'Brave'
    | 'Serper';
  title: string;
  url: string;
  snippet: string;
  publishedAtUtc: string | null;
  author: string | null;
  domain: string;
}

export interface UniversalSearchResponse {
  query: string;
  hits: WebSearchHit[];
  sourceSummary: Array<{
    source: string;
    count: number;
    status: 'ok' | 'empty' | 'error';
    note?: string;
  }>;
  fetchedAtUtc: string;
}

const UA = 'info9/2.0 (OSINT Workbench; +https://github.com/ARYAN007H/info9)';

async function fetchJsonWithTimeout(
  url: string,
  timeoutMs = 8000,
  extraHeaders: Record<string, string> = {}
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
        ...extraHeaders,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function parseGdeltDate(raw: string | undefined): string | null {
  if (!raw) return null;
  // Format: 20250115T143000Z
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}

export async function runUniversalWebSearch(
  query: string,
  selectedSources?: string[]
): Promise<UniversalSearchResponse> {
  const clean = query.trim();
  const enabled = new Set(
    selectedSources && selectedSources.length > 0
      ? selectedSources
      : [
          'GDELT',
          'HackerNews',
          'Reddit',
          'Bluesky',
          'Mastodon',
          'GitHub',
          'InternetArchive',
          'CommonCrawl',
        ]
  );

  const tasks: Array<{
    name: string;
    run: () => Promise<WebSearchHit[]>;
  }> = [];

  if (enabled.has('GDELT')) {
    tasks.push({
      name: 'GDELT',
      run: async () => {
        const json = (await fetchJsonWithTimeout(
          `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(
            clean
          )}&mode=ArtList&maxrecords=10&format=json&sort=DateDesc`
        )) as {
          articles?: Array<{
            url?: string;
            title?: string;
            domain?: string;
            seendate?: string;
            language?: string;
            sourcecountry?: string;
          }>;
        };
        const list = Array.isArray(json?.articles) ? json.articles : [];
        return list
          .filter((a) => a.url && a.title)
          .slice(0, 10)
          .map((a, i) => ({
            id: `gdelt-${i}-${Date.now()}`,
            source: 'GDELT' as const,
            title: String(a.title),
            url: String(a.url),
            snippet: [a.domain, a.sourcecountry, a.language]
              .filter(Boolean)
              .join(' · '),
            publishedAtUtc: parseGdeltDate(a.seendate),
            author: a.domain || null,
            domain: a.domain || hostOf(String(a.url)),
          }));
      },
    });
  }

  if (enabled.has('HackerNews')) {
    tasks.push({
      name: 'HackerNews',
      run: async () => {
        const json = (await fetchJsonWithTimeout(
          `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(
            clean
          )}&hitsPerPage=10`
        )) as {
          hits?: Array<{
            objectID?: string;
            title?: string;
            story_title?: string;
            url?: string;
            story_url?: string;
            author?: string;
            created_at?: string;
            points?: number;
            num_comments?: number;
          }>;
        };
        const list = Array.isArray(json?.hits) ? json.hits : [];
        return list.slice(0, 10).map((h, i) => {
          const url =
            h.url ||
            h.story_url ||
            `https://news.ycombinator.com/item?id=${h.objectID || ''}`;
          return {
            id: `hn-${h.objectID || i}`,
            source: 'HackerNews' as const,
            title: String(h.title || h.story_title || 'HN Discussion'),
            url,
            snippet: `${h.points ?? 0} pts · ${h.num_comments ?? 0} comments · by ${h.author ?? 'unknown'}`,
            publishedAtUtc: h.created_at || null,
            author: h.author || null,
            domain: hostOf(url),
          };
        });
      },
    });
  }

  if (enabled.has('Reddit')) {
    tasks.push({
      name: 'Reddit',
      run: async () => {
        const json = (await fetchJsonWithTimeout(
          `https://www.reddit.com/search.json?q=${encodeURIComponent(
            clean
          )}&limit=8&sort=relevance`
        )) as {
          data?: {
            children?: Array<{
              data?: {
                id?: string;
                title?: string;
                permalink?: string;
                selftext?: string;
                author?: string;
                subreddit_name_prefixed?: string;
                created_utc?: number;
                score?: number;
              };
            }>;
          };
        };
        const items = json?.data?.children ?? [];
        return items
          .map((c) => c.data)
          .filter((d): d is NonNullable<typeof d> => Boolean(d?.title))
          .slice(0, 8)
          .map((d) => {
            const url = `https://www.reddit.com${d.permalink || ''}`;
            return {
              id: `reddit-${d.id || Math.random()}`,
              source: 'Reddit' as const,
              title: String(d.title),
              url,
              snippet: `${d.subreddit_name_prefixed || 'Reddit'} · score ${d.score ?? 0}${
                d.selftext ? ` — ${d.selftext.slice(0, 160)}` : ''
              }`,
              publishedAtUtc: d.created_utc
                ? new Date(d.created_utc * 1000).toISOString()
                : null,
              author: d.author ? `u/${d.author}` : null,
              domain: 'www.reddit.com',
            };
          });
      },
    });
  }

  if (enabled.has('Bluesky')) {
    tasks.push({
      name: 'Bluesky',
      run: async () => {
        const json = (await fetchJsonWithTimeout(
          `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(
            clean
          )}&limit=8`
        )) as {
          posts?: Array<{
            uri?: string;
            author?: { handle?: string; displayName?: string };
            record?: { text?: string; createdAt?: string };
            likeCount?: number;
          }>;
        };
        const posts = Array.isArray(json?.posts) ? json.posts : [];
        return posts.slice(0, 8).map((p, i) => {
          const handle = p.author?.handle || 'unknown';
          const rkey = (p.uri || '').split('/').pop() || '';
          const url = `https://bsky.app/profile/${encodeURIComponent(handle)}/post/${encodeURIComponent(rkey)}`;
          const text = String(p.record?.text || '');
          return {
            id: `bsky-${rkey || i}`,
            source: 'Bluesky' as const,
            title: `${p.author?.displayName || handle} (@${handle})`,
            url,
            snippet: text.slice(0, 220),
            publishedAtUtc: p.record?.createdAt || null,
            author: `@${handle}`,
            domain: 'bsky.app',
          };
        });
      },
    });
  }

  if (enabled.has('Mastodon')) {
    tasks.push({
      name: 'Mastodon',
      run: async () => {
        const tag = clean.replace(/[^a-z0-9]/gi, '').toLowerCase();
        if (!tag) return [];
        const json = (await fetchJsonWithTimeout(
          `https://mastodon.social/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=6`
        )) as Array<{
          id?: string;
          url?: string;
          content?: string;
          created_at?: string;
          account?: { acct?: string; display_name?: string };
        }>;
        const list = Array.isArray(json) ? json : [];
        return list.slice(0, 6).map((s, i) => ({
          id: `masto-${s.id || i}`,
          source: 'Mastodon' as const,
          title: `${s.account?.display_name || s.account?.acct || 'Mastodon post'} (#${tag})`,
          url: String(s.url || 'https://mastodon.social'),
          snippet: stripHtmlToText(String(s.content || '')).slice(0, 220),
          publishedAtUtc: s.created_at || null,
          author: s.account?.acct ? `@${s.account.acct}` : null,
          domain: hostOf(String(s.url || 'https://mastodon.social')),
        }));
      },
    });
  }

  if (enabled.has('GitHub')) {
    tasks.push({
      name: 'GitHub',
      run: async () => {
        const json = (await fetchJsonWithTimeout(
          `https://api.github.com/search/repositories?q=${encodeURIComponent(
            clean
          )}&per_page=8&sort=updated`,
          8000,
          { Accept: 'application/vnd.github+json' }
        )) as {
          items?: Array<{
            id?: number;
            full_name?: string;
            html_url?: string;
            description?: string;
            updated_at?: string;
            owner?: { login?: string };
            stargazers_count?: number;
            language?: string;
          }>;
        };
        const items = Array.isArray(json?.items) ? json.items : [];
        return items.slice(0, 8).map((r) => ({
          id: `gh-${r.id || r.full_name}`,
          source: 'GitHub' as const,
          title: String(r.full_name || 'GitHub Repository'),
          url: String(r.html_url || 'https://github.com'),
          snippet: `${r.language || 'Code'} · ★${r.stargazers_count ?? 0}${
            r.description ? ` — ${r.description.slice(0, 160)}` : ''
          }`,
          publishedAtUtc: r.updated_at || null,
          author: r.owner?.login ? `@${r.owner.login}` : null,
          domain: 'github.com',
        }));
      },
    });
  }

  if (enabled.has('InternetArchive')) {
    tasks.push({
      name: 'InternetArchive',
      run: async () => {
        const json = (await fetchJsonWithTimeout(
          `https://archive.org/advancedsearch.php?q=${encodeURIComponent(
            clean
          )}&fl[]=identifier,title,creator,date,mediatype,description&rows=8&page=1&output=json`
        )) as {
          response?: {
            docs?: Array<{
              identifier?: string;
              title?: string;
              creator?: string | string[];
              date?: string;
              mediatype?: string;
              description?: string | string[];
            }>;
          };
        };
        const docs = json?.response?.docs ?? [];
        return docs.slice(0, 8).map((d) => {
          const id = String(d.identifier || '');
          const desc = Array.isArray(d.description)
            ? d.description[0]
            : d.description;
          const creator = Array.isArray(d.creator) ? d.creator[0] : d.creator;
          return {
            id: `ia-${id}`,
            source: 'InternetArchive' as const,
            title: String(d.title || id),
            url: `https://archive.org/details/${encodeURIComponent(id)}`,
            snippet: `${d.mediatype || 'archive'}${desc ? ` — ${String(desc).slice(0, 160)}` : ''}`,
            publishedAtUtc: d.date ? String(d.date).slice(0, 10) : null,
            author: creator ? String(creator) : null,
            domain: 'archive.org',
          };
        });
      },
    });
  }

  if (enabled.has('CommonCrawl') && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(clean)) {
    tasks.push({
      name: 'CommonCrawl',
      run: async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        try {
          const res = await fetch(
            `https://index.commoncrawl.org/CC-MAIN-2024-51-index?url=*.${encodeURIComponent(
              clean
            )}&output=json&limit=8`,
            { signal: controller.signal, headers: { 'User-Agent': UA } }
          );
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const text = await res.text();
          const lines = text.split('\n').filter(Boolean).slice(0, 8);
          const out: WebSearchHit[] = [];
          lines.forEach((line, idx) => {
            try {
              const row = JSON.parse(line) as {
                url?: string;
                timestamp?: string;
                status?: string;
                mime?: string;
              };
              if (!row.url) return;
              const ts = row.timestamp || '';
              const iso =
                ts.length >= 8
                  ? `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T${ts.slice(8, 10) || '00'}:${ts.slice(10, 12) || '00'}:00Z`
                  : null;
              out.push({
                id: `cc-${idx}-${ts}`,
                source: 'CommonCrawl',
                title: row.url,
                url: row.url,
                snippet: `Common Crawl capture · HTTP ${row.status || '?'} · ${row.mime || 'text/html'}`,
                publishedAtUtc: iso,
                author: null,
                domain: hostOf(row.url),
              });
            } catch {
              // ignore malformed ndjson line
            }
          });
          return out;
        } finally {
          clearTimeout(timer);
        }
      },
    });
  }

  // Optional BYOK env-configured search backends (never exposed to browser)
  const searxUrl = process.env.SEARXNG_URL?.trim();
  if (searxUrl) {
    tasks.push({
      name: 'SearXNG',
      run: async () => {
        const endpoint = `${searxUrl.replace(/\/$/, '')}/search?q=${encodeURIComponent(
          clean
        )}&format=json`;
        const json = (await fetchJsonWithTimeout(endpoint, 8000)) as {
          results?: Array<{ url?: string; title?: string; content?: string }>;
        };
        return (json.results ?? []).slice(0, 10).map((r, i) => ({
          id: `searx-${i}`,
          source: 'SearXNG' as const,
          title: String(r.title || r.url || 'Result'),
          url: String(r.url || ''),
          snippet: String(r.content || '').slice(0, 200),
          publishedAtUtc: null,
          author: null,
          domain: hostOf(String(r.url || '')),
        }));
      },
    });
  }

  const braveKey = process.env.BRAVE_API_KEY?.trim();
  if (braveKey) {
    tasks.push({
      name: 'Brave',
      run: async () => {
        const json = (await fetchJsonWithTimeout(
          `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(
            clean
          )}&count=10`,
          8000,
          { 'X-Subscription-Token': braveKey }
        )) as {
          web?: {
            results?: Array<{
              url?: string;
              title?: string;
              description?: string;
              age?: string;
            }>;
          };
        };
        return (json.web?.results ?? []).slice(0, 10).map((r, i) => ({
          id: `brave-${i}`,
          source: 'Brave' as const,
          title: String(r.title || r.url || 'Result'),
          url: String(r.url || ''),
          snippet: String(r.description || '').slice(0, 220),
          publishedAtUtc: null,
          author: null,
          domain: hostOf(String(r.url || '')),
        }));
      },
    });
  }

  const settled = await Promise.allSettled(
    tasks.map(async (t) => ({ name: t.name, hits: await t.run() }))
  );

  const allHits: WebSearchHit[] = [];
  const sourceSummary: UniversalSearchResponse['sourceSummary'] = [];

  settled.forEach((res, idx) => {
    const name = tasks[idx].name;
    if (res.status === 'fulfilled') {
      allHits.push(...res.value.hits);
      sourceSummary.push({
        source: name,
        count: res.value.hits.length,
        status: res.value.hits.length > 0 ? 'ok' : 'empty',
      });
    } else {
      sourceSummary.push({
        source: name,
        count: 0,
        status: 'error',
        note: res.reason instanceof Error ? res.reason.message : 'unreachable',
      });
    }
  });

  return {
    query: clean,
    hits: allHits,
    sourceSummary,
    fetchedAtUtc: new Date().toISOString(),
  };
}

/**
 * SSRF-guarded server-side page intelligence extractor.
 * Fetches HTML/text, hashes payload with SHA-256, extracts emails/phones/handles/
 * wallets/analytics IDs/outbound domains/social links, and fetches favicon for
 * Shodan-compatible MurmurHash3-32 hashing.
 */
export async function extractLivePageIntelligence(
  rawUrl: string
): Promise<{ page: CollectedWebPage; fullText: string; headers: Record<string, string> }> {
  const fetched = await safePublicFetch(rawUrl, {
    timeoutMs: 12_000,
    maxBytes: 1_500_000,
  });

  const sha256 = crypto.createHash('sha256').update(fetched.body).digest('hex');
  const html = fetched.body.toString('utf8');
  const fullText = stripHtmlToText(html);
  const meta = extractHtmlMetadata(html);
  const faviconUrl = extractFaviconHref(html, fetched.finalUrl);

  let faviconHash: number | null = null;
  if (faviconUrl) {
    try {
      const favRes = await safePublicFetch(faviconUrl, {
        timeoutMs: 5000,
        maxBytes: 256_000,
        accept: 'image/*,*/*;q=0.8',
      });
      if (favRes.status >= 200 && favRes.status < 300 && favRes.body.length > 0) {
        faviconHash = computeShodanFaviconHash(new Uint8Array(favRes.body));
      }
    } catch {
      // Favicon unavailable — recorded cleanly as null
    }
  }

  const artifacts = extractPageArtifacts(html, fetched.finalUrl, faviconHash, faviconUrl);
  const domain = hostOf(fetched.finalUrl);
  const fetchedAtUtc = new Date().toISOString();

  const page: CollectedWebPage = {
    id: `page-${sha256.slice(0, 16)}`,
    url: fetched.finalUrl,
    domain,
    title: meta.title || domain || fetched.finalUrl,
    description: meta.description,
    httpStatus: fetched.status,
    contentType: fetched.contentType,
    sha256,
    fetchedAtUtc,
    excerpt: fullText.slice(0, 500),
    artifacts,
    provenance: {
      status: 'LIVE',
      source: `Live Page Extractor (${domain})`,
      fetchedAtUtc,
      note: `SHA-256 ${sha256.slice(0, 16)}… · HTTP ${fetched.status}`,
    },
  };

  return { page, fullText, headers: fetched.headers };
}
