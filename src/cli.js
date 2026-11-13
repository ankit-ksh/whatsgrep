#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { runTracker } from './runtime/run.js';
import { defaultPaths, legacyFiles } from './core/paths.js';
import { useScope } from './core/secrets.js';
import { COMMANDS_HELP, runCommand } from './commands/commands.js';
import { runShell } from './commands/shell.js';
import { startServer } from './server/server.js';
import { openBrowser } from './core/open.js';
import { VERSION } from './core/version.js';

const HELP = `whatsgrep - get notified when WhatsApp messages match your rules

Usage: whatsgrep [options]            start the tracker
       whatsgrep <command> [...]      manage it (see Commands below)

  -c, --config <file>   rules file (default: config.yaml in the per-user config folder)
  -d, --data-dir <dir>  session + state folder (default: the per-user data folder)
  -p, --profile <name>  a separate copy with its own config, data and keychain entries, for
                        trying things out next to your real install (never touches its service)
  -b, --browser <path>  Chrome/Chromium/Edge to use (default: auto-detected; or set WHATSGREP_BROWSER)
      --verbose         print every incoming message with its chat name and id
      --dry-run         print matches, don't send notifications
      --check <text>    test rules against a text offline and exit
                        (also: whatsgrep check <text>)
  -v, --version         print the version
  -h, --help

${COMMANDS_HELP}`;

const OPTIONS = {
  config: { type: 'string', short: 'c' },
  browser: { type: 'string', short: 'b' },
  'data-dir': { type: 'string', short: 'd' },
  profile: { type: 'string', short: 'p' },
  // Left over from ntfy. Service files written by an earlier version still pass them, so they are accepted and ignored.
  resume: { type: 'boolean' }, topic: { type: 'string' }, server: { type: 'string' }, qr: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  verbose: { type: 'boolean' },
  check: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
};

// Flags come before the command; everything after the command word belongs to the command
// (so `rules add x --any a,b` keeps its own flags).
const argv = process.argv.slice(2);
const cmdAt = parseArgs({ args: argv, options: OPTIONS, strict: false, allowPositionals: true, tokens: true })
  .tokens.find((t) => t.kind === 'positional')?.index ?? argv.length;
let opt;
try {
  opt = parseArgs({ args: argv.slice(0, cmdAt), options: OPTIONS }).values;
} catch (e) {
  console.error(`${e.message}\n\n${HELP}`);
  process.exit(1);
}
const positionals = argv.slice(cmdAt);

if (opt.version) { console.log(`whatsgrep ${VERSION}`); process.exit(0); }
if (opt.help) { console.log(HELP); process.exit(0); }

let configFile, dataDir;
try {
  ({ config: configFile, dataDir } = defaultPaths(opt));
} catch (e) {
  console.error(`error: ${e.message}`);
  process.exit(1);
}
opt.config = configFile;
opt['data-dir'] = dataDir;
const profile = opt.profile ?? null;
useScope(profile);

// Flags to bake into a background service so it uses the same files as this invocation.
const serviceArgs = ['--config', configFile, '--data-dir', dataDir, ...(profile ? ['--profile', profile] : []), ...(opt.browser ? ['--browser', opt.browser] : [])];
const ctx = { configFile, dataDir, serviceArgs, profile };

// Older versions kept their files in whatever folder they were started from.
const old = legacyFiles();
if ((old.config && !existsSync(configFile)) || (old.data && !existsSync(join(dataDir, 'auth')))) {
  if (!positionals.length || ['run', 'ui', 'shell'].includes(positionals[0])) {
    console.warn(`Found files from an older version in ${process.cwd()}. whatsgrep now keeps its files in:\n  config: ${configFile}\n  data:   ${dataDir}\nRun \`whatsgrep migrate\` here to copy them over (the originals stay).\n`);
  }
}

const [command] = positionals;
if (opt.check !== undefined) positionals.splice(0, positionals.length, 'check', opt.check);
if (command === 'shell') { await runShell(ctx); process.exit(0); }
if (command === 'tray' && positionals[1] === 'run') {
  const { runTray } = await import('./tray/run.js');
  try { await runTray(ctx); } catch (e) { console.error(`error: ${e.message}`); process.exit(1); }
  process.exit(0);
}
if (command === 'ui') {
  const { values } = parseArgs({ args: positionals.slice(1), options: { port: { type: 'string' }, 'no-open': { type: 'boolean' } } });
  const { url } = await startServer(ctx, { port: Number(values.port ?? 0) });
  console.log(`whatsgrep UI: ${url}\nPress Ctrl+C to close it (the tracker keeps running).`);
  if (!values['no-open']) openBrowser(url);
  await new Promise(() => {});
}
if (positionals.length && command !== 'run') {
  try {
    const out = await runCommand(positionals, ctx);
    if (out) console.log(out);
    process.exit(0);
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
}

await runTracker(ctx, opt);
