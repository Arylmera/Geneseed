"""The destamp must ASSERT before it passes anything through.

A blind `re.sub` that is too aggressive silently blanks a real difference — the failure mode
where a gate stays green because it stopped looking. But the assertion has to be about the
thing that actually threatens a recorded corpus, and dc00083 aimed it at the wrong axis: it
demanded the canonical SHAPE of every line, which the harnesses' synthetic marker fixtures do
not have, so each new fixture bolted on another declared shape and shape three implied shape
four. The narrow property is that a line the destamp does not blank must carry nothing that
MOVES — no build date, no live-shaped source fingerprint. Everything else is left verbatim,
which keeps it fully under the byte comparison rather than erasing it."""
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

    def test_a_line_of_an_unexpected_shape_carrying_a_DATE_raises(self):
        # THE RULE THAT REPLACED "any unexpected shape raises". A date is what actually rots a
        # recorded corpus — `write_version` stamps TODAY'S — so a `YYYY-MM-DD` that escapes the
        # canonical `(built ...)` bracket has to be loud, whatever the rest of the line looks
        # like. `b"built yesterday\n"` is deliberately NOT here: it is an odd line that cannot
        # move, and the covering test below proves it now survives verbatim.
        for body in (b"built 2026-08-11\n", b"# stamped 2026-08-11 by hand\n",
                     b"2026-08-11\r\n", b"deadbeef (built 2026-08-11)-ish\n"):
            with self.subTest(body=body):
                with self.assertRaises(AssertionError):
                    golden._destamp(".geneseed-version", body)

    def test_a_line_carrying_a_LIVE_SHAPED_FINGERPRINT_raises(self):
        # `source_fingerprint()` is `hexdigest()[:12]` and `sourceFingerprint()` is
        # `slice(0, 12)` — exactly twelve lowercase hex characters in BOTH implementations.
        # Outside the canonical line that token is unblanked and moves with every `src/` edit.
        for body in (b"abc123def456\n", b"legacy: abc123def456\r\n", b"000000000000\n"):
            with self.subTest(body=body):
                with self.assertRaises(AssertionError):
                    golden._destamp(".geneseed-version", body)

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

    def test_the_harnesses_SYNTHETIC_MARKERS_survive_verbatim(self):
        # EVERY SYNTHETIC MARKER THE THREE HARNESSES SEED, reduced to its bytes. Both of these
        # took down the `cells` job in turn, and each one used to cost a new declared shape.
        #
        #   * `"   \n"` — `harness_golden.py:1182`, `an-empty-marker-is-not-a-version`, which
        #     exercises `cmd_version`'s `txt.split()[0] if txt else None`: a whitespace-only
        #     marker reads as ABSENT and the host walk moves to the next candidate.
        #   * `"0000000000000000"` — `web_golden.py:339`, a fingerprint no source render can
        #     produce, so the version verdict is the stable "differs" arm rather than a race
        #     against whatever the checkout currently hashes to. Sixteen hex characters, and
        #     the reason the fingerprint test is EXACTLY-twelve rather than at-least-twelve.
        #
        # Both harnesses reach `_destamp` through `golden._snapshot`, so it sees both seeds.
        # VERBATIM is asserted, not merely "did not raise": these values are constant across
        # both implementations and across days, so leaving the bytes alone keeps them under the
        # byte comparison in full, which is strictly better than blanking them. `\r` is the same
        # file written by `Path.write_text` on Windows — the whitespace failure reproduced on
        # both platforms (`b'   '` on Linux, `b'   \r'` here); only the `cells` job is
        # ubuntu-only, not the defect.
        for body in (b"   \n", b"   \r\n", b"\t \n", b"   ",
                     b"0000000000000000", b"0000000000000000\n", b"0000000000000000\r\n",
                     b"", b"\n"):
            with self.subTest(body=body):
                self.assertEqual(golden._destamp(".geneseed-version", body), body)

    def test_an_odd_but_IMMOBILE_line_survives_verbatim(self):
        # The other half of the redesign, and the one dc00083 got backwards. A line can be
        # unrecognisable and still be perfectly safe to record, because nothing in it moves.
        # Blanking it, or raising on it, would cost comparison coverage for no gain.
        for body in (b"built yesterday\n", b"junk   \n", b"  deadbeef  \n"):
            with self.subTest(body=body):
                self.assertEqual(golden._destamp(".geneseed-version", body), body)

    def test_a_multi_line_marker_blanks_the_stamp_and_keeps_the_rest(self):
        # The vacuity guard on "verbatim": passing lines through must not disable the blanking
        # of the ones that DO match. Without this, "stop raising" and "stop looking" would be
        # the same edit — which is the whole failure dc00083 was written against.
        body = b"abc123def456789 (built 2026-08-11) [release 1.0.0]\n0000000000000000\n"
        self.assertEqual(golden._destamp(".geneseed-version", body),
                         b"<FP> (built <DATE>) [release <REL>]\n0000000000000000\n")


if __name__ == "__main__":
    unittest.main()
