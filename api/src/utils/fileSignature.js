// Real image type detection by magic bytes. The client-supplied mimetype
// and filename extension are never trusted alone (AGENTS.md upload rule:
// cek magic bytes asli, bukan cuma ekstensi) — this is the authoritative
// check, run after multer hands off the buffer.
const SIGNATURES = [
  {
    type: 'jpeg',
    ext: '.jpg',
    check: (buf) => buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  },
  {
    type: 'png',
    ext: '.png',
    check: (buf) =>
      buf.length >= 8 &&
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47 &&
      buf[4] === 0x0d &&
      buf[5] === 0x0a &&
      buf[6] === 0x1a &&
      buf[7] === 0x0a,
  },
  {
    type: 'webp',
    ext: '.webp',
    check: (buf) =>
      buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP',
  },
];

function detectImageType(buffer) {
  return SIGNATURES.find((sig) => sig.check(buffer)) || null;
}

module.exports = { detectImageType };
