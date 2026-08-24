# Ops Dashboard

A local dashboard for Claude usage, MacBook health, and Antigravity activity.
Runs on `127.0.0.1:3111` only — never exposed to the network.

```bash
npm run dev
```

## Panels

### Today (date/time, weather, calendar)
A live clock, current weather, and upcoming calendar events — general-purpose
widgets, not Claude-specific, shown at the top of the Overview tab.

- **Weather** geocodes `WEATHER_LOCATION` (a free-text city name) once via
  Open-Meteo's free geocoding API, then polls current conditions every 15
  minutes. No API key required. Both responses are cached in SQLite (30 days
  for the geocode, 15 minutes for conditions) so restarts don't re-geocode.
- **Calendar** reads `GOOGLE_CALENDAR_ICS_URL` — a Google Calendar "secret
  address in iCal format" (Settings → your calendar → that section). This is
  a bearer secret: keep it in `.env.local` only, never in chat or committed —
  regenerate it in Google's settings to revoke access. The ICS parser handles
  a practical subset of RFC 5545 (verified against a synthetic fixture:
  plain events, all-day events, `CANCELLED` filtering, and weekly `RRULE`
  recurrence with `BYDAY`/`UNTIL`/`EXDATE`) — not the full spec (no
  `BYMONTHDAY`, `BYSETPOS`, etc.). Timezone conversion uses Node's built-in
  ICU data (`Intl.DateTimeFormat`) rather than a timezone-database dependency,
  verified against known UTC offsets including a DST boundary.

### Plan limits (real quota)
The Claude **desktop app** caches its own account-synced usage percentages at
`~/Library/Application Support/Claude/plan-usage-history.json`, sampled every
~15 minutes while it runs — the same numbers behind its own Settings → Usage
pane. This is the one source in this dashboard that is genuine account quota,
not a token-derived estimate: session (a rolling ~5-hour window) and weekly
(7-day, all models, observed resetting Sundays). Requires the desktop app to
have been opened at least once, and it stops updating while closed.

### Claude Code (subscription)
Reads `~/.claude/projects/**/*.jsonl` directly. Per-request model, token counts
(including the 5-minute vs 1-hour cache-write split), project, branch, and effort.

Two things this gets right that a naive reader would not:

- **Deduplicated by `requestId`.** One API request emits several assistant lines
  — one per content block — each carrying the *same cumulative* usage object.
  Measured here: 6,289 usage-bearing lines collapse to 3,255 real requests, every
  duplicate byte-identical. Summing lines overstates cost by ~93%.
- **Subagent transcripts included.** 91 of 122 transcripts live in
  `<project>/<sessionId>/subagents/`, not the session file. A single-level scan
  silently drops ~18% of billed requests.

Costs are *equivalent API value* — what the same work would cost at list prices —
not a charge against your plan. Prices resolve per-day, because Sonnet 5's
introductory rate ends 2026-08-31.

Trailing 5-hour and 7-day windows are shown as **consumption**, not quota. Real
plan limits are enforced server-side and are not exposed to any local client, so
there is no honest way to render "% of plan used".

### Claude API (paid)
Nothing about API usage is stored locally, so this queries the Admin API
(`/v1/organizations/usage_report/messages` and `/cost_report`), following
`next_page` because `bucket_width=1d` caps a page at 31 buckets. Dollars come
from the cost report when available; token-derived estimates are the fallback and
are labeled as such.

Set `ANTHROPIC_ADMIN_KEY` in `.env.local`. It must be an **Admin** key
(`sk-ant-admin…`) created by an org owner at console.anthropic.com — a regular
API key cannot read usage reports. Without one the panel renders a setup card.

### System
Everything unprivileged; `powermetrics` needs sudo, so per-core power and
thermals are out of scope.

**Creating a process costs ~200ms on this machine** — the commands themselves are
free, so spawn overhead dominates entirely (four parallel spawns measured at
~690ms; batching them into one `sh -c` saves nothing, because the cost is per
process created). So `iostat -w 1`, `vm_stat 1`, and `netstat -w 1` each run
**once** as long-lived streams and the API reads the newest row. That took
`/api/system` from **1.37s to 6ms**. Disk, battery, and the process list still
spawn, but are cached at 60s/30s/5s — well past the 2s poll.

Samples are written to SQLite every 60s and pruned after 30 days.

### Antigravity
Antigravity stores **no token or credit counts on disk** — `modelCredits` holds
only protobuf sentinels. Two sources are used instead:

- **Live quota (opt-in).** Set `ANTIGRAVITY_LIVE_QUOTA=1` to reuse the IDE's
  cached Google access token against the same undocumented Cloud Code endpoint
  the IDE itself polls. The token goes only to Google, its own issuer; the
  refresh token is deliberately never touched. It expires roughly hourly, so
  expect this to fail unless Antigravity was open recently — every failure falls
  back cleanly, and no token material ever appears in an API response.
- **Local state (always).** `state.vscdb` is copied to a temp file and opened
  read-only — the IDE holds the original open with WAL, and writing to it could
  corrupt the running editor. Agent trajectories are decoded from an
  undocumented nested protobuf with a structural wire-format reader; malformed
  records are skipped rather than failing the panel.

IDE uptime is reconstructed from `loadCodeAssist` heartbeats (one per ~5 min),
with a >15 min gap ending a session. This measures **the IDE running**, not time
spent actively working. Log-directory mtimes are not usable for this — they
report a flat 24h every day the app merely stayed open.

## Always-on

```bash
./deploy/install.sh
```

Builds, then installs a launchd agent that starts at login and restarts on crash.
Docker is deliberately not used: Docker Desktop runs a Linux VM, so `vm_stat`,
`pmset`, and `ioreg` would not exist in the container and `/proc` would describe
the VM rather than the Mac.

The agent pins node's absolute path because launchd gets a minimal PATH and
cannot resolve nvm — **re-run `install.sh` after switching node versions**.

```bash
./deploy/uninstall.sh    # remove the agent; project and data untouched
tail -f data/dashboard.log
```

## Configuration

`.env.local` (mode 600, gitignored):

| Variable | Purpose |
|---|---|
| `ANTHROPIC_ADMIN_KEY` | Admin key for the Claude API panel. Server-side only. |
| `ANTIGRAVITY_LIVE_QUOTA` | `1` to attempt the live Antigravity quota lookup. |

## Footprint

Measured with the dashboard open and polling every 2s: **0–2% of one core,
80–106MB RSS** across the Node server and all three stream samplers, each of
which sits at 0.0% CPU and 1–3MB. With the tab closed, only the 60s collector
runs. Polling is gated on `document.visibilityState`.
