export interface ParsedPhoneClue {
  rawInput: string;
  normalizedDigits: string;
  countryCode: string;
  countryName: string;
  cityOrRegion: string;
  timezoneUtc: string;
  lat: number;
  lon: number;
  areaCodeMatched?: string;
}

export interface DetectedClueResult {
  clueType: 'coordinates' | 'phone' | 'ip_address' | 'place_or_text';
  summaryLabel: string;
  coordinates?: { lat: number; lon: number };
  phoneInfo?: ParsedPhoneClue;
  ipAddress?: string;
  searchQuery?: string;
}

interface CountryDialEntry {
  code: string;
  country: string;
  capitalOrCenter: string;
  tz: string;
  lat: number;
  lon: number;
  areaCodes?: Record<
    string,
    { city: string; lat: number; lon: number; tz?: string }
  >;
}

const DIALING_DIRECTORY: CountryDialEntry[] = [
  {
    code: '1',
    country: 'United States / Canada (NANP)',
    capitalOrCenter: 'Washington, D.C.',
    tz: 'UTC-5 to UTC-8',
    lat: 38.9072,
    lon: -77.0369,
    areaCodes: {
      '212': { city: 'New York City, NY, USA', lat: 40.7128, lon: -74.006, tz: 'UTC-5' },
      '646': { city: 'Manhattan, New York, USA', lat: 40.758, lon: -73.9855, tz: 'UTC-5' },
      '917': { city: 'New York Metro, NY, USA', lat: 40.7128, lon: -74.006, tz: 'UTC-5' },
      '310': { city: 'Los Angeles (Westside), CA, USA', lat: 34.0522, lon: -118.2437, tz: 'UTC-8' },
      '213': { city: 'Downtown Los Angeles, CA, USA', lat: 34.0407, lon: -118.2468, tz: 'UTC-8' },
      '415': { city: 'San Francisco, CA, USA', lat: 37.7749, lon: -122.4194, tz: 'UTC-8' },
      '650': { city: 'Silicon Valley / San Mateo, CA, USA', lat: 37.4419, lon: -122.143, tz: 'UTC-8' },
      '408': { city: 'San Jose, CA, USA', lat: 37.3382, lon: -121.8863, tz: 'UTC-8' },
      '202': { city: 'Washington, D.C., USA', lat: 38.9072, lon: -77.0369, tz: 'UTC-5' },
      '312': { city: 'Chicago, IL, USA', lat: 41.8781, lon: -87.6298, tz: 'UTC-6' },
      '305': { city: 'Miami, FL, USA', lat: 25.7617, lon: -80.1918, tz: 'UTC-5' },
      '617': { city: 'Boston, MA, USA', lat: 42.3601, lon: -71.0589, tz: 'UTC-5' },
      '206': { city: 'Seattle, WA, USA', lat: 47.6062, lon: -122.3321, tz: 'UTC-8' },
      '713': { city: 'Houston, TX, USA', lat: 29.7604, lon: -95.3698, tz: 'UTC-6' },
      '214': { city: 'Dallas, TX, USA', lat: 32.7767, lon: -96.797, tz: 'UTC-6' },
      '404': { city: 'Atlanta, GA, USA', lat: 33.749, lon: -84.388, tz: 'UTC-5' },
      '416': { city: 'Toronto, ON, Canada', lat: 43.6532, lon: -79.3832, tz: 'UTC-5' },
      '604': { city: 'Vancouver, BC, Canada', lat: 49.2827, lon: -123.1207, tz: 'UTC-8' },
      '514': { city: 'Montreal, QC, Canada', lat: 45.5017, lon: -73.5673, tz: 'UTC-5' },
    },
  },
  {
    code: '44',
    country: 'United Kingdom',
    capitalOrCenter: 'London',
    tz: 'UTC+0 / BST',
    lat: 51.5074,
    lon: -0.1278,
    areaCodes: {
      '20': { city: 'Greater London, UK', lat: 51.5074, lon: -0.1278 },
      '161': { city: 'Manchester, UK', lat: 53.4808, lon: -2.2426 },
      '121': { city: 'Birmingham, UK', lat: 52.4862, lon: -1.8904 },
      '131': { city: 'Edinburgh, Scotland, UK', lat: 55.9533, lon: -3.1883 },
      '141': { city: 'Glasgow, Scotland, UK', lat: 55.8642, lon: -4.2518 },
      '151': { city: 'Liverpool, UK', lat: 53.4084, lon: -2.9916 },
      '29': { city: 'Cardiff, Wales, UK', lat: 51.4816, lon: -3.1791 },
      '28': { city: 'Belfast, Northern Ireland, UK', lat: 54.5973, lon: -5.9301 },
    },
  },
  {
    code: '49',
    country: 'Germany',
    capitalOrCenter: 'Berlin',
    tz: 'UTC+1 / CEST',
    lat: 52.52,
    lon: 13.405,
    areaCodes: {
      '30': { city: 'Berlin, Germany', lat: 52.52, lon: 13.405 },
      '89': { city: 'Munich (München), Germany', lat: 48.1351, lon: 11.582 },
      '69': { city: 'Frankfurt am Main, Germany', lat: 50.1109, lon: 8.6821 },
      '40': { city: 'Hamburg, Germany', lat: 53.5511, lon: 9.9937 },
      '221': { city: 'Cologne (Köln), Germany', lat: 50.9375, lon: 6.9603 },
      '711': { city: 'Stuttgart, Germany', lat: 48.7758, lon: 9.1829 },
    },
  },
  {
    code: '33',
    country: 'France',
    capitalOrCenter: 'Paris',
    tz: 'UTC+1 / CEST',
    lat: 48.8566,
    lon: 2.3522,
    areaCodes: {
      '1': { city: 'Paris & Île-de-France, France', lat: 48.8566, lon: 2.3522 },
      '4': { city: 'Southeast France (Lyon / Marseille / Nice)', lat: 45.764, lon: 4.8357 },
      '5': { city: 'Southwest France (Bordeaux / Toulouse)', lat: 44.8378, lon: -0.5792 },
    },
  },
  {
    code: '81',
    country: 'Japan',
    capitalOrCenter: 'Tokyo',
    tz: 'UTC+9 (JST)',
    lat: 35.6762,
    lon: 139.6503,
    areaCodes: {
      '3': { city: 'Tokyo Special Wards, Japan', lat: 35.6762, lon: 139.6503 },
      '6': { city: 'Osaka, Japan', lat: 34.6937, lon: 135.5023 },
      '45': { city: 'Yokohama, Japan', lat: 35.4437, lon: 139.638 },
      '52': { city: 'Nagoya, Japan', lat: 35.1815, lon: 136.9066 },
      '75': { city: 'Kyoto, Japan', lat: 35.0116, lon: 135.7681 },
    },
  },
  {
    code: '91',
    country: 'India',
    capitalOrCenter: 'New Delhi',
    tz: 'UTC+5:30 (IST)',
    lat: 28.6139,
    lon: 77.209,
    areaCodes: {
      '11': { city: 'New Delhi, NCR, India', lat: 28.6139, lon: 77.209 },
      '22': { city: 'Mumbai, Maharashtra, India', lat: 19.076, lon: 72.8777 },
      '80': { city: 'Bengaluru, Karnataka, India', lat: 12.9716, lon: 77.5946 },
      '44': { city: 'Chennai, Tamil Nadu, India', lat: 13.0827, lon: 80.2707 },
      '40': { city: 'Hyderabad, Telangana, India', lat: 17.385, lon: 78.4867 },
      '33': { city: 'Kolkata, West Bengal, India', lat: 22.5726, lon: 88.3639 },
    },
  },
  {
    code: '61',
    country: 'Australia',
    capitalOrCenter: 'Sydney / Canberra',
    tz: 'UTC+10 (AEST)',
    lat: -33.8688,
    lon: 151.2093,
    areaCodes: {
      '2': { city: 'Sydney & New South Wales, Australia', lat: -33.8688, lon: 151.2093 },
      '3': { city: 'Melbourne & Victoria, Australia', lat: -37.8136, lon: 144.9631 },
      '7': { city: 'Brisbane & Queensland, Australia', lat: -27.4705, lon: 153.026 },
      '8': { city: 'Perth & Adelaide, Australia', lat: -31.9505, lon: 115.8605 },
    },
  },
  {
    code: '971',
    country: 'United Arab Emirates',
    capitalOrCenter: 'Dubai / Abu Dhabi',
    tz: 'UTC+4 (GST)',
    lat: 25.2048,
    lon: 55.2708,
    areaCodes: {
      '4': { city: 'Dubai, UAE', lat: 25.2048, lon: 55.2708 },
      '2': { city: 'Abu Dhabi, UAE', lat: 24.4539, lon: 54.3773 },
      '6': { city: 'Sharjah, UAE', lat: 25.3463, lon: 55.4209 },
    },
  },
  { code: '65', country: 'Singapore', capitalOrCenter: 'Singapore', tz: 'UTC+8 (SGT)', lat: 1.3521, lon: 103.8198 },
  { code: '41', country: 'Switzerland', capitalOrCenter: 'Zurich / Bern', tz: 'UTC+1', lat: 47.3769, lon: 8.5417 },
  { code: '31', country: 'Netherlands', capitalOrCenter: 'Amsterdam', tz: 'UTC+1', lat: 52.3676, lon: 4.9041 },
  { code: '34', country: 'Spain', capitalOrCenter: 'Madrid', tz: 'UTC+1', lat: 40.4168, lon: -3.7038 },
  { code: '39', country: 'Italy', capitalOrCenter: 'Rome', tz: 'UTC+1', lat: 41.9028, lon: 12.4964 },
  { code: '46', country: 'Sweden', capitalOrCenter: 'Stockholm', tz: 'UTC+1', lat: 59.3293, lon: 18.0686 },
  { code: '47', country: 'Norway', capitalOrCenter: 'Oslo', tz: 'UTC+1', lat: 59.9139, lon: 10.7522 },
  { code: '48', country: 'Poland', capitalOrCenter: 'Warsaw', tz: 'UTC+1', lat: 52.2297, lon: 21.0122 },
  { code: '380', country: 'Ukraine', capitalOrCenter: 'Kyiv', tz: 'UTC+2', lat: 50.4501, lon: 30.5234 },
  {
    code: '7',
    country: 'Russia / Kazakhstan',
    capitalOrCenter: 'Moscow',
    tz: 'UTC+3',
    lat: 55.7558,
    lon: 37.6173,
    areaCodes: {
      '495': { city: 'Moscow, Russia', lat: 55.7558, lon: 37.6173 },
      '499': { city: 'Moscow, Russia', lat: 55.7558, lon: 37.6173 },
      '812': { city: 'St. Petersburg, Russia', lat: 59.9343, lon: 30.3351 },
      '4012': { city: 'Kaliningrad, Russia', lat: 54.7104, lon: 20.4522 },
    },
  },
  { code: '86', country: 'China', capitalOrCenter: 'Beijing / Shanghai', tz: 'UTC+8', lat: 39.9042, lon: 116.4074 },
  { code: '82', country: 'South Korea', capitalOrCenter: 'Seoul', tz: 'UTC+9', lat: 37.5665, lon: 126.978 },
  { code: '55', country: 'Brazil', capitalOrCenter: 'São Paulo / Brasília', tz: 'UTC-3', lat: -23.5505, lon: -46.6333 },
  { code: '52', country: 'Mexico', capitalOrCenter: 'Mexico City', tz: 'UTC-6', lat: 19.4326, lon: -99.1332 },
  { code: '27', country: 'South Africa', capitalOrCenter: 'Johannesburg / Cape Town', tz: 'UTC+2', lat: -26.2041, lon: 28.0473 },
  { code: '90', country: 'Turkey', capitalOrCenter: 'Istanbul / Ankara', tz: 'UTC+3', lat: 41.0082, lon: 28.9784 },
  { code: '966', country: 'Saudi Arabia', capitalOrCenter: 'Riyadh', tz: 'UTC+3', lat: 24.7136, lon: 46.6753 },
  { code: '972', country: 'Israel', capitalOrCenter: 'Tel Aviv / Jerusalem', tz: 'UTC+2', lat: 32.0853, lon: 34.7818 },
  { code: '20', country: 'Egypt', capitalOrCenter: 'Cairo', tz: 'UTC+2', lat: 30.0444, lon: 31.2357 },
  { code: '62', country: 'Indonesia', capitalOrCenter: 'Jakarta', tz: 'UTC+7', lat: -6.2088, lon: 106.8456 },
  { code: '60', country: 'Malaysia', capitalOrCenter: 'Kuala Lumpur', tz: 'UTC+8', lat: 3.139, lon: 101.6869 },
  { code: '63', country: 'Philippines', capitalOrCenter: 'Manila', tz: 'UTC+8', lat: 14.5995, lon: 120.9842 },
  { code: '66', country: 'Thailand', capitalOrCenter: 'Bangkok', tz: 'UTC+7', lat: 13.7563, lon: 100.5018 },
  { code: '84', country: 'Vietnam', capitalOrCenter: 'Hanoi / Ho Chi Minh City', tz: 'UTC+7', lat: 21.0285, lon: 105.8542 },
  { code: '357', country: 'Cyprus', capitalOrCenter: 'Limassol / Nicosia', tz: 'UTC+2', lat: 34.6786, lon: 33.0413 },
  { code: '356', country: 'Malta', capitalOrCenter: 'Valletta', tz: 'UTC+1', lat: 35.8989, lon: 14.5146 },
  { code: '372', country: 'Estonia', capitalOrCenter: 'Tallinn', tz: 'UTC+2', lat: 59.437, lon: 24.7536 },
];

/**
 * Parses a phone number string (e.g. "+44 20 7946 0921" or "+1 (415) 555-0199")
 * into geographic coordinates, country, and city/region.
 */
export function parsePhoneNumberClue(rawInput: string): ParsedPhoneClue | null {
  const trimmed = rawInput.trim();
  // Must start with '+' or '00' or look like a formatted phone number with at least 7 digits
  const looksLikePhone =
    /^(\+|00)\d[\d\s().-]{6,18}$/.test(trimmed) ||
    /^\(\d{3}\)\s*\d{3}[-\s]\d{4}$/.test(trimmed);

  if (!looksLikePhone) return null;

  let digits = trimmed.replace(/[^\d]/g, '');
  if (trimmed.startsWith('00')) {
    digits = digits.slice(2);
  } else if (trimmed.startsWith('(') && digits.length === 10) {
    digits = '1' + digits;
  }

  if (digits.length < 7 || digits.length > 15) return null;

  // Sort dialing directory by longest prefix first (e.g., 380 before 3)
  const sortedEntries = [...DIALING_DIRECTORY].sort(
    (a, b) => b.code.length - a.code.length
  );

  for (const entry of sortedEntries) {
    if (digits.startsWith(entry.code)) {
      const nationalPart = digits.slice(entry.code.length);
      let cityOrRegion = entry.capitalOrCenter;
      let lat = entry.lat;
      let lon = entry.lon;
      let tz = entry.tz;
      let areaCodeMatched: string | undefined;

      if (entry.areaCodes) {
        const areaKeys = Object.keys(entry.areaCodes).sort(
          (a, b) => b.length - a.length
        );
        for (const ac of areaKeys) {
          if (nationalPart.startsWith(ac)) {
            const match = entry.areaCodes[ac];
            cityOrRegion = match.city;
            lat = match.lat;
            lon = match.lon;
            if (match.tz) tz = match.tz;
            areaCodeMatched = ac;
            break;
          }
        }
      }

      return {
        rawInput: trimmed,
        normalizedDigits: `+${digits}`,
        countryCode: `+${entry.code}`,
        countryName: entry.country,
        cityOrRegion,
        timezoneUtc: tz,
        lat,
        lon,
        areaCodeMatched,
      };
    }
  }

  return null;
}

/**
 * Universal Clue Classifier: detects whether the user entered GPS coordinates,
 * an international phone number, an IPv4 address, or a place/landmark query.
 */
export function classifyGeolocationClue(rawInput: string): DetectedClueResult {
  const q = rawInput.trim();

  // 1. Check decimal coordinates (e.g., "48.8584, 2.2945" or "48.8584° N, 2.2945° E")
  const decMatch = q.match(
    /^(-?\d{1,2}(?:\.\d+)?)\s*°?\s*([NSns])?\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([EWew])?$/
  );
  if (decMatch) {
    let lat = parseFloat(decMatch[1]);
    if (decMatch[2]?.toUpperCase() === 'S') lat = -Math.abs(lat);
    let lon = parseFloat(decMatch[3]);
    if (decMatch[4]?.toUpperCase() === 'W') lon = -Math.abs(lon);
    if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      return {
        clueType: 'coordinates',
        summaryLabel: `Coordinates (${lat.toFixed(5)}, ${lon.toFixed(5)})`,
        coordinates: {
          lat: Number(lat.toFixed(6)),
          lon: Number(lon.toFixed(6)),
        },
      };
    }
  }

  // 2. Check IPv4 address (e.g., "8.8.8.8" or "185.215.113.42")
  const ipMatch = q.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipMatch) {
    const octets = ipMatch.slice(1, 5).map(Number);
    if (octets.every((o) => o >= 0 && o <= 255)) {
      return {
        clueType: 'ip_address',
        summaryLabel: `IPv4 Network Address (${q})`,
        ipAddress: q,
      };
    }
  }

  // 3. Check Phone Number
  const phone = parsePhoneNumberClue(q);
  if (phone) {
    return {
      clueType: 'phone',
      summaryLabel: `${phone.countryName} — ${phone.cityOrRegion} (${phone.countryCode})`,
      phoneInfo: phone,
      coordinates: { lat: phone.lat, lon: phone.lon },
    };
  }

  // 4. Default: Place name, street address, business, or landmark query
  return {
    clueType: 'place_or_text',
    summaryLabel: `Place / Address Search ("${q}")`,
    searchQuery: q,
  };
}
