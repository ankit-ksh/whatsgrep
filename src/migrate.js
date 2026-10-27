import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { readStatus } from './status.js';

// Chromium lock files and our own runtime files are not worth copying.
const SKIP = /^(Singleton(Lock|Cookie|Socket)|status\.json|whatsgrep\.log)$/;

// Copies a config and WhatsApp session from an old location (a folder holding config.yaml and
// .whatsgrep) into the standard per-user folders. Never deletes or changes the originals.
export function migrate({ from, config, dataDir, force = false }) {
  const srcConfig = join(from, 'config.yaml');
  const srcData = join(from, '.whatsgrep');
  const out = [];
  if (!existsSync(srcConfig) && !existsSync(srcData)) return [`Nothing to migrate: no config.yaml or .whatsgrep in ${from}`];
  if (existsSync(srcData) && readStatus(srcData)?.running) throw new Error('The tracker is still running from the old folder. Stop it first.');

  if (existsSync(srcConfig)) {
    if (existsSync(config) && !force) out.push(`Kept the existing ${config} (use --force to replace it)`);
    else { mkdirSync(dirname(config), { recursive: true }); cpSync(srcConfig, config); out.push(`Copied config  -> ${config}`); }
  }
  if (existsSync(srcData)) {
    if (existsSync(join(dataDir, 'auth')) && !force) out.push(`Kept the existing session in ${dataDir} (use --force to replace it)`);
    else {
      mkdirSync(dataDir, { recursive: true });
      cpSync(srcData, dataDir, { recursive: true, force: true, filter: (p) => !SKIP.test(basename(p)) });
      out.push(`Copied session -> ${dataDir}`);
    }
  }
  out.push(`The originals in ${from} were left alone; delete them when you are happy.`);
  return out;
}
