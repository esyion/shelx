# Changelog

All notable changes to shelx are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> Versions prior to `0.2.0` were internal iterations before the project
> was open-sourced; their changes are summarized under "Unreleased / 0.2.0".

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

[0.2.11]: https://github.com/esyion/shelx/releases/tag/v0.2.11
[0.2.1]: https://github.com/esyion/shelx/releases/tag/v0.2.1
[0.2.0]: https://github.com/esyion/shelx/releases/tag/v0.2.0
