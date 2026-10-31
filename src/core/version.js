import { readFileSync } from 'node:fs';

// The build script bakes the version into the executable; from source it comes from package.json.
export const VERSION = typeof __WG_VERSION__ !== 'undefined'
  ? __WG_VERSION__
  : JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
