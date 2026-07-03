# Themes

Each theme is a single JSON file of **voice tokens** — it controls only *how the
agent speaks* and *how the prose in the docs reads*. It never moves a folder, a
link, or a law number: structure is theme-independent (see [DESIGN.md](../DESIGN.md)).

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
   python rituals/harness.py doctor --theme mytheme   # this theme only
   python rituals/harness.py doctor --all             # every theme + parity
   ```

   `doctor` fails on any missing key, unresolved `{{TOKEN}}`, or dead link.

4. **Preview / use it:**

   ```bash
   python build.py --theme mytheme        # render the bundle
   ```

   or pick it in the TUI/web wizard, or with `--theme mytheme` on any emit.

## What the token classes mean

- **Voice** — `VOICE`, `ACCENT`, `BANNER`, `TAGLINE`, `LOADED_SIGIL`,
  `BENEDICTION`, the epigraphs (`EPI_*`), section intros (`INTRO_*`), law titles
  (`LEX_*`), capability descriptions (`DESC_*`), and `ROAST_PERSONA`.
- **Themed nouns** — `LAW(S)`, `AGENT(S)`, `SKILL(S)`, `MEMORY`, `NOTEBOOK`,
  `VAULT`, `WIKI`. These read in your voice but must stay nouns the prose can use.

Folder names, file paths, and law *numbers* are **never** themed — they live in
the `STRUCTURE` map in `build.py`, laid over every render, so tooling never breaks.
