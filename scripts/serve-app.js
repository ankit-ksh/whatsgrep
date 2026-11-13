// Serves the phone app (docs/app) for testing: `npm run phone-app [-- --port 8099] [--lan]`.
// A phone only lets a page receive push alerts over https (or from localhost), so to try it on a
// real phone put an https tunnel in front of this, or publish docs/ with GitHub Pages.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { port: { type: 'string', default: '8099' }, lan: { type: 'boolean' } } });
const root = fileURLToPath(new URL('../docs/app/', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html';
  const file = join(root, path.endsWith(sep) || path === '' ? path + 'index.html' : path);
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'Content-Type': `${TYPES[extname(file)] ?? 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/' });
  createReadStream(file).pipe(res);
}).listen(Number(values.port), values.lan ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`Phone app on http://localhost:${values.port}/${values.lan ? '  (reachable from your network)' : ''}`);
});
