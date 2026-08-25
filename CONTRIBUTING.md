# Contributing

Flightdeck started as a personal tool for monitoring one Mac, one Claude
account, and one Antigravity install — it's public so the approach is useful
to others, not because it's aiming to become a general-purpose product. Keep
that in mind when opening a PR: small, focused fixes are much more likely to
land than large new features or a different architectural direction.

## Before you start

- **This is macOS-only, by design** (see the README's Prerequisites). PRs
  that try to make the System panel cross-platform are out of scope unless
  they preserve the exact behavior on macOS — the whole point of that panel is
  reading real `iostat`/`vm_stat`/`netstat`/`ioreg` output, not an abstraction
  over it.
- If you're proposing something non-trivial (a new panel, a new data source,
  a structural change), open an issue first to discuss the approach before
  writing code — it'll save you a rewrite if the direction doesn't fit.

## What's genuinely welcome

- Bug fixes, especially anything that produces a wrong number silently
  (this project cares a lot about that — see the `requestId` dedup and
  subagent-transcript notes in the README for the kind of correctness bug
  worth catching).
- Fixes for local setups this wasn't tested against (different node/npm
  versions, different Antigravity or Claude desktop app versions whose local
  file formats have drifted).
- Documentation fixes.

## Local setup

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

`npm run build && npx tsc --noEmit` before opening a PR — there's no CI here,
so a clean local typecheck and build is the bar.

## Commit style

Plain, descriptive commit messages explaining *why*, not just *what*. Look at
the existing git log for the tone this project uses.
