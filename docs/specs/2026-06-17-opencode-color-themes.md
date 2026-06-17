# Spec — Curated OpenCode color themes (transparent + solid)

**Status:** design confirmed → building.
**Date:** 2026-06-17

**Decisions (2026-06-17):** flavours named `-solid` / `-transparent`; ship all 8
themes from §5; **dark-only** for v1 (no `{dark,light}`); colour themes fully
**decoupled** from voice themes; source format plain `.json`, one file per theme
under `themes/opencode/`; the legacy accent-tint emit stays as fallback.

---

## 1. Problem

Geneseed already writes a branded OpenCode theme on emit (`_theme_json`,
[_build_emit.py:50](../../_build_emit.py)). But that theme is **cosmetically thin**:

- It fills every slot from a single `ACCENT` token mapped to one ANSI colour (0–7).
- Every background slot is `"none"` (transparent only).
- So `geneseed-cyberpunk` and `geneseed-military` differ by *one* accent hue and
  otherwise look identical — terminal-safe, hermetic, but not "modern".

What we want to ship instead: a small set of **genuinely good-looking, distinct**
colour themes, each available in a **transparent** flavour (terminal background shows
through) and a **solid** flavour (opaque panel background), so users on a translucent
terminal *and* users who want a contained UI both get something polished.

This is a **separate concern from voice themes.** A voice theme (`imperial`,
`cyberpunk`) controls how the agent *speaks*; a colour theme controls how the TUI
*looks*. They should not be coupled — a user running the `neutral` voice may still
want the `tokyonight` colours. (Keeping the old accent-tint emit as a fallback is fine;
see §7.)

## 2. How OpenCode themes actually work

OpenCode reads theme JSON from (later overrides earlier):

1. built-in themes,
2. `~/.config/opencode/themes/*.json` (global),
3. `.opencode/themes/*.json` (project).

Selected at runtime with `/theme <name>`; the **filename stem is the theme name**.

Schema: `{"$schema": "https://opencode.ai/theme.json", "defs"?: {...}, "theme": {...}}`.

A **slot value** can be any of:

| Form | Meaning |
| --- | --- |
| `"#1e1e2e"` | hex colour |
| `0`–`15` | ANSI palette index (terminal-rendered, theme-portable) |
| `"none"` | **terminal default** — i.e. transparent for backgrounds |
| `"defName"` | reference into the `defs` block |
| `{"dark": x, "light": y}` | resolves by the terminal's background mode |

**`defs` is the key best-practice lever:** define the palette *once* as named colours,
then reference them from slots. Change the palette in one place, every slot follows.

The full slot set (what we must fill) — taken from the current emit:

```
primary secondary accent  error warning success info  text textMuted
background backgroundPanel backgroundElement  border borderActive borderSubtle
diffAdded diffRemoved diffContext diffHunkHeader diffHighlightAdded diffHighlightRemoved
diffAddedBg diffRemovedBg diffContextBg diffLineNumber diffAddedLineNumberBg diffRemovedLineNumberBg
markdownText markdownHeading markdownLink markdownLinkText markdownCode markdownBlockQuote
markdownEmph markdownStrong markdownHorizontalRule markdownListItem markdownListEnumeration
markdownImage markdownImageText markdownCodeBlock
syntaxComment syntaxKeyword syntaxFunction syntaxVariable syntaxString syntaxNumber
syntaxType syntaxOperator syntaxPunctuation
```

## 3. The transparent ↔ solid distinction is *only* the background slots

This is the whole trick. Transparent vs solid differs in **exactly these slots**:

```
background  backgroundPanel  backgroundElement
diffAddedBg diffRemovedBg diffContextBg
diffAddedLineNumberBg diffRemovedLineNumberBg
markdownCodeBlock
```

- **Transparent flavour:** background slots → `"none"`, *except* the diff/code-block
  highlight backgrounds, which should stay a subtle tinted hex so added/removed lines
  are still legible against the terminal — going fully `none` there makes diffs unreadable.
- **Solid flavour:** background slots → the palette's `bg` / `bgPanel` / `bgElement` hex.

So we **do not author two palettes per theme.** We author one palette and a single
background-mode switch produces both. (Ponytail: no palette duplication, no
hand-maintained `-glass` twins drifting out of sync.)

## 4. Authoring best practices (per theme)

1. **One `defs` palette, referenced everywhere.** ~12 named colours is enough:
   `bg bgPanel bgElement fg fgMuted accent secondary border ok warn err` + a couple of
   syntax hues. Never inline a raw hex in a slot.
2. **Contrast first.** Target WCAG-ish legibility: `fg` on `bg` ≥ ~7:1, `fgMuted`
   ≥ ~4.5:1, accent on bg ≥ ~3:1. A theme that looks moody but can't be read fails.
3. **Borrow proven palettes, don't invent hues.** The well-loved community palettes
   (below) are already contrast-tuned across thousands of users. Inventing a palette
   from scratch almost always lands muddy. Credit upstream in a `// note`/README.
4. **Dark and light where it's cheap.** Use `{dark, light}` on `bg`/`fg`/`border` so one
   theme serves both terminal modes; skip it for themes that only make sense dark
   (neon/cyberpunk).
5. **Semantics stay semantic.** `error`→red-family, `warning`→amber, `success`→green —
   even in a stylised theme. Don't make "error" purple because it matches the brand;
   users read state from these.
6. **Diff legibility is non-negotiable.** Added/removed line backgrounds must be
   distinguishable from each other *and* from context in both flavours.
7. **Validate every theme renders** (no missing slots, valid values) — extend `doctor`
   (§6) so a broken colour theme fails CI like a broken voice theme does.

## 5. Proposed shipped set (curated, not exhaustive)

Lazy principle: ship a **small, opinionated set** people actually pick, not 30 themes
that bloat the picker. Proposed starting eight — popular, contrast-proven, visually
distinct from each other:

| Theme | Identity | Mode |
| --- | --- | --- |
| `catppuccin` | soft pastel, the current TUI darling | dark (Mocha) + light (Latte) |
| `tokyonight` | deep indigo / neon — modern default | dark |
| `rosepine` | muted rose / pine, elegant low-contrast | dark + light (Dawn) |
| `gruvbox` | warm retro, high comfort | dark + light |
| `nord` | cool arctic, calm | dark |
| `everforest` | soft sage green, easy on eyes | dark + light |
| `kanagawa` | Japanese ink-wash, warm muted | dark |
| `dracula` | classic vivid purple/green | dark |

Each ships in **both** flavours via the §3 switch, so the picker shows e.g.
`geneseed-tokyonight` and `geneseed-tokyonight-glass` (naming TBD — see open questions).

Optionally, map the existing **voice themes** to matching colour palettes so
`--theme cyberpunk` *can* also suggest a neon colour theme — but keep them selectable
independently. (Stretch, not v1.)

## 6. Build / emit plan (sketch)

Keep it small and hermetic — stdlib only, no palette duplication.

- **New source:** `themes/opencode/<name>.json5` (or `.json`) — palette + slot map
  authored once, backgrounds expressed with a sentinel (e.g. `bg`/`bgPanel`/`bgElement`
  def names) so the emitter knows which slots to flip.
- **New emit step** (extends `_write_theme`): for each source palette, write two files
  to the themes dir — solid (`geneseed-<name>.json`) and transparent
  (`geneseed-<name>-glass.json`), differing only in the §3 background slots.
- **doctor:** validate each colour theme — all slots present, every value is hex / ANSI
  int / `none` / known def, and a rough contrast check on `fg`-vs-`bg`. Fail like the
  voice-theme parity gate does.
- **Web gallery:** the existing theme gallery should preview colour themes too (render
  the palette swatches). Stretch.
- **Backward compatibility:** keep the accent-tint `_theme_json` as the fallback when no
  curated colour theme is selected, so nothing that exists today breaks.

## 7. Decisions to confirm (open questions)

1. **Coupling.** Confirm colour themes are fully decoupled from voice themes (recommended),
   vs. each voice theme owning a palette.
2. **Naming for the two flavours.** `geneseed-tokyonight` (solid) + `-glass` (transparent)?
   Or `-solid`/`-transparent`? Or default transparent and `-solid` suffix? Pick one.
3. **Which flavour is the default** emitted/suggested on install — transparent (matches
   today's behaviour) or solid?
4. **Set size.** Eight to start (§5), or trim to ~4 for v1?
5. **Light variants** — worth the extra `{dark,light}` authoring, or dark-only v1?
6. **Source format** — plain `.json` (stdlib, no comments) vs `.json5`/commented for
   palette readability. Geneseed is stdlib-only, so likely plain JSON + a README note.

---

## 8. User-authored themes (brainstorm, 2026-06-17)

Follow-up ask: let a user create their **own** theme(s) via a skill, and **never erase
them on rebuild**.

### 8.1 What rebuild erases today

| Emit | User theme survives rebuild? | Mechanism |
| --- | --- | --- |
| `opencode-global` | **yes** | The install manifest prunes only files Geneseed *owns*; a user file never enters `owned`, so it's never deleted ([_build_global.py](../../_build_global.py)). |
| `opencode` (per-repo) | **no** | `shutil.rmtree(root/".opencode")` wipes the whole dir before re-emit ([_build_emit.py](../../_build_emit.py)). |

So the global path is already correct. Only per-repo erases.

### 8.2 The ownership rule (the whole design)

> **Geneseed owns exactly the theme files a given emit *writes*. Any other theme file in
> the dir is the user's, and is never deleted.**

Preservation keys off the **emit set**, not a filename prefix — so user themes can also
carry the `geneseed-` prefix (they group with the shipped ones in the picker) and still
survive. Per mode:

- **Global:** already holds — user files aren't in the install manifest. No change.
- **Per-repo:** snapshot **all** theme files under `.opencode/themes/` before the
  `rmtree`, then after re-emit restore only the ones the emit did *not* regenerate (the
  shipped themes were just recreated, so they already exist; what's left to restore is
  exactly the user's themes). The full wipe still applies to agents/skills/commands so
  removed ones leave no stale file — themes are the only carve-out.
  *Ceiling (ponytail-flagged in code): deleting a shipped palette source would resurrect
  its old emitted file rather than drop it — only a maintainer editing `themes/opencode/`
  would see it; move to a manifest/emit-set diff if it ever matters.*

User themes live **where OpenCode already reads them** (`.opencode/themes/` or
`<cfg>/themes/`), branded `geneseed-<name>`, selectable as `/theme geneseed-<name>`.
Bonus: they live in the *config dir*, not the harness checkout, so they also survive a
harness reinstall / `git pull` / fresh clone — nothing about them depends on the harness
source tree.

### 8.3 Two ways to author — chosen approach

| | **X — palette source in harness** | **Y — finished theme in config dir** ✅ |
| --- | --- | --- |
| Where | `themes/opencode/<name>.json` (palette) | `<themes-dir>/<name>.json` (full theme) |
| Re-emitted each build | yes (`geneseed-<name>-*`) | no — static user file |
| Survives harness re-clone | no (untracked in repo) | **yes** (lives in config dir) |
| Ownership | named `geneseed-*` = ours | preserved by emit-set diff, untouched |
| Build change needed | none | ~5-line per-repo carve-out |

**Y is chosen** — the stronger "we literally never touch your files" guarantee, clean
ownership, and it matches how the global manifest already behaves.

### 8.4 DRY expansion — one CLI, reused by the skill

A user shouldn't hand-write all ~50 slots. They give a small **palette** (the 19 roles in
[themes/opencode/README.md](../../themes/opencode/README.md)); the same `_color_theme_json`
slot→role logic that builds the shipped themes expands it into both flavours. To avoid
re-encoding that map in skill prose (drift), expose it as a CLI:

```
python rituals/harness.py theme <name> [--from <shipped>] [--palette <file.json>] \
                                       [--transparent-only | --solid-only]
```

- Resolves the active themes dir (per-repo `.opencode/themes/` vs global `<cfg>/themes/`).
- Writes `<name>.json` (+ `<name>-transparent.json` by default) using `_color_theme_json`.
- Refuses a `geneseed-`-prefixed name (that's our namespace).
- `--from tokyonight` seeds the palette from a shipped theme so the user only tweaks a few hues.

### 8.5 The skill (`src/skills/theme.md`)

Model-invoked, themed like every skill. Procedure:
1. Decide the starting point — clone a shipped palette (`--from`), or derive hexes from a
   vibe the user describes.
2. Fill the 19 palette roles; sanity-check contrast (fg/bg legible, error=red-family).
3. Run the CLI to write both flavours into the live themes dir.
4. Tell the user to `/theme <name>` (and that the file is theirs — rebuilds won't erase it).
- **Cost:** a new skill needs a `DESC_THEME` token in all voice themes + `_TEMPLATE.json`
  (parity gate), like any skill.

### 8.6 Status — built (2026-06-17)

All three layers shipped:
- **Preservation** — per-repo carve-out (`_snapshot_user_themes`/`_restore_user_themes` in
  `_build_emit.py`); global already safe via the manifest.
- **CLI** — `python rituals/harness.py theme <name> [--from] [--palette] [--dir] [--global]
  [--solid-only|--transparent-only]` (`cmd_theme` in `rituals/_harness_build.py`).
- **Skill** — `src/skills/theme.md` (+ `DESC_THEME` in all voice themes + `_TEMPLATE.json`,
  AGENT.md skills row, `SKILL_CLASS` entry, README badge 37→38).

---

**Skipped for now:** web-gallery preview of user themes, light variants. Add when asked.
