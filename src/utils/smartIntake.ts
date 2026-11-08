import type { ModuleId } from '../types/osint';
import { classifyGeolocationClue, parsePhoneNumberClue } from './clueParser';

export type SmartClueKind =
  | 'coordinates'
  | 'ipv4'
  | 'email'
  | 'phone'
  | 'domain'
  | 'url'
  | 'username'
  | 'entity_or_place';

export interface SmartRouteAction {
  id: string;
  label: string;
  moduleId: ModuleId;
  targetValue: string;
  /** Optional sub-mode or hint for the target module */
  subMode?: string;
}

export interface SmartIntakeClassification {
  rawInput: string;
  normalizedValue: string;
  kind: SmartClueKind;
  badgeLabel: string;
  summary: string;
  recommendedActions: SmartRouteAction[];
}

const EMAIL_RE = /^[^\s@]+@([a-z0-9-]+\.)+[a-z]{2,}$/i;
const URL_RE = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,18}$/i;
const HANDLE_RE = /^@[a-z0-9._-]{2,39}$/i;
const BARE_HANDLE_RE = /^[a-z0-9][a-z0-9._-]{2,30}$/i;

/**
 * Classifies any raw user input from the Smart Intake Omnibar or Command Palette
 * and returns ranked, one-click actions across the 9 workbench instruments.
 */
export function classifyUniversalIntake(
  rawInput: string
): SmartIntakeClassification | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  // 1. Check coordinates first via clueParser
  const geoClue = classifyGeolocationClue(trimmed);
  if (geoClue.clueType === 'coordinates' && geoClue.coordinates) {
    const coordStr = `${geoClue.coordinates.lat}, ${geoClue.coordinates.lon}`;
    return {
      rawInput: trimmed,
      normalizedValue: coordStr,
      kind: 'coordinates',
      badgeLabel: 'COORDINATES',
      summary: `Pin WGS84 ${coordStr}`,
      recommendedActions: [
        {
          id: 'geo-pin',
          label: 'Pin on Geolocation map',
          moduleId: 'geolocation',
          targetValue: coordStr,
        },
        {
          id: 'pivot-place',
          label: 'Scan nearby landmarks & weather',
          moduleId: 'investigate',
          targetValue: coordStr,
          subMode: 'place',
        },
      ],
    };
  }

  // 2. Check IPv4
  if (geoClue.clueType === 'ip_address' && geoClue.ipAddress) {
    const ip = geoClue.ipAddress;
    return {
      rawInput: trimmed,
      normalizedValue: ip,
      kind: 'ipv4',
      badgeLabel: 'IPv4 ADDRESS',
      summary: `Network host ${ip}`,
      recommendedActions: [
        {
          id: 'pivot-ip',
          label: 'Run IP full attribution chain',
          moduleId: 'investigate',
          targetValue: ip,
          subMode: 'ip',
        },
        {
          id: 'geo-ip',
          label: 'Geolocate IP on map',
          moduleId: 'geolocation',
          targetValue: ip,
        },
      ],
    };
  }

  // 3. Check Email Address
  if (EMAIL_RE.test(trimmed)) {
    const email = trimmed.toLowerCase();
    const [localPart, domainPart] = email.split('@');
    return {
      rawInput: trimmed,
      normalizedValue: email,
      kind: 'email',
      badgeLabel: 'EMAIL CLUE',
      summary: `Email ${email} (handle "${localPart}" · domain "${domainPart}")`,
      recommendedActions: [
        {
          id: 'id-email',
          label: 'Run Email & Gravatar recon',
          moduleId: 'identity',
          targetValue: email,
          subMode: 'email',
        },
        {
          id: 'id-handle',
          label: `Sweep handle "${localPart}" (~700 sites)`,
          moduleId: 'identity',
          targetValue: localPart,
          subMode: 'username',
        },
        {
          id: 'infra-domain',
          label: `Scan mail domain "${domainPart}"`,
          moduleId: 'infra',
          targetValue: domainPart,
        },
      ],
    };
  }

  // 4. Check Phone Number
  const phone = parsePhoneNumberClue(trimmed);
  if (phone) {
    return {
      rawInput: trimmed,
      normalizedValue: phone.normalizedDigits,
      kind: 'phone',
      badgeLabel: 'PHONE NUMBER',
      summary: `${phone.countryName} · ${phone.cityOrRegion} (${phone.timezoneUtc})`,
      recommendedActions: [
        {
          id: 'geo-phone',
          label: `Pin ${phone.cityOrRegion} on map`,
          moduleId: 'geolocation',
          targetValue: trimmed,
        },
        {
          id: 'id-phone',
          label: 'Open Phone & Timezone Overlap analyzer',
          moduleId: 'identity',
          targetValue: trimmed,
          subMode: 'phone',
        },
      ],
    };
  }

  // 5. Check Full URL
  if (URL_RE.test(trimmed)) {
    let hostname = trimmed;
    try {
      hostname = new URL(trimmed).hostname.toLowerCase();
    } catch {
      // keep raw
    }
    return {
      rawInput: trimmed,
      normalizedValue: trimmed,
      kind: 'url',
      badgeLabel: 'WEB URL',
      summary: `URL on host ${hostname}`,
      recommendedActions: [
        {
          id: 'for-wayback',
          label: 'Check Wayback archival history',
          moduleId: 'forensics',
          targetValue: trimmed,
          subMode: 'wayback',
        },
        {
          id: 'infra-host',
          label: `Scan host domain "${hostname}"`,
          moduleId: 'infra',
          targetValue: hostname,
        },
      ],
    };
  }

  // 6. Check Domain Name
  if (DOMAIN_RE.test(trimmed) && !trimmed.includes(' ')) {
    const domain = trimmed.toLowerCase();
    return {
      rawInput: trimmed,
      normalizedValue: domain,
      kind: 'domain',
      badgeLabel: 'DOMAIN NAME',
      summary: `Domain ${domain}`,
      recommendedActions: [
        {
          id: 'infra-scan',
          label: 'Scan DNS, ports, certs & lookalikes',
          moduleId: 'infra',
          targetValue: domain,
        },
        {
          id: 'pivot-domain',
          label: 'Run 5-step Domain Full Recon chain',
          moduleId: 'investigate',
          targetValue: domain,
          subMode: 'domain',
        },
      ],
    };
  }

  // 7. Check explicit @username or single-token handle with underscore/digits
  if (
    HANDLE_RE.test(trimmed) ||
    (BARE_HANDLE_RE.test(trimmed) && /[0-9_-]/.test(trimmed))
  ) {
    const handle = trimmed.replace(/^@/, '');
    return {
      rawInput: trimmed,
      normalizedValue: handle,
      kind: 'username',
      badgeLabel: 'USERNAME / HANDLE',
      summary: `Handle @${handle}`,
      recommendedActions: [
        {
          id: 'id-sweep',
          label: `Sweep @${handle} across ~700 sites`,
          moduleId: 'identity',
          targetValue: handle,
          subMode: 'username',
        },
        {
          id: 'face-avatar',
          label: `Compare @${handle} avatars in Face Recon`,
          moduleId: 'face',
          targetValue: handle,
        },
        {
          id: 'pivot-handle',
          label: 'Run cross-registry entity sweep',
          moduleId: 'investigate',
          targetValue: handle,
          subMode: 'entity-name',
        },
      ],
    };
  }

  // 8. Default: Person, Company, or Place Name
  return {
    rawInput: trimmed,
    normalizedValue: trimmed,
    kind: 'entity_or_place',
    badgeLabel: 'ENTITY / PLACE',
    summary: `Name or place "${trimmed}"`,
    recommendedActions: [
      {
        id: 'dossier-search',
        label: 'Search corporate & public records (Dossier)',
        moduleId: 'dossier',
        targetValue: trimmed,
      },
      {
        id: 'watchlist-screen',
        label: 'Screen against OFAC & sanctions watchlists',
        moduleId: 'sanctions',
        targetValue: trimmed,
      },
      {
        id: 'geo-place',
        label: 'Geocode as place or address on map',
        moduleId: 'geolocation',
        targetValue: trimmed,
      },
      {
        id: 'pivot-entity',
        label: 'Run automated cross-registry pivot chain',
        moduleId: 'investigate',
        targetValue: trimmed,
        subMode: 'entity-name',
      },
    ],
  };
}
