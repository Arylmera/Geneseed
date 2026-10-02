---
group: understand
order: 2
title: "What lands on your machine"
kind: "map"
---
An install writes a handful of files into your host's config folder and, where the host allows it, wires small programs that run at fixed moments: when a session starts, before a tool call, when a session ends. Everything below says what each piece does for you, when it runs, what it costs, and how to turn it off. The **Kind** column uses four words:

- **enforced**: code runs before the action and can stop it. The model cannot argue past it.
- **automatic**: runs by itself at a fixed moment, such as session start or session end.
- **asked**: text the model reads every session. It usually follows it, but nothing makes it.
- **on demand**: loads only when you or the agent call it by name.

Token costs are for the default *lean* footprint. Before you type anything, a session carries about 12k tokens of harness. That is roughly 6% of a 200k window. A `--footprint full` build adds about 5k on the rules file. For a live figure on your own install, ask the agent to use the `token-report` skill.

<!--harness:claude-->
*(Claude Code only)*

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

<!--/harness-->
<!--harness:opencode-->
*(OpenCode only)*

| Piece | What it does for you | Kind | Cost | Turn it off |
|---|---|---|---|---|
| `AGENT.md` | The rules, the pointers to agents and skills, and how memory works | asked | ~7.2k tokens every session | Shrink it with fewer doctrine packs (`--doctrines`); remove it with `geneseed uninstall` |
| `user-rules.md` | Your own standing rules, read every session. Seeded empty | asked | 0 until you write in it | Leave it empty |
| `PROFILE.md` | Who you are and how you like answers pitched. Fill it with the `profile` skill | asked | 0 until you fill it | Leave the seeded text untouched |
| `opencode.json` entries | `instructions` points OpenCode at `AGENT.md`. `permission.bash` makes OpenCode ask before `rm -rf`, a force-push, `reset --hard`, `clean -f`, `branch -D` or `checkout --`, and before every commit and push when the **process** pack is on | enforced | No tokens | Edit the `permission` block yourself. The commit/push questions follow the **process** pack |
| context plugin | Puts your repo's README, CONTRIBUTING and a listing of `docs/` in front of the agent, with your rules, profile, memory index and wiki | automatic | Your docs, capped at 16 KB a file and 48 KB a session | `GENESEED_CONTEXT_INJECT=off` |
| guard plugin | Blocks writes to key and credential files (`id_rsa`, `.pem`, `.ssh/`…), catastrophic commands (`rm -rf /`, formatting a disk), and changes inside your wiki's protected folders. Refuses the first write to `user-rules.md` or memory once, so the choice is yours | enforced | No tokens | `GENESEED_GUARD=off`, or `GENESEED_GUARD=warn` to log instead of block |
| learn plugin | Once a session has been quiet for 60 seconds, distils durable facts into `memory/` with the model the session already uses | automatic | One model call per quiet session | `geneseed exclude add <folder>` silences it in that folder |
| activity plugin | Writes one small file per session that the web console's Activity view shows | automatic | No tokens | `GENESEED_ACTIVITY=off` |
| notify plugin | A desktop notification when a turn took longer than 30 seconds | automatic | No tokens | `GENESEED_NOTIFY=off` |
| ponytail plugin | Minimal-code mode. `/ponytail lite`, `full` or `ultra` adds a short ruleset to every turn until you switch it off | on demand | 0 while off, which is the default | `/ponytail off` |
| workflow plugin | Adds a `workflow` tool that runs saved orchestration scripts | on demand | Runs only when called | `geneseed uninstall` |
| `skills/` | Written procedures you call by name, such as `brainstorm` or `plan` | on demand | ~4.1k tokens for names and descriptions; a skill's body loads only when called | No per-skill switch; `geneseed uninstall` removes them all |
| `agents/` | Specialists the agent can delegate to, such as `reviewer` or `tester` | on demand | ~0.5k tokens | `geneseed uninstall` |
| `memory/` | Durable facts, one per file, with a `MEMORY.md` index the context plugin injects | automatic | 0 when fresh; grows as facts accumulate | `geneseed memory list`, then `geneseed memory rm <name>` |
| `notebook/` | The agent's own working space: plans, scratch notes, and the gate log `gates.jsonl` | automatic | 0 when fresh; its index grows with use | Delete what you do not want; it is git-ignored and yours |

<!--/harness-->

### Where the files are

**OpenCode.** A global install writes to `~/.config/opencode/`. Setting `OPENCODE_CONFIG_DIR` or `XDG_CONFIG_HOME` moves it. Geneseed merges its entries into your existing `opencode.json` and keeps every other key. A per-repo install writes into the repo instead.

**Claude Code.** A global install writes to `~/.claude/`, and its hooks go into `~/.claude/settings.json`, next to any hooks of your own. A per-repo install uses the repo's `.claude/` folder, with the hooks in `.claude/settings.local.json`.

**Bob.** A global install writes to `~/.bob/`, or `BOB_CONFIG_DIR`. Bob does not load a global `AGENTS.md`, so the rules go into `~/.bob/rules/geneseed.md`. A per-repo install writes `AGENTS.md` instead. Hooks live in `~/.bob/settings/settings.json`. Bob runs three of them: context at session start, one combined gate before each tool call, and learn at session end. Bob has no "ask" prompt, so the gate refuses outright, and only for credentials and destructive git. The commit/push and memory questions become log lines.

**OpenClaude.** Same pieces as Claude Code, under `~/.openclaude/` or `OPENCLAUDE_CONFIG_DIR`. A per-repo install uses `.openclaude/`, with the hooks in `.openclaude/settings.local.json`.

**Plain bundle.** The `files` target writes `AGENT.md` and the same folders into `./Harness/` for any tool that reads `AGENT.md`. It installs no hooks and no plugins, so nothing in it is enforced.

### Taking it back out

`geneseed uninstall` removes only what Geneseed recorded writing: the rules file or its managed block, `agents/`, `skills/`, plugins, and Geneseed's own hook and config entries. It keeps `memory/` and `notebook/` in place, along with the files it seeded for you to edit (`user-rules.md`, `PROFILE.md`, `wiki.jsonc`). Add `--archive-memory` to move memory and notebook aside instead. It still deletes nothing. See [Uninstall](../guides/uninstall.md).

---

**Next:** [A day with the harness](a-day.md)
