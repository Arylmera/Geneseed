"""Smoke matrix: every --emit mode, in every footprint, must build clean into a
sandboxed HOME *and produce the right shape*.

Catches per-host emit regressions that mode-specific suites don't reach. Three
classes of assertion, in increasing strength:

1. the build exits 0 and writes something (the original guarantee);
2. the carrier file lands where that host reads it, carries the Rules section,
   and carries the capability tables IFF the host is not declared
   `native_catalog` in build.HOSTS — so the declared capability and the emitted
   bytes can never drift apart;
3. the carrier stays under a per-footprint size ceiling.

(3) is the anti-bloat guard: the harness is paid for in context tokens on every
single session, so "the instructions file must not silently regrow" is an
invariant worth a failing test, not an intention. Ceilings are measured in
CHARACTERS (read_text, newline-normalised), never st_size — on Windows CRLF
inflates the byte count by ~3% and would make the ceiling platform-dependent.
"""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import build  # noqa: E402

FOOTPRINTS = ("full", "lean")

# Per-footprint ceiling on the carrier file, in characters. Tightened whenever a
# change legitimately shrinks the harness — never loosened without a reason
# stated in the commit message. Headroom is deliberately small (~4%): the point is
# to fail on the next silent regrowth, not to leave room for one.
#
# Largest carrier at each footprint today is the host-agnostic `files` bundle,
# which keeps the capability tables no host will catalogue for it:
#   full 49_072   lean 29_421
# (full raised past 49_000 by the token-report folder-skill entry — real
# capability growth, not regrowth.)
CEILING = {"full": 51_000, "lean": 30_500}

# mode -> (host or None, carrier base, carrier relpath, native-layer base+dir)
# Bases: "out" = the --out bundle, "home" = the sandboxed config dir.
# `native` is the directory holding the host's agents/ + skills/ layer, or None
# for the host-agnostic `files` bundle (which has no native layer of its own —
# its agents/ and skills/ ARE the bundle).
EXPECTED = {
    "files": (None, "out", "AGENT.md", None),
    "opencode": ("opencode", "out", "AGENT.md", ("out", ".opencode")),
    "opencode-global": ("opencode", "home", ".config/opencode/AGENT.md",
                        ("home", ".config/opencode")),
    "claude": ("claude", "out", "CLAUDE.md", ("out", ".claude")),
    "claude-global": ("claude", "home", ".claude/CLAUDE.md", ("home", ".claude")),
    "bob": ("bob", "out", "AGENTS.md", ("out", ".bob")),
    "bob-global": ("bob", "home", ".bob/rules/geneseed.md", ("home", ".bob")),
    "copilot": ("copilot", "out", "AGENTS.md", ("out", ".github")),
    "copilot-global": ("copilot", "home", ".copilot/copilot-instructions.md",
                       ("home", ".copilot")),
}

# The native layer is generated from the same source tree for every host, so the
# counts are host-independent. A mismatch means the emit dropped or duplicated
# specs — the failure mode a bare "exit 0" smoke test cannot see.
N_AGENTS = 18
N_SKILLS = 50


def _native_catalog(host: "str | None") -> bool:
    """Does this host catalogue skills/agents to the model by itself? Read from
    the HOSTS registry so the test follows the declared capability instead of
    hardcoding a second, driftable copy of it."""
    if host is None:
        return False
    return bool(build.HOSTS.get(host, {}).get("native_catalog", False))


class EmitModeSmokeTests(unittest.TestCase):
    def _build(self, mode, footprint, td):
        home = Path(td) / "home"
        home.mkdir()
        out = Path(td) / "out"
        # redirect every config-dir root a host resolver might use
        env = dict(
            os.environ,
            HOME=str(home),
            USERPROFILE=str(home),
            XDG_CONFIG_HOME=str(home / ".config"),
            APPDATA=str(home / "AppData" / "Roaming"),
            LOCALAPPDATA=str(home / "AppData" / "Local"),
        )
        env.pop("GENESEED_HARNESS", None)
        # --theme neutral pins the themed nouns the content assertions match on;
        # without it the repo's configured theme would leak into the test.
        argv = [sys.executable, str(ROOT / "build.py"), "--emit", mode,
                "--theme", "neutral", "--footprint", footprint]
        if not mode.endswith("-global"):
            argv += ["--out", str(out)]
        r = subprocess.run(argv, capture_output=True, text=True,
                           encoding="utf-8", cwd=str(ROOT), env=env)
        return r, {"out": out, "home": home}

    def test_every_emit_mode_builds_clean(self):
        for footprint in FOOTPRINTS:
            for mode in EXPECTED:
                with self.subTest(mode=mode, footprint=footprint), \
                        tempfile.TemporaryDirectory() as td:
                    r, bases = self._build(mode, footprint, td)
                    self.assertEqual(
                        r.returncode, 0,
                        f"--emit {mode} --footprint {footprint} failed:\n"
                        f"STDOUT:\n{r.stdout}\nSTDERR:\n{r.stderr}",
                    )
                    emitted = (list(Path(td).rglob("AGENT*.md"))
                               + list(Path(td).rglob(".geneseed-manifest.json")))
                    self.assertTrue(
                        emitted,
                        f"--emit {mode} wrote nothing inside the sandbox {td}",
                    )

    def test_carrier_lands_where_the_host_reads_it(self):
        for footprint in FOOTPRINTS:
            for mode, (_host, base, rel, _native) in EXPECTED.items():
                with self.subTest(mode=mode, footprint=footprint), \
                        tempfile.TemporaryDirectory() as td:
                    r, bases = self._build(mode, footprint, td)
                    self.assertEqual(r.returncode, 0, r.stderr)
                    carrier = bases[base] / rel
                    self.assertTrue(
                        carrier.is_file(),
                        f"--emit {mode}: no carrier at {base}/{rel}",
                    )
                    text = carrier.read_text(encoding="utf-8")
                    self.assertIn(
                        "## 1. ", text,
                        f"--emit {mode}: carrier carries no Rules section",
                    )

    def test_capability_tables_match_the_declared_host_capability(self):
        """The catalogue tables must be present exactly where the host does NOT
        catalogue skills natively. A host declared `native_catalog` that still
        ships the tables is paying ~2.7k tokens twice; a host NOT declared that
        loses them has lost its only discovery mechanism."""
        for mode, (host, base, rel, _native) in EXPECTED.items():
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as td:
                r, bases = self._build(mode, "full", td)
                self.assertEqual(r.returncode, 0, r.stderr)
                text = (bases[base] / rel).read_text(encoding="utf-8")
                has_tables = "| Skill | Trigger |" in text
                if _native_catalog(host):
                    self.assertFalse(
                        has_tables,
                        f"--emit {mode}: host '{host}' declares native_catalog "
                        f"but the carrier still ships the Skills table",
                    )
                else:
                    self.assertTrue(
                        has_tables,
                        f"--emit {mode}: host '{host}' does not catalogue "
                        f"natively, so the Skills table is its only discovery "
                        f"path — it must not be stripped",
                    )

    def test_carrier_stays_under_the_footprint_ceiling(self):
        for footprint in FOOTPRINTS:
            for mode, (_host, base, rel, _native) in EXPECTED.items():
                with self.subTest(mode=mode, footprint=footprint), \
                        tempfile.TemporaryDirectory() as td:
                    r, bases = self._build(mode, footprint, td)
                    self.assertEqual(r.returncode, 0, r.stderr)
                    n = len((bases[base] / rel).read_text(encoding="utf-8"))
                    self.assertLessEqual(
                        n, CEILING[footprint],
                        f"--emit {mode} --footprint {footprint}: carrier is "
                        f"{n} chars, over the {CEILING[footprint]} ceiling — "
                        f"the harness is paid for on every session",
                    )

    def test_native_layer_is_complete(self):
        for mode, (_host, _base, _rel, native) in EXPECTED.items():
            if native is None:
                continue
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as td:
                r, bases = self._build(mode, "full", td)
                self.assertEqual(r.returncode, 0, r.stderr)
                cfg = bases[native[0]] / native[1]
                skills = len(list((cfg / "skills").glob("*/SKILL.md")))
                agents = len(list((cfg / "agents").glob("*.md")))
                self.assertEqual(
                    skills, N_SKILLS,
                    f"--emit {mode}: {skills} native skills, expected {N_SKILLS}")
                self.assertEqual(
                    agents, N_AGENTS,
                    f"--emit {mode}: {agents} native agents, expected {N_AGENTS}")

    def test_bob_project_rules_stub_stays_a_stub(self):
        """Bob PROJECT scope: the repo-root AGENTS.md is the preamble, and
        .bob/rules/geneseed.md exists only to shadow the global copy. If it ever
        grows into a second full preamble, Bob loads the harness twice."""
        with tempfile.TemporaryDirectory() as td:
            r, bases = self._build("bob", "full", td)
            self.assertEqual(r.returncode, 0, r.stderr)
            stub = bases["out"] / ".bob" / "rules" / "geneseed.md"
            self.assertTrue(stub.is_file())
            self.assertLess(
                len(stub.read_text(encoding="utf-8")), 1_000,
                "the Bob project rules stub has grown into a full preamble")


if __name__ == "__main__":
    unittest.main()
