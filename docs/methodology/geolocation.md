# Methodology: Geolocation & Chronolocation

Module: **01 Geolocate** · Code: `src/utils/solarMath.ts`, `src/services/osintApis.ts` · Tests: `src/utils/osintCore.test.ts`

## What this module does

1. **Forward geocoding** of any clue (place name, phone area code, IP, coordinates) via OpenStreetMap Nominatim.
2. **Spatial intersection solving**: find coordinates where up to two infrastructure clue types co-occur within chosen radii (e.g. *substation ∩ railway crossing*).
3. **Chronolocation**: infer the time of day a photo was taken from shadow geometry.
4. **Weather plausibility check**: verify the claimed date against historical cloud cover and temperature.
5. **Terrain horizon profiling** from a DEM sampled on 8 compass radials.

## Shadow chronolocation (the math)

Given a vertical object of height `H` casting a shadow of length `L`:

- Solar elevation: `α = arctan(H / L)` (`calculateShadowElevation`).
- Solar position: NOAA's closed-form solar equations (`calculateSolarPosition`) compute declination, the equation of time, and the hour angle for a given latitude/longitude/UTC instant — the same approximation used by NOAA's Solar Calculator.
- The module inverts this: it sweeps the day and returns UTC time windows where the predicted azimuth matches the *measured* shadow azimuth (`solveChronolocationTimeWindow`), plus a **blind solver** that proposes latitude bands from solar angles alone (`solveBlindSolarCoordinates`).

**Provenance rule:** the predicted window is DERIVED (computed from your measurements). The measurements themselves are the analyst's responsibility — bad height/azimuth inputs produce confident nonsense, which is why the UI shows the full diurnal curve rather than a single "answer".

## Multi-clause spatial intersection

The Overpass QL compiler emits one query per constraint (`buildOverpassIntersectionQuery`), e.g.:

```
node["power"="substation"](around:3000,LAT,LON);
node["railway"="level_crossing"](around:500,LAT,LON);
```

Results are cross-filtered by pair distance so only co-occurring candidates survive. This is the classic Bellingcat "find the place where the two background features meet" technique, automated against live OpenStreetMap data.

## Weather verification

Open-Meteo's ERA5 archive provides the day's hourly cloud cover, min/max temperature and precipitation for the pinned coordinates. Shadow sharpness requires direct sunlight, so mean cloud cover > 78% flags the photo as implausible for that date/location (`OVERCAST_ANOMALY`).

**Provenance rule:** weather data is LIVE only when the archive returns it. There is no offline fallback — a failed lookup renders as an explicit gap.

## Limitations (read before publishing)

- Shadow azimuth measurement on low-res images is the #1 error source; ±5° can move the time window by ~20 minutes.
- ERA5 gridding smooths microclimates; a "clear" grid cell can still be locally overcast.
- Nominatim is autocompletion, not truth — always eyeball the map.

## References

- NOAA Solar Calculator — https://gml.noaa.gov/grad/solcalc/calcdetails.html
- Bellingcat geolocation guides — https://www.bellingcat.com/category/resources/how-tos/
- Overpass API — https://wiki.openstreetmap.org/wiki/Overpass_API
- Open-Meteo ERA5 archive — https://open-meteo.com/en/docs/historical-weather-api
