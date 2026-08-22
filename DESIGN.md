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
     *layout*, the harness name (`HARNESS`), the law *numbers*, the four ontology section
     names (`ONT_TELOS`, `ONT_EVIDENCE`, `ONT_DECISIONS`, `ONT_CONDUCT`), a few rare
     technical nouns (`Context`, `Scripts`, `Charter`), and the folder names (`laws/`,
     `ontology/`, `doctrines/`, `agents/`, `skills/`, `memory/`, `notebook/` via `DIR_*`).
     These live in the `STRUCTURE` map in `js/build/render.mjs` and are laid on top of every
     render, so a theme can never move a path, a link, or a heading number. No theme file
     defines a `DIR_*` or an `ONT_*` key, and none may: an ontology citation spells the
     section on both sides (`{{ONTOLOGY}}: {{ONT_TELOS}}`), so heading and reference move
     together or not at all. Tooling stays stable.
   - **Voice + vocabulary** (themed) — how the AI *responds* (`VOICE`), a top `BANNER`,
     and the prose words the docs use: the core nouns `LAW(S)`/`DOCTRINE(S)`/`ONTOLOGY`/
     `AGENT(S)`/`SKILL(S)`/`MEMORY`/`NOTEBOOK`/`VAULT`/`WIKI`, plus `TAGLINE`,
     `LOADED_SIGIL`, `EPI_*`, `BENEDICTION`, `DESC_*`, `ROAST_PERSONA`, the invariant
     titles `LEX_I`..`LEX_IX`, the 23 doctrine-rule titles `DOC_<PACK>_<n>`, the four pack
     names `PACK_CRAFT`/`PACK_RIGOR`/`PACK_OPS`/`PACK_PROCESS`, and the section intros
     `INTRO_*`. Each theme defines its own nouns; **neutral keeps the plain words** (Rule,
     Doctrine, Agent, Skill, Memory, Workspace), so neutral output is unchanged.
     `{{LAW}}` and `{{DOCTRINE}}` must each be a **single word** — both heading parsers
     match the tier noun with `\S+`, so a two-word value makes the whole tier parse to
     nothing in silence. `constitutionProblems` refuses one.

   So `imperial` flavours the agent's tone *and* the page — the banner, the readiness
   sigil, the epigraphs, and the words themselves (the invariants read as *Dictates*,
   doctrine rules as *Doctrinae*, agents as *Adepts*) — while every folder is still
   `agents/`/`skills/`, an invariant is still numbered `IV` and a doctrine rule is still
   addressed `process 5`, and links resolve identically across themes. The source
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

7. **Lean governance — three tiers, and every line must change behaviour.** The
   constitution, the agent specs, and the skills are the product, and a bloated
   instruction surface is ignored at runtime, not obeyed: an over-long rule set dilutes
   the rules that matter. The governance surface is split into three tiers, each answering
   a different question:

   - **Ontology** (`src/ontology/universal.md`) — *who is deciding*. Four sections of
     flowing prose: **Telos** (what the agent is for, and the Pact it works under),
     **Evidence** (how a claim is graded by how it was obtained), **Decisions** (classify
     and tier by reversibility; show the real forks), **Conduct** (answer what was asked,
     once). It absorbed the Pact, which is now stated *inside* Telos rather than standing
     as a peer of the rules.
   - **Invariants** (`src/laws/universal.md`) — *what is never traded*. Nine numbered
     Rules, `I`..`IX`, headed `### {{LAW}} <roman> — {{LEX_<roman>}}`.
   - **Doctrines** (`src/doctrines/{craft,rigor,ops,process}.md`) — *how work is done
     here*. Practice rules addressed by pack and number, cited as `Doctrine process 5`.
     `PACK_ORDER` (`js/build/source.mjs`) fixes the order craft → rigor → ops → process, which
     is narrative and deliberately not alphabetical.

   **The Ontology and the Invariants are never toggleable** — every build carries both,
   whole. The Doctrine tier is the only one a repository may narrow, and it narrows on
   **two axes**, both chosen once at build time and both defaulting to everything on:
   `--doctrines craft,rigor` (or `none`, or the wizard) selects PACKS, and
   `--exclude-rules "process 7"` drops individual RULES from the packs that survive. They
   compose in one direction only — a pack whose every rule is excluded leaves the active
   set, so no pack header is ever rendered empty. There is no runtime toggle for either.
   Every pack file ships on disk at both footprints whether or not it was built in, which
   is what lets a citation into an inactive pack still resolve.

   Each axis leaves its own marker line in the carrier for later readers (`upgrade`,
   `rebuild-all`, the console) to parse back: `Active packs:` always, and
   `Excluded rules:` **only when something is excluded**. That asymmetry is deliberate and
   load-bearing — the second line's absence is a complete answer ("nothing"), so a default
   build is byte-identical to one from before the axis existed and no recording had to be
   re-blessed; `excludedRulesOfDir` accordingly reads a missing line as `[]` where
   `doctrinesOfDir` must read one as `null`.

   **Conflict order, exactly:** Ontology + Invariants → the user's own `user-rules.md` →
   the active Doctrines → `PROFILE.md`. A doctrine rule may *tighten* an invariant, never
   repeal one; a user rule outranks a doctrine rule outright; nothing outranks an
   invariant. And an always-on tier may never cite a toggleable one — a `--doctrines craft`
   build would otherwise ship an invariant pointing at text its `AGENT.md` does not
   contain — so `constitutionProblems` (`js/inspect/checks-authoring.mjs`) refuses a `{{DOCTRINE}}` token
   anywhere under `src/ontology/` or `src/laws/`.

   The bar for a **new invariant** is the highest in the tree: universal (it binds *every*
   task, in *every* repository), agent-behavioural (something the model does, not infra it
   cannot instantiate), and not already covered. A principle that is app-code craft,
   host-specific infrastructure, or single-domain now has a home one tier down — a doctrine
   pack — or in an agent, a skill, or `context.json`. A rule that overlaps an existing
   invariant is folded in as a clause, not minted as a new number. This is the
   authoring-time counterpart to Doctrine `process 3`'s runtime context economy.

   **The satellites differ per tier, and that difference is the design** — a doctrine rule
   is cheap on purpose, so the expensive slot stays scarce:

   | Satellite | A new invariant | A new doctrine rule | A whole new pack |
   |---|---|---|---|
   | body | append to `src/laws/universal.md` — never insert; nothing resolves a cross-reference against the canon | append to `src/doctrines/<pack>.md`, `### {{DOCTRINE}} <pack> <n> — {{DOC_<PACK>_<n>}}`; ids must run contiguously from 1 | a new `src/doctrines/<pack>.md` with its `**Name** — lead line` |
   | themed title | `LEX_<roman>` in all 15 theme files | `DOC_<PACK>_<n>` in all 15 theme files | `PACK_<NAME>` in all 15, plus each rule's `DOC_*` |
   | class | `LAW_CLASS` in `js/inspect/inventory.mjs`, one of the six in `LAW_CLASSES` | **none** — a doctrine rule's class *is* its pack, and there is no second taxonomy over it | — |
   | console copy | a `LAW_META` row in `web/src/pages/Laws.jsx` (keyed by arabic number) | a `DOCTRINE_META` row in the same file (keyed `<pack>.<n>`) | one `DOCTRINE_META` row per rule |
   | registration | the numeral is the registration | the number is the registration | the pack name in `PACK_ORDER`, `js/build/source.mjs` |
   | renumber risk | high — appending is the only safe move | none — packs are numbered independently | none |
   | counts | README badge + the `N universal laws` prose, `SHIPPED.md`'s triple, the web onboarding copy | **none** — the console spends the `N_PACKS` / `N_PACKS_ACTIVE` / `N_DOCTRINE_RULES` count tokens, all computed at request time | none, same reason |
   | changelog | `CHANGELOG.md` | `CHANGELOG.md` | `CHANGELOG.md` |

   "All 15 theme files" is the 14 voices **and** `themes/_TEMPLATE.json`: theme parity
   skips underscore-prefixed names, but `constitutionProblems` reads the template too,
   because it is what `geneseed-build --sync-themes` seeds a new voice from. That flag is
   the *generator's*, not the CLI's — `geneseed build --sync-themes` is an error, not a
   synonym. `--sync-themes` writes the template's placeholder and only *prints* which keys
   to restyle; a shipped placeholder passes every gate.

   Almost all of it is gated, across six named checks in `js/inspect/checks-build.mjs` —
   `themeParityProblems` (key parity across the voices), `lawMetaProblems` and
   `doctrineMetaProblems` (the console's Principle column, in both directions),
   `constitutionProblems` (pack numbering and filing, `LEX_I..LEX_IX` as an *equality*, the
   `DOC_*` vocabulary, and every `{{DOCTRINE}}` citation in `src/`), and
   `countTableProblems` / `proseMirrorProblems` (badges and prose). So `geneseed doctor
   --all` is the check; the table above only says what it will ask for. `CHANGELOG.md` has
   no gate and never has.

   Two things the table cannot tell you, and `docs/extending.md` can: the default footprint
   is **lean**, which keeps an invariant's or a doctrine rule's heading and its *first
   sentence* only — so an amendment written into the second paragraph does not exist for
   most installs — and `LEX_I` is one of seven theme keys frozen byte-for-byte in a
   recording nothing can re-make, so Rule I's themed titles are the one part of this list
   that cannot be edited. The Ontology is exempt from the truncation: it ships whole at
   both footprints, because four flowing sections cut to their first sentences would read
   as four orphan sentences.

## 🧩 Components

Every folder name in the `Harness/` output column is theme-independent (Decision 3): no
theme file defines a `DIR_*` key, so `laws/` is `laws/` in all fourteen voices.

| Component | Source | `Harness/` output | Purpose |
| --- | --- | --- | --- |
| Entrypoint | `src/AGENT.md.tmpl` | `AGENT.md` | what the tool reads; inlines the constitution, links the rest |
| Ontology | `src/ontology/` | `ontology/` | the mind the rules govern — Telos, Evidence, Decisions, Conduct; always on, never toggleable |
| Governance | `src/laws/` | `laws/` | the nine universal invariants; always on, never toggleable |
| Doctrines | `src/doctrines/` | `doctrines/` | the four practice packs — the one build-time axis that changes *which rules ship*; the whole catalogue is written to disk either way |
| Delegation | `src/agents/` | `agents/` | capability specialists with output contracts |
| Workflows | `src/skills/` | `skills/` | repeatable procedures |
| Memory | `src/memory/` | `memory/` | one-fact-per-file convention + index |
| Notebook | `src/notebook/` | `notebook/` | the agent's sovereign space — any medium, seed-once charter the agent may rewrite; only `.gitignore` re-asserted |
| Posture | `src/postures/` | inlined into `AGENT.md` | how much ceremony the agent brings to a task |
| Mode | `src/modes/` | inlined into `AGENT.md` | the working axis (solo, foreman, …) — orthogonal to posture |
| Context | `js/emit.mjs` | `context.json` | empty per-repo manifest, written once and never overwritten; git-ignore it |
| Themes | `themes/*.json` | — | token → label maps; `themes/opencode/` is a separate colour system |
| Release label | `harness.config.json` | `.geneseed-version` | the theme and the human-readable version the driver reads; the canonical identity is the source fingerprint, not this string |
| Lifecycle | `registry.json` | — | maintainer-side status/version/owner per agent and skill; never rendered into a bundle |
| Generator | `bin/build-driver.mjs` (`geneseed-build`) | — | substitution + `<!-- INCLUDE: -->` inlining, and the nine `--emit` targets |
| CLI, as data | `js/cli-table.json` | — | the owned document the entry point parses its own argv from |
| Automation | `bin/geneseed-cli.mjs` (`geneseed`) | — | 25 verbs — `build` / `doctor` / `status` / `prompt` / `diff` / `setup` / `web` / `upgrade` / … |
| Hooks | `bin/geneseed-hook.mjs` (`geneseed-hook`) | — | the four verbs an emitted `settings.json` invokes: `context` / `git-gate` / `rule-gate` / `learn` |
| Adapters | `adapters/` | — | optional per-tool glue (hooks, OpenCode plugins) |

## ⚙️ Generator contract

- Substitutes `{{TOKEN}}` in file *contents* only; paths are never themed.
- Resolves `<!-- INCLUDE: relpath -->` by inlining the rendered target.
- Unknown tokens are left visible (debugging aid); `doctor` flags them.
- Node built-ins only; no third-party dependencies, ever. (`package.json` carries neither a
  `dependencies` nor a `devDependencies` key, and a test asserts it.)
- **`js/hosts/settings.mjs` is the half of the emit that edits files you co-own** — the
  `settings.json` / `opencode.json` merges, JSONC parsing, the hook shim and the managed
  CLAUDE.md block. It is a separate module because every function in it reconciles
  Geneseed's claim with content Geneseed did not write, and because eleven of its names are
  driven by the *runtime* as well as by an emit (`js/hosts/mcp.mjs` uses ten of them
  for deactivate, remerge, reactivate and uninstall; `exclude` and `doctor` use the rest).
  Its dependency closure points one way only: nothing in it calls into `js/build/render.mjs` or
  `js/emit.mjs`. Keep it that way — that closure is what makes it a unit.
- **Every emit runs five stages in one order: `RENDER* → WIRE* → PRUNE → MANIFEST →
  VERIFY`.** RENDER writes files Geneseed owns wholesale; WIRE is `js/hosts/settings.mjs`
  reconciling files you co-own; PRUNE removes what the previous manifest owned and this
  emit no longer produces; MANIFEST records both; VERIFY re-reads the merge to confirm it
  stuck. WIRE must precede MANIFEST because wiring is what fills the `managed` record the
  manifest stores, and no RENDER may follow a WIRE because a render writes wholesale a file
  a wire has just reconciled. `tests/unit/emit_phase_order.test.mjs` fails the build if any of
  the nine emits drifts out of that order, or if a new file-mutating routine in
  `js/hosts/settings.mjs` is called from an emit without being classified. RENDER and WIRE now run
  in the *same process* — the seam that once spawned a second runtime per emit is gone — so
  the render and wire dispatchers stay two separate functions and two separate statements on
  purpose: that shape is the only thing left for the walker to check, and a gate refuses an
  emit whose sequence has lost its WIRE.
  `bin/build-driver.mjs`'s `main()` is classified too, as the one stage no per-emit gate can see: it
  writes the `.geneseed-emit` / `-footprint` / `-theme` markers and the install-registry
  record *after* every emit returns, and nothing that reconciles a file you co-own may run
  there, because there is no manifest to record the claim and no teardown able to undo it.
---

## 📜 How this got built

The phase-by-phase record of the Node port — the seams, the parity gates, the defects each one
caught, and the reasoning behind every deliberate divergence — lives in
[docs/design-history.md](docs/design-history.md). It is history: it describes a period when
this project had two implementations and every byte either one wrote was compared. Read it to
understand *why* a seam is where it is; read the contract above to know *what* it is today.

See also [docs/extending.md](docs/extending.md) — what one addition costs, and which gate says
so — and [docs/limits.md](docs/limits.md) — what this tool does not prove about itself.
## 🚫 Explicitly out of scope

Graph/index generation, web-clipping pipelines, session-classification capture,
sync-conflict cleanup, and folder-ownership delegation — all assumed a specific
vault and lifecycle hooks. They are not ported. The `learn` CLI is the one
distilled survivor of the original learning loop, made model-CLI-agnostic.
