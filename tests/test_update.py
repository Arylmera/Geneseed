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
from unittest import mock

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


class GitCloneSourceTests(unittest.TestCase):
    """The preferred transport: a shallow `git clone` that reaches github.com through
    proxies that block the codeload archive zips, with a clean fall-through to the zip
    download when git is absent, opted out, or the clone fails."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self._saved_src = os.environ.pop("GENESEED_SRC", None)
        self._saved_which = _update.shutil.which
        self._saved_run = _update.subprocess.run

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)
        _update.shutil.which = self._saved_which
        _update.subprocess.run = self._saved_run
        if self._saved_src is not None:
            os.environ["GENESEED_SRC"] = self._saved_src
        else:
            os.environ.pop("GENESEED_SRC", None)

    def test_env_opt_out_skips_git(self):
        os.environ["GENESEED_SRC"] = "zip"
        _update.shutil.which = lambda _n: (_ for _ in ()).throw(
            AssertionError("git must not be probed when GENESEED_SRC=zip"))
        self.assertIsNone(_update._git_clone_source("main", self.tmp))

    def test_returns_none_when_git_absent(self):
        _update.shutil.which = lambda _n: None
        self.assertIsNone(_update._git_clone_source("main", self.tmp))

    def test_success_returns_clone_dir(self):
        _update.shutil.which = lambda _n: "git"

        def fake_run(cmd, **kw):
            target = Path(cmd[-1])
            target.mkdir(parents=True, exist_ok=True)
            (target / "build.py").write_text("print('hi')", encoding="utf-8")
            return _update.subprocess.CompletedProcess(cmd, 0, "Cloning ...", "")

        _update.subprocess.run = fake_run
        root = _update._git_clone_source("main", self.tmp)
        self.assertIsNotNone(root)
        self.assertEqual(root.name, "geneseed-clone")
        self.assertTrue((root / "build.py").is_file())

    def test_failed_clone_cleans_partial_tree(self):
        # A partial clone (no build.py) must be removed so the zip path's geneseed-*
        # scan into the same dest cannot mistake it for a valid source.
        _update.shutil.which = lambda _n: "git"

        def fake_run(cmd, **kw):
            Path(cmd[-1]).mkdir(parents=True, exist_ok=True)  # partial, no build.py
            return _update.subprocess.CompletedProcess(cmd, 128, "fatal: unable to access", "")

        _update.subprocess.run = fake_run
        self.assertIsNone(_update._git_clone_source("main", self.tmp))
        self.assertFalse((self.tmp / "geneseed-clone").exists())

    def test_fetch_source_prefers_clone(self):
        sentinel = self.tmp / "geneseed-clone"
        sentinel.mkdir()
        saved_clone = _update._git_clone_source
        saved_sha = _update._resolve_sha
        _update._git_clone_source = lambda ref, dest, log=None: sentinel
        # _resolve_sha would hit the network; the clone short-circuit must avoid it.
        _update._resolve_sha = lambda *a, **k: (_ for _ in ()).throw(
            AssertionError("must not reach the archive download when the clone succeeds"))
        try:
            self.assertEqual(_update._fetch_source("main", self.tmp), sentinel)
        finally:
            _update._git_clone_source = saved_clone
            _update._resolve_sha = saved_sha


class DoctorSignatureTests(unittest.TestCase):
    def test_extracts_and_sorts_problem_bullets(self):
        out = "header\n  - zeta problem\nnoise\n- alpha problem\n  - alpha problem\n"
        sig = _update._doctor_signature(out)
        self.assertEqual(sig, "- alpha problem\n- zeta problem")

    def test_empty_when_no_bullets(self):
        self.assertEqual(_update._doctor_signature("all clean\n"), "")


class RedactCredsTests(unittest.TestCase):
    def test_strips_userinfo_from_https(self):
        self.assertEqual(
            _update._redact_url_creds("clone https://user:tok@github.com/o/r.git failed"),
            "clone https://github.com/o/r.git failed")

    def test_leaves_plain_url_untouched(self):
        self.assertEqual(
            _update._redact_url_creds("https://github.com/o/r.git"),
            "https://github.com/o/r.git")

    def test_handles_empty(self):
        self.assertEqual(_update._redact_url_creds(""), "")
        self.assertEqual(_update._redact_url_creds(None), "")


class ParseOriginTests(unittest.TestCase):
    def _slug(self, url):
        return _update._parse_origin(url).github_slug

    def test_https_with_dotgit(self):
        od = _update._parse_origin("https://github.com/Own/Repo.git")
        self.assertEqual(od.url, "https://github.com/Own/Repo")
        self.assertEqual(od.github_slug, "Own/Repo")

    def test_https_bare(self):
        self.assertEqual(self._slug("https://github.com/Own/Repo"), "Own/Repo")

    def test_scp_form(self):
        od = _update._parse_origin("git@github.com:Own/Repo.git")
        self.assertEqual(od.url, "https://github.com/Own/Repo")
        self.assertEqual(od.github_slug, "Own/Repo")

    def test_ssh_scheme(self):
        self.assertEqual(self._slug("ssh://git@github.com/Own/Repo.git"), "Own/Repo")

    def test_ghe_has_no_slug_but_browser_url(self):
        od = _update._parse_origin("https://ghe.corp.com/team/Repo.git")
        self.assertIsNone(od.github_slug)
        self.assertEqual(od.url, "https://ghe.corp.com/team/Repo")

    def test_gitlab_nested_subgroup(self):
        od = _update._parse_origin("https://gitlab.corp.com/team/sub/Repo.git")
        self.assertIsNone(od.github_slug)
        self.assertEqual(od.url, "https://gitlab.corp.com/team/sub/Repo")

    def test_azure_git_path(self):
        od = _update._parse_origin("https://dev.azure.com/org/proj/_git/Repo")
        self.assertIsNone(od.github_slug)
        self.assertEqual(od.url, "https://dev.azure.com/org/proj/_git/Repo")

    def test_embedded_creds_stripped_from_url_kept_in_slug(self):
        od = _update._parse_origin("https://user:tok@github.com/Own/Repo.git")
        self.assertEqual(od.url, "https://github.com/Own/Repo")
        self.assertEqual(od.github_slug, "Own/Repo")


class OriginDisplayTests(unittest.TestCase):
    def test_no_origin_falls_back_to_default(self):
        with mock.patch.object(_update, "_git", return_value=(128, "", "no origin")):
            self.assertEqual(_update._origin_display(), _update.DEFAULT_ORIGIN)

    def test_reads_origin(self):
        with mock.patch.object(_update, "_git",
                               return_value=(0, "https://github.com/Own/Repo.git", "")):
            self.assertEqual(_update._origin_display().github_slug, "Own/Repo")


class PreflightTests(unittest.TestCase):
    def _run(self, seam):
        with mock.patch.object(_update, "_git", side_effect=seam):
            return _update._preflight()

    def test_no_git(self):
        # first _git call returns rc=None (git absent)
        p = self._run(lambda *a, **k: (None, "", ""))
        self.assertFalse(p.ok); self.assertEqual(p.code, "no_git_exe"); self.assertEqual(p.kind, "info")

    def test_not_a_repo(self):
        p = self._run(lambda *a, **k: (128, "", "not a work tree"))
        self.assertEqual(p.code, "not_git")

    def test_detached_head(self):
        def seam(*a, **k):
            if a[0] == "rev-parse" and a[1] == "--is-inside-work-tree": return (0, "true", "")
            if a[0] == "symbolic-ref": return (1, "", "")          # detached
            return (0, "", "")
        self.assertEqual(self._run(seam).code, "detached")

    def test_no_upstream(self):
        def seam(*a, **k):
            if a[0] == "rev-parse" and a[1] == "--is-inside-work-tree": return (0, "true", "")
            if a[0] == "symbolic-ref": return (0, "refs/heads/main", "")
            if a[0] == "rev-parse" and "@{u}" in a: return (128, "", "no upstream")
            return (0, "", "")
        self.assertEqual(self._run(seam).code, "no_upstream")

    def test_dirty_tracked_change(self):
        def seam(*a, **k):
            if a[0] == "rev-parse" and a[1] == "--is-inside-work-tree": return (0, "true", "")
            if a[0] == "symbolic-ref": return (0, "refs/heads/main", "")
            if a[0] == "rev-parse" and "@{u}" in a: return (0, "origin/main", "")
            if "status" in a: return (0, " M rituals/build.py", "")
            return (0, "", "")
        p = self._run(seam)
        self.assertFalse(p.ok); self.assertEqual(p.code, "dirty")

    def test_ready_when_clean(self):
        def seam(*a, **k):
            if a[0] == "rev-parse" and a[1] == "--is-inside-work-tree": return (0, "true", "")
            if a[0] == "symbolic-ref": return (0, "refs/heads/main", "")
            if a[0] == "rev-parse" and "@{u}" in a: return (0, "origin/main", "")
            if "status" in a: return (0, "", "")                  # clean (untracked ignored by flags)
            return (0, "", "")
        p = self._run(seam)
        self.assertTrue(p.ok); self.assertEqual(p.code, "ready")


class MeasureUpstreamTests(unittest.TestCase):
    def _run(self, seam):
        with mock.patch.object(_update, "_git", side_effect=seam):
            return _update._measure_upstream()

    def test_fetch_failure(self):
        code, behind, _ = self._run(lambda *a, **k: (128, "", "could not resolve host"))
        self.assertEqual(code, "fetch_failed")

    def test_up_to_date(self):
        def seam(*a, **k):
            if a[0] == "fetch": return (0, "", "")
            if a[0] == "rev-list": return (0, "0", "")
            return (0, "", "")
        self.assertEqual(self._run(seam)[0], "uptodate")

    def test_behind_is_ready(self):
        def seam(*a, **k):
            if a[0] == "fetch": return (0, "", "")
            if a[0] == "rev-list" and a[2] == "@{u}..HEAD": return (0, "0", "")   # ahead
            if a[0] == "rev-list" and a[2] == "HEAD..@{u}": return (0, "3", "")   # behind
            return (0, "", "")
        code, behind, _ = self._run(seam)
        self.assertEqual(code, "ready"); self.assertEqual(behind, 3)

    def test_diverged_with_common_ancestor(self):
        def seam(*a, **k):
            if a[0] == "fetch": return (0, "", "")
            if a[0] == "rev-list" and a[2] == "@{u}..HEAD": return (0, "2", "")
            if a[0] == "rev-list" and a[2] == "HEAD..@{u}": return (0, "1", "")
            if a[0] == "merge-base": return (0, "abc123", "")
            return (0, "", "")
        self.assertEqual(self._run(seam)[0], "diverged")

    def test_unrelated_history(self):
        def seam(*a, **k):
            if a[0] == "fetch": return (0, "", "")
            if a[0] == "rev-list" and a[2] == "@{u}..HEAD": return (0, "1", "")
            if a[0] == "rev-list" and a[2] == "HEAD..@{u}": return (0, "1", "")
            if a[0] == "merge-base": return (1, "", "")
            return (0, "", "")
        self.assertEqual(self._run(seam)[0], "unrelated")


if __name__ == "__main__":
    unittest.main()
