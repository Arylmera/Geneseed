"""Unit tests for the Geneseed generator (build.py). Stdlib unittest only — no deps.

Run from the Geneseed root:  python -m unittest discover -s tests
"""
import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import build  # noqa: E402


class SubstituteTests(unittest.TestCase):
    def test_known_token_replaced(self):
        self.assertEqual(build.substitute("{{X}}", {"X": "y"}), "y")

    def test_unknown_token_left_visible(self):
        # Unknown tokens stay verbatim so doctor can flag them.
        self.assertEqual(build.substitute("{{Z}}", {"X": "y"}), "{{Z}}")


class ThemeStructureTests(unittest.TestCase):
    def test_structure_overrides_theme_voice(self):
        # A theme can never rename a folder, the harness name, or a rare technical noun.
        t = build.effective_theme("imperial")
        self.assertEqual(t["DIR_AGENTS"], "agents")
        self.assertEqual(t["HARNESS"], "Geneseed")
        self.assertEqual(t["CONTEXT"], "Context")

    def test_vocabulary_nouns_are_themed(self):
        # Prose nouns ARE themed now: neutral keeps the plain words, imperial differs.
        self.assertEqual(build.effective_theme("neutral")["LAW"], "Rule")
        self.assertEqual(build.effective_theme("neutral")["VAULT"], "Workspace")
        self.assertEqual(build.effective_theme("imperial")["LAW"], "Dictate")
        self.assertEqual(build.effective_theme("imperial")["SKILL"], "Rite")
        # but the folder is still neutral even when the prose noun is themed
        self.assertEqual(build.effective_theme("imperial")["DIR_SKILLS"], "skills")

    def test_themed_rel_neutral_is_identity(self):
        t = build.effective_theme("neutral")
        self.assertEqual(
            build.themed_rel(Path("laws/universal.md"), t).as_posix(),
            "laws/universal.md",
        )


class DestRelTests(unittest.TestCase):
    def test_tmpl_becomes_agent_md(self):
        self.assertEqual(build.dest_rel(Path("AGENT.md.tmpl")).name, "AGENT.md")

    def test_other_names_unchanged(self):
        self.assertEqual(build.dest_rel(Path("laws/universal.md")).name, "universal.md")


class RenderAllTests(unittest.TestCase):
    def test_no_unresolved_tokens_in_any_theme(self):
        for theme in (p.stem for p in build.theme_files()):
            _t, items = build.render_all(theme)
            for rel, text, _src in items:
                # Vendored third-party skill folders are exempt (same as doctor's
                # _check_build): they are copied verbatim and legitimately contain `{{`
                # — e.g. JSX `style={{ ... }}` — which is not a Geneseed token.
                if text is not None and not build.is_vendored_path(rel):
                    self.assertNotIn("{{", text, f"unresolved token in {rel} ({theme})")

    def test_include_directive_is_inlined(self):
        # AGENT.md.tmpl includes laws/universal.md; proof the INCLUDE engine ran.
        _t, items = build.render_all("neutral")
        agent = next(t for r, t, _ in items if r == "AGENT.md")
        self.assertIn("Sealed Secrets", agent)


class FootprintTests(unittest.TestCase):
    """The lean/full instruction-set footprint: AGENT.md §1 either inlines every law's
    full text (full) or condenses each law to its title + first sentence (lean), while
    the complete laws/universal.md always ships in the bundle. Every law binds either
    way — footprint governs how much AGENT.md inlines, not which laws apply."""

    # A mid-law sentence present ONLY in Law I's full body — dropped once lean keeps
    # just the opening sentence. The discriminator between the two footprints.
    FULL_ONLY = "or a secret manager"
    ESSENCE = "No key, password, token, or secret"

    def _agent(self, footprint):
        _t, items = build.render_all("neutral", footprint)
        return next(t for r, t, _ in items if r == "AGENT.md")

    def test_full_inlines_complete_law_text(self):
        self.assertIn(self.FULL_ONLY, self._agent("full"))

    def test_lean_keeps_essence_but_drops_the_rest(self):
        agent = self._agent("lean")
        self.assertIn(self.ESSENCE, agent)          # first sentence kept
        self.assertNotIn(self.FULL_ONLY, agent)     # the rest of the body trimmed

    def test_lean_build_still_ships_the_full_law_file(self):
        tmp = Path(tempfile.mkdtemp())
        try:
            build.build("neutral", tmp, "lean")
            self.assertIn(self.ESSENCE, (tmp / "AGENT.md").read_text(encoding="utf-8"))
            # universal.md keeps the complete, binding text regardless of footprint.
            self.assertIn(self.FULL_ONLY,
                          (tmp / "laws" / "universal.md").read_text(encoding="utf-8"))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class BuildRoundTripTests(unittest.TestCase):
    def test_build_writes_expected_tree(self):
        tmp = Path(tempfile.mkdtemp())
        try:
            build.build("neutral", tmp)
            self.assertTrue((tmp / "AGENT.md").is_file())
            self.assertTrue((tmp / "laws" / "universal.md").is_file())
            self.assertTrue((tmp / "memory" / "MEMORY.md").is_file())
            # The agent's own freeform space ships its convention + a seeded index.
            self.assertTrue((tmp / "notebook" / "README.md").is_file())
            self.assertTrue((tmp / "notebook" / ".gitignore").is_file())
            self.assertTrue((tmp / "notebook" / "NOTEBOOK.md").is_file())
            # context.json stub is created once.
            self.assertTrue((tmp / "context.json").is_file())
            # wiki.jsonc stub is created once, with an empty wikis list.
            self.assertTrue((tmp / "wiki.jsonc").is_file())
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_wiki_manifest_is_preserved_across_rebuild(self):
        """wiki.jsonc holds the user's own knowledge-base declarations: seeded once as
        JSONC — a commented copy-and-edit example over an empty list — and never
        overwritten (spec 2026-06-11)."""
        tmp = Path(tempfile.mkdtemp())
        try:
            build.build("neutral", tmp)
            wiki = tmp / "wiki.jsonc"
            text = wiki.read_text(encoding="utf-8")
            self.assertIn("// Example", text)   # the inline example ships with the stub
            data = json.loads("\n".join(
                l for l in text.splitlines() if not l.lstrip().startswith("//")))
            self.assertEqual(data["wikis"], [])
            mine = '{"wikis": [{"name": "Brain", "path": "/kb"}]}\n'
            wiki.write_text(mine, encoding="utf-8")
            build.build("neutral", tmp)   # rebuild over the same dir
            self.assertEqual(wiki.read_text(encoding="utf-8"), mine)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_wiki_legacy_json_suppresses_the_stub(self):
        """A `wiki.json` seeded by an earlier build still counts as the manifest:
        building must not drop a second `wiki.jsonc` beside it (that would fork
        the user's declarations across two files)."""
        tmp = Path(tempfile.mkdtemp())
        try:
            legacy = '{"wikis": [{"name": "Old", "path": "/kb"}]}\n'
            (tmp / "wiki.json").write_text(legacy, encoding="utf-8")
            build.build("neutral", tmp)
            self.assertFalse((tmp / "wiki.jsonc").exists())
            self.assertEqual((tmp / "wiki.json").read_text(encoding="utf-8"), legacy)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_posture_default_peer_is_inlined(self):
        """With no --posture, AGENT.md's Posture section carries the peer body."""
        tmp = Path(tempfile.mkdtemp())
        try:
            build.build("neutral", tmp)
            agent = (tmp / "AGENT.md").read_text(encoding="utf-8")
            self.assertIn("## Posture", agent)
            self.assertIn("**Peer**", agent)
            self.assertNotIn("**Expert**", agent)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_posture_selection_switches_the_inlined_body(self):
        """Setting the build-wide POSTURE inlines that posture instead of peer."""
        tmp = Path(tempfile.mkdtemp())
        old = build.POSTURE
        try:
            build.POSTURE = "expert"          # facade mirrors into _build_render
            build.build("neutral", tmp)
            agent = (tmp / "AGENT.md").read_text(encoding="utf-8")
            self.assertIn("**Expert**", agent)
            self.assertNotIn("**Peer**", agent)
            # The full catalogue always ships regardless of the active posture.
            self.assertTrue((tmp / "postures" / "peer.md").is_file())
        finally:
            build.POSTURE = old
            shutil.rmtree(tmp, ignore_errors=True)

    def test_posture_names_discovers_files_peer_first(self):
        names = build.posture_names()
        self.assertEqual(names[0], "peer")            # default sorts first
        self.assertIn("expert", names)
        self.assertNotIn("README", names)             # README is not a posture

    def test_profile_is_seeded_once_and_preserved(self):
        """PROFILE.md holds the user's own identity: seeded once beside AGENT.md,
        never overwritten (same contract as wiki.jsonc / user-rules.md). It is
        identity, not rules — the stub must point rules at user-rules.md."""
        tmp = Path(tempfile.mkdtemp())
        try:
            build.build("neutral", tmp)
            prof = tmp / "PROFILE.md"
            self.assertTrue(prof.is_file())
            self.assertIn("user-rules.md", prof.read_text(encoding="utf-8"))
            mine = "# Your profile\n\nI am the test user.\n"
            prof.write_text(mine, encoding="utf-8")
            build.build("neutral", tmp)   # rebuild over the same dir
            self.assertEqual(prof.read_text(encoding="utf-8"), mine)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_notebook_is_preserved_across_rebuild(self):
        """The notebook is the agent's own store: NOT an owned dir, seeded once.
        A rebuild must never wipe the index or any file the agent kept there."""
        tmp = Path(tempfile.mkdtemp())
        try:
            build.build("neutral", tmp)
            # The agent writes its own index + a freeform file.
            (tmp / "notebook" / "NOTEBOOK.md").write_text("# Notebook Index\n- kept\n",
                                                          encoding="utf-8")
            (tmp / "notebook" / "scratch.md").write_text("my own work", encoding="utf-8")
            build.build("neutral", tmp)   # rebuild over the same dir
            self.assertEqual((tmp / "notebook" / "NOTEBOOK.md").read_text(encoding="utf-8"),
                             "# Notebook Index\n- kept\n")
            self.assertTrue((tmp / "notebook" / "scratch.md").is_file())
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_notebook_charter_is_agent_owned_after_seed(self):
        """The charter README is seeded on first build and never re-emitted: an
        agent rewrite must survive a rebuild byte-for-byte (sovereign space,
        spec 2026-06-11)."""
        tmp = Path(tempfile.mkdtemp())
        try:
            build.build("neutral", tmp)
            charter = tmp / "notebook" / "README.md"
            self.assertTrue(charter.is_file())   # seeded on first build
            charter.write_text("# My rules\nmine now\n", encoding="utf-8")
            build.build("neutral", tmp)          # rebuild over the same dir
            self.assertEqual(charter.read_text(encoding="utf-8"),
                             "# My rules\nmine now\n")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_notebook_gitignore_is_reasserted(self):
        """The .gitignore is the one fixed law of the space: modified or deleted,
        the next rebuild restores the build's version."""
        tmp = Path(tempfile.mkdtemp())
        try:
            build.build("neutral", tmp)
            gi = tmp / "notebook" / ".gitignore"
            original = gi.read_text(encoding="utf-8")
            gi.write_text("# lifted\n", encoding="utf-8")
            build.build("neutral", tmp)
            self.assertEqual(gi.read_text(encoding="utf-8"), original)
            gi.unlink()
            build.build("neutral", tmp)
            self.assertTrue(gi.is_file())
            self.assertEqual(gi.read_text(encoding="utf-8"), original)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


class SrcDirRenameOrphanTests(unittest.TestCase):
    """Task 9: a DIR_* rename between two builds into the SAME `out` must not orphan
    the old themed dir. Shipped themes never actually vary DIR_* today (STRUCTURE
    always wins over a theme's own value — see effective_theme), so this simulates
    the rename the way a future themed DIR_* would produce: by patching the module-
    level STRUCTURE dict build() actually resolves against, between two build() calls
    into the same target."""

    def _rename_dir_token(self, token: str, new_name: str):
        old = dict(build.STRUCTURE)
        build.STRUCTURE[token] = new_name
        self.addCleanup(lambda: (build.STRUCTURE.clear(), build.STRUCTURE.update(old)))

    def test_dir_laws_rename_prunes_the_old_dir(self):
        tmp = Path(tempfile.mkdtemp())
        try:
            build.build("neutral", tmp)
            self.assertTrue((tmp / "laws").is_dir())
            self._rename_dir_token("DIR_LAWS", "ordinances")
            build.build("neutral", tmp)
            self.assertFalse((tmp / "laws").exists(),
                              "old DIR_LAWS dir must be pruned, not orphaned")
            self.assertTrue((tmp / "ordinances" / "universal.md").is_file())
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_dir_agents_and_dir_skills_rename_prunes_old_dirs(self):
        tmp = Path(tempfile.mkdtemp())
        try:
            build.build("neutral", tmp)
            self._rename_dir_token("DIR_AGENTS", "specialists")
            self._rename_dir_token("DIR_SKILLS", "rites")
            build.build("neutral", tmp)
            self.assertFalse((tmp / "agents").exists())
            self.assertFalse((tmp / "skills").exists())
            self.assertTrue((tmp / "specialists").is_dir())
            self.assertTrue((tmp / "rites").is_dir())
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_rename_round_trips_back_without_leftovers(self):
        """Renaming out and back must leave exactly the original dir — no trace of
        the intermediate themed name survives a second flip."""
        tmp = Path(tempfile.mkdtemp())
        try:
            build.build("neutral", tmp)
            self._rename_dir_token("DIR_LAWS", "ordinances")
            build.build("neutral", tmp)
            self.assertTrue((tmp / "ordinances").is_dir())
            # Flip back to the original name.
            build.STRUCTURE["DIR_LAWS"] = "laws"
            build.build("neutral", tmp)
            self.assertTrue((tmp / "laws").is_dir())
            self.assertFalse((tmp / "ordinances").exists())
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_first_build_into_non_bundle_dir_never_wipes_user_content(self):
        """The prior-dirs marker must only ever prune inside an established bundle
        (is_bundle) — a first render into an arbitrary repo must not touch a
        pre-existing user dir just because a stale marker happens to be lying
        around from an unrelated source."""
        import contextlib, io
        tmp = Path(tempfile.mkdtemp())
        try:
            (tmp / "laws").mkdir()
            (tmp / "laws" / "mine.md").write_text("user content", encoding="utf-8")
            # build() prints a merge warning on this exact path — redirect to keep
            # the test output clean.
            with contextlib.redirect_stdout(io.StringIO()):
                build.build("neutral", tmp)   # tmp has no .geneseed-theme/-version yet
            self.assertTrue((tmp / "laws" / "mine.md").is_file())
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_suspicious_marker_values_are_never_rmtreed(self):
        """The marker is a plain editable file — "..", an absolute path, a nested
        "a/b", or a non-string must never reach rmtree. Each is skipped with a
        WARN naming the marker file, the build completes, and nothing the value
        pointed at is deleted."""
        import contextlib, io
        outer = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, outer, ignore_errors=True)
        bundle = outer / "bundle"
        with contextlib.redirect_stdout(io.StringIO()):
            build.build("neutral", bundle)
        # Targets a malicious/corrupt value could otherwise reach:
        (outer / "sentinel.txt").write_text("parent content", encoding="utf-8")
        victim = outer / "victim"                      # absolute-path escape target
        (victim / "sub").mkdir(parents=True)
        (victim / "sub" / "keep.md").write_text("x", encoding="utf-8")
        nested = bundle / "a" / "b"                    # multi-segment reach-in target
        nested.mkdir(parents=True)
        (nested / "keep.md").write_text("x", encoding="utf-8")
        for bad in ("..", str(victim), "a/b", ["laws"], 123):
            (bundle / build.SRC_DIRS_MARKER).write_text(
                json.dumps({"laws": bad}), encoding="utf-8")
            err = io.StringIO()
            with contextlib.redirect_stdout(io.StringIO()), \
                 contextlib.redirect_stderr(err):
                build.build("neutral", bundle)         # must not raise, must warn
            self.assertIn("WARN", err.getvalue(), f"value {bad!r} must warn")
            self.assertIn(build.SRC_DIRS_MARKER, err.getvalue())
        self.assertTrue((outer / "sentinel.txt").is_file())      # ".." blocked
        self.assertTrue((victim / "sub" / "keep.md").is_file())  # absolute blocked
        self.assertTrue((nested / "keep.md").is_file())          # "a/b" blocked


class FootprintOrphanRegressionTests(unittest.TestCase):
    """Task 9: full -> lean -> full footprint switches must not leave the standalone
    lean-mode laws dir behind. This is already fixed by Task 3's owned-file manifest
    for the global/claude/bob scopes (`_ship_lean_laws`'s files are tracked in
    `owned` and pruned by the existing old_owned - owned diff) — kept here as
    regression coverage, not a new fix."""

    def test_global_scope_lean_to_full_prunes_standalone_laws_dir(self):
        import contextlib, io
        cfg = Path(tempfile.mkdtemp()) / "cfg"
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                build.emit_opencode_global("neutral", out=Path(tempfile.mkdtemp()) / "b",
                                           cfg=cfg, footprint="lean")
            self.assertTrue((cfg / "laws" / "universal.md").is_file())
            with contextlib.redirect_stdout(io.StringIO()):
                build.emit_opencode_global("neutral", out=Path(tempfile.mkdtemp()) / "b",
                                           cfg=cfg, footprint="full")
            self.assertFalse((cfg / "laws").exists(),
                              "lean-mode standalone laws/ must be pruned on full switch")
        finally:
            shutil.rmtree(cfg.parent, ignore_errors=True)

    def test_claude_global_scope_lean_to_full_prunes_standalone_laws_dir(self):
        import contextlib, io
        cfg = Path(tempfile.mkdtemp()) / "cfg"
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                build.emit_claude_global("neutral", out=Path(tempfile.mkdtemp()) / "b",
                                         cfg=cfg, footprint="lean")
            self.assertTrue((cfg / "laws" / "universal.md").is_file())
            with contextlib.redirect_stdout(io.StringIO()):
                build.emit_claude_global("neutral", out=Path(tempfile.mkdtemp()) / "b",
                                         cfg=cfg, footprint="full")
            self.assertFalse((cfg / "laws").exists())
        finally:
            shutil.rmtree(cfg.parent, ignore_errors=True)

    def test_excludes_stub_seeded_and_user_owned(self):
        """excludes.json is seeded once beside AGENT.md, never overwritten (it holds
        the user's own folder exclusion list). It is never in the owned-manifest, so
        the global emits' prune treats it as the user's — the same contract as
        context.json, wiki.jsonc, and user-rules.md."""
        cfg = Path(tempfile.mkdtemp()) / "cfg"
        try:
            build.emit_claude_global("neutral", cfg=cfg)
            dest = cfg / "excludes.json"
            self.assertTrue(dest.is_file())
            data = json.loads(dest.read_text(encoding="utf-8"))
            self.assertEqual(data["excludes"], [])
            # never in the owned manifest
            manifest = json.loads((cfg / ".geneseed-manifest.json").read_text(encoding="utf-8"))
            self.assertNotIn("excludes.json", manifest["owned"])
            # user content survives a re-emit
            dest.write_text('{"excludes": [{"path": "C:/x"}]}', encoding="utf-8")
            build.emit_claude_global("neutral", cfg=cfg)
            self.assertEqual(json.loads(dest.read_text(encoding="utf-8"))["excludes"], [{"path": "C:/x"}])
        finally:
            shutil.rmtree(cfg.parent, ignore_errors=True)


class CircularIncludeTests(unittest.TestCase):
    """INCLUDE resolution must catch a cycle and emit a visible marker rather than
    recursing until Python raises RecursionError."""

    def _render_in_temp_src(self, files: dict, entry: str) -> str:
        tmp = Path(tempfile.mkdtemp())
        orig = build.SRC
        try:
            build.SRC = tmp
            for name, body in files.items():
                (tmp / name).write_text(body, encoding="utf-8")
            return build.render_file(tmp / entry, {})
        finally:
            build.SRC = orig
            shutil.rmtree(tmp, ignore_errors=True)

    def test_mutual_cycle_is_marked(self):
        out = self._render_in_temp_src(
            {"a.md": "A\n<!-- INCLUDE: b.md -->\n", "b.md": "B\n<!-- INCLUDE: a.md -->\n"},
            "a.md",
        )
        self.assertIn("<!-- CIRCULAR INCLUDE: a.md -->", out)
        self.assertIn("B", out)  # b is inlined once before the cycle back to a is caught

    def test_self_include_is_marked(self):
        out = self._render_in_temp_src({"s.md": "S\n<!-- INCLUDE: s.md -->\n"}, "s.md")
        self.assertIn("<!-- CIRCULAR INCLUDE: s.md -->", out)


class NativeLayerTests(unittest.TestCase):
    def test_readonly_agents_get_permission_block(self):
        _t, items = build.render_all("neutral")
        d = Path(tempfile.mkdtemp())
        try:
            build._write_native_layer(items, d / "agents", d / "skills")
            reviewer = (d / "agents" / "reviewer.md").read_text(encoding="utf-8")
            explorer = (d / "agents" / "explorer.md").read_text(encoding="utf-8")
            architect = (d / "agents" / "architect.md").read_text(encoding="utf-8")
            tester = (d / "agents" / "tester.md").read_text(encoding="utf-8")
            # read-only agents get a permission block denying edit + webfetch
            self.assertIn("permission:", reviewer)
            self.assertIn("edit: deny", reviewer)
            self.assertIn("webfetch: deny", reviewer)
            # reviewer/explorer opt in to read-only bash (<!-- bash: allow -->) -> ask;
            # architect (no opt-in) -> bash denied outright
            self.assertIn('"*": ask', reviewer)
            self.assertIn('"*": ask', explorer)
            self.assertIn("bash: deny", architect)
            self.assertNotIn('"*": ask', architect)
            # tester edits test files -> not read-only -> no permission block
            self.assertNotIn("permission:", tester)
        finally:
            shutil.rmtree(d, ignore_errors=True)


class OpencodeExtrasTests(unittest.TestCase):
    def _items(self):
        _t, items = build.render_all("neutral")
        return items

    def test_load_agent_overrides_missing_and_parsed(self):
        d = Path(tempfile.mkdtemp())
        try:
            self.assertEqual(build._load_agent_overrides(d), {})          # absent -> {}
            (d / "agent-overrides.json").write_text(
                '{"agents": {"reviewer": {"model": "x/y", "temperature": 0.1}}}', encoding="utf-8")
            ov = build._load_agent_overrides(d)
            self.assertEqual(ov["reviewer"]["model"], "x/y")
            # malformed -> {} (never throws, agents just inherit)
            (d / "agent-overrides.json").write_text("{ not json", encoding="utf-8")
            self.assertEqual(build._load_agent_overrides(d), {})
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_overrides_emit_model_only_when_set(self):
        d = Path(tempfile.mkdtemp())
        try:
            ov = {"reviewer": {"model": "anthropic/claude-haiku-4-5", "temperature": 0.1}}
            build._write_native_layer(self._items(), d / "agents", d / "skills", ov)
            reviewer = (d / "agents" / "reviewer.md").read_text(encoding="utf-8")
            tester = (d / "agents" / "tester.md").read_text(encoding="utf-8")
            self.assertIn("model: anthropic/claude-haiku-4-5", reviewer)
            self.assertIn("temperature: 0.1", reviewer)
            self.assertNotIn("model:", tester)                           # no override -> inherits
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_primary_and_commands_are_opt_in(self):
        import os
        d = Path(tempfile.mkdtemp())
        try:
            items = self._items()
            os.environ.pop("GENESEED_PRIMARY", None)
            os.environ.pop("GENESEED_COMMANDS", None)
            self.assertIsNone(build._write_primary_agent(d / "agents", {}))   # off by default
            self.assertEqual(build._write_command_layer(items, d / "command"), [])
            os.environ["GENESEED_PRIMARY"] = "1"
            os.environ["GENESEED_COMMANDS"] = "1"
            try:
                p = build._write_primary_agent(d / "agents", {})
                self.assertIsNotNone(p)
                self.assertIn("mode: primary", p.read_text(encoding="utf-8"))
                cmds = build._write_command_layer(items, d / "command")
                self.assertTrue(any(c.name == "commit.md" for c in cmds))
            finally:
                os.environ.pop("GENESEED_PRIMARY", None)
                os.environ.pop("GENESEED_COMMANDS", None)
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_default_permission_added_only_when_absent(self):
        import json as _json
        d = Path(tempfile.mkdtemp())
        try:
            cfg = d / "opencode.json"
            build._merge_opencode_json(cfg, "AGENT.md")                  # fresh -> gets default
            data = _json.loads(cfg.read_text(encoding="utf-8"))
            self.assertIn("permission", data)
            self.assertEqual(data["permission"]["bash"]["rm -rf *"], "ask")
            # Law XX backstop: every commit AND push is gated, not just force-push
            self.assertEqual(data["permission"]["bash"]["git commit*"], "ask")
            self.assertEqual(data["permission"]["bash"]["git push*"], "ask")
            # an existing policy is never overwritten
            cfg.write_text('{"permission": {"bash": "allow"}}', encoding="utf-8")
            build._merge_opencode_json(cfg, "AGENT.md")
            data = _json.loads(cfg.read_text(encoding="utf-8"))
            self.assertEqual(data["permission"]["bash"], "allow")
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_merge_preserves_mcp_block(self):
        # The markitdown MCP server (and any user-added server) lives under `mcp`;
        # a re-emit must never clobber it — only `instructions` is merged in.
        import json as _json
        d = Path(tempfile.mkdtemp())
        try:
            cfg = d / "opencode.json"
            cfg.write_text(_json.dumps({
                "mcp": {"markitdown": {"type": "local",
                                       "command": ["markitdown-mcp"], "enabled": True}}
            }), encoding="utf-8")
            build._merge_opencode_json(cfg, "AGENT.md")
            data = _json.loads(cfg.read_text(encoding="utf-8"))
            self.assertEqual(data["mcp"]["markitdown"]["command"], ["markitdown-mcp"])
            self.assertIn("AGENT.md", data["instructions"])
        finally:
            shutil.rmtree(d, ignore_errors=True)


class AgentOverridesVersionTests(unittest.TestCase):
    """Task 8.2: agent-overrides.json is stamped with `_version` at creation, never
    rewritten on re-emit, and a drift notice fires only when the file actually
    carries overrides beyond the empty stub."""

    def test_stub_stamped_with_current_version_on_creation(self):
        d = Path(tempfile.mkdtemp())
        try:
            build.ensure_agent_overrides_stub(d)
            data = json.loads((d / "agent-overrides.json").read_text(encoding="utf-8"))
            self.assertEqual(data["_version"], build.source_release_version())
            self.assertEqual(data["agents"], {})
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_reemit_never_rewrites_existing_file(self):
        d = Path(tempfile.mkdtemp())
        try:
            dest = d / "agent-overrides.json"
            custom = '{"_version": "0.1.0", "agents": {"reviewer": {"model": "x/y"}}}'
            dest.write_text(custom, encoding="utf-8")
            build.ensure_agent_overrides_stub(d)   # must be a no-op on the user's file
            self.assertEqual(dest.read_text(encoding="utf-8"), custom)
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_notice_fires_on_version_drift_with_real_overrides(self):
        import contextlib, io
        d = Path(tempfile.mkdtemp())
        try:
            dest = d / "agent-overrides.json"
            dest.write_text(json.dumps({
                "_version": "0.0.1",
                "agents": {"reviewer": {"model": "x/y"}},
            }), encoding="utf-8")
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                build.ensure_agent_overrides_stub(d)
            out = buf.getvalue()
            self.assertIn("agent-overrides.json was written for Geneseed 0.0.1", out)
            self.assertIn(build.source_release_version(), out)
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_no_notice_when_version_matches(self):
        import contextlib, io
        d = Path(tempfile.mkdtemp())
        try:
            dest = d / "agent-overrides.json"
            dest.write_text(json.dumps({
                "_version": build.source_release_version(),
                "agents": {"reviewer": {"model": "x/y"}},
            }), encoding="utf-8")
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                build.ensure_agent_overrides_stub(d)
            self.assertEqual(buf.getvalue(), "")
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_no_notice_when_overrides_empty_even_if_version_drifted(self):
        import contextlib, io
        d = Path(tempfile.mkdtemp())
        try:
            dest = d / "agent-overrides.json"
            dest.write_text(json.dumps({"_version": "0.0.1", "agents": {}}), encoding="utf-8")
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                build.ensure_agent_overrides_stub(d)
            self.assertEqual(buf.getvalue(), "")
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_missing_version_reported_as_unknown(self):
        import contextlib, io
        d = Path(tempfile.mkdtemp())
        try:
            dest = d / "agent-overrides.json"
            dest.write_text(json.dumps({
                "agents": {"reviewer": {"model": "x/y"}},   # legacy file: no _version key
            }), encoding="utf-8")
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                build.ensure_agent_overrides_stub(d)
            self.assertIn("unknown version", buf.getvalue())
        finally:
            shutil.rmtree(d, ignore_errors=True)


class OpencodeJsoncTests(unittest.TestCase):
    """`.jsonc`-aware config writes: OpenCode reads/writes opencode.jsonc in preference
    to opencode.json, so Geneseed operates on a present .jsonc — but never rewrites one
    that carries comments (that would drop them)."""

    def _merge(self, cfg):
        # Run a merge while swallowing the warn output; return what was printed.
        import contextlib
        import io
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            build._merge_opencode_json(cfg, "AGENT.md")
        return buf.getvalue()

    def test_read_jsonc_strips_comments_and_trailing_commas(self):
        data, had = build._read_jsonc(
            '{\n  // a line comment\n  "a": 1, /* block */\n  "b": [1, 2,],\n}')
        self.assertEqual(data, {"a": 1, "b": [1, 2]})
        self.assertTrue(had)

    def test_read_jsonc_slashes_inside_string_are_not_comments(self):
        # The $schema URL contains `//` — it must NOT register as a comment.
        data, had = build._read_jsonc(
            '{"$schema": "https://opencode.ai/config.json", "instructions": []}')
        self.assertEqual(data["$schema"], "https://opencode.ai/config.json")
        self.assertFalse(had)

    def test_read_jsonc_trailing_comma_strip_is_string_aware(self):
        # A string value containing `,]` or `, }` must round-trip byte-faithfully —
        # the trailing-comma stripper must not reach inside string literals.
        data, _ = build._read_jsonc('{"n": "fix [1,2,] and {b, }"}')
        self.assertEqual(data["n"], "fix [1,2,] and {b, }")
        # ...while genuine structural trailing commas are still removed.
        self.assertEqual(build._read_jsonc("[1,2,]")[0], [1, 2])
        self.assertEqual(build._read_jsonc('{"a":1,}')[0], {"a": 1})

    def test_read_jsonc_malformed_returns_none(self):
        # None (unparseable) is distinct from {} (legitimately empty): writers
        # refuse to rewrite a malformed file instead of clobbering it.
        data, had = build._read_jsonc("{not json at all")
        self.assertIsNone(data)
        self.assertFalse(had)

    def test_target_prefers_existing_jsonc(self):
        d = Path(tempfile.mkdtemp())
        try:
            j = d / "opencode.json"
            jc = d / "opencode.jsonc"
            self.assertEqual(build._opencode_target(j), j)      # neither exists -> .json
            jc.write_text("{}", encoding="utf-8")
            self.assertEqual(build._opencode_target(j), jc)     # .jsonc present -> .jsonc
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_merge_targets_existing_jsonc_without_comments(self):
        d = Path(tempfile.mkdtemp())
        try:
            j = d / "opencode.json"
            jc = d / "opencode.jsonc"
            jc.write_text('{"instructions": []}', encoding="utf-8")
            out = self._merge(j)
            self.assertEqual(out, "")                           # no warning
            self.assertFalse(j.exists())                        # never creates the .json
            data = json.loads(jc.read_text(encoding="utf-8"))
            self.assertIn("AGENT.md", data["instructions"])
            self.assertIn("permission", data)
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_merge_warns_and_skips_commented_jsonc(self):
        d = Path(tempfile.mkdtemp())
        try:
            j = d / "opencode.json"
            jc = d / "opencode.jsonc"
            original = '// my notes\n{\n  "instructions": []\n}\n'
            jc.write_text(original, encoding="utf-8")
            out = self._merge(j)
            self.assertIn("has comments", out)
            self.assertIn("AGENT.md", out)                      # the manual entry is shown
            self.assertEqual(jc.read_text(encoding="utf-8"), original)  # byte-for-byte unchanged
            self.assertFalse(j.exists())                        # no stray .json written
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_merge_commented_jsonc_already_wired_is_silent_noop(self):
        d = Path(tempfile.mkdtemp())
        try:
            j = d / "opencode.json"
            jc = d / "opencode.jsonc"
            original = ('// notes\n{\n  "instructions": ["AGENT.md"],\n'
                        '  "permission": {"bash": "allow"},\n  "lsp": true\n}\n')
            jc.write_text(original, encoding="utf-8")
            out = self._merge(j)
            self.assertEqual(out, "")                           # nothing to add -> no warning
            self.assertEqual(jc.read_text(encoding="utf-8"), original)  # untouched
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_merge_returns_resolved_target(self):
        d = Path(tempfile.mkdtemp())
        try:
            j = d / "opencode.json"
            (d / "opencode.jsonc").write_text('{"instructions": []}', encoding="utf-8")
            self.assertEqual(build._merge_opencode_json(j, "AGENT.md").name, "opencode.jsonc")
        finally:
            shutil.rmtree(d, ignore_errors=True)


class OpencodeJsonMergeFailureTests(unittest.TestCase):
    """The opencode.json merge is best-effort but must never be SILENT about it: a read
    or write failure (permissions, a locked file) must print a loud `[geneseed] WARN`
    naming the path and reason, and must never crash the emit or silently overwrite a
    file it couldn't even read. Simulated with unittest.mock (chmod-based permission
    denial isn't reliable cross-platform, notably on Windows)."""

    def test_read_failure_warns_and_does_not_overwrite(self):
        import contextlib
        import io
        from unittest import mock

        d = Path(tempfile.mkdtemp())
        try:
            cfg = d / "opencode.json"
            original = '{"instructions": ["keep-me.md"]}'
            cfg.write_text(original, encoding="utf-8")
            real_read_text = Path.read_text

            def _boom(self, *a, **kw):
                if self == cfg:
                    raise OSError("Permission denied")
                return real_read_text(self, *a, **kw)

            err = io.StringIO()
            with mock.patch.object(Path, "read_text", _boom), \
                 contextlib.redirect_stderr(err):
                build._merge_opencode_json(cfg, "AGENT.md")
            self.assertIn("WARN", err.getvalue())
            self.assertIn(str(cfg), err.getvalue())
            self.assertIn("Permission denied", err.getvalue())
            # Never overwritten — the original content survives byte-for-byte.
            self.assertEqual(cfg.read_text(encoding="utf-8"), original)
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_write_failure_warns_and_does_not_crash(self):
        import contextlib
        import io
        from unittest import mock

        d = Path(tempfile.mkdtemp())
        try:
            cfg = d / "opencode.json"

            def _boom(src, dst):
                raise OSError("Permission denied")

            err = io.StringIO()
            with mock.patch.object(build.os, "replace", _boom), \
                 contextlib.redirect_stderr(err):
                result = build._merge_opencode_json(cfg, "AGENT.md")  # must not raise
            self.assertEqual(result, cfg)
            self.assertIn("WARN", err.getvalue())
            self.assertIn(str(cfg), err.getvalue())
            self.assertIn("Permission denied", err.getvalue())
            self.assertIn("AGENT.md", err.getvalue())  # manual-wiring instructions shown
        finally:
            shutil.rmtree(d, ignore_errors=True)


class SyncThemesTests(unittest.TestCase):
    """build.sync_themes(): the maintainer assist for the theme-parity gate. Redirects
    build.THEMES to a temp dir per test (mirrors test_harness.ThemeParityTests) so the
    real themes/ tree is never touched."""

    def _with_temp_themes(self, files: dict):
        tmp = Path(tempfile.mkdtemp())
        orig = build.THEMES
        try:
            for name, text in files.items():
                (tmp / name).write_text(text, encoding="utf-8")
            build.THEMES = tmp
            import contextlib
            import io
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                changed = build.sync_themes()
            after = {p.name: json.loads(p.read_text(encoding="utf-8"))
                     for p in tmp.glob("*.json")}
            return changed, out.getvalue(), after
        finally:
            build.THEMES = orig
            shutil.rmtree(tmp, ignore_errors=True)

    def test_fills_missing_key_from_template(self):
        tmpl = {"A": "<a>", "B": "<b>", "C": "<c>"}
        theme = {"A": "hello", "C": "world"}   # missing B
        changed, report, after = self._with_temp_themes({
            "_TEMPLATE.json": json.dumps(tmpl),
            "mytheme.json": json.dumps(theme),
        })
        self.assertEqual(changed, 1)
        self.assertEqual(after["mytheme.json"], {"A": "hello", "B": "<b>", "C": "world"})
        # Template order preserved.
        self.assertEqual(list(after["mytheme.json"].keys()), ["A", "B", "C"])
        self.assertIn("mytheme.json", report)
        self.assertIn("added 1 key", report)
        self.assertIn("B", report)
        self.assertIn("RESTYLE", report)

    def test_reports_extra_key_without_removing_it(self):
        tmpl = {"A": "<a>"}
        theme = {"A": "hello", "ZZZ": "keep-me"}   # ZZZ not in template
        changed, report, after = self._with_temp_themes({
            "_TEMPLATE.json": json.dumps(tmpl),
            "mytheme.json": json.dumps(theme),
        })
        # No missing key, so the file is untouched, but the extra key is reported.
        self.assertEqual(changed, 0)
        self.assertEqual(after["mytheme.json"], theme)
        self.assertIn("ZZZ", report)
        self.assertIn("not removed", report)

    def test_extra_key_reported_and_kept_when_also_syncing_a_missing_one(self):
        tmpl = {"A": "<a>", "B": "<b>"}
        theme = {"A": "hello", "ZZZ": "keep-me"}   # missing B, plus an extra key
        changed, report, after = self._with_temp_themes({
            "_TEMPLATE.json": json.dumps(tmpl),
            "mytheme.json": json.dumps(theme),
        })
        self.assertEqual(changed, 1)
        self.assertEqual(after["mytheme.json"]["B"], "<b>")
        self.assertEqual(after["mytheme.json"]["ZZZ"], "keep-me")   # preserved, not dropped
        self.assertIn("not removed", report)
        self.assertIn("ZZZ", report)

    def test_already_in_sync_reports_nothing_changed(self):
        tmpl = {"A": "<a>"}
        changed, report, _after = self._with_temp_themes({
            "_TEMPLATE.json": json.dumps(tmpl),
            "mytheme.json": json.dumps({"A": "hello"}),
        })
        self.assertEqual(changed, 0)
        self.assertIn("already carry every template key", report)

    def test_one_key_sync_is_a_minimal_textual_diff(self):
        """A one-key sync against a conventionally-formatted (indent-2) theme must be
        a surgical insertion: untouched lines stay byte-identical — raw Unicode stays
        raw, legacy \\uXXXX escapes stay escaped — with only the new line added and at
        most a comma on its predecessor. This is the churn guarantee: re-dumping the
        whole file rewrote ~170 lines per theme for a single added key."""
        tmp = Path(tempfile.mkdtemp())
        orig = build.THEMES
        try:
            (tmp / "_TEMPLATE.json").write_text(
                '{\n  "A": "<a>",\n  "B": "<b>",\n  "C": "<c>"\n}\n', encoding="utf-8")
            # Raw em dash AND a legacy é escape — a json.dumps round-trip cannot
            # preserve both, so byte-identity here proves the edit is textual.
            before = '{\n  "A": "hello — caf\\u00e9",\n  "C": "world"\n}\n'
            (tmp / "mytheme.json").write_text(before, encoding="utf-8")
            build.THEMES = tmp
            import contextlib
            import io
            with contextlib.redirect_stdout(io.StringIO()):
                changed = build.sync_themes()
            after = (tmp / "mytheme.json").read_text(encoding="utf-8")
        finally:
            build.THEMES = orig
            shutil.rmtree(tmp, ignore_errors=True)
        self.assertEqual(changed, 1)
        self.assertEqual(
            after,
            '{\n  "A": "hello — caf\\u00e9",\n  "B": "<b>",\n  "C": "world"\n}\n')

    def test_noop_leaves_file_bytes_untouched(self):
        """An in-sync theme must not be rewritten AT ALL — same bytes, even when the
        formatting could not survive a dumps round-trip (mixed raw/escaped Unicode)."""
        tmp = Path(tempfile.mkdtemp())
        orig = build.THEMES
        try:
            (tmp / "_TEMPLATE.json").write_text('{\n  "A": "<a>"\n}\n', encoding="utf-8")
            before = '{\n  "A": "caf\\u00e9 — raw"\n}\n'
            (tmp / "mytheme.json").write_text(before, encoding="utf-8")
            build.THEMES = tmp
            import contextlib
            import io
            with contextlib.redirect_stdout(io.StringIO()):
                changed = build.sync_themes()
            after = (tmp / "mytheme.json").read_text(encoding="utf-8")
        finally:
            build.THEMES = orig
            shutil.rmtree(tmp, ignore_errors=True)
        self.assertEqual(changed, 0)
        self.assertEqual(after, before)

    def test_cli_exits_nonzero_when_changed_zero_when_in_sync(self):
        """`build.py --sync-themes` maps the changed count to the exit code so CI can
        use it as a drift check: 1 when files were filled, 0 on a no-op."""
        import contextlib
        import io
        from unittest import mock

        tmp = Path(tempfile.mkdtemp())
        orig = build.THEMES
        try:
            (tmp / "_TEMPLATE.json").write_text('{\n  "A": "<a>",\n  "B": "<b>"\n}\n',
                                                encoding="utf-8")
            (tmp / "mytheme.json").write_text('{\n  "A": "hello"\n}\n', encoding="utf-8")
            build.THEMES = tmp
            argv = ["build.py", "--sync-themes"]
            with mock.patch.object(sys, "argv", argv), \
                 contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(SystemExit) as ctx:
                    build.main()
                self.assertEqual(ctx.exception.code, 1)   # changed a file -> red
                with self.assertRaises(SystemExit) as ctx:
                    build.main()                           # second run: already in sync
                self.assertEqual(ctx.exception.code, 0)
        finally:
            build.THEMES = orig
            shutil.rmtree(tmp, ignore_errors=True)

    def test_sync_makes_shipped_themes_parity_clean(self):
        """A theme with a genuinely missing key, once synced, must stop tripping the
        real parity gate (integration check between Task 5 and the Task-5-adjacent
        parity gate the task doc points at)."""
        good = json.loads((build.THEMES / "neutral.json").read_text(encoding="utf-8"))
        broken = dict(good)
        broken.pop("VOICE")
        tmp = Path(tempfile.mkdtemp())
        orig_themes = build.THEMES
        try:
            (tmp / "_TEMPLATE.json").write_text(
                json.dumps(json.loads((orig_themes / "_TEMPLATE.json").read_text(encoding="utf-8"))),
                encoding="utf-8")
            (tmp / "neutral.json").write_text(json.dumps(good), encoding="utf-8")
            (tmp / "broken.json").write_text(json.dumps(broken), encoding="utf-8")
            build.THEMES = tmp
            import contextlib
            import io
            with contextlib.redirect_stdout(io.StringIO()):
                build.sync_themes()
            after = json.loads((tmp / "broken.json").read_text(encoding="utf-8"))
            self.assertIn("VOICE", after)
        finally:
            build.THEMES = orig_themes
            shutil.rmtree(tmp, ignore_errors=True)


class DescBlockTests(unittest.TestCase):
    """build._desc_block_problem: the first-block-is-a-blockquote shape check that
    protects desc_of()/_first_blockquote() from silently picking up the wrong line."""

    def test_clean_shape_is_no_problem(self):
        text = "# {{SKILL}}: foo\n\n> One-line purpose.\n\n## Procedure\n1. Step.\n"
        self.assertEqual(build._desc_block_problem(text), "")

    def test_html_comment_before_title_is_stripped_first(self):
        text = "<!--\n  authoring notes\n-->\n# {{SKILL}}: foo\n\n> Purpose.\n"
        self.assertEqual(build._desc_block_problem(text), "")

    def test_prose_before_blockquote_is_flagged(self):
        # The first block after the title is plain prose, not a blockquote — a later
        # '>' line would still satisfy _first_blockquote's naive scan and silently
        # become the description.
        text = ("# {{SKILL}}: foo\n\nSome introductory prose that is NOT the "
                "description.\n\n> {{DESC_FOO}}\n")
        problem = build._desc_block_problem(text)
        self.assertNotEqual(problem, "")
        self.assertIn("not a '>' blockquote", problem)

    def test_missing_title_is_flagged(self):
        text = "> Purpose without a title above it.\n"
        problem = build._desc_block_problem(text)
        self.assertIn("not a title", problem)

    def test_title_with_nothing_after_is_flagged(self):
        text = "# {{SKILL}}: foo\n"
        problem = build._desc_block_problem(text)
        self.assertIn("no purpose blockquote", problem)

    def test_empty_blockquote_is_flagged(self):
        text = "# {{SKILL}}: foo\n\n>\n"
        problem = build._desc_block_problem(text)
        self.assertIn("empty", problem)

    def test_empty_file_is_flagged(self):
        self.assertIn("empty", build._desc_block_problem(""))

    def test_real_specs_all_pass(self):
        for folder in ("agents", "skills"):
            d = build.SRC / folder
            for spec in sorted(d.glob("*.md")):
                if spec.name.startswith("_"):
                    continue
                with self.subTest(spec=str(spec)):
                    text = spec.read_text(encoding="utf-8")
                    self.assertEqual(build._desc_block_problem(text), "")


class ValidateOnlyTests(unittest.TestCase):
    """build.py --validate-only: render + emit into a throwaway sandbox, run doctor-
    grade checks, write nothing real. Driven as a real subprocess (mirrors how
    build.py is normally invoked) so the exit code and "nothing written" guarantee are
    checked exactly as a user would see them, not just at the Python-API level."""

    def _run(self, *extra_args):
        return subprocess.run(
            [sys.executable, str(ROOT / "build.py"), "--validate-only", *extra_args],
            cwd=ROOT, capture_output=True, text=True, encoding="utf-8", timeout=120)

    def test_clean_theme_exits_zero_and_writes_nothing(self):
        target = Path(tempfile.mkdtemp()) / "Harness"
        try:
            self.assertFalse(target.exists())
            r = self._run("--theme", "neutral", "--emit", "files", "--out", str(target))
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            self.assertIn("would write", r.stdout)
            self.assertIn("ok", r.stdout)
            # The whole point: --out was never created.
            self.assertFalse(target.exists(), "--validate-only must not write --out")
        finally:
            shutil.rmtree(target.parent, ignore_errors=True)

    def test_does_not_touch_an_existing_out_dir(self):
        """Even when --out already exists (a real prior bundle), --validate-only must
        leave its mtime/contents untouched — not just "absent stays absent"."""
        target = Path(tempfile.mkdtemp()) / "Harness"
        try:
            build.build("neutral", target)
            marker = target / "AGENT.md"
            before_mtime = marker.stat().st_mtime_ns
            before_text = marker.read_text(encoding="utf-8")
            r = self._run("--theme", "imperial", "--emit", "files", "--out", str(target))
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
            self.assertEqual(marker.stat().st_mtime_ns, before_mtime)
            self.assertEqual(marker.read_text(encoding="utf-8"), before_text)
        finally:
            shutil.rmtree(target.parent, ignore_errors=True)

    def test_unknown_theme_exits_nonzero(self):
        r = self._run("--theme", "not-a-real-theme", "--emit", "files")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("unknown theme", r.stdout + r.stderr)

    def test_verbose_lists_paths_quiet_mode_lists_counts_only(self):
        quiet = self._run("--theme", "neutral", "--emit", "files")
        verbose = self._run("--theme", "neutral", "--emit", "files", "-v")
        self.assertEqual(quiet.returncode, 0, quiet.stdout + quiet.stderr)
        self.assertEqual(verbose.returncode, 0, verbose.stdout + verbose.stderr)
        self.assertNotIn("would write:", quiet.stdout)   # per-file line prefix
        self.assertIn("would write:", verbose.stdout)
        self.assertIn("AGENT.md", verbose.stdout)

    def test_induced_target_scan_failure_exits_nonzero(self):
        """A dead/non-hermetic link or unresolved token in the SANDBOXED render output
        must fail --validate-only via its own target-scan (_validate_sandbox_problems),
        independent of the doctor subprocess. Exercised in-process against
        build._validate_sandbox_problems directly — the unit under test that
        --validate-only's target-specific half relies on."""
        tmp = Path(tempfile.mkdtemp())
        try:
            (tmp / "AGENT.md").write_text(
                "unresolved {{NOT_A_REAL_TOKEN}} and a [dead link](missing/file.md)\n",
                encoding="utf-8")
            problems = build._validate_sandbox_problems(tmp)
            self.assertTrue(any("unresolved token" in p for p in problems), problems)
            self.assertTrue(any("dead link" in p for p in problems), problems)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_validate_only_calls_doctor_and_relays_its_verdict(self):
        """--validate-only's source-tree half is a `harness.py doctor` subprocess (see
        build._validate_only) — confirm it actually runs and its ok/problem verdict
        line is relayed into --validate-only's own output, proving the two are wired
        together rather than the doctor call being silently swallowed."""
        args = argparse.Namespace(theme="neutral", emit="files", out="Harness", root=None,
                                  footprint="full", verbose=False)
        import contextlib
        import io
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            rc = build._validate_only(args)
        report = out.getvalue()
        self.assertEqual(rc, 0, report)
        self.assertIn("[doctor]", report)
        self.assertIn("ok", report)

    def test_root_split_counts_and_scans_the_native_layer(self):
        """With a distinct --root, the per-repo opencode emit splits its output: the
        bundle under out, the native layer (.opencode/, opencode.json) under root. The
        sandbox count/scan must cover BOTH dirs — before the fix, the native layer was
        neither counted nor validated (86 vs 191 files)."""
        import contextlib
        import io
        import re as _re

        # Ground truth: a real split emit (bundle nested inside root, mirroring the
        # documented `--out myrepo/Harness --root myrepo` usage), counted directly.
        tmp = Path(tempfile.mkdtemp())
        try:
            root_dir = tmp / "root"
            out_dir = root_dir / "bundle"
            with contextlib.redirect_stdout(io.StringIO()):
                build.emit_opencode("neutral", out_dir, root_dir, "full")
            expected = sum(1 for p in root_dir.rglob("*") if p.is_file())
            n_native = sum(1 for p in root_dir.rglob("*") if p.is_file()
                           and not str(p).startswith(str(out_dir)))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        self.assertGreater(n_native, 0)   # the split emit really writes outside the bundle

        args = argparse.Namespace(theme="neutral", emit="opencode", out="ignored-out",
                                  root="ignored-root", footprint="full", verbose=False)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            build._validate_only(args)
        m = _re.search(r"would write (\d+) file", buf.getvalue())
        self.assertIsNotNone(m, buf.getvalue())
        self.assertEqual(int(m.group(1)), expected)

    @unittest.skipUnless(sys.platform == "win32", "8.3 short paths are a Windows-only concept")
    def test_hermeticity_scan_survives_short_form_8dot3_sandbox_root(self):
        """Windows CI runners can hand back a TemporaryDirectory whose path resolves
        through an 8.3 short name (e.g. `C:\\Users\\RUNNER~1\\...`), while
        _validate_sandbox_problems resolves each link's TARGET via `.resolve()` (long
        form). Comparing an unresolved short-form sandbox root against a resolved
        long-form target in `_within` made relative_to fail for EVERY relative link,
        not just genuinely escaping ones — this is what surfaced in CI as spurious
        'non-hermetic link ... escapes the bundle' reports for links that plainly sit
        inside the same directory (e.g. skills/workflow.md -> council.md). Reproduce
        deterministically via GetShortPathNameW and assert a same-dir link is clean."""
        import ctypes

        tmp = Path(tempfile.mkdtemp())
        try:
            buf = ctypes.create_unicode_buffer(260)
            n = ctypes.windll.kernel32.GetShortPathNameW(str(tmp), buf, len(buf))
            if not n:
                self.skipTest("GetShortPathNameW failed — short names may be disabled on this volume")
            short_tmp = Path(buf.value)
            if str(short_tmp) == str(tmp):
                self.skipTest("no distinct 8.3 short name available for this path")

            (tmp / "workflow.md").write_text(
                "see [council](council.md)\n", encoding="utf-8")
            (tmp / "council.md").write_text("# council\n", encoding="utf-8")

            problems = build._validate_sandbox_problems(short_tmp)
            self.assertEqual(problems, [], problems)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    def test_validate_is_vendored_handles_nested_host_layouts(self):
        """_validate_is_vendored must exempt vendored skill folders wherever the
        `skills` segment sits: flat bundle root (files/opencode-global) AND the
        one-level-deeper per-repo native layers (.opencode/.claude/.bob/.github)."""
        vendored = build.VENDORED_SKILL_DIRS[0]   # e.g. 'react-view-transitions'
        for rel, want in [
            (Path(f"skills/{vendored}/README.md"), True),
            (Path(f".opencode/skills/{vendored}/SKILL.md"), True),
            (Path(f".claude/skills/{vendored}/SKILL.md"), True),
            (Path(f".bob/skills/{vendored}/nested/deep.md"), True),
            (Path(f".github/skills/{vendored}/SKILL.md"), True),
            (Path("skills/commit.md"), False),                    # flat skill, not vendored
            (Path(".claude/skills/council/SKILL.md"), False),     # native, not vendored
            (Path(f"{vendored}/loose.md"), False),                # vendored name w/o skills/
            (Path(f"docs/{vendored}/note.md"), False),
        ]:
            with self.subTest(rel=str(rel)):
                self.assertIs(build._validate_is_vendored(rel), want)


if __name__ == "__main__":
    unittest.main()
