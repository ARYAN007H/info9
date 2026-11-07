# Methodology: Acoustic Doppler Geolocation (experimental)

Code: `src/utils/doppler.ts`, `src/utils/fft.ts` · Tests: `src/utils/doppler.test.ts`, `src/utils/fft.test.ts`
Status: **engine complete, UI pending** — the math is shipped and tested; the analyst-facing module is in progress.

## The technique (and where it comes from)

Demonstrated publicly by the YouTuber **Colsto** ("I discovered a sound that leaks your exact location", Nov 2026): barely-audible aircraft in a video's soundtrack leave **Doppler curves** — frequency-vs-time sweeps — on the spectrogram. Matched against public flight-tracking data, the curves of several aircraft triangulate the recording position to roughly **100 m** from ~60 seconds of audio. Prior art: Doppler-based positioning is the same principle COSPAS-SARSAT uses to locate distress beacons from satellite passes.

## The math

1. **Measured curve** — an STFT (radix-2 FFT, Hann window) tracks the dominant peak inside an analyst-selected frequency band, with parabolic interpolation for sub-bin accuracy → `f_meas(t)`.
2. **Predicted curve** — for an aircraft track (from ADS-B) and a *candidate recorder position*, the range-rate `v_r(t) = d(range)/dt` gives `f_pred(t) = f0 · c / (c + v_r(t))`, `c = 331.3·√(1+T/273.15)`.
3. **The fit** — grid search over candidate positions on a shared lattice; for each candidate the tone's base frequency `f0` has a **closed-form least-squares solution** (the model is linear in `f0`); timeline offset between the recording and the flight track is searched in parallel; RMS residual per candidate. Two-stage coarse→refine.
4. **Multi-aircraft joint fit** — each aircraft's RMS field is normalized by its own best cost, then summed on the shared grid. Different flight headings collapse the ambiguity. This is the honest default.

## The fundamental ambiguity (disclosed, not hidden)

A single straight-line pass constrains **distance to the flight track**, not which side you're on — the curve is symmetric about the track. A single-aircraft fit is therefore **two-sided** and must never be presented as unique (the test suite asserts the fit lands on the truth *or its mirror*). Only aircraft on different headings collapse the ambiguity; the joint fit test recovers the true position to **~200 m** from noisy synthetic curves (1 Hz noise, two crossing aircraft at 3 km altitude).

## Honest requirements & limitations

- **The aircraft track must cover the recording window.** Public snapshot APIs (adsb.lol, OpenSky anonymous) only give *current* positions — for a past recording you need historical track data: OpenSky's free account APIs, a tar1090/adsb.fi dump, or a provider CSV export. info9's pipeline is **import-first** so any provider works, zero keys.
- The tone must be a quasi-stable harmonic (propeller/buzzer whine, turbine whine); pure broadband jet roar has no clean curve. Band selection is manual by design.
- Wind, temperature errors, and non-straight flight segments all inflate the RMS — which is why RMS is always reported, never hidden.
- Requires aircraft overhead: quiet skies → no constraint (Colsto's own caveat).

## Privacy note

This is dual-use by nature: it locates the *recorder*. The same math protects you — if you publish video with ambient audio, faint aircraft tones leak your position even after stripping EXIF. Muting or replacing ambient audio is the only reliable countermeasure (high-pass filters don't remove the curve's shape).

## References

- Colsto, "I discovered a sound that leaks your exact location (and it's everywhere)" (Nov 2026) — https://youtu.be/UytYrhYLOKI
- TechRadar coverage of the technique — https://www.techradar.com/computing/cyber-security/youtuber-discovers-aircraft-noise-trick-that-can-geolocate-your-videos-to-within-100m-doppler-effect-pinpoints-locations-from-just-60-seconds-of-audio
- adsb.lol free API — https://api.adsb.lol/
- OpenSky Network — https://opensky-network.org/
- COSPAS-SARSAT Doppler processing — https://cospas-sarsat.int/
