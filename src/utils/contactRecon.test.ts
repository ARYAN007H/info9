import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeEmailClue,
  analyzePhoneTimezoneOverlap,
  md5HexSync,
} from './contactRecon';

describe('contactRecon utilities', () => {
  it('computes RFC 1321 MD5 test vectors accurately for Gravatar', () => {
    assert.equal(md5HexSync(''), 'd41d8cd98f00b204e9800998ecf8427e');
    assert.equal(md5HexSync('abc'), '900150983cd24fb0d6963f7d28e17f72');
    assert.equal(
      md5HexSync('myemailaddress@example.com'),
      '0bc83cb571cd1c50ba6f3e8a78ef1346'
    );
  });

  it('analyzes email clues with subaddress tags, provider class, and pivot handles', () => {
    const profile = analyzeEmailClue('John.Doe+osint@gmail.com');
    assert.ok(profile);
    assert.equal(profile.domain, 'gmail.com');
    assert.equal(profile.subaddressTag, 'osint');
    assert.equal(profile.canonicalLocalPart, 'johndoe');
    assert.equal(profile.providerClass, 'free_webmail');
    assert.ok(profile.pivotHandles.includes('john.doe'));
    assert.ok(profile.pivotHandles.includes('johndoe'));
    assert.ok(profile.pivotHandles.includes('john_doe'));
  });

  it('computes timezone waking and business hour overlap between two phone numbers', () => {
    // London (UTC+0) and New York (UTC-5)
    const overlap = analyzePhoneTimezoneOverlap(
      '+44 20 7946 0921',
      '+1 (212) 555-0143'
    );
    assert.ok(overlap);
    assert.equal(overlap.primaryUtcOffset, 0);
    assert.equal(overlap.secondaryUtcOffset, -5);
    // Business hours in London: 09..17 UTC; in NYC (UTC-5): 14..22 UTC -> overlap is 14,15,16,17 UTC (4 hours)
    assert.deepEqual(overlap.overlappingBusinessUtcHours, [14, 15, 16, 17]);
    assert.ok(overlap.verificationLinks.length >= 2);
  });
});
