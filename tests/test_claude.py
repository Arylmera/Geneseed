"""Unit tests for the Claude Code host: the emit (claude-global / claude folder),
user-content safety (claim-on-create, managed CLAUDE.md block, surgical settings.json
hook merge), and the deactivate/reactivate/uninstall activation. Stdlib unittest only.

Run from the Geneseed root:  python -m unittest discover -s tests
"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "rituals"))
sys.path.insert(0, str(ROOT))
import build  # noqa: E402
import harness  # noqa: E402
import _harness_build  # noqa: E402  (monkeypatched directly for the rebuild-all test)


def _read(p):
    return p.read_text(encoding="utf-8")


def _hook_cmds(settings: dict):
    return [h["command"] for ev in (settings.get("hooks") or {}).values()
            for g in ev for h in g["hooks"]]


class ClaudeEmitTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.cfg = self.tmp / "dotclaude"

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_emit_writes_claude_layout(self):
        build.emit_claude_global("neutral", cfg=self.cfg)
        # CLAUDE.md carries a managed block (auto-loaded by Claude).
        cm = _read(self.cfg / "CLAUDE.md")
        self.assertIn("<!-- BEGIN GENESEED -->", cm)
        self.assertIn("<!-- END GENESEED -->", cm)
        # Agents use the Claude subagent schema — name/description, NO mode/color/permission.
        reviewer = _read(self.cfg / "agents" / "reviewer.md")
        self.assertIn("name: reviewer", reviewer)
        self.assertNotIn("mode: subagent", reviewer)
        self.assertNotIn("color:", reviewer)
        self.assertNotIn("permission:", reviewer)
        # A read-only agent maps the deny-tree to disallowedTools.
        explorer = _read(self.cfg / "agents" / "explorer.md")
        self.assertIn("disallowedTools:", explorer)
        # settings.json hooks call harness.py by ABSOLUTE path (hook cwd is the project).
        s = json.loads(_read(self.cfg / "settings.json"))
        gen = [c for c in _hook_cmds(s) if "harness.py" in c]
        self.assertTrue(gen)
        self.assertTrue(all(str(build.ROOT) in c for c in gen))
        # No cat AGENT.md at global scope; plugins dir never written.
        self.assertFalse(any("cat AGENT.md" in c for c in _hook_cmds(s)))
        self.assertFalse((self.cfg / "plugins").exists())

    def test_skills_byte_identical_to_opencode(self):
        oc = self.tmp / "dotopencode"
        build.emit_claude_global("neutral", cfg=self.cfg)
        build.emit_opencode_global("neutral", cfg=oc)
        a, b = self.cfg / "skills" / "tdd" / "SKILL.md", oc / "skills" / "tdd" / "SKILL.md"
        self.assertTrue(a.is_file() and b.is_file())
        self.assertEqual(_read(a), _read(b))

    def test_reemit_is_idempotent_and_prunes_only_own(self):
        build.emit_claude_global("neutral", cfg=self.cfg)
        # A stale Geneseed-owned agent from a "previous" emit is pruned on re-emit.
        stale = self.cfg / "agents" / "_stale.md"
        stale.write_text("old", encoding="utf-8")
        man = json.loads(_read(self.cfg / build.GLOBAL_MANIFEST))
        man["owned"].append("agents/_stale.md")
        (self.cfg / build.GLOBAL_MANIFEST).write_text(json.dumps(man), encoding="utf-8")
        cm_before = _read(self.cfg / "CLAUDE.md")
        build.emit_claude_global("neutral", cfg=self.cfg)
        self.assertFalse(stale.exists(), "stale owned file not pruned")
        self.assertEqual(_read(self.cfg / "CLAUDE.md"), cm_before, "block stacked / not idempotent")
        self.assertEqual(cm_before.count("<!-- BEGIN GENESEED -->"), 1)

    def test_reemit_manifest_hooks_stable_after_user_edit(self):
        # A user editing a managed hook then a re-emit must NOT grow the manifest's
        # recorded hook list (dedup) — else it accumulates unbounded.
        build.emit_claude_global("neutral", cfg=self.cfg)
        man = json.loads(_read(self.cfg / build.GLOBAL_MANIFEST))
        before = len(man["managed"]["settings_hooks"])
        s = json.loads(_read(self.cfg / "settings.json"))
        s["hooks"]["PreToolUse"][0]["hooks"][0]["command"] += " --edited"
        (self.cfg / "settings.json").write_text(json.dumps(s), encoding="utf-8")
        build.emit_claude_global("neutral", cfg=self.cfg)
        after = len(json.loads(_read(self.cfg / build.GLOBAL_MANIFEST))["managed"]["settings_hooks"])
        self.assertEqual(after, before, "manifest settings_hooks grew on re-emit (dedup failed)")

    def test_folder_emit_round_trips(self):
        repo = self.tmp / "repo"
        repo.mkdir()
        build.emit_claude("neutral", repo)
        self.assertTrue((repo / "CLAUDE.md").is_file())
        # Machine-absolute hooks land in the PERSONAL settings.local.json, never the
        # team-shared settings.json (which is not even created).
        self.assertTrue((repo / ".claude" / "settings.local.json").is_file())
        self.assertFalse((repo / ".claude" / "settings.json").exists())
        self.assertTrue((repo / ".claude" / build.GLOBAL_MANIFEST).is_file())
        # learn hook points at the project's own memory store (absolute).
        s = json.loads(_read(repo / ".claude" / "settings.local.json"))
        learn = [c for c in _hook_cmds(s) if "learn" in c]
        self.assertTrue(learn and str((repo / ".claude" / "memory")) in learn[0])
        # store pointers in the root CLAUDE.md carry the marker-dir prefix — bare
        # `memory/` would point at a nonexistent repo-root store (split-brain memory).
        self.assertIn(".claude/memory", _read(repo / "CLAUDE.md"))
        # hygiene: the personal/never-commit files are gitignored.
        gi = _read(repo / ".claude" / ".gitignore")
        for line in ("settings.local.json", "wiki.jsonc", "agent-overrides.json"):
            self.assertIn(line, gi)


class ClaudeSafetyTests(unittest.TestCase):
    """A pre-existing, user-owned ~/.claude is never clobbered, and uninstall removes
    only Geneseed-owned files — leaving every user file + their settings intact."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.cfg = self.tmp / "dotclaude"
        self.cfg.mkdir()
        # Pre-seed user content that collides by name + a user settings.json + prose.
        (self.cfg / "settings.json").write_text(json.dumps({
            "model": "opus",
            "hooks": {"Stop": [{"hooks": [{"type": "command", "command": "echo mine"}]}]},
        }), encoding="utf-8")
        (self.cfg / "skills" / "impeccable").mkdir(parents=True)
        (self.cfg / "skills" / "impeccable" / "SKILL.md").write_text("USER SKILL", encoding="utf-8")
        (self.cfg / "agents").mkdir()
        (self.cfg / "agents" / "mine.md").write_text("USER AGENT", encoding="utf-8")
        (self.cfg / "CLAUDE.md").write_text("# my notes\nkeep this\n", encoding="utf-8")

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_install_preserves_user_content(self):
        build.emit_claude_global("neutral", cfg=self.cfg)
        man = json.loads(_read(self.cfg / build.GLOBAL_MANIFEST))
        owned = set(man["owned"])
        # user files untouched and NOT adopted into the manifest
        self.assertEqual(_read(self.cfg / "agents" / "mine.md"), "USER AGENT")
        self.assertNotIn("agents/mine.md", owned)
        # CLAUDE.md prose survives around the block
        cm = _read(self.cfg / "CLAUDE.md")
        self.assertIn("keep this", cm)
        self.assertIn("<!-- BEGIN GENESEED -->", cm)
        self.assertFalse(man["managed"]["claude_md"].get("whole"))
        # user settings key + their own hook survive; geneseed hooks added
        s = json.loads(_read(self.cfg / "settings.json"))
        self.assertEqual(s["model"], "opus")
        self.assertIn("echo mine", _hook_cmds(s))
        self.assertTrue(any("git-gate" in c for c in _hook_cmds(s)))

    def test_same_name_user_skill_is_kept_not_clobbered(self):
        build.emit_claude_global("neutral", cfg=self.cfg)
        # impeccable is also a Geneseed skill name — the USER copy must win.
        self.assertEqual(_read(self.cfg / "skills" / "impeccable" / "SKILL.md"), "USER SKILL")
        owned = set(json.loads(_read(self.cfg / build.GLOBAL_MANIFEST))["owned"])
        self.assertNotIn("skills/impeccable/SKILL.md", owned)

    def test_uninstall_removes_only_owned(self):
        build.emit_claude_global("neutral", cfg=self.cfg)
        harness._uninstall_global(self.cfg, archive_memory=False, host="claude")
        # every user artifact survives
        self.assertEqual(_read(self.cfg / "agents" / "mine.md"), "USER AGENT")
        self.assertEqual(_read(self.cfg / "skills" / "impeccable" / "SKILL.md"), "USER SKILL")
        self.assertIn("keep this", _read(self.cfg / "CLAUDE.md"))
        self.assertNotIn("<!-- BEGIN GENESEED -->", _read(self.cfg / "CLAUDE.md"))
        s = json.loads(_read(self.cfg / "settings.json"))
        self.assertEqual(s["model"], "opus")
        self.assertIn("echo mine", _hook_cmds(s))
        self.assertFalse(any("harness.py" in c for c in _hook_cmds(s)), "geneseed hooks not removed")
        # Geneseed's own agents are gone; markers gone.
        self.assertFalse((self.cfg / "agents" / "reviewer.md").exists())
        self.assertFalse((self.cfg / build.GLOBAL_MANIFEST).exists())

    def test_uninstall_keeps_prose_added_after_creation(self):
        # Geneseed CREATES CLAUDE.md in an empty dir; the user then adds their own
        # prose. The old sticky `whole` flag deleted the whole file at uninstall —
        # eating that prose. Teardown must excise the block and keep the rest.
        cfg = (self.tmp / "fresh").resolve()
        cfg.mkdir()
        build.emit_claude_global("neutral", cfg=cfg)
        cm = cfg / "CLAUDE.md"
        cm.write_text(_read(cm) + "\nMY LATER NOTES\n", encoding="utf-8")
        harness._uninstall_global(cfg, archive_memory=False, host="claude")
        self.assertTrue(cm.is_file(), "user prose deleted with the file")
        self.assertIn("MY LATER NOTES", _read(cm))
        self.assertNotIn("<!-- BEGIN GENESEED -->", _read(cm))

    def test_uninstall_removes_pristine_created_claude_md(self):
        # No user prose ever added: excision leaves the file empty → it is removed
        # (same end state the whole-file delete used to produce, minus the risk).
        cfg = (self.tmp / "pristine").resolve()
        cfg.mkdir()
        build.emit_claude_global("neutral", cfg=cfg)
        harness._uninstall_global(cfg, archive_memory=False, host="claude")
        self.assertFalse((cfg / "CLAUDE.md").exists())


class ClaudeActivationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.cfg = (self.tmp / "dotclaude").resolve()
        self.cfg.mkdir()
        (self.cfg / "CLAUDE.md").write_text("# mine\nkeep\n", encoding="utf-8")
        build.emit_claude_global("neutral", cfg=self.cfg)

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_deactivate_reactivate_round_trip(self):
        self.assertEqual(harness._install_state(self.cfg, "claude", "global"), "active")
        res = harness._install_deactivate(self.cfg, "claude", "global")
        self.assertTrue(res["ok"], res)
        self.assertEqual(harness._install_state(self.cfg, "claude", "global"), "disabled")
        # agent stashed (host-tagged), block excised but user prose kept, hooks unwired
        self.assertFalse((self.cfg / "agents" / "reviewer.md").exists())
        self.assertTrue((self.cfg / ".geneseed-disabled" / "claude" / "agents" / "reviewer.md").is_file())
        cm = _read(self.cfg / "CLAUDE.md")
        self.assertNotIn("<!-- BEGIN GENESEED -->", cm)
        self.assertIn("keep", cm)
        s = json.loads(_read(self.cfg / "settings.json"))
        self.assertFalse(any("harness.py" in c for c in _hook_cmds(s)))
        # markers stay put
        self.assertTrue((self.cfg / build.VERSION_MARKER).is_file())

        res = harness._install_reactivate(self.cfg, "claude", "global")
        self.assertTrue(res["ok"], res)
        self.assertEqual(harness._install_state(self.cfg, "claude", "global"), "active")
        self.assertTrue((self.cfg / "agents" / "reviewer.md").is_file())
        cm = _read(self.cfg / "CLAUDE.md")
        self.assertIn("<!-- BEGIN GENESEED -->", cm)
        self.assertIn("keep", cm)
        s = json.loads(_read(self.cfg / "settings.json"))
        self.assertTrue(any("harness.py" in c for c in _hook_cmds(s)))
        self.assertFalse((self.cfg / ".geneseed-disabled").exists(), "stash not cleaned")

    def test_reactivate_discards_stash_after_reemit_while_disabled(self):
        # Disable, then `geneseed build` re-emits live while disabled — reactivate must
        # discard the stale stash (not collide), mirroring the OpenCode path.
        harness._install_deactivate(self.cfg, "claude", "global")
        self.assertEqual(harness._install_state(self.cfg, "claude", "global"), "disabled")
        build.emit_claude_global("neutral", cfg=self.cfg)   # re-created while disabled
        res = harness._install_reactivate(self.cfg, "claude", "global")
        self.assertTrue(res["ok"], res)
        self.assertIn("discarded", res.get("note", ""))
        self.assertFalse((self.cfg / ".geneseed-disabled").exists(), "stale stash not discarded")
        self.assertTrue((self.cfg / "agents" / "reviewer.md").is_file())
        self.assertEqual(harness._install_state(self.cfg, "claude", "global"), "active")

    def test_bob_global_reactivate_discards_stash_after_reemit(self):
        # Bob GLOBAL writes no managed AGENTS.md block (rules/geneseed.md is the
        # preamble carrier), so the relive guard must key on THAT — without it the
        # restore collides with every freshly re-emitted file and the install is
        # stuck "disabled" until the stash is hand-deleted.
        bobcfg = (self.tmp / "dotbob").resolve()
        bobcfg.mkdir()
        build.emit_bob_global("neutral", cfg=bobcfg)
        self.assertEqual(harness._install_state(bobcfg, "bob", "global"), "active")
        harness._install_deactivate(bobcfg, "bob", "global")
        self.assertEqual(harness._install_state(bobcfg, "bob", "global"), "disabled")
        build.emit_bob_global("neutral", cfg=bobcfg)   # re-created while disabled
        res = harness._install_reactivate(bobcfg, "bob", "global")
        self.assertTrue(res["ok"], res)
        self.assertIn("discarded", res.get("note", ""))
        self.assertFalse((bobcfg / ".geneseed-disabled").exists(), "stale stash not discarded")
        self.assertTrue((bobcfg / "rules" / "geneseed.md").is_file())
        self.assertEqual(harness._install_state(bobcfg, "bob", "global"), "active")

    def test_reemit_prunes_stale_managed_hook_group(self):
        # A recorded managed group that is no longer canonical (old interpreter path,
        # or the pre-`|| exit 0` hook form) must be PRUNED on re-emit, not left to
        # stack beside the new group — a duplicated Stop hook runs `learn` twice.
        man = json.loads(_read(self.cfg / build.GLOBAL_MANIFEST))
        claims = man["managed"]["settings_hooks"]
        stop = next(r for r in claims if r["event"] == "Stop")
        stale = {"event": "Stop",
                 "group": json.loads(json.dumps(stop["group"]))}
        stale["group"]["hooks"][0]["command"] = \
            stale["group"]["hooks"][0]["command"].replace("|| exit 0", "|| true")
        # Simulate the old install: stale form in the file AND in the manifest claims.
        s = json.loads(_read(self.cfg / "settings.json"))
        s["hooks"]["Stop"] = [stale["group"]]
        (self.cfg / "settings.json").write_text(json.dumps(s), encoding="utf-8")
        man["managed"]["settings_hooks"] = \
            [r for r in claims if r["event"] != "Stop"] + [stale]
        (self.cfg / build.GLOBAL_MANIFEST).write_text(json.dumps(man), encoding="utf-8")

        build.emit_claude_global("neutral", cfg=self.cfg)
        s = json.loads(_read(self.cfg / "settings.json"))
        stops = s["hooks"]["Stop"]
        self.assertEqual(len(stops), 1, f"stale Stop group not pruned: {stops}")
        self.assertIn("|| exit 0", stops[0]["hooks"][0]["command"])
        man = json.loads(_read(self.cfg / build.GLOBAL_MANIFEST))
        recorded = [r["group"]["hooks"][0]["command"]
                    for r in man["managed"]["settings_hooks"] if r["event"] == "Stop"]
        self.assertEqual(len(recorded), 1, recorded)
        self.assertIn("|| exit 0", recorded[0])

    def test_deactivate_leaves_no_empty_skill_folders(self):
        # tdd is a real Geneseed skill, emitted at skills/tdd/SKILL.md.
        self.assertTrue((self.cfg / "skills" / "tdd" / "SKILL.md").is_file())
        harness._install_deactivate(self.cfg, "claude", "global")
        # the file is stashed AND its now-empty folder is climbed away (no husk left).
        self.assertFalse((self.cfg / "skills" / "tdd").exists(), "empty skill folder left behind")
        self.assertFalse((self.cfg / "skills").exists(), "empty skills/ left behind")


class InstallTargetsTests(unittest.TestCase):
    def test_yields_host_scope_root_triples_for_both_hosts(self):
        rows = harness._install_targets()
        self.assertTrue(all(len(r) == 3 for r in rows))
        hosts = {h for h, _s, _r in rows}
        self.assertIn("opencode", hosts)
        self.assertIn("claude", hosts)
        # every row carries a global scope per host (config dirs always exist as candidates)
        scopes = {(h, s) for h, s, _r in rows}
        self.assertIn(("opencode", "global"), scopes)
        self.assertIn(("claude", "global"), scopes)

    def test_no_host_doubles_its_global_config_dir_as_a_phantom_project(self):
        # For EVERY host (claude/bob share the ~/.X shape; opencode differs): a cwd whose
        # marker dir resolves to that host's own global config dir must yield a single
        # global row — never a phantom project aliasing it (toggling one would hit both).
        import shutil
        for host, spec in build.HOSTS.items():
            tmp = Path(tempfile.mkdtemp())
            cfgdir = tmp / "cfg" / spec["project_marker"]   # <cwd>/<marker> IS the global dir
            cfgdir.mkdir(parents=True)
            (cfgdir / build.GLOBAL_MANIFEST).write_text("{}", encoding="utf-8")
            cwd = tmp / "cfg"
            saved = spec["config_dir"]
            cwd0 = Path.cwd()
            try:
                spec["config_dir"] = lambda c=cfgdir: c
                os.chdir(cwd)
                mine = [(s, Path(r).resolve())
                        for h, s, r in harness._install_targets() if h == host]
                self.assertNotIn(("project", cwd.resolve()), mine,
                                 f"{host}: phantom project aliasing its own global")
                self.assertIn(("global", cfgdir.resolve()), mine, f"{host}: global row missing")
            finally:
                os.chdir(cwd0)
                spec["config_dir"] = saved
                shutil.rmtree(tmp, ignore_errors=True)

    def test_genuine_project_marker_is_not_over_suppressed(self):
        # The guard must NOT eat a real per-repo install: a repo's .claude is not ~/.claude,
        # so it still appears as a project row.
        import shutil
        tmp = Path(tempfile.mkdtemp())
        repo = tmp / "repo"
        (repo / ".claude").mkdir(parents=True)
        (repo / ".claude" / build.GLOBAL_MANIFEST).write_text("{}", encoding="utf-8")
        cwd0 = Path.cwd()
        try:
            os.chdir(repo)
            rows = [(h, s, Path(r).resolve()) for h, s, r in harness._install_targets()]
            self.assertIn(("claude", "project", repo.resolve()), rows)
        finally:
            os.chdir(cwd0)
            shutil.rmtree(tmp, ignore_errors=True)


class RebuildAllTests(unittest.TestCase):
    """rebuild-all rebuilds every ACTIVE install in its own emit, best-effort:
    an absent install is never created, and a failure doesn't abort the rest."""

    def test_best_effort_rebuild_of_active_installs(self):
        import argparse
        import shutil
        tmp = Path(tempfile.mkdtemp())
        og = tmp / "oc"; og.mkdir(); (og / ".geneseed-emit").write_text("opencode-global", encoding="utf-8")
        cg = tmp / "cl"; cg.mkdir(); (cg / ".geneseed-emit").write_text("claude-global", encoding="utf-8")
        ab = tmp / "ab"; ab.mkdir()
        calls = []

        class RC:
            def __init__(self, rc):
                self.returncode = rc

        def fake_run(cmd, *a, **k):
            calls.append([str(c) for c in cmd])
            return RC(1 if any("claude-global" in str(c) for c in cmd) else 0)

        state = {og.resolve(): "active", cg.resolve(): "active", ab.resolve(): "absent"}
        saved = {k: getattr(_harness_build, k)
                 for k in ("_install_targets", "_install_state", "_theme_of_dir", "run")}
        _harness_build._install_targets = lambda: [
            ("opencode", "global", og), ("claude", "global", cg), ("opencode", "global", ab)]
        _harness_build._install_state = lambda r, h="opencode", s="global": \
            state.get(Path(r).resolve(), "absent")
        _harness_build._theme_of_dir = lambda d: "neutral"
        _harness_build.run = fake_run
        try:
            rc = _harness_build.cmd_rebuild_all(argparse.Namespace())
        finally:
            for k, v in saved.items():
                setattr(_harness_build, k, v)
            shutil.rmtree(tmp, ignore_errors=True)
        emits = [c[c.index("--emit") + 1] for c in calls if "--emit" in c]
        self.assertEqual(len(calls), 2, "the absent install must be skipped, not created")
        self.assertIn("opencode-global", emits)
        self.assertIn("claude-global", emits)
        self.assertEqual(rc, 1, "a failed install -> non-zero, but the others still ran")


class ProjectBypassesGlobalTests(unittest.TestCase):
    """Project-bypasses-global: a project install suppresses the same host's GLOBAL
    preamble (claudeMdExcludes) and its global context hook stands down in-repo."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        # Keep the opt-out env out of every assertion unless a test sets it.
        self._saved_env = {k: os.environ.pop(k, None)
                           for k in ("GENESEED_STACK_GLOBAL", "GENESEED_ROOT")}

    def tearDown(self):
        import shutil
        for k, v in self._saved_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _settings(self, repo, marker=".claude", fname=None):
        # Claude project installs write the personal settings.local.json; bob (no
        # documented local variant) keeps settings.json.
        fname = fname or ("settings.json" if marker == ".bob" else "settings.local.json")
        return json.loads(_read(repo / marker / fname))

    def test_project_emit_writes_exclude_and_scoped_hook(self):
        repo = (self.tmp / "repo").resolve(); repo.mkdir()
        build.emit_claude("neutral", repo)
        s = self._settings(repo)
        # claudeMdExcludes suppresses the GLOBAL ~/.claude/CLAUDE.md, and only that.
        # Posix spelling: the entries are glob patterns, where a backslash escapes.
        want = (build._claude_config_dir() / "CLAUDE.md").resolve().as_posix()
        self.assertIn(want, s.get("claudeMdExcludes", []))
        # context hook is scope-aware: --root points at the project's own .claude.
        ctx = [c for c in _hook_cmds(s) if "context" in c]
        self.assertTrue(ctx and "--root" in ctx[0])
        self.assertIn(str(repo / ".claude"), ctx[0])
        # manifest records the exclude so deactivate/uninstall can remove exactly it.
        man = json.loads(_read(repo / ".claude" / build.GLOBAL_MANIFEST))
        self.assertIn(want, man["managed"].get("settings_excludes", []))

    def test_global_emit_writes_no_exclude(self):
        cfg = self.tmp / "dotclaude"
        build.emit_claude_global("neutral", cfg=cfg)
        s = json.loads(_read(cfg / "settings.json"))
        self.assertNotIn("claudeMdExcludes", s)

    def test_bob_project_writes_rules_stub_and_no_exclude(self):
        # Bob's bypass is the rules file, NOT claudeMdExcludes (Claude-only key, unknown
        # Bob semantics): the project ships .bob/rules/geneseed.md — always injected, and
        # shadowing the same-named global rule — and settings.json carries no exclude.
        # The rules file is a slim STUB (the root AGENTS.md already auto-loads the
        # preamble; a full second copy would double the per-turn token cost).
        repo = (self.tmp / "bobrepo").resolve(); repo.mkdir()
        build.emit_bob("neutral", repo)
        s = self._settings(repo, ".bob")
        self.assertNotIn("claudeMdExcludes", s)
        rules = repo / ".bob" / "rules" / "geneseed.md"
        self.assertTrue(rules.is_file())
        stub = _read(rules)
        self.assertEqual(stub, build._BOB_RULES_STUB)
        self.assertLess(len(stub), 1000, "the stub is injected every turn — keep it slim")
        self.assertIn("AGENTS.md", stub)
        # the preamble itself lives in the root AGENTS.md managed block.
        agents_md = _read(repo / "AGENTS.md")
        self.assertIn("<!-- BEGIN GENESEED -->", agents_md)
        self.assertGreater(len(agents_md), len(stub))
        man = json.loads(_read(repo / ".bob" / build.GLOBAL_MANIFEST))
        self.assertIn("rules/geneseed.md", man["owned"])

    def test_bob_global_writes_rules_preamble_and_no_agents_md(self):
        # A global ~/.bob/AGENTS.md is not auto-loaded by Bob, so none is written;
        # rules/geneseed.md is the channel that actually injects and carries the FULL
        # preamble (skills already load natively from ~/.bob/skills).
        cfg = self.tmp / "dotbob"
        build.emit_bob_global("neutral", cfg=cfg)
        rules = cfg / "rules" / "geneseed.md"
        self.assertTrue(rules.is_file())
        self.assertNotEqual(_read(rules), build._BOB_RULES_STUB)
        self.assertGreater(len(_read(rules)), 5000, "global rules file carries the preamble")
        self.assertFalse((cfg / "AGENTS.md").exists())
        # and the manifest records no claude_md block, but still reads as Claude-style
        # (cmd_uninstall must pick the Claude reversal for ~/.bob).
        man = json.loads(_read(cfg / build.GLOBAL_MANIFEST))
        self.assertNotIn("claude_md", man["managed"])
        self.assertTrue(harness._manifest_is_claude(cfg))
        self.assertNotIn("claudeMdExcludes", json.loads(_read(cfg / "settings.json")))

    def test_bob_global_reemit_removes_stale_agents_md(self):
        # Older Bob-global emits wrote AGENTS.md as a managed block; a re-emit must
        # self-heal — delete a Geneseed-created file (whole), excise the block from a
        # user-prose one — instead of leaving a stale preamble copy behind.
        cfg = self.tmp / "dotbob2"
        build.emit_bob_global("neutral", cfg=cfg)
        stale = cfg / "AGENTS.md"
        stale.write_text("<!-- BEGIN GENESEED -->\nold preamble\n<!-- END GENESEED -->\n",
                         encoding="utf-8")
        mp = cfg / build.GLOBAL_MANIFEST
        man = json.loads(_read(mp))
        man["managed"]["claude_md"] = {"rel": "AGENTS.md", "whole": True}
        mp.write_text(json.dumps(man, indent=2) + "\n", encoding="utf-8")
        build.emit_bob_global("neutral", cfg=cfg)
        self.assertFalse(stale.exists())
        self.assertNotIn("claude_md", json.loads(_read(mp))["managed"])
        # user prose around the block survives the excise path (whole=False).
        stale.write_text("my own notes\n<!-- BEGIN GENESEED -->\nold\n<!-- END GENESEED -->\n",
                         encoding="utf-8")
        man = json.loads(_read(mp))
        man["managed"]["claude_md"] = {"rel": "AGENTS.md", "whole": False}
        mp.write_text(json.dumps(man, indent=2) + "\n", encoding="utf-8")
        build.emit_bob_global("neutral", cfg=cfg)
        self.assertTrue(stale.exists())
        self.assertIn("my own notes", _read(stale))
        self.assertNotIn("BEGIN GENESEED", _read(stale))

    def test_bob_reemit_self_heals_old_exclude(self):
        # Older emits wrote the global AGENTS.md into claudeMdExcludes; a re-emit must
        # strip it (and drop it from the manifest) rather than carry it forward.
        repo = (self.tmp / "bobrepo2").resolve(); repo.mkdir()
        build.emit_bob("neutral", repo)
        stale = str((build._bob_config_dir() / "AGENTS.md").resolve())
        sp = repo / ".bob" / "settings.json"
        s = json.loads(_read(sp)); s["claudeMdExcludes"] = [stale]
        sp.write_text(json.dumps(s, indent=2) + "\n", encoding="utf-8")
        mp = repo / ".bob" / build.GLOBAL_MANIFEST
        man = json.loads(_read(mp)); man["managed"]["settings_excludes"] = [stale]
        mp.write_text(json.dumps(man, indent=2) + "\n", encoding="utf-8")
        build.emit_bob("neutral", repo)
        self.assertNotIn("claudeMdExcludes", self._settings(repo, ".bob"))
        man = json.loads(_read(mp))
        self.assertNotIn("settings_excludes", man["managed"])

    def test_stack_global_env_suppresses_the_exclude(self):
        repo = (self.tmp / "repo2").resolve(); repo.mkdir()
        os.environ["GENESEED_STACK_GLOBAL"] = "1"
        build.emit_claude("neutral", repo)
        s = self._settings(repo)
        self.assertNotIn("claudeMdExcludes", s)
        # and a re-emit WITHOUT the env adds it; re-emit WITH it strips it again.
        del os.environ["GENESEED_STACK_GLOBAL"]
        build.emit_claude("neutral", repo)
        self.assertIn("claudeMdExcludes", self._settings(repo))
        os.environ["GENESEED_STACK_GLOBAL"] = "1"
        build.emit_claude("neutral", repo)
        self.assertNotIn("claudeMdExcludes", self._settings(repo))

    def test_reemit_migrates_hooks_out_of_shared_settings_json(self):
        # An older install wired the machine-absolute hooks into the team-shared
        # settings.json. A re-emit must unwire them THERE (via the recorded claims)
        # and wire settings.local.json instead — otherwise every teammate keeps
        # inheriting hooks that point at this machine's python forever.
        repo = (self.tmp / "repo3").resolve(); repo.mkdir()
        build.emit_claude("neutral", repo)
        cfg = repo / ".claude"
        # Rewind to the old layout: hooks live in settings.json, manifest says so.
        (cfg / "settings.json").write_text(_read(cfg / "settings.local.json"),
                                           encoding="utf-8")
        (cfg / "settings.local.json").unlink()
        man = json.loads(_read(cfg / build.GLOBAL_MANIFEST))
        man["managed"]["settings_file"] = "settings.json"
        (cfg / build.GLOBAL_MANIFEST).write_text(json.dumps(man), encoding="utf-8")

        build.emit_claude("neutral", repo)
        s_shared = json.loads(_read(cfg / "settings.json"))
        self.assertFalse(any("harness.py" in c for c in _hook_cmds(s_shared)),
                         "hooks left in the team-shared settings.json")
        s_local = self._settings(repo)
        self.assertTrue(any("harness.py" in c for c in _hook_cmds(s_local)))
        man = json.loads(_read(cfg / build.GLOBAL_MANIFEST))
        self.assertEqual(man["managed"].get("settings_file"), "settings.local.json")

    def test_bob_global_rules_pointers_climb_to_stores(self):
        # ~/.bob's preamble carrier is rules/geneseed.md, one level BELOW the stores:
        # its pointers must climb (../memory), or `memory/`/`laws/` resolve under
        # rules/ where nothing exists.
        cfg = (self.tmp / "dotbob2").resolve(); cfg.mkdir()
        build.emit_bob_global("neutral", cfg=cfg)
        rules = _read(cfg / "rules" / "geneseed.md")
        self.assertIn("../memory", rules)
        self.assertNotIn("(memory/", rules)

    def _mk_install(self, parent, marker=".claude"):
        d = (parent / marker)
        d.mkdir(parents=True)
        (d / build.GLOBAL_MANIFEST).write_text("{}", encoding="utf-8")
        return d

    def test_detector_global_stands_down_only_for_matching_project(self):
        import _harness_context as hc
        gcfg = self._mk_install(self.tmp / "home")          # global ~/.claude analogue
        repo = (self.tmp / "repo").resolve()
        pcfg = self._mk_install(repo)                        # project <repo>/.claude
        # global hook in the repo -> stands down (project hook will inject)
        self.assertTrue(hc._global_hook_standing_down(gcfg, repo))
        # the project's OWN hook never stands down
        self.assertFalse(hc._global_hook_standing_down(pcfg, repo))
        # no project install in cwd -> global injects
        empty = (self.tmp / "elsewhere").resolve(); empty.mkdir()
        self.assertFalse(hc._global_hook_standing_down(gcfg, empty))
        # up-walk: a subdir of the repo still triggers stand-down
        sub = repo / "a" / "b"; sub.mkdir(parents=True)
        self.assertTrue(hc._global_hook_standing_down(gcfg, sub))
        # per-host: a project .opencode never silences a global .claude (different marker)
        bobg = self._mk_install(self.tmp / "bobhome", ".bob")
        self.assertFalse(hc._global_hook_standing_down(bobg, repo))

    def test_cmd_context_stand_down_is_silent_and_opt_out_works(self):
        import io
        import argparse
        import contextlib
        import _harness_context as hc
        repo = (self.tmp / "repo").resolve()
        build.emit_claude("neutral", repo)                  # project install + repo/CLAUDE.md
        gcfg = self._mk_install(self.tmp / "home")          # a foreign global install
        os.environ["GENESEED_ROOT"] = str(repo)
        # global hook -> silent (stands down)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = hc.cmd_context(argparse.Namespace(root=str(gcfg)))
        self.assertEqual(rc, 0)
        self.assertEqual(buf.getvalue().strip(), "", "global hook should inject nothing in-repo")
        # the project's own hook injects (its --root is the repo's .claude)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            hc.cmd_context(argparse.Namespace(root=str(repo / ".claude")))
        self.assertIn("PROJECT CONTEXT", buf.getvalue())
        # opt out: GENESEED_STACK_GLOBAL makes the global hook inject too (stacking)
        os.environ["GENESEED_STACK_GLOBAL"] = "1"
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            hc.cmd_context(argparse.Namespace(root=str(gcfg)))
        self.assertIn("PROJECT CONTEXT", buf.getvalue())


if __name__ == "__main__":
    unittest.main()
