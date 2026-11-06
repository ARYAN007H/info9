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
