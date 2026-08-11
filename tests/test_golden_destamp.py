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


if __name__ == "__main__":
    unittest.main()
