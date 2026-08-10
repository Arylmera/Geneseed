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
sys.path.insert(0, str(Path(__file__).resolve().parent))
import golden  # noqa: E402  (the process-home sandbox)


#: Restored by `tearDownModule`. See `NoCellCanReachTheNetwork` for what it buys.
_SAVED_ALLOW_PROTOCOL: "str | None" = None


def setUpModule():
    # The route here is not visible in this file's own syntax: the tests that do NOT mock
    # `_rebuild_bundle` run a real one, which spawns the generator with this process's
    # environment — and `_write_hook_shim()` targets the ENVIRONMENT's home. Measured, and
    # declared in `_ROUTED_BY_ANOTHER_PATH`. See tests/test_home_sandbox.py.
    golden.sandbox_process_home()
    # THE SAME BAN `harness_golden._NO_NETWORK_ENV` PUTS ON EVERY CELL, for the module that
    # owns the verb those cells exercise. This file's flow tests call the REAL `upgrade()`
    # with `_measure_upstream` mocked out, and `upgrade()` logs "fetching from origin ..."
    # BEFORE that call — so the log claims a fetch that never happens, and a CI transcript
    # reads exactly like a test that went online. It was not one (measured: the fetch seam
    # is mocked in every arm that reaches it). But "no test reaches the network" was a
    # property of the mocks rather than of anything enforced, and one un-mocked seam in a
    # future arm would silently make it false. Git enforces it here instead: with
    # `GIT_ALLOW_PROTOCOL=file` a fetch over https dies with `transport 'https' not
    # allowed` before a socket opens, and `NoCellCanReachTheNetwork` proves that is what
    # happens rather than asserting it.
    global _SAVED_ALLOW_PROTOCOL
    _SAVED_ALLOW_PROTOCOL = os.environ.get("GIT_ALLOW_PROTOCOL")
    os.environ["GIT_ALLOW_PROTOCOL"] = "file"


def tearDownModule():
    if _SAVED_ALLOW_PROTOCOL is None:
        os.environ.pop("GIT_ALLOW_PROTOCOL", None)
    else:
        os.environ["GIT_ALLOW_PROTOCOL"] = _SAVED_ALLOW_PROTOCOL
    golden.restore_process_home()


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
        """A real subprocess running `script` stands in for git fetch.

        `spawned` collects the Popen objects handed back, because the pipe they carry is
        itself part of the contract — see `_assert_pipe_closed`."""
        real_popen = subprocess.Popen
        spawned = []
        def fake_which(_name):
            return sys.executable
        def fake_popen(cmd, **kw):
            p = real_popen([sys.executable, "-c", script], **{
                k: v for k, v in kw.items() if k != "env"})
            spawned.append(p)
            return p
        return fake_which, fake_popen, spawned

    def _assert_pipe_closed(self, spawned):
        """`_fetch_streaming` must close the read end on EVERY exit.

        Not tidiness. Its only production caller is `upgrade()`, which runs inside
        `geneseed web`'s daemon — a process that stays up for weeks — so a pipe left open
        per upgrade is a descriptor leaked per upgrade, and the unit suite was already
        saying so in `ResourceWarning: unclosed file` on two lines of this class. A
        ResourceWarning fires whenever the collector gets round to it, which makes it
        useless as a gate; the handle is checked directly instead."""
        # `spawned[0]` and not "the only one": on Windows `_kill_tree` shells out to
        # `taskkill`, and this stub patches `subprocess.Popen` module-wide, so the timeout
        # arm's kill is intercepted too and stands up a SECOND stub child. Only the first
        # is the fetch, and only the fetch's pipe is `_fetch_streaming`'s to close.
        self.assertTrue(spawned, "the stub should have spawned the fetch child")
        self.assertTrue(spawned[0].stdout.closed,
                        "_fetch_streaming returned with git's pipe still open")

    def test_streams_progress_and_returns_rc(self):
        which, popen, spawned = self._popen_stub(
            "import sys; print('Receiving objects: 100% (3/3), done.'); sys.exit(0)")
        logged = []
        with mock.patch.object(_update.shutil, "which", which), \
             mock.patch.object(_update.subprocess, "Popen", popen):
            rc, tail = _update._fetch_streaming(logged.append)
        self.assertEqual(rc, 0)
        self.assertIn("Receiving objects", tail)
        self.assertTrue(any("Receiving objects" in m for m in logged))
        self._assert_pipe_closed(spawned)

    def test_timeout_kills_and_returns_none(self):
        which, popen, spawned = self._popen_stub("import time; time.sleep(60)")
        logged = []
        with mock.patch.object(_update.shutil, "which", which), \
             mock.patch.object(_update.subprocess, "Popen", popen), \
             mock.patch.object(_update, "_fetch_timeout", return_value=1), \
             mock.patch.object(_update.time, "sleep", lambda s: None):
            rc, _ = _update._fetch_streaming(logged.append)
        self.assertIsNone(rc)
        self.assertTrue(any("killed it" in m for m in logged))
        # The timeout arm returns from INSIDE the poll loop, which is the exit a `close()`
        # written after the loop would miss.
        self._assert_pipe_closed(spawned)

    def test_no_git_exe(self):
        with mock.patch.object(_update.shutil, "which", lambda _n: None):
            rc, err = _update._fetch_streaming()
        self.assertIsNone(rc)
        self.assertIn("git is not installed", err)


@unittest.skipUnless(shutil.which("git"), "git is not on PATH")
class NoCellCanReachTheNetwork(unittest.TestCase):
    """The POSITIVE CONTROL for `setUpModule`'s `GIT_ALLOW_PROTOCOL=file`.

    Declaring a ban and running under one are two properties, and only the second is worth
    anything: this runs the REAL `_fetch_streaming` — no mock, no seam — against this
    checkout's real `origin`, and requires git to refuse it by TRANSPORT. Without the
    variable the same call fetches, so the gate is red the moment the ban stops being
    applied, on any machine and in CI.

    It is harmless on the way to being useful: the refusal happens in git's own argument
    handling, before a connection is attempted, and `fetch` writes nothing to the working
    tree on the failing path."""

    def test_a_real_fetch_is_refused_by_transport(self):
        rc, url, _ = _update._git("remote", "get-url", "origin")
        url = (url or "").strip()
        if rc != 0 or not url.startswith(("http://", "https://", "ssh://", "git@")):
            self.skipTest(f"origin is not a network remote here ({url[:60]!r})")
        code, out = _update._fetch_streaming()
        self.assertNotEqual(code, 0, "the fetch SUCCEEDED — the network ban is not applied")
        self.assertIn("not allowed", out,
                      "git failed for some other reason than the transport ban; the ban "
                      f"may not be in effect. git said: {out!r}")


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


class TheShellWrappersAreGone(unittest.TestCase):
    """P8b deleted `upgrade.sh` and `sync-self.sh`, and a deletion needs a gate too.

    THEY WERE ALREADY VESTIGIAL AND THAT IS THE ARGUMENT, checked here rather than asserted in
    a commit message. Each was ~30 lines of bash whose entire body was an interpreter probe and
    `exec "$PY" rituals/harness.py {upgrade|sync-self} "$@"` — the same subcommand every
    launcher already calls, on every OS, with no bash. They could not run on native Windows,
    where the flow they name has been the documented one for as long as `geneseed.cmd` has
    existed. What replaces them is not new: it is `geneseed upgrade`, `python rituals/harness.py
    upgrade`, and now `node bin/geneseed-cli.mjs upgrade`.

    THE ONE THING THAT MUST NOT GO WITH THEM is `_update.main()`. All three launchers (`geneseed`,
    `geneseed.cmd`, `geneseed.ps1`) probe `harness.py <cmd> --help` and, on a miss, fall back to
    `python rituals/_update.py <cmd>` to self-heal a factory too old to know the subcommand.
    That is a STABLE CONTRACT, it never went through either wrapper, and `AliasTests` below is
    what keeps it answering.
    """

    #: The two files.
    GONE = ("upgrade.sh", "sync-self.sh")

    #: THE HISTORICAL RECORDS, exempt from the scan below — and the exemption is the scan's
    #: own premise applied honestly rather than a hole in it. What it hunts is a POINTER: a
    #: doc, launcher or CI step that tells someone to run a script that is not there. A
    #: changelog entry saying "`upgrade.sh` and `sync-self.sh` are gone, use `geneseed
    #: upgrade`" is the opposite of that, and DESIGN.md's record of why they went is the
    #: reasoning a future reader needs most. Scrubbing the names out of an append-only
    #: history to satisfy a grep would delete the record OF the removal.
    RECORDS = ("CHANGELOG.md", "DESIGN.md")

    def _tracked(self):
        out = subprocess.run(["git", "ls-files"], cwd=str(ROOT), capture_output=True,
                             text=True, encoding="utf-8")
        self.assertEqual(out.returncode, 0, "git ls-files failed — the scan below would be "
                                            "vacuous rather than passing")
        return [ROOT / rel for rel in out.stdout.split("\n") if rel.strip()]

    def test_neither_wrapper_is_tracked_any_more(self):
        for name in self.GONE:
            with self.subTest(script=name):
                self.assertFalse((ROOT / name).exists(), f"{name} is back on disk")
        tracked = {p.name for p in self._tracked()}
        self.assertTrue(tracked, "the tracked-file list is empty")
        for name in self.GONE:
            self.assertNotIn(name, tracked)

    def test_nothing_in_the_repository_still_points_at_them(self):
        """The half a `rm` does not do. A launcher, a doc or a CI step naming a script that is
        no longer there fails at the moment a user runs it, which is the worst time to find out
        — and `bootstrap`'s own header comment described the update as "sync-self.sh then
        upgrade.sh" long after the harness stopped invoking either.

        EVERY tracked text file, not just the launchers: the references were spread across
        README, SETUP, two adapter documents, a docs page, three `rituals/` modules and a
        comment in `build.py`. This file names them, which is why it excludes itself, and so
        do the two append-only records — see `RECORDS` for why that is the rule rather than an
        exception to it.
        """
        offenders = []
        scanned = 0
        for p in self._tracked():
            if p.resolve() == Path(__file__).resolve() or not p.is_file():
                continue
            if p.name in self.RECORDS and p.parent == ROOT:
                continue
            if p.suffix.lower() in (".woff2", ".png", ".jpg", ".ico", ".gz"):
                continue
            try:
                text = p.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            scanned += 1
            for name in self.GONE:
                if name in text:
                    offenders.append(f"{p.relative_to(ROOT).as_posix()} -> {name}")
        # Non-vacuity, because two exemptions and three `continue`s are exactly how a scan
        # ends up reading nothing and reporting a pass.
        self.assertGreater(scanned, 100, f"the scan read only {scanned} files, so a clean "
                                         f"result says nothing")
        self.assertFalse(offenders, "these still name a deleted shell wrapper:\n  "
                                    + "\n  ".join(sorted(offenders)))


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


class TheHandoffKeepsWhatWasAlreadyPrinted(unittest.TestCase):
    """`_harness_lifecycle._reexec`, off a terminal, on whichever platform is running.

    THE CONTRACT IS THE SAME ON BOTH AND ONLY ONE CAN BREAK IT. Windows has no `exec`, so
    that branch runs the successor as a child and this process's buffers are flushed at exit
    as usual. POSIX calls `os.execv`, which replaces the process IMAGE — Python's stdio
    buffers go with it, and off a terminal stdout is block-buffered, so everything printed
    since the last flush is discarded. `geneseed bootstrap > log.txt` lost `[geneseed] ✓
    update complete.` on every Unix run, for as long as the verb has existed.

    Written as a subprocess with a PIPE for stdout, because a terminal is exactly the
    condition under which the bug does not happen: line buffering had already written the
    line. The child is spelled with the real `_reexec` rather than a stand-in, and the
    successor prints a second marker so a `_reexec` that silently did nothing fails too."""

    def test_nothing_printed_before_the_handoff_is_lost(self):
        script = (
            "import sys, os\n"
            f"sys.path.insert(0, {str(ROOT / 'rituals')!r})\n"
            f"sys.path.insert(0, {str(ROOT)!r})\n"
            "import _harness_lifecycle as L\n"
            "print('BEFORE-THE-HANDOFF')\n"
            "L._reexec([sys.executable, '-c', \"print('AFTER-THE-HANDOFF')\"])\n"
        )
        r = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True,
                           encoding="utf-8", env=dict(os.environ, PYTHONUTF8="1"))
        self.assertIn("AFTER-THE-HANDOFF", r.stdout,
                      f"the successor never ran: {r.stderr!r}")
        self.assertIn("BEFORE-THE-HANDOFF", r.stdout,
                      "the handoff discarded this process's buffered stdout — os.execv "
                      f"replaces the image, buffers included. stderr was {r.stderr!r}")


if __name__ == "__main__":
    unittest.main()
