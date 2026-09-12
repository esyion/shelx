# shelx

<p align="left">
  <img src="https://raw.githubusercontent.com/esyion/shelx/main/public/shelx.svg"
       alt="shelx logo" width="222" />
</p>

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-orange.svg)](https://v2.tauri.app/)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black.svg)](https://nextjs.org/)
[![Rust 2021](https://img.shields.io/badge/Rust-2021-brown.svg)](https://www.rust-lang.org/)
[![CI](https://img.shields.io/badge/CI-GitHub_Actions-2088ff.svg)](.github/workflows/ci.yml)
[![Release](https://img.shields.io/badge/Release-GitHub_Releases-2088ff.svg)](https://github.com/esyion/shelx/releases)

> Lightweight, no-tracking, open-source **SSH + SFTP + server monitor**
> desktop client for Windows, macOS and Linux.

## Download

Pre-built installers live in [GitHub Releases](https://github.com/esyion/shelx/releases/latest).
Pick the one that matches your platform:

| Platform | File | Notes |
| --- | --- | --- |
| Windows | `shelx-<version>-Windows.msi` | Run the installer. |
| macOS (Apple Silicon / Intel) | `shelx-<version>-macOS.dmg` | See macOS notice below. |
| macOS (alternative) | `shelx-<version>-macOS.zip` | Unzip and drag into `/Applications`. |
| Linux | `shelx-<version>-Linux.AppImage` | `chmod +x` and run. |
| Linux | `shelx-<version>-Linux.deb` | `sudo apt install ./...deb`. |

> **Updating from an older version?** shelx also checks for updates in-app:
> the sidebar icon turns blue when a newer release is available on GitHub.
> Click it to open the release dialog and jump to the download page.
>
> **macOS notice (until we ship a notarized build):** the `.dmg` / `.zip`
> artifacts are **unsigned and not notarized**. macOS Gatekeeper will block
> the first open. Workarounds:
>
> ```bash
> # Option A — remove the quarantine attribute after copying to /Applications
> xattr -dr com.apple.quarantine /Applications/shelx.app
>
> # Option B — right-click the .app → Open → confirm the warning once
> ```
>
> Once a Developer ID is wired into the release pipeline this section will
> shrink to a single line.

shelx bundles the three jobs every operator does into one window — open a
shell, drag a file, glance at the CPU — without an Electron-sized footprint
and without phoning home.

## Highlights

- 🪶 **Lightweight** — Tauri 2 + system WebView. Idle memory roughly a
  tenth of Tabby / electerm.
- 🔒 **Open & auditable** — MIT-licensed. Credentials are stored in the
  OS keyring (with a documented AES-GCM fallback). No telemetry, no ads,
  no forced login.
- 🖥️ **Real terminal** — xterm.js 5.5 with the WebGL renderer; SSH
  sessions are powered by `russh` on the Rust side.
- 📁 **Dual-pane SFTP** — local ↔ remote drag-and-drop, queue, retry,
  cancel, conflict handling.
- 📊 **Server monitor** — CPU / memory / disk / network / load with
  sparklines, all over a single SSH channel.
- 🇨🇳 **GBK-friendly** — native GBK encoding support for older Chinese
  Linux hosts.

## Screenshots

<!-- TODO: drop real screenshots once the marketing page is ready.
     Until then the ASCII placeholders are intentional. -->

```
┌───────────────────────────────────────────────────────────────┐
│  ● prod-web-01   ● prod-db-01   ○ staging-api     + Add host │
├──────────┬────────────────────────────────────────────────────┤
│ Sessions │  $ tail -F /var/log/nginx/access.log                │
│          │  10.0.4.21 - - [12/Sep/2026:03:14:12 +0000] ...    │
│ ▸ web-01 │  10.0.4.22 - - [12/Sep/2026:03:14:12 +0000] ...    │
│ ▸ db-01  │                                                    │
│          │                                                    │
├──────────┴──────────────────────┬─────────────────────────────┤
│ Local: ~/project               │ Remote: /srv/app            │
│ src/   dist/   README.md       │ src/   dist/   package.json │
└────────────────────────────────┴─────────────────────────────┘
```

## Tech stack

- **Desktop shell** — [Tauri 2](https://v2.tauri.app/) (Rust backend).
- **Frontend** — [Next.js 16](https://nextjs.org/) App Router
  (**static export**, `output: 'export'`), React 19, TypeScript.
- **UI** — Tailwind CSS v4 + shadcn/ui (Base UI) + Zustand.
- **Backend** — Rust 2021, `russh` / `russh-sftp`, `rusqlite`,
  `aes-gcm` + OS keyring for credential storage.
- **Tooling** — `bun` for the frontend, `cargo` for the backend.

## Architecture at a glance

```
┌─────────────────────────── Tauri host ──────────────────────────┐
│                                                                  │
│   Next.js static export  ──invoke / events──▶   Rust backend    │
│   (WebView, `src/app`)                          (`src-tauri/`)  │
│         │                                              │        │
│         ▼                                              ▼        │
│   presentation → application                 presentation → …    │
│   (hooks, api.ts)                            commands (thin)     │
│                                              application → …     │
│                                              domain (pure Rust)  │
│                                              infrastructure      │
└──────────────────────────────────────────────────────────────────┘
```

- The frontend **must** stay statically exportable. SSR / Server Actions /
  dynamic route handlers are off-limits — the WebView serves `out/`.
- All Rust ↔ frontend calls go through `src/gateway/tauri.ts` on the
  frontend and `#[tauri::command]` in `src-tauri/src/commands/` on the
  backend. Components never call `@tauri-apps/api` directly.
- Layering and IPC contract rules are spelled out in
  [`AGENTS.md`](AGENTS.md) — it is normative for new code.

## Getting started

### Prerequisites

- **bun** — see <https://bun.sh>.
- **Rust stable** with `clippy` and `rustfmt`:
  ```bash
  rustup component add clippy rustfmt
  ```
- **Tauri 2 system dependencies** for your OS — see the
  [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/).

### Run the desktop app in dev mode

```bash
bun install
bun tauri dev
```

The first run compiles the Rust backend (a few minutes). Subsequent runs
are incremental.

## Build & quality gates

Run these locally before opening a PR; they mirror what CI runs on every
push and PR.

```bash
bun run build                                                 # Next.js static export → out/
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
bun run test                                                  # vitest
bun tauri build                                               # produce installers / bundles
```

## Project layout

```
.
├─ src/                  # Next.js frontend (presentation + frontend gateway)
├─ src-tauri/            # Rust backend (commands / application / domain / infrastructure)
│  ├─ src/
│  ├─ capabilities/      # Tauri permission manifests
│  ├─ migrations/        # schema migrations
│  └─ tauri.conf.json
├─ docs/                 # PRD, technical design, TODO, UI layout
├─ tests/                # cross-layer / end-to-end tests
├─ .github/              # workflows, issue & PR templates, security & CoC
└─ AGENTS.md             # engineering rules (normative for new code)
```

## Documentation

- [`docs/PRD.md`](docs/PRD.md) — product requirements and milestones.
- [`docs/TECHNICAL_DESIGN.md`](docs/TECHNICAL_DESIGN.md) — architecture,
  IPC contracts, layering.
- [`docs/UI_LAYOUT.md`](docs/UI_LAYOUT.md) — UI structure & navigation.
- [`docs/TODO.md`](docs/TODO.md) — milestone tracker.
- [`AGENTS.md`](AGENTS.md) — engineering rules (must-read for
  contributors).
- [`CHANGELOG.md`](CHANGELOG.md) — release notes.

## Contributing

We welcome bug reports, documentation fixes, and focused PRs. Please start
with [`CONTRIBUTING.md`](CONTRIBUTING.md); the layering and security rules
in [`AGENTS.md`](AGENTS.md) are normative. By participating you agree to
follow the [Code of Conduct](.github/CODE_OF_CONDUCT.md).

## Security

Found a vulnerability? **Do not** open a public issue — see
[`SECURITY.md`](.github/SECURITY.md) for the private reporting channels.

## License

[MIT](LICENSE) © 2026 esyion.
