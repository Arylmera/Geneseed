# 🐙 GitHub Copilot adapter

> [← Back to README](../../README.md) · [Setup guide](../../SETUP.md) · [Claude Code adapter](../claude-code/README.md) · [OpenCode adapter](../opencode/README.md)

[GitHub Copilot](https://docs.github.com/copilot) is the **second Claude-shaped
host**, and a closer fit than Bob: skills are the same `SKILL.md` dirs (Copilot
Agent Skills), custom agents are markdown-with-frontmatter, and the repo-root
`AGENTS.md` is auto-loaded. So the Copilot emit **reuses the Claude engine** with
a `host="copilot"` flag. Nothing to install by hand: `geneseed setup` (or
`build.py --emit copilot` / `--emit copilot-global`) writes everything.

Copilot is a **deliberately reduced host** — it has no hook mechanism — so this
page is mostly about *what it does not automate* and why the harness still holds.

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

## No hooks — the reduced-host reality

Copilot has **no `settings.json` and no lifecycle-hook mechanism**, so the whole
settings/hooks/excludes stage is skipped. Concretely, Copilot does **not** get:

- **automated context injection** — Rule XVIII's project-context load falls back
  to the preamble instructing the agent to read the docs itself;
- **automated memory / learn write-back** — no `Stop`/`SubagentStop` hook; the
  memory convention rides the preamble's instructions (the agent writes its own
  memories) rather than a session-end distiller;
- **the git-gate consent backstop** — Rule XX (*consent before every commit and
  push*) is enforced by the **preamble prose only**, not at the tool boundary.
  There is no hook to force the prompt;
- **sovereign-repo excludes** — Copilot documents no exclude/shadow mechanism
  (nothing like Claude's `claudeMdExcludes` or Bob's same-named workspace rule),
  so a global install's `copilot-instructions.md` and a repo's own `AGENTS.md`
  simply **stack**. A global emit warns, non-blocking, when project Copilot
  installs already exist.

None of this is a build gap — it is Copilot's ceiling. The harness still applies
in full: every Rule, agent, and skill is present; only the *automation* of a few
Rules degrades to instruction-only. This is behaviour-contract parity, the same
principle every non-OpenCode host follows.

## MCP

MCP servers are wired at runtime by `geneseed mcp` into `~/.copilot/mcp-config.json`
(with a `tools` allowlist) — see `rituals/_harness_mcp.py`.

## What Copilot does not get

As a Claude-shaped host Copilot has none of the OpenCode-only extras (colour
themes, JS plugins, workflow runner, primary-agent, LSP, `/`-commands), **and**
— uniquely among the four hosts — none of the hook-driven automation Claude and
Bob get. See the [host matrix](../../README.md#-supported-harnesses) for the full
comparison.
