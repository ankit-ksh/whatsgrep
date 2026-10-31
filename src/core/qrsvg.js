// Static imports so the bundler includes these internals of qrcode-terminal.
import QRCode from 'qrcode-terminal/vendor/QRCode/index.js';
import ErrorCorrectLevel from 'qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel.js';

// A QR code as an SVG string (black squares on a white background with the standard quiet zone).
export function qrSvg(text, quiet = 4) {
  const qr = new QRCode(-1, ErrorCorrectLevel.L);
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const size = n + quiet * 2;
  let path = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.modules[r][c]) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
