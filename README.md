<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/shelx.svg">
    <img src="public/shelx-light.svg" alt="shelx" height="40">
  </picture>
</p>

<p align="center">
  <strong>English</strong> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/esyion/shelx/releases/latest"><img src="https://img.shields.io/github/v/release/esyion/shelx" alt="latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT"></a>
</p>

# shelx

A terminal, a file pane, a look at CPU — and, since 0.3, an assistant that can do the digging for you.

I built this because SSH clients keep getting heavier, and most of that weight is stuff I never open. Tunnels, plugin stores, remote desktop, packet tools, five kinds of session log. Fine for someone. For me — and, I think, for about 80% of people who "need a terminal" — the daily loop is: connect, type, copy a file, glance at whether the box is dying. One window should be enough. The assistant follows the same rule: it works over the SSH connections you already configured, it shows every step as it happens, and it waits for your click before it writes anything.

The layout is borrowed from [FinalShell](https://www.finalshell.net.cn/): connection tree on the left, tabs on top, and the workspace shared by terminal / monitor / files. I sat in that arrangement for years. It still feels like the right one. Thanks, FinalShell.

```
┌──────────────┬─────────────────────────────────┬────────────┐
│ connections  │  tabs                           │            │
│              ├─────────────────────────────────┤  AI panel  │
│  tree        │  terminal · monitor ·           │  (docked,  │
│              │  processes · files              │  collapses)│
│  cpu / mem   ├─────────────────────────────────┤            │
│  / disks     │  transfers                      │            │
└──────────────┴─────────────────────────────────┴────────────┘
```

Desktop app for Windows, macOS, and Linux. The UI is Chinese right now.

## Install

Grab a build from [Releases](https://github.com/esyion/shelx/releases/latest):

| Platform | File |
| --- | --- |
| Windows x64 | `*-setup.exe` (NSIS) |
| macOS Apple Silicon | `*_aarch64.dmg` |
| macOS Intel | `*_x64.dmg` |
| Linux x64 | `.deb`, `.rpm`, or AppImage |

Installers are not Apple / Microsoft signed yet. On macOS, if Gatekeeper blocks it: right-click → Open, or System Settings → Privacy & Security → Open Anyway.

After install, shelx checks GitHub Releases on its own and verifies the package with minisign. When an update is out, the sidebar arrow turns blue.

## SSH

Double-click a host in the tree. Password, OpenSSH private key, keyboard-interactive (OTP), or「use my local SSH setup」— the agent and default keys (`~/.ssh/id_ed25519`, then `id_ecdsa`, then `id_rsa`). On Windows, the agent looks at `openssh-ssh-agent` first, then Pageant.

First connect shows the SHA-256 host fingerprint and waits (TOFU). shelx keeps its own known-hosts store — it never touches `~/.ssh/known_hosts`. If the fingerprint later changes, the connection is refused — nothing silent. Keepalive is 30s by default, three misses and it's down.

The terminal is xterm.js — WebGL when the GPU cooperates, DOM renderer when it doesn't. Copy-on-select and right-click paste are on by default, OSC 52 included, all through the native clipboard because WebViews like to refuse the web one. `Ctrl` + wheel changes the font size. Seven built-in color schemes (Dracula, Tokyo Night, One Dark, Nord, Solarized Dark / Light, GitHub Light); font, line height, cursor, scrollback live in settings and apply to open terminals immediately. Chinese IME input has its own guard, so pinyin doesn't shatter into `f rf ree -h`. Encoding is UTF-8 or GBK per host, for the older boxes.

One SSH session carries the terminal, the file pane, the monitor, and the process list. Switching views does not tear down the pty. Disconnect keeps the buffer so you can still read and copy; a banner has the reconnect button.

## Files

Dual pane: local left, remote right. List, mkdir, rename (`F2`), delete (`Del`), show-hidden, sort by name / size / mtime, permissions changed through a nine-checkbox grid instead of octal digits. Lists are virtualized, so a directory with ten thousand entries still scrolls. Drop files onto the window to upload into the current remote directory. Right-click to upload / download.

Transfers go through a queue in the bottom panel (`Ctrl+J`): progress, speed, ETA, cancel, retry. Same-name conflicts ask you — overwrite, skip, or keep both — with an "apply to the rest" box. Default concurrency is 2. Failed transfers retry twice with backoff; cancelled ones leave a `.shelx-partial` file. When the window isn't focused, a finished transfer says so through an OS notification.

## Monitor

Linux servers only. It reads `/proc` over the same SSH connection — one shell call per sample, parsed in Rust. Not an agent, not SNMP, nothing to install on the box.

CPU (donut + per-core), memory & swap, network, disks, load (with an idle / normal / busy badge), uptime. Disk bars turn orange past 85% and red past 95%. Compact bars sit under the connection tree — disks included; the workspace view is charts. Collection follows the session, not the view: switching tabs doesn't stop it, and the last hour stays available with 5m / 15m / 30m / 1h windows. Sampling is 2 / 5 / 10 / 30 / 60 seconds. Non-Linux hosts say they aren't supported instead of inventing numbers.

Processes are their own workspace tab — a task-manager table (name, user, PID, state, CPU%, memory, cumulative time), every column sortable, with a filter box. Current CPU% is diffed between two snapshots the way `top` does it, because `ps` reports a lifetime average. Killing a process asks first, shows the full command line, and sends SIGTERM — no fake "force" option that doesn't exist.

There's an overview page too: every connected host as a card with CPU / memory / network at a glance. The monitor view can be pinned always-on-top while you work in the terminal.

## The assistant

The AI panel docks on the right — it squeezes the workspace instead of covering it, and closing it doesn't stop a running turn. You describe the problem in plain language; it picks hosts from your connection list (connecting itself if needed), runs commands, reads files, tails logs, and answers with the evidence inline.

- **Two protocols, on purpose**: OpenAI Responses and Anthropic Messages. `/chat/completions` is not supported — the old protocol can't carry the reasoning and tool streams this needs. Custom base URLs are fine; an OpenAI-style gateway must pass a live probe of `{base_url}/responses` before the profile saves, because most compatibility gateways only speak chat completions and would fail mid-task. Model names and context windows come from a bundled catalog and can be overridden per profile.
- **Thirteen tools**: list hosts, host details, connect, server info, run commands, read file, list directory, tail log, write file, delete, rename, chmod, save a memory.
- **Approval gate**: read-only commands (a whitelist — `nginx -t` is read-only, `nginx` is not) run on their own in the default mode; anything that writes waits, per host, for a three-way decision — allow once, allow for this thread + host + tool, or deny. Deny is the default when the 10-minute timer runs out. Commands travel as argv arrays — no shell strings, no pipes, no redirects — and there are stricter modes if you want every command asked or read-only tools only.
- **Batch across hosts**: pick targets by group, by what's online, or all configured hosts. Concurrency is capped in settings, each host is approved separately, results come back per host, and one failure doesn't stop the rest.
- **Memory**: the assistant can propose notes — global or per-host — but a note only sticks when you approve it, and anything that looks like a credential is refused outright.
- **Threads**: stored in SQLite and replayed as one ordered timeline per turn — thinking, steps, answer — not a pile of collapsed logs. If some thread is waiting on your approval while you're elsewhere, the sidebar badge says so.
- **Metering & keys**: a context meter shows how full the model's window is, with a per-thread token budget behind it. API keys live in the OS keyring — never in SQLite, logs, or IPC payloads.

## Desktop manners

Close-to-tray (opt-in) keeps SSH and SFTP sessions alive after the window closes; restore or quit from the tray. A second launch — including one pulled up by an `ssh://user@host:port` link from a browser or doc — brings the existing window forward instead of a new process, with quick connect prefilled. Window size and position are remembered. Autostart is a setting. A global shortcut (preset tiers, managed on the shortcuts page) summons the window from anywhere. The theme is one truth across three places: the setting, the UI, and the native title bar.

## Connections

The left tree is the address book. Groups, search, drag to rearrange, remarks. Right-click to connect, edit, clone, or delete. Clone copies the host, not the secrets. The form can test a connection before you save it; failures keep what you typed.

Passwords never go into SQLite. They go to the OS keyring (Keychain / Credential Manager / Secret Service). If the keyring isn't there, they land in an AES-GCM file under `~/.shelx`. You can also keep a password for this session only, or not save it at all.

No jump host. No port forwarding. No plugin system. On purpose.

## Settings

The settings screen renders from a contract the backend owns: which controls exist, their ranges, presets, units — the same schema that validates the write on the Rust side. A patch with an unknown field is rejected instead of silently dropped, so a setting can't look like it works while doing nothing. Saves are instant; a rejected save keeps your input and explains itself. Groups: general, terminal, transfer, monitor, window, AI, shortcuts, data.

## Shortcuts

| Key | Action |
| --- | --- |
| `Ctrl+,` | Settings |
| `Ctrl+B` | Sidebar |
| `Ctrl+J` | Transfer panel |
| `Ctrl+W` | Close tab |
| `Ctrl+Tab` | Next tab |
| `Alt+1` / `2` / `3` / `4` | Terminal / monitor / processes / files |
| `Ctrl` + mouse wheel | Terminal font size |

## Build

Need [Rust](https://rustup.rs/), [Bun](https://bun.sh/), and the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```bash
git clone https://github.com/esyion/shelx.git
cd shelx
bun install
bun tauri dev      # run
bun tauri build    # installer
```

Data lives in `~/.shelx` (SQLite, logs, fallback secrets). Settings and layout go in the OS app-config directory (`com.krmeow.shelx`).

Stack: Tauri 2, russh, russh-sftp, rig (the agent loop), SQLite, OS keyring. Frontend is a Next.js static export with xterm.js, shadcn/ui, and Zustand.

## Under the hood

- The Rust side is layered — commands → application → domain, infrastructure behind port traits — and stays testable without a window.
- The IPC contract is generated, not hand-copied: Rust DTOs export JSON Schema, `bun run gen:ipc` compiles it into TypeScript, and `check:ipc` fails CI on drift. The frontend cannot quietly mirror a backend type.
- 260+ Rust tests, a dockerized sshd suite for auth / transfer round-trips, and a vitest suite over user-visible behavior. Dependency advisories are scanned in CI.
- No telemetry, no accounts, no cloud. Design docs (PRD, technical design, agent design, IPC contract) live in [`docs/`](docs/). Engineering rules are [`AGENTS.md`](AGENTS.md); the short path for PRs is [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Thanks

The window is a straight nod to **FinalShell**. If you've used it, you'll know where everything is in about ten seconds.

Bugs and ideas: [Issues](https://github.com/esyion/shelx/issues). How to hack on it: [CONTRIBUTING.md](CONTRIBUTING.md). Security reports go through [SECURITY.md](.github/SECURITY.md), not a public issue.

## License

[MIT](LICENSE). © 2026 [esyion](https://github.com/esyion)
