# {{SKILL}}: loop

> {{DESC_LOOP}}

**Trigger:** the user asks to run a loop, or to work a requirement in small validated
iterations, each one committed on its own; or names a loop template (`bugfix`, `refactor`,
`feature`, `tdd`, `legacy-tests`, `legacy-refactor`, `deps-upgrade`, `ci-repair`,
`architecture-decision`, `enforce-architecture-rule`, `update-contract`, `spec-first-feature`,
`api-endpoint`, `remove-dead-code`, `fix-flaky-tests`).

Default trust preset: **{{TRUST_LABEL}}**

The preset passed to `init` is `{{TRUST}}` unless the user names another (`prudent`,
`balanced`, `aggressive`).

## What it is

`geneseed loop` is a state machine kept in `LOOP.md` at the worktree's root. It decides every
transition, ceiling, score and stop; you run the node it hands you and report the outcome. Every
action prints one JSON object — act on its keys, never on your own reading of the graph.

## Setup

1. `git worktree add ../<repo>-loop-<slug> -b loop/<slug>`, then make that worktree the session's
   working directory with its own command. Every later command runs there **as written below**:
   no `cd` prefix, no `git -C`, no quoted refspec — any of those makes the git gate ask.
2. On a `loop/*` branch with a launched loop, the git gate lets exactly the commit form below
   through without asking. Merging into a shared branch is never yours.

## Compose

3. Use a template when the user names one. Otherwise run `geneseed loop check`: it lists the
   `templates` and every brick (`name`, `description`, `effect`, `agent`/`skill`, `outcomes`,
   `available`). Compose a graph JSON from available bricks — skip one marked unavailable or whose
   `skill` you do not have: `name`, `nodes`, `start`, `edges` of `{from, on, to}` (one per
   outcome; `$close`/`$stop` are terminals), `loops` with exactly one `"iteration": true`. The
   iteration loop's first node is where every iteration begins (normally `identify`).
   Write it to `<name>.json` in the OS temp directory — never inside the worktree, where it would
   be scored and committed — and validate it: `geneseed loop check --graph <file>`.
4. `geneseed loop init --title "<title>" --requirement "<requirement>" --graph <template|file> --preset {{TRUST}}`.
   Add `--contracts <globs>` naming the interface or schema files the requirement changes when
   the template's defaults do not cover them. A refused graph prints `problems` — fix them and retry.

## The cycle

Repeat `geneseed loop next` and act on its JSON:

- **`{awaiting}`** — a person must decide. Present it: `launch` → the graph in `LOOP.md`;
  `declared` → the card, its score and the threshold; `actual` → `git diff --cached` and the
  `reasons`; `gate` → what `node` produced (the file its `note` names, or `git diff`), the
  `note` and the `outcome` it reported — `ok` follows the outcome the brick reported (on a held
  `fail` it stops; to continue, `amend` with your answers), `amend` re-runs that brick with their
  note. Then
  **end the run** and wait. On their answer:
  `geneseed loop decide --verdict ok|no|amend --note "<their words>"` and continue.
- **`{verify, run}`** — run exactly the `run` command it prints.
- **`{node, validate: true}`** — score the card before the brick runs:
  `geneseed loop score --declared` (the card the iteration head recorded), or for a setup brick with no
  card `geneseed loop score --declared --actions <kinds> --write-set <files> --intent <label>`
  (`spec`: `--actions new-file --write-set 'specs/**'`).
  Single-quote any glob in `--write-set` (safe in bash and PowerShell; unquoted, the shell expands it).
  `blocking` turns into an `{awaiting}` on the next `next`.
- **`{node}`** — run the brick: dispatch its `agent` (or follow its `skill`) with the `prompt`,
  the `card`, the `notes` and the template's `rules`. Then report the outcome, one of its `outcomes`:
  `git status --porcelain | geneseed loop record --outcome <outcome>` — the iteration head
  (`identify`, `upgrade-scout`, `ci-triage`) adds `--card '<card json>'` when it reports `more`;
  a brick that reports a note file's path gets `--note-file <path>`, so its finding lands in
  `notes`; `--note "<short, one line, no git command>"` only for a note you write yourself.
- **`{terminal: "$close"}`** — see *The end*. **`{terminal: "$stop"}`** — report the `reason`
  and the `summary`, and leave the branch as it is.

What `score --diff`, `decide` and `record` print back:

- **`{commit: true, message_file}`** — close the unit with exactly this command, nothing added:
  `git add -A && git commit -F <message_file> && git push -u origin HEAD:loop/<slug>`
  Never `git commit -m`: only this form is exempt; anything else asks. It assumes a remote named
  `origin` and a `message_file` path without spaces: if the path has a space, quote it and accept
  that the gate asks; with no remote, report and stop instead of retrying.
- **`{discard: true}`** (with `resplit` when an inner ring was exhausted) — set the attempt aside,
  keeping `LOOP.md`: `git stash -u -m loop-discarded -- . :^LOOP.md` (never `git stash push` —
  the word `push` trips the git gate mid-run).
- **`{done: true}`**, **`{empty}`**, **`{resumed}`**, **`{dropped}`**, **`{node}`**, **`{verify}`**,
  **`{awaiting}`** (a gate), **`{stopped}`**, a declared score, and any result with
  `commit: false` (a blocking diff score included — it surfaces as `{awaiting}`) — call `next`
  again.
- **`{error}`** — read it; it names the step you skipped (`score --declared` before a mutate
  brick, `score --diff` before `record`). Do the step, never edit the state block to get past it.
  An `{error}` from `record` that mentions JSON means the shell mangled the card's quotes: retry
  with the card on a single line and no single quotes inside it.

## The end

5. On `$close`: `git rm -f LOOP.md` (the engine rewrote it after the last commit), then
   `git commit -m "loop(<slug>): close" && git push -u origin HEAD:loop/<slug>`.
   This final commit is outside the exemption — the loop is no longer running — so the gate
   asks: that ask is the user's consent to close the loop.
6. Report: the iteration count, the **soft** iterations from `summary.review` under
   "to review", the `notes`, and the branch to merge. **Never merge.**

## Resume

After a crash or an answered `awaiting`, from the worktree: `geneseed loop next`. The state is
`LOOP.md` plus the branch — nothing else to restore. The user may edit `preset` or `contracts`
in `LOOP.md`; they apply from the next score.

## Done when

- `$close` is reported with the branch pushed and `LOOP.md` removed, or `$stop` is reported with
  its reason — and in both cases nothing was merged.

<!-- INCLUDE: skills/_self-improvement.md -->
