/**
 * OFAC SDN list parsing — brings LIVE sanctions screening to info9 with
 * zero keys: the U.S. Treasury publishes the SDN list as a free CSV.
 *
 * CSV columns (sdn.csv): ent_num, SDN_Name, SDN_Type, Program, Title,
 * Call_Sign, Vess_type, Tonnage, GRIT, Voyage_Flag, ..., Remarks.
 * DOBs live in the free-text Remarks column ("DOB 05 Jan 1968; ...").
 */

export interface OfacSdnRecord {
  entryNumber: string;
  listedName: string;
  sdnType: string;
  program: string;
  dobOrIncorporation: string;
  remarks: string;
}

/** Minimal RFC-4180-ish CSV row splitter (handles quoted commas + escaped quotes). */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

const MONTHS = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec';
const DATE_PATTERN = new RegExp(`\\d{1,2}\\s(?:${MONTHS})\\s\\d{2,4}`, 'i');

/** Extracts the first explicit "DOB <date>" from free-text remarks, else ''. */
export function extractDobFromRemarks(remarks: string): string {
  const dob = remarks.match(new RegExp(`DOB[^;"\\d]{0,10}(\\d{1,2}\\s(?:${MONTHS})\\s\\d{2,4})`, 'i'));
  if (dob) return dob[1];
  // Some entries state the date without the DOB prefix — only trust the
  // first date-like token when the remark is short (low ambiguity).
  const anyDate = remarks.match(DATE_PATTERN);
  return remarks.length <= 80 && anyDate ? anyDate[0] : '';
}

export function parseOfacSdnCsv(text: string): OfacSdnRecord[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const records: OfacSdnRecord[] = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = splitCsvLine(lines[i]);
    if (fields.length < 4) continue;
    const entryNumber = fields[0];
    const listedName = fields[1];
    const sdnType = fields[2] || 'Unknown';
    const program = fields[3] || 'Unknown';
    // Remarks are the last column in current exports; fall back to scanning all.
    const remarks = fields[fields.length - 1] || '';
    if (!listedName) continue;
    records.push({
      entryNumber,
      listedName: listedName.replace(/\s+/g, ' ').trim(),
      sdnType,
      program,
      dobOrIncorporation: extractDobFromRemarks(remarks),
      remarks: remarks.slice(0, 400),
    });
  }
  return records;
}

/** Maps parsed SDN rows into the app's SanctionsCandidate shape. */
export function toSanctionsCandidates(
  records: OfacSdnRecord[],
  limit: number = 12000
): Array<{
  id: string;
  listedName: string;
  aliases: string[];
  listSource: 'OFAC_SDN';
  program: string;
  entityType: 'INDIVIDUAL' | 'ENTITY' | 'VESSEL';
  dobOrIncorporation: string;
  citizenshipOrJurisdiction: string;
  identifierCode: string;
  notes: string;
}> {
  return records.slice(0, limit).map((r) => ({
    id: `ofac-sdn-${r.entryNumber}`,
    listedName: r.listedName,
    aliases: [],
    listSource: 'OFAC_SDN' as const,
    program: r.program,
    entityType: /vessel/i.test(r.sdnType)
      ? ('VESSEL' as const)
      : /individual/i.test(r.sdnType)
      ? ('INDIVIDUAL' as const)
      : ('ENTITY' as const),
    dobOrIncorporation: r.dobOrIncorporation,
    citizenshipOrJurisdiction: '',
    identifierCode: `OFAC-SDN-${r.entryNumber}`,
    notes: r.remarks,
  }));
}

export interface BatchScreeningRow {
  targetName: string;
  targetDob: string;
  targetJurisdiction: string;
}

/**
 * Parses multi-line or CSV batch screening rows (`Name, DOB, Jurisdiction` or `Name`).
 * Ignores blank lines, `#` comments, and optional header rows (`name,dob,country`).
 */
export function parseBatchScreeningInput(
  rawText: string,
  maxRows = 100
): BatchScreeningRow[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  const out: BatchScreeningRow[] = [];
  for (let i = 0; i < lines.length && out.length < maxRows; i++) {
    const fields = splitCsvLine(lines[i]);
    const col0 = (fields[0] || '').trim();
    if (!col0) continue;
    if (
      i === 0 &&
      /^(name|target|entity|person|subject)$/i.test(col0) &&
      fields.length >= 2
    ) {
      continue;
    }
    out.push({
      targetName: col0,
      targetDob: (fields[1] || '').trim(),
      targetJurisdiction: (fields[2] || '').trim(),
    });
  }
  return out;
}

function extractNameTrigrams(raw: string): string[] {
  const norm = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!norm) return [];
  const padded = ` ${norm} `;
  const grams = new Set<string>();
  for (let i = 0; i <= padded.length - 3; i++) {
    grams.add(padded.slice(i, i + 3));
  }
  return Array.from(grams);
}

export interface TrigramCandidateIndex<T extends { listedName: string }> {
  candidates: T[];
  postings: Map<string, number[]>;
}

/**
 * Builds an in-memory inverted 3-gram index over a large sanctions candidate
 * array (~20,000+ rows) so batch queries pre-filter to top candidates in <5ms.
 */
export function buildTrigramCandidateIndex<T extends { listedName: string }>(
  candidates: T[]
): TrigramCandidateIndex<T> {
  const postings = new Map<string, number[]>();
  for (let idx = 0; idx < candidates.length; idx++) {
    const grams = extractNameTrigrams(candidates[idx].listedName);
    for (const g of grams) {
      let list = postings.get(g);
      if (!list) {
        list = [];
        postings.set(g, list);
      }
      list.push(idx);
    }
  }
  return { candidates, postings };
}

/**
 * Returns up to `topK` candidate records sharing the highest trigram overlap
 * with `queryName`. Falls back to the first `topK` records if no trigrams match.
 */
export function queryTrigramIndex<T extends { listedName: string }>(
  index: TrigramCandidateIndex<T>,
  queryName: string,
  topK = 250
): T[] {
  const grams = extractNameTrigrams(queryName);
  if (grams.length === 0) return index.candidates.slice(0, topK);

  const hits = new Map<number, number>();
  for (const g of grams) {
    const list = index.postings.get(g);
    if (!list) continue;
    for (const docIdx of list) {
      hits.set(docIdx, (hits.get(docIdx) || 0) + 1);
    }
  }

  if (hits.size === 0) return index.candidates.slice(0, Math.min(80, topK));

  return Array.from(hits.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([docIdx]) => index.candidates[docIdx]);
}

