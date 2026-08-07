<div align="center">

# 🧬 Geneseed — Design

**The spec behind the harness. Read this before changing structure.**

[← Back to README](README.md) · [Setup guide](SETUP.md)

</div>

---

## 🌱 Origin

Geneseed is a generic port of a personal, Obsidian-vault-grown agent system. The
source system had five layers: governance law, folder-owning delegate agents,
lifecycle-hook automation, skills, and persistent memory. Geneseed keeps the
parts that are **runtime-agnostic** and drops the parts that assumed a specific
vault or a specific tool's hooks.

## 🧠 Decisions

1. **Target: generic `AGENT.md`, no hooks assumed.** The harness must work in any
   assistant that reads an instructions file at the repo root. Automation is
   therefore *optional* (standalone CLIs) rather than load-bearing.

2. **Instructions-first.** The valuable behaviours (memory, learning, delegation)
   are expressed primarily as instructions in `AGENT.md` that the model follows.
   Scripts are a power-user convenience layered on top, never a requirement.

3. **Theme is voice + vocabulary; the scaffolding is theme-independent.** A single
   neutral source renders to any theme via token substitution, split into two classes:
   - **Structure** (always plain English, every theme, every emit) — the section
     *layout*, the harness name (`HARNESS`), the law *numbers*, a few rare technical
     nouns (`Context`, `Scripts`, `Charter`), and the folder names (`laws/`, `agents/`,
     `skills/`, `memory/` via `DIR_*`). These live in the `STRUCTURE` map in `build.py`
     and are laid on top of every render, so a theme can never move a path, a link, or
     a heading number. Tooling stays stable.
   - **Voice + vocabulary** (themed) — how the AI *responds* (`VOICE`), a top `BANNER`,
     and the prose words the docs use: the core nouns `LAW(S)`/`AGENT(S)`/`SKILL(S)`/
     `MEMORY`/`NOTEBOOK`/`VAULT`/`WIKI`, plus `TAGLINE`, `LOADED_SIGIL`, `EPI_*`, `BENEDICTION`, `DESC_*`,
     `ROAST_PERSONA`, the law titles `LEX_*`, and the section intros `INTRO_*`. Each
     theme defines its own nouns; **neutral keeps the plain words** (Rule, Agent, Skill,
     Memory, Workspace), so neutral output is unchanged.

   So `imperial` flavours the agent's tone *and* the page — the banner, the readiness
   sigil, the epigraphs, and the words themselves (the laws read as *Dictates*, agents
   as *Adepts*, skills as *Rites*) — while every folder is still `agents/`/`skills/`,
   law numbers stay `XVIII`, and links resolve identically across themes. The source
   tree under `src/` stays neutral for sane authoring. Toggle = one flag.

   The OpenCode emits add only: native skills at `skills/<name>/SKILL.md` (not slash
   commands) and an `AGENT.md` skill-link rewrite to that nested path.

4. **Delegation by capability, not by folder.** The source system owned content
   folders with delegate agents. For code repositories, specialists by capability
   (reviewer, tester, architect, docs, security) fit better and stay generic.

5. **Hermetic — with one git-ignored escape hatch.** The *tracked* harness
   references nothing outside itself — no links into the vault it grew from, no
   secrets, no host-specific paths. This guarantees a clean `git subtree split` /
   copy into any destination. The single sanctioned bridge to host-specific
   documentation is the `context.json` manifest (Decision 6): it is git-ignored, so
   host paths and proprietary docs never enter the published bundle, so
   hermeticity holds.

6. **Project context is a single git-ignored manifest — never published.** A
   consumer often needs the agent to know about substantial external documentation
   (framework internals, front-/back-end architecture) that must not be committed
   into the portable harness. A `context.json` file at the bundle root lists those
   docs by path, each with a `load` mode (`eager` = read every session, `lazy` =
   read on demand). The build writes an empty `context.json` once and never
   overwrites it; that file and the docs it points at stay on the machine. The agent
   reads it dynamically — no build step, tool-agnostic — and it is distinct from
   `memory/` (atomic learned *facts*) by holding pointers to *bodies of
   documentation* maintained elsewhere. It also subsumes what a baked-in project
   rules file used to do: point at the project's own conventions instead.

7. **Lean governance — every line must change behaviour.** The Laws, agent specs,
   and skills are the product, and a bloated instruction surface is ignored at
   runtime, not obeyed: an over-long rule set dilutes the rules that matter. So the
   bar for a new Law is high — it must be universal (it binds *every* task, in
   *every* repository), agent-behavioural (something the model does, not infra it
   cannot instantiate), and not already covered. A principle that is app-code craft,
   host-specific infrastructure, or single-domain belongs in an agent, a skill, or
   `context.json`, not in the universal Laws; a rule that overlaps an existing Law is
   folded in as a clause, not minted as a new number. This is the authoring-time
   counterpart to Law XV's runtime context economy: keep the instruction surface
   high-signal and pruned so it stays read and heeded.

   A Law that clears that bar is not one edit but six, because its *satellites* —
   themed title, class, display copy, counts — live outside `universal.md`:

   1. the rule body in `src/laws/universal.md`, headed `### {{LAW}} <roman> — {{LEX_<roman>}}`;
   2. `LEX_<roman>` in `themes/_TEMPLATE.json`, then `python build.py --sync-themes`
      to seed every theme, then restyle each one in its own voice;
   3. `LAW_CLASS` in `rituals/_harness_tui.py` — the governance class, one of the six
      in `LAW_CLASSES`;
   4. `LAW_META` in `web/src/pages/Laws.jsx` — the class fallback *and* the one-line
      Principle shown in the web ledger. This copy exists nowhere else; a law absent
      here renders with a blank description;
   5. the counts — README badge and prose, `SHIPPED.md`, the web onboarding copy;
   6. `CHANGELOG.md`.

   Everything on that list is gated by `doctor` (`_count_table_problems` in
   `rituals/_harness_build.py`), so `python rituals/harness.py doctor --all` is the
   check, not the checklist above — the list just says what it will ask for. Steps 3
   and 4 both earned their gate the same way: a law shipped without them, and the
   only symptom was a wrong chip or an empty cell in a UI nobody re-read.

## 🧩 Components

The `Harness/` output column shows the **neutral** folder name; the imperial theme
renders it as the name in parentheses.

| Component | Source | `Harness/` output | Purpose |
| --- | --- | --- | --- |
| Entrypoint | `src/AGENT.md.tmpl` | `AGENT.md` | what the tool reads; inlines the rules, links the rest |
| Governance | `src/laws/` | `laws/` (`leges/`) | universal rules |
| Delegation | `src/agents/` | `agents/` (`legati/`) | capability specialists with output contracts |
| Workflows | `src/skills/` | `skills/` (`rites/`) | repeatable procedures |
| Memory | `src/memory/` | `memory/` (`anamnesis/`) | one-fact-per-file convention + index |
| Notebook | `src/notebook/` | `notebook/` (`scriptorium/`) | the agent's sovereign space — any medium, seed-once charter the agent may rewrite; only `.gitignore` re-asserted |
| Context | `build.py` | `context.json` | empty per-repo manifest, written once and never overwritten; git-ignore it |
| Themes | `themes/*.json` | — | token → label maps |
| Generator | `build.py` | — | substitution + `<!-- INCLUDE: -->` inlining |
| Automation | `rituals/harness.py` | — | optional `build` / `doctor` / `context` / `learn` / `prompt` / `diff` / `setup` / `tui` |
| Adapters | `adapters/` | — | optional per-tool glue (hooks) |

## ⚙️ Generator contract

- Substitutes `{{TOKEN}}` in file *contents* only; paths are never themed.
- Resolves `<!-- INCLUDE: relpath -->` by inlining the rendered target.
- Unknown tokens are left visible (debugging aid); `doctor` flags them.
- Stdlib only; no third-party dependencies, ever.
- **`_build_settings.py` is the half of the emit that edits files you co-own** — the
  `settings.json` / `opencode.json` merges, JSONC parsing, the hook shim and the managed
  CLAUDE.md block. It is a separate module because every function in it reconciles
  Geneseed's claim with content Geneseed did not write, and because nine of its ten entry
  points are driven by the *runtime* as well as by an emit (`rituals/_harness_mcp.py` uses
  them for deactivate, remerge, reactivate and uninstall; so do `exclude` and `mcp`).
  Its dependency closure points one way only: nothing in it calls into `_build_render` or
  `_build_emit`. Keep it that way — that closure is what makes it a unit.
- **Every emit runs five stages in one order: `RENDER* → WIRE* → PRUNE → MANIFEST →
  VERIFY`.** RENDER writes files Geneseed owns wholesale; WIRE is `_build_settings`
  reconciling files you co-own; PRUNE removes what the previous manifest owned and this
  emit no longer produces; MANIFEST records both; VERIFY re-reads the merge to confirm it
  stuck. WIRE must precede MANIFEST because wiring is what fills the `managed` record the
  manifest stores, and no RENDER may follow a WIRE because the render half is the half
  that leaves Python. `tests/test_emit_phase_order.py` fails the build if any of the nine
  emits drifts out of that order, or if a new file-mutating routine in `_build_settings`
  is called from an emit without being classified.
- **The render core has a Node twin: [`js/render.mjs`](js/render.mjs).** It is a
  translation of `_build_render.py`'s pure pipeline, byte-identical by test rather than by
  intent — `tests/test_render_parity.py` renders both over every theme × footprint ×
  catalog × laws-prefix × posture × mode and compares the written trees byte for byte,
  plus the item order, which is observable and derives from a platform-dependent path
  sort. `js/lib/pyfs.mjs` holds the primitives where the two runtimes disagree in silence;
  `Path.write_text`'s `\n` → `os.linesep` translation is the load-bearing one. Zero
  dependencies on that side too.
- **The host-native layer has one too: [`js/native.mjs`](js/native.mjs)** — the point where
  RENDER stops being a pure function of `src/`. Its output depends on your
  `agent-overrides.json`, on which files already exist in the target (claim-on-create never
  overwrites a file Geneseed did not write), and on which of the three host dialects is
  emitting. None of those is reachable from a bundle-emitting test: an emit always writes an
  *empty* overrides stub into a *fresh* tree. So it has a gate of its own,
  `tests/test_native_layer_parity.py`, which hands both implementations the same rendered
  items and compares the written tree byte for byte, the returned ownership list *in order*,
  and the warning stream — and asserts the Node side printed nothing at all on stdout,
  because the emitted hook gates signal their verdict there and return 0 on every path.
- **The OpenCode extras are ported too: [`js/opencode.mjs`](js/opencode.mjs)** — the
  branded and curated colour themes, the opt-in primary agent and slash-command layer, the
  always-on `/ponytail` switch, the verbatim plugin/workflow copies, and the
  `agent-overrides.json` stub with its staleness notice. Half of it sits behind
  `GENESEED_PRIMARY` / `GENESEED_COMMANDS`, which are off by default — so a default emit
  never writes the primary agent or any command, and neither does any golden cell.
  `tests/test_opencode_extras_parity.py` drives both implementations with those flags on
  and off, over every theme plus synthetic ACCENT values the shipped themes do not
  contain, and compares the files, the returned ownership list, **and both output
  streams** — the staleness notice goes to stdout where every native-layer warning goes to
  stderr, an asymmetry inherited from the Python rather than corrected.
- **The seam is now a real process boundary: `build.py` spawns Node once per emit.**
  [`js/emit.mjs`](js/emit.mjs) writes the bundle (`build`) and the OpenCode layer's RENDER
  stage; Python keeps WIRE, PRUNE, MANIFEST and VERIFY, and drives — so doctor, web deploy,
  setup and rebuild-all keep calling `build.emit_*` in-process with no call site changed.
  Node falls back to Python when `node` is missing, silently and by design: the whole claim
  is that the two are indistinguishable. `GENESEED_NO_JS=1` forces the Python path.
  **The child's stdout carries the protocol document and nothing else — structurally.**
  `js/emit.mjs` replaces `process.stdout.write` and `process.stderr.write` with buffers for
  the whole run and restores them only to emit that document, so a stray `console.log`
  cannot corrupt the handoff; it lands in the payload, Python re-prints it, and the byte
  comparison fails. Python re-emits both buffers through its own `print`, which is what
  keeps the bytes identical: Node writes UTF-8 unconditionally where Python writes the
  console's locale encoding. `tests/test_emit_boundary.py` runs the real generator twice
  over the same cell — Node driving, then `GENESEED_NO_JS=1` — and compares the tree,
  **stdout, stderr and the exit code**, over cells a uniform matrix cannot reach: a
  re-emit, a renamed owned dir, a *suspicious* name in `.geneseed-srcdirs.json` (the one
  file-driven path into a recursive delete), user edits between two emits, and a truncated
  source tree. `tests/golden.py` now compares both streams too, as `<stdout>`/`<stderr>`
  pseudo-files.
- **The write-before-delete prune finally has a gate that makes it delete.**
  `golden.py --idempotent` re-emits the *same* configuration, so the owned set is identical
  on both passes and `old_owned - owned` is always empty — 259 green cells said nothing
  about the prune. `--deletion` emits configuration A, then B onto A's tree, and compares
  the result against a **fresh** emit of B: a working prune makes those byte-identical, a
  missing one leaves A's files behind, and one widened past the difference deletes files B
  still wants. Both axes were measured rather than assumed (`lean → full` drops the
  single-file laws pointer, `neutral → imperial` drops the theme-named OpenCode theme), and
  a cell whose two configurations stop differing is rejected instead of quietly becoming a
  second `--idempotent`. The one thing it forgives is named per cell: the agent's own
  memory and notebook seeds are written **once** and never re-rendered, so they keep the
  pre-switch vocabulary by design — and a cell whose carve-out excuses nothing fails too.
- **All nine emits now cross that seam.** The last of the render half is
  `_emit_claude_core`, the shared engine behind six of the nine — Claude, Bob and Copilot
  at both scopes — so until it moved, two thirds of the matrix compared Python against
  Python. Three things in it are not translations. `_ship_lean_laws` is the render that
  used to run *after* a wiring stage, and it does two jobs: it writes the standalone laws
  file and it **claims** it, so a later switch back to the full footprint prunes it.
  `_global_memory` / `_global_notebook` copy arbitrary **user** files in from a legacy
  bundle — the one-time migration that keeps a host switch from losing learned facts — and
  the only thing making that safe is that they run at all only when the destination is
  empty. And the payload has to carry something that is not a file: **`claudeMdText`**, the
  text of CLAUDE.md's managed block, because computing it is a render (AGENT.md re-rendered
  with every store dir prefixed) while merging it into a file the user co-owns is wiring.
  `hasAgentText` travels beside it and is a *different* predicate — Bob at global scope
  emits a preamble but gets no managed block.
  The boundary gate grew the states that go with them: a legacy bundle to migrate from
  (with the bundle in a subfolder, so `--out` and the target are not the same directory), a
  `.claude/` the user got to first, and every write-once file edited *between* two emits —
  the only way a byte comparison can tell "kept your store" from "re-seeded it".
- **The wiring layer has a Node twin as well: [`js/settings.mjs`](js/settings.mjs)** — the
  JSONC reader, the `opencode.json` and `settings.json` merges, the hook shim, the
  managed-block machinery and the settings integrity check. Nothing imports it yet; it is
  proven before it is wired, the way every piece before it was. It is the last unit to
  cross because it is the one the **runtime** drives too: eleven of its names have a
  consumer outside the emit tree, ten of them in `rituals/_harness_mcp.py`, which is what
  actually pins it — remerge, deactivate, reactivate, uninstall and `exclude` all edit a
  real settings.json through these functions, and until now nothing compared two runtimes
  across any of them. `tests/test_settings_parity.py` drives seven scripted sequences —
  not seven isolated calls, because the defects here are sequence defects — over states no
  emit-time gate could construct: a settings.json carrying the user's own hooks, a
  commented JSONC, a recorded claim set that is no longer canonical, a settings file that
  is not valid JSON, and the migration where an older install wired hooks into a different
  file. **The shim is compared, not skipped.** It is the one function whose Python output
  is legitimately runtime-dependent — it bakes the interpreter and the checkout — so the
  Node twin takes both as arguments and the gate feeds it the two Python computed, which
  makes every byte comparable, both platform branches included. What stays unproven is
  which values a Node driver will pass, and that is one line at a future call site rather
  than anything in the body.
- **Python and JavaScript disagree about JSON, in two ways that reach emitted bytes.**
  `json.dumps` escapes non-ASCII and `JSON.stringify` does not, which is 44–50
  `description:` lines per theme; and `json.loads` distinguishes `20` from `1.0` where
  `JSON.parse` collapses both to one double, so `temperature: 1.0` would emit as
  `temperature: 1`. `js/lib/pyfs.mjs` settles both — the second by parsing through the
  reviver's `context.source` so the literal survives, and re-serialising through
  `JSON.rawJSON` so it survives a round trip. Every JSON the generator reads goes through
  `parseJson`, themes included, so the rule has no exceptions to remember.
  The split between the two writers is **compact vs indented**, not string vs container:
  Python's default separators are `(', ', ': ')`, but passing an indent switches them to
  `(',', ': ')` — exactly what `JSON.stringify(v, null, 2)` emits. So `jsonDumpsIndent`
  covers every container the render half writes, while `jsonDumps` stays string-only and
  throws on a container rather than silently emitting the wrong separators. The wiring
  layer is where the third form finally has callers: `jsonDumpsCompact` writes a container
  with no indent, which cannot delegate to `JSON.stringify` at all — patching the
  separators into the serialised text would corrupt any string holding a comma or a colon
  — so the walk is written out, with `sort_keys=True` as an option because the orphan scan
  keys on it.
- **`_build_core` is the single owner of the generator's mutable configuration** — the
  source/theme roots, the four `_<host>_config_dir` resolvers, and the build-wide
  posture/mode selection, listed in its `_OWNED` tuple. The membership rule is *does
  anything ever redirect this name* — a redirect that reaches some of five copies is
  worse than one that reaches none, because it half-works in silence.
  The process seam extended that rule: everything the Node child reads travels in one
  explicit `cfg` object (`_build_core.js_cfg`), because a subprocess cannot share a
  binding. That is how `STRUCTURE` joined it — it had passed the membership test by
  accident, since the splice shares the dict *by reference* and a test mutating
  `build.STRUCTURE` reached every reader. A child process shares nothing, so it now
  travels too — and `CAPABILITY_LINK_RE` followed it for the same reason one phase later,
  found not by review but by the doctor test that redirects the regex to its pre-fix form
  and asserts the emit then renders dead links. It had been in `_OWNED` all along; what
  changed is that the code reading it moved into another process.
  `build.py` splices its four `_build_*` submodules into one shared namespace, so
  every other shared name exists as a copy in each of them; the owned ones deliberately
  do not. They are held back from both `_build_core.__all__` and the splice, so there is
  exactly one binding: read them as `_build_core.SRC`, redirect them by writing
  `_build_core.SRC`. `build.SRC` still reads (that is the runtime's surface) but refuses
  writes — a write through the facade cannot be restored reliably, and a redirect that
  silently outlives its test poisons every later read. A bare `SRC` left in a submodule
  raises `NameError` rather than quietly reading a stale copy; that noise is the point.

## 🚫 Explicitly out of scope

Graph/index generation, web-clipping pipelines, session-classification capture,
sync-conflict cleanup, and folder-ownership delegation — all assumed a specific
vault and lifecycle hooks. They are not ported. The `learn` CLI is the one
distilled survivor of the original learning loop, made model-CLI-agnostic.
