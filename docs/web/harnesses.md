---
group: start
order: 4
title: "Supported harnesses"
kind: "concept"
---
One source, **five emit targets** — each with a per-repo and a global (`-global`) variant, plus a portable `files` bundle any `AGENT.md`-aware tool can read. **OpenCode** runs its own engine (JS plugins, colour themes, LSP); **Claude Code**, **Bob**, and **Copilot** share one Claude-shaped engine that diverges only by host dialect.

The harness itself — Rules, Agents, Skills, Memory, and the preamble voice — is **identical on every host**. What differs is how much of it the host can *automate* (via plugins or hooks) versus carry as preamble discipline.

| Capability | OpenCode | Claude | Bob | Copilot |
| --- | :---: | :---: | :---: | :---: |
| Agents · Skills · Memory | ✅ | ✅ | ✅ | ✅ |
| Context injection | ⚙️ plugin | 🪝 hook | 🪝 hook¹ | 📄 preamble |
| Memory write-back (learn) | ⚙️ plugin | 🪝 hook | 🪝 hook¹ | 📄 preamble |
| Git-gate consent (Rule XX) | ⚙️ plugin | 🪝 hook | 🪝 hook¹ | 📄 preamble |
| Sovereign-repo excludes | ⚙️ plugin | ✅ | ✅ | ➖ |
| MCP server wiring | ✅ | ✅ | ✅ | ✅ |
| Colour themes | ✅ | ➖ | ➖ | ➖ |
| LSP · workflows · primary-agent · `/`-commands | ✅ | ➖ | ➖ | ➖ |

✅ native · ⚙️ OpenCode plugin · 🪝 `settings.json` hook · 📄 preamble prose only · ➖ no host mechanism (harness discipline still applies). ¹ Bob honours Claude-dialect hooks best-effort — inert if unsupported, harness still holds via the preamble.

**No host drops an Agent, Skill, or the memory convention.** The asymmetry is entirely in *automation mechanism*: OpenCode's plugins and Claude/Bob's hooks enforce a few Rules for you, where **Copilot** (no hook mechanism) enforces them through preamble discipline. The OpenCode-only extras (themes, LSP, workflow runner, primary-agent) have no analogue on a Claude-shaped host.

---

**Deeper:** [The harness model](#/docs/model) · [Footprint per host](#/docs/footprint)
