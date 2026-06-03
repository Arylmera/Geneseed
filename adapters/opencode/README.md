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
  `instructions` field at `AGENT.md` (which inlines the laws) and `context.json`
  (the project-context manifest, created empty by the build) — so every session
  starts bound by the harness *and* carrying the project's own context.

That's it. OpenCode loads `AGENT.md` and `context.json` as rule files on every run.

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

Drop a **`context.json`** manifest at the bundle root (beside `AGENT.md`) and the
agent loads it dynamically — no `opencode.json` wiring needed, and it works on any
tool. Each entry carries a `load` mode: `eager` (read every session — small,
always-relevant rules) or `lazy` (read only when the task needs it — large or
occasional docs, often elsewhere on the machine). The build drops an empty
`context.json` at the bundle root (never overwriting an existing one); git-ignore
it and list your docs by absolute or repo-relative path. The schema is in AGENT.md
§6 and the file's own comment.

If you'd rather use OpenCode's own always-on loading for a small rule file, you can
also add its path to the `instructions` array of `opencode.json` directly — it
accepts absolute paths, repo-relative paths, globs, and URLs.

## Notes

- Project config beats global; `./opencode.json` or `.opencode/opencode.json`
  both work (OpenCode walks up to the worktree root).
- `instructions` in `opencode.json` accepts absolute paths, repo-relative paths,
  globs (`"laws/*.md"`), and URLs — edit it directly for ambient rule files.
- OpenCode also auto-loads external skills from `~/.claude/skills/` — unrelated to
  this harness, but handy to know.
