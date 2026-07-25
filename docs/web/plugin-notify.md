---
group: plugins
order: 5
title: "geneseed-notify"
kind: "concept"
---
Pings the OS when the agent finishes a turn, so you can start a long run, walk away, and be called back when it's your move again. It hooks `session.idle` like the learn plugin.

- **Anti-spam:** only fires when the turn actually took a while — the gap between the session's last user prompt and now must exceed `GENESEED_NOTIFY_MIN_SECONDS` (default 30). Native subagent child sessions and the learn plugin's throwaway distil sessions are skipped.
- **Native, dependency-free:** macOS `osascript`, Linux `notify-send` (libnotify), Windows a PowerShell balloon. Spawned detached; any failure is swallowed, so it never blocks a session.

### Install

Installs with the other plugins in one step — see [Plugin setup](#/docs/plugin-setup). On Linux, install `libnotify` (for `notify-send`) if nothing appears.

### Configure

- `GENESEED_NOTIFY=off` — disable it.
- `GENESEED_NOTIFY_MIN_SECONDS=N` — tune the threshold (`0` notifies on every turn).
- `GENESEED_NOTIFY_TITLE="…"` — override the title (default `Geneseed`).

### Verify

With `GENESEED_DEBUG=1`, end a session that ran longer than the threshold — you'll see `[geneseed-notify] notified for …` and a desktop notification.
