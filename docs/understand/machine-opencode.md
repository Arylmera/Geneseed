---
group: understand
order: 3
title: "On OpenCode"
kind: "map"
harness: "opencode"
section: "On your machine"
description: "Every file and plugin an OpenCode install writes: what it does, what it costs, how to turn it off."
---
What an OpenCode install writes, piece by piece. The **Kind** words are explained in [What lands on your machine](on-your-machine.md).

| Piece | What it does for you | Kind | Cost | Turn it off |
|---|---|---|---|---|
| `AGENT.md` | The rules, the pointers to agents and skills, and how memory works | asked | ~7.2k tokens every session | Shrink it with fewer doctrine packs (`--doctrines`); remove it with `geneseed uninstall` |
| `user-rules.md` | Your own standing rules, read every session. Seeded empty | asked | 0 until you write in it | Leave it empty |
| `PROFILE.md` | Who you are and how you like answers pitched. Fill it with the `profile` skill | asked | 0 until you fill it | Leave the seeded text untouched |
| `opencode.json` entries | `instructions` points OpenCode at `AGENT.md`. `permission.bash` makes OpenCode ask before `git reflog expire`, `git gc --prune` or a force-push or delete of `main`/`master`, and before every commit and push when the **process** pack is on. `permission.skill` denies each user-only skill, so the model never starts it but `/name` still runs it; Geneseed takes back only the denies it wrote | enforced | No tokens | Edit the `permission` block yourself. The commit/push questions follow the **process** pack |
| context plugin | Puts your repo's README, CONTRIBUTING and a listing of `docs/` in front of the agent, with your rules, profile, memory index and wiki | automatic | Your docs, capped at 16 KB a file and 48 KB a session | `GENESEED_CONTEXT_INJECT=off` |
| guard plugin | Blocks writes to key and credential files (`id_rsa`, `.pem`, `.ssh/`…), catastrophic commands (`rm -rf /`, formatting a disk), every other real data loss judged against the repository's state, a recursive scan of a whole filesystem (`find /`), and changes inside your wiki's protected folders. Refuses the first write to `user-rules.md` or memory once, so the choice is yours. In an application repo with no `## Ownership` section in its root `AGENTS.md`, refuses the session's first write once so the agent proposes the [ownership](../concepts/ownership.md) setup | enforced | No tokens | `GENESEED_GUARD=off`, or `GENESEED_GUARD=warn` to log instead of block; the ownership refusal alone: `mode: off` in the repo's `## Ownership`, `Setup: declined <YYYY-MM-DD>` in your personal `.geneseed/ownership.md`, or rebuild with `--no-ownership-gate` |
| learn plugin | Once a session has been quiet for 60 seconds, distils durable facts into `memory/` with the model the session already uses | automatic | One model call per quiet session | `geneseed exclude add <folder>` silences it in that folder |
| activity plugin | Writes one small file per session that the web console's Activity view shows: what the session does now, its sub-agents, the files each of them changed (by path inside the repository), its turns, how full its context is and its compactions | automatic | No tokens | `GENESEED_ACTIVITY=off` |
| notify plugin | A desktop notification when a turn took longer than 30 seconds | automatic | No tokens | `GENESEED_NOTIFY=off` |
| ponytail plugin | Minimal-code mode. `/ponytail lite`, `full` or `ultra` adds a short ruleset to every turn until you switch it off | on demand | 0 while off, which is the default | `/ponytail off` |
| workflow plugin | Adds a `workflow` tool that runs saved orchestration scripts | on demand | Runs only when called | `geneseed uninstall` |
| `skills/` | Written procedures you call by name, such as `brainstorm` or `plan` | on demand | ~4.1k tokens for names and descriptions; a skill's body loads only when called | No per-skill switch; `geneseed uninstall` removes them all |
| `agents/` | Specialists the agent can delegate to, such as `reviewer` or `tester` | on demand | ~0.5k tokens | `geneseed uninstall` |
| `memory/` | Durable facts, one per file, with a `MEMORY.md` index the context plugin injects | automatic | 0 when fresh; grows as facts accumulate | `geneseed memory list`, then `geneseed memory rm <name>` (archives; `--purge` deletes) |
| `notebook/` | The agent's own working space: plans, scratch notes, and the gate log `gates.jsonl` | automatic | 0 when fresh; its index grows with use | Delete what you do not want; it is git-ignored and yours |

## Where the files are

**OpenCode.** A global install writes to `~/.config/opencode/`. Setting `OPENCODE_CONFIG_DIR` or `XDG_CONFIG_HOME` moves it. Geneseed merges its entries into your existing `opencode.json` and keeps every other key. A per-repo install writes into the repo instead.

---

**Next:** [On Bob, or any AGENT.md tool](machine-bob.md) · [Taking it back out](take-it-out.md)
