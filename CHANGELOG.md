# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed
- **Nothing asks you to restart any more.** Notifications, rules, the repeat window and trackers apply as soon as you save. Changing the browser setting restarts only the WhatsApp trackers.
- **Alerts to your devices are now encrypted Web Push, replacing ntfy.** Alerts are encrypted on your computer (RFC 8291) and sent straight to Google's, Apple's or Mozilla's push service, which only sees unreadable bytes. No account, no topic, no server of ours. Works on Android, iPhone (iOS 16.4+, added to the Home Screen), tablets and laptops. The computer running whatsgrep keeps its own native notification. The setting is `devices` (it was briefly `phone`, which still works).
- `ntfy` in `notifications:` is ignored with a notice and its saved topic is deleted. The default is now `[desktop]`. The `--topic`, `--resume`, `--server` and `--qr` options and the `topic` command are gone.
- The log now timestamps every line, records the reason WhatsApp gives when it ends a link, and no longer says "from the phone" when it cannot know. A saved session that briefly shows a login code is given 45 seconds to restore before it is reported as not linked, and a leftover browser is asked to close before it is force-stopped.

### Added
- **Add tracker** is one button that lists everything that can be watched. WhatsApp opens a two-pane popup (details, then the login code) and you can add as many accounts as you like.
- **Rules are built from conditions.** A new rule starts empty; **Add condition** picks sender, subject, body, recipient, attachment, size, time of day and so on. Whatever you do not add is ignored. Each condition says *is exactly*, *contains*, *has the word* or *matches pattern*, and the rule reads back as a sentence ("Sender is “ceo@boss.com” and subject is exactly “Invoice 4821”").
- `equals:` matches a whole subject or text exactly, and `email: {body: ...}` matches the body without the subject.
- **The app** (`docs/app`, served by GitHub Pages) is one page for every device and words itself for a phone, tablet or laptop. A bottom bar has Alerts and Computers. A device can follow several computers, **Add computer** scans the QR code with the camera inside the app, and each alert shows which computer it came from. Keeps the last 200 alerts and works offline. `npm run phone-app` serves it locally for testing.
- `whatsgrep devices [list | pair | add <code> | remove <id> | test | name <text>]`. Each computer can be named under Delivery.
- **Profiles.** `whatsgrep --profile test ui` runs a separate copy with its own config, data and keychain entries, so you can try a new version next to your real install. It never installs the background service or the tray icon. `whatsgrep --profile test reset` deletes it completely.
- **Email.** Watch a mailbox over IMAP and alert the moment mail arrives. It only reads: nothing is marked read, moved or deleted. Passwords are kept in the OS keychain. Works with Gmail, Outlook, Yahoo, iCloud, Fastmail and any IMAP server.
- **Trackers.** Everything watched is now a tracker: several WhatsApp accounts and several mailboxes at once. Each is separate, so one failing or needing a login never stops the others. Add, change and remove trackers while it runs. Rules choose which trackers they listen to with `on:`.
- **Email filters** in the style of a mail client: recipient, subject, attachments (by type or name), size, not a newsletter or auto-reply, verified sender, marked important, and days and hours. A "Check against my recent mail" button shows which of your last 50 emails a rule would have caught.
- Commands: `tracker list|add|remove|enable|disable|password|test|link`, `rules add --on`, plus `start`, `stop` and `restart`.
- Tray icon for Linux (GNOME AppIndicator, KDE) and Windows. Commands: `tray`, `tray enable|disable|stop|status`.
- Type checking for the interface (`npm run typecheck`).

### Changed
- **Nothing asks you to restart any more.** Notifications, rules, the repeat window and trackers apply as soon as you save. Changing the browser setting restarts only the WhatsApp trackers.
- The interface is rebuilt with React and TypeScript, with the same look. A page that fails now shows its error instead of a blank screen.
- The code is organised into modules: `core`, `trackers`, `runtime`, `commands`, `system`, `server`, `tray`, `ui`.
- A lost WhatsApp connection is retried inside the program, with growing waits, instead of exiting for the service to restart it.

### Added
- Tray icon for Linux (GNOME AppIndicator, KDE) and Windows: start, stop, restart, open the interface, show at login. Commands: `tray`, `tray enable|disable|stop|status`.
- `start`, `stop` and `restart` commands.

## [0.2.1]

### Changed
- **Nothing asks you to restart any more.** Notifications, rules, the repeat window and trackers apply as soon as you save. Changing the browser setting restarts only the WhatsApp trackers.
- Linux builds strip the embedded Node runtime (about 20 MB smaller).
- A new config starts with no rules; the interface has a Help page explaining how to write them.
- The repeat filter is off by default, so every matching message alerts you. Set hours under Settings to turn it on.

### Fixed
- Windows "Run at login": the startup task is now created for the current user only (no administrator rights or password prompt), and every system command run by the service tools has a timeout and closed input, so it can no longer freeze the interface.

## [0.2.0]

First packaged release.

### Added
- Single-file executables for Windows, macOS and Linux. They need only an installed Chrome, Chromium, Edge or Brave.
- Local web interface (`whatsgrep ui`): rules editor with a live test panel, searchable chat picker, WhatsApp login by QR code, notification history with search and filters, and every setting in one place.
- Desktop notifications (Linux, macOS, Windows) alongside ntfy. At least one delivery method must stay on.
- Interactive `whatsgrep shell` and one-shot commands for config, rules, status and the background service.
- Run at login through systemd (Linux), launchd (macOS) or Task Scheduler (Windows), with automatic restart.
- Secrets (the ntfy topic) stored in the operating system keychain.
- Standard per-user config and data folders on every platform, plus `whatsgrep migrate` for older setups.
- `--version` flag and a version shown in the interface.

### Changed
- **Nothing asks you to restart any more.** Notifications, rules, the repeat window and trackers apply as soon as you save. Changing the browser setting restarts only the WhatsApp trackers.
- A new random ntfy topic is generated on every run unless `--resume` or a fixed topic is used. Background services keep their topic.
- Files no longer depend on the current directory.

## [0.1.0]

- Initial version: watch WhatsApp chats for keyword rules and send ntfy notifications.
