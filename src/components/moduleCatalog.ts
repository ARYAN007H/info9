import type { ModuleId } from '../types/osint';

/**
 * The bench catalogue: five fixed instruments, numbered the same way as the
 * README. Single source of truth for the spine, the ledger rows and the
 * module header plates.
 */
export interface ModuleCatalogEntry {
  id: ModuleId;
  num: string;
  name: string;
  shortName: string;
  job: string;
}

export const MODULE_CATALOG: Record<ModuleId, ModuleCatalogEntry> = {
  geolocation: {
    id: 'geolocation',
    num: '01',
    name: 'Geolocate',
    shortName: 'GEO',
    job: 'Pin coordinates from spatial clues; solve time of day from shadow geometry.',
  },
  dossier: {
    id: 'dossier',
    num: '02',
    name: 'Dossier',
    shortName: 'DOS',
    job: 'Resolve legal entities, crawl ownership chains, compute effective equity.',
  },
  infra: {
    id: 'infra',
    num: '03',
    name: 'Infrastructure',
    shortName: 'INF',
    job: 'Passive recon on a domain — DNS, certificates, hosting, BGP, lookalikes.',
  },
  forensics: {
    id: 'forensics',
    num: '04',
    name: 'Forensics',
    shortName: 'FOR',
    job: 'In-browser DSP lab: ELA, clone detection, noise maps, EXIF integrity.',
  },
  identity: {
    id: 'identity',
    num: '05',
    name: 'Identity',
    shortName: 'IDN',
    job: 'Sweep a handle across ~700 community-indexed sites with per-probe detection.',
  },
  investigate: {
    id: 'investigate',
    num: '06',
    name: 'Pivot Console',
    shortName: 'PIV',
    job: 'One input, an orchestrated multi-source recon chain; save findings to the case.',
  },
  sanctions: {
    id: 'sanctions',
    num: '07',
    name: 'Watchlist',
    shortName: 'WAT',
    job: 'Cross-script sanctions and PEP matching with fully disclosed scoring.',
  },
};

export const MODULE_ORDER: ModuleId[] = [
  'geolocation',
  'dossier',
  'infra',
  'forensics',
  'identity',
  'investigate',
  'sanctions',
];
