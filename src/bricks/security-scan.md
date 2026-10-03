---
name: security-scan
description: Security review of this iteration's diff.
effect: read
agent: security
outcomes: pass, fail
---
Read this iteration's diff and review it for security issues: injected input reaching a
dangerous sink, a widened trust boundary, a secret written to disk or logs, a weakened auth or
permission check — anything that would not survive a real security review.

Never edit any file; this brick only observes and reports.

Report `pass` if nothing in the diff raises a security concern.

Report `fail` with each finding as `file:line`, the concrete risk, and the fix — severe enough to
block the iteration, not a style nit that belongs in `review` instead.
