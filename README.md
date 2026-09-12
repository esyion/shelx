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

<br />

**shelx** is a single-window desktop client for the three jobs every
operator does on a Linux box: open a shell, drag a file across, glance at
the CPU. One SSH connection, three panels, no account, no telemetry, no
phoning home.

It is built for people who currently juggle Xshell for terminal,
WinSCP for files, and a web panel for monitoring — same host, three
tools, three copies of the credentials. shelx collapses that into one
app that stays out of your way.

---

## Why another client

Most tools in this space make a deal with you. FinalShell is closed,
ad-supported, and stores credentials in an opaque format. Xshell's free
edition caps your tabs. The Electron-based options (Tabby, electerm,
WindTerm) eat a gigabyte of RAM once you have a dozen hosts open and
hand-wave their security model. None of them handle GBK-encoded Chinese
server output gracefully, which is a daily annoyance if you work with
older domestic Linux boxes.

shelx takes the opposite trade. Everything is local. Credentials live in
the OS keyring (with a documented AES-GCM fallback when the keyring is
unavailable). The web view runs with a strict CSP and no remote scripts.
There is no cloud sync, no account, no analytics endpoint, and no plugin
runtime that could exfiltrate your terminal. The cost is that shelx
deliberately does not do a lot of things.

## What it does not do

No zmodem / rz-sz. No Telnet, serial, RDP, or VNC. No jump-host chains
or SSH agent forwarding. No built-in editor, no directory diff-sync, no
threshold alerting, no history persistence, no team collaboration, no
mobile, no Windows-server monitoring. If you need any of those, shelx is
the wrong tool and that is fine.

---

## What it looks like

You open a saved host and the workspace shows three panels over the same
connection. The tab strip across the top carries one colored dot per
session: green online, amber connecting, red disconnected.

**Terminal.** A full-window dark terminal with xterm.js inside. Tabs
across the top, reconnect-on-disconnect, GBK encoding support so legacy
Chinese servers don't render as mojibake.

**Files.** A dual-pane browser — local on the left, remote on the right —
with a breadcrumb path, a toolbar (up / refresh / new folder / new file /
rename / delete / chmod / show hidden), drag-and-drop upload and
download, and a transfer queue with retry and conflict handling.
Right-clicking a file on the remote side opens a 3×3 read/write/execute
grid that live-previews the resulting `rwxr-xr-x` octal.

**Monitor.** A live dashboard pulled over the same SSH channel. A
single-line system strip (hostname, kernel, uptime, current user), then
a 2×2 grid of charts — CPU per-core area, memory stacked with a separate
swap chart, network down/up dual-line with auto-scaled Y axis, load
1/5/15 — and one progress-bar row per disk mount that turns amber over
85% and red over 95%. Sample interval is configurable from 2 seconds to
a minute.

**Settings.** A single-column form, sectioned into cards: appearance,
terminal, connection, transfer, monitor. Changes save immediately.

---

## First-time security check

When you connect to a host shelx has never seen, it pops up a dialog
with the algorithm and SHA256 fingerprint, with the line "verify the
fingerprint matches before continuing". On the server you run
`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` and compare. This is
the only trust moment that matters for an SSH client, and shelx does
not bury it.

---

## Get started in 30 seconds

1. **Download** the installer for your platform from
   [GitHub Releases](https://github.com/esyion/shelx/releases/latest).

   | Platform | File |
   | --- | --- |
   | Windows | `shelx-<version>-Windows.msi` |
   | macOS | `shelx-<version>-macOS.dmg` |
   | Linux | `shelx-<version>-Linux.AppImage` or `.deb` |

2. **Install** — run the MSI, drag the .app into `/Applications`, or
   `chmod +x` the AppImage.

3. **Open shelx.** The sidebar is empty. Click the lightning-bolt
   "快速连接" button (or Ctrl+Shift+C / Ctrl+T) and fill in host, port,
   username, and auth method (password, private key, keyboard-interactive
   for OTP, or SSH agent). Confirm the fingerprint when prompted.

4. **You're in.** The terminal tab opens. Alt+1 / Alt+2 / Alt+3 flips
   between terminal, monitor, and files on the same connection.

Save the connection from the same dialog if you want it in the sidebar
for next time. Credentials go to the OS keyring, never plaintext on disk.

---

## A few honest things you should know

**macOS builds are not notarized yet.** Gatekeeper will block the first
open. Two workarounds until Developer ID is wired in:

```bash
# option A — strip the quarantine attribute after copying
xattr -dr com.apple.quarantine /Applications/shelx.app

# option B — right-click the .app the first time, choose Open, confirm once
```

**Linux packaging is not yet exercised in CI.** Windows and macOS are
the primary build targets until the first batch of testers reports in.
The AppImage and .deb do work, but expect rough edges on less-common
distros.

**The `rsa` crate is shipped despite an upstream advisory.**
RUSTSEC-2023-0071 (Marvin Attack) affects the legacy `ssh-rsa` host-key
algorithm. The upstream crate has no fixed release available, and the
attack requires a network-positioned adversary against a client
connecting to such a legacy server. shelx keeps the `rsa` feature on
to stay compatible with those servers; users connecting to modern hosts
(which default to `ssh-ed25519` and `rsa-sha2-256/512`) are unaffected.
Tracked at <https://rustsec.org/advisories/RUSTSEC-2023-0071>.

---

## Updates

shelx checks for new releases on GitHub and verifies them with a minisign
signature. When a newer release is available, the sidebar's upload-arrow
icon turns blue. Click it, read the release notes, hit "立即更新" — the
app downloads, verifies, installs, and relaunches.

---

## License

[MIT](LICENSE). Versions prior to 0.2.0 were internal iterations before
the project was open-sourced; their changes are summarized in the
[CHANGELOG](CHANGELOG.md) under 0.2.0.