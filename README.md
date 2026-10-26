# whatsgrep

Watch selected WhatsApp chats for keyword patterns and get a push notification on your phone or desktop the moment one matches. No more refreshing busy buy/sell, jobs or deals groups.

- Rules are plain YAML: which chats, which words must appear, which words rule a message out.
- Notifications go to your desktop (Linux, macOS, Windows) and/or through [ntfy](https://ntfy.sh) to your phone, with no account. Pick with `notifications` in the config.
- Log in to WhatsApp once with a QR code. After that you start it when you want to track and stop it with Ctrl+C.
- It only listens. It never sends WhatsApp messages and sends no phone numbers to ntfy.

> **Unofficial.** whatsgrep uses [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js), which automates WhatsApp Web. This is against WhatsApp's terms and accounts that automate can be restricted. whatsgrep only reads messages, which is lower risk than sending, but consider using a secondary number. Use at your own risk.

## How it works

```
WhatsApp Web (headless Chromium)  ->  your rules  ->  desktop notification and/or ntfy -> phone
```

### What happens when you run it

1. **Load config.** `config.yaml` is read and validated. If it is missing or invalid, whatsgrep exits with an error. A valid config starts a file watcher so later edits reload live.
2. **Topic.** The ntfy topic is resolved (see [The ntfy topic](#the-ntfy-topic)) and printed, with a subscribe QR code if it is new.
3. **WhatsApp login.** A headless Chromium opens WhatsApp Web. The first time (or after the session expires) it shows a QR code to scan. Otherwise it restores the saved session from `.whatsgrep/`.
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
cp config.example.yaml config.yaml    # then edit your chats and keywords
npm start -- --dry-run --verbose      # first run: scan the QR, watch matches print
```

1. **Link WhatsApp.** A QR code appears. In WhatsApp go to Settings > Linked devices > Link a device and scan it. The session is saved in `.whatsgrep/`, so later runs log in automatically.
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
| `-c, --config <file>` | Rules file. Default `config.yaml` |
| `-t, --topic <value>` | Use this ntfy topic and save it. `random` generates a new one |
| `-s, --server <url>` | ntfy server. Overrides `ntfy.server` in the config. Default `https://ntfy.sh` |
| `-d, --data-dir <dir>` | Folder for the session and saved topic. Default `.whatsgrep` |
| `--dry-run` | Print matches, send no notifications |
| `--verbose` | Print every incoming message with chat name, id, number and delay |
| `--qr` | Print the phone-subscribe QR (also shown automatically when the topic is new) |
| `--check <text>` or `check <text>` | Test your rules against some text, offline, and exit |
| `-h, --help` | Show help |

The `--` after `npm start` is required, otherwise npm swallows the flags.

### The ntfy topic

The topic is the "room" your notifications go to. On public ntfy.sh anyone who knows it can read your alerts, so treat it like a password.

| Command | Result |
|---|---|
| `npm start` | First run generates a random topic and saves it. Later runs reuse it |
| `npm start -- --topic my-long-secret` | Use this topic and overwrite the saved one |
| `npm start -- --topic random` | Generate a new random topic and overwrite the saved one |

After changing the topic, subscribe to the new one in the ntfy app and delete the old subscription. You can self-host ntfy and point `--server` at it (use `http://` only on trusted networks).

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
- `.whatsgrep/` holds your WhatsApp session and ntfy topic. Anyone with it can use your WhatsApp account. It is gitignored. Never commit or share it.
- `config.yaml` is gitignored so your chat names and keywords stay private. Share rules by pasting them, not by committing the file.

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
test/            node:test unit tests
```

Run the tests with `npm test`.

## Contributing

Issues and pull requests are welcome. The matcher is a pure function with tests, so new rule features are easy to add: put the logic in `src/matcher.js` and cover it in `test/matcher.test.js`.

## License

MIT
