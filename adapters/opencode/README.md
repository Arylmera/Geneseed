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

## Native mapping (recommended) — generated, zero drift

Turn Geneseed's capability agents into OpenCode **subagents** and its skills into
**commands**, so they're dispatchable rather than just described in prose. The
generator produces all of it from the same `src/`, so it never drifts:

```
python build.py --emit opencode --target /path/to/your-repo
```

That writes, on top of the normal bundle:

```
your-repo/
├── opencode.json              instructions → AGENT.md
└── .opencode/
    ├── agent/                 one subagent per capability agent
    │   ├── reviewer.md  architect.md  security.md   (read-only: write/edit denied)
    │   ├── tester.md    docs.md                      (may edit files)
    └── command/               one command per skill
        ├── commit.md  code-review.md  create-skill.md
```

- Read-only agents (their spec says *Read-only*) get `tools: { write: false,
  edit: false }`; the rest keep edit access.
- OpenCode invokes a subagent via the task tool, e.g. `subagent_type: "reviewer"`.
- Themed: add `--theme imperial` for the Warhammer vocabulary.

### Manual mapping (fallback)

If you'd rather not run the generator, create each file by hand:
`.opencode/agent/<name>.md` with frontmatter `description`, `mode: subagent`, and
(for read-only agents) `tools: { write: false, edit: false }`, body = the agent
spec. Skills become command files with `description` + `agent: build` frontmatter.
(`.opencode/command/` and `.opencode/commands/` are both recognised.)

## Pointing the agent at files beyond the Harness

Two native OpenCode mechanisms, for two purposes — use whichever fits, or both:

**Ambient — always loaded.** For *small, always-relevant* rule files. List their
paths in the `instructions` array of `harness.config.json`:

```json
{ "theme": "neutral", "instructions": ["/abs/path/to/house-rules.md", "docs/*.md"] }
```

`python build.py --emit opencode` folds them into the generated `opencode.json`
alongside `AGENT.md`. Entries may be absolute paths (a file living elsewhere on the
machine), repo-relative paths, globs, or URLs. They cost tokens every session —
keep this list short.

**Lazy — loaded on demand.** For *large or occasional* docs, and anything that
lives **elsewhere on the machine**. Use the git-ignored `references/` layer: list
each doc in `references/REFERENCES.md` as an `@`-prefixed path; OpenCode reads it
only when the task needs it (see [`references/README.md`](../../src/references/README.md)).
This is the better default for host-specific documentation — zero token cost until
used, and never published.

## Notes

- Project config beats global; `./opencode.json` or `.opencode/opencode.json`
  both work (OpenCode walks up to the worktree root).
- `instructions` accepts absolute paths, repo-relative paths, globs (`"laws/*.md"`),
  and URLs — see the ambient mechanism above.
- OpenCode also auto-loads external skills from `~/.claude/skills/` — unrelated to
  this harness, but handy to know.
