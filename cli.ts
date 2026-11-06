#!/usr/bin/env node
/**
 * info9 CLI — the same zero-key intelligence core as the web workbench,
 * headless. Every command honors upstream rate limits, caches responses,
 * and stamps provenance. No API keys. Ever.
 *
 *   npm run cli -- connectors
 *   npm run cli -- recon example.com
 *   npm run cli -- geocode "Tower Bridge London"
 *   npm run cli -- landmarks 35.68214,139.76308
 *   npm run cli -- weather 35.68214,139.76308
 *   npm run cli -- entity "Siemens AG"
 *   npm run cli -- screen "Viktor Morozov" 1968-04-14
 */
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { parseCliArgs } from './src/core/cliParse';
import {
  getConnector,
  listConnectors,
  suggestPivots,
} from './src/connectors';
import { scoreSanctionsCandidate } from './src/utils/osintForensics';
import { SEED_INVESTIGATION_CASES } from './src/data/seedCases';

const USAGE = `info9 — zero-key OSINT workbench (headless)

USAGE: npm run cli -- <command> [args] [--pretty]

COMMANDS:
  connectors                      List the zero-key connector registry
  recon <domain>                  Full passive recon on a domain (DNS, RDAP, CT,
                                  Shodan InternetDB, RIPEstat, transparent risk)
  geocode "<place>"               Place name -> coordinates (Nominatim)
  landmarks <lat,lon>             Infrastructure landmarks within 2.5 km (Overpass)
  weather <lat,lon>               Elevation + historical weather (Open-Meteo ERA5)
  entity "<name>"                 GLEIF + Wikidata entity search
  screen "<name>" [dob] [country] Score name against the bundled demo sanctions
                                  set (synthetic data — see module notice)
  help                            Show this message

Every result includes provenance (source + timestamp) and named data gaps.
Failed lookups are reported as failures — never filled with estimates.`;

function print(value: unknown, pretty: boolean): void {
  console.log(JSON.stringify(value, null, pretty ? 2 : undefined));
}

function entityNameResultLine(name: string, dob: string, jurisdiction: string) {
  const demoCandidates = SEED_INVESTIGATION_CASES[0].sanctionsQuery.candidates;
  return demoCandidates
    .map((candidate) => {
      const scored = scoreSanctionsCandidate(
        { targetName: name, targetDob: dob, targetJurisdiction: jurisdiction },
        candidate,
        { namePhoneticWeight: 40, dobExactWeight: 30, jurisdictionWeight: 20, aliasOverlapWeight: 10 }
      );
      return {
        listedName: candidate.listedName,
        listSource: candidate.listSource,
        compositeScore: scored.compositeScore,
        disposition: scored.disposition,
      };
    })
    .sort((a, b) => b.compositeScore - a.compositeScore);
}

async function main(): Promise<number> {
  const { command, args, flags } = parseCliArgs(process.argv.slice(2));
  const pretty = flags.pretty === true;

  try {
    switch (command) {
      case 'help':
        console.log(USAGE);
        return 0;

      case 'connectors': {
        const connectors = listConnectors().map((c) => ({
          id: c.id,
          label: c.label,
          category: c.category,
          accepts: c.accepts,
          policy: c.policy,
        }));
        print({ connectors, count: connectors.length }, pretty);
        return 0;
      }

      case 'recon': {
        const domain = args[0];
        if (!domain) throw new Error('recon requires a domain argument');
        const { scanDomainInfrastructureLive } = await import(
          './src/services/osintApis'
        );
        const record = await scanDomainInfrastructureLive(domain);
        const pivots = suggestPivots(['ip', 'domain']).map((c) => c.id);
        print(
          {
            command: 'recon',
            target: domain,
            summary: {
              aRecords: record.aRecords,
              asn: record.asn,
              asnOrg: record.asnOrg,
              registrar: record.registrar,
              createdAt: record.createdAt,
              tlsIssuer: record.tlsIssuer,
              dmarcPolicy: record.dmarcPolicy,
              ctSubdomainsCount: record.ctSubdomainsCount,
            },
            riskAssessment: record.riskAssessment,
            dataGaps: record.dataGaps,
            provenance: record.provenance,
            suggestedPivots: pivots,
            fullRecord: record,
          },
          pretty
        );
        return 0;
      }

      case 'geocode':
      case 'landmarks':
      case 'weather':
      case 'entity': {
        const target = args.join(' ').trim();
        if (!target) throw new Error(`${command} requires an argument`);
        const idByCommand: Record<string, string> = {
          geocode: 'nominatim-geocode',
          landmarks: 'overpass-landmarks',
          weather: 'open-meteo-verification',
          entity: 'gleif-entity-search',
        };
        const connector = getConnector(idByCommand[command]);
        if (!connector) throw new Error(`no connector wired for ${command}`);
        const res = await connector.run(target);
        print(
          {
            ...res,
            suggestedPivots: suggestPivots(res.emitted.map((e) => e.kind)).map(
              (c) => c.id
            ),
          },
          pretty
        );
        return res.dataGaps.length > 0 && res.data === null ? 1 : 0;
      }

      case 'screen': {
        const [name, dob = '', jurisdiction = ''] = args;
        if (!name) throw new Error('screen requires a name argument');
        console.error(
          '# NOTE: bundled sanctions set is a SYNTHETIC DEMO DATASET (see README). Live OpenSanctions is roadmap Phase 3.'
        );
        print(
          {
            command: 'screen',
            target: { name, dob, jurisdiction },
            results: entityNameResultLine(name, dob, jurisdiction),
          },
          pretty
        );
        return 0;
      }

      default:
        console.error(`Unknown command: ${command}`);
        console.log(USAGE);
        return 2;
    }
  } catch (err) {
    console.error(
      `error: ${err instanceof Error ? err.message : String(err)}`
    );
    return 1;
  }
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
  main().then((code) => {
    process.exitCode = code;
  });
}
