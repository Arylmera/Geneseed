# Limits — what this tool does not prove about itself

Geneseed is one implementation: `bin/`, `js/`, `adapters/`. It used to be two. Until the 2.0
re-layout there was a second, older implementation beside it, and three cell harnesses ran both
and compared every byte either one wrote plus both streams and the exit code. That second party
is deleted. What survives it is a **recording**: the answers it gave, frozen under
`tests/__snapshots__/`, replayed by `tests/golden.mjs`, `tests/cli_golden.mjs` and
`tests/web_golden.mjs` against the code that ships.

This file is the standing answer to *"what does this tool not prove about itself?"* It is kept
beside the code rather than in a phase note, because phase notes are per-machine and this
outlives them.

Each row says whether the limit is **ASSERTED** — there is a test that fails if it closes or
widens without this file changing — or **STATED**, meaning the claim rests on prose and nothing
enforces it. Prefer asserting. A structural gate must read *code*, never the paragraph that
admits the limit, or deleting the paragraph is a way to pass it.

**New in the 2.0 re-layout**, and each is checked against the tree rather than inherited from the
previous version of this document:

* **Limit zero** below — the corpus proves *unchanged*, never *correct* — promoted from a bullet
  to the frame every other row sits inside, because with the second party gone it now governs all
  of them.
* **Row 1** — there is no full-screen panel at all any more, on any path. Not "unported": absent.
* **Row 3** — `/api/pick-folder` still exists as a declared decline and a live 501, but there is
  no longer a handler anywhere for it to be declined *against*.
* **Row 12** — the width tables are pinned by a recorded hash and a declared Unicode version, not
  by a live Unicode oracle.

---

## ⚠ Limit zero — the corpus proves UNCHANGED, never CORRECT

Every replay in this repository compares today's answer against a recorded one. That is a
regression gate and it is a good one. It is **not** a correctness gate, and the difference is the
whole subject of this file.

The recording was taken from an implementation that **agreed with this one at the time it was
taken**. Where the two agreed and were both right, the corpus freezes a right answer. Where the
two agreed and were both wrong, the corpus freezes the agreement — and there is no longer a
second party who could disagree. A cross-implementation comparison was already structurally blind
to a defect both sides shared; the recording inherited that blindness and made it permanent.

So: a green replay says *"this code still answers what it answered on 2026-08-17."* It says
nothing about whether that answer was ever the right one. Everything below is the standing list of
where that matters and of the branches nothing reaches at all.

## ⚠ The corpus is frozen — recorded 2026-08-17, replay-only from here

**The recordings under `tests/__snapshots__/` can never be taken again.** They were produced by the
reference implementation and by nothing else; every program that has ever written a cell is
deleted, and the three Node replayers reject `--record` by design. The dispatch-only CI job that
produced the `lf` halves is gone from `.github/workflows/ci.yml` in the same history, so the
workflow did not outlive the reference it drove.

The last recording was taken deliberately, immediately after the edits that had to be made while
an oracle still existed — the emitted prose that named files the deletion removes, the removal of
the web API's interpreter field, the three verbs the reference never had, and the release-label
destamp that stops a version bump from reddening a corpus nobody can re-bless. Everything after
that point may only be checked against those bytes.

**The consequence, ASSERTED by the replayers themselves:** a change that moves a recorded byte is
a **finding, not a step**. There is no re-bless. If a replay goes red the choice is to revert the
change or to argue, in writing, that the recording was wrong — and nothing can settle that
argument any more.

**What the last recording fixed, and what a reader should know it cost.** The two platform halves
had drifted apart for a reason that had nothing to do with either implementation: the `crlf` half
had captured a stale `Harness/` — this repository's own dogfooded install, which is **gitignored
build output** — so `doctor` reported seven stale renders on the machine that recorded it and none
on CI, and the two platforms disagreed permanently. The final recording was taken with that
directory absent, which is the state a fresh clone has. **A stale local build tree moves recorded
bytes; an absent or freshly built one does not.** Anyone comparing the halves should know they now
agree because that input was removed, not because it was ever normalised.

### The one hand-edit ever made to a recorded file

**2026-08-17 — `tests/__snapshots__/primitives/{win32,posix}.json`, the `note` field of three cases
each, edited by hand to repoint `docs/port-ledger.md` at `docs/limits.md`.** It was safe for a
reason that has to be re-checked before anyone ever does it again, not quoted as a precedent:
`note` is **never compared as an answer**. `tests/pure_snapshot.test.mjs`'s replay loop compares
`result` and `result_ascii` and reads nothing else from a case; the only claim on `note` is the
assertion that every noted case's note names this document, and that assertion was updated to the
new filename rather than dropped — *a note that quietly stops being emitted is a bug that quietly
becomes an unremarked-on fact.* Nothing that any replay treats as an answer was touched, and the
edit was verified to move only `note` lines.

**This is an exception, not a precedent.** The next person who wants to hand-edit a recording
should assume the answer is no and re-derive the whole argument above for their own field.

## Frozen residue — true statements that are now permanently unfixable

Four things in this repository are wrong, known to be wrong, and **cannot be corrected**, because
correcting them would move a byte in a corpus with no recorder left. They are listed so a future
reader finds a decision here rather than concluding nobody looked.

- **`js/tui.mjs` and `js/menu.mjs` end a refusal with ``Use `harness setup`, `doctor`, or `build`.``**
  `harness` was the reference's argparse program name and now names nothing. Both strings are
  recorded in the CLI corpus. Changing either reddens cells that can never be re-recorded.
- **`tests/__snapshots__/primitives/{win32,posix}.json` freeze `[authoring] _web_core prose says …`**
  across five cases, naming a module the cut deleted. Frozen evidence about a program that no
  longer exists — accurate as a record of what the reference answered, misleading as a description
  of today.
- **`js/cli-table.json`'s `tui` help still promises a "full-screen curses control panel"** for a
  verb that returns 1 on every path. The help corpus is frozen at the 26 texts argparse rendered,
  so this string has no oracle to be corrected against. The verb's actual output is honest; only
  its help is not.
- **`tests/helpers/matrix/*.json` — 6 files — are permanently un-regenerable.** Their only producer
  was the reference's matrix exporter. The committed copies are the last export, and
  `tests/unit/hook_cli.test.mjs` reads both halves of them to derive the platform union.
- **`tests/__snapshots__/token_report_primitives.json` names `js/lib/pyfs.mjs`** in one recorded
  `why` field, and this release renamed that file to `js/lib/fs.mjs`. **This one was left alone on
  purpose, and the reasoning is the point:** `why` is never compared — it is interpolated into a
  failure message — so editing it would have been *safe*. Nothing *forced* it. The one hand-edit of a
  recording this release did make (the `note` fields, below) was forced: an assertion matched on
  those strings and would have gone stale. **Reserve editing a recording for when an assertion
  demands it, not for when it is merely harmless**, or the exception becomes the rule and the corpus
  stops being evidence.

The first three share one shape: **a string is cheap to fix right up until it is recorded, and then
it is not fixable at all.** That is the cost of freezing a corpus, paid knowingly.

## What IS covered

All 25 subcommands, 29 of 29 web paths, 5 of 5 docs kinds. Every `NOT_PORTED*` table in `js/web/`
is empty and stays declared as the empty half of a partition — the shape that makes the next
missing thing visible instead of silently absent.

## Declared, with an assertion

| # | The limit | Where it is asserted |
|---|---|---|
| 1 | **There is no full-screen panel.** Not unported — absent. `js/tui.mjs`'s `cmdTui` has two arms and **both print and return 1**: off a TTY it says so, on one it says the entry carries the TUI's layout half and not its screens. The reference's panel — its loop, its eighteen screens, its `(stdscr, curses, pal)` drawing helpers, its Windows console window, its menus, the curses arms of `setup` and `bootstrap`, and `doctor`'s progress callback — is deleted with the implementation that had it. **The comparison half of this row is history**: there is no panel to declare a gap against. What is live is the claim about the shipping code, and it is a claim about ABSENCE, which is the kind a structural gate can hold. (This row used to say the refusal *names* the interpreter-and-script invocation of the panel. It has not since P2, which removed the pointer rather than re-aiming it: a refusal naming a file this migration deletes is worse than one that simply says the screen does not exist. The row was factually stale for two phases, which is the argument for reading the gate out of the code rather than out of the prose.) | **`tests/unit/no_panel.test.mjs`**, which needs nothing but the port: behavioural (faked `isTTY`, exit 1, no panel marks on stdout, and the refusal is the only line it writes) and structural — it fails if `js/tui.mjs` grows any of `?1049h`, `?1049l`, `?25l`, a literal ESC, `\x1b[`, `[`. **What is NOT asserted and cannot be**: that a panel, if one were written, would work. The positive control that used to prove the reference panel really painted — the thing that stopped the mark list being a set of strings nothing produces — retired with the reference. The Node file replaces it with a control of its own (see row 6), which proves the marks still match how *this* codebase spells an escape, not that any panel exists. Landing a real panel means deleting the structural test **first** and updating this row second. |
| 2 | **`_wrap_lines`, the panel's line wrapper.** Its only caller was the panel loop, so it travels with row 1 and is now history along with it. **`textwrap.wrap` itself CROSSED** — this row said "a stdlib payload with no Node twin … port it *with* the panel or not at all" until P1 made `--help` the caller that required it: `pyTextWrap` (`js/cli.mjs`) is a real port of it, driven by `formatHelp`. | `tests/__snapshots__/textwrap.json` freezes the CPython answers (38 cases × widths 11..198, sha256 over the matrix) and `tests/pure_snapshot.test.mjs` replays them with no interpreter anywhere on the machine. The live comparison against a running `textwrap` retired with the reference, so **limit zero applies here in its sharpest form**: the matrix is 38 cases wide and one CPython version deep, and a wrap CPython itself later changes is a divergence this repository cannot see. The corpus declares which side of gh-139065 it was recorded on, precisely so it cannot be mistaken for one frozen against the behaviour CPython already fixed. |
| 3 | **`/api/pick-folder` will never exist here.** It opens an OS-native folder dialog on the daemon host, which is a GUI dependency and a sixth allowed-spawn row for a modal window. `js/web/server.mjs` carries it in `DECLINED_POST`, a set kept distinct from `NOT_PORTED_POST` because "will never cross" is a different claim from "not yet". **What changed in this phase**: there is no longer anything on the other side to decline. The reference's own handler is deleted, so this stopped being a comparison between an endpoint that exists over there and one that does not exist here, and became simply a documented, permanent 501 — and it is the ONLY member of either set, which makes it the last live target the dispatcher's 501 arm has (see row 9). | Probed live, not merely declared: `tests/unit/web_server.test.mjs` drives the real dispatcher and requires POST → 501 and GET → *not* 501 (it must fall through to the SPA). That pair is what refuses the one-line collapse of the POST declarations back into the GET set, which would leave every exported set exactly as written and every set-reading test green. The collapse is planted as **M23** in `tests/mutate.mjs` and killed, so the row's own argument is gated rather than asserted. |
| 4 | **`_win_user_path`'s registry-write success arm.** `link`/`unlink` edit the persistent user Path through PowerShell. No test in this repo may run that — the edit would outlive the suite, the checkout and the machine. | The *failure* arm is reached honestly: the `unlink` cells hand the verb a PATH with no `powershell` on it, so the code takes the "said nothing about PATH" branch with the registry untouched. Everything that can be *wrong* lives in the pure `winUserPathScript` half, and `tests/__snapshots__/win_user_path.json` is a recorded corpus over it, replayed by `tests/pure_snapshot.test.mjs` on every platform (the builder reads nothing host-shaped, and a non-Windows run is what measures that). That the spawn half carries no logic used to be **STATED**, in a test docstring; `tests/unit/win_user_path.test.mjs`'s last test now checks it — one `spawnSync`, the builder's output passed through unchanged, no string work on the directory, and a statement ceiling. If logic drifts INTO the spawn the ungated region grows, and this is what refuses that. |
| 5 | ~~**`link`/`unlink`'s Unix arm.**~~ **CLOSED at P11.** It writes a `#!/bin/sh` shim into `~/.local/bin` carrying a `# GENESEED_LINK_SHIM` marker and chmod 0755, and it has six cells of its own. (It *symlinked* `ROOT/geneseed` until P0/P1 Task 2b; the `is_symlink()` branch survives so `unlink` still removes a legacy symlink install, and **no cell covers that branch** — the one piece of this row still open.) The six include the `PATH` split (a substring test passes every other cell and fails `a-path-entry-that-merely-contains-the-dir`), the **marker check** that leaves a foreign `geneseed` alone — the decoy is a regular file, not a symlink, so the marker is what has to reject it — and an explicit dir argument with a trailing slash. That last one found a live divergence: the reference built a `Path` and the port kept the raw string, so `str(Path('/x/bin/'))` and `/x/bin/` disagreed in two messages and in the PATH comparison. Fixed in `js/link.mjs` with `pyPathStr`. | The group is a UNION across the two platforms. `tests/cli_golden.mjs`'s `platformDeclarationProblems` travels with the matrix and asserts, on every replay and on both operating systems in CI, that every id declared for this platform is built, every id declared for the other is absent, and neither half is empty; it also PRINTS the half it did not run, so a run says out loud what it skipped. The two directions that need to read **both** halves at once live in `tests/unit/hook_cli.test.mjs`. |
| 6 | **The boot animation's call site.** `playLine` itself is exercised; what is declared is that `js/setup.mjs` and `js/update.mjs` reach no panel. **Nothing about this row ever needed a second implementation** — its subject is two JavaScript files — and until P3 its only gate was a test that retired with the reference. | **`tests/unit/no_panel.test.mjs`**. Escape sequences, not the word "curses": the first draft looked for the word and failed on a *docblock*, and a structural gate that reads prose is a gate on the documentation — it would have been satisfied by deleting the paragraph that admits the limit. It carries two things its predecessor had not. A **positive control**: the same scan run over `js/anim.mjs`, which paints by design and is excluded by name, must find a hit — otherwise a mark list that has stopped matching how this codebase spells an escape retires all three gates green. And a **literal ESC byte** among the marks, found by accident while falsifying the gate: the falsifying edit was appended with `printf`, which ate the backslash and wrote a real ESC, and every scan stayed green over a module that had just grown a screen-clear. A gate that knows the spellings of a character but not the character is a gate on a coding style. |

## Ungated, and honest about it

| # | The limit | Why nothing reaches it |
|---|---|---|
| 7 | **`npmBuild`** (`npm install && npm run build`). | A first-run-from-a-partial-checkout path; no cell can be in that state, because `web/dist/` is tracked. `tests/unit/web_daemon.test.mjs` asserts *that* — it re-derives the unreachability from `git ls-files`, so untracking `web/dist/index.html` fails the test instead of quietly making the arm live. It also asserts the file must EXIST in the working tree, because tracked-but-absent is a real state in which the `ask` arm is reachable here and now while the tracking claim still holds. The two branches only reachable through it — the prompt's wording and EOF handling, and the `npm install` → `npm run build` order — are asserted as source and gated as **M25**. |
| 8 | **The stale-factory probe.** *(HISTORY, not a live limit.)* | Its subject was a reference CLI too old to know `upgrade`, dead-ending on argparse's `invalid choice` — a program that no longer exists. `js/update.mjs` argues the absence out at the call site: the update step is an **import, not a spawn**, so there is no second program to be stale, no argparse to refuse, and no `invalid choice` to recognise. The half that DID have a live subject is the durable trace a failed step leaves, and it is asserted absolutely by `tests/unit/update_steps.test.mjs` — persisted before it is printed, appended rather than overwritten, still returned when the log itself cannot be written. |
| 9 | **The web dispatcher's 501 arm, for anything but one path.** | `NOT_PORTED_ACTIONS`, `NOT_PORTED_KINDS` and `NOT_PORTED_POST` are all empty, so `/api/pick-folder` (row 3) is the only target the arm has left, and no second one can be borrowed: every remaining action either starts a job in the developer's checkout or writes a shim and edits the real user PATH. The action-side claim therefore rests on `tests/unit/web_jobs.test.mjs` reading the set out of the module — **a gate on a declaration, which is weaker than a probe**, and is declared as such at both sites. A new row in that set makes the arm reachable again and obliges this row to become a probe. What is stronger is the sibling declaration beside it: each of the three `INLINE_ACTIONS` names a recorded cell that really drives the dispatcher, and the cell's existence is asserted on both corpus halves. |
| 10 | **`pyStrPath` / `pyPathStr`.** Two spellings of one translation in `js/generate.mjs`. | Ungated; the comment at the call site says so. The recorded CLI cells read stderr through a universal-newline decode and cannot see the difference the split is about. |
| 11 | **The Linux browser lookup answering FALSE.** The reference walked `webbrowser`'s registry (`$BROWSER`, `xdg-open`, `gio`, `gvfs-open`, a dozen browser binaries); `js/menu.mjs`'s `browserAvailable` asks only whether `xdg-open` — the binary `openUrl` will actually run — is on PATH. On a box with `gio` and no `xdg-open` they disagreed, which is what a WSL run measured. | The corpus in `tests/unit/web_first.test.mjs` SUPPLIES the input instead of inheriting it: an `xdg-open` stub on PATH plus `DISPLAY`, so the True arm is reached identically on every host, and a `no-display` row gates the Linux-only display refusal absolutely. Reaching the FALSE arm needs a PATH with no `xdg-open` at all, which is not something a probe on Windows survives — so it stays ungated, here, rather than in a comment. **The divergence it names is now permanent** and belongs in `docs/declined.md`'s territory rather than this file's: with the reference gone, `browserAvailable`'s answer is simply the answer, and nothing can say it is the wrong one. |
| 12 | **The width tables are pinned by a HASH, not by a live oracle.** `js/tui.mjs`'s `WIDE`/`COMBINING` tables are a snapshot of unidata **15.1.0** (declared as `DWIDTH_UNIDATA`). Nothing in this repository consults a live Unicode database any more — there is none to consult — so what the sweep proves is that the tables have not moved since they were recorded, and **not** that they encode any Unicode version correctly. This was already true of the CPython comparison in one direction (3.14 carries 16.0.0 and assigned U+0897 a combining class, so the old live sweep reported a divergence that was neither implementation's); it is now true in both. | `tests/__snapshots__/dwidth.json` carries all 527 runs, a sha256 over them, and the unidata version they were measured at; `tests/pure_snapshot.test.mjs` checks `DWIDTH_UNIDATA` against that declaration, asserts the constant NAMES a Unicode version at all — read out of `js/tui.mjs` by regex **as well as** imported, so the gate cannot be satisfied by deleting the declaration and supplying the value some other way — and replays the sweep. The document self-checks against its own hash first, so a hand-edited `rle` is not accepted as an oracle. The interpreter pin that used to hold this together retired with the live sweep. Regenerating the tables means moving the constant and re-recording the corpus **together**, and re-recording is exactly what is no longer possible: **new tables would have to arrive with a new corpus recorded from the port itself, which is a determinism check and not a regression gate.** |
| 13 | **`minuteStamp`'s recorded answers carry the recording machine's clock.** `%Y-%m-%d %H:%M` off a naive local-time conversion, so the frozen answers hold one UTC offset. There is no token to substitute — the offset is the answer's arithmetic, not a substring of it. | Each of the five cases carries a `guard` naming the UTC offset **at that instant** (so DST is part of the match, not an approximation), and `tests/pure_snapshot.test.mjs` recomputes it from `Date` before asserting. A replay in another zone SKIPS those cases and PRINTS how many it skipped — the width sweep's rule that a skip is not a pass. The live comparison that used to gate them everywhere is retired, so they are gated only where the offsets agree, which is not many machines. That is the cost of the cut, taken deliberately: a case asserted in one zone and declared in the others beats one silently re-blessed to whatever zone last ran it. |

**On row 8, and the shape it is an example of.** A row whose only gate was a retiring test silently
demotes from ASSERTED to prose at a deletion — which is the exact failure this file exists to
prevent. Row 8 was the first to be settled the other way instead: its *stale-factory* half
describes machinery this tool cannot have, so it is recorded as history and the design argument
lives at the call site in `js/update.mjs`; its *durable trace* half had a live subject, so it landed
absolutely on the Node side **before** the code that used to carry it went. Rows 1, 2 and 12 are
now settled the same way, and row 3's history half with them.

## Not proven anywhere, and worth knowing before a release

* ~~**The three cell harnesses have only ever run on Windows.**~~ **FIXED at P11**, and widened in
  the 2.0 re-layout: the `node-cells` job in `.github/workflows/ci.yml` replays all three corpora
  on **`ubuntu-latest` AND `windows-latest`** on every push, and `validate` (doctor plus the whole
  Node suite) runs on both as well. The budget argument that kept the old comparison job
  Linux-only does not carry over — a replay is a single spawn per cell — and the `crlf` half of
  the corpus has no other replayer at all. What the first Linux run found, recorded because it is
  the honest measure of what one-platform testing hides:
  * The POSIX shim's `"$@"` was read as a path, so every healthy install's hooks were reported
    dead — **a user-visible `doctor` bug on every Linux and macOS install**, in both
    implementations, plus 112 of 259 golden cells and four `--validate-only` tests. Fixed at the
    single owner.
  * A POSIX re-exec called `execv` without flushing, so `bootstrap` discarded everything it had
    printed since the last spawn — a redirected `bootstrap` lost its completion line on every Unix
    run. Windows has no `exec` and never reaches the line; a terminal hides it because line
    buffering had already written it.
  * A cell driver left the interpreter a bare name, which `CreateProcess` resolves against the
    PARENT's PATH and `execvpe` does not — so any cell that replaces PATH could not spawn the
    candidate at all off Windows.
  * A wizard decline was POSITIONAL (six newlines, then `n`), and the wizard does not ask a fixed
    number of questions. Off Windows the `n` landed one prompt late, the wizard proceeded, and it
    emitted a whole install into the sandbox HOME.
  * Two web `expect_re`s named Windows' case-folded catalog order as if it were the only one.
  * The `link`/`unlink` Unix arm (row 5) and the browser step (row 11).
* **What the first WINDOWS CI run found, and what the harnesses now guarantee.** The same argument,
  one platform over: PR #78's first run was green on a Windows laptop and in WSL, and red on
  `windows-latest`. Every finding was an environment the developer's machine could not produce, so
  each fix carries a gate that MANUFACTURES the environment rather than one that waits for a runner
  to supply it.
  * **Sandbox paths are CANONICAL.** GitHub's Windows runner spells `TEMP` as the 8.3 alias
    `C:\Users\RUNNER~1\…`; the generator resolves it, so every destamp root matched nothing and the
    raw sandbox name leaked into 45 byte comparisons — and `git-gate/sovereign-bypass` went VACUOUS
    because the excludes entry it seeds stopped matching a resolved cwd. `tests/helpers/sandbox.mjs`
    is the one owner for all three replayers. POSIX reaches the same duality through symlinks and
    the gates build one there.
  * **`resolveOut` was `path.resolve` where the reference resolved** — a defect the aliasing exposed
    and a canonicalising fixture would have hidden. Now `pyResolve`, the twin that already existed
    for this and is used at nine other sites.
  * **`pyWhich` did not reproduce the current-directory rule.** `NoDefaultCurrentDirectoryInExePath`
    is an INPUT, Git Bash defines it and the runner does not. The corpus reached the branch and
    never varied the variable; `tests/pure_snapshot.test.mjs` now drives both states and asserts
    that exactly one of fifteen answers moves, and which.
  * **A locale-decoded child stdout** in a Windows-path test, which this repo's `PYTHONUTF8=1`
    runbook had been making accidentally right.
  * **A temp-directory cleanup race killed the Linux job** after it had compared 270 of 318 cells;
    the same commit passed on re-run. A sandbox teardown cannot raise.
* ~~**The reference is load-bearing.**~~ **HISTORY.** The replayers used to default to the reference
  as their `--ref`; there is no `--ref` left to default. What replaced it is limit zero: the
  recording is now the only second party, and it cannot be asked a new question.
* **Nothing measures the corpus's own coverage from the outside.** The claims that stop a corpus
  quietly ceasing to exercise a function it still names — the fence really varies, the diff reaches
  past 200 elements, a splitlines case breaks where `split('\n')` does not, a capitalize case where
  the rest matters, a `len` case where code points and UTF-16 units differ, both arms of every
  two-valued decision — all live in `tests/pure_snapshot.test.mjs` and are written by hand. They
  are the best thing available and they are a list somebody maintains, not a measurement.

## Standing decisions the cut handed forward

Not limits on what the tool proves: limits that OPENED when the reference went, created by the
recordings the cut took. They are here rather than in a phase note because the phase note is
per-machine.

1. ~~**`cli.json` is a frozen oracle as well as a runtime table.**~~ **SETTLED IN P2.** The roles
   were split rather than ranked. The file MOVED — byte for byte, minus its source digest — to
   **`js/cli-table.json`**, a product path `package.json` already ships, and it is now the OWNED
   document: nothing generates it, and the generator, the digest and doctor's row for it are gone.
   The FROZEN ORACLE role was retired outright: the recorded copy was byte-identical to the table,
   and a second copy nothing could re-record would have made every legitimate future edit an
   unblessable red.
2. **The 26 help fixtures cannot be re-recorded.** Adding or rewording a single CLI flag changes
   `formatHelp`'s output and reddens `tests/cli_help.test.mjs`, with no argparse left to ask.
   Either the CLI's help text becomes effectively immutable, or the fixtures get re-blessed from
   the port — which makes them a DETERMINISM check rather than a regression gate, the same
   degradation `--idempotent`/`--deletion` already carry. Neither is wrong; picking neither is.
   **This is limit zero with a deadline**, and it is the live one.
3. ~~**`record-corpus` stops working entirely.**~~ **DONE, and it is what makes item 2 sharp.** The
   job is deleted from `.github/workflows/ci.yml`. With it went the platform-independence gate and
   the record-twice rot detector: the two recorded platform halves ARE the platform table now, and
   nothing re-derives them. A replacement had to be written while both implementations still
   existed — a port-recorded corpus proves nothing the port did not already believe — and what was
   written instead is the two-OS `node-cells` job above, which replays rather than records.
