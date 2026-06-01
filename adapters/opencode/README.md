# OpenCode adapter

[OpenCode](https://opencode.ai) is `AGENTS.md`-native and has first-class
**subagents** and **commands**, so Geneseed fits it cleanly. Pick the depth you
want — the baseline is a 30-second drop-in; the native mapping turns Geneseed's
agents and skills into real OpenCode primitives.

## Baseline (instant intake)

After implanting the harness into your repo (so `AGENT.md`, `agents/`, `skills/`,
`laws/`, `memory/` are at the root):

- Copy [`opencode.json`](opencode.json) to the repo root (or merge its
  `instructions` array into an existing `opencode.json`). It points OpenCode's
  `instructions` field at `AGENT.md`, which already inlines the laws — so every
  session starts bound by the harness.

That's it. OpenCode loads `AGENT.md` as a rule file on every run.

> **Alternative, zero-config:** OpenCode auto-loads `AGENTS.md` (plural) with no
> config at all. If you prefer that, rename the harness entrypoint
> `AGENT.md` → `AGENTS.md` when you implant it and skip `opencode.json` entirely.

## Native mapping (recommended for the full experience)

Turn Geneseed's capability agents into OpenCode **subagents** and its skills into
**commands**, so they're dispatchable rather than just described in prose.

### Agents → `.opencode/agent/<name>.md`

For each file in `agents/`, create `.opencode/agent/<name>.md`:

```markdown
---
description: <the one-line purpose from the Geneseed agent spec>
mode: subagent
tools:
  write: false   # read-only agents (reviewer, architect, security, docs-read)
  edit: false
---

<paste the body of the Geneseed agent spec here>
```

Leave `write`/`edit` enabled for agents that must change files (e.g. tester).
OpenCode then invokes them via the task tool (`subagent_type: "reviewer"`).

### Skills → commands

For each file in `skills/`, create a command markdown file with frontmatter:

```markdown
---
description: <the skill's one-line purpose>
agent: build
---

<paste the skill procedure here>
```

(See the OpenCode docs for the exact command directory on your version —
`.opencode/command/` and `.opencode/commands/` are both recognised.)

> If you want this generated automatically from `src/` instead of by hand, ask
> for the `build.py --emit opencode` generator — it produces these files from the
> same single source, so they never drift.

## Notes

- Project config beats global; `./opencode.json` or `.opencode/opencode.json`
  both work (OpenCode walks up to the worktree root).
- `instructions` accepts globs, e.g. add `"laws/*.md"` if you split project rules
  out of `AGENT.md`.
- OpenCode also auto-loads external skills from `~/.claude/skills/` — unrelated to
  this harness, but handy to know.
