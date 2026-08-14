# Image Exporter

This is a pure client-side web tool, which uses cloud native geospatial
technologies to create a very pretty picture from Earth observation data.

## Requirements

- [ ] Uses Maplibre as a base
- [ ] Uses the map extent, when zoomed in close, to highlight data footprints from a STAC API query
- [ ] Start with Earth Search at the URL `https://earth-search.aws.element84.com/v1/` and the Sentinel-2 collection `sentinel-2-c1-l2a` — **shipped with `sentinel-2-l2a` as the default instead; see the CORS note below.**
- [ ] UI should have a date range picker, plus other filters if useful
- [ ] Base the functionality on this notebook: https://github.com/GeoscienceAustralia/dea-notebooks/blob/rbt/Interactive_apps/Exporting_satellite_images.ipynb and code: https://github.com/GeoscienceAustralia/dea-notebooks/blob/rbt/Tools/dea_tools/app/imageexport.py
- [ ] Everything should be javascript, or web assembly
- [ ] Build a super simple local dev/test environment
- [ ] Deep dive in the tech, write very little new code, just integrate existing work.
- [ ] When several STAC items from the same acquisition day cover the drawn area, load their COGs and **merge (mosaic) them into a single image** before export.
- [ ] Export is always driven by a **user-drawn rectangle** on the map (not the map viewport).
- [ ] **Warn the user before large downloads** — estimate the pixel count / MB that will be fetched from the drawn area at the chosen resolution, and require confirmation past a sensible threshold.
- [ ] Use the **COG overview levels** (built-in pyramids) to fetch data at a reasonable resolution: pick the overview whose native pixel size is closest to (but not finer than) the target output pixel size, so we don't waste bandwidth pulling full-resolution tiles for a small preview.

## Getting started

Prerequisites: Node 20+ (`.nvmrc` provided).

```bash
npm ci        # install dependencies
npm run dev   # start Vite dev server on http://127.0.0.1:5173
npm run build # produce a static bundle in dist/
npm run preview
```

The app is pure client-side: `dist/` can be hosted on any static file host,
including S3, Cloudflare Pages, GitHub Pages or a plain nginx.

## How it works

The app is glue code around a handful of well-known JavaScript libraries.
Everything runs in the browser; there is no backend.

| Piece | Library | What we use it for |
|---|---|---|
| Map | [maplibre-gl](https://maplibre.org/) | Basemap, navigation, footprint layer, drawn-box display, final overlay of the exported image. |
| STAC search | plain `fetch` to [Earth Search v1](https://earth-search.aws.element84.com/v1/) | Returns Sentinel-2 items with `red`/`green`/`blue` COG hrefs. |
| Read COGs | [geotiff.js](https://geotiffjs.github.io/) | Windowed `readRasters` reads only the bytes we need for the drawn box, at a resolution matching the target output size — geotiff.js automatically picks the smallest COG overview large enough. |
| Reprojection | [proj4](http://proj4js.org/) | Convert the WGS84 drawn bbox to each item's native UTM zone before reading. |
| Geometry helpers | [`@turf/turf`](https://turfjs.org/) | Area, intersection, bbox polygon, WGS84 distances for GSD/pixel-size maths. |

Pipeline for the export step:

1. **Group by day.** All items intersecting the drawn box are grouped by
   solar day. Selecting a day tells the app "mosaic every item from this
   acquisition into one image".
2. **Reproject bbox per item.** Sentinel-2 tiles straddle UTM zones, so the
   drawn bbox is reprojected to *each* contributing item's native CRS.
3. **Windowed COG read.** For each item and each of the three RGB assets,
   `image.readRasters({ bbox, width, height, resampleMethod: 'bilinear' })`
   fetches only the byte ranges needed. geotiff.js picks the smallest
   overview that satisfies the requested pixel size — no bandwidth wasted
   on a preview.
4. **Mosaic.** Per-item arrays are merged pixel-wise, first-valid wins
   (Sentinel-2 nodata = 0), yielding a single seamless RGB canvas.
5. **Stretch, gamma, unsharp.** vmin/vmax stretch → power (gamma) → optional
   two-pass box-blur unsharp mask.
6. **Preview + download.** The result is drawn to an `OffscreenCanvas`,
   overlaid on the map as a MapLibre image source, and downloaded as PNG
   or JPG.

### Download-size safety net

Before the export runs, the app estimates the number of bytes it will fetch
using `width × height × 3 bands × 2 bytes/sample × item count × 1.3` and
categorises the result:

| Tier | Range | Behaviour |
|---|---|---|
| small | < 25 MB | Runs immediately. |
| medium | 25–150 MB | Runs after a confirmation dialog. |
| large | > 150 MB | Runs after a confirmation dialog with a warning. |
| too large | > 8000 × 8000 px | Warns that the browser canvas may reject the image. |

The drawn area itself is capped at 10 000 km² to match the DEA reference
app's hard limit.

### A note on preview vs. export

We initially planned to overlay the source COGs directly with
[`@geomatico/maplibre-cog-protocol`](https://github.com/geomatico/maplibre-cog-protocol),
but that library requires COGs to be in EPSG:3857 while Sentinel-2 assets are
in per-tile UTM zones. Rather than reprojecting server-side (which would
break the "pure client-side" requirement), the app composites the RGB
in-browser and shows the result as an `image` source overlay on the map.
The composited image *is* the export — the preview and download go through
the same pipeline (only the target size differs).

### A note on collection choice (CORS)

The requirements pointed at `sentinel-2-c1-l2a` on Earth Search v1. That
collection's data lives in
`e84-earth-search-sentinel-data.s3.us-west-2.amazonaws.com`, which currently
returns no `Access-Control-Allow-Origin` header — so browser range requests
to the COG bytes are blocked by CORS. The app ships with `sentinel-2-l2a`
selected by default, which serves the **same** Sentinel-2 L2A imagery from
`sentinel-cogs.s3.us-west-2.amazonaws.com` — the older bucket that has
`Access-Control-Allow-Origin: *` set. The dropdown still exposes
`sentinel-2-c1-l2a` for the day Element84 enables CORS on the new bucket.

### Auto-stretch

Different scenes have wildly different reflectance distributions
(exposure, snow, water, clouds…), so hard-coded vmin/vmax rarely look
good everywhere. When a fresh set of COGs is fetched, the app computes
the 2nd and 98th percentile of the R/G/B pixels and drops those into the
vmin/vmax sliders. From there, the user can drag the sliders to
fine-tune — and every subsequent drag re-tones the cached pixels
instantly (no re-download).

