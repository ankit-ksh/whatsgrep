// Builds a single executable for the OS it runs on:  npm run build   ->  dist/whatsgrep[.exe]
// Needs the official Node.js binary (nodejs.org / actions/setup-node); distro builds that link
// shared libraries won't run on other machines. Cross-compiling isn't supported: build on each OS.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const win = process.platform === 'win32';
const mac = process.platform === 'darwin';
const out = 'dist';
const exe = join(out, win ? 'whatsgrep.exe' : 'whatsgrep');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 1. One ESM file with every dependency. whatsapp-web.js only needs puppeteer's API, and we
//    always point it at an installed browser, so the slim puppeteer-core stands in for puppeteer.
await build({
  entryPoints: ['src/cli.js'],
  outfile: join(out, 'bundle.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  minify: true,
  legalComments: 'none',
  alias: { puppeteer: 'puppeteer-core' },
  define: { __WG_VERSION__: JSON.stringify(JSON.parse(readFileSync('package.json', 'utf8')).version) },
  external: ['@aws-sdk/client-s3'], // optional S3 support inside unzipper, never used here
  // CommonJS dependencies expect require, __filename and __dirname to exist.
  banner: { js: [
    "import { createRequire as __cr } from 'node:module';",
    "import { fileURLToPath as __fu } from 'node:url';",
    "import { dirname as __dn } from 'node:path';",
    'const require = __cr(import.meta.url), __filename = __fu(import.meta.url), __dirname = __dn(__filename);',
  ].join('\n') },
  logLevel: 'warning',
});

// 2. SEA's entry must be CommonJS, so a small stub unpacks the ESM bundle (cached by content
//    hash in the temp folder) and imports it.
writeFileSync(join(out, 'stub.cjs'), `
const sea = require('node:sea');
const { createHash } = require('node:crypto');
const { existsSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const code = sea.getAsset('bundle.mjs', 'utf8');
const dir = join(tmpdir(), 'whatsgrep-' + createHash('sha1').update(code).digest('hex').slice(0, 12));
const file = join(dir, 'cli.mjs');
if (!existsSync(file)) { mkdirSync(dir, { recursive: true }); writeFileSync(file, code); }
import(pathToFileURL(file).href).catch((e) => { console.error(e); process.exit(1); });
`);

// 3. Inject into a copy of the node binary.
writeFileSync(join(out, 'sea-config.json'), JSON.stringify({
  main: join(out, 'stub.cjs'),
  output: join(out, 'sea.blob'),
  disableExperimentalSEAWarning: true,
  assets: { 'bundle.mjs': join(out, 'bundle.mjs'), 'config.example.yaml': 'config.example.yaml', 'ui.html': join('src', 'ui', 'index.html') },
}));
execFileSync(process.execPath, ['--experimental-sea-config', join(out, 'sea-config.json')], { stdio: 'inherit' });
copyFileSync(process.execPath, exe);
if (!win) chmodSync(exe, 0o755);
if (mac) execFileSync('codesign', ['--remove-signature', exe], { stdio: 'inherit' });
execFileSync(process.execPath, [
  join('node_modules', 'postject', 'dist', 'cli.js'), exe, 'NODE_SEA_BLOB', join(out, 'sea.blob'),
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ...(mac ? ['--macho-segment-name', 'NODE_SEA'] : []),
], { stdio: 'inherit' });
if (mac) execFileSync('codesign', ['--sign', '-', exe], { stdio: 'inherit' });

for (const f of ['bundle.mjs', 'stub.cjs', 'sea-config.json', 'sea.blob']) rmSync(join(out, f));
console.log(`Built ${exe}`);
