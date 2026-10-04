---
group: reference
kind: "concept"
section: "Troubleshooting"
order: 4
title: "Troubleshooting"
description: "Problems organised by what you see, and the first command to run."
---
Find what you are seeing on the pages below. Each entry gives the likely cause, the fix, and how to confirm it worked. Messages in quotes are what Geneseed actually prints.

First stop for almost anything: `geneseed doctor`. It renders the harness into a temp directory and reports every problem it finds without touching your install.

```bash
geneseed doctor
```

## By where it happens

- [Install problems](troubleshoot-install.md): Node, `setup`, `command not found`.
- [Hook, context and memory problems](troubleshoot-hooks.md): hooks that stop firing, missing project docs, no memory.
- [Update problems](troubleshoot-update.md): when `geneseed upgrade` refuses to run.
- [Doctor findings](troubleshoot-doctor.md): what `geneseed doctor` reports, and the fix.
- [Web console problems](troubleshoot-web.md): a missing build, a stale page, no deployed harness.

A loop that misbehaves has its own table in [Finish a loop](../guides/loop-finish.md).
