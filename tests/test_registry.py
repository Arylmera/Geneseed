"""Unit tests for the three source-wide authoring gates added with the entity
registry: registry coverage/field validity, the credential sweep, and the vendored
upstream pins. Stdlib unittest only.

Each gate is tested BOTH ways — clean on the shipped tree, and actually firing on a
planted fault — because a gate that only ever returns [] is indistinguishable from a
gate that is silently broken.

Run from the Geneseed root:  python -m unittest discover -s tests
"""
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "rituals"))
sys.path.insert(0, str(ROOT))
import build  # noqa: E402
import harness  # noqa: E402
import _harness_build  # noqa: E402  the namespace whose ROOT the gates read
import _harness_tui  # noqa: E402


def _row(**over) -> dict:
    row = {"status": "approved", "version": "1.0.0", "owner": "Someone",
           "added": "2026-01-01", "last_verified": ""}
    row.update(over)
    return row


class _FakeTree:
    """A temp repo root with src/agents, src/skills and the three other scanned trees,
    wired into build.* and _harness_build.ROOT for the duration of the `with` block."""

    def __init__(self, agents=(), skills=(), vendored=()):
        self.agents, self.skills, self.vendored = agents, skills, vendored

    def __enter__(self):
        self.root = Path(tempfile.mkdtemp())
        for sub in ("src/agents", "src/skills", "themes", "plugins", "workflows"):
            (self.root / sub).mkdir(parents=True)
        for name in self.agents:
            (self.root / "src/agents" / f"{name}.md").write_text("> p", encoding="utf-8")
        for name in self.skills:
            (self.root / "src/skills" / f"{name}.md").write_text("> p", encoding="utf-8")
        for name in self.vendored:
            (self.root / "src/skills" / name).mkdir()
        self._patches = [
            mock.patch.object(_harness_build, "ROOT", self.root),
            mock.patch.object(build, "SRC", self.root / "src"),
            mock.patch.object(build, "THEMES", self.root / "themes"),
            mock.patch.object(build, "PLUGIN_SRC", self.root / "plugins"),
            mock.patch.object(build, "WORKFLOW_SRC", self.root / "workflows"),
            mock.patch.object(build, "VENDORED_SKILL_DIRS", tuple(self.vendored)),
        ]
        for p in self._patches:
            p.start()
        return self

    def __exit__(self, *exc):
        for p in self._patches:
            p.stop()
        shutil.rmtree(self.root, ignore_errors=True)

    def write_registry(self, entities: dict) -> None:
        (self.root / "registry.json").write_text(
            json.dumps({"entities": entities}), encoding="utf-8")

    def vendor_md(self, name: str, text: str) -> None:
        (self.root / "src/skills" / name / "VENDOR.md").write_text(text, encoding="utf-8")


PINNED = ("- **Upstream:** https://example.invalid/x\n"
          "- **Commit:** " + "a" * 40 + "\n"
          "- **License:** MIT\n")


class RegistryGateTests(unittest.TestCase):
    def test_shipped_registry_is_clean(self):
        self.assertEqual(harness._registry_problems(), [])

    def test_every_shipped_entity_has_a_row(self):
        """The count the gate guards, asserted independently of the gate itself."""
        entities = json.loads((ROOT / "registry.json").read_text(encoding="utf-8"))["entities"]
        self.assertEqual(set(entities), harness._registry_keys())

    def test_flags_missing_row_and_orphan_row(self):
        with _FakeTree(agents=("reviewer",), skills=("commit",)) as t:
            t.write_registry({"agents/reviewer": _row(), "skills/ghost": _row()})
            problems = harness._registry_problems()
        self.assertTrue(any("skills/commit has no row" in p for p in problems), problems)
        self.assertTrue(any("'skills/ghost'" in p and "no such entity" in p
                            for p in problems), problems)

    def test_vendored_folders_need_a_row_too(self):
        with _FakeTree(vendored=("daydream",)) as t:
            t.write_registry({})
            problems = harness._registry_problems()
        self.assertTrue(any("skills/daydream has no row" in p for p in problems), problems)

    def test_flags_malformed_fields(self):
        with _FakeTree(agents=("a", "b", "c", "d")) as t:
            t.write_registry({
                "agents/a": _row(status="retired"),
                "agents/b": _row(version="1.0"),
                "agents/c": _row(owner="  "),
                "agents/d": _row(last_verified="last tuesday"),
            })
            problems = harness._registry_problems()
        self.assertTrue(any("'retired'" in p and "status" in p for p in problems), problems)
        self.assertTrue(any("agents/b" in p and "semver" in p for p in problems), problems)
        self.assertTrue(any("agents/c" in p and "owner" in p for p in problems), problems)
        self.assertTrue(any("agents/d" in p and "ISO date" in p for p in problems), problems)

    def test_empty_last_verified_is_accepted(self):
        with _FakeTree(agents=("a",)) as t:
            t.write_registry({"agents/a": _row(last_verified="")})
            self.assertEqual(harness._registry_problems(), [])

    def test_flags_absent_and_corrupt_registry(self):
        with _FakeTree(agents=("a",)) as t:
            self.assertTrue(any("unreadable" in p for p in harness._registry_problems()))
            (t.root / "registry.json").write_text("{not json", encoding="utf-8")
            self.assertTrue(any("not valid JSON" in p for p in harness._registry_problems()))
            (t.root / "registry.json").write_text("{}", encoding="utf-8")
            self.assertTrue(any("no 'entities'" in p for p in harness._registry_problems()))


class SecretSweepTests(unittest.TestCase):
    def test_shipped_source_carries_no_credential(self):
        self.assertEqual(harness._secret_problems(), [])

    def test_flags_a_planted_credential_without_echoing_it(self):
        planted = "ghp_" + "b" * 36
        with _FakeTree() as t:
            (t.root / "src" / "leak.md").write_text(f"token\n{planted}\n", encoding="utf-8")
            problems = harness._secret_problems()
        self.assertEqual(len(problems), 1, problems)
        self.assertIn("src/leak.md:2", problems[0])
        self.assertIn("GitHub token", problems[0])
        # The whole point: the report must not republish the credential into CI logs.
        self.assertNotIn(planted, problems[0])

    def test_sweeps_every_shipped_tree(self):
        with _FakeTree() as t:
            for sub in ("src", "themes", "plugins", "workflows"):
                (t.root / sub / "x.txt").write_text(
                    'password = "hunter2-hunter2"\n', encoding="utf-8")
            problems = harness._secret_problems()
        self.assertEqual(len(problems), 4, problems)

    def test_ignores_binary_files(self):
        with _FakeTree() as t:
            (t.root / "src" / "blob.bin").write_bytes(b"\xff\xfe\x00sk-ant-" + b"c" * 30)
            self.assertEqual(harness._secret_problems(), [])


class VendorPinTests(unittest.TestCase):
    def test_shipped_vendored_folders_are_pinned(self):
        self.assertEqual(harness._vendor_pin_problems(), [])

    def test_flags_missing_vendor_md(self):
        with _FakeTree(vendored=("orphan",)):
            problems = harness._vendor_pin_problems()
        self.assertTrue(any("no VENDOR.md" in p for p in problems), problems)

    def test_flags_moving_branch_pin(self):
        with _FakeTree(vendored=("v",)) as t:
            t.vendor_md("v", "- **Upstream:** https://example.invalid/x\n"
                             "- **Commit:** main\n- **License:** MIT\n")
            problems = harness._vendor_pin_problems()
        self.assertTrue(any("moving branch" in p for p in problems), problems)

    def test_flags_short_pin_and_missing_license(self):
        with _FakeTree(vendored=("v",)) as t:
            t.vendor_md("v", "- **Upstream:** https://example.invalid/x\n"
                             "- **Commit:** abc1234\n")
            problems = harness._vendor_pin_problems()
        self.assertTrue(any("40-character" in p for p in problems), problems)
        self.assertTrue(any("License" in p for p in problems), problems)

    def test_first_party_folder_needs_no_pin(self):
        with _FakeTree(vendored=("mine",)) as t:
            t.vendor_md("mine", "- **Upstream:** this repository (first-party)\n"
                                "- **License:** same as Geneseed\n")
            self.assertEqual(harness._vendor_pin_problems(), [])

    def test_accepts_a_proper_pin(self):
        with _FakeTree(vendored=("v",)) as t:
            t.vendor_md("v", PINNED)
            self.assertEqual(harness._vendor_pin_problems(), [])

    def test_flags_a_listed_folder_that_does_not_exist(self):
        with _FakeTree() as t:  # noqa: F841
            with mock.patch.object(build, "VENDORED_SKILL_DIRS", ("gone",)):
                problems = harness._vendor_pin_problems()
        self.assertTrue(any("does not exist" in p for p in problems), problems)


class EntityStatusTests(unittest.TestCase):
    def test_status_of_a_known_entity(self):
        registry = _harness_tui.load_registry()
        self.assertEqual(_harness_tui.entity_status(registry, "skills/rule"), "experimental")
        self.assertEqual(_harness_tui.entity_status(registry, "skills/commit"), "approved")

    def test_unknown_key_and_unusable_rows_degrade_to_unknown(self):
        self.assertEqual(_harness_tui.entity_status({}, "skills/nope"), "unknown")
        self.assertEqual(_harness_tui.entity_status({"a": "nope"}, "a"), "unknown")
        self.assertEqual(_harness_tui.entity_status({"a": {"status": "x"}}, "a"), "unknown")

    def test_corrupt_registry_loads_as_empty(self):
        with _FakeTree() as t:
            (t.root / "registry.json").write_text("{oops", encoding="utf-8")
            with mock.patch.object(build, "ROOT", t.root):
                self.assertEqual(_harness_tui.load_registry(), {})

    def test_inventory_carries_a_status_for_every_entity(self):
        inv = harness._tui_inventory("neutral")
        entries = inv["agents"] + inv["skills"]
        self.assertTrue(entries)
        for e in entries:
            self.assertIn(e["status"], _harness_tui.ENTITY_STATUSES, e["name"])


if __name__ == "__main__":
    unittest.main()
