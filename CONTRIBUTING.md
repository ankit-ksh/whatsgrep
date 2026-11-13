# Contributing

Thanks for helping. Bug reports and pull requests are welcome.

## Set up

```
git clone https://github.com/ankit-ksh/whatsgrep.git
cd whatsgrep
npm install
npm test          # unit tests, no WhatsApp account or mailbox needed
npm run typecheck # type check the interface
npm start -- ui   # run the interface from source
```

Node 20 or newer is required. Use `npm run build` to make the single-file executable for your OS
(`dist/`). Builds are per operating system.

## Guidelines

- Keep tests passing and add one for new behaviour. Pure logic (matching, config, paths) is easy to test.
- The interface is a React and TypeScript app in `src/ui/`, bundled into one page by `src/ui/build.js`. Do not add placeholder text or example values to it; a test enforces this. Write against React's API (import from `react`) so it stays portable.
- A new kind of thing to watch is a new tracker in `src/trackers/`, following the contract described in `src/trackers/index.js`.
- Never commit a real `config.yaml`, session folder, chat names or phone numbers.
- Add a line to `CHANGELOG.md` under an "Unreleased" heading for user-visible changes.

## Releasing (maintainers)

1. Move the Unreleased notes to a new version heading in `CHANGELOG.md` and bump `version` in `package.json`.
2. Commit, then `git tag vX.Y.Z && git push --tags`.
3. The `release` workflow tests, builds all executables and publishes the GitHub release with checksums.
