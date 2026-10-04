---
name: upgrade-scout
description: Pick the next dependency upgrade and read its breaking changes, or declare all done.
effect: read
agent: researcher
outcomes: more, done
---
Read the requirement and the loop's history (LOOP.md, `git log --format=%(trailers)` on this
branch). Pick the next package or group the requirement names that is not yet upgraded, skipping
any release younger than 14 days, and read its changelog or migration guide. Never edit any file.

Report `done` when every named package is upgraded. Otherwise report `more` with a card:
{"intent": "<bump X to N and adapt>", "writeSet": ["<manifest, lockfile, every file to adapt>"],
 "actions": ["<each of: format, imports, rename, logic, new-file, api, delete, architecture>"]}
Write the breaking changes that hit this repo to a file in the OS temp directory and report that
file's path with the outcome — the card alone does not carry them to `apply`.
