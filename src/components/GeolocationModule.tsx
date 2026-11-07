import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import L from 'leaflet';
import { HeatLayer } from 'leaflet.heat';
import {
  Anchor,
  Camera,
  CloudSun,
  Compass,
  Crosshair,
  Flame,
  Globe,
  Image as ImageIcon,
  Layers,
  MapPin,
  Phone,
  Plane,
  Radar,
  Search,
  BookmarkPlus,
  Sparkles,
  Sun,
  TrainFront,
  Upload,
} from 'lucide-react';
import ProvenanceBadge from './ProvenanceBadge';
import { MODULE_CATALOG } from './moduleCatalog';
import type {
  CommonsGeoPhoto,
  InvestigationCase,
  OverpassConstraintClause,
  OverpassLandmark,
  WeatherVerificationData,
} from '../types/osint';
import {
  calculateShadowElevation,
  calculateSolarPosition,
  projectBearingCoordinate,
  solveChronolocationTimeWindow,
} from '../utils/solarMath';
import { parseAdsbLolStates, type AircraftTrack } from '../utils/doppler';
import {
  executeOverpassIntersectionQuery,
  fetchElevationAndWeatherVerification,
  geocodeLocationNominatim,
  geolocateIpAddress,
  geolocatePhotoViaVision,
  queryOverpassLandmarks,
  reverseGeocodeNominatim,
  searchCommonsGeolocatedPhotos,
  searchCommonsPhotosNear,
} from '../services/osintApis';
import { corroborateWithCommons, type CommonsCorroborationResult } from '../services/photoCorroborate';
import {
  classifyGeolocationClue,
  type ParsedPhoneClue,
} from '../utils/clueParser';
import { parseUploadedBinaryMetadata } from '../utils/osintForensics';
import {
  arrayBufferToBase64,
  REVERSE_IMAGE_SEARCH_LINKS,
  satelliteLink,
  streetViewLink,
  type VisionGeolocationResult,
} from '../utils/visionGeolocate';
import type { VisionGeolocationCandidate } from '../types/osint';

interface GeolocationModuleProps {
  activeCase: InvestigationCase;
  onUpdateGeoState: (
    updater: (
      prev: InvestigationCase['geoState']
    ) => InvestigationCase['geoState']
  ) => void;
  onAppendLedger: (entry: {
    module: 'geolocation';
    targetLabel: string;
    findingSummary: string;
    sourceUrl: string;
  }) => void;
}

type TileLayerMode = 'satellite' | 'osm' | 'topo';
type AssistantTab = 'landmarks' | 'sun_shadow';

const TILE_URLS: Record<
  TileLayerMode,
  { url: string; attribution: string; label: string }
> = {
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri World Imagery',
    label: 'Satellite',
  },
  osm: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    label: 'Street map',
  },
  topo: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenTopoMap (CC-BY-SA)',
    label: 'Terrain',
  },
};

const LANDMARK_CLUE_TYPES: Array<{
  label: string;
  featureType: OverpassConstraintClause['featureType'];
  maxDistanceMeters: number;
}> = [
  {
    label: 'Storage / Fuel Tanks',
    featureType: 'storage_tank',
    maxDistanceMeters: 2500,
  },
  {
    label: 'Electrical Substations',
    featureType: 'power_substation',
    maxDistanceMeters: 1200,
  },
  {
    label: 'Railway Level Crossings',
    featureType: 'railway_crossing',
    maxDistanceMeters: 1000,
  },
  {
    label: 'High-Voltage Power Towers',
    featureType: 'power_tower',
    maxDistanceMeters: 800,
  },
  {
    label: 'Harbor / Port Cranes',
    featureType: 'port_crane',
    maxDistanceMeters: 1500,
  },
  {
    label: 'Radio / Cell Masts',
    featureType: 'communications_tower',
    maxDistanceMeters: 1500,
  },
];

interface ResolvedClueCard {
  type: 'phone' | 'ip' | 'photo' | 'place' | 'coordinates';
  title: string;
  subtitle: string;
  details: Array<{ label: string; value: string }>;
  photoPreviewUrl?: string;
}

export const GeolocationModule: React.FC<GeolocationModuleProps> = ({
  activeCase,
  onUpdateGeoState,
  onAppendLedger,
}) => {
  const { geoState } = activeCase;
  const [tileMode, setTileMode] = useState<TileLayerMode>('satellite');
  const [activeTab, setActiveTab] = useState<AssistantTab>('landmarks');
  const [clueInput, setClueInput] = useState('');
  const [isLocating, setIsLocating] = useState(false);
  const [isQueryingOverpass, setIsQueryingOverpass] = useState(false);
  const [isQueryingWeather, setIsQueryingWeather] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [selectedUtcHour, setSelectedUtcHour] = useState<number>(10.5);
  const [resolvedClue, setResolvedClue] = useState<ResolvedClueCard | null>(
    null
  );

  // Map overlay layers — all zero-key: local heatmap over scanned landmarks,
  // live adsb.lol aircraft, Commons geosearch photos, OpenRailwayMap /
  // OpenSeaMap tiles. (No traffic layer: every traffic tile source needs a
  // paid key — we don't fake one.)
  const [layersOpen, setLayersOpen] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showAircraft, setShowAircraft] = useState(false);
  const [showCommonsPhotos, setShowCommonsPhotos] = useState(false);
  const [showRailways, setShowRailways] = useState(false);
  const [showMarine, setShowMarine] = useState(false);
  const [commonsPhotos, setCommonsPhotos] = useState<CommonsGeoPhoto[]>([]);
  const [commonsPhotosError, setCommonsPhotosError] = useState<string | null>(null);
  const [aircraftCount, setAircraftCount] = useState<number | null>(null);

  // AI photo geolocation state (optional capability; candidates are DERIVED).
  const [photoPayload, setPhotoPayload] = useState<{
    base64: string;
    mimeType: string;
  } | null>(null);
  const [isQueryingVision, setIsQueryingVision] = useState(false);
  const [visionResult, setVisionResult] = useState<VisionGeolocationResult | null>(
    null
  );
  const [visionError, setVisionError] = useState<string | null>(null);
  const [commonsTerms, setCommonsTerms] = useState('');
  const [isCorroborating, setIsCorroborating] = useState(false);
  const [commonsResult, setCommonsResult] =
    useState<CommonsCorroborationResult | null>(null);
  const [commonsError, setCommonsError] = useState<string | null>(null);

  // Simple 2-clue landmark filter
  const [primaryFeatureIdx, setPrimaryFeatureIdx] = useState<number>(0);
  const [secondaryFeatureIdx, setSecondaryFeatureIdx] = useState<number>(-1);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const vectorLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const heatLayerRef = useRef<L.Layer | null>(null);
  const aircraftLayerRef = useRef<L.LayerGroup | null>(null);
  const commonsLayerRef = useRef<L.LayerGroup | null>(null);
  const railwayLayerRef = useRef<L.TileLayer | null>(null);
  const marineLayerRef = useRef<L.TileLayer | null>(null);
  const aircraftTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const shadowMetrics = useMemo(
    () =>
      calculateShadowElevation(
        geoState.objectHeightMeters,
        geoState.shadowLengthMeters
      ),
    [geoState.objectHeightMeters, geoState.shadowLengthMeters]
  );

  const chronoSolution = useMemo(
    () =>
      solveChronolocationTimeWindow(
        geoState.lat,
        geoState.lon,
        geoState.dateIso,
        shadowMetrics.elevationDeg,
        geoState.measuredShadowAzimuthDeg,
        10
      ),
    [
      geoState.lat,
      geoState.lon,
      geoState.dateIso,
      shadowMetrics.elevationDeg,
      geoState.measuredShadowAzimuthDeg,
    ]
  );

  useEffect(() => {
    if (chronoSolution.bestMatches.length > 0) {
      setSelectedUtcHour(chronoSolution.bestMatches[0].utcHoursDecimal);
    }
  }, [chronoSolution.bestMatches]);

  const activeSunPosition = useMemo(() => {
    const parts = geoState.dateIso.split('-').map(Number);
    const y = parts[0] || 2026;
    const m = (parts[1] || 1) - 1;
    const d = parts[2] || 1;
    const hours = Math.floor(selectedUtcHour);
    const minutes = Math.round((selectedUtcHour - hours) * 60);
    const dt = new Date(Date.UTC(y, m, d, hours, minutes, 0));
    return calculateSolarPosition(geoState.lat, geoState.lon, dt);
  }, [geoState.lat, geoState.lon, geoState.dateIso, selectedUtcHour]);

  // Initialize Leaflet Map once
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [geoState.lat, geoState.lon],
      zoom: geoState.zoom || 13,
      zoomControl: true,
    });

    const initialTile = TILE_URLS[tileMode];
    const tileLayer = L.tileLayer(initialTile.url, {
      attribution: initialTile.attribution,
      maxZoom: 19,
    }).addTo(map);

    const vectorGroup = L.layerGroup().addTo(map);

    map.on('click', async (ev: L.LeafletMouseEvent) => {
      const clickedLat = Number(ev.latlng.lat.toFixed(6));
      const clickedLon = Number(ev.latlng.lng.toFixed(6));
      onUpdateGeoState((prev) => ({
        ...prev,
        lat: clickedLat,
        lon: clickedLon,
        locationLabel: `Loading address for (${clickedLat}, ${clickedLon})...`,
      }));
      const address = await reverseGeocodeNominatim(clickedLat, clickedLon);
      onUpdateGeoState((prev) => ({
        ...prev,
        lat: clickedLat,
        lon: clickedLon,
        locationLabel: address,
      }));
    });

    mapInstanceRef.current = map;
    tileLayerRef.current = tileLayer;
    vectorLayerGroupRef.current = vectorGroup;

    // Leaflet computes tile layout from the container size at init; without
    // this, viewport/responsive resizes leave the map clipped or half-drawn.
    const resizeObserver = new ResizeObserver(() => map.invalidateSize());
    resizeObserver.observe(mapContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapInstanceRef.current = null;
      tileLayerRef.current = null;
      vectorLayerGroupRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!tileLayerRef.current) return;
    tileLayerRef.current.setUrl(TILE_URLS[tileMode].url);
  }, [tileMode]);

  // Close the layers dropdown when a click lands outside it.
  useEffect(() => {
    if (!layersOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && !target.closest('[data-layers-root]')) setLayersOpen(false);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [layersOpen]);

  // The dropdown renders through a portal with fixed coordinates so the map
  // panel's overflow-hidden rounding never clips it on short viewports.
  const layersBtnRef = useRef<HTMLButtonElement | null>(null);
  const [layersPos, setLayersPos] = useState<{ top: number; left: number; maxH: number } | null>(null);
  useEffect(() => {
    if (!layersOpen) {
      setLayersPos(null);
      return;
    }
    const update = () => {
      const rect = layersBtnRef.current?.getBoundingClientRect();
      if (!rect) return;
      setLayersPos({
        top: rect.bottom + 6,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 308)),
        maxH: Math.min(430, window.innerHeight - rect.bottom - 14),
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [layersOpen]);

  // ---- Overlay layers (each adds/removes independently of the base map) ----

  // Infrastructure heatmap over the scanned landmark set.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!showHeatmap) {
      if (heatLayerRef.current) {
        map.removeLayer(heatLayerRef.current);
        heatLayerRef.current = null;
      }
      return;
    }
    const points = geoState.landmarks.map((lm) => [lm.lat, lm.lon, 1] as [number, number, number]);
    // the plugin's d.ts omits the inherited Leaflet Layer members
    const layer = new HeatLayer(points, {
      radius: 28,
      blur: 20,
      minOpacity: 0.35,
      maxZoom: 16,
    }) as unknown as L.Layer;
    layer.addTo(map);
    heatLayerRef.current = layer;
    return () => {
      if (heatLayerRef.current) {
        map.removeLayer(heatLayerRef.current);
        heatLayerRef.current = null;
      }
    };
  }, [showHeatmap, geoState.landmarks]);

  // Keyless tile overlays: OpenRailwayMap + OpenSeaMap.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!showRailways) {
      if (railwayLayerRef.current) {
        map.removeLayer(railwayLayerRef.current);
        railwayLayerRef.current = null;
      }
      return;
    }
    const layer = L.tileLayer('https://{s}.tiles.openrailwaymap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenRailwayMap (CC-BY-SA)',
      maxZoom: 19,
      subdomains: 'abc',
      opacity: 0.85,
    }).addTo(map);
    railwayLayerRef.current = layer;
    return () => {
      if (railwayLayerRef.current) {
        map.removeLayer(railwayLayerRef.current);
        railwayLayerRef.current = null;
      }
    };
  }, [showRailways]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!showMarine) {
      if (marineLayerRef.current) {
        map.removeLayer(marineLayerRef.current);
        marineLayerRef.current = null;
      }
      return;
    }
    const layer = L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenSeaMap contributors',
      maxZoom: 18,
      opacity: 0.9,
    }).addTo(map);
    marineLayerRef.current = layer;
    return () => {
      if (marineLayerRef.current) {
        map.removeLayer(marineLayerRef.current);
        marineLayerRef.current = null;
      }
    };
  }, [showMarine]);

  // Geotagged Commons photos near the pin (refetches when the pin moves).
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!showCommonsPhotos) {
      if (commonsLayerRef.current) {
        map.removeLayer(commonsLayerRef.current);
        commonsLayerRef.current = null;
      }
      setCommonsPhotos([]);
      setCommonsPhotosError(null);
      return;
    }
    let cancelled = false;
    const fetchPhotos = async () => {
      try {
        const results = await searchCommonsPhotosNear(geoState.lat, geoState.lon, 2000);
        if (cancelled) return;
        setCommonsPhotos(results);
        setCommonsPhotosError(null);
        const group = L.layerGroup();
        for (const photo of results) {
          L.marker([photo.lat, photo.lon], {
            icon: L.divIcon({
              className: '',
              html: `<div style="width:22px;height:22px;border-radius:4px;overflow:hidden;border:2px solid #f0954f;box-shadow:0 1px 4px rgba(0,0,0,.5)"><img src="${photo.thumbUrl}" style="width:100%;height:100%;object-fit:cover" alt=""/></div>`,
              iconSize: [22, 22],
              iconAnchor: [11, 11],
            }),
          })
            .bindPopup(
              `<div style="max-width:220px"><img src="${photo.thumbUrl}" style="width:100%;border-radius:4px;margin-bottom:4px" alt=""/><div style="font-weight:600;font-size:12px">${photo.title.replace(/</g, '&lt;')}</div><a href="${photo.descriptionUrl}" target="_blank" rel="noreferrer" style="font-size:11px">Open on Wikimedia Commons ↗</a></div>`
            )
            .addTo(group);
        }
        if (commonsLayerRef.current) map.removeLayer(commonsLayerRef.current);
        group.addTo(map);
        commonsLayerRef.current = group;
      } catch (err) {
        if (!cancelled) {
          setCommonsPhotos([]);
          setCommonsPhotosError(err instanceof Error ? err.message : String(err));
        }
      }
    };
    const timer = setTimeout(fetchPhotos, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [showCommonsPhotos, geoState.lat, geoState.lon]);

  // Live air traffic from the free adsb.lol feed — markers refresh ~15 s
  // while the layer is on. Pairs naturally with the Acoustic module: what's
  // overhead right now is what a recording would hear.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (!showAircraft) {
      if (aircraftTimerRef.current) {
        clearInterval(aircraftTimerRef.current);
        aircraftTimerRef.current = null;
      }
      if (aircraftLayerRef.current) {
        map.removeLayer(aircraftLayerRef.current);
        aircraftLayerRef.current = null;
      }
      setAircraftCount(null);
      return;
    }
    let cancelled = false;
    const drawAircraft = (tracks: AircraftTrack[]) => {
      const group = L.layerGroup();
      for (const t of tracks) {
        const p = t.points[t.points.length - 1];
        const lat = p.lat;
        const lon = p.lon;
        const heading = p.headingDeg ?? 0;
        L.marker([lat, lon], {
          icon: L.divIcon({
            className: '',
            html: `<span style="display:inline-block;font-size:16px;line-height:16px;color:#f0954f;text-shadow:0 1px 3px rgba(0,0,0,.7);transform:rotate(${heading - 45}deg)">✈</span>`,
            iconSize: [18, 18],
            iconAnchor: [9, 9],
          }),
        })
          .bindTooltip(`${t.callsign || t.icao}`)
          .bindPopup(
            `<div style="font-size:12px"><b>${t.callsign || t.icao}</b><br/>alt ${Math.round(p.altM)} m · ${t.points.length > 1 ? 'live' : 'first fix'}</div>`
          )
          .addTo(group);
      }
      if (aircraftLayerRef.current) map.removeLayer(aircraftLayerRef.current);
      group.addTo(map);
      aircraftLayerRef.current = group;
      setAircraftCount(tracks.length);
    };
    const poll = async () => {
      try {
        const res = await fetch(`/api/osint/adsb?lat=${geoState.lat}&lon=${geoState.lon}&radiusKm=30`);
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        drawAircraft(parseAdsbLolStates(json, Date.now() / 1000));
      } catch {
        // transient network error — next poll retries; the map shows what it has
      }
    };
    void poll();
    aircraftTimerRef.current = setInterval(poll, 15000);
    return () => {
      cancelled = true;
      if (aircraftTimerRef.current) {
        clearInterval(aircraftTimerRef.current);
        aircraftTimerRef.current = null;
      }
    };
  }, [showAircraft, geoState.lat, geoState.lon]);

  // Update Map Pin, Sun/Shadow Vectors, and Discovered landmarks
  useEffect(() => {
    const map = mapInstanceRef.current;
    const group = vectorLayerGroupRef.current;
    if (!map || !group) return;

    map.setView([geoState.lat, geoState.lon], map.getZoom(), {
      animate: false,
    });
    group.clearLayers();

    L.circleMarker([geoState.lat, geoState.lon], {
      radius: 9,
      color: '#ff6b2c',
      weight: 3,
      fillColor: '#ff8350',
      fillOpacity: 0.9,
    })
      .bindPopup(
        `<strong>${geoState.locationLabel}</strong><br/>${geoState.lat.toFixed(
          5
        )}, ${geoState.lon.toFixed(5)}`
      )
      .addTo(group);

    if (activeTab === 'sun_shadow') {
      const sunEnd = projectBearingCoordinate(
        geoState.lat,
        geoState.lon,
        activeSunPosition.azimuthDeg,
        1.2
      );
      L.polyline([[geoState.lat, geoState.lon], sunEnd], {
        color: '#e5b454',
        weight: 3,
        dashArray: '6, 6',
      })
        .bindTooltip(`Sun Direction (${activeSunPosition.azimuthDeg}°)`)
        .addTo(group);

      const shadowEnd = projectBearingCoordinate(
        geoState.lat,
        geoState.lon,
        geoState.measuredShadowAzimuthDeg,
        0.85
      );
      L.polyline([[geoState.lat, geoState.lon], shadowEnd], {
        color: '#06b6d4',
        weight: 4,
      })
        .bindTooltip(`Shadow direction (${geoState.measuredShadowAzimuthDeg}°)`)
        .addTo(group);
    }

    for (const lm of geoState.landmarks) {
      L.circleMarker([lm.lat, lm.lon], {
        radius: 6,
        color: '#10b981',
        weight: 2,
        fillColor: '#059669',
        fillOpacity: 0.9,
      })
        .bindPopup(
          `<strong>${lm.name}</strong><br/>Type: ${lm.category}<br/>Distance: ${lm.distanceMeters}m`
        )
        .addTo(group);
    }
  }, [
    geoState.lat,
    geoState.lon,
    geoState.locationLabel,
    geoState.measuredShadowAzimuthDeg,
    geoState.landmarks,
    activeSunPosition.azimuthDeg,
    activeTab,
  ]);

  // Universal Clue Resolver (handles Phone numbers, IP addresses, Coordinates, and Places)
  const resolveAnyClue = async (rawQuery: string) => {
    const q = rawQuery.trim();
    if (!q) return;

    setIsLocating(true);
    setStatusMessage(null);

    try {
      const classified = classifyGeolocationClue(q);

      if (classified.clueType === 'phone' && classified.phoneInfo) {
        const p: ParsedPhoneClue = classified.phoneInfo;
        onUpdateGeoState((prev) => ({
          ...prev,
          lat: p.lat,
          lon: p.lon,
          locationLabel: `${p.cityOrRegion} (${p.countryName})`,
          landmarks: [],
        }));
        setResolvedClue({
          type: 'phone',
          title: `Phone Clue Located: ${p.cityOrRegion}`,
          subtitle: `International dialing prefix and area code matched to ${p.countryName}`,
          details: [
            { label: 'Phone Number', value: p.rawInput },
            { label: 'Country / Region', value: `${p.countryName} (${p.countryCode})` },
            { label: 'Matched City / Area', value: p.cityOrRegion },
            { label: 'Local Timezone', value: p.timezoneUtc },
            {
              label: 'Center Coordinates',
              value: `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`,
            },
          ],
        });
        setStatusMessage(
          `Located phone number ${p.rawInput} in ${p.cityOrRegion}, ${p.countryName}.`
        );
        return;
      }

      if (classified.clueType === 'ip_address' && classified.ipAddress) {
        setStatusMessage(`Looking up network location for IP ${classified.ipAddress}...`);
        const ipData = await geolocateIpAddress(classified.ipAddress);
        onUpdateGeoState((prev) => ({
          ...prev,
          lat: ipData.lat,
          lon: ipData.lon,
          locationLabel: `${ipData.city}, ${ipData.country} (${ipData.ip})`,
          landmarks: [],
        }));
        setResolvedClue({
          type: 'ip',
          title: `IP Address Located: ${ipData.city}, ${ipData.country}`,
          subtitle: `Hosted by ${ipData.isp} (${ipData.asn})`,
          details: [
            { label: 'IP Address', value: ipData.ip },
            { label: 'City & Region', value: `${ipData.city}, ${ipData.region}` },
            { label: 'Country', value: ipData.country },
            { label: 'Network / ISP', value: `${ipData.isp} (${ipData.asn})` },
            {
              label: 'Coordinates',
              value: `${ipData.lat.toFixed(4)}, ${ipData.lon.toFixed(4)}`,
            },
          ],
        });
        setStatusMessage(
          `Resolved IP ${ipData.ip} to ${ipData.city}, ${ipData.country} (${ipData.isp}).`
        );
        return;
      }

      if (classified.clueType === 'coordinates' && classified.coordinates) {
        const { lat, lon } = classified.coordinates;
        const address = await reverseGeocodeNominatim(lat, lon);
        onUpdateGeoState((prev) => ({
          ...prev,
          lat,
          lon,
          locationLabel: address,
          landmarks: [],
        }));
        setResolvedClue({
          type: 'coordinates',
          title: `Coordinates Pinned: ${lat.toFixed(4)}, ${lon.toFixed(4)}`,
          subtitle: address,
          details: [
            { label: 'Latitude', value: `${lat.toFixed(6)}°` },
            { label: 'Longitude', value: `${lon.toFixed(6)}°` },
            { label: 'Reverse Geocoded Address', value: address },
          ],
        });
        setStatusMessage(`Pinned coordinates ${lat}, ${lon} (${address}).`);
        return;
      }

      // Default: Place / Street / Landmark Search via OpenStreetMap Nominatim
      setStatusMessage(`Searching OpenStreetMap for "${q}"...`);
      const hits = await geocodeLocationNominatim(q);
      if (hits.length > 0) {
        const best = hits[0];
        onUpdateGeoState((prev) => ({
          ...prev,
          lat: best.lat,
          lon: best.lon,
          locationLabel: best.displayName,
          landmarks: [],
        }));
        setResolvedClue({
          type: 'place',
          title: best.displayName.split(',')[0] || q,
          subtitle: best.displayName,
          details: [
            { label: 'Matched Location', value: best.displayName },
            { label: 'Place Category', value: best.type.replace(/_/g, ' ') },
            {
              label: 'Coordinates',
              value: `${best.lat.toFixed(5)}, ${best.lon.toFixed(5)}`,
            },
          ],
        });
        setStatusMessage(
          `Found "${best.displayName.slice(0, 60)}" (${best.lat}, ${best.lon}).`
        );
      } else {
        setStatusMessage(
          `No location found for "${q}". Try a city name, street address, phone number (+44...), or coordinates.`
        );
      }
    } catch (err) {
      setStatusMessage(
        `Lookup error: ${err instanceof Error ? err.message : 'Unable to reach geocoder'}`
      );
    } finally {
      setIsLocating(false);
    }
  };

  const handleClueFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await resolveAnyClue(clueInput);
  };

  // Photo Upload Handler for Geolocation
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const buffer = await file.arrayBuffer();
    const exifTags = parseUploadedBinaryMetadata(
      file.name,
      file.size,
      file.type,
      buffer
    );
    const objectUrl = URL.createObjectURL(file);
    const base64 = arrayBufferToBase64(buffer);

    const img = new Image();
    img.onload = () => {
      const hasExifSegment = exifTags.some(
        (t) => t.tagId === '0xFFE1' && t.status === 'NOMINAL'
      );

      setResolvedClue({
        type: 'photo',
        title: `Uploaded Photo Clue: ${file.name}`,
        subtitle: hasExifSegment
          ? 'EXIF camera segment detected — inspect visual landmarks or enter any visible text/phone numbers from the image.'
          : 'GPS metadata was stripped from this image (common for social media/messaging apps). Use visual clues from the photo below to pinpoint it.',
        photoPreviewUrl: objectUrl,
        details: [
          { label: 'File Name', value: file.name },
          { label: 'Resolution', value: `${img.width} × ${img.height} px` },
          {
            label: 'File Size',
            value: `${(file.size / 1024).toFixed(1)} KB`,
          },
          {
            label: 'EXIF / GPS Status',
            value: hasExifSegment
              ? 'APP1 EXIF Header Present'
              : 'EXIF GPS Stripped — Use Visual/Shadow Clues',
          },
        ],
      });
      setPhotoPayload(
        /^image\/(jpeg|png|webp)$/i.test(file.type)
          ? { base64, mimeType: file.type }
          : { base64, mimeType: 'image/jpeg' }
      );
      setVisionResult(null);
      setVisionError(null);
      setCommonsResult(null);
      setCommonsError(null);
      setCommonsTerms('');
      setStatusMessage(
        `Loaded photo "${file.name}" (${img.width}×${img.height}px). Run AI geolocation below, or use the Nearby Landmarks / Sun & Shadow tools on the right.`
      );
    };
    img.src = objectUrl;
  };

  const handleRunCommonsMatch = async () => {
    if (!resolvedClue?.photoPreviewUrl || !commonsTerms.trim() || isCorroborating) return;
    setIsCorroborating(true);
    setCommonsError(null);
    setCommonsResult(null);
    setStatusMessage('Matching the photo against geolocated Wikimedia Commons images...');
    try {
      const result = await corroborateWithCommons(
        commonsTerms.trim(),
        resolvedClue.photoPreviewUrl
      );
      setCommonsResult(result);
      if (result.matches.length === 0) {
        setStatusMessage(
          `Commons returned ${result.candidatesExamined} keyword matches but none carried GPS metadata. Refine the terms or use the reverse-search links.`
        );
      } else {
        const best = result.matches[0];
        setStatusMessage(
          `Found ${result.matches.length} geolocated Commons photos — best perceptual match ${best.similarityPercent}% at ${best.photo.lat.toFixed(5)}, ${best.photo.lon.toFixed(5)}. Compare the thumbnails before pinning.`
        );
      }
    } catch (err) {
      setCommonsError(
        err instanceof Error ? err.message : 'Commons matching failed'
      );
      setStatusMessage('Commons matching failed — see the notice in the photo panel.');
    } finally {
      setIsCorroborating(false);
    }
  };

  const handlePinCommonsMatch = async (photo: CommonsGeoPhoto) => {
    const address = await reverseGeocodeNominatim(photo.lat, photo.lon);
    onUpdateGeoState((prev) => ({
      ...prev,
      lat: photo.lat,
      lon: photo.lon,
      locationLabel: photo.title.replace(/\.(jpg|jpeg|png)$/i, ''),
      weatherVerification: null,
      landmarks: [],
    }));
    setStatusMessage(
      `Pinned Commons photo location (${photo.lat.toFixed(5)}, ${photo.lon.toFixed(5)}) — nearest address: ${address}. Compare the two photos side by side before saving to the ledger.`
    );
  };

  const handleRunVisionGeolocation = async () => {
    if (!photoPayload || isQueryingVision) return;
    setIsQueryingVision(true);
    setVisionError(null);
    setVisionResult(null);
    setStatusMessage('Running AI geolocation on the uploaded photo...');
    try {
      const result = await geolocatePhotoViaVision(
        photoPayload.base64,
        photoPayload.mimeType
      );
      setVisionResult(result);
      setStatusMessage(
        result.candidates.length > 0
          ? `AI produced ${result.candidates.length} candidate location(s) — verify each one before recording it as evidence.`
          : 'The AI model found no usable geographic signal in this photo. Try reverse image search below.'
      );
    } catch (err) {
      setVisionError(
        err instanceof Error ? err.message : 'Vision geolocation failed'
      );
      setStatusMessage('AI geolocation unavailable — see the notice in the photo panel.');
    } finally {
      setIsQueryingVision(false);
    }
  };

  const handlePinVisionCandidate = async (candidate: VisionGeolocationCandidate) => {
    const address = await reverseGeocodeNominatim(candidate.lat, candidate.lon);
    onUpdateGeoState((prev) => ({
      ...prev,
      lat: candidate.lat,
      lon: candidate.lon,
      locationLabel: candidate.label,
      // Weather verified for the previous pin is invalid for this one.
      weatherVerification: null,
      landmarks: [],
    }));
    setStatusMessage(
      `Pinned AI candidate "${candidate.label}" (${candidate.confidencePercent}% confidence). Nearest address: ${address}. Verify with Street View / satellite imagery before saving to the ledger.`
    );
  };

  const handleScanNearbyLandmarks = async () => {
    setIsQueryingOverpass(true);
    setStatusMessage(
      'Scanning OpenStreetMap within 2.5 km for infrastructure and visual landmarks...'
    );
    try {
      if (secondaryFeatureIdx >= 0) {
        const c1 = LANDMARK_CLUE_TYPES[primaryFeatureIdx];
        const c2 = LANDMARK_CLUE_TYPES[secondaryFeatureIdx];
        const clauses: OverpassConstraintClause[] = [
          {
            id: 'c1',
            label: c1.label,
            featureType: c1.featureType,
            maxDistanceMeters: 3000,
          },
          {
            id: 'c2',
            label: c2.label,
            featureType: c2.featureType,
            maxDistanceMeters: c2.maxDistanceMeters,
          },
        ];
        const res = await executeOverpassIntersectionQuery(
          clauses,
          geoState.lat,
          geoState.lon,
          3500
        );
        onUpdateGeoState((prev) => ({
          ...prev,
          landmarks: res.landmarks,
        }));
        setStatusMessage(
          res.landmarks.length > 0
            ? `Found ${res.landmarks.length} locations where "${c1.label}" is near "${c2.label}".`
            : `No exact matches for both clues within 3.5 km — try scanning all nearby landmarks instead.`
        );
      } else {
        const landmarks: OverpassLandmark[] = await queryOverpassLandmarks(
          geoState.lat,
          geoState.lon,
          2500
        );
        onUpdateGeoState((prev) => ({
          ...prev,
          landmarks,
        }));
        setStatusMessage(
          landmarks.length > 0
            ? `Found ${landmarks.length} infrastructure landmarks within 2.5 km. Click any item below or green pin on the map.`
            : 'No industrial/utility landmarks returned within 2.5 km of this pin.'
        );
      }
    } catch {
      setStatusMessage(
        'OpenStreetMap Overpass server is busy; try again in a few seconds.'
      );
    } finally {
      setIsQueryingOverpass(false);
    }
  };

  const handleVerifyWeather = async () => {
    setIsQueryingWeather(true);
    setStatusMessage('Checking historical weather and terrain elevation…');
    try {
      const weatherVerification = await fetchElevationAndWeatherVerification(
        geoState.lat,
        geoState.lon,
        geoState.dateIso
      );
      if (weatherVerification === null) {
        setStatusMessage(
          'Open-Meteo is unreachable or has no data for that date — no weather data was recorded (info9 never fills gaps with estimates).'
        );
        return;
      }
      onUpdateGeoState((prev) => ({
        ...prev,
        weatherVerification,
      }));
      setStatusMessage(
        `Verified elevation (${
          weatherVerification.elevationMeters ?? 'unknown'
        }m ASL) and ${weatherVerification.cloudCoverMeanPercent}% cloud cover on ${geoState.dateIso}.`
      );
    } catch {
      setStatusMessage(
        'Weather verification failed — no data recorded rather than a fabricated estimate.'
      );
    } finally {
      setIsQueryingWeather(false);
    }
  };

  const handleSaveFinding = () => {
    const topMatch = chronoSolution.bestMatches[0];
    const timeNote = topMatch ? ` · Estimated Solar Time: ${topMatch.utcTimeFormatted}` : '';
    const elevationNote = geoState.weatherVerification?.elevationMeters != null
      ? ` Elevation: ${geoState.weatherVerification.elevationMeters}m ASL.`
      : '';
    onAppendLedger({
      module: 'geolocation',
      targetLabel: `${geoState.locationLabel} (${geoState.lat}, ${geoState.lon})`,
      findingSummary: `Geolocated pin at ${geoState.lat}, ${geoState.lon} (${geoState.locationLabel}).${elevationNote}${timeNote}`,
      sourceUrl: 'https://www.openstreetmap.org',
    });
    setStatusMessage('Saved geolocation finding to your Watchlist & Notes report.');
  };

  return (
    <div className="space-y-6">
      {/* Step 1: Universal Clue Intake Bar (Photo, Phone, IP, Address, or Coordinates) */}
      <div className="space-y-4 rounded-md border border-line bg-panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-baseline gap-2.5">
              <span className="signage text-[10px] font-semibold text-accent">
                {MODULE_CATALOG.geolocation.num}
              </span>
              <h1 className="text-lg font-semibold text-ink">
                {MODULE_CATALOG.geolocation.name}
              </h1>
            </div>
            <p className="mt-1 text-sm text-ink-2">
              Photo, phone number, IP, place name, or coordinates — pinpoint
              any clue on the map.
            </p>
          </div>

          <button
            type="button"
            onClick={handleSaveFinding}
            className="flex items-center gap-1.5 rounded px-3.5 py-2 text-xs font-semibold text-on-accent bg-accent transition-colors hover:bg-accent-strong whitespace-nowrap shrink-0"
          >
            <BookmarkPlus className="h-3.5 w-3.5" />
            <span>Record finding</span>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
          {/* Unified Text Clue Input (Phone, IP, Place, Coordinates) */}
          <form
            onSubmit={handleClueFormSubmit}
            className="lg:col-span-8 flex flex-col justify-between p-4 border border-line bg-well rounded space-y-3"
          >
            <div>
              <label
                htmlFor="universal-clue-input"
                className="block text-xs font-semibold text-ink-2 mb-1.5"
              >
                Phone number, IP address, place name, or coordinates
              </label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-ink-3 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="universal-clue-input"
                    type="text"
                    placeholder="e.g. +44 20 7946 0921, 8.8.8.8, Tower Bridge London, or 35.6586, 139.7454"
                    value={clueInput}
                    onChange={(e) => setClueInput(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm border border-line bg-panel rounded text-ink focus:outline-none focus:border-accent"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isLocating}
                  className="px-4 py-2 text-xs font-semibold text-on-accent bg-accent hover:bg-accent-strong rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  {isLocating ? 'Locating…' : 'Locate clue'}
                </button>
              </div>
            </div>

            {/* 1-Click Example Clues for Easy Testing */}
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
              <span>Try:</span>
              <button
                type="button"
                onClick={() => {
                  const sample = '+44 20 7946 0921';
                  setClueInput(sample);
                  resolveAnyClue(sample);
                }}
                className="px-2.5 py-1 border border-line bg-well hover:border-accent rounded-md text-ink-2 font-mono transition-colors whitespace-nowrap shrink-0"
              >
                Phone: +44 20 7946 0921
              </button>
              <button
                type="button"
                onClick={() => {
                  const sample = '+1 (415) 555-0192';
                  setClueInput(sample);
                  resolveAnyClue(sample);
                }}
                className="px-2.5 py-1 border border-line bg-well hover:border-accent rounded-md text-ink-2 font-mono transition-colors whitespace-nowrap shrink-0"
              >
                Phone: +1 (415) 555-0192
              </button>
              <button
                type="button"
                onClick={() => {
                  const sample = '8.8.8.8';
                  setClueInput(sample);
                  resolveAnyClue(sample);
                }}
                className="px-2.5 py-1 border border-line bg-well hover:border-accent rounded-md text-ink-2 font-mono transition-colors whitespace-nowrap shrink-0"
              >
                IP: 8.8.8.8
              </button>
              <button
                type="button"
                onClick={() => {
                  const sample = '35.6586, 139.7454';
                  setClueInput(sample);
                  resolveAnyClue(sample);
                }}
                className="px-2.5 py-1 border border-line bg-well hover:border-accent rounded-md text-ink-2 font-mono transition-colors whitespace-nowrap shrink-0"
              >
                Coords: 35.6586, 139.7454
              </button>
            </div>
          </form>

          {/* Upload Photo Clue Card */}
          <label className="lg:col-span-4 cursor-pointer p-4 border border-dashed border-line-strong bg-well hover:border-accent rounded-lg flex flex-col items-center justify-center text-center transition-colors">
            <Camera className="w-6 h-6 text-ink-3 mb-1.5" />
            <span className="text-xs font-semibold text-ink">
              Upload a photo to geolocate
            </span>
            <span className="mt-1 text-[11px] text-ink-3">
              Extracts EXIF metadata &amp; displays the image beside the map to
              match landmarks or shadows
            </span>
            <span className="mt-2.5 inline-flex items-center gap-1.5 rounded border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-ink">
              <Upload className="w-3.5 h-3.5" />
              <span>Choose image (JPG/PNG)</span>
            </span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handlePhotoUpload}
              className="hidden"
            />
          </label>
        </div>

        {/* Status Feedback */}
        {statusMessage && (
          <div
            role="status"
            className="px-4 py-2.5 text-xs rounded border border-line border-l-2 border-l-derived bg-well text-ink-2 flex items-center justify-between"
          >
            <span>{statusMessage}</span>
            <button
              type="button"
              onClick={() => setStatusMessage(null)}
              className="text-xs underline ml-4 whitespace-nowrap shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Resolved Clue Breakdown Card (When user submits a Phone, IP, Photo, or Location) */}
        {resolvedClue && (
          <div className="p-4 border border-line bg-well rounded flex flex-col md:flex-row gap-4 items-start justify-between">
            {resolvedClue.photoPreviewUrl && (
              <img
                src={resolvedClue.photoPreviewUrl}
                alt="Uploaded geolocation clue"
                referrerPolicy="no-referrer"
                className="w-36 h-24 object-cover rounded-lg border border-line-strong shrink-0"
              />
            )}
            <div className="flex-1 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-bold text-ink">
                    {resolvedClue.title}
                  </h2>
                  <p className="text-xs text-ink-3">
                    {resolvedClue.subtitle}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setResolvedClue(null)}
                  className="text-xs text-ink-3 hover:text-ink"
                >
                  Clear
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                {resolvedClue.details.map((item) => (
                  <div
                    key={item.label}
                    className="p-2 border border-line bg-well rounded"
                  >
                    <div className="text-[11px] text-ink-3">
                      {item.label}
                    </div>
                    <div className="text-xs font-semibold text-ink font-mono tabular-nums truncate mt-0.5">
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        {/* AI photo geolocation Panel (optional capability; output is DERIVED) */}
        {resolvedClue?.type === 'photo' && (
          <div className="p-4 border border-line bg-panel rounded space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-ink flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-accent" />
                  AI photo geolocation
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold border border-accent/40 bg-accent/10 text-accent">
                    HYPOTHESIS · NOT EVIDENCE
                  </span>
                </h2>
                <p className="text-xs text-ink-3 mt-0.5">
                  No GPS metadata? The vision model proposes candidate locations
                  from visual clues. Every candidate is an unverified hypothesis —
                  corroborate with the links and tools below.
                </p>
              </div>
              <button
                type="button"
                onClick={handleRunVisionGeolocation}
                disabled={!photoPayload || isQueryingVision}
                className="px-3.5 py-2 text-xs font-semibold text-on-accent bg-accent hover:bg-accent-strong disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                {isQueryingVision ? 'Analyzing photo…' : 'Run AI geolocation'}
              </button>
            </div>

            {visionError && (
              <div className="p-3 border border-gap/40 bg-gap/10 rounded-lg text-xs text-gap">
                <strong>AI geolocation unavailable:</strong> {visionError}
              </div>
            )}

            {visionResult && visionResult.candidates.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <ProvenanceBadge meta={visionResult.provenance} />
                  <span className="text-[11px] font-mono text-ink-3">
                    model: {visionResult.model}
                  </span>
                </div>
                {visionResult.candidates.map((candidate, idx) => (
                  <div
                    key={`${candidate.label}-${idx}`}
                    className="p-3 border border-line bg-well rounded space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="text-xs font-bold text-ink">
                          #{idx + 1} {candidate.label}
                        </span>
                        <span className="ml-2 text-[11px] font-mono tabular-nums text-ink-3">
                          {candidate.lat.toFixed(5)}, {candidate.lon.toFixed(5)}
                        </span>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-bold font-mono ${
                          candidate.confidencePercent >= 60
                            ? 'bg-live/10 text-live'
                            : candidate.confidencePercent >= 30
                            ? 'bg-gap/10 text-gap'
                            : 'bg-danger/10 text-danger'
                        }`}
                      >
                        {candidate.confidencePercent}% confidence
                      </span>
                    </div>
                    {candidate.reasoning && (
                      <p className="text-[11px] text-ink-2">
                        {candidate.reasoning}
                      </p>
                    )}
                    {candidate.landmarks.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {candidate.landmarks.map((lm) => (
                          <span
                            key={lm}
                            className="rounded border border-line bg-app px-1.5 py-0.5 font-mono text-[10px] text-ink-2"
                          >
                            {lm}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      <button
                        type="button"
                        onClick={() => handlePinVisionCandidate(candidate)}
                        className="px-2.5 py-1 text-[11px] font-semibold text-on-accent bg-accent hover:bg-accent-strong rounded-md transition-colors"
                      >
                        Pin on Map (then verify)
                      </button>
                      <a
                        href={streetViewLink(candidate.lat, candidate.lon)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1 text-[11px] font-medium border border-line bg-well hover:border-accent rounded-md transition-colors"
                      >
                        Street View ↗
                      </a>
                      <a
                        href={satelliteLink(candidate.lat, candidate.lon)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1 text-[11px] font-medium border border-line bg-well hover:border-accent rounded-md transition-colors"
                      >
                        Satellite ↗
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="pt-1 border-t border-line">
              <div className="text-[11px] font-semibold text-ink-2 pb-1">
                Human verification (zero-key reverse image search — upload the
                photo yourself):
              </div>
              <div className="flex flex-wrap gap-1.5">
                {REVERSE_IMAGE_SEARCH_LINKS.map((engine) => (
                  <a
                    key={engine.name}
                    href={engine.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={engine.note}
                    className="px-2.5 py-1 text-[11px] font-medium border border-line bg-well hover:border-accent rounded-md transition-colors"
                  >
                    {engine.name} ↗
                  </a>
                ))}
              </div>
            </div>

            {/* Automated zero-key matching against geolocated public photos */}
            <div className="pt-1 border-t border-line space-y-2">
              <div>
                <h3 className="text-xs font-bold text-ink flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-live" />
                  Automated matching — Wikimedia Commons geolocated photos
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold border border-live/35 bg-live/10 text-live">
                    ZERO-KEY · NO REDIRECT
                  </span>
                </h3>
                <p className="text-[11px] text-ink-3 mt-0.5">
                  Describe the scene (place + landmarks). The engine searches
                  Commons for geotagged photos of the same subject and ranks
                  them by perceptual similarity to your upload — a strong match
                  pins real coordinates without any external service.
                </p>
              </div>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={commonsTerms}
                  onChange={(e) => setCommonsTerms(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRunCommonsMatch();
                  }}
                  placeholder="e.g. ginkgo avenue Marunouchi Tokyo skyscrapers"
                  className="flex-1 px-3 py-2 text-xs font-mono border border-line bg-well rounded text-ink"
                />
                <button
                  type="button"
                  onClick={handleRunCommonsMatch}
                  disabled={!resolvedClue?.photoPreviewUrl || !commonsTerms.trim() || isCorroborating}
                  className="px-3 py-2 text-xs font-semibold text-on-accent bg-accent hover:bg-accent-strong disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
                >
                  {isCorroborating ? 'Matching…' : 'Match geolocated photos'}
                </button>
              </div>

              {commonsError && (
                <div className="p-3 border border-gap/40 bg-gap/10 rounded-lg text-xs text-gap">
                  <strong>Commons matching error:</strong> {commonsError}
                </div>
              )}

              {commonsResult && (
                <div className="space-y-2">
                  <div className="text-[11px] text-ink-3 font-mono">
                    {commonsResult.matches.length} of{' '}
                    {commonsResult.candidatesExamined} keyword matches carried GPS
                    metadata · query dHash {commonsResult.queryHash.slice(0, 8)}…
                  </div>
                  {commonsResult.matches.length === 0 ? (
                    <div className="p-3 border border-line bg-well rounded text-xs text-ink-3">
                      No geotagged Commons photos matched those terms. Refine the
                      keywords — e.g. add the district or landmark name.
                    </div>
                  ) : (
                    commonsResult.matches.slice(0, 6).map((match) => (
                      <div
                        key={match.photo.title}
                        className="p-3 border border-line bg-well rounded flex flex-col sm:flex-row gap-3 items-start"
                      >
                        <div className="flex gap-2 shrink-0">
                          {resolvedClue?.photoPreviewUrl && (
                            <img
                              src={resolvedClue.photoPreviewUrl}
                              alt="Uploaded query photo"
                              className="w-24 h-16 object-cover rounded border border-line-strong"
                            />
                          )}
                          <img
                            src={match.photo.thumbUrl}
                            alt={match.photo.title}
                            referrerPolicy="no-referrer"
                            className="w-24 h-16 object-cover rounded border border-line-strong"
                          />
                        </div>
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono ${
                                match.similarityPercent >= 70
                                  ? 'bg-live/10 text-live'
                                  : match.similarityPercent >= 55
                                  ? 'bg-gap/10 text-gap'
                                  : 'bg-well text-ink-3'
                              }`}
                            >
                              {match.similarityPercent}% visual match
                            </span>
                            <span className="text-[11px] font-mono tabular-nums text-ink-2">
                              {match.photo.lat.toFixed(5)}, {match.photo.lon.toFixed(5)}
                            </span>
                          </div>
                          <div className="text-[11px] text-ink-2 truncate">
                            {match.photo.title}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={() => handlePinCommonsMatch(match.photo)}
                              className="px-2.5 py-1 text-[11px] font-semibold text-on-accent bg-accent hover:bg-accent-strong rounded-md transition-colors"
                            >
                              Pin these coordinates
                            </button>
                            <a
                              href={match.photo.descriptionUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-2.5 py-1 text-[11px] font-medium border border-line bg-well hover:border-accent rounded-md transition-colors"
                            >
                              Commons page ↗
                            </a>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Step 2: Interactive Map (Left 7 cols) + Guided Verification Tools (Right 5 cols).
          On desktop both columns size to the viewport so the whole map is on
          screen without scrolling — the assistant column scrolls internally. */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left 7 Cols: Interactive Map */}
        <div className="lg:col-span-7 border border-line bg-panel rounded-md flex flex-col overflow-hidden lg:h-[clamp(300px,calc(100dvh-412px),760px)]">
          <div className="px-4 py-3 border-b border-line flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-ink truncate">
                <MapPin className="w-4 h-4 text-ink-3 shrink-0" />
                <span className="truncate">{geoState.locationLabel}</span>
              </div>
              <div className="text-[11px] font-mono tabular-nums text-ink-3">
                Lat: {geoState.lat.toFixed(5)}° · Lon: {geoState.lon.toFixed(5)}° ·
                Elevation:{' '}
                {geoState.weatherVerification?.elevationMeters != null
                  ? `${geoState.weatherVerification.elevationMeters}m`
                  : 'not verified'}
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <div className="flex items-center gap-1 p-0.5 rounded border border-line bg-app">
                {(['satellite', 'osm', 'topo'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setTileMode(mode)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      tileMode === mode
                        ? 'bg-well text-ink'
                        : 'text-ink-2 hover:text-ink'
                    }`}
                  >
                    {TILE_URLS[mode].label}
                  </button>
                ))}
              </div>

              <div className="relative" data-layers-root>
                <button
                  ref={layersBtnRef}
                  type="button"
                  onClick={() => setLayersOpen((v) => !v)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                    layersOpen
                      ? 'border-accent text-ink bg-well'
                      : 'border-line bg-app text-ink-2 hover:text-ink'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  Layers
                  {(showHeatmap || showAircraft || showCommonsPhotos || showRailways || showMarine) && (
                    <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
                  )}
                </button>

                {layersOpen && layersPos &&
                  createPortal(
                  <div
                    data-layers-root
                    className="fixed z-[1200] w-72 rounded-md border border-line bg-panel shadow-xl overflow-y-auto"
                    style={{ top: layersPos.top, left: layersPos.left, maxHeight: layersPos.maxH }}
                  >
                    <div className="px-3 pt-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-3">
                      Map layers — all free public data
                    </div>
                    {(
                      [
                        {
                          key: 'heatmap',
                          icon: <Flame className="w-3.5 h-3.5" />,
                          label: 'Infrastructure heatmap',
                          desc:
                            geoState.landmarks.length > 0
                              ? `Density of the ${geoState.landmarks.length} scanned landmarks`
                              : 'Scan landmarks first — heat comes from the pin scan',
                          value: showHeatmap,
                          set: setShowHeatmap,
                        },
                        {
                          key: 'aircraft',
                          icon: <Plane className="w-3.5 h-3.5" />,
                          label:
                            aircraftCount != null
                              ? `Live aircraft (${aircraftCount})`
                              : 'Live aircraft',
                          desc: 'adsb.lol feed within 30 km, refreshes ~15 s',
                          value: showAircraft,
                          set: setShowAircraft,
                        },
                        {
                          key: 'commons',
                          icon: <ImageIcon className="w-3.5 h-3.5" />,
                          label:
                            commonsPhotos.length > 0
                              ? `Commons photos (${commonsPhotos.length})`
                              : 'Commons photos',
                          desc: 'Geotagged Wikimedia photos within 2 km',
                          value: showCommonsPhotos,
                          set: setShowCommonsPhotos,
                        },
                        {
                          key: 'railways',
                          icon: <TrainFront className="w-3.5 h-3.5" />,
                          label: 'Railway network',
                          desc: 'OpenRailwayMap overlay (rail-side verification)',
                          value: showRailways,
                          set: setShowRailways,
                        },
                        {
                          key: 'marine',
                          icon: <Anchor className="w-3.5 h-3.5" />,
                          label: 'Marine marks',
                          desc: 'OpenSeaMap overlay (buoys, lights, harbors)',
                          value: showMarine,
                          set: setShowMarine,
                        },
                      ] as const
                    ).map((row) => (
                      <label
                        key={row.key}
                        className="flex items-start gap-2.5 px-3 py-2 hover:bg-well cursor-pointer border-t border-line first:border-t-0"
                      >
                        <input
                          type="checkbox"
                          checked={row.value}
                          onChange={(e) => row.set(e.target.checked)}
                          className="mt-0.5 accent-[var(--color-accent,#f0954f)]"
                        />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5 text-xs font-medium text-ink">
                            <span className="text-ink-3">{row.icon}</span>
                            {row.label}
                          </span>
                          <span className="mt-0.5 block text-[11px] leading-4 text-ink-3">
                            {row.desc}
                          </span>
                        </span>
                      </label>
                    ))}
                    <div className="border-t border-line px-3 py-2 text-[10px] leading-4 text-ink-3">
                      No traffic layer: every traffic tile source is paid-API —
                      info9 doesn't fake one.
                    </div>
                  </div>,
                  document.body
                )}
              </div>
            </div>
          </div>

          <div className="relative flex-1 min-h-[200px]">
            <div
              ref={mapContainerRef}
              data-testid="osint-leaflet-map"
              className="w-full h-full min-h-[200px] z-0"
            />
          </div>

          <div className="px-4 py-2.5 border-t border-line bg-well flex items-center justify-between text-xs text-ink-3">
            <span>Tip: Click anywhere on the map to move the pin and look up the address</span>
            <span className="font-mono tabular-nums">
              {geoState.landmarks.length} nearby pins
            </span>
          </div>
        </div>

        {/* Right 5 Cols: Clean 2-Tab Verification Assistant */}
        <div className="lg:col-span-5 border border-line bg-panel rounded-md p-5 flex flex-col justify-between lg:h-[clamp(300px,calc(100dvh-412px),760px)] lg:overflow-y-auto">
          <div className="space-y-4">
            {/* Segmented Tab Switcher */}
            <div className="flex items-center gap-1 p-0.5 rounded border border-line bg-app">
              <button
                type="button"
                onClick={() => setActiveTab('landmarks')}
                className={`flex-1 py-1.5 px-3 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === 'landmarks'
                    ? 'bg-well text-ink'
                    : 'text-ink-2 hover:text-ink'
                }`}
              >
                Nearby landmarks
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('sun_shadow')}
                className={`flex-1 py-1.5 px-3 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === 'sun_shadow'
                    ? 'bg-well text-ink'
                    : 'text-ink-2 hover:text-ink'
                }`}
              >
                Sun &amp; shadow time
              </button>
            </div>

            {activeTab === 'landmarks' ? (
              <div className="space-y-4">
                <div>
                  <h2 className="text-sm font-bold text-ink">
                    Find matching landmarks around this pin
                  </h2>
                  <p className="mt-1 text-xs text-ink-3">
                    Scan OpenStreetMap within 2.5 km of the map pin to locate
                    power towers, railway crossings, storage tanks, or antennas
                    visible in your photo.
                  </p>
                </div>

                {/* Optional 2-Clue Filter */}
                <div className="p-3.5 border border-line bg-well rounded space-y-3">
                  <div>
                    <label
                      htmlFor="primary-landmark-select"
                      className="block text-[11px] font-medium text-ink-2 mb-1"
                    >
                      Primary background clue (optional filter)
                    </label>
                    <select
                      id="primary-landmark-select"
                      value={primaryFeatureIdx}
                      onChange={(e) =>
                        setPrimaryFeatureIdx(parseInt(e.target.value, 10))
                      }
                      className="w-full px-2.5 py-1.5 text-xs border border-line bg-panel rounded text-ink"
                    >
                      {LANDMARK_CLUE_TYPES.map((item, idx) => (
                        <option key={item.featureType} value={idx}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="secondary-landmark-select"
                      className="block text-[11px] font-medium text-ink-2 mb-1"
                    >
                      Near a second clue? (optional intersection)
                    </label>
                    <select
                      id="secondary-landmark-select"
                      value={secondaryFeatureIdx}
                      onChange={(e) =>
                        setSecondaryFeatureIdx(parseInt(e.target.value, 10))
                      }
                      className="w-full px-2.5 py-1.5 text-xs border border-line bg-panel rounded text-ink"
                    >
                      <option value={-1}>Any — scan all nearby landmarks</option>
                      {LANDMARK_CLUE_TYPES.map((item, idx) => (
                        <option key={item.featureType} value={idx}>
                          Must be near: {item.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={handleScanNearbyLandmarks}
                    disabled={isQueryingOverpass}
                    className="w-full flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-on-accent bg-accent hover:bg-accent-strong rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    <Radar className="w-3.5 h-3.5" />
                    <span>
                      {isQueryingOverpass
                        ? 'Scanning OpenStreetMap…'
                        : 'Scan nearby landmarks (2.5 km)'}
                    </span>
                  </button>
                </div>

                {/* Discovered landmarks List */}
                <div>
                  <div className="flex items-center justify-between text-xs font-semibold text-ink-2 mb-2">
                    <span>Discovered landmarks</span>
                    <span className="font-mono tabular-nums text-ink-3">
                      {geoState.landmarks.length} found
                    </span>
                  </div>

                  {geoState.landmarks.length === 0 ? (
                    <div className="p-4 text-center border border-line bg-well rounded text-xs text-ink-3">
                      Click <strong>&ldquo;Scan nearby landmarks&rdquo;</strong>{' '}
                      above to list notable structures around the current map pin.
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                      {geoState.landmarks.map((lm) => (
                        <button
                          key={lm.id}
                          type="button"
                          onClick={() =>
                            onUpdateGeoState((prev) => ({
                              ...prev,
                              lat: lm.lat,
                              lon: lm.lon,
                              locationLabel: lm.name,
                            }))
                          }
                          className="w-full p-2.5 text-left border border-line bg-well hover:border-accent rounded-lg transition-colors flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-ink truncate">
                              {lm.name}
                            </div>
                            <div className="text-[11px] text-ink-3 font-mono">
                              {lm.category.replace(/_/g, ' ')} · {lm.lat.toFixed(4)},{' '}
                              {lm.lon.toFixed(4)}
                            </div>
                          </div>
                          <span className="text-xs font-mono tabular-nums font-semibold text-ink-2 shrink-0">
                            {lm.distanceMeters}m
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Tab 2: Sun, Shadow & Weather Calculator */
              <div className="space-y-4">
                <div>
                  <h2 className="text-sm font-bold text-ink">
                    Estimate photo capture time from shadows
                  </h2>
                  <p className="mt-1 text-xs text-ink-3">
                    Enter the date and approximate height/shadow length of an
                    object in the photo to find when the sun was at that angle.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="chrono-date"
                      className="block text-[11px] font-medium text-ink-2 mb-1"
                    >
                      Photo date
                    </label>
                    <input
                      id="chrono-date"
                      type="date"
                      value={geoState.dateIso}
                      onChange={(e) =>
                        onUpdateGeoState((prev) => ({
                          ...prev,
                          dateIso: e.target.value,
                        }))
                      }
                      className="w-full px-2.5 py-1.5 text-xs font-mono border border-line bg-well rounded text-ink"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="chrono-azimuth"
                      className="block text-[11px] font-medium text-ink-2 mb-1"
                    >
                      Shadow direction ({geoState.measuredShadowAzimuthDeg}°)
                    </label>
                    <input
                      id="chrono-azimuth"
                      type="range"
                      min={0}
                      max={359}
                      step={1}
                      value={geoState.measuredShadowAzimuthDeg}
                      onChange={(e) =>
                        onUpdateGeoState((prev) => ({
                          ...prev,
                          measuredShadowAzimuthDeg: parseFloat(e.target.value),
                        }))
                      }
                      className="w-full accent-accent mt-1.5"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="chrono-height"
                      className="block text-[11px] font-medium text-ink-2 mb-1"
                    >
                      Object Height ({geoState.objectHeightMeters} m)
                    </label>
                    <input
                      id="chrono-height"
                      type="number"
                      min={0.5}
                      max={500}
                      step={0.5}
                      value={geoState.objectHeightMeters}
                      onChange={(e) =>
                        onUpdateGeoState((prev) => ({
                          ...prev,
                          objectHeightMeters: Math.max(
                            0.5,
                            parseFloat(e.target.value) || 1
                          ),
                        }))
                      }
                      className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums border border-line bg-well rounded text-ink"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="chrono-shadow"
                      className="block text-[11px] font-medium text-ink-2 mb-1"
                    >
                      Shadow Length ({geoState.shadowLengthMeters} m)
                    </label>
                    <input
                      id="chrono-shadow"
                      type="number"
                      min={0.1}
                      max={1000}
                      step={0.2}
                      value={geoState.shadowLengthMeters}
                      onChange={(e) =>
                        onUpdateGeoState((prev) => ({
                          ...prev,
                          shadowLengthMeters: Math.max(
                            0.1,
                            parseFloat(e.target.value) || 1
                          ),
                        }))
                      }
                      className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums border border-line bg-well rounded text-ink"
                    />
                  </div>
                </div>

                {/* Estimated Time Windows */}
                <div className="p-3 border border-line bg-well rounded space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-ink-2">
                      Estimated Capture Time
                    </span>
                    <span className="font-mono tabular-nums text-ink-2">
                      Sun Angle: {shadowMetrics.elevationDeg}°
                    </span>
                  </div>

                  {chronoSolution.bestMatches.length === 0 ? (
                    <div className="text-xs text-gap">
                      No exact sun match for this shadow angle on {geoState.dateIso}.
                      Try adjusting the shadow direction slider above.
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {chronoSolution.bestMatches.slice(0, 2).map((match) => (
                        <button
                          key={match.utcTimeFormatted}
                          type="button"
                          onClick={() => setSelectedUtcHour(match.utcHoursDecimal)}
                          className="w-full p-2 border border-line bg-well rounded flex items-center justify-between text-xs font-mono tabular-nums"
                        >
                          <div>
                            <span className="font-bold text-ink-2">
                              {match.utcTimeFormatted}
                            </span>
                            <span className="mx-1.5 text-ink-3">·</span>
                            <span>{match.localSolarTimeFormatted}</span>
                          </div>
                          <span className="text-live font-bold">
                            {match.confidencePercent}% Match
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Historical Weather Verification */}
                <div className="p-3 border border-line bg-well rounded flex items-center justify-between gap-2">
                  <div className="text-xs min-w-0">
                    <div className="font-semibold text-ink">
                      Weather on {geoState.dateIso}
                    </div>
                    {geoState.weatherVerification ? (
                      <div className="text-[11px] text-ink-3 font-mono tabular-nums">
                        Temp: {geoState.weatherVerification.minTempC}°C –{' '}
                        {geoState.weatherVerification.maxTempC}°C · Cloud Cover:{' '}
                        {geoState.weatherVerification.cloudCoverMeanPercent}%
                      </div>
                    ) : (
                      <div className="text-[11px] text-gap">
                        No data recorded — run a live check (info9 shows gaps, not
                        guesses)
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleVerifyWeather}
                    disabled={isQueryingWeather}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border border-line bg-well hover:border-accent rounded-md transition-colors whitespace-nowrap shrink-0"
                  >
                    <CloudSun className="w-3.5 h-3.5 text-gap" />
                    <span>
                      {isQueryingWeather ? 'Checking...' : 'Check Weather'}
                    </span>
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="pt-4 mt-4 border-t border-line text-xs text-ink-3 flex items-center justify-between">
            <span>Sources: OpenStreetMap · Nominatim · IPWhois · Open-Meteo</span>
          </div>
        </div>
      </div>
    </div>
  );
};
