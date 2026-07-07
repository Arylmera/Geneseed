# Token footprint

What a deployed harness costs in context-window tokens, per host. Measured on a
`--footprint full` build of the neutral theme (41 skills, 17 agents); token
counts are chars/4 estimates and shift a little with theme and version.

## Always-on cost per session

The context every host injects at session start, before you type anything:

| Component | Claude Code | OpenCode | Bob | Copilot |
|---|---|---|---|---|
| Root instruction file | ~10.7k (`CLAUDE.md`) | ~10.6k (`AGENT.md`) | ~10.7k (`AGENTS.md`) | ~10.7k (`AGENTS.md`) |
| Skill metadata (name + description) | ~1.6k | ~1.6k | ~1.6k | ~1.6k |
| Agent metadata | ~0.45k | ~0.55k | ~0.45k | ~0.45k |
| Eager memory/notebook injection | ~1.2k (SessionStart hook) | ~1.2k (context plugin) | ~1.2k (SessionStart hook) | — (no hooks; read on demand) |
| **Total** | **~14k** | **~14k** | **~14k** | **~12.8k** |

The emits are at parity by design: ~14k tokens, about 7% of a 200k
window (Copilot runs slightly lighter because it has no hook mechanism — the
memory/notebook indexes load when the agent reads them, not eagerly). The
eager-injection path is budget-capped identically everywhere
(16 KB per file, 48 KB total ≈ 12k tokens ceiling), so growing Memory degrades
every host the same way instead of one silently falling behind.

## Where the tokens go

- **The root file is ~76% of the bill**, and its Rules section alone is ~6.3k
  of the ~10.7k. The [footprint dial](#/docs/footprint) (`full` vs `lean`)
  exists precisely because this is the only lever that matters — trimming
  anything else is noise.
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

So a ~34k session on a work repo is normal arithmetic: ~14k harness +
~10k repo docs + ~5–10k host overhead. Set `GENESEED_DEBUG=1` (OpenCode) to
log exactly which files the context plugin injected, or run the SessionStart
command by hand to see the hook's payload.
