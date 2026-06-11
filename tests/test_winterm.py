"""Unit tests for the Windows VT curses shim (rituals/_winterm.py). Stdlib only.

Run from the Geneseed root:  python -m unittest discover -s tests

The shim emulates the bounded `curses` subset used by harness.py on a VT-capable
Windows console. These tests exercise the pure pieces (SGR generation, key
translation, coordinate math) plus the getch state machine and wrapper lifecycle
with an injected fake `msvcrt` / stubbed VT-enable, so they run on any OS.
"""

import io
import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "rituals"))
import _winterm  # noqa: E402


class KeyConstantTests(unittest.TestCase):
    def test_special_keys_are_distinct_ints_above_byte_range(self):
        keys = [_winterm.KEY_UP, _winterm.KEY_DOWN, _winterm.KEY_HOME,
                _winterm.KEY_END, _winterm.KEY_NPAGE, _winterm.KEY_PPAGE,
                _winterm.KEY_ENTER, _winterm.KEY_BACKSPACE]
        for k in keys:
            self.assertGreater(k, 255, "special keys must not collide with byte ords")
        self.assertEqual(len(set(keys)), len(keys), "special keys must be distinct")


class TranslateKeyTests(unittest.TestCase):
    """getwch() returns 1-char strings; extended keys arrive as a \\x00/\\xe0
    prefix followed by a second char. _translate_key maps to curses-style codes."""

    def test_plain_chars_return_their_ordinal(self):
        self.assertEqual(_winterm._translate_key("q", None), ord("q"))
        self.assertEqual(_winterm._translate_key(" ", None), ord(" "))

    def test_escape_enter_backspace_match_harness_comparisons(self):
        # harness compares ESC==27, Enter in (10,13,...), Backspace in (8,127,...)
        self.assertEqual(_winterm._translate_key("\x1b", None), 27)
        self.assertEqual(_winterm._translate_key("\r", None), 13)
        self.assertEqual(_winterm._translate_key("\x08", None), 8)

    def test_extended_arrows_and_pages_map_to_sentinels(self):
        cases = {"H": _winterm.KEY_UP, "P": _winterm.KEY_DOWN,
                 "G": _winterm.KEY_HOME, "O": _winterm.KEY_END,
                 "I": _winterm.KEY_PPAGE, "Q": _winterm.KEY_NPAGE}
        for second, expected in cases.items():
            self.assertEqual(_winterm._translate_key("\xe0", second), expected)
            self.assertEqual(_winterm._translate_key("\x00", second), expected)

    def test_unknown_extended_key_is_ignored(self):
        self.assertEqual(_winterm._translate_key("\xe0", "\x99"), -1)


class SgrTests(unittest.TestCase):
    def setUp(self):
        _winterm._reset_pairs()

    def test_default_attr_emits_no_styling(self):
        self.assertEqual(_winterm._sgr(0), "")

    def test_standalone_attributes(self):
        self.assertEqual(_winterm._sgr(_winterm.A_BOLD), "\x1b[1m")
        self.assertEqual(_winterm._sgr(_winterm.A_DIM), "\x1b[2m")
        self.assertEqual(_winterm._sgr(_winterm.A_REVERSE), "\x1b[7m")

    def test_color_pair_foreground_default_background(self):
        # init_pair(4, YELLOW, -1) -> fg 33, no bg (default)
        _winterm.init_pair(4, _winterm.COLOR_YELLOW, -1)
        self.assertEqual(_winterm._sgr(_winterm.color_pair(4)), "\x1b[33m")

    def test_color_pair_with_background_and_bold(self):
        # init_pair(2, BLACK, CYAN) | A_BOLD -> bold + fg30 + bg46
        _winterm.init_pair(2, _winterm.COLOR_BLACK, _winterm.COLOR_CYAN)
        token = _winterm.color_pair(2) | _winterm.A_BOLD
        self.assertEqual(_winterm._sgr(token), "\x1b[1;30;46m")

    def test_color_pairs_are_orable_ints(self):
        _winterm.init_pair(1, _winterm.COLOR_CYAN, -1)
        self.assertIsInstance(_winterm.color_pair(1) | _winterm.A_BOLD, int)


class WindowDrawTests(unittest.TestCase):
    def _win(self):
        return _winterm._Window(io.StringIO(), rows=24, cols=80)

    def test_addnstr_positions_cursor_one_based(self):
        w = self._win()
        w.addnstr(2, 5, "hi")
        w.refresh()
        # curses (0,0) origin -> VT (1,1): row 3, col 6
        self.assertIn("\x1b[3;6H", w._stream.getvalue())

    def test_addnstr_truncates_to_n_columns(self):
        w = self._win()
        w.addnstr(0, 0, "abcdefgh", 3)
        w.refresh()
        out = w._stream.getvalue()
        self.assertIn("abc", out)
        self.assertNotIn("abcd", out)

    def test_getmaxyx_returns_rows_cols(self):
        self.assertEqual(self._win().getmaxyx(), (24, 80))

    def test_erase_clears_screen(self):
        w = self._win()
        w.erase()
        w.refresh()
        self.assertIn("\x1b[2J", w._stream.getvalue())


class WindowAcsTests(unittest.TestCase):
    """Box glyphs reach hline/vline as `ACS_* | attr` (a packed chtype int), and reach
    addch as either a 1-char str or an ACS int. The shim must decode glyph + style."""

    def setUp(self):
        _winterm._reset_pairs()

    def _win(self):
        return _winterm._Window(io.StringIO(), rows=24, cols=80)

    def test_hline_renders_acs_glyph_n_times(self):
        w = self._win()
        w.hline(1, 2, _winterm.ACS_HLINE, 4)
        w.refresh()
        out = w._stream.getvalue()
        self.assertIn("\x1b[2;3H", out)   # (1,2) -> one-based (2,3)
        self.assertIn("─" * 4, out)

    def test_hline_renders_ascii_ord_glyph(self):
        w = self._win()
        w.hline(0, 0, ord("-"), 3)        # ASCII-mode glyph from _bx
        w.refresh()
        self.assertIn("-" * 3, w._stream.getvalue())

    def test_hline_decodes_attr_packed_into_glyph(self):
        _winterm.init_pair(1, _winterm.COLOR_RED, -1)
        w = self._win()
        w.hline(0, 0, _winterm.ACS_HLINE | _winterm.color_pair(1), 2)
        w.refresh()
        out = w._stream.getvalue()
        self.assertIn("\x1b[31m", out)    # red foreground from the packed pair
        self.assertIn("─" * 2, out)

    def test_vline_renders_down_the_column(self):
        w = self._win()
        w.vline(0, 0, _winterm.ACS_VLINE, 3)
        w.refresh()
        out = w._stream.getvalue()
        for row in ("\x1b[1;1H", "\x1b[2;1H", "\x1b[3;1H"):
            self.assertIn(row, out)
        self.assertEqual(out.count("│"), 3)

    def test_addch_accepts_str_acsint_and_ord(self):
        w = self._win()
        w.addch(0, 0, "+")
        w.addch(0, 1, _winterm.ACS_ULCORNER)
        w.addch(0, 2, ord("|"))
        w.refresh()
        out = w._stream.getvalue()
        self.assertIn("+", out)
        self.assertIn("┌", out)
        self.assertIn("|", out)


class FakeMsvcrt:
    """Scripted msvcrt stand-in. `hits` is a queue of kbhit() return values;
    `chars` is a queue of getwch() return values."""
    def __init__(self, hits, chars):
        self._hits = list(hits)
        self._chars = list(chars)

    def kbhit(self):
        return self._hits.pop(0) if self._hits else False

    def getwch(self):
        return self._chars.pop(0)


class GetchTests(unittest.TestCase):
    def _win(self, fake):
        w = _winterm._Window(io.StringIO(), rows=24, cols=80)
        w._msvcrt = fake
        return w

    def test_blocking_getch_returns_translated_key(self):
        w = self._win(FakeMsvcrt(hits=[False, True], chars=["k"]))
        w.timeout(-1)  # blocking
        self.assertEqual(w.getch(), ord("k"))

    def test_nodelay_returns_minus_one_when_no_key(self):
        w = self._win(FakeMsvcrt(hits=[False], chars=[]))
        w.nodelay(True)  # timeout 0
        self.assertEqual(w.getch(), -1)

    def test_timeout_returns_minus_one_after_deadline(self):
        w = self._win(FakeMsvcrt(hits=[False, False, False], chars=[]))
        w.timeout(10)  # ms
        self.assertEqual(w.getch(), -1)

    def test_extended_key_consumes_two_getwch_calls(self):
        w = self._win(FakeMsvcrt(hits=[True], chars=["\xe0", "H"]))
        w.timeout(-1)
        self.assertEqual(w.getch(), _winterm.KEY_UP)


class WrapperTests(unittest.TestCase):
    def test_wrapper_enters_and_restores_screen(self):
        buf = io.StringIO()
        with mock.patch.object(_winterm, "enable_vt", lambda stream: (lambda: None)):
            with mock.patch.object(sys, "stdout", buf):
                _winterm.wrapper(lambda scr: scr.addnstr(0, 0, "x"))
        out = buf.getvalue()
        self.assertIn("\x1b[?1049h", out)   # enter alt screen
        self.assertIn("\x1b[?1049l", out)   # leave alt screen
        self.assertIn("\x1b[?25l", out)     # hide cursor
        self.assertIn("\x1b[?25h", out)     # show cursor

    def test_curs_set_is_silent_without_an_active_window(self):
        # Outside a wrapper() session there is no screen to act on; curs_set must not
        # leak escapes to the real stdout (keeps test/headless output pristine).
        buf = io.StringIO()
        _winterm._ACTIVE = None
        with mock.patch.object(sys, "stdout", buf):
            _winterm.curs_set(0)
            _winterm.curs_set(1)
        self.assertEqual(buf.getvalue(), "")

    def test_wrapper_restores_on_exception(self):
        buf = io.StringIO()
        restored = []
        with mock.patch.object(_winterm, "enable_vt",
                               lambda stream: (lambda: restored.append(True))):
            with mock.patch.object(sys, "stdout", buf):
                with self.assertRaises(ValueError):
                    _winterm.wrapper(lambda scr: (_ for _ in ()).throw(ValueError("boom")))
        self.assertEqual(restored, [True], "console mode must be restored on error")
        self.assertIn("\x1b[?1049l", buf.getvalue())


class ScreenIntegrationTests(unittest.TestCase):
    """End-to-end: drive a real harness screen (`_menu`) through the shim with scripted
    input and an in-memory stream. The shim is installed as `curses` for the duration so
    harness' internal `import curses` calls resolve to it too — so this runs on any OS
    and exercises the full draw stack (palette, box, list rows, getch loop)."""

    def setUp(self):
        self._saved = sys.modules.get("curses")
        sys.modules["curses"] = _winterm
        _winterm._reset_pairs()
        import harness  # noqa: F401  (rituals/ already on sys.path)
        self.harness = harness

    def tearDown(self):
        if self._saved is not None:
            sys.modules["curses"] = self._saved
        else:
            sys.modules.pop("curses", None)

    def test_menu_renders_options_and_returns_selection(self):
        win = _winterm._Window(io.StringIO(), rows=24, cols=80)
        # 'j' moves the highlight down to the 2nd option, Enter selects it.
        win._msvcrt = FakeMsvcrt(hits=[True, True], chars=["j", "\r"])
        options = [("a", "Alpha", "the first option"),
                   ("b", "Beta", "the second option")]
        result = self.harness._menu(win, _winterm, "Pick one", options)
        out = win._stream.getvalue()
        self.assertEqual(result, "b")
        self.assertIn("Alpha", out)
        self.assertIn("Beta", out)
        self.assertIn("Pick one", out)            # the top bar prompt rendered
        self.assertTrue("─" in out or "│" in out)  # box frame drawn via ACS glyphs

    def test_menu_cancels_on_q(self):
        win = _winterm._Window(io.StringIO(), rows=24, cols=80)
        win._msvcrt = FakeMsvcrt(hits=[True], chars=["q"])
        options = [("a", "Alpha", "the first option")]
        self.assertIsNone(self.harness._menu(win, _winterm, "Pick", options))


if __name__ == "__main__":
    unittest.main()
