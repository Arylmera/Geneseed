"""Unit tests for the cross-platform update core (rituals/_update.py). Stdlib only.

These cover the network-free logic — emit/theme precedence, the staged factory-file
swap, the stray-bundle migration, and the doctor-signature fingerprint — so the port of
upgrade.sh / sync-self.sh is exercised without hitting GitHub. Run from the Geneseed root:
    python -m unittest discover -s tests
"""
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "rituals"))
sys.path.insert(0, str(ROOT))
import _update  # noqa: E402


class ResolveEmitTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.cfg = self.tmp / "cfg"
        self.out = self.tmp / "out"
        self.cfg.mkdir()
        self.out.mkdir()
        self._saved = os.environ.pop("GENESEED_EMIT", None)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)
        if self._saved is not None:
            os.environ["GENESEED_EMIT"] = self._saved
        else:
            os.environ.pop("GENESEED_EMIT", None)

    def test_default_is_files(self):
        self.assertEqual(_update._resolve_emit(self.cfg, self.out), "files")

    def test_env_wins(self):
        os.environ["GENESEED_EMIT"] = "opencode"
        self.assertEqual(_update._resolve_emit(self.cfg, self.out), "opencode")

    def test_global_marker_beats_bundle_marker(self):
        (self.cfg / ".geneseed-emit").write_text("opencode-global\n", encoding="utf-8")
        (self.out / ".geneseed-emit").write_text("opencode\n", encoding="utf-8")
        self.assertEqual(_update._resolve_emit(self.cfg, self.out), "opencode-global")

    def test_bundle_marker_used_when_no_global(self):
        (self.out / ".geneseed-emit").write_text("opencode\n", encoding="utf-8")
        self.assertEqual(_update._resolve_emit(self.cfg, self.out), "opencode")


class RefreshItemTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.new = self.tmp / "new"
        self.here = self.tmp / "here"
        self.new.mkdir()
        self.here.mkdir()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_replaces_a_file(self):
        (self.new / "build.py").write_text("NEW", encoding="utf-8")
        (self.here / "build.py").write_text("OLD", encoding="utf-8")
        _update._refresh_item(self.new, self.here, "build.py")
        self.assertEqual((self.here / "build.py").read_text(encoding="utf-8"), "NEW")
        self.assertFalse((self.here / "build.py.geneseed-new").exists())

    def test_replaces_a_directory(self):
        (self.new / "src").mkdir()
        (self.new / "src" / "a.md").write_text("fresh", encoding="utf-8")
        (self.here / "src").mkdir()
        (self.here / "src" / "stale.md").write_text("gone", encoding="utf-8")
        _update._refresh_item(self.new, self.here, "src")
        self.assertTrue((self.here / "src" / "a.md").is_file())
        self.assertFalse((self.here / "src" / "stale.md").exists())

    def test_missing_source_is_a_noop(self):
        (self.here / "LICENSE").write_text("keep", encoding="utf-8")
        _update._refresh_item(self.new, self.here, "LICENSE")  # not in new/
        self.assertEqual((self.here / "LICENSE").read_text(encoding="utf-8"), "keep")


class StrayBundleTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.here = self.tmp / "Geneseed"
        self.out = self.tmp / "Harness"
        self.here.mkdir()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_rescues_context_and_memory_then_drops_stray(self):
        stray = self.here / "Harness"
        stray.mkdir()
        (stray / "context.json").write_text("{}", encoding="utf-8")
        (stray / "memory").mkdir()
        (stray / "memory" / "MEMORY.md").write_text("# idx", encoding="utf-8")
        _update._migrate_stray_bundle(self.here, self.out, lambda _m: None)
        self.assertTrue((self.out / "context.json").is_file())
        self.assertTrue((self.out / "memory" / "MEMORY.md").is_file())
        self.assertFalse(stray.exists())

    def test_does_not_clobber_existing_out_state(self):
        stray = self.here / "Harness"
        stray.mkdir()
        (stray / "context.json").write_text("STRAY", encoding="utf-8")
        self.out.mkdir()
        (self.out / "context.json").write_text("REAL", encoding="utf-8")
        _update._migrate_stray_bundle(self.here, self.out, lambda _m: None)
        self.assertEqual((self.out / "context.json").read_text(encoding="utf-8"), "REAL")


class DoctorSignatureTests(unittest.TestCase):
    def test_extracts_and_sorts_problem_bullets(self):
        out = "header\n  - zeta problem\nnoise\n- alpha problem\n  - alpha problem\n"
        sig = _update._doctor_signature(out)
        self.assertEqual(sig, "- alpha problem\n- zeta problem")

    def test_empty_when_no_bullets(self):
        self.assertEqual(_update._doctor_signature("all clean\n"), "")


if __name__ == "__main__":
    unittest.main()
