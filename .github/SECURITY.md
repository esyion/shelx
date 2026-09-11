# Security Policy

## Supported Versions

shelx is currently in active early development (`0.x`). Only the latest commit
on the `main` branch receives security fixes. Older releases and tags are not
patched; please upgrade before reporting an issue.

| Branch / Tag | Supported          |
| ------------ | ------------------ |
| `main`       | ✅ Active          |
| older tags   | ❌ No backports    |

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security-sensitive reports.
Instead, use one of the private channels below:

- Email: **qingbo.my@gmail.com** (preferred — fastest response)
- GitHub: open a [private security advisory](https://github.com/esyion/shelx/security/advisories/new)
  on this repository

When writing the report, please include:

1. A clear description of the vulnerability and its impact (e.g. credential
   disclosure, RCE, sandbox escape, path traversal).
2. Steps to reproduce, ideally with a minimal PoC; include Tauri version,
   OS, and architecture (Windows / macOS / Linux).
3. Affected commit SHA or release tag.
4. Any known mitigations or workarounds you have identified.

You can expect:

- An acknowledgement within **3 business days**.
- A triage decision (accepted / duplicate / declined / needs-more-info)
  within **10 business days**.
- Coordinated disclosure — we will agree on a disclosure date before any
  public commit, CVE request, or release notes go out.

## Scope

shelx runs a Tauri 2 host with a Next.js (static export) WebView and a Rust
backend. The following areas are explicitly in scope:

- Tauri command surface in `src-tauri/src/commands/` — boundary validation,
  path handling, IPC DTO mapping.
- Capability / CSP misconfiguration (`src-tauri/capabilities/`,
  `src-tauri/tauri.conf.json`).
- Credential and key handling in `src-tauri/src/application/credentials/`
  and the keyring fallback (`machine-uid` + `aes-gcm`).
- SSH/SFTP transport (`russh`, `russh-sftp`) — host key verification,
  username handling, file path traversal.
- Frontend ↔ backend IPC via `src/gateway/`.
- Local persistence (`rusqlite`, settings files) and migration logic.

The following are out of scope for *this* repository: vulnerabilities in
upstream crates (please report upstream first), denial of service against the
developer machine from malicious web content the user explicitly opens in the
WebView, and self-XSS from copy-pasting attack payloads into the terminal.

## Safe Harbor

We will not pursue legal action against researchers who:

- Make a good-faith effort to avoid privacy violations, data destruction,
  and service disruption.
- Only interact with accounts they own or have explicit permission to test.
- Stop testing immediately if they encounter user data and report it to us.
- Give us a reasonable window to fix the issue before public disclosure.

## Disclosure Policy

Once a fix is ready we will:

1. Cut a patch release tagged on `main`.
2. Publish a GitHub Security Advisory with CVE (requested via GitHub).
3. Credit the reporter in the advisory (unless they prefer to remain
   anonymous).
