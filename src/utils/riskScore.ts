import type { DomainRiskAssessment, RiskFactor } from '../types/osint';

/**
 * Transparent additive heuristic for domain-infrastructure risk.
 *
 * METHODOLOGY (stable contract — changing a rule is a breaking change and
 * must update these docs AND the tests):
 *
 *   Registration age (RDAP `registration` event):
 *     < 30 days   +35   Fresh registrations dominate phishing/malware infra.
 *     < 180 days  +18   Young domains warrant elevated scrutiny.
 *     unknown      +0   "Registration date unknown" factor recorded instead.
 *
 *   Email spoof-ability (DNS):
 *     no DMARC    +20   Receivers cannot enforce policy on spoofed mail.
 *     no SPF      +10   SMTP envelope sender not constrained.
 *
 *   Certificate controls:
 *     no CAA       +5   Any CA may issue for the domain.
 *
 *   Exposure (Shodan InternetDB):
 *     CVEs        +6 each, capped at +18. Unknown exposure records +0 with
 *                      an "exposure unknown" factor.
 *
 * The score is clamped to 0..100. This is a triage aid, not a verdict:
 * every contributing factor is returned so an analyst can audit the number.
 */

const FRESH_DOMAIN_DAYS = 30;
const YOUNG_DOMAIN_DAYS = 180;
const POINTS_FRESH_DOMAIN = 35;
const POINTS_YOUNG_DOMAIN = 18;
const POINTS_NO_DMARC = 20;
const POINTS_NO_SPF = 10;
const POINTS_NO_CAA = 5;
const POINTS_PER_CVE = 6;
const CVE_CAP_POINTS = 18;

export function computeDomainRiskScore(input: {
  /** ISO date (YYYY-MM-DD) of the RDAP registration event, or null if unknown. */
  createdAt: string | null;
  /** True when a DMARC TXT record exists (any policy). */
  hasDmarc: boolean;
  /** True when an SPF record (v=spf1) exists. */
  hasSpf: boolean;
  /** True when a CAA record exists. */
  hasCaa: boolean;
  /** Number of CVEs reported by Shodan InternetDB, or null when unknown. */
  shodanVulnCount: number | null;
  /** Injectable clock for deterministic tests. */
  now?: Date;
}): DomainRiskAssessment {
  const factors: RiskFactor[] = [];
  const now = input.now ?? new Date();

  if (input.createdAt === null) {
    factors.push({
      label: 'Registration date unknown — age rules skipped',
      points: 0,
    });
  } else {
    const created = new Date(`${input.createdAt}T00:00:00Z`);
    const ageDays = Number.isNaN(created.getTime())
      ? null
      : Math.floor((now.getTime() - created.getTime()) / 86_400_000);
    if (ageDays === null) {
      factors.push({
        label: 'Registration date unparseable — age rules skipped',
        points: 0,
      });
    } else if (ageDays < FRESH_DOMAIN_DAYS) {
      factors.push({
        label: `Registered ${ageDays}d ago (<30d fresh-registration window)`,
        points: POINTS_FRESH_DOMAIN,
      });
    } else if (ageDays < YOUNG_DOMAIN_DAYS) {
      factors.push({
        label: `Registered ${ageDays}d ago (<180d young domain)`,
        points: POINTS_YOUNG_DOMAIN,
      });
    }
  }

  if (!input.hasDmarc) {
    factors.push({
      label: 'No DMARC record — email spoofing possible',
      points: POINTS_NO_DMARC,
    });
  }
  if (!input.hasSpf) {
    factors.push({
      label: 'No SPF record — envelope sender unconstrained',
      points: POINTS_NO_SPF,
    });
  }
  if (!input.hasCaa) {
    factors.push({
      label: 'No CAA record — any CA may issue certificates',
      points: POINTS_NO_CAA,
    });
  }

  if (input.shodanVulnCount === null) {
    factors.push({
      label: 'Shodan exposure unknown — CVE rules skipped',
      points: 0,
    });
  } else if (input.shodanVulnCount > 0) {
    const vulnPoints = Math.min(
      CVE_CAP_POINTS,
      input.shodanVulnCount * POINTS_PER_CVE
    );
    factors.push({
      label: `${input.shodanVulnCount} CVE(s) on exposed services (capped at +${CVE_CAP_POINTS})`,
      points: vulnPoints,
    });
  }

  const score = Math.max(
    0,
    Math.min(100, factors.reduce((sum, f) => sum + f.points, 0))
  );

  return { score, factors };
}
