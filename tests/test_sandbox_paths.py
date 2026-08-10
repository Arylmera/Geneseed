"""The two properties `golden.sandbox()` adds to a temp dir, and the wiring that carries
them to every harness.

WHY THIS FILE EXISTS. The port was green on two machines and red on the first one that was
neither. Both Windows failures in that CI run — 49 byte comparisons in
`tests/test_emit_boundary.py` and the `git-gate/sovereign-bypass` cell going VACUOUS —
were ONE bug: GitHub's Windows runner sets `TEMP` to the 8.3 SHORT spelling of the temp
directory, so the sandbox path a harness hands a child is not the path the child resolves
and reports back. A destamp holding the short spelling normalises nothing; an
`excludes.json` seeded with the short spelling never matches a resolved cwd. Neither is
reachable on a machine whose `TEMP` is already canonical, which is every developer machine
this repo has run on.

So the gates here do not assert that the helper canonicalises. They RECREATE the
condition — a temp directory reached through a second, equal-but-different spelling —
and then run the real thing under it. On Windows the alias is the 8.3 short name; on POSIX
it is a symlink, which is the same duality (`/tmp -> /private/tmp`) and reaches the same
code. Every test below refuses to run rather than pass vacuously if the alias it built is
not actually a different spelling of the same directory.

The third property is the teardown, which the Linux job found by dying of it: a cleanup
race in a harness that had already finished comparing 318 cells.
"""
import ast
import ctypes
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import golden  # noqa: E402


def _alias_of(real: str) -> "str | None":
    """A SECOND spelling of `real` naming the same directory, or None if this platform or
    volume cannot make one.

    Windows: the 8.3 short name, which is what the GitHub runner's `TEMP` holds. It is a
    per-volume feature and can be switched off (`fsutil 8dot3name`), hence the None.
    POSIX: a symlink beside it — the spelling duality `realpath` exists for."""
    if os.name == "nt":
        buf = ctypes.create_unicode_buffer(1024)
        n = ctypes.windll.kernel32.GetShortPathNameW(str(real), buf, len(buf))
        short = buf.value if 0 < n < len(buf) else ""
        return short or None
    link = os.path.join(os.path.dirname(real), os.path.basename(real) + "-alias")
    try:
        os.symlink(real, link, target_is_directory=True)
    except (OSError, NotImplementedError):
        return None
    return link


class AliasedTempDirCase(unittest.TestCase):
    """A temp directory reachable under two spellings, installed as `tempfile.tempdir`."""

    def setUp(self):
        # A name with spaces and >8 characters per component, so the 8.3 form really does
        # differ. A short-name lookup on an already-short path returns it unchanged, and a
        # test built on one of those would be green for the wrong reason.
        self.real = os.path.realpath(tempfile.mkdtemp(prefix="geneseed alias case "))
        self.addCleanup(shutil.rmtree, self.real, ignore_errors=True)
        alias = _alias_of(self.real)
        if alias is None:
            self.skipTest("this platform/volume cannot produce a second path spelling")
        if os.name != "nt":
            self.addCleanup(lambda: os.path.islink(alias) and os.unlink(alias))
        # THE VACUITY GUARD. Everything below is about the gap between two spellings; if
        # there is no gap the tests would pass without exercising anything.
        if alias == self.real:
            self.skipTest("8.3 short names are disabled on this volume")
        self.assertEqual(os.path.realpath(alias), self.real,
                         "the alias must name the same directory as the original")
        self.alias = alias
        self._saved_tempdir = tempfile.tempdir
        tempfile.tempdir = alias
        self.addCleanup(setattr, tempfile, "tempdir", self._saved_tempdir)


class TheSandboxRootIsCanonical(AliasedTempDirCase):

    def test_a_bare_mkdtemp_keeps_the_alias(self):
        """The control. Without this the two tests below could not tell a helper that
        canonicalises from a platform that never had the problem."""
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d, ignore_errors=True)
        self.assertTrue(d.startswith(self.alias))
        self.assertNotEqual(os.path.realpath(d), d,
                            "the alias did not survive into mkdtemp's result")

    def test_the_helper_hands_out_the_resolved_spelling(self):
        with golden.sandbox() as d:
            self.assertEqual(os.path.realpath(d), d,
                             "golden.sandbox() handed out a path a child would resolve to "
                             "something else — the destamp roots and every seeded path "
                             "would then be spelled differently from the bytes they must "
                             "match")
            self.assertTrue(os.path.isdir(d))
            self.assertTrue(d.startswith(self.real))

    def test_importing_golden_canonicalises_the_process_temp_base(self):
        """The WHOLE-SUITE half. `golden.sandbox()` covers the three cell harnesses; the
        twenty other test modules that hand a temp path to a child and destamp its output
        call `tempfile` directly, and converting forty call sites is a worse fix than
        canonicalising the base they all read. A child process, because the assignment
        happens once at import."""
        env = {**os.environ, "TMPDIR": self.alias, "TEMP": self.alias, "TMP": self.alias}
        p = subprocess.run(
            [sys.executable, "-c",
             "import sys, tempfile; sys.path.insert(0, 'tests'); import golden; "
             "sys.stdout.write(tempfile.gettempdir())"],
            cwd=str(ROOT), env=env, capture_output=True, encoding="utf-8",
            errors="replace")
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout, self.real,
                         "importing golden left the process temp base on the alias, so "
                         "every module that calls tempfile directly still gets a path its "
                         "own children will resolve to something else")

    def test_the_process_home_sandbox_is_canonical_too(self):
        """`sandbox_process_home` writes its path into HOME/APPDATA, which children read
        and resolve exactly as they resolve `--out`."""
        home = golden.sandbox_process_home()
        try:
            self.assertEqual(Path(os.path.realpath(home)), home)
        finally:
            golden.restore_process_home()


class TheHarnessesUseTheHelper(unittest.TestCase):
    """The WIRING. A helper nothing calls fixes nothing, and the CI failure was in the call
    sites rather than in any shared function — there was no shared function."""

    FILES = ["tests/golden.py", "tests/harness_golden.py", "tests/web_golden.py",
             "tests/test_emit_boundary.py"]
    MAKES_A_DIR = {"TemporaryDirectory", "mkdtemp"}

    def test_no_harness_makes_a_raw_temp_sandbox(self):
        # Parsed rather than grepped: these files describe the bug they were fixed for, and
        # a regex over the text reports the PROSE that names `tempfile.TemporaryDirectory()`
        # as a call site. `ast` sees calls only.
        offenders = []
        for rel in self.FILES:
            src = (ROOT / rel).read_text(encoding="utf-8")
            lines = src.splitlines()
            for node in ast.walk(ast.parse(src)):
                if not (isinstance(node, ast.Call)
                        and isinstance(node.func, ast.Attribute)
                        and node.func.attr in self.MAKES_A_DIR
                        and isinstance(node.func.value, ast.Name)
                        and node.func.value.id == "tempfile"):
                    continue
                line = lines[node.lineno - 1]
                # The two spellings that carry the property: wrapped in `realpath` on the
                # spot, or `golden.sandbox`'s own body / the process-home sandbox, which
                # resolves on the following line and declares its teardown here.
                if "realpath" in line or "ignore_cleanup_errors" in line:
                    continue
                offenders.append(f"{rel}:{node.lineno}: {line.strip()}")
        self.assertEqual(offenders, [],
                         "a harness sandbox that does not go through golden.sandbox() (or "
                         "resolve on the spot) reintroduces the 8.3/symlink split that "
                         "took out 49 comparisons and one cell on the first CI run")


class TheTeardownCannotRaise(unittest.TestCase):
    """A cleanup failure must not destroy a run that has already finished comparing.

    The Linux `cells` job died at cell ~270 of 318 with `OSError: [Errno 39] Directory not
    empty` raised by `TemporaryDirectory.cleanup()` — a cell's own checkout copy still
    being written to while `rmtree` walked it. The next run of the SAME commit was green,
    which is what a race is. 318 compared cells are worth more than one `/tmp` entry."""

    def _sabotage(self, root):
        """Make `root` un-removable, and return the callable that lifts it. Two mechanisms
        because the platforms refuse deletion for different reasons: POSIX needs the write
        bit on the PARENT to unlink a child, Windows refuses to unlink an open file."""
        sub = Path(root) / "locked"
        sub.mkdir()
        f = sub / "held.txt"
        f.write_text("x", encoding="utf-8")
        if os.name == "nt":
            handle = open(f, "rb")
            return handle.close
        os.chmod(sub, 0o500)
        return lambda: os.chmod(sub, 0o700)

    def test_a_plain_rmtree_really_does_raise_here(self):
        """The control, and it is not decoration: as root (some containers) the POSIX
        sabotage does nothing, and the test below would then prove nothing."""
        d = tempfile.mkdtemp()
        lift = self._sabotage(d)
        try:
            with self.assertRaises(OSError):
                shutil.rmtree(d)
        finally:
            lift()
            shutil.rmtree(d, ignore_errors=True)

    def test_the_helper_swallows_it(self):
        lifts = []
        try:
            with golden.sandbox() as d:
                lifts.append(self._sabotage(d))
                kept = d
        except OSError as e:
            self.fail(f"golden.sandbox() let a cleanup failure out: {e}")
        finally:
            for lift in lifts:
                lift()
            shutil.rmtree(kept, ignore_errors=True)


@unittest.skipUnless(shutil.which("node"), "node is not on PATH")
class TheTwoResolversAgreeOnASecondSpelling(AliasedTempDirCase):
    """`resolve_out` / `resolveOut`, which is where the harnesses' problem was also a PORT
    bug rather than a fixture one.

    The reference ends in `Path.resolve()` — canonicalising — and the port ended in
    `path.resolve`, which only normalises `.` and `..`. The repo already had the right twin
    (`js/hosts.mjs`'s `pyResolve`, written for exactly this and used at nine other sites);
    this call site simply did not use it. Nothing could see the difference while every path
    handed to it was already canonical, and then the two CLIs printed the same directory
    under two names into a line that is compared BYTE for byte.

    A direct probe of the two resolvers rather than a whole `build`: it is the same claim in
    half a second, and it names the function instead of the symptom."""

    def _resolve(self, raw: str) -> "tuple[str, str]":
        py = subprocess.run(
            [sys.executable, "-c",
             "import sys; sys.path.insert(0, '.'); import _build_render as r; "
             "sys.stdout.write(str(r.resolve_out(sys.argv[1])))", raw],
            cwd=str(ROOT), capture_output=True, encoding="utf-8", errors="replace")
        node = subprocess.run(
            [shutil.which("node"), "--input-type=module", "-e",
             "import {resolveOut} from './bin/geneseed.mjs';"
             "process.stdout.write(resolveOut(process.argv[1]));", "--", raw],
            cwd=str(ROOT), capture_output=True, encoding="utf-8", errors="replace")
        self.assertEqual((py.returncode, node.returncode), (0, 0),
                         f"a probe failed:\n{py.stderr}\n{node.stderr}")
        return py.stdout, node.stdout

    def test_an_existing_directory_under_the_alias(self):
        raw = os.path.join(self.alias, "already-here")
        os.mkdir(raw)
        py, node = self._resolve(raw)
        # The vacuity guard: if the alias did not need resolving there is no claim here.
        self.assertNotEqual(py, raw, "the reference did not canonicalise, so this proves "
                                     "nothing about the port")
        self.assertEqual(py, node, "resolveOut is not Path.resolve() — the two CLIs will "
                                   "print the same directory under two different names")

    def test_a_target_that_does_not_exist_yet(self):
        """The normal case for `build --out`, and the one `realpathSync` alone cannot do:
        Python canonicalises the part that exists and appends the rest verbatim."""
        raw = os.path.join(self.alias, "not", "created", "yet")
        py, node = self._resolve(raw)
        self.assertNotEqual(py, raw)
        self.assertEqual(py, node)
        self.assertTrue(py.endswith(os.path.join("not", "created", "yet")),
                        f"the unresolvable tail was rewritten: {py!r}")


@unittest.skipUnless(shutil.which("node"), "node is not on PATH")
class TheCellThatWentVacuous(AliasedTempDirCase):
    """The END-TO-END one, and the literal CI failure.

    `git-gate/sovereign-bypass` seeds `excludes.json` with the sandbox's own path and
    requires the hook to stay silent inside it. Under an aliased temp dir the seeded
    spelling and the hook's resolved cwd stop matching, the bypass misses, the gate speaks,
    and the harness correctly reports the cell as VACUOUS — 'the reference printed on
    stdout, but this cell exists to prove it stays silent'. That is the harness working:
    the cell was silent on a developer's machine because of an ambient property of the
    machine, and it says so the moment the property changes.

    Run as a SUBPROCESS because `tempfile.tempdir` is a module global of THIS process and
    the harness spawns children that read `TEMP`/`TMPDIR` for themselves."""

    def test_the_sovereign_bypass_cell_survives_an_aliased_tempdir(self):
        env = {**os.environ, "TMPDIR": self.alias, "TEMP": self.alias, "TMP": self.alias,
               "PYTHONUTF8": "1"}
        p = subprocess.run(
            [sys.executable, str(ROOT / "tests" / "harness_golden.py"),
             "--new", f"node {ROOT / 'bin' / 'geneseed-hook.mjs'}",
             "--new-cli", f"node {ROOT / 'bin' / 'geneseed-cli.mjs'}",
             "--only", "git-gate/sovereign-bypass", "--jobs", "1"],
            cwd=str(ROOT), env=env, capture_output=True, encoding="utf-8",
            errors="replace")
        self.assertEqual(p.returncode, 0,
                         f"the cell no longer proves what it claims when the temp dir is "
                         f"reached under a second spelling.\n{p.stdout}\n{p.stderr}")
        self.assertIn("1 cells identical", p.stdout)


if __name__ == "__main__":
    unittest.main()
