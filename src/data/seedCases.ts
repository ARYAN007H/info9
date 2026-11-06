import type { InvestigationCase } from '../types/osint';

export const DEFAULT_WORKSPACE_CASE: InvestigationCase = {
  id: 'workspace-default',
  codeName: 'MY-WORKSPACE',
  title: 'Active OSINT Investigation Workspace',
  classification: 'OPEN SOURCE RESEARCH',
  summary:
    'Submit any photo, phone number, IP address, place name, domain, or company to gather open-source intelligence and save verified findings.',
  updatedAtUtc: new Date().toISOString(),
  geoState: {
    lat: 51.5074,
    lon: -0.1278,
    zoom: 13,
    locationLabel: 'London, United Kingdom',
    dateIso: '2026-06-18',
    objectHeightMeters: 10.0,
    shadowLengthMeters: 8.5,
    measuredShadowAzimuthDeg: 42.0,
    landmarks: [],
    // Evidentiary integrity: weather starts as an explicit gap. It is only
    // populated after a live Open-Meteo query in the Geolocation module.
    weatherVerification: null,
  },
  entities: [],
  ownershipEdges: [],
  infraRecords: [],
  forensicSamples: [
    {
      id: 'sample-reference-1',
      title: 'Sample Test Image (Port Terminal Scene with Spliced Stencil)',
      subtitle:
        'Built-in test image demonstrating how JPEG compression & clone analysis highlights edited areas',
      sourceType: 'SYNTHETIC_SPLICE_SCENE',
      claimedDateUtc: '2026-06-18 09:40 UTC',
      claimedLocation: 'Port Terminal Berth #4',
      claimedCoords: [51.5074, -0.1278],
      scenePreset: 'port_terminal',
      exifTags: [
        {
          tagId: '0x010F',
          name: 'Camera Make / Model',
          value: 'DJI Mavic 3 Enterprise · Hasselblad L2D-20c',
          status: 'NOMINAL',
        },
        {
          tagId: '0x0131',
          name: 'Editing Software',
          value: 'Adobe Photoshop 25.4 (Re-saved after capture)',
          status: 'MISMATCH',
        },
        {
          tagId: '0x9003',
          name: 'Original Capture Date',
          value: '2026-06-18 09:42:19 UTC',
          status: 'NOMINAL',
        },
        {
          tagId: '0x8825',
          name: 'GPS Coordinates (EXIF)',
          value: 'Removed / Stripped before upload',
          status: 'STRIPPED',
        },
      ],
      spliceRegions: [
        {
          xRatio: 0.56,
          yRatio: 0.48,
          wRatio: 0.24,
          hRatio: 0.16,
          description:
            'Edited Vessel Nameplate: Re-saved at a different JPEG compression level than the surrounding hull.',
        },
        {
          xRatio: 0.18,
          yRatio: 0.32,
          wRatio: 0.15,
          hRatio: 0.22,
          description:
            'Edited Tank Label (#A12): Higher compression error along the pasted text box.',
        },
      ],
      dHashHex: '8f3e7c1a9b20e4d1',
      waybackUrl: 'https://example.com',
    },
  ],
  sanctionsQuery: {
    targetName: '',
    targetDob: '',
    targetJurisdiction: '',
    candidates: [
      {
        id: 'wl-1',
        listedName: 'MOROZOV, Viktor Alekseevich',
        aliases: ['Viktor Alekseyevich Morozov', 'Victor Morosov', 'В. А. Морозов'],
        listSource: 'OFAC_SDN',
        program: 'Maritime & Energy Sanctions List (E.O. 14024)',
        entityType: 'INDIVIDUAL',
        dobOrIncorporation: '1968-04-14',
        citizenshipOrJurisdiction: 'Russian Federation / Cyprus',
        identifierCode: 'OFAC-SDN-48291',
        notes: 'Designated for managing offshore crude oil shipping companies.',
      },
      {
        id: 'wl-2',
        listedName: 'MOROZOV, Viktor Ivanovich',
        aliases: ['Viktor Morozov'],
        listSource: 'EU_FSF',
        program: 'EU Consolidated Financial Sanctions List',
        entityType: 'INDIVIDUAL',
        dobOrIncorporation: '1954-09-22',
        citizenshipOrJurisdiction: 'Belarus',
        identifierCode: 'EU-FSF-11094',
        notes: 'Former regional official in Gomel, Belarus (Common surname homonym).',
      },
      {
        id: 'wl-3',
        listedName: 'MOROSOV, Viktor',
        aliases: ['Viktor Morozov (Software Engineer)'],
        listSource: 'WIKIDATA_PEP',
        program: 'Public Civic Registry Record',
        entityType: 'INDIVIDUAL',
        dobOrIncorporation: '1991-02-19',
        citizenshipOrJurisdiction: 'Estonia',
        identifierCode: 'WD-Q9918273',
        notes: 'Tallinn-based civic researcher sharing the same first and last name.',
      },
      {
        id: 'wl-4',
        listedName: 'VEGA MARITIME HOLDINGS LTD',
        aliases: ['Vega Shipping Majuro', 'Nordic Polaris Maritime Ltd'],
        listSource: 'UK_OFSI',
        program: 'UK OFSI Consolidated List',
        entityType: 'ENTITY',
        dobOrIncorporation: '2025-11-04',
        citizenshipOrJurisdiction: 'Marshall Islands',
        identifierCode: 'OFSI-UK-19482',
        notes: 'Registered shipping holding company.',
      },
      {
        id: 'wl-5',
        listedName: 'HELIOS DEFENSE MICROELECTRONICS LLC',
        aliases: ['Helios Telemetry Systems', 'Helios Industrial AG'],
        listSource: 'OFAC_SDN',
        program: 'Dual-Use Technology Export Controls',
        entityType: 'ENTITY',
        dobOrIncorporation: '2021-03-10',
        citizenshipOrJurisdiction: 'Switzerland / British Virgin Islands',
        identifierCode: 'OFAC-55910',
        notes: 'Listed for transshipping dual-use industrial controllers.',
      },
    ],
  },
  evidenceLedger: [],
};

export const SEED_INVESTIGATION_CASES: InvestigationCase[] = [
  DEFAULT_WORKSPACE_CASE,
];
