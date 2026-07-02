"""Unit tests for the cross-platform update core (rituals/_update.py). Stdlib only.

These cover the network-free logic — emit/theme precedence, the staged factory-file
swap, the stray-bundle migration, and the doctor-signature fingerprint — so the port of
upgrade.sh / sync-self.sh is exercised without hitting GitHub. Run from the Geneseed root:
    python -m unittest discover -s tests
"""
import os
import shutil
import subprocess
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
    def _run(self, seam, fetch=(0, "")):
        # The network fetch goes through its own streaming seam now; everything
        # else (rev-list, merge-base) still rides _git.
        with mock.patch.object(_update, "_fetch_streaming", return_value=fetch), \
             mock.patch.object(_update, "_git", side_effect=seam):
            return _update._measure_upstream()

    def test_fetch_failure(self):
        code, behind, err = self._run(lambda *a, **k: (0, "", ""),
                                      fetch=(128, "could not resolve host"))
        self.assertEqual(code, "fetch_failed")
        self.assertEqual(err, "could not resolve host")

    def test_fetch_timeout_is_failure(self):
        # rc None (spawn failure / hard timeout) must classify as fetch_failed.
        code, _, _ = self._run(lambda *a, **k: (0, "", ""), fetch=(None, ""))
        self.assertEqual(code, "fetch_failed")

    def test_up_to_date(self):
        def seam(*a, **k):
            if a[0] == "rev-list": return (0, "0", "")
            return (0, "", "")
        self.assertEqual(self._run(seam)[0], "uptodate")

    def test_behind_is_ready(self):
        def seam(*a, **k):
            if a[0] == "rev-list" and a[2] == "@{u}..HEAD": return (0, "0", "")   # ahead
            if a[0] == "rev-list" and a[2] == "HEAD..@{u}": return (0, "3", "")   # behind
            return (0, "", "")
        code, behind, _ = self._run(seam)
        self.assertEqual(code, "ready"); self.assertEqual(behind, 3)

    def test_diverged_with_common_ancestor(self):
        def seam(*a, **k):
            if a[0] == "rev-list" and a[2] == "@{u}..HEAD": return (0, "2", "")
            if a[0] == "rev-list" and a[2] == "HEAD..@{u}": return (0, "1", "")
            if a[0] == "merge-base": return (0, "abc123", "")
            return (0, "", "")
        self.assertEqual(self._run(seam)[0], "diverged")

    def test_unrelated_history(self):
        def seam(*a, **k):
            if a[0] == "rev-list" and a[2] == "@{u}..HEAD": return (0, "1", "")
            if a[0] == "rev-list" and a[2] == "HEAD..@{u}": return (0, "1", "")
            if a[0] == "merge-base": return (1, "", "")
            return (0, "", "")
        self.assertEqual(self._run(seam)[0], "unrelated")


class FetchStreamingTests(unittest.TestCase):
    def _popen_stub(self, script):
        """A real subprocess running `script` stands in for git fetch."""
        real_popen = subprocess.Popen
        def fake_which(_name):
            return sys.executable
        def fake_popen(cmd, **kw):
            return real_popen([sys.executable, "-c", script], **{
                k: v for k, v in kw.items() if k != "env"})
        return fake_which, fake_popen

    def test_streams_progress_and_returns_rc(self):
        which, popen = self._popen_stub(
            "import sys; print('Receiving objects: 100% (3/3), done.'); sys.exit(0)")
        logged = []
        with mock.patch.object(_update.shutil, "which", which), \
             mock.patch.object(_update.subprocess, "Popen", popen):
            rc, tail = _update._fetch_streaming(logged.append)
        self.assertEqual(rc, 0)
        self.assertIn("Receiving objects", tail)
        self.assertTrue(any("Receiving objects" in m for m in logged))

    def test_timeout_kills_and_returns_none(self):
        which, popen = self._popen_stub("import time; time.sleep(60)")
        logged = []
        with mock.patch.object(_update.shutil, "which", which), \
             mock.patch.object(_update.subprocess, "Popen", popen), \
             mock.patch.object(_update, "_fetch_timeout", return_value=1), \
             mock.patch.object(_update.time, "sleep", lambda s: None):
            rc, _ = _update._fetch_streaming(logged.append)
        self.assertIsNone(rc)
        self.assertTrue(any("killed it" in m for m in logged))

    def test_no_git_exe(self):
        with mock.patch.object(_update.shutil, "which", lambda _n: None):
            rc, err = _update._fetch_streaming()
        self.assertIsNone(rc)
        self.assertIn("git is not installed", err)


class PullAndValidateTests(unittest.TestCase):
    def test_ff_success_then_doctor_pass(self):
        calls = []
        def seam(*a, **k):
            calls.append(a)
            if a[0] == "rev-parse" and a[1] == "HEAD": return (0, "oldsha", "")
            if a[0] == "merge": return (0, "", "")
            return (0, "", "")
        with mock.patch.object(_update, "_git", side_effect=seam), \
             mock.patch.object(_update, "_run_doctor", return_value=(True, "ok")):
            ok, code, _ = _update._pull_and_validate(lambda *_: None)
        self.assertTrue(ok)
        self.assertNotIn(("reset", "--hard", "oldsha"),
                         [c[:3] for c in calls])  # no rollback on success

    def test_doctor_fail_rolls_back(self):
        resets = []
        def seam(*a, **k):
            if a[0] == "rev-parse" and a[1] == "HEAD": return (0, "oldsha", "")
            if a[0] == "merge": return (0, "", "")
            if a[0] == "reset": resets.append(a); return (0, "", "")
            return (0, "", "")
        with mock.patch.object(_update, "_git", side_effect=seam), \
             mock.patch.object(_update, "_run_doctor", return_value=(False, "bad")):
            ok, code, _ = _update._pull_and_validate(lambda *_: None)
        self.assertFalse(ok); self.assertEqual(code, "doctor_fail")
        self.assertEqual(resets[0][:3], ("reset", "--hard", "oldsha"))

    def test_ff_collision_returns_collision(self):
        def seam(*a, **k):
            if a[0] == "rev-parse" and a[1] == "HEAD": return (0, "oldsha", "")
            if a[0] == "merge": return (1, "", "untracked working tree files would be overwritten")
            return (0, "", "")
        with mock.patch.object(_update, "_git", side_effect=seam):
            ok, code, _ = _update._pull_and_validate(lambda *_: None)
        self.assertFalse(ok); self.assertEqual(code, "collision")


class UpgradeFlowTests(unittest.TestCase):
    def _patch_rebuild(self):
        return mock.patch.object(_update, "_rebuild_bundle", return_value=0, create=True)

    def test_precondition_info_returns_3_no_rebuild(self):
        pf = _update.Preflight(False, "dirty", "info", "msg")
        with mock.patch.object(_update, "_preflight", return_value=pf), \
             self._patch_rebuild() as rb:
            self.assertEqual(_update.upgrade(), 3)
        rb.assert_not_called()

    def test_up_to_date_still_rebuilds_returns_0(self):
        pf = _update.Preflight(True, "ready", "info", "")
        with mock.patch.object(_update, "_preflight", return_value=pf), \
             mock.patch.object(_update, "_measure_upstream", return_value=("uptodate", 0, "")), \
             mock.patch.object(_update, "_migrate_stray_bundle", create=True), \
             self._patch_rebuild() as rb:
            self.assertEqual(_update.upgrade(), 0)
        rb.assert_called_once()

    def test_ready_pulls_then_rebuilds(self):
        pf = _update.Preflight(True, "ready", "info", "")
        with mock.patch.object(_update, "_preflight", return_value=pf), \
             mock.patch.object(_update, "_measure_upstream", return_value=("ready", 2, "")), \
             mock.patch.object(_update, "_pull_and_validate", return_value=(True, "ready", "")) as pv, \
             mock.patch.object(_update, "_migrate_stray_bundle", create=True), \
             self._patch_rebuild() as rb:
            self.assertEqual(_update.upgrade(), 0)
        pv.assert_called_once(); rb.assert_called_once()

    def test_doctor_fail_returns_1_no_rebuild(self):
        pf = _update.Preflight(True, "ready", "info", "")
        with mock.patch.object(_update, "_preflight", return_value=pf), \
             mock.patch.object(_update, "_measure_upstream", return_value=("ready", 2, "")), \
             mock.patch.object(_update, "_pull_and_validate", return_value=(False, "doctor_fail", "x")), \
             self._patch_rebuild() as rb:
            self.assertEqual(_update.upgrade(), 1)
        rb.assert_not_called()


class AliasTests(unittest.TestCase):
    def test_sync_self_calls_upgrade(self):
        with mock.patch.object(_update, "upgrade", return_value=0) as up:
            self.assertEqual(_update.sync_self(), 0)
        up.assert_called_once()

    def test_main_update_calls_upgrade(self):
        with mock.patch.object(_update, "upgrade", return_value=0) as up:
            self.assertEqual(_update.main(["update"]), 0)
        up.assert_called_once()

    def test_main_rejects_unknown(self):
        self.assertEqual(_update.main(["frobnicate"]), 2)


if __name__ == "__main__":
    unittest.main()
