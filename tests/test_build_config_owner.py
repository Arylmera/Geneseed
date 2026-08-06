"""The generator's mutable configuration has exactly ONE owner.

`_build_core` holds the source/theme roots and the posture/mode selection (its
`_OWNED` tuple). build.py's splice skips those names and `from _build_core import *`
does not export them, so no submodule carries a copy — the arrangement that replaced
the old `_BuildFacade.__setattr__` mirror, which kept four copies in sync by fanning
every write out to every submodule.

These are the tests that make that arrangement fail loudly when it regresses:

  * a copy reappearing in any submodule (someone re-splices, or re-adds a constant)
    breaks `test_owned_names_have_exactly_one_binding`;
  * a redirect that stops reaching the render pipeline breaks the two behaviour tests,
    which drive real generator code against a fixture tree rather than asserting on
    module dicts;
  * `mock.patch.object(build, ...)` coming back breaks `test_facade_refuses_writes` —
    that call silently leaked its patch for the rest of the process (mock deletes
    rather than restores an attribute it did not find in the target's own __dict__),
    which is why the facade is read-only for these names rather than write-through.

Run from the Geneseed root:  python -m unittest discover -s tests
"""
import ast
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import build  # noqa: E402
import _build_core  # noqa: E402
import _build_render  # noqa: E402
import _build_emit  # noqa: E402
import _build_global  # noqa: E402

SUBMODULES = (_build_render, _build_emit, _build_global)


class SingleBindingTests(unittest.TestCase):
    def test_owned_names_have_exactly_one_binding(self):
        """No submodule and not the facade may hold a copy of an owned name. A copy is
        what a redirect silently misses, and what the deleted mirror existed to paper
        over — so its reappearance is the regression this asserts against."""
        for name in _build_core._OWNED:
            self.assertIn(name, vars(_build_core),
                          f"{name} is listed in _OWNED but _build_core does not define it")
            self.assertNotIn(name, vars(build),
                             f"build.{name} is a copy — it must resolve through __getattr__")
            for mod in SUBMODULES:
                self.assertNotIn(name, vars(mod),
                                 f"{mod.__name__}.{name} is a stale copy of "
                                 f"_build_core.{name}")

    def test_facade_reads_delegate_to_the_owner(self):
        """`build.SRC` is the runtime's read surface (rituals/ and web/ use it) and must
        track the owner, not a value frozen at import."""
        original = _build_core.SRC
        self.addCleanup(setattr, _build_core, "SRC", original)
        _build_core.SRC = Path("nowhere-at-all")
        self.assertEqual(build.SRC, Path("nowhere-at-all"))

    def test_facade_refuses_writes(self):
        """Writing through the facade is refused, loudly, naming the owner.

        Not a style preference: `mock.patch.object(build, "ROOT", tmp)` records at patch
        time whether the attribute lives in the target's own __dict__. A delegated name
        does not, so on exit mock calls delattr() instead of restoring — the redirect
        then survives for the whole process. Under the old mirror that poisoned every
        later test that read a source root."""
        with self.assertRaises(AttributeError) as cm:
            build.SRC = Path("hijacked")
        self.assertIn("_build_core.SRC", str(cm.exception))
        self.assertNotEqual(_build_core.SRC, Path("hijacked"))

        with self.assertRaises(AttributeError):
            with mock.patch.object(build, "ROOT", Path("hijacked")):
                pass

    def test_no_test_redirects_a_shared_but_unowned_build_name(self):
        """The narrowing shape, caught mechanically instead of by review.

        build.py splices the four submodules into a shared namespace, so every name that
        is NOT owned exists as five copies. Redirecting such a name through the facade
        (`build.X = …` or `mock.patch.object(build, "X", …)`) now updates build's copy
        only — generator-internal callers keep reading their own. The test does not fail;
        it just stops covering what it claims to. Two names were already in that state
        when this was written (`VENDORED_SKILL_DIRS` and `_opencode_config_dir`, the
        latter able to send a global emit into the developer's real config dir); both
        were moved into `_OWNED`. Anything new that wants redirecting belongs there too."""
        shared = set()
        for mod in (_build_core, *SUBMODULES):
            shared |= {k for k in vars(mod) if not k.startswith("__")}
        offenders = []
        for path in sorted(Path(__file__).parent.glob("*.py")):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                name = None
                if (isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name)
                        and node.value.id == "build"
                        and not isinstance(node.ctx, ast.Load)):
                    name = node.attr
                elif (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                        and node.func.attr == "object" and len(node.args) > 1
                        and isinstance(node.args[0], ast.Name) and node.args[0].id == "build"
                        and isinstance(node.args[1], ast.Constant)):
                    name = node.args[1].value
                if name and name in shared and name not in _build_core._OWNED:
                    offenders.append(f"{path.name}:{node.lineno} redirects build.{name}")
        self.assertEqual(offenders, [], "\n".join(
            [""] + offenders + ["-> add the name to _build_core._OWNED (and read it as "
                                "_build_core.<name>), or patch the defining module"]))

    def test_unknown_attribute_still_raises_attributeerror(self):
        """__getattr__ must not turn a typo into something else — `build.NOPE` is still
        a plain AttributeError, so `hasattr`/`getattr(..., default)` behave normally."""
        with self.assertRaises(AttributeError):
            build.NOT_A_REAL_NAME


class RedirectReachesTheGeneratorTests(unittest.TestCase):
    """Behaviour, not bookkeeping: redirect the owner and check real generator code
    picks it up. A stale copy anywhere in the render pipeline fails these."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(__import__("shutil").rmtree, self.tmp, ignore_errors=True)

    def test_theme_root_redirect_reaches_theme_files(self):
        """theme_files() lives in _build_render and used to read a spliced THEMES copy."""
        (self.tmp / "only-one.json").write_text("{}", encoding="utf-8")
        (self.tmp / "_TEMPLATE.json").write_text("{}", encoding="utf-8")
        with mock.patch.object(_build_core, "THEMES", self.tmp):
            self.assertEqual([p.name for p in build.theme_files()], ["only-one.json"])
        # and the patch really came back — the failure mode this file exists for
        self.assertNotEqual(_build_core.THEMES, self.tmp)

    def test_src_and_posture_redirect_reach_the_posture_body(self):
        """_posture_body reads BOTH owned names (SRC for the path, POSTURE for which
        file), from _build_render — the module that used to define POSTURE itself."""
        (self.tmp / "postures").mkdir()
        (self.tmp / "postures" / "fixture.md").write_text(
            "a posture written for this test", encoding="utf-8")
        with mock.patch.object(_build_core, "SRC", self.tmp), \
                mock.patch.object(_build_core, "POSTURE", "fixture"):
            self.assertEqual(build._posture_body({}), "a posture written for this test")
            self.assertEqual(build.posture_names(), ["fixture"])

    def test_config_dir_redirect_reaches_a_global_emit_with_no_cfg(self):
        """The footgun this ownership exists to disarm.

        `emit_*_global` falls back to `cfg or _<host>_config_dir()`. While the resolvers
        lived in _build_global, redirecting `build._opencode_config_dir` reached the web
        layer's reads but NOT that fallback — so a global emit called without an explicit
        `cfg` would render into the developer's real ~/.config/opencode. Every existing
        caller happens to pass `cfg`, which is exactly why nothing caught it. This drives
        the fallback deliberately."""
        cfg = self.tmp / "fixture-config"
        with mock.patch.object(_build_core, "_opencode_config_dir", lambda: cfg):
            build.emit_opencode_global("neutral", out=self.tmp / "bundle")
        self.assertTrue((cfg / "AGENT.md").is_file(),
                        "the global emit ignored the redirected config dir")

    def test_config_dir_redirect_reaches_hosts_and_the_preamble_map(self):
        """Two module-level dicts hold a callable per host. Binding the resolver FUNCTION
        into them captures it at import — a second binding the owner cannot reach, which
        is the same 'redirect reaches only some copies' defect one level down. Both are
        late-bound instead; this is what fails if either goes back to a direct reference.

        `_PREAMBLE_CONFIG_DIR` is the one with teeth: its value is written into a real
        settings file as a claudeMdExcludes path, so a missed redirect bakes whoever ran
        the build into an emitted config."""
        marker = Path("redirected-config-dir")
        with mock.patch.object(_build_core, "_claude_config_dir", lambda: marker):
            self.assertEqual(build.HOSTS["claude"]["config_dir"](), marker)
            self.assertEqual(_build_global._PREAMBLE_CONFIG_DIR["CLAUDE.md"](), marker)
        for host, name in (("opencode", "_opencode_config_dir"),
                           ("bob", "_bob_config_dir"),
                           ("copilot", "_copilot_config_dir")):
            with mock.patch.object(_build_core, name, lambda: marker):
                self.assertEqual(build.HOSTS[host]["config_dir"](), marker, host)

    def test_src_and_mode_redirect_reach_the_mode_body(self):
        (self.tmp / "modes").mkdir()
        (self.tmp / "modes" / "fixture.md").write_text(
            "a mode written for this test", encoding="utf-8")
        with mock.patch.object(_build_core, "SRC", self.tmp), \
                mock.patch.object(_build_core, "MODE", "fixture"):
            self.assertEqual(build._mode_body({}), "a mode written for this test")
            self.assertEqual(build.mode_names(), ["fixture"])


if __name__ == "__main__":
    unittest.main()
