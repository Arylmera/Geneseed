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

## ⚠ The corpus is frozen — recorded 2026-08-17, replay-only from here

**The recordings under `tests/__snapshots__/` can never be taken again.** They are produced by
the Python reference and by nothing else: `tests/golden.py`, `tests/harness_golden.py`,
`tests/web_golden.py`, `tests/test_pure_function_parity.py` and `tests/record_help.py` are the
only programs that have ever written a cell, the three Node replayers reject `--record` by
design, and the phase after this one deletes every one of those programs. The `record-corpus`
job that produced the `lf` halves on ubuntu is deleted in the same commit as this paragraph, so
the workflow cannot outlive the reference it drives.

The last recording was taken deliberately, immediately after the edits that had to be made while
an oracle still existed — the emitted prose that named files the deletion removes, the removal of
the web API's interpreter field, the three verbs the reference never had, and the release-label
destamp that stops a version bump from reddening a corpus nobody can re-bless. Everything after
this point may only be checked against those bytes.

**Two consequences, both ASSERTED by the replayers themselves:**

- A change that moves a recorded byte is now a **finding, not a step**. There is no re-bless. If
  a replay goes red the choice is to revert the change or to argue, in writing, that the recording
  was wrong — and nothing can settle that argument any more.
- The corpus proves **unchanged**, never **correct**. It was recorded from an implementation that
  agreed with the port at the time; where both were wrong together, it now freezes the agreement.
  That blindness is the whole subject of this file and it no longer has a second party to correct it.

**What the last recording fixed, and what a reader should know it cost.** The two halves had drifted
apart for a reason that had nothing to do with either implementation: the `crlf` half had captured a
stale `Harness/` — this repository's own dogfooded install, which is **gitignored build output** —
so `doctor` reported seven stale renders on the machine that recorded it and none on CI, and the two
platforms disagreed permanently. The final recording was taken with that directory absent, which is
the state a fresh clone has. **A stale local build tree moves recorded bytes; an absent or freshly
built one does not.** Anyone comparing the halves should know they now agree because that input was
removed, not because it was ever normalised.

## What DOES cross

All 25 subcommands, 29 of 29 web paths, 5 of 5 docs kinds. Every `NOT_PORTED*` table in
`js/web/` is empty and stays declared as the empty half of a partition — the shape that
makes the next unported thing visible instead of silently absent.

## Declared, with an assertion

| # | The gap | Where it is asserted |
|---|---|---|
| 1 | **The full-screen curses panel.** `_tui_loop`, the eighteen screens of `_harness_tui_views.py`, the `(stdscr, curses, pal)` helpers of `_harness_tui_draw.py`, `_winterm.py`'s `_Window`, `_harness_menu.py`'s menus, `cmd_setup`'s and `cmd_bootstrap`'s curses arms, `_doctor_collect(on_progress=)`. **This row's subject is Python and becomes history at P4** — there is no panel to declare a gap against once the reference is gone. What survives the cut is the claim about the PORT: `js/tui.mjs` refuses on a TTY, and the refusal still offers `harness setup` / `doctor` / `build`. (This row used to say the refusal *names* `python rituals/harness.py tui`. It has not since P2, which removed the pointer rather than re-aiming it: a refusal naming a file this migration deletes is worse than one that simply says the screen does not exist. The row was factually stale for two phases, which is the argument for the Node-side gate.) | **`tests/unit/no_panel.test.mjs`**, which needs no Python and so outlives the cut: behavioural (faked `isTTY`, exit 1, no panel marks on stdout, and the refusal is the only line it writes) and structural — it fails if `js/tui.mjs` grows any of `?1049h`, `?1049l`, `?25l`, a literal ESC, `\x1b[`, `[`. `tests/test_tui_boundary.py` additionally proves the *reference* panel really paints — the positive control that stops the mark list being a set of strings nothing produces — and that half retires with it. Landing a real panel means deleting the structural test *first* and updating this row second. |
| 2 | **`_wrap_lines`** (`rituals/_harness_tui_draw.py`). Its only caller is `_tui_loop`, so it is callerless in the port and travels with row 1. **`textwrap.wrap` itself has CROSSED** — this row said "a stdlib payload with no Node twin … port it *with* the panel or not at all" until P1 made `--help` the caller that required it: `pyTextWrap` (`js/cli.mjs`) is a real port of it, driven by `formatHelp`. | `textwrap.wrap`: `tests/__snapshots__/textwrap.json` freezes the CPython answers (38 cases × widths 11..198, sha256 over the matrix) and `tests/pure_snapshot.test.mjs` replays them with no Python involved; while the reference lives, `tests/test_cli_reference.py::test_the_ports_line_breaker_is_textwrap_at_every_width` compares against the running interpreter. `_wrap_lines` itself is gated on the reference alone — there is nothing to compare against, and the row says so. |
| 3 | **`/api/pick-folder`.** Declined, never ported: it opens an OS-native folder dialog on the daemon host. `js/web/server.mjs` carries it in `DECLINED_POST`, a set distinct from `NOT_PORTED_POST` because "will never cross" is a different claim from "not yet". | Probed live, not merely declared: `tests/unit/web_server.test.mjs` drives the real dispatcher and requires POST → 501 and GET → *not* 501 (it must fall through to the SPA). **P3 moved the probe off the reference and kept it a probe** — the pair is what refuses the one-line collapse of the POST declarations back into the GET set, which leaves every exported set exactly as written and every set-reading test green. That collapse is now planted as **M23** in `tests/mutate.mjs` and killed, so the row's own argument is gated rather than asserted. The reference's own handler, `rituals/_web_server.py:179`, is what no test ever reached. |
| 4 | **`_win_user_path`'s registry-write success arm.** `link`/`unlink` edit the persistent user Path through PowerShell. No test in this repo may run that — the edit would outlive the suite. | The *failure* arm is reached honestly: `harness_golden`'s `unlink` cells hand the verb a PATH with no `powershell` on it, so both sides take the "said nothing about PATH" branch with the registry untouched. Everything that can be *wrong* lives in the pure `_win_user_path_script` / `winUserPathScript` half, and `tests/test_win_user_path.py` runs a corpus over both. That the spawn half carries no logic is **STATED**, in that file's docstring. **P3 asserted the stated half instead of describing it.** The argument for leaving the success arm ungated is that the spawn carries no logic — it hands `winUserPathScript`'s output to PowerShell and maps the outcome — and that claim lived only in a test docstring. `tests/unit/win_user_path.test.mjs`'s last test now checks it: one `spawnSync`, the builder's output passed through unchanged, no string work on the directory, and a statement ceiling. If logic drifts INTO the spawn the ungated region grows, and this is what refuses that. |
| 5 | ~~**`link`/`unlink`'s Unix arm.**~~ **CLOSED at P11.** It writes a `#!/bin/sh` shim into `~/.local/bin` — `_harness_lifecycle.py:406-421`, carrying a `# GENESEED_LINK_SHIM` marker and chmod 0755 — and it now has six cells of its own. (It *symlinked* `ROOT/geneseed` until P0/P1 Task 2b moved the reference onto the same written shim the port had; the `is_symlink()` branch survives at `:469-470` so `unlink` still removes a legacy symlink install, and no cell covers that branch.) The six include the `PATH` split (a substring test passes every other cell and fails `a-path-entry-that-merely-contains-the-dir`), the **marker check** that leaves a foreign `geneseed` alone — the decoy in `unlink-removes-a-shim-it-made-and-leaves-a-foreign-one-alone` is a regular file, not a symlink, so the marker is what has to reject it — and an explicit dir argument with a trailing slash. That last one found a live divergence: the reference builds a `Path` and the port kept the raw string, so `str(Path('/x/bin/'))` and `/x/bin/` disagreed in two messages and in the PATH comparison. Fixed in `js/link.mjs` with `pyPathStr`. | The group is now a UNION across the two platforms, declared in `harness_golden.PLATFORM_ONLY` and asserted from either host by `tests/test_hook_cli_parity.py::ThePlatformDeclaredCellsAreDeclared`: every id declared for this platform must be built, every id declared for the other must be absent, and neither half may be empty. `compare()` also PRINTS the half it is not running, so a run says what it skipped. |
| 6 | **The boot animation's call site.** `theme_anim.play_line` itself crossed; what is declared is that `js/setup.mjs` and `js/update.mjs` reach no panel. **Nothing about this row ever needed Python** — its subject is two JavaScript files — and until P3 its only gate was a Python test retiring at P4. | **`tests/unit/no_panel.test.mjs`** (was `tests/test_tui_boundary.py::test_neither_module_contains_anything_that_could_paint_a_screen`). Escape sequences, not the word "curses": the first draft looked for the word and failed on a *docblock*, and a structural gate that reads prose is a gate on the documentation — it would have been satisfied by deleting the paragraph that admits the gap. The Node version adds two things the Python had not. A **positive control**: the same scan run over `js/anim.mjs`, which paints by design and is excluded by name, must find a hit — otherwise a mark list that has stopped matching how this codebase spells an escape retires all three gates green. And a **literal ESC byte** among the marks, found by accident while falsifying the gate: the falsifying edit was appended with `printf`, which ate the backslash and wrote a real ESC, and every scan stayed green over a module that had just grown a screen-clear. A gate that knows the spellings of a character but not the character is a gate on a coding style. |

## Ungated, and honest about it

| # | The gap | Why nothing reaches it |
|---|---|---|
| 7 | **`_npm_build` / `npmBuild`** (`npm install && npm run build`). | A first-run-from-a-partial-checkout path; no cell can be in that state, because `web/dist/` is tracked. `tests/unit/web_daemon.test.mjs` asserts *that* — it re-derives the unreachability from `git ls-files`, so untracking `web/dist/index.html` fails the test instead of quietly making the arm live. **P3 added the second direction**: the file must also EXIST in the working tree, because tracked-but-absent is a real state in which the `ask` arm is reachable here and now while the tracking claim still holds. The two branches that are only reachable through it — the prompt's wording and EOF handling, and the `npm install` → `npm run build` order — are asserted as source and gated as **M25**. |
| 8 | **`_harness_supports` / `_stale_factory_hint`.** *(Recast as HISTORY in P3 — see the note under this table.)* | Cell-unreachable in the *reference* too, so there was never anything to compare against. Both are now **history rather than a gap**: their subject is a `rituals/harness.py` too old to know `upgrade`, dead-ending on argparse's `invalid choice`, and P4 deletes that file. `js/update.mjs` argues the absence out at the call site — the update step is an **import, not a spawn**, so there is no second program to be stale, no argparse to refuse, and no `invalid choice` to recognise. What DID have a live subject is the durable trace a failed step leaves, and it is now asserted absolutely by `tests/unit/update_steps.test.mjs` (persisted before it is printed, appended rather than overwritten, still returned when the log itself cannot be written). |
| 9 | **The web dispatcher's 501 arm.** | `NOT_PORTED_ACTIONS` and `NOT_PORTED_KINDS` are both empty, so no target exists to ask for a 501, and none can be borrowed: every remaining action either starts a job in the developer's checkout or writes a shim and edits the real user PATH. The claim now rests on `tests/unit/web_jobs.test.mjs` reading the set out of the module — a gate on a *declaration*, which is weaker than a probe, and is declared as such at both sites. **P3 moved the gate off the reference and did NOT upgrade the claim**: the successor still reads `NOT_PORTED_ACTIONS` and asserts it empty, and says in place that a new row there makes the 501 arm reachable again and obliges this row to become a probe. What *did* get stronger is the sibling declaration beside it — each of the three `INLINE_ACTIONS` now names a recorded cell that really drives the dispatcher, and the cell's existence is asserted on both corpus halves. |
| 10 | **`pyStrPath` / `pyPathStr`.** Two spellings of one translation in `js/generate.mjs`. | Ungated; the comment at the call site says so. `harness_golden` reads stderr through `subprocess`'s universal-newline decode and cannot see the difference the split is about. |
| 11 | **The Linux browser lookup answering FALSE.** `_web_first_ok`'s last step: the reference walks `webbrowser`'s registry (`$BROWSER`, `xdg-open`, `gio`, `gvfs-open`, a dozen browser binaries) and `js/menu.mjs`'s `browserAvailable` asks only whether `xdg-open` — the binary `openUrl` will actually run — is on PATH. On a box with `gio` and no `xdg-open` they disagree, which is what a WSL run measured. | The corpus in `tests/unit/web_first.test.mjs` SUPPLIES the input instead of inheriting it: an `xdg-open` stub on PATH plus `DISPLAY`, so the True arm is reached identically on every host, and a `no-display` row gates the Linux-only display refusal absolutely. Reaching the FALSE arm of the browser lookup needs a PATH with no `xdg-open` at all, which is not something a probe on Windows survives — so it stays ungated, here, rather than in a comment. |
| 12 | **The width sweep off one Unicode version.** `js/tui.mjs`'s `WIDE`/`COMBINING` tables are a snapshot of unidata **15.1.0** (declared as `DWIDTH_UNIDATA`); the sweep compares them against the running interpreter's live `unicodedata`. CPython 3.14 carries 16.0.0 and assigned U+0897 a combining class, so the sweep reports a divergence that is neither implementation's. | **The anchor is now the recording, and it outlives the interpreter.** `tests/__snapshots__/dwidth.json` carries all 527 runs, a sha256 over them, and the unidata version they were measured at; `tests/pure_snapshot.test.mjs` checks `DWIDTH_UNIDATA` against that declaration, asserts the constant NAMES a Unicode version at all — read out of `js/tui.mjs` by regex as well as imported — and replays the sweep with no Python involved. The `python-version` pin that used to hold this together retires with the live sweep: it existed because that sweep skipped itself when the runner's interpreter carried newer tables, and after the cut there is no interpreter in it. Regenerating the tables means moving the constant and re-recording the corpus together. |
| 13 | **`minute_stamp`, once the reference is gone.** `%Y-%m-%d %H:%M` off a naive `fromtimestamp` is LOCAL time, so the recorded answers carry the recording machine's UTC offset. There is no token to substitute — the offset is the answer's arithmetic, not a substring of it. | Each of the five cases carries a `guard` naming the UTC offset **at that instant** (so DST is part of the match, not an approximation), and `tests/pure_snapshot.test.mjs` recomputes it from `Date` before asserting. A replay in another zone SKIPS those cases and PRINTS how many it skipped — the width sweep's rule that a skip is not a pass. The live comparison in `tests/test_pure_function_parity.py` used to gate them everywhere; it is retired, so they are now gated only where the offsets agree, which on this project's CI is the `record-corpus` runner and not much else. That is the cost of the cut, taken deliberately: a case asserted in one zone and declared in the others beats one silently re-blessed to whatever zone last ran it. |

**On row 8, and the shape it is an example of.** A row whose only gate was a retiring Python
test silently demotes from ASSERTED to prose at the cut — which is the exact failure this file
exists to prevent. Row 8 is the first to be settled the other way instead: its *stale-factory*
half describes machinery the port cannot have, so it is recorded as history and the design
argument lives at the call site in `js/update.mjs`; its *durable trace* half had a live subject,
so it landed absolutely on the Node side **before** the Python that used to carry it goes. The
one thing still owed is a claim about the SOURCE rather than about behaviour: the reference's
step command names an interpreter and a `.py` where the port's names `process.execPath` and this
repo's own CLI, and P4's repo-wide no-python scan must name `js/update.mjs` when it is written.

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

## Handed to the next phase — three things P0/P1 froze that P2–P4 must decide

Not gaps in what the port proves: gaps that OPEN when the reference goes, created by the
recordings this branch took. They are here rather than in a phase note because the phase note
is per-machine and the decision has a deadline — the window in which both implementations
exist.

1. ~~**`cli.json` is now a frozen oracle as well as a runtime table, and P2 takes it back.**~~
   **SETTLED IN P2.** The three roles were split rather than ranked. The file MOVED — `git mv`,
   byte for byte, minus `source_sha256` — to **`js/cli-table.json`**, a product path
   `package.json`'s `files[]` already ships, and it is now the OWNED document: nothing generates
   it, `tests/gen_cli_reference.py` is gone, and so are `cliSourceDigest`/`cliReferenceProblems`
   and doctor's `cli` row, which hashed a file this migration deletes. The FROZEN ORACLE role
   was retired outright — `tests/__snapshots__/cli_reference.json` was byte-identical to the
   table, and a second copy that only `import harness` could ever re-record would have made
   every legitimate future edit an unblessable red. What replaces it is stronger while the
   parser lives: `tests/test_cli_reference.py` walks `build_argparser()` and asserts it equals
   the table field for field, catching a wrong `nargs` on a flag no cell exercises and a hand
   edit a digest could never see. Point 2 below is unchanged and is now the only role with a
   deadline.
2. **After P4 the 26 help fixtures cannot be re-recorded.** Adding or rewording a single CLI
   flag changes `formatHelp`'s output and reddens `tests/cli_help.test.mjs`, with no argparse
   left to ask. Either the CLI's help text becomes effectively immutable, or the fixtures get
   re-blessed from the port — which makes them a DETERMINISM check rather than a regression
   gate, the same degradation already flagged for `--idempotent`/`--deletion`. Neither is
   wrong; picking neither is.
3. **`record-corpus` stops working entirely at P4.** It is the only way to produce the `lf`
   halves, it is Linux-only and dispatch-only, and four of its steps run the reference (record
   the emit/CLI/web matrices, record the primitive corpus, the two `record_help.py`
   invocations). When `build.py` / `rituals/harness.py` go, so do the platform-independence
   gate and the record-twice rot detector. Whatever replaces those steps must be written while
   both implementations still exist — a port-recorded corpus proves nothing the port did not
   already believe.
