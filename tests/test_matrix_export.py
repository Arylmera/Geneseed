"""The exported cell matrices are the ones the reference actually declares — and the two
platform halves differ in exactly the declared places.

WHAT THIS GATES. `tests/export_matrix.py` writes the three matrices to JSON so the Node
replayers can read them after `build.py` and `rituals/harness.py` are gone. A committed export
that has drifted from the functions it was taken from is the worst reachable state: the Node
suite would replay a matrix nobody declares, green, forever. This file makes the drift a red
build while both sides still exist to disagree.

IT DIES AT P4 WITH ITS SUBJECT, and that is correct rather than a gap. Its whole claim is
"the file equals what these Python functions return", and after the deletion there are no
Python functions — the exported JSON becomes the OWNED matrix, exactly as `cli.json` became
`js/cli-table.json`. What survives the cut is the Node side's own gate over the same files.

THE CROSS-PLATFORM DIFF IS THE SHARPEST TEST HERE, and it needs both halves committed. Two
machines that agree on everything except a declared list are two machines whose difference is
understood; a residual anywhere else is host state that leaked into the matrix, which is the
one defect a single-platform export cannot show. The method is Task 8c's, aimed at a matrix.

BOTH DIRECTIONS OF THE DECLARATION ARE ASSERTED. A declared difference that has stopped
differing is a rotted declaration and fails here too — otherwise the exception list only ever
grows and stops describing anything.
"""
import base64
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import export_matrix  # noqa: E402
import harness_golden  # noqa: E402

MATRIX = HERE / "helpers" / "matrix"
THIS = harness_golden.this_platform()
OTHER = "posix" if THIS == "win32" else "win32"

#: The only places the two halves may differ, beyond the `PLATFORM_ONLY` cells themselves.
#: Each entry is (document, cell id, field). Every one is a site where the reference branches
#: on the host INSIDE cell data — the three the export's docstring names.
DECLARED_VALUE_DIFFS = {
    ("cli", "exclude/remove-a-case-differing-entry", "expect"),
}


def _load(name: str, plat: str):
    f = MATRIX / f"{name}.{plat}.json"
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else None


def _slash(o):
    """Backslash-insensitive view. `_np()` is `str(Path(rel))`, so every bundle-relative path
    in the CLI matrix carries the recording host's separator; that class of difference is
    expected everywhere and is not interesting anywhere. Normalising it on BOTH sides keeps
    the diff below pointed at differences that are not about separators. Literal backslashes
    that are content — a Windows path inside a hook's JSON stdin, a `\\d` in an `expect_re` —
    are normalised identically on both sides and so still compare equal to each other."""
    if isinstance(o, str):
        return o.replace("\\", "/")
    if isinstance(o, dict):
        return {k: _slash(v) for k, v in o.items()}
    if isinstance(o, list):
        return [_slash(v) for v in o]
    return o


class TheExportIsWhatTheReferenceDeclares(unittest.TestCase):
    def test_every_committed_half_for_this_host_is_current(self):
        live = export_matrix.documents()
        for name, doc in live.items():
            got = _load(name, THIS)
            self.assertIsNotNone(got, f"tests/helpers/matrix/{name}.{THIS}.json is missing — "
                                      f"run `python tests/export_matrix.py`")
            self.assertEqual(got.get("platform"), THIS)
            self.assertEqual({k: v for k, v in got.items() if k != "platform"}, doc,
                             f"{name}.{THIS}.json has drifted from what the reference "
                             f"declares — re-export it")

    def test_exporting_twice_in_two_processes_gives_the_same_bytes(self):
        """The rot detector — and TWO SUBPROCESSES, which is the whole content of the test.

        Its first draft called `export_matrix.write` twice in THIS process and passed while
        the web matrix carried `os.getpid()` in a seeded world: a detector that shares the
        varying input with the thing it is testing cannot see it. Two interpreters cannot
        share a pid, so this one can — and it is the measurement that found the only
        per-process value in any of the three matrices."""
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            for out in (a, b):
                r = subprocess.run(
                    [sys.executable, str(HERE / "export_matrix.py"), "--out", out],
                    capture_output=True, text=True, encoding="utf-8",
                    env=dict(os.environ, PYTHONUTF8="1"))
                self.assertEqual(r.returncode, 0, r.stderr)
            names = sorted(f.name for f in Path(a).iterdir())
            self.assertTrue(names, "the exporter wrote nothing")
            for name in names:
                self.assertEqual((Path(a) / name).read_bytes(),
                                 (Path(b) / name).read_bytes(),
                                 f"{name} differs between two exports — the matrix carries "
                                 f"per-process state")

    def test_the_export_seeds_the_same_bytes_the_reference_does(self):
        """The transformation the exporter declares, proved rather than described — and NOT
        as a round trip, which is the shape it cannot have.

        `"pid": {pid}` is ambiguous by construction: five sibling seeds in `_activity_world`
        already spell it that way, so substituting the literal into the placeholder is not
        invertible and an identity test would be asking the wrong question. The property that
        matters is run-time equivalence — `_subst` replaces `{pid}` with `str(os.getpid())`
        in the process that drives the cell, so a placeholder and this process's own literal
        seed IDENTICAL bytes. Applying that substitution to both sides is the assertion.

        AND THE LITERAL WOULD HAVE BEEN WRONG IN AN EXPORT, which is why this is a fidelity
        fix and not a tidy-up: a pid frozen into a committed matrix names a process that
        exited months ago, `_pid_alive` answers false, and the cell that exists to test the
        LIVE session branch would quietly test the dead one."""
        raw = export_matrix.documents(depid=False)
        for name, doc in raw.items():
            got = _load(name, THIS)
            self.assertEqual(
                export_matrix.repid({k: v for k, v in got.items() if k != "platform"}),
                export_matrix.repid(doc),
                f"{name}.{THIS}.json seeds different bytes than the reference declares")

    def test_the_substitution_touched_only_the_pid_positions(self):
        """Run-time equivalence above would also be satisfied by a transformation that turned
        some OTHER value into `{pid}`, since the substitution would put a pid back there too.
        Counting is what closes that: the export must carry exactly as many placeholders as
        the reference has placeholders plus literals, and not one more."""
        live = json.dumps(export_matrix.documents(depid=False), sort_keys=True)
        exported = json.dumps({k: v for k, v in _load("web", THIS).items() if k != "platform"},
                              sort_keys=True)
        placeholder = '\\"pid\\": {pid}'
        literal = f'\\"pid\\": {os.getpid()}'
        self.assertEqual(exported.count(placeholder),
                         live.count(placeholder) + live.count(literal))

    def test_no_recording_process_leaks_into_the_committed_matrix(self):
        """The absolute half. The round trip above proves the substitution is reversible; this
        proves it actually happened, which a reversible no-op would also satisfy."""
        for name in ("emit", "cli", "web"):
            text = (MATRIX / f"{name}.{THIS}.json").read_text(encoding="utf-8")
            self.assertNotIn(f'\\"pid\\": {os.getpid()}', text)
        self.assertIn('\\"pid\\": {pid}',
                      (MATRIX / f"web.{THIS}.json").read_text(encoding="utf-8"),
                      "the placeholder is not in the web matrix — the substitution that "
                      "makes this export reproducible has stopped firing")

    def test_bytes_survive_the_round_trip(self):
        """114 web request bodies are `bytes` and base64 is how they cross. A body that is not
        valid UTF-8 is a case those cells deliberately contain, so the tag must be lossless
        rather than convenient."""
        raw = {c["id"]: c for c in web_cells()}
        doc = {c["id"]: c for c in _load("web", THIS)["cells"]}
        n = 0
        for cid, cell in raw.items():
            for i, req in enumerate(cell.get("requests", [])):
                if not isinstance(req.get("body"), bytes):
                    continue
                n += 1
                tag = doc[cid]["requests"][i]["body"]
                self.assertEqual(base64.b64decode(tag["__b64__"]), req["body"], f"{cid}[{i}]")
        self.assertGreater(n, 0, "no web cell carried a bytes body — the encoder is untested")


class ThePlatformUnionIsDeclared(unittest.TestCase):
    def test_the_table_travels_with_the_matrix(self):
        self.assertEqual(_load("cli", THIS)["platform_only"], harness_golden.PLATFORM_ONLY)

    def test_neither_half_of_the_union_is_empty(self):
        vals = set(harness_golden.PLATFORM_ONLY.values())
        self.assertEqual(vals, {"win32", "posix"})

    def test_this_halfs_cells_are_exactly_this_platforms(self):
        ids = {c["id"] for c in _load("cli", THIS)["cells"]}
        for cid, plat in harness_golden.PLATFORM_ONLY.items():
            if plat == THIS:
                self.assertIn(cid, ids, f"{cid} is declared for {THIS} and was not exported")
            else:
                self.assertNotIn(cid, ids, f"{cid} is declared for {plat} and leaked into "
                                           f"the {THIS} export")


class TheTwoHalvesDifferOnlyWhereDeclared(unittest.TestCase):
    """Skipped, LOUDLY, until the other host has committed its half. A skip is not a pass —
    `tests/pure_snapshot.test.mjs`'s width sweep set that rule and it holds here."""

    def setUp(self):
        if _load("cli", OTHER) is None:
            self.skipTest(f"the {OTHER} half is not committed yet; it can only be recorded on "
                          f"that host, and until it is this suite has NOT checked the union")

    def test_the_emit_matrix_is_identical_on_both_hosts(self):
        """Declared platform-independent, and this is the measurement rather than the claim.
        `golden.py` branches on the host only at run time (`PLATFORM_CORPUS`), never in a
        cell."""
        a, b = _load("emit", THIS), _load("emit", OTHER)
        self.assertEqual({k: v for k, v in a.items() if k != "platform"},
                         {k: v for k, v in b.items() if k != "platform"})

    def test_every_other_difference_is_declared(self):
        found = set()
        for name in ("cli", "web"):
            a = {c["id"]: c for c in _load(name, THIS)["cells"]}
            b = {c["id"]: c for c in _load(name, OTHER)["cells"]}
            shared = set(a) & set(b)
            # The ids only one host builds are the union, asserted above; what is compared
            # here is everything both hosts claim to build identically.
            for cid in sorted(shared):
                x, y = _slash(a[cid]), _slash(b[cid])
                if x == y:
                    continue
                for field in sorted(set(x) | set(y)):
                    if x.get(field) != y.get(field):
                        found.add((name, cid, field))
        self.assertEqual(found, DECLARED_VALUE_DIFFS,
                         "the two halves differ somewhere undeclared (or a declared "
                         "difference has stopped differing, which is a rotted declaration). "
                         f"undeclared: {sorted(found - DECLARED_VALUE_DIFFS)}; "
                         f"declared and now identical: {sorted(DECLARED_VALUE_DIFFS - found)}")

    def test_only_the_declared_ids_are_one_sided(self):
        a = {c["id"] for c in _load("cli", THIS)["cells"]}
        b = {c["id"] for c in _load("cli", OTHER)["cells"]}
        self.assertEqual(a ^ b, set(harness_golden.PLATFORM_ONLY))


def web_cells():
    import web_golden
    return web_golden.cells()


if __name__ == "__main__":
    unittest.main()
