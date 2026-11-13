import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));
const read = (f) => readFileSync(dir + f, 'utf8');

// The interface is a React app in this folder. It is bundled into one HTML page with the script and
// styles inline: the program serves that page, and the packaged executable carries it as an asset.
// esbuild is a development dependency, so it is loaded only here, when the page is built.
let cached;
export async function buildUiHtml({ minify = true } = {}) {
  if (cached && minify) return cached;
  const { build } = await import('esbuild');
  const out = await build({
    entryPoints: [dir + 'main.tsx'],
    bundle: true,
    write: false,
    minify,
    format: 'iife',
    target: 'es2022',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    legalComments: 'none',
    logLevel: 'warning',
  });
  const js = out.outputFiles[0].text.replace(/<\/script>/gi, '<\\/script>');
  // split/join: the page text contains "$" sequences that String.replace would treat specially.
  const html = read('index.html').split('/*CSS*/').join(read('styles.css')).split('/*JS*/').join(js);
  if (minify) cached = html;
  return html;
}
