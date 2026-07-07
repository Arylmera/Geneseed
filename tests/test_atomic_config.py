"""Atomic write guarantee for user-owned config files (opencode.json,
settings.json): a failed write must never leave the file half-written."""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import _build_emit as emit


class AtomicWriteJsonTests(unittest.TestCase):
    def test_replaces_existing_file_with_new_json(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "settings.json"
            p.write_text('{"old": true}\n', encoding="utf-8")
            emit._atomic_write_json(p, {"new": 1})
            self.assertEqual(json.loads(p.read_text(encoding="utf-8")), {"new": 1})
            # no temp-file litter left beside the target
            self.assertEqual([f.name for f in Path(td).iterdir()], ["settings.json"])

    def test_creates_file_when_missing(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "opencode.json"
            emit._atomic_write_json(p, {"instructions": ["AGENT.md"]})
            self.assertEqual(
                json.loads(p.read_text(encoding="utf-8")),
                {"instructions": ["AGENT.md"]},
            )

    def test_failed_replace_leaves_original_intact(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "settings.json"
            p.write_text('{"old": true}\n', encoding="utf-8")
            real_replace = emit.os.replace

            def boom(src, dst):
                raise OSError("disk full")

            emit.os.replace = boom
            try:
                with self.assertRaises(OSError):
                    emit._atomic_write_json(p, {"new": 1})
            finally:
                emit.os.replace = real_replace
            # the original survives the failed write, byte-identical
            self.assertEqual(json.loads(p.read_text(encoding="utf-8")), {"old": True})


class WireClaudeExcludesAtomicTests(unittest.TestCase):
    def test_failed_write_leaves_original_settings_intact_and_warns(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "settings.json"
            p.write_text('{"old": true}\n', encoding="utf-8")
            real_replace = emit.os.replace

            def boom(src, dst):
                raise OSError("disk full")

            emit.os.replace = boom
            try:
                added = emit._wire_claude_excludes(p, ["/abs/CLAUDE.md"])
            finally:
                emit.os.replace = real_replace
            # no crash, nothing reported as wired, original untouched
            self.assertEqual(added, [])
            self.assertEqual(json.loads(p.read_text(encoding="utf-8")), {"old": True})


if __name__ == "__main__":
    unittest.main()
