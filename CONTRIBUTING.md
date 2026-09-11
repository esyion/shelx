# Contributing to shelx

Thanks for taking the time to contribute. This document is the short version
of how to set up the project, make a change, and get it merged. The full
engineering rules live in [`AGENTS.md`](AGENTS.md) — read it before opening
a non-trivial PR; it is normative.

> By participating in this project you agree to follow our
> [Code of Conduct](.github/CODE_OF_CONDUCT.md).

## Project at a glance

- **Desktop shell**: Tauri 2 (Rust backend, statically exported Next.js
  WebView).
- **Frontend**: Next.js App Router + React 19 + TypeScript + Tailwind CSS v4
  + shadcn/ui (Base UI) + Zustand. Built with **bun**.
- **Backend**: Rust 2021, built with **cargo**.
- **IPC boundary**: every Rust ↔ frontend call goes through
  `src/gateway/tauri.ts` on the frontend and `#[tauri::command]` in
  `src-tauri/src/commands/` on the backend.
- **Layering**: presentation → application → domain; infrastructure is
  injected via ports (traits). The full rule set is in AGENTS.md §4.

## Local setup

You need:

- **bun** (any recent version)
- **Rust** stable toolchain with `clippy` and `rustfmt`
  (`rustup component add clippy rustfmt`)
- Platform Tauri prerequisites — see the
  [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/).

Then:

```bash
git clone https://github.com/esyion/shelx.git
cd shelx
bun install                 # frontend dependencies
bun tauri dev               # launches the desktop window; internally runs next dev on :3000
```

The first `bun tauri dev` will compile the Rust backend, which takes a few
minutes; subsequent runs are incremental.

## Quality gates (must pass before a PR)

Run all four locally — they mirror what CI does:

```bash
bun run build                                                # Next.js static export → out/
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
bun run test                                                  # vitest
```

Tips:

- `cargo fmt -- --check` should be followed by `cargo fmt` (no flag) when
  you actually want to reformat.
- A failing clippy warning is a blocking issue; do not silence it without a
  justification comment.
- Add a regression test when you fix a bug. Domain rules belong in
  `src-tauri/src/domain/` with unit tests next to the code.

## Working on something

1. **Open an issue first** for anything beyond a trivial fix. For
   non-trivial features, share the user case, data flow, and IPC contract
   impact up front. AGENTS.md §12 ("New feature implementation flow") is the
   template we expect PRs to follow.
2. **Fork & branch** from `main`:
   `git checkout -b feat/<short-topic>` or `fix/<short-topic>`.
3. **Keep the change focused.** One topic per PR. Drive-by reformatting and
   unrelated refactors make review harder and will be asked to be split out.
4. **Respect the layering.** Don't reach across layers:
   - Frontend components → `gateway` only, never `@tauri-apps/api` directly.
   - `#[tauri::command]` → application use case only, no I/O.
   - Domain code stays pure Rust — no env, no file I/O, no IPC DTOs.
5. **Contracts are versioned.** If you add or change a Tauri command or a
   frontend API, update `docs/PRD.md` / `docs/TECHNICAL_DESIGN.md` and the
   matching capability. Frontend and backend types must stay in sync; we use
   shared camelCase DTOs and `string` IDs everywhere.

## Commit messages & PRs

- Use [Conventional Commits](https://www.conventionalcommits.org/):
  `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`.
- One logical change per commit; small commits are easier to review and
  revert.
- The PR description must cover: **why**, **what changed**, **scope of
  impact**, **IPC / capability changes**, **security impact**, **test
  commands run**, and any **known limitations**. The AGENTS.md §11 checklist
  is the canonical version.
- Reference the issue (e.g. `Closes #123`). Screenshots / screen recordings
  for UI changes.

## Security

Found a vulnerability? **Do not** file a public issue — see
[SECURITY.md](.github/SECURITY.md) for the private reporting channels.

## License

By contributing, you agree that your contributions will be licensed under
the project's [MIT License](LICENSE).
