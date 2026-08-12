import tempfile
import unittest
from pathlib import Path

import snapshot_io


class ASnapshotRoundTrips(unittest.TestCase):
    def test_identical_snapshots_compare_clean(self):
        snap = {"a/b.md": b"hello\n", "<stdout>": b"ok\n", "<exit>": b"0"}
        with tempfile.TemporaryDirectory() as td:
            snapshot_io.write(Path(td), "cell-1", snap, verbatim={"<stdout>", "<exit>"})
            rec = snapshot_io.read(Path(td), "cell-1")
            self.assertEqual(snapshot_io.compare(rec, snap), [])

    def test_a_changed_byte_is_reported_by_path(self):
        snap = {"a/b.md": b"hello\n"}
        with tempfile.TemporaryDirectory() as td:
            snapshot_io.write(Path(td), "cell-1", snap, verbatim=set())
            rec = snapshot_io.read(Path(td), "cell-1")
            problems = snapshot_io.compare(rec, {"a/b.md": b"HELLO\n"})
            self.assertEqual(len(problems), 1)
            self.assertIn("a/b.md", problems[0])

    def test_a_missing_and_an_extra_path_are_both_reported(self):
        with tempfile.TemporaryDirectory() as td:
            snapshot_io.write(Path(td), "c", {"kept": b"1", "gone": b"2"}, verbatim=set())
            rec = snapshot_io.read(Path(td), "c")
            problems = snapshot_io.compare(rec, {"kept": b"1", "new": b"3"})
            self.assertEqual(len(problems), 2)
            self.assertTrue(any("gone" in p for p in problems))
            self.assertTrue(any("new" in p for p in problems))

    def test_an_unrecorded_cell_reads_as_None(self):
        with tempfile.TemporaryDirectory() as td:
            self.assertIsNone(snapshot_io.read(Path(td), "never-recorded"))


if __name__ == "__main__":
    unittest.main()
