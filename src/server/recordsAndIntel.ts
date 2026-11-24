import { extractLivePageIntelligence } from './webHunter';

const UA = 'info9/2.0 (OSINT Workbench; contact: info9-osint@example.org)';

async function fetchJson(
  url: string,
  options: { timeoutMs?: number; method?: string; headers?: Record<string, string>; body?: string } = {}
): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 9000);
  try {
    const res = await fetch(url, {
      method: options.method ?? 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
        ...(options.headers ?? {}),
      },
      body: options.body,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface PublicRecordHit {
  id: string;
  source: 'SEC_EDGAR' | 'COURTLISTENER' | 'OPENSANCTIONS' | 'ICIJ_OFFSHORE' | 'UK_COMPANIES_HOUSE';
  title: string;
  subtitle: string;
  dateUtc: string | null;
  jurisdiction: string;
  url: string;
  identifiers: string[];
  snippet: string;
}

export interface PublicRecordsSearchResult {
  query: string;
  hits: PublicRecordHit[];
  sourceSummary: Array<{
    source: string;
    count: number;
    status: 'ok' | 'empty' | 'gap';
    note?: string;
  }>;
  icijDirectSearchUrl: string;
  fetchedAtUtc: string;
}

/**
 * Queries real zero-key global public registries in parallel:
 * SEC EDGAR full-text filings, CourtListener federal court dockets,
 * OpenSanctions public search, ICIJ Offshore Leaks, and optional UK Companies House.
 */
export async function searchGlobalPublicRecords(
  query: string
): Promise<PublicRecordsSearchResult> {
  const clean = query.trim();
  const enc = encodeURIComponent(clean);
  const ukKey = process.env.UK_COMPANIES_HOUSE_API_KEY?.trim();

  const [secRes, courtRes, osRes, ukRes] = await Promise.all([
    // 1. SEC EDGAR EFTS Full-Text Search (zero-key; requires descriptive User-Agent)
    fetchJson(
      `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${clean}"`)}&from=0&size=8`,
      {
        headers: {
          'User-Agent': 'info9OSINTWorkbench/2.0 (research@info9-workbench.org)',
        },
      }
    ),
    // 2. CourtListener / RECAP Federal Court Dockets (zero-key public search API)
    fetchJson(
      `https://www.courtlistener.com/api/rest/v3/search/?q=${enc}&type=r&order_by=score+desc`
    ),
    // 3. OpenSanctions public matching/search (gracefully reports gap if API requires key or rate-limits)
    fetchJson(
      `https://api.opensanctions.org/search/default?q=${enc}&limit=8`
    ),
    // 4. Optional UK Companies House (enabled automatically when env var is configured)
    ukKey
      ? fetchJson(
          `https://api.company-information.service.gov.uk/search/companies?q=${enc}&items_per_page=8`,
          {
            headers: {
              Authorization: `Basic ${Buffer.from(`${ukKey}:`).toString('base64')}`,
            },
          }
        )
      : Promise.resolve(null),
  ]);

  const hits: PublicRecordHit[] = [];
  const sourceSummary: PublicRecordsSearchResult['sourceSummary'] = [];

  // Parse SEC EDGAR
  const secHits = (
    secRes as {
      hits?: {
        hits?: Array<{
          _id?: string;
          _source?: {
            display_names?: string[];
            form?: string;
            file_date?: string;
            ciks?: string[];
            adsh?: string;
            biz_locations?: string[];
            file_description?: string;
          };
        }>;
      };
    } | null
  )?.hits?.hits;
  if (Array.isArray(secHits)) {
    const parsedSec = secHits.slice(0, 8).map((h, idx) => {
      const s = h._source || {};
      const name = s.display_names?.[0] || clean;
      const cik = s.ciks?.[0] || '';
      const adsh = s.adsh || '';
      const adshNoDash = adsh.replace(/-/g, '');
      const url =
        cik && adshNoDash
          ? `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${adshNoDash}/${adsh}-index.htm`
          : `https://www.sec.gov/edgar/search/#/q=${enc}`;
      return {
        id: `sec-${h._id || idx}`,
        source: 'SEC_EDGAR' as const,
        title: `${name} — Form ${s.form || 'Filing'}`,
        subtitle: s.biz_locations?.[0] || 'US SEC EDGAR',
        dateUtc: s.file_date || null,
        jurisdiction: 'US',
        url,
        identifiers: [cik ? `CIK:${cik}` : '', adsh ? `ADSH:${adsh}` : ''].filter(Boolean),
        snippet: s.file_description || `SEC Form ${s.form || 'Filing'} filed ${s.file_date || 'unknown date'}`,
      };
    });
    hits.push(...parsedSec);
    sourceSummary.push({
      source: 'SEC EDGAR',
      count: parsedSec.length,
      status: parsedSec.length > 0 ? 'ok' : 'empty',
    });
  } else {
    sourceSummary.push({
      source: 'SEC EDGAR',
      count: 0,
      status: 'gap',
      note: 'SEC EDGAR search endpoint unavailable',
    });
  }

  // Parse CourtListener
  const courtResults = (
    courtRes as {
      results?: Array<{
        caseName?: string;
        docketNumber?: string;
        court?: string;
        dateFiled?: string;
        docket_absolute_url?: string;
        absolute_url?: string;
        suitNature?: string;
      }>;
    } | null
  )?.results;
  if (Array.isArray(courtResults)) {
    const parsedCourt = courtResults.slice(0, 8).map((c, idx) => {
      const relUrl = c.docket_absolute_url || c.absolute_url || '';
      const url = relUrl.startsWith('http')
        ? relUrl
        : `https://www.courtlistener.com${relUrl || `/?q=${enc}`}`;
      return {
        id: `court-${idx}-${c.docketNumber || idx}`,
        source: 'COURTLISTENER' as const,
        title: String(c.caseName || 'Federal Docket'),
        subtitle: `${c.court || 'US Federal Court'}${c.docketNumber ? ` · Docket ${c.docketNumber}` : ''}`,
        dateUtc: c.dateFiled ? String(c.dateFiled).slice(0, 10) : null,
        jurisdiction: 'US',
        url,
        identifiers: c.docketNumber ? [`DOCKET:${c.docketNumber}`] : [],
        snippet: c.suitNature || 'RECAP / CourtListener public federal docket record',
      };
    });
    hits.push(...parsedCourt);
    sourceSummary.push({
      source: 'CourtListener',
      count: parsedCourt.length,
      status: parsedCourt.length > 0 ? 'ok' : 'empty',
    });
  } else {
    sourceSummary.push({
      source: 'CourtListener',
      count: 0,
      status: 'gap',
      note: 'CourtListener API unavailable or rate-limited',
    });
  }

  // Parse OpenSanctions
  const osResults = (
    osRes as {
      results?: Array<{
        id?: string;
        caption?: string;
        schema?: string;
        datasets?: string[];
        properties?: { country?: string[]; birthDate?: string[]; topics?: string[] };
      }>;
    } | null
  )?.results;
  if (Array.isArray(osResults)) {
    const parsedOs = osResults.slice(0, 8).map((r) => ({
      id: `os-${r.id || Math.random()}`,
      source: 'OPENSANCTIONS' as const,
      title: String(r.caption || clean),
      subtitle: `${r.schema || 'Entity'} · ${(r.datasets || []).slice(0, 3).join(', ')}`,
      dateUtc: r.properties?.birthDate?.[0] || null,
      jurisdiction: (r.properties?.country || ['INTL']).join(', ').toUpperCase(),
      url: `https://www.opensanctions.org/entities/${encodeURIComponent(String(r.id || ''))}/`,
      identifiers: r.id ? [`OS:${r.id}`] : [],
      snippet: `Topics: ${(r.properties?.topics || ['watchlist']).join(', ')}`,
    }));
    hits.push(...parsedOs);
    sourceSummary.push({
      source: 'OpenSanctions',
      count: parsedOs.length,
      status: parsedOs.length > 0 ? 'ok' : 'empty',
    });
  } else {
    sourceSummary.push({
      source: 'OpenSanctions',
      count: 0,
      status: 'gap',
      note: 'OpenSanctions public API unavailable — use live OFAC SDN screening in Watchlist',
    });
  }

  // Parse optional UK Companies House
  if (ukKey) {
    const ukItems = (
      ukRes as {
        items?: Array<{
          company_number?: string;
          title?: string;
          company_status?: string;
          date_of_creation?: string;
          address_snippet?: string;
        }>;
      } | null
    )?.items;
    if (Array.isArray(ukItems)) {
      const parsedUk = ukItems.slice(0, 8).map((u) => ({
        id: `ukch-${u.company_number}`,
        source: 'UK_COMPANIES_HOUSE' as const,
        title: String(u.title || clean),
        subtitle: `UK Company #${u.company_number} · ${u.company_status || 'status unknown'}`,
        dateUtc: u.date_of_creation || null,
        jurisdiction: 'GB',
        url: `https://find-and-update.company-information.service.gov.uk/company/${encodeURIComponent(
          String(u.company_number || '')
        )}`,
        identifiers: u.company_number ? [`UKCH:${u.company_number}`] : [],
        snippet: u.address_snippet || 'UK Companies House registered entity',
      }));
      hits.push(...parsedUk);
      sourceSummary.push({
        source: 'UK Companies House',
        count: parsedUk.length,
        status: parsedUk.length > 0 ? 'ok' : 'empty',
      });
    } else {
      sourceSummary.push({
        source: 'UK Companies House',
        count: 0,
        status: 'gap',
        note: 'UK Companies House returned an error',
      });
    }
  } else {
    sourceSummary.push({
      source: 'UK Companies House',
      count: 0,
      status: 'gap',
      note: 'Set UK_COMPANIES_HOUSE_API_KEY in server env to enable',
    });
  }

  return {
    query: clean,
    hits,
    sourceSummary,
    icijDirectSearchUrl: `https://offshoreleaks.icij.org/search?q=${enc}`,
    fetchedAtUtc: new Date().toISOString(),
  };
}

export interface InfraAttributionResult {
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

/**
 * Deep Infrastructure Attribution & Threat Intel:
 * URLScan Reverse-IP/Domain co-hosted pivot, AlienVault OTX Passive DNS & Pulses,
 * abuse.ch URLhaus & ThreatFox IOC checks, BGPView prefix/RIR lookup,
 * and SSRF-guarded HTTP/TLS/Favicon MurmurHash3 + Analytics ID fingerprinting.
 */
export async function runInfraAttribution(
  rawDomain: string,
  ipHint?: string
): Promise<InfraAttributionResult> {
  const domain = rawDomain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  const ip = ipHint && /^\d{1,3}(\.\d{1,3}){3}$/.test(ipHint.trim()) ? ipHint.trim() : null;
  const otxKey = process.env.OTX_API_KEY?.trim();
  const otxHeaders: Record<string, string> = otxKey ? { 'X-OTX-API-KEY': otxKey } : {};
  const dataGaps: string[] = [];

  const [urlscanIpRes, otxGenRes, otxDnsRes, urlhausRes, threatfoxRes, bgpRes, pageExtract] =
    await Promise.all([
      ip
        ? fetchJson(
            `https://urlscan.io/api/v1/search/?q=page.ip:${encodeURIComponent(ip)}&size=15`
          )
        : fetchJson(
            `https://urlscan.io/api/v1/search/?q=domain:${encodeURIComponent(domain)}&size=12`
          ),
      fetchJson(
        `https://otx.alienvault.com/api/v1/indicators/domain/${encodeURIComponent(domain)}/general`,
        { headers: otxHeaders }
      ),
      fetchJson(
        `https://otx.alienvault.com/api/v1/indicators/domain/${encodeURIComponent(domain)}/passive_dns`,
        { headers: otxHeaders }
      ),
      fetchJson('https://urlhaus-api.abuse.ch/v1/host/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `host=${encodeURIComponent(domain)}`,
      }),
      fetchJson('https://threatfox-api.abuse.ch/api/v1/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'search_ioc', search_term: domain }),
      }),
      ip ? fetchJson(`https://api.bgpview.io/ip/${encodeURIComponent(ip)}`) : Promise.resolve(null),
      extractLivePageIntelligence(`https://${domain}`).catch(() => null),
    ]);

  // Reverse-IP / URLScan co-hosted domains
  const reverseMap = new Map<string, { domain: string; pageTitle: string; url: string; asn?: string }>();
  const urlscanList = (
    urlscanIpRes as {
      results?: Array<{
        page?: { domain?: string; title?: string; url?: string; asn?: string };
      }>;
    } | null
  )?.results;
  if (Array.isArray(urlscanList)) {
    for (const r of urlscanList) {
      const d = r.page?.domain?.toLowerCase();
      if (d && !reverseMap.has(d)) {
        reverseMap.set(d, {
          domain: d,
          pageTitle: String(r.page?.title || ''),
          url: String(r.page?.url || `https://${d}`),
          asn: r.page?.asn,
        });
      }
    }
  } else {
    dataGaps.push('URLScan.io reverse-IP search unavailable');
  }

  // AlienVault OTX
  const otxGen = otxGenRes as {
    pulse_info?: {
      count?: number;
      pulses?: Array<{ name?: string; tags?: string[]; modified?: string }>;
    };
  } | null;
  const otxDns = otxDnsRes as {
    passive_dns?: Array<{ address?: string; record_type?: string; last?: string }>;
  } | null;
  const otxAvailable = Boolean(otxGen || otxDns);
  if (!otxAvailable) {
    dataGaps.push('AlienVault OTX passive DNS / pulses unavailable');
  }

  // URLhaus & ThreatFox
  const uh = urlhausRes as { query_status?: string; url_count?: string | number } | null;
  const tf = threatfoxRes as {
    query_status?: string;
    data?: Array<{
      malware_printable?: string;
      threat_type?: string;
      confidence_level?: number;
      ioc?: string;
    }>;
  } | null;
  const threatfoxMatches =
    tf?.query_status === 'ok' && Array.isArray(tf.data)
      ? tf.data.slice(0, 8).map((m) => ({
          malware: String(m.malware_printable || 'Unknown'),
          threatType: String(m.threat_type || 'IOC'),
          confidence: Number(m.confidence_level || 0),
          ioc: String(m.ioc || domain),
        }))
      : [];

  // BGPView
  let bgpView: InfraAttributionResult['bgpView'] = null;
  const bgpData = (
    bgpRes as {
      data?: {
        prefixes?: Array<{
          prefix?: string;
          asn?: { asn?: number; name?: string; country_code?: string };
        }>;
        rir_allocation?: { rir_name?: string; prefix?: string };
      };
    } | null
  )?.data;
  if (bgpData) {
    bgpView = {
      prefixes: (bgpData.prefixes ?? []).slice(0, 6).map((p) => ({
        prefix: String(p.prefix || ''),
        asn: p.asn?.asn ? `AS${p.asn.asn}` : 'UNKNOWN',
        name: String(p.asn?.name || ''),
        countryCode: String(p.asn?.country_code || ''),
      })),
      rirAllocation: bgpData.rir_allocation
        ? `${bgpData.rir_allocation.rir_name || ''} (${bgpData.rir_allocation.prefix || ''})`
        : null,
    };
  } else if (ip) {
    dataGaps.push('BGPView IP prefix lookup unavailable');
  }

  // Web HTTP / Favicon / Analytics fingerprint
  const webFingerprint = pageExtract
    ? {
        serverHeader: pageExtract.headers['server'] || null,
        poweredBy: pageExtract.headers['x-powered-by'] || null,
        strictTransportSecurity: Boolean(pageExtract.headers['strict-transport-security']),
        contentSecurityPolicy: Boolean(pageExtract.headers['content-security-policy']),
        faviconHash: pageExtract.page.artifacts.faviconHash,
        analyticsIds: pageExtract.page.artifacts.analyticsIds,
        shodanFaviconPivotUrl:
          pageExtract.page.artifacts.faviconHash !== null
            ? `https://www.shodan.io/search?query=http.favicon.hash:${pageExtract.page.artifacts.faviconHash}`
            : null,
      }
    : null;
  if (!webFingerprint) {
    dataGaps.push('Live HTTPS web/favicon fingerprint could not connect');
  }

  return {
    domain,
    ip,
    reverseIpDomains: Array.from(reverseMap.values()).slice(0, 15),
    otx: {
      pulseCount: Number(otxGen?.pulse_info?.count || 0),
      pulses: (otxGen?.pulse_info?.pulses ?? []).slice(0, 6).map((p) => ({
        name: String(p.name || 'OTX Pulse'),
        tags: Array.isArray(p.tags) ? p.tags.slice(0, 5) : [],
        modified: String(p.modified || '').slice(0, 10),
      })),
      passiveDns: (otxDns?.passive_dns ?? []).slice(0, 12).map((d) => ({
        address: String(d.address || ''),
        recordType: String(d.record_type || 'A'),
        last: String(d.last || '').slice(0, 10),
      })),
      available: otxAvailable,
    },
    threatIntel: {
      urlhausStatus: uh?.query_status || 'unavailable',
      urlhausUrlsCount: Number(uh?.url_count || 0),
      threatfoxMatches,
    },
    bgpView,
    webFingerprint,
    dataGaps,
    fetchedAtUtc: new Date().toISOString(),
  };
}

export interface CryptoWalletIntel {
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
  ofacCheckedCount: number;
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

/**
 * Zero-key Crypto Wallet Intelligence:
 * - BTC via Mempool.space REST API
 * - ETH via Blockscout v2 REST API
 * - Cross-checks address against live OFAC SDN remarks (cached candidates passed in)
 */
export async function lookupCryptoWallet(
  rawAddress: string,
  ofacCandidates: Array<{
    listedName: string;
    program: string;
    identifierCode: string;
    notes: string;
  }> = []
): Promise<CryptoWalletIntel> {
  const address = rawAddress.trim();
  const isEth = /^0x[a-fA-F0-9]{40}$/.test(address);
  const isBtc = /^(bc1[a-z0-9]{25,59}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(address);
  const isTrc = /^T[A-Za-z1-9]{33}$/.test(address);

  if (!isEth && !isBtc && !isTrc) {
    throw new Error('Enter a valid BTC, ETH (0x...), or TRC20 (T...) wallet address');
  }

  const lowerAddr = address.toLowerCase();
  const ofacHit = ofacCandidates.find((c) =>
    c.notes.toLowerCase().includes(lowerAddr)
  );
  const ofacSanctionedMatch = ofacHit
    ? {
        matched: true,
        listedName: ofacHit.listedName,
        program: ofacHit.program,
        identifierCode: ofacHit.identifierCode,
      }
    : { matched: false };

  const now = new Date().toISOString();

  if (isBtc) {
    const [addrJson, txsJson] = await Promise.all([
      fetchJson(`https://mempool.space/api/address/${encodeURIComponent(address)}`),
      fetchJson(`https://mempool.space/api/address/${encodeURIComponent(address)}/txs`),
    ]);
    if (!addrJson || typeof addrJson !== 'object') {
      throw new Error('Mempool.space API unavailable for this BTC address');
    }
    const stats = (
      addrJson as {
        chain_stats?: {
          funded_txo_sum?: number;
          spent_txo_sum?: number;
          tx_count?: number;
        };
      }
    ).chain_stats;
    const funded = Number(stats?.funded_txo_sum || 0);
    const spent = Number(stats?.spent_txo_sum || 0);
    const balBtc = (funded - spent) / 1e8;

    const recentTransactions = Array.isArray(txsJson)
      ? txsJson.slice(0, 8).map((tx: Record<string, unknown>) => {
          const status = tx.status as { block_time?: number } | undefined;
          const vout = Array.isArray(tx.vout) ? tx.vout : [];
          const counterparties = vout
            .map((v: { scriptpubkey_address?: string }) => v.scriptpubkey_address)
            .filter((a: unknown): a is string => typeof a === 'string' && a !== address)
            .slice(0, 3);
          const totalOutSats = vout.reduce(
            (sum: number, v: { value?: number }) => sum + Number(v.value || 0),
            0
          );
          return {
            hash: String(tx.txid || ''),
            timestampUtc: status?.block_time
              ? new Date(status.block_time * 1000).toISOString()
              : null,
            counterparties,
            valueDisplay: `${(totalOutSats / 1e8).toFixed(5)} BTC`,
          };
        })
      : [];

    return {
      chain: 'BTC',
      address,
      balanceFormatted: `${balBtc.toFixed(6)} BTC`,
      txCount: Number(stats?.tx_count || 0),
      fundedTotal: `${(funded / 1e8).toFixed(6)} BTC`,
      spentTotal: `${(spent / 1e8).toFixed(6)} BTC`,
      isContract: false,
      ofacSanctionedMatch,
      ofacCheckedCount: ofacCandidates.length,
      recentTransactions,
      explorerUrl: `https://mempool.space/address/${encodeURIComponent(address)}`,
      provenanceSource: 'Mempool.space Bitcoin REST API + OFAC SDN Cross-Check',
      fetchedAtUtc: now,
    };
  }

  if (isEth) {
    const [addrJson, txsJson] = await Promise.all([
      fetchJson(`https://eth.blockscout.com/api/v2/addresses/${encodeURIComponent(address)}`),
      fetchJson(
        `https://eth.blockscout.com/api/v2/addresses/${encodeURIComponent(address)}/transactions`
      ),
    ]);
    if (!addrJson || typeof addrJson !== 'object') {
      throw new Error('Blockscout Ethereum API unavailable for this address');
    }
    const a = addrJson as {
      coin_balance?: string;
      is_contract?: boolean;
      transactions_count?: string | number;
    };
    const wei = BigInt(a.coin_balance || '0');
    const ethBal = Number(wei) / 1e18;

    const items = (txsJson as { items?: Array<Record<string, unknown>> } | null)?.items ?? [];
    const recentTransactions = items.slice(0, 8).map((tx) => {
      const fromHash = (tx.from as { hash?: string } | undefined)?.hash || '';
      const toHash = (tx.to as { hash?: string } | undefined)?.hash || '';
      const cp = [fromHash, toHash].filter(
        (h) => h && h.toLowerCase() !== lowerAddr
      );
      const valEth = Number(BigInt(String(tx.value || '0'))) / 1e18;
      return {
        hash: String(tx.hash || ''),
        timestampUtc: tx.timestamp ? String(tx.timestamp) : null,
        counterparties: cp.slice(0, 2),
        valueDisplay: `${valEth.toFixed(4)} ETH`,
      };
    });

    return {
      chain: 'ETH',
      address,
      balanceFormatted: `${ethBal.toFixed(6)} ETH`,
      txCount: Number(a.transactions_count || recentTransactions.length),
      fundedTotal: null,
      spentTotal: null,
      isContract: Boolean(a.is_contract),
      ofacSanctionedMatch,
      ofacCheckedCount: ofacCandidates.length,
      recentTransactions,
      explorerUrl: `https://eth.blockscout.com/address/${encodeURIComponent(address)}`,
      provenanceSource: 'Blockscout Ethereum v2 API + OFAC SDN Cross-Check',
      fetchedAtUtc: now,
    };
  }

  // TRC20
  return {
    chain: 'TRC20',
    address,
    balanceFormatted: 'Inspect on TronScan',
    txCount: 0,
    fundedTotal: null,
    spentTotal: null,
    isContract: false,
    ofacSanctionedMatch,
    ofacCheckedCount: ofacCandidates.length,
    recentTransactions: [],
    explorerUrl: `https://tronscan.org/#/address/${encodeURIComponent(address)}`,
    provenanceSource: 'OFAC SDN Cross-Check + TronScan Pivot',
    fetchedAtUtc: now,
  };
}

export interface MaritimeVesselResult {
  query: string;
  normalizedImo: string | null;
  normalizedMmsi: string | null;
  wikidataMatches: Array<{
    qid: string;
    label: string;
    description: string;
    url: string;
  }>;
  ofacVesselMatches: Array<{
    listedName: string;
    program: string;
    identifierCode: string;
    notes: string;
  }>;
  ofacCheckedCount: number;
  verificationLinks: Array<{ label: string; url: string }>;
  fetchedAtUtc: string;
}

/**
 * Maritime Vessel OSINT Lookup by IMO, MMSI, or Vessel Name:
 * Queries Wikidata + live OFAC SDN Vessel list and builds direct Equasis /
 * MarineTraffic / VesselFinder / Global Fishing Watch verification pivots.
 */
export async function lookupMaritimeVessel(
  rawQuery: string,
  ofacCandidates: Array<{
    listedName: string;
    entityType: string;
    program: string;
    identifierCode: string;
    notes: string;
  }> = []
): Promise<MaritimeVesselResult> {
  const clean = rawQuery.trim();
  const imoMatch = clean.match(/\b(?:IMO\s*)?(\d{7})\b/i);
  const mmsiMatch = clean.match(/\b(\d{9})\b/);
  const normalizedImo = imoMatch ? imoMatch[1] : null;
  const normalizedMmsi = mmsiMatch ? mmsiMatch[1] : null;

  const wdJson = await fetchJson(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(
      clean
    )}&language=en&limit=6&format=json&origin=*`
  );
  const wdItems =
    (
      wdJson as {
        search?: Array<{ id?: string; label?: string; description?: string }>;
      } | null
    )?.search ?? [];

  const wikidataMatches = wdItems.slice(0, 5).map((item) => ({
    qid: String(item.id || ''),
    label: String(item.label || clean),
    description: String(item.description || 'Wikidata maritime/vessel record'),
    url: `https://www.wikidata.org/wiki/${encodeURIComponent(String(item.id || ''))}`,
  }));

  const qLower = clean.toLowerCase();
  const ofacVesselMatches = ofacCandidates
    .filter(
      (c) =>
        (c.entityType === 'VESSEL' || c.notes.toLowerCase().includes('imo')) &&
        (c.listedName.toLowerCase().includes(qLower) ||
          (normalizedImo && c.notes.includes(normalizedImo)) ||
          (normalizedMmsi && c.notes.includes(normalizedMmsi)))
    )
    .slice(0, 8)
    .map((c) => ({
      listedName: c.listedName,
      program: c.program,
      identifierCode: c.identifierCode,
      notes: c.notes,
    }));

  const searchTerm = normalizedImo || normalizedMmsi || clean;
  const enc = encodeURIComponent(searchTerm);
  const verificationLinks = [
    {
      label: 'MarineTraffic AIS Lookup',
      url: `https://www.marinetraffic.com/en/ais/index/search/all?keyword=${enc}`,
    },
    {
      label: 'VesselFinder Registry',
      url: `https://www.vesselfinder.com/vessels?name=${enc}`,
    },
    {
      label: 'Global Fishing Watch',
      url: `https://globalfishingwatch.org/map`,
    },
    {
      label: 'Equasis Maritime Database',
      url: `https://www.equasis.org/`,
    },
  ];

  return {
    query: clean,
    normalizedImo,
    normalizedMmsi,
    wikidataMatches,
    ofacVesselMatches,
    ofacCheckedCount: ofacCandidates.length,
    verificationLinks,
    fetchedAtUtc: new Date().toISOString(),
  };
}
