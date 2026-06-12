"""Unit tests for the Geneseed web API (rituals/web.py). Stdlib unittest only.

Run from the Geneseed root:  python -m unittest discover -s tests
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "rituals"))
sys.path.insert(0, str(ROOT))
import web  # noqa: E402


class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.state = web.WebState(theme="neutral")

    def test_overview_has_counts_and_doctor(self):
        ov = web.api_overview(self.state)
        self.assertIn("counts", ov)
        self.assertIn("agents", ov["counts"])
        self.assertIsInstance(ov["counts"]["agents"], int)
        self.assertGreater(ov["counts"]["agents"], 0)
        self.assertIn("doctor", ov)
        self.assertIn("ok", ov["doctor"])
        self.assertIsInstance(ov["doctor"]["problems"], list)
        self.assertIn("theme", ov)
        # The UI tints itself with the deployed theme's accent.
        self.assertIn(ov["accent"], ("red", "green", "yellow", "blue",
                                     "magenta", "cyan", "white"))
        self.assertIn("checked_at", ov["doctor"])

    def test_doctor_verdict_is_cached_until_refresh(self):
        first = web.api_overview(self.state)["doctor"]
        # Same object back on the next overview — no doctor re-run per request.
        self.assertIs(self.state.doctor, self.state.doctor)
        second = web.api_overview(self.state)["doctor"]
        self.assertEqual(first, second)
        self.state.refresh()
        self.assertIsNone(self.state._doctor)

    def test_catalog_agents_shape(self):
        cat = web.api_catalog(self.state, "agents")
        self.assertEqual(cat["section"], "agents")
        self.assertTrue(cat["items"])
        first = cat["items"][0]
        self.assertIn("name", first)
        self.assertIn("title", first)
        self.assertIn("desc", first)

    def test_catalog_unknown_section_raises(self):
        with self.assertRaises(web.NotFound):
            web.api_catalog(self.state, "bogus")

    def test_item_agent_returns_body(self):
        name = web.api_catalog(self.state, "agents")["items"][0]["name"]
        item = web.api_item(self.state, "agent", name)
        self.assertEqual(item["name"], name)
        self.assertTrue(item["body"])
        self.assertIn("links", item)
        self.assertIsInstance(item["links"], list)

    def test_item_missing_raises_notfound(self):
        with self.assertRaises(web.NotFound):
            web.api_item(self.state, "agent", "does-not-exist-xyz")


class DiffTests(unittest.TestCase):
    def test_diff_no_deployed_install(self):
        # Point at an empty temp dir => no GLOBAL_MANIFEST => deployed False.
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            state = web.WebState(theme="neutral", target=Path(tmp))
            res = web.api_diff(state)
            self.assertFalse(res["deployed"])
            self.assertEqual(res["files"], [])


class JobManagerTests(unittest.TestCase):
    def test_run_and_complete(self):
        jm = web.JobManager()
        jid = jm.start("noop", [sys.executable, "-c", "print('hello')"])
        self.assertIsNotNone(jid)
        job = jm.wait(jid, timeout=20)
        self.assertEqual(job["status"], "done")
        self.assertIn("hello", job["output"])
        self.assertEqual(job["returncode"], 0)

    def test_busy_returns_none(self):
        jm = web.JobManager()
        jid = jm.start("slow", [sys.executable, "-c", "import time; time.sleep(2)"])
        self.assertIsNotNone(jid)
        second = jm.start("other", [sys.executable, "-c", "print('x')"])
        self.assertIsNone(second)  # busy
        jm.wait(jid, timeout=20)

    def test_history_persists_and_reloads(self):
        import tempfile
        with tempfile.TemporaryDirectory() as t:
            hp = Path(t) / "runs.json"
            jm = web.JobManager(history_path=hp)
            jid = jm.start("noop", [sys.executable, "-c", "print('hi')"])
            jm.wait(jid, timeout=20)
            import time
            for _ in range(100):                 # save runs just after status flips
                if hp.is_file():
                    break
                time.sleep(0.05)
            self.assertTrue(hp.is_file())
            # A fresh manager (server restart) reloads the finished run.
            jm2 = web.JobManager(history_path=hp)
            jobs = jm2.recent()
            self.assertEqual(len(jobs), 1)
            self.assertEqual(jobs[0]["id"], jid)
            self.assertEqual(jobs[0]["status"], "done")
            self.assertIsNotNone(jobs[0]["duration"])
            self.assertIn("hi", jobs[0]["output"])

    def test_recent_is_chronological(self):
        jm = web.JobManager()
        a = jm.start("first", [sys.executable, "-c", "print(1)"])
        jm.wait(a, timeout=20)
        b = jm.start("second", [sys.executable, "-c", "print(2)"])
        jm.wait(b, timeout=20)
        ids = [j["id"] for j in jm.recent()]
        self.assertEqual(ids, [a, b])

    def test_cancel_terminates_a_running_job(self):
        jm = web.JobManager()
        jid = jm.start("slow", [sys.executable, "-c", "import time; time.sleep(30)"])
        import time
        for _ in range(100):                  # wait until the proc is registered
            if jm._procs.get(jid):
                break
            time.sleep(0.05)
        self.assertTrue(jm.cancel(jid))
        job = jm.wait(jid, timeout=20)
        self.assertEqual(job["status"], "failed")
        self.assertIn("cancelled by user", job["output"])

    def test_cancel_unknown_or_finished_returns_false(self):
        jm = web.JobManager()
        self.assertFalse(jm.cancel("nope"))
        jid = jm.start("quick", [sys.executable, "-c", "print('x')"])
        jm.wait(jid, timeout=20)
        self.assertFalse(jm.cancel(jid))

    def test_on_done_fires_after_completion(self):
        jm = web.JobManager()
        seen = []
        jid = jm.start("noop", [sys.executable, "-c", "print('x')"],
                       on_done=lambda: seen.append(True))
        jm.wait(jid, timeout=20)
        import time
        for _ in range(100):           # on_done runs just after status flips
            if seen:
                break
            time.sleep(0.05)
        self.assertEqual(seen, [True])

    def test_failure_captured(self):
        jm = web.JobManager()
        jid = jm.start("boom", [sys.executable, "-c",
                                "import sys; sys.stderr.write('bad'); sys.exit(3)"])
        job = jm.wait(jid, timeout=20)
        self.assertEqual(job["status"], "failed")
        self.assertEqual(job["returncode"], 3)
        self.assertIn("bad", job["output"])


class ActionCommandsTests(unittest.TestCase):
    def test_build_preserves_theme_and_emit(self):
        # Build must render the deployed install in its theme — not a bare,
        # neutral `build.py`. Global install => --theme <t> --emit opencode-global.
        cmds = web.action_commands("build", theme="imperial", emit="opencode-global")
        self.assertEqual(len(cmds), 1)
        argv = cmds[0]
        self.assertIn("--theme", argv)
        self.assertIn("imperial", argv)
        self.assertIn("--emit", argv)
        self.assertIn("opencode-global", argv)

    def test_update_runs_sync_then_upgrade(self):
        cmds = web.action_commands("update")
        self.assertEqual(len(cmds), 2)
        self.assertIn("sync-self", cmds[0])
        self.assertIn("upgrade", cmds[1])

    def test_unknown_action_is_none(self):
        self.assertIsNone(web.action_commands("bogus"))


class ThemePickerTests(unittest.TestCase):
    def setUp(self):
        self.state = web.WebState(theme="neutral")

    def test_api_themes_lists_themes_and_emits(self):
        t = web.api_themes(self.state)
        names = [x["name"] for x in t["themes"]]
        self.assertIn("neutral", names)
        self.assertIn("imperial", names)
        emits = [x["name"] for x in t["emits"]]
        self.assertIn("opencode-global", emits)
        self.assertEqual(t["current"]["theme"], "neutral")

    def test_build_override_valid_wins(self):
        theme, emit = web._build_override(self.state, {"theme": "imperial", "emit": "files"})
        self.assertEqual(theme, "imperial")
        self.assertEqual(emit, "files")

    def test_build_override_invalid_falls_back(self):
        self.state.emit = "opencode-global"
        theme, emit = web._build_override(self.state, {"theme": "bogus", "emit": "nope"})
        self.assertEqual(theme, "neutral")          # state.theme
        self.assertEqual(emit, "opencode-global")   # state.emit

    def test_build_override_empty_body_uses_state(self):
        theme, emit = web._build_override(self.state, {})
        self.assertEqual(theme, self.state.theme)
        self.assertEqual(emit, self.state.emit)

    def test_theme_choices_carry_gallery_fields(self):
        t = web.api_themes(self.state)
        neutral = next(x for x in t["themes"] if x["name"] == "neutral")
        for key in ("blurb", "accent", "tagline", "sigil"):
            self.assertIn(key, neutral)
        self.assertEqual(neutral["accent"], "cyan")
        # Every theme declares an accent the swatch palette knows.
        for x in t["themes"]:
            self.assertIn(x["accent"], ("red", "green", "yellow", "blue",
                                        "magenta", "cyan", "white"))


class DoctorTests(unittest.TestCase):
    def test_api_doctor_groups_match_flat_problems(self):
        state = web.WebState(theme="neutral")
        d = web.api_doctor(state)
        self.assertIn("groups", d)
        self.assertTrue(d["groups"])  # at least build/global/parity/authoring
        for g in d["groups"]:
            self.assertIn("check", g)
            self.assertIn("label", g)
            self.assertIsInstance(g["problems"], list)
        checks = {g["check"] for g in d["groups"]}
        self.assertLessEqual({"build", "global", "parity", "authoring"}, checks)
        # The flat list is exactly the union of the groups (deduped, sorted).
        union = sorted({p for g in d["groups"] for p in g["problems"]})
        self.assertEqual(d["problems"], union)
        self.assertEqual(d["ok"], not d["problems"])


class RestoreTests(unittest.TestCase):
    def _deploy(self, tmp: Path) -> "web.WebState":
        import contextlib
        import io
        cfg = tmp / "cfg"
        with contextlib.redirect_stdout(io.StringIO()):
            web.build.emit_opencode_global("neutral", out=tmp / "bundle", cfg=cfg)
        return web.WebState(theme="neutral", target=cfg)

    def test_restore_edited_deletes_added_rejects_bad_paths(self):
        import tempfile
        with tempfile.TemporaryDirectory() as t:
            tmp = Path(t)
            state = self._deploy(tmp)
            agent = state.target / "AGENT.md"
            original = agent.read_text(encoding="utf-8")
            agent.write_text(original + "\nLOCAL EDIT\n", encoding="utf-8")
            extra = state.target / "zz-extra.md"
            extra.write_text("local only\n", encoding="utf-8")

            res = web.api_restore(
                state, ["AGENT.md", "zz-extra.md", "bogus.md", "../escape.md"])

            self.assertIn("AGENT.md", res["restored"])      # edited -> source wins
            self.assertEqual(agent.read_text(encoding="utf-8"), original)
            self.assertIn("zz-extra.md", res["deleted"])    # added -> removed
            self.assertFalse(extra.exists())
            self.assertEqual(len(res["errors"]), 2)         # bogus + traversal

    def test_restore_without_deployed_install_is_an_error(self):
        import tempfile
        with tempfile.TemporaryDirectory() as t:
            state = web.WebState(theme="neutral", target=Path(t))
            res = web.api_restore(state, ["AGENT.md"])
            self.assertEqual(res["restored"], [])
            self.assertEqual(res["errors"], ["no deployed harness"])


class McpTests(unittest.TestCase):
    def test_api_mcp_lists_targets_and_states(self):
        state = web.WebState(theme="neutral")
        m = web.api_mcp(state)
        self.assertTrue(m["targets"])
        for t in m["targets"]:
            self.assertIn("path", t)
            self.assertIn("commented", t)
            for s in t["servers"]:
                self.assertIn(s["state"], ("enabled", "disabled", "absent"))
                self.assertIn("label", s)
        self.assertIsInstance(m["default"], int)

    def test_api_mcp_toggle_add_then_disable(self):
        import tempfile
        with tempfile.TemporaryDirectory() as t:
            cfg_path = Path(t) / "opencode.json"
            state = web.WebState(theme="neutral")
            preset = next(iter(web.harness._MCP_PRESETS))
            saved = web.harness._mcp_targets
            web.harness._mcp_targets = lambda: [("test", cfg_path)]
            try:
                res = web.api_mcp_toggle(
                    state, {"path": str(cfg_path), "name": preset, "enabled": True})
                self.assertTrue(res["ok"])
                self.assertEqual(res["state"], "enabled")
                res = web.api_mcp_toggle(
                    state, {"path": str(cfg_path), "name": preset, "enabled": False})
                self.assertTrue(res["ok"])
                self.assertEqual(res["state"], "disabled")
                with self.assertRaises(web.NotFound):
                    web.api_mcp_toggle(state, {"path": "bogus", "name": preset,
                                               "enabled": True})
            finally:
                web.harness._mcp_targets = saved


class GraphTests(unittest.TestCase):
    def test_api_graph_nodes_and_edges_resolve(self):
        state = web.WebState(theme="neutral")
        g = web.api_graph(state)
        self.assertTrue(g["nodes"])
        ids = {n["id"] for n in g["nodes"]}
        self.assertEqual(len(ids), len(g["nodes"]))          # unique nodes
        for n in g["nodes"]:
            self.assertIn(n["type"], ("agent", "skill"))
        for e in g["edges"]:
            self.assertIn(e["source"], ids)                  # edges resolve
            self.assertIn(e["target"], ids)
            self.assertNotEqual(e["source"], e["target"])    # no self-links
        # No duplicate edges.
        pairs = [(e["source"], e["target"]) for e in g["edges"]]
        self.assertEqual(len(pairs), len(set(pairs)))


class OfflineZipTests(unittest.TestCase):
    def test_offline_zip_holds_the_source_tree(self):
        import io
        import zipfile
        data, name = web.offline_zip_bytes()
        self.assertRegex(name, r"^geneseed-offline-\d{8}\.zip$")
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            names = zf.namelist()
        self.assertIn("geneseed-offline/build.py", names)
        self.assertIn("geneseed-offline/rituals/web.py", names)
        self.assertTrue(any(n.startswith("geneseed-offline/themes/") for n in names))
        self.assertFalse(any("/.git/" in n or "node_modules" in n for n in names))


class SetupTests(unittest.TestCase):
    def test_api_setup_reports_install_snapshot(self):
        state = web.WebState(theme="neutral")
        s = web.api_setup(state)
        for key in ("theme", "accent", "emit", "source_fp", "installed_fp",
                    "version_verdict", "root", "target", "deployed", "python",
                    "memory_dir", "facts"):
            self.assertIn(key, s)
        self.assertTrue(s["root"])
        self.assertRegex(s["python"], r"^\d+\.\d+")
        self.assertIsInstance(s["deployed"], bool)


class HandlerTests(unittest.TestCase):
    def _serve(self):
        state = web.WebState(theme="neutral")
        jm = web.JobManager()
        token = "test-token"
        Handler = web.make_handler(state, jm, token, dist=ROOT / "web" / "dist")
        from http.server import ThreadingHTTPServer
        srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        import threading
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        return srv, srv.server_address[1], token

    def test_overview_endpoint(self):
        import json
        import urllib.request
        srv, port, _ = self._serve()
        try:
            with urllib.request.urlopen(
                    f"http://127.0.0.1:{port}/api/overview", timeout=20) as r:
                data = json.loads(r.read())
            self.assertIn("counts", data)
        finally:
            srv.shutdown()

    def test_post_without_token_is_403(self):
        import urllib.error
        import urllib.request
        srv, port, _ = self._serve()
        try:
            req = urllib.request.Request(
                f"http://127.0.0.1:{port}/api/actions/doctor", method="POST",
                data=b"{}")
            with self.assertRaises(urllib.error.HTTPError) as cm:
                urllib.request.urlopen(req, timeout=20)
            self.assertEqual(cm.exception.code, 403)
        finally:
            srv.shutdown()


class WebAutoBuildTests(unittest.TestCase):
    """_build_plan decides what serve() does about a missing web/dist."""

    def setUp(self):
        import tempfile
        self.tmp = Path(tempfile.mkdtemp())
        self.web_dir = self.tmp / "web"
        self.dist = self.web_dir / "dist"

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _populate(self, *, dist=False, source=False):
        if source:
            self.web_dir.mkdir(parents=True, exist_ok=True)
            (self.web_dir / "package.json").write_text("{}", encoding="utf-8")
        if dist:
            self.dist.mkdir(parents=True, exist_ok=True)
            (self.dist / "index.html").write_text("<html></html>", encoding="utf-8")

    def test_serve_when_dist_built(self):
        self._populate(dist=True, source=True)
        self.assertEqual(web._build_plan(self.dist, self.web_dir, "npm", True), "serve")

    def test_no_source_without_package_json(self):
        self.assertEqual(web._build_plan(self.dist, self.web_dir, "npm", True), "no-source")

    def test_no_npm_when_npm_missing(self):
        self._populate(source=True)
        self.assertEqual(web._build_plan(self.dist, self.web_dir, None, True), "no-npm")

    def test_no_tty_when_not_interactive(self):
        self._populate(source=True)
        self.assertEqual(web._build_plan(self.dist, self.web_dir, "npm", False), "no-tty")

    def test_ask_when_buildable_and_interactive(self):
        self._populate(source=True)
        self.assertEqual(web._build_plan(self.dist, self.web_dir, "npm", True), "ask")


if __name__ == "__main__":
    unittest.main()
