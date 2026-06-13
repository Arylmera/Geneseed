# {{SKILL}}: geneseed

> {{DESC_GENESEED}}

**Trigger:** the user mentions Geneseed, the harness, `AGENT.md`, or asks you to inspect, read from, or refresh the deployed bundle — or you need to know what {{LAWS}}, {{AGENTS}}, or {{SKILLS}} are available in the current install.

## Procedure
1. Locate the deployment. Try in order: `command -v geneseed` (use the launcher if found); `$GENESEED_HARNESS`; `$OPENCODE_CONFIG_DIR`; `~/.config/opencode/AGENT.md`; `.opencode/AGENT.md` walking up from `pwd`; any `AGENT.md` at the repo root. Stop and say so if none resolves — do not run `setup`, `build`, or `upgrade` to "fix" this.
2. For state — install mode, theme, counts, version fingerprint, drift — prefer the CLI: `geneseed status`, `geneseed version`, `geneseed doctor`, `geneseed diff`. All read-only and cheap ({{LAW}} XV).
3. To read a specific piece, read the file directly rather than re-deriving from prose ({{LAW}} III): `<harness>/agents/<name>.md`, `<harness>/skills/<name>/SKILL.md`, `<harness>/memory/<file>.md`, `<harness>/notebook/<file>.md`. {{LAWS}} live as numbered `## N. …` sections inside `<harness>/AGENT.md`.
4. Side-effecting verbs need explicit assent ({{LAW}} XX): `geneseed learn` (writes to {{MEMORY}}), `geneseed context` (refreshes the project's `context.json`), `geneseed web start|stop` (the local browser UI on `127.0.0.1`). `geneseed web status` is read-only.
5. Never run `setup`, `build`, `upgrade`, `bootstrap`, `update`, `sync-self`, `link`, `unlink`, or `uninstall` as a side effect — these are scope-changing and only run when the user explicitly asks ({{LAW}} II).
6. The bundle's directory and section names are theme-independent (plain English everywhere); only voice and prose change per theme. Don't pattern-match on flavour words to find files.

## Done when
- The user's question about the deployed harness is answered from the live install — file paths or CLI output — not from recall.

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
