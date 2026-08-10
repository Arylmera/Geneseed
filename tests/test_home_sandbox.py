"""No test module may emit into the DEVELOPER'S real home.

THE DEFECT THIS EXISTS FOR. `_build_settings._write_hook_shim()` runs on every emit and
writes `<home>/.geneseed/bin/geneseed-hook[.cmd]` — the machine-wide shim every installed
Geneseed hook execs — at a path that comes from the ENVIRONMENT (`GENESEED_HOME`, else
`Path.home()`) and never from the emit's own `--out` or `cfg=`. A test module that calls
`build.emit_claude_global(...)` in this process therefore rewrites the live shim of whatever
machine runs the suite.

AND IT LEAVES NO TRACE, which is why it survived ten phases of the Node port. A
Python-driven emit reproduces the body the shim already had, so `_write_hook_shim`'s
unchanged-content fast path takes and not even the mtime moves. Only a NODE-driven emit
bakes a different runner, and it is the one that made the damage visible — by then the
machine's shim was pointing at the wrong interpreter and every hook on the box was broken.

WHAT THE GATE CAN AND CANNOT SEE, stated rather than implied. `_ROUTED_BY_ANOTHER_PATH`
below is the honest half: the route into an emit is not always visible in a module's own
syntax — `tests/test_update.py` reaches one through `_update._rebuild_bundle`, which spawns
the generator, and no attribute walk over that file would name it. So this gate asserts the
DISCIPLINE (every at-risk module installs the sandbox) plus a POSITIVE CONTROL (the sandbox
really moves the shim path), and a module that finds a NEW route is caught by re-measuring,
not by this file. The measurement is a sweep: run each `tests/test_*.py` alone with
HOME/USERPROFILE/XDG_CONFIG_HOME/APPDATA/LOCALAPPDATA pointed at a fresh temp dir — and
crucially NOT `GENESEED_HOME`, which `_shim_home()` prefers over `Path.home()` and which
therefore OVERRIDES a module's own sandbox and reports well-behaved modules as polluters.
Whatever lands in that dir is what would have landed in `~`.
"""
from __future__ import annotations

import ast
import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TESTS = ROOT / "tests"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(TESTS))

import golden  # noqa: E402
import _build_settings  # noqa: E402

#: The generator entry points whose emit reaches `_write_hook_shim`, plus the shim writer
#: itself. Resolved against the real modules by `test_the_at_risk_names_are_real`, so a
#: rename empties the derived set LOUDLY instead of silently.
_EMIT_ENTRIES = ("emit_claude", "emit_claude_global", "emit_bob", "emit_bob_global",
                 "emit_opencode", "emit_opencode_global", "emit_copilot",
                 "emit_copilot_global")
_SHIM_ENTRIES = ("_write_hook_shim", "_hook_shim_path", "_shim_home")

#: Modules that reach an emit by a route no walk over their own source can name. Each row
#: is a MEASURED result of the sweep in this file's docstring, with the route written down.
_ROUTED_BY_ANOTHER_PATH = {
    # `_update.upgrade` / `_rebuild_bundle` spawn the generator; the tests that do not mock
    # `_rebuild_bundle` run a real one, and it inherits this process's environment.
    "test_update": "_update._rebuild_bundle spawns the generator",
}

#: The one thing every at-risk module must do, and the marker this gate looks for.
_SANDBOX_CALL = "sandbox_process_home"


def _calls(tree: ast.AST) -> set[str]:
    """Every `<anything>.<name>(...)` attribute call in a module, by attribute name."""
    return {n.func.attr for n in ast.walk(tree)
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)}


def _bare_names(tree: ast.AST) -> set[str]:
    """Names pulled in by `from build import X` — which would call an emitter WITHOUT the
    `build.` prefix and so evade the attribute walk above. Nothing does this today; the
    gate below keeps it that way rather than trusting that it stays true."""
    return {a.name for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)
            for a in n.names}


def _module_sources() -> dict[str, ast.AST]:
    return {p.stem: ast.parse(p.read_text(encoding="utf-8"))
            for p in sorted(TESTS.glob("test_*.py"))}


def at_risk() -> dict[str, str]:
    """{module: why} — every test module that can reach `_write_hook_shim` in THIS process."""
    out = {}
    for mod, tree in _module_sources().items():
        if mod == Path(__file__).stem:
            continue        # this file's positive control moves the home on purpose
        hit = sorted(_calls(tree) & set(_EMIT_ENTRIES + _SHIM_ENTRIES))
        if hit:
            out[mod] = ", ".join(hit)
    out.update(_ROUTED_BY_ANOTHER_PATH)
    return out


class EveryEmittingModuleSandboxesItsHome(unittest.TestCase):

    def test_the_at_risk_names_are_real(self):
        """The derivation's input, checked against the modules it names. A typo here would
        produce an EMPTY at-risk set and a green gate over a polluting suite."""
        sys.path.insert(0, str(ROOT))
        import build
        for name in _EMIT_ENTRIES:
            self.assertTrue(hasattr(build, name), f"build has no {name} — the derived set "
                                                  "in tests/test_home_sandbox.py is stale")
        for name in _SHIM_ENTRIES:
            self.assertTrue(hasattr(_build_settings, name),
                            f"_build_settings has no {name}")
        self.assertTrue(at_risk(), "the at-risk set is empty, which cannot be true while "
                                   "any test module emits")

    def test_every_at_risk_module_installs_the_sandbox(self):
        for mod, why in sorted(at_risk().items()):
            with self.subTest(module=mod):
                tree = ast.parse((TESTS / f"{mod}.py").read_text(encoding="utf-8"))
                self.assertIn(_SANDBOX_CALL, _calls(tree),
                              f"tests/{mod}.py reaches the hook shim ({why}) but never "
                              f"calls golden.{_SANDBOX_CALL}() — a suite run rewrites the "
                              "developer's ~/.geneseed/bin/geneseed-hook[.cmd]")

    def test_no_module_defines_the_same_fixture_hook_twice(self):
        """THE FIRST DEFECT THIS GATE FOUND, and it found it in the fix rather than in the
        code: `tests/test_web.py` already had a `setUpModule`, so the one added above it was
        SHADOWED — the later `def` wins and the sandbox never ran. The gate above was green
        the whole time, because a call inside dead code is still a call.

        Asserted for every module and both hooks, not just the one that was wrong: a second
        `setUpModule` silently discards the first one's work, and that is invisible in a
        diff that only shows the lines it added."""
        for mod, tree in _module_sources().items():
            for hook in ("setUpModule", "tearDownModule"):
                names = [n.name for n in tree.body
                         if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
                         and n.name == hook]
                with self.subTest(module=mod, hook=hook):
                    self.assertLessEqual(len(names), 1,
                                         f"tests/{mod}.py defines {hook} {len(names)} times "
                                         "— the last one wins and the rest are dead")

    def test_no_module_imports_an_emitter_by_bare_name(self):
        """`from build import emit_claude_global` would call it without the `build.` prefix
        and be invisible to the walk above — a hole in the derivation rather than in the
        code, which is the kind this port has been bitten by five times."""
        for mod, tree in _module_sources().items():
            with self.subTest(module=mod):
                self.assertFalse(_bare_names(tree) & set(_EMIT_ENTRIES),
                                 f"tests/{mod}.py imports an emitter by bare name; the "
                                 "at-risk derivation only sees `build.<emitter>(...)`")


class TheSandboxActuallyMovesTheShim(unittest.TestCase):
    """The positive control. Every assertion above is satisfied by a helper that does
    NOTHING — the call would still be there and the shim would still be the real one."""

    def test_it_moves_the_shim_path_and_puts_it_back(self):
        real = _build_settings._hook_shim_path()
        home = golden.sandbox_process_home()
        try:
            moved = _build_settings._hook_shim_path()
        finally:
            golden.restore_process_home()
        self.assertNotEqual(moved, real, "sandbox_process_home() left the shim path alone")
        self.assertTrue(str(moved).startswith(str(home)),
                        f"{moved} is not under the sandbox {home}")
        self.assertEqual(_build_settings._hook_shim_path(), real,
                         "restore_process_home() did not put the real home back")

    def test_it_covers_every_variable_that_decides_where_home_is(self):
        """`HOME_VARS` is what `cell_env` and the process sandbox share, and a row missing
        from it is a hole in BOTH. `GENESEED_HOME` is the one that matters most and the one
        a HOME/USERPROFILE-only sandbox misses."""
        home = golden.sandbox_process_home()
        try:
            for var in golden.HOME_VARS:
                with self.subTest(var=var):
                    self.assertTrue(os.environ.get(var, "").startswith(str(home)),
                                    f"{var} is not inside the sandbox")
        finally:
            golden.restore_process_home()

    def test_restoring_puts_absence_back_as_absence(self):
        """An unset variable must come back UNSET. Writing `""` where nothing was set makes
        `Path.home()` read the empty string, which is a different machine again."""
        saved = os.environ.pop("GENESEED_HOME", None)
        try:
            golden.sandbox_process_home()
            golden.restore_process_home()
            self.assertNotIn("GENESEED_HOME", os.environ)
        finally:
            if saved is not None:
                os.environ["GENESEED_HOME"] = saved


if __name__ == "__main__":
    unittest.main()
