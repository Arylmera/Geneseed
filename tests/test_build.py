"""Unit tests for the Geneseed generator (build.py). Stdlib unittest only — no deps.

Run from the Geneseed root:  python -m unittest discover -s tests
"""
import json
import shutil
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
                if text is not None:
                    self.assertNotIn("{{", text, f"unresolved token in {rel} ({theme})")

    def test_include_directive_is_inlined(self):
        # AGENT.md.tmpl includes laws/universal.md; proof the INCLUDE engine ran.
        _t, items = build.render_all("neutral")
        agent = next(t for r, t, _ in items if r == "AGENT.md")
        self.assertIn("Sealed Secrets", agent)


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
            tester = (d / "agents" / "tester.md").read_text(encoding="utf-8")
            # read-only agents get a permission block denying edit + webfetch
            self.assertIn("permission:", reviewer)
            self.assertIn("edit: deny", reviewer)
            self.assertIn("webfetch: deny", reviewer)
            # reviewer runs tests -> bash gated to ask; explorer -> bash denied
            self.assertIn('"*": ask', reviewer)
            self.assertIn("bash: deny", explorer)
            self.assertNotIn('"*": ask', explorer)
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

    def test_read_jsonc_malformed_returns_empty(self):
        data, had = build._read_jsonc("{not json at all")
        self.assertEqual(data, {})
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
                        '  "permission": {"bash": "allow"}\n}\n')
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


if __name__ == "__main__":
    unittest.main()
