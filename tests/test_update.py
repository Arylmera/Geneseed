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


class MarkerThemeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.cfg = self.tmp / "cfg"
        self.out = self.tmp / "out"
        self.cfg.mkdir()
        self.out.mkdir()

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_empty_when_no_marker(self):
        self.assertEqual(_update._marker_theme(self.cfg, self.out), "")

    def test_config_dir_marker_wins(self):
        # Global installs write the theme marker into the config dir, not the bundle.
        (self.cfg / ".geneseed-theme").write_text("imperial\n", encoding="utf-8")
        self.assertEqual(_update._marker_theme(self.cfg, self.out), "imperial")

    def test_bundle_marker_used_when_no_config(self):
        (self.out / ".geneseed-theme").write_text("pirate\n", encoding="utf-8")
        self.assertEqual(_update._marker_theme(self.cfg, self.out), "pirate")


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


class DownloadDiagnosticsTests(unittest.TestCase):
    """Failed downloads must say WHY (one ASCII line per transport), not just
    "unavailable - trying next source"."""

    def test_curl_reason_prefers_last_stderr_line(self):
        reason = _update._curl_failure_reason(35, b"curl: (35) schannel: next InitializeSecurityContext failed\n")
        self.assertEqual(reason, "(35) schannel: next InitializeSecurityContext failed")

    def test_curl_reason_falls_back_to_exit_code(self):
        self.assertEqual(_update._curl_failure_reason(7, b""), "exit 7")

    def test_exc_reason_is_single_line_ascii(self):
        reason = _update._exc_reason(OSError("ligne un\nligne deux → fin"))
        self.assertEqual(reason, "ligne un ligne deux ? fin")
        self.assertNotIn("\n", reason)

    def test_exc_reason_empty_message_uses_class_name(self):
        self.assertEqual(_update._exc_reason(TimeoutError()), "TimeoutError")

    def test_urllib_download_failure_logs_reason(self):
        import urllib.error
        lines = []
        saved = _update._urlopen
        def boom(url, accept=None):
            raise urllib.error.HTTPError(url, 407, "Proxy Authentication Required", None, None)
        _update._urlopen = boom
        try:
            ok = _update._urllib_download("https://example.invalid/x.zip",
                                          Path(tempfile.mkdtemp()) / "x.zip", lines.append)
        finally:
            _update._urlopen = saved
        self.assertFalse(ok)
        diag = [ln for ln in lines if "x urllib:" in ln]
        self.assertEqual(len(diag), 1)
        self.assertIn("407", diag[0])


class LocalZipTests(unittest.TestCase):
    """The offline package path: extract a local zip instead of downloading."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _zip(self, entries: dict) -> Path:
        import zipfile
        zp = self.tmp / "pkg.zip"
        with zipfile.ZipFile(zp, "w") as zf:
            for name, body in entries.items():
                zf.writestr(name, body)
        return zp

    def test_extracts_wrapped_source(self):
        # GitHub archives and the web offline-zip wrap in a geneseed-* dir.
        zp = self._zip({"geneseed-offline/build.py": "print('hi')"})
        root = _update._extract_local_zip(zp, self.tmp / "a")
        self.assertIsNotNone(root)
        self.assertEqual(root.name, "geneseed-offline")
        self.assertTrue((root / "build.py").is_file())

    def test_extracts_flat_source(self):
        zp = self._zip({"build.py": "print('hi')"})
        root = _update._extract_local_zip(zp, self.tmp / "b")
        self.assertIsNotNone(root)
        self.assertTrue((root / "build.py").is_file())

    def test_corrupt_zip_returns_none(self):
        zp = self.tmp / "bad.zip"
        zp.write_bytes(b"this is not a zip")
        self.assertIsNone(_update._extract_local_zip(zp, self.tmp / "c"))

    def test_missing_package_raises_upgrade_error(self):
        with self.assertRaises(_update._UpgradeError) as cm:
            _update._local_zip_source(str(self.tmp / "nope.zip"), self.tmp,
                                      lambda _m: None)
        self.assertEqual(cm.exception.code, "E-ZIP")

    def test_main_rejects_zip_without_path(self):
        self.assertEqual(_update.main(["upgrade", "--zip"]), 2)


class DoctorSignatureTests(unittest.TestCase):
    def test_extracts_and_sorts_problem_bullets(self):
        out = "header\n  - zeta problem\nnoise\n- alpha problem\n  - alpha problem\n"
        sig = _update._doctor_signature(out)
        self.assertEqual(sig, "- alpha problem\n- zeta problem")

    def test_empty_when_no_bullets(self):
        self.assertEqual(_update._doctor_signature("all clean\n"), "")


if __name__ == "__main__":
    unittest.main()
