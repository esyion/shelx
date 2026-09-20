# Changelog

All notable changes to shelx are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> Versions prior to `0.2.0` were internal iterations before the project
> was open-sourced; their changes are summarized under "Unreleased / 0.2.0".

## [0.2.17] - 2026-09-20

### Added

- **Automatic update checking moved to a Rust background service.**
  A resident loop now checks GitHub for new versions — first check
  10 seconds after launch, every 4 hours afterwards, retrying 5 minutes
  after a failure — replacing the old one-shot frontend timer that
  silently gave up on any transient network hiccup. When a new version
  is found, the sidebar update icon lights up via the new
  `app-update-available` event; the result is cached so the icon
  survives webview reloads (`get_update_notice`), and check failures
  are logged instead of lost.
- **"Auto-check updates" toggle.** New `update.autoCheck` setting
  (default on, exposed in a dedicated Settings section) makes the
  background loop skip network requests entirely while disabled
  (PRD #66).
- **Terminal addons.** `unicode11` (wide/CJK character width),
  `clipboard` (OSC 52), `web-links` (clickable URLs opened via the
  opener plugin) and `serialize` (loaded for upcoming session-restore
  features) are wired up in a unified `base-addons.ts` loader.

### Fixed

- **Manual reconnect always failed.** `reconnect_session` validated the
  `Disconnected → Connecting` transition but never wrote the new state
  back to the session entry, so the session still looked disconnected
  when the fresh connection arrived and the multi-tab teardown guard
  discarded it — every reconnect after a manual close returned
  `SessionClosed`. The transition result is now persisted; the existing
  close-then-reconnect unit tests cover the regression.

## [0.2.16] - 2026-09-20

### Added

- **Multiple terminal tabs per connection.** Opening a connection that
  already has a tab now creates an additional tab instead of focusing
  the existing one. All tabs of the same connection share one
  authenticated SSH session — authentication runs once — and each tab
  owns an independent pty channel (PRD §6.3 multi-terminal).
- **Smart session teardown on tab close.** Closing a tab keeps the
  shared session alive while other tabs still reference it; the SSH
  session is disconnected only when the last referencing tab closes
  (tab-bar × button and `Ctrl+W` share the same code path).
- **Regression tests for session lifecycle races.** New unit tests
  cover online-session reuse and the case where a session is closed
  while authentication is still in progress: the freshly established
  connection is explicitly discarded instead of leaking an orphan
  online session.

### Changed

- **Redesigned disconnect banner.** The in-terminal disconnect notice
  is now a compact floating pill centered at the top — frosted-glass
  background, theme-aware semantic colors, a spinner while connecting
  and a prominent reconnect button when disconnected — replacing the
  full-width red strip.

## [0.2.15] - 2026-09-17

### Changed

- **Upgraded `rustls` to 0.23.45.** Pulled in via `cargo update` to pick
  up the latest patch release of the TLS stack used by `reqwest` /
  `rustls`. No behavioral or configuration changes.

## [0.2.14] - 2026-09-17

### Added

- **Settings page now ships 8 built-in terminal color schemes.**
  `GitHub Light`, `GitHub Dark`, `Dracula`, `One Dark`, `Solarized Light`,
  `Solarized Dark`, `Monokai`, and `Tomorrow Night` are exposed via a
  new `TerminalColorScheme` contract (Rust enum + matching frontend
  type). Picking a scheme applies it to every already-open terminal
  immediately, not only to tabs opened afterwards.
- **Terminal preferences live in a dedicated data layer.**
  `src/lib/terminal-prefs.ts` and `src/lib/terminal-schemes.ts` own the
  palette tables and the user override; the Settings page splits into
  `terminal-section.tsx` plus a shared `form-controls.tsx`, and
  `page.tsx` shrinks accordingly. Old configs with `default` are
  migrated to `GitHub Light` on read.
- **Application-layer tests for the terminal scheme migration.**
  `src-tauri/src/application/settings/tests.rs` covers the legacy
  `default` → `GitHub Light` upgrade path so the contract change is
  regression-protected.

### Changed

- **Development server moved from port 3000 to 56789.** Reduces the
  chance of colliding with other local dev servers; production
  builds and the bundled WebView are unaffected.

### Docs

- **README rewritten in English and Chinese.** Quick start, build,
  signing-key setup, and the macOS `xattr` quarantine workaround are
  now documented in both languages, with feature screenshots kept in
  English.

## [Unreleased]

### Changed

- **Release pipeline now uses `tauri-apps/tauri-action@v1`.** Tag-triggered
  matrix build across macOS Apple Silicon, macOS Intel, Linux x64, and
  Windows x64; `latest.json` is now generated and uploaded by the action,
  and the release is published only after all installers are uploaded.
  The previous hand-rolled bundling/renaming/latest.json assembly steps in
  `.github/workflows/release.yml` are removed.

### Security

- **`rsa` crate (RUSTSEC-2023-0071, Marvin Attack).** shelx enables the
  `rsa` feature on `russh` to keep SSH-compatible with legacy servers
  that only support the `ssh-rsa` host-key algorithm. The upstream crate
  has **no fixed release available**, and the attack requires a
  network-positioned adversary against a client connecting to such a
  legacy server. We accept this medium-severity risk; users who only
  connect to modern servers (which default to `ssh-ed25519` /
  `rsa-sha2-256/512`) are unaffected. Tracking upstream:
  <https://rustsec.org/advisories/RUSTSEC-2023-0071>.
- **Transitive `unic-*` and `proc-macro-error` unmaintained warnings.**
  No upstream fix available; flagged by `cargo audit` in CI but the
  audit step is non-blocking (`continue-on-error: true`) until a
  high-severity advisory appears.

## [0.2.13] - 2026-09-14

### Fixed

- **Transfers with the "overwrite" decision failed at the final rename.**
  When a same-name conflict was resolved as overwrite, the finalize step
  renamed the `.partial` file over the existing target, which SFTP v3
  (and the Windows file API) rejects. The engine now deletes the old
  target before renaming, and the answered decision is written back to
  the task's conflict policy so automatic retries no longer re-open the
  dialog.

### Changed

- **Transfer conflict prompt is a modal dialog again.** The
  `transfers/conflict` route introduced in the earlier dialog-to-route
  migration is removed; conflicts now resolve through a command-style
  `TransferConflictDialog` driven by the UI store (`conflictTaskId`)
  while the engine waits in `awaiting_conflict`.
- **Global UI restyle to a Twitter-style theme** — refreshed semantic
  color tokens in `globals.css` and root layout styling.

## [0.2.12] - 2026-09-14

### Fixed

- **All tabs and terminals were lost after navigating to Settings (or any
  page) and back in the packaged app** — the true root cause of issue #3.
  The production CSP `connect-src` directive was missing `'self'`, so the
  Next.js client router's RSC payload fetch (`/route.txt?_rsc=`) was blocked
  and every cross-page navigation degraded into a full page reload, wiping
  all in-memory state. Combined with the 0.2.10 resident-shell change,
  navigation is now a true SPA: entering Settings/Overview/connection forms
  keeps every terminal channel, scrollback and transfer intact.

## [0.2.11] - 2026-09-14

### Fixed

- **Sidebar logo nearly invisible in light theme.** The wordmark was
  hard-coded white; a light-theme variant (`shelx-light.svg`) is now
  swapped in via the `dark:` class so both themes stay legible.
- **Update dialog always said "no release notes".** `latest.json` was
  generated with empty `notes` because tauri-action uploads into a
  pre-created draft without body context. The publish job now extracts
  the section for the released tag from this file, injects it into
  `latest.json` and the release body, and fails the release if the
  section is missing.

### Added

- **Silent update check on startup** (first step of PRD #66). About
  five seconds after launch the app checks once in the background; the
  sidebar icon turns blue when a newer release is found. Failures stay
  silent, and manual checks keep their existing toast feedback.

## [0.2.1] - 2026-09-12

### Added

- **In-app updates via tauri-plugin-updater** — GitHub Releases endpoint
  with minisign signature verification. The sidebar icon turns blue when a
  newer release is available; clicking it opens a dialog that downloads
  and installs the update with a single click (Windows restarts
  automatically, macOS / Linux relaunch via `App::restart`).
- **`get_app_version` command** — exposes the compiled-in package version
  (`CARGO_PKG_VERSION`) to the frontend so the in-app update check can
  compare against the running version.
- **GitHub Releases API client** (`src/gateway/release.ts`) — fallback
  path for development and non-Tauri environments; the update store
  prefers the Tauri command and falls back to this when the command
  fails.
- **`scripts/bump-version.mjs`** — single entry to bump `package.json`,
  `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` in lockstep;
  accepts `patch` / `minor` / `major` / explicit `x.y.z`.
- **Release workflow (`release.yml`)** — `push: tags: ['v*']` triggers
  a three-platform matrix build (Windows / macOS / Linux) and a
  follow-up job that assembles `latest.json` from the uploaded `.sig`
  files so the Tauri updater client can locate the next version.
- **Minisign public key** (`src-tauri/keys/minisign.pub`) — committed
  for signature verification; the matching private key is held only in
  the GitHub Actions secret `TAURI_SIGNING_PRIVATE_KEY`.

### Notes

- macOS artifacts are still **unsigned and not notarized**; first
  launch requires `xattr -dr com.apple.quarantine
  /Applications/shelx.app` or right-click → Open. The README documents
  this.

## [0.2.0] - 2026-09-12

First publicly tagged release. Source-of-truth versions live in
`package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.

### Added

- **Project skeleton** — Tauri 2 host with statically-exported Next.js 16
  WebView; cross-platform desktop app (Windows / macOS / Linux).
- **SSH terminal** — connection management, multi-tab sessions, xterm.js
  5.5 + WebGL renderer, GBK encoding support, settings per host.
- **SFTP file management** — dual-pane local / remote browser with
  drag-and-drop, transfer queue, retry, cancel, and conflict handling.
- **Server monitor** — CPU, memory, disk, network and load metrics with
  sparklines, polled over the SSH channel.
- **Credentials & storage** — connection records in `rusqlite`, secrets in
  the OS keyring with an `aes-gcm` + `machine-uid` fallback when the
  keyring is unavailable.
- **IPC layer** — typed `IpcResult<T>` contract, single frontend gateway
  (`src/gateway/tauri.ts`), thin `#[tauri::command]` adapters on the
  backend, capability-scoped permissions, restrictive CSP.
- **Engineering rules** — `AGENTS.md` covering layering, IPC contract,
  state / concurrency, security defaults, testing, and quality gates.
- **CI** — GitHub Actions running frontend build + tests, Rust
  `fmt` / `clippy -D warnings` / `test`, and `cargo audit` (non-blocking).
- **Open-source metadata** — MIT license, contributing guide, code of
  conduct, security policy, issue & PR templates.

### Changed

- Pinned xterm to 5.5.0 + matching addon versions (`addon-fit 0.11.0`,
  `addon-search 0.16.0`, `addon-webgl 0.19.0`) for renderer stability.
- Adopted `output: 'export'` for the Next.js frontend; SSR / Server
  Actions / dynamic route handlers are intentionally disabled.
- Refactored frontend code structure for improved readability and
  maintainability.

### Known limitations

- Linux packaging is not exercised in CI; Windows and macOS are the
  primary targets until first tester reports.
- `cargo audit` runs as a non-blocking job; high-severity findings will
  become blocking on the next minor.
- No automatic updater wired yet (resolved in 0.2.1).

[0.2.15]: https://github.com/esyion/shelx/releases/tag/v0.2.15
[0.2.14]: https://github.com/esyion/shelx/releases/tag/v0.2.14
[0.2.13]: https://github.com/esyion/shelx/releases/tag/v0.2.13
[0.2.12]: https://github.com/esyion/shelx/releases/tag/v0.2.12
[0.2.11]: https://github.com/esyion/shelx/releases/tag/v0.2.11
[0.2.1]: https://github.com/esyion/shelx/releases/tag/v0.2.1
[0.2.0]: https://github.com/esyion/shelx/releases/tag/v0.2.0
