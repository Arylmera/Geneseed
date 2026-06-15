# Shell completion for the `geneseed` command

**Date:** 2026-06-15
**Status:** draft

## Problem

`geneseed` exposes ~20 subcommands (`menu`, `tui`, `web`, `setup`, `bootstrap`,
`update`, `build`, `doctor`, `diff`, `context`, `learn`, `prompt`, `upgrade`,
`sync-self`, `link`, `unlink`, `home`, `version`, `status`, `uninstall`,
`git-gate`, `help`) plus second-level verbs (`web start|stop|status`) and a
handful of flags. New users discover them by running `geneseed help` or reading
`README.md`; experienced users routinely mistype `geneseed doctro` or forget
whether it's `geneseed web start` or `geneseed web up`. Every shell the project
supports — bash and zsh on macOS/Linux, PowerShell on Windows — has a native
completion mechanism. We ship none of them, so TAB does nothing useful after the
word `geneseed`.

## Fix

A **single source of truth** (`harness.py`'s argparse tree) renders **per-shell
completion scripts** on demand, and `geneseed link` installs the one that
matches the user's shell. No new runtime dependency, no manual list of
subcommands to keep in sync.

The four moving parts:

1. A new subcommand: `geneseed completions <shell>` prints the script to stdout.
2. A small generator that reads `build_argparser()` and emits bash, zsh, and
   PowerShell scripts (and fish, opportunistically).
3. `geneseed link` learns a `--with-completions` flag (default ON on first run)
   that drops the right script into the right system location.
4. `geneseed doctor` learns one new check: *"completion installed but stale"*.

### Source of truth: argparse introspection

The generator walks `build_argparser()`'s subparsers and, for each subcommand,
collects:

- `name`, `help` text (used as the tooltip in zsh/PowerShell).
- Positional arguments with their `choices=` if present (e.g. `web {start,stop,status}`).
- Optional flags (`--theme`, `--mode`, `--daemon`, …) and their `choices=`.
- An explicit **completion hint** per `(subcommand, dest)` looked up from a
  side-table (see below). Anything not in the table gets no completion.

The hint side-table lives in `rituals/_completions.py` as a single dict:

```python
HINTS: dict[tuple[str, str], Hint] = {
    ("link",     "dir"):    Hint.DIR,
    ("upgrade",  "theme"):  Hint.THEME,        # ls themes/
    ("upgrade",  "ref"):    Hint.NONE,         # free text
    ("bootstrap","theme"):  Hint.THEME,
    ("prompt",   "name"):   Hint.SKILL_OR_AGENT,  # ls src/skills/ + src/agents/
    ("context",  "name"):   Hint.SKILL_OR_AGENT,
    # ... one entry per arg we want to complete
}
```

**Why a side-table and not a dest-name convention** ([[2026-06-13-docs-menu]]'s
CLI page made the same call): renaming an argparse dest in `harness.py` would
silently break completion if convention-driven. With the table, the generator
*crashes* on an unknown `(cmd, dest)` for any arg whose `choices=` isn't set —
forcing a deliberate decision at every new subcommand.

The module exports three pure functions: `render_bash(parser, hints) -> str`,
`render_zsh(parser, hints) -> str`, `render_powershell(parser, hints) -> str`.
Each is a templated string-builder; no external libraries.

The argparse tree is the **only** place subcommands are declared. Adding a new
`sub.add_parser(...)` automatically appears in every shell's completion the next
time `geneseed completions <shell>` runs (or `geneseed doctor` re-installs).

### Generator contract & snapshot tests

A fixture parser lives at `tests/completions/fixture_parser.py` — a small
argparse tree exercising every code path (subcommand with no args, positional
with `choices=`, optional with `choices=`, `DIR` hint, `THEME` hint,
`SKILL_OR_AGENT` hint, free-text arg). Golden output lives at
`tests/completions/expected/{bash,zsh,powershell,fish}.txt` and is regenerated
with `pytest tests/completions --update-snapshots`.

CI runs `pytest tests/completions` against the live `build_argparser()` *and*
the fixture, asserting byte-stable output. A regression in any shell's
generator fails the whole suite — there's no way to ship a broken bash script
because the zsh test passed.

A separate test asserts that **every** subcommand in `build_argparser()` is
either covered by `choices=` (no entry needed) or has an entry in `HINTS` for
each of its positional/optional args. New subcommands without explicit hints
fail CI with a pointer to `_completions.py`.

### The `completions` subcommand

```
geneseed completions <shell>           # print to stdout
geneseed completions <shell> --install # write to the canonical path for that shell
geneseed completions --detect          # print "bash" | "zsh" | "powershell" | "unknown"
```

`<shell>` ∈ `bash`, `zsh`, `powershell`, `fish`. Detection inspects `$SHELL`
on Unix and `$PSModulePath` / `$env:SHELL` on Windows; if ambiguous it prints
`unknown` and exits non-zero so the caller can ask the user.

Eval-style use (no install) — works today, in any shell:

```bash
# bash / zsh in ~/.bashrc or ~/.zshrc
eval "$(geneseed completions bash)"     # or zsh
```

```powershell
# PowerShell, in $PROFILE
geneseed completions powershell | Out-String | Invoke-Expression
```

The eval path is documented as the *manual* install for users who don't want
`geneseed link` to touch their dotfiles.

### Per-shell behavior

**bash** — emits a function `_geneseed()` registered with
`complete -F _geneseed geneseed`. Completes:

- 1st token: subcommand list from argparse.
- `geneseed web <TAB>`: `start stop status`.
- `geneseed link <TAB>`: directories (uses `_filedir -d`).
- `geneseed upgrade <TAB>` / `bootstrap <TAB>` / `update <TAB>`: refs are free
  text (no completion); `geneseed upgrade <ref> <TAB>`: themes via on-disk
  glob of `$GENESEED_ROOT/themes/`.
- `geneseed prompt <TAB>` / `geneseed context <TAB>`: skill + agent names via
  on-disk glob of `$GENESEED_ROOT/src/skills/*.md` and `src/agents/*.md`. No
  subprocess.
- `geneseed --<TAB>` per-subcommand: flags from argparse (`--theme`, `--mode`,
  `--daemon`, …).

`$GENESEED_ROOT` is baked into the generated script at install time (it's
the directory `link` is reading the launcher from). Targets bash 3.2 (the
macOS system bash) — no associative arrays, no `mapfile`.

**zsh** — emits a `#compdef geneseed` function using `_arguments`/`_values`.
Same coverage as bash (subcommands, `web` verbs, `link` dirs, themes, skill +
agent names) plus tooltip text from each parser's `help=` string (zsh shows
it as the description column). Skill/agent names are read with native zsh
glob `$GENESEED_ROOT/src/skills/*.md(:t:r)`. Works under both `bashcompinit`
and native zsh completion.

**PowerShell** — emits a `Register-ArgumentCompleter -CommandName geneseed
-ScriptBlock { … }`. Same subcommand + flag + skill/agent coverage; the
dynamic lists (themes, skill/agent names) use `Get-ChildItem -Path
"$env:GENESEED_ROOT/..."` inside the script block — no subprocess back to
Python. Tooltips populated from `help=`. Targets PowerShell 5.1 (Windows
default) and 7.x.

**fish** — best-effort, emits `complete -c geneseed -n '...' -a '...'` lines.
Not part of the linked install path; available only via
`geneseed completions fish`.

**cmd.exe** — *not supported.* cmd has no per-command completion mechanism
(DOSKEY is filename-only). Doctor will print one line if `cmd.exe` is the
caller's shell explaining that PowerShell is required for completion on Windows.

### Install paths

The principle: **prefer paths that the shell already auto-loads**, so we never
edit `~/.zshrc` / `$PROFILE` unless we have to. Each shell has a short
preference chain; the first writable, auto-loaded path wins.

**bash** (preference order):
1. `$(brew --prefix)/etc/bash_completion.d/geneseed` — macOS, if Homebrew's
   `bash-completion` is installed (auto-loaded, no rc edit).
2. `/usr/share/bash-completion/completions/geneseed` — Linux distros that
   ship bash-completion (auto-loaded, no rc edit). Requires sudo, so we only
   write here from `setup --system` (explicit).
3. `~/.local/share/bash-completion/completions/geneseed` — picked up by
   bash-completion ≥ 2.8 automatically. **Default for non-root installs.**
4. Fallback: `~/.geneseed/completions/geneseed.bash` + a fenced
   `source <path>` block in `~/.bashrc`. Only when none of 1–3 are writable.

**zsh** (preference order):
1. `$(brew --prefix)/share/zsh/site-functions/_geneseed` — already in zsh's
   default `fpath`. **Default on macOS Homebrew installs, no rc edit.**
2. `/usr/local/share/zsh/site-functions/_geneseed` — same, non-brew Unix.
3. `~/.zsh/completions/_geneseed` + a fenced `fpath=(...)` +
   `autoload -U compinit && compinit` block in `~/.zshrc`. Only when 1–2 fail.

**PowerShell** (no auto-loaded dir exists; rc edit is unavoidable):
- Append a fenced block to `$PROFILE` that dot-sources
  `~/.geneseed/completions/geneseed.ps1`. The block is ~3 lines. We only edit
  `$PROFILE`; the heavy completion script lives in its own file so the rc
  diff stays minimal and reviewable.

**fish:**
- `~/.config/fish/completions/geneseed.fish` — auto-loaded, no rc edit.

**cmd.exe:** unsupported. `link` prints a one-line note pointing at the
PowerShell install if `cmd.exe` is detected.

**Idempotence & cleanup.** All writes are exact overwrite. All rc edits are
bracketed by `# >>> geneseed completions >>>` / `# <<< geneseed completions
<<<` markers. `geneseed unlink` removes both the completion file *and* the
fenced block (exact marker match; if markers are missing it leaves the rc
file alone and prints a warning with the path to clean by hand).

**Per-shell success message.** `link` prints exactly one of:

- bash, brew/system dir:   `geneseed: bash completion installed (auto-loaded next shell).`
- bash, rc edit needed:    `geneseed: bash completion installed. Added 4 lines to ~/.bashrc. Run: source ~/.bashrc`
- zsh, fpath dir:          `geneseed: zsh completion installed (auto-loaded next shell).`
- zsh, rc edit needed:     `geneseed: zsh completion installed. Added 5 lines to ~/.zshrc. Run: exec zsh`
- PowerShell:              `geneseed: PowerShell completion installed. Added 3 lines to $PROFILE. Run: . $PROFILE`
- fish:                    `geneseed: fish completion installed (auto-loaded next shell).`

**Cross-shell install.** When the *current* shell differs from the detected
default shell, `link` installs for the detected default and prints a hint
about the override flag. `link --shell bash --shell zsh` (repeatable) installs
both — useful for users who switch.

### Detection logic

In order of precedence:

1. Explicit `--shell <name>` flag — always wins.
2. **Parent-process inspection** — read the *interactive* shell that invoked
   `geneseed`, not the login shell. Implementation, dependency-free:
   - Linux: `/proc/$PPID/comm`.
   - macOS: `ps -o comm= -p $PPID`.
   - Windows: `Get-CimInstance Win32_Process -Filter "ProcessId=$PID"` via a
     short PowerShell one-liner, parsed for `powershell.exe` /
     `pwsh.exe` / `cmd.exe`.
   - Walk up one more level if the immediate parent is `python`/`python3`/`py`
     (covers `python harness.py` indirection) or `sh` wrapping (covers
     `bash -c geneseed ...`).
3. `$SHELL` basename, as a fallback when parent-process inspection fails or
   returns something opaque (e.g. `tmux`, `screen`, `code`).
4. **No silent fallback.** If detection returns `unknown` we *do not* install
   both bash and zsh — that was the wrong call in the v0 draft (overwrites
   files the user may not want). Instead: print a one-liner asking the user to
   re-run with `--shell <name>`, and list the detected shells if any. The
   `setup` wizard catches this earlier by asking explicitly.

`geneseed completions --detect` prints the detected shell (one of `bash`,
`zsh`, `powershell`, `fish`, `unknown`) and the *reason* (e.g. `parent=zsh`,
`fallback=$SHELL=/bin/zsh`, `none`) so doctor and the setup wizard can render
useful UI.

### Caching for dynamic values

Themes are cheap to enumerate (one `os.listdir` on `themes/`), so no cache.
The deployed install path (used to scope `diff`/`doctor` completions) is read
from the install marker on demand — also cheap, no cache.

If we later add slow dynamic completions (e.g. spec IDs for a hypothetical
`geneseed docs <spec>`), they go through a small cache at
`~/.cache/geneseed/completions.json` with a 60-second TTL. Out of scope for
v1.

### Doctor integration

One new check, `completions_stale`:

- If the file at any of the canonical install paths exists, hash its contents
  and compare to `render_<shell>(build_argparser())`. Mismatch → warn,
  recommend `geneseed completions <shell> --install`.
- If a profile/rc has the fenced block but the referenced fpath/file is
  missing → warn, recommend `geneseed link --with-completions`.

The check is gated on `--strict` so a stale completion doesn't fail a normal
doctor run; the warning still appears.

### CLI reference page (docs menu)

The CLI reference page from [[2026-06-13-docs-menu]] gains a top-of-page
"Install completion for this shell:" snippet, copy-to-clipboard, populated by
detecting the user's shell from the request `User-Agent`/`Accept-Language` is
not reliable — instead show a small selector (bash / zsh / PowerShell / fish)
and render the matching one-line eval command.

## Non-goals

- **cmd.exe completion.** Skipped intentionally; PowerShell is the documented
  Windows shell.
- **Completion of arbitrary file paths inside subcommand args.** Only `dir` /
  `path`-typed args get directory/file completion; everything else is opaque.
- **Network calls.** No fetching theme lists from the upstream repo for
  completion — only what's on disk.
- **Per-user theming of completion text.** Tooltips come from `help=` strings
  as-is; no theme-token expansion (would force a build-step in the generator).
- **Versioned completions.** We don't ship pinned scripts for older `geneseed`
  builds; doctor's staleness check covers drift.

## Risks & mitigations

| Risk                                                                 | Mitigation                                                                                 |
|----------------------------------------------------------------------|---------------------------------------------------------------------------------------------|
| A user has hand-written completion already                           | Fenced markers + idempotent overwrite of *our* file only; we never edit a user-named file.  |
| Slow TAB on PowerShell because the script subprocess-spawns Python    | Generator emits **static** scripts — no Python at TAB time. Themes list is the one dynamic call, behind a session cache. |
| zsh `fpath` not picked up                                            | `link` appends an `fpath=(...)` + `autoload -U compinit && compinit` block (idempotent, fenced) only if not already present. |
| Stale completion after `geneseed upgrade`                            | `upgrade` calls `completions install` for whichever shells have an existing install. Doctor backs this up with a warning. |
| Generator regression breaks all four shells at once                  | Snapshot tests per shell under `tests/`: assert generated bash/zsh/PS output for a known argparse fixture is byte-stable. |
| `geneseed unlink` leaving orphan rc edits                            | Fenced-block removal is exact-match on the markers; if markers are missing, we leave the file alone and warn.            |

## Rollout

1. Land `rituals/_completions.py` + the `completions` subcommand + snapshot
   tests. No behavior change yet — users can already `eval "$(geneseed
   completions bash)"`.
2. Land `geneseed link --with-completions` (default ON) and the doctor check.
3. Update `README.md` quickstart and the docs-menu CLI reference page.
4. Add `completions` to `upgrade`'s post-step so existing installs self-heal.

## Resolved decisions (was: open questions)

**Q1 — does `link` prompt before editing rc files?** *Resolved: no prompt,
no silent surprise either.* The install-paths chain prefers auto-loaded
dirs first; rc edits happen only when no auto-loaded dir is writable
(common case on PowerShell, edge case on bash/zsh). When an rc edit *does*
happen, the success print states it explicitly — "Added N lines to
~/.bashrc" — so the user sees it the same turn. The fenced markers and
`unlink` symmetry mean it's always reversible without manual editing.
`link --no-rc-edit` exists for users who never want their rc touched
(the completion file is still written; they wire it up themselves).

**Q2 — does completion surface skill/agent/law/spec names?** *Resolved:
yes for skills and agents in v1, deferred for laws and specs.* Skills and
agents are the two args most commonly typed after a subcommand
(`geneseed prompt <skill>`, `geneseed context <agent>`), so the UX win is
real. **Implementation constraint:** the generated script reads
`src/skills/` and `src/agents/` *directly* with the shell's native glob
(`for f in "$here"/src/skills/*.md`) — no subprocess back to Python at TAB
time, no perf cost. The path to the install root is baked into the script
at install time (it's known: it's where `link` is reading the
launcher from). Laws and specs share the same mechanism but aren't
typed at the CLI today; if a future subcommand needs them, they slot into
the same `HINTS` table with new `Hint.LAW` / `Hint.SPEC` values.
