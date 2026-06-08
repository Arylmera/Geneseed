# Spec — install/update: auto-retry steps, stop on failure

> When an install/update step fails, retry it (transient failures self-heal), and if it
> still fails, STOP — never run a later step, or the setup wizard, on top of a broken
> update. Closes the "it doesn't retry or fix it, it just barrels on" gap.

**Date:** 2026-06-08
**Status:** implementing
**Scope:** Behaviour of the curses progress flow + the non-curses fallback. No new
screens; no change to what each step does.

## Problem

Only `upgrade.sh` retried — and only its *download*. The orchestration UI did not:

- `_run_steps` marked a step `failed` but **ran the next step anyway** (e.g. rebuild even
  after refresh-scripts failed), and offered **no retry**.
- `_bootstrap_progress` continued into **setup after a failed update** ("press any key to
  continue to setup") — running the wizard on possibly-stale/broken code.
- `_bootstrap_plain` (non-curses) used an unchecked `run()` — never aborted on failure.

So a single transient hiccup forced a manual re-run, and a real failure was followed by
setup regardless.

## Decision (user-selected)

- **Auto-retry only** — retry a failed step up to N times with exponential backoff, no
  interactive prompt; on final failure, stop and surface the captured output.
- **Stop, don't run setup** — a failed update halts before the wizard.

## Change

- `_run_steps(…, attempts=3)` — retries each step (backoff 2s, 4s) and **breaks the chain**
  the moment a step fails after all attempts (remaining steps stay `pending`). Returns the
  status list so callers can tell success from failure.
- `_bootstrap_progress` → returns `bool` (all steps done). On failure it pauses on the
  error instead of auto-advancing.
- `_retry_plain(label, cmd, attempts=3)` + `_bootstrap_plain` → mirror the retry/stop in
  the non-curses path; returns success.
- `cmd_bootstrap` — captures success; on failure prints a clear message and **returns 1
  without running setup**. `_main_menu`'s update/bootstrap action re-execs back to the
  **menu** (not setup) when the update failed.

## Out of scope

Interactive retry prompts (explicitly not chosen), auto-diagnosing/repairing arbitrary
build errors, changing `upgrade.sh`'s own (already-present) download retry.

## Verification

1. `python -m unittest discover -s tests` — full suite green (+4): `_retry_plain` succeeds
   first try, fails after exhausting attempts (with backoff), and `_bootstrap_plain` stops
   at the first failed step / runs both on success.
2. `python rituals/harness.py doctor --all` — green.

## Worklog

- [x] `_run_steps` retry + stop-on-fail; `_bootstrap_progress` returns success
- [x] `_retry_plain` + `_bootstrap_plain` retry/stop; `cmd_bootstrap` skips setup on failure
- [x] `_main_menu` update/bootstrap respects the result
- [x] unit tests (93 green) + doctor --all
- [ ] commit + push
