# {{SKILL}}: brick-forge

> {{DESC_BRICK_FORGE}}

**Trigger:** the user wants a new loop brick, or to adapt an existing one to their stack — "make
a brick for…", "our tests run differently, change the `test` brick", "the loop needs a step
that…".

## Procedure

1. **Interview, one question at a time:**
   - **name** — kebab-case, the file stem.
   - **what it does** — one line; it becomes `description`.
   - **effect** — does it ever create, edit or delete a file? Yes → `mutate`; never → `read`;
     unsure → `mutate`. A `read` brick that writes stops the loop.
   - **who runs it** — exactly one of an `agent` (one of the {{AGENTS}}) or a `skill`.
   - **outcomes** — every result it can report, comma-separated. Each becomes an edge label a
     loop graph must route (`{from, on: "<outcome>", to}`).
   - **level** — project `<repo>/.geneseed/bricks/` (committed, shared with the team), global
     `$XDG_CONFIG_HOME/geneseed/bricks/` (default `~/.config/geneseed/bricks/`, every project on
     this machine), or shipped `src/bricks/` — only inside the Geneseed repository itself.
2. **Write `<level>/<name>.md`**, the file stem equal to `name`:

   ```
   ---
   name: <kebab-name>
   description: <one line>
   effect: read | mutate
   agent: <agent>            (or  skill: <skill> — exactly one of the two)
   outcomes: <a>, <b>
   ---
   <4-10 lines of direct instructions, ending with exactly how to choose among the outcomes>
   ```

   No double-brace tokens in the body: the loop hands it to the model raw.
3. **Overriding by name** — a project or global brick named like a shipped one replaces it in
   every template. That is allowed; say so to the user. `geneseed loop check` lists overrides under `overridden`.
4. **Check it:** `geneseed loop check --brick <path>` (this file alone), then
   `geneseed loop check` from the repository (the whole catalogue, including every template that
   now routes through it). Fix every listed problem and re-run both.

## Done when

- The brick file exists at the chosen level, and both checks print `ok: true`.

<!-- INCLUDE: skills/_self-improvement.md -->
