"""Unit tests for the Claude Code host: the emit (claude-global / claude folder),
user-content safety (claim-on-create, managed CLAUDE.md block, surgical settings.json
hook merge), and the deactivate/reactivate/uninstall activation. Stdlib unittest only.

Run from the Geneseed root:  python -m unittest discover -s tests
"""
import json
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
        self.assertTrue((repo / ".claude" / "settings.json").is_file())
        self.assertTrue((repo / ".claude" / build.GLOBAL_MANIFEST).is_file())
        # learn hook points at the project's own memory store (absolute).
        s = json.loads(_read(repo / ".claude" / "settings.json"))
        learn = [c for c in _hook_cmds(s) if "learn" in c]
        self.assertTrue(learn and str((repo / ".claude" / "memory")) in learn[0])


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
        self.assertFalse(man["managed"]["claude_md"]["whole"])
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


if __name__ == "__main__":
    unittest.main()
