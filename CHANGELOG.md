# Changelog

All notable changes to shelx are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> Versions prior to `0.2.0` were internal iterations before the project
> was open-sourced; their changes are summarized under "Unreleased / 0.2.0".

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

[0.2.1]: https://github.com/esyion/shelx/releases/tag/v0.2.1
[0.2.0]: https://github.com/esyion/shelx/releases/tag/v0.2.0
