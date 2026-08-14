import { describe, it, expect, vi, afterEach } from 'vitest';
import { slugify, placeName } from '../src/geocode.js';

describe('slugify', () => {
  it('lowercases and hyphenates spaces', () => {
    expect(slugify('New South Wales')).toBe('new-south-wales');
  });

  it('strips diacritics', () => {
    expect(slugify('Bogotá')).toBe('bogota');
  });

  it('collapses non-alphanumeric runs and trims leading/trailing hyphens', () => {
    expect(slugify(" St. Ives / Cornwall! ")).toBe('st-ives-cornwall');
  });
});

describe('placeName', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a slugified name from the reverse-geocode response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ address: { city: 'Canberra' } }),
    }));
    expect(await placeName(149.13, -35.28)).toBe('canberra');
  });

  it('returns null (not throw) when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await placeName(1.23456, 2.34567)).toBeNull();
  });

  it('returns null when the response has no usable address field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    expect(await placeName(3.456, 4.567)).toBeNull();
  });
});
