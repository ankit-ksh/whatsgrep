# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed
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
- A new random ntfy topic is generated on every run unless `--resume` or a fixed topic is used. Background services keep their topic.
- Files no longer depend on the current directory.

## [0.1.0]

- Initial version: watch WhatsApp chats for keyword rules and send ntfy notifications.
