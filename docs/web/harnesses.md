---
group: start
order: 4
title: "Supported harnesses"
kind: "concept"
---
One source, **five emit targets** — each with a per-repo and a global (`-global`) variant, plus a portable `files` bundle any `AGENT.md`-aware tool can read. **OpenCode** runs its own engine (JS plugins, colour themes, LSP); **Claude Code**, **Bob**, and **Copilot** share one Claude-shaped engine that diverges only by host dialect.

The harness *content* — the constitution (Ontology, Rules, Doctrines), Agents, Skills, Memory, and the preamble voice — is **identical on every host**: one build renders the same text for all five targets. What differs is how much of it the host can *automate* (via plugins or hooks) versus carry as preamble discipline.

| Capability | OpenCode | Claude | Bob | Copilot |
| --- | :---: | :---: | :---: | :---: |
| Agents · Skills · Memory | ✅ | ✅ | ✅ | ✅ |
| Context injection | ⚙️ plugin | 🪝 hook | 🪝 hook¹ | 📄 preamble |
| Memory write-back (learn) | ⚙️ plugin | 🪝 hook | 🪝 hook¹ | 📄 preamble |
| Git-gate consent (Doctrine process 5) | ⚙️ plugin | 🪝 hook | 🪝 hook¹ | 📄 preamble |
| Sovereign-repo excludes | ⚙️ plugin | ✅ | ✅ | ➖ |
| MCP server wiring | ✅ | ✅ | ✅ | ✅ |
| Colour themes | ✅ | ➖ | ➖ | ➖ |
| LSP · workflows · primary-agent · `/`-commands | ✅ | ➖ | ➖ | ➖ |

✅ native · ⚙️ OpenCode plugin · 🪝 `settings.json` hook · 📄 preamble prose only · ➖ no host mechanism (harness discipline still applies). ¹ Bob honours Claude-dialect hooks best-effort — inert if unsupported, harness still holds via the preamble.

**The git-gate row is the one capability that is not always present**, on any host. It implements **Doctrine process 5**, so it is wired only on an install that built the **process** [doctrine pack](#/docs/setup-choices) in — drop that pack and the boundary drops with it, because a gate that keeps asking for a rule the install never adopted is a gate arguing with its own harness. One asymmetry: on OpenCode that holds for a *fresh* install, but a pack-off rebuild of an install whose `opencode.json` already carries a `git commit*` entry leaves it in place and reports it — Geneseed cannot tell its own entry from one you typed, so it removes neither ([doctrine packs](#/docs/setup-choices)). The invariant-territory refusals in the same neighbourhood (`rm -rf`, a force-push) are the Rules' territory, not the pack's, and stay in every build.

**No host drops an Agent, Skill, or the memory convention.** The asymmetry is otherwise entirely in *automation mechanism*: OpenCode's plugins and Claude/Bob's hooks enforce a few of these rules for you at the tool boundary, where **Copilot** (no hook mechanism) enforces them through preamble discipline. The OpenCode-only extras (themes, LSP, workflow runner, primary-agent) have no analogue on a Claude-shaped host.

---

**Deeper:** [The harness model](#/docs/model) · [Footprint per host](#/docs/footprint)
