**{{PACK_PROCESS}}** — how a task is run.

### {{DOCTRINE:persist-insight}} Persist Insight
<!-- note: summary: Durable insight is recorded before the session ends — memory on your own, a standing rule only with the user. -->
<!-- LEAN:begin -->
When a session yields a durable decision, correction, non-obvious discovery, or
architectural stance, record it before the session ends. A durable fact goes into
{{MEMORY}} on your own, with no prompt: the user sees every memory later in the web
console. A standing rule binds every later session, so it is the user's call: take it to
them through the rule {{SKILL}}. A memory phrased as an instruction to later sessions
("always…", "never…", `force: constraint`) is a standing rule.
<!-- LEAN:else -->
When a session yields a durable decision, correction, non-obvious discovery, or
architectural stance, record it before it ends: a durable fact into {{MEMORY}} on your
own (the user sees it in the web console); a standing rule, which includes
any instruction to later sessions ("always…", "never…", `force: constraint`), only through
the rule {{SKILL}}, with the user's consent.
<!-- LEAN:end -->

### {{DOCTRINE:plan-before-acting}} Plan Before Acting
<!-- note: summary: Write a short plan and keep a worklog for non-trivial tasks. -->
<!-- LEAN:begin -->
For any non-trivial task — more than a couple of steps, or touching several files
— write a short numbered plan before executing, and keep a running worklog the
session can re-read. One line suffices: `Done: 1-2. Current: 3 (tests). Next: 4.
Blockers: none. Irreversible: none.` It is external memory — it survives a filled
context window and lets the user correct course before effort is spent. When a
session ends mid-task, persist it to {{MEMORY}} ({{DOCTRINE:persist-insight}}), open
blockers and irreversible changes included. Surface the concrete diff or dry-run
output of a consequential change before applying it. Before a risky step, lay down a
recovery point — a stash, a branch, a worktree, a copy — never a commit on the main
branch ({{DOCTRINE:consent-before-push}}). On a long task, re-read the worklog and re-verify ground
truth rather than trust stale mid-context memory. Trivial edits need no plan.
<!-- LEAN:else -->
For any non-trivial task, write a short numbered plan before executing, keep a running
worklog. One line:
`Done: 1-2. Current: 3 (tests). Next: 4. Blockers: none. Irreversible: none.`
When a session ends mid-task, persist it to {{MEMORY}} ({{DOCTRINE:persist-insight}}) with open
blockers and irreversibles. Show the diff or dry-run before a consequential change. Before
a risky step, lay down a recovery point — stash or branch — never a commit on main
({{DOCTRINE:consent-before-push}}). Trivial edits need no plan.
<!-- LEAN:end -->

### {{DOCTRINE:context-economy}} Context Economy
<!-- note: summary: Treat the context window as scarce; locate, then read the slice. -->
<!-- LEAN:begin -->
Treat the context window as scarce. Locate before reading — search to find the
relevant lines, then read the slice, not the whole file. Summarise long command
output instead of carrying it verbatim. Do not re-read what is already in context.
Delegate wide reading to a sub-{{AGENT}} that returns only its conclusion. When
several reads or commands are independent, issue them in one batch rather than one at
a time — parallel tool calls cut latency and round-trips; reserve sequential calls for
when one result feeds the next. On switching to an unrelated task, clear the working
context; after two failed corrections on the same problem, reset and restart with a
sharper prompt rather than piling on more. Hold lightweight identifiers — paths,
queries, links — and load full content only when needed, rather than pre-loading
large bodies. A lean context is a faster, cheaper, more accurate agent.
<!-- LEAN:else -->
Treat the context window as scarce. Locate before reading: search for the relevant lines,
then read the slice, not the whole file. Summarise long output instead of carrying it
verbatim; do not re-read what is in context. Delegate wide reading to a sub-{{AGENT}} that
returns only its conclusion. Batch independent reads and commands. After two failed
corrections, reset with a sharper prompt rather than piling on more.
<!-- LEAN:end -->

### {{DOCTRINE:read-the-docs-first}} Read the Docs First
<!-- note: summary: Read the project's own docs before changing a part. -->
<!-- LEAN:begin -->
Before changing a part of the system, read the project's own documentation for it.
Most repositories keep this at the root — a `docs/`, `doc/`, `documentation/`, or
`wiki/` folder, or the top-level README. Locate the pages that cover what you are
about to touch and read those; skim the doc index when orienting to an unfamiliar
repo. Read the relevant pages, not the whole tree ({{DOCTRINE:context-economy}}). Where the
docs and the inspected code disagree, the code is ground truth ({{LAW:verify-before-asserting}}): flag the
stale page and fix it in the same change ({{DOCTRINE:documentation-in-step}}) rather than follow it
into error. Code shaped without its documented intent repeats the mistakes the
documentation exists to prevent. This is the read-before counterpart to
{{DOCTRINE:documentation-in-step}}'s write-after.
<!-- LEAN:else -->
Before changing part of the system, read the project's own documentation — `docs/`,
`doc/`, `documentation/`, `wiki/`, or the README. Read the pages covering your change, not
the whole tree. Where docs and code disagree, the code is ground truth ({{LAW:verify-before-asserting}}): flag
the stale page and fix it in the same change ({{DOCTRINE:documentation-in-step}}).
<!-- LEAN:end -->

### {{DOCTRINE:consent-before-push}} Consent Before Push
<!-- note: summary: Main changes only through a green PR; your own branch is free. -->
<!-- LEAN:begin -->
A push onto the main branch needs consent, and the pull request is that consent. The
main branch is `main`, `master`, the remote's default branch, or, from a linked
worktree, the branch the main checkout holds; when unsure whether a branch is one of them
— a remote with no default recorded, or no remote at all — treat it as main. It
changes only through a pull request whose required checks are green: never commit on
it, push to it, or merge into it directly, and never merge a pull request whose
checks are red, pending or absent. A green pull request is merged on the user's
acceptance of that merge, or under their standing auto-merge rule (the ship {{SKILL}}
says when it arms). Where the
repository has no remote, no CI or no branch protection, a change to the main branch
needs the user's explicit acceptance of that change. Any other branch you work on is
your own: commit as the work advances and push it with a plain push, without asking.
Each commit still holds one intent ({{LAW:one-intent-one-act}}) and passes the commit
{{SKILL}}'s checks; a forced push asks, even on your own branch. A tag, a release or a
publish faces outward and asks ({{LAW:deletion-is-deliberate}}). A dispatched worker,
crew or slice (a Foreman worker, a pipeline crew, a parallel-agents slice) commits, and
merges its own sub-workers, only in its own worktree, and never pushes: the session
that dispatched it pushes the branch and opens the pull request. Never force-push,
hard-reset, or rebase the main branch: undo a published mistake with a revert commit;
the rare legitimate rewrite goes through the git-history {{SKILL}} behind a backup,
with the user's acceptance. The host gates commits and pushes onto the main branch at
the tool boundary, so this consent cannot be lost to a sticky allowlist. (On OpenCode,
whose permission rules cannot see the branch, every commit and push asks.){{STRICT_CONSENT}}
<!-- LEAN:else -->
A push onto the main branch needs consent; the pull request is that consent. Main is
`main`, `master`, the remote's default, or, from a linked worktree, the main checkout's
branch; unsure (no remote, or no default recorded), treat it as main. It changes only
through a pull request with green checks: never commit, push or merge directly onto it,
never merge a red, pending or unchecked one; a green one on the user's yes or their
standing auto-merge rule (ship {{SKILL}}). With no remote, CI or protection, a change to
main needs explicit acceptance.
Your own branch: commit and plain-push freely; a forced push asks. Tags, releases and
publishes ask ({{LAW:deletion-is-deliberate}}). A dispatched worker, crew or slice commits
and merges only in its own worktree, never pushes. Never force-push, hard-reset or
rebase main: revert instead (git-history {{SKILL}}, with acceptance, for a real rewrite).
The host gates both at the tool boundary (on OpenCode, which cannot see the branch, every
commit and push asks).{{STRICT_CONSENT}}
<!-- LEAN:end -->

### {{DOCTRINE:bound-the-loop}} Bound the Loop
<!-- note: summary: Set a loop's exit before entering it; break out of thrashing. -->
<!-- LEAN:begin -->
Every autonomous loop needs an exit you set before you enter it. Before iterating —
retrying, searching, generating-and-checking — fix the bounds: a cap on attempts, a
budget of time or tokens, and an explicit definition of success *and* of failure.
A check-and-repair loop gets two repairs, then a fresh attempt or a hand-back — more
revisions cost accuracy. Only a verdict on the final artifact counts: a pass from before
an edit is void, and old check output is never fed back. Then watch for the loop that has stopped progressing:
if you are issuing the same call, hitting the same error, or trying variations of one
approach with no new information, that is not persistence, it is thrashing — break out, change strategy,
gather different context, or stop. When a bound is reached or progress stalls, do
not grind on: halt and hand back a structured summary of what was tried, what was
learned, and what remains ({{LAW:surface-failures}}, {{DOCTRINE:plan-before-acting}}). {{DOCTRINE:context-economy}}
economises *within* a step; this bounds the *number* of steps. An agent that cannot
stop itself is a cost without a limit.
<!-- LEAN:else -->
Fix an autonomous loop's bounds before you enter it: an attempt cap, a time or token
budget, an explicit definition of success *and* failure. A check-and-repair loop spends
two repairs at most, then a fresh attempt or a hand-back; accept only a verdict on the final
artifact — a pass from before an edit is void, old check output is never fed back.
Watch for the loop that has stopped progressing: the same call, the same error, variations with no new information are
thrashing; break out, change strategy, or stop. When a bound is reached or progress
stalls, halt with a structured summary of what was tried, learned, and remains ({{LAW:surface-failures}},
{{DOCTRINE:plan-before-acting}}).
<!-- LEAN:end -->

### {{DOCTRINE:one-writer-per-file}} One Writer Per File
<!-- note: summary: One writer per file: give each agent a write set, never overwrite a change you did not make. -->
<!-- LEAN:begin -->
When several {{AGENTS}} work on the same code — sub-{{AGENTS}}, a pipeline crew, a
workflow fan-out, another session or tool in this checkout — each file has one writer at
a time. Before dispatch, give every unit a **write set** (the files or globs it may
change) and intersect them: overlapping units run in sequence or the overlap gets one
owner. Files every unit would append to — a registry, an index table, a lockfile, a
generated bundle — stay with the integrator; workers return the rows. Parallel editors
get their own worktree where the host offers one. One authoritative attempt per task:
no second editor until the first is proven stopped, and a reviewer reports, never edits.
With another writer live, re-read a file just before writing it; a change you did not
make is merged or stops you, never overwritten. Hand work back rebased on the current
base, naming the files changed, so a conflict resolves on the worker's branch.
<!-- LEAN:else -->
When several {{AGENTS}} share code, each file has one writer at a time. Give every unit a
write set and intersect them before dispatch: overlaps run in sequence or get one owner.
Shared append files (registries, lockfiles, generated bundles) stay with the integrator.
Parallel editors get a worktree. Reviewers never edit. With another writer live, re-read
before writing; never overwrite a change you did not make. Hand back rebased, naming files.
<!-- LEAN:end -->
