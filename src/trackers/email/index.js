import { matchesMail } from '../../core/rule.js';
import { preview, senderKeys, senderLabel } from '../../core/mail.js';
import { emailPassword } from './password.js';
import { watchAccount } from './watch.js';

// A mailbox, watched over IMAP so mail is seen the moment it arrives. One connection per folder.
export function createEmail(def, env) {
  const watchers = [];
  const folderState = new Map();

  const summarize = () => {
    const states = [...folderState.values()];
    const bad = states.find((s) => s.state === 'error');
    if (bad) return env.set('error', { error: bad.error });
    if (states.every((s) => s.state === 'connected')) return env.set('listening');
    env.set('connecting', { error: states.find((s) => s.error)?.error });
  };

  const onMail = async (mail) => {
    if (env.opt.verbose) console.log(`  [${senderLabel(mail)} <${mail.fromAddress}>] ${mail.subject}`);
    await env.handle({
      chat: senderLabel(mail),
      text: preview(mail, 2000),
      key: `${mail.fromAddress}|${mail.subject}`,
      title: (rule) => `${rule.name} · ${senderLabel(mail)}`,
      body: preview(mail),
      match: (rule) => matchesMail(rule, mail),
    });
  };

  return {
    async start() {
      const password = emailPassword(def);
      if (!password) return env.set('error', { error: 'No password saved for this account.' });
      env.entry.user = def.user;
      for (const folder of def.folders) {
        folderState.set(folder, { state: 'connecting' });
        env.log(`Watching ${def.user} (${folder})`);
        watchers.push(watchAccount({ ...def, folder, stateKey: `${def.id}/${folder}` }, password, {
          dataDir: env.dir,
          onMail,
          onStatus: (s) => { folderState.set(folder, s); summarize(); },
          log: { warn: env.warn, error: env.error },
        }));
      }
      summarize();
    },
    async stop() { watchers.splice(0).forEach((w) => w.stop()); },
    async command() {},
  };
}
