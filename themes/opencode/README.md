# OpenCode colour themes

Curated, full-palette colour themes for OpenCode's TUI — **separate** from the voice
themes in `../`. A voice theme changes how the agent *speaks*; these change how the TUI
*looks*. Pick them independently.

Each `<name>.json` here is **one palette**. On any OpenCode emit (`build.py --emit
opencode` or `opencode-global`) every palette is written out in **two flavours**:

- `geneseed-<name>-solid` — opaque panel backgrounds.
- `geneseed-<name>-transparent` — backgrounds set to the terminal default, so a
  translucent terminal shows through. (Diff +/- line backgrounds stay tinted for
  legibility — see the spec.)

Select one in OpenCode with e.g. `/theme geneseed-tokyonight-transparent`.

## Creating your OWN theme (users)

You don't edit this dir to make a personal theme — it ships with the harness. Instead:

```bash
python rituals/harness.py theme mytheme --from tokyonight   # clone a palette, rename
python rituals/harness.py theme mytheme --palette mine.json # or supply your own palette
```

This writes `geneseed-mytheme.json` + `geneseed-mytheme-transparent.json` (the name is
auto-prefixed `geneseed-` so every harness theme groups together in the picker) straight
into the live OpenCode themes dir (per-repo `.opencode/themes/`, else the global config
dir). Select with `/theme geneseed-mytheme`. A harness rebuild **never erases it** —
preservation keeps any theme the emit doesn't itself regenerate, regardless of the prefix
(spec §8.2). The model-invoked `theme` skill (`src/skills/theme.md`) drives this whole
flow for you — just ask for a custom theme.

The two dirs are distinct: **shipped palettes** here (re-emitted as `geneseed-<name>-*`),
**your themes** in the config dir (yours, untouched across rebuilds).

## Authoring a new SHIPPED theme (maintainers)

1. Copy any existing file to `themes/opencode/<yourname>.json`.
2. Fill in **every** palette role (the parity gate fails on a missing role). Roles:

   | Role | Used for |
   | --- | --- |
   | `bg` `bgPanel` `bgElement` | the three background layers (flipped to `none` in transparent) |
   | `fg` `fgMuted` | primary / muted text |
   | `accent` `secondary` | brand + links/markup accent |
   | `border` | borders, rules |
   | `ok` `warn` `err` | success / warning / error (keep them green/amber/red — users read state from these) |
   | `kw` `str` `fn` `num` `type` `comment` | syntax highlighting |
   | `addBg` `delBg` | diff added/removed line backgrounds (kept tinted even when transparent) |

3. Every value must be a `#rrggbb` hex string. Dark-only for now.
4. Validate: `python rituals/harness.py doctor --all` (runs the `colours` gate).
5. Borrow a proven palette rather than inventing hues — credit it in the `credit` field.

The shared slot→role mapping lives in `_build_emit.py` (`_SLOT_ROLE`), so a new theme is
just a palette file — no code. Full rationale:
[docs/specs/2026-06-17-opencode-color-themes.md](../../docs/specs/2026-06-17-opencode-color-themes.md).
