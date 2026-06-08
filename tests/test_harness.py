"""Unit tests for the Geneseed CLI (rituals/harness.py). Stdlib unittest only.

Run from the Geneseed root:  python -m unittest discover -s tests
"""
import json
import re
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "rituals"))
sys.path.insert(0, str(ROOT))
import build  # noqa: E402
import harness  # noqa: E402


class PromptParityTests(unittest.TestCase):
    """The distil prompt has ONE source: the OpenCode plugin's literal. harness.py
    extracts it — this test fails the moment the two drift."""

    def test_extracted_head_matches_plugin_literal(self):
        js = (build.PLUGIN_SRC / "geneseed-learn.js").read_text(encoding="utf-8")
        m = re.search(r"const LEARN_PROMPT_HEAD = `([\s\S]*?)`", js)
        self.assertIsNotNone(m, "could not find LEARN_PROMPT_HEAD literal in plugin")
        self.assertEqual(harness.LEARN_PROMPT_HEAD, m.group(1))

    def test_head_is_substantive(self):
        self.assertIn("NOTHING", harness.LEARN_PROMPT_HEAD)
        self.assertGreater(len(harness.LEARN_PROMPT_HEAD), 200)


class FrontmatterTests(unittest.TestCase):
    def test_parse_name_and_description(self):
        fm, body = harness._frontmatter(
            "---\nname: foo\ndescription: bar\n---\nthe body"
        )
        self.assertEqual(fm["name"], "foo")
        self.assertEqual(fm["description"], "bar")
        self.assertIn("the body", body)

    def test_no_frontmatter_returns_whole_body(self):
        fm, body = harness._frontmatter("just text, no fm")
        self.assertEqual(fm, {})
        self.assertEqual(body, "just text, no fm")


class WriteMemoriesTests(unittest.TestCase):
    def test_writes_new_skips_existing_and_indexes(self):
        d = Path(tempfile.mkdtemp())
        try:
            out = (
                "---\nname: new-fact\ndescription: a desc\n---\nthe fact\n"
                "---FILE---\n---\nname: dup\ndescription: x\n---\nbody"
            )
            written = harness._write_memories(out, d, {"dup"})
            self.assertEqual(written, ["new-fact"])
            self.assertTrue((d / "new-fact.md").is_file())
            self.assertFalse((d / "dup.md").exists())
            idx = (d / "MEMORY.md").read_text(encoding="utf-8")
            self.assertIn("new-fact", idx)
            self.assertIn("a desc", idx)
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_nothing_writes_no_files(self):
        d = Path(tempfile.mkdtemp())
        try:
            self.assertEqual(harness._write_memories("NOTHING", d, set()), [])
            self.assertFalse((d / "MEMORY.md").exists())
        finally:
            shutil.rmtree(d, ignore_errors=True)


class ExistingSlugsTests(unittest.TestCase):
    def test_skips_index_and_readme(self):
        d = Path(tempfile.mkdtemp())
        try:
            for nm in ("README.md", "MEMORY.md", "real.md"):
                (d / nm).write_text("x", encoding="utf-8")
            self.assertEqual(harness._existing_slugs(d), {"real"})
        finally:
            shutil.rmtree(d, ignore_errors=True)


class ReadNotesTests(unittest.TestCase):
    def test_raw_text_passthrough(self):
        self.assertEqual(harness._read_notes("plain notes"), "plain notes")

    def test_json_without_transcript_path_returns_raw(self):
        self.assertEqual(harness._read_notes('{"foo": 1}'), '{"foo": 1}')


class ThemeParityTests(unittest.TestCase):
    def test_shipped_themes_are_in_parity(self):
        self.assertEqual(harness._theme_parity_problems(), [])


class ThemeDetectionTests(unittest.TestCase):
    AVAIL = ["cyberpunk", "gamer", "imperial", "military", "neutral",
             "pirate", "sports", "wizard"]

    def test_marker_wins(self):
        d = Path(tempfile.mkdtemp())
        try:
            (d / ".geneseed-theme").write_text("imperial\n", encoding="utf-8")
            self.assertEqual(harness._theme_of_dir(d), "imperial")
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_falls_back_to_sigil(self):
        d = Path(tempfile.mkdtemp())
        try:
            build.build("imperial", d)
            (d / ".geneseed-theme").unlink()        # force the sigil path
            self.assertEqual(harness._theme_of_dir(d), "imperial")
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_none_when_undetectable(self):
        d = Path(tempfile.mkdtemp())
        try:
            self.assertIsNone(harness._theme_of_dir(d))
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_explicit_theme_wins(self):
        self.assertEqual(
            harness._themes_to_check("pirate", False, "imperial", self.AVAIL),
            ["pirate"])

    def test_scopes_to_detected(self):
        self.assertEqual(
            harness._themes_to_check(None, False, "imperial", self.AVAIL),
            ["imperial"])

    def test_all_sweeps_every_theme(self):
        self.assertEqual(
            harness._themes_to_check(None, True, "imperial", self.AVAIL),
            sorted(self.AVAIL))

    def test_sweeps_when_detected_is_unknown_or_absent(self):
        # nothing installed (fresh clone) -> full sweep
        self.assertEqual(
            harness._themes_to_check(None, False, None, self.AVAIL),
            sorted(self.AVAIL))
        # a detected name not among available themes -> full sweep, not a dead theme
        self.assertEqual(
            harness._themes_to_check(None, False, "ghost", self.AVAIL),
            sorted(self.AVAIL))


class ResolveMemoryDirTests(unittest.TestCase):
    def test_falls_back_to_geneseed_harness_store(self):
        """A global install's store lives in $GENESEED_HARNESS/memory, not beside the
        repo — the resolver must find it from an unrelated cwd."""
        import os
        store = Path(tempfile.mkdtemp())
        (store / "memory").mkdir()
        work = Path(tempfile.mkdtemp())          # a cwd with no memory/ of its own
        old_cwd = Path.cwd()
        saved = {k: os.environ.get(k) for k in ("GENESEED_HARNESS", "GENESEED_MEMORY")}
        try:
            os.chdir(work)
            os.environ.pop("GENESEED_MEMORY", None)
            os.environ["GENESEED_HARNESS"] = str(store)
            self.assertEqual(harness._resolve_memory_dir(None), store / "memory")
        finally:
            os.chdir(old_cwd)
            for k, v in saved.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
            shutil.rmtree(store, ignore_errors=True)
            shutil.rmtree(work, ignore_errors=True)


class GlobalEmitDoctorTests(unittest.TestCase):
    def test_global_emit_is_link_clean(self):
        """The opencode-global AGENT.md/agents/skills/memory must carry no unresolved
        tokens, dead links, or non-hermetic escapes — memory links are relative and
        co-located with AGENT.md, so nothing should point outside the bundle."""
        for theme in ("neutral", "imperial"):
            with self.subTest(theme=theme):
                self.assertEqual(harness._global_emit_problems(theme), [])


class SkillBodyDelinkTests(unittest.TestCase):
    REL_MD = re.compile(r"\]\((?!https?://)[^)\s]*\.md")

    def test_pure_strips_relative_md_links_keeps_urls(self):
        s = ("run [verify](verify.md) if unsure; via the [refactor Skill](refactor.md);\n"
             "dispatch the [reviewer Agent](../agents/reviewer.md); copy "
             "[`_template.md`](_template.md); see [docs](https://example.com/x.md).")
        out = build._strip_skill_body_links(s)
        self.assertIn("run verify if unsure", out)
        self.assertIn("the refactor Skill", out)
        self.assertIn("the reviewer Agent", out)
        self.assertIn("copy `_template.md`", out)
        self.assertNotRegex(out, self.REL_MD)                 # no relative .md links
        self.assertIn("[docs](https://example.com/x.md)", out)  # external URL kept

    def test_native_skill_body_delinked_portable_kept(self):
        import contextlib, io
        d = Path(tempfile.mkdtemp())
        cfg = Path(tempfile.mkdtemp()) / "cfg"
        try:
            build.build("neutral", d)
            # portable bundle keeps the in-body link
            self.assertRegex((d / "skills" / "ship.md").read_text(encoding="utf-8"), self.REL_MD)
            with contextlib.redirect_stdout(io.StringIO()):
                build.emit_opencode_global("neutral", out=Path(tempfile.mkdtemp()) / "b", cfg=cfg)
            # native skill is plain text
            native = (cfg / "skills" / "ship" / "SKILL.md").read_text(encoding="utf-8")
            self.assertNotRegex(native, self.REL_MD)
            self.assertIn("verify", native)
        finally:
            shutil.rmtree(d, ignore_errors=True)
            shutil.rmtree(cfg.parent, ignore_errors=True)


class CapabilityLinkStripTests(unittest.TestCase):
    PER_ROW = re.compile(r"\]\((?:agents|skills)/[A-Za-z0-9_-]+\.md\)")

    def test_pure_strips_per_row_keeps_folder_and_memory(self):
        s = ("| [reviewer](agents/reviewer.md) | when ready |\n"
             "| [brainstorm](skills/brainstorm.md) | new design |\n"
             "Specs live in [`agents/`](agents/) and [`skills/`](skills/).\n"
             "Facts live in [`memory/`](memory/).")
        out = build._strip_capability_links(s)
        self.assertIn("| reviewer | when ready |", out)
        self.assertIn("| brainstorm | new design |", out)
        self.assertNotRegex(out, self.PER_ROW)        # per-row spec links gone
        self.assertIn("](agents/)", out)              # folder pointers kept
        self.assertIn("](skills/)", out)
        self.assertIn("](memory/)", out)              # memory links untouched

    def test_files_emit_keeps_links_global_strips_them(self):
        import contextlib, io
        d = Path(tempfile.mkdtemp())
        cfg = Path(tempfile.mkdtemp()) / "cfg"
        try:
            build.build("neutral", d)
            self.assertRegex((d / "AGENT.md").read_text(encoding="utf-8"), self.PER_ROW)
            with contextlib.redirect_stdout(io.StringIO()):
                build.emit_opencode_global("neutral", out=Path(tempfile.mkdtemp()) / "b", cfg=cfg)
            self.assertNotRegex((cfg / "AGENT.md").read_text(encoding="utf-8"), self.PER_ROW)
        finally:
            shutil.rmtree(d, ignore_errors=True)
            shutil.rmtree(cfg.parent, ignore_errors=True)


class VersionTests(unittest.TestCase):
    def test_fingerprint_deterministic_and_short(self):
        fp = build.source_fingerprint()
        self.assertEqual(fp, build.source_fingerprint())   # stable across calls
        self.assertRegex(fp, r"^[0-9a-f]{12}$")

    def test_write_then_read_roundtrip(self):
        d = Path(tempfile.mkdtemp())
        try:
            fp = build.write_version(d)
            self.assertEqual(build.read_version(d), fp)
            self.assertIn("built", (d / build.VERSION_MARKER).read_text(encoding="utf-8"))
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_read_version_absent_is_none(self):
        self.assertIsNone(build.read_version(Path(tempfile.mkdtemp())))

    def test_verdict(self):
        self.assertIn("no Geneseed install", harness._version_verdict(None, "abc"))
        self.assertIn("up to date", harness._version_verdict("abc", "abc"))
        self.assertIn("differs", harness._version_verdict("old", "new"))


class StatusDataTests(unittest.TestCase):
    def test_reports_counts_version_and_keys(self):
        d = harness._status_data()
        # counts match the rendered inventory
        self.assertEqual(d["agents"], 16)
        self.assertEqual(d["skills"], 20)
        self.assertEqual(d["laws"], 20)
        # version fields present and well-formed
        self.assertRegex(d["source_fp"], r"^[0-9a-f]{12}$")
        self.assertIsInstance(d["version_verdict"], str)
        self.assertTrue(d["version_verdict"])
        # the structural keys the command/TUI rely on are all present
        for k in ("theme", "accent", "emit", "memory_dir", "facts",
                  "installed_fp", "agent_md", "agent_md_present"):
            self.assertIn(k, d)


class StatusRenderTests(unittest.TestCase):
    def test_framed_box_is_uniform_width_and_complete(self):
        lines = harness._status_lines(harness._status_data(), color=False)
        self.assertGreaterEqual(len(lines), 7)
        self.assertEqual(len({len(ln) for ln in lines}), 1)   # every line same width (no ANSI)
        self.assertIn(lines[0][0], "┌+")                       # top frame
        self.assertIn(lines[-1][0], "└+")                      # bottom frame
        blob = "\n".join(lines)
        for token in ("Geneseed", "theme", "components", "version", "source"):
            self.assertIn(token, blob)

    def test_color_adds_ansi_without_changing_line_count(self):
        d = harness._status_data()
        plain = harness._status_lines(d, color=False)
        colored = harness._status_lines(d, color=True)
        self.assertEqual(len(plain), len(colored))
        self.assertNotIn("\x1b[", "".join(plain))
        self.assertIn("\x1b[", "".join(colored))


class UninstallTests(unittest.TestCase):
    def test_global_uninstall_removes_owned_keeps_memory(self):
        import contextlib, io
        cfg = Path(tempfile.mkdtemp()) / "cfg"
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                build.emit_opencode_global("neutral", out=Path(tempfile.mkdtemp()) / "b", cfg=cfg)
            # sanity: a real install exists
            self.assertTrue((cfg / "AGENT.md").is_file())
            self.assertTrue((cfg / "skills" / "ship" / "SKILL.md").is_file())
            self.assertTrue((cfg / "memory").is_dir())
            instr = json.loads((cfg / "opencode.json").read_text(encoding="utf-8"))["instructions"]
            self.assertIn((cfg / "AGENT.md").as_posix(), instr)

            summary = harness._uninstall_global(cfg, archive_memory=False)

            self.assertFalse((cfg / "AGENT.md").exists())
            self.assertFalse((cfg / "skills").exists())
            self.assertFalse((cfg / "agents").exists())
            self.assertFalse((cfg / build.GLOBAL_MANIFEST).exists())
            self.assertFalse((cfg / build.VERSION_MARKER).exists())
            self.assertTrue((cfg / "memory").is_dir())          # memory kept
            self.assertTrue(summary["unmerged"])
            instr2 = json.loads((cfg / "opencode.json").read_text(encoding="utf-8"))["instructions"]
            self.assertNotIn((cfg / "AGENT.md").as_posix(), instr2)
        finally:
            shutil.rmtree(cfg.parent, ignore_errors=True)

    def test_archive_memory_moves_store_never_deletes(self):
        import contextlib, io
        cfg = Path(tempfile.mkdtemp()) / "cfg"
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                build.emit_opencode_global("neutral", out=Path(tempfile.mkdtemp()) / "b", cfg=cfg)
            (cfg / "memory" / "fact.md").write_text("a learned fact", encoding="utf-8")
            summary = harness._uninstall_global(cfg, archive_memory=True)
            self.assertFalse((cfg / "memory").exists())          # moved, not left
            self.assertTrue((cfg / "archived-memory").is_dir())  # created beside it
            self.assertIsNotNone(summary["archived"])
            archived_fact = summary["archived"] / "fact.md"
            self.assertTrue(archived_fact.is_file())             # the fact survived
            self.assertEqual(archived_fact.read_text(encoding="utf-8"), "a learned fact")
        finally:
            shutil.rmtree(cfg.parent, ignore_errors=True)


class ArchiveMemoryTests(unittest.TestCase):
    def test_moves_into_timestamped_sibling(self):
        base = Path(tempfile.mkdtemp())
        try:
            mem = base / "memory"
            mem.mkdir()
            (mem / "MEMORY.md").write_text("# Memory Index\n- [x](x.md)\n", encoding="utf-8")
            dest = harness._archive_memory(mem)
            self.assertFalse(mem.exists())                       # original moved away
            self.assertEqual(dest.parent, base / "archived-memory")
            self.assertTrue((dest / "MEMORY.md").is_file())      # contents preserved
        finally:
            shutil.rmtree(base, ignore_errors=True)


class RenderedCheckTests(unittest.TestCase):
    def test_fresh_build_clean_then_drift_detected(self):
        d = Path(tempfile.mkdtemp())
        try:
            build.build("neutral", d)
            self.assertEqual(harness._rendered_problems(d), [])
            (d / "AGENT.md").write_text("tampered", encoding="utf-8")
            probs = harness._rendered_problems(d)
            self.assertTrue(any("AGENT.md" in p and "stale" in p for p in probs))
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_missing_file_detected(self):
        d = Path(tempfile.mkdtemp())
        try:
            build.build("neutral", d)
            (d / "laws" / "universal.md").unlink()
            probs = harness._rendered_problems(d)
            self.assertTrue(any("universal.md" in p and "missing" in p for p in probs))
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_absent_bundle_is_noop(self):
        self.assertEqual(harness._rendered_problems(ROOT / "does-not-exist"), [])


class McpServerTests(unittest.TestCase):
    """The pure logic behind the TUI's MCP-servers screen: toggling a server block in
    an opencode.json without disturbing anything else."""

    def test_apply_adds_and_preserves_other_keys(self):
        cfg = {"$schema": "x", "instructions": ["AGENT.md"],
               "permission": {"bash": "allow"}}
        block = harness._MCP_PRESETS["markitdown"]["block"]
        out = harness._mcp_apply(cfg, "markitdown", block)
        self.assertEqual(out["mcp"]["markitdown"]["command"], ["markitdown-mcp"])
        self.assertEqual(out["instructions"], ["AGENT.md"])      # untouched
        self.assertEqual(out["permission"], {"bash": "allow"})   # untouched
        self.assertEqual(cfg.get("mcp"), None)                   # input not mutated

    def test_apply_remove_drops_empty_mcp_map(self):
        cfg = {"mcp": {"markitdown": {"type": "local"}}}
        out = harness._mcp_apply(cfg, "markitdown", None)
        self.assertNotIn("mcp", out)                             # emptied map removed
        self.assertIn("$schema", out)                            # still a valid file

    def test_apply_remove_keeps_other_servers(self):
        cfg = {"mcp": {"markitdown": {"type": "local"}, "other": {"type": "local"}}}
        out = harness._mcp_apply(cfg, "markitdown", None)
        self.assertEqual(list(out["mcp"]), ["other"])

    def test_state_reports_enabled_disabled_absent(self):
        self.assertEqual(harness._mcp_state({}, "markitdown"), "absent")
        self.assertEqual(
            harness._mcp_state({"mcp": {"markitdown": {"enabled": True}}}, "markitdown"),
            "enabled")
        self.assertEqual(
            harness._mcp_state({"mcp": {"markitdown": {"enabled": False}}}, "markitdown"),
            "disabled")
        # no explicit flag == OpenCode's default (enabled)
        self.assertEqual(
            harness._mcp_state({"mcp": {"markitdown": {}}}, "markitdown"), "enabled")

    def test_set_enabled_toggles_only_that_server(self):
        cfg = {"mcp": {"markitdown": {"type": "local", "enabled": True}}}
        off = harness._mcp_set_enabled(cfg, "markitdown", False)
        self.assertFalse(off["mcp"]["markitdown"]["enabled"])
        self.assertEqual(off["mcp"]["markitdown"]["type"], "local")   # other fields kept
        self.assertEqual(harness._mcp_set_enabled({}, "markitdown", True), {})  # absent no-op

    def test_default_target_lands_on_the_one_config_that_exists(self):
        # The bug this guards: edits silently went to a stray <cwd>/opencode.json while
        # the user watched the global file. When exactly one config exists, open there.
        d = Path(tempfile.mkdtemp())
        try:
            proj, glob = d / "proj.json", d / "glob.json"
            glob.write_text("{}", encoding="utf-8")          # only the global exists
            targets = [("this project", proj), ("global config", glob)]
            self.assertEqual(harness._mcp_default_target(targets), 1)   # -> global
            proj.write_text("{}", encoding="utf-8")
            glob.unlink()                                    # now only the project
            self.assertEqual(harness._mcp_default_target(targets), 0)   # -> project
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_default_target_follows_install_mode_when_ambiguous(self):
        d = Path(tempfile.mkdtemp())
        try:
            targets = [("this project", d / "a.json"), ("global config", d / "b.json")]
            orig = harness._installed_defaults
            try:                                             # neither file exists
                harness._installed_defaults = lambda: {"emit": "opencode-global"}
                self.assertEqual(harness._mcp_default_target(targets), 1)   # -> global
                harness._installed_defaults = lambda: {"emit": "files"}
                self.assertEqual(harness._mcp_default_target(targets), 0)   # -> project
            finally:
                harness._installed_defaults = orig
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_load_save_roundtrip_and_malformed(self):
        d = Path(tempfile.mkdtemp())
        try:
            path = d / "opencode.json"
            self.assertEqual(harness._mcp_load(path), {})            # missing -> {}
            cfg = harness._mcp_apply({}, "markitdown",
                                     harness._MCP_PRESETS["markitdown"]["block"])
            harness._mcp_save(path, cfg)
            self.assertEqual(harness._mcp_load(path)["mcp"]["markitdown"]["command"],
                             ["markitdown-mcp"])
            path.write_text("{not json", encoding="utf-8")
            self.assertEqual(harness._mcp_load(path), {})            # malformed -> {}
        finally:
            shutil.rmtree(d, ignore_errors=True)


class SetupArgsTests(unittest.TestCase):
    def test_global_omits_out_and_root(self):
        self.assertEqual(
            harness._setup_build_args("neutral", "opencode-global", "x", "y"),
            ["--theme", "neutral", "--emit", "opencode-global"])

    def test_files_includes_out(self):
        self.assertEqual(
            harness._setup_build_args("imperial", "files", "Bundle", None),
            ["--theme", "imperial", "--emit", "files", "--out", "Bundle"])

    def test_opencode_includes_out_and_root(self):
        self.assertEqual(
            harness._setup_build_args("neutral", "opencode", "repo", "repo"),
            ["--theme", "neutral", "--emit", "opencode", "--out", "repo", "--root", "repo"])


class TuiInventoryTests(unittest.TestCase):
    def test_counts_and_bodies(self):
        inv = harness._tui_inventory("neutral")
        self.assertEqual(len(inv["agents"]), 16)
        self.assertEqual(len(inv["skills"]), 20)
        self.assertEqual(len(inv["laws"]), 20)
        self.assertTrue(all(e["desc"] and e["body"] for e in inv["agents"]))
        self.assertTrue(all(e["desc"] and e["body"] for e in inv["skills"]))
        self.assertTrue(all(l["title"] and l["body"] for l in inv["laws"]))

    def test_entries_and_detail(self):
        inv = harness._tui_inventory("neutral")
        rows = harness._tui_entries(inv)
        kinds = {k for k, _l, _d in rows}
        self.assertEqual(kinds, {"head", "agent", "skill", "law"})
        heads = [l for k, l, _d in rows if k == "head"]
        self.assertTrue(any(h.startswith("AGENTS") for h in heads))
        # selecting a law yields multi-line detail (title + body)
        law_row = next(r for r in rows if r[0] == "law")
        self.assertGreater(len(harness._detail_lines(*law_row)), 2)
        # an agent's detail is its full rendered spec
        agent_row = next(r for r in rows if r[0] == "agent")
        self.assertTrue(any("##" in ln or "When" in ln for ln in harness._detail_lines(*agent_row)))


class AuthoringGateTests(unittest.TestCase):
    def test_real_specs_and_plugins_pass(self):
        # Spec purpose-line + single-source-prompt checks must hold for the source
        # tree; node --check is best-effort (skipped when node is absent).
        self.assertEqual(harness._authoring_problems(), [])


class MemoryFactsTests(unittest.TestCase):
    def test_lists_facts_skips_index_and_readme(self):
        d = Path(tempfile.mkdtemp())
        try:
            (d / "MEMORY.md").write_text("# Memory Index\n- [a](a.md)\n- [b](b.md)\n", encoding="utf-8")
            (d / "README.md").write_text("conv", encoding="utf-8")
            (d / "a.md").write_text("---\nname: a\ndescription: alpha\n---\nbody A", encoding="utf-8")
            (d / "b.md").write_text("---\nname: b\ndescription: beta\n---\nbody B", encoding="utf-8")
            facts = harness._memory_facts(d)
            names = sorted(f["name"] for f in facts)
            self.assertEqual(names, ["a", "b"])
            self.assertTrue(any(f["desc"] == "alpha" for f in facts))
            # drop b from the index
            harness._memory_drop_index(d, "b")
            self.assertNotIn("(b.md)", (d / "MEMORY.md").read_text(encoding="utf-8"))
            self.assertIn("(a.md)", (d / "MEMORY.md").read_text(encoding="utf-8"))
        finally:
            shutil.rmtree(d, ignore_errors=True)


class DiscoverContextTests(unittest.TestCase):
    def _fixture(self, d):
        (d / "README.md").write_text("# r", encoding="utf-8")
        (d / "CONTRIBUTING.md").write_text("# c", encoding="utf-8")
        (d / "notes.md").write_text("# n", encoding="utf-8")
        (d / "docs").mkdir()
        (d / "docs" / "guide.md").write_text("# g", encoding="utf-8")
        (d / "node_modules").mkdir()
        (d / "node_modules" / "junk.md").write_text("x", encoding="utf-8")
        (d / "packages" / "foo").mkdir(parents=True)
        (d / "packages" / "foo" / "README.md").write_text("# foo", encoding="utf-8")

    def test_convention_discovery(self):
        d = Path(tempfile.mkdtemp())
        try:
            self._fixture(d)
            eager, lazy = harness._discover_context(d)
            enames = {Path(e["path"]).name for e in eager}
            lnames = {Path(l["path"]).name for l in lazy}
            self.assertIn("README.md", enames)
            self.assertIn("CONTRIBUTING.md", enames)
            self.assertIn("notes.md", lnames)      # misc root .md -> lazy
            self.assertIn("guide.md", lnames)      # docs/ tree -> lazy
            self.assertNotIn("junk.md", lnames)    # node_modules never scanned
            self.assertTrue(any(Path(l["path"]).parent.name == "foo" for l in lazy))
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_empty_manifest_falls_back_to_discovery(self):
        d = Path(tempfile.mkdtemp())
        try:
            self._fixture(d)
            (d / "context.json").write_text('{"context": []}', encoding="utf-8")
            eager, _lazy, source = harness._resolve_context_sets(d)
            self.assertTrue(any(Path(e["path"]).name == "README.md" for e in eager))
            self.assertIn("auto-discovery", source)
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_manifest_extend_layers_on_discovery(self):
        d = Path(tempfile.mkdtemp())
        try:
            self._fixture(d)
            (d / "house.md").write_text("# house rules", encoding="utf-8")
            (d / "context.json").write_text(
                '{"extend": true, "context": ['
                '{"path": "house.md", "load": "eager", "description": "house rules"}]}',
                encoding="utf-8",
            )
            eager, _lazy, source = harness._resolve_context_sets(d)
            enames = {Path(e["path"]).name for e in eager}
            self.assertIn("README.md", enames)   # from discovery
            self.assertIn("house.md", enames)    # from manifest, layered on top
            self.assertNotIn("auto-discovery", source)
        finally:
            shutil.rmtree(d, ignore_errors=True)


class TuiHelperTests(unittest.TestCase):
    def test_clear_frame_erases_and_forces_full_repaint(self):
        # Guards the leftover/ghost fix: every interactive frame must both erase and
        # mark the window for a full physical repaint (clearok(True)).
        class FakeWin:
            def __init__(self):
                self.calls = []
            def erase(self):
                self.calls.append("erase")
            def clearok(self, flag):
                self.calls.append(("clearok", flag))
        win = FakeWin()
        harness._clear_frame(win)
        self.assertEqual(win.calls, ["erase", ("clearok", True)])

    def test_clamp_keeps_window_in_range(self):
        # plenty of room → no scroll
        self.assertEqual(harness._clamp(0, 5, 10), 0)
        self.assertEqual(harness._clamp(7, 5, 10), 0)     # total < view → pinned to 0
        # more rows than fit → clamp to last full window
        self.assertEqual(harness._clamp(0, 100, 10), 0)
        self.assertEqual(harness._clamp(95, 100, 10), 90)
        self.assertEqual(harness._clamp(-4, 100, 10), 0)  # never negative

    def test_wrap_lines_preserves_blanks_and_wraps(self):
        out = harness._wrap_lines(["short", "", "a b c d e f g"], 5)
        self.assertEqual(out[0], "short")
        self.assertEqual(out[1], "")                      # blank line kept
        self.assertGreater(len(out), 3)                   # long line wrapped to >1 row
        # degenerate width never raises
        self.assertEqual(harness._wrap_lines([""], 0), [""])

    def test_glyphs_honour_ascii_mode(self):
        uni = harness._glyphs(False)
        asc = harness._glyphs(True)
        self.assertEqual(set(uni), set(asc))              # same keys both modes
        self.assertEqual(uni["sel"], "▸")
        self.assertEqual(asc["sel"], ">")
        # ASCII mode must emit only ASCII (the whole point of the flag)
        self.assertTrue(all(ord(c) < 128 for v in asc.values() for c in v))
        # the back-compat aliases track the table
        self.assertEqual(harness._SEL_G, harness._GLYPH["sel"])
        self.assertEqual(harness._MORE_G, harness._GLYPH["down"])


if __name__ == "__main__":
    unittest.main()
