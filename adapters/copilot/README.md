# 🐙 GitHub Copilot adapter

> [← Back to README](../../README.md) · [Setup guide](../../SETUP.md) · [Claude Code adapter](../claude-code/README.md) · [OpenCode adapter](../opencode/README.md)

[GitHub Copilot](https://docs.github.com/copilot) is the **second Claude-shaped
host**, and a closer fit than Bob: skills are the same `SKILL.md` dirs (Copilot
Agent Skills), custom agents are markdown-with-frontmatter, and the repo-root
`AGENTS.md` is auto-loaded. So the Copilot emit **reuses the Claude engine** with
a `host="copilot"` flag. Nothing to install by hand: `geneseed setup` (or
`geneseed build --emit copilot` / `--emit copilot-global`) writes everything.

Copilot is a **reduced host**: it has lifecycle hooks, but one command per event and
no "ask the user" tier, so this page is mostly about what those hooks *can* and
*cannot* automate and why the harness still holds where they cannot.

## What the emit writes

### Per-repo (`--emit copilot`)

- **`AGENTS.md`** at the repo root — auto-loaded by the Copilot CLI, the coding
  agent, and VS Code agent mode. Carries the preamble as a managed block.
- **`.github/`** layer (Copilot's *shared* repo config surface):
  - `agents/<name>.agent.md` — Copilot's **custom-agent dialect** (`.agent.md`
    extension; a `tools:` **allowlist**, not Claude's denylist — a read-only
    agent lists the tool ids it keeps: `read, search, todo, agent`, plus
    `execute` only when the spec opts in with `<!-- bash: allow -->`). Sibling
    agent links are rewritten to the `.agent.md` filename.
  - `skills/<name>/SKILL.md` — **byte-identical** to every other host.

  Writing into the shared `.github/` dir is safe because the engine's manifest +
  claim-on-create machinery never touches a file it doesn't own — your own
  workflows, agents, and skills there are never clobbered, and uninstall removes
  only manifest-owned files.

### Personal / global (`--emit copilot-global` → `~/.copilot`, or `$COPILOT_CONFIG_DIR`)

- **`copilot-instructions.md`** — the Copilot CLI auto-loads this in every repo;
  the preamble rides it as a managed block. (Unlike Bob, Copilot *has* a real
  personal instructions carrier, so no rules-folder workaround is needed.)
- `agents/<name>.agent.md` + `skills/` under `~/.copilot`.
- **`settings.json` hooks** — two entries under `hooks`, see below.

## Hooks — one command per event, block or warn

The Copilot CLI reads lifecycle hooks from **`~/.copilot/settings.json`** as a map of
event → one `{command}` object (no matcher groups, no list). The global emit wires
two of them, each calling the machine-wide `geneseed-hook` shim with `--host copilot`
so the verdict is spoken in Copilot's dialect:

| event | verb | what it does |
| --- | --- | --- |
| `sessionStart` | `context` | eager project-context injection, as on Claude Code, returned as `{"additionalContext": …}` |
| `toolCall` | `tool-gate` | the git gate and the rule gate **fused** — one command is all the event allows — dispatched on the payload: a `command` gets the git checks, a path gets the rule checks; the `after` phase is ignored |

Copilot's `toolCall` has **no "ask the user" tier** — its stdout contract is
`{"block": true|false}` — so the verdict tiers are:

- **Laws I and IV block.** A credential-shaped string headed for a tracked file, or
  a history-discarding git act (`reset --hard`, `clean -f`, `branch -D`,
  `checkout --`, `push --force`), is refused outright with the reason. Same stance
  as the OpenCode guard plugin, whose `tool.execute.before` can only allow or throw.
- **Process 1 and process 5 warn.** The two consent rules are the *user's* calls; a
  hard block would make Copilot unable to commit at all. They log a `[geneseed] …`
  line on stderr (which Copilot records) and allow. A gate error warns the same way
  rather than locking every tool call behind a block nobody can clear.

**A hook you already set on one of those events is left alone**, and that event is
not claimed — one slot per event means Geneseed could only displace it. Uninstall
removes exactly the hooks it claimed. Comments in the file mean it is never
rewritten.

**What is not wired, and why:**

- **no `learn`** — Copilot's `sessionEnd` and `agentStop` payloads carry no
  `transcript_path`, so a distiller would have nothing to read. The memory
  convention rides the preamble's instructions (the agent writes its own memories);
- **no hooks at project scope** — the CLI documents hooks in the personal settings
  file only, and a machine-absolute command committed into a shared `.github/`
  would fail on every teammate's machine;
- **sovereign-repo excludes** — Copilot documents no exclude/shadow mechanism
  (nothing like Claude's `claudeMdExcludes` or Bob's same-named workspace rule),
  so a global install's `copilot-instructions.md` and a repo's own `AGENTS.md`
  simply **stack**. A global emit warns, non-blocking, when project Copilot
  installs already exist.

None of this is a build gap — it is Copilot's ceiling. The harness still applies
in full: the Ontology, every Rule, every doctrine rule the install built in, and
every agent and skill are present; where the host offers no prompt, a Rule's
*automation* degrades to a block, a warning, or instruction-only. This is
behaviour-contract parity, the same principle every non-OpenCode host follows.

## MCP

MCP servers are wired at runtime by `geneseed mcp` into `~/.copilot/mcp-config.json`
(with a `tools` allowlist) — see `js/hosts/mcp.mjs`.

## What Copilot does not get

As a Claude-shaped host Copilot has none of the OpenCode-only extras (colour
themes, JS plugins, workflow runner, primary-agent, LSP, `/`-commands), and of the
hook-driven automation it gets context injection and the boundary gates but not
the learn distiller or a consent *prompt*. See the
[host matrix](../../README.md#-supported-harnesses) for the full comparison.
