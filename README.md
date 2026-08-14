# Image Exporter

**Live at [cogniscient.auspatious.com](https://cogniscient.auspatious.com/)**

A pure client-side web app for making pretty pictures from Earth observation
data. Search Sentinel-2 imagery, draw a box on the map, pick an acquisition
day, tune the look, and download a PNG or JPG — all in the browser, no
backend, no sign-up.

## Using it

1. **Zoom in** to your area of interest — scene footprints appear as you pan
   and zoom. Adjust the date range and max cloud cover in the Search panel.
2. **Draw a rectangle** over the area you want to export. A size slider sets
   the output resolution, up to the data's native 10 m/px, with an estimate
   of how much data will be fetched.
3. **Pick a day** from the list. Each day shows mean cloud cover, how much of
   your box it covers, and whether it's a mosaic of several scenes. Same-day
   scenes are merged seamlessly into one image.
4. **Choose bands** (optional). Any Sentinel-2 band can go into the R, G, and
   B channels — try NIR/Red/Green for false-colour vegetation.
5. **Tune the look.** vmin/vmax/gamma sliders re-tone the cached pixels
   instantly — nothing is re-downloaded.
6. **Download.** Saves exactly what you see, cropped to the valid data area,
   as PNG or JPG.

## How it works

Everything runs in the browser. The app is glue code around a handful of
excellent open-source libraries:

| Piece | Library | Used for |
|---|---|---|
| Map | [maplibre-gl](https://maplibre.org/) | Basemap, footprints, box drawing, preview overlay |
| STAC search | plain `fetch` to [Earth Search v1](https://earth-search.aws.element84.com/v1/) | Finding Sentinel-2 scenes and their COG URLs |
| COG reads | [geotiff.js](https://geotiffjs.github.io/) | Windowed range-reads of just the bytes covering the drawn box |
| Reprojection | [proj4](http://proj4js.org/) | WGS84 box → each scene's native UTM zone |
| Geometry | [@turf/turf](https://turfjs.org/) | Areas, intersections, coverage percentages |
| Date picker | [flatpickr](https://flatpickr.js.org/) | Date-range selection |

The export pipeline: scenes intersecting the box are grouped by solar day;
the drawn box is reprojected to each scene's UTM zone; geotiff.js reads only
the intersecting pixel window of each RGB COG (using internal overviews, so
previews are fast); windows are placed at their true geographic offsets and
merged into one mosaic (brighter pixel wins in overlaps, which heals
resampling artefacts at scene seams); a vmin/vmax/gamma stretch renders the
result to canvas. The preview overlay and the downloaded file are the same
pixels — downloading never re-fetches.

## Local development

Requires Node 20+ (`.nvmrc` provided).

```bash
npm ci        # install dependencies
npm run dev   # dev server at http://127.0.0.1:5173
npm run build # static bundle in dist/
npm run preview
```

Notes:

- The MapTiler basemap key is origin-restricted, so local dev automatically
  falls back to OpenStreetMap tiles. To get the clean basemap locally, add
  your own origins to a MapTiler key in `src/map.js`.
- `dist/` is fully static and can be hosted anywhere. This deployment uses
  Cloudflare Workers static assets: `npx wrangler deploy` (see
  `wrangler.jsonc`).

### Code layout

```
src/
  main.js            controller: search, draw, day selection, preview, download
  export.js          COG windowed reads, mosaic compositing, stretch/render
  stac.js            Earth Search POST /search client
  mosaic.js          group scenes by day, cloud/coverage stats
  overviews.js       box size / output pixel geometry helpers
  size-estimate.js   fetch-size estimate and warning tiers
  map.js             MapLibre setup and basemap
  footprint-layer.js scene footprint + selection layers
  rectangle-draw.js  click-drag box drawing
  state.js           tiny reactive store
  ui/                one small render function per sidebar panel
```

Contributions welcome — keep it simple, keep it client-side.

## Credits

- Imagery search and cloud-optimised GeoTIFFs served by
  [Earth Search](https://earth-search.aws.element84.com/v1/), a free STAC API
  operated by [Element 84](https://element84.com/) — thank you!
- Contains modified [Copernicus](https://www.copernicus.eu/) Sentinel-2 data,
  hosted in the [AWS Open Data](https://registry.opendata.aws/sentinel-2-l2a-cogs/)
  program.
- Inspired by the
  [DEA image export notebook](https://github.com/GeoscienceAustralia/dea-notebooks/blob/rbt/Interactive_apps/Exporting_satellite_images.ipynb)
  from Geoscience Australia.
- Basemaps by [MapTiler](https://www.maptiler.com/) and
  [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.

## License

[Apache 2.0](LICENSE)
