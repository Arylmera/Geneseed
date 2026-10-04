---
group: understand
order: 4
title: "On Claude Code and OpenClaude"
kind: "map"
harness: "claude"
section: "On your machine"
description: "Every file and hook a Claude Code or OpenClaude install writes: what it does, what it costs, how to turn it off."
---
What a Claude Code or OpenClaude install writes, piece by piece. The **Kind** words are explained in [What lands on your machine](on-your-machine.md).

| Piece | What it does for you | Kind | Cost | Turn it off |
|---|---|---|---|---|
| `CLAUDE.md` (managed block) | The rules, the pointers to agents and skills, and how memory works. Geneseed writes only its own block; your own lines in the file stay | asked | ~7.2k tokens every session | Shrink it with fewer doctrine packs (`--doctrines`); remove it with `geneseed uninstall` |
| `user-rules.md` | Your own standing rules, read every session. Seeded empty | asked | 0 until you write in it | Leave it empty |
| `PROFILE.md` | Who you are and how you like answers pitched. Fill it with the `profile` skill | asked | 0 until you fill it | Leave the seeded text untouched |
| context hook | At session start, and again after a resume or compaction, puts your repo's README, CONTRIBUTING and a listing of `docs/` in front of the agent, with your rules, profile, memory index and wiki | automatic | Your docs, capped at 16 KB a file and 48 KB a session | `geneseed exclude add <folder>` silences every hook in that folder |
| git-gate hook | Before each shell command: asks you before any `git commit` or `git push`, and before a force-push, `reset --hard`, `clean -f`, `branch -D` or `checkout --` | enforced | ~14 ms per shell call | The commit/push question goes away if you build without the **process** pack; the destructive-git question has no switch except `geneseed exclude` |
| rule-gate hook | Before each write or edit: asks you when the file would carry a credential-shaped string (outside `.env`), or when the agent writes to `user-rules.md` or memory | enforced | ~14 ms per write | `geneseed exclude add <folder>` |
| learn hook | When the agent finishes a reply, and before compaction, distils durable facts from the recent conversation into `memory/`. Off until you set `GENESEED_LLM` to a model command such as `claude -p` | automatic | One model call each time it runs, once enabled | Leave `GENESEED_LLM` unset (the default) |
| `skills/` | Written procedures you call by name, such as `brainstorm` or `plan` | on demand | ~4.1k tokens for names and descriptions; a skill's body loads only when called | No per-skill switch; `geneseed uninstall` removes them all |
| `agents/` | Specialists the agent can delegate to, such as `reviewer` or `tester` | on demand | ~0.5k tokens | `geneseed uninstall` |
| `memory/` | Durable facts, one per file, with a `MEMORY.md` index the context hook injects | automatic | 0 when fresh; grows as facts accumulate | `geneseed memory list`, then `geneseed memory rm <name>` |
| `notebook/` | The agent's own working space: plans, scratch notes, and the gate log `gates.jsonl` | automatic | 0 when fresh; its index grows with use | Delete what you do not want; it is git-ignored and yours |
| hook shim | `~/.geneseed/bin/geneseed-hook`, the one stable path every hook calls, so moving the Geneseed checkout does not break your hooks | automatic | Nothing on its own | Not removed by uninstall, since every install on the machine shares it. `GENESEED_HOME` moves it |

## Where the files are

**Claude Code.** A global install writes to `~/.claude/`, and its hooks go into `~/.claude/settings.json`, next to any hooks of your own. A per-repo install uses the repo's `.claude/` folder, with the hooks in `.claude/settings.local.json`.

**OpenClaude.** Same pieces as Claude Code, under `~/.openclaude/` or `OPENCLAUDE_CONFIG_DIR`. A per-repo install uses `.openclaude/`, with the hooks in `.openclaude/settings.local.json`.

---

**Next:** [On Bob, or any AGENT.md tool](machine-bob.md) · [Taking it back out](take-it-out.md)
