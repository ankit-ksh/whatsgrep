# whatsgrep

Watch selected WhatsApp chats and email accounts for keyword patterns and get a notification on your desktop or phone the moment one matches. No more refreshing busy buy/sell, jobs or deals groups, or an inbox.

- Set it up in a friendly local web page (`whatsgrep ui`) or in plain YAML: which chats, which words must appear, which words rule a message out.
- Notifications go to your desktop (Linux, macOS, Windows) and/or to your phones, tablets and laptops as encrypted push alerts, with no account and no server of ours. Pick with `notifications` in the config.
- Log in to WhatsApp once with a QR code, and/or add email accounts. Add as many of each as you like; every rule picks which ones it listens to. Then let it run in the background from login.
- Email is read over IMAP with mail-client-style filters (sender, subject, attachments, size, newsletters, hours). See [Trackers and email](#trackers-and-email).
- It only listens. It never sends WhatsApp messages, never changes your mail, and sends nothing readable to anyone: alerts to your devices are encrypted on your computer, so Google's and Apple's push servers only carry unreadable bytes.

> **Unofficial.** whatsgrep uses [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js), which automates WhatsApp Web. This is against WhatsApp's terms and accounts that automate can be restricted. whatsgrep only reads messages, which is lower risk than sending, but consider using a secondary number. Use at your own risk.

[![release](https://img.shields.io/github/v/release/ankit-ksh/whatsgrep?include_prereleases&label=release)](https://github.com/ankit-ksh/whatsgrep/releases)
[![ci](https://github.com/ankit-ksh/whatsgrep/actions/workflows/ci.yml/badge.svg)](https://github.com/ankit-ksh/whatsgrep/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/ankit-ksh/whatsgrep)](LICENSE)
**Website:** https://ankit-ksh.github.io/whatsgrep/ · **Changelog:** [CHANGELOG.md](CHANGELOG.md)

## Install

Download the file for your system from the [latest release](https://github.com/ankit-ksh/whatsgrep/releases/latest). It is a single program with nothing else to install, apart from a Chrome, Chromium, Edge or Brave browser.

| System | File |
|---|---|
| Windows | `whatsgrep-windows-x64.exe` |
| macOS | `whatsgrep-macos-arm64` (Apple silicon), `whatsgrep-macos-x64` (Intel) |
| Linux | `whatsgrep-linux-x64`, `whatsgrep-linux-arm64` |

Then run `whatsgrep ui`, choose **Log in with QR code**, add a rule, and turn on **Run at login** in Settings.

<details><summary><b>Linux</b></summary>

```sh
chmod +x whatsgrep-linux-x64
mkdir -p ~/.local/bin && mv whatsgrep-linux-x64 ~/.local/bin/whatsgrep
whatsgrep ui
```
Optional: `libnotify` (desktop pop-ups) and `libsecret` (keychain). Run `loginctl enable-linger $USER` to keep the background service running while logged out.
</details>

<details><summary><b>macOS</b></summary>

```sh
chmod +x whatsgrep-macos-arm64
xattr -d com.apple.quarantine whatsgrep-macos-arm64   # unsigned download
mkdir -p ~/.local/bin && mv whatsgrep-macos-arm64 ~/.local/bin/whatsgrep
whatsgrep ui
```
</details>

<details><summary><b>Windows</b></summary>

Save the `.exe` somewhere permanent (the startup task points at it), then in PowerShell run `.\whatsgrep-windows-x64.exe ui`. If SmartScreen warns, choose **More info**, then **Run anyway**.
</details>

> **Status.** The Linux x64 build is used daily by the author. The others are built and smoke-tested on their own operating system on every release, but the interface, login, notifications and background service have only been exercised on Linux so far. Please [open an issue](https://github.com/ankit-ksh/whatsgrep/issues) if something misbehaves.

`whatsgrep --version` prints the version, and `SHA256SUMS.txt` on each release has the checksums. To uninstall, run `whatsgrep service uninstall`, delete the file and your config and data folders, and remove the device under WhatsApp, Linked devices. Versions follow [semver](https://semver.org/); see the [changelog](CHANGELOG.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## How it works

```
WhatsApp Web (headless Chromium)  \
Email (IMAP, kept open)           /->  your rules  ->  desktop notification and/or encrypted push -> your devices
```

### What happens when you run it

1. **Load config.** `config.yaml` is read and validated. If it is missing or invalid, whatsgrep exits with an error. A valid config starts a file watcher so later edits reload live.
2. **Devices.** If device alerts are on and none is paired yet, it says so (see [Alerts on your devices](#alerts-on-your-devices)).
3. **WhatsApp login.** A headless Chromium opens WhatsApp Web. The first time (or after the session expires) it shows a QR code to scan. Otherwise it restores the saved session from the data folder (see [Run it as a program](#run-it-as-a-program)).
4. **Listening.** When it prints `Listening`, every new message that arrives is checked. Messages sent before this point, or while whatsgrep is not running, are never seen. whatsgrep does not read history.
5. **Stop.** Ctrl+C closes the browser cleanly. The session stays saved.

### What happens to each message

For every new message, in order:

1. **Skipped** if it is empty (no text), a status/story update, or a message you sent yourself. The one exception is your own "Message yourself" chat, which is processed so you can test.
2. **Config reload check:** if `config.yaml` changed since the last look, it is reloaded first.
3. **Chat lookup:** whatsgrep finds the chat's name, id and, where known, phone number. Newer WhatsApp hides numbers behind `@lid` ids, which are resolved to the number when WhatsApp knows it.
4. **`--verbose`:** if set, the message is printed with its chat and delay, whether or not any rule matches.
5. **Every rule is tested independently.** A rule fires when both of its sections pass:
   - `from`: the chat passes. At least one `from.any` entry matches (if given), every `from.all` entry matches (if given), and no `from.exclude` entry matches. They are tested against the chat's name, id and (where known) phone number. No `from`, or `from: all`, means every chat.
   - `message`: the text passes by the same three tests, on words.
   - A rule must have something to look for: `message.any` / `message.all`, or `from.any` / `from.all`. Otherwise it is rejected at load time, since it would fire on everything. `message` itself is optional.
6. **Repeat filter:** if the same sender sent the same text for the same rule within `repeat_window_hours`, it is dropped silently. The window slides, so a sender who keeps repeating the message every few hours is never notified again until they stop for a full window. This also applies in `--dry-run`.
7. **Notify:** the match is printed to the terminal as `[rule] chat: text`. Unless `--dry-run`, it is then sent to every method in `notifications` (desktop and/or devices) as title `rule · chat`, body the full message text, with the rule's priority. If a method fails the error is logged and the remaining rules still run.

One message can fire several rules, and you get one notification per rule.

### What applies right away

| Change | Takes effect |
|---|---|
| Rules, `notifications`, `settings.repeat_window_hours` in `config.yaml` | On save, within about half a second |
| Adding, removing, turning off or changing a tracker | On save: only that tracker restarts |
| An invalid saved config | Ignored with a warning, previous settings stay active |
| `browser` | On save: WhatsApp trackers restart to use it |
| Command-line flags such as `--dry-run`, `--verbose` | Only when whatsgrep is started |
| Pairing or removing a device | Immediately |
| Your WhatsApp login | Persisted; restart not needed to keep it |

## Requirements

- Node.js 20 or newer
- Linux, macOS or Windows (a Chromium is downloaded by Puppeteer on `npm install`)
- A WhatsApp account that can link a device
- A device for alerts: Chrome, Edge or Firefox on Android, Windows, Mac or Linux, or Safari on iPhone (iOS 16.4 or later) (optional but the point)

## Quick start

```sh
git clone https://github.com/ankit-ksh/whatsgrep.git && cd whatsgrep
npm install
npm start -- config init    # creates the config in your per-user folder, then edit it (or use `npm start -- ui`)
npm start -- --dry-run --verbose      # first run: scan the QR, watch matches print
```

1. **Link WhatsApp.** A QR code appears. In WhatsApp go to Settings > Linked devices > Link a device and scan it. The session is saved in the data folder, so later runs log in automatically.
2. **Pair a device.** Run `npm start -- devices pair` (or **Delivery > Add device** in the interface) and follow [Alerts on your devices](#alerts-on-your-devices).
3. **Check your rules.** With `--dry-run` matches print in the terminal and nothing is sent. `--verbose` prints every incoming message with its chat name and id, so you can see what to put in `from:`.
4. **Go live.** Stop with Ctrl+C and run `npm start`.

Startup takes up to a minute while WhatsApp Web loads. Messages that arrive before it prints `Listening` are missed.

## Command line

```
npm start -- [options]
```

| Option | Meaning |
|---|---|
| `-c, --config <file>` | Rules file. Default `config.yaml` in the per-user config folder |
| `-d, --data-dir <dir>` | Folder for the session and paired devices. Default: the per-user data folder |
| `--dry-run` | Print matches, send no notifications |
| `--verbose` | Print every incoming message with chat name, id, number and delay |
| `--check <text>` or `check <text>` | Test your rules against some text, offline, and exit |
| `-h, --help` | Show help |

The `--` after `npm start` is required, otherwise npm swallows the flags.

### Alerts on your devices

Alerts to your phones, tablets and laptops use Web Push, the same system browsers use for notifications, with the message encrypted on your computer ([RFC 8291](https://www.rfc-editor.org/rfc/rfc8291)) before it leaves. Google's, Apple's or Mozilla's push server only passes on bytes it cannot read. There is no account and no server of ours: the app is a static page, and your computer sends alerts straight to the push service. The computer running whatsgrep also shows its own native notification (`desktop`), which needs no browser or internet.

The app is one page for every device. It works out whether it is on a phone, a tablet or a laptop and words itself to match. On the device:

1. Open the app (**Delivery > Add device** shows a QR code for its address, or run `whatsgrep devices pair`). Android and desktop: any browser with push, and you may install it. iPhone and iPad: Safari, then Share > Add to Home Screen, and open it from there (iOS only allows alerts for apps added to the Home Screen).
2. Tap **Turn on alerts** and allow notifications.
3. Under **Computers**, tap **Add computer**. The camera opens inside the app: scan the QR code in **Delivery > Add device** on your computer. The app then shows a pairing code.
4. Paste the code under **Delivery > Add device** on that computer (or `whatsgrep devices add <code>`). The device gets a confirmation alert, and the computer shows in its list.

A device can follow several computers (add each one the same way), and a computer can send to several devices. Each computer has a name (**Delivery > This computer**, or `whatsgrep devices name <text>`); the app shows it on every alert once there is more than one computer. The device's own name comes from its model and can be changed in the app.

The pairing code is private: it lets whoever holds it send alerts to that device (not read yours). Paste it only into your own whatsgrep. All your computers share one code per device, so a device cannot cut off just one of them: remove the device in that computer's Delivery page, or turn alerts off in the app to cut off all. `whatsgrep devices` lists paired devices, `devices remove <id>` forgets one, `devices test` sends a test to all of them, `devices test <id>` to one.

The app address defaults to `https://ankit-ksh.github.io/whatsgrep/app/`. To host your own copy of `docs/app/` (or to try changes), set it under `devices:` in the config. `npm run phone-app` serves it locally; a device only receives alerts from a page served over https (or from localhost), so for a real phone put an https tunnel in front of it.

The app keeps the last 200 alerts, readable offline. On Linux a browser must be open to receive. Upgrading from an earlier version: `ntfy` in `notifications:` is ignored with a notice and its saved topic is deleted from your keychain, and `phone` is now called `devices` (the old name still works). Pair a device to get alerts again.

## Run it as a program

whatsgrep can be built into one executable for Windows, macOS or Linux. It needs no Node.js on the target machine, only a Chrome, Chromium, Edge or Brave install (found automatically; override with `--browser <path>`, `browser:` in the config or `WHATSGREP_BROWSER`).

```
npm run build        # -> dist/whatsgrep  (dist/whatsgrep.exe on Windows)
```

Builds are per OS (no cross-compiling). The GitHub workflow in `.github/workflows/release.yml` builds all four on a version tag. Use the official Node.js binary from nodejs.org when building, since distro builds that link shared libraries will not run on other machines. The macOS/Windows builds are unsigned, so expect a Gatekeeper / SmartScreen warning on first launch.

whatsgrep keeps its files in standard per-user folders, so it behaves the same wherever you start it (a terminal, a service, a shortcut) and depends on no project folder:

| OS | Config | Session + state |
|---|---|---|
| Linux | `~/.config/whatsgrep/` | `~/.local/share/whatsgrep/` |
| macOS | `~/Library/Application Support/whatsgrep/` | same |
| Windows | `%APPDATA%\whatsgrep\` | `%LOCALAPPDATA%\whatsgrep\` |

Override with `--config <file>` and `--data-dir <dir>`. If you used an older version that kept `config.yaml` and `.whatsgrep` in the folder you ran it from, run `whatsgrep migrate` in that folder to copy them over (the originals are left alone; `--from DIR` picks another folder, `--force` replaces existing files). If WhatsApp asks you to link again after migrating, scan the QR once more.

### First run, then keep it on

```
whatsgrep config init     # create the config in the per-user folder
whatsgrep                 # run once in a terminal and scan the WhatsApp QR
whatsgrep service install # then start it at login and restart it if it stops
```

`service install` creates a systemd user service (Linux), a launchd agent (macOS) or a scheduled task (Windows). Also: `service uninstall|start|stop|restart|status`. On Linux, run `loginctl enable-linger $USER` to keep it running when you are logged out. A service never asks for a QR scan: if the WhatsApp login is lost it exits with code 2 and stays stopped until you run `whatsgrep` once in a terminal. A dropped connection or a closed browser exits with code 1 and the service restarts it.

### Settings in your browser

```
whatsgrep ui              # opens http://127.0.0.1:<port>/ with a one-time access link
```

Everything can be changed there, with no config file editing. Switches and fields on the Notifications and Settings pages only stage a change; nothing is applied until you press the common **Save changes** bar (or **Discard**): start/stop the tracker, link WhatsApp (the login QR is shown on the page), build rules from conditions instead of YAML (a rule starts empty; **Add condition** for sender, subject, body, attachment and so on; each can be *is exactly*, *contains* or *matches pattern*; anything you do not add is ignored; the rule reads back as a sentence, and a "try it" box tests a sample live), choose desktop and/or device notifications, send a test notification, pair devices, set the repeat window and browser, and turn **Run at login** on or off. The **Advanced** tab has the config file as text and the log.

It is the same `config.yaml` underneath, so you can edit by hand whenever you like; the UI keeps your header comments and any rule you did not touch exactly as written (comments inside a rule you save from the UI are not kept). Hand edits and UI edits can be mixed: a running tracker reloads rules by itself.

The page only listens on `127.0.0.1`, needs the random token from the link whatsgrep prints, and rejects requests from other sites. Use `--no-open` to just print the link, `--port N` for a fixed port. Closing the UI does not stop the tracker.

### Commands and the shell

`whatsgrep shell` opens a prompt (`whatsgrep>`) that takes every command below. Each also works one-shot, e.g. `whatsgrep config get notifications`.

| Command | What it does |
|---|---|
| `status` | Running or not, connection state, matches so far |
| `config show / path / edit / init` | View, locate, edit (in `$EDITOR`) or create the config |
| `config get <key>` | e.g. `config get settings.repeat_window_hours` |
| `config set <key> <value>` | e.g. `config set notifications desktop,devices`. Keeps your comments; refuses a value that would break the config |
| `config unset <key>` | Remove a setting |
| `rules list / show <name> / remove <name>` | Inspect and delete rules |
| `rules add <name> [--from a,b] [--any x,y] [--priority high]` | Add a simple rule (use the file for complex ones) |
| `check <text>` | Which rules match this text |
| `devices [list / pair / add <code> / remove <id> / test [<id>] / name <text>]` | Phones, tablets and laptops that get alerts (`phone` still works) |
| `ui [--port N] [--no-open]` | The settings page above |
| `migrate [--from DIR] [--force]` | Copy an old `./config.yaml` + `./.whatsgrep` into the standard folders |
| `service ...` | Background service, see above |

A running tracker applies every edit by itself, so there is nothing to restart.

### Where secrets are kept

Email passwords are stored in your OS keychain: macOS Keychain, Windows Credential Manager, or the Secret Service on Linux (GNOME Keyring / KWallet, via `secret-tool` from `libsecret-tools`). Paired devices (their push address and keys) are in `devices.json` in the data folder, readable only by you. The WhatsApp session itself is a browser profile and stays in the data folder, so treat that folder as a secret.

### Tray icon (Linux and Windows)

```
whatsgrep tray            # show a status icon: green listening, amber starting, red needs login, grey stopped
whatsgrep tray enable     # show it at every login
whatsgrep start | stop | restart
```

Click the icon to start, stop or restart tracking, open the interface, or turn "show at login" on or off. Quitting the icon never stops tracking. On GNOME it needs the "AppIndicator and KStatusNotifierItem Support" extension (the one Flameshot and Clipboard Indicator use). There is no macOS icon yet; use `whatsgrep ui` or the commands.

## Trackers and email

Everything whatsgrep watches is a **tracker**: a WhatsApp account or an email account. List them under `trackers:` in the config, or manage them on the Trackers page of the interface.

```
whatsgrep tracker list
whatsgrep tracker add whatsapp "Second phone"
whatsgrep tracker add email "Work Gmail" --user you@gmail.com     # asks for the password
whatsgrep tracker test "Work Gmail"         # check the login
whatsgrep tracker disable|enable|remove <name>
```

- **Passwords** go in your OS keychain, never in the config file. On a machine without a keychain, set `WHATSGREP_EMAIL_PASSWORD_<ID>` instead (the id is the tracker name in capitals with dashes).
- **App passwords.** Gmail, Outlook.com, Yahoo, iCloud and Fastmail block your normal password for IMAP. Create an app password in the account's security settings (the account form links the right place). Work or school Microsoft accounts usually block this and are not supported yet.
- **Read-only.** The mailbox is opened read-only: nothing is marked as read, moved or deleted, and nothing is sent.
- **Instant.** whatsgrep keeps an IMAP connection open (IDLE), so new mail is seen within a second or two. After downtime it catches up on unread mail from the last 24 hours.
- **Independent.** Each tracker runs on its own. A tracker that needs a login, or loses its connection, retries or waits without touching the others.
- **Rules choose trackers** with `on:` (`all`, or a list of tracker names). A rule with no `on:` listens to WhatsApp only, as before. `from` matches the sender (name or address) for email, and `message` matches the subject and body.

Email-only conditions go under `email:` in a rule:

| Key | Meaning |
|---|---|
| `to` | recipients (To and Cc), same `any` / `all` / `exclude` form as `from` |
| `subject` | words in the subject only. `equals: ["Invoice 4821"]` matches the whole subject |
| `body` | words in the text of the mail, without the subject |
| `attachment` | `true`, `false`, or a list of file types (`pdf`) or `contains:name` |
| `larger_than`, `smaller_than` | message size: `500KB`, `2MB`, `1GB` |
| `not_bulk` | skip mailing lists, newsletters and auto-replies |
| `verified` | the sender passed SPF, DKIM or DMARC at the receiving server |
| `important` | marked high priority by the sender |
| `during` | `{days: [mon, tue], from: "09:00", to: "18:00"}`: only alert in this window |

The rule editor's "Check against my recent mail" shows which of your last 50 emails a rule would have caught, before you save it.

### Trying things out safely

`whatsgrep --profile test ui` runs a separate copy: its own config, sessions and keychain entries (folders named `whatsgrep-test` beside the real ones). It never touches your installed service, and `service` and `tray` are refused. Enter passwords in the interface as usual. `whatsgrep --profile test reset` removes the profile, including its keychain entries.

## Writing rules

`config.yaml` (copy [config.example.yaml](config.example.yaml), which is documented section by section) has three sections:

| Section | Purpose |
|---|---|
| `notifications` | List of where alerts go: `desktop` (native notification on this computer: `notify-send` on Linux, `osascript` on macOS, a PowerShell toast on Windows) and/or `devices` (encrypted push to your paired devices). Default `[desktop]` |
| `devices` | `app`: the address of the app (default `https://ankit-ksh.github.io/whatsgrep/app/`) |
| `settings` | `repeat_window_hours`: notify once per sender and text in this window (default `0` = off: every match alerts) |
| `rules` | What to watch for. Everything below. The other two sections are optional |

Paired devices are deliberately not in the file, so you can share your config without leaking them.

```yaml
settings:
  repeat_window_hours: 0
rules:
  - name: items-for-sale
    from:                                     # WHICH chats
      any:                                    #   must be one of these
        exact: ["Neighbourhood Market"]
        contains: ["classifieds"]
      exclude:                                #   and not one of these
        contains: ["archive"]
    message:                                  # WHAT the text says
      any:                                    #   the topic: at least one of these
        exact: [laptop, phone, bike]          #     whole words
        contains: [notebook, mobile]          #     anywhere in a word
        re: ["rs\\.?\\s*\\d+"]                #     regex, e.g. a price like "Rs 5000"
      all:                                    #   the intent: every line must hold
        - [sell, selling, sale, "for sale"]   #     (one of these)
      exclude:                                #   and none of these
        exact: [buy, buying, wtb, need, wanted]
        contains: ["looking for", "anyone selling"]
    priority: high
```

| Field | Meaning |
|---|---|
| `name` | Shown in the notification title. Required |
| `from` | Which chats. Takes `any` / `all` / `exclude`. Omit, or write `from: all`, for every chat |
| `message` | What the text must contain. Takes `any` / `all` / `exclude`. Optional |
| `priority` | `min`, `low`, `default`, `high`, `urgent`. Controls how loudly alerts sound on your devices |

`from` and `message` use the same three words:

| | Meaning |
|---|---|
| `any` | At least one of these matches |
| `all` | Every entry matches. An entry is one value, or a `[list]` where any one is enough |
| `exclude` | None of these match. Anything that matches rules the message or chat out |

Within a section the parts are combined with AND, so `message: {any: [laptop, phone], exclude: [wanted]}` means "has laptop or phone, and does not have wanted". The two sections are also ANDed. (`none` still works as an older name for `exclude`.)

A rule needs something to look for: `message.any` / `message.all`, or `from.any` / `from.all`. So a rule with only `from: ["Hostel Announcements"]` notifies on every message from that chat, with no `message` section at all.

**Short forms**
- `message: [laptop, phone]` means `message: {any: [laptop, phone]}`.
- `from: "Mess"` or `from: [Mess, "contains:market"]` means any of those chats.
- `any` and `exclude` can be a plain list (using prefixes like `"contains:x"`) or grouped by kind (`exact`, `equals`, `contains`, `re`), as in the example above. Writing `exact`, `contains` or `re` directly inside `from` or `message` is a shorthand that adds to `any`.
- `all` can also be `{contains: [sell, laptop]}`, meaning every listed entry must match.

Older configs that use `chats:` and put `any` / `all` / `none` directly on the rule still work.

### Words in `message`

Each word or phrase is matched one of four ways, always case-insensitively:

| Form | Meaning | Example |
|---|---|---|
| plain, or `exact:x` | Whole word or phrase. Spaces in a phrase match any whitespace | `bike` matches "my bike", not "bikes" or "motorbike" |
| `contains:x` | Anywhere, including inside longer words | `contains:bike` matches "motorbike" and "bikes" |
| `equals:x` | The whole text is exactly this (a whole subject, say) | `equals:Invoice 4821` matches "Invoice 4821", not "Re: Invoice 4821" |
| `re:x` | A raw regex | `re:bikes?` matches "bike" and "bikes" |

Whole-word matching means you list each form you want: `sell, selling, sold`, or use `contains:sell` to catch them all (and also "reseller"). A regex has no automatic word boundaries; add `\\b` in a quoted YAML string if you want them: `"re:\\bsell\\w*"`.

### Chats in `from`

Each entry is one of:

| Entry | Matches |
|---|---|
| `"Project Chat"` | The chat with exactly this name (case-insensitive) |
| `"exact:Project Chat"` | Same, written explicitly |
| `"contains:market"` | Any chat whose name includes this text |
| `"re:^team .*"` | Any chat whose name matches this regex |
| `"919876543210"` | The 1-to-1 chat with this number. Country code is optional, and `+`, spaces and dashes are ignored |
| `"120363012345@g.us"` | A specific chat by id |

A list of those is "any of these chats". To mix kinds, group them, and `exclude` chats you never want:

```yaml
from:
  any:
    exact: ["Project Chat", "919876543210"]
    contains: ["market", "classifieds"]
    re: ["^team .*"]
  exclude:
    contains: ["archive"]
```

`from.all` requires every entry to match the same chat (for example `all: ["contains:hostel", "contains:market"]`). A `from` with only `exclude` means every chat except those.

To watch every chat write `from: all` (`everywhere`, `any`, `"*"` also work, as does omitting `from`). A chat literally named "all" can be matched with `exact:all`.

Plain entries are exact, so be explicit when you want looser matching. Keep `contains:` entries long enough to be distinctive, since `contains:sell` matches every chat with "sell" in its name. Phone numbers only match direct chats; for a group use its name or id. Run with `--verbose` to see the name and id of every chat you receive from.

### Covering common cases in `message`

| Situation | How to handle it |
|---|---|
| Different forms of a word | `contains:` with a stem: `contains:breakf` catches breakfast and breakfasts |
| Typos or spelling variants | `re:`, for example `re:s+r+r` |
| A price or number | `re:` such as `rs\\.?\\s*\\d+` |
| A phrase with odd spacing | A plain phrase (`"for sale"`) already allows any spacing |
| Buyer posts mixed in with sellers | `exclude` with phrases like `anyone selling`, not just `anyone`, so "selling, anyone interested" still gets through |
| Two things that must both appear | Two entries in `all` |
| Word order or distance | A regex, for example `re:sell.{0,20}coupon` |

Non-English words: the whole-word check only recognises English letters, digits and `_`, so a word in another script is matched anywhere in the text even with `exact:`. Emoji and symbols work as plain terms.

### Live reload and testing

Saving `config.yaml` reloads the rules within about half a second and prints `Reloaded config.yaml (N rules)`. If the new file is invalid (bad YAML or a bad regex) the previous rules stay active and a warning is printed.

Try wording without touching WhatsApp. This ignores `from` and tests only the `message` section of every rule against your text, then exits. Rules with no `message` section are skipped, since they match any text:

```sh
npm start -- check "selling thinkpad laptop"        # match: gear-for-sale
npm start -- check "anyone selling laptop"          # no match
```

## Testing the whole chain from your own phone

WhatsApp's "Message yourself" chat is processed too. Add your own number to `from:`, run `--dry-run`, and send yourself a message that should match. Your own messages in other chats are ignored. Identical text from the same sender is notified only once per `repeat_window_hours` (6 by default), so vary the wording between tests or set it to `0` while testing.

## Troubleshooting

| Problem | What to do |
|---|---|
| Stuck before `Listening` | WhatsApp Web is still loading. Wait a minute. If it stays stuck, press Ctrl+C and start again |
| QR code appears again | The saved session expired or you logged out on your phone. Scan again |
| Nothing matches | Run with `--dry-run --verbose`, send a message, and compare the printed chat name and id with `from:`. Check wording with `check "..."` |
| Chat shows as `?` | The name lookup failed. Copy the id from the `--verbose` line into `from:` |
| Chat id ends in `@lid` | Newer WhatsApp uses anonymous ids. whatsgrep resolves them to a number when it can, shown as `+number` in `--verbose` |
| Matches print but the phone is silent | You are in `--dry-run`, `devices` is not in `notifications`, or no device is paired (`whatsgrep devices`) |
| Notification arrives late | `--verbose` shows seconds between send and receipt. Large numbers mean WhatsApp delivered it late. Small numbers mean the delay is in the push service or your phone. On Android, do not restrict the browser's or app's background activity; on iPhone, check Focus modes |
| `r: r` errors from whatsapp-web.js | A WhatsApp Web update broke part of the library. whatsgrep avoids the affected calls. Update with `npm update whatsapp-web.js` and open an issue if it persists |
| Chromium fails to launch (Linux) | Install the browser libraries Puppeteer needs (for Debian/Ubuntu: `libnss3`, `libatk-bridge2.0-0`, `libgbm1`, `libasound2`) |

## Privacy and safety

- Alerts to your devices carry the rule name, chat name and message text, encrypted so only your phone can read them. The push service sees only that something was sent, when, and roughly how large.
- Everything else stays on your machine. Message text is not stored.
- The data folder (`~/.local/share/whatsgrep`, or see the table above) holds your WhatsApp session. Anyone with it can use your WhatsApp account. Never share it. It lives outside any project, so it cannot be committed by accident.
- Your config lives in your per-user config folder, outside any project, so your chat names and keywords are not committed by accident. Share rules by pasting them.

## Limitations

- Needs a computer running while you track. It is not a hosted service.
- Sees only new text messages while it is running. No history, edits, deletions, reactions or media content.
- Chat names are read from WhatsApp Web's internals, which can change; chats can always be matched by id as a fallback.
- Relies on an unofficial library, so a WhatsApp Web update can break it until the library is fixed.

## Project layout

```
src/cli.js            entry: reads options, runs a command or the tracker
src/core/             config, rules and matching, notifications, status files, paths, secrets
src/trackers/         what is watched: whatsapp.js and email/ (one file per kind, same contract)
src/runtime/run.js    the tracker process: runs every tracker, alerts, keeps status, reloads config
src/commands/         the command line and shell: config, rules, trackers, status
src/system/           background service setup, starting and stopping, browser detection
src/server/           the local interface API
src/ui/               the interface: a React and TypeScript app, built into one page
src/tray/             the status icon for Linux and Windows
scripts/build.js      builds the single executable
docs/                 the project website (GitHub Pages)
.github/              CI, release and Pages workflows
test/                 node:test unit tests
```

Run the tests with `npm test` and the type check with `npm run typecheck`.

## Contributing

Issues and pull requests are welcome. The matcher is a pure function with tests, so new rule features are easy to add: put the logic in `src/matcher.js` and cover it in `test/matcher.test.js`.

## License

MIT
