import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractDobFromRemarks,
  parseOfacSdnCsv,
  splitCsvLine,
  toSanctionsCandidates,
} from './sanctionsData';

const SAMPLE_CSV = [
  'ent_num,SDN_Name,SDN_Type,Program,Title,Call_Sign,Vess_type,Tonnage,GRIT,Voyage_Flag,Remarks',
  '4731,"MOROZOV, Viktor Alekseevich",Individual,E.O. 14024,,,,,,,,"DOB 14 Apr 1968; POB Moscow, Russia; citizenship Russia; Passport Y1234567 (Russia)"',
  '9999,VEGA MARITIME HOLDINGS LTD,Vessel,UK-OFSI,,,,,,,,"Registered in Marshall Islands"',
  '8888,EXAMPLE COMPANY LTD,Entity,NPWMD,,,,,,,,"Incorporated 12 Mar 2021 in Cyprus"',
  '7777,"QUOTED, INC.",Entity,SDGT,"Title, with comma",,,,,,"Short remark with 05 Jan 1968 date"',
].join('\n');

test('splitCsvLine handles quoted commas and escaped quotes', () => {
  assert.deepEqual(splitCsvLine('a,b,c'), ['a', 'b', 'c']);
  assert.deepEqual(
    splitCsvLine('"MOROZOV, Viktor",Individual,Program'),
    ['MOROZOV, Viktor', 'Individual', 'Program']
  );
  assert.deepEqual(splitCsvLine('"say ""hi""",x'), ['say "hi"', 'x']);
});

test('parseOfacSdnCsv extracts names, programs, and remarks DOBs', () => {
  const records = parseOfacSdnCsv(SAMPLE_CSV);
  assert.equal(records.length, 4);
  assert.equal(records[0].listedName, 'MOROZOV, Viktor Alekseevich');
  assert.equal(records[0].sdnType, 'Individual');
  assert.equal(records[0].program, 'E.O. 14024');
  assert.equal(records[0].dobOrIncorporation, '14 Apr 1968');
  assert.equal(records[2].dobOrIncorporation, '12 Mar 2021');
  assert.equal(records[1].dobOrIncorporation, '');
});

test('extractDobFromRemarks trusts explicit DOB prefix over stray dates', () => {
  assert.equal(extractDobFromRemarks('DOB 05 Jan 1968; POB X; alt date 12 Dec 1999'), '05 Jan 1968');
  assert.equal(extractDobFromRemarks('Short remark 05 Jan 1968'), '05 Jan 1968');
  assert.equal(extractDobFromRemarks('very long remark mentioning 05 Jan 1968 somewhere deep'.repeat(4)), '');
  assert.equal(extractDobFromRemarks(''), '');
});

test('toSanctionsCandidates maps types and keeps provenance identifiers', () => {
  const records = parseOfacSdnCsv(SAMPLE_CSV);
  const candidates = toSanctionsCandidates(records);
  assert.equal(candidates.length, 4);
  assert.equal(candidates[0].entityType, 'INDIVIDUAL');
  assert.equal(candidates[1].entityType, 'VESSEL');
  assert.equal(candidates[2].entityType, 'ENTITY');
  assert.equal(candidates[0].listSource, 'OFAC_SDN');
  assert.match(candidates[0].identifierCode, /^OFAC-SDN-4731$/);
});
