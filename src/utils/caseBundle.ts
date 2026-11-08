import type { InvestigationCase } from '../types/osint';
import { DEFAULT_WORKSPACE_CASE } from '../data/seedCases';
import {
  computeMerkleRoot,
  sha256HexSync,
  verifyEvidenceLedgerChain,
} from './osintForensics';

export interface Info9CaseBundle {
  format: 'info9-case-bundle';
  version: '1.0';
  exportedAtUtc: string;
  merkleRoot: string;
  caseChecksumSha256: string;
  caseData: InvestigationCase;
}

export interface ParsedCaseBundleResult {
  caseData: InvestigationCase;
  chainValid: boolean;
  merkleRoot: string;
  tamperedIndex: number | null;
  checksumVerified: boolean;
  warnings: string[];
}

/**
 * Creates a clean, empty InvestigationCase with a custom title and codename.
 */
export function createBlankInvestigationCase(
  title: string,
  codeName?: string,
  classification = 'OPEN SOURCE RESEARCH'
): InvestigationCase {
  const cleanTitle = title.trim() || 'Untitled Investigation';
  const generatedCode =
    (codeName?.trim() || cleanTitle)
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'CASE-NEW';
  const now = new Date().toISOString();
  return {
    ...DEFAULT_WORKSPACE_CASE,
    id: `case-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    codeName: generatedCode,
    title: cleanTitle,
    classification: classification.trim() || 'OPEN SOURCE RESEARCH',
    summary: `Investigation workspace initialized ${now.slice(0, 10)}.`,
    updatedAtUtc: now,
    entities: [],
    ownershipEdges: [],
    infraRecords: [],
    evidenceLedger: [],
    geoState: {
      ...DEFAULT_WORKSPACE_CASE.geoState,
      landmarks: [],
      weatherVerification: null,
    },
  };
}

/**
 * Serializes an InvestigationCase into a portable, cryptographically signed
 * `.info9.json` bundle.
 */
export function serializeCaseBundle(
  activeCase: InvestigationCase,
  exportedAtUtc = new Date().toISOString()
): string {
  const merkleRoot = computeMerkleRoot(activeCase.evidenceLedger);
  const canonicalCaseJson = JSON.stringify(activeCase);
  const caseChecksumSha256 = sha256HexSync(`${merkleRoot}:${canonicalCaseJson}`);

  const bundle: Info9CaseBundle = {
    format: 'info9-case-bundle',
    version: '1.0',
    exportedAtUtc,
    merkleRoot,
    caseChecksumSha256,
    caseData: activeCase,
  };
  return JSON.stringify(bundle, null, 2);
}

/**
 * Parses and cryptographically verifies an imported `.info9.json` case bundle
 * (or raw InvestigationCase JSON).
 */
export function parseAndVerifyCaseBundle(
  rawJson: string
): ParsedCaseBundleResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('Invalid JSON file — could not parse case bundle.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Case bundle must be a JSON object.');
  }

  const obj = parsed as Record<string, unknown>;
  const warnings: string[] = [];

  const candidateCase = (
    obj.format === 'info9-case-bundle' && obj.caseData
      ? obj.caseData
      : obj
  ) as Partial<InvestigationCase>;

  if (
    !candidateCase ||
    typeof candidateCase !== 'object' ||
    typeof candidateCase.id !== 'string' ||
    typeof candidateCase.codeName !== 'string' ||
    !candidateCase.geoState
  ) {
    throw new Error(
      'File is missing required info9 InvestigationCase fields (id, codeName, geoState).'
    );
  }

  const normalizedCase: InvestigationCase = {
    ...DEFAULT_WORKSPACE_CASE,
    ...candidateCase,
    id: candidateCase.id,
    codeName: candidateCase.codeName,
    title: candidateCase.title || candidateCase.codeName,
    classification: candidateCase.classification || 'OPEN SOURCE RESEARCH',
    summary: candidateCase.summary || '',
    updatedAtUtc: candidateCase.updatedAtUtc || new Date().toISOString(),
    entities: Array.isArray(candidateCase.entities) ? candidateCase.entities : [],
    ownershipEdges: Array.isArray(candidateCase.ownershipEdges)
      ? candidateCase.ownershipEdges
      : [],
    infraRecords: Array.isArray(candidateCase.infraRecords)
      ? candidateCase.infraRecords
      : [],
    forensicSamples: Array.isArray(candidateCase.forensicSamples)
      ? candidateCase.forensicSamples
      : DEFAULT_WORKSPACE_CASE.forensicSamples,
    evidenceLedger: Array.isArray(candidateCase.evidenceLedger)
      ? candidateCase.evidenceLedger
      : [],
    geoState: {
      ...DEFAULT_WORKSPACE_CASE.geoState,
      ...candidateCase.geoState,
      landmarks: Array.isArray(candidateCase.geoState.landmarks)
        ? candidateCase.geoState.landmarks
        : [],
    },
    sanctionsQuery: {
      ...DEFAULT_WORKSPACE_CASE.sanctionsQuery,
      ...(candidateCase.sanctionsQuery || {}),
    },
  };

  const chainCheck = verifyEvidenceLedgerChain(normalizedCase.evidenceLedger);
  if (!chainCheck.isValid) {
    warnings.push(chainCheck.reason);
  }

  let checksumVerified = true;
  if (obj.format === 'info9-case-bundle') {
    const expectedMerkle = String(obj.merkleRoot || '');
    if (expectedMerkle && expectedMerkle !== chainCheck.merkleRoot) {
      checksumVerified = false;
      warnings.push(
        `Bundle Merkle root mismatch: header=${expectedMerkle.slice(0, 12)}… vs computed=${chainCheck.merkleRoot.slice(0, 12)}…`
      );
    }
    const expectedChecksum = String(obj.caseChecksumSha256 || '');
    const actualChecksum = sha256HexSync(
      `${chainCheck.merkleRoot}:${JSON.stringify(obj.caseData)}`
    );
    if (expectedChecksum && expectedChecksum !== actualChecksum) {
      checksumVerified = false;
      warnings.push(
        'Case payload checksum differs from export signature (file was modified after export).'
      );
    }
  }

  return {
    caseData: normalizedCase,
    chainValid: chainCheck.isValid,
    merkleRoot: chainCheck.merkleRoot,
    tamperedIndex: chainCheck.tamperedIndex,
    checksumVerified,
    warnings,
  };
}
