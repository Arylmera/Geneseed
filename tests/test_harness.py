"""Unit tests for the Geneseed CLI (rituals/harness.py). Stdlib unittest only.

Run from the Geneseed root:  python -m unittest discover -s tests
"""
import re
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "rituals"))
sys.path.insert(0, str(ROOT))
import build  # noqa: E402
import harness  # noqa: E402


class PromptParityTests(unittest.TestCase):
    """The distil prompt has ONE source: the OpenCode plugin's literal. harness.py
    extracts it — this test fails the moment the two drift."""

    def test_extracted_head_matches_plugin_literal(self):
        js = (build.PLUGIN_SRC / "geneseed-learn.js").read_text(encoding="utf-8")
        m = re.search(r"const LEARN_PROMPT_HEAD = `([\s\S]*?)`", js)
        self.assertIsNotNone(m, "could not find LEARN_PROMPT_HEAD literal in plugin")
        self.assertEqual(harness.LEARN_PROMPT_HEAD, m.group(1))

    def test_head_is_substantive(self):
        self.assertIn("NOTHING", harness.LEARN_PROMPT_HEAD)
        self.assertGreater(len(harness.LEARN_PROMPT_HEAD), 200)


class FrontmatterTests(unittest.TestCase):
    def test_parse_name_and_description(self):
        fm, body = harness._frontmatter(
            "---\nname: foo\ndescription: bar\n---\nthe body"
        )
        self.assertEqual(fm["name"], "foo")
        self.assertEqual(fm["description"], "bar")
        self.assertIn("the body", body)

    def test_no_frontmatter_returns_whole_body(self):
        fm, body = harness._frontmatter("just text, no fm")
        self.assertEqual(fm, {})
        self.assertEqual(body, "just text, no fm")


class WriteMemoriesTests(unittest.TestCase):
    def test_writes_new_skips_existing_and_indexes(self):
        d = Path(tempfile.mkdtemp())
        try:
            out = (
                "---\nname: new-fact\ndescription: a desc\n---\nthe fact\n"
                "---FILE---\n---\nname: dup\ndescription: x\n---\nbody"
            )
            written = harness._write_memories(out, d, {"dup"})
            self.assertEqual(written, ["new-fact"])
            self.assertTrue((d / "new-fact.md").is_file())
            self.assertFalse((d / "dup.md").exists())
            idx = (d / "MEMORY.md").read_text(encoding="utf-8")
            self.assertIn("new-fact", idx)
            self.assertIn("a desc", idx)
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_nothing_writes_no_files(self):
        d = Path(tempfile.mkdtemp())
        try:
            self.assertEqual(harness._write_memories("NOTHING", d, set()), [])
            self.assertFalse((d / "MEMORY.md").exists())
        finally:
            shutil.rmtree(d, ignore_errors=True)


class ExistingSlugsTests(unittest.TestCase):
    def test_skips_index_and_readme(self):
        d = Path(tempfile.mkdtemp())
        try:
            for nm in ("README.md", "MEMORY.md", "real.md"):
                (d / nm).write_text("x", encoding="utf-8")
            self.assertEqual(harness._existing_slugs(d), {"real"})
        finally:
            shutil.rmtree(d, ignore_errors=True)


class ReadNotesTests(unittest.TestCase):
    def test_raw_text_passthrough(self):
        self.assertEqual(harness._read_notes("plain notes"), "plain notes")

    def test_json_without_transcript_path_returns_raw(self):
        self.assertEqual(harness._read_notes('{"foo": 1}'), '{"foo": 1}')


class ThemeParityTests(unittest.TestCase):
    def test_shipped_themes_are_in_parity(self):
        self.assertEqual(harness._theme_parity_problems(), [])


class RenderedCheckTests(unittest.TestCase):
    def test_fresh_build_clean_then_drift_detected(self):
        d = Path(tempfile.mkdtemp())
        try:
            build.build("neutral", d)
            self.assertEqual(harness._rendered_problems(d), [])
            (d / "AGENT.md").write_text("tampered", encoding="utf-8")
            probs = harness._rendered_problems(d)
            self.assertTrue(any("AGENT.md" in p and "stale" in p for p in probs))
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_missing_file_detected(self):
        d = Path(tempfile.mkdtemp())
        try:
            build.build("neutral", d)
            (d / "laws" / "universal.md").unlink()
            probs = harness._rendered_problems(d)
            self.assertTrue(any("universal.md" in p and "missing" in p for p in probs))
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_absent_bundle_is_noop(self):
        self.assertEqual(harness._rendered_problems(ROOT / "does-not-exist"), [])


class AuthoringGateTests(unittest.TestCase):
    def test_real_specs_and_plugins_pass(self):
        # Spec purpose-line + single-source-prompt checks must hold for the source
        # tree; node --check is best-effort (skipped when node is absent).
        self.assertEqual(harness._authoring_problems(), [])


class DiscoverContextTests(unittest.TestCase):
    def _fixture(self, d):
        (d / "README.md").write_text("# r", encoding="utf-8")
        (d / "CONTRIBUTING.md").write_text("# c", encoding="utf-8")
        (d / "notes.md").write_text("# n", encoding="utf-8")
        (d / "docs").mkdir()
        (d / "docs" / "guide.md").write_text("# g", encoding="utf-8")
        (d / "node_modules").mkdir()
        (d / "node_modules" / "junk.md").write_text("x", encoding="utf-8")
        (d / "packages" / "foo").mkdir(parents=True)
        (d / "packages" / "foo" / "README.md").write_text("# foo", encoding="utf-8")

    def test_convention_discovery(self):
        d = Path(tempfile.mkdtemp())
        try:
            self._fixture(d)
            eager, lazy = harness._discover_context(d)
            enames = {Path(e["path"]).name for e in eager}
            lnames = {Path(l["path"]).name for l in lazy}
            self.assertIn("README.md", enames)
            self.assertIn("CONTRIBUTING.md", enames)
            self.assertIn("notes.md", lnames)      # misc root .md -> lazy
            self.assertIn("guide.md", lnames)      # docs/ tree -> lazy
            self.assertNotIn("junk.md", lnames)    # node_modules never scanned
            self.assertTrue(any(Path(l["path"]).parent.name == "foo" for l in lazy))
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_empty_manifest_falls_back_to_discovery(self):
        d = Path(tempfile.mkdtemp())
        try:
            self._fixture(d)
            (d / "context.json").write_text('{"context": []}', encoding="utf-8")
            eager, _lazy, source = harness._resolve_context_sets(d)
            self.assertTrue(any(Path(e["path"]).name == "README.md" for e in eager))
            self.assertIn("auto-discovery", source)
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_manifest_extend_layers_on_discovery(self):
        d = Path(tempfile.mkdtemp())
        try:
            self._fixture(d)
            (d / "house.md").write_text("# house rules", encoding="utf-8")
            (d / "context.json").write_text(
                '{"extend": true, "context": ['
                '{"path": "house.md", "load": "eager", "description": "house rules"}]}',
                encoding="utf-8",
            )
            eager, _lazy, source = harness._resolve_context_sets(d)
            enames = {Path(e["path"]).name for e in eager}
            self.assertIn("README.md", enames)   # from discovery
            self.assertIn("house.md", enames)    # from manifest, layered on top
            self.assertNotIn("auto-discovery", source)
        finally:
            shutil.rmtree(d, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
