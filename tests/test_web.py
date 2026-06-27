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
        self.assertIn("config", ov["counts"])
        self.assertIsInstance(ov["counts"]["config"], int)

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

    def test_agent_item_and_catalog_carry_source(self):
        # Agents/skills now expose their src/ file too, so the UI shows the real
        # path instead of guessing one — uniform with memory/notebook.
        row = web.api_catalog(self.state, "agents")["items"][0]
        self.assertTrue(Path(row["source"]).is_file())
        item = web.api_item(self.state, "agent", row["name"])
        self.assertEqual(item["source"], row["source"])

    def test_file_backed_item_carries_resolved_source_path(self):
        # The detail pane shows where a document lives on disk; the file-backed
        # item branch (shared by memory + notebook) must return the absolute,
        # resolved path to the file it read. Driven through notebook because its
        # directory hangs off state.target and so is hermetic to control.
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            nb = Path(tmp) / "notebook"
            nb.mkdir()
            (nb / "ritual.md").write_text("# Ritual\n", encoding="utf-8")
            state = web.WebState(theme="neutral", target=Path(tmp))
            item = web.api_item(state, "notebook", "ritual")
            self.assertEqual(Path(item["source"]), (nb / "ritual.md").resolve())
            # The catalog row carries the same source, so the list and the
            # detail pane agree without the UI having to guess the path.
            row = web.api_catalog(state, "notebook")["items"][0]
            self.assertEqual(row["source"], item["source"])


class SpecDescTests(unittest.TestCase):
    # Purpose derivation for deployed specs: blockquote first, then frontmatter
    # description, then first prose paragraph — so vendored skills with no
    # blockquote (daydream, react-view-transitions) never show a blank Purpose.
    def test_blockquote_wins(self):
        import _web_core
        body = "# Title\n\n> the curated purpose\n\nMore text."
        self.assertEqual(_web_core._spec_desc({"description": "fm desc"}, body),
                         "the curated purpose")

    def test_falls_back_to_frontmatter_description(self):
        import _web_core
        body = "# React View Transitions\n\nAnimate between UI states."
        self.assertEqual(_web_core._spec_desc({"description": "Guide for view\ntransitions"}, body),
                         "Guide for view transitions")

    def test_falls_back_to_first_paragraph(self):
        import _web_core
        body = "# Vault Daydream Skill\n\nMines the vault\nfor connections.\n\n## Usage"
        self.assertEqual(_web_core._spec_desc({}, body), "Mines the vault for connections.")


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


class WikiTests(unittest.TestCase):
    def setUp(self):
        import json
        import os
        import tempfile
        self.tmp = Path(tempfile.mkdtemp())
        vault = self.tmp / "vault"
        (vault / "sub").mkdir(parents=True)
        (vault / "Hidden").mkdir()
        (vault / "Note.md").write_text("# Note\nSee [[learn]].", encoding="utf-8")
        (vault / "sub" / "Page.md").write_text("# Page", encoding="utf-8")
        (vault / "Hidden" / "Secret.md").write_text("# Secret", encoding="utf-8")
        manifest = self.tmp / "wiki.jsonc"
        manifest.write_text(json.dumps({"wikis": [{
            "name": "test", "path": str(vault),
            "entries": [
                {"path": "Note.md", "load": "eager", "description": "the note"},
                {"path": "sub/", "load": "lazy"},
                {"path": "Hidden/", "load": "exclude"},
            ]}]}), encoding="utf-8")
        os.environ["GENESEED_WIKI"] = str(manifest)
        self.state = web.WebState(theme="neutral")

    def tearDown(self):
        import os
        import shutil
        os.environ.pop("GENESEED_WIKI", None)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_catalog_lists_pages_minus_excluded(self):
        cat = web.api_catalog(self.state, "wiki")
        names = [i["name"] for i in cat["items"]]
        self.assertIn("test:Note.md", names)
        self.assertIn("test:sub/Page.md", names)
        self.assertNotIn("test:Hidden/Secret.md", names)

    def test_item_reads_page_and_blocks_traversal(self):
        item = web.api_item(self.state, "wiki", "test:Note.md")
        self.assertIn("# Note", item["body"])
        self.assertEqual(item["title"], "Note")
        with self.assertRaises(web.NotFound):
            web.api_item(self.state, "wiki", "test:../wiki.jsonc")
        with self.assertRaises(web.NotFound):
            web.api_item(self.state, "wiki", "nope:Note.md")


class McpTests(unittest.TestCase):
    def test_api_mcp_lists_targets_and_states(self):
        state = web.WebState(theme="neutral")
        # api_mcp only lists targets whose install is active; force one so the
        # structure check doesn't hinge on the host machine having an install. Each
        # target now carries its owning install's (host, root) for the table to join on.
        saved_t, saved_s = web.harness._install_targets, web.harness._install_state
        web.harness._install_targets = lambda: [("opencode", "project", Path("."))]
        web.harness._install_state = lambda root, host="opencode", scope="global": "active"
        try:
            m = web.api_mcp(state)
        finally:
            web.harness._install_targets, web.harness._install_state = saved_t, saved_s
        self.assertTrue(m["targets"])
        for t in m["targets"]:
            self.assertIn("path", t)
            self.assertIn("commented", t)
            self.assertIn(t["host"], ("opencode", "claude", "bob"))
            self.assertIn("root", t)
            for s in t["servers"]:
                self.assertIn(s["state"], ("enabled", "disabled", "absent"))
                self.assertIn("label", s)
        self.assertIsInstance(m["default"], int)

    def test_api_mcp_toggle_opencode_add_then_disable(self):
        import tempfile
        with tempfile.TemporaryDirectory() as t:
            root = Path(t)
            cfg_path = root / "opencode.json"
            state = web.WebState(theme="neutral")
            preset = next(iter(web.harness._MCP_PRESETS))
            saved = web.harness._mcp_install_targets
            web.harness._mcp_install_targets = \
                lambda: [("test", cfg_path, "opencode", "project", root)]
            try:
                res = web.api_mcp_toggle(
                    state, {"path": str(cfg_path), "name": preset, "enabled": True})
                self.assertTrue(res["ok"])
                self.assertEqual(res["state"], "enabled")
                # OpenCode keeps the entry and flips its enabled flag → 'disabled'.
                res = web.api_mcp_toggle(
                    state, {"path": str(cfg_path), "name": preset, "enabled": False})
                self.assertTrue(res["ok"])
                self.assertEqual(res["state"], "disabled")
                with self.assertRaises(web.NotFound):
                    web.api_mcp_toggle(state, {"path": "bogus", "name": preset,
                                               "enabled": True})
            finally:
                web.harness._mcp_install_targets = saved

    def test_api_mcp_toggle_claude_add_then_remove(self):
        import tempfile, json as _json
        with tempfile.TemporaryDirectory() as t:
            root = Path(t)
            cfg_path = root / ".mcp.json"
            state = web.WebState(theme="neutral")
            saved = web.harness._mcp_install_targets
            web.harness._mcp_install_targets = \
                lambda: [("project config", cfg_path, "claude", "project", root)]
            try:
                # Add markitdown → written under `mcpServers` in Claude's split shape.
                res = web.api_mcp_toggle(
                    state, {"path": str(cfg_path), "name": "markitdown", "enabled": True})
                self.assertTrue(res["ok"])
                self.assertEqual(res["state"], "enabled")
                cfg = _json.loads(cfg_path.read_text())
                self.assertEqual(cfg["mcpServers"]["markitdown"],
                                 {"command": "uvx", "args": ["markitdown-mcp"]})
                self.assertNotIn("mcp", cfg)            # not OpenCode's key
                # Claude has no enabled flag → toggling off REMOVES the entry (state absent).
                res = web.api_mcp_toggle(
                    state, {"path": str(cfg_path), "name": "markitdown", "enabled": False})
                self.assertTrue(res["ok"])
                self.assertEqual(res["state"], "absent")
                self.assertNotIn("markitdown",
                                 _json.loads(cfg_path.read_text()).get("mcpServers", {}))
            finally:
                web.harness._mcp_install_targets = saved

    def test_api_mcp_toggle_claude_preserves_other_keys_and_refuses_unparseable(self):
        import tempfile, json as _json
        with tempfile.TemporaryDirectory() as t:
            root = Path(t)
            cfg_path = root / ".claude.json"            # the user-scope config holds far more than MCP
            state = web.WebState(theme="neutral")
            saved = web.harness._mcp_install_targets
            web.harness._mcp_install_targets = \
                lambda: [("global config", cfg_path, "claude", "global", root)]
            try:
                cfg_path.write_text(_json.dumps(
                    {"numStartups": 7, "projects": {"/x": {}}}))
                res = web.api_mcp_toggle(
                    state, {"path": str(cfg_path), "name": "gitlab", "enabled": True})
                self.assertTrue(res["ok"])
                after = _json.loads(cfg_path.read_text())
                self.assertEqual(after["numStartups"], 7)         # unrelated keys preserved
                self.assertIn("gitlab", after["mcpServers"])
                # A config we can't parse is refused, never clobbered.
                cfg_path.write_text("{ not json")
                res = web.api_mcp_toggle(
                    state, {"path": str(cfg_path), "name": "markitdown", "enabled": True})
                self.assertFalse(res["ok"])
                self.assertEqual(cfg_path.read_text(), "{ not json")
            finally:
                web.harness._mcp_install_targets = saved

    def test_api_mcp_toggle_claude_does_not_mangle_string_values(self):
        """A Claude config is strict JSON and must round-trip byte-faithfully: a string
        value holding ',]' or ', }' (realistic in ~/.claude.json history/prompts) must NOT
        have its comma silently dropped by the OpenCode comment-stripper's trailing-comma
        pass. Regression guard for the parser-mismatch data-loss bug."""
        import tempfile, json as _json
        with tempfile.TemporaryDirectory() as t:
            root = Path(t)
            cfg_path = root / ".claude.json"
            state = web.WebState(theme="neutral")
            # Values that the non-string-aware trailing-comma regex would corrupt.
            booby = {"history": [{"display": "jq .a[] | select(.x,]"},
                                 {"display": "rewrite {a, } please"}],
                     "note": "fix [1,2,] and {b, }"}
            cfg_path.write_text(_json.dumps(booby))
            saved = web.harness._mcp_install_targets
            web.harness._mcp_install_targets = \
                lambda: [("global config", cfg_path, "claude", "global", root)]
            try:
                res = web.api_mcp_toggle(
                    state, {"path": str(cfg_path), "name": "markitdown", "enabled": True})
                self.assertTrue(res["ok"])
                after = _json.loads(cfg_path.read_text())
                # Every booby-trapped string survives intact — no dropped commas.
                self.assertEqual(after["history"], booby["history"])
                self.assertEqual(after["note"], booby["note"])
                self.assertIn("markitdown", after["mcpServers"])
            finally:
                web.harness._mcp_install_targets = saved


class InstallActivationTests(unittest.TestCase):
    """The Harness-installs switch: deactivate moves owned artifacts into a sibling
    `.geneseed-disabled/` stash and strips the AGENT.md `instructions` entry — never
    deleting a file — and reactivate restores the exact prior bytes. Backed by the
    on-disk stash dir alone; no recorded JSON state. Drives the engine through the web
    API (api_installs / api_install_toggle) with `_install_targets` monkeypatched to a
    single seeded GLOBAL root, so the suite is hermetic and cwd-independent."""

    DISABLED = ".geneseed-disabled"

    def setUp(self):
        import tempfile
        self.tmp = Path(tempfile.mkdtemp())
        self.root = (self.tmp / "opencode").resolve()
        self.root.mkdir(parents=True)
        self.state = web.WebState(theme="neutral")
        # One detected install: a GLOBAL root (it carries a manifest). Mirror the
        # path-allowlist contract of api_install_toggle by pinning _install_targets.
        self._saved_targets = web.harness._install_targets
        web.harness._install_targets = lambda: [("opencode", "global", self.root)]

    def tearDown(self):
        import shutil
        web.harness._install_targets = self._saved_targets
        shutil.rmtree(self.tmp, ignore_errors=True)

    # -- seeding -------------------------------------------------------------
    def _agent_entry(self) -> str:
        # The global emit wires `instructions` at the absolute AGENT.md posix path
        # (see _build_global.py:181 / _uninstall_global) — match it exactly.
        return (self.root / "AGENT.md").as_posix()

    def _seed_global(self, *, opencode_text: "str | None" = None):
        """A minimal GLOBAL install: AGENT.md + agents/x.md + a manifest listing them
        (plus VERSION_MARKER, the one marker the real manifest carries) + an
        opencode.json whose `instructions` already points at AGENT.md."""
        import json
        (self.root / "AGENT.md").write_text("# Rules\nbody\n", encoding="utf-8")
        (self.root / "agents").mkdir()
        (self.root / "agents" / "x.md").write_text("# agent x\n", encoding="utf-8")
        # VERSION_MARKER is the only marker that appears in `owned`; deactivate must
        # leave it in place (theme/version detection keeps working while disabled).
        (self.root / web.build.VERSION_MARKER).write_text("v\n", encoding="utf-8")
        manifest = {"owned": sorted(["AGENT.md", "agents/x.md", web.build.VERSION_MARKER])}
        (self.root / web.build.GLOBAL_MANIFEST).write_text(
            json.dumps(manifest), encoding="utf-8")
        cfg = opencode_text if opencode_text is not None else json.dumps(
            {"instructions": [self._agent_entry()], "lsp": True})
        (self.root / "opencode.json").write_text(cfg, encoding="utf-8")

    def _instructions(self) -> list:
        import json
        data = json.loads((self.root / "opencode.json").read_text(encoding="utf-8"))
        return data.get("instructions", [])

    def _stash(self) -> Path:
        return self.root / self.DISABLED

    # -- shape ---------------------------------------------------------------
    def test_api_installs_shape_and_state_per_scope(self):
        self._seed_global()
        res = web.api_installs(self.state)
        self.assertIn("installs", res)
        self.assertEqual(len(res["installs"]), 1)          # one row per scope
        row = res["installs"][0]
        for key in ("id", "host", "scope", "path", "state"):
            self.assertIn(key, row)
        self.assertEqual(row["host"], "opencode")
        self.assertEqual(row["scope"], "global")
        self.assertEqual(row["path"], str(self.root))
        self.assertEqual(row["state"], "active")           # manifest present, no stash

        # absent: a root with neither manifest nor .opencode/ reports `absent`.
        web.harness._install_targets = lambda: [("opencode", "global", self.tmp / "empty")]
        (self.tmp / "empty").mkdir()
        self.assertEqual(
            web.api_installs(self.state)["installs"][0]["state"], "absent")

    # -- round trip ----------------------------------------------------------
    def test_deactivate_then_reactivate_restores_exact_bytes(self):
        self._seed_global()
        agent_bytes = (self.root / "AGENT.md").read_bytes()
        x_bytes = (self.root / "agents" / "x.md").read_bytes()

        res = web.api_install_toggle(
            self.state, {"host": "opencode", "path": str(self.root), "action": "deactivate"})
        self.assertTrue(res["ok"])
        self.assertEqual(res["kind"], "global")
        self.assertEqual(res["moved"], 2)                  # AGENT.md + agents/x.md

        # artifacts now live under the stash, at their original rel paths...
        self.assertTrue(self._stash().is_dir())
        self.assertTrue((self._stash() / "AGENT.md").is_file())
        self.assertTrue((self._stash() / "agents" / "x.md").is_file())
        # ...and NO file was deleted — bytes preserved in the stash.
        self.assertEqual((self._stash() / "AGENT.md").read_bytes(), agent_bytes)
        self.assertEqual((self._stash() / "agents" / "x.md").read_bytes(), x_bytes)
        # the live copies are gone from the discovery path...
        self.assertFalse((self.root / "AGENT.md").exists())
        self.assertFalse((self.root / "agents" / "x.md").exists())
        # ...and the emptied owned dir is pruned (uninstall's ancestor-climb).
        self.assertFalse((self.root / "agents").exists())
        # the AGENT.md instructions entry is stripped.
        self.assertNotIn(self._agent_entry(), self._instructions())
        # VERSION_MARKER stays put — markers are excluded from the move.
        self.assertTrue((self.root / web.build.VERSION_MARKER).is_file())
        self.assertFalse((self._stash() / web.build.VERSION_MARKER).exists())
        # state now reads `disabled` (the stash dir IS the flag).
        self.assertEqual(
            web.api_installs(self.state)["installs"][0]["state"], "disabled")

        res = web.api_install_toggle(
            self.state, {"host": "opencode", "path": str(self.root), "action": "activate"})
        self.assertTrue(res["ok"])
        # restored exactly to the original rel paths, byte-for-byte.
        self.assertEqual((self.root / "AGENT.md").read_bytes(), agent_bytes)
        self.assertEqual((self.root / "agents" / "x.md").read_bytes(), x_bytes)
        # the instructions entry is back.
        self.assertIn(self._agent_entry(), self._instructions())
        # the stash dir is removed once everything is restored.
        self.assertFalse(self._stash().exists())
        self.assertEqual(
            web.api_installs(self.state)["installs"][0]["state"], "active")

    # -- roll-back -----------------------------------------------------------
    def test_deactivate_rolls_back_on_a_failed_move(self):
        self._seed_global()
        agent_bytes = (self.root / "AGENT.md").read_bytes()
        x_bytes = (self.root / "agents" / "x.md").read_bytes()
        # Plant a plain FILE named like the stash dir. `_install_state` gates on
        # `(root / DISABLED_STASH).is_dir()`, so a file leaves state `active` (the
        # op is allowed to start) — but every `mkdir(stash / rel)` then fails,
        # forcing a mid-operation failure and a full roll-back.
        self._stash().write_text("not a dir\n", encoding="utf-8")

        res = web.api_install_toggle(
            self.state, {"host": "opencode", "path": str(self.root), "action": "deactivate"})
        self.assertFalse(res["ok"])
        self.assertIn("failed", res)
        self.assertTrue(res["failed"])

        # Everything is back where it started — no half-gutted install.
        self.assertTrue((self.root / "AGENT.md").is_file())
        self.assertEqual((self.root / "AGENT.md").read_bytes(), agent_bytes)
        self.assertTrue((self.root / "agents" / "x.md").is_file())
        self.assertEqual((self.root / "agents" / "x.md").read_bytes(), x_bytes)
        # The config edit is the LAST step, so a move failure leaves it intact.
        self.assertIn(self._agent_entry(), self._instructions())
        # The install is still ACTIVE — the blocking file is not a stash dir.
        self.assertEqual(
            web.api_installs(self.state)["installs"][0]["state"], "active")
        # The blocking artifact we planted is untouched (engine deleted nothing).
        self.assertEqual(self._stash().read_text(encoding="utf-8"), "not a dir\n")

    # -- re-emit while disabled ---------------------------------------------
    def test_reactivate_discards_stash_when_files_re_created(self):
        self._seed_global()
        res = web.api_install_toggle(
            self.state, {"host": "opencode", "path": str(self.root), "action": "deactivate"})
        self.assertTrue(res["ok"])
        self.assertTrue(self._stash().is_dir())

        # Simulate `geneseed build` re-creating the live install while disabled:
        # the manifest + AGENT.md + agents are back on the discovery path.
        self._seed_global()                               # rewrites live files
        self.assertTrue((self.root / "AGENT.md").is_file())

        res = web.api_install_toggle(
            self.state, {"host": "opencode", "path": str(self.root), "action": "activate"})
        self.assertTrue(res["ok"])
        self.assertIn("note", res)
        self.assertIn("discarded", res["note"])
        # The stale stash is discarded, the live files are untouched...
        self.assertFalse(self._stash().exists())
        self.assertTrue((self.root / "AGENT.md").is_file())
        # ...and the instructions entry is ensured present.
        self.assertIn(self._agent_entry(), self._instructions())
        self.assertEqual(
            web.api_installs(self.state)["installs"][0]["state"], "active")

    # -- commented .jsonc refusal -------------------------------------------
    def test_deactivate_refuses_commented_jsonc_and_moves_nothing(self):
        # OpenCode prefers a present opencode.jsonc; a commented one must not be
        # rewritten (it would drop the comments), so deactivate aborts up front.
        self._seed_global()
        (self.root / "opencode.json").unlink()
        (self.root / "opencode.jsonc").write_text(
            '// my notes\n{\n  "instructions": ["' + self._agent_entry() + '"]\n}\n',
            encoding="utf-8")

        res = web.api_install_toggle(
            self.state, {"host": "opencode", "path": str(self.root), "action": "deactivate"})
        self.assertFalse(res["ok"])
        self.assertIn("error", res)
        # Nothing moved: live files in place, no stash created, comments intact.
        self.assertTrue((self.root / "AGENT.md").is_file())
        self.assertTrue((self.root / "agents" / "x.md").is_file())
        self.assertFalse(self._stash().exists())
        self.assertIn("// my notes",
                      (self.root / "opencode.jsonc").read_text(encoding="utf-8"))
        self.assertEqual(
            web.api_installs(self.state)["installs"][0]["state"], "active")

    # -- endpoint allowlist --------------------------------------------------
    def test_install_toggle_rejects_unknown_path(self):
        self._seed_global()
        with self.assertRaises(web.NotFound):
            web.api_install_toggle(
                self.state, {"path": "/no/such/root", "action": "deactivate"})

    def test_install_toggle_unknown_action_is_not_ok(self):
        self._seed_global()
        res = web.api_install_toggle(
            self.state, {"host": "opencode", "path": str(self.root), "action": "bogus"})
        self.assertFalse(res["ok"])


class InstallCreateTests(unittest.TestCase):
    """api_install_cmd resolves the build command for an install/re-theme, keyed on the
    (host, path) allowlist; installs an absent row, rebuilds an active one, refuses a
    disabled one and an unknown pair."""

    def setUp(self):
        self.state = web.WebState(theme="neutral")
        self._saved = (web.harness._install_targets, web.harness._install_state)
        self.cl = Path("/home/.claude")              # absent (claude)
        self.oc = Path("/home/.config/opencode")     # active (opencode)
        self.dis = Path("/home/proj")                # disabled (opencode project)
        web.harness._install_targets = lambda: [
            ("claude", "global", self.cl), ("opencode", "global", self.oc),
            ("opencode", "project", self.dis)]
        st = {(str(self.cl), "claude"): "absent", (str(self.oc), "opencode"): "active",
              (str(self.dis), "opencode"): "disabled"}
        web.harness._install_state = lambda r, h="opencode", s="global": \
            st.get((str(r), h), "absent")

    def tearDown(self):
        web.harness._install_targets, web.harness._install_state = self._saved

    def test_install_cmd_for_absent_global_target(self):
        plan = web.api_install_cmd(self.state, {"host": "claude", "path": str(self.cl)})
        self.assertIn("cmd", plan)
        self.assertIn("claude-global", plan["cmd"])
        self.assertIn("neutral", plan["cmd"])           # inherits the current voice
        self.assertNotIn("--out", plan["cmd"])          # a global install takes no out/root

    def test_install_cmd_honours_a_valid_picked_theme(self):
        plan = web.api_install_cmd(
            self.state, {"host": "claude", "path": str(self.cl), "theme": "imperial"})
        self.assertIn("imperial", plan["cmd"])

    def test_install_cmd_rejects_a_bogus_theme_and_falls_back(self):
        plan = web.api_install_cmd(
            self.state, {"host": "claude", "path": str(self.cl), "theme": "../evil"})
        self.assertNotIn("../evil", plan["cmd"])        # never reaches the argv
        self.assertIn("neutral", plan["cmd"])           # falls back to state.theme

    def test_install_cmd_rebuilds_an_active_install(self):
        # An active row re-themes/rebuilds in place — same build command, no refusal.
        plan = web.api_install_cmd(
            self.state, {"host": "opencode", "path": str(self.oc), "theme": "imperial"})
        self.assertIn("cmd", plan)
        self.assertIn("opencode-global", plan["cmd"])
        self.assertIn("imperial", plan["cmd"])

    def test_install_cmd_refuses_a_disabled_install(self):
        plan = web.api_install_cmd(self.state, {"host": "opencode", "path": str(self.dis)})
        self.assertIn("error", plan)
        self.assertIn("disabled", plan["error"])

    def test_install_cmd_unknown_pair_raises(self):
        with self.assertRaises(web.NotFound):
            web.api_install_cmd(self.state, {"host": "claude", "path": "/no/such/root"})


class SelectViewTests(unittest.TestCase):
    """The harness selector: api_select_view re-points the whole console at a detected
    install (target/theme/emit), and api_installs marks the current one selected."""

    def setUp(self):
        import tempfile
        self.tmp = Path(tempfile.mkdtemp())
        self.oc = (self.tmp / "oc").resolve(); self.oc.mkdir()
        self.cl = (self.tmp / "cl").resolve(); self.cl.mkdir()
        (self.cl / ".geneseed-emit").write_text("claude-global", encoding="utf-8")
        (self.cl / ".geneseed-theme").write_text("imperial", encoding="utf-8")
        self.state = web.WebState(theme="neutral", target=self.oc)
        self._saved = web.harness._install_targets
        web.harness._install_targets = lambda: [
            ("opencode", "global", self.oc), ("claude", "global", self.cl)]

    def tearDown(self):
        import shutil
        web.harness._install_targets = self._saved
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_select_repoints_target_theme_and_emit(self):
        res = web.api_select_view(self.state, {"host": "claude", "path": str(self.cl)})
        self.assertTrue(res["ok"])
        self.assertEqual(Path(self.state.target), self.cl)
        self.assertEqual(self.state.theme, "imperial")        # read from cl's marker
        self.assertEqual(self.state.emit, "claude-global")     # read from cl's marker

    def test_select_unknown_pair_raises(self):
        with self.assertRaises(web.NotFound):
            web.api_select_view(self.state, {"host": "claude", "path": "/no/such/root"})

    def test_installs_marks_the_current_view_selected(self):
        rows = web.api_installs(self.state)["installs"]
        selected = [r for r in rows if r["selected"]]
        self.assertEqual(len(selected), 1)
        self.assertEqual(selected[0]["host"], "opencode")     # state.target starts at oc
        web.api_select_view(self.state, {"host": "claude", "path": str(self.cl)})
        rows = web.api_installs(self.state)["installs"]
        self.assertEqual([r for r in rows if r["selected"]][0]["host"], "claude")


class GraphTests(unittest.TestCase):
    def test_api_graph_nodes_and_edges_resolve(self):
        state = web.WebState(theme="neutral")
        g = web.api_graph(state)
        self.assertTrue(g["nodes"])
        ids = {n["id"] for n in g["nodes"]}
        self.assertEqual(len(ids), len(g["nodes"]))          # unique nodes
        for n in g["nodes"]:
            self.assertIn(n["type"], ("agent", "skill", "law"))
        # Laws contribute at least the universal set; they appear as nodes.
        self.assertTrue(any(n["type"] == "law" for n in g["nodes"]))
        # Agents/skills cite each other via Markdown cross-links, not just laws —
        # otherwise the only citation targets are laws and the matrix collapses to
        # a single law column. At least one edge must target a non-law node.
        type_of = {n["id"]: n["type"] for n in g["nodes"]}
        self.assertTrue(any(type_of[e["target"]] != "law" for e in g["edges"]))
        for e in g["edges"]:
            self.assertIn(e["source"], ids)                  # edges resolve
            self.assertIn(e["target"], ids)
            self.assertNotEqual(e["source"], e["target"])    # no self-links
        # No duplicate edges.
        pairs = [(e["source"], e["target"]) for e in g["edges"]]
        self.assertEqual(len(pairs), len(set(pairs)))

    def test_api_graph_edges_survive_themed_law_noun(self):
        # The law-noun is themed ({{LAW}} → "Dictate", "Code", "Directive", …),
        # so a hardcoded "Rule|Law" reference regex found zero law edges under
        # any non-neutral theme and the graph rendered with no links. The web
        # reads the DEPLOYED harness, so emit each theme to its own target and
        # graph that — every theme should yield the same (non-empty) edge set.
        import contextlib
        import io
        import tempfile

        def graph_for(theme):
            tmp = Path(tempfile.mkdtemp())
            cfg = tmp / "cfg"
            with contextlib.redirect_stdout(io.StringIO()):  # swallow emit log
                web.build.emit_opencode_global(theme, out=tmp / "bundle", cfg=cfg)
            return web.api_graph(web.WebState(target=cfg))  # theme auto-detected

        baseline = len(graph_for("neutral")["edges"])
        self.assertGreater(baseline, 0)
        for theme in ("imperial", "biker", "military"):
            g = graph_for(theme)
            self.assertEqual(len(g["edges"]), baseline, f"theme {theme} dropped edges")
            self.assertTrue(any(e["target"] in {n["id"] for n in g["nodes"]
                                                if n["type"] == "law"} for e in g["edges"]),
                            f"theme {theme} found no law edges")


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


class HarnessFilterTests(unittest.TestCase):
    """The Docs Claude/OpenCode selector: page/group tags drop from the menu,
    inline `<!--harness:X-->` blocks strip per host, malformed markers fail open."""

    def setUp(self):
        self.state = web.WebState(theme="neutral")

    def test_norm_defaults_and_validates(self):
        # explicit valid value wins; junk and None fall back to the install default
        self.assertEqual(web._norm_harness("claude", self.state), "claude")
        self.assertEqual(web._norm_harness("opencode", self.state), "opencode")
        self.assertIn(web._norm_harness("nonsense", self.state), ("opencode", "claude"))
        self.assertIn(web._norm_harness(None, self.state), ("opencode", "claude"))

    def test_strip_keeps_matching_drops_other(self):
        body = ("shared\n"
                "<!--harness:opencode-->\nopen only\n<!--/harness-->\n"
                "<!--harness:claude-->\nclaude only\n<!--/harness-->\ntail")
        oc = web._strip_harness_blocks(body, "opencode")
        cc = web._strip_harness_blocks(body, "claude")
        self.assertIn("open only", oc)
        self.assertNotIn("claude only", oc)
        self.assertIn("claude only", cc)
        self.assertNotIn("open only", cc)
        # markers themselves never survive
        for out in (oc, cc):
            self.assertNotIn("<!--harness", out)
            self.assertNotIn("<!--/harness", out)

    def test_strip_passthrough_and_fail_open(self):
        self.assertEqual(web._strip_harness_blocks("plain text", "claude"), "plain text")
        # an unbalanced (dangling) marker must not blank the tail — fail open
        broken = "keep me\n<!--harness:claude-->\nand this too"
        self.assertEqual(web._strip_harness_blocks(broken, "opencode"), broken)

    def test_visible_groups_filter_by_tag(self):
        oc = {p["id"] for g in web._visible_groups("opencode") for p in g["pages"]}
        cc = {p["id"] for g in web._visible_groups("claude") for p in g["pages"]}
        # host-specific pages appear only under their host
        self.assertIn("adapters-opencode", oc)
        self.assertNotIn("adapters-opencode", cc)
        self.assertIn("mcp-claude-code", cc)
        self.assertNotIn("mcp-claude-code", oc)
        # the whole Plugins group is opencode-only
        self.assertNotIn("plugins", {g["id"] for g in web._visible_groups("claude")})

    def test_api_docs_echoes_resolved_harness(self):
        self.assertEqual(web.api_docs(self.state, "claude")["harness"], "claude")
        self.assertEqual(web.api_docs(self.state, "opencode")["harness"], "opencode")

    def test_api_docs_page_strips_for_host(self):
        # mcp-verify slices SETUP.md; the opencode clause must vanish under claude
        oc = web.api_docs_page(self.state, "mcp-verify", "opencode")["body"]
        cc = web.api_docs_page(self.state, "mcp-verify", "claude")["body"]
        self.assertIn("opencode mcp", oc)
        self.assertNotIn("opencode mcp", cc)
        self.assertNotIn("<!--harness", oc + cc)

    def test_every_doc_body_has_balanced_markers(self):
        # Guard: an unbalanced/nested marker in any doc source or concept body
        # fails open (whole page shown) — catch it here, not as a blank panel.
        def sources():
            for g in web.DOC_GROUPS:
                for p in g["pages"]:
                    if p.get("kind") == "concept":
                        yield (f"concept:{p['id']}", p.get("body", ""))
                    elif p.get("kind") == "markdown":
                        yield (p["source"], web._read_doc_source(p["source"]))
        for where, text in sources():
            with self.subTest(source=where):
                self.assertTrue(
                    web._harness_blocks_balanced(text.splitlines()),
                    f"unbalanced harness markers in {where}")

    def test_strip_guard_not_narrower_than_matcher(self):
        # The early-out guard must catch any marker the open regex accepts —
        # including odd whitespace — or a stray-spaced marker leaks unstripped.
        body = "A\n<!--  harness:claude  -->\nSECRET\n<!--/harness-->\nB"
        out = web._strip_harness_blocks(body, "opencode")
        self.assertNotIn("SECRET", out)
        self.assertNotIn("<!--", out)

    def test_strip_ignores_markers_inside_code_fence(self):
        # A marker shown as example text inside ``` is not a real marker — it
        # must survive verbatim for both hosts, fences intact.
        body = ("intro\n```\n<!--harness:opencode-->\nexample\n<!--/harness-->\n```\nouter")
        for hn in ("opencode", "claude"):
            out = web._strip_harness_blocks(body, hn)
            self.assertIn("<!--harness:opencode-->", out, hn)
            self.assertIn("example", out, hn)
            self.assertEqual(out.count("```"), 2, hn)

    def test_no_cross_harness_dead_links(self):
        # Invariant: every `#/docs/<id>` link in a VISIBLE page resolves to a
        # page visible under the SAME harness — no link dead-ends after filtering.
        import re
        link_re = re.compile(r"#/docs/([a-z0-9-]+)")
        for hn in ("opencode", "claude"):
            menu = web.api_docs(self.state, hn)
            visible = {p["id"] for g in menu["groups"] for p in g["pages"]}
            for g in menu["groups"]:
                for p in g["pages"]:
                    body = web.api_docs_page(self.state, p["id"], hn).get("body", "")
                    for target in set(link_re.findall(body or "")):
                        with self.subTest(harness=hn, page=p["id"], target=target):
                            self.assertIn(
                                target, visible,
                                f"{hn}: page '{p['id']}' links to '{target}', "
                                f"hidden under {hn}")


class ActivityTests(unittest.TestCase):
    """The live-activity reader: globs <target>/activity/*.json, prunes dead/stale
    writers (self-cleaning their files), and never raises on a missing dir or a
    garbage file."""

    def _state(self, tmp):
        return web.WebState(theme="neutral", target=Path(tmp))

    def _write(self, tmp, name, entry):
        import json
        d = Path(tmp) / "activity"
        d.mkdir(exist_ok=True)
        p = d / name
        p.write_text(json.dumps(entry), encoding="utf-8")
        return p

    def test_missing_dir_is_empty(self):
        import tempfile
        with tempfile.TemporaryDirectory() as t:
            res = web.api_activity(self._state(t))
            self.assertEqual(res["activity"], [])
            self.assertTrue(res["enabled"])

    def test_globs_live_entries(self):
        import os
        import time
        import tempfile
        with tempfile.TemporaryDirectory() as t:
            self._write(t, "ses_a.json", {
                "session_id": "ses_a", "agent": "reviewer", "title": "fix it",
                "cwd": "/repo", "status": "busy", "pid": os.getpid(),
                "updated_at": time.time(),
            })
            res = web.api_activity(self._state(t))
            self.assertEqual(len(res["activity"]), 1)
            self.assertEqual(res["activity"][0]["agent"], "reviewer")
            self.assertEqual(res["activity"][0]["status"], "busy")

    def test_prunes_dead_pid_and_self_cleans(self):
        import time
        import tempfile
        with tempfile.TemporaryDirectory() as t:
            # A pid that is virtually never alive — os.kill(pid, 0) raises ESRCH.
            p = self._write(t, "ses_dead.json", {
                "session_id": "ses_dead", "status": "busy",
                "pid": 2_147_483_647, "updated_at": time.time(),
            })
            self.assertEqual(web.api_activity(self._state(t))["activity"], [])
            self.assertFalse(p.exists())   # stale file removed

    def test_prunes_stale_entry(self):
        import os
        import time
        import tempfile
        with tempfile.TemporaryDirectory() as t:
            self._write(t, "ses_old.json", {
                "session_id": "ses_old", "status": "idle",
                "pid": os.getpid(), "updated_at": time.time() - 10_000,
            })
            self.assertEqual(web.api_activity(self._state(t))["activity"], [])

    def test_garbage_file_never_raises(self):
        import tempfile
        with tempfile.TemporaryDirectory() as t:
            d = Path(t) / "activity"
            d.mkdir()
            (d / "broken.json").write_text("{ not json", encoding="utf-8")
            self.assertEqual(web.api_activity(self._state(t))["activity"], [])

    def test_v11_fields_pass_through(self):
        import os
        import time
        import tempfile
        with tempfile.TemporaryDirectory() as t:
            self._write(t, "s.json", {
                "session_id": "s", "status": "busy", "pid": os.getpid(),
                "updated_at": time.time(), "model": "opus", "phase": "Editing x",
                "cost": 0.62, "tokens": 48000,
                "files": {"count": 2, "additions": 10, "deletions": 1, "items": []},
                "todos": {"done": 1, "total": 3, "items": []},
                "error": "oops", "blocked_on": None, "turn_started_at": time.time(),
            })
            e = web.api_activity(self._state(t))["activity"][0]
            self.assertEqual(e["model"], "opus")
            self.assertEqual(e["phase"], "Editing x")
            self.assertEqual(e["cost"], 0.62)
            self.assertEqual(e["tokens"], 48000)
            self.assertEqual(e["files"]["count"], 2)
            self.assertEqual(e["todos"]["done"], 1)
            self.assertEqual(e["error"], "oops")

    def test_v1_file_gets_safe_defaults(self):
        # A pre-v1.1 writer omits the new keys; the reader must fill safe defaults.
        import os
        import time
        import tempfile
        with tempfile.TemporaryDirectory() as t:
            self._write(t, "s.json", {
                "session_id": "s", "status": "idle", "pid": os.getpid(),
                "updated_at": time.time(),
            })
            e = web.api_activity(self._state(t))["activity"][0]
            self.assertIsNone(e["model"])
            self.assertIsNone(e["phase"])
            self.assertIsNone(e["files"])
            self.assertEqual(e["cost"], 0)
            self.assertEqual(e["tokens"], 0)

    def test_enabled_by_default(self):
        import tempfile
        with tempfile.TemporaryDirectory() as t:
            self.assertTrue(web.api_activity(self._state(t))["enabled"])

    def test_toggle_off_persists_and_gates_output(self):
        import os
        import time
        import tempfile
        with tempfile.TemporaryDirectory() as t:
            state = self._state(t)
            # A live entry that would otherwise show.
            self._write(t, "ses_a.json", {
                "session_id": "ses_a", "status": "busy",
                "pid": os.getpid(), "updated_at": time.time(),
            })
            self.assertEqual(len(web.api_activity(state)["activity"]), 1)
            res = web.api_activity_toggle(state, {"enabled": False})
            self.assertEqual(res, {"ok": True, "enabled": False})
            self.assertTrue((Path(t) / ".geneseed-activity").is_file())
            # Disabled → output gated to [], flag reported off (files left for the
            # plugin to clear on its next event).
            out = web.api_activity(state)
            self.assertFalse(out["enabled"])
            self.assertEqual(out["activity"], [])
            # Back on → entries flow again.
            web.api_activity_toggle(state, {"enabled": True})
            self.assertTrue(web.api_activity(state)["enabled"])
            self.assertEqual(len(web.api_activity(state)["activity"]), 1)

    def test_list_skips_detail_files(self):
        # *.detail.json is the v1.2 timeline sidecar, not a session snapshot.
        import os
        import time
        import tempfile
        with tempfile.TemporaryDirectory() as t:
            self._write(t, "s.json", {"session_id": "s", "status": "busy", "pid": os.getpid(), "updated_at": time.time()})
            self._write(t, "s.detail.json", {"timeline": [{"kind": "tool"}], "files": None, "todos": None})
            acts = web.api_activity(self._state(t))["activity"]
            self.assertEqual([a["session_id"] for a in acts], ["s"])   # detail file not listed

    def test_detail_returns_session_and_timeline(self):
        import os
        import time
        import tempfile
        with tempfile.TemporaryDirectory() as t:
            self._write(t, "s.json", {"session_id": "s", "status": "busy", "pid": os.getpid(), "updated_at": time.time(), "files": {"count": 1, "items": [{"file": "a"}]}})
            self._write(t, "s.detail.json", {
                "timeline": [{"kind": "tool", "label": "Editing a.js"}],
                "files": {"count": 9, "items": [{"file": f"f{i}.js", "additions": 1, "deletions": 0} for i in range(20)]},
                "todos": {"done": 1, "total": 2, "items": [{"content": "a", "status": "completed"}]},
            })
            res = web.api_activity_detail(self._state(t), "s")
            self.assertEqual(res["session"]["session_id"], "s")
            self.assertEqual(res["timeline"][0]["label"], "Editing a.js")
            # detail file's UNCAPPED lists win over the snapshot's capped ones
            self.assertEqual(len(res["session"]["files"]["items"]), 20)
            self.assertEqual(res["session"]["todos"]["total"], 2)

    def test_detail_404_on_unknown(self):
        import tempfile
        from web import NotFound
        with tempfile.TemporaryDirectory() as t:
            with self.assertRaises(NotFound):
                web.api_activity_detail(self._state(t), "nope")

    def test_detail_tolerates_missing_detail_file(self):
        import os
        import time
        import tempfile
        with tempfile.TemporaryDirectory() as t:
            self._write(t, "s.json", {"session_id": "s", "status": "idle", "pid": os.getpid(), "updated_at": time.time()})
            res = web.api_activity_detail(self._state(t), "s")   # no s.detail.json
            self.assertEqual(res["timeline"], [])
            self.assertEqual(res["session"]["session_id"], "s")

    def test_detail_conversation_transcript_with_title_fallback(self):
        import os
        import time
        import tempfile
        with tempfile.TemporaryDirectory() as t:
            self._write(t, "s.json", {"session_id": "s", "title": "the very first ask", "status": "busy", "pid": os.getpid(), "updated_at": time.time()})
            # no detail file → a single opening user turn from the session title
            conv = web.api_activity_detail(self._state(t), "s")["conversation"]
            self.assertEqual(conv, [{"role": "user", "text": "the very first ask"}])
            # with a captured transcript → it's returned as-is, ordered
            turns = [
                {"role": "user", "text": "add a toggle"},
                {"role": "assistant", "text": "done"},
                {"role": "user", "text": "make it 50/50"},
            ]
            self._write(t, "s.detail.json", {"timeline": [], "conversation": turns})
            self.assertEqual(web.api_activity_detail(self._state(t), "s")["conversation"], turns)


class DeployTests(unittest.TestCase):
    """Deploy a fresh per-repo harness into a user-chosen folder, and have it persist in
    the installs list via the registry (the open-ended sibling of the row Install)."""

    def setUp(self):
        self.state = web.WebState(theme="neutral")

    def test_deploy_cmd_validates_host_and_path(self):
        import tempfile, os
        bad_host = web.api_deploy_cmd(self.state, {"host": "nope", "path": "/tmp"})
        self.assertIn("unknown host", bad_host["error"])
        self.assertIn("no folder", web.api_deploy_cmd(
            self.state, {"host": "opencode", "path": "  "})["error"])
        self.assertIn("not a folder", web.api_deploy_cmd(
            self.state, {"host": "opencode", "path": "/no/such/dir/zzz"})["error"])
        with tempfile.TemporaryDirectory() as d:
            plan = web.api_deploy_cmd(
                self.state, {"host": "opencode", "path": d, "theme": "imperial"})
            cmd = plan["cmd"]
            self.assertEqual(cmd[cmd.index("--emit") + 1], "opencode")        # project, never global
            self.assertEqual(cmd[cmd.index("--theme") + 1], "imperial")
            self.assertEqual(cmd[cmd.index("--out") + 1], str(Path(d).resolve()))
            self.assertEqual(cmd[cmd.index("--root") + 1], str(Path(d).resolve()))

    def test_deploy_cmd_bogus_theme_falls_back_to_state(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            plan = web.api_deploy_cmd(
                self.state, {"host": "claude", "path": d, "theme": "not-a-theme"})
            cmd = plan["cmd"]
            self.assertEqual(cmd[cmd.index("--theme") + 1], "neutral")  # state.theme wins
            self.assertEqual(cmd[cmd.index("--emit") + 1], "claude")

    def test_deploy_cmd_rejects_host_config_dir(self):
        import tempfile, build
        from unittest import mock
        with tempfile.TemporaryDirectory() as d:
            with mock.patch.object(build, "_opencode_config_dir", lambda: Path(d)):
                res = web.api_deploy_cmd(self.state, {"host": "opencode", "path": d})
        self.assertIn("global config dir", res.get("error", ""))

    def test_pick_folder_tkinter_nonzero_is_error_not_cancel(self):
        # A headless/SSH daemon: tkinter exits non-zero with a traceback. Must surface as
        # an error (so the UI keeps its editable field), never a silent {cancelled}.
        import subprocess
        from unittest import mock
        fake = mock.Mock(returncode=1, stdout="",
                         stderr="Traceback ...\n_tkinter.TclError: no display name")
        with mock.patch("sys.platform", "linux"), \
                mock.patch.object(subprocess, "run", return_value=fake):
            res = web.api_pick_folder()
        self.assertNotIn("cancelled", res)
        self.assertIn("TclError", res.get("error", ""))

    def test_pick_folder_tkinter_empty_stdout_is_cancel(self):
        import subprocess
        from unittest import mock
        fake = mock.Mock(returncode=0, stdout="\n", stderr="")
        with mock.patch("sys.platform", "linux"), \
                mock.patch.object(subprocess, "run", return_value=fake):
            self.assertEqual(web.api_pick_folder(), {"cancelled": True})

    def test_deploy_cmd_bob_maps_to_bob_emit(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            plan = web.api_deploy_cmd(self.state, {"host": "bob", "path": d, "theme": "imperial"})
            cmd = plan["cmd"]
            self.assertEqual(cmd[cmd.index("--emit") + 1], "bob")        # project, never global
            self.assertEqual(cmd[cmd.index("--theme") + 1], "imperial")

    def test_bob_emit_layout_and_disable_reactivate_lifecycle(self):
        # IBM Bob is a first-class host: a .bob/ project layer + AGENTS.md, riding the
        # Claude-style manifest lifecycle (deactivate stashes, reactivate restores).
        import tempfile, build
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            build.emit_bob("neutral", root, root)
            self.assertTrue((root / "AGENTS.md").is_file())
            self.assertTrue((root / ".bob").is_dir())
            self.assertEqual(web.harness._install_state(root, "bob", "project"), "active")
            self.assertEqual(web.harness._mcp_servers_key("bob"), "mcpServers")
            self.assertEqual(web.harness._mcp_config_for("bob", "project", root),
                             root / ".bob" / "settings.json")
            off = web.harness._install_deactivate(root, "bob", "project")
            self.assertTrue(off["ok"]) and self.assertEqual(off["kind"], "bob")
            self.assertEqual(web.harness._install_state(root, "bob", "project"), "disabled")
            on = web.harness._install_reactivate(root, "bob", "project")
            self.assertTrue(on["ok"])
            self.assertEqual(web.harness._install_state(root, "bob", "project"), "active")

    def test_bob_view_cfg_and_restore_emitter_are_host_correct(self):
        # A bob PROJECT install's data lives under <repo>/.bob (not the bare root), and a
        # restore must render the bob 'expected' tree, not OpenCode's (would corrupt agents).
        import build
        self.assertEqual(web._view_cfg("bob", "project", Path("/r")), Path("/r") / ".bob")
        self.assertEqual(web._view_cfg("bob", "global", Path("/r")), Path("/r"))   # global == root
        self.assertIs(web._global_emitter_for("bob-global"), build.emit_bob_global)
        self.assertIs(web._global_emitter_for("claude-global"), build.emit_claude_global)
        self.assertIs(web._global_emitter_for("opencode-global"), build.emit_opencode_global)
        self.assertIs(web._global_emitter_for(None), build.emit_opencode_global)   # safe fallback

    def test_bob_mcp_toggle_off_removes_entry(self):
        # Bob shares Claude's flag-less mcpServers shape: disable REMOVES the server (a
        # stray enabled:false would be ignored by Bob, leaving it live).
        cfg = {"mcpServers": {"md": {"command": "uvx", "args": ["x"]}}}
        self.assertEqual(web.harness._mcp_state(cfg, "md", "bob"), "enabled")
        off = web.harness._mcp_set_enabled(cfg, "md", False, "bob")
        self.assertEqual(off.get("mcpServers", {}), {})
        self.assertNotIn("enabled", off.get("mcpServers", {}).get("md", {}))

    def test_bob_theme_detected_from_agents_md(self):
        import tempfile, build
        with tempfile.TemporaryDirectory() as d:
            build.emit_bob("imperial", Path(d), Path(d))
            self.assertEqual(web.harness._theme_of_dir(Path(d)), "imperial")

    def test_registry_round_trip_and_install_targets_merge_and_prune(self):
        import tempfile, os
        import _install_registry
        saved_xdg = os.environ.get("XDG_CONFIG_HOME")
        with tempfile.TemporaryDirectory() as cfg, tempfile.TemporaryDirectory() as live:
            os.environ["XDG_CONFIG_HOME"] = cfg
            try:
                (Path(live) / ".geneseed-emit").write_text("opencode\n", encoding="utf-8")
                _install_registry.record(live)
                _install_registry.record(live)  # idempotent
                rows = web.harness._install_targets()
                mine = [r for r in rows if r[2].resolve() == Path(live).resolve()]
                self.assertEqual([(r[0], r[1]) for r in mine], [("opencode", "project")])
                # drop the marker -> the registry self-prunes and the row disappears
                (Path(live) / ".geneseed-emit").unlink()
                self.assertEqual(_install_registry.roots(), [])
                rows2 = web.harness._install_targets()
                self.assertFalse([r for r in rows2 if r[2].resolve() == Path(live).resolve()])
            finally:
                if saved_xdg is None:
                    os.environ.pop("XDG_CONFIG_HOME", None)
                else:
                    os.environ["XDG_CONFIG_HOME"] = saved_xdg


class TestInstallRemove(unittest.TestCase):
    """The trash icon: api_install_toggle's `remove` action permanently deletes a folder
    install and de-lists it (the registry self-prunes once the root `.geneseed-emit` is
    gone). memory/ + notebook/ follow the `memory` disposition; the file removal never
    touches them, so the default keep can't lose a learned fact. OpenCode project is the
    interesting case — no manifest, so the bundle dirs (laws/agents/skills) + AGENT.md are
    reversed by name (build() owns and clobbers them each run)."""

    def setUp(self):
        import tempfile
        self.tmp = Path(tempfile.mkdtemp())

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _seed_opencode_project(self, root: Path):
        import json
        root.mkdir(parents=True, exist_ok=True)
        for d in (".opencode", "laws", "agents", "skills", "memory", "notebook"):
            (root / d).mkdir()
            (root / d / "f").write_text("x", encoding="utf-8")
        (root / "AGENT.md").write_text("# rules\n", encoding="utf-8")
        (root / "opencode.json").write_text(
            json.dumps({"instructions": ["AGENT.md"], "lsp": True}), encoding="utf-8")
        (root / ".geneseed-emit").write_text("opencode\n", encoding="utf-8")
        (root / ".geneseed-theme").write_text("neutral\n", encoding="utf-8")
        (root / web.build.VERSION_MARKER).write_text("v\n", encoding="utf-8")

    def test_remove_opencode_project_deletes_files_keeps_memory(self):
        import json
        root = (self.tmp / "repo").resolve()
        self._seed_opencode_project(root)
        res = web.harness._install_uninstall(root, "opencode", "project", "keep")
        self.assertTrue(res["ok"])
        for d in (".opencode", "laws", "agents", "skills"):
            self.assertFalse((root / d).exists(), f"{d} should be gone")
        self.assertFalse((root / "AGENT.md").exists())
        # opencode.json kept; its instructions entry dropped
        instr = json.loads((root / "opencode.json").read_text(encoding="utf-8"))["instructions"]
        self.assertNotIn("AGENT.md", instr)
        # registry + theme/version markers gone -> the row self-prunes
        for m in (".geneseed-emit", ".geneseed-theme", web.build.VERSION_MARKER):
            self.assertFalse((root / m).exists(), m)
        # memory + notebook KEPT (default disposition can't lose a fact)
        self.assertTrue((root / "memory" / "f").exists())
        self.assertTrue((root / "notebook" / "f").exists())

    def test_remove_memory_archive_then_delete(self):
        root = (self.tmp / "repo2").resolve()
        self._seed_opencode_project(root)
        res = web.harness._install_uninstall(root, "opencode", "project", "archive")
        self.assertTrue(res["ok"])
        self.assertFalse((root / "memory").exists())          # moved aside, not deleted
        self.assertTrue(any((root / "archived-memory").glob("*/f")))
        self.assertTrue(any((root / "archived-notebook").glob("*/f")))

        root2 = (self.tmp / "repo3").resolve()
        self._seed_opencode_project(root2)
        res2 = web.harness._install_uninstall(root2, "opencode", "project", "delete")
        self.assertTrue(res2["ok"])
        self.assertFalse((root2 / "memory").exists())
        self.assertFalse((root2 / "notebook").exists())
        self.assertEqual(res2["memory"], "delete")

    def test_api_remove_action_wired_and_allowlisted(self):
        root = (self.tmp / "repo4").resolve()
        self._seed_opencode_project(root)
        saved = web.harness._install_targets
        web.harness._install_targets = lambda: [("opencode", "project", root)]
        try:
            state = web.WebState(theme="neutral")
            with self.assertRaises(web.NotFound):    # (host, path) not in the detected set
                web.api_install_toggle(
                    state, {"host": "opencode", "path": "/nope", "action": "remove"})
            res = web.api_install_toggle(
                state, {"host": "opencode", "path": str(root),
                        "action": "remove", "memory": "keep"})
            self.assertTrue(res["ok"])
            self.assertFalse((root / ".opencode").exists())
        finally:
            web.harness._install_targets = saved

    def test_remove_claude_and_bob_project_installs(self):
        # Real per-repo emits (manifest-backed) -> remove must reverse them host-agnostically.
        for host, emit in (("claude", web.build.emit_claude), ("bob", web.build.emit_bob)):
            root = (self.tmp / f"repo_{host}").resolve()
            root.mkdir()
            emit("neutral", root)
            marker = web.build.HOSTS[host]["project_marker"]
            self.assertEqual(web.harness._install_state(root, host, "project"), "active", host)
            res = web.harness._install_uninstall(root, host, "project", "keep")
            self.assertTrue(res["ok"], (host, res))
            self.assertEqual(web.harness._install_state(root, host, "project"), "absent", host)
            self.assertFalse((root / marker / web.build.GLOBAL_MANIFEST).exists(), host)
            # memory kept (default disposition) — the per-host store survives the removal
            self.assertTrue((root / marker / "memory").is_dir(), host)

    def test_remove_deregisters_via_registry_prune(self):
        import os
        import _install_registry
        saved_xdg = os.environ.get("XDG_CONFIG_HOME")
        cfg = self.tmp / "xdg"
        cfg.mkdir()
        os.environ["XDG_CONFIG_HOME"] = str(cfg)
        try:
            root = (self.tmp / "deployed").resolve()
            self._seed_opencode_project(root)
            _install_registry.record(root)
            self.assertIn(root, [r.resolve() for r in _install_registry.roots()])
            web.harness._install_uninstall(root, "opencode", "project", "keep")
            # `.geneseed-emit` gone -> the registry self-prunes the row on next read
            self.assertEqual(_install_registry.roots(), [])
        finally:
            if saved_xdg is None:
                os.environ.pop("XDG_CONFIG_HOME", None)
            else:
                os.environ["XDG_CONFIG_HOME"] = saved_xdg


if __name__ == "__main__":
    unittest.main()
