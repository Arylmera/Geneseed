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
  Geneseed's claim with content Geneseed did not write, and because eleven of its names are
  driven by the *runtime* as well as by an emit (`rituals/_harness_mcp.py` uses ten of them
  for deactivate, remerge, reactivate and uninstall; `exclude` and `doctor` use the rest).
  Its dependency closure points one way only: nothing in it calls into `_build_render` or
  `_build_emit`. Keep it that way — that closure is what makes it a unit.
- **Every emit runs five stages in one order: `RENDER* → WIRE* → PRUNE → MANIFEST →
  VERIFY`.** RENDER writes files Geneseed owns wholesale; WIRE is `_build_settings`
  reconciling files you co-own; PRUNE removes what the previous manifest owned and this
  emit no longer produces; MANIFEST records both; VERIFY re-reads the merge to confirm it
  stuck. WIRE must precede MANIFEST because wiring is what fills the `managed` record the
  manifest stores, and no RENDER may follow a WIRE because a render writes wholesale a file
  a wire has just reconciled. `tests/test_emit_phase_order.py` fails the build if any of the
  nine emits drifts out of that order, or if a new file-mutating routine in
  `_build_settings` is called from an emit without being classified. Now that RENDER and
  WIRE happen in the *same* child, the render and wire dispatchers stay two separate
  functions and two separate statements on purpose — that shape is the only thing left for
  the walker to check, and a gate refuses an emit whose sequence has lost its WIRE.
  `build.py`'s `main()` is classified too, as the one stage no per-emit gate can see: it
  writes the `.geneseed-emit` / `-footprint` / `-theme` markers and the install-registry
  record *after* every emit returns, and nothing that reconciles a file you co-own may run
  there, because there is no manifest to record the claim and no teardown able to undo it.
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
- **All nine emits cross that seam** — and this bullet said so for two phases while eight
  did. `emit_opencode_global` spawned Node **zero** times: its render half was inline
  Python, `js/emit.mjs` offered no job kind for it, and `tests/test_emit_boundary.py` had no
  cell for it either, which is why nothing contradicted the sentence.
  `tests/test_seam_coverage.py` measures the spawn count of every mode, fails if the table
  drifts, and **refuses a mode that crosses without a boundary cell** — so the count above
  is a measurement, and restoring it cost the six cells that earn it. Porting the ninth was
  assembly rather than translation (58 of the 65 functions in its closure were already in
  `js/`), and its structural work was elsewhere: unlike its eight siblings it had no
  `_render_py` / `_wire_py` pair to port into, so the pair had to be **created**. That
  shape is not tidiness — `run_node` classifies as RENDER, so an emit whose two dispatch
  statements are folded into one is perfectly monotone, renders, manifests, and wires
  nothing the phase-order gate can see.
  The largest of the nine is `_emit_claude_core`, the shared engine behind six — Claude,
  Bob and Copilot at both scopes — so until it moved, two thirds of the matrix compared
  Python against Python. Three things in it are not translations. `_ship_lean_laws` is the render that
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
  managed-block machinery and the settings integrity check. It was proven before it was
  wired, the way every piece before it was; the emit now drives it. It was the last unit to
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
- **The wiring half now runs inside the render child, and two stages deliberately do not.**
  The same spawn that renders an emit also merges your `settings(.local).json`, your
  CLAUDE.md managed block and your `opencode.json`. `_settings_integrity_check` stays in
  Python because VERIFY runs *after* MANIFEST and MANIFEST is Python — which turns out to be
  worth keeping rather than merely unavoidable. It never writes, so every Claude-shaped emit
  now ends with Python re-reading the settings file Node just wrote and checking it against
  the claims Node just returned. Two implementations of this layer coexist while the runtime
  is Python, and that check is what makes them **interoperate** on a real file rather than
  merely resemble each other under a parity harness; `tests/test_harness.py`'s uninstall
  tests do the same across a whole lifecycle, wiring through Node and unwiring through
  Python. `emit_opencode_global`'s own `opencode.json` merge also stays in Python, for the
  duller reason that it has no child to join.
  **The hook shim baked the Python interpreter and `rituals/harness.py` through P5a** even
  though Node wrote the file, because the hooks it launched were still Python;
  `process.execPath` was to become the right answer the day the hooks crossed, not the day
  the driver did. They crossed in P5a and the substitution landed in P5b — see *the shim is
  machine-wide* below. That substitution used to be invisible to every
  gate — golden filters the shim out by name so a cross-revision run is not drowned in
  noise, and `doctor`'s check only fires once the baked path stops existing — so the
  boundary gate now compares the shim body between the two runtimes directly.
  **`hookPrefix` throws rather than defaulting.** Left undefined, the runner and entry point
  were baked as the literal string `"undefined"`, killing every hook in the install, and the
  hooks report success on every path by design.
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
- **There is a second driver: [`bin/geneseed.mjs`](bin/geneseed.mjs), and it is ADDED beside
  `main()` rather than replacing it.** `build.py` is also the `import build` facade that 19
  `rituals/` modules read 55 distinct names from, and roughly eleven sites spawn it as a
  subprocess; none of them flip, because flipping them would make Node mandatory for the
  *Python* runtime and kill the silent `js_render_available()` fallback. **All nine emits now
  cross**, and they crossed in an order where each added one thing: `--emit files` is the one
  whose Python dispatcher hands the whole emit to Node and returns; `--emit opencode` is the
  first whose **driver body** — PRE (the manifest read), PRUNE, the atomic MANIFEST write, the
  summary line — had to be ported beside the RENDER/WIRE half that already ran there; and
  `--emit opencode-global` is the first **global** target, which is where the inverted
  boundary rule stops being theory. The host config-dir resolvers are exactly the values a
  render child must never resolve, so the driver originates them — `pyResolve` reproducing
  `Path.resolve(strict=False)`, because `realpathSync` throws on the normal case where nobody
  has created the config dir yet. An emit that has not crossed **refuses with exit 3** instead
  of producing a partial tree; that branch is now unreachable and stays, because it is the
  partition `test_the_node_driver_classifies_every_emit` asserts — a tenth emit that failed to
  cross would refuse loudly rather than fall through to building a plain bundle.
  `tests/golden.py --emits` is no longer part of the acceptance command (the full 259 run
  is), but the flag stays: it is how a single emit is narrowed to while iterating, and it
  carries its own wiring gate and mutation history.
  **The Copilot pair crossed next, and which two was the decision.** All six remaining emits
  share one engine (`_emit_claude_core`), so porting the engine looks like it should get all
  six at once. Four of them write `settings.json` hooks, so they reach `hookPrefix`, which
  needs the two machine-absolute values `_hook_runner_entry()` returns — `sys.executable`
  and the harness entry point. **A Node driver has no `sys.executable`**: the hooks it would
  be wiring are Python and `process.execPath` is node. `js/emit.mjs` gates the whole
  settings path behind `!isCopilot` and skips VERIFY for the same host, so the Copilot pair
  rides the shared engine without touching either — which buys the entire driver body
  (manifest-with-`managed`, prune, atomic write) while leaving the interpreter question
  isolated and labelled rather than answered in passing. `hookOpts` is consequently
  **omitted** for a host that wires no hooks, rather than sent as `{}` or `null`: omitted, a
  stray call throws the error P3b built for it; `null` raises an unrelated `TypeError`; `{}`
  bakes the literal string `"undefined"` into the shim and silently kills every hook in the
  install.
  **Then the interpreter question had to be answered, and the answer was to refuse — until
  P5b deleted the question.** (What follows describes P4e; the shim bakes Node now, and
  neither the discovery nor the refusal survives. Kept because the *reasoning* is why the
  flip could only land once the hook verbs had crossed.) The four
  hook-writing emits discovered a Python rather than inheriting one: `$PYTHON` first (the
  documented contract of both front doors), then `py`, `python`, `python3` on `PATH`. When
  none is found the emit **exits 4 having written nothing**, because a shim naming an absent
  interpreter is a *silently disabled hook* — every Geneseed hook returns 0 and signals
  through stdout, and `golden.py` excludes the shim from byte comparison by name, so nothing
  in the system would report it. An install that looks complete with six dead hook groups is
  worse than a build that stops, and the command the refusal names (`python build.py`) is
  available exactly when the emit would have meant anything. Discovery is a **filesystem
  scan, not a probe**, and that is forced: the Node driver may not import `child_process` (it
  is half the proof that it is a second implementation rather than a passthrough), so
  `geneseed.cmd`'s "first candidate that actually runs" test is unavailable. Measured rather
  than assumed — `existsSync` returns false for the Microsoft Store alias stub, because
  `statSync` on the reparse point raises `EACCES`, so the plain spelling already skips the
  thing the launcher needed a subprocess to detect. (End of the superseded passage.)
  **VERIFY did not need porting; it needed calling.** `settingsIntegrityCheck` has been
  complete in `js/settings.mjs` since P3a with no production caller, so the "largest unported
  unit left" was one call site. What changed with it is what it proves: on the Python driver
  the stage runs in Python *after* a Node child did the wiring, making it a live
  cross-implementation check on every build; with both halves in Node that property is gone
  and only the self-check remains.
  **Two hazards here are invisible to a byte comparison for opposite reasons.**
  `json.dumps` defaults to `ensure_ascii=True` where `JSON.stringify` does not — a
  difference the matrix catches in the manifest (its comment carries an em dash) and cannot
  catch in `installs.json`, whose paths are ASCII in every cell and are not on a machine
  with an accented user name. And `$OPENCODE_CONFIG_DIR` is *deliberately cleared* by
  `golden.cell_env`, because leaving a relocation variable set would send ~126 global cells
  into the developer's real install — so a driver that ignored it would be byte-identical in
  all 259 cells while writing to the wrong directory on every machine that exports it. Both
  get a hand-written cell asserting the target, and a mutation confirms each is the only
  thing that catches its own bug.
  **A fresh sandbox cannot reach a driver body's more interesting half.** Every one of
  golden's cells emits into an empty tree, so `old_owned` is `[]`, the PRE branch never
  parses a manifest and the prune never has anything to delete — the code most likely to be
  wrong is invisible to the gate that is otherwise this port's acceptance test. Two gates
  answer that: `golden.py --repeat N` emits N times into the same sandbox on **both** sides,
  which is the re-emit path compared ACROSS implementations (`--idempotent` compares a
  generator against itself and can only prove self-consistency), and the `--root` axis gets
  a hand-written cell because `_argv` never passes the flag — `out == root` in all 259 cells,
  so the instruction-path prefix `opencode.json` records is otherwise never exercised.
  **Three gates for a driver body, and each reaches something the other two cannot** —
  measured by deleting the prune and watching which one goes red. A fresh cell covers the
  first emit; `--repeat` covers reading a manifest and merging into files that already
  exist; only `--deletion` reaches the prune's deletion path, because it is the only one
  that changes the configuration between emits and so the only one where `old_owned - owned`
  is non-empty. A narrowing flag also has to be *proven wired*: `--repeat` degrades silently
  into the plain parity run if `main` stops threading it through, so
  `tests/test_golden_sandbox.py` intercepts `compare` and asserts the value arrived.
  **The boundary rule inverts here.** Every phase since the seam became a process has asked
  which values the child may resolve and which the parent must decide and send — the answer
  for `cfgDir` being that a child resolving it would render into the developer's real config
  dir. A Node driver is the *parent*, so the values a child must never resolve are exactly
  the ones it must originate: `ROOT` and the paths under it come from the script's own
  location. Two `cfg` keys are deliberately **absent**, and their absence is load-bearing:
  `js_cfg()` always sends `structure` and `capabilityLinkRe` because the Python originals are
  module names tests mutate, but this driver has no Python module to mutate — so
  `js/render.mjs`'s `cfg.structure ?? STRUCTURE` and `js/emit.mjs`'s `capabilityLinkRe`
  fallback take their right-hand branches for the first time since they were written. They
  were unreachable, not untested. A second driver is what reached them.
  **A byte gate cannot tell two implementations from one**, so the driver owes a process
  observation and not another matrix: a `bin/geneseed.mjs` whose whole body was
  `spawnSync('python', ['build.py', ...argv])` passes every golden cell perfectly, because it
  *is* the Python CLI. `tests/test_node_cli_parity.py` refuses that from both sides — running
  with every interpreter removed from PATH catches a spawn a source read would miss in a
  disabled branch, and a source check catches the absolute-path spawn no PATH change can
  observe. Each half is the only one that catches its own mutation, which is why they are two
  tests. The markers go through `pyfs.writeText`, never `writeFileSync`: `Path.write_text`
  opens in text mode with `newline=None`, so a marker written with a bare LF differs from
  Python's on Windows in every cell.
  **The hook path is where the matrix is weakest, because the shim is excluded from it by
  name.** That exclusion is what made byte-parity reachable for a Node generator at all — the
  shim body bakes the writing generator's interpreter and checkout, so it would differ in
  every cell — and it leaves a hole exactly where the last four emits work. `_shim_health`
  fills part of it by asserting the shim exists and names files that exist, and it used to
  return "fine" when it found *no* shim: a generator that wired `settings.json` correctly
  (every command naming the shim path, so every compared byte matches) but never wrote the
  shim passed. It now takes the emit and requires the four hook-writing ones to produce a
  shim. Two further things no byte comparison can reach get hand-written cells: *which*
  interpreter the shim names (its runner is executed and required to be Python 3 — the driver
  may not spawn, the gate may, and that asymmetry is the point), and whether the emitted
  hooks **run** at all, by taking a command out of the settings file and running it through
  the shell with its `|| exit 0` intact.
  **A fifth kind of coverage hole: SILENT ON SUCCESS.** VERIFY runs on every Claude-shaped
  emit and prints only on a fault, and no cell creates one — so deleting the call is
  byte-identical across all 259. That is neither unreachable (it runs every time) nor
  indistinguishable-by-fixture in the earlier senses; its whole *output* is conditional. The
  cell that closes it plants a user-authored hook matching a sniff marker, which makes both
  implementations speak so their stderr can be compared. The four earlier kinds —
  fresh-sandbox, flag-never-varied, deliberately-cleared-env, empty-precondition — each
  needed a different fix, and so did this one.
- **The runtime port starts with the four HOOK verbs, and with a gate rather than with
  code.** `context`, `git-gate`, `rule-gate` and `learn` are the four commands an emitted
  `settings.json` actually invokes, and they now have a Node twin:
  [`js/hooks.mjs`](js/hooks.mjs) behind [`bin/geneseed-hook.mjs`](bin/geneseed-hook.mjs), a
  **second binary** rather than a subcommand of the generator driver — `learn` must spawn
  whatever `$GENESEED_LLM` names, and `bin/geneseed.mjs` is under a hard `child_process`
  ban that is half the proof it is not a passthrough. The hook entry loads none of the
  ~11,600 lines a Python `harness context` pulls in through `harness.py`'s
  fourteen-submodule splice, which is the same reason the Python originals already refuse
  to import `build` for the marker filenames they need.
  **A cell is not an emit here, and that is the phase's first design question.** A verb's
  observable surface is stdout, stderr, the **exit code** and whatever it wrote, so
  [`tests/harness_golden.py`](tests/harness_golden.py) compares all four across 103 seeded
  worlds — reusing `golden.py`'s `cell_env`, `_normalise`, `_snapshot` and `_split` rather
  than growing a second set of rules about sandboxes and CRLF. `cwd` is an **input** to
  three of the four (discovery, the sovereign bypass, and learn's memory search all read
  it), so every cell runs from inside its own sandbox — which is why the harness resolves a
  repo-relative CLI path once, up front.
- **A comparison alone would have been the wrong gate for these four**, and more obviously
  than for the generator: a hook must never break a tool call, so every unreadable payload,
  missing file, malformed user config and bypass exits 0 with **no output at all**. Two
  implementations that both stopped gating would agree in every such cell forever. Each
  cell therefore also states, absolutely, what the *reference* must do — `expect`,
  `expect_absent` (the direction `expect` cannot express, and the only way to gate a filter
  like `EXCLUDE_DIRS` whose whole job is leaving things out), `expect_silent` and
  `expect_files` — and a cell that has stopped exercising what it names is reported as
  **VACUOUS** rather than banked as a pass.
- **One line could not be ported, and it was rewritten on both sides instead.** A malformed
  `context.json` used to be reported by quoting the decoder's own exception. Python's
  `json` and V8 disagree on the wording *and* the offset for every common typo — a trailing
  comma points at the comma in one and at the character after it in the other, and V8's
  `Unexpected token 'x'` carries no offset at all — measured across twenty malformed
  documents. Both now print the file and the fix, following the precedent already set for a
  malformed `settings.json`, and the read failure is split out from the syntax error
  because they were never the same problem. `learn` also gained `encoding="utf-8"` on the
  model CLI's pipe: a bare `text=True` decodes the reply with the console code page, and
  the mojibake is *written to the memory store*, so it outlives the process.
- **The shim bakes Node now, and the shim is machine-wide.** `bin/geneseed.mjs` writes
  `<node> <checkout>/bin/geneseed-hook.mjs`, so an install it emits needs no Python for its
  hooks at all; the interpreter discovery and the exit-4 refusal that guarded it are deleted
  rather than bypassed, because `process.execPath` is the node already running and cannot
  fail to exist. What makes this a decision rather than a substitution is that
  `hookShimPath()` has **no per-install component** — `$GENESEED_HOME`-or-`~/.geneseed` plus
  `bin/geneseed-hook[.cmd]` — so every emit on a machine rewrites one file that every
  install's hooks execute. Last writer wins, and after the flip that is observable: a
  machine whose last emit ran through Node has every install's hooks running under Node,
  including installs `python build.py` wrote. That is correct exactly while the two entry
  points answer the same verbs identically, which turns
  `test_the_entry_carries_exactly_the_verbs_the_emitter_wires` from a formality into the
  gate the design rests on. A per-driver shim path was considered and rejected: the path is
  baked into every already-emitted hook command, so changing it makes every existing
  install's hooks stale until re-emit.
  **The cell that asked which interpreter the driver discovered became a cell that runs the
  shim.** Asserting the runner's identity stopped meaning anything once the answer was
  "node"; the property underneath was always the chain, so the gate now pulls the git-gate
  command out of the settings file the driver just wrote, runs it through the shell with a
  commit payload, and requires the verdict document back — an assertion that would pass
  unchanged against a Python-baked shim. Its former opposite number flipped with it: with
  every Python stripped from PATH, the four hook-writing emits must now *succeed* and their
  hooks must still answer.
  **The pre-shim fallback is recognisable to cleanup only by a coincidence of filename**,
  and that is now gated. When the shim cannot be written, `hookPrefix` emits
  `"<node>" "<checkout>/bin/geneseed-hook.mjs"`, which `GENESEED_HOOK_SNIFF` matches through
  `SHIM_MARK` — the marker lives in the shim's *filename*, and the Node entry happens to
  share it. An unrecognised hook is one no `unlink`, `uninstall` or orphan scan can find.
  **Node's hooks now translate newlines like Python's.** `sys.stdout` is a TextIOWrapper
  with `newline=None`, so Python's hooks emit CRLF on Windows; `process.stdout` translates
  nothing, measured at 176 bytes against 171 for one `context` run. Every cell in
  `harness_golden.py` reads stdout through a universal-newline decoder, so the difference
  was invisible to the entire matrix — the same shape as the shim's exclusion from
  `golden.py`. Harmless while nothing baked the Node entry; the bytes a real host reads once
  something does. `js/hooks.mjs`'s two output funnels translate, and one gate reads raw
  bytes.
  The acceptance harness is what kept the port from being dead code before any of this — it
  executes `bin/geneseed-hook.mjs` as a real process against the Python one, which is the
  lesson from a stage that sat complete and uncalled in `js/settings.mjs` for two phases and
  was then briefed as unported.
  **Adding a module that legitimately spawns opened a door the driver's own gate cannot see
  through**: `test_the_driver_imports_no_child_process_module` greps `bin/geneseed.mjs`'s
  source, and one `import` of `js/hooks.mjs` would put `child_process` in the driver's
  process with that source still clean. `tests/test_hook_cli_parity.py` walks the driver's
  transitive relative imports instead — the same assertion, one level out, added because of
  this phase.
- **`status` and `version` cross, and the phase's method is a CORPUS beside the matrix.**
  [`js/status.mjs`](js/status.mjs) answers both from `bin/geneseed-cli.mjs`. Two structural
  things came with them.
  **A closure walk counts what the callee COMPUTES; the caller consumes a fraction of it.**
  An `ast` walk puts `status` at 527 LOC across 7 modules — `_tui_inventory` returns every
  agent and skill with its body, purpose, source and lifecycle badge, and `_status_data`
  reads three `len()`s off it. So the `SKILL_CLASS`/`LAW_CLASS`/`ENTITY_STATUSES` taxonomy
  the TUI owns is in the walk and is not in the port, and neither are `_installed_defaults`'
  posture and mode detectors. The exception names the rule: `_footprint_of_dir`'s return
  value is unused too, and it is ported, because an unrecognised marker makes it WARN on a
  stream the matrix compares.
  **The fixture cannot FENCE OFF `_build_core.ROOT`, and that is a ninth kind of coverage
  hole** — the inverse of the eight before it, which were all about what a fixture cannot
  reach. `status` counts by rendering the real `src/`, and both `_installed_defaults` and
  `version`'s fallback walk `ROOT/"Harness"`. No env var moves ROOT, every path under it is
  derived at import, and the `_OWNED` redirect the suite uses is an in-process write — so
  neither implementation can be pointed at a fixture tree, and copying the checkout into the
  sandbox would copy the same `src/` back in. The counts are therefore gated by comparison
  and asserted only by SHAPE (`expect_re`, new this phase); a cell naming `17 agents` rots
  with the next content change and one naming a fingerprint rots every commit, which
  `test_no_cell_hardcodes_a_source_fingerprint` refuses.
  **The colour branch is unreachable from any cell, and the answer was neither of the two
  the handoff offered.** `_color_enabled()` is `sys.stdout.isatty()`, every harness captures
  through a pipe, so deleting every escape code would be byte-identical across the whole
  matrix — ship it ungated or drop it and regress a real terminal. `_status_lines` is
  documented pure, so [`tests/test_pure_function_parity.py`](tests/test_pure_function_parity.py)
  calls it directly on both sides over a corpus of dashboards × colour × ASCII, and the tty
  question never arises. Three more cell-unreachable functions ride along for the same
  reason — `_version_verdict`'s up-to-date branch, `_manifest_is_claude` (only consulted for
  a candidate ordered *after* the unfenceable `ROOT/"Harness"`), and `_accent_for`'s
  fallback — plus `pyLen`/`pyLjust`, because a reproduction of a language primitive needs a
  corpus rather than a cell.
  **And the corpus found a live defect in shipped code.** `js/hooks.mjs` carried its own
  `str(Path(p))` as `pyStrPath`, built on `path.normalize`; P5c had already found that
  `normalize` collapses `a/../b` where `PurePath` keeps it, fixed `js/lib/pyfs.mjs`'s
  `pyPathStr`, and gated it with a 25-path corpus — which never reached the twin, because a
  corpus finds what it is pointed at and a different NAME was enough to hide it. The
  consequence was live on the bypass path: a hand-edited `..` entry in `excludes.json` made
  the Node hook stand down for a repo Python still gates.
  `context/sovereign-bypass-does-not-match-a-dotdot-entry` is the cell, and the hook path
  now has one owner for the primitive instead of two.
- **The first NON-hook verb crosses, and it needed a third binary rather than a row in an
  existing table.** `harness exclude add|remove|list` — the sovereign-repo exclusions —
  is now [`js/excludes.mjs`](js/excludes.mjs) behind
  [`bin/geneseed-cli.mjs`](bin/geneseed-cli.mjs). The *reader* had been ported since P5a
  (`sovereignBypass` runs on every hook call); this is the writer, which maintains
  `excludes.json` across every global install and wires each host's native per-repo
  suppression into the excluded repo.
  **Where to put it was the whole question, and two of the three answers cost something
  specific.** Growing `bin/geneseed-hook.mjs` would have meant relaxing
  `test_the_entry_carries_exactly_the_verbs_the_emitter_wires` from equality to a subset
  relation — the gate the machine-wide shim now rests on — *and* loading `js/settings.mjs`
  plus `js/emit.mjs`, ~2,100 lines, on every `PreToolUse` call, against a spec that says the
  shim must exec a minimal entry. Putting it in `bin/geneseed.mjs` would have crossed two
  different Python programs: that file is `build.py`'s `main()`, parses generator flags with
  a partition asserted over them, and carries a `child_process` ban that `web` and `upgrade`
  will eventually need broken — the ban should outlive them, not be dismantled by the first
  verb that does not need it. So the two Node entries are **disjoint by assertion**, and
  `tests/harness_golden.py` grew a `bin` per cell and a `--new-cli` beside `--new`.
  **Supplying one candidate binary and not the other is refused, not defaulted**: an
  unsupplied cell would compare the reference against itself, which always passes and reads
  exactly like a ported verb.
  **The ownership rule is asserted absolutely, because a comparison is blind to it.**
  `exclude add` records the `claudeMdExcludes` entry it *created* so that `exclude remove`
  strips only that; an entry found rather than created — a project install's own wiring, or
  a hand edit — must never be claimed. Two writers that both claimed what they found would
  agree in every cell of the matrix while both deleting a line out of a user's settings file,
  so that one is a hand-written gate run against **both** implementations, with the
  positive control (`remove` really does unwire what `add` wired) beside it, since without it
  the test passes on an implementation that never unwires anything.
  **Two writers for one user-owned file is a stated, temporary cost.**
  `rituals/_web_actions.py` calls the Python `exclude_add`/`exclude_remove` verbatim and the
  web server is a later phase, so until then both exist — held byte-equal by the matrix, and
  atomic (temp + rename) on both sides, so a concurrent pair loses an edit rather than
  tearing the file.
- **`build`, `prompt` and `theme` cross — the generator's own CLI face —** as
  [`js/generate.mjs`](js/generate.mjs). **Ten of the 24 subcommands are now Node.** Three
  things are worth recording, and the first is about measurement rather than code.
  **A closure walk cannot see through a `subprocess`, and `build` is nothing but one.**
  `cmd_build` measures three lines because the work is `run([sys.executable, BUILD])`. Its
  Node twin does **not** reproduce that shape: `bin/geneseed-cli.mjs` is under a transitive
  `child_process` ban, and spawning `node bin/geneseed.mjs` would be a Node CLI starting a
  second Node process to do work it can do in its own. So `bin/geneseed.mjs`'s `main` is
  exported and called directly, and the auto-run at its foot grew an entry guard — Python
  needs a second process because `build.py` is a different *program*; here it is a module.
  Both ways of getting the guard wrong are gated: stuck false makes the driver a silent
  no-op and fails all 259 golden cells, stuck true runs the generator on the CLI's argv and
  fails the three `build/*` cells.
  **The cells found a live Windows bug in the reference, and the first draft of them encoded
  it.** `harness build` printed nothing where the Node twin printed the generator's summary,
  so the cells were written `expect_silent=True` — asserting what *is* rather than what
  *should be*. `_harness_core.run` folded `CREATE_NO_WINDOW` into every spawn, and with all
  three streams inherited `subprocess` never sets `STARTF_USESTDHANDLES`, so the child got a
  fresh hidden console and **everything it printed was discarded whenever the parent's stdout
  was not a terminal**: `geneseed build > log.txt` wrote an empty log, and the web UI's
  "build all" job logged the harness's lines and none of the generator's. The flag now
  applies only when the caller redirects — which is when it was ever needed, and the doctor's
  per-theme sweep (the case its comment named) captures, so the Doctor page stays flash-free.
  Fixed at the shared `run()` rather than reproduced, following the precedent set for
  `learn`'s cp1252 pipe.
  **A function can be reachable in every cell and still never VARY in one.** `_fence_for`
  picks a backtick fence longer than the longest run inside a rendered file; measured over
  the whole tree, the longest run in any source text is 3, so it returns the four-backtick
  floor for all 96 files and a port that hardcoded four is byte-identical across the matrix.
  That is a fifth distinct reason for the corpus gate, and it is a claim about *content*, so
  `test_the_fence_corpus_still_describes_the_real_tree` re-derives it and fails the day a
  source file grows a four-backtick run — at which point a cell becomes writable and should
  be written. The corpus file is renamed to
  [`tests/test_pure_function_parity.py`](tests/test_pure_function_parity.py) with it: it was
  named for the status panel when the panel was all it held.
  **Three of the six verbs the phase was scoped around did not cross, each for a measured
  reason.** `sync-self` is a five-line alias whose body is `_update.sync_self` → `upgrade()`,
  i.e. `git pull` + rebuild, which the self-update phase deletes rather than ports.
  `link` and `unlink` install the `geneseed` front door on PATH, and that is three blockers
  at once: `_win_user_path` drives **PowerShell** to edit the persistent user PATH, which the
  CLI's `child_process` ban forbids; the shim they write names `sys.executable` plus
  `rituals/harness.py`, so a byte-equal Node twin would have to rediscover a Python
  interpreter using the discovery the shim flip deleted; and a shim naming
  `bin/geneseed-cli.mjs` instead would answer three of the 24 verbs. The npm `bin` map is
  what replaces them, so they belong to the publish phase and not to this one.
- **`diff` and `rebuild-all` cross** as [`js/diff.mjs`](js/diff.mjs) and `cmdRebuildAll` in
  [`js/generate.mjs`](js/generate.mjs), with the install detectors extracted to
  [`js/installs.mjs`](js/installs.mjs) and the registry to [`js/registry.mjs`](js/registry.mjs).
  **Twelve of the 24 subcommands are now Node.**
  **A closure walk cannot see through the standard library either.** An `ast` walk puts
  `diff` at 252 LOC of marker and manifest reading, and the verb's *entire* user-visible
  payload is `difflib.unified_diff`, which the walk counts as zero because `difflib` is not in
  `rituals/`. There is no lazier answer than reproducing it: a generic JS diff produces a
  correct diff and a *different* one, and what the acceptance matrix compares is bytes. So
  [`js/lib/pydiff.mjs`](js/lib/pydiff.mjs) is `SequenceMatcher` and `unified_diff`, including
  `autojunk` — the popular-line purge that engages at 200 elements and rewrites the hunks of
  every real harness file, and which no fixture is large enough to reach.
  **The rest of the diff is gated by cells and the algorithm by a corpus**, with the
  unreachability measured in both directions: switching `autojunk` off turns 28 corpus cases
  red and leaves all 189 acceptance cells green.
  **Calling `main` in-process is not transparent, and `rebuild-all` is where that showed.**
  Its contract is "continue past a failure so one broken install never blocks the rest",
  which the Python gets for free from a subprocess return code. `bin/geneseed.mjs`'s `die`
  called `process.exit`, which would have taken the loop, the CLI and every remaining install
  with it — so it throws now and `main` converts every deliberate refusal to an exit code.
  The first draft converted only `die`'s own, on the theory that a refusal from deeper down
  should keep its stack; the cell for a bogus theme marker is what showed that was a
  distinction with no principle behind it.
  **A second live ordering bug in the same helper `build` found the first in.** The Python's
  `[rebuild-all]` label lines arrived *after* the generator output they introduce, because
  `print()` block-buffers when stdout is not a terminal while the inherited child writes
  straight through — so every label named the install below it. Invisible in a terminal and
  wrong in the web UI's "build all" log, the same consumer the `CREATE_NO_WINDOW` bug was
  hiding output from. Fixed at the shared `run()`: flush before an inheriting spawn.
  **And the driver's newlines are Python's now**, which closes an item carried since the
  generator's CLI landed: its stdout was one byte short of the Python's on Windows because
  `print()` translates and `process.stdout.write` does not, and no gate could see it —
  `tests/golden.py` captures with `text=True`. `withPyNewlines` wraps the driver's `main`
  rather than converting ~25 print sites, because those modules are *also* the body of the
  seam child whose output a Python parent re-prints; translating at the site would translate
  twice. The gate is a new `build` row in `test_the_two_entry_points_agree_on_stdout_BYTES`.
  **`doctor` was scoped into this phase and is deliberately not in it.** Its closure is 925
  LOC and it runs fifteen `_*_problems` checks that print nothing when they all pass — so
  deleting any one of them is byte-identical in every clean cell, and the gate has to be one
  *planted fault per check*. Measured: **ten of the fifteen read the checkout itself** — `src/`,
  `themes/`, `README.md`, the web pages — and no cell can write there, because `ROOT` is
  derived from the running file's own location on both sides and is the one thing the sandbox
  cannot redirect. Gating `doctor` to this port's standard therefore needs a fixture kind that
  does not exist yet: copy the checkout into the sandbox, plant one fault, and run *both*
  binaries from the copy so their two `ROOT`s move together. That is the next phase's first
  design decision rather than a corner of this one.
- **`doctor` crosses** as [`js/doctor.mjs`](js/doctor.mjs), and the fixture came first.
  **Thirteen of the 24 subcommands are now Node.**
  **The copy-the-checkout fixture, measured rather than feared.** `_copy_checkout` in
  [`tests/harness_golden.py`](tests/harness_golden.py) gives each cell its own copy of the
  working tree (`git ls-files --cached --others --exclude-standard`), plants one fault in it,
  and runs *both* binaries from the copy so the two `ROOT`s move together. 511 files, 5.2 MB,
  **0.31 s** against a `doctor` run of ~2.1 s — a seventh of the cell, so it is one copy per
  cell per side and the obvious optimisation (one copy per cell *group*, planted and reverted)
  is refused: it would buy that seventh back by making the cells order-dependent, which nothing
  in this harness has ever been. Thirty cells, one planted fault per check.
  **The fixture's own blind spot was the check it was built for.** `Harness/` is *gitignored*,
  so a copy of the tracked set has no committed bundle at all and `_rendered_problems` returns
  on its first line — every "rendered bundle in sync" a clean cell prints was a sentence about
  nothing. `--bundle` and a seeded tree close it, and a two-step cell (`build`, then `doctor`
  against what it wrote) is the only honest source of a bundle a fresh render *agrees* with.
  **A `git ls-files` fixture cannot see the file you are writing.** The first draft copied the
  *tracked* set, so every cell reported the candidate dying on `ERR_MODULE_NOT_FOUND`:
  `js/doctor.mjs` was untracked until it was committed. The fixture mirrors the working tree
  now, ignored paths excluded, which is also what keeps `node_modules/` out of 27 copies.
  **The `child_process` ban became an allow-list, on the condition its own docstring named.**
  `_authoring_problems` runs `node --check` over the OpenCode plugins and there is no
  in-process equivalent — `vm.Script` compiles as a *script* and every plugin is ESM, which
  `node --check` accepts through module-syntax detection. That is the opposite of `build`,
  whose spawn existed only because `build.py` is a different *program*. So the gate now asserts
  the property it used to infer: one binding, one call site, an argv that is `node --check`,
  and a dynamic run of `doctor` with **no python anywhere on PATH**.
  **Two of a check's three arms are unreachable because doctor's own consumer is stricter than
  its gate.** A colour theme missing a palette role kills the opencode-global emit — which runs
  *first* — with a `KeyError`, so `_color_theme_problems` never reports it. Only the arm the
  emit passes through (a value present and not `#rrggbb`) can be planted.
  **And the first caller in the port that CATCHES a refusal found what that costs.**
  `sys.exit(msg)` attaches its message to the *exception*, so a Python caller that catches it
  sees no output; this port writes at the raise site, which is identical for every caller that
  lets the throw propagate and wrong for exactly this one. `renderedProblems` buffers stderr
  and replays it only if the render returns.
  **36 mutations, 34 fire.** The two survivors are classified (one unreachable, one
  indistinguishable), and one of the mutations is aimed at the FIXTURE: with `_copy_checkout`
  planting nothing, a planted-fault cell does not go red, it goes *vacuous* — which is the
  absolute half of a cell doing its job one layer further out than it ever has.
- **`uninstall` crosses** as [`js/uninstall.mjs`](js/uninstall.mjs), and it is the first verb
  in the port that **deletes**. **Fourteen of the 24 subcommands are now Node**; of the ten
  left, `setup`/`menu`/`home` are P5's and the rest belong to P6–P10.
  **A deletion needs the gate to prove what SURVIVED.** Every cell before this one asserts
  what the reference produced, and a cross-implementation comparison is structurally blind to
  two ports that both stopped deleting — they agree perfectly, forever. So every removal cell
  seeds an *unowned* neighbour beside the owned files and names it in `expect_files`: the
  difference between a manifest-driven removal and an `rmtree` is a positive control, not a
  comment. P5c's ownership rule, one phase on and pointed the other way.
  **The snapshot learned to see a directory.** `golden._snapshot` walks *files*, so an empty
  husk was invisible in all 219 cells — and the ancestor-climb prune (`skills/<name>/…`, the
  nested vendored layout) is a quarter of this verb. A `<dirs>` column in `run_cell` closes it
  for the whole matrix at once, including the cells written before it existed; `cmdTheme`'s
  statement order was sitting in the same hole. The *absolute* half is a different axis and is
  the sixth expectation kind, **`expect_absent_files`**, which fails loudly if the column is
  missing rather than letting every husk assertion pass unexamined.
  **The reference's INCOMPLETE message promises a retry that cannot happen.** `uninstall` warns
  that "the install marker was KEPT so you can retry" whenever a directory survives — but for a
  *global* install the per-host reversal has already dropped the manifest and all four markers,
  because it gates on its own `failed` list while the survivors sweep gates on `survivors`. Two
  signals, one deletion, and only one of them reaches it: the promised retry reports *no
  install at all*. Found by an `expect_files` written to assert the promise, and recorded as a
  two-step cell both implementations must agree on rather than quietly fixed on one side.
  **And a user's own file makes a clean uninstall report INCOMPLETE.** `_owned_dirs_for` holds
  that *existence*, not emptiness, is the retry signal for `agents`/`skills`/`.opencode`, so any
  file the manifest does not claim under one of them keeps the whole install marked
  retry-worthy. The first draft of the cells put their positive controls inside those
  directories and every removal cell came back INCOMPLETE — which is how the behaviour was
  found. Both arms are now gated deliberately.
  **`pyIsAbsolute` joins `pyfs` as a single owner.** `path.isAbsolute` calls a *rootless*
  `/x/AGENT.md` absolute and `Path.is_absolute` does not — Python wants a drive or a UNC root —
  and that decides which `opencode.json` `instructions` entry `uninstall` unwires. Corpus-gated
  for the reason P5c gave, and the corpus earned its place immediately: the first draft called a
  drive-*relative* `C:x` absolute and only the two drive-relative cases said so.
  **33 mutations, 30 fire.** All three survivors are the same shape — an arm with no caller in
  *this* binary — and two of the reds only fired after a FIXTURE changed: a green mutation is a
  question about the corpus of inputs before it is a question about the code. The control had to
  be re-chosen too; the first one shared mechanism with half the mutations and reported four
  over-reaches that were nothing of the kind.
- **`setup` crosses** as [`js/setup.mjs`](js/setup.mjs), and it is the first **interactive**
  verb in the port. **Fifteen of the 24 subcommands are now Node**, and P5 is done: the nine
  left belong to P6–P10.
  **`cmd_setup` is a dispatcher, and that is the phase's first finding.** It is 21 lines: a
  TTY check that refuses, `curses.wrapper(_setup_flow)` — 1,100 lines of full-screen wizard
  that are **P7's** — and a line-mode fallback. Same shape as `menu` and `home`, which the
  brief had already excluded from P5 for exactly that reason. The difference is that the
  phases table commits GA to "the text wizard + web console", and `_setup_lines` *is* the
  text wizard, so the line arm crosses and the curses arm does not. On Windows the reference
  always lands in the line arm anyway (there is no `curses` to import); the one stderr line
  it prints on the way is a stated divergence, and P7's to reconcile.
  **No cell can reach any of it, so the corpus learned to type.** `setup` refuses when
  `sys.stdin.isatty()` is false and every cell's stdin is a pipe — so the three `setup/*`
  cells gate the *gate*: that it refuses, that it refuses before reading or writing anything,
  and that a full script of answers does not get it to run anyway. Everything behind it is
  gated by a new corpus shape in `tests/test_pure_function_parity.py`: both probes run with
  **stdin redirected from a seeded file**, and their **whole stdout is compared byte for
  byte** — prompts, numbered menus, `(default)` markers, the plan line and the returned
  selection in one string. That is stricter than a cell would have been, because a cell
  cannot vary the answers at all, and it puts the newline translation under the gate for the
  first time (every earlier probe comparison went through a JSON parse, which cannot see it).
  **And it found a bug in the port on its first run.** The stdin reader inherited from
  `uninstall` decoded fd 0 **one byte at a time**, which turns every multi-byte character
  into replacement characters. Invisible for a phase because its only caller answered `y` or
  `n`; the wizard's first non-ASCII answer exposed it. The bytes are now collected and
  decoded once — scanning for `\n`/`\r` a byte at a time is still correct, since no UTF-8
  continuation byte is below 0x80. This is the second phase running where moving a helper to
  its **second owner** is what made a latent defect observable.
  **`pyInt` joins `pyfs` as a single owner.** `int(s)` is not `Number(s)` in four ways that
  each change a wizard answer: `Number('')` is 0, `Number('0x2')` is 2, `Number('1_0')` is
  NaN and PEP 515 says 10, and `int` accepts any Unicode decimal where `Number` accepts none.
  The menu's three fallback arms — an in-range index, a *parsed* out-of-range one, and an
  unparseable answer matched against the option keys — are told apart by nothing else.
  **The `child_process` allow-list became a table.** `_lsp_prereqs` runs `java -version` to
  see whether OpenCode's `jdtls` has a JVM, so `js/setup.mjs` is the second module on this
  entry allowed to spawn. The gate now carries the module, the binding, the call count and
  the literal argv for each one, cross-checked against the source — the port's rule that the
  second instance of anything stops being a special case.
  **And the posture/mode debt came due.** `installedDefaults` had answered two keys since
  P5d; the wizard pre-selects three of its five pickers from the other three, so a two-key
  answer would have silently offered the *configured* default where the *deployed* one was
  meant. Nothing in `status` or `doctor` moves — both read the keys they already read.
  **34 mutations, 32 fire.** One survivor is indistinguishable (`_ask` trims, so dropping the
  `\r` in the reader changes nothing) and one is unreachable from every gate
  (`exportImprovements`' no-drift arm needs a deployed install byte-identical to a fresh
  render, and the render reads `src/`). A third fired only *after* a corpus was added: eight
  menu cases and not one of them was both a valid index and a valid option key, so matching
  keys before parsing an index was the same function — a green mutation is a question about
  the corpus of inputs before it is a question about the code.
  **And a warning worth more than the phase: `< /dev/null` is a TTY to Python on Windows.**
  The null device is a character device and the CRT's `_isatty` says yes, so smoke-testing
  this verb's refusal from a shell runs the whole wizard and rebuilds your live install. The
  cells are safe — `subprocess.run(input=…)` is a real pipe — but a gate on `isatty` cannot
  be checked with a redirect.
- **The web console's HTTP shell crosses, and it needed a third acceptance harness.**
  `tests/golden.py` compares the tree a generator writes; `tests/harness_golden.py` compares
  one verb invocation on stdout/stderr/exit/files. An endpoint writes nothing and never
  exits, so [`tests/web_golden.py`](tests/web_golden.py) asks a different question: one
  seeded world, one **sequence of requests** against a freshly started server, compared on
  the status line, the response body as bytes, the five headers the handler *chooses*, the
  daemon record, and the server's own streams. **Both sides are real processes**, started on
  an ephemeral port and stopped in a `finally` — a fixed 4747 would collide with the
  developer's own daemon. The connection is **reused across a cell's requests**, which is
  what makes `do_POST`'s drain-before-routing observable at all; a harness opening a fresh
  socket per request would leave `protocol_version = "HTTP/1.1"` untested.
  **Cells for the shell, corpus for the functions.** All 136 tests in `tests/test_web.py`
  call `api_X(state)` in process, and none of them can see any of `_web_server.py` — not the
  routing, the CSRF check, the DNS-rebinding guard, the status conventions, gzip negotiation,
  keep-alive, or the token injected into `index.html` per request. That is the 654 lines the
  new harness exists for.
  **`_send_json` is `jsonDumpsCompact`, exactly** — "compact" there means *no indent*, not
  *no spaces*, and Python's default separators are `(', ', ': ')`. So all 29 paths share one
  serialiser and no new helper. Its `bareInts` flag states the one condition: a response
  body's numbers are computed here rather than parsed from JSON, and Python types every one
  of them `int`, which both languages render identically.
  **A compressed body is the one thing that cannot be compared as bytes.** The gzip member
  header carries a clock and an OS byte the two runtimes spell differently — and, measured
  after a small payload matched by luck, **the DEFLATE streams differ too**: 753 bytes
  against 751 for the same 1.5 kB input at the same level. That is the zlib build each
  runtime links, which neither implementation chose. So the body is inflated and compared,
  with the compressed length normalised to a tag so its presence stays gated. A destamp
  cannot reach inside one either: the injected token compresses to a different length every
  run, and the reference differed from *itself* until the gzip cells moved to a payload
  carrying no per-run value.
  **Fourteen mutations, twelve fire, and both survivors were findings.** One was a cell
  asking the wrong question — a forged `Host` sent *with* a valid token cannot tell
  host-first from token-first, since both answer `forbidden host`; only a request failing
  **both** checks can. The other is honest: two mutations that stop draining the POST body
  both survive, because Node's parser owns the message boundary where Python's handler reads
  a raw socket. The branch is **indistinguishable on this runtime, not unreachable**, and it
  stays. A third mutation found the gate itself: with no daemon record, the teardown raised
  while parsing a port out of `""` — in a `finally`, *before* the kill — so a failed cell
  ended the run and orphaned one server per cell, which is the exact failure the teardown
  exists to prevent.
- **Eight web read endpoints cross, and six of them were a JSON face over work already
  done.** `/api/overview`, `/api/themes`, `/api/doctor`, `/api/diff`, `/api/installs`,
  `/api/excludes`, `/api/setup` and `/api/profile` now answer from
  [`js/web/api.mjs`](js/web/api.mjs) as well as from `rituals/_web_*.py`. **No subcommand
  crosses here and the count stays fifteen** — `web` the verb is P6h's, and until then the
  only caller of this code is the acceptance harness. `api_setup` is `statusData()` plus
  four fields; `api_diff` is `diffCollect()` reshaped; `api_excludes` is
  `excludesSnapshot()` unmodified; `api_installs` is a row per `installTargets()` entry
  through five detectors P5d and P5f had already ported. That is the same discovery every
  P5 sub-phase made, one layer up.
  **One parameter had to grow: `doctorCollect({groups})`.** `js/doctor.mjs` already carried
  a `ran(check, label, probs)` whose label went nowhere, with a docblock saying it stayed
  because it is the one place each check is named. `/api/doctor` renders one card per
  check, so this is the phase that fills it. `on_progress=` is still absent and still P7's.
  **The inventory stays the counting half, deliberately.** `state.inventory` is every agent
  and skill with its body, purpose, source path, lifecycle badge and taxonomy class, and
  `api_overview` reads three `len()`s off it. The badge and the class come from the ~111
  lines of TUI taxonomy P7 owns and no P6b endpoint consumes either, so `specNames` is the
  file-*selection* half of `_spec_entries` and P6c grows it by adding the read — not by
  writing a second selector.
  **`python` is the first field in this port with no honest twin.** `api_setup` reports the
  interpreter running the daemon; a Node daemon has none, and answering with Node's version
  under a key named `python` would be a lie the About page prints. It answers `null`. The
  harness normalises the field on both sides — and, because the value is four bytes wider
  on one of them, the `Content-Length` it moves, tagged the same way a compressed body's
  length already was. A comparison made tolerant of a value owes an absolute assertion
  about that value somewhere else, so `tests/test_web_server.py` now carries **both**
  halves: that the reference reports `sys.version`, and that the Node daemon reports
  `null` rather than something version-shaped that would slip through the same pattern.
  **The clock needed a corpus, because the cell cannot see it.** `build_time` and
  `checked_at` are both `%Y-%m-%d %H:%M` sampled while the cell runs, and the two sides run
  seconds apart — so the harness normalises them, which means a twin formatting in UTC, or
  padding wrong, would compare equal in every web cell. The stamp is a pure function of an
  epoch second and the local zone, so it is gated in
  [`tests/test_pure_function_parity.py`](tests/test_pure_function_parity.py) over five
  instants chosen for what they break: single-digit month/day/hour/minute, both sides of a
  UTC date rollover, a DST transition, and a fractional second.
  **Two gates, two findings, and neither came from review.** The harness's own self-check
  refused two cells before a line of the port existed: one named a `version_verdict` that
  is only reachable when the checkout has no committed bundle, and one seeded a Windows
  path inside a JSON string, where the backslashes made `\U` an invalid escape — the
  reference then swallowed the parse error and returned the empty stub, which reads exactly
  like a working exclusion list. And the first parity run found a real port bug in
  `js/installs.mjs`: `readMaybe` was a bare `readFileSync` where `Path.read_text` opens in
  TEXT mode and folds `\r\n` to `\n`. Every caller until now read a single-line marker and
  trimmed it, so five phases never noticed; `/api/profile` is the first consumer that hands
  the whole decoded text back out, and it failed on both the text and the sha256 of it.
  Fixed at `readMaybe` rather than at the new call site — the four multi-line readers in
  `installs.mjs` and `uninstall.mjs` all mirror a Python `read_text` too, and were wrong in
  the same way.
  **And the route table became a partition, cross-checked against the source.**
  `tests/web_golden.py` compares the routes that ARE ported, one cell at a time; it is
  structurally blind to a path the reference answers and the Node daemon declares nowhere,
  which the SPA fallback would then serve as an HTML 200 where the client expects JSON. So
  `tests/test_web_server.py` reads the reference's routes out of `_web_server.py` with
  `ast`, asks the Node modules for their own, and requires ported ∪ unported to equal it —
  **split by verb**, because five paths answer both with different bodies and porting
  `/api/excludes`' GET must not take its unported POST out of the list with it.
  **Fourteen mutations, and the one that survived was about that partition.** Collapsing
  the two unported lists back into one — a single line, and the whole reason they are two —
  left both sets exactly as declared and both tests green, while POST `/api/excludes`
  began answering a plausible 404 instead of the 501 that says "unported". **A gate on a
  declaration is not a gate on the dispatcher.** The fix drives the real handler over
  `node:http`, one probe per branch of the partition, with a ported route beside them as
  the control — without which every 501 in the list is vacuous.
- **The catalog crosses, and the taxonomy it needed was already ported.**
  `/api/catalog/<section>`, `/api/item/<type>/<name>` and the wiki reader answer from
  [`js/web/api.mjs`](js/web/api.mjs), over a new
  [`js/inventory.mjs`](js/inventory.mjs) — `_harness_tui.py`'s catalog half. **Still
  fifteen subcommands; still no call site until P6h.**
  **The measurement is the finding.** `js/status.mjs` had said since P5d that "the ~111
  lines of TUI taxonomy" were P7's and not ported. `LAW_CLASS`, `SKILL_CLASS`,
  `LAW_CLASSES` and `ENTITY_STATUSES` had in fact crossed in P5g, inside `js/doctor.mjs`,
  because doctor's authoring gates are what validate them. So P6c moved the four to the
  module that mirrors where Python keeps them and had doctor import them back, rather than
  writing a second copy — a copy of a value under test stops being the value under test the
  first time one of them is edited. Only `_parse_laws`, `load_registry` and
  `entity_status` were genuinely new.
  **And `inventoryCounts` folded back into the walk it was a copy of.** P5d shipped a
  counting-only twin with a docblock warning that the two must not become two classifiers;
  `api_catalog` consumes exactly the fields the count threw away, so this was the phase
  that would have made them two. It is now three `length`s off `tuiInventory`, and the
  eleven `status` cells and the catalog cells gate the same classifier from opposite ends.
  **`decodeURIComponent` is not `urllib.parse.unquote`**, and the difference is a status
  code. The JS builtin throws a `URIError` on a `%` that is not an escape — `a%ZZfact`, a
  trailing bare `%` — which the shell would answer as a 500 where the reference answers a
  404 naming the literal text. `pyUnquote` reproduces Python's rule (a two-hex-digit table,
  and anything else is left alone), gated by a 21-input corpus that also measures the two
  runtimes' replacement of truncated UTF-8 rather than assuming it.
  **A hand-maintained manifest is JSONC, and a cell had to say so.** `wiki.jsonc` is read
  through the comment-tolerant loader on the reference; every manifest the harness seeds is
  plain JSON, so a port using `JSON.parse` would have listed no wiki pages and returned an
  empty `manifest` — both of which read as "the user has no wikis" rather than as a parse
  failure. Found by reading the reference's loader, not by a failing cell, and closed with
  the cell that would have.
  **Three security branches, three cells**, because a GET carries no token: a flat name
  containing `..`, a wiki entry whose relpath climbs out of its vault, and the router's
  bounded `split("/", 4)` — an unbounded one hands the item route the wrong name.
  **Thirteen mutations, and the two that survived were both those cells.** Each pointed at
  a path with no file behind it, so the containment check could be deleted with no effect:
  `is_file()` refused first, and a refusal and a miss produce the same 404. **A containment
  cell whose target does not exist proves nothing.** Closed by seeding files that ARE there
  and naming, in each cell, the content that must not come back.
- **The Docs pages cross for 57 of 59, and the two that do not are declared rather than
  discovered.** [`js/web/docs.mjs`](js/web/docs.mjs) answers `/api/docs` and
  `/api/docs/page/<id>` for the `markdown`, `concept` and `glossary` kinds — the harness-
  block stripping, the slug rules, the section slicing, the live-count substitution and the
  theme-aware glossary. **Still fifteen subcommands.** The measurement that scoped it is
  the entry: `cli` walks `harness.build_argparser()`, **24 subparsers and 43
  `add_argument` calls**, none of which a Node twin can introspect — reproducing it means
  transcribing the whole CLI surface into a second table that would describe verbs
  `bin/geneseed-cli.mjs` cannot run, and the real fix is to make that metadata data both
  sides read, which is packaging work. `about` shells out through `_update._origin_display`,
  which is P8's subject. Both answer 501, and the KIND partition is cross-checked against
  the kinds the reference dispatches on — the same shape the route table took, and a table
  rather than three `if`s so the gate reads what the dispatcher consults.
  **`?harness=` finally has a caller**, and it is the only input these endpoints have that
  is not the checkout — so it is the only thing a cell can vary, and every filtering rule
  is gated by sending both hosts over one page.
  **And a corpus found a divergence the port had been carrying as a footnote.** The slug
  rules are compared against the frontend's, so they have to match character for character.
  Python's `\s` on a `str` pattern is not JavaScript's, and the standing note read "differs
  only at U+FEFF". Measured: `python \s = js \s − U+FEFF + U+001C..U+001F + U+0085`. A
  heading carrying an information separator slugged differently on each side. `PY_SPACE`
  in [`js/lib/pyfs.mjs`](js/lib/pyfs.mjs) is the measured set, and no cell could have found
  it — nobody has written that heading.
  **Twelve mutations, eleven fire, six of them on the corpus rather than a cell** — which
  is what "a corpus phase" means in practice. The survivor is honest: dropping a blank
  `?harness=` is `parse_qs`'s documented default and changes nothing observable, because
  the empty string and a missing value reach the same fallback. Indistinguishable through
  its one consumer, not unreachable, and kept for the reason the POST body drain was.
- **The capability graph and the live-activity surface cross, and the spawn the plan warned
  about was never there.** [`js/web/graph.mjs`](js/web/graph.mjs) and
  [`js/web/activity.mjs`](js/web/activity.mjs) answer `/api/graph`, `/api/activity` (GET)
  and `/api/activity/<sid>` — **22 of 29 web paths, still fifteen subcommands.** The plan
  scored the pid probe as a `tasklist` spawn needing a sixth allow-list row; the source is
  `ctypes` over `OpenProcess`, so **neither implementation spawns anything** and
  `process.kill(pid, 0)` is the twin.
  **`api_graph`'s two halves read two different inventories** — nodes from the deployed set,
  edges from the SOURCE render's bodies, because deploying a skill flattens its markdown
  links to prose. A port walking one inventory for both answers a single-banded matrix on a
  deployed install, and every undeployed cell still passes; the cell that separates them
  deploys a skill whose deployed body carries no links at all.
  **A hardcoded regex can be right for one theme and empty for another**: `Rule|Law` finds
  46 law references in the neutral render's law bodies and **zero** in the imperial one,
  where the noun is "Dictate" — so the edge set is gated once per voice. Two more regex
  divergences came with it: Python's word boundary is Unicode-aware where JavaScript's is
  ASCII-only, and `re.escape` must not escape `-` (JavaScript reads `\-` outside a character
  class as an invalid escape).
  **The first web endpoint that DELETES**, which the response is completely silent about, so
  `tests/web_golden.py` grew `expect_files` / `expect_absent_files` — and the clock is
  **seeded rather than destamped**, one `now` per cell shared by both sides, because
  normalising `updated_at` would erase the live/stale rule it exists to gate.
  **`parseJson` is not optional once a third party writes the file**: activity snapshots come
  from an OpenCode plugin and carry a float, and `JSON.parse` loses Python's `1.0`.
  **Eighteen mutations, eighteen fire, no survivors** — two of them visible only in the file
  snapshot, because the response body is byte-identical with the unlink removed.
- **The web console starts WRITING, and the argv-in-a-response-body trap had a false
  premise.** [`js/web/actions.mjs`](js/web/actions.mjs) and [`js/mcp.mjs`](js/mcp.mjs) answer
  the eight mutating POSTs that own their own path plus the `/api/rules` and `/api/mcp` GETs
  that had to cross with them — **27 of 29 web paths, still fifteen subcommands.** The plan
  called `api_install_cmd`'s `{"cmd": [sys.executable, "build.py", …]}` "a Python argv, as
  DATA, in a response body" and offered two designs for it. **It is not in a response body**:
  no consumer exists in `web/src/`, and `_post_routes` hands the list straight to the job
  runner in the same process. So the "better design" bought nothing, `web/dist` did not need
  rebuilding, and the twin simply names its own runtime — gated by a corpus rather than by a
  byte gate that can never see the value. **Measure who READS a value before designing around
  its shape.**
  **A partition that shrinks needs a partition that does not.** `/api/pick-folder` opens an
  OS-native folder dialog and will never cross, so it is declared in `DECLINED_POST` rather
  than in `NOT_PORTED_POST` — folding a permanent decline into a to-do list makes the list
  wrong in the one direction nobody checks.
  **The 409 convention is a per-route column, not a rule about bodies**: five paths map
  `ok: false` to 409, `/api/activity` answers 200 regardless, and `/api/memory/delete` carries
  no `ok` at all. **`_read_json_body` finally has callers**, which is what P6a's retained
  drain was for — a body that never parsed must reach the endpoint as `{}` and be refused by
  its own validation, never as a 500 carrying a parser message the two runtimes word
  differently.
  **A cell with an upper-case filename found a live bug three phases old**: `sorted()` over
  `Path` objects is case-folded on Windows, so `MEMORY.md` files under `m`, where JS's default
  comparator puts `M` before `a` — every seeded memory file since P6b had been lower-case.
  `comparePaths` already existed; three call sites in the catalog readers were not using it.
  **Thirty mutations, thirty fire** — but two survived the first pass, and both were questions
  about the CORPUS OF INPUTS. One was closed by sending a truthy non-boolean; the other could
  not be closed by any cell, so the 409 column itself became the thing under test, read out of
  the reference by `ast` and compared against the table `doPost` dispatches on.
- **The console runs BACKGROUND JOBS, and the port's one sanctioned spawn is argued rather
  than assumed.** [`js/web/jobs.mjs`](js/web/jobs.mjs) answers the last two web paths —
  **29 of 29, still fifteen subcommands** — and it is the only module in the port allowed to
  start a copy of *this program*. **Isolation is the discriminator and it is a property of the
  RUNTIME, not of the verb**: the reference's daemon is threaded, Node's server is
  single-threaded and every ported `cmdX` is synchronous, so an in-process job would freeze the
  poll the console depends on to watch it, and a `process.exit` in any callee would kill the
  daemon instead of the job.
  **Five of the eight actions cross and three are DECLARED**, because spawning
  `python harness.py upgrade` for `update`, `link` and `unlink` would put Python back into a
  "no Python needed" install for the operations that matter most. They answer **501, not the
  404 an unknown action gets** — a real endpoint that has not crossed and a typo must not give
  the same answer — and the two sets are cross-checked against `action_commands`' own keys by
  `ast`.
  **The `$ <argv>` echo line is the first value the byte gate is asked to be tolerant of by
  CONSTRUCTION**: the reference starts `python harness.py doctor` and the twin starts
  `node bin/geneseed-cli.mjs doctor`, and that difference *is* the port. It is normalised the
  way a timestamp is destamped, and each side's argv head is then asserted absolutely — with
  the TAIL compared literally — in a corpus, because a tolerant comparison owes an absolute
  assertion on every side it is tolerant of.
  **Python's text mode is two ports, not one**: a chunked pipe read needs a decoder that holds
  a partial UTF-8 sequence across a boundary, and it needs universal-newline folding, or the
  same job's output is CRLF on one side and LF on the other.
  **A destamp that bites a prefix out of a value is worse than no destamp**: the daemon
  record's `"started": <int>` was replaced as a literal, a job's `started` is a float whose
  integer part is the same second, and the tail it left behind only appeared when the two
  clocks happened to agree. Found by the ref-vs-ref self-check, before a line of the port
  existed — along with a `Content-Length` rule that named ONE field by hand where it meant
  "any normalised value whose width differs".
  **Twenty-five mutations, twenty-three fire, two declared survivors** — one unobservable by
  construction (the env variable whose reader is P8's) and one a real race the corpus cannot
  reach, because closing it needs a job whose output is still in flight and the cheap way to
  get one writes a file whose NAME carries a clock. **A destamp that only reaches inside files
  leaves the filename as an ungateable axis.**
- **The `web` VERB crosses — sixteen of 24 subcommands — and the TEARDOWN decided which cells
  exist.** [`js/web/server.mjs`](js/web/server.mjs) grows the daemon lifecycle in one file, as
  the reference keeps it: `_probe`, `_live_daemon`, `_spawn_detached`, `start|stop|status|
  restart`, `_build_plan`'s consumer, `_npm_build`, the browser open, `cmd_web`, and the last
  POST — `/api/restart`. `bin/geneseed-cli.mjs` finally imports the web tree, which is what
  makes the CLI's spawn walk cover the job runner too.
  **Three of the verb's five shapes end with a process still running**, and
  `harness_golden.run_cell` has no `finally` for one: it leaves a `TemporaryDirectory`, whose
  `rmtree` RAISES when a surviving daemon holds the log file open — so a failed `start` cell
  would both hide its own finding and orphan a server on the developer's machine. The cell
  group therefore takes the eight actions that TERMINATE (the whole stale-record protocol,
  and the two `_build_plan` arms that refuse before a socket is bound), and the real-server
  lifecycle stays in `web_golden`, whose teardown never raises. **Read the teardown before
  deciding what a cell may do**, not after.
  **The byte gate is what licenses the MOVE, and a passing run proves nothing until a
  mutation says so.** All 95 `web_golden` cells now run through
  `node bin/geneseed-cli.mjs web` as well as through the module — and two mutations in the
  CLI's own dispatch turn the first run red while leaving the second green, which is the only
  way to show the matrix is connected to the moved code rather than to where it used to live.
  **A byte gate cannot tell two implementations from one, and it cannot tell two ENTRIES from
  one either.**
  **Putting the web tree on the CLI's graph pulled a third spawning module onto it**, through
  a frontmatter parser and a memory helper that happen to live beside the `$GENESEED_LLM`
  spawn. That is P6g's "a reachability gate over a shared graph re-asks every decision that
  graph already contains", arriving from the other side — and the row DELEGATES to the test
  that already owns that argv rather than copying its literals into a second file.
  **`/api/restart` is the one route in this port that no test may reach**: every way of asking
  it a question spawns a detached daemon — in the acceptance harness's sandbox, or in the
  developer's own environment where it would bind 4747 and serve the checkout forever. It is
  declared and read from both sources instead, and the reason is written where the route is.
  **And EOF is not an empty line.** The npm prompt accepts `""` as yes, so a reader that
  returned the empty string at end-of-file would answer YES to "run npm install now?" on
  every non-interactive run; the reference's `input()` raises there. The byte reader now
  reports that case as null, gated by a stdin-seeded corpus.
- **The install TOGGLE crosses and the web console is whole — 29 of 29 paths ANSWER, still
  sixteen subcommands.** [`js/uninstall.mjs`](js/uninstall.mjs) gains the reversible half it was
  written expecting: deactivate MOVES every owned artifact into a sibling stash and drops the
  wiring, reactivate moves the same bytes back, and the stash directory's PRESENCE is the
  disabled flag — no recorded state that could drift from the filesystem. `/api/pick-folder` is
  the one endpoint that is DECLINED rather than deferred, and `NOT_PORTED_POST` is now empty and
  still declared.
  **A deferral's measurement is a claim about another file and it rots exactly like a
  docblock.** The handoff said "293 lines over nine functions"; it is 306 over eleven, it
  counted one that had crossed three phases earlier, and it never named three others. 293 was a
  SPAN — nine bodies plus the blank lines between them.
  **`web_golden` had no `<dirs>` column, and a third of the engine lived in it.** A file
  snapshot cannot see an empty directory, so a port that moved every owned file and left
  `skills/<name>/` standing was byte-identical in all 95 cells. One pseudo-file closed it for
  the whole matrix **including every cell written before it existed** — which is what a harness
  axis can do and a per-cell expectation cannot — and it broke none of them.
  **The rollback branch is reachable, and exactly one world shape reaches it.** A deactivate is
  all-or-nothing, and the move only fails on a destination that already exists — but a
  pre-existing stash makes the install `disabled`, so the operation refuses before the loop. The
  single seedable shape is a manifest naming a file AND its parent directory. **When a defensive
  branch looks unreachable, ask what input makes the operation fail at its SECOND step**, not
  whether a cell can fail it at all.
  **One line is a security boundary rather than a translation**: pathlib's `/` REPLACES the base
  for an absolute entry, so a manifest naming `/evil.md` resolves outside the root and is
  dropped, where a `path.join` port would have folded it back inside and moved a file the
  manifest never owned.
  **And a refusal to guess is a gate that runs in production.** The settings merger will not
  default the hook shim's runner and entry, so the Claude reactivate answered with that refusal
  on its first Node run instead of quietly wiring hooks at an invented path.
- **`upgrade` crosses — seventeen of 24 — and the phase's real work was a fixture that could
  WRITE.** [`js/update.mjs`](js/update.mjs) is `rituals/_update.py`'s upgrade half: the
  preflight, the streamed fetch, the four upstream classifications, the fast-forward, the
  doctor gate with its exact rollback, and the two rebuilds. Every other verb in this port
  READS the checkout; this one rewrites it, so its cells needed a git repository they could
  fast-forward and an origin they could fetch from — a `git clone --local` off a bare
  template the harness builds once per run (2.2 s to commit 526 files, 0.8 s to clone one).
  **The spawn ban's fourth exception, and its argument is not the job runner's.** `js/web/`
  spawns for ISOLATION; this module spawns because **the code on disk changes halfway through
  the verb**. `pullAndValidate` fast-forwards and then has to ask the PULLED source whether it
  is sound, and `rebuildBundle` has to render with the PULLED generator — an in-process
  `cmdDoctor` would validate the modules this process loaded before the merge, pass, and then
  render the old source while reporting an upgrade. `js/generate.mjs`'s `cmdBuild` calls the
  driver in-process and is right to; the discriminator is whether anything changed underneath.
  **"No cell reaches the network" is enforced by git, not by the fixture.** A fixture that
  merely points `origin` somewhere safe is a claim about the fixture. `GIT_ALLOW_PROTOCOL=file`
  is in EVERY cell's environment now, so git refuses `https` before a socket opens — and one
  cell names that refusal in its `expect`, so the day the variable stops being honoured a cell
  goes vacuous instead of going online.
  **`git add -A` drops files that are TRACKED**, which is how a fixture plants a fault by
  accident. Two source files under `src/notebook/` are in the index and also matched by the
  repo's own `.gitignore`; without `--force` the fixture's commit lost them, `doctor --all`
  on the clone reported five dead links nobody planted, and the pull's SUCCESS arm would have
  been unreachable while its rollback arm looked like the verb's only behaviour.
  **A local fetch prints NOTHING**, so the streaming half — the reader, the phase filter that
  keeps a thousand `Receiving objects: 43%` repaints out of the log, the 15 s heartbeat — is
  reachable in every cell and varied in none. The filter moved to the corpus; the heartbeat
  and the hard deadline are gated by neither, and saying so is the point.
  **P6g's `GENESEED_WEB_JOB` finally has a reader, so its mutation finally fires.** The job
  runner sets it and this verb honours it by NOT bouncing the daemon mid-job; a pair of cells
  differing only in that variable is what makes deleting either end red.
  **`export_improvements`' no-drift arm is gated at last**, and it took the first phase that
  could deploy a byte-fresh install inside a cell: step one is `rebuild-all`, step two is the
  upgrade that finds nothing to say. The drift cell beside it is the positive control — same
  fixture, one edited file, the message appears.
  **Twenty-four mutations, twenty-two fire, and the two survivors are ONE finding.** The
  credential in a tokened remote passes two independent scrubbers on one path — `_git` redacts
  its stdout, and `_parse_origin` then rebuilds the display url from host and path — so either
  alone suffices and neither is observable by itself. Removing BOTH turns the cell red, which
  is what says it is connected; each is separately corpus-gated. **A cell aimed at a defence in
  depth gates the conjunction, not the layers**, and the cell's comment now says so instead of
  naming the wrong one.
  **And P5e's `CREATE_NO_WINDOW` fix had one call site left.** `_update` keeps its own copy of
  the flag (it stays importable standalone so a stale factory can self-heal) and so kept its
  own copy of the bug: every `[rebuild-all]` line an upgrade printed on Windows was discarded,
  including the FAILED rows its error message tells you to look for. Found by a cell's
  ABSOLUTE half naming a line the reference was not printing.
- **`sync-self` and `bootstrap` cross — nineteen of 24 — and the two shell wrappers are
  deleted.** `sync_self` is nine lines and calls `upgrade()`, so its cells gate the DISPATCH
  rather than new behaviour — and "an alias" turns out to be two properties, not one: the row
  points at `cmdSyncSelf` and not at `cmdUpgrade` because `sync-self cyberpunk` must NOT
  rebuild in cyberpunk the way `upgrade cyberpunk` does. `cmd_bootstrap` was the phase's real
  work and the plan never measured it: 30 lines over a fork, ~143 reachable and ~141 not.
  The curses progress screen is P7's, declared on exactly the terms P5i declared `cmd_setup`'s;
  `_harness_supports` and `_stale_factory_hint` are declared for a second reason — they detect
  argparse's `invalid choice` from a PARTIALLY updated install, and the Node step is a function
  this binary statically imported.
  **The step is an IMPORT, not a spawn, and this module is where that had to be argued twice.**
  P8a's rows spawn because the code on disk changes halfway through the verb; nothing has
  changed when the update step STARTS, so `cmdUpgrade()` in-process is the same program and the
  reference's own spawn is an artifact of a progress UI needing a pipe. The ARGV is still built,
  because the install log promises the user a command they can re-run — and that line cannot be
  byte-equal across runtimes, so it is normalised (the P6g `$ <argv>` shape, now in a FILE) with
  the absolute per-side assertion beside it.
  **The deletion needed a gate of its own.** `upgrade.sh` and `sync-self.sh` were an interpreter
  probe and `exec "$PY" rituals/harness.py <sub>`; no launcher invoked either, and all three
  probe `harness.py <cmd> --help` and fall back to `python rituals/_update.py <cmd>` — a stable
  contract that never went through a wrapper. Twelve tracked files still NAMED them, `bootstrap`'s
  own header comment among them, so the gate scans every tracked text file: the next stale
  pointer fails a test instead of a user.
  **Three defects, all found by a cell's absolute half.** `cmd_bootstrap` re-exec'd
  `python rituals/_harness_lifecycle.py setup` — `__file__` rather than `harness.py` — and that
  module has no `__main__` block, so `geneseed bootstrap` UPDATED AND THEN SKIPPED THE WIZARD,
  reporting success, on the front door's own default path. The Node step called `upgrade()`
  where the reference's step is the SUBCOMMAND, and `cmd_upgrade` is where the pre-update
  improvements export lives. And the first `nargs="*"` in the verb table swallowed unknown
  OPTIONS, so `geneseed bootstrap --no-setpu` would have run a full bootstrap instead of
  refusing — the most dangerous parse bug this entry point could have had.
- **P8c pays two partition debts, and a payment needs a gate DIRECTION.** `update` leaves
  `NOT_PORTED_ACTIONS` and the docs `about` kind leaves `NOT_PORTED_KINDS` — one line each,
  which is what P6g and P6d built the partitions for. What is not one line is the observation:
  a removal seen only as the ABSENCE of a 501 is satisfied by a 404, so the dispatcher probe
  that asserted 501 now asserts the success shape for both.
  **The probe that asks for `update` can never START one.** It runs against the developer's own
  checkout, where a clean tree with an upstream would make the preflight say "ready" — so the
  probe points `GIT_DIR` at a path that does not exist, every git call in the preflight fails,
  and 422 is the only reachable answer. That is also the arm the endpoint is really about: a
  local-only gate ahead of the job, so a dirty tree gets an explanation instead of a spawn that
  fails. `unportedAction` moves to `link`, which is still declared, so the partition question
  keeps being asked by something that can still answer it.
  **`aliases=["update"]` was believed coupled to that and is not.** The action's argv names
  `upgrade`, the VERB, on both sides and always did. The alias is a separate parity fact, and it
  lands as a ROW in the verb table rather than as an `aliases` field, because the three matrix
  gates read that table as the DISPATCH — so `harness_py_subcommands()` now reads argparse's
  aliases out of the reference and an `update/` cell group proves the row reaches `cmdUpgrade`,
  the dead `ref` positional's re-read included.
  **And the `about` page's defect is this port's recurring shape.** `OriginDisplay`'s JS twin
  spells the field `githubSlug`; the wire format spells it `repo_is_github`. Reading the wire
  name off the record gives `undefined` — a perfectly plausible `false` that silently drops
  every github deep link on the page and changes nothing else.
- **`link` and `unlink` cross — 21 of 24 — and the two defects only an INSTALL could see are
  fixed in the RENDERER.** `npm install` renames every `.gitignore` to `.npmignore` on
  extraction, and `npm pack` honours nested ignore files: so an npm-installed Geneseed emitted
  bundles with no `memory/.gitignore` and no `notebook/.gitignore` (the agent's private stores,
  committable in the user's repo, silently) and no `notebook/README.md` (loudly — 84 doctor
  problems). The manifest, the pack report and the tarball were all clean; **only the extracted
  tree disagreed.** The fix is four lines: the two source files are stored as `gitignore` and
  `dest_rel` puts the dot back, beside the `AGENT.md.tmpl` rule that was already there — so the
  emitted bytes are IDENTICAL and 259 golden cells stayed green across a change to the
  renderer. The recommended alternative (assert them from constants) would have moved the file
  COUNT in every cell; measuring is what said so. **The second call site is the one a review
  misses**: `_global_memory`/`_global_notebook` seed from the SOURCE path, not the rendered
  one, so a fix in `dest_rel` alone is right for `--emit files` and wrong for every global
  emit. `private` came off, gated by a test that runs the INSTALLED generator and diffs its
  bundle against the checkout's.
  **The verbs ship because of the WEB CONSOLE, not the CLI.** npm's own bin linking already
  puts `geneseed` on PATH, so under npm these two are near-vestigial — but the Settings page
  POSTs them in both implementations, and emptying `NOT_PORTED_ACTIONS` meant either porting
  the verbs or deleting two buttons and rebuilding the tracked `web/dist`. Deleting takes a
  working feature from checkout users, for whom `link` is the only thing that puts `geneseed`
  on PATH at all.
  **The shim is P5b's divergence again — Node bakes node** — normalised by a fifth `_STAMPS`
  entry with the debt paid absolutely per runtime; and the reference's `Path.write_text` turns
  its own `\r\n` into `\r\r\n`, which the port reproduces because `writeText` already carries
  that rule.
  **`_win_user_path` edits the registry, so the CODE was shaped to be gateable rather than the
  fixture stretched.** The PowerShell script builder is split out and compared over a corpus
  (apostrophes, UNC roots, a `;` inside the path); the cells reach both branches by handing the
  verb a `PATH` that is the sandbox bin dir and nothing else — `link` short-circuits, `unlink`
  finds no `powershell`. The SUCCESS arm stays ungated in both implementations, and says so.
  **Emptying the set cost a probe.** With no unported action left, `test_web_server.py`'s
  running 501 probe had no target and none could be borrowed — every remaining action starts a
  job or edits the real PATH — so the claim fell back to an `ast` check on the declaration,
  which is strictly weaker. Named rather than quietly dropped.
- **The parser becomes DATA, and `migrate` becomes the 25th subcommand.** The Docs `cli`
  page walked `harness.build_argparser()`, which is the largest copy-of-a-value-under-test in
  the project and unreadable from Node. It is now `cli.json` at the repo root — `source_sha256`
  + 25 subparsers, generated by `tests/gen_cli_reference.py` and **gated by `doctor` on both
  binaries** against the sha256 of `rituals/harness.py`. `bin/geneseed-cli.mjs`'s `VERBS` is
  `{ fn }` per row now; 154 lines of hand-written argparse metadata are gone. The cost is
  named: the Node CLI cannot parse a single verb without the file, so **`rituals/harness.py`
  and `cli.json` must be changed together** — a mismatch is a doctor problem on both runtimes,
  which is the desired failure and not an accident.
  **`geneseed migrate` then found the premise the whole spec rested on to be wrong twice.**
  There is no `current` directory in this project and never was (npm replaces its own install
  in place, so there is no pointer to flip), and **no code in this repository has ever written
  an autostart entry** — so `migrate` detects and REPORTS a stale login item, prints the
  replacement command, and touches nothing. What it does do: survey every registered install,
  refuse rather than guess on an unrecognised emit marker, stash every settings file it will
  touch and roll the whole run back on any failure, and re-emit each root in its own theme,
  emit, footprint, posture and mode. **The shape lives in the shim BODY, not in the settings
  file** — shapes 2 and 3 are byte-identical in the host config, so a classifier reading only
  the config would call an unmigrated machine "already migrated", silently and forever.
- **P10e — the docs, and the counts that had moved under them.** Every phase of this port
  changed a number some sentence had written down. The reconciliation is measured, not
  transcribed, and it splits three ways: **derived** where a mechanism already existed
  (`_doc_counts`' live substitution into the web Docs pages; the `howto` pages that SLICE
  `SETUP.md` by anchor, so one edit reaches the console); **gated** where the sentence has to
  stay prose
  (`doctor`'s `_prose_mirror_problems` grew the plugin count — the README said six while
  seven shipped, and the project's only derived plugin count reads a DEPLOYED directory a
  markdown file never has); and **derived-in-the-gate** for the claims `src/` cannot answer,
  in the new `tests/test_docs_claims.py`: which subcommands have no Node twin, what Python a
  bundle carries, and `N of the M subcommands`. DESIGN.md and CHANGELOG.md are deliberately
  outside that gate — they are dated logs, and rewriting a log to agree with today is how it
  stops being one.
  **The publish workflow is the one thing in this port that cannot be rehearsed.**
  `.github/workflows/publish.yml` uses npm trusted publishing (OIDC): no `NPM_TOKEN`, manual
  `workflow_dispatch` only, and the trusted publisher on the npm side is keyed on the workflow
  FILENAME — so a rename breaks publishing while the workflow still runs and still mints a
  token. The file names its own filename in the instructions it carries, and the gate asserts
  the two agree, because that self-reference is the only local symptom that exists.
- **P7a — `menu` and `home`, and the shim the test suite had been rewriting.** Twenty-four of
  the twenty-five subcommands now run from Node. Both of these are DISPATCHERS, not screens:
  `cmd_menu` prints a five-line command list off a TTY and hands a terminal to
  `curses.wrapper(_main_menu)`, and `cmd_home` picks between the web console — already ported
  — and `cmd_menu`. **On a terminal the Node entry FALLS BACK rather than inventing a second
  menu**: the reference already has that arm (`import curses` fails on stock Windows Python,
  and it prints the same list), so the port inherits an answer instead of writing a third user
  interface that no cell could reach and P7b would delete.
  **The corpus fakes the TTY**, because every cell's stdin is a pipe and `_web_first_ok`'s
  four refusals past `isatty()` are executed and never varied — the branch is reachable and
  the input is not, which is a different kind of hole from an unreachable branch.
  Separately, and not a port matter at all: six test modules emitted with no `HOME` override
  and had been rewriting the developer's machine-wide hook shim on every suite run. It left no
  trace because `_write_hook_shim` skips an unchanged body, so nothing — not even an mtime —
  moved. `golden.sandbox_process_home()` and `tests/test_home_sandbox.py` close it, and the
  gate's first finding was a `setUpModule` shadowed by a second one further down the file.
- **P7b — the panel runs on this machine after all, and the layout half crosses with it.**
  `tui` was the twenty-fifth and last subcommand, so **every command now runs from Node**.
  The phase opened by disproving its own brief: a bare `import curses` fails on stock Windows
  Python, but `rituals/_harness_core.py` catches that and installs `rituals/_winterm.py` under
  the name `curses` — **the shim is not a layer beside curses, on Windows it IS curses**. So
  the reference's panel opens here, `_winterm._Window` takes a stream and a pinned geometry
  and reads keys through an instance attribute, and the panel can be driven in-process. That
  made `windows-curses` the wrong answer rather than an unavailable one: installing it would
  swap PDCurses in for the 353 lines of hand-rolled VT code Geneseed actually ships to Windows,
  hiding exactly the "hard-won console behaviour" the phase was told to be careful of.
  **What crosses is the alignment contract** — display width, width-aware truncation and
  padding, the three glyph tiers, the scroll clamp, the eighths progress bar, the theme reads,
  and the inventory's two consumers. `_dwidth` is the one function with no equivalent at any
  rung: JavaScript has neither `east_asian_width` nor `combining`, `\p{Mn}|\p{Me}` disagrees
  with `combining(ch) != 0` on 897 codepoints, and no dependency may be added — so the port
  carries its own range tables and **the gate over them is the whole input space rather than a
  case list**: both sides walk every codepoint from U+0000 to U+2FFFF, run-length encode the
  widths and compare, against the live `unicodedata` rather than a copy of it.
  **The panel itself is declared, and the declaration is asserted from both directions**: the
  reference is shown drawing one, and the port is shown emitting no alt-screen escape, no
  cursor hide and no section header — plus a structural check that there is nothing in
  `js/tui.mjs` that *could* draw one. A declaration that only says "we did not" is a claim
  about one run; this says there is no screen to reach.
  The phase's own worst defect was a fixture, not a port: a scripted key list feeding a
  BLOCKING reader deadlocked the suite the moment it ran dry — and it did not hang when the
  module ran alone, because the `setUpClass` that suppressed the splash set an environment
  variable the target module had already read at import. **A fixture whose effect depends on
  import order passes in isolation and hangs in the suite.**

## 🚫 Explicitly out of scope

Graph/index generation, web-clipping pipelines, session-classification capture,
sync-conflict cleanup, and folder-ownership delegation — all assumed a specific
vault and lifecycle hooks. They are not ported. The `learn` CLI is the one
distilled survivor of the original learning loop, made model-CLI-agnostic.
