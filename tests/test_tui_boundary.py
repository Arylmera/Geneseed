"""P7b/P7c — the panel is declared, and this is the file that makes the declaration checkable.

`js/tui.mjs` carries the TUI's layout half and refuses the panel. Saying "the panel is P7c's"
costs nothing; this file is what makes it a measurement. It asserts the boundary from BOTH
sides, because either half alone is satisfied by something broken:

  * THE REFERENCE DOES OPEN A PANEL, and it opens one HERE. This is the half that P7a's
    handoff said was impossible ("`curses` is NOT importable on this machine — the
    reference's own panel cannot run here"), and the measurement that dissolved it is that
    `rituals/_harness_core.py` installs `rituals/_winterm.py` as `sys.modules["curses"]` when
    the real module is missing. `_winterm` is not a Windows terminal layer BESIDE curses; on
    Windows it IS curses, and `_Window` takes a stream and a pinned geometry and reads keys
    through an instance attribute. So the panel is drivable in-process, which is what
    `tests/test_winterm.py`'s `ScreenIntegrationTests` has quietly been doing all along.
    Without this half, "the port does not draw a panel" is a claim about a panel nobody
    proved exists.

  * THE PORT NEVER OPENS ONE, with `isTTY` FAKED TRUE. Every cell in `tests/harness_golden.py`
    runs off a TTY, so `cmd_tui`'s first arm is the only one they reach and the arm this file
    is about is invisible to all of them. Faking the TTY is the same move the corpus makes for
    `_web_first_ok`, and for the same reason: it is the one input no cell can vary.

WHY THIS IS NOT A "SILENT ON SUCCESS" GATE. The fifth coverage hole this port found was code
that printed only on a fault no cell could create, and was therefore deletable with nothing
noticing. The assertions below are the opposite shape: they name what the reference PRODUCES
and require the port to produce a specific different thing, so deleting either implementation
turns this red rather than quiet. `test_the_reference_panel_is_not_an_empty_string` is the
positive control that keeps the absence assertions from passing vacuously.

⚠ NOT A TTY, AND NOT `< /dev/null`. On Windows, Python reports a redirect from the null
device as a TTY — a previous session tried it against `setup` and rebuilt the machine's live
install. Nothing here redirects stdin; the reference half drives the panel in-process and the
port half assigns `process.stdin.isTTY` in the child.

--------------------------------------------------------------------------------------
P7C ADDED THE OTHER TWO CURSES ARMS, AND THE MEASUREMENT THAT MERGED THEM WITH THIS ONE.

The plan named four P7c leftovers — `cmd_setup`'s curses arm, `theme_anim.play_line`,
`_doctor_collect(on_progress=)` and "`_tui_inventory`'s consumers in
`_harness_tui_views.py`" — and P8bc handed over a fifth, `cmd_bootstrap`'s curses arm. Two of
those five are not what their names say:

  * **`_tui_inventory` HAS NO CONSUMER IN `_harness_tui_views.py`.** Not one reference to it
    in all 750 lines. Its five real consumers (`_harness_menu`, `_harness_status`,
    `_harness_tui`, `_web_core`, `_web_graph`) all crossed in P5d/P6c/P6h/P7a/P7b. The bullet
    counted a filename, not a call.
  * **THE OTHER THREE ARE ONE CLOSURE WITH THREE NAMES.** `cmd_setup`'s arm is
    `curses.wrapper(_setup_flow)`; `_setup_flow` is `_setup_tui` then `_grow_flow`;
    `_grow_flow` calls `_run_steps` — which IS `cmd_bootstrap`'s step runner — then
    `_themed_reveal`, `_info_screen`, and finally `_doctor_view`, which is the ONLY caller
    of `_doctor_collect(on_progress=)` in the repo. So porting any one of them ports all of
    them, and all of them are the `(stdscr, curses, pal)` panel this file already declares.

So P7c re-declares the panel rather than growing a second one, and extends the assertion to
name the two additional entrances. The FRESH argument, which P7b did not have and could not
have made: the port's `setup` and `bootstrap` do not have a curses arm that FALLS BACK — they
have no second arm at all. `js/setup.mjs` and `js/update.mjs` run the line/plain
implementation on a TTY and off one alike, which is the reference's own documented fallback
("Falls back to line prompts on Windows / no-TTY / any curses failure"), reached
unconditionally. A Node panel would need a Node `_winterm` as well, and nothing in this
project could compare the two: `_drive_panel` below drives the REFERENCE through PYTHON's
`_winterm`, and a second implementation would be checked against a hand-written expectation
on both sides — a re-implementation graded by itself.

`theme_anim.play_line` is the one leftover that is NOT the panel: it is the LINE mode's
animation, its only caller is `_setup_lines`, which crossed in P5i, and P7c ports it into
`js/anim.mjs` under `tests/test_pure_function_parity.py`'s corpus. It deliberately does not
go into `js/tui.mjs`, so
`ThePortNeverOpensAPanel.test_the_arm_is_unreachable_by_construction_and_not_by_luck`
below survives P7c UNCHANGED and still means what it says: the TUI module has no screen.
"""
from __future__ import annotations

import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))
sys.path.insert(0, str(ROOT / "rituals"))

import golden  # noqa: E402
# The shim install, run the way the harness runs it — see `_drive_panel`'s docstring for
# what happens when this is done as a save/restore around the import instead.
import _harness_core  # noqa: E402,F401

NODE = shutil.which("node")

#: What a full-screen panel necessarily leaves in a byte stream. `wrapper()` writes the first
#: two before the first draw and undoes them after the last; the rest are what `_tui_loop`
#: itself paints. A port that opened a panel could avoid any ONE of these; it could not avoid
#: all of them and still have drawn a screen.
_PANEL_MARKS = ("\x1b[?1049h", "\x1b[?25l", "AGENTS (", "SKILLS (", "LAWS (")


def setUpModule() -> None:
    # `_tui_inventory` renders the whole bundle in-process, and a render is one import away
    # from an emit; no test module may write the developer's real `~/.claude` or shim.
    golden.sandbox_process_home()


def tearDownModule() -> None:
    golden.restore_process_home()


class _FakeMsvcrt:
    """`msvcrt`'s two methods, replaying a scripted key list — `_winterm._Window.getch`
    reads them through `self._msvcrt`, which is an instance attribute for exactly this.

    ⚠ IT NEVER RUNS OUT, AND THAT IS NOT CONVENIENCE — IT IS THE FIX FOR A HANG THIS FILE
    SHIPPED WITH FOR AN HOUR. The first draft answered `kbhit() -> bool(self._chars)` and
    popped from the list, which is the obvious shape and is a DEADLOCK: `_winterm._Window.
    getch` in blocking mode is `while not mv.kbhit(): time.sleep(0.005)`, so the moment the
    script runs dry the panel waits for a key that can never come. Nothing times it out.

    It did not hang when this module was run ALONE, which is what made it dangerous. The
    class set `GENESEED_TUI_ASCII` in `setUpClass` to suppress the splash animation — but
    `_harness_tui_draw._TUI_ANIM` is a module constant read at IMPORT time, and running the
    module alone imports it after the environment is set, while running it inside
    `unittest discover` imports `harness` several modules earlier and the assignment lands
    too late to mean anything. That is this project's "the fixture SETS a variable" hole
    exactly: a fixture whose effect depends on import order passes in isolation and hangs
    the whole suite. The full suite sat for fifteen minutes with no output.

    So the tier is no longer manipulated at all — nothing asserted here depends on it — and
    the script is a PREFIX rather than the whole input: once it is spent every further read
    answers `q`, which every screen in the panel treats as leave. The panel can consume as
    many keys as it likes (the splash polls for one) and still terminate.
    """

    def __init__(self, chars):
        self._chars = list(chars)
        self.past_the_script = 0

    def kbhit(self) -> bool:
        return True

    def getwch(self) -> str:
        if self._chars:
            return self._chars.pop(0)
        self.past_the_script += 1
        return "q"


#: The inventory `_drive_panel` uses unless a test names another one.
_INV = {"agents": [{"name": "archivist", "desc": "keeps the record", "body": "One."}],
        "skills": [{"name": "audit", "desc": "checks", "body": "Two."}],
        "laws": [{"num": "I", "title": "Secrets", "body": "Never."}],
        "theme": "neutral"}

#: A tree with nothing in it. Reachable from a broken or half-synced `src/`, and the input
#: that found the crash P7b recorded and P7c fixed — see
#: `TheEmptyInventoryDrawsAnEmptyStateInsteadOfCrashing`.
_INV_EMPTY = {"agents": [], "skills": [], "laws": [], "theme": "neutral"}


def _drive_panel(keys, rows=24, cols=80, inv=None) -> str:
    """Run the REFERENCE's `_tui_loop` headlessly and return the VT bytes it wrote.

    THE SHIM IS INSTALLED AND LEFT INSTALLED, and the first draft of this helper is why it
    is worth a paragraph. It saved `sys.modules.get("curses")`, set the shim, and popped the
    key again if the save had been `None` — which it always was, because the save happened
    BEFORE `import harness`, and `import harness` is what runs `_harness_core`'s shim
    install. So the helper uninstalled the shim the harness had just put there, and the next
    bare `import curses` in the process re-ran the stdlib package and raised. A save/restore
    around a module that installs the thing being saved restores the wrong state.

    So `_harness_core` is imported at module scope above, exactly as the harness does it,
    and this helper only pins the geometry and the keys. On a host with a real `curses` the
    shim is still forced for the duration: `_Window` writes to a stream and takes its keys
    from an attribute, and no real curses can be driven that way — this is the same thing
    `tests/test_winterm.py`'s `ScreenIntegrationTests` has always done.
    """
    import _winterm

    sys.modules["curses"] = _winterm
    _winterm._reset_pairs()
    import harness

    win = _winterm._Window(io.StringIO(), rows=rows, cols=cols)
    win._msvcrt = _FakeMsvcrt(keys)
    harness._tui_loop(win, _INV if inv is None else inv)
    return win._stream.getvalue()


class TheReferenceDrawsAPanelOnThisMachine(unittest.TestCase):
    """The half P7a's handoff said could not be run here."""

    @classmethod
    def setUpClass(cls):
        # NO TIER MANIPULATION HERE — see `_FakeMsvcrt`'s docstring. Nothing this class
        # asserts depends on the glyph tier, and the assignment that used to be here was
        # a no-op inside `unittest discover` that hid a deadlock.
        cls.out = _drive_panel(["q"])

    def test_curses_resolves_to_the_windows_shim_when_the_real_one_is_absent(self):
        """The measurement itself, asserted rather than described. On a Unix host this is
        the stdlib module and the test says so; on this one it is `rituals/_winterm.py`, and
        that is what makes every other assertion in this file possible."""
        import _harness_core  # noqa: F401  (installs the shim as a side effect)
        import curses

        if curses.__name__ == "_winterm":
            self.assertEqual(Path(curses.__file__).name, "_winterm.py")
        else:  # pragma: no cover — a host with a real curses
            self.assertTrue(hasattr(curses, "wrapper"))

    def test_the_panel_paints_its_sections_and_its_frame(self):
        for mark in ("AGENTS (1)", "SKILLS (1)", "LAWS (1)"):
            self.assertIn(mark, self.out)
        self.assertIn("\x1b[2J", self.out, "the panel never cleared the screen")
        # A cursor-position escape per drawn row — the thing a plain print cannot produce.
        self.assertIn("\x1b[1;1H", self.out)

    def test_the_reference_panel_is_not_an_empty_string(self):
        """The positive control for the whole file. Every absence assertion in
        `ThePortNeverOpensAPanel` is satisfied by a reference that drew nothing at all, and
        the driver returning `''` would be the easy way for this to rot into a no-op."""
        self.assertGreater(len(self.out), 500,
                           "the reference panel produced almost no output, so the absence "
                           "assertions in this file are not measuring anything")
        self.assertGreater(self.out.count("\x1b["), 50)

    def test_the_panel_reads_the_keys_it_is_given(self):
        """The other control: `q` is what ENDS the loop, so a driver whose keys were ignored
        would hang rather than return — but a loop that returned immediately without reading
        would also produce a screen. Two navigation keys before the quit must change what is
        drawn, or the panel is a static banner and this file proves nothing about it."""
        one = _drive_panel(["q"])
        moved = _drive_panel(["j", "j", "q"])
        self.assertNotEqual(one, moved,
                            "moving the selection changed nothing in the drawn bytes")


@unittest.skipIf(NODE is None, "node is not on PATH")
class ThePortNeverOpensAPanel(unittest.TestCase):
    """The declaration, asserted. With `isTTY` faked TRUE — the input no cell can give."""

    @classmethod
    def setUpClass(cls):
        # A child, not this process: `process.stdin.isTTY` has to be set before `cmdTui`
        # reads it, and the CLI entry is a module with side effects at import.
        script = (
            "process.stdin.isTTY = true;"
            "const { cmdTui } = await import('file://' + process.argv[1]);"
            "const rc = cmdTui();"
            "process.stderr.write(JSON.stringify({ rc }));"
        )
        proc = subprocess.run(
            [NODE, "--input-type=module", "-e", script, "--",
             str(ROOT / "js" / "tui.mjs")],
            capture_output=True, cwd=str(ROOT),
            env=dict(os.environ, PYTHONUTF8="1"))
        cls.stdout = proc.stdout.decode("utf-8")
        cls.rc = json.loads(proc.stderr.decode("utf-8"))["rc"]

    def test_on_a_tty_it_refuses_and_says_where_the_panel_is(self):
        """THE NAME OF THIS TEST IS NOW HALF WRONG, and that is the finding rather than an
        oversight: there is nowhere to send the reader. The refusal used to end "run `python
        rituals/harness.py tui` for the panel", which was a real fallback while the panel
        existed. It is the Python this migration deletes, so P2 took the pointer out instead
        of re-aiming it — a refusal naming a file that will not be there is worse than one
        that simply says the screen does not exist.

        What is asserted instead is that the refusal still OFFERS something: the three verbs
        that do work off a panel. Dropping that clause too would leave a bare "unavailable",
        which is the dead end this test was written to forbid."""
        self.assertEqual(self.rc, 1)
        self.assertIn("full-screen panel unavailable", self.stdout)
        self.assertNotIn("harness.py", self.stdout,
                         "the refusal may not name a file this migration deletes")
        self.assertIn("Use `harness setup`, `doctor`, or `build`.", self.stdout,
                      "the refusal must still offer what DOES work, or it is a dead end "
                      "rather than a fallback")

    def test_it_leaves_none_of_a_panel_behind(self):
        """The load-bearing half. Each mark is something a drawn panel necessarily writes,
        and the reference half of this file proves each one is really produced over there."""
        for mark in _PANEL_MARKS:
            with self.subTest(mark=mark):
                self.assertNotIn(mark, self.stdout)

    def test_the_refusal_is_the_only_thing_it_writes(self):
        """A port that printed the refusal and THEN tried to draw would pass the two rows
        above if its panel failed early enough to write nothing recognisable. One line is
        one line."""
        self.assertEqual(len(self.stdout.strip().splitlines()), 1)

    def test_the_arm_is_unreachable_by_construction_and_not_by_luck(self):
        """The structural half, and the reason it is here: the two behavioural tests above
        say the panel was not drawn ON THIS RUN. This one says there is nothing that could
        have drawn it — no alt-screen escape and no cursor-positioning anywhere in the
        module, which is the same shape of check P4e used to refute a passthrough.

        When P7c lands a real window this test is the one that must be deleted, and its
        failure is the reminder to update this file's declaration rather than to delete the
        assertion quietly."""
        src = (ROOT / "js" / "tui.mjs").read_text(encoding="utf-8")
        for seq in ("?1049h", "?1049l", "?25l", "\\x1b[", "\\u001b["):
            with self.subTest(seq=seq):
                self.assertNotIn(seq, src,
                                 f"js/tui.mjs contains {seq!r} — it has grown a screen, and "
                                 f"this file still declares that it has none")


class TheEmptyInventoryDrawsAnEmptyStateInsteadOfCrashing(unittest.TestCase):
    """P7b found this with a corpus entry and left it for the phase that owns `_tui_loop`.

    `rituals/_harness_tui.py`:614 was

        wrapped = _wrap_lines(_detail_lines(kind, label, data), riw)

    and `_detail_lines` returns **None** for a `head` row while `_wrap_lines` iterates its
    argument. Line 556 normally moves `sel` onto the first SELECTABLE row, so a head row is
    never selected — but line 554 is `if not selectable: sel = 0`, and row 0 is always the
    AGENTS header. An inventory with no agents, no skills and no laws therefore crashed the
    panel on its FIRST FRAME with `TypeError: 'NoneType' object is not iterable`.

    THE FIX IS AT THE CALL SITE AND NOT IN `_detail_lines`, and that is the whole of the
    root-cause question here. `_detail_lines` returning `None` for a head row is its
    documented contract, it is gated as such by
    `tests/test_pure_function_parity.py`'s `detail_lines` corpus on BOTH implementations, and
    line 614 is its ONLY call site in the repo — so one `or []` there fixes every caller
    there is, and changing the function would have broken a gated contract to fix one of its
    consumers.

    THE PORT NEEDS NO FIX. `js/tui.mjs`'s `detailLines` reproduces the `null` return and has
    no caller, because the loop that would call it is the declared panel. The defect is the
    reference's alone, which is why the assertion below is ABSOLUTE about the reference
    rather than a comparison: a comparison between an implementation that crashes and one
    that does not exist proves nothing.
    """

    def test_a_tree_with_nothing_in_it_still_paints_a_frame(self):
        out = _drive_panel(["q"], inv=_INV_EMPTY)
        self.assertIn("\x1b[2J", out, "the empty panel never cleared the screen")
        self.assertIn("AGENTS (0)", out)
        self.assertIn("SKILLS (0)", out)
        self.assertIn("LAWS (0)", out)

    def test_the_empty_panel_is_a_real_frame_and_not_a_stub(self):
        """The positive control. `assertIn` above is satisfied by a panel that drew three
        headers and gave up; the crash was on the DETAIL pane, which is drawn after them."""
        out = _drive_panel(["q"], inv=_INV_EMPTY)
        self.assertIn(" Detail ", out,
                      "the right pane never got drawn — the crash was one line into it")
        self.assertGreater(out.count("\x1b["), 50)

    def test_the_selection_is_the_head_row_which_is_what_made_it_crash(self):
        """Names the precondition rather than trusting it: with nothing selectable, `sel`
        stays 0 and row 0 is the AGENTS header, so the detail pane is asked to render a
        `head` entry. If `_tui_entries` ever stops emitting a header for an empty section
        this test goes green for the wrong reason, so it re-derives the fact."""
        import harness

        entries = harness._tui_entries(_INV_EMPTY)
        self.assertTrue(entries, "an empty inventory produced no rows at all")
        self.assertEqual(entries[0][0], "head")
        self.assertFalse([e for e in entries if e[0] != "head"],
                         "something in the empty inventory is selectable — the crash's "
                         "precondition no longer holds and this test is measuring nothing")
        kind, label, data = entries[0]
        self.assertIsNone(harness._detail_lines(kind, label, data),
                          "`_detail_lines` no longer returns None for a head row — the fix "
                          "at _harness_tui.py:614 is now guarding nothing")


class TheReferenceHasTwoMoreCursesArmsAndTheyAreTheSameClosure(unittest.TestCase):
    """P7c's declaration, from the reference's side: `setup` and `bootstrap` DO enter curses.

    Neither arm is RUN here, and that is deliberate rather than timid. `_setup_flow` reaches
    `_run_steps([sys.executable, BUILD, ...])` and `_bootstrap_progress` reaches `git pull`
    plus a re-exec; driving either against this checkout would rebuild or update the
    developer's tree, which is the accident P5i's handoff recorded when `< /dev/null` was
    read as a TTY. What the declaration needs is not the flow's output but the ARM SELECTION
    — that a TTY sends the reference into `curses.wrapper` and the port has nowhere to go —
    so `wrapper` is replaced by a recorder that runs nothing and reports what it was handed.
    """

    @staticmethod
    def _arm(fn, ns):
        import _winterm

        sys.modules["curses"] = _winterm
        import harness

        class _Stdin:
            def isatty(self):
                return True

        seen = []
        real_wrapper, real_stdin = _winterm.wrapper, sys.stdin
        # The recorder returns False: `cmd_bootstrap` reads the return as "a step failed",
        # and False is the success answer, so the code after the arm runs as it would.
        _winterm.wrapper = lambda f, *a, **k: (seen.append(getattr(f, "__name__", repr(f))),
                                               False)[1]
        sys.stdin = _Stdin()
        try:
            rc = fn(ns)
        finally:
            _winterm.wrapper, sys.stdin = real_wrapper, real_stdin
        return seen, rc

    def test_setup_on_a_tty_enters_the_curses_setup_flow(self):
        import argparse

        import harness

        seen, rc = self._arm(harness.cmd_setup, argparse.Namespace())
        self.assertEqual(seen, ["_setup_flow"])
        self.assertEqual(rc, False)

    def test_bootstrap_on_a_tty_enters_the_curses_progress_screen(self):
        import argparse

        import harness

        # `no_setup=True` is load-bearing: without it `cmd_bootstrap` ends in `os.execv`
        # and replaces this test process with a setup wizard.
        seen, rc = self._arm(harness.cmd_bootstrap,
                             argparse.Namespace(ref=None, no_setup=True))
        self.assertEqual(seen, ["_bootstrap_progress"])
        self.assertEqual(rc, 0)

    def test_the_three_named_leftovers_are_one_closure_and_not_three(self):
        """The measurement the declaration rests on, re-derived instead of quoted. If any of
        these edges is ever cut, `setup`'s arm stops implying bootstrap's runner or the
        progress callback, the leftovers really are separate, and this test says so."""
        import inspect

        import harness

        def calls(fn):
            return inspect.getsource(fn)

        self.assertIn("_setup_tui", calls(harness._setup_flow))
        self.assertIn("_grow_flow", calls(harness._setup_flow))
        grow = calls(harness._grow_flow)
        self.assertIn("_run_steps", grow, "setup's flow no longer uses bootstrap's runner")
        self.assertIn("_doctor_view", grow)
        self.assertIn("_run_steps", calls(harness._bootstrap_progress))
        self.assertIn("on_progress", calls(harness._doctor_view))

    def test_doctor_collect_s_progress_callback_has_exactly_one_caller(self):
        """`_doctor_collect(on_progress=)` is declared because its only consumer is the
        panel. That is a claim about every module that could call it, so every one is read.

        `rituals/*.py` ONLY, and the first draft's inclusion of `js/**/*.mjs` is why the
        scope is spelled out: `js/web/api.mjs` mentions `on_progress=` in the paragraph where
        P6 declared it, and a scan that counts a DECLARATION as a CALLER is a gate that gets
        greener the less the code admits."""
        callers = [p.name for p in sorted(ROOT.glob("rituals/*.py"))
                   if "on_progress=" in p.read_text(encoding="utf-8")]
        self.assertEqual(callers, ["_harness_build.py", "_harness_tui_views.py"],
                         "a new caller of on_progress= appeared; the declaration that it is "
                         "the panel's alone no longer holds")

    def test_tui_inventory_is_not_consumed_by_the_views_module_at_all(self):
        """The bullet the plan wrote, measured. It names a file that never mentions it."""
        views = (ROOT / "rituals" / "_harness_tui_views.py").read_text(encoding="utf-8")
        self.assertNotIn("_tui_inventory", views)


@unittest.skipIf(NODE is None, "node is not on PATH")
class ThePortHasNoCursesArmToFallBackFrom(unittest.TestCase):
    """P7c's declaration, from the port's side, and it is a different claim from P7b's.

    `js/tui.mjs` REFUSES on a TTY — one line, exit 1 — because the reference's `tui` has
    nothing else to do without a panel. `setup` and `bootstrap` are not like that: their
    non-curses path is a complete, shipping implementation that the reference itself falls
    back to on Windows, and the port simply takes it unconditionally. So the assertion here
    is not "it refuses" but "there is no branch": the TTY path produces the LINE wizard.
    """

    #: DECLINE EVERY PROMPT. Not "six defaults then n" — that spelling counted the wizard's
    #: questions, and the count is not a constant. `_wizard` asks `Repo root to install into`
    #: only for the four PROJECT emits and `Output dir for the bundle` only for `files`, so the
    #: number of readers before `Proceed? (Y/n)` depends on which install mode is the default
    #: on the machine under test. Measured, not reasoned about: this developer's Windows box
    #: asks four `Choose` + one root prompt, and a Linux box asks five `Choose` and no root —
    #: so the sixth `\n` landed on `Proceed?`, took its default (**yes**), and the `n` went to
    #: `Run a health check (doctor) now?` instead. The wizard ran to completion and emitted a
    #: full install into the sandbox HOME. That is `_DECLINE`'s own warning below happening a
    #: second time, from a new direction, and the first Linux run of this suite is what found
    #: it.
    #:
    #: `n` is a safe answer to every reader here and that is what makes the repetition sound:
    #: `askChoice` falls back to its default for an unrecognised answer (no re-prompt loop),
    #: `ask` returns the literal string for the two free-text prompts — never used, because
    #: the run is cancelled — and `confirm` reads it as NO. Twelve is comfortably more than
    #: the seven any path asks; the surplus is never read.
    #:
    #: The original note, which is still the reason this is spelled at all:
    #:
    #: ⚠ THE FIRST DRAFT PASSED `b""` AND RAN A 99-FILE BUILD INTO THE CHECKOUT. The reasoning
    #: was that an immediate EOF is the inert input and would cancel the wizard. It is the
    #: opposite: every reader falls back to its DEFAULT on EOF, and the last default is
    #: `Proceed? (Y/n)` → **yes**. So the emptiest possible stdin is the most AGREEABLE one,
    #: and it drove theme/posture/mode/emit/footprint/root all the way through to
    #: `driverMain` and then to `cmdDoctor`. This is P5i's `< /dev/null` hole wearing a new
    #: costume — that one was "a null device reads as a TTY", this one is "no answer reads as
    #: the default answer" — and the general rule behind both is that **an interactive
    #: component has no inert input; declining is an ANSWER and has to be spelled.**
    _DECLINE = b"n\n" * 12

    @classmethod
    def setUpClass(cls):
        # TWO INDEPENDENT GUARDS, because the first draft of this class proved one is not
        # enough. (1) stdin DECLINES rather than defaults — see `_DECLINE`. (2) the child's
        # cwd is a temp dir, so the wizard's `Repo root to install into [.]` resolves there
        # and a future edit that gets past the decline lands in the sandbox instead of in the
        # developer's checkout. HOME is already the module-level sandbox and the child
        # inherits it, which is what kept the machine's real shim out of the first accident.
        script = (
            "process.stdin.isTTY = true;"
            "const { cmdSetup } = await import('file://' + process.argv[1]);"
            "const rc = cmdSetup();"
            "process.stderr.write(JSON.stringify({ rc }));"
        )
        with tempfile.TemporaryDirectory() as td:
            proc = subprocess.run(
                [NODE, "--input-type=module", "-e", script, "--",
                 str(ROOT / "js" / "setup.mjs")],
                capture_output=True, cwd=td, input=cls._DECLINE,
                env=dict(os.environ, PYTHONUTF8="1"))
        cls.stdout = proc.stdout.decode("utf-8")
        cls.stderr = proc.stderr.decode("utf-8")
        cls.rc = json.loads(proc.stderr.decode("utf-8"))["rc"] if proc.stderr else None

    def test_setup_on_a_tty_runs_the_line_wizard_and_not_a_panel(self):
        self.assertIn("Theme", self.stdout,
                      f"the wizard never printed a prompt; stderr was {self.stderr!r}")
        for mark in _PANEL_MARKS[:3]:      # the frame marks are `tui`'s, not the wizard's
            with self.subTest(mark=mark):
                self.assertNotIn(mark, self.stdout)

    def test_the_wizard_cancelled_and_wrote_nothing(self):
        """The safety assertion, and it is the one that failed first — see `_DECLINE`. It is
        kept as a test rather than a comment so a future edit that lets this class BUILD
        something fails here instead of in the developer's checkout."""
        self.assertIn("cancelled — nothing written", self.stdout)
        self.assertEqual(self.rc, 0)
        self.assertNotIn("Running:", self.stdout,
                         "the wizard reached the build — the decline is not declining")

    def test_the_decline_does_not_depend_on_how_many_questions_are_asked(self):
        """The structural half, and the one that would have caught the Linux failure without
        a Linux machine. An empty line in this stream is not a neutral filler — it is the
        DEFAULT answer, and the default at `Proceed?` is yes. So padding the stream with
        newlines makes the safety of this class a function of how many questions the wizard
        happens to ask on the host running it, which is not a constant. Every answer must be
        an explicit `n`."""
        answers = self._DECLINE.split(b"\n")
        self.assertEqual(answers[-1], b"", "_DECLINE must end with a newline, or its last "
                                           "answer is never submitted")
        self.assertEqual(set(answers[:-1]), {b"n"},
                         "a blank answer in _DECLINE is a DEFAULT, and one of the defaults "
                         "this wizard offers is `Proceed? (Y/n)` -> yes. (Discarding every "
                         "empty element before this comparison is exactly the mistake: the "
                         "empties ARE the padding under test.)")

    def test_neither_module_contains_anything_that_could_paint_a_screen(self):
        """The structural half, in the shape P7b established for `js/tui.mjs` and P4e for the
        passthrough refutation. `js/anim.mjs` is deliberately NOT in this list: `play_line`
        is the line mode's animation, it writes `\\x1b[nA` cursor moves by design, and it is
        the one P7c leftover that crossed. It is excluded by name, not by omission.

        THE MARKS ARE ESCAPE SEQUENCES AND NOT THE WORD "curses". The first draft included
        the word, and `js/update.mjs` failed it — in the docblock where P8b DECLARED the
        bootstrap arm. A structural gate that reads prose is a gate on the documentation:
        it would have been satisfied by deleting the paragraph that admits the gap."""
        for rel in ("js/setup.mjs", "js/update.mjs"):
            src = (ROOT / rel).read_text(encoding="utf-8")
            for seq in ("?1049h", "?1049l", "?25l", "\\x1b[", "\\u001b["):
                with self.subTest(module=rel, seq=seq):
                    self.assertNotIn(seq, src,
                                     f"{rel} contains {seq!r} — it has grown a panel, and "
                                     f"this file still declares that it has none")


if __name__ == "__main__":
    unittest.main()
