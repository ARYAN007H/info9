import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyGeolocationClue, parsePhoneNumberClue } from './clueParser';

test('parsePhoneNumberClue resolves UK London +44 20 and US San Francisco +1 415 numbers accurately', () => {
  const uk = parsePhoneNumberClue('+44 20 7946 0921');
  assert.ok(uk);
  assert.equal(uk.countryName, 'United Kingdom');
  assert.ok(uk.cityOrRegion.includes('London'));
  assert.ok(Math.abs(uk.lat - 51.5074) < 0.1);

  const sf = parsePhoneNumberClue('+1 (415) 555-0192');
  assert.ok(sf);
  assert.ok(sf.cityOrRegion.includes('San Francisco'));
  assert.equal(sf.areaCodeMatched, '415');
});

test('classifyGeolocationClue distinguishes coordinates, IPv4, phone numbers, and place names', () => {
  const coord = classifyGeolocationClue('35.6586, 139.7454');
  assert.equal(coord.clueType, 'coordinates');
  assert.equal(coord.coordinates?.lat, 35.6586);

  const ip = classifyGeolocationClue('8.8.8.8');
  assert.equal(ip.clueType, 'ip_address');
  assert.equal(ip.ipAddress, '8.8.8.8');

  const phone = classifyGeolocationClue('+49 30 901820');
  assert.equal(phone.clueType, 'phone');
  assert.ok(phone.phoneInfo?.cityOrRegion.includes('Berlin'));

  const place = classifyGeolocationClue('Eiffel Tower, Paris');
  assert.equal(place.clueType, 'place_or_text');
  assert.equal(place.searchQuery, 'Eiffel Tower, Paris');
});
