"""Unit tests for the Geneseed CLI (rituals/harness.py). Stdlib unittest only.

Run from the Geneseed root:  python -m unittest discover -s tests
"""
import json
import os
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


class DoctorCatchesThemeDriftTests(unittest.TestCase):
    """Self-tests for the parity gate: it must actually *flag* a corrupted theme, not
    just pass on the clean shipped set. Point the theme dir at a temp copy so the real
    themes are never touched."""

    def _with_temp_themes(self, files: dict) -> list:
        tmp = Path(tempfile.mkdtemp())
        orig = build.THEMES
        try:
            for name, text in files.items():
                (tmp / name).write_text(text, encoding="utf-8")
            build.THEMES = tmp
            return harness._theme_parity_problems()
        finally:
            build.THEMES = orig
            shutil.rmtree(tmp, ignore_errors=True)

    def test_missing_key_is_flagged(self):
        good = json.loads((build.THEMES / "neutral.json").read_text(encoding="utf-8"))
        broken = dict(good)
        broken.pop("VOICE")
        problems = self._with_temp_themes({
            "neutral.json": json.dumps(good),
            "broken.json": json.dumps(broken),
        })
        self.assertTrue(problems, "a theme missing a key must be flagged")
        self.assertTrue(any("VOICE" in p and "broken" in p for p in problems), problems)

    def test_malformed_json_is_flagged(self):
        good = json.loads((build.THEMES / "neutral.json").read_text(encoding="utf-8"))
        problems = self._with_temp_themes({
            "neutral.json": json.dumps(good),
            "broken.json": "{ not valid json",
        })
        self.assertTrue(any("unreadable" in p for p in problems), problems)

    def test_underscore_scaffold_is_ignored(self):
        """A `_`-prefixed scaffold (e.g. _TEMPLATE.json) is skipped, so an intentionally
        partial template never trips the gate."""
        good = json.loads((build.THEMES / "neutral.json").read_text(encoding="utf-8"))
        problems = self._with_temp_themes({
            "neutral.json": json.dumps(good),
            "imperial.json": json.dumps(good),
            "_TEMPLATE.json": json.dumps({"VOICE": "<placeholder>"}),
        })
        self.assertEqual(problems, [])


class CountTableGateTests(unittest.TestCase):
    """The authoring gate that keeps the AGENT.md capability tables and the README
    count badges honest against src/. Self-tested both ways: clean on the shipped
    tree, and actually flagging a mismatch."""

    def test_shipped_tables_and_badges_consistent(self):
        self.assertEqual(harness._count_table_problems(), [])

    def test_gate_flags_table_and_badge_drift(self):
        tmp = Path(tempfile.mkdtemp())
        orig = build.SRC
        try:
            for sub in ("agents", "skills", "laws"):
                (tmp / sub).mkdir()
            # Far fewer specs than the README badges declare, and a table (copied
            # verbatim) that now references files which don't exist here.
            (tmp / "agents" / "reviewer.md").write_text("> p", encoding="utf-8")
            (tmp / "skills" / "commit.md").write_text("> p", encoding="utf-8")
            (tmp / "laws" / "universal.md").write_text("### {{LAW}} I — x\n", encoding="utf-8")
            shutil.copy(build.SRC / "AGENT.md.tmpl", tmp / "AGENT.md.tmpl")
            build.SRC = tmp
            problems = harness._count_table_problems()
        finally:
            build.SRC = orig
            shutil.rmtree(tmp, ignore_errors=True)
        self.assertTrue(problems)
        self.assertTrue(any("badge" in p for p in problems), problems)
        self.assertTrue(any("AGENT.md links" in p or "omits" in p for p in problems), problems)

    def test_prose_mirror_gate_catches_drift(self):
        """The prose count mirrors (README table + web onboarding) are unit-tested in
        isolation: clean on matching inputs, and flagging every drift class the badge
        regex is blind to — a wrong prose count, a dropped skill name, a stale web
        law count, and a self-inconsistent 'N repeatable workflows' subset."""
        counts = {"laws": 35, "agents": 16, "skills": 3}
        stems = {"alpha", "beta", "gamma"}
        readme = (
            "| **🛡️ Rules** (`laws/`) | 35 universal laws the agent obeys — … |\n"
            "| **🤖 Agents** (16) | capability specialists: … |\n"
            "| **🛠 Skills** (3) | repeatable workflows: alpha · **beta** · gamma |\n"
        )
        web = (
            "- **`AGENT.md`** — 35 universal Rules the agent obeys.\n"
            "16 capability specialists — reviewer, tester …\n"
            "35 universal laws the agent obeys — secrets handling …\n"
            "3 repeatable workflows the agent can invoke by name — "
            "[[alpha]], [[beta]], [[gamma]]. A skill is a markdown "
            "playbook under `src/skills/`.\n"
        )
        shipped = "| **Laws / Agents / Skills** | 35 laws, 16 agents, 3 skills, … |\n"
        self.assertEqual(harness._prose_mirror_problems(readme, web, counts, stems, shipped), [])

        # SHIPPED.md capability row drifts (any of the three counts).
        p = harness._prose_mirror_problems(
            readme, web, counts, stems, shipped.replace("35 laws", "34 laws"))
        self.assertTrue(any("SHIPPED.md says '34 laws'" in x for x in p), p)

        # README law-count prose drifts.
        p = harness._prose_mirror_problems(
            readme.replace("35 universal laws", "34 universal laws"), web, counts, stems)
        self.assertTrue(any("universal laws" in x for x in p), p)
        # README Skills (N) count drifts.
        p = harness._prose_mirror_problems(
            readme.replace("Skills** (3)", "Skills** (9)"), web, counts, stems)
        self.assertTrue(any("Skills (9)" in x for x in p), p)
        # README skills list drops a name — invisible to the count, caught here.
        p = harness._prose_mirror_problems(
            readme.replace("alpha · **beta** · gamma", "alpha · **beta**"), web, counts, stems)
        self.assertTrue(any("omits 'gamma'" in x for x in p), p)
        # web law count drifts.
        p = harness._prose_mirror_problems(
            readme, web.replace("35 universal Rules", "34 universal Rules"), counts, stems)
        self.assertTrue(any("universal laws/Rules" in x for x in p), p)
        # web "N repeatable workflows" no longer matches its own wikilink list.
        p = harness._prose_mirror_problems(
            readme, web.replace("3 repeatable workflows", "9 repeatable workflows"), counts, stems)
        self.assertTrue(any("repeatable workflows" in x for x in p), p)

    def test_gate_flags_law_missing_from_class(self):
        """A law numeral parsed from universal.md but absent from LAW_CLASS must be
        flagged — the gate that would have caught the Law XXXV 'craft' fallback."""
        tmp = Path(tempfile.mkdtemp())
        orig = build.SRC
        try:
            for sub in ("agents", "skills", "laws"):
                (tmp / sub).mkdir()
            # XL is not a key in LAW_CLASS, so it must trip the completeness gate.
            (tmp / "laws" / "universal.md").write_text(
                "### {{LAW}} I — a\n### {{LAW}} XL — z\n", encoding="utf-8")
            shutil.copy(build.SRC / "AGENT.md.tmpl", tmp / "AGENT.md.tmpl")
            build.SRC = tmp
            problems = harness._count_table_problems()
        finally:
            build.SRC = orig
            shutil.rmtree(tmp, ignore_errors=True)
        self.assertTrue(
            any("XL" in p and "LAW_CLASS" in p for p in problems), problems)

    def test_gate_flags_unknown_law_class_value(self):
        """A LAW_CLASS value outside the known six-class set must be flagged."""
        from _harness_tui import LAW_CLASS
        orig = LAW_CLASS.get("I")
        LAW_CLASS["I"] = "bogus"
        try:
            problems = harness._count_table_problems()
        finally:
            LAW_CLASS["I"] = orig
        self.assertTrue(any("bogus" in p for p in problems), problems)


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

    def test_falls_back_to_bob_rules_sigil(self):
        # A global Bob install writes no AGENTS.md; without its marker the theme is
        # still recognised from the preamble in rules/geneseed.md.
        d = Path(tempfile.mkdtemp())
        try:
            build.emit_bob_global("imperial", cfg=d)
            (d / ".geneseed-theme").unlink(missing_ok=True)   # force the sigil path
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
        s = ("run [ship](ship.md) if unsure; via the [refactor Skill](refactor.md);\n"
             "dispatch the [reviewer Agent](../agents/reviewer.md); copy "
             "[`_template.md`](_template.md); see [docs](https://example.com/x.md).")
        out = build._strip_skill_body_links(s)
        self.assertIn("run ship if unsure", out)
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
            # portable bundle keeps the in-body link (tdd links refactor.md + commit.md)
            self.assertRegex((d / "skills" / "tdd.md").read_text(encoding="utf-8"), self.REL_MD)
            with contextlib.redirect_stdout(io.StringIO()):
                build.emit_opencode_global("neutral", out=Path(tempfile.mkdtemp()) / "b", cfg=cfg)
            # native skill is plain text
            native = (cfg / "skills" / "tdd" / "SKILL.md").read_text(encoding="utf-8")
            self.assertNotRegex(native, self.REL_MD)
            self.assertIn("refactor", native)
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
        # counts match the rendered inventory (derived from src/, never hand-bumped)
        self.assertEqual(d["agents"], len(harness._src_stems("agents")))
        self.assertEqual(d["skills"], len(harness._src_stems("skills")))
        self.assertEqual(d["laws"], 35)
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

    def test_unmerge_warns_and_skips_commented_jsonc(self):
        import contextlib, io
        d = Path(tempfile.mkdtemp())
        try:
            jc = d / "opencode.jsonc"
            original = '// keep my notes\n{\n  "instructions": ["AGENT.md", "other.md"]\n}\n'
            jc.write_text(original, encoding="utf-8")
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                changed = harness._unmerge_opencode_json(d / "opencode.json", "AGENT.md")
            self.assertFalse(changed)                            # reported unchanged
            self.assertIn("has comments", buf.getvalue())
            self.assertEqual(jc.read_text(encoding="utf-8"), original)   # untouched
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_unmerge_edits_comment_free_jsonc(self):
        d = Path(tempfile.mkdtemp())
        try:
            jc = d / "opencode.jsonc"
            jc.write_text('{"instructions": ["AGENT.md", "other.md"]}', encoding="utf-8")
            changed = harness._unmerge_opencode_json(d / "opencode.json", "AGENT.md")
            self.assertTrue(changed)
            instr = json.loads(jc.read_text(encoding="utf-8"))["instructions"]
            self.assertEqual(instr, ["other.md"])
        finally:
            shutil.rmtree(d, ignore_errors=True)


class ProjectUninstallResolveTests(unittest.TestCase):
    """`_uninstall_resolve` is the new bit of surface Task 1 adds: it turns a bare
    `--target` (or the cwd) into (host, scope, root) for BOTH global and project
    installs, so `cmd_uninstall` no longer special-cases global only."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.saved_cwd = os.getcwd()

    def tearDown(self):
        os.chdir(self.saved_cwd)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_resolves_project_from_explicit_repo_target(self):
        import contextlib, io
        repo = self.tmp / "repo"
        repo.mkdir()
        with contextlib.redirect_stdout(io.StringIO()):
            build.emit_claude("neutral", out=repo, root=repo)
        hit = harness._uninstall_resolve(str(repo))
        self.assertEqual(hit, ("claude", "project", repo.resolve()))

    def test_resolves_project_from_explicit_cfg_dir_target(self):
        import contextlib, io
        repo = self.tmp / "repo"
        repo.mkdir()
        with contextlib.redirect_stdout(io.StringIO()):
            build.emit_claude("neutral", out=repo, root=repo)
        # The pre-existing single-target convention: point straight at .claude/ itself.
        hit = harness._uninstall_resolve(str(repo / ".claude"))
        self.assertEqual(hit, ("claude", "project", repo.resolve()))

    def test_resolves_project_from_cwd_when_no_target(self):
        import contextlib, io
        repo = self.tmp / "repo"
        repo.mkdir()
        with contextlib.redirect_stdout(io.StringIO()):
            build.emit_opencode("neutral", out=repo, root=repo)
        os.chdir(repo)
        hit = harness._uninstall_resolve(None)
        self.assertEqual(hit, ("opencode", "project", repo.resolve()))

    def test_no_target_falls_back_to_opencode_global_default(self):
        # Unchanged legacy default: no --target, no project marker in cwd -> the
        # OpenCode global config dir, exactly as before this task.
        os.chdir(self.tmp)   # an empty dir carries no project marker
        hit = harness._uninstall_resolve(None)
        self.assertEqual(hit, ("opencode", "global", build._opencode_config_dir()))

    def test_unknown_target_returns_none(self):
        empty = self.tmp / "nothing-here"
        empty.mkdir()
        self.assertIsNone(harness._uninstall_resolve(str(empty)))


class ProjectUninstallCliTests(unittest.TestCase):
    """`cmd_uninstall` itself, now that it drives project-scoped installs too (it
    previously only supported the global manifest-tracked case and told per-repo users
    to `rm -rf` by hand). Exercises the full CLI path: resolve -> summary -> confirm ->
    `_install_uninstall` -> printed result — for Claude (manifest + CLAUDE.md block +
    hooks) and OpenCode (manifest-less) project installs."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _args(self, target, yes=True, archive_memory=False):
        import argparse
        return argparse.Namespace(target=target, yes=yes, archive_memory=archive_memory)

    def test_claude_project_uninstall_removes_owned_unwires_hooks_keeps_memory(self):
        import contextlib, io, argparse
        repo = self.tmp / "repo"
        repo.mkdir()
        with contextlib.redirect_stdout(io.StringIO()):
            build.emit_claude("neutral", out=repo, root=repo)
        cfg = repo / ".claude"
        # User prose around the managed CLAUDE.md block must survive the uninstall.
        original = (repo / "CLAUDE.md").read_text(encoding="utf-8")
        (repo / "CLAUDE.md").write_text(
            "# my own project notes\n\n" + original + "\nmy own trailing note\n",
            encoding="utf-8")
        settings = json.loads((cfg / "settings.local.json").read_text(encoding="utf-8"))
        self.assertTrue(settings.get("hooks"))   # sanity: hooks really were wired

        with contextlib.redirect_stdout(io.StringIO()):
            rc = harness.cmd_uninstall(self._args(str(repo)))
        self.assertEqual(rc, 0)

        self.assertFalse((cfg / "skills").exists())
        self.assertFalse((cfg / "agents").exists())
        self.assertFalse((cfg / build.GLOBAL_MANIFEST).exists())
        self.assertTrue((cfg / "memory").is_dir())           # memory kept
        self.assertTrue((repo / "CLAUDE.md").exists())        # user prose kept the file alive
        remaining = (repo / "CLAUDE.md").read_text(encoding="utf-8")
        self.assertIn("my own project notes", remaining)
        self.assertIn("my own trailing note", remaining)
        settings2 = json.loads((cfg / "settings.local.json").read_text(encoding="utf-8"))
        self.assertEqual(settings2.get("hooks", {}), {})     # Geneseed's hook groups unwired

    def test_opencode_project_uninstall_removes_files_and_instructions_entry(self):
        import contextlib, io
        repo = self.tmp / "repo"
        repo.mkdir()
        with contextlib.redirect_stdout(io.StringIO()):
            build.emit_opencode("neutral", out=repo, root=repo)
        self.assertIn("AGENT.md",
                      json.loads((repo / "opencode.json").read_text(encoding="utf-8"))["instructions"])

        with contextlib.redirect_stdout(io.StringIO()):
            rc = harness.cmd_uninstall(self._args(str(repo)))
        self.assertEqual(rc, 0)

        self.assertFalse((repo / ".opencode").exists())
        self.assertFalse((repo / "AGENT.md").exists())
        self.assertTrue((repo / "memory").is_dir())          # memory kept
        instr = json.loads((repo / "opencode.json").read_text(encoding="utf-8")).get("instructions", [])
        self.assertNotIn("AGENT.md", instr)

    def test_project_uninstall_deregisters_from_registry(self):
        import contextlib, io, os
        import _install_registry
        saved_xdg = os.environ.get("XDG_CONFIG_HOME")
        xdg = self.tmp / "xdg"
        xdg.mkdir()
        os.environ["XDG_CONFIG_HOME"] = str(xdg)
        try:
            repo = self.tmp / "repo"
            repo.mkdir()
            with contextlib.redirect_stdout(io.StringIO()):
                build.emit_claude("neutral", out=repo, root=repo)
            (repo / ".geneseed-emit").write_text("claude\n", encoding="utf-8")
            _install_registry.record(repo)
            self.assertIn(repo.resolve(), [r.resolve() for r in _install_registry.roots()])

            with contextlib.redirect_stdout(io.StringIO()):
                rc = harness.cmd_uninstall(self._args(str(repo)))
            self.assertEqual(rc, 0)
            self.assertEqual(_install_registry.roots(), [])
        finally:
            if saved_xdg is None:
                os.environ.pop("XDG_CONFIG_HOME", None)
            else:
                os.environ["XDG_CONFIG_HOME"] = saved_xdg

    def test_archive_memory_flag_archives_project_memory(self):
        import contextlib, io
        repo = self.tmp / "repo"
        repo.mkdir()
        with contextlib.redirect_stdout(io.StringIO()):
            build.emit_claude("neutral", out=repo, root=repo)
        cfg = repo / ".claude"
        (cfg / "memory" / "learned.md").write_text("a fact", encoding="utf-8")

        with contextlib.redirect_stdout(io.StringIO()):
            rc = harness.cmd_uninstall(self._args(str(repo), archive_memory=True))
        self.assertEqual(rc, 0)
        self.assertFalse((cfg / "memory").exists())
        archived = list((cfg / "archived-memory").glob("*/learned.md"))
        self.assertEqual(len(archived), 1)
        self.assertEqual(archived[0].read_text(encoding="utf-8"), "a fact")

    def test_no_install_at_target_errors_without_raising(self):
        empty = self.tmp / "empty"
        empty.mkdir()
        import contextlib, io
        buf = io.StringIO()
        with contextlib.redirect_stderr(buf):
            rc = harness.cmd_uninstall(self._args(str(empty)))
        self.assertEqual(rc, 1)
        self.assertIn("no Geneseed install detected", buf.getvalue())

    def test_uninstall_without_yes_refuses_when_noninteractive(self):
        import contextlib, io
        repo = self.tmp / "repo"
        repo.mkdir()
        with contextlib.redirect_stdout(io.StringIO()):
            build.emit_claude("neutral", out=repo, root=repo)
        buf = io.StringIO()
        # Force the non-interactive branch regardless of the test runner's own stdin,
        # mirroring exactly what cmd_uninstall checks (sys.stdin.isatty()).
        old_isatty = sys.stdin.isatty
        sys.stdin.isatty = lambda: False
        try:
            with contextlib.redirect_stderr(buf), contextlib.redirect_stdout(io.StringIO()):
                rc = harness.cmd_uninstall(self._args(str(repo), yes=False))
        finally:
            sys.stdin.isatty = old_isatty
        self.assertEqual(rc, 1)
        self.assertIn("refusing to proceed without --yes", buf.getvalue())
        # Nothing was touched — refusing must not partially uninstall.
        self.assertTrue((repo / ".claude" / build.GLOBAL_MANIFEST).exists())


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
        self.assertEqual(out["mcp"]["markitdown"]["command"], ["uvx", "markitdown-mcp"])
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
            # Patch the global in the module where _mcp_default_target actually reads
            # it (its own __globals__), so the stub applies post-split regardless of
            # which _harness_* file the function now lives in.
            g = harness._mcp_default_target.__globals__
            orig = g["_installed_defaults"]
            try:                                             # neither file exists
                g["_installed_defaults"] = lambda: {"emit": "opencode-global"}
                self.assertEqual(harness._mcp_default_target(targets), 1)   # -> global
                g["_installed_defaults"] = lambda: {"emit": "files"}
                self.assertEqual(harness._mcp_default_target(targets), 0)   # -> project
            finally:
                g["_installed_defaults"] = orig
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
                             ["uvx", "markitdown-mcp"])
            path.write_text("{not json", encoding="utf-8")
            self.assertEqual(harness._mcp_load(path), {})            # malformed -> {}
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_load_is_comment_tolerant(self):
        d = Path(tempfile.mkdtemp())
        try:
            jc = d / "opencode.jsonc"
            jc.write_text('// hand-maintained\n{\n  "mcp": {"x": {"enabled": true}}\n}\n',
                          encoding="utf-8")
            self.assertEqual(harness._mcp_load(jc)["mcp"]["x"]["enabled"], True)
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def test_targets_prefer_existing_jsonc(self):
        d = Path(tempfile.mkdtemp())
        orig_cwd = Path.cwd()
        try:
            (d / "opencode.jsonc").write_text("{}", encoding="utf-8")
            os.chdir(d)
            label, path = harness._mcp_targets()[0]
            self.assertEqual(label, "this project")
            self.assertEqual(path.name, "opencode.jsonc")
        finally:
            os.chdir(orig_cwd)
            shutil.rmtree(d, ignore_errors=True)

    def test_commented_detects_only_real_comments(self):
        d = Path(tempfile.mkdtemp())
        try:
            plain = d / "a.jsonc"
            plain.write_text('{"$schema": "https://opencode.ai/config.json"}',
                             encoding="utf-8")
            self.assertFalse(harness._mcp_commented(plain))      # // in URL is not a comment
            noted = d / "b.jsonc"
            noted.write_text('// note\n{}', encoding="utf-8")
            self.assertTrue(harness._mcp_commented(noted))
            self.assertFalse(harness._mcp_commented(d / "c.json"))  # .json is never "commented"
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


class SetupFlairTests(unittest.TestCase):
    """The setup wizard speaks in the chosen theme's voice once a theme is picked —
    accent-tinted chrome, a banner/sigil on success, the benediction to close."""

    VALID_ACCENTS = {"cyan", "yellow", "red", "green", "magenta", "blue", "white"}

    def _themes(self):
        return [p.stem for p in build.theme_files()]

    def test_every_theme_supplies_full_flair(self):
        # Parity: each theme must give the wizard a usable voice, not blanks.
        for t in self._themes():
            f = harness._theme_flair(t)
            self.assertIn(f["accent"], self.VALID_ACCENTS, t)
            self.assertTrue(f["tagline"], t)
            self.assertTrue(f["sigil"], t)
            self.assertTrue(f["banner"] and all(isinstance(ln, str) for ln in f["banner"]), t)
            self.assertTrue(f["benediction"], t)

    def test_missing_theme_degrades_safely(self):
        f = harness._theme_flair("no-such-theme")
        self.assertEqual(f["accent"], "cyan")
        self.assertEqual(f["tagline"], "")
        self.assertEqual(f["banner"], [])

    def test_done_title_from_sigil_on_success_plain_on_failure(self):
        # Every theme's sigil opens with a different glyph; the title must strip it so
        # the bar's own badge isn't doubled — check the whole set, not just one theme.
        for t in self._themes():
            f = harness._theme_flair(t)
            title = harness._setup_done_title(f, True)
            self.assertNotEqual(title, "setup", t)
            self.assertEqual(title, title.lower(), t)       # title-bar styling, lowercased
            self.assertTrue(title[0].isalnum(), (t, title))  # no leading emoji/symbol
            self.assertEqual(harness._setup_done_title(f, False), "setup", t)

    def test_done_lines_crown_success_with_banner_and_benediction(self):
        f = harness._theme_flair("imperial")
        rows = harness._setup_done_lines(f, "imperial", "files", "Bundle", None, True)
        kinds = [k for k, _t in rows]
        self.assertIn("art", kinds)                     # banner/sigil rows present
        self.assertEqual(rows[-1][0], "dim")            # benediction closes the screen
        self.assertEqual(rows[-1][1], f["benediction"])
        # the factual install summary is still in the middle
        facts = harness._setup_summary_lines("imperial", "files", "Bundle", None, True)
        self.assertTrue(set(facts).issubset(set(rows)))

    def test_done_lines_failure_is_just_facts(self):
        f = harness._theme_flair("imperial")
        rows = harness._setup_done_lines(f, "imperial", "files", "Bundle", None, False)
        self.assertEqual(rows, harness._setup_summary_lines("imperial", "files", "Bundle", None, False))
        self.assertNotIn("art", [k for k, _t in rows])


class LspPrereqTests(unittest.TestCase):
    def test_java_major_parse(self):
        # modern scheme -> major is the leading number; legacy 1.x -> major 1 (< 21)
        self.assertTrue(harness._java_major_ok('openjdk version "21.0.2" 2024-01-16'))
        self.assertTrue(harness._java_major_ok('java version "24" 2025-03-18'))
        self.assertFalse(harness._java_major_ok('java version "1.8.0_392"'))
        self.assertFalse(harness._java_major_ok('no version string here'))

    def test_prereqs_shape(self):
        prereqs = harness._lsp_prereqs()
        self.assertEqual(len(prereqs), 1)
        label, present, hint = prereqs[0]
        self.assertIsInstance(label, str)
        self.assertIsInstance(present, bool)   # machine-dependent value, but always a bool
        self.assertIn("JDK 21", hint)

    def test_summary_surfaces_lsp_for_opencode_only(self):
        # opencode emit gets a Java line; the portable "files" emit must not.
        oc = " ".join(t for _k, t in harness._setup_summary_lines("neutral", "opencode", None, ".", True))
        files = " ".join(t for _k, t in harness._setup_summary_lines("neutral", "files", "Bundle", None, True))
        self.assertIn("Java 21+ (jdtls)", oc)
        self.assertNotIn("Java 21+ (jdtls)", files)


class TuiInventoryTests(unittest.TestCase):
    def test_counts_and_bodies(self):
        inv = harness._tui_inventory("neutral")
        self.assertEqual(len(inv["agents"]), len(harness._src_stems("agents")))
        self.assertEqual(len(inv["skills"]), len(harness._src_stems("skills")))
        self.assertEqual(len(inv["laws"]), 35)
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

    def test_dwidth_counts_emoji_and_cjk_as_two_columns(self):
        # plain ASCII is one column each; box-drawing/§/• stay single-width
        self.assertEqual(harness._dwidth("abc"), 3)
        self.assertEqual(harness._dwidth("─§•"), 3)
        # supplementary-plane emoji and CJK occupy two columns each
        self.assertEqual(harness._dwidth("🧬"), 2)
        self.assertEqual(harness._dwidth("🧬x"), 3)
        self.assertEqual(harness._dwidth("世界"), 4)
        # a U+FE0F presentation selector promotes its single-width base to two
        self.assertEqual(harness._dwidth("⚠️"), 2)
        # combining marks add nothing
        self.assertEqual(harness._dwidth("é"), 1)

    def test_fit_pads_and_truncs_by_display_width(self):
        # pads to the exact column count (not str length)
        self.assertEqual(harness._fit("ab", 5), "ab   ")
        self.assertEqual(harness._dwidth(harness._fit("🧬x", 6)), 6)
        # truncates by columns, never splitting a wide glyph mid-cell
        self.assertEqual(harness._fit("🧬🧬", 3), "🧬 ")   # one emoji (2) + pad to 3
        self.assertEqual(harness._truncd("abcdef", 3), "abc")
        self.assertEqual(harness._truncd("x", 0), "")

    def test_icon_and_mark_honour_display_tier(self):
        # ASCII mode → pure ASCII for both icons and status marks
        self.assertTrue(all(ord(c) < 128 for c in (
            harness._ICONS[k][2] for k in harness._ICONS)))
        self.assertTrue(all(ord(c) < 128 for c in (
            harness._MARKS[k][2] for k in harness._MARKS)))
        # every emoji icon is a single, double-width codepoint so _fit's math is exact
        for emoji, _sym, _asc in harness._ICONS.values():
            self.assertEqual(harness._dwidth(emoji), 2, emoji)

    def test_logo_lines_form_a_rectangular_block(self):
        rows = harness._logo_lines()
        self.assertEqual(len(rows), 5)
        widths = {harness._dwidth(r) for r in rows}
        self.assertEqual(len(widths), 1)                  # every row the same width

    def test_spin_is_static_when_motion_off(self):
        # The calm tiers (PLAIN / non-animated) must not emit a braille glyph — _spin
        # returns a tick-independent static mark so a per-keypress redraw never flickers.
        # Patch the flags in the module that _spin reads (its own __globals__) so the
        # override applies post-split wherever the function now lives.
        g = harness._spin.__globals__
        saved = (g["_TUI_ANIM"], g["_TUI_ASCII"])
        try:
            g["_TUI_ANIM"], g["_TUI_ASCII"] = False, False
            self.assertEqual(harness._spin(0), "·")
            self.assertEqual(harness._spin(7), "·")        # independent of the tick
            g["_TUI_ASCII"] = True
            self.assertEqual(harness._spin(3), "-")
            g["_TUI_ANIM"], g["_TUI_ASCII"] = True, False
            self.assertIn(harness._spin(0), harness._SPIN)  # animated tier whirls
        finally:
            g["_TUI_ANIM"], g["_TUI_ASCII"] = saved

    def test_new_icon_and_mark_keys_present_and_ascii_pure(self):
        self.assertIn("badge", harness._ICONS)
        for k in ("pending", "edited", "added", "missing", "mcp_on", "mcp_off", "mcp_absent"):
            self.assertIn(k, harness._MARKS)
            self.assertTrue(all(ord(c) < 128 for c in harness._MARKS[k][2]))  # ASCII tier pure

    def test_progress_bar_is_exact_width_at_sub_cell_resolution(self):
        # The bar is always exactly `width` display columns, at any fraction, so it
        # never drifts the surrounding layout — even mid-cell (eighths) fills.
        for frac in (0.0, 0.03, 0.1, 0.5, 0.99, 1.0):
            self.assertEqual(harness._dwidth(harness._progress_bar(frac, 24)), 24)
        g = harness._progress_bar.__globals__              # patch where the fn reads it
        saved = g["_TUI_ASCII"]
        try:
            g["_TUI_ASCII"] = True
            bar = harness._progress_bar(0.5, 10)
            self.assertEqual(len(bar), 10)
            self.assertTrue(set(bar) <= set("#-"))         # ASCII tier stays #/-
        finally:
            g["_TUI_ASCII"] = saved


class OpencodeAgentColorAndThemeTests(unittest.TestCase):
    """Agent display colours must be valid OpenCode named slots, and the emitted theme
    must be a complete, valid, accent-tinted JSON."""

    _SLOTS = {"primary", "secondary", "accent", "success", "warning", "error", "info"}

    def test_agent_colors_are_valid_named_slots(self):
        for v in build.AGENT_COLORS.values():
            self.assertIn(v, self._SLOTS)

    def test_theme_json_complete_and_accent_tinted(self):
        t = build._theme_json({"ACCENT": "cyan"})
        self.assertEqual(t["$schema"], "https://opencode.ai/theme.json")
        theme = t["theme"]
        for k in ("primary", "secondary", "accent", "error", "warning", "success",
                  "info", "text", "background", "border", "syntaxKeyword"):
            self.assertIn(k, theme)
        self.assertEqual(theme["accent"], 6)        # cyan -> ANSI 6
        self.assertEqual(theme["primary"], 6)
        # every value is a bare ANSI int (0-255) or the literal "none" — both valid
        for v in theme.values():
            self.assertTrue(v == "none" or (isinstance(v, int) and 0 <= v <= 255), v)
        self.assertEqual(build._theme_json({})["theme"]["accent"], 6)  # unknown -> cyan

    def test_global_emit_writes_branded_theme_and_agent_color(self):
        import contextlib, io, json as _json
        cfg = Path(tempfile.mkdtemp()) / "cfg"
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                build.emit_opencode_global("neutral", out=Path(tempfile.mkdtemp()) / "b", cfg=cfg)
            theme_file = cfg / "themes" / "geneseed-neutral.json"
            self.assertTrue(theme_file.is_file())
            self.assertIn("theme", _json.loads(theme_file.read_text(encoding="utf-8")))
            reviewer = (cfg / "agents" / "reviewer.md").read_text(encoding="utf-8")
            self.assertIn("color: warning", reviewer)   # role -> semantic slot
        finally:
            shutil.rmtree(cfg.parent, ignore_errors=True)


class McpServerListingTests(unittest.TestCase):
    """The MCP screen must show user-added servers, not only the built-in presets."""

    def test_known_names_unions_presets_with_config_servers(self):
        # "custom"/"sentry" are NOT presets; markitdown IS — exercise both branches.
        cfg = {"mcp": {"custom": {"type": "local"}, "sentry": {"type": "local"},
                       "markitdown": {"type": "local"}}}
        names = harness._mcp_known_names(cfg)
        # the built-in presets come first, then the user-added servers that aren't presets
        self.assertEqual(names[:len(harness._MCP_PRESETS)], list(harness._MCP_PRESETS))
        self.assertIn("custom", names)
        self.assertIn("sentry", names)
        # no duplicates even though markitdown is both a preset and in the config
        self.assertEqual(len(names), len(set(names)))

    def test_known_names_handles_empty_or_missing_mcp(self):
        self.assertEqual(harness._mcp_known_names({}), list(harness._MCP_PRESETS))
        self.assertEqual(harness._mcp_known_names({"mcp": {}}), list(harness._MCP_PRESETS))

    def test_meta_falls_back_for_unknown_server(self):
        label, desc = harness._mcp_meta("custom")
        self.assertEqual(label, "custom")                   # bare name, no KeyError
        self.assertTrue(desc)
        plabel, _ = harness._mcp_meta("markitdown")
        self.assertEqual(plabel, harness._MCP_PRESETS["markitdown"]["label"])

    def test_starter_presets_present_and_well_formed(self):
        # The four starter MCP servers Geneseed ships as presets (SETUP.md -> MCP servers).
        for name in ("markitdown", "gitlab", "gitlab-2", "filesystem"):
            self.assertIn(name, harness._MCP_PRESETS)
            preset = harness._MCP_PRESETS[name]
            self.assertTrue(preset["label"] and preset["desc"])
            self.assertEqual(preset["block"]["type"], "local")
            self.assertTrue(preset["block"]["command"])      # non-empty command
        # GitLab presets share the zereight command; differ only by API URL / token.
        for name in ("gitlab", "gitlab-2"):
            cmd = harness._MCP_PRESETS[name]["block"]["command"]
            self.assertEqual(cmd, ["npx", "-y", "@zereight/mcp-gitlab"])
            env = harness._MCP_PRESETS[name]["block"]["environment"]
            self.assertEqual(env["GITLAB_PERSONAL_ACCESS_TOKEN"], "")  # no token in source
        self.assertEqual(
            harness._MCP_PRESETS["filesystem"]["block"]["command"][:3],
            ["npx", "-y", "@modelcontextprotocol/server-filesystem"])


class SourceCompletenessGateTests(unittest.TestCase):
    """A partial src/ — an interrupted sync, or an AGENT.md table row whose spec file
    is missing — must ABORT the emit before any write, not produce an AGENT.md full of
    dead links (and, for the global emit, delete the previously-good copies)."""

    def _isolated(self) -> Path:
        """Copy the source into a temp tree and point build.* at it, restoring the
        real paths on teardown — so a removed spec never touches the real repo."""
        work = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, work, ignore_errors=True)
        shutil.copytree(build.SRC, work / "src")
        shutil.copytree(build.THEMES, work / "themes")
        shutil.copytree(build.PLUGIN_SRC, work / "plugins")
        shutil.copytree(build.WORKFLOW_SRC, work / "workflows")
        saved = (build.ROOT, build.SRC, build.THEMES, build.PLUGIN_SRC, build.CONFIG,
                 build.WORKFLOW_SRC)
        self.addCleanup(lambda: setattr_many(build, saved))
        build.ROOT, build.SRC, build.THEMES = work, work / "src", work / "themes"
        build.PLUGIN_SRC, build.CONFIG = work / "plugins", work / "harness.config.json"
        build.WORKFLOW_SRC = work / "workflows"
        return work

    def test_complete_source_passes_gate(self):
        self._isolated()
        _theme, items = build.render_all("neutral")
        self.assertEqual(build._missing_referenced_specs(items), [])

    def test_missing_skill_aborts_build_without_writing(self):
        work = self._isolated()
        (work / "src" / "skills" / "council.md").unlink()
        _theme, items = build.render_all("neutral")
        self.assertIn("skills/council.md", build._missing_referenced_specs(items))
        with self.assertRaises(SystemExit):
            build.build("neutral", work / "out")
        self.assertFalse((work / "out" / "AGENT.md").exists())   # nothing emitted

    def test_missing_agent_aborts_global_emit_and_preserves_install(self):
        import contextlib, io
        work = self._isolated()
        cfg = work / "cfg"
        with contextlib.redirect_stdout(io.StringIO()):
            build.emit_opencode_global("neutral", out=work / "bundle", cfg=cfg)
        self.assertTrue((cfg / "agents" / "operator.md").exists())
        (work / "src" / "agents" / "operator.md").unlink()       # simulate partial src
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            build.emit_opencode_global("neutral", out=work / "bundle", cfg=cfg)
        # write-before-delete + the gate: the previously-good install is untouched
        self.assertTrue((cfg / "agents" / "operator.md").exists())
        self.assertTrue((cfg / "skills" / "council" / "SKILL.md").exists())


class GitGateTests(unittest.TestCase):
    """The PreToolUse git gate (Law XX backstop): a commit/push command — bare,
    flagged, chained, or `-C path` — yields a `permissionDecision: "ask"`; everything
    else (and any unreadable payload) exits 0 with no output, deferring to normal flow."""

    def _run(self, payload: str):
        import contextlib, io
        buf = io.StringIO()
        stdin = io.StringIO(payload)
        with contextlib.redirect_stdout(buf):
            old, sys.stdin = sys.stdin, stdin
            try:
                rc = harness.cmd_git_gate(None)
            finally:
                sys.stdin = old
        return rc, buf.getvalue()

    def _asks(self, command: str):
        rc, out = self._run(json.dumps({"tool_name": "Bash",
                                        "tool_input": {"command": command}}))
        self.assertEqual(rc, 0)
        self.assertTrue(out.strip(), f"expected an ask decision for: {command}")
        dec = json.loads(out)["hookSpecificOutput"]
        self.assertEqual(dec["hookEventName"], "PreToolUse")
        self.assertEqual(dec["permissionDecision"], "ask")

    def _defers(self, command: str):
        rc, out = self._run(json.dumps({"tool_name": "Bash",
                                        "tool_input": {"command": command}}))
        self.assertEqual(rc, 0)
        self.assertEqual(out, "", f"expected no output (defer) for: {command}")

    def test_commit_and_push_forms_ask(self):
        for cmd in ("git commit -m 'x'",
                    "git push",
                    "git push --force origin feature",
                    "git add . && git commit -m x && git push",
                    "git -C /repo push origin main"):
            self._asks(cmd)

    def test_non_git_and_readonly_git_defer(self):
        for cmd in ("ls -la", "git status", "git add .", "echo committing"):
            self._defers(cmd)

    def test_unreadable_or_empty_payload_defers(self):
        for payload in ("", "not json", "{}", '{"tool_input": null}'):
            rc, out = self._run(payload)
            self.assertEqual(rc, 0)
            self.assertEqual(out, "")


def setattr_many(mod, saved):
    mod.ROOT, mod.SRC, mod.THEMES, mod.PLUGIN_SRC, mod.CONFIG, mod.WORKFLOW_SRC = saved


class WindowsProgressUiTests(unittest.TestCase):
    """The TUI progress runner must survive native Windows: WinSock select() cannot
    wait on pipe fds, and the legacy console code page cannot decode the UTF-8 the
    child processes emit. Either one used to throw out of the curses wrapper — the
    menu then died to its plain-text fallback and the setup wizard re-prompted
    everything as line input after a fully completed TUI pass."""

    def test_pipe_select_is_skipped_on_windows(self):
        saved = sys.platform
        try:
            sys.platform = "win32"
            self.assertFalse(harness._pipe_select_ok())
            sys.platform = "linux"
            self.assertTrue(harness._pipe_select_ok())
        finally:
            sys.platform = saved

    def test_run_logged_survives_utf8_glyphs_from_child(self):
        import io as io_mod
        import _winterm
        win = _winterm._Window(io_mod.StringIO(), rows=24, cols=80)
        pal = harness._tui_palette(_winterm)
        code = ("import sys;"
                "sys.stdout.reconfigure(encoding='utf-8');"
                "print('upgrade \\u26a0\\ufe0f retry \\u2713 ok')")
        log = []
        rc = harness._run_logged(win, _winterm, pal, [("emit", None)], ["running"],
                                 log, [sys.executable, "-c", code])
        self.assertEqual(rc, 0)
        self.assertTrue(any("⚠️" in ln and "✓" in ln for ln in log), log)


class ReexecTests(unittest.TestCase):
    """update/bootstrap hand off to a fresh harness process. On Windows os.exec*
    does not replace the process — it kills the parent, so the launcher's cmd.exe
    resumes and races the child for the console — the hand-off must instead run
    the child as a subprocess and exit with its code."""

    def test_windows_runs_child_subprocess_and_exits_with_its_code(self):
        import types
        saved_platform = sys.platform
        real_run = harness.subprocess.run
        calls = []

        def fake_run(argv, **kwargs):
            calls.append(list(argv))
            return types.SimpleNamespace(returncode=7)

        try:
            sys.platform = "win32"
            harness.subprocess.run = fake_run
            with self.assertRaises(SystemExit) as cm:
                harness._reexec([sys.executable, "harness.py", "menu"])
            self.assertEqual(cm.exception.code, 7)
            self.assertEqual(calls, [[sys.executable, "harness.py", "menu"]])
        finally:
            sys.platform = saved_platform
            harness.subprocess.run = real_run

    def test_unix_execs_in_place(self):
        saved_platform = sys.platform
        real_execv = harness.os.execv
        calls = []
        try:
            sys.platform = "linux"
            harness.os.execv = lambda exe, argv: calls.append((exe, list(argv)))
            harness._reexec([sys.executable, "harness.py", "setup"])
            self.assertEqual(
                calls, [(sys.executable, [sys.executable, "harness.py", "setup"])])
        finally:
            sys.platform = saved_platform
            harness.os.execv = real_execv


class UpdateStepDiagnosisTests(unittest.TestCase):
    """A failed in-process update step must leave a durable, legible trace. Field report:
    'refresh ok, then update factory step 2/2 failed — usage harness ... invalid choice
    upgrade'. That is the stale-factory skew; the diagnosis must name it and persist."""

    def test_stale_factory_signature_yields_cure(self):
        out = ("usage: harness [-h] {...}\n"
               "harness: error: argument command: invalid choice: 'upgrade'")
        hint = harness._stale_factory_hint(out, "upgrade", "main")
        self.assertTrue(hint)
        self.assertIn("PREDATES", hint[0])
        self.assertTrue(any("python rituals/_update.py update main" in ln for ln in hint))

    def test_unrelated_failure_gives_no_false_cure(self):
        self.assertEqual(harness._stale_factory_hint("network unreachable", "upgrade", "main"), [])
        self.assertEqual(harness._stale_factory_hint("", "upgrade", "main"), [])
        # an empty subcommand must not match every line via the `sub in low` test
        self.assertEqual(harness._stale_factory_hint("invalid choice: 'x'", "", "main"), [])

    def test_failed_step_persists_to_install_log(self):
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        logp = tmp / "install.log"
        saved = os.environ.get("GENESEED_LOG")
        os.environ["GENESEED_LOG"] = str(logp)
        try:
            cmd = [sys.executable, "harness.py", "upgrade", "main"]
            out = "error: argument command: invalid choice: 'upgrade'"
            lines = harness._diagnose_failed_step(
                2, 2, "Update factory & rebuild bundle", cmd, 2, out)
        finally:
            if saved is None:
                os.environ.pop("GENESEED_LOG", None)
            else:
                os.environ["GENESEED_LOG"] = saved
        self.assertTrue(logp.is_file())
        body = logp.read_text(encoding="utf-8")
        self.assertIn("step 2/2", body)
        self.assertIn("FAILED (exit 2)", body)
        self.assertIn("invalid choice", body)
        # the live lines carry the cure and a pointer to the persisted log
        self.assertTrue(any("rituals/_update.py update main" in ln for ln in lines))
        self.assertTrue(any(str(logp) in ln for ln in lines))


class UpdateStepSelfHealTests(unittest.TestCase):
    """A stale factory must self-heal in-process: when harness.py predates `upgrade`, the
    step routes to rituals/_update.py instead of dead-ending on argparse 'invalid choice'."""

    def test_supports_real_subcommand(self):
        hp = str(ROOT / "rituals" / "harness.py")
        self.assertTrue(harness._harness_supports(hp, "upgrade"))
        self.assertTrue(harness._harness_supports(hp, "sync-self"))
        self.assertFalse(harness._harness_supports(hp, "bogus-zzz"))

    def test_step_uses_harness_when_supported(self):
        cmd = harness._update_step_cmd(ROOT, "upgrade")
        self.assertTrue(cmd[1].endswith("harness.py"))
        self.assertEqual(cmd[2:], ["upgrade"])

    def test_step_falls_back_to_update_when_stale(self):
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        rituals = tmp / "rituals"
        rituals.mkdir()
        # a harness.py too old to know any self-update subcommand (exit 2 like argparse)
        (rituals / "harness.py").write_text("import sys\nsys.exit(2)\n", encoding="utf-8")
        (rituals / "_update.py").write_text("import sys\nsys.exit(0)\n", encoding="utf-8")
        cmd = harness._update_step_cmd(tmp, "upgrade")
        self.assertTrue(cmd[1].endswith("_update.py"))
        self.assertEqual(cmd[2:], ["upgrade"])


class ImprovementsExportTests(unittest.TestCase):
    """The drift report (`diff --out` / auto-export on setup & upgrade): a markdown
    artifact carrying the deployed harness's local edits for back-porting to src/."""

    FILES = [
        {"rel": "agents/reviewer.md", "status": "edited",
         "diff": ["--- source/agents/reviewer.md", "+++ deployed/agents/reviewer.md",
                  "@@ -1 +1 @@", "-old line", "+new line"]},
        {"rel": "skills/extra.md", "status": "added",
         "diff": ["(only in deployed — your addition)", "", "+the whole body"]},
        {"rel": "laws/gone.md", "status": "missing",
         "diff": ["(in source, not deployed — re-emit to add)"]},
    ]

    def test_md_carries_header_counts_and_fenced_diffs(self):
        md = harness._improvements_md(Path("/cfg"), "neutral", self.FILES,
                                      "2026-06-12 10:00:00")
        self.assertIn("# Geneseed — deployed improvements to back-port", md)
        self.assertIn("- captured: 2026-06-12 10:00:00", md)
        self.assertIn("- theme: neutral", md)
        self.assertIn("1 edited · 1 added in deployed · 1 missing from deployed", md)
        self.assertIn("## `agents/reviewer.md`  (edited in deployed)", md)
        self.assertIn("## `skills/extra.md`  (only in deployed — your addition)", md)
        self.assertIn("## `laws/gone.md`  (in source, not deployed)", md)
        # every section is a ```diff fence and the diff bodies survive verbatim
        self.assertEqual(md.count("```diff"), 3)
        self.assertEqual(md.count("```"), 6)
        self.assertIn("+new line", md)

    def test_version_marker_date_drift_is_not_an_edit(self):
        # Same fingerprint, different build date -> not a local edit.
        marker = build.VERSION_MARKER
        self.assertEqual(harness._cmp_key(marker, "abc123 (built 2026-06-18)\n"),
                         harness._cmp_key(marker, "abc123 (built 2026-06-17)\n"))
        # Different fingerprint -> still flagged.
        self.assertNotEqual(harness._cmp_key(marker, "abc123 (built 2026-06-18)\n"),
                            harness._cmp_key(marker, "def456 (built 2026-06-18)\n"))
        # Other owned files compare verbatim.
        self.assertNotEqual(harness._cmp_key("agents/x.md", "a (built 1)"),
                            harness._cmp_key("agents/x.md", "a (built 2)"))

    def test_default_destination_is_inside_the_deployed_dir(self):
        tmp = Path(tempfile.mkdtemp())        # stands in for ~/.config/opencode
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        path = harness._write_improvements(tmp, "neutral", self.FILES)
        self.assertEqual(path.parent, tmp / "improvements")
        self.assertRegex(path.name, r"^improvements-\d{8}-\d{6}\.md$")
        self.assertIn("- theme: neutral", path.read_text(encoding="utf-8"))

    def test_write_improvements_honours_out_path(self):
        tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        out = tmp / "deep" / "report.md"      # parent does not exist yet
        path = harness._write_improvements(Path("/cfg"), "imperial", self.FILES, out)
        self.assertEqual(path, out)
        text = out.read_text(encoding="utf-8")
        self.assertIn("- theme: imperial", text)
        self.assertIn("agents/reviewer.md", text)

    def test_export_improvements_no_install_writes_nothing(self):
        tmp = Path(tempfile.mkdtemp())        # no .geneseed-manifest.json here
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        path, files = harness.export_improvements(target=tmp)
        self.assertIsNone(path)
        self.assertIsNone(files)

    def test_flush_export_notes_prints_fresh_skips_stale(self):
        import contextlib
        import io
        tmp = Path(tempfile.mkdtemp())        # stands in for the global config dir
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        d = tmp / "improvements"
        d.mkdir()
        fresh = d / "improvements-20991231-235959.md"
        fresh.write_text("x", encoding="utf-8")
        stale = d / "improvements-20200101-000000.md"
        stale.write_text("x", encoding="utf-8")
        os.utime(stale, (0, harness._T0 - 3600))   # written before this process
        old = os.environ.get("OPENCODE_CONFIG_DIR")
        os.environ["OPENCODE_CONFIG_DIR"] = str(tmp)
        try:
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                harness._flush_export_notes()
        finally:
            if old is None:
                os.environ.pop("OPENCODE_CONFIG_DIR", None)
            else:
                os.environ["OPENCODE_CONFIG_DIR"] = old
        out = buf.getvalue()
        self.assertIn(fresh.name, out)
        self.assertIn("back-port", out)
        self.assertNotIn(stale.name, out)


class WebSubcommandTests(unittest.TestCase):
    def test_cmd_web_exists_and_callable(self):
        self.assertTrue(hasattr(harness, "cmd_web"))
        self.assertTrue(callable(harness.cmd_web))

    def test_web_subcommand_parses(self):
        # The `web` subcommand must parse and bind fn=cmd_web with theme/port/no_browser.
        import argparse
        import contextlib
        import io
        # Re-run main()'s parser build path by parsing a known-good argv via a
        # SystemExit-free probe: argparse exits on error, so catch it.
        argv = ["web", "--no-browser", "--port", "4748"]
        # harness.main() builds the parser and dispatches; we only want parsing.
        # Patch cmd_web to a no-op capturing args, then invoke main with argv.
        captured = {}
        orig = harness.cmd_web
        harness.cmd_web = lambda args: captured.update(vars(args)) or 0
        old_argv = sys.argv
        try:
            sys.argv = ["harness.py", *argv]
            with contextlib.redirect_stdout(io.StringIO()):
                rc = harness.main()
        finally:
            harness.cmd_web = orig
            sys.argv = old_argv
        self.assertEqual(rc, 0)
        self.assertEqual(captured.get("port"), 4748)
        self.assertTrue(captured.get("no_browser"))
        self.assertIsNone(captured.get("theme"))


if __name__ == "__main__":
    unittest.main()
