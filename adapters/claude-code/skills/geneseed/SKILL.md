---
name: geneseed
description: "Interact with a deployed Geneseed harness from any repo — locate the install, read its laws/agents/skills/memory/notebook by name, run status/doctor/diff, distill memory with learn, and manage the local web UI. Use when the user mentions Geneseed, AGENT.md, the harness, an agent operating system, or asks you to inspect, refresh, or read from the deployed bundle."
---

# geneseed — agent skill

Geneseed is a portable AI-agent harness deployed once and used everywhere. This skill lets you talk to whichever deployment is in scope from any repo: read the canonical files (laws, agents, skills, memory, notebook), probe state (status, version, doctor, diff), distill durable memory, and drive the local web UI. The harness is theme-independent in structure — directory and section names are always plain English — so the paths below are stable across themes.

## Find the deployed harness before doing anything

Pick the first that resolves; remember the path for the rest of the session.

1. `command -v geneseed` — if the launcher is on PATH, use it. The CLI knows its own install and is the source of truth for `status`, `version`, `doctor`, etc.
2. `$GENESEED_HARNESS` — if set, that directory is the deployment root.
3. `~/.config/opencode/AGENT.md` — the default OpenCode global install.
4. `./.opencode/AGENT.md` (walking up from `pwd`) — a per-repo OpenCode install.
5. Any `AGENT.md` in the repo root — a plain bundle install.

If none resolve, the user does not have Geneseed deployed here — say so and stop. Do not run `setup`, `build`, or `upgrade` on your own to "fix" this; that is a user decision.

A live harness root contains: `AGENT.md`, `agents/<name>.md`, `skills/<name>/SKILL.md`, `memory/MEMORY.md`, `notebook/NOTEBOOK.md`, `themes/`, and (on OpenCode) `plugins/`, `workflows/`, `opencode.jsonc`, `wiki.jsonc`. Laws live as numbered sections inside `AGENT.md`, not as separate files in the deployed bundle — read them from `AGENT.md` directly.

## Read-only verbs (safe, no confirmation needed)

- **Inventory** — `ls <harness>/agents`, `ls <harness>/skills`, `ls <harness>/memory`, `ls <harness>/notebook`. Counts also appear in `geneseed status`.
- **Status** — `geneseed status`. One-screen dashboard: theme, install mode, component counts, memory path & fact count, version fingerprint, whether `AGENT.md` is present, and whether the install matches its source.
- **Version** — `geneseed version`. Source vs installed fingerprint; `up to date` / `differs` / `unknown source`.
- **Doctor** — `geneseed doctor`. Health check on every theme + parity + links + drift. Exit 0 means `ok`.
- **Diff** — `geneseed diff` (or `geneseed diff --out FILE`). Shows local edits the agent has made in the deployed bundle vs the canonical source; the same content the TUI shows under *Review local edits*. Useful to find drift worth back-porting into `src/` of the Geneseed repo.
- **Prompt** — `geneseed prompt`. Prints the install prompt Geneseed uses to ask an external agent to recreate the bundle by hand. Safe to read; do not pipe it into another agent unless the user asks.
- **Read a specific piece** — read the file directly:
  - Agent by name: `<harness>/agents/<name>.md`
  - Skill by name: `<harness>/skills/<name>/SKILL.md`
  - Law by number: section `## N. …` inside `<harness>/AGENT.md`
  - Memory fact: `<harness>/memory/<file>.md`; index at `MEMORY.md`
  - Notebook entry: `<harness>/notebook/<file>.md`; index at `NOTEBOOK.md`

When the user asks "what does the X skill say" or "what's law VI", read the file directly — do not summarise from memory.

## Side-effecting verbs (confirm with the user first)

- **`geneseed learn`** — distills the current session into memory under `<harness>/memory/`. Writes new files and may update `MEMORY.md`. Confirm before running, and only at end-of-session or when the user explicitly asks.
- **`geneseed context`** — refreshes the project-docs context manifest. Touches `context.json` in the current repo. Confirm before running.
- **`geneseed web start`** / **`stop`** / **`status`** — manages the local web UI daemon on `127.0.0.1:4747` (offline, per-session token). `status` is read-only; `start`/`stop` need user assent. Use `start` only if the user asks to "open the web UI" or similar.

## Hard no without explicit user ask

These are destructive or scope-changing and must be initiated by the user:

- `geneseed setup` — interactive install wizard.
- `geneseed build` — re-renders the bundle from `src/` (only meaningful inside the Geneseed source repo anyway).
- `geneseed upgrade` / `bootstrap` / `update` / `sync-self` — pull-and-rebuild from the published source; overwrites the deployed bundle. Local edits are auto-exported to an `improvements/` markdown beside the install before being overwritten, but still: user decision.
- `geneseed link` / `unlink` — modifies PATH symlinks.
- `geneseed uninstall` — removes a global or per-repo (project-scoped) install.

If the user asks for any of these, run them as requested. Do not run them as a side effect of a more general request.

## Common patterns

- **"What harness do I have here?"** — `geneseed status` (if launcher on PATH); else resolve via the fallback list and report theme, install mode, path, and version.
- **"What does the `<X>` skill / agent / law say?"** — read the file directly. For laws, grep `AGENT.md` for `## N\.` or `Law N`.
- **"Show me what's drifted in my install."** — `geneseed diff`. Offer to write the output to a file (`--out`) if it's long.
- **"Distill what we did today into memory."** — confirm scope, then `geneseed learn`. Afterwards, `git status` inside the harness dir to show what landed.
- **"Open the dashboard / web UI."** — `geneseed web start`. Tell the user the URL it printed and that it binds to localhost only.
- **End-of-session check-in** — if the user is wrapping up and there's something memorable, offer `geneseed learn`; if there are edits the agent made to the deployed bundle, offer `geneseed diff` so they can back-port them.

## Notes

- The launcher is `./geneseed` in the Geneseed source repo and plain `geneseed` once linked. Inside a non-Geneseed repo, only the linked form is available — if it's not on PATH, you cannot drive the CLI and must fall back to reading the deployed files directly.
- The deployed bundle's directory and section names are theme-independent; only voice (descriptions, prose, sigils) changes per theme. Don't pattern-match on flavor words.
- `memory/` and `notebook/` are personal and git-ignored. Anything you write there with `learn` does not leave the user's machine.
