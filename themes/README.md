# Themes

Each theme is a single JSON file of **voice tokens** — it controls only *how the
agent speaks* and *how the prose in the docs reads*. It never moves a folder, a
link, a Rule numeral, an Ontology section name, or a doctrine pack slug:
structure is theme-independent (see [DESIGN.md](../DESIGN.md)).

Fourteen themes ship. `neutral` is the canonical baseline (plain professional
English); the others range from `imperial` (Warhammer 40k) to community voices.

## Authoring a new theme

1. **Copy the scaffold** to your theme's name (plain, lowercase):

   ```bash
   cp themes/_TEMPLATE.json themes/mytheme.json
   ```

   `_TEMPLATE.json` lists every required key with a one-line note on what it is.
   It is `_`-prefixed, so the build, `doctor`, and the parity gate skip it — it is
   a scaffold, never a real theme.

2. **Fill in every value.** Keep **all** the keys: every theme must define the
   same set, or the parity gate fails. Replace each `<…>` placeholder with prose
   in your theme's voice. Leave the **structure** alone — `LAW`/`LAWS`,
   `AGENT(S)`, `SKILL(S)` are themed *nouns*, but folder names and law numbers are
   not yours to move.

   **Tone guard.** An aggressive or comedic persona MUST carry, inside its
   `VOICE` and written in the persona's own voice, a self-consistent line
   establishing that the tone never compromises correctness or completeness —
   every finding, caveat, and step is still delivered in full. A persona primed
   for contempt or comedy without that line will trade substance for
   character. See `mean` and `joker` for the pattern.

3. **Validate:**

   ```bash
   ./geneseed doctor --theme mytheme   # this theme only
   ./geneseed doctor --all             # every theme + parity
   ```

   `doctor` fails on any missing key, unresolved `{{TOKEN}}`, or dead link.

4. **Preview / use it:**

   ```bash
   ./geneseed build --theme mytheme       # render the bundle
   ```

   or pick it in the TUI/web wizard, or with `--theme mytheme` on any emit.

## What the token classes mean

- **Voice** — `VOICE`, `ACCENT`, `BANNER`, `TAGLINE`, `LOADED_SIGIL`,
  `BENEDICTION`, the epigraphs (`EPI_*`, including `EPI_ONTOLOGY` and
  `EPI_DOCTRINES`), section intros (`INTRO_*`), the nine Rule titles (`LEX_*`),
  the twenty-three doctrine rule titles (`DOC_<PACK>_<N>`), the four pack names
  (`PACK_CRAFT`, `PACK_RIGOR`, `PACK_OPS`, `PACK_PROCESS`), capability
  descriptions (`DESC_*`), and `ROAST_PERSONA`.
- **Themed nouns** — `ONTOLOGY`, `LAW(S)`, `DOCTRINE(S)`, `AGENT(S)`, `SKILL(S)`,
  `MEMORY`, `NOTEBOOK`, `VAULT`, `WIKI`. These read in your voice but must stay
  nouns the prose can use. ⚠ `LAW` and `DOCTRINE` must each be a **single word** —
  both heading parsers match the tier noun with `\S+`, so a value with a space
  makes that whole tier parse to nothing. `doctor` refuses it.
- **Agent colours** — `AGENT_COLORS`, a flat `{agent_name: slot}` object (not a
  string) mapping each capability agent to an OpenCode *named theme slot*
  (`primary`/`secondary`/`accent`/`success`/`warning`/`error`/`info`), plus a
  `_default` used for any agent not listed (the council seats). Only consumed by
  the OpenCode emit's `color:` frontmatter — restyle the grouping per theme if you
  want to, or leave the synced default. An unrecognised slot value is rejected at
  build time and falls back to `secondary`, with a warning, rather than ever
  reaching emitted frontmatter.

Folder names, file paths, Rule *numerals*, the four Ontology section names
(Telos, Evidence, Decisions, Conduct) and the pack *slugs* used in citations
(`craft`, `rigor`, `ops`, `process`) are **never** themed — they live in the
`STRUCTURE` map in the generator, laid over every render, so tooling never breaks.
`PACK_*` themes how a pack is *named* in prose, never how it is *addressed*.
