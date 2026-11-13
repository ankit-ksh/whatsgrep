import { readFileSync } from 'node:fs';
import { parseConfig } from '../core/config.js';
import { computerIdentity, listDevices, pairDevice, pushToDevices, removeDevice, setComputerName } from '../core/devices.js';

const when = (t) => new Date(t).toLocaleDateString();

const qrText = async (text) => {
  const { default: qrcode } = await import('qrcode-terminal');
  return new Promise((done) => qrcode.generate(text, { small: true }, done));
};

// whatsgrep devices [list|pair|add <code>|remove <id>|test [<id>]|name [<new name>]]  (`phone` still works)
export async function devicesCommand(args, ctx) {
  const [action = 'list', ...rest] = args;
  const dir = ctx.dataDir;
  switch (action) {
    case 'list': {
      const phones = listDevices(dir);
      return phones.length ? phones.map((p) => `${p.id}  ${p.name}  (paired ${when(p.addedAt)})`).join('\n') : 'No device is paired. Run: whatsgrep devices pair';
    }
    case 'pair': {
      const { app } = parseConfig(readFileSync(ctx.configFile, 'utf8'));
      return `1. On the device that should get alerts, open this page (scan the code):\n${await qrText(app)}\n   ${app}\n2. In the app, turn alerts on and copy the code it shows.\n3. Here, run:  whatsgrep devices add <code>`;
    }
    case 'add': {
      if (!rest.length) throw new Error('usage: devices add <code>   (the code the app shows)');
      const p = await pairDevice(dir, rest.join(''));
      return `Paired "${p.name}". It was sent a message to confirm.`;
    }
    case 'remove': {
      const key = rest.join(' ').trim();
      const hit = listDevices(dir).find((p) => p.id === key || p.name === key);
      if (!hit || !removeDevice(dir, hit.id)) throw new Error(`no paired device "${key}" (see: devices list)`);
      return `Removed "${hit.name}".`;
    }
    case 'test': {
      const key = rest.join(' ').trim();
      const hit = key ? listDevices(dir).find((p) => p.id === key || p.name === key) : undefined;
      if (key && !hit) throw new Error(`no paired device "${key}" (see: devices list)`);
      const r = await pushToDevices(dir, { t: 'test', title: 'whatsgrep test', body: 'If you can read this, notifications work.', at: Date.now() }, { only: hit?.id });
      return `Sent to ${hit ? `"${hit.name}"` : `${r.sent} device${r.sent === 1 ? '' : 's'}`}.${r.failed.length ? `\n${r.failed.join('\n')}` : ''}`;
    }
    case 'name': return rest.length ? `This computer is now called "${setComputerName(dir, rest.join(' ')).name}".` : computerIdentity(dir).name;
    default: throw new Error(`unknown devices command "${action}"`);
  }
}
