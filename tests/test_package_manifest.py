"""The npm package's own gate — what ships, what does not, and why each.

`package.json` is the first file in this repo whose CONTENT IS A DECISION ABOUT
DISTRIBUTION rather than about behaviour, and it is the first one no other test could
have caught drifting. Every other partition in this port (`NOT_PORTED_POST`,
`NOT_PORTED_KINDS`, `NOT_PORTED_ACTIONS`, `_ALLOWED_SPAWNS`) declares a set and then
proves the declaration against the running thing. This file does the same for the
package: it runs the real `npm pack`, INSTALLS the tarball into a throwaway consumer, and
compares all three views of the file list — npm's report, the tarball, and the extracted
`node_modules` tree — against a two-sided partition of every tracked file in the repo.
The three views are not the same list, and the phase's worst defect lived in the gap.

TWO-SIDED IS THE POINT. A one-sided "these directories ship" list goes green forever
after someone adds a top-level directory nobody decided about — it simply is not in the
list, so it simply does not ship, and no test says so. Here every tracked path must match
exactly one row of `SHIPS` or `WITHHELD`, each row carries its reason, and a row that
matches nothing is itself a failure. Adding `tools/` to the repo fails this file until a
human writes down which side it is on.

WHY THE PACK LIST HAD TO BE MEASURED RATHER THAN REASONED ABOUT. npm's ignore semantics
under a `files` whitelist are not derivable from reading the docs, and the first honest
`npm pack --dry-run` of this repo proved it three ways:

  * `"docs/"` in `files` shipped `docs/specs/` and `docs/reviews/` — 33 gitignored,
    deliberately-private working documents, including this port's own plans — into a
    publishable tarball. The root `.gitignore` names both directories. npm packed them.
  * `"rituals/"` shipped 28 `__pycache__/*.pyc` files, likewise gitignored.
  * `"src/"` did NOT ship `src/notebook/README.md`, a tracked file, because
    `src/notebook/.gitignore` said `*` + `!.gitignore` and npm-packlist honours nested
    ignore files.

The first two are fixed by narrowing the globs (`docs/*.md` + `docs/web/`,
`rituals/*.py`). The third could not be fixed from `package.json` at all — an explicit
`"src/notebook/README.md"` entry, `"src/notebook/**"`, `"src/notebook/*"`,
`"src/notebook/"` and a root `.npmignore` were each measured and each failed — so P10b
fixed it in the RENDERER: the two product ignore files are stored without the leading dot
and `dest_rel` puts it back. `NPM_STRIPS` is the empty set that watches for a relapse.

WHAT THE `engines` FLOOR IS, AND WHY IT IS NOT A ROUND NUMBER. `API_FLOOR` is the table of
the newest runtime features this code depends on, each with the Node version that supplies
it and a regex that finds it in the source. The floor is the maximum, asserted exactly —
so raising it by hand fails, lowering it fails, and DELETING THE LAST USE of the API that
sets it also fails, which is what stops the floor from ratcheting up and never coming back
down. The spec's `>=24` was a guess resting on `node:sqlite` and the test runner's global
setup/teardown; neither is imported anywhere, so neither is a floor.

WHY `version` IS GATED AND `description` IS NOT. `harness.config.json` already carries a
release label and `CHANGELOG.md` names it as the version source. `package.json.version`
is therefore a COPY OF A VALUE UNDER TEST — the exact shape the port refuses everywhere
else — so it is asserted equal to the config's, which makes `npm version` (forbidden in
P10a, and a foot-gun afterwards) fail loudly rather than fork the two. `description` and
`keywords` are prose with no consumer inside the program; a drift gate on them would be
ceremony.

WHY `private` IS GONE. It was there for exactly two reasons, both P10a defects that only
an INSTALL could see, and P10b fixed both in the renderer — see
`TheInstalledTreeIsTheOneAUserGets`, which now emits a bundle from the installed package
and diffs it against the checkout's. What is left before a first publish is scope, not
correctness (`tui`/`menu`/`home` are P7's, the docs `cli` kind is P10c's, `migrate` is
P10d's, and the OIDC workflow is P10e's) — and none of those makes an installed package
do the wrong thing. Publishing remains a human act: nothing in this repo runs
`npm publish`.

THE ONE PYTHON DEPENDENCY, AND WHY IT IS GATED AT THE SOURCE RATHER THAN THE BUNDLE.
`TheBundlesOnlyPythonIsDeclared` scans every tracked file under `src/` and `adapters/` —
the two trees a bundle is rendered FROM — for a `.py` file, a python shebang, or a command
line that runs a `.py`. A bundle cannot contain a Python dependency that is not in one of
those trees, so a source scan is strictly stronger than emitting one bundle and scanning
it: it covers every theme, every host, every footprint and both emit modes at once,
without emitting anything and without touching the user's install registry (the reason
`emitProjectInto` exists as a separate export at all — see `bin/geneseed.mjs`).

MEASURED, so the claim in the docs is not prose: `src/skills/token-report/scripts/
token_report.py` (746 lines) renders into `<skills>/token-report/scripts/` of EVERY
bundle. The `lean`/`full` footprint switch touches only `laws/universal.md`
(`js/render.mjs:195`), so there is no footprint that leaves it out. A Node-emitted Claude
or Bob install therefore still needs Python 3 on PATH for that one skill to run, and only
for that one skill. Everything else in `PYTHON_IN_THE_PRODUCT` is prose or a template that
NAMES the Python front door; the scan freezes those too, so a new one has to be declared.
"""
from __future__ import annotations

import atexit
import filecmp
import json
import os
import re
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "package.json"

_PACK: tuple[set[str], set[str], set[str], Path] | None = None


def _package_under_test() -> tuple[set[str], set[str], set[str], Path]:
    """Pack AND install once per process — (npm's report, the tarball, the INSTALLED tree,
    the installed package's directory).

    THREE SETS, BECAUSE THEY ARE THREE DIFFERENT ANSWERS AND ONLY THE LAST ONE IS THE ONE
    A USER GETS. `npm pack --json` reports SOURCE paths. The tarball holds those same
    paths. `npm install` rewrites some of them on extraction, and neither of the first two
    layers shows it. Reading only the report — or only the tarball — is how a defect that
    leaked a user's agent memory into their git repository stayed invisible through both.
    See `TheInstalledTreeIsTheOneAUserGets`.

    THE FOURTH RETURN IS THE DIRECTORY ITSELF, and it is what P10b needed that P10a did
    not: a file LIST cannot answer "does a bundle emitted from this install match one
    emitted from the checkout". Only running the installed generator can, so the install
    outlives this call and is cleaned up at interpreter exit.
    """
    global _PACK
    if _PACK is None:
        npm = shutil.which("npm")
        keep = Path(tempfile.mkdtemp(prefix="gs-npm-install-"))
        atexit.register(shutil.rmtree, keep, True)
        with tempfile.TemporaryDirectory() as tmp:
            tmp_p = Path(tmp)
            proc = subprocess.run(
                [npm, "pack", "--json", "--pack-destination", tmp],
                cwd=ROOT, capture_output=True, text=True, timeout=600,
            )
            if proc.returncode != 0:
                raise AssertionError(f"npm pack failed: {proc.stderr[-2000:]}")
            report = json.loads(proc.stdout)[0]
            reported = {entry["path"] for entry in report["files"]}
            tgz = tmp_p / report["filename"]
            with tarfile.open(tgz) as tar:
                inside = {
                    m.name[len("package/"):] for m in tar.getmembers()
                    if m.isfile() and m.name.startswith("package/")
                }
            consumer = keep / "consumer"
            consumer.mkdir()
            (consumer / "package.json").write_text(
                '{"name":"geneseed-install-probe","version":"1.0.0","private":true}\n',
                encoding="utf-8",
            )
            proc = subprocess.run(
                [npm, "install", str(tgz), "--no-audit", "--no-fund", "--ignore-scripts"],
                cwd=consumer, capture_output=True, text=True, timeout=600,
            )
            if proc.returncode != 0:
                raise AssertionError(f"npm install of the tarball failed: {proc.stderr[-2000:]}")
        pkg = consumer / "node_modules" / "geneseed"
        installed = {p.relative_to(pkg).as_posix() for p in pkg.rglob("*") if p.is_file()}
        _PACK = (reported, inside, installed, pkg)
    return _PACK


def _emit_bundle(generator_root: Path, out: Path, home: Path) -> None:
    """Emit a portable bundle with `bin/geneseed.mjs`, with every home-shaped variable
    redirected into `home` so the user's real install registry is never read or written."""
    env = {
        **os.environ,
        "HOME": str(home), "USERPROFILE": str(home), "XDG_CONFIG_HOME": str(home / "cfg"),
        "APPDATA": str(home / "appdata"), "LOCALAPPDATA": str(home / "localappdata"),
    }
    proc = subprocess.run(
        [_NODE, str(generator_root / "bin" / "geneseed.mjs"), "--emit", "files",
         "--out", str(out)],
        cwd=str(generator_root), capture_output=True, text=True, timeout=600, env=env,
    )
    if proc.returncode != 0:
        raise AssertionError(
            f"emit from {generator_root} failed ({proc.returncode}): {proc.stderr[-2000:]}")


_NODE = shutil.which("node") or "node"


def _tracked() -> list[str]:
    out = subprocess.run(
        ["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True,
    ).stdout
    return [line.strip() for line in out.splitlines() if line.strip()]


def _manifest() -> dict:
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


# --------------------------------------------------------------------------------------
# The partition. A row is an exact path or a prefix ending in `/`; the longest matching
# row wins, so a specific path can carve itself out of a broader directory.
# --------------------------------------------------------------------------------------

SHIPS: tuple[tuple[str, str], ...] = (
    # Not decorative. This row did not exist when the file was written, because
    # `package.json` was still UNTRACKED — `git ls-files` does not list a file until it is
    # committed, so the partition was total right up to the commit that made it false, and
    # the whole acceptance matrix had already been run and reported green. A gate whose
    # input is the git index has to be re-run AFTER the commit, not only before it.
    ("package.json", "the manifest itself; npm packs it whatever `files` says"),
    ("bin/", "the three entry points — the whole reason there is a package"),
    ("js/", "the port"),
    ("src/", "the product: what a bundle is rendered from"),
    ("themes/", "render.loadTheme reads these; a themeless install renders nothing"),
    ("adapters/", "bin/geneseed.mjs, js/hooks.mjs and js/web/docs.mjs all read ROOT/adapters"),
    ("docs/web/", "js/web/docs.mjs serves ROOT/docs; the console's Docs pages ARE these files"),
    ("docs/opencode-plugin-setup.md", "docs/*.md — the five non-web pages, same reader"),
    ("docs/token-footprint.md", "docs/*.md"),
    ("docs/web-ui.md", "docs/*.md"),
    ("docs/wiki.md", "docs/*.md"),
    # P9. Ships for the reason the others do not: it is the standing statement of what the
    # Node port does NOT prove, and a package carrying two implementations owes its reader
    # that list. `docs/specs/` is gitignored, so a ledger kept only in a phase note is a
    # per-machine file — this is the tracked home for it.
    ("docs/port-ledger.md", "docs/*.md — what the Node port does not prove"),
    ("web/dist/", "TRACKED and load-bearing: js/web/server.mjs serves it, and _npm_build is a "
                  "first-run-from-a-partial-checkout path no cell reaches"),
    ("web/src/pages/Laws.jsx", "doctor's lawMetaProblems reads this ONE file out of web/src; "
                               "shipping the other 99 to satisfy it would be 700 kB of React "
                               "sources nothing else in the package opens"),
    # P10c RE-ARGUED THIS ROW TOO, and it came out STRONGER rather than narrower. The old
    # reason's second clause died — the docs `cli` kind no longer reads
    # `harness.build_argparser()`, it reads `cli.json` — but the port put a new load on the
    # same tree: `rituals/harness.py` is the file BOTH doctors hash for the `cli` check, so a
    # package without it cannot answer whether its own CLI reference is current.
    # P7b RE-ARGUED THIS ROW, and its first clause is now GONE rather than narrowed: `tui`
    # was the last subcommand, so no subcommand is Python-only. What replaces it is not a
    # verb but a SCREEN — the full-screen panel behind `tui`'s TTY arm is `rituals/
    # _harness_tui*.py` + `rituals/_winterm.py`, the Node entry declares it (js/tui.mjs's
    # header) and falls back by pointing the operator at `python rituals/harness.py tui`. A
    # package without `rituals/` would make that message a dead end. The second clause is
    # untouched and would carry the row on its own.
    ("rituals/", "no subcommand is Python-only since P7b, but the full-screen PANEL is: "
                 "js/tui.mjs refuses and names `python rituals/harness.py tui`, which has "
                 "to be there for the fallback to mean anything. And doctor's `cli` check "
                 "hashes rituals/harness.py on BOTH binaries — P10c"),
    ("cli.json", "the harness parser's metadata, generated by tests/gen_cli_reference.py. "
                 "js/cli.mjs is the only description of the CLI the Node side has: the "
                 "console's `cli` docs page AND bin/geneseed-cli.mjs's own argument parser "
                 "read it, so an install without it cannot parse a single verb"),
    ("build.py", "rituals/harness.py imports the `build` facade"),
    ("_build_core.py", "the facade's modules"),
    ("_build_emit.py", "the facade's modules"),
    ("_build_global.py", "the facade's modules"),
    ("_build_render.py", "the facade's modules"),
    ("_build_settings.py", "the facade's modules"),
    ("_install_registry.py", "the facade's modules"),
    ("harness.config.json", "js/checkout.mjs CONFIG — every render reads it"),
    ("registry.json", "js/inventory.mjs and doctor's registryProblems read it"),
    # P10b RE-ARGUED THIS ROW, because the reason it carried stopped being true. `link`
    # crossed, and the Node CLI's shim names `bin/geneseed-cli.mjs` rather than these files
    # (P5b's "Node bakes node"), so nothing puts the launchers on PATH from an npm install
    # any more. P10b's replacement reason was "the route to the three Python-only verbs".
    #
    # P7B RE-ARGUED IT AGAIN, on P10b's own instruction, and that reason is dead: there are
    # no Python-only verbs. The row survives on the clause that was always underneath it —
    # README, QUICKSTART and SETUP all ship and all tell the reader to run `./geneseed`, so
    # dropping these is three shipped documents that lie — plus the panel, which is the one
    # thing `./geneseed tui` still reaches that the Node entry does not. Four small files.
    # When P7c lands the panel, only the documents' clause is left, and at that point the
    # honest move is to fix the documents rather than to keep re-arguing the row.
    ("geneseed", "the bash front door; the shipped README/QUICKSTART/SETUP name it, and it "
                 "is the route to the full-screen panel, which is still Python (P7c). NOT "
                 "the updater under npm (`npm i -g geneseed@latest` is), and NOT what "
                 "`link` puts on PATH any more — re-argue when P7c lands"),
    ("geneseed.cmd", "the Windows front door, same argument"),
    ("geneseed.ps1", "the Windows front door, same argument"),
    ("bootstrap", "`geneseed bootstrap` execs it; still referenced by all three launchers"),
    ("README.md", "npm adds it regardless of `files`; doctor also reads its badges"),
    ("LICENSE", "npm adds it regardless of `files`"),
    ("SHIPPED.md", "doctor's proseMirrorProblems reads it"),
    ("CHANGELOG.md", "user-facing; small"),
    ("DESIGN.md", "user-facing; small"),
    ("QUICKSTART.md", "user-facing; small"),
    ("SETUP.md", "user-facing, and the install/autostart reference the README points at"),
)

WITHHELD: tuple[tuple[str, str], ...] = (
    ("tests/", "1.6 MB of developer gates. npm ships the tool, not its test rig — and the "
               "cell harnesses need a git checkout to run at all"),
    ("web/", "the React sources, the vite config and package-lock. web/dist is TRACKED, so "
             "the console never needs building at install time; web/src/pages/Laws.jsx is "
             "carved back in above"),
    (".github/", "CI configuration for this repository"),
    (".claude/", "this repository's OWN agent config — a deployed harness, not the product"),
    (".gitignore", "repo mechanics; npm strips it from a tarball anyway"),
    (".gitattributes", "repo mechanics"),
)

# EMPTY SINCE P10b, AND KEPT DECLARED. This held the one tracked file `npm pack` refused
# to carry: `src/notebook/README.md`, hidden by `src/notebook/.gitignore`'s `*` because
# npm-packlist honours nested ignore files. Five `files` spellings and a root `.npmignore`
# were each measured and each failed — `files` cannot override an ignore file.
#
# P10b killed it at the source instead: the two product ignore files are stored as
# `gitignore` (no dot) and `_build_render.dest_rel` puts the dot back at render time, so
# nothing under `src/` is an ignore file to npm-packlist any more. The set stays declared
# and stays empty, which is the shape that makes a REGRESSION visible: a new nested
# `.gitignore` under a shipped tree starts eating siblings again and
# `test_the_tarball_omits_nothing_the_partition_ships` is what says so, immediately,
# instead of someone quietly adding a row here.
NPM_STRIPS: frozenset[str] = frozenset()

# `npm pack` adds this whatever `files` says, and it is untracked until it is committed.
ALWAYS_PACKED: frozenset[str] = frozenset({"package.json"})


def _row_for(path: str, rows: tuple[tuple[str, str], ...]) -> str | None:
    best = None
    for pattern, _why in rows:
        hit = path == pattern if not pattern.endswith("/") else path.startswith(pattern)
        if hit and (best is None or len(pattern) > len(best)):
            best = pattern
    return best


def _ships(path: str) -> bool:
    s, w = _row_for(path, SHIPS), _row_for(path, WITHHELD)
    if s is None:
        return False
    return w is None or len(s) > len(w)


class TheManifestPartitionIsTotal(unittest.TestCase):
    """Every tracked file has a side, and every row has a file."""

    def test_every_tracked_file_matches_exactly_one_side(self):
        orphans = [
            p for p in _tracked()
            if _row_for(p, SHIPS) is None and _row_for(p, WITHHELD) is None
        ]
        self.assertEqual(
            orphans, [],
            "tracked paths in neither SHIPS nor WITHHELD — decide, with a reason, before "
            "the next publish:\n  " + "\n  ".join(orphans),
        )

    def test_no_row_is_dead(self):
        tracked = _tracked()
        dead = [
            pattern
            for pattern, _why in SHIPS + WITHHELD
            if not any(_row_for(p, SHIPS + WITHHELD) == pattern for p in tracked)
        ]
        self.assertEqual(dead, [], f"rows matching nothing tracked (stale): {dead}")

    def test_every_row_carries_a_reason(self):
        for pattern, why in SHIPS + WITHHELD:
            with self.subTest(pattern=pattern):
                self.assertTrue(why.strip(), f"{pattern} has no reason")


@unittest.skipUnless(shutil.which("npm"), "npm is not on PATH")
class TheTarballIsTheDeclaredPartition(unittest.TestCase):
    """`npm pack --dry-run` against `SHIPS` — both directions, on the real npm.

    The two mutations this exists for: drop a directory out of `files` (the packed set
    loses tracked paths that `SHIPS` claims), and drop a stray file into a shipped
    directory (the packed set gains a path `SHIPS` never claimed). Neither is visible to
    any other test in this repo, and neither is visible to a human reading `package.json`.
    """

    @classmethod
    def setUpClass(cls):
        cls.packed = _package_under_test()[0]

    def _expected(self) -> set[str]:
        return ({p for p in _tracked() if _ships(p)} - NPM_STRIPS) | set(ALWAYS_PACKED)

    def test_the_tarball_omits_nothing_the_partition_ships(self):
        missing = sorted(self._expected() - self.packed)
        self.assertEqual(
            missing, [],
            "declared as shipping and absent from the tarball — either a `files` entry is "
            "gone, or a nested .gitignore is eating it (see NPM_STRIPS):\n  "
            + "\n  ".join(missing),
        )

    def test_the_tarball_carries_nothing_the_partition_withholds(self):
        extra = sorted(self.packed - self._expected())
        self.assertEqual(
            extra, [],
            "in the tarball and not declared. An untracked file inside a shipped directory "
            "reaches a published package this way — which is how docs/specs/ and "
            "rituals/__pycache__/ were nearly published:\n  " + "\n  ".join(extra),
        )

    def test_the_developer_only_trees_are_really_absent(self):
        """An absolute assertion beside the set comparison, because the set comparison is
        only as good as `WITHHELD`, and these four are the expensive mistakes."""
        for prefix in ("tests/", "Harness/", "node_modules/", "docs/specs/"):
            with self.subTest(prefix=prefix):
                self.assertEqual(
                    [p for p in self.packed if p.startswith(prefix)], [],
                    f"{prefix} reached the tarball",
                )


@unittest.skipUnless(shutil.which("npm"), "npm is not on PATH")
class TheInstalledTreeIsTheOneAUserGets(unittest.TestCase):
    """The EXTRACTED tree, not the tarball — the layer where P10a's headline defect lived.

    `npm install` renames EVERY file named `.gitignore` to `.npmignore` on extraction, no
    opt-out. Two files under `src/` were named `.gitignore` and both RENDER INTO EVERY
    BUNDLE, so a bundle emitted by an npm-installed geneseed had `memory/.npmignore` and
    `notebook/.npmignore` and NO `.gitignore` at all — the agent's private memory and
    notebook, committable in the user's repository. Nothing errored. Nothing warned.
    `doctor` said nothing: zero mentions in the same run that reported the LOUD sibling 84
    times. `git status` in the user's repo was the first place it showed up.

    ALL THREE OF THE OBVIOUS VIEWS WERE CLEAN. `npm pack --json` reported
    `src/notebook/.gitignore`; the TARBALL contained `package/src/notebook/.gitignore`.
    Only the extracted `node_modules` tree disagreed. A gate reading the manifest, the
    pack report, or even the tarball was green on all three — which is the packaging form
    of "ask what the TRANSPORT normalises", where the transport is the installer.

    THE FIX WAS THE RENDERER, IN BOTH IMPLEMENTATIONS. The two product ignore files are
    stored as `src/memory/gitignore` and `src/notebook/gitignore` — a name git does not
    read as an ignore file, npm-packlist does not honour and npm's extract does not rename
    — and `_build_render.dest_rel` / `js/render.mjs`'s `destRel` put the dot back at render
    time, exactly as they already did for `AGENT.md.tmpl`. Emitted bytes are unchanged, so
    259 golden cells stayed green across the fix rather than being regenerated.

    THE GATE IS DELIBERATELY NOT A LIST COMPARISON. `test_a_bundle_emitted_from_the_
    install_matches_the_checkout` runs the INSTALLED generator and diffs its bundle against
    the checkout's, byte for byte. That is the only check in this file that would have
    caught the defect on the day it was written, because the defect was not a missing file
    in the package — every file was there, one of them under the wrong name.
    """

    #: Kept declared and kept EMPTY. Anything in the tarball that is missing from the
    #: extracted tree is a file npm renamed or dropped on the way in, and the answer is
    #: never a new row here — it is a source file that must stop being named `.gitignore`.
    RENAMED_BY_NPM: dict[str, str] = {}

    #: The two product ignore files, by their ON-DISK source name and their RENDERED name.
    #: Absolute, per side, because a set comparison between the tarball and the install is
    #: silent about a defect BOTH layers share.
    IGNORE_SOURCES = {
        "src/memory/gitignore": "memory/.gitignore",
        "src/notebook/gitignore": "notebook/.gitignore",
    }

    def test_the_install_renames_nothing(self):
        _reported, inside, installed, _pkg = _package_under_test()
        lost = sorted(p for p in inside if p not in installed)
        self.assertEqual(
            lost, sorted(self.RENAMED_BY_NPM),
            "files that are in the tarball and NOT in the installed tree. npm renames "
            "`.gitignore` to `.npmignore` on extraction; if one of these renders into a "
            "bundle it is a data leak, not a packaging wart. Rename the SOURCE (see "
            "_build_render.dest_rel) rather than adding a row here.",
        )

    def test_no_npmignore_reaches_the_installed_tree(self):
        """The absolute half of the above: name the artefact, not just the difference. A
        set comparison goes green if the tarball ALSO starts carrying `.npmignore`."""
        _reported, _inside, installed, _pkg = _package_under_test()
        stray = sorted(p for p in installed if Path(p).name in (".npmignore", ".gitignore"))
        self.assertEqual(
            stray, [],
            "an ignore file survived into the installed package. Under `src/` it renders "
            "into every user bundle under whatever name npm chose:\n  " + "\n  ".join(stray),
        )

    def test_the_ignore_sources_are_present_under_the_name_npm_leaves_alone(self):
        _reported, _inside, installed, _pkg = _package_under_test()
        for src_name in self.IGNORE_SOURCES:
            with self.subTest(src=src_name):
                self.assertTrue((ROOT / src_name).is_file(), "the source file is gone")
                self.assertIn(
                    src_name, installed,
                    f"{src_name} did not reach the installed tree at all — if it came "
                    f"through under another name the whole fix has been undone",
                )

    def test_a_bundle_emitted_from_the_install_matches_the_checkout(self):
        """THE ONE THAT WOULD HAVE CAUGHT IT. Emit from the installed package and from the
        checkout, and diff. Both runs get a redirected HOME so neither touches the user's
        install registry."""
        _reported, _inside, _installed, pkg = _package_under_test()
        with tempfile.TemporaryDirectory() as tmp:
            tmp_p = Path(tmp)
            from_npm, from_git = tmp_p / "from-npm", tmp_p / "from-git"
            _emit_bundle(pkg, from_npm, tmp_p / "home-npm")
            _emit_bundle(ROOT, from_git, tmp_p / "home-git")
            npm_files = {p.relative_to(from_npm).as_posix()
                         for p in from_npm.rglob("*") if p.is_file()}
            git_files = {p.relative_to(from_git).as_posix()
                         for p in from_git.rglob("*") if p.is_file()}
            self.assertEqual(
                sorted(git_files - npm_files), [],
                "the npm-installed generator emitted a bundle MISSING files the checkout "
                "emits — this is the shape of both P10a defects",
            )
            self.assertEqual(
                sorted(npm_files - git_files), [],
                "the npm-installed generator emitted files the checkout does not",
            )
            differing = sorted(
                rel for rel in git_files
                if not filecmp.cmp(from_npm / rel, from_git / rel, shallow=False)
            )
            self.assertEqual(differing, [], f"bundle files differ byte-for-byte: {differing}")

    def test_the_emitted_bundle_really_carries_the_ignore_files(self):
        """Absolute, beside the diff: a diff of two bundles that BOTH lost `.gitignore`
        is green. Name the files that have to be there."""
        _reported, _inside, _installed, pkg = _package_under_test()
        with tempfile.TemporaryDirectory() as tmp:
            tmp_p = Path(tmp)
            out = tmp_p / "bundle"
            _emit_bundle(pkg, out, tmp_p / "home")
            for src_name, rendered in self.IGNORE_SOURCES.items():
                with self.subTest(rendered=rendered):
                    dest = out / rendered
                    self.assertTrue(
                        dest.is_file(),
                        f"a bundle emitted from the npm install has no {rendered} — the "
                        f"user's agent memory and notebook are committable",
                    )
                    self.assertEqual(
                        dest.read_bytes(), (ROOT / src_name).read_bytes(),
                        f"{rendered} is not a copy of {src_name}",
                    )
            self.assertTrue(
                (out / "notebook" / "README.md").is_file(),
                "the notebook charter is missing — the LOUD half of the same defect",
            )


class TheBinMapIsTheThreeEntryPoints(unittest.TestCase):
    """Three names, three files, and the user-facing one is the CLI.

    `bin/geneseed.mjs` IS `build.py`'s `main()` — the generator, whose argv is
    `--theme/--emit/--out`, not a verb. Mapping the bare name `geneseed` to it would put
    the generator behind every `geneseed doctor` in the README. The bare name goes to the
    harness CLI, which is what the bash launcher has always run
    (`python rituals/harness.py <cmd>`), and the generator gets an explicit
    `geneseed-build`. The disjointness of the hook and CLI verb sets is
    `test_hook_cli_parity.py`'s; what is asserted here is that all three files have a
    name at all, since the shim bakes one of them by absolute path and a file with no bin
    entry is one nobody can invoke after `npm i -g`.
    """

    def test_each_bin_target_exists_and_is_a_node_script(self):
        for name, rel in _manifest()["bin"].items():
            with self.subTest(bin=name):
                target = ROOT / rel
                self.assertTrue(target.is_file(), f"{rel} does not exist")
                first = target.read_text(encoding="utf-8").splitlines()[0]
                self.assertEqual(
                    first, "#!/usr/bin/env node",
                    f"{rel} needs the shebang or npm's generated shim cannot run it",
                )

    def test_every_entry_point_file_has_exactly_one_bin_name(self):
        targets = sorted(_manifest()["bin"].values())
        on_disk = sorted(f"bin/{p.name}" for p in (ROOT / "bin").glob("*.mjs"))
        self.assertEqual(targets, on_disk, "a bin/ entry point with no npm name, or vice versa")

    def test_the_bare_name_is_the_harness_cli_not_the_generator(self):
        self.assertEqual(_manifest()["bin"]["geneseed"], "bin/geneseed-cli.mjs")


class TheEnginesFloorIsMeasured(unittest.TestCase):
    """The floor is the newest thing the source actually uses — asserted, not chosen.

    Two-way on purpose. A row whose regex no longer matches means the API is gone and the
    floor it justified should come down; without that half the floor only ever ratchets
    up and the reason rots in place.
    """

    # (label, minimum Node, regex that finds it under js/ and bin/)
    API_FLOOR: tuple[tuple[str, str, str], ...] = (
        # Stable in v22.3.0; present but EXPERIMENTAL from v16.7.0, and an experimental
        # API prints `ExperimentalWarning` on stderr — the stream this port compares
        # byte-for-byte in 294 harness cells. So the floor is where it stops warning, not
        # where it starts existing. (Only the >= 22.17.0 half of this is verifiable on
        # this machine; the stabilisation version is Node's v22.3.0 changelog.)
        ("fs.cpSync (stable)", "22.3.0", r"\bcpSync\b"),
        # js/lib/pyfs.mjs:296 — pyStr's toJSON writes verbatim text. Its own comment
        # already says "Node >= 21".
        ("JSON.rawJSON", "21.0.0", r"\bJSON\.rawJSON\b"),
        ("Object.hasOwn", "16.9.0", r"\bObject\.hasOwn\b"),
        ("String.prototype.replaceAll", "15.0.0", r"\.replaceAll\("),
    )

    @staticmethod
    def _sources() -> str:
        parts = []
        for d in ("js", "bin"):
            for f in sorted((ROOT / d).rglob("*.mjs")):
                parts.append(f.read_text(encoding="utf-8"))
        return "\n".join(parts)

    def test_every_row_still_names_an_api_the_source_uses(self):
        blob = self._sources()
        for label, _ver, pattern in self.API_FLOOR:
            with self.subTest(api=label):
                self.assertRegex(
                    blob, pattern,
                    f"{label} is no longer used — delete the row and let the floor fall",
                )

    def test_the_floor_is_exactly_the_newest_api_in_the_table(self):
        newest = max(
            (tuple(int(n) for n in ver.split(".")), ver) for _l, ver, _p in self.API_FLOOR
        )[1]
        self.assertEqual(
            _manifest()["engines"]["node"], f">={newest}",
            "engines.node must be the maximum of API_FLOOR — raise it only by adding the "
            "row that justifies it. The spec's >=24 rested on node:sqlite and the test "
            "runner's global setup/teardown; neither is imported anywhere in js/ or bin/.",
        )

    def test_the_floor_is_not_above_this_machine(self):
        """An engines floor above the developer's own runtime is a constraint nobody is
        testing — the spec said so at P2 and it is still true."""
        floor = tuple(int(n) for n in _manifest()["engines"]["node"].lstrip(">=").split("."))
        proc = subprocess.run(["node", "--version"], capture_output=True, text=True, check=True)
        running = tuple(int(n) for n in proc.stdout.strip().lstrip("v").split("."))
        self.assertLessEqual(floor, running, "engines.node is above the Node running the suite")


class TheManifestInventsNoFacts(unittest.TestCase):
    """`version` has one owner; the zero-dependency claim is a fact about this file."""

    def test_version_mirrors_harness_config(self):
        cfg = json.loads((ROOT / "harness.config.json").read_text(encoding="utf-8"))
        self.assertEqual(
            _manifest()["version"], cfg["version"],
            "harness.config.json owns the release label (CHANGELOG.md says so). "
            "`npm version` bumps only package.json and forks the two.",
        )

    def test_zero_dependencies_is_true_and_not_merely_claimed(self):
        m = _manifest()
        for field in ("dependencies", "peerDependencies", "optionalDependencies",
                      "bundleDependencies"):
            self.assertNotIn(field, m, f"{field} breaks the zero-dependency claim")

    def test_the_package_is_publishable(self):
        """`private` came off in P10b, and the two defects that put it there are gated by
        `TheInstalledTreeIsTheOneAUserGets`. Asserted ABSENT rather than deleted, so
        putting it back is as deliberate as taking it off was — a silent re-add would make
        P10e's publish workflow fail at the last step with no test naming why."""
        self.assertNotIn(
            "private", _manifest(),
            "the package is private again. If a new defect blocks publication, say which "
            "one here — `private` with no gate beside it is how a workaround outlives its "
            "reason.",
        )

    def test_the_license_field_matches_the_license_file(self):
        head = (ROOT / "LICENSE").read_text(encoding="utf-8").splitlines()[0]
        self.assertEqual(_manifest()["license"], "MIT")
        self.assertIn("MIT", head)


class TheBundlesOnlyPythonIsDeclared(unittest.TestCase):
    """"No Python needed" is false in exactly one declared place — freeze it there.

    Scanned over `src/` and `adapters/`, the two trees every bundle is rendered from, so
    the answer covers every theme, host and footprint without emitting anything.
    """

    # `python3 -c '...'` is an invocation too, and the first draft of this pattern could
    # not see it — which is how src/skills/daydream and src/skills/herdr came to call
    # python while README.md, SETUP.md and SHIPPED.md promised that exactly one file did.
    # A gate that cannot see the counterexample is not a gate; it is a sentence about the
    # examples someone thought of.
    INVOCATION = re.compile(
        r"python3?(?:\.exe)?\s+-c\b"
        r"|python3?(?:\.exe)?\s+[^\s`\"']*\.py\b"
        r"|#!.*python"
        r"|\buv run\b")

    PYTHON_IN_THE_PRODUCT: dict[str, str] = {
        "src/skills/token-report/scripts/token_report.py":
            "THE one. 746 lines, rendered into <skills>/token-report/scripts/ of EVERY "
            "bundle — the lean/full switch touches only laws/universal.md "
            "(js/render.mjs:195), so no footprint leaves it out. A Node-emitted Claude or "
            "Bob install still needs Python 3 on PATH for this skill and no other.",
        "src/skills/token-report/SKILL.md":
            "invokes the above: `python3 <this-skill-directory>/scripts/token_report.py`",
        "src/agents/_template.md": "authoring template; documents `python rituals/harness.py`",
        "src/skills/_template.md": "authoring template; documents `python rituals/harness.py`",
        "src/skills/opencode-theme.md": "documents `python rituals/harness.py`",
        "adapters/claude-code/README.md": "adapter prose naming the Python front door",
        "adapters/claude-code/settings.json":
            "the Claude settings TEMPLATE names `python rituals/harness.py`. The emitted "
            "hook commands are built by js/hooks.mjs and point at the machine-wide shim "
            "(P5b), not at this string — test_hook_form.py gates the emitted shape.",
        "adapters/opencode/README.md": "adapter prose naming `python build.py`",
        "adapters/opencode/GLOBAL-HARNESS-SPEC.md": "adapter prose naming `python build.py`",
        "src/skills/daydream/instructions.md": "`python3 -c` for weighted random sampling",
        "src/skills/herdr.md":
            "`| python3 -c 'import sys,json; ...'` to pull a field out of JSON, x2",
    }

    # THE ACTUAL PYTHON SURFACE OF THE PRODUCT, as of P0. Three entries, not one — the
    # widened INVOCATION regex above and the whole-tree scan below each found a path the
    # old gates could not see. P2 empties this by porting all three; P4's
    # no_python.test.mjs asserts it is empty. Until then README.md, SETUP.md and
    # SHIPPED.md say three, because saying one was false.
    PYTHON_IN_THE_PRODUCT_FILES = ["src/skills/token-report/scripts/token_report.py"]
    PYTHON_IN_THE_PRODUCT_INVOCATIONS = [  # Unused until the phase that empties it (P4 and later).
        "src/skills/daydream/instructions.md",   # `python3 -c` for random sampling
        "src/skills/herdr.md",                   # `| python3 -c 'import sys,json; ...'` x2
    ]

    # Python that is tracked in this repository but never rides inside a rendered
    # bundle: the reference implementation this port is replacing (`rituals/`, the root
    # `_build_*.py` facade, `build.py`, `_install_registry.py`), and `.claude/` — this
    # repository's OWN deployed harness (WITHHELD above: "not the product"). The `.claude/`
    # directory is watched file-by-file rather than excluded by prefix, so a NEW Python file
    # appearing there is caught rather than silently permitted.
    _NOT_THE_PRODUCT_PREFIXES = ("tests/", "rituals/")
    _NOT_THE_PRODUCT_FILES = frozenset({
        "build.py", "_install_registry.py", "_build_core.py", "_build_emit.py",
        "_build_global.py", "_build_render.py", "_build_settings.py",
        ".claude/skills/token-report/scripts/token_report.py",
    })

    def _found(self) -> set[str]:
        out = subprocess.run(
            ["git", "ls-files", "src", "adapters"],
            cwd=ROOT, capture_output=True, text=True, check=True,
        ).stdout.split()
        hits = set()
        for rel in out:
            if rel.endswith(".py"):
                hits.add(rel)
                continue
            try:
                text = (ROOT / rel).read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            if self.INVOCATION.search(text):
                hits.add(rel)
        return hits

    def test_no_undeclared_python_rides_into_a_bundle(self):
        new = sorted(self._found() - set(self.PYTHON_IN_THE_PRODUCT))
        self.assertEqual(
            new, [],
            "a NEW Python dependency entered the product. Every one of these ships inside "
            "user bundles, so each has to be declared here with what it costs a "
            "no-Python-needed install:\n  " + "\n  ".join(new),
        )

    def test_no_declared_row_has_quietly_been_fixed(self):
        gone = sorted(set(self.PYTHON_IN_THE_PRODUCT) - self._found())
        self.assertEqual(
            gone, [], f"declared Python dependencies that no longer exist — delete: {gone}",
        )

    def test_the_only_python_file_in_the_product_is_the_token_report_script(self):
        """Absolute, beside the set comparison: the count is what the docs promise.

        `self._found()` only ever scans `src` and `adapters`, so it cannot see
        `.claude/skills/token-report/scripts/token_report.py` — THIS repository's own
        deployed harness (WITHHELD above: "not the product"), which carries a second
        tracked copy of the same script. Scan every tracked file instead, then subtract
        what is never part of a rendered bundle (`_NOT_THE_PRODUCT_*` above).
        """
        found = sorted(
            p for p in _tracked() if p.endswith(".py")
            and not p.startswith(self._NOT_THE_PRODUCT_PREFIXES)
            and p not in self._NOT_THE_PRODUCT_FILES
        )
        self.assertEqual(
            found, sorted(self.PYTHON_IN_THE_PRODUCT_FILES),
            f"tracked .py files outside the reference implementation and .claude/: {found}",
        )


if __name__ == "__main__":
    unittest.main()
