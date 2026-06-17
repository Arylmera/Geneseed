# {{SKILL}}: theme

> {{DESC_THEME}}

**Trigger:** the user wants their own OpenCode colour theme — "make me a theme",
"create a custom theme", "I want my own colours", "a theme that matches <brand>", "a
darker/transparent version of <theme>", or asks to tweak the shipped colours. For
changing the agent's *voice* (imperial, pirate…) that is a different concept — point
them at `--theme` / the setup wizard, not this {{SKILL}}.

## Procedure
1. **Pick a starting palette.** Fastest is to clone a shipped one and tweak a few hues —
   `catppuccin tokyonight rosepine gruvbox nord everforest kanagawa dracula`. If the user
   describes a vibe ("warm terminal green", "my brand is #ff0066"), derive the full
   palette yourself: fill all 19 roles in `themes/opencode/README.md` (`bg bgPanel
   bgElement fg fgMuted accent secondary border ok warn err kw str fn num type comment
   addBg delBg`), every value a `#rrggbb` hex.
2. **Respect legibility and semantics.** `fg` on `bg` must stay readable (~7:1), `error`
   stays a red-family hue, `warning` amber, `success` green — users read state from these.
   Keep `addBg`/`delBg` distinct from each other and from the background.
3. **Write the palette to a small JSON** (a bare `{role: "#hex", …}` map or
   `{"palette": {…}}`) — only the roles you are overriding if you also pass `--from`.
4. **Run the CLI** — it expands your palette into the full slot set and writes both
   flavours into the live themes dir (per-repo `.opencode/themes/`, else the global
   config dir), using the same logic as the shipped themes:
   ```
   python rituals/harness.py theme <name> --from <shipped> --palette <file.json>
   ```
   Use `--from` alone to clone-and-rename, `--palette` alone for a from-scratch palette,
   or both (palette overrides the cloned base). `--solid-only` / `--transparent-only` to
   write just one flavour; `--global` to force the global dir from inside a repo.
5. **Tell the user how to select it:** `/theme <name>` (opaque) or `/theme
   <name>-transparent` (terminal background shows through). Mention that the file is
   theirs — named without the `geneseed-` prefix, so a harness rebuild never erases it.

## Done when
- Both `<name>.json` (and/or `<name>-transparent.json`) exist in the active themes dir,
  the CLI reported the path, and the user knows the `/theme <name>` command to select it.

## Self-improvement

Close each run with one beat of reflection on the {{SKILL}} itself:
- A step misled, a needed step was missing, or the trigger fired wrongly — that
  is a flaw in this file. Propose the exact edit (trigger, procedure, or
  done-when) and apply it with the user's assent ({{LAW}} II).
- A lesson that is *not* a flaw in this file goes to {{MEMORY}} only if it
  clears {{LAW}} VI's bar: it would change how a future session behaves, and a
  fresh read of the repo would not re-derive it. Update an existing memory over
  adding one; when in doubt, leave it out.
- No friction, nothing learned — move on; this loop earns no ceremony. Most
  runs end here.
