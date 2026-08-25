# Security Policy

Flightdeck is a personal, local-only tool — no hosted service, no user
accounts, no data collected from anyone but the person running it. Most of
what would be a "security issue" in a hosted app doesn't apply here, but a few
things are still worth knowing and reporting on if they break.

## What Flightdeck does with sensitive data

- **`ANTHROPIC_ADMIN_KEY`** is read server-side only, in Next.js route
  handlers, and never returned to the browser or logged.
- **Antigravity's cached Google access token** (used only when
  `ANTIGRAVITY_LIVE_QUOTA=1`) is read from local IDE state, sent only to
  Google's own endpoint over HTTPS, and never logged, persisted, or included
  in any API response this app returns.
- **`.env.local`** and the SQLite database under `data/` are gitignored and
  never committed. `.env.local.example` ships with every value blank.
- The server binds to `127.0.0.1` only — it is not reachable from the network,
  by design, with or without a firewall.

## Reporting a vulnerability

If you find a real security issue — a secret leaking into a response, the
server binding somewhere other than `127.0.0.1`, or similar — please open a
GitHub issue on this repository. This is a hobby project maintained by one
person in their spare time, so there's no formal SLA, but real reports will be
looked at and fixed.

Please don't open public issues for anything that would need a live secret or
live account to reproduce — describe the mechanism instead.
