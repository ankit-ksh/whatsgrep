// A round, anti-aliased status dot as raw ARGB pixels (the format StatusNotifierItem wants).
export function dotPixmap(hex, size) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2, outer = size / 2 - 1, inner = outer - Math.max(1.5, size / 14);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x - c, y - c);
    const edge = Math.min(1, Math.max(0, outer + 0.5 - d)); // soft outer edge
    const ring = Math.min(1, Math.max(0, d - inner));        // white ring
    const o = (y * size + x) * 4;
    buf[o] = Math.round(edge * 255);
    buf[o + 1] = Math.round(r + (255 - r) * ring);
    buf[o + 2] = Math.round(g + (255 - g) * ring);
    buf[o + 3] = Math.round(b + (255 - b) * ring);
  }
  return [size, size, buf];
}
