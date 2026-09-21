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

SSH, a file pane, and a look at CPU. That's the whole app.

I built this because SSH clients keep getting heavier, and most of that weight is stuff I never open. Tunnels, plugin stores, remote desktop, packet tools, five kinds of session log. Fine for someone. For me — and, I think, for about 80% of people who "need a terminal" — the daily loop is: connect, type, copy a file, glance at whether the box is dying. One window should be enough.

The layout is borrowed from [FinalShell](https://www.finalshell.net.cn/): connection tree on the left, tabs on top, and terminal / files / monitor sharing the same workspace. I sat in that arrangement for years. It still feels like the right one. Thanks, FinalShell.

```
┌──────────────┬─────────────────────────────────┐
│ connections  │  tabs                            │
│              ├──────────────────────────────────┤
│  tree        │  terminal  ·  files  ·  monitor  │
│              ├──────────────────────────────────┤
│  cpu / mem   │  transfers                       │
└──────────────┴─────────────────────────────────┘
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

Double-click a host in the tree. Password, OpenSSH private key, keyboard-interactive (OTP), or ssh-agent. Empty key path tries `~/.ssh/id_ed25519`, then `id_ecdsa`, then `id_rsa`. On Windows, agent looks at `openssh-ssh-agent` first, then Pageant.

First connect shows the SHA-256 host fingerprint and waits (TOFU). If that fingerprint later changes, the connection is refused — nothing silent. Keepalive is 30s by default, three misses and it's down.

The terminal is xterm.js (WebGL when the GPU cooperates). Copy-on-select and right-click paste are on by default. `Ctrl` + wheel changes the font size. Encoding is UTF-8 or GBK per host, for older Chinese boxes. Disconnect keeps the buffer so you can still read and copy; a banner has the reconnect button.

One SSH session carries the terminal, the file pane, and the monitor. Switching views does not tear down the pty.

## Files

Dual pane: local left, remote right. List, mkdir, rename (`F2`), delete (`Del`), show-hidden, sort by name or size. Drop files onto the window to upload into the current remote directory. Right-click to upload / download.

Transfers go through a queue in the bottom panel (`Ctrl+J`): progress, speed, ETA, cancel, retry. Same-name conflicts ask you — overwrite, skip, or keep both. Default concurrency is 2. Failed transfers retry twice with backoff; cancelled ones leave a `.shelx-partial` file.

## Monitor

Linux servers only. It reads `/proc` over the same SSH connection — not an agent, not SNMP.

CPU (total + per core), memory, swap, network, disks, load, uptime. Disk bars turn orange past 85% and red past 95%. Compact bars sit under the connection tree; the workspace view is charts. Sampling is 2 / 5 / 10 / 30 / 60 seconds. Non-Linux hosts say they aren't supported instead of inventing numbers.

Connect also grabs hostname, kernel, distro, CPU model, and memory once, for the system-info dialog.

## Connections

The left tree is the address book. Groups, search, drag to rearrange. Right-click to connect, edit, clone, or delete. Clone copies the host, not the secrets.

Passwords never go into SQLite. They go to the OS keyring (Keychain / Credential Manager / Secret Service). If the keyring isn't there, they land in an AES-GCM file under `~/.shelx`. You can also keep a password for this session only, or not save it at all.

No jump host. No port forwarding. No plugin system. On purpose.

## Shortcuts

| Key | Action |
| --- | --- |
| `Ctrl+,` | Settings |
| `Ctrl+B` | Sidebar |
| `Ctrl+J` | Transfer panel |
| `Ctrl+W` | Close tab |
| `Ctrl+Tab` | Next tab |
| `Alt+1` / `2` / `3` | Terminal / monitor / files |
| `Ctrl` + mouse wheel | Terminal font size |

Settings save as you change them: theme, font, scrollback, keepalive, transfer concurrency, conflict policy, sample interval. Window layout (sidebar split, panel height) is remembered.

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

Stack: Tauri 2, russh, russh-sftp, SQLite. Frontend is a Next.js static export with xterm.js and React.

## Thanks

The window is a straight nod to **FinalShell**. If you've used it, you'll know where everything is in about ten seconds.

Bugs and ideas: [Issues](https://github.com/esyion/shelx/issues). How to hack on it: [CONTRIBUTING.md](CONTRIBUTING.md). Security reports go through [SECURITY.md](.github/SECURITY.md), not a public issue.

## License

[MIT](LICENSE). © 2026 [esyion](https://github.com/esyion)
