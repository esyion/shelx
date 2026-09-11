## Summary

<!-- One-paragraph summary of what this PR changes and why. -->

## Linked issues

<!-- Closes #123, refs #456. Use "Closes" only when the PR fully resolves the issue. -->

## Type of change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality
      to change — call this out explicitly)
- [ ] Refactor / chore (no user-facing behavior change)
- [ ] Documentation only

## Layering check

<!-- AGENTS.md §4 is the source of truth. Tick the boxes that apply and
     explain any that don't. -->

- [ ] Frontend change goes through `src/gateway/tauri.ts`; no direct
      `@tauri-apps/api` calls in components.
- [ ] Rust change keeps `#[tauri::command]` thin — boundary validation
      only, business logic stays in `application/` or `domain/`.
- [ ] Domain code remains pure Rust (no env, no file I/O, no IPC DTOs).
- [ ] New / changed ports have infrastructure implementations.

## IPC & capability impact

<!-- If this PR touches IPC, capability, or CSP, list exactly what changed
     and link the updated files. If none of these changed, write "None". -->

- Commands added or modified:
- DTOs added or modified:
- Capabilities / CSP changes:

## Security impact

<!-- Honest assessment. If there is no security implication, say so. -->

## How I tested

<!-- Mirror the CI commands; the local results are what we trust. -->

```bash
bun run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
bun run test
```

- [ ] I ran the four commands above locally and they pass.
- [ ] I added or updated tests covering the change (unit / integration /
      regression). List the test files below.
- [ ] I manually exercised the desktop app on: <!-- Windows / macOS / Linux -->

Test files:

## Screenshots / recordings

<!-- UI changes only. Drag in images or link to recordings. -->

## Known limitations

<!-- Anything you intentionally left out, follow-up work, or "could be done
     better but isn't required for this PR". Reviewers will look here. -->

## Checklist

- [ ] I have read [CONTRIBUTING.md](../CONTRIBUTING.md) and
      [AGENTS.md](../AGENTS.md).
- [ ] My commits follow Conventional Commits and each commit is logically
      scoped.
- [ ] I did not include secrets, hostnames, or user data in commits, logs,
      or screenshots.
