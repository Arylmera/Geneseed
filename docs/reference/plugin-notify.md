---
group: reference
kind: "concept"
section: "OpenCode plugins"
order: 15
title: "geneseed-notify"
description: "A desktop notification when a long turn finishes."
---
One of the [OpenCode plugins](opencode-plugins.md). Its switches are also listed in [Environment variables](environment.md).

**What it does.** Sends a native desktop notification when the agent finishes a long turn, so you can start a run, walk away, and be called back. macOS uses `osascript`, Linux `notify-send` (install `libnotify` if nothing appears), Windows a PowerShell balloon.

**When it runs.** When a session goes idle, and only if the turn took longer than `GENESEED_NOTIFY_MIN_SECONDS` (default 30) since your last prompt. Sub-agent sessions and the learn plugin's own sessions are skipped.

**What you see.** A notification titled `Geneseed`. With `GENESEED_DEBUG=1`, `[geneseed-notify] notified for …` on stderr.

**Switches.**
- `GENESEED_NOTIFY=off` — disable.
- `GENESEED_NOTIFY_MIN_SECONDS=N` — threshold (`0` = every turn).
- `GENESEED_NOTIFY_TITLE="…"` — the title.
