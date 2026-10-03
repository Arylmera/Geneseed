# {{SKILL}}: geneseed

> {{DESC_GENESEED}}

**Trigger:** the user mentions Geneseed, the harness, or `AGENT.md`; asks how the install is set up; asks to change its theme, footprint, posture, mode, doctrine packs or excluded rules — or you need to know what {{LAWS}}, {{AGENTS}}, or {{SKILLS}} this install carries.

## Procedure
1. **Locate.** Run `geneseed status --json` first: `installs` lists every install on this machine — host, scope, root, state, theme, footprint, posture, mode, packs, excluded rules — and `rebuild`, the command that reproduces each one exactly. `geneseed` not on PATH → ask the user before using `npx geneseed` (it downloads the package), and prefix every command below the same way. Still nothing → look for a host root file: `~/.config/opencode/AGENT.md` or `.opencode/AGENT.md` (OpenCode), `~/.claude/CLAUDE.md` or `.claude/` (Claude Code), `.openclaude/` (OpenClaude), `AGENTS.md` beside `.bob/` (Bob). None → say so; never install to "fix" it.
2. **Read state** with the read-only verbs, cheapest first ({{DOCTRINE:context-economy}}): `geneseed status --json`, `geneseed version`, `geneseed catalog` (optionally `agents|skills|laws|ontology|doctrines`), `geneseed doctor`, `geneseed diff`, `geneseed mcp`, `geneseed memory list`, `geneseed exclude list`.
3. **Read a piece** from disk, not from recall ({{LAW:verify-before-asserting}}): `<root>/agents/<name>.md`, `<root>/skills/<name>/SKILL.md`, `<root>/memory/`, `<root>/notebook/`. The {{ONTOLOGY}}, the {{LAWS}} and the active {{DOCTRINES}} are numbered `## N. …` sections of the install's root file.
4. **Change an install only when the user asked for that change** ({{LAW:one-intent-one-act}}). Take that install's `rebuild` command from step 1, edit only the flag the user named (add it if the command omits it — `--posture`, `--mode` and `--trust` are left out at their defaults) — `--theme`, `--footprint lean|full`, `--posture`, `--mode direct|foreman`, `--trust prudent|balanced|aggressive`, `--doctrines craft,rigor|none`, `--exclude-rules "process 7"|none` — dry-run it first by running the same flags through `geneseed validate`, show the command, and run it once the user agrees. Never rebuild from a bare `geneseed build`: every omitted flag resets that setting to the generator default. Confirm with `geneseed status`.
5. **Other writes also need the user's word:** `geneseed memory rm <name>`, `geneseed exclude add|remove <path>`, `geneseed web start|stop`, `geneseed uninstall --target <root> --yes`. Personal rules and the profile belong to their own {{SKILLS}}; do not edit `user-rules.md` or `PROFILE.md` from here.
6. **Never on your own initiative:** `geneseed setup` (interactive only), `geneseed upgrade`, `geneseed update`, `geneseed bootstrap`, `geneseed sync-self`, `geneseed rebuild-all`, `geneseed migrate`, `geneseed link`, `geneseed unlink`. `learn`, `context` and the `*-gate` verbs are `geneseed-hook` verbs the host's hooks run — never run them by hand.
7. Directory and section names are plain English in every theme; only prose changes. Do not search by flavour words.

## Done when
- The answer comes from the live install — CLI output or file paths, not recall — or the requested change was rebuilt with every other setting preserved and `geneseed status` shows it.

<!-- INCLUDE: skills/_self-improvement.md -->
