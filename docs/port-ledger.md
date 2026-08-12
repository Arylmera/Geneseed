# The port ledger — what the Node port does not prove

Geneseed ships two implementations of the same tool: the Python reference (`build.py`,
`rituals/`) and the Node port (`bin/`, `js/`). Three cell harnesses prove they agree —
`tests/golden.py` over the emit matrix, `tests/harness_golden.py` over the CLI verbs,
`tests/web_golden.py` over the web console — by running both and comparing every byte
either one wrote, plus both streams and the exit code.

**A cross-implementation comparison is structurally blind to two things**: a defect both
sides share, and a branch neither side reaches. This file is the standing list of the
second kind. It is the honest answer to *"what does this port not prove?"*, kept beside
the code rather than inside a phase note, because the phase notes are per-machine and this
outlives them.

Each row says whether the gap is **ASSERTED** — there is a test that fails if the gap
closes or widens without this file changing — or **STATED**, meaning the claim rests on
prose and nothing enforces it. Prefer asserting. A structural gate must read *code*, never
the paragraph that admits the gap, or deleting the paragraph is a way to pass it.

*Verified at P11 against the tree, not against the previous note. P11 is the phase that first
ran the three harnesses on a second operating system; the rows below are what that changed.*

## What DOES cross

All 25 subcommands, 29 of 29 web paths, 5 of 5 docs kinds. Every `NOT_PORTED*` table in
`js/web/` is empty and stays declared as the empty half of a partition — the shape that
makes the next unported thing visible instead of silently absent.

## Declared, with an assertion

| # | The gap | Where it is asserted |
|---|---|---|
| 1 | **The full-screen curses panel.** `_tui_loop`, the eighteen screens of `_harness_tui_views.py`, the `(stdscr, curses, pal)` helpers of `_harness_tui_draw.py`, `_winterm.py`'s `_Window`, `_harness_menu.py`'s menus, `cmd_setup`'s and `cmd_bootstrap`'s curses arms, `_doctor_collect(on_progress=)`. `js/tui.mjs` refuses and names `python rituals/harness.py tui`. | `tests/test_tui_boundary.py` from both directions: behavioural (the arm refuses and leaves no panel behind) and structural — `test_the_arm_is_unreachable_by_construction_and_not_by_luck` fails if `js/tui.mjs` grows any of `?1049h`, `?1049l`, `?25l`, `\x1b[`, `[`. Landing a real panel means deleting that test *first* and updating this row second. |
| 2 | **`textwrap.wrap` / `_wrap_lines`.** A second `difflib`: a stdlib payload with no Node twin. Its only caller is `_tui_loop`, so it is callerless in the port. Port it *with* the panel or not at all. | Gated on the reference alone — `tests/test_tui_boundary.py:306`. There is nothing to compare against, and the row says so. |
| 3 | **`/api/pick-folder`.** Declined, never ported: it opens an OS-native folder dialog on the daemon host. `js/web/server.mjs` carries it in `DECLINED_POST`, a set distinct from `NOT_PORTED_POST` because "will never cross" is a different claim from "not yet". | Probed live, not merely declared: `tests/test_web_server.py` drives the real dispatcher and requires POST → 501 and GET → *not* 501 (it must fall through to the SPA). The reference's own handler, `rituals/_web_server.py:179`, is what no test reaches. |
| 4 | **`_win_user_path`'s registry-write success arm.** `link`/`unlink` edit the persistent user Path through PowerShell. No test in this repo may run that — the edit would outlive the suite. | The *failure* arm is reached honestly: `harness_golden`'s `unlink` cells hand the verb a PATH with no `powershell` on it, so both sides take the "said nothing about PATH" branch with the registry untouched. Everything that can be *wrong* lives in the pure `_win_user_path_script` / `winUserPathScript` half, and `tests/test_win_user_path.py` runs a corpus over both. That the spawn half carries no logic is **STATED**, in that file's docstring. |
| 5 | ~~**`link`/`unlink`'s Unix arm.**~~ **CLOSED at P11.** It symlinks `ROOT/geneseed` into `~/.local/bin`, and it now has six cells of its own — including the `PATH` split (a substring test passes every other cell and fails `a-path-entry-that-merely-contains-the-dir`), the `is_symlink()` clause that leaves a foreign `geneseed` alone, and an explicit dir argument with a trailing slash. That last one found a live divergence: the reference builds a `Path` and the port kept the raw string, so `str(Path('/x/bin/'))` and `/x/bin/` disagreed in two messages and in the PATH comparison. Fixed in `js/link.mjs` with `pyPathStr`. | The group is now a UNION across the two platforms, declared in `harness_golden.PLATFORM_ONLY` and asserted from either host by `tests/test_hook_cli_parity.py::ThePlatformDeclaredCellsAreDeclared`: every id declared for this platform must be built, every id declared for the other must be absent, and neither half may be empty. `compare()` also PRINTS the half it is not running, so a run says what it skipped. |
| 6 | **The boot animation's call site.** `theme_anim.play_line` itself crossed; what is declared is that `js/setup.mjs` and `js/update.mjs` reach no panel. | `tests/test_tui_boundary.py::test_neither_module_contains_anything_that_could_paint_a_screen` — escape sequences, not the word "curses". The first draft looked for the word and failed on a *docblock*: a structural gate that reads prose is a gate on the documentation. |

## Ungated, and honest about it

| # | The gap | Why nothing reaches it |
|---|---|---|
| 7 | **`_npm_build` / `npmBuild`** (`npm install && npm run build`). | A first-run-from-a-partial-checkout path; no cell can be in that state, because `web/dist/` is tracked. `tests/test_web_daemon.py` asserts *that* — it re-derives the unreachability from `git ls-files`, so untracking `web/dist/index.html` fails the test instead of quietly making the arm live. |
| 8 | **`_harness_supports` / `_stale_factory_hint`.** | Cell-unreachable in the *reference* too, so there is nothing to compare against. Gated on the Python side alone by `tests/test_harness.py`; `js/update.mjs` declares the absence of a twin. |
| 9 | **The web dispatcher's 501 arm.** | `NOT_PORTED_ACTIONS` and `NOT_PORTED_KINDS` are both empty, so no target exists to ask for a 501, and none can be borrowed: every remaining action either starts a job in the developer's checkout or writes a shim and edits the real user PATH. The claim now rests on `tests/test_web_jobs.py` reading the set out of the module — a gate on a *declaration*, which is weaker than a probe, and is declared as such at both sites. |
| 10 | **`pyStrPath` / `pyPathStr`.** Two spellings of one translation in `js/generate.mjs`. | Ungated; the comment at the call site says so. `harness_golden` reads stderr through `subprocess`'s universal-newline decode and cannot see the difference the split is about. |
| 11 | **The Linux browser lookup answering FALSE.** `_web_first_ok`'s last step: the reference walks `webbrowser`'s registry (`$BROWSER`, `xdg-open`, `gio`, `gvfs-open`, a dozen browser binaries) and `js/menu.mjs`'s `browserAvailable` asks only whether `xdg-open` — the binary `openUrl` will actually run — is on PATH. On a box with `gio` and no `xdg-open` they disagree, which is what a WSL run measured. | The corpus in `tests/test_pure_function_parity.py` now SUPPLIES the input instead of inheriting it: an `xdg-open` stub on PATH plus `DISPLAY`, so the True arm is reached identically on every host, and a `no-display` row gates the Linux-only display refusal absolutely on both sides. Reaching the FALSE arm of the browser lookup needs a PATH with no `xdg-open` at all, which is not something a probe on Windows survives — so it stays ungated, here, rather than in a comment. |
| 12 | **The width sweep off one Unicode version.** `js/tui.mjs`'s `WIDE`/`COMBINING` tables are a snapshot of unidata **15.1.0** (declared as `DWIDTH_UNIDATA`); the sweep compares them against the running interpreter's live `unicodedata`. CPython 3.14 carries 16.0.0 and assigned U+0897 a combining class, so the sweep reports a divergence that is neither implementation's. | The class skips itself when the versions differ, naming both — and the skip is not silent: `.github/workflows/ci.yml` PINS `python-version: "3.13"`, and `test_ci_pins_an_interpreter_whose_unicode_matches_the_tables` reads that file plus the constant and fails if the two drift apart. Regenerating the tables means moving the constant and the pin with them. **Since the corpus, there is a second anchor that outlives the interpreter**: `tests/__snapshots__/dwidth.json` carries all 527 runs, a sha256 over them, and the unidata version they were measured at, and `tests/pure_snapshot.test.mjs` checks `DWIDTH_UNIDATA` against that declaration with no Python involved. |
| 13 | **`minute_stamp`, once the reference is gone.** `%Y-%m-%d %H:%M` off a naive `fromtimestamp` is LOCAL time, so the recorded answers carry the recording machine's UTC offset. There is no token to substitute — the offset is the answer's arithmetic, not a substring of it. | Each of the five cases carries a `guard` naming the UTC offset **at that instant** (so DST is part of the match, not an approximation), and `tests/pure_snapshot.test.mjs` recomputes it from `Date` before asserting. A replay in another zone SKIPS those cases and PRINTS how many it skipped — the width sweep's rule that a skip is not a pass. While `rituals/harness.py` exists the live comparison in `tests/test_pure_function_parity.py` still gates them everywhere; after the deletion they are gated only where the offsets agree, which on this project's CI is the `record-corpus` runner and not much else. |

## Not proven anywhere, and worth knowing before a release

* ~~**The three cell harnesses have only ever run on Windows.**~~ **FIXED at P11.** They now
  run on Linux too, and `.github/workflows/ci.yml` has a `cells` job that runs all three on
  `ubuntu-latest` on every push. What the first Linux run found, recorded because it is the
  honest measure of what one-platform testing hides:
  * `_shim_problems` / `_shim_health` read the POSIX shim's `"$@"` as a path and reported
    every healthy install's hooks as dead — **a user-visible `doctor` bug on every Linux and
    macOS install**, in both implementations, plus 112 of 259 golden cells and four
    `--validate-only` tests. Fixed at the single owner, `_build_settings._SHIM_ARGV`.
  * `_reexec`'s POSIX branch called `os.execv` without flushing, so `bootstrap` discarded
    everything it had printed since the last spawn — `geneseed bootstrap > log.txt` lost
    `[geneseed] ✓ update complete.` on every Unix run. Windows has no `exec` and never
    reaches the line; a terminal hides it because line buffering had already written it.
  * `harness_golden._resolve_cli` left the interpreter a bare name, which `CreateProcess`
    resolves against the PARENT's PATH and `execvpe` does not — so any cell that replaces
    PATH could not spawn the candidate at all off Windows.
  * `test_tui_boundary`'s wizard decline was POSITIONAL (six newlines, then `n`), and the
    wizard does not ask a fixed number of questions. Off Windows the `n` landed one prompt
    late, the wizard proceeded, and it emitted a whole install into the sandbox HOME.
  * Two `web_golden` `expect_re`s named Windows' case-folded catalog order as if it were the
    only one.
  * The `link`/`unlink` Unix arm (row 5) and the `_web_first_ok` browser step (row 11).
* **What the first WINDOWS CI run found, and what the harnesses now guarantee.** The same
  argument as above, one platform over: PR #78's first run was green on a Windows laptop and
  in WSL, and red on `windows-latest`. Every finding was an environment the developer's
  machine could not produce, so each fix carries a gate that MANUFACTURES the environment
  (`tests/test_sandbox_paths.py`, and the two named below) rather than one that waits for a
  runner to supply it.
  * **Sandbox paths are CANONICAL.** GitHub's Windows runner spells `TEMP` as the 8.3 alias
    `C:\Users\RUNNER~1\…`; the generator's `Path.resolve()` expands it, so every destamp
    root matched nothing and the raw sandbox name leaked into 45 byte comparisons — and
    `git-gate/sovereign-bypass` went VACUOUS because the excludes entry it seeds stopped
    matching a resolved cwd. `golden.sandbox()` is the one owner for the three cell
    harnesses; `tests/golden.py` also canonicalises `tempfile.tempdir` at import, which
    covers the twenty other modules that call `tempfile` directly. POSIX reaches the same
    duality through symlinks and the gates build one there.
  * **`resolveOut` was `path.resolve` where the reference is `Path.resolve()`** — a PORT bug
    the aliasing exposed and a canonicalising fixture would have hidden. Now `pyResolve`,
    the twin that already existed for this and is used at nine other sites.
  * **`pyWhich` did not reproduce the current-directory rule.** `shutil.which` prepends
    `os.curdir` unless `NoDefaultCurrentDirectoryInExePath` is DEFINED; Git Bash defines it
    and the runner does not. The corpus reached the branch and never varied the variable.
  * **A bare `text=True` decoded node's stdout with the locale codec** in
    `tests/test_win_user_path.py`; `PYTHONUTF8=1` (this repo's runbook, not CI) had been
    making it accidentally right since P5a made the same finding.
  * **A `TemporaryDirectory` cleanup race killed the Linux `cells` job** after it had
    compared 270 of 318 cells; the same commit passed on re-run. `sandbox()` cannot raise
    on teardown, for the reason `sandbox_process_home` already gave.
* **The `cells` job is Linux-only.** `validate` (doctor + the unit suite + `node --test`)
  still runs on `ubuntu-latest` *and* `windows-latest`, so every cross-implementation gate
  that is not a cell runs on both; the three harnesses themselves run on Linux in CI and on
  Windows by hand. The Windows-only half of `PLATFORM_ONLY` is therefore proved locally, not
  by CI — which is why the harness prints the half it did not run.
* **The reference is load-bearing.** `golden.py` defaults `--ref` to `build.py`;
  `harness_golden.py` and `web_golden.py` default to `rituals/harness.py`. Deleting the
  Python implementation deletes the thing the port is measured against. `package.json`
  ships both for independent reasons — see `tests/test_package_manifest.py`, where every
  shipped path carries its argument.
