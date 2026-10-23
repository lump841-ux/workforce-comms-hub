// Shared browser/server media allowlist. Never treats SVG/HTML as an image.
(function (root, factory) {
  const policy = factory();
  if (typeof module === 'object' && module.exports) module.exports = policy;
  else root.MediaPolicy = policy;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MAX_IMAGE_BYTES = 512 * 1024;
  const MAX_DIMENSION = 4096;
  function invalid(message) { throw Object.assign(new Error(message), { status: 400 }); }
  function validateDataImage(value) {
    if (typeof value !== 'string' || value.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64) invalid('Choose an image no larger than 512 KB');
    const match = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match || match[2].length % 4 !== 0) invalid('Use a base64 PNG, JPEG, GIF or WebP image');
    let bytes;
    try { bytes = atob(match[2]); } catch (_) { invalid('The image encoding is invalid'); }
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) invalid('Choose an image no larger than 512 KB');
    const byte = (n) => bytes.charCodeAt(n);
    const le = (n, count) => { let result = 0; for (let i = 0; i < count; i++) result += byte(n + i) * (2 ** (8 * i)); return result; };
    const be = (n, count) => { let result = 0; for (let i = 0; i < count; i++) result = result * 256 + byte(n + i); return result; };
    let width = 0, height = 0;
    if (match[1] === 'png' && bytes.length >= 45 && bytes.slice(0, 8) === '\x89PNG\r\n\x1a\n' && bytes.slice(12, 16) === 'IHDR' && bytes.slice(-8, -4) === 'IEND') {
      width = be(16, 4); height = be(20, 4);
    } else if (match[1] === 'gif' && bytes.length >= 14 && /^GIF8[79]a/.test(bytes) && bytes.endsWith(';')) {
      width = le(6, 2); height = le(8, 2);
    } else if (match[1] === 'jpeg' && bytes.startsWith('\xff\xd8') && bytes.endsWith('\xff\xd9')) {
      for (let offset = 2; offset + 8 < bytes.length;) {
        if (byte(offset) !== 255) break;
        const marker = byte(offset + 1); const size = be(offset + 2, 2);
        if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && size >= 8) {
          height = be(offset + 5, 2); width = be(offset + 7, 2); break;
        }
        if (size < 2 || offset + size + 2 > bytes.length || marker === 0xda) break;
        offset += size + 2;
      }
    } else if (match[1] === 'webp' && bytes.length >= 30 && bytes.slice(0, 4) === 'RIFF' && bytes.slice(8, 12) === 'WEBP' && le(4, 4) + 8 === bytes.length) {
      if (bytes.slice(12, 16) === 'VP8X') { width = le(24, 3) + 1; height = le(27, 3) + 1; }
      else if (bytes.slice(12, 16) === 'VP8L' && byte(20) === 47) { const bits = le(21, 4); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1; }
      else if (bytes.slice(12, 16) === 'VP8 ' && bytes.slice(23, 26) === '\x9d\x01\x2a') { width = le(26, 2) & 0x3fff; height = le(28, 2) & 0x3fff; }
    }
    if (!width || !height || width > MAX_DIMENSION || height > MAX_DIMENSION) invalid('Invalid image format or dimensions; maximum 4096 × 4096');
    return value;
  }
  function normalizeImageSource(value) {
    if (typeof value !== 'string' || !value || /[\u0000-\u0020\u007f]/.test(value)) invalid('Use a valid image URL or upload');
    if (value.startsWith('data:')) return validateDataImage(value);
    if (value.length > 2048 || /[\\<>"']/.test(value)) invalid('Invalid image URL');
    if (value.startsWith('/') && !value.startsWith('//')) return value;
    let url; try { url = new URL(value); } catch (_) { invalid('Use a secure HTTPS image URL'); }
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) invalid('Use a secure HTTPS image URL');
    return url.href;
  }
  return { MAX_IMAGE_BYTES, MAX_DIMENSION, validateDataImage, normalizeImageSource };
});
