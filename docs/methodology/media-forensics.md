# Methodology: Media Forensics

Module: **04 Photo Forensics** · Code: `src/components/MediaForensicsModule.tsx`, `src/utils/osintForensics.ts` · Tests: `src/utils/osintCore.test.ts`

## What runs, and where

All signal processing executes **in the browser** on a forensic canvas (typically 640×360 working resolution) using typed arrays — no image bytes leave the machine.

## Techniques

1. **Error Level Analysis (ELA)** — the image is re-saved at a fixed JPEG quality; the per-pixel difference between original and re-save is amplified into a heatmap. Regions edited and re-saved at a different quality level light up. Caveat: every image has natural ELA gradients (edges, high-detail areas); ELA is a *pointer*, not proof.
2. **Copy-move clone detection** — the frame is tiled, each block's DCT descriptor is compared against neighbours, and matched pairs with consistent displacement are drawn as clone vectors. Catches pasted-in regions copied from within the same image.
3. **Noise variance map** — local variance of the luminance channel; sensor/processing noise should be spatially uniform, so smooth or inconsistent patches warrant inspection.
4. **JPEG ghost sweep** — the image is re-compressed across a quality ladder; regions whose error curve dips at a different quality than the majority were compressed twice — a re-save fingerprint.
5. **8× pixel loupe + live RGB histogram** — plain magnification and channel statistics for manual inspection.
6. **EXIF integrity review** — `parseUploadedBinaryMetadata` walks the APP1 segment: camera make/model, capture date, editing-software tags, GPS presence. `STRIPPED`/`MISMATCH` statuses are rendered as badges, never silently merged.

## Evidence discipline

- The built-in demo sample is **explicitly synthetic** (labelled in the UI and the dossier).
- Uploaded EXIF is parsed locally; nothing is uploaded anywhere.
- A forensic indicator is a reason to *look closer*, not a conclusion. Save conclusions (not indicators) to the evidence ledger.

## References

- Forensically (29a.ch) — the ELA/loupe interaction model — https://29a.ch/photo-forensics/
- Guo et al., copy-move forgery detection via DCT blocks — https://ieeexplore.ieee.org/document/6313709
- Bellingcat verification handbook (media chapter) — https://www.bellingcat.com/resources/how-tos/
- ExifTool tag reference — https://exiftool.org/TagNames/
