import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

// Per-user folders, so the program works from any directory and as a service.
export function appDirs(platform = process.platform, env = process.env, home = homedir()) {
  if (platform === 'win32') {
    return { data: join(env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'whatsgrep'), config: join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'whatsgrep') };
  }
  if (platform === 'darwin') {
    const base = join(home, 'Library', 'Application Support', 'whatsgrep');
    return { data: base, config: base };
  }
  return {
    data: join(env.XDG_DATA_HOME ?? join(home, '.local', 'share'), 'whatsgrep'),
    config: join(env.XDG_CONFIG_HOME ?? join(home, '.config'), 'whatsgrep'),
  };
}

// A flag wins, otherwise the per-user folders. Never the current directory, so it behaves the
// same wherever it is started from (a terminal, a service, a double-click).
export const PROFILE_RE = /^[a-z0-9][a-z0-9-]{0,30}$/i;

// A profile is a self-contained copy of whatsgrep (own config, sessions and keychain entries) for
// trying things out next to a real install. Folders sit beside the real ones.
export function profileDirs(name, dirs = appDirs()) {
  if (!PROFILE_RE.test(name)) throw new Error(`invalid profile name "${name}" (letters, digits and dashes, up to 31 characters)`);
  return { data: `${dirs.data}-${name}`, config: `${dirs.config}-${name}` };
}

export function defaultPaths(opt, dirs = appDirs()) {
  if (opt.profile) dirs = profileDirs(opt.profile, dirs);
  return {
    config: resolve(opt.config ?? join(dirs.config, 'config.yaml')),
    dataDir: resolve(opt['data-dir'] ?? dirs.data),
  };
}

// Files an older version kept next to wherever it was run.
export function legacyFiles(cwd = process.cwd()) {
  return {
    config: existsSync(join(cwd, 'config.yaml')) ? join(cwd, 'config.yaml') : null,
    data: existsSync(join(cwd, '.whatsgrep')) ? join(cwd, '.whatsgrep') : null,
  };
}

// Each tracker keeps its own files (login session, linked account, chat list). The first WhatsApp
// account keeps using the data folder itself, so sessions saved by earlier versions still work.
export const trackerDir = (dataDir, tracker) => (tracker.id === 'whatsapp' && tracker.type === 'whatsapp' ? dataDir : join(dataDir, 'trackers', tracker.id));
