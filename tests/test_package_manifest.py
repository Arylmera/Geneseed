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
    `src/notebook/.gitignore` says `*` + `!.gitignore` and npm-packlist honours nested
    ignore files. See `NPM_STRIPS` below — this one is a live defect, not a tidy-up.

The first two are fixed by narrowing the globs (`docs/*.md` + `docs/web/`,
`rituals/*.py`). The third cannot be fixed from `package.json` at all: an explicit
`"src/notebook/README.md"` entry, `"src/notebook/**"`, `"src/notebook/*"` and a root
`.npmignore` were each measured and each failed. It is declared instead.

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

WHY `private: true`. The package is complete enough to install and run and is NOT
complete enough to publish: five subcommands are still Python-only, the docs `cli` kind is
P10c's, and `link`/`unlink` are undecided (P10b). `private` makes `npm publish` refuse
outright, so publishing stays a deliberate edit rather than an accident, and P10e's OIDC
workflow removes it in the same commit that decides to ship.

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

import json
import re
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "package.json"

_PACK: tuple[set[str], set[str], set[str]] | None = None


def _package_under_test() -> tuple[set[str], set[str], set[str]]:
    """Pack AND install once per process — (npm's report, the tarball, the INSTALLED tree).

    THREE SETS, BECAUSE THEY ARE THREE DIFFERENT ANSWERS AND ONLY THE LAST ONE IS THE ONE
    A USER GETS. `npm pack --json` reports SOURCE paths. The tarball holds those same
    paths. `npm install` then rewrites two of them on extraction, and neither of the first
    two layers shows it. Reading only the report — or only the tarball — is how a defect
    that leaks a user's agent memory into their git repository stayed invisible through
    both. See `TheInstallRenamesEveryDotGitignore`.
    """
    global _PACK
    if _PACK is None:
        npm = shutil.which("npm")
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
            consumer = tmp_p / "consumer"
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
            installed = {
                p.relative_to(pkg).as_posix() for p in pkg.rglob("*") if p.is_file()
            }
        _PACK = (reported, inside, installed)
    return _PACK


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
    ("bin/", "the three entry points — the whole reason there is a package"),
    ("js/", "the port"),
    ("src/", "the product: what a bundle is rendered from"),
    ("themes/", "render.loadTheme reads these; a themeless install renders nothing"),
    ("adapters/", "bin/geneseed.mjs, js/hooks.mjs and js/web/docs.mjs all read ROOT/adapters"),
    ("docs/web/", "js/web/docs.mjs serves ROOT/docs; the console's Docs pages ARE these files"),
    ("docs/opencode-plugin-setup.md", "docs/*.md — the four non-web pages, same reader"),
    ("docs/token-footprint.md", "docs/*.md"),
    ("docs/web-ui.md", "docs/*.md"),
    ("docs/wiki.md", "docs/*.md"),
    ("web/dist/", "TRACKED and load-bearing: js/web/server.mjs serves it, and _npm_build is a "
                  "first-run-from-a-partial-checkout path no cell reaches"),
    ("web/src/pages/Laws.jsx", "doctor's lawMetaProblems reads this ONE file out of web/src; "
                               "shipping the other 99 to satisfy it would be 700 kB of React "
                               "sources nothing else in the package opens"),
    ("rituals/", "five subcommands are still Python-only (home, tui, menu, link, unlink) and "
                 "the docs `cli` kind reads harness.build_argparser() — P10c's"),
    ("build.py", "rituals/harness.py imports the `build` facade"),
    ("_build_core.py", "the facade's modules"),
    ("_build_emit.py", "the facade's modules"),
    ("_build_global.py", "the facade's modules"),
    ("_build_render.py", "the facade's modules"),
    ("_build_settings.py", "the facade's modules"),
    ("_install_registry.py", "the facade's modules"),
    ("harness.config.json", "js/checkout.mjs CONFIG — every render reads it"),
    ("registry.json", "js/inventory.mjs and doctor's registryProblems read it"),
    ("geneseed", "the bash front door. Under npm the self-heal is `npm i -g geneseed@latest`, "
                 "so the launcher is NOT the updater any more — but it is still the only way "
                 "to reach the five Python-only verbs, and P10b's `link`/`unlink` put THESE "
                 "files on PATH. Dropping them here would pre-decide P10b"),
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

# Tracked, intended to ship, and npm REFUSES TO PACK IT. `src/notebook/.gitignore` is
# product content (`*` + `!.gitignore` — the one rule the agent cannot lift inside its own
# notebook) that npm-packlist also reads as a live ignore rule for the source tree, so the
# sibling README is invisible to `npm pack` no matter what `files` says. Four `files`
# spellings and a root `.npmignore` were each measured and each failed.
#
# CONSEQUENCE, and it is not cosmetic: a bundle emitted by an npm-installed geneseed has
# no `notebook/README.md` — the agent's notebook charter. `ensureNotebookIndex` still
# writes `NOTEBOOK.md`, so nothing errors at emit time.
#
# THIS ONE IS LOUD, AND ITS SIBLING IS NOT — worth knowing which gate you are relying on.
# `geneseed doctor` run from a tarball install reports it: 84 problems at the time of
# measurement, six per theme across fourteen (`dead link 'notebook/README.md' in
# AGENT.md`, plus the .bob/.claude/.github spellings). The `.gitignore` -> `.npmignore`
# rename below shares this root cause and doctor says NOTHING about it — zero mentions in
# the same run. That asymmetry is why the rename needed a gate written for it and this
# row did not.
#
# NEITHER FIX BELONGS TO P10a. Adding `src/notebook/.npmignore` would win the pack (npm
# never packs `.npmignore`) and would render `notebook/.npmignore` into every user's
# bundle, because renderAll walks everything under src/. Adding `!README.md` to
# `src/notebook/.gitignore` would fix the pack and would also un-ignore the charter inside
# every user's repo, which is a product decision about the notebook's sovereignty. Both
# are P10b's to choose between; this row fails the moment one of them lands, which is the
# only way a workaround gets deleted when it stops being needed.
NPM_STRIPS: frozenset[str] = frozenset({"src/notebook/README.md"})

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
class TheInstallRenamesEveryDotGitignore(unittest.TestCase):
    """`npm install` renames EVERY `.gitignore` to `.npmignore` on extraction. No opt-out.

    THIS IS P10a's HEADLINE DEFECT AND IT IS WHY `private` IS STILL TRUE. Two files under
    `src/` are named `.gitignore` and both are RENDERED INTO EVERY BUNDLE:

        src/memory/.gitignore     -> the agent's memory store stays off the team's remote
        src/notebook/.gitignore   -> `*` + `!.gitignore`; the notebook's sovereignty rule

    A bundle emitted by an npm-installed geneseed therefore has `memory/.npmignore` and
    `notebook/.npmignore` and NO `.gitignore` at all — so the agent's private memory and
    notebook become committable in the user's repository. Nothing errors. Nothing warns.
    `git status` in the user's repo is the first place it shows up, after the fact.

    MEASURED THROUGH ALL THREE LAYERS, and the first two are clean:
    `npm pack --dry-run --json` reports `src/notebook/.gitignore`, and the TARBALL
    contains `package/src/notebook/.gitignore`. Only the extracted `node_modules` tree
    disagrees. A gate that read the manifest, or the pack report, or even the tarball,
    would have been green on all three. That is the packaging form of "ask what the
    TRANSPORT normalises" — and here the transport is not the wire, it is the installer.

    Not fixable from `package.json`. `files` cannot suppress the rename, a `postinstall`
    repair is skipped under `--ignore-scripts` (a data-leak fix that works only sometimes
    is worse than a blocked publish), and both real fixes change the RENDERER in two
    implementations: either the emitter asserts these two files the way
    `ensureBundleGitignore` already asserts the bundle's own, or the source files are
    renamed to something npm leaves alone and the renderer maps them back. P10b's choice.

    The tests below hold the line in both directions: the casualty list may not grow, and
    when it shrinks to nothing the `private` assertion here is what has to be deleted
    deliberately.
    """

    RENAMED_BY_NPM = {
        "src/memory/.gitignore": "src/memory/.npmignore",
        "src/notebook/.gitignore": "src/notebook/.npmignore",
    }

    def test_the_rename_happens_at_install_and_not_before(self):
        """The absolute half: name which layer is innocent, so a future fix in the wrong
        layer cannot look like a fix."""
        reported, inside, _installed = _package_under_test()
        for src_name in self.RENAMED_BY_NPM:
            with self.subTest(src=src_name):
                self.assertIn(src_name, reported, "npm pack --json stopped reporting it")
                self.assertIn(src_name, inside, "the TARBALL stopped carrying it")

    def test_the_casualty_list_is_exact(self):
        _reported, inside, installed = _package_under_test()
        lost = sorted(p for p in inside if p not in installed)
        self.assertEqual(
            lost, sorted(self.RENAMED_BY_NPM),
            "the set of files that are in the tarball and NOT in the installed tree has "
            "changed. A NEW entry means another source file reaches consumers under the "
            "wrong name — check what it is before shipping anything.",
        )
        for src_name, installed_name in self.RENAMED_BY_NPM.items():
            with self.subTest(src=src_name):
                self.assertIn(
                    installed_name, installed,
                    f"{src_name} did not even arrive as {installed_name}",
                )

    def test_every_casualty_is_one_that_renders_into_a_bundle(self):
        """The severity claim, asserted rather than described: these live under `src/`, and
        `renderAll` walks everything under `src/`."""
        for src_name in self.RENAMED_BY_NPM:
            with self.subTest(src=src_name):
                self.assertTrue(src_name.startswith("src/"))
                self.assertTrue((ROOT / src_name).is_file())

    def test_the_package_stays_private_while_a_casualty_exists(self):
        if self.RENAMED_BY_NPM:
            self.assertIs(
                _manifest().get("private"), True,
                "a bundle emitted from this package would ship a user's agent memory and "
                "notebook without a .gitignore. Fix the rename before removing `private`.",
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

    def test_publishing_is_still_a_deliberate_edit(self):
        self.assertIs(
            _manifest().get("private"), True,
            "P10a ships a package that installs and runs; it does not decide to publish "
            "one. Remove `private` in the commit that means to publish, not before.",
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

    INVOCATION = re.compile(r"python3?(?:\.exe)?\s+[^\s`\"']*\.py\b|#!.*python|\buv run\b")

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
    }

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
        """Absolute, beside the set comparison: the count is what the docs promise."""
        py = sorted(p for p in self._found() if p.endswith(".py"))
        self.assertEqual(py, ["src/skills/token-report/scripts/token_report.py"])


if __name__ == "__main__":
    unittest.main()
