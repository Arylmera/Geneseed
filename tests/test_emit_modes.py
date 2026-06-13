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
        # AGENT.md keeps its prose but the per-row spec links are de-linked to names.
        agent_md = (out / "AGENT.md").read_text(encoding="utf-8")
        self.assertEqual(build.CAPABILITY_LINK_RE.findall(agent_md), [])

    def test_reemit_wipes_opencode_dir(self):
        out = self.d / "bundle"
        _quiet(build.emit_opencode, "neutral", out, self.d)
        stale = self.d / ".opencode" / "agents" / "ghost.md"
        stale.write_text("stale", encoding="utf-8")
        _quiet(build.emit_opencode, "neutral", out, self.d)
        self.assertFalse(stale.exists(), ".opencode/ is owned and must be wiped on re-emit")


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
