"""Unit tests for the Geneseed generator (build.py). Stdlib unittest only — no deps.

Run from the Geneseed root:  python -m unittest discover -s tests
"""
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import build  # noqa: E402


class SubstituteTests(unittest.TestCase):
    def test_known_token_replaced(self):
        self.assertEqual(build.substitute("{{X}}", {"X": "y"}), "y")

    def test_unknown_token_left_visible(self):
        # Unknown tokens stay verbatim so doctor can flag them.
        self.assertEqual(build.substitute("{{Z}}", {"X": "y"}), "{{Z}}")


class ThemeStructureTests(unittest.TestCase):
    def test_structure_overrides_theme_voice(self):
        # A theme can never rename a section/structural noun/folder.
        t = build.effective_theme("imperial")
        self.assertEqual(t["LAW"], "Rule")
        self.assertEqual(t["DIR_AGENTS"], "agents")

    def test_themed_rel_neutral_is_identity(self):
        t = build.effective_theme("neutral")
        self.assertEqual(
            build.themed_rel(Path("laws/universal.md"), t).as_posix(),
            "laws/universal.md",
        )


class DestRelTests(unittest.TestCase):
    def test_tmpl_becomes_agent_md(self):
        self.assertEqual(build.dest_rel(Path("AGENT.md.tmpl")).name, "AGENT.md")

    def test_other_names_unchanged(self):
        self.assertEqual(build.dest_rel(Path("laws/universal.md")).name, "universal.md")


class RenderAllTests(unittest.TestCase):
    def test_no_unresolved_tokens_in_any_theme(self):
        for theme in (p.stem for p in build.THEMES.glob("*.json")):
            _t, items = build.render_all(theme)
            for rel, text, _src in items:
                if text is not None:
                    self.assertNotIn("{{", text, f"unresolved token in {rel} ({theme})")

    def test_include_directive_is_inlined(self):
        # AGENT.md.tmpl includes laws/universal.md; proof the INCLUDE engine ran.
        _t, items = build.render_all("neutral")
        agent = next(t for r, t, _ in items if r == "AGENT.md")
        self.assertIn("Sealed Secrets", agent)


class BuildRoundTripTests(unittest.TestCase):
    def test_build_writes_expected_tree(self):
        tmp = Path(tempfile.mkdtemp())
        try:
            build.build("neutral", tmp)
            self.assertTrue((tmp / "AGENT.md").is_file())
            self.assertTrue((tmp / "laws" / "universal.md").is_file())
            self.assertTrue((tmp / "memory" / "MEMORY.md").is_file())
            # context.json stub is created once.
            self.assertTrue((tmp / "context.json").is_file())
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class NativeLayerTests(unittest.TestCase):
    def test_readonly_agents_get_permission_block(self):
        _t, items = build.render_all("neutral")
        d = Path(tempfile.mkdtemp())
        try:
            build._write_native_layer(items, d / "agents", d / "skills")
            reviewer = (d / "agents" / "reviewer.md").read_text(encoding="utf-8")
            explorer = (d / "agents" / "explorer.md").read_text(encoding="utf-8")
            tester = (d / "agents" / "tester.md").read_text(encoding="utf-8")
            # read-only agents get a permission block denying edit + webfetch
            self.assertIn("permission:", reviewer)
            self.assertIn("edit: deny", reviewer)
            self.assertIn("webfetch: deny", reviewer)
            # reviewer runs tests -> bash gated to ask; explorer -> bash denied
            self.assertIn('"*": ask', reviewer)
            self.assertIn("bash: deny", explorer)
            self.assertNotIn('"*": ask', explorer)
            # tester edits test files -> not read-only -> no permission block
            self.assertNotIn("permission:", tester)
        finally:
            shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
