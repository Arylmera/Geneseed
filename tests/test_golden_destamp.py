"""The destamp must ASSERT the shape before blanking it.

A blind `re.sub` that is too aggressive silently blanks a real difference — the failure mode
where a gate stays green because it stopped looking. Every destamp here declares the shape it
expects and RAISES when the field is present but shaped differently, so a change to the
version line's format is a loud test failure rather than a quietly widened blind spot."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import golden  # noqa: E402  (needs tests/ on the path first)


class TheVersionLineIsDestampedByShapeNotByGuess(unittest.TestCase):
    def test_a_well_formed_line_is_blanked(self):
        body = b"abc123def (built 2026-08-11) [release 1.0.0]\n"
        self.assertEqual(golden._destamp(".geneseed-version", body),
                         b"<FP> (built <DATE>) [release <REL>]\n")

    def test_a_line_of_an_unexpected_shape_RAISES(self):
        with self.assertRaises(AssertionError):
            golden._destamp(".geneseed-version", b"built yesterday\n")

    def test_a_file_that_is_not_the_version_marker_is_untouched(self):
        body = b"2026-08-11 is a date in this document\n"
        self.assertEqual(golden._destamp("AGENT.md", body), body)

    def test_a_windows_crlf_line_is_blanked_and_the_cr_is_kept(self):
        # OBSERVED, not assumed: write_text/fs.writeFileSync both write this file in text
        # mode, and on Windows that turns the trailing \n into \r\n. golden.py splits the
        # body on b"\n" before matching, so the real line carries a trailing \r that the
        # brief's original pattern did not account for — see golden.py's _VERSION_LINE
        # comment for the full story.
        body = b"abc123def (built 2026-08-11) [release 1.0.0]\r\n"
        self.assertEqual(golden._destamp(".geneseed-version", body),
                         b"<FP> (built <DATE>) [release <REL>]\r\n")

    def test_a_whitespace_only_marker_is_a_declared_shape_and_survives_verbatim(self):
        # THE CELL THAT KILLED THE `cells` JOB, reduced to its bytes.
        # `harness_golden._version_cells`'s `an-empty-marker-is-not-a-version` seeds
        # `home/.config/opencode/.geneseed-version` with exactly `"   \n"` — three spaces —
        # to exercise `cmd_version`'s `txt.split()[0] if txt else None`, where a
        # whitespace-only marker reads as ABSENT and the host walk moves to the next
        # candidate. That harness reuses `golden._snapshot`, so `_destamp` sees the seed.
        # This is why the assertion has to be widened rather than deleted, and why the
        # widening is a SECOND SHAPE and not a fall-through.
        #
        # PASSED THROUGH VERBATIM, never blanked: nothing in a blank line moves between two
        # runs, so the bytes stay under the byte comparison. `\r` is the same file written
        # by `Path.write_text` on Windows — the failure reproduces on both platforms
        # (`b'   '` on Linux, `b'   \r'` here), it is only the ubuntu-only `cells` job that
        # made it look POSIX-specific.
        for body in (b"   \n", b"   \r\n", b"\t \n", b"   "):
            with self.subTest(body=body):
                self.assertEqual(golden._destamp(".geneseed-version", body), body)

    def test_a_marker_with_junk_beside_the_whitespace_still_RAISES(self):
        # The vacuity guard on the widening above: `_VERSION_BLANK` is anchored at both
        # ends, so tolerating a blank line does not tolerate a line that merely starts or
        # ends with blanks. Without this, "widen the shape" and "stop looking" are the same
        # edit.
        for body in (b"   junk\n", b"junk   \n", b"  deadbeef  \n"):
            with self.subTest(body=body):
                with self.assertRaises(AssertionError):
                    golden._destamp(".geneseed-version", body)


if __name__ == "__main__":
    unittest.main()
