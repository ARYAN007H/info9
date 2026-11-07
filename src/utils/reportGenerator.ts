import { computeMerkleRoot, verifyEvidenceLedgerChain } from './osintForensics';
import type { InvestigationCase } from '../types/osint';

/**
 * Builds a self-contained, print-optimized HTML dossier for an
 * InvestigationCase. Rendered by the browser's own print-to-PDF pipeline —
 * zero dependencies, and the analyst gets a real PDF with page margins.
 *
 * Evidentiary contract: only recorded findings appear, every value carries
 * its provenance or an explicit gap, and user-supplied strings are always
 * HTML-escaped. Methodology citations point at docs/methodology/ so the
 * report explains HOW each conclusion class is reached.
 */

const METHODOLOGY_LINKS: Record<string, { label: string; url: string }> = {
  geolocation: {
    label: 'Geolocation & chronolocation methodology',
    url: 'https://github.com/ARYAN007H/info9/blob/main/docs/methodology/geolocation.md',
  },
  dossier: {
    label: 'Corporate unwrapping methodology',
    url: 'https://github.com/ARYAN007H/info9/blob/main/docs/methodology/corporate-unwrapping.md',
  },
  infra: {
    label: 'Infrastructure recon methodology',
    url: 'https://github.com/ARYAN007H/info9/blob/main/docs/methodology/infrastructure-recon.md',
  },
  forensics: {
    label: 'Media forensics methodology',
    url: 'https://github.com/ARYAN007H/info9/blob/main/docs/methodology/media-forensics.md',
  },
  identity: {
    label: 'Identity resolution methodology',
    url: 'https://github.com/ARYAN007H/info9/blob/main/docs/methodology/identity.md',
  },
  sanctions: {
    label: 'Sanctions screening methodology',
    url: 'https://github.com/ARYAN007H/info9/blob/main/docs/methodology/sanctions-screening.md',
  },
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const BASE_CSS = `
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a2233; margin: 0; padding: 28px 34px; font-size: 12px; line-height: 1.5; }
  h1 { font-size: 21px; margin: 0 0 2px; letter-spacing: -0.3px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 1.2px; color: #0f4c81; border-bottom: 2px solid #0f4c81; padding-bottom: 4px; margin: 26px 0 10px; }
  h3 { font-size: 12.5px; margin: 12px 0 4px; }
  .meta-line { color: #64748b; font-size: 11px; margin: 2px 0; }
  .mono { font-family: 'Consolas', 'Menlo', monospace; font-size: 11px; }
  .kv { width: 100%; border-collapse: collapse; margin: 6px 0; }
  .kv td { border: 1px solid #d8dee9; padding: 4px 8px; vertical-align: top; }
  .kv td.k { width: 190px; background: #f4f6fa; font-weight: 600; }
  .card { border: 1px solid #d8dee9; border-radius: 6px; padding: 10px 12px; margin: 8px 0; page-break-inside: avoid; }
  .badge { display: inline-block; border: 1px solid #b7c0cf; border-radius: 3px; padding: 0 6px; font-size: 10px; font-weight: 700; letter-spacing: 0.4px; }
  .badge.gap { border-color: #c2921f; color: #8a6a10; background: #fdf6e3; }
  .badge.live { border-color: #1a7f5a; color: #1a7f5a; background: #ecfaf3; }
  .badge.derived { border-color: #0f4c81; color: #0f4c81; background: #ecf4fb; }
  .gap-note { color: #8a6a10; font-size: 11px; }
  ul { margin: 4px 0 8px 18px; padding: 0; }
  li { margin: 2px 0; }
  .footer { margin-top: 30px; border-top: 1px solid #d8dee9; padding-top: 10px; color: #64748b; font-size: 10.5px; }
  .cite { font-size: 11px; color: #334155; }
  .cite a { color: #0f4c81; }
  @page { margin: 14mm 12mm; }
`;

function section(title: string, bodyHtml: string): string {
  if (!bodyHtml.trim()) return '';
  return `<h2>${escapeHtml(title)}</h2>\n${bodyHtml}`;
}

function provenanceBadge(status?: string): string {
  if (status === 'UNAVAILABLE') return '<span class="badge gap">NO DATA</span>';
  if (status === 'DERIVED') return '<span class="badge derived">DERIVED</span>';
  return '<span class="badge live">LIVE</span>';
}

export function buildPrintableReportHtml(
  activeCase: InvestigationCase,
  nowIso: string = new Date().toISOString()
): string {
  const esc = escapeHtml;
  const chain = verifyEvidenceLedgerChain(activeCase.evidenceLedger);
  const merkle = computeMerkleRoot(activeCase.evidenceLedger);
  const usedModules = new Set<string>();

  const parts: string[] = [];

  // --- Header ---
  parts.push(`
    <h1>info9 Investigation Dossier</h1>
    <div class="meta-line mono">${esc(activeCase.codeName)} · ${esc(activeCase.classification)}</div>
    <div class="meta-line">${esc(activeCase.title)}</div>
    <div class="meta-line">Generated ${esc(nowIso.slice(0, 16).replace('T', ' '))} UTC · Ledger chain: ${
      chain.isValid ? 'VERIFIED (' + chain.verifiedCount + ' blocks)' : 'TAMPERED at block ' + chain.tamperedIndex
    } · Merkle root <span class="mono">${esc(merkle)}</span></div>
  `);

  // --- Geolocation ---
  if (activeCase.geoState.locationLabel) {
    usedModules.add('geolocation');
    const w = activeCase.geoState.weatherVerification;
    const weather = w
      ? `<tr><td class="k">Weather verification</td><td>${esc(w.date)} · ${esc(
          String(w.minTempC)
        )}–${esc(String(w.maxTempC))}°C · cloud cover ${esc(
          String(w.cloudCoverMeanPercent)
        )}% · ${esc(w.shadowPlausibility)} · elevation ${
          w.elevationMeters != null ? esc(String(w.elevationMeters)) + ' m' : '<span class="badge gap">NO DATA</span>'
        }</td></tr>`
      : `<tr><td class="k">Weather verification</td><td><span class="badge gap">NO DATA</span> — never queried or upstream unavailable</td></tr>`;
    parts.push(
      section(
        'Geolocation finding',
        `<table class="kv">
          <tr><td class="k">Location</td><td>${esc(activeCase.geoState.locationLabel)}</td></tr>
          <tr><td class="k">Coordinates</td><td class="mono">${activeCase.geoState.lat.toFixed(
            5
          )}, ${activeCase.geoState.lon.toFixed(5)}</td></tr>
          <tr><td class="k">Date under assessment</td><td>${esc(activeCase.geoState.dateIso)}</td></tr>
          ${weather}
        </table>`
      )
    );
  }

  // --- Entities & ownership ---
  if (activeCase.entities.length > 0) {
    usedModules.add('dossier');
    const rows = activeCase.entities
      .map(
        (e) => `<tr>
          <td>${esc(e.label)}</td>
          <td>${esc(e.type)}</td>
          <td>${esc(e.jurisdiction)}</td>
          <td class="mono">${esc(e.identifier)}</td>
          <td>${esc(e.riskLevel)}</td>
        </tr>`
      )
      .join('');
    const edges = activeCase.ownershipEdges
      .map(
        (edge) =>
          `<li class="mono">${esc(edge.sourceId)} → ${esc(edge.targetId)} · ${esc(
            edge.relationship
          )}${edge.isOffshoreConduit ? ' · offshore conduit flag' : ''} · source: ${esc(
            edge.verifiedSource
          )}</li>`
      )
      .join('');
    parts.push(
      section(
        'Saved entities & ownership graph',
        `<table class="kv"><tr><td><b>Name</b></td><td><b>Type</b></td><td><b>Jurisdiction</b></td><td><b>Identifier</b></td><td><b>Risk</b></td></tr>${rows}</table>
         ${edges ? `<h3>Ownership links</h3><ul>${edges}</ul>` : ''}`
      )
    );
  }

  // --- Infrastructure ---
  if (activeCase.infraRecords.length > 0) {
    usedModules.add('infra');
    const cards = activeCase.infraRecords
      .map((d) => {
        const factors = d.riskAssessment.factors
          .map((f) => `<li>${esc(f.label)} <span class="mono">+${f.points}</span></li>`)
          .join('');
        return `<div class="card">
          <h3 class="mono">${esc(d.domain)}</h3>
          <table class="kv">
            <tr><td class="k">A records</td><td class="mono">${esc(d.aRecords.join(', ') || '— none —')}</td></tr>
            <tr><td class="k">Hosting</td><td>${esc(d.asn ?? '— gap —')} (${esc(
              d.asnOrg ?? 'attribution unavailable'
            )}) · ${esc(d.ipCountry)}</td></tr>
            <tr><td class="k">Registration</td><td>${esc(d.createdAt ?? '— gap —')} · ${esc(
              d.registrar ?? 'registrar unavailable'
            )}</td></tr>
            <tr><td class="k">Email anti-spoofing</td><td>DMARC: ${esc(
              d.dmarcPolicy ?? 'not configured'
            )}</td></tr>
            <tr><td class="k">TLS / CT</td><td>${esc(d.tlsIssuer ?? '— gap —')} · ${
              d.ctSubdomainsCount
            } subdomains</td></tr>
            <tr><td class="k">Heuristic risk</td><td><b>${d.riskAssessment.score}/100</b> — additive rule table (see methodology)${
              factors ? `<ul>${factors}</ul>` : '<div class="gap-note">No factors triggered.</div>'
            }</td></tr>
            <tr><td class="k">Provenance</td><td>${provenanceBadge(
              d.provenance.status
            )} ${esc(d.provenance.source)} @ ${esc(d.provenance.fetchedAtUtc.slice(0, 16).replace('T', ' '))}</td></tr>
          </table>
          ${
            d.dataGaps.length
              ? `<div class="gap-note">Data gaps: ${d.dataGaps.map(esc).join('; ')}</div>`
              : ''
          }
        </div>`;
      })
      .join('');
    parts.push(section('Infrastructure records', cards));
  }

  // --- Identity findings from ledger ---
  const identityEntries = activeCase.evidenceLedger.filter((e) => e.module === 'identity');
  if (identityEntries.length > 0) {
    usedModules.add('identity');
    parts.push(
      section(
        'Identity resolution findings',
        `<ul>${identityEntries
          .map(
            (e) =>
              `<li><b>${esc(e.targetLabel)}</b> — ${esc(e.findingSummary)} <span class="mono">[${esc(
                e.sha256Hash.slice(0, 16)
              )}…]</span></li>`
          )
          .join('')}</ul>`
      )
    );
  }

  // --- Forensics ---
  if (activeCase.forensicSamples.length > 0) {
    usedModules.add('forensics');
    const cards = activeCase.forensicSamples
      .map(
        (s) => `<div class="card">
          <h3>${esc(s.title)}</h3>
          <div class="meta-line">Claimed: ${esc(s.claimedDateUtc)} · ${esc(s.claimedLocation)} · claimed coords <span class="mono">${esc(
            s.claimedCoords.join(', ')
          )}</span></div>
          <ul>${s.exifTags
            .map(
              (t) =>
                `<li>${esc(t.name)}: ${esc(t.value)} <span class="badge ${
                  t.status === 'NOMINAL' ? 'live' : 'gap'
                }">${esc(t.status)}</span></li>`
            )
            .join('')}</ul>
        </div>`
      )
      .join('');
    parts.push(section('Media forensics samples', cards));
  }

  // --- Sanctions screening (query + note; scored results live in ledger notes) ---
  if (activeCase.sanctionsQuery.targetName.trim()) {
    usedModules.add('sanctions');
    parts.push(
      section(
        'Sanctions screening query',
        `<table class="kv">
          <tr><td class="k">Screened name</td><td>${esc(activeCase.sanctionsQuery.targetName)}</td></tr>
          <tr><td class="k">DOB / jurisdiction</td><td>${esc(
            activeCase.sanctionsQuery.targetDob || '—'
          )} · ${esc(activeCase.sanctionsQuery.targetJurisdiction || '—')}</td></tr>
          <tr><td class="k">Dataset</td><td>Live OFAC SDN list (U.S. Treasury) and/or bundled demo set — see ledger entries for the exact run</td></tr>
        </table>`
      )
    );
  }

  // --- Full evidence ledger ---
  const ledgerRows =
    activeCase.evidenceLedger.length === 0
      ? '<div class="gap-note">No findings recorded.</div>'
      : `<table class="kv"><tr><td><b>#</b></td><td><b>UTC</b></td><td><b>Module</b></td><td><b>Target</b></td><td><b>Finding</b></td><td><b>SHA-256</b></td></tr>${activeCase.evidenceLedger
          .map(
            (e) =>
              `<tr><td>${e.index}</td><td class="mono">${esc(e.timestampUtc.slice(0, 19))}</td><td>${esc(
                e.module
              )}</td><td>${esc(e.targetLabel)}</td><td>${esc(e.findingSummary)}</td><td class="mono">${esc(
                e.sha256Hash
              )}</td></tr>`
          )
          .join('')}</table>`;
  parts.push(section('Evidence ledger (hash-chained)', ledgerRows));

  // --- Methodology & citations ---
  const citationList = [...usedModules]
    .map((m) => {
      const link = METHODOLOGY_LINKS[m];
      return link
        ? `<li><a href="${link.url}">${esc(link.label)}</a> — docs/methodology/${esc(m === 'dossier' ? 'corporate-unwrapping' : m === 'infra' ? 'infrastructure-recon' : m)}.md</li>`
        : '';
    })
    .filter(Boolean)
    .join('');
  parts.push(
    section(
      'Methodology & citations',
      `<p class="cite">Each conclusion class above is produced by a documented, unit-tested method. How each section was reached:</p>
       <ul>${citationList}</ul>
       <p class="cite">External references: NOAA Solar Calculator (solar position equations) · OpenStreetMap Overpass QL API · Open-Meteo ERA5 archive · GLEIF API Level-2 relationship records · Shodan InternetDB · RIPEstat Data API · U.S. Treasury OFAC SDN publication · WebBreacher's WhatsMyName dataset · Wikimedia Commons API · Bellingcat's online investigation guides.</p>`
    )
  );

  parts.push(`
    <div class="footer">
      Generated by <b>info9 — Argon OSINT Workbench</b> (zero-key, AGPL-3.0). Provenance badges: LIVE = returned by the named upstream for this query · DERIVED = computed locally from live inputs · NO DATA = upstream failed or was never queried. A heuristic risk score is a triage aid, not a verdict. Verify before you amplify.
    </div>
  `);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>info9 dossier — ${esc(
    activeCase.codeName
  )}</title><style>${BASE_CSS}</style></head><body>${parts.join('\n')}</body></html>`;
}
