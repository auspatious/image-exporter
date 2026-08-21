/**
 * Builds a minimal STAC Item describing how a Cogniscient export was produced.
 * Uses core STAC links (`derived_from`) for source-scene provenance:
 * https://github.com/radiantearth/stac-spec/blob/master/item-spec/item-spec.md
 */

function bboxGeometry([w, s, e, n]) {
  return {
    type: 'Polygon',
    coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
  };
}

function activeBandSelection(appState) {
  if (appState.vizMode === 'single') return { mode: 'single', band: appState.singleBand };
  if (appState.vizMode === 'index') {
    return {
      mode: 'index',
      bands: { ...appState.indexBands },
      expression: '(a - b) / (a + b)',
    };
  }
  return { mode: 'rgb', bands: { ...appState.bands } };
}

function selfHref(item) {
  return item?.links?.find((l) => l.rel === 'self')?.href ?? null;
}

export function buildStacProvenance({ appState, sourceItems, exportedAsset }) {
  const bbox = appState.drawnBbox;
  const datetime = appState.selectedDay ? `${appState.selectedDay}T00:00:00Z` : null;
  const created = new Date().toISOString();
  const selectedBands = activeBandSelection(appState);
  const links = [
    {
      rel: 'about',
      href: 'https://stacspec.org/en',
      title: 'STAC specification',
    },
    ...sourceItems
      .map((item) => {
        const href = selfHref(item);
        return href
          ? {
            rel: 'derived_from',
            href,
            type: 'application/geo+json',
            title: item.id,
          }
          : null;
      })
      .filter(Boolean),
  ];

  const assets = exportedAsset
    ? {
      export: {
        href: exportedAsset.href,
        type: exportedAsset.type,
        title: exportedAsset.title,
        roles: ['data'],
      },
    }
    : {};

  return {
    stac_version: '1.0.0',
    stac_extensions: ['https://stac-extensions.github.io/processing/v1.1.0/schema.json'],
    type: 'Feature',
    id: `cogniscient-${appState.selectedDay}-${created}`,
    bbox,
    geometry: bbox ? bboxGeometry(bbox) : null,
    properties: {
      datetime,
      created,
      'processing:lineage': sourceItems.map((item) => item.id),
      'cogniscient:collection': appState.collection,
      'cogniscient:visualisation': {
        selected_bands: selectedBands,
        stretch: {
          vmin: appState.viz.vmin,
          vmax: appState.viz.vmax,
          gamma: appState.viz.gamma,
          colormap: appState.viz.colormap,
          colormap_reversed: appState.viz.colormapReversed,
        },
        format: appState.viz.format,
      },
    },
    links,
    assets,
  };
}
