---
name: docs-update
description: Update the documentation this iteration's diff made stale.
effect: mutate
agent: docs
outcomes: pass
---
Read this iteration's diff and find every doc it made stale: a changed signature, a renamed
flag, a moved file, a behaviour the README or docs still describe the old way.

Update only those docs, only to match what the diff actually changed. Do not rewrite unrelated
prose, reorganize a page, or fix an unrelated staleness you happen to notice while in there.
Keep each doc in the format it is already in (Markdown or AsciiDoc) — never convert one; a new
page follows the `Docs format:` line in the root `AGENTS.md`.

As a factory's docs lane, there is no iteration diff: the stage hands you the work item as
`carry` (and, when a later stage sent the work back, the reason). Make the doc change the work
item asks for, under the same limits, then commit the files you changed: the factory records a
stage only on a clean tree.

Report `pass` once every doc the diff touched is back in sync, naming the files you changed — or
that none needed it, if the diff left nothing stale.
