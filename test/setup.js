// Node has no ImageData global; export.js only needs it as a plain data
// holder (width/height/data), so a minimal stand-in is enough for tests.
if (typeof globalThis.ImageData === 'undefined') {
  globalThis.ImageData = class ImageData {
    constructor(data, width, height) {
      this.data = data;
      this.width = width;
      this.height = height ?? data.length / (4 * width);
    }
  };
}
