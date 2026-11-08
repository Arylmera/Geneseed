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
   - **stages**, in order — each a brick name, `loop:<template>` (a whole loop: outcomes `pass`
     and `fail`), or `loop:$triaged` (the loop a `triage` stage picks from a `loops` allowlist).
   - **where a human gates** — a gate belongs to the brick (`gate: human` in its frontmatter,
     narrowed by `gateOn`), never to the factory. A stage that must hold for a person uses a
     gated brick: an existing one, or one from step 4.
   - **routes** — for every outcome of every stage: the next stage, `$close` or `$stop`.
   - **failures that route back** — each one to an earlier stage, with its `max` from 1 to 5.
     Each becomes a `cycles` entry.
   - **rules** — optional lines every stage receives ("Never merge.").
   - **level** — project `<repo>/.geneseed/factories/` (this repository, shared with the team
     once committed) or global `$XDG_CONFIG_HOME/geneseed/factories/` (default
     `~/.config/geneseed/factories/`, every project on this machine). Shipped `src/factories/`
     only inside the Geneseed repository. At project level, when
     `git check-ignore -q .geneseed/factories/<name>.json` exits 0, tell the user the file stays
     personal until `.geneseed/.gitignore` lets `/factories/` back in.
3. **Write `<level>/<name>.json`**, `name` equal to the file stem, in the shape of the shipped
   `bug-report-to-fix`:

   ```json
   {
     "name": "<name>", "description": "<one line>", "category": "<category>",
     "rules": ["<optional>"],
     "stages": ["intake", "loop:<template>", "pr-open", "merge-gate", "retro"],
     "start": "intake",
     "edges": [{ "from": "<stage>", "on": "<outcome>", "to": "<stage | $close | $stop>" }],
     "cycles": [{ "name": "<name>", "nodes": ["<first stage of the lap>", "..."], "max": 2 }],
     "loops": ["<templates triage may pick, only with loop:$triaged>"]
   }
   ```

   A cycle's `nodes[0]` is where every lap starts, and every route back targets it.
4. **A brick that does not exist** — never write it here. Offer the `brick-forge` {{SKILL}}, or
   run it when the user says so, then come back to this step. `brick-forge` is the only
   {{SKILL}} that writes bricks.
5. **Check:** `geneseed factory check --factory <name>` (or the `.json` path). For each problem,
   tell the user which rule it names, then fix the file and re-run until it prints `ok: true`:
   - `not JSON` / `does not match the file name` — the file does not parse, or its `name` is
     not its stem; until fixed, `--factory <name>` cannot find it.
   - `must be a non-empty string` / `entry … must have` / `is listed twice` / `rules: must be` —
     the shape: a `name`, well-formed `edges` and `cycles` entries, each stage once, `rules` a
     list of non-empty strings.
   - `is not a stage` — an edge endpoint, `start` or a cycle node names no stage (often a typo).
   - `no brick named` / `no loop template named` / `brick unavailable` — a stage that does not
     exist or cannot run here: fix the name, or step 4.
   - `is not an outcome of` / `no edge for outcome` / `edges for outcome` — every outcome of a
     stage has exactly one edge, and an edge uses only outcomes the stage declares (`error` may
     go without one: it stops the run).
   - `$close is not reachable` — no path from `start` ends the run well.
   - `has no declared cycle around it` — a route back with no `cycles` entry.
   - `max must be an integer` — a cycle's `max` is 1 to 5.
   - `entered at …, not at its first stage` — a way into the cycle lands mid-cycle: reorder its
     `nodes` or move the edge.
   - `laps without spending a declared cycle` — a route back to the middle of a cycle: target
     its first stage.
   - `loop:$triaged` problems — it needs a non-empty `loops` and a `triage` stage on every path
     to it.
6. **Hand off:** tell the user the file, then the `factory` {{SKILL}} runs it
   (`geneseed factory init --factory <name> …`). Do not start a run unasked.

## Done when

- The factory file exists at the chosen level, `geneseed factory check --factory <name>` prints
  `ok: true`, and no brick was written outside `brick-forge`.

<!-- INCLUDE: skills/_self-improvement.md -->
