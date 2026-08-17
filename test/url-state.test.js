import { describe, it, expect } from 'vitest';
import { parseParams, buildParams } from '../src/url-state.js';

describe('parseParams', () => {
  it('returns {} for an empty query string', () => {
    expect(parseParams('')).toEqual({});
  });

  it('parses bbox as four numbers', () => {
    expect(parseParams('?bbox=1,2,3,4').bbox).toEqual([1, 2, 3, 4]);
  });

  it('ignores a malformed bbox (wrong length or non-numeric)', () => {
    expect(parseParams('?bbox=1,2,3').bbox).toBeUndefined();
    expect(parseParams('?bbox=a,b,c,d').bbox).toBeUndefined();
  });

  it('splits datetime into dateFrom/dateTo', () => {
    const out = parseParams('?datetime=2026-01-01/2026-02-01');
    expect(out.dateFrom).toBe('2026-01-01');
    expect(out.dateTo).toBe('2026-02-01');
  });

  it('parses cloud_cover_max and width as numbers', () => {
    const out = parseParams('?cloud_cover_max=25&width=800');
    expect(out.cloudCoverMax).toBe(25);
    expect(out.width).toBe(800);
  });

  it('passes selected_datetime through as-is', () => {
    expect(parseParams('?selected_datetime=2026-01-15').selectedDatetime).toBe('2026-01-15');
  });

  it('parses visualise_settings JSON', () => {
    const settings = { vizMode: 'index', indexBands: { a: 'nir', b: 'red' } };
    const out = parseParams(`?visualise_settings=${encodeURIComponent(JSON.stringify(settings))}`);
    expect(out.visualiseSettings).toEqual(settings);
  });

  it('ignores malformed visualise_settings JSON instead of throwing', () => {
    expect(() => parseParams('?visualise_settings=not-json')).not.toThrow();
    expect(parseParams('?visualise_settings=not-json').visualiseSettings).toBeUndefined();
  });
});

describe('buildParams', () => {
  const baseState = {
    drawnBbox: [1, 2, 3, 4],
    dateFrom: '2026-01-01',
    dateTo: '2026-02-01',
    cloudCoverMax: 50,
    selectedDay: '2026-01-15',
    targetWidth: 1000,
    preset: 'ndvi',
    vizMode: 'index',
    bands: { r: 'red', g: 'green', b: 'blue' },
    singleBand: 'nir',
    indexBands: { a: 'nir', b: 'red' },
    viz: { vmin: -1, vmax: 1, gamma: 1, colormap: 'rdylgn', colormapReversed: false, format: 'png' },
  };

  it('serializes bbox, datetime, cloud_cover_max, selected_datetime, width', () => {
    const params = buildParams(baseState, '');
    expect(params.get('bbox')).toBe('1,2,3,4');
    expect(params.get('datetime')).toBe('2026-01-01/2026-02-01');
    expect(params.get('cloud_cover_max')).toBe('50');
    expect(params.get('selected_datetime')).toBe('2026-01-15');
    expect(params.get('width')).toBe('1000');
  });

  it('omits bbox/selected_datetime when there is no drawn box or selected day', () => {
    const params = buildParams({ ...baseState, drawnBbox: null, selectedDay: null }, '');
    expect(params.has('bbox')).toBe(false);
    expect(params.has('selected_datetime')).toBe(false);
  });

  it('round-trips visualise_settings as JSON', () => {
    const params = buildParams(baseState, '');
    const parsed = JSON.parse(params.get('visualise_settings'));
    expect(parsed).toEqual({
      preset: 'ndvi',
      vizMode: 'index',
      bands: baseState.bands,
      singleBand: 'nir',
      indexBands: baseState.indexBands,
      viz: baseState.viz,
    });
  });

  it('preserves unrelated existing params', () => {
    const params = buildParams(baseState, '?utm_source=test');
    expect(params.get('utm_source')).toBe('test');
    expect(params.get('bbox')).toBe('1,2,3,4');
  });

  it('round-trips through parseParams', () => {
    const params = buildParams(baseState, '');
    const out = parseParams(`?${params.toString()}`);
    expect(out.bbox).toEqual(baseState.drawnBbox);
    expect(out.dateFrom).toBe(baseState.dateFrom);
    expect(out.dateTo).toBe(baseState.dateTo);
    expect(out.cloudCoverMax).toBe(baseState.cloudCoverMax);
    expect(out.selectedDatetime).toBe(baseState.selectedDay);
    expect(out.width).toBe(baseState.targetWidth);
    expect(out.visualiseSettings.vizMode).toBe('index');
  });
});
