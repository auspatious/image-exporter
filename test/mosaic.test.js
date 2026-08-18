import { describe, it, expect } from 'vitest';
import { groupByDay } from '../src/mosaic.js';

function item({ id, day, cloud, bbox }) {
  const [w, s, e, n] = bbox;
  return {
    id,
    type: 'Feature',
    properties: { datetime: `${day}T01:02:03Z`, 'eo:cloud_cover': cloud },
    geometry: {
      type: 'Polygon',
      coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
    },
  };
}

describe('groupByDay', () => {
  it('groups items by their acquisition day', () => {
    const items = [
      item({ id: 'a', day: '2026-01-01', cloud: 10, bbox: [0, 0, 1, 1] }),
      item({ id: 'b', day: '2026-01-01', cloud: 20, bbox: [0, 0, 1, 1] }),
      item({ id: 'c', day: '2026-01-02', cloud: 5, bbox: [0, 0, 1, 1] }),
    ];
    const groups = groupByDay(items, null);
    expect(groups.map((g) => g.day)).toEqual(['2026-01-02', '2026-01-01']);
    expect(groups.find((g) => g.day === '2026-01-01').items).toHaveLength(2);
  });

  it('sorts items within a day by ascending cloud cover', () => {
    const items = [
      item({ id: 'cloudy', day: '2026-01-01', cloud: 80, bbox: [0, 0, 1, 1] }),
      item({ id: 'clear', day: '2026-01-01', cloud: 5, bbox: [0, 0, 1, 1] }),
    ];
    const [group] = groupByDay(items, null);
    expect(group.items.map((i) => i.id)).toEqual(['clear', 'cloudy']);
  });

  it('computes mean cloud cover per day', () => {
    const items = [
      item({ id: 'a', day: '2026-01-01', cloud: 10, bbox: [0, 0, 1, 1] }),
      item({ id: 'b', day: '2026-01-01', cloud: 30, bbox: [0, 0, 1, 1] }),
    ];
    const [group] = groupByDay(items, null);
    expect(group.meanCloud).toBe(20);
  });

  it('keeps non-intersecting items in `items`, but only intersecting ones in `renderItems`', () => {
    const items = [
      item({ id: 'inside', day: '2026-01-01', cloud: 10, bbox: [0, 0, 1, 1] }),
      item({ id: 'outside', day: '2026-01-01', cloud: 10, bbox: [10, 10, 11, 11] }),
    ];
    const groups = groupByDay(items, [0, 0, 1, 1]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => i.id).sort()).toEqual(['inside', 'outside']);
    expect(groups[0].renderItems.map((i) => i.id)).toEqual(['inside']);
    expect(groups[0].intersectingIds).toEqual(new Set(['inside']));
  });

  it('drops a day entirely when a box is drawn and nothing that day intersects it', () => {
    const items = [item({ id: 'outside', day: '2026-01-01', cloud: 10, bbox: [10, 10, 11, 11] })];
    expect(groupByDay(items, [0, 0, 1, 1])).toEqual([]);
  });

  it('has a null intersectingIds and renderItems === items with no drawn box', () => {
    const items = [item({ id: 'a', day: '2026-01-01', cloud: 10, bbox: [0, 0, 1, 1] })];
    const [group] = groupByDay(items, null);
    expect(group.intersectingIds).toBeNull();
    expect(group.renderItems).toEqual(group.items);
  });

  it('reports null coverage with no drawn box, and 100% for a fully covering scene', () => {
    const noBox = groupByDay([item({ id: 'a', day: '2026-01-01', cloud: 10, bbox: [0, 0, 1, 1] })], null);
    expect(noBox[0].coverage).toBeNull();

    const withBox = groupByDay(
      [item({ id: 'a', day: '2026-01-01', cloud: 10, bbox: [-1, -1, 2, 2] })],
      [0, 0, 1, 1],
    );
    expect(withBox[0].coverage).toBeCloseTo(100, 5);
  });

  it('reports partial coverage for a scene covering half the box', () => {
    const groups = groupByDay(
      [item({ id: 'a', day: '2026-01-01', cloud: 10, bbox: [0, 0, 0.5, 1] })],
      [0, 0, 1, 1],
    );
    expect(groups[0].coverage).toBeCloseTo(50, 0);
  });

  it('ignores items with no datetime', () => {
    const noDate = { id: 'x', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } };
    expect(groupByDay([noDate], null)).toEqual([]);
  });
});
