import { createRequire } from 'node:module';

// node:sea only answers inside a packaged executable; elsewhere these are no-ops.
let sea;
try { sea = createRequire(import.meta.url)('node:sea'); } catch {}

export const isPackaged = () => Boolean(sea?.isSea());
export const getAsset = (name) => (isPackaged() ? sea.getAsset(name, 'utf8') : undefined);
