# {{SKILL}}: factory-forge

> {{DESC_FACTORY_FORGE}}

**Trigger:** the user wants a new factory, or to change one. For example: "make a factory that
takes a feature request to a PR", "add a security scan before the PR opens", "send red CI back
to the loop three times, not two".

## Procedure

1. **See what exists:** `geneseed factory list` (the factories) and `geneseed loop check` (every
   brick with its outcomes, and every loop template). Adapting a factory starts from its file.
2. **Interview, one question at a time:**
   - **name** — kebab-case, the file stem. A factory named like an existing one replaces it at
     every level below; say so to the user.
   - **what it does** — one line; it becomes `description`. A short `category` (`development`).
   - **input** — what one run takes: a request, a document, or a GitHub or GitLab issue. The
     first stage reads it, usually `intake`.
   - **stages**, in order — each a brick name or `loop:<template>` (a whole loop: outcomes `pass`
     and `fail`).
   - **forks** — where the work takes one way or another, use a brick with named outcomes (a
     **fork**, such as `triage`: `bug`, `feature`, `deps`, `refactor`, `docs`, `fail`). Give each
     named outcome its own edge to its own **lane**: a loop for work that changes code, or a brick
     where a loop adds nothing (`docs` → `docs-update`). Every lane joins the same path after it
     (`checks`, then `review-panel` and `holdout`, then `pr-open` and `merge-gate`). An outcome the factory does not offer goes to
     `$stop`.
   - **where a human gates** — a gate belongs to the brick (`gate: human` in its frontmatter,
     narrowed by `gateOn`), never to the factory. A stage that must hold for a person uses a
     gated brick: an existing one, or one from step 4.
   - **routes** — for every outcome of every stage: the next stage, `$close` or `$stop`.
   - **failures that route back** — each one to an earlier stage, with its `max` from 1 to 5.
     Each becomes a `cycles` entry. After a fork, route back to `$lane`, the lane the run took,
     and start the cycle's `nodes` with `$lane`. Only a `fail` routes back to a loop: `checks`
     `error` and `merge-gate` `none` also carry environment failures (a failed fetch, a missing
     tool, CI pending at the bound) that no loop can fix, so route them on or to `$stop`, never
     to a loop or `$lane` (`factory check` refuses that route).
   - **rules** — optional lines every stage receives ("Never merge.").
   - **level** — project `<repo>/.geneseed/factories/` (this repository, shared with the team
     once committed) or global `$XDG_CONFIG_HOME/geneseed/factories/` (default
     `~/.config/geneseed/factories/`, every project on this machine). Shipped `src/factories/`
     only inside the Geneseed repository. At project level, when
     `git check-ignore -q .geneseed/factories/<name>.json` exits 0, the repository's
     `.geneseed/.gitignore` predates `!/factories/`: tell the user the file stays personal until
     they add that line.
3. **Write `<level>/<name>.json`**, `name` equal to the file stem, in the shape of the shipped
   `bug-report-to-fix`:

   ```json
   {
     "name": "<name>", "description": "<one line>", "category": "<category>",
     "rules": ["<optional>"],
     "stages": ["intake", "holdout-write", "loop:<template>", "checks", "review-panel", "holdout", "pr-open", "merge-gate", "retro"],
     "start": "intake",
     "edges": [{ "from": "<stage>", "on": "<outcome>", "to": "<stage | $lane | $close | $stop>" }],
     "cycles": [{ "name": "<name>", "nodes": ["<first stage of the lap, or $lane>", "..."], "max": 2 }],
     "protected": ["<optional: paths checks refuses to see changed>"],
     "review": { "seats": { "small": ["reviewer"], "medium": ["reviewer", "tester"], "large": ["reviewer", "tester", "steward"],
       "areas": { "security": ["security"], "performance": ["performance"], "ui": ["user-advocate"], "data": ["security"] } } }
   }
   ```

   The edge `intake --needs-info--> <stage>` is optional: without it, a `needs-info` the user
   answers `ok` follows intake's `pass` edge. The edge `intake --reject--> $stop` is optional
   too: without it, a refusal the user accepts stops the run. `protected` is optional. `review.seats` is what a
   `review-panel` stage seats; copy the shipped table unless the user wants other seats.

   A cycle's `nodes[0]` is where every lap starts, and every route back targets it. A factory
   with a fork follows the shipped `issue-to-pr`: one edge per named outcome out of `triage`,
   and `$lane` as the target of each route back and as `nodes[0]` of its cycles.
4. **A brick that does not exist** — never write it here. Offer the `brick-forge` {{SKILL}}, or
   run it when the user says so, then come back to this step. `brick-forge` is the only
   {{SKILL}} that writes bricks.
5. **Check:** `geneseed factory check --factory <name>` (or the `.json` path). For each problem,
   tell the user which rule it names, then fix the file and re-run until it prints `ok: true`:
   - `no factory named "<name>"` — `--factory <name>` found no loadable file of that name. Run
     a bare `geneseed factory check`: it lists every catalogue problem, among them `not JSON`
     (the file does not parse) and `does not match the file name` (its `name` is not its stem).
   - `must be a non-empty string` / `entry … must have` / `is listed twice` / `rules: must be` —
     the shape: a `name`, well-formed `edges` and `cycles` entries, each stage once, `rules` a
     list of non-empty strings.
   - `is not a stage` — an edge endpoint, `start` or a cycle node names no stage (often a typo).
   - `no brick named` / `no loop template named` / `brick unavailable` — a stage that does not
     exist or cannot run here: fix the name, or step 4.
   - `is not an outcome of` / `no edge for outcome` / `edges for outcome` — every outcome of a
     stage has exactly one edge, and an edge uses only outcomes the stage declares (`error` and
     `reject` may go without one: each stops the run; so may `needs-info`: it follows the
     `pass` edge).
   - `protected: must be a list of non-empty paths` — `protected` is a list of path strings.
   - `review: must be an object with a seats table` / `review.seats.<size>: must be a non-empty
     list of agent names` / `review.seats.areas: must map each area to a list of agents` — the
     seat table needs a list for `small`, `medium` and `large`, and `areas` maps each area to a list.
   - `review.seats.<where>: no agent named <name>` — a seat names an agent Geneseed does not ship;
     a project's own agents cannot sit.
   - `$close is not reachable` — no path from `start` ends the run well.
   - `has no declared cycle around it` — a route back with no `cycles` entry.
   - `max must be an integer` — a cycle's `max` is 1 to 5.
   - `entered at …, not at its first stage` — a way into the cycle lands mid-cycle: reorder its
     `nodes` or move the edge.
   - `laps without spending a declared cycle` — a route back to the middle of a cycle: target
     its first stage.
   - `$lane: no fork chooses a lane` / `before any fork has chosen a lane` — `$lane` needs a
     fork on every path to it. `a fork's edge names its lane` — a fork's edge targets its lane
     stage, never `$lane`.
   - `retired` — the file still uses `loop:$triaged` or `loops`: list each loop as its own stage,
     give the fork one edge per lane, and route back to `$lane`. Rewrite it with the user; never
     silently.
   - `reports environment failures on …, which no loop can fix` — `checks` `error` or
     `merge-gate` `none` routes to a loop or `$lane`: route it to the next stage or to `$stop`.
6. **Hand off:** tell the user the file, then the `factory` {{SKILL}} runs it
   (`geneseed factory init --factory <name> …`). Do not start a run unasked.

## Done when

- The factory file exists at the chosen level, `geneseed factory check --factory <name>` prints
  `ok: true`, and no brick was written outside `brick-forge`.

<!-- INCLUDE: skills/_self-improvement.md -->
