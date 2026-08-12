"""The claims the top-level docs make about THIS port, gated against the tree.

`_harness_build._prose_mirror_problems` (run by `doctor`, on both implementations)
already gates the counts that come out of `src/`: laws, agents, skills, themes and —
since P10e — plugins. This module gates the other kind of counting sentence, the one
`src/` cannot answer: **what a reader is promised about the two runtimes.**

Seven claims, and each one was wrong at least once during this port:

* **"these commands have no Node twin"** — derived from the CLI table's subparser list
  minus the two Node entry tables. Transcribing that list is exactly the
  copy-of-a-value-under-test this port forbids, so the docs name the verbs and this
  test derives the set they must equal. It moved in P5a, P5c, P5d, P5e, P5f, P5g,
  P5h, P5i, P6h, P8a, P8b, P10b and P10d — thirteen times, in one port.
* **"one Python file rides inside every bundle"** — derived by globbing `src/` for
  `*.py`. `TheBundlesOnlyPythonIsDeclared` in `test_package_manifest.py` freezes the
  same fact from the packaging side; this one asserts the DOCS say it. A gate on the
  package that no sentence in the README reflects still ships a README that promises
  a Python-free install.
* **`N plugins` and `N themes`** — derived from `adapters/opencode/plugins/geneseed-*.js`
  and `themes/*.json`, over the files `doctor`'s mirror is not handed. The plugin count
  is the one that actually drifted: the README said six while seven shipped.
* **`npx <name>`** — the name in the install command must be the name
  `package.json` declares. A published package under a different name than the one
  the README tells people to run is not recoverable by an edit.
* **the publish workflow** — see `ThePublishWorkflowIsDeliberate`. npm's trusted
  publisher is keyed on the workflow's FILENAME, so a rename silently breaks
  publishing in a way nothing local can detect.
* **the argv `migrate` tells you to paste into a login item** — see
  `TheMigrateNoteAdvisesARealWebAction`. A report string that hands the reader a
  command is a doc, and it shipped wrong: it named no `web` action at all.

None of this parses YAML: the harness is stdlib-only and always has been. The
structural claims are made as text assertions over the file, and the real parse
happens where the file actually runs.
"""
from __future__ import annotations

import ast
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# The docs that make these claims. QUICKSTART is deliberately absent from the
# verb-list check — it is the five-minute page and does not enumerate anything.
README = ROOT / "README.md"
SETUP = ROOT / "SETUP.md"
QUICKSTART = ROOT / "QUICKSTART.md"

_WORDS = {w: i for i, w in enumerate(
    "zero one two three four five six seven eight nine ten eleven twelve thirteen "
    "fourteen fifteen sixteen seventeen eighteen nineteen twenty".split())}


def _read(p: Path) -> str:
    return p.read_text(encoding="utf-8")


def _int(token: str) -> int | None:
    """A count written as a digit or as an English word, or None if it is neither."""
    if token.isdigit():
        return int(token)
    return _WORDS.get(token.lower())


def _verbs_of(entry: Path) -> set[str]:
    """The verb table of a `bin/*.mjs` entry point, scraped rather than imported.

    Same regex `tests/test_hook_cli_parity._verbs_of` uses, and for the same reason:
    the table is the dispatch, and reading it as TEXT is what makes it impossible for
    the answer to come from anywhere but the shipped file.
    """
    src = entry.read_text(encoding="utf-8")
    body = re.search(r"const VERBS = \{(.*?)\n\};", src, re.S)
    if not body:
        return set()
    return set(re.findall(r"^\s{2}'?([a-z][a-z-]*)'?:\s*\{", body.group(1), re.M))


def _python_only_verbs() -> set[str]:
    """Subparsers in the CLI table that neither Node entry point answers.

    The table carries argparse's `update` alias as its own row; it is the same
    subparser as `upgrade` and is folded away here so the set is about COMMANDS a
    user cannot run from Node, not about names.
    """
    spec = json.loads((ROOT / "js" / "cli-table.json").read_text(encoding="utf-8"))
    names = {c["name"] for c in spec["commands"]}
    node = _verbs_of(ROOT / "bin" / "geneseed-cli.mjs") | _verbs_of(ROOT / "bin" / "geneseed-hook.mjs")
    # An alias of a verb that crossed has crossed. `update` aliases `upgrade`.
    aliases = {"update": "upgrade"}
    return {n for n in names if n not in node and aliases.get(n) not in node}


def _backticked(text: str) -> list[str]:
    return re.findall(r"`([^`]+)`", text)


class TheDocsNameTheVerbsThatStillNeedPython(unittest.TestCase):
    """The docs enumerate the Python-only commands; the enumeration is DERIVED here.

    The sentence shape is fixed on purpose — `N commands have no Node twin` followed
    by the names in backticks — because a gate that guessed at prose would go quiet
    the first time somebody rephrased it. If the phrasing has to change, change it
    here in the same commit; a silent miss is what `MARKER` exists to prevent.
    """

    # Stops at the first `.`, not at the end of the line: the names are the first sentence
    # after the colon, and swallowing the rest of the paragraph would let any later
    # backticked token join the set the docs are held to.
    # `ha(?:ve|s)` since P7a: the count reached ONE, and "One command have no Node twin" is
    # not a sentence. A gate that fixes the grammar of a number fixes the number too — this
    # one silently stopped matching, and an unmatched MARKER is caught only because
    # `assertIsNotNone` is there. Number-agreement is the doc's business, not the gate's.
    #
    # P7b took the count to ZERO, and the sentence still has to exist. "0 commands have no
    # Node twin" reads oddly and is the point: the claim is the one a reader deciding
    # between an npm install and a checkout needs, so it is made explicitly rather than by
    # the absence of a sentence — an absent claim and an unwritten one look identical, and
    # `assertIsNotNone` below is what keeps a deletion from passing as "nothing to say".
    MARKER = re.compile(r"(\w+) commands? ha(?:ve|s) no Node twin[^\n]*?:([^\n.]*)")

    def test_the_derivation_reads_both_sides_and_is_not_a_broken_scrape(self):
        """The positive control, REBUILT IN P7B because the one it replaces stopped being
        possible. It used to assert `_python_only_verbs()` is non-empty: with a non-empty
        set, "the docs name exactly these" is a real requirement, and an empty one would
        have let the docs satisfy the gate by naming nothing.

        `tui` was the last verb, so the set is legitimately EMPTY now — and "assert it is
        empty" is precisely the vacuous gate the old control existed to prevent, because a
        scrape that found no CLI table, or that parsed neither entry table, produces the
        same empty set for the opposite reason. So the control moved to the DERIVATION's
        inputs instead of its output: both sides must be non-empty and they must PARTITION
        the command list. A broken scrape fails that; a verb that genuinely stopped crossing
        fails `test_each_doc_names_exactly_the_verbs_with_no_node_twin` and lands back in
        the docs, which is where it belongs.
        """
        spec = json.loads((ROOT / "js" / "cli-table.json").read_text(encoding="utf-8"))
        names = {c["name"] for c in spec["commands"]}
        cli = _verbs_of(ROOT / "bin" / "geneseed-cli.mjs")
        hook = _verbs_of(ROOT / "bin" / "geneseed-hook.mjs")
        self.assertGreater(len(names), 20, "js/cli-table.json parsed to almost nothing")
        self.assertGreater(len(cli), 20, "bin/geneseed-cli.mjs's verb table did not scrape")
        self.assertEqual(len(hook), 4, f"the hook entry's verbs scraped as {sorted(hook)}")
        # The partition: every name in the CLI table is answered by one of the two entries, or
        # is the `update` alias of one that is. This is the same statement as "the set is
        # empty", made from the other direction — it cannot be satisfied by reading nothing.
        self.assertEqual(names - cli - hook, set(),
                         "js/cli-table.json has commands neither Node entry answers — P7b left the "
                         "set empty, so this is a regression or a docs update this test "
                         "wants")
        self.assertEqual(_python_only_verbs(), set())

    def test_each_doc_names_exactly_the_verbs_with_no_node_twin(self):
        left = _python_only_verbs()
        for path in (README, SETUP):
            with self.subTest(doc=path.name):
                m = self.MARKER.search(_read(path))
                self.assertIsNotNone(
                    m, f"{path.name} makes no 'N commands have no Node twin' claim — the "
                       "npx install path is only honest if it says which commands it "
                       "cannot run")
                named = {v.strip().removeprefix("geneseed ").strip()
                         for v in _backticked(m.group(2))}
                self.assertEqual(
                    named, left,
                    f"{path.name} names {sorted(named)} as Python-only but the CLI table minus "
                    f"the two Node entry tables is {sorted(left)}")

    def test_each_doc_counts_them_correctly(self):
        left = _python_only_verbs()
        for path in (README, SETUP):
            with self.subTest(doc=path.name):
                m = self.MARKER.search(_read(path))
                assert m is not None  # the test above is the one that reports this
                got = _int(m.group(1))
                self.assertIsNotNone(got, f"{path.name}: '{m.group(1)}' is not a count")
                self.assertEqual(got, len(left),
                                 f"{path.name} says '{m.group(1)} commands' but {len(left)} "
                                 "have no Node twin")


class TheDocsCountThePlugins(unittest.TestCase):
    """`N plugins` in the two docs `doctor`'s mirror cannot reach.

    `doctor`'s `_prose_mirror_problems` gained the plugin count in P10e and is handed the
    README; the same claim is made in `docs/opencode-plugin-setup.md` (twice) and in
    `adapters/opencode/README.md`, and widening that function's signature to reach them
    would be a second owner of one question. This is the same derivation, over the files
    the mirror does not see. Word forms count — "seven plugins" drifts exactly as "7
    plugins" does, and the README's did.
    """

    PAT = re.compile(r"(\w+) plugins\b")
    DOCS = ("docs/opencode-plugin-setup.md", "adapters/opencode/README.md")

    def test_every_plugin_count_in_prose_is_the_real_one(self):
        want = len(list((ROOT / "adapters" / "opencode" / "plugins").glob("geneseed-*.js")))
        self.assertGreater(want, 1, "no plugins found — the assertion below would be vacuous")
        seen = 0
        for rel in self.DOCS:
            for tok in self.PAT.findall(_read(ROOT / rel)):
                got = _int(tok)
                if got is None:
                    continue  # "the plugins", "OpenCode plugins" — not a count
                seen += 1
                with self.subTest(doc=rel, claim=f"{tok} plugins"):
                    self.assertEqual(got, want)
        self.assertTrue(seen, "neither adapter doc states a plugin count")


class TheDocsCountTheThemes(unittest.TestCase):
    """`N themes` in prose, against `themes/*.json`.

    The README *badge* is already gated by `doctor` (`_count_table_problems`), but the badge
    regex never sees prose, and `_prose_mirror_problems` is only handed the README — SETUP.md
    says "the 14 themes" twice and nothing looked at it. Word forms count: "Fourteen themes
    ship" is the same claim as "14 themes ship" and drifts the same way.
    """

    # PLURAL only. `themes?` also matched "one theme", which is a sentence about a single
    # install ("scoped to the one theme you installed"), not a claim about the roster.
    PAT = re.compile(r"(\w+) themes\b")

    def test_every_theme_count_in_prose_is_the_real_one(self):
        want = len([p for p in (ROOT / "themes").glob("*.json") if p.stem != "_TEMPLATE"])
        self.assertGreater(want, 1, "no themes found — the assertion below would be vacuous")
        seen = 0
        for path in (README, SETUP, QUICKSTART):
            for tok in self.PAT.findall(_read(path)):
                got = _int(tok)
                if got is None:
                    continue  # "the themes", "voice themes" — not a count
                seen += 1
                with self.subTest(doc=path.name, claim=f"{tok} themes"):
                    self.assertEqual(got, want)
        self.assertTrue(seen, "no theme count in any of the three docs")


class TheDocsCountTheSubcommandsThatCrossed(unittest.TestCase):
    """`N of the M subcommands` — both halves derived, in the three present-tense docs.

    DESIGN.md and CHANGELOG.md are deliberately NOT scanned. They are dated logs: "Ten of
    the 24 subcommands are now Node" was true when it was written, and rewriting a log to
    agree with today is how a log stops being one. This gate is about the documents that
    describe the harness you install right now.

    The denominator moves too — `migrate` made it 25 — which is exactly why neither half
    is written down here.
    """

    PAT = re.compile(r"(\w+) of the (\w+) subcommands")

    def _figures(self) -> tuple[int, int]:
        spec = json.loads((ROOT / "js" / "cli-table.json").read_text(encoding="utf-8"))
        # argparse's `update` alias is a second NAME for `upgrade`'s subparser, not a
        # second subcommand; fold it away so the denominator counts commands.
        total = len({c["name"] for c in spec["commands"]} - {"update"})
        return total - len(_python_only_verbs()), total

    def test_the_figures_are_derivable_and_sane(self):
        crossed, total = self._figures()
        self.assertEqual(total, 25, "the subparser count moved — every doc that states it "
                                    "needs a look, and so does this sanity floor")
        # `<=`, not `<`, since P7b: `tui` was the last verb and the two halves are now
        # EQUAL. The floor that matters is the other one — a numerator of 0, or one above
        # the denominator, means the derivation broke rather than that the port finished.
        self.assertLessEqual(crossed, total)
        self.assertGreater(crossed, 0)

    def test_every_present_tense_doc_states_both_halves_correctly(self):
        crossed, total = self._figures()
        seen = 0
        for path in (README, SETUP, ROOT / "SHIPPED.md"):
            for got_c, got_t in self.PAT.findall(_read(path)):
                seen += 1
                with self.subTest(doc=path.name, claim=f"{got_c} of the {got_t}"):
                    self.assertEqual(_int(got_c), crossed)
                    self.assertEqual(_int(got_t), total)
        self.assertTrue(seen, "no document states how much of the CLI crosses — the "
                              "assertion above is satisfied by silence, which is the one "
                              "way a count gate goes green while the docs say nothing")


class TheDocsNameThePythonThatRidesInsideABundle(unittest.TestCase):
    '''"No Python needed" is FALSE in exactly one place and the docs have to say so.

    Derived by globbing `src/` — the tree every bundle is rendered from — rather than
    by trusting `test_package_manifest.PYTHON_IN_THE_PRODUCT`, so the two gates fail
    independently. Today the answer is `token_report.py` and nothing else.
    '''

    MARKER = re.compile(r"every bundle carries[^\n]*?:([^\n]*)")

    def _scripts(self) -> set[str]:
        return {p.name for p in (ROOT / "src").rglob("*.py")}

    def test_the_glob_finds_the_one_script(self):
        """Positive control: the assertion below is vacuous if `src/` has no Python."""
        self.assertEqual(self._scripts(), {"token_report.py"},
                         "the set of Python files inside the bundle source has changed — "
                         "the docs claim and test_package_manifest's declaration both "
                         "need the new row")

    def test_each_doc_names_every_python_file_a_bundle_carries(self):
        want = self._scripts()
        for path in (README, SETUP):
            with self.subTest(doc=path.name):
                m = self.MARKER.search(_read(path))
                self.assertIsNotNone(
                    m, f"{path.name} never says what Python a bundle carries — an npx "
                       "install that promises 'no Python' while shipping a .py is the "
                       "one dishonest sentence P10a measured")
                named = {Path(t).name for t in _backticked(m.group(1)) if t.endswith(".py")}
                self.assertEqual(named, want,
                                 f"{path.name} names {sorted(named)} but src/ carries "
                                 f"{sorted(want)}")


class TheInstallCommandNamesThePublishedPackage(unittest.TestCase):
    """An `npx` line that runs a geneseed binary must name the geneseed PACKAGE.

    Two gate defects in this class, both found by running it:

    1. **A prose mention of a command reads exactly like an invocation of it.** An
       unanchored `npx\\s+(\\w+)` matched the sentence "An npx install is Python-free"
       and reported that the README told people to run `npx install`. The patterns are
       anchored to a line start or a backtick — a gate over prose has to say where a
       command may live.
    2. **"Every npx line names our package" is simply false**, and the docs are right:
       SETUP.md tells you to run `npx @modelcontextprotocol/server-filesystem` to wire an
       MCP server. The real claim is narrower and derived — an npx line whose BINARY is one
       of `package.json`'s `bin` keys must resolve to this package. That also catches the
       mistake the loose version could not: `npx geneseed-build` is a bin name, not a
       package name, and would install something else entirely.
    """

    NPX = re.compile(r"(?m)(?:^\s*|`)npx((?:\s+[@\w./=-]+)+)")
    NPM_G = re.compile(r"(?m)(?:^\s*|`)npm (?:install|i) -g\s+([@\w./-]+)")

    @staticmethod
    def _manifest() -> dict:
        return json.loads((ROOT / "package.json").read_text(encoding="utf-8"))

    @staticmethod
    def _bare(spec: str) -> str:
        """`geneseed@latest` → `geneseed`; `@scope/x@1` → `@scope/x`."""
        at = spec.rfind("@")
        return spec[:at] if at > 0 else spec

    def _npx_calls(self, text: str):
        """(package-spec, binary) per npx line, resolving `-p`/`--package`."""
        for m in self.NPX.finditer(text):
            toks = [t for t in m.group(1).split() if not t.startswith("-")
                    or t in ("-p", "--package")]
            if not toks:
                continue
            if toks[0] in ("-p", "--package") and len(toks) >= 3:
                yield toks[1], toks[2]
            else:
                yield toks[0], toks[0]

    def test_every_npx_line_that_runs_a_geneseed_binary_names_the_package(self):
        man = self._manifest()
        name, bins = man["name"], set(man["bin"])
        seen = 0
        for path in (README, QUICKSTART, SETUP, ROOT / "docs" / "web" / "install-quick.md"):
            for spec, binary in self._npx_calls(_read(path)):
                if self._bare(binary) not in bins:
                    continue  # a third-party package the docs legitimately name
                seen += 1
                self.assertEqual(
                    self._bare(spec), name,
                    f"{path.name}: `npx {spec} … {binary}` runs one of this package's "
                    f"binaries but names '{self._bare(spec)}'; the package is '{name}'. "
                    f"A bin name is not a package name — use `npx -p {name} {binary}`.")
        self.assertTrue(seen, "no `npx …` line runs a geneseed binary in any install doc — "
                              "this test is vacuous and the npx install path is "
                              "undocumented")

    def test_the_global_install_names_it_too(self):
        name = self._manifest()["name"]
        seen = 0
        for path in (README, QUICKSTART, SETUP):
            for got in self.NPM_G.findall(_read(path)):
                seen += 1
                self.assertEqual(self._bare(got), name,
                                 f"{path.name} says `npm i -g {got}` but the package is "
                                 f"named '{name}'")
        self.assertTrue(seen, "no `npm install -g …` line in any install doc")


class ThePublishWorkflowIsDeliberate(unittest.TestCase):
    """The publishing workflow, gated for the three things a rename or a paste breaks.

    npm's trusted publisher is keyed on `owner/repo` PLUS the workflow FILENAME. A
    rename is therefore a silent break: the workflow still runs, still mints an OIDC
    token, and npm rejects it — and nothing local can rehearse that. So the file
    states its own filename in the comment that tells a maintainer what to configure,
    and this test asserts the two agree.

    The workflow is DISCOVERED (the one file under `.github/workflows/` that runs
    `npm publish`) rather than named by a constant here, because a constant would be
    a second copy of the value under test: renaming both the file and the constant
    would pass while the npm side still pointed at the old name. The self-reference
    is the only thing that cannot be renamed into agreement by accident.
    """

    def _workflow(self) -> Path:
        found = [p for p in sorted((ROOT / ".github" / "workflows").glob("*.yml"))
                 if re.search(r"^\s*(-\s*)?run:.*npm publish", p.read_text(encoding="utf-8"), re.M)]
        self.assertEqual(len(found), 1,
                         f"expected exactly one workflow that runs `npm publish`, found "
                         f"{[p.name for p in found]}")
        return found[0]

    def test_it_references_its_own_filename(self):
        wf = self._workflow()
        named = set(re.findall(r"[\w.-]+\.ya?ml", wf.read_text(encoding="utf-8")))
        self.assertEqual(
            named, {wf.name},
            f"{wf.name} names {sorted(named)} as a workflow filename. npm's trusted "
            "publisher is keyed on the filename, so the file must name itself and "
            "nothing else — renaming it without updating the npm side breaks publishing "
            "with no local symptom.")

    def test_it_mints_an_oidc_token_and_carries_no_registry_credential(self):
        # The credential half reads the workflow with COMMENTS STRIPPED, and that is a
        # gate defect this gate found in itself on its first run: the file's own header
        # explains that there is no `NPM_TOKEN`, and the check fired on the sentence
        # saying so. A claim about what a workflow USES cannot be made against its prose.
        text = self._workflow().read_text(encoding="utf-8")
        executable = re.sub(r"#.*", "", text)
        self.assertRegex(text, r"(?m)^\s*id-token:\s*write\b",
                         "trusted publishing needs `id-token: write`; without it the job "
                         "cannot mint the OIDC token and falls back to a credential that "
                         "this repository deliberately does not have")
        for forbidden in ("NPM_TOKEN", "NODE_AUTH_TOKEN", "secrets."):
            self.assertNotIn(forbidden, executable,
                             f"{forbidden} in the publish workflow — the whole point of "
                             "trusted publishing is that no long-lived registry credential "
                             "exists in this repository")

    def test_publishing_is_triggered_by_hand_and_never_by_a_push(self):
        text = self._workflow().read_text(encoding="utf-8")
        trigger = re.search(r"(?ms)^on:\n(.*?)(?=^\w)", text)
        self.assertIsNotNone(trigger, "the workflow has no `on:` block")
        body = trigger.group(1)
        self.assertIn("workflow_dispatch", body,
                      "publishing must be startable by a human on purpose")
        for auto in ("push:", "pull_request:", "schedule:"):
            self.assertNotIn(auto, body,
                             f"`{auto}` triggers the publish workflow — a merge, a PR or a "
                             "clock must never publish this package")

    def test_it_publishes_once(self):
        text = self._workflow().read_text(encoding="utf-8")
        self.assertEqual(len(re.findall(r"(?m)^\s*(?:-\s*)?run:.*npm publish", text)), 1,
                         "more than one `npm publish` step")

    def test_it_asks_for_a_node_and_an_npm_that_support_trusted_publishing(self):
        """npm >= 11.5.1 and Node >= 22.14.0 (npm's own floor for trusted publishing).

        `package.json`'s `engines` is a different number on purpose — that is the
        floor for RUNNING geneseed, not for publishing it — so this is asserted
        against the workflow, not against the manifest.
        """
        text = self._workflow().read_text(encoding="utf-8")
        self.assertRegex(text, r"registry-url:\s*['\"]?https://registry\.npmjs\.org",
                         "setup-node must set `registry-url`, or npm publishes nowhere "
                         "the OIDC grant is valid for")
        m = re.search(r"node-version:\s*['\"]?(\d+)", text)
        self.assertIsNotNone(m, "the workflow pins no node-version")
        self.assertGreaterEqual(int(m.group(1)), 22,
                                "trusted publishing needs Node >= 22.14.0")
        self.assertRegex(text, r"npm install -g npm@",
                         "the runner's bundled npm may predate 11.5.1, which is where "
                         "trusted publishing landed — pin the floor rather than hope")

    def test_it_names_the_package_it_publishes(self):
        name = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["name"]
        text = self._workflow().read_text(encoding="utf-8")
        self.assertIn(name, text,
                      f"the workflow never names '{name}' — the trusted-publisher "
                      "instructions in it must name the package they configure")

    def test_the_file_is_tab_free(self):
        """Not a YAML parse — the harness is stdlib-only — but a tab is the one
        character that makes a YAML file fail to parse for a reason nobody sees in a
        diff."""
        wf = self._workflow()
        for i, line in enumerate(wf.read_text(encoding="utf-8").splitlines(), 1):
            self.assertNotIn("\t", line, f"{wf.name}:{i} contains a tab")


class TheMigrateNoteAdvisesARealWebAction(unittest.TestCase):
    """`migrate` hands the reader an argv to paste into a login item. That argv is a
    doc, and it is gated here against the parser metadata both implementations already
    read — never against a copy of the sentence.

    It shipped wrong, on a real machine: the note advised `geneseed web --no-browser`,
    which names **no action**, so it falls through `cmd_web`'s dispatch into
    `serve(daemon=False)`. That path never writes the daemon record, so `web stop`,
    `web restart` and `web status` cannot see the server the user was just told to
    launch at every login — and a later `web start` orphans a second one on a taken
    port. It is the exact failure `SETUP.md`'s autostart section exists to warn about.

    **Why not just assert the corrected sentence.** A literal check only re-transcribes
    the bug's shape: it is green for whatever string was typed last, so it says yes to
    the next wrong one just as readily. These assertions derive what a valid `web`
    invocation *is* — the launcher name from `package.json`'s `bin`, the verb, its
    action `choices` and its option names from the CLI table, and the branch that actually
    daemonises from `cmd_web`'s own dispatch. Advice naming no action, an action that
    is not offered, an unknown flag, or an action that does not daemonise each fails,
    and each fails by name.

    Every scrape below is fail-closed: finding nothing raises rather than passing.
    """

    # The advice, as it is written in each implementation. `harness_golden` proves the two
    # print the same bytes; this reads the SOURCE, so it still holds for the arm no cell
    # reaches, and it is what makes the two files' drift visible as drift.
    _SOURCES = (Path("rituals") / "_harness_build.py", Path("js") / "migrate.mjs")
    _ADVICE_RE = re.compile(r"update it by hand to run: (.+?)(?:\\n)?['\"]")

    def _advice(self, rel: Path) -> str:
        found = self._ADVICE_RE.findall(_read(ROOT / rel))
        self.assertEqual(len(found), 1,
                         f"{rel.as_posix()} should carry exactly one 'update it by hand "
                         f"to run:' advice, found {len(found)} — a scrape that matches "
                         "nothing must fail here, not pass silently")
        return found[0].strip()

    def test_both_implementations_advise_the_same_argv(self):
        py, js = (self._advice(p) for p in self._SOURCES)
        self.assertEqual(py, js, "the Python reference and js/migrate.mjs advise "
                                 "different commands; harness_golden compares their "
                                 "bytes, so one of them is about to go red")

    def test_the_advice_names_a_launcher_this_package_installs(self):
        """The table's `prog` is `harness` — the launcher name is the npm `bin` key, so
        that is where it is derived from."""
        bins = json.loads(_read(ROOT / "package.json"))["bin"]
        for rel in self._SOURCES:
            token = self._advice(rel).split()[0]
            self.assertIn(token, bins,
                          f"{rel.as_posix()} advises running '{token}', which is not one "
                          f"of the commands this package installs ({sorted(bins)})")

    def test_the_advice_names_a_real_web_action(self):
        """The regression itself: an argv that names no action is not a daemon."""
        spec = json.loads(_read(ROOT / "js" / "cli-table.json"))
        commands = {c["name"]: c for c in spec["commands"]}
        self.assertGreater(len(commands), 20, "js/cli-table.json parsed to almost nothing")
        for rel in self._SOURCES:
            tokens = self._advice(rel).split()[1:]
            verb, rest = tokens[0], tokens[1:]
            self.assertIn(verb, commands, f"{rel.as_posix()} advises the verb '{verb}', "
                                          "which the CLI table does not declare")
            cmd = commands[verb]
            known = {n for o in cmd["options"] for n in o["names"]}
            positional = [t for t in rest if not t.startswith("-")]
            for flag in (t for t in rest if t.startswith("-")):
                self.assertIn(flag, known, f"{rel.as_posix()} advises '{flag}', which is "
                                           f"not an option of `{verb}`")
            choices = [p["choices"] for p in cmd["positionals"] if p["choices"]]
            self.assertEqual(len(choices), 1,
                             f"`{verb}` no longer has exactly one positional with "
                             "choices — this gate needs re-aiming, not deleting")
            self.assertEqual(len(positional), 1,
                             f"{rel.as_posix()} advises `{verb}` with {len(positional)} "
                             f"action(s), {positional} — an autostart entry must name "
                             f"one of {choices[0]}, or it runs the foreground path that "
                             "writes no daemon record")
            self.assertIn(positional[0], choices[0],
                          f"{rel.as_posix()} advises the action '{positional[0]}', which "
                          f"`{verb}` does not offer")

    def test_the_advised_action_is_the_one_that_daemonises(self):
        """Naming *an* action is not enough — `web stop --no-browser` would satisfy the
        grammar. The branch the advice reaches must be the one that spawns the detached,
        record-writing daemon, and that is read out of `cmd_web`'s own dispatch."""
        dispatch = _web_dispatch()
        for rel in self._SOURCES:
            action = [t for t in self._advice(rel).split()[2:] if not t.startswith("-")][0]
            self.assertIn(action, dispatch,
                          f"cmd_web has no `action == {action!r}` branch — the advice in "
                          f"{rel.as_posix()} reaches the fallthrough, which is "
                          "`serve()` in the foreground")
            self.assertTrue(any(n.endswith("start_daemon") for n in dispatch[action]),
                            f"{rel.as_posix()} advises `web {action}`, whose branch calls "
                            f"{sorted(dispatch[action])} — none of which starts the "
                            "daemon that writes the record `web stop` reads")


def _web_dispatch() -> dict[str, set[str]]:
    """`cmd_web`'s action dispatch, read from the source: action -> the methods its
    branch calls. Static because the alternative is importing the TUI module, which
    pulls curses in on Windows for no gain here."""
    tree = ast.parse(_read(ROOT / "rituals" / "_harness_tui.py"))
    fns = [n for n in ast.walk(tree)
           if isinstance(n, ast.FunctionDef) and n.name == "cmd_web"]
    if len(fns) != 1:
        raise AssertionError(f"expected one cmd_web in _harness_tui.py, found {len(fns)}")
    out: dict[str, set[str]] = {}
    for node in ast.walk(fns[0]):
        if not (isinstance(node, ast.If) and isinstance(node.test, ast.Compare)):
            continue
        test = node.test
        if not (isinstance(test.left, ast.Name) and test.left.id == "action"
                and len(test.ops) == 1 and isinstance(test.ops[0], ast.Eq)
                and isinstance(test.comparators[0], ast.Constant)
                and isinstance(test.comparators[0].value, str)):
            continue
        called = {c.func.attr for c in ast.walk(node)
                  if isinstance(c, ast.Call) and isinstance(c.func, ast.Attribute)}
        out.setdefault(test.comparators[0].value, set()).update(called)
    return out


if __name__ == "__main__":
    unittest.main()
