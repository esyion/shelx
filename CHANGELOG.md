# Changelog

All notable changes to shelx are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> Versions prior to `0.2.0` were internal iterations before the project
> was open-sourced; their changes are summarized under "Unreleased / 0.2.0".

## [0.3.2] - 2026-10-23

Follow-up to the desktop-integration release: 0.3.1 was superseded
before publication (its release was destroyed while re-triggering the
failed Linux build, and nothing was ever published or downloaded), so
0.3.2 ships everything from 0.3.1 — theme sync, tray, single instance,
`ssh://` deep links, notifications, window state, autostart, global
shortcut, monitor pinning — plus the dependency hardening below.

### Security

- **Dependency hardening** — `rust-ini` is held at 0.21.1 because
  `tauri-plugin-deep-link` 2.6.2's Linux desktop-file parser does not
  compile against rust-ini ≥ 0.21.2 (the failure broke the Linux build
  and CI); `rustls`, `rustls-webpki`, `webpki-root-certs`, `ctutils`
  and `tokio` were bumped past their RUSTSEC advisories (2026-0346–0349,
  0382, 0383, 0385, 0386); and the updater plugin's unused `zip` feature
  is disabled, dropping zip 4.x (three open advisories, 2026-0367–0369)
  from the tree — no shipped updater artifact is a `.zip`, and the
  feature returns once the plugin ships zip 9.

## [0.3.1] - 2026-10-23

Desktop integration release: the appearance setting, the UI and the
native window now share one theme, and shelx gains the standard
desktop-app behaviors — tray, single instance, deep links, system
notifications, window state memory and more.

### Added

- **Theme synced three ways** — the backend appearance setting, the UI
  and the native window titlebar follow one source of truth; the window
  now starts dark by default instead of flashing a light titlebar, and
  startup sync happens inside the theme provider where it actually
  takes effect.
- **System tray with keep-alive close** — opt-in「关闭窗口时最小化到托盘」
  keeps SSH/SFTP sessions alive after the window closes; restore the
  window or quit from the tray icon.
- **Single instance** — a second launch brings the existing window to
  the front instead of starting another process; two instances would
  otherwise fight over the data directory.
- **`ssh://` deep links** — clicking an ssh:// link opens shelx with
  quick connect prefilled; the link reaches the already-running
  instance.
- **System notifications when unfocused** — transfer completions
  surface as OS notifications while you work in other apps; in-app
  toasts remain while shelx is focused.
- **Window state memory** — size, position and maximized state are
  restored on launch.
- **Launch at login** — opt-in autostart setting.
- **Global summon shortcut** — a preset-tiered shortcut (managed on the
  shortcuts settings page) brings the main window to the front from
  anywhere.
- **Monitor always-on-top** — pin the monitor view above other windows
  while watching server metrics.

### Changed

- Settings gained a「窗口」group — tray close behavior, autostart,
  global shortcut and system notifications — rendered from the backend
  settings schema, so each new capability has its entry point.

## [0.3.0] - 2026-10-23

Stable release of the built-in operations agent, graduating from
`0.3.0-beta`. The agent lives in a docked right-hand panel reached from
the sidebar entry, so the terminal or file list you are viewing is
squeezed — never covered — and keeps running while the panel is
collapsed.

### Added

- **Built-in AI operations agent** — a rig-based agent speaking the
  Responses/Messages protocol only, driving connected hosts through tool
  calls. Each turn is persisted and replayed as a single ordered
  timeline (thinking / tool steps / answer as ordered stream parts,
  chain-of-thought steps keyed by tool `callId`); pending approvals are
  prompt cards with a three-way decision; the system prompt is assembled
  as standard Markdown sections with a host table.
- **AI configuration moved into Settings** — shared memory and model
  profiles left the agent panel's popovers for dedicated pages under
  「设置 → AI」, and the profile form was rebuilt on react-hook-form
  with token limits validated against a backend-owned range contract,
  so out-of-range values are rejected up front.
- **Model window shipped with the package** — the context-usage meter
  takes its budget from the model window bundled with the app and can be
  overridden in settings.
- **ShelxMark brand glyph** — the terminal-prompt arrow mark now
  identifies the assistant in the sidebar entry, panel header and
  message avatars.

### Changed

- Assistant message role copy unified to「助手」(was "Agent"); idle turns
  no longer repeat the role header.
- Approval three-way decisions gained icons; the panel header and input
  area borders were simplified.

### Fixed

- Thinking-then-acting turns now render in true chronological order
  (the second round of thinking is its own block instead of being
  appended to the first), and the settled answer no longer duplicates
  the streamed copy.
- Log timestamps now use the machine's local timezone (`+08:00` style)
  instead of UTC `Z`, so log lines match the system clock.

## [0.3.0-beta] - 2026-10-22

First beta of the built-in operations agent (M5). The agent lives in a
docked right-hand panel reached from the sidebar entry, so the terminal
or file list you are viewing is squeezed — never covered — and keeps
running while the panel is collapsed.

### Added

- **Built-in AI operations agent (beta)** — a rig-based agent speaking
  the Responses/Messages protocol only, driving connected hosts through
  tool calls. Each turn is persisted and replayed as a single ordered
  timeline (thinking / tool steps / answer as ordered stream parts,
  chain-of-thought steps keyed by tool `callId`); pending approvals are
  prompt cards with a three-way decision; the context-usage meter takes
  its budget from the model window shipped with the package and can be
  overridden in settings; the system prompt is assembled as standard
  Markdown sections with a host table.
- **ShelxMark brand glyph** — the terminal-prompt arrow mark now
  identifies the assistant in the sidebar entry, panel header and
  message avatars.

### Changed

- Assistant message role copy unified to「助手」(was "Agent"); idle
  turns no longer repeat the role header.

### Fixed

- Log timestamps now use the machine's local timezone (`+08:00`
  style) instead of UTC `Z`, so log lines match the system clock.

## [0.2.26] - 2026-10-20

### Added

- **Cross-boundary contract is now generated, not hand-copied** — Rust
  types are exported as JSON Schema (`cargo test --lib ipc_contract`) and
  `bun run gen:ipc` compiles them into `src/types/gen/**`; every
  hand-written mirror type in `src/types/*.ts` was replaced by re-exports
  and aliases, so a renamed or misspelled field is now a compile error
  instead of a silently dead setting. Guards: `every_id_field_is_string_typed`,
  enum wire-literal assertions, `src/types/contract.test.ts` and
  `bun run check:ipc` (now part of the pre-commit gate list). The
  procedure itself is specified in docs/IPC_CONTRACT.md.
- **Settings ranges and presets have one owner** — new
  `application/settings/schema.rs` defines path / kind / min / max /
  presets / options / unit / default once, consumed by both `validate()`
  and the UI; the settings screen renders controls from
  `get_settings_schema`, so there is no longer a duplicate range table to
  drift. Adding a setting = register it in Rust, run `bun run gen:ipc`,
  add copy — the control appears by itself.
- **Visible entry points for capabilities that existed but were
  unreachable** — quick connect (temporary session, optional「保存为连接」),
  chmod via the remote context menu, a persistent「传输」button with
  active/pending badges in the tab bar, server overview page reachable
  from the sidebar with real metrics, scrollback rows setting, and a
  keyboard-shortcut reference section in settings.
- **Test connection before saving** — the connection form can now verify
  host / credentials with a throwaway session (released afterwards);
  failures show the backend reason without discarding what was typed.
- **File lists show real modification times** — local entries report
  actual `mtime` and (on unix) real permission bits; a「修改时间」column
  with sorting was added, and the permission column hides itself when the
  platform has no POSIX mode instead of showing a made-up value.

### Changed

- **Settings screen no longer punishes input** — numeric settings became
  preset dropdowns aligned with backend validation; a rejected save keeps
  the chosen value, shows the backend error text inline and names the
  current persisted value instead of the old「保存失败,已恢复原值」.
  Path and free-text fields commit on blur/Enter rather than per
  keystroke, so browsing a directory no longer flashes list errors.
- **Connection form validates per field** — required fields and the port
  range are checked before submitting and focus the first error; invalid
  ports no longer silently fall back to 22; auth method, private key,
  credential storage and encoding are described in user terms (with an
  `~/.ssh` key picker) rather than SSH/OS jargon.
- **Patch writes reject unknown fields** — `update_settings` now refuses
  paths outside the registered contract and returns structured
  `{path,min,max,unit,received}` details for out-of-range values. This is
  the root fix for the block-size setting: the front end had been sending
  `chunkSizeKiB` while serde emits `chunkSizeKib`, so every change was
  silently dropped and the value never took effect.
- **Status fields are enums again** — session status, transfer status and
  direction cross the boundary as typed enums (identical wire literals,
  locked by a regression test), and the transfer list renders Chinese
  status labels instead of raw enum values.

### Fixed

- **Terminal no longer doubles capital letters** — with Caps Lock or
  Shift, a letter was sent twice because the IME guard forwarded the same
  character that xterm had already emitted on `keypress`; the guard now
  defers to xterm's own dedup.
- **Font-size zoom persists correctly** — Ctrl+wheel clamps to the
  backend-allowed 8–32 (previously 6–72, so out-of-range sizes were
  silently reverted on restart) and a rejected write rolls the terminal
  back with the reason shown.
- **Transfer conflicts are no longer a dead end** — dismissing the
  decision dialog leaves the task visibly「等待你决定」with a
  「处理冲突」re-entry, the ambiguous「取消」button was replaced by the
  three real decisions, and the queued-conflict policy setting is now
  actually honoured (uploads used to hard-code「每次询问」).
- **Monitors and overview tell the truth up front** — non-Linux targets
  are explained before a doomed subscribe attempt, disconnection states
  state the next step, and the overview page no longer renders「M4 接入」
  placeholders or raw session ids.
- **Destructive actions describe real consequences** — deleting a
  connection now states that stored credentials remain in the OS keyring
  and are not cleaned up by this version; remote deletion says
  permanently / not recoverable and lists aggregated failures; PID 1
  cannot be killed from the UI.
- **Process kill wording matches behaviour** — the confirm dialog no
  longer implies a force-kill option that the backend does not have.

### Removed

- **Scaffold leftovers** — the Tauri template `greet` command, its DTO
  and application module were deleted (no caller in the front end); the
  language switcher was removed rather than left as a disabled control
  for an unimplemented i18n.

## [0.2.25] - 2026-10-20

### Fixed

- **Update dialog no longer re-checks on open** — with an update already
  detected (sidebar icon lit by the background auto-check), opening the
  dialog now shows it instantly with zero network requests; a check runs
  only when the app holds no update information at all (e.g. auto-check
  disabled or still in its startup delay). Manual refresh stays on the
  「重新检查」button.
- **Dialog title covers the checking state** — while a check was in
  flight the title previously flipped to「已是最新版本」, contradicting
  the blue sidebar icon and the release notes still on screen; it now
  reads「正在检查更新…」.
- **Install obtains the updater handle lazily** — updates found by the
  background auto-check carry no plugin `Update` object, so「立即更新」
  now performs a silent check first (shown as「正在获取更新信息…」),
  refreshes version / release notes when a newer release exists, and
  falls back to "up-to-date" with a toast when the notice is stale
  instead of failing silently. Concurrent install clicks and late
  `app-update-available` events during an install are ignored.

## [0.2.24] - 2026-10-19

### Added

- **Persistent monitoring history** — collection now follows the session
  instead of the monitor view: switching tabs no longer stops collection
  or wipes the ring buffer, so returning to the「监控」tab shows the
  continuous curve instead of rebuilding from zero. Changing the
  sampling interval keeps history in place (no more CPU gap). A
  time-window selector (5m / 15m / 30m / 1h, default 15m) replaces the
  previous hard-coded ~4-minute view; beyond 600 points curves are
  downsampled with the newest point always kept.

### Changed

- **Monitor IPC contract** — `start_monitor`/`stop_monitor` are replaced
  by `ensure_monitor` (idempotent keep-alive, in-place interval update),
  `attach_monitor` (subscribe, returns a subscription id) and
  `detach_monitor` (unsubscribe). Stopping is now owned by the session
  close hook and the disconnect self-check; view unmount only detaches.
  See docs/TECHNICAL_DESIGN.md §9.5 and the IPC table.

### Fixed

- **Sidebar monitor no longer freezes** — the sidebar and the monitor
  view previously fought over a single collector slot per session
  (last starter took over the sample channel; leaving the monitor view
  killed collection entirely, freezing the sidebar on stale values).
  Both are now independent subscribers of a session-scoped collector.

## [0.2.23] - 2026-10-19

### Added

- **Process manager view** — a new「进程」workspace tab (Alt+3, alongside
  终端/监控/文件) shows a task-manager-style process table for the
  connected host: process name, owner, PID, state, current CPU%, memory
  (RSS) and cumulative CPU time. Every column header sorts (click to
  toggle direction with an arrow indicator, stable tie-break by PID) and
  a filter box matches process name / command line / user / PID. The
  list polls every 2s while the tab is open and covers all five UI
  states (loading, error + retry, paused while offline, empty, ready).
- **Kill process** — each row has an end-process action with a
  confirmation dialog that shows the full command line and a
  non-reversible warning. It sends SIGTERM via `kill -TERM <pid>`,
  verifies the real exit status, and reports the outcome via toast
  before refreshing the list; failures keep the dialog open. The PID is
  validated at the command boundary (u64 only, pid 0 rejected to
  protect the process group), so no user input ever reaches the shell
  unescaped.
- **Process snapshot collector and CPU% delta** — `ps` is parsed
  instead of scraping `top` (stable columns, locale-independent). Since
  ps `%CPU` is a lifetime average, the current usage is derived in the
  domain layer by diffing each PID's cumulative CPU time between two
  snapshots (the same algorithm top uses internally); the first
  snapshot reports `null` like the other monitor metrics, and PID reuse
  clamps to 0. Targets without procps (`busybox`) show an empty state
  instead of failing.

## [0.2.22] - 2026-10-19

### Added

- **Load state badge in the monitor view** — the load card now shows a
  state badge (idle / normal / busy / overloaded) derived from the
  1-minute load average divided by the CPU core count; the raw
  1/5/15-minute values move to a caption on the card's right.

### Changed

- **CPU and memory cards use donut charts** — the monitor view shows the
  latest usage as a donut with the percentage in the center instead of
  time-series area charts. Colors come from the `--chart-*` theme tokens,
  so they follow light/dark mode. The default sampling interval drops
  from 5s to 2s.
- **Disk and per-core sections get icon headers** — both sections show a
  header with a hint (mount count / core count) and reflow into more
  columns on wider panels; disk rows now place the percentage before the
  bar. Chart grid lines use `var(--border)` directly, fixing an
  inconsistent `hsl()`/`oklch()` wrapper.

### Fixed

- **Disk list no longer shows pseudo filesystems** — `df` parsing now
  also excludes `efivarfs` and `cgroup2` by type and filters mounts
  under `/proc`, `/sys`, `/dev` and `/snap`, so snap loop devices
  (`/dev/loopN` mounted at `/snap/...`) no longer appear as disks.

## [0.2.21] - 2026-10-18

### Added

- **Disk usage in the sidebar monitor** — the compact sidebar panel now
  shows disk rows under CPU / memory / swap. The root filesystem is
  labeled "磁盘"; additional mount points show their mount path, up to
  three rows (the full list remains in the monitor view). Bars turn
  orange above 85% and red above 95% usage, matching the full monitor
  view.
- **Terminal clipboard over the native channel** — copy-on-select,
  right-click paste and OSC 52 now read and write the system clipboard
  through the native clipboard plugin instead of the Web Clipboard API,
  which WKWebView rejects with `NotAllowedError`. Failures degrade to a
  console warning and no longer produce unhandled rejections.

### Fixed

- **Chinese IME input no longer fragments in the terminal** (macOS) —
  input methods that report keyCode 229 for every key with no
  composition events produced shattered or duplicated text such as
  "f rf ree -h" (upstream xterm.js#5887). A host-level IME guard now
  intercepts those events outside real composition windows and forwards
  the exact inserted text to the terminal; pinyin composition is
  untouched.
- **WebGL context loss no longer breaks the terminal** — when the GPU
  rendering context is lost, the addon disposes itself and the terminal
  falls back to the built-in DOM renderer; cleanup no longer
  double-disposes the dead addon.
- **Clearer macOS keychain error** — when keychain access is denied
  (typical after repeated dev rebuilds change the binary signature),
  the error message now explains that re-saving the password on the
  connection rebuilds the entry.

### Changed

- Network throughput tooltips use adaptive units (KiB/s, MiB/s, …)
  instead of a fixed MB/s, and the monitor time axis now includes the
  hour.
- Polished the disconnected/reconnect banner styling.

## [0.2.20] - 2026-09-21

### Added

- **Update dialog shows live download progress** — after starting an
  install, the dialog switches in place to a determinate progress bar
  when the server reports the update size, or an indeterminate state
  otherwise, then to an "installing" state while the updater takes over
  for install and relaunch. Re-checking for updates is blocked during
  installation; the dialog can be closed and reopened while the
  download continues in the background.

### Changed

- **Terminal settings now apply to already-open terminals instantly** —
  font family, font size, line height and cursor style hot-update live
  terminals (with a refit and pty resize when font metrics change)
  instead of only taking effect for newly opened terminals;
  copy-on-select and right-click paste toggles are read live as well.
  The settings page hint now reads "changes take effect immediately".

### Removed

- **Scrollback buffer setting** (Settings → Terminal) — the terminal
  keeps using a previously saved value or the default 5,000 lines.
- **Default encoding setting** — it had no effect; terminal encoding
  comes from each connection's own configuration.

## [0.2.19] - 2026-09-21

### Added

- **Local data now lives in `~/.shelx`** (previously
  `~/.agents-plus/shelx`). Existing data is offered a guided one-shot
  migration: about two seconds after startup a dialog lists exactly what
  will be moved (SQLite database, logs, fallback credentials with sizes);
  choosing **Migrate** writes an approval marker and relaunches the app,
  and the switch itself is an atomic rename performed early in the next
  startup — before any file handle is open — so it is instant and safe.
- **Settings → Data Storage section** always shows the current data
  directory and, if legacy data is still waiting, a manual "Migrate now"
  entry — dismissing the automatic dialog never hides it.
- **Extensible migration registry** (`MigrationSpec`): future data
  migrations register a stable id plus copy, reusing the same dialog and
  settings entry with no frontend changes.

### Changed

- Choosing **Not now** on the migration dialog permanently silences the
  automatic prompt for that migration (persisted per migration id);
  migration stays available from Settings.
- While legacy data is unmigrated the app keeps running entirely on the
  old directory (single-writer invariant), so deferring never splits or
  merges data.

### Fixed

- In `tauri dev`, approving a migration no longer attempts an automatic
  relaunch (the dev runner reaps the relaunched child, which looked like
  a crash); it now asks for a manual dev-process restart instead.

## [0.2.18] - 2026-09-21

### Added

- **Release notes are now rendered as rich markdown** in the update
  dialog — headings, lists, bold/italic, tables, syntax-highlighted
  code blocks (Shiki), mermaid diagrams, LaTeX math (KaTeX) and
  CJK-aware typography — replacing the raw monospace text dump.
- **Links inside release notes open in the system browser** via the
  opener plugin instead of navigating the embedded web view, which
  would otherwise replace the running app UI.

### Changed

- **Full release notes are shown** with the body scrolling inside the
  dialog, replacing the previous 12-line truncation that could cut
  markdown syntax mid-way.

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
