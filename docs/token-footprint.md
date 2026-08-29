# Token footprint

What a deployed harness costs in context-window tokens, per host. Token counts are
chars/4 estimates and shift a little with theme and version.

**Treat every number below as a floor, not a reading.** They were measured on a
`--footprint lean` build (the default) of the neutral theme when the tree carried
47 skills and 17 agents, and nothing re-measures this page automatically. For a
live figure on your own install, ask the agent for the `token-report` skill —
that is what it is for. A `--footprint full` build runs roughly 5k tokens
heavier on the root file.

## Always-on cost per session

The context every host injects at session start, before you type anything:

| Component | Claude Code | OpenCode | Bob | Copilot |
|---|---|---|---|---|
| Root instruction file | ~6.4k (`CLAUDE.md`) | ~6.4k (`AGENT.md`) | ~8.3k (`AGENTS.md`) | ~8.3k (`AGENTS.md`) |
| Skill metadata (name + description) | ~1.7k | ~1.7k | ~1.7k | ~1.7k |
| Agent metadata | ~0.5k | ~0.55k | ~0.5k | ~0.5k |
| Eager memory/notebook injection | ~1.2k (SessionStart hook) | ~1.2k (context plugin) | ~1.2k (SessionStart hook) | — (no hooks; read on demand) |
| **Total** | **~9.8k** | **~9.9k** | **~11.7k** | **~10.5k** |

The emits are at parity by design: ~10–12k tokens, about 5–6% of a 200k
window. Bob and Copilot carry the §3/§4 catalogue tables inline because their
hosts expose no native skill/agent inventory; Claude Code and OpenCode ship a
pointer to the host's own inventory instead, ~1.9k tokens lighter. Copilot also
runs without eager injection — it has no hook mechanism, so the
memory/notebook indexes load when the agent reads them, not eagerly. The
eager-injection path is budget-capped identically everywhere
(16 KB per file, 48 KB total ≈ 12k tokens ceiling), so growing Memory degrades
every host the same way instead of one silently falling behind.

## Where the tokens go

- **The root file is ~65% of the bill**, and the constitution inside it is the
  bulk of that — no longer one section but three: the Ontology, the nine Rules,
  and the doctrine packs this install built in. **Two** levers move it, not one.
  The [footprint dial](#/docs/footprint) (`lean`, the default, keeps each Rule
  and each doctrine rule as its heading plus first line, and swaps the Ontology
  and the longest prose sections — the preamble, §6 Notebook, §8 Wiki — for
  hand-written condensations; `full` inlines every rationale). And the
  [doctrine packs](#/docs/setup-choices) — `geneseed-build --doctrines craft,rigor`
  drops whole blocks of §2 at build time, which removes far more than the
  footprint dial trims. Anything else is noise.

  The lean condensations are authored, not generated. An earlier design shipped
  the Ontology *whole* under `lean` on the grounds that truncating four flowing
  sections to four orphan sentences would ship a worldview nobody could read —
  the `LEAN:` blocks answer that by hand-writing the short form instead
  (measured on `neutral`, the root file at `lean` went from 29,966 bytes to
  25,614 with them).
- **Skill bodies (~53k) and agent bodies (~10k) are lazy** on every host —
  loaded only when invoked. A typical skill costs ≤3k per invocation; the
  heaviest (`react-view-transitions`, ~17.5k with its reference files) loads
  its references progressively.
- Plugin JavaScript (OpenCode, ~26k on disk) runs in the host runtime and
  never enters the context window.

## Why your session may show more

The always-on figures above are the *harness's* share. A real session's
token counter also includes, none of which Geneseed controls:

1. **The host's own overhead** — system prompt plus built-in tool
   definitions. On OpenCode this is typically 5–10k tokens before any
   harness content loads.
2. **Your repo's docs, injected eagerly** — the context delivery
   (plugin on OpenCode, SessionStart hook on Claude Code / Bob; Copilot has no
   hook channel, so its sessions read docs on demand instead) discovers and
   injects `README.md`, `CONTRIBUTING.md`, and files under `docs/`, up to the
   48 KB budget (≈12k tokens). A doc-heavy repo fills it.
3. **Wiki eager entries** plus the lazy listing of the rest, if a wiki is
   configured.
4. **Grown Memory/Notebook** — the emitted starter set is ~1.2k, but both
   accumulate with use (same 48 KB shared budget).
5. **Other instruction files the host also loads** — a global install plus a
   per-repo install, a personal `~/.claude/CLAUDE.md`, or MCP servers each add
   their own share.

So a ~30k session on a work repo is normal arithmetic: ~10k harness +
~10k repo docs + ~5–10k host overhead. Set `GENESEED_DEBUG=1` (OpenCode) to
log exactly which files the context plugin injected, or run the SessionStart
command by hand to see the hook's payload.
