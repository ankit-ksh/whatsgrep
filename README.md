# whatsgrep

Watch selected WhatsApp chats for keyword patterns and get a push notification on your phone or desktop the moment one matches. No more refreshing busy buy/sell, jobs or deals groups.

- Set it up in a friendly local web page (`whatsgrep ui`) or in plain YAML: which chats, which words must appear, which words rule a message out.
- Notifications go to your desktop (Linux, macOS, Windows) and/or through [ntfy](https://ntfy.sh) to your phone, with no account. Pick with `notifications` in the config.
- Log in to WhatsApp once with a QR code, then let it run in the background from login.
- It only listens. It never sends WhatsApp messages and sends no phone numbers to ntfy.

> **Unofficial.** whatsgrep uses [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js), which automates WhatsApp Web. This is against WhatsApp's terms and accounts that automate can be restricted. whatsgrep only reads messages, which is lower risk than sending, but consider using a secondary number. Use at your own risk.

[![release](https://img.shields.io/github/v/release/ankit-ksh/whatsgrep?include_prereleases&label=release)](https://github.com/ankit-ksh/whatsgrep/releases)
[![ci](https://github.com/ankit-ksh/whatsgrep/actions/workflows/ci.yml/badge.svg)](https://github.com/ankit-ksh/whatsgrep/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/ankit-ksh/whatsgrep)](LICENSE)
**Website:** https://ankit-ksh.github.io/whatsgrep/ · **Changelog:** [CHANGELOG.md](CHANGELOG.md)

## Install

Download the file for your system from the [latest release](https://github.com/ankit-ksh/whatsgrep/releases/latest). Each is a single program that needs no Node.js. The only requirement is a Chrome, Chromium, Edge or Brave browser, which whatsgrep finds automatically (see `--browser` if yours is somewhere unusual).

| System | File | Status |
|---|---|---|
| Linux, 64-bit x86 | `whatsgrep-linux-x64` | Used day to day by the author |
| Linux, ARM 64-bit | `whatsgrep-linux-arm64` | Built and smoke-tested on every release |
| macOS, Apple silicon | `whatsgrep-macos-arm64` | Built and smoke-tested on every release |
| macOS, Intel | `whatsgrep-macos-x64` | Built and smoke-tested on every release |
| Windows, 64-bit | `whatsgrep-windows-x64.exe` | Built and smoke-tested on every release |

"Smoke-tested" means CI runs the real executable on that operating system (version, config, rules and rule checking). The interface, the WhatsApp login, notifications and the background service have so far been exercised on Linux only, so please [open an issue](https://github.com/ankit-ksh/whatsgrep/issues) if something misbehaves elsewhere. The programs are not code-signed.

### Linux

```sh
chmod +x whatsgrep-linux-x64
mkdir -p ~/.local/bin && mv whatsgrep-linux-x64 ~/.local/bin/whatsgrep
whatsgrep ui
```

Optional: `libnotify` (`notify-send`) for desktop pop-ups and `libsecret` (`secret-tool`) so secrets go in your keychain. Without the keychain they fall back to a file only you can read. Run `loginctl enable-linger $USER` if the background service should keep running while you are logged out.

### macOS

```sh
chmod +x whatsgrep-macos-arm64
xattr -d com.apple.quarantine whatsgrep-macos-arm64   # the download is unsigned
mkdir -p ~/.local/bin && mv whatsgrep-macos-arm64 ~/.local/bin/whatsgrep
whatsgrep ui
```

Allow notifications when macOS asks. Add `~/.local/bin` to your `PATH` if `whatsgrep` is not found.

### Windows

Save `whatsgrep-windows-x64.exe` somewhere permanent (the startup task points at it), then in PowerShell:

```powershell
.\whatsgrep-windows-x64.exe ui
```

If SmartScreen warns about an unknown app, choose **More info**, then **Run anyway**.

### First run (all systems)

1. `whatsgrep ui` opens the interface in your browser.
2. On the Overview page choose **Log in with QR code** and scan it in WhatsApp: Settings, Linked devices, Link a device.
3. Add a rule on the **Rules** page and pick where alerts go on **Delivery**.
4. Turn on **Run at login** under Settings so it is always on.

### Verify, update, uninstall

- Each release has a `.sha256` file per download: `sha256sum -c whatsgrep-linux-x64.sha256` (macOS: `shasum -a 256 -c`).
- `whatsgrep --version` prints the version. To update, replace the file with a newer one and run `whatsgrep service restart` if the background service is on.
- To remove it: `whatsgrep service uninstall`, delete the file, then delete your config and data folders (see the table under [Run it as a program](#run-it-as-a-program)). Also remove the linked device in WhatsApp under Settings, Linked devices.

Versions follow [semantic versioning](https://semver.org/); see the [changelog](CHANGELOG.md). Working from source instead? See [CONTRIBUTING.md](CONTRIBUTING.md).

## How it works

```
WhatsApp Web (headless Chromium)  ->  your rules  ->  desktop notification and/or ntfy -> phone
```

### What happens when you run it

1. **Load config.** `config.yaml` is read and validated. If it is missing or invalid, whatsgrep exits with an error. A valid config starts a file watcher so later edits reload live.
2. **Topic.** The ntfy topic is resolved (see [The ntfy topic](#the-ntfy-topic)) and printed, with a subscribe QR code if it is new.
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
7. **Notify:** the match is printed to the terminal as `[rule] chat: text`. Unless `--dry-run`, it is then sent to every method in `notifications` (desktop and/or ntfy) as title `rule · chat`, body the full message text, with the rule's priority. If a method fails the error is logged and the remaining rules still run.

One message can fire several rules, and you get one notification per rule.

### What is live and what needs a restart

| Change | Takes effect |
|---|---|
| Rules, `settings.repeat_window_hours` in `config.yaml` | On save, within about half a second |
| An invalid saved config | Ignored with a warning, previous settings stay active |
| `notifications`, `ntfy.server`, `--topic`, `--server`, `--dry-run`, `--verbose` | After restart |
| Your WhatsApp login | Persisted; restart not needed to keep it |

## Requirements

- Node.js 20 or newer
- Linux, macOS or Windows (a Chromium is downloaded by Puppeteer on `npm install`)
- A WhatsApp account that can link a device
- The [ntfy app](https://ntfy.sh) on your phone (optional but the point)

## Quick start

```sh
git clone https://github.com/ankit-ksh/whatsgrep.git && cd whatsgrep
npm install
npm start -- config init    # creates the config in your per-user folder, then edit it (or use `npm start -- ui`)
npm start -- --dry-run --verbose      # first run: scan the QR, watch matches print
```

1. **Link WhatsApp.** A QR code appears. In WhatsApp go to Settings > Linked devices > Link a device and scan it. The session is saved in the data folder, so later runs log in automatically.
2. **Subscribe on your phone.** whatsgrep prints a second, smaller QR for your ntfy topic. Scan it with your phone camera to open the ntfy app and subscribe. Or add the printed topic by hand: in the ntfy app tap **+**, paste the topic, keep the server as `ntfy.sh`.
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
| `-t, --topic <value>` | Use this ntfy topic. Default is a new random topic every run |
| `-r, --resume` | Reuse the ntfy topic from the last run |
| `-s, --server <url>` | ntfy server. Overrides `ntfy.server` in the config. Default `https://ntfy.sh` |
| `-d, --data-dir <dir>` | Folder for the session and saved topic. Default: the per-user data folder |
| `--dry-run` | Print matches, send no notifications |
| `--verbose` | Print every incoming message with chat name, id, number and delay |
| `--qr` | Print the phone-subscribe QR (shown automatically unless `--resume`) |
| `--check <text>` or `check <text>` | Test your rules against some text, offline, and exit |
| `-h, --help` | Show help |

The `--` after `npm start` is required, otherwise npm swallows the flags.

### The ntfy topic

The topic is the "room" your notifications go to. On public ntfy.sh anyone who knows it can read your alerts, so treat it like a password.

| Command | Result |
|---|---|
| `npm start` | Generates a new random topic every run and shows the subscribe QR. The topic is saved as the "last" one |
| `npm start -- --resume` | Reuse the topic from the last run (no new subscription needed) |
| `npm start -- --topic my-long-secret` | Use this topic (and save it as the last one) |

After changing the topic, subscribe to the new one in the ntfy app and delete the old subscription. You can self-host ntfy and point `--server` at it (use `http://` only on trusted networks).

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

Everything can be changed there, with no config file editing. Switches and fields on the Notifications and Settings pages only stage a change; nothing is applied until you press the common **Save changes** bar (or **Discard**): start/stop the tracker, link WhatsApp (the login QR is shown on the page), build rules with chips instead of YAML (with a "try it" box that tests a sample message live), choose desktop and/or phone notifications, send a test notification, show the ntfy subscribe QR, set the repeat window and browser, and turn **Run at login** on or off. The **Advanced** tab has the config file as text and the log.

It is the same `config.yaml` underneath, so you can edit by hand whenever you like; the UI keeps your header comments and any rule you did not touch exactly as written (comments inside a rule you save from the UI are not kept). Hand edits and UI edits can be mixed: a running tracker reloads rules by itself.

The page only listens on `127.0.0.1`, needs the random token from the link whatsgrep prints, and rejects requests from other sites. Use `--no-open` to just print the link, `--port N` for a fixed port. Closing the UI does not stop the tracker.

### Commands and the shell

`whatsgrep shell` opens a prompt (`whatsgrep>`) that takes every command below. Each also works one-shot, e.g. `whatsgrep config get notifications`.

| Command | What it does |
|---|---|
| `status` | Running or not, connection state, matches so far |
| `config show / path / edit / init` | View, locate, edit (in `$EDITOR`) or create the config |
| `config get <key>` | e.g. `config get settings.repeat_window_hours` |
| `config set <key> <value>` | e.g. `config set notifications desktop,ntfy`. Keeps your comments; refuses a value that would break the config |
| `config unset <key>` | Remove a setting |
| `rules list / show <name> / remove <name>` | Inspect and delete rules |
| `rules add <name> [--from a,b] [--any x,y] [--priority high]` | Add a simple rule (use the file for complex ones) |
| `check <text>` | Which rules match this text |
| `topic [forget]` | Show or delete the saved ntfy topic |
| `ui [--port N] [--no-open]` | The settings page above |
| `migrate [--from DIR] [--force]` | Copy an old `./config.yaml` + `./.whatsgrep` into the standard folders |
| `service ...` | Background service, see above |

A running tracker reloads rule edits by itself. `notifications` and `ntfy` changes need `service restart`.

### Where secrets are kept

The ntfy topic works like a password on public ntfy.sh, so it is stored in your OS keychain: macOS Keychain, Windows Credential Manager, or the Secret Service on Linux (GNOME Keyring / KWallet, via `secret-tool` from `libsecret-tools`). With no usable keychain (a headless Linux box) it falls back to `state.json` readable only by you, and startup says so. The WhatsApp session itself is a browser profile and stays in the data folder, so treat that folder as a secret.

## Writing rules

`config.yaml` (copy [config.example.yaml](config.example.yaml), which is documented section by section) has three sections:

| Section | Purpose |
|---|---|
| `notifications` | List of where alerts go: `desktop` (native notification on this computer: `notify-send` on Linux, `osascript` on macOS, a PowerShell toast on Windows) and/or `ntfy` (phone). Default `[ntfy]`. ntfy's topic, QR code and server are only set up if `ntfy` is listed. Needs a restart to change |
| `ntfy` | `server`: the ntfy server to publish to (default `https://ntfy.sh`). The `--server` flag overrides it |
| `settings` | `repeat_window_hours`: notify once per sender and text in this window (default `6`, `0` = off) |
| `rules` | What to watch for. Everything below. The other two sections are optional |

The topic is deliberately not in the file, so you can share your config without leaking it.

```yaml
ntfy:
  server: https://ntfy.sh
settings:
  repeat_window_hours: 6
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
| `priority` | `min`, `low`, `default`, `high`, `urgent`. Controls how loudly ntfy alerts |

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
- `any` and `exclude` can be a plain list (using prefixes like `"contains:x"`) or grouped by kind (`exact`, `contains`, `re`), as in the example above. Writing `exact`, `contains` or `re` directly inside `from` or `message` is a shorthand that adds to `any`.
- `all` can also be `{contains: [sell, laptop]}`, meaning every listed entry must match.

Older configs that use `chats:` and put `any` / `all` / `none` directly on the rule still work.

### Words in `message`

Each word or phrase is matched one of three ways, always case-insensitively:

| Form | Meaning | Example |
|---|---|---|
| plain, or `exact:x` | Whole word or phrase. Spaces in a phrase match any whitespace | `bike` matches "my bike", not "bikes" or "motorbike" |
| `contains:x` | Anywhere, including inside longer words | `contains:bike` matches "motorbike" and "bikes" |
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
| Matches print but the phone is silent | You are in `--dry-run`, or you are not subscribed to the exact topic printed at startup |
| Notification arrives late | `--verbose` shows seconds between send and receipt. Large numbers mean WhatsApp delivered it late. Small numbers mean the delay is in ntfy or your phone. On Android, exclude ntfy from battery optimisation |
| `r: r` errors from whatsapp-web.js | A WhatsApp Web update broke part of the library. whatsgrep avoids the affected calls. Update with `npm update whatsapp-web.js` and open an issue if it persists |
| Chromium fails to launch (Linux) | Install the browser libraries Puppeteer needs (for Debian/Ubuntu: `libnss3`, `libatk-bridge2.0-0`, `libgbm1`, `libasound2`) |

## Privacy and safety

- Only the rule name, chat name and message text are sent to ntfy. No phone numbers or sender names.
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
src/cli.js       arguments, WhatsApp client, message handling, config reload
src/config.js    config file parsing (sections, defaults, validation)
src/matcher.js   rule compilation and matching (pure, unit tested)
src/state.js     ntfy topic generation and persistence
src/notify.js    desktop + ntfy senders
src/secrets.js   OS keychain access
src/commands.js  config / rules / status commands (CLI + shell)
src/shell.js     interactive prompt
src/server.js    local web UI API
src/ui/index.html the web UI page
src/ruleform.js  rule <-> UI form conversion
src/control.js   start/stop the tracker, read its log
src/service.js   systemd / launchd / Task Scheduler setup
src/browser.js   finds an installed Chrome-family browser
src/paths.js     per-OS default folders
scripts/build.js builds the single executable
docs/            the project website (GitHub Pages)
.github/         CI, release and Pages workflows
test/            node:test unit tests
```

Run the tests with `npm test`.

## Contributing

Issues and pull requests are welcome. The matcher is a pure function with tests, so new rule features are easy to add: put the logic in `src/matcher.js` and cover it in `test/matcher.test.js`.

## License

MIT
