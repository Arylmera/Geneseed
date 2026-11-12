# Token footprint

What a deployed harness costs in context-window tokens, per host. Token counts are
chars/4 estimates and shift a little with theme and version.

**Treat every number below as a floor, not a reading.** They were measured on
2026-10-08 on a `--footprint lean` build (the default) of the neutral theme with
the default doctrine packs, 47 skills (plus 12 alias stubs) and 18 agents, and nothing
re-measures this page automatically. For a
live figure on your own install, ask the agent for the `token-report` skill —
that is what it is for. A `--footprint full` build ran about 7k tokens heavier
when the whole request was captured on 2026-11-12 (see
[Why there is no chat mode](#why-there-is-no-chat-mode)).

## Always-on cost per session

The context every host injects at session start, before you type anything:

| Component | Claude Code | OpenCode | Bob |
|---|---|---|---|
| Root instruction file | ~7.7k (`CLAUDE.md`) | ~7.6k (`AGENT.md`) | ~8.0k (`AGENTS.md`, §3 table inline) |
| Skill metadata (name + description) | ~3.0k | ~3.0k | ~3.0k (native) |
| Agent metadata | ~1.0k | ~1.0k | — (in the root's §3 table) |
| Session files (rules, profile, Memory/Notebook indexes, wiki) | 0 fresh, grows with use (SessionStart hook) | 0 fresh, grows with use (context plugin) | 0 fresh, grows with use (SessionStart hook) |
| **Total** | **~12k** | **~12k** | **~11k** |

The emits are at parity by design: ~12k tokens, about 6% of a 200k
window. Bob catalogues skills natively but not agents, so its
root keeps the §3 Agents table and drops the §4 Skills table — the catalogue
flag is per kind (`hostCatalogsNatively`), not one boolean. Before the 2026-09 footprint pass every hooked host paid roughly double
this: the context hook re-injected the root file the host had already loaded
natively, and skill descriptions ran to 900 characters each — see the
"Where the tokens go" list below for what changed. Bob carries the §3 Agents table inline because its host exposes
no native agent inventory; Claude Code and OpenCode ship a
pointer to the host's own inventory instead, ~0.3k tokens lighter. A session file still
byte-identical to its seed is skipped — it says nothing — so a fresh install injects none
of them; until 2026-10 the hook read them from the repo root, where a Claude-shaped install
never puts them, and none reached the session at all. The
eager-injection path is budget-capped on every host. The SessionStart hook (Claude Code,
Bob, OpenClaude) keeps its whole payload under 9,000 characters: Claude Code persists a
hook output past ~10k to a file and shows the model a 2 KB preview, so until 2026-10 a
doc-heavy repo's context was cut off unannounced. Session files come first, in the order
rules, profile, wiki, memory map, notebook, and a global install counts the shared tier's
layers with its own. Eager docs are injected whole or listed lazy with the reason. The OpenCode plugin has no such cap
and keeps 16 KB per file / 48 KB per session. Both fold a lazy listing: three or more
docs in one folder become one `dir/ — N docs` line. The hook also **never injects
the root file the host loads by itself** (`CLAUDE.md` on Claude Code,
`AGENTS.md` on Bob, `AGENT.md`/`AGENTS.md`/`CLAUDE.md` on OpenCode):
until 2026-09 it did, and the whole harness was paid twice per session.

## Where the tokens go

- **The root file is ~65% of the bill**, and the constitution inside it is the
  bulk of that — no longer one section but three: the Ethos, the nine Rules,
  and the doctrine packs this install built in. **Two** levers move it, not one.
  The [footprint dial](#/docs/footprint) (`lean`, the default, swaps each Rule,
  each doctrine rule, the Ethos and the longest prose sections — the preamble,
  §6 Notebook, §8 Wiki — for their hand-written condensations; `full` inlines
  every rationale). And the
  [doctrine packs](#/docs/setup-choices) — `geneseed-build --doctrines craft,rigor`
  drops whole blocks of §2 at build time, which removes far more than the
  footprint dial trims. Anything else is noise.

  The lean condensations are authored, not generated. An earlier design shipped
  the Ethos *whole* under `lean` on the grounds that truncating four flowing
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
- **§5–§9 carry authored lean halves too** (Memory, Notebook, Workspace, Wiki,
  Context): each keeps its obligations — read `MEMORY.md`, read
  `context.json` before the first reply, the git-ignored folders — and points at
  the on-disk README or config file for the rest. §10 (Scripts) is full-only: it
  describes the CLI to a reader, not an obligation to the agent.
- **Restated prose is full-only** (2026-10): the laws and Ethos intros, the §2
  pack intro, the posture/mode intros, §3's dispatch envelope and council roster
  (they live in the parallel-agents and council Skills; the lean root keeps
  "dispatched agents never commit or push"), and the folder-Skill list, which
  now sits in the §4 catalogue half and so drops wherever the host catalogues
  Skills natively.
- **Skill bodies (~54k) and agent bodies (~14k) are lazy** on every host —
  loaded only when invoked. A typical skill costs ≤3k per invocation; the
  heaviest (`react-view-transitions`, ~20k with its reference files) loads
  its references progressively.
- **User-only skills leave the catalogue.** A skill whose source carries
  `<!-- invocation: user -->` renders `disable-model-invocation: true`; Claude
  Code and Bob then drop its description from the always-on skill metadata and
  only `/name` opens it. The two teaching skills (`teach`, `learn-mode`)
  carry it today.
- **Aliases cost 0 always-on.** A merged skill's old names (`<!-- aliases: -->`)
  ship as user-only stubs on Claude Code, Bob and OpenClaude, and as `/name` commands
  on OpenCode — never in the model's catalogue, so a rename or merge is free.
- Plugin JavaScript (OpenCode, ~26k on disk) runs in the host runtime and
  never enters the context window.

## Why there is no chat mode

A "chat mode" would switch the harness off for a quick question, so a "hey, how are you?"
does not load the rules. It was measured on 2026-11-12 and turned down: the harness stays
loaded in every session.

**What was measured.** Each host was installed from npm and pointed at a local endpoint that
captured the request it sent for one short prompt, in an empty folder, with and without a
default global install. Sizes are characters of the request; tokens are chars/4.

| Host | No harness | Lean (default) | Full | Harness share, lean | Harness share, full |
|---|---|---|---|---|---|
| Claude Code 2.1.322 | 45,964 | 89,935 | 118,486 | ~11k tokens | ~18k tokens |
| OpenClaude 0.32.0 | 86,122 | 128,457 | 157,003 | ~11k tokens | ~18k tokens |
| OpenCode 1.19.5 | 30,435 | 86,811 | 115,599 | ~14k tokens | ~21k tokens |
| OpenCode 2.2.7 | 22,654 | 70,506 | 99,054 | ~12k tokens | ~19k tokens |

Bob was not measured: IBM does not publish Bob Shell on npm.

**Why the saving is small.** The harness share is 5–10% of a 200k window. The host re-sends
it with every message, but where the provider caches prompts it is billed at the full input
price once per session and at the cached rate after that. A chat mode would save that one
payment on sessions that stay small talk, and nothing else.

**Why it cannot be a command inside the chat.** The harness is in the context before the
first message, and no host can take text back out of a running conversation. A slash command
can only tell the model to ignore the rules, which saves no tokens. Switching on a resumed
conversation was measured too (harness on, resumed without it, resumed with it again):

| Host | Resumed without the harness | Resumed with it again |
|---|---|---|
| OpenClaude | sheds it (86,390) | back to normal (128,963) |
| OpenCode 1 | sheds it (30,606) | back to normal (87,250) |
| Claude Code | keeps it in the history (91,213) | loads it a second time (126,697) |
| OpenCode 2 | keeps it in the system prompt (68,273) | loads it a second time (118,720) |

On Claude Code and OpenCode 2 a toggle therefore costs more than it saves. A plain resume,
with the same configuration, adds only the new message on all four hosts.

**Why not a ready-made excluded folder.** An [excluded folder](concepts/exclusions.md) is for a
repo that brings its own setup, not for saving tokens. On Claude Code and OpenClaude it
removes the instructions file but leaves the skill and agent listings (about 3k tokens). On
OpenCode the request was byte-identical with and without the exclusion.

**If you want a session without the harness anyway**, each host has its own launch switch.
These are the hosts' options, not Geneseed's: they were checked on the versions above, in
non-interactive mode with an API key, and a host update can change them.

| Host | Launch line | Measured |
|---|---|---|
| Claude Code | `claude --setting-sources project,local` | 45,963 — the no-harness size |
| OpenClaude | `openclaude --setting-sources project,local` | 86,124 — the no-harness size |
| OpenCode 1 | `XDG_CONFIG_HOME=<empty dir> opencode` | 30,435 — the no-harness size |
| OpenCode 2 | `OPENCODE_CONFIG_DIR=<empty dir> opencode --standalone` | 22,654 — the no-harness size |

Such a session has no rules and no gates, and on Claude Code and OpenCode 2 they cannot be
added back to the same conversation cleanly. `XDG_CONFIG_HOME` is inherited by every program
the session starts, so git and other tools lose their own configuration too. On OpenCode 1,
`OPENCODE_CONFIG_DIR` changes nothing. Whether a subscription login survives
`--setting-sources` on Claude Code was not checked.

The decision is recorded in [Considered and refused](design-history.md#considered-and-refused).

## Why your session may show more

The always-on figures above are the *harness's* share. A real session's
token counter also includes, none of which Geneseed controls:

1. **The host's own overhead** — system prompt plus built-in tool
   definitions. On OpenCode this is typically 5–10k tokens before any
   harness content loads.
2. **Your repo's docs, injected eagerly** — the context delivery
   (plugin on OpenCode, SessionStart hook on Claude Code / Bob / OpenClaude) discovers and
   injects `README.md`, `CONTRIBUTING.md`, and files under `docs/`, up to the
   budget: 9,000 characters for the whole hook payload (≈2.3k tokens), 48 KB on
   OpenCode (≈12k tokens).
3. **Wiki eager entries** plus the lazy listing of the rest, if a wiki is
   configured.
4. **Grown Memory/Notebook** — the emitted starter set is ~1.2k, but both
   accumulate with use (same shared budget).
5. **Other instruction files the host also loads** — a global install plus a
   per-repo install, a personal `~/.claude/CLAUDE.md`, or MCP servers each add
   their own share.

So a ~30k session on a work repo is normal arithmetic: ~10k harness +
~10k repo docs + ~5–10k host overhead. Set `GENESEED_DEBUG=1` (OpenCode) to
log exactly which files the context plugin injected, or run the SessionStart
command by hand to see the hook's payload.
