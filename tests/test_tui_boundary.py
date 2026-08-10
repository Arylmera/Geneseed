"""P7b — the panel is declared, and this is the file that makes the declaration checkable.

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
"""
from __future__ import annotations

import io
import json
import os
import shutil
import subprocess
import sys
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


def _drive_panel(keys, rows=24, cols=80) -> str:
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

    inv = {"agents": [{"name": "archivist", "desc": "keeps the record", "body": "One."}],
           "skills": [{"name": "audit", "desc": "checks", "body": "Two."}],
           "laws": [{"num": "I", "title": "Secrets", "body": "Never."}],
           "theme": "neutral"}
    win = _winterm._Window(io.StringIO(), rows=rows, cols=cols)
    win._msvcrt = _FakeMsvcrt(keys)
    harness._tui_loop(win, inv)
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
        self.assertEqual(self.rc, 1)
        self.assertIn("full-screen panel unavailable", self.stdout)
        self.assertIn("python rituals/harness.py tui", self.stdout,
                      "the refusal must name the entry that DOES have the panel, or it is "
                      "a dead end rather than a fallback")

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


if __name__ == "__main__":
    unittest.main()
