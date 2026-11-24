import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { CollectedWebPage, InvestigationCase } from '../types/osint';

/**
 * Local SQLite persistence backend (Node 22 native node:sqlite + FTS5)
 * for multi-case storage, full-text search across collected web pages/findings,
 * and resumable recursive scan job tracking.
 */

export interface ScanJobRecord {
  id: string;
  caseId: string;
  kind: string;
  target: string;
  depth: number;
  status: 'running' | 'completed' | 'failed';
  entitiesFound: number;
  edgesFound: number;
  stepsCompleted: number;
  resultJson: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
}

export interface FtsSearchHit {
  id: string;
  caseId: string;
  url: string;
  domain: string;
  title: string;
  sha256: string;
  fetchedAtUtc: string;
  snippet: string;
}

export interface ConnectorStatusEntry {
  id: string;
  name: string;
  category: 'Search' | 'Identity' | 'Corporate & Legal' | 'Infrastructure' | 'Crypto & Maritime' | 'AI Analysis';
  mode: 'zero-key' | 'optional-env-key';
  envVar: string | null;
  active: boolean;
  note: string;
}

export class Info9Database {
  private db: DatabaseSync;
  public readonly dbPath: string;

  constructor(customPath?: string) {
    if (customPath === ':memory:') {
      this.dbPath = ':memory:';
      this.db = new DatabaseSync(':memory:');
    } else {
      const baseDir = path.resolve(process.cwd(), '.info9-data');
      const requested = customPath
        ? path.resolve(customPath)
        : path.resolve(baseDir, 'info9.db');
      const dir = path.dirname(requested);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.dbPath = requested;
      this.db = new DatabaseSync(this.dbPath);
    }
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS cases (
        id TEXT PRIMARY KEY,
        code_name TEXT NOT NULL,
        title TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS collected_pages (
        id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL,
        url TEXT NOT NULL,
        domain TEXT NOT NULL,
        title TEXT NOT NULL,
        text_content TEXT NOT NULL,
        extracted_json TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
        page_id UNINDEXED,
        case_id UNINDEXED,
        title,
        url,
        domain,
        text_content,
        extracted_json
      );

      CREATE TABLE IF NOT EXISTS scan_jobs (
        id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        target TEXT NOT NULL,
        depth INTEGER NOT NULL,
        status TEXT NOT NULL,
        entities_found INTEGER NOT NULL DEFAULT 0,
        edges_found INTEGER NOT NULL DEFAULT 0,
        steps_completed INTEGER NOT NULL DEFAULT 0,
        result_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  public upsertCase(caseData: InvestigationCase): void {
    const stmt = this.db.prepare(`
      INSERT INTO cases (id, code_name, title, updated_at, payload_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        code_name = excluded.code_name,
        title = excluded.title,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json
    `);
    stmt.run(
      caseData.id,
      caseData.codeName,
      caseData.title,
      caseData.updatedAtUtc || new Date().toISOString(),
      JSON.stringify(caseData)
    );
  }

  public listCases(): InvestigationCase[] {
    const rows = this.db
      .prepare('SELECT payload_json FROM cases ORDER BY updated_at DESC')
      .all() as Array<{ payload_json: string }>;
    const out: InvestigationCase[] = [];
    for (const r of rows) {
      try {
        const parsed = JSON.parse(r.payload_json) as InvestigationCase;
        if (parsed && parsed.id) out.push(parsed);
      } catch {
        // skip corrupt row
      }
    }
    return out;
  }

  public deleteCase(caseId: string): void {
    this.db.prepare('DELETE FROM cases WHERE id = ?').run(caseId);
    this.db.prepare('DELETE FROM collected_pages WHERE case_id = ?').run(caseId);
    this.db.prepare('DELETE FROM pages_fts WHERE case_id = ?').run(caseId);
    this.db.prepare('DELETE FROM scan_jobs WHERE case_id = ?').run(caseId);
  }

  public saveCollectedPage(
    caseId: string,
    page: CollectedWebPage,
    fullText: string
  ): void {
    const extractedStr = JSON.stringify(page.artifacts);
    this.db
      .prepare(
        `
      INSERT INTO collected_pages (id, case_id, url, domain, title, text_content, extracted_json, sha256, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        text_content = excluded.text_content,
        extracted_json = excluded.extracted_json,
        sha256 = excluded.sha256,
        fetched_at = excluded.fetched_at
    `
      )
      .run(
        page.id,
        caseId,
        page.url,
        page.domain,
        page.title,
        fullText.slice(0, 250_000),
        extractedStr,
        page.sha256,
        page.fetchedAtUtc
      );

    this.db.prepare('DELETE FROM pages_fts WHERE page_id = ?').run(page.id);
    this.db
      .prepare(
        `
      INSERT INTO pages_fts (page_id, case_id, title, url, domain, text_content, extracted_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        page.id,
        caseId,
        page.title,
        page.url,
        page.domain,
        fullText.slice(0, 250_000),
        extractedStr
      );
  }

  public searchArchivedPages(query: string, caseId?: string, limit = 25): FtsSearchHit[] {
    const tokens = query
      .trim()
      .split(/\s+/)
      .map((t) => t.replace(/["'()*^:]/g, '').trim())
      .filter((t) => t.length >= 2)
      .slice(0, 8);
    if (tokens.length === 0) return [];

    // Safe FTS5 phrase/prefix match using double-quoted literal tokens
    const matchExpr = tokens.map((t) => `"${t}"*`).join(' AND ');

    try {
      const sql = caseId
        ? `
          SELECT p.id, p.case_id, p.url, p.domain, p.title, p.sha256, p.fetched_at,
                 snippet(pages_fts, 5, '[', ']', '…', 20) AS snippet
          FROM pages_fts
          JOIN collected_pages p ON p.id = pages_fts.page_id
          WHERE pages_fts MATCH ? AND pages_fts.case_id = ?
          ORDER BY rank
          LIMIT ?
        `
        : `
          SELECT p.id, p.case_id, p.url, p.domain, p.title, p.sha256, p.fetched_at,
                 snippet(pages_fts, 5, '[', ']', '…', 20) AS snippet
          FROM pages_fts
          JOIN collected_pages p ON p.id = pages_fts.page_id
          WHERE pages_fts MATCH ?
          ORDER BY rank
          LIMIT ?
        `;

      const rows = (
        caseId
          ? this.db.prepare(sql).all(matchExpr, caseId, limit)
          : this.db.prepare(sql).all(matchExpr, limit)
      ) as Array<{
        id: string;
        case_id: string;
        url: string;
        domain: string;
        title: string;
        sha256: string;
        fetched_at: string;
        snippet: string;
      }>;

      return rows.map((r) => ({
        id: r.id,
        caseId: r.case_id,
        url: r.url,
        domain: r.domain,
        title: r.title,
        sha256: r.sha256,
        fetchedAtUtc: r.fetched_at,
        snippet: r.snippet || '',
      }));
    } catch {
      return [];
    }
  }

  public upsertScanJob(job: ScanJobRecord): void {
    this.db
      .prepare(
        `
      INSERT INTO scan_jobs (
        id, case_id, kind, target, depth, status,
        entities_found, edges_found, steps_completed, result_json,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        entities_found = excluded.entities_found,
        edges_found = excluded.edges_found,
        steps_completed = excluded.steps_completed,
        result_json = excluded.result_json,
        updated_at = excluded.updated_at
    `
      )
      .run(
        job.id,
        job.caseId,
        job.kind,
        job.target,
        job.depth,
        job.status,
        job.entitiesFound,
        job.edgesFound,
        job.stepsCompleted,
        job.resultJson,
        job.createdAtUtc,
        job.updatedAtUtc
      );
  }

  public listScanJobs(caseId?: string, limit = 25): ScanJobRecord[] {
    const rows = (
      caseId
        ? this.db
            .prepare(
              'SELECT * FROM scan_jobs WHERE case_id = ? ORDER BY updated_at DESC LIMIT ?'
            )
            .all(caseId, limit)
        : this.db
            .prepare('SELECT * FROM scan_jobs ORDER BY updated_at DESC LIMIT ?')
            .all(limit)
    ) as Array<{
      id: string;
      case_id: string;
      kind: string;
      target: string;
      depth: number;
      status: 'running' | 'completed' | 'failed';
      entities_found: number;
      edges_found: number;
      steps_completed: number;
      result_json: string | null;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((r) => ({
      id: r.id,
      caseId: r.case_id,
      kind: r.kind,
      target: r.target,
      depth: r.depth,
      status: r.status,
      entitiesFound: r.entities_found,
      edgesFound: r.edges_found,
      stepsCompleted: r.steps_completed,
      resultJson: r.result_json,
      createdAtUtc: r.created_at,
      updatedAtUtc: r.updated_at,
    }));
  }

  public getStats(): {
    caseCount: number;
    archivedPageCount: number;
    scanJobCount: number;
    dbPath: string;
  } {
    const c = (
      this.db.prepare('SELECT COUNT(*) as n FROM cases').get() as { n: number }
    ).n;
    const p = (
      this.db
        .prepare('SELECT COUNT(*) as n FROM collected_pages')
        .get() as { n: number }
    ).n;
    const j = (
      this.db
        .prepare('SELECT COUNT(*) as n FROM scan_jobs')
        .get() as { n: number }
    ).n;
    return {
      caseCount: Number(c || 0),
      archivedPageCount: Number(p || 0),
      scanJobCount: Number(j || 0),
      dbPath: this.dbPath,
    };
  }

  public close(): void {
    this.db.close();
  }
}

/**
 * Returns the live server-side connector capability matrix.
 * All optional API keys live strictly in server process.env — never exposed to client.
 */
export function getConnectorStatusMatrix(): ConnectorStatusEntry[] {
  const has = (name: string) => Boolean(process.env[name]?.trim());
  return [
    {
      id: 'gdelt-doc',
      name: 'GDELT 2.0 Global News',
      category: 'Search',
      mode: 'zero-key',
      envVar: null,
      active: true,
      note: '100+ language global news discovery',
    },
    {
      id: 'common-crawl',
      name: 'Common Crawl CDX',
      category: 'Search',
      mode: 'zero-key',
      envVar: null,
      active: true,
      note: 'Web-scale URL & domain index',
    },
    {
      id: 'social-open',
      name: 'Reddit · HN · Bluesky · Mastodon · GitHub · IA',
      category: 'Search',
      mode: 'zero-key',
      envVar: null,
      active: true,
      note: 'Zero-key public discussion, code & archive search',
    },
    {
      id: 'searxng',
      name: 'Self-Hosted SearXNG',
      category: 'Search',
      mode: 'optional-env-key',
      envVar: 'SEARXNG_URL',
      active: has('SEARXNG_URL'),
      note: 'Optional local meta-search backend via SEARXNG_URL',
    },
    {
      id: 'brave-search',
      name: 'Brave Search API',
      category: 'Search',
      mode: 'optional-env-key',
      envVar: 'BRAVE_API_KEY',
      active: has('BRAVE_API_KEY'),
      note: 'Optional open-web SERP enrichment via server env',
    },
    {
      id: 'serper-search',
      name: 'Serper Google SERP',
      category: 'Search',
      mode: 'optional-env-key',
      envVar: 'SERPER_API_KEY',
      active: has('SERPER_API_KEY'),
      note: 'Optional automated Google dork execution via server env',
    },
    {
      id: 'identity-zero-key',
      name: 'WMN · GitHub · GitLab · Keybase · ProtonPGP · XposedOrNot',
      category: 'Identity',
      mode: 'zero-key',
      envVar: null,
      active: true,
      note: 'Zero-key profile enrichment, PGP & breach metadata',
    },
    {
      id: 'hibp',
      name: 'Have I Been Pwned',
      category: 'Identity',
      mode: 'optional-env-key',
      envVar: 'HIBP_API_KEY',
      active: has('HIBP_API_KEY'),
      note: 'Optional commercial breach feed via server env',
    },
    {
      id: 'public-records-zero-key',
      name: 'OFAC SDN · OpenSanctions · SEC EDGAR · CourtListener · GLEIF · ICIJ',
      category: 'Corporate & Legal',
      mode: 'zero-key',
      envVar: null,
      active: true,
      note: 'Live federal filings, dockets, watchlists & LEI ownership',
    },
    {
      id: 'uk-companies-house',
      name: 'UK Companies House',
      category: 'Corporate & Legal',
      mode: 'optional-env-key',
      envVar: 'UK_COMPANIES_HOUSE_API_KEY',
      active: has('UK_COMPANIES_HOUSE_API_KEY'),
      note: 'Optional free UK registry API key via server env',
    },
    {
      id: 'infra-zero-key',
      name: 'DoH · RDAP · crt.sh · InternetDB · URLScan · OTX · ThreatFox · URLhaus · BGPView',
      category: 'Infrastructure',
      mode: 'zero-key',
      envVar: null,
      active: true,
      note: 'Full passive DNS, reverse-IP, BGP, threat intel & favicon hash',
    },
    {
      id: 'crypto-maritime-zero-key',
      name: 'Mempool.space (BTC) · Blockscout (ETH) · OFAC Crypto · Vessel Registry',
      category: 'Crypto & Maritime',
      mode: 'zero-key',
      envVar: null,
      active: true,
      note: 'Zero-key blockchain clustering & vessel screening',
    },
    {
      id: 'gemini-copilot',
      name: 'Gemini Case Analyst Copilot (gemini-4-hydrogen)',
      category: 'AI Analysis',
      mode: 'optional-env-key',
      envVar: 'GEMINI_API_KEY',
      active: has('GEMINI_API_KEY'),
      note: 'Evidence-grounded NER, ACH & next-pivot reasoning',
    },
  ];
}
