"""Fixture tests for the three emit modes (build.py). Stdlib unittest only — no deps.

These exercise the *whole-tree* behaviour of each emit — what files land, that a
rebuild leaves no stale files behind, and (for the global emit) that the ownership
manifest prunes only what it owns while never touching the memory/notebook stores.
They complement test_build.py's unit-level coverage of the render pipeline.

Run from the Geneseed root:  python -m unittest discover -s tests
"""
import contextlib
import io
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import build  # noqa: E402


def _quiet(fn, *a, **kw):
    """Run an emit, swallowing its progress prints so the test log stays clean."""
    with contextlib.redirect_stdout(io.StringIO()):
        return fn(*a, **kw)


class _Tmp(unittest.TestCase):
    def setUp(self):
        self.d = Path(tempfile.mkdtemp())
        # The primary/commands layers are opt-in via env; pin them off so the owned
        # set is deterministic regardless of the runner's environment.
        self._saved = {k: os.environ.pop(k, None) for k in ("GENESEED_PRIMARY", "GENESEED_COMMANDS")}

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)
        for k, v in self._saved.items():
            if v is not None:
                os.environ[k] = v


class FilesEmitTests(_Tmp):
    """`build` — the portable plain-folder bundle."""

    def test_writes_core_tree(self):
        out = self.d / "Harness"
        _quiet(build.build, "neutral", out)
        self.assertTrue((out / "AGENT.md").is_file())
        for sub in ("laws", "agents", "skills"):
            self.assertTrue((out / sub).is_dir(), f"{sub}/ missing")
        self.assertTrue((out / "agents" / "reviewer.md").is_file())
        self.assertTrue((out / "skills" / "commit.md").is_file())
        self.assertTrue((out / "memory" / "MEMORY.md").is_file())

    def test_rebuild_prunes_stale_owned_files(self):
        out = self.d / "Harness"
        _quiet(build.build, "neutral", out)
        stale = out / "agents" / "ghost-agent.md"
        stale.write_text("not from source", encoding="utf-8")
        _quiet(build.build, "neutral", out)            # owned dirs are wiped + rewritten
        self.assertFalse(stale.exists(), "stale file in an owned dir survived a rebuild")
        self.assertTrue((out / "agents" / "reviewer.md").is_file())

    def test_agent_files_match_agent_md_table(self):
        """The hand-authored AGENT.md tables and the globbed specs stay in agreement:
        every capability the table links to has a rendered file (no dead links), and
        every rendered spec is referenced by the table (no orphan the table forgot)."""
        import re
        out = self.d / "Harness"
        _quiet(build.build, "neutral", out)
        agent_md = (out / "AGENT.md").read_text(encoding="utf-8")
        # Path stems the table's per-row links target, e.g. `agents/reviewer.md` -> reviewer.
        linked = set(re.findall(r"\((?:agents|skills)/([A-Za-z0-9_-]+)\.md\)", agent_md))
        linked.discard("_template")                    # the prose scaffold link, not a capability
        # Files actually rendered under agents/ and skills/ (sans README/_template scaffolds).
        on_disk = {p.stem for p in (out / "agents").glob("*.md") if not p.name.startswith("_")}
        on_disk |= {p.stem for p in (out / "skills").glob("*.md") if not p.name.startswith("_")}
        self.assertEqual(linked - on_disk, set(), "AGENT.md links to a missing spec file")
        self.assertEqual(on_disk - linked, set(), "a rendered spec is missing from the AGENT.md table")


class OpencodePerRepoTests(_Tmp):
    """`emit_opencode` — the per-repo `.opencode/` native layer."""

    def test_writes_native_layer_and_config(self):
        out = self.d / "bundle"
        _quiet(build.emit_opencode, "neutral", out, self.d)
        oc = self.d / ".opencode"
        self.assertTrue((oc / "agents" / "reviewer.md").is_file())
        self.assertTrue((oc / "skills" / "commit" / "SKILL.md").is_file())
        cfg = json.loads((self.d / "opencode.json").read_text(encoding="utf-8"))
        self.assertIn("AGENT.md", json.dumps(cfg.get("instructions", "")))
        self.assertIs(cfg.get("lsp"), True)            # code intelligence enabled (all built-in servers)
        # AGENT.md keeps its prose but the per-row spec links are de-linked to names.
        agent_md = (out / "AGENT.md").read_text(encoding="utf-8")
        self.assertEqual(build.CAPABILITY_LINK_RE.findall(agent_md), [])

    def test_manifest_tracks_owned_files(self):
        out = self.d / "bundle"
        _quiet(build.emit_opencode, "neutral", out, self.d)
        manifest = self.d / ".opencode" / build.GLOBAL_MANIFEST
        self.assertTrue(manifest.is_file())
        owned = set(json.loads(manifest.read_text(encoding="utf-8"))["owned"])
        self.assertIn("agents/reviewer.md", owned)
        self.assertIn("skills/commit/SKILL.md", owned)

    def test_reemit_prunes_stale_owned_file(self):
        """A file this layer owned on a previous run but no longer produces (a removed
        agent, a stale manifest entry) is pruned on re-emit — write-before-delete."""
        out = self.d / "bundle"
        _quiet(build.emit_opencode, "neutral", out, self.d)
        ghost = self.d / ".opencode" / "agents" / "ghost.md"
        ghost.write_text("from an older harness", encoding="utf-8")
        manifest = self.d / ".opencode" / build.GLOBAL_MANIFEST
        data = json.loads(manifest.read_text(encoding="utf-8"))
        data["owned"] = sorted(set(data["owned"]) | {"agents/ghost.md"})
        manifest.write_text(json.dumps(data), encoding="utf-8")

        _quiet(build.emit_opencode, "neutral", out, self.d)
        self.assertFalse(ghost.exists(), "a stale owned file was not pruned on re-emit")
        new_owned = set(json.loads(manifest.read_text(encoding="utf-8"))["owned"])
        self.assertNotIn("agents/ghost.md", new_owned)
        self.assertIn("agents/reviewer.md", new_owned)   # real specs survive

    def test_user_authored_file_survives_reemit_with_warning(self):
        """A pre-existing file under `.opencode/` that was never in the manifest is the
        user's own (a hand-added agent) — claim-on-create leaves it untouched and warns,
        instead of the old full-wipe silently destroying it."""
        out = self.d / "bundle"
        _quiet(build.emit_opencode, "neutral", out, self.d)
        mine = self.d / ".opencode" / "agents" / "reviewer.md"   # collides with a real spec name
        mine.write_text("my own hand-authored reviewer agent", encoding="utf-8")
        manifest = self.d / ".opencode" / build.GLOBAL_MANIFEST
        data = json.loads(manifest.read_text(encoding="utf-8"))
        data["owned"] = sorted(set(data["owned"]) - {"agents/reviewer.md"})   # simulate: never ours
        manifest.write_text(json.dumps(data), encoding="utf-8")

        buf = io.StringIO()
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(buf):
            build.emit_opencode("neutral", out, self.d)
        self.assertEqual(mine.read_text(encoding="utf-8"), "my own hand-authored reviewer agent",
                         "a user-authored file must survive a re-emit untouched")
        self.assertIn("kept your existing", buf.getvalue())
        new_owned = set(json.loads(manifest.read_text(encoding="utf-8"))["owned"])
        self.assertNotIn("agents/reviewer.md", new_owned, "never claimed into the manifest")

    def test_theme_change_prunes_old_theme_files(self):
        """Re-emitting under a different theme name removes the old geneseed-<theme>.json
        (it's no longer in the owned set) while the color themes (theme-independent) and
        a genuine user theme both survive."""
        out = self.d / "bundle"
        _quiet(build.emit_opencode, "neutral", out, self.d)
        themes = self.d / ".opencode" / "themes"
        old_theme = themes / "geneseed-neutral.json"
        self.assertTrue(old_theme.is_file())
        _quiet(build.emit_opencode, "imperial", out, self.d)
        self.assertFalse(old_theme.exists(), "the old theme's own file must be pruned")
        self.assertTrue((themes / "geneseed-imperial.json").is_file())
        self.assertTrue((themes / "geneseed-catppuccin-solid.json").is_file())

    def test_legacy_manifestless_install_preserves_unknown_files(self):
        """Migration: an install from the wipe-and-rebuild era has no manifest. The
        first re-emit over it must NOT wipe `.opencode/` — with old_owned reading as
        empty, claim-on-create treats EVERY already-existing file (a genuinely
        hand-added one, but also every still-current Geneseed spec, since the emit has
        no record of having written them before) as the user's, conservatively skipping
        it rather than refreshing it. Nothing is deleted either way, and a manifest is
        bootstrapped from what THIS run actually wrote — so freshly-created files (a
        theme, a plugin, anything not already on disk pre-migration) are tracked and
        pruned normally from here on. This mirrors the pre-existing Claude/Bob engine's
        own migration behaviour (same claim-on-create machinery), not a new limitation."""
        out = self.d / "bundle"
        _quiet(build.emit_opencode, "neutral", out, self.d)
        manifest = self.d / ".opencode" / build.GLOBAL_MANIFEST
        manifest.unlink()   # simulate a pre-manifest legacy install
        unknown = self.d / ".opencode" / "agents" / "my-legacy-agent.md"
        unknown.write_text("hand-added long ago", encoding="utf-8")
        reviewer = self.d / ".opencode" / "agents" / "reviewer.md"
        original_reviewer = reviewer.read_text(encoding="utf-8")

        _quiet(build.emit_opencode, "neutral", out, self.d)
        self.assertTrue(unknown.is_file(), "an unrecognised file must survive the first "
                        "post-upgrade re-emit, not be wiped")
        # The pre-existing spec file is untouched too (conservative claim-on-create) —
        # not deleted, not required to be re-claimed on this very first pass.
        self.assertEqual(reviewer.read_text(encoding="utf-8"), original_reviewer)
        self.assertTrue(manifest.is_file(), "the manifest is bootstrapped on this re-emit")
        owned = set(json.loads(manifest.read_text(encoding="utf-8"))["owned"])
        # Files that already existed pre-migration (both the genuine hand-added one and
        # every already-current spec) are never claimed on this pass — but a freshly
        # produced file (nothing on disk to collide with) IS tracked from run one.
        self.assertNotIn("agents/reviewer.md", owned)
        self.assertNotIn("agents/my-legacy-agent.md", owned)
        self.assertIn("themes/geneseed-neutral.json", owned)

    def test_color_themes_emit_both_flavours(self):
        out = self.d / "bundle"
        _quiet(build.emit_opencode, "neutral", out, self.d)
        themes = self.d / ".opencode" / "themes"
        names = [p.stem for p in build.color_theme_files()]
        self.assertTrue(names, "expected curated colour themes to ship")
        for name in names:
            solid = json.loads((themes / f"geneseed-{name}-solid.json").read_text())["theme"]
            trans = json.loads((themes / f"geneseed-{name}-transparent.json").read_text())["theme"]
            # transparent flips the panel backgrounds to the terminal default…
            self.assertEqual(trans["background"], "none")
            self.assertNotEqual(solid["background"], "none")
            # …but keeps diff +/- line backgrounds tinted (legibility) and accents identical.
            self.assertEqual(trans["diffAddedBg"], solid["diffAddedBg"])
            self.assertEqual(trans["primary"], solid["primary"])

    def test_user_theme_survives_rebuild(self):
        out = self.d / "bundle"
        _quiet(build.emit_opencode, "neutral", out, self.d)
        themes = self.d / ".opencode" / "themes"
        # A user theme is any file that is never in the owned manifest (claim-on-create)
        # — preserved whether or not it carries the geneseed- prefix (CLI now brands
        # them geneseed-). Formerly done via a snapshot/restore special-case (spec §8.2);
        # now it falls straight out of the general manifest-diff prune, since nothing
        # unrecognised is ever written to the manifest in the first place.
        plain = themes / "mybrand.json"
        branded = themes / "geneseed-mybrand.json"
        plain.write_text('{"theme":{"primary":"#abcabc"}}', encoding="utf-8")
        branded.write_text('{"theme":{"primary":"#defdef"}}', encoding="utf-8")
        _quiet(build.emit_opencode, "imperial", out, self.d)   # rebuild, even switching theme
        self.assertIn("#abcabc", plain.read_text(encoding="utf-8"))
        self.assertIn("#defdef", branded.read_text(encoding="utf-8"))
        # …while a shipped theme the emit owns is regenerated, not the stale snapshot.
        self.assertTrue((themes / "geneseed-catppuccin-solid.json").is_file())


class OpencodeGlobalTests(_Tmp):
    """`emit_opencode_global` — the shared-config deployment with an ownership manifest."""

    def _emit(self):
        _quiet(build.emit_opencode_global, "neutral", None, self.d)

    def test_manifest_tracks_owned_not_stores(self):
        self._emit()
        manifest = self.d / build.GLOBAL_MANIFEST
        self.assertTrue(manifest.is_file())
        owned = set(json.loads(manifest.read_text(encoding="utf-8"))["owned"])
        self.assertIn("AGENT.md", owned)
        self.assertIn("agents/reviewer.md", owned)
        self.assertIn("skills/commit/SKILL.md", owned)
        # The memory + notebook stores exist but are NEVER listed (never pruned).
        self.assertTrue((self.d / "memory").is_dir())
        self.assertTrue((self.d / "notebook").is_dir())
        self.assertFalse(any(o.startswith("memory/") for o in owned))
        self.assertFalse(any(o.startswith("notebook/") for o in owned))

    def test_reemit_prunes_only_stale_owned(self):
        self._emit()
        # Forge a previous-run owned file the current source no longer produces.
        ghost = self.d / "agents" / "ghost.md"
        ghost.write_text("from an older harness", encoding="utf-8")
        mpath = self.d / build.GLOBAL_MANIFEST
        data = json.loads(mpath.read_text(encoding="utf-8"))
        data["owned"] = sorted(set(data["owned"]) | {"agents/ghost.md"})
        mpath.write_text(json.dumps(data), encoding="utf-8")

        self._emit()                                    # re-emit should prune the ghost
        self.assertFalse(ghost.exists(), "a stale owned file was not pruned on re-emit")
        new_owned = set(json.loads(mpath.read_text(encoding="utf-8"))["owned"])
        self.assertNotIn("agents/ghost.md", new_owned)
        self.assertIn("agents/reviewer.md", new_owned)  # real specs survive

    def test_reemit_preserves_memory_store(self):
        self._emit()
        fact = self.d / "memory" / "kept-fact.md"
        fact.write_text("---\nname: kept-fact\n---\nremember me", encoding="utf-8")
        self._emit()
        self.assertTrue(fact.is_file(), "the memory store must never be wiped on re-emit")


if __name__ == "__main__":
    unittest.main()
