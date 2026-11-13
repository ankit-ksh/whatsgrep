import { existsSync, readFileSync, statSync, watchFile } from 'node:fs';
import { join } from 'node:path';
import { parseConfig } from '../core/config.js';
import { notify } from '../core/notify.js';
import { trackerDir } from '../core/paths.js';
import { appliesTo } from '../core/rule.js';
import { forgetLegacyTopic, listDevices } from '../core/devices.js';
import { appendMatch, readStatus, takeCommands, trimMatches, writeStatus } from '../core/status.js';
import { createTracker } from '../trackers/index.js';

// Exit codes a service understands: 2 = needs a human (do not restart in a loop), 3 = already running.

// Which state the whole tracker process reports, from its trackers' states.
function overallState(entries) {
  const has = (s) => entries.some((e) => e.state === s);
  if (!entries.length) return 'idle';
  if (has('listening')) return 'listening';
  if (has('waiting for QR scan')) return 'waiting for QR scan';
  if (has('linking')) return 'linking';
  if (entries.every((e) => e.state === 'needs login')) return 'needs login';
  // Nothing is working and nothing is still trying: say so instead of showing "starting" forever.
  if (entries.every((e) => ['needs login', 'error', 'reconnecting'].includes(e.state))) return 'error';
  return 'starting';
}

// The tracker process: runs every enabled tracker, turns matches into notifications, keeps the
// status files the interface and commands read.
// In a log file, every line says when it happened. In a terminal the time is just noise.
function stampLog() {
  if (process.stdout.isTTY) return;
  for (const level of ['log', 'warn', 'error']) {
    const write = console[level].bind(console);
    console[level] = (...args) => write(new Date().toLocaleString('sv'), ...args);
  }
}

export async function runTracker(ctx, opt) {
  stampLog();
  const dataDir = opt['data-dir'];
  const loadConfig = () => parseConfig(readFileSync(opt.config, 'utf8'));
  let config;
  try {
    config = loadConfig();
  } catch (e) {
    console.error(`Could not load ${opt.config}: ${e.message}\nCreate one with: whatsgrep config init`);
    process.exit(1);
  }
  let { rules } = config;
  const dryRun = opt['dry-run'];

  // One tracker process per data folder: two would fight over the same sessions.
  const other = readStatus(dataDir);
  if (other?.running && other.pid !== process.pid) {
    console.error(`whatsgrep is already running (pid ${other.pid}). Stop it first, or use the UI / \`whatsgrep service\`.`);
    process.exit(3);
  }
  trimMatches(dataDir);

  console.log(`Notifications: ${config.methods.join(', ') || 'none'}`);
  if (config.dropped.length) {
    console.warn('ntfy is no longer supported and was ignored. Pair a device under Delivery (or `whatsgrep devices pair`) for alerts on your phone.');
    forgetLegacyTopic(dataDir);
  }
  if (config.methods.includes('devices') && !listDevices(dataDir).length) console.warn('Device alerts are on but no device is paired yet. Pair one under Delivery (or `whatsgrep devices pair`).');

  // Live state for the `status` command and the interface.
  const stats = { pid: process.pid, startedAt: Date.now(), state: 'starting', matches: 0, lastMatch: null, recent: [], methods: config.methods, trackers: [] };
  let stopping = false;
  const publish = () => {
    if (!stopping) stats.state = overallState(stats.trackers);
    writeStatus(dataDir, stats);
  };

  // The same sender repeating the same text shouldn't ping again.
  const seen = new Map();
  const isRepeat = (key) => {
    if (!config.repeatWindowMs) return false; // off: every match alerts
    const now = Date.now();
    for (const [k, t] of seen) if (now - t > config.repeatWindowMs) seen.delete(k);
    const dup = seen.has(key);
    seen.set(key, now);
    return dup;
  };

  // One alert for one match, from any tracker: records it, then sends it through every notification method.
  async function alert(rule, def, item) {
    if (isRepeat(`${rule.name}|${def.id}|${item.key}`)) return;
    console.log(`[${rule.name}] ${item.chat}: ${item.text.slice(0, 200)}`);
    stats.matches++;
    stats.lastMatch = Date.now();
    stats.recent = [{ t: stats.lastMatch, rule: rule.name, chat: item.chat, tracker: def.name, text: item.text.slice(0, 140) }, ...stats.recent].slice(0, 8);
    publish();
    const rec = { t: stats.lastMatch, rule: rule.name, chat: item.chat, tracker: def.name, source: def.type, text: item.text.slice(0, 2000), priority: rule.priority ?? 'default', sent: [], failed: [] };
    if (dryRun) { rec.dry = true; appendMatch(dataDir, rec); return; }
    try {
      for (const r of await notify(config.methods, { rule: rule.name, dataDir, tracker: def.name, chat: item.chat, title: item.title(rule), message: item.body, priority: rule.priority })) {
        if (r.ok) rec.sent.push(r.method); else rec.failed.push({ method: r.method, error: r.error });
      }
    } catch (e) {
      console.error(`[${rule.name}] notification failed: ${e.message}`);
      rec.failed.push({ method: 'all', error: e.message });
    }
    appendMatch(dataDir, rec);
  }

  async function handle(def, item) {
    reloadIfChanged();
    for (const rule of rules) {
      if (!appliesTo(rule, def) || !item.match(rule)) continue;
      await alert(rule, def, item);
    }
  }

  // Trackers come and go while running: adding, removing or changing one in the interface
  // starts, stops or restarts just that tracker.
  const live = new Map(); // id -> { json, tracker, entry }
  function startOne(def) {
    const entry = { id: def.id, name: def.name, type: def.type, state: 'starting' };
    const tag = `[${def.name}]`;
    const env = {
      dir: trackerDir(dataDir, def),
      opt,
      get browser() { return config.browser; }, // read at each launch, so a change applies on the next one
      tty: !!process.stdout.isTTY,
      entry,
      set(state, extra = {}) { Object.assign(entry, { error: undefined }, extra, { state }); publish(); },
      publish,
      handle: (item) => handle(def, item),
      log: (m) => console.log(`${tag} ${m}`),
      warn: (m) => console.warn(`${tag} ${m}`),
      error: (m) => console.error(`${tag} ${m}`),
    };
    const tracker = createTracker(def, env);
    live.set(def.id, { json: JSON.stringify(def), browser: config.browser, tracker, entry });
    tracker.start().catch((e) => env.set('error', { error: e.message }));
  }

  async function reconcile() {
    const want = new Map(config.trackers.filter((t) => t.enabled).map((t) => [t.id, t]));
    for (const [id, h] of [...live]) {
      // A tracker is restarted when it changed, or (WhatsApp) when the browser it should use changed.
      const browserChanged = want.get(id)?.type === 'whatsapp' && h.browser !== config.browser;
      if (!want.has(id) || JSON.stringify(want.get(id)) !== h.json || browserChanged) { live.delete(id); await h.tracker.stop(); }
    }
    for (const [id, def] of want) if (!live.has(id)) startOne(def);
    const order = config.trackers.map((t) => t.id);
    stats.trackers = [...live.values()].map((h) => h.entry).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    publish();
  }

  // Pick up config edits as soon as the file is saved; keep the old settings if the new file is broken.
  let mtime = statSync(opt.config).mtimeMs;
  function reloadIfChanged() {
    try {
      const m = statSync(opt.config).mtimeMs;
      if (m === mtime) return;
      mtime = m;
      const next = loadConfig();
      config = next;
      ({ rules } = next);
      stats.methods = next.methods;
      console.log(`Reloaded ${opt.config} (${rules.length} rules, ${next.trackers.filter((t) => t.enabled).length} trackers)`);
      reconcile().catch((e) => console.error(`could not apply tracker changes: ${e.message}`));
    } catch (e) {
      console.warn(`Config reload failed, keeping previous settings: ${e.message}`);
    }
  }
  watchFile(opt.config, { interval: 500 }, reloadIfChanged);

  if (!config.trackers.some((t) => t.enabled)) {
    console.error('Nothing to watch: no tracker is turned on. Add one in the interface or with: whatsgrep tracker add');
    process.exit(2);
  }

  // Commands from the interface: link, check, list chats, log out. Addressed to a tracker by id.
  // One for a tracker that has not come up yet (the interface starts everything at once) waits for it.
  let waiting = [];
  setInterval(async () => {
    const cmds = [...waiting, ...takeCommands(dataDir)];
    waiting = [];
    for (const cmd of cmds) {
      if (Date.now() - cmd.at > 120000) continue; // left over from long ago
      const id = cmd.tracker ?? [...live.values()].find((h) => h.entry.type === 'whatsapp')?.entry.id;
      const h = live.get(id);
      if (!h) { waiting.push(cmd); continue; }
      try { await h.tracker.command?.(cmd.action); } catch (e) { console.warn(`[${id}] ${cmd.action}: ${e.message}`); }
    }
  }, 1000).unref();

  const quit = async () => {
    stopping = true;
    stats.state = 'stopped';
    writeStatus(dataDir, stats);
    await Promise.allSettled([...live.values()].map((h) => h.tracker.stop()));
    process.exit(0);
  };
  process.on('SIGINT', quit);
  process.on('SIGTERM', quit);
  // A failure inside one tracker (a browser or network error nobody caught) must not take the others down.
  process.on('unhandledRejection', (e) => console.error(`unhandled error: ${e instanceof Error ? e.message : e}`));

  publish();
  await reconcile();
  await new Promise(() => {});
}
