import dbus from 'dbus-next';
import { dotPixmap } from './icon.js';

const { Interface } = dbus.interface;
const { Variant } = dbus;
const SIZES = [24, 48];

// Linux: a StatusNotifierItem on the session bus. KDE shows it natively; GNOME needs the
// "AppIndicator and KStatusNotifierItem Support" extension (the one Flameshot, Variety and
// Clipboard Indicator use).
export async function createTray({ onClick }) {
  const bus = dbus.sessionBus();
  let view = { color: '#8e99a8', tooltip: 'whatsgrep', items: [] };
  let revision = 1;

  const props = (it) => {
    if (it.separator) return { type: new Variant('s', 'separator') };
    const p = { label: new Variant('s', it.label), enabled: new Variant('b', it.enabled !== false), visible: new Variant('b', true) };
    if (it.checked !== undefined) { p['toggle-type'] = new Variant('s', 'checkmark'); p['toggle-state'] = new Variant('i', it.checked ? 1 : 0); }
    return p;
  };
  const nodes = () => view.items.map((it, i) => [i + 1, props(it), []]);

  class Menu extends Interface {
    constructor() { super('com.canonical.dbusmenu'); this.Version = 3; this.TextDirection = 'ltr'; this.Status = 'normal'; this.IconThemePath = []; }
    GetLayout() { return [revision, [0, { 'children-display': new Variant('s', 'submenu') }, nodes().map((n) => new Variant('(ia{sv}av)', n))]]; }
    GetGroupProperties(ids) { return nodes().filter((n) => !ids.length || ids.includes(n[0])).map((n) => [n[0], n[1]]); }
    GetProperty(id, name) { const n = nodes().find((x) => x[0] === id); return n?.[1][name] ?? new Variant('s', ''); }
    Event(id, type) { if (type === 'clicked') { const it = view.items[id - 1]; if (it?.id) onClick(it.id); } }
    EventGroup(events) { for (const [id, type] of events) this.Event(id, type); return []; }
    AboutToShow() { return false; }
    AboutToShowGroup() { return [[], []]; }
    LayoutUpdated(rev, parent) { return [rev, parent]; }
  }
  Menu.configureMembers({
    properties: { Version: { signature: 'u' }, TextDirection: { signature: 's' }, Status: { signature: 's' }, IconThemePath: { signature: 'as' } },
    methods: {
      GetLayout: { inSignature: 'iias', outSignature: 'u(ia{sv}av)' },
      GetGroupProperties: { inSignature: 'aias', outSignature: 'a(ia{sv})' },
      GetProperty: { inSignature: 'is', outSignature: 'v' },
      Event: { inSignature: 'isvu', outSignature: '' },
      EventGroup: { inSignature: 'a(isvu)', outSignature: 'ai' },
      AboutToShow: { inSignature: 'i', outSignature: 'b' },
      AboutToShowGroup: { inSignature: 'ai', outSignature: 'aiai' },
    },
    signals: { LayoutUpdated: { signature: 'ui' } },
  });

  class Item extends Interface {
    constructor() {
      super('org.kde.StatusNotifierItem');
      Object.assign(this, { Category: 'ApplicationStatus', Id: 'whatsgrep', Title: 'whatsgrep', Status: 'Active', WindowId: 0, IconName: '', ItemIsMenu: true, Menu: '/Menu' });
    }
    get IconPixmap() { return SIZES.map((s) => dotPixmap(view.color, s)); }
    get ToolTip() { return ['', [], 'whatsgrep', view.tooltip.replace(/^whatsgrep · /, '')]; }
    Activate() {}
    SecondaryActivate() {}
    ContextMenu() {}
    Scroll() {}
    NewIcon() {}
    NewToolTip() {}
  }
  Item.configureMembers({
    properties: {
      Category: { signature: 's' }, Id: { signature: 's' }, Title: { signature: 's' }, Status: { signature: 's' },
      WindowId: { signature: 'u' }, IconName: { signature: 's' }, IconPixmap: { signature: 'a(iiay)' },
      ToolTip: { signature: '(sa(iiay)ss)' }, ItemIsMenu: { signature: 'b' }, Menu: { signature: 'o' },
    },
    methods: {
      Activate: { inSignature: 'ii' }, SecondaryActivate: { inSignature: 'ii' }, ContextMenu: { inSignature: 'ii' }, Scroll: { inSignature: 'is' },
    },
    signals: { NewIcon: { signature: '' }, NewToolTip: { signature: '' } },
  });

  const item = new Item(), menu = new Menu();
  bus.export('/StatusNotifierItem', item);
  bus.export('/Menu', menu);
  const name = `org.kde.StatusNotifierItem-${process.pid}-1`;
  await bus.requestName(name, 0);

  // The watcher may start after us (at login), so register now and again whenever it appears.
  const register = async () => {
    const w = await bus.getProxyObject('org.kde.StatusNotifierWatcher', '/StatusNotifierWatcher');
    await w.getInterface('org.kde.StatusNotifierWatcher').RegisterStatusNotifierItem(name);
  };
  let registered = false;
  const tryRegister = () => register().then(() => { registered = true; }).catch(() => { registered = false; });
  await tryRegister();
  // The watcher goes away and comes back (screen lock, shell restart, extension toggled): register again each time.
  const dbusIface = (await bus.getProxyObject('org.freedesktop.DBus', '/org/freedesktop/DBus')).getInterface('org.freedesktop.DBus');
  dbusIface.on('NameOwnerChanged', (n, _old, owner) => { if (n === 'org.kde.StatusNotifierWatcher') { registered = false; if (owner) tryRegister(); } });
  const retry = setInterval(() => { if (!registered) tryRegister(); }, 5000);
  retry.unref?.();
  bus.on('error', () => {});

  return {
    registered: () => registered,
    update(v) {
      view = v;
      revision++;
      menu.LayoutUpdated(revision, 0);
      item.NewIcon();
      item.NewToolTip();
    },
    close() { clearInterval(retry); try { bus.disconnect(); } catch {} },
  };
}
