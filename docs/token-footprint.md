# Token footprint

What a deployed harness costs in context-window tokens, per host. Token counts are
chars/4 estimates and shift a little with theme and version.

**Treat every number below as a floor, not a reading.** They were measured on
2026-09-12 on a `--footprint lean` build (the default) of the neutral theme with
four doctrine packs, 54 skills and 19 agents, and nothing re-measures this page
automatically. For a
live figure on your own install, ask the agent for the `token-report` skill —
that is what it is for. A `--footprint full` build runs roughly 5k tokens
heavier on the root file.

## Always-on cost per session

The context every host injects at session start, before you type anything:

| Component | Claude Code | OpenCode | Bob | Copilot |
|---|---|---|---|---|
| Root instruction file | ~7.3k (`CLAUDE.md`) | ~7.3k (`AGENT.md`) | ~7.7k (`AGENTS.md`, §3 table inline) | ~9.0k (`AGENTS.md`, §3+§4 tables inline) |
| Skill metadata (name + description) | ~4.1k | ~4.1k | ~4.1k (native) | — (§4 table; native catalogue unverified) |
| Agent metadata | ~0.5k | ~0.5k | — (no agents directory) | — (§3 table) |
| Eager memory/notebook injection | ~1.2k (SessionStart hook) | ~1.2k (context plugin) | ~1.2k (SessionStart hook) | ~1.2k (sessionStart hook) |
| **Total** | **~13k** | **~13k** | **~13k** | **~10k** |

The emits are at parity by design: ~10–13k tokens, about 6% of a 200k
window. Bob catalogues skills natively but has no agents directory, so its
root keeps the §3 Agents table and drops the §4 Skills table — the catalogue
flag is per kind (`hostCatalogsNatively`), not one boolean. Before the 2026-09 footprint pass every hooked host paid roughly double
this: the context hook re-injected the root file the host had already loaded
natively, and skill descriptions ran to 900 characters each — see the
"Where the tokens go" list below for what changed. Bob and Copilot carry the §3/§4 catalogue tables inline because their
hosts expose no native skill/agent inventory; Claude Code and OpenCode ship a
pointer to the host's own inventory instead, ~1.9k tokens lighter. Copilot also
runs without eager injection — it has no hook mechanism, so the
memory/notebook indexes load when the agent reads them, not eagerly. The
eager-injection path is budget-capped identically everywhere — 16 KB per file
(cut at a line break, with a marker saying so) and 48 KB per session (files past
the budget are listed lazy with the reason) — so a 40k-character README no
longer leaves whole every session, and growing Memory degrades every host the
same way instead of one silently falling behind. The hook also **never injects
the root file the host loads by itself** (`CLAUDE.md` on Claude Code,
`AGENTS.md` on Bob and Copilot, `AGENT.md`/`AGENTS.md`/`CLAUDE.md` on OpenCode):
until 2026-09 it did, and the whole harness was paid twice per session.

## Where the tokens go

- **The root file is ~65% of the bill**, and the constitution inside it is the
  bulk of that — no longer one section but three: the Ontology, the nine Rules,
  and the doctrine packs this install built in. **Two** levers move it, not one.
  The [footprint dial](#/docs/footprint) (`lean`, the default, swaps each Rule,
  each doctrine rule, the Ontology and the longest prose sections — the preamble,
  §6 Notebook, §8 Wiki — for their hand-written condensations; `full` inlines
  every rationale). And the
  [doctrine packs](#/docs/setup-choices) — `geneseed-build --doctrines craft,rigor`
  drops whole blocks of §2 at build time, which removes far more than the
  footprint dial trims. Anything else is noise.

  The lean condensations are authored, not generated. An earlier design shipped
  the Ontology *whole* under `lean` on the grounds that truncating four flowing
  sections to four orphan sentences would ship a worldview nobody could read —
  the `LEAN:` blocks answer that by hand-writing the short form instead. The
  doctrine packs were the last tier still cut at the first full stop, and they
  now author their halves too — which *adds* text at `lean` rather than removing
  it, deliberately: eleven of the twenty-four rules were shipping a slogan with
  no verb an agent could act on. Read the carrier size off the ceiling in
  `tests/unit/emit_smoke.test.mjs` rather than a byte count quoted here; the
  figure moved twice while this paragraph went on stating the old one.
- **Skill descriptions are the second bill** on a host that catalogues natively.
  Each is the skill's purpose line plus the *first sentence* of its trigger,
  capped at 320 characters (`skillDescription` in `js/hosts/native.mjs`); at
  the earlier 900-character cap the catalogue weighed ~5.6k tokens. The later
  trigger sentences still live in the body, read as soon as the skill is chosen.
- **§5–§10 carry authored lean halves too** (Memory, Notebook, Workspace, Wiki,
  Context, Scripts): each keeps its obligations — read `MEMORY.md`, read
  `context.json` before the first reply, the git-ignored folders — and points at
  the on-disk README or config file for the rest.
- **Skill bodies (~53k) and agent bodies (~10k) are lazy** on every host —
  loaded only when invoked. A typical skill costs ≤3k per invocation; the
  heaviest (`react-view-transitions`, ~17.5k with its reference files) loads
  its references progressively.
- **User-only skills leave the catalogue.** A skill whose source carries
  `<!-- invocation: user -->` renders `disable-model-invocation: true`; Claude
  Code and Bob then drop its description from the always-on skill metadata and
  only `/name` opens it. Seven skills carry it today (the five teaching drills,
  `herdr`, `opencode-theme`), roughly a seventh of the ~1.7k skill-metadata line.
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
