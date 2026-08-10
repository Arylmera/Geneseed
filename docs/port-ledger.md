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

*Verified at P9 against the tree, not against the previous note.*

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
| 5 | **`link`/`unlink`'s Unix arm.** It symlinks `ROOT/geneseed` into `~/.local/bin`. | `tests/harness_golden.py:_link_cells` returns `[]` on any non-Windows host, so on a Unix machine these two verbs have **no cells at all** — not a declared arm but an empty group. See *Not proven anywhere* below. |
| 6 | **The boot animation's call site.** `theme_anim.play_line` itself crossed; what is declared is that `js/setup.mjs` and `js/update.mjs` reach no panel. | `tests/test_tui_boundary.py::test_neither_module_contains_anything_that_could_paint_a_screen` — escape sequences, not the word "curses". The first draft looked for the word and failed on a *docblock*: a structural gate that reads prose is a gate on the documentation. |

## Ungated, and honest about it

| # | The gap | Why nothing reaches it |
|---|---|---|
| 7 | **`_npm_build` / `npmBuild`** (`npm install && npm run build`). | A first-run-from-a-partial-checkout path; no cell can be in that state, because `web/dist/` is tracked. `tests/test_web_daemon.py` asserts *that* — it re-derives the unreachability from `git ls-files`, so untracking `web/dist/index.html` fails the test instead of quietly making the arm live. |
| 8 | **`_harness_supports` / `_stale_factory_hint`.** | Cell-unreachable in the *reference* too, so there is nothing to compare against. Gated on the Python side alone by `tests/test_harness.py`; `js/update.mjs` declares the absence of a twin. |
| 9 | **The web dispatcher's 501 arm.** | `NOT_PORTED_ACTIONS` and `NOT_PORTED_KINDS` are both empty, so no target exists to ask for a 501, and none can be borrowed: every remaining action either starts a job in the developer's checkout or writes a shim and edits the real user PATH. The claim now rests on `tests/test_web_jobs.py` reading the set out of the module — a gate on a *declaration*, which is weaker than a probe, and is declared as such at both sites. |
| 10 | **`pyStrPath` / `pyPathStr`.** Two spellings of one translation in `js/generate.mjs`. | Ungated; the comment at the call site says so. `harness_golden` reads stderr through `subprocess`'s universal-newline decode and cannot see the difference the split is about. |

## Not proven anywhere, and worth knowing before a release

* **The three cell harnesses have only ever run on Windows.** CI (`.github/workflows/ci.yml`)
  runs `doctor`, the Python unit suite and `node --test` on Linux *and* Windows, but it does
  not run `golden.py`, `harness_golden.py` or `web_golden.py` at all. Every claim in this
  file about "the port is byte-identical" is a claim about one operating system.
* **`link` and `unlink` have zero cells on a Unix host** (row 5), so a Unix CI run would not
  cover them even if the harnesses were added to it.
* **The reference is load-bearing.** `golden.py` defaults `--ref` to `build.py`;
  `harness_golden.py` and `web_golden.py` default to `rituals/harness.py`. Deleting the
  Python implementation deletes the thing the port is measured against. `package.json`
  ships both for independent reasons — see `tests/test_package_manifest.py`, where every
  shipped path carries its argument.
