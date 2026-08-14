# Cogniscient required features

This file is the source of truth for what the app must do. Changes to
behaviour should update this file in the same commit. No drift!

## Core workflow

1. **Search**: query the Earth Search STAC API
   (https://earth-search.aws.element84.com/v1, collection sentinel-2-l2a)
   for the current map view, with a date range (default: last 30 days) and
   a max cloud cover filter (default: 50%). Searching requires a minimum
   zoom level (8) to avoid huge result sets.
2. **Draw a box**: the user draws a rectangle on the map to define the
   export area. A stray click (zero-size box) cancels instead of drawing.
3. **Pick a day**: results are grouped by acquisition day. Each day shows:
   - mean cloud cover (%) across that day's scenes (whole-footprint value)
   - coverage (%): how much of the drawn box is covered by the union of
     that day's footprints
   - a dropdown toggle showing the scene count; expanding it lists each
     contributing STAC item (id + its own cloud cover %), preserving list
     scroll position across the toggle. Hovering an item row highlights just
     that item's footprint on the map (white outline, drawn above the
     selected-day highlight); clicking opens the item's canonical STAC JSON
     (its `self` link) in a new tab.
4. **Preview**: a mosaicked RGB preview streams from the COGs and is shown
   as an image overlay on the map, georeferenced inside the drawn box.
5. **Tune the look**: vmin / vmax / gamma sliders (defaults 0 / 3000 / 1.0,
   never auto-overridden). Repaints reuse the cached pixel data; no refetch.
6. **Bands**: user-selectable R/G/B band assignment from all 12 Sentinel-2
   L2A bands (default red/green/blue). Changing bands refetches.
7. **Download**: export the preview as PNG or JPG from cached data (no
   refetch), cropped to valid data, named
   `cogniscient-<day>-<width>px-<place>.<ext>` where `<place>` is a
   reverse-geocoded name (OSM Nominatim, city/region level) for the
   centre of the drawn box. Geocoding failures are silent: the name is
   simply omitted.

## Data handling rules

- **Multi-COG same-day mosaic**: all scenes from the selected day that
  intersect the box are merged. On overlap, keep the brighter pixel
  (larger r+g+b) to heal resampled nodata seams at scene edges.
- **Use overviews**: read at a reasonable output resolution (target width
  default 1000 px, user adjustable), never full native resolution of a
  large area by default.
- **Range reads only**: compute pixel windows from the COG geotransform;
  never fetch whole files.
- **Size warning**: before fetching, show an estimated download size
  ("fetches ~X MB" - raw fetch traffic, not output file size) with a
  soft-warning tier, and a hard limit of 10,000 km² for the drawn box.
- **Cache keying**: the scene cache key includes day, bbox, target width,
  bands, and the contributing item IDs, so any change that alters the
  mosaic (including cloud-filter changes) triggers a refetch.
- If the selected day disappears from new search results, clear the
  selection and preview.

## Map

- MapLibre GL with the MapTiler dataviz-dark basemap (key is committed;
  it is a public, origin-locked client key), falling back to OSM raster
  on style error (e.g. local dev where the key is rejected).
- Default view: whole world (center [0, 20], zoom 1).
- STAC footprints always drawn (logo blue #3474c7); when a box is drawn
  and a day is selected, only that day's footprints show, highlighted in
  gold (#fbc27b). Drawn box is white.
- The maplibre worker must be bundled self-contained
  (`?worker&url` import + `setWorkerUrl`) or GeoJSON layers silently
  break in production.

## UI

- Sidebar panels in order: Search, Area, Days, Bands, Look, Export,
  Status. No sidebar preview image (map overlay only).
- Panels use a paint-key render guard so progress updates never rebuild
  DOM mid-interaction (sliders, dropdowns).
- Auspatious brand theme: Space Grotesk headings (uppercase, wide
  tracking), Inclusive Sans body, ausblue #194bfd accent, gold #fbc27b
  secondary, #232323 dark panels, rounded corners, Auspatious favicon.
- Header: app name "Cogniscient", tagline, "Built with ❤️ by Auspatious"
  link, and a link to GitHub issues.

## Architecture and deployment

- 100% client-side, no backend. Vite build, plain JS, small modules:
  store (state.js) + controller (main.js) + panels (src/ui/).
- Unit tests (vitest, `npm test`) cover the pure logic modules: mosaic
  grouping/coverage, output-size geometry, size estimates, geocode slugify,
  and UTM reprojection. GitHub Actions runs tests + build on every push/PR.
- Unexpected runtime errors (uncaught exceptions, unhandled promise
  rejections) are surfaced in the Status panel via `log.err`, not just the
  console.
- Deployed as Cloudflare Workers static assets (worker name
  `image-exporter`, do not rename - the cogniscient.auspatious.com route
  depends on it). Deploy: `npm run build && npx wrangler deploy`.
- Live at https://cogniscient.auspatious.com/.
- Apache 2.0 licensed; credits to Auspatious, Element 84 / Earth Search,
  Copernicus Sentinel-2 on AWS Open Data, DEA notebook, MapTiler / OSM.
