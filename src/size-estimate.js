/**
 * Estimate how many bytes the export/preview will pull from cloud storage.
 * We assume 3 bands (R, G, B) × 2 bytes per sample (uint16) × item count,
 * with a 1.3× overhead for HTTP/tile/decompression waste.
 */
export function estimateBytes({ width, height, itemCount, bands = 3, bytesPerSample = 2 }) {
  const pixels = width * height;
  const bytes = pixels * bands * bytesPerSample * Math.max(1, itemCount) * 1.3;
  return { pixels, bytes, megabytes: bytes / (1024 * 1024), tier: tierFor(bytes / (1024 * 1024), pixels) };
}

function tierFor(mb, pixels) {
  if (pixels > 8000 * 8000) return 'too-large';
  if (mb > 150) return 'large';
  if (mb > 25) return 'medium';
  return 'small';
}
