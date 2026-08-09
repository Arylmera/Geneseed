#!/usr/bin/env python3
"""Harness acceptance harness — prove two harness CLIs BEHAVE the same.

`tests/golden.py` is the gate the generator port was measured against: two generators are
equivalent when the TREE they write is byte-identical. That question does not transfer to
a runtime verb. `harness git-gate` writes nothing at all; its entire output is a JSON
object on stdout. `harness context` writes nothing and prints a document. `harness learn`
writes files, prints to both streams, AND returns the model's exit code. So a cell here is
not "one emit into one sandbox" — it is:

    one VERB invocation, in one seeded world, compared on
      * stdout        (normalised)
      * stderr        (normalised)
      * the exit code (a hook's contract: 0 on every path, and learn's passthrough)
      * every file left behind (normalised, same snapshot machinery as golden)

    python tests/harness_golden.py                              # determinism self-check
    python tests/harness_golden.py --only context               # one verb, fast
    python tests/harness_golden.py --new "node bin/geneseed-hook.mjs" \
                                  --new-cli "node bin/geneseed-cli.mjs"     # the P5 gate

TWO CANDIDATE BINARIES, ONE REFERENCE
-------------------------------------
`rituals/harness.py` answers all 24 subcommands, so the REFERENCE side is one command for
every cell. The Node side is split: `bin/geneseed-hook.mjs` carries the four verbs a hook
invokes and stays minimal because the shim execs it on every tool call, and
`bin/geneseed-cli.mjs` carries the rest. So a cell declares which one answers it — `bin`,
defaulting to `"hook"` — and `--new-cli` supplies the second command.

Supplying `--new` while a selected cell needs `--new-cli` REFUSES rather than quietly
comparing that cell's reference against itself: a ref-vs-ref cell always passes, which reads
exactly like a ported verb. Same discipline as `--only` refusing an empty selection.

DO NOT MISTAKE THE SELF-CHECK FOR A REGRESSION GATE — the same warning golden.py carries.
With no --new this runs the reference CLI against ITSELF and proves only that the cells are
deterministic. It is still worth running: several of these verbs read the clock
(`append_agent_lesson` stamps a date), the environment, and the user's own files, and a
cell that is not deterministic cannot gate anything.

WHY THE CELLS CARRY `expect` AS WELL AS COMPARING
-------------------------------------------------
P4e/M43: a cross-implementation comparison is structurally blind to a defect BOTH sides
share. That risk is higher here than it was for the generator, because the four HOOK verbs
are silent on almost every path by design — a hook must never break a tool call, so every
unreadable payload, every missing file and every bypass exits 0 with no output. Two CLIs
that both stopped gating would agree perfectly, in every cell, forever.

So each cell also states, ABSOLUTELY, what the reference must produce: `expect` substrings
that have to appear, `expect_silent` for the paths whose whole contract is saying nothing,
and `expect_files` for the ones that write. Those run against the REFERENCE side and fail
the cell when they do not hold — a cell that has stopped exercising what it names is
reported as vacuous rather than banked as a pass. `test_hook_cli_parity.py` asserts that
every cell carries at least one of them.

AND IT IS NOT ONLY THE SILENT VERBS. `build` is loud and its first three cells still
asserted the wrong thing: `harness build` printed nothing, so they were written
`expect_silent=True` — a faithful record of a Windows bug in `_harness_core.run`, stated
absolutely, in the file whose job is stating things absolutely. The absolute half answers
"what does the reference do", never "is the reference right"; only reading the two
implementations against each other asks the second question. See the `build` section.

SAFETY: every cell runs under `golden.cell_env`, which redirects HOME/USERPROFILE/XDG/
APPDATA/LOCALAPPDATA into a throwaway dir and clears every host relocation variable and
every inherited `GENESEED_*` knob. That matters as much here as it does for the generator
and for a second reason: `learn` WRITES, and `_resolve_memory_dir` falls back to the
OpenCode global config dir — so an unsandboxed learn cell appends to the developer's real
memory store. A cell's own `env` is applied as an overlay ON TOP of that cleared base, so
every knob a cell depends on is stated by the cell instead of inherited from the machine.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import golden  # noqa: E402  (needs tests/ on the path first)

ROOT = golden.ROOT
FAKE_LLM = ROOT / "tests" / "fixtures" / "fake_llm.py"

# One canned model reply, reused wherever the shape of the fact does not matter. Written
# as a fixture file rather than inline in the env so the fake CLI's contract stays "read a
# file", which is the only form that survives a multi-kilobyte reply.
FACT_ONE = """---
name: alpha-fact
description: the first canned fact
metadata:
  type: project
---

Body of the first fact. Links to [[beta-fact]].
"""

FACT_TWO = """---
name: beta-fact
description: the second canned fact
metadata:
  type: reference
---

Body of the second fact.
"""

# A Claude-Code-style transcript. `_flatten_transcript` keeps only user/assistant turns and
# flattens block content, so the tool_result line and the block list are both load-bearing.
TRANSCRIPT = (
    '{"message": {"role": "user", "content": "why does the build fail on windows"}}\n'
    '{"message": {"role": "assistant", "content": [{"type": "text", "text": "cp1252"},'
    ' {"type": "tool_use", "name": "Bash"}]}}\n'
    '{"type": "tool_result", "content": "ignored"}\n'
    '\n'
    'not json at all\n'
    '{"message": {"role": "assistant", "content": ""}}\n'
)


def _payload(**kw) -> str:
    """A hook payload as the host writes it. Spelled out rather than json.dumps-ed so the
    cell shows the literal bytes the gate parses."""
    return json.dumps(kw)


def cells() -> list[dict]:
    """Every cell, grouped by verb. A cell is a dict:

        id            "<verb>/<name>", the display key and the --only prefix
        bin           which candidate binary answers this verb: "hook" (default) or "cli".
                      The REFERENCE is one command for every cell — `rituals/harness.py`
                      answers all 24 subcommands — so only the candidate side splits.
        world         {relative path: text} seeded into the sandbox before the run
        checkout      {relative path: text or None} planted into a fresh COPY of the
                      tracked checkout, which this cell's CLI is then run FROM. `{}` is a
                      clean copy and is not the same as omitting the key — omitting it
                      runs against the real checkout, as every other cell does. See
                      `_copy_checkout` for why a verb that reads `ROOT` needs this.
        steps         [{argv, stdin, cwd, seed}] — more than one runs them in order into the
                      SAME sandbox, and only the LAST step's streams are compared (the
                      others' effects survive in the tree, which is the point). `seed` is a
                      world fragment written just BEFORE that step, for the files an earlier
                      step produces and this one must find changed.
        env           overlay on golden.cell_env — the knobs this cell depends on
        expect        substrings the REFERENCE must print on stdout+stderr
        expect_absent substrings the reference must NOT print — the direction `expect`
                      cannot express, and the only way to gate a filter (EXCLUDE_DIRS, a
                      manifest replacing discovery) whose whole job is leaving things out
        expect_re     regexes the reference's output must MATCH. For the values a cell
                      cannot name without rotting: `status` counts the real `src/` tree
                      (see the status section on why no fixture can redirect it), so the
                      only honest absolute assertion is the SHAPE — `[1-9]\\d* agents` says
                      the line is still there and still counting something, and the byte
                      comparison is what gates the numbers themselves.
        expect_silent the reference must print NOTHING on stdout
        expect_files  paths that must exist in the sandbox afterwards
        expect_absent_files
                      paths (files OR directories) that must NOT exist afterwards — the
                      absolute half of a DELETION, added in P5h. Seed it in `world` and
                      name it here and the cell states that the reference removed it;
                      without it, two implementations that both stopped deleting compare
                      equal. Directories are covered because the snapshot now carries a
                      `<dirs>` column (see `run_cell`).

    Placeholders `{sb}` `{home}` `{repo}` `{cfg}` `{py}` `{llm}` are substituted in world
    contents, argv, stdin and env values once the sandbox exists — plus `{ck}`, the copied
    checkout, for the cells that have one. Each path one also has a
    `{sb/}` form spelling the same path with forward slashes, and JSON contexts MUST use
    it: a Windows sandbox root inside a JSON string literal is `C:\\Users\\...`, whose `\\U`
    is an invalid escape, so the document fails to parse and the cell silently tests the
    unparseable-input path instead of the one it names. Six cells were written that way
    and every one of them was caught by its own `expect` rather than by review.
    """
    return (_context_cells() + _git_gate_cells() + _rule_gate_cells() + _learn_cells()
            + _exclude_cells() + _status_cells() + _version_cells()
            + _build_cells() + _prompt_cells() + _theme_cells()
            + _diff_cells() + _rebuild_all_cells() + _doctor_cells()
            + _uninstall_cells() + _setup_cells())


# --------------------------------------------------------------------------------------
# context
# --------------------------------------------------------------------------------------

_DOCS_WORLD = {
    "repo/README.md": "# Project\n\nThe readme.\n",
    "repo/CLAUDE.md": "# Instructions\n\nBe careful.\n",
    "repo/NOTES.md": "loose root markdown — lazy, not eager\n",
    "repo/docs/architecture.md": "# Architecture\n",
    "repo/docs/nested/deep.md": "# Deep\n",
    "repo/docs/node_modules/vendored.md": "must never be listed\n",
    "repo/packages/widget/README.md": "# widget\n",
    "repo/packages/widget/index.js": "// not markdown\n",
    "repo/apps/site/README.md": "# site\n",
}


def _context_cells() -> list[dict]:
    def ctx(**kw):
        kw.setdefault("steps", [{"argv": ["context"], "cwd": "repo"}])
        return kw

    return [
        ctx(id="context/discovery", world=_DOCS_WORLD,
            expect=["PROJECT CONTEXT", "auto-discovery", "The readme.", "Be careful.",
                    "Lazy entries", "docs/architecture.md", "packages/widget/README.md",
                    "apps/site/README.md"]),
        ctx(id="context/discovery-excludes-vendored", world=_DOCS_WORLD,
            # The inverse of the cell above, and it needs its own direction: a filter's
            # whole job is leaving things out, and `expect` cannot say "and nothing else".
            # `docs/nested/deep.md` proves the rglob really did descend, so the absence of
            # the vendored sibling is the filter and not an empty walk.
            expect=["docs/nested/deep.md"],
            expect_absent=["vendored.md", "index.js"]),
        ctx(id="context/empty-repo", world={"repo/.keep": ""},
            expect_silent=True, expect=["nothing to load"]),
        ctx(id="context/manifest",
            world=dict(_DOCS_WORLD, **{"repo/context.json": (
                '{"context": [{"path": "README.md", "load": "eager",'
                ' "description": "the front door"},'
                ' {"path": "docs/architecture.md", "load": "lazy",'
                ' "description": "how it hangs together"}]}\n')}),
            expect=["the front door", "how it hangs together", "The readme."]),
        ctx(id="context/manifest-overrides-discovery",
            world=dict(_DOCS_WORLD, **{"repo/context.json":
                                       '{"context": [{"path": "NOTES.md"}]}\n'}),
            # An explicit manifest REPLACES discovery, and that is the assertion: CLAUDE.md
            # and README.md are eager by convention, so their CONTENT appearing here would
            # mean discovery ran anyway. Only `expect_absent` can state that.
            expect=["context.json", "loose root markdown"],
            expect_absent=["Be careful.", "The readme."]),
        ctx(id="context/manifest-extend",
            world=dict(_DOCS_WORLD, **{"repo/context.json": (
                '{"extend": true, "context": [{"path": "NOTES.md", "load": "eager",'
                ' "description": "promoted"}]}\n')}),
            expect=["promoted", "The readme.", "loose root markdown"]),
        ctx(id="context/manifest-glob",
            world=dict(_DOCS_WORLD, **{"repo/context.json": (
                '{"extend": true, "context": [{"path": "docs/*.md", "load": "eager",'
                ' "description": "docs promoted"}]}\n')}),
            expect=["docs promoted", "# Architecture"]),
        ctx(id="context/manifest-empty-falls-through",
            world=dict(_DOCS_WORLD, **{"repo/context.json": '{"context": []}\n'}),
            expect=["auto-discovery", "empty context.json", "The readme."]),
        # Four shapes, because the decoder's own message is deliberately not printed and
        # this is what proves the four still land in the same branch. Python's json and V8
        # disagree on the wording AND the offset for every one of them — a trailing comma
        # points at the comma in Python and at the character after it in V8 — which is why
        # the message names the file instead of quoting a decoder.
        *[ctx(id=f"context/manifest-unparseable-{name}",
              world=dict(_DOCS_WORLD, **{"repo/context.json": text}),
              expect_silent=True,
              expect=["is not valid JSON", "fix the syntax"])
          for name, text in (("unquoted-key", "{not json\n"),
                             ("trailing-comma", '{"context": [{"path": "a"},]}\n'),
                             ("missing-comma", '{"context": [], "extend": true "x": 1}\n'),
                             ("truncated", '{"context": [{"path": "a"\n'))],
        # Valid JSON of the WRONG SHAPE. A user hand-edits this file, and each of these
        # raised out of a SessionStart hook before the guards went in: no `.get` on a list,
        # an object under "context" iterating to strings, a string entry, a numeric path.
        # They are four cells and not one because they land in two different places — the
        # first two fall through to discovery, the last two produce nothing at all.
        ctx(id="context/manifest-is-a-list", world=dict(_DOCS_WORLD, **{
            "repo/context.json": '["README.md"]\n'}),
            expect=["auto-discovery", "The readme."]),
        ctx(id="context/manifest-context-is-an-object", world=dict(_DOCS_WORLD, **{
            "repo/context.json": '{"context": {"path": "README.md"}}\n'}),
            expect=["auto-discovery", "The readme."]),
        ctx(id="context/manifest-entry-is-a-string", world=dict(_DOCS_WORLD, **{
            "repo/context.json": '{"context": ["README.md"]}\n'}),
            expect_silent=True, expect=["nothing to load"]),
        ctx(id="context/manifest-entry-path-is-a-number", world=dict(_DOCS_WORLD, **{
            "repo/context.json": '{"context": [{"path": 7}]}\n'}),
            expect_silent=True, expect=["nothing to load"]),
        ctx(id="context/harness-dir-wins",
            world=dict(_DOCS_WORLD, **{
                "repo/context.json": '{"context": [{"path": "NOTES.md"}]}\n',
                "repo/.harness/context.json":
                    '{"context": [{"path": "CLAUDE.md", "description": "from .harness"}]}\n'}),
            expect=["from .harness", "Be careful."]),
        ctx(id="context/env-manifest-wins",
            world=dict(_DOCS_WORLD, **{
                "repo/context.json": '{"context": [{"path": "NOTES.md"}]}\n',
                "elsewhere/ctx.json":
                    '{"context": [{"path": "CLAUDE.md", "description": "from $GENESEED_CONTEXT"}]}\n'}),
            env={"GENESEED_CONTEXT": "{sb}/elsewhere/ctx.json"},
            expect=["from $GENESEED_CONTEXT", "Be careful."]),
        ctx(id="context/env-root-overrides-cwd", world=_DOCS_WORLD,
            steps=[{"argv": ["context"], "cwd": "cfg"}],
            env={"GENESEED_ROOT": "{repo}"},
            expect=["The readme.", "Be careful."]),
        ctx(id="context/missing-eager-file",
            world={"repo/context.json":
                   '{"context": [{"path": "gone.md", "description": "not there"}]}\n'},
            expect=["MISSING eager file"]),
        ctx(id="context/absolute-path-entry",
            world=dict(_DOCS_WORLD, **{
                "outside/handbook.md": "# Handbook\n",
                "repo/context.json":
                    '{"context": [{"path": "{sb/}/outside/handbook.md",'
                    ' "description": "outside the repo"}]}\n'}),
            expect=["# Handbook", "outside the repo"]),
        ctx(id="context/case-folded-sort-order",
            # `sorted(Path...)` folds case on Windows and does not on POSIX, so the LISTED
            # ORDER of the lazy entries is platform-dependent — and a JS `sort()` with no
            # comparator sorts by UTF-16 code unit, which puts every capital before every
            # lowercase. `Zebra` vs `alpha` is the pair that separates the two; a world of
            # all-lowercase names cannot, which is why this cell is not `_DOCS_WORLD`.
            world={"repo/README.md": "# root\n", "repo/Zebra.md": "z\n",
                   "repo/alpha.md": "a\n", "repo/Beta.md": "b\n"},
            expect=["Zebra.md", "alpha.md", "Beta.md"]),
        ctx(id="context/non-ascii-doc",
            world={"repo/README.md": "# Dépôt — résumé\n\nAccented ✓ and an em dash —.\n"},
            expect=["Dépôt", "em dash"]),
        # ---- the two stand-down paths ----
        ctx(id="context/global-stands-down-for-project",
            world=dict(_DOCS_WORLD, **{
                "repo/.claude/.geneseed-manifest.json": '{"owned": []}\n',
                "home/.claude/.geneseed-manifest.json": '{"owned": []}\n'}),
            steps=[{"argv": ["context", "--root", "{home}/.claude"], "cwd": "repo"}],
            expect_silent=True),
        ctx(id="context/global-stacking-opt-out",
            world=dict(_DOCS_WORLD, **{
                "repo/.claude/.geneseed-manifest.json": '{"owned": []}\n',
                "home/.claude/.geneseed-manifest.json": '{"owned": []}\n'}),
            steps=[{"argv": ["context", "--root", "{home}/.claude"], "cwd": "repo"}],
            env={"GENESEED_STACK_GLOBAL": "1"},
            expect=["PROJECT CONTEXT", "The readme."]),
        ctx(id="context/project-hook-does-not-stand-down-for-itself",
            world=dict(_DOCS_WORLD, **{
                "repo/.claude/.geneseed-manifest.json": '{"owned": []}\n'}),
            steps=[{"argv": ["context", "--root", "{repo}/.claude"], "cwd": "repo"}],
            expect=["PROJECT CONTEXT", "The readme."]),
        ctx(id="context/non-marker-root-never-stands-down",
            world=dict(_DOCS_WORLD, **{
                "repo/.claude/.geneseed-manifest.json": '{"owned": []}\n',
                "cfg/.geneseed-manifest.json": '{"owned": []}\n'}),
            # An opencode-global install's root is `~/.config/opencode`, not a marker dir,
            # so the project-bypasses-global rule must not fire for it.
            steps=[{"argv": ["context", "--root", "{cfg}"], "cwd": "repo"}],
            expect=["PROJECT CONTEXT"]),
        # ---- the sovereign-repo bypass ----
        ctx(id="context/sovereign-bypass",
            world=dict(_DOCS_WORLD, **{
                "cfg/excludes.json": '{"excludes": [{"path": "{repo/}"}]}\n'}),
            steps=[{"argv": ["context", "--root", "{cfg}"], "cwd": "repo"}],
            expect_silent=True),
        ctx(id="context/sovereign-bypass-bare-string",
            world=dict(_DOCS_WORLD, **{
                "cfg/excludes.json": '{"excludes": ["{repo/}"]}\n'}),
            steps=[{"argv": ["context", "--root", "{cfg}"], "cwd": "repo"}],
            expect_silent=True),
        ctx(id="context/sovereign-bypass-subfolder",
            world=dict(_DOCS_WORLD, **{
                "cfg/excludes.json": '{"excludes": [{"path": "{sb/}"}]}\n'}),
            steps=[{"argv": ["context", "--root", "{cfg}"], "cwd": "repo"}],
            expect_silent=True),
        ctx(id="context/sovereign-miss",
            world=dict(_DOCS_WORLD, **{
                "cfg/excludes.json": '{"excludes": [{"path": "{sb/}/elsewhere"}]}\n'}),
            steps=[{"argv": ["context", "--root", "{cfg}"], "cwd": "repo"}],
            expect=["PROJECT CONTEXT"]),
        ctx(id="context/sovereign-prefix-is-not-a-match",
            world=dict(_DOCS_WORLD, **{
                # `{repo}` is `<sb>/repo`; `<sb>/rep` must not swallow it. A `startswith`
                # without the separator would, and both implementations would agree.
                "cfg/excludes.json": '{"excludes": [{"path": "{sb/}/rep"}]}\n'}),
            steps=[{"argv": ["context", "--root", "{cfg}"], "cwd": "repo"}],
            expect=["PROJECT CONTEXT"]),
        ctx(id="context/sovereign-bypass-does-not-match-a-dotdot-entry",
            # The hook-side twin of `exclude/remove-does-not-match-a-dotdot-entry`, and it
            # found a live defect rather than confirming one. `sovereign_bypass` compares
            # `str(Path(entry).expanduser())`, which KEEPS `..`; `js/hooks.mjs` had its own
            # `str(Path(...))` under the name `pyStrPath`, built on `path.normalize`, which
            # collapses it. So a hand-edited entry made the NODE hook stand down for a repo
            # Python still gates — and no cell saw it, because P5c's 25-path corpus was
            # pointed at `pyPathStr` and a different NAME is all it took to hide the twin.
            world=dict(_DOCS_WORLD, **{
                "cfg/excludes.json": '{"excludes": [{"path": "{repo/}/../repo"}]}\n'}),
            steps=[{"argv": ["context", "--root", "{cfg}"], "cwd": "repo"}],
            expect=["PROJECT CONTEXT"]),
        ctx(id="context/sovereign-malformed-degrades-to-off",
            world=dict(_DOCS_WORLD, **{"cfg/excludes.json": "{not json\n"}),
            steps=[{"argv": ["context", "--root", "{cfg}"], "cwd": "repo"}],
            expect=["PROJECT CONTEXT"]),
        ctx(id="context/sovereign-absent-file-degrades-to-off", world=_DOCS_WORLD,
            steps=[{"argv": ["context", "--root", "{cfg}"], "cwd": "repo"}],
            expect=["PROJECT CONTEXT"]),
    ]


# --------------------------------------------------------------------------------------
# git-gate
# --------------------------------------------------------------------------------------

def _git_gate_cells() -> list[dict]:
    def gg(name, command, root=None, world=None, **kw):
        argv = ["git-gate"] + (["--root", root] if root else [])
        return dict(id=f"git-gate/{name}", world=world or {"repo/.keep": ""},
                    steps=[{"argv": argv, "cwd": "repo",
                            "stdin": _payload(tool_name="Bash",
                                              tool_input={"command": command})}], **kw)

    ASK = "permissionDecision"
    return [
        gg("commit", "git commit -m 'x'", expect=[ASK, "Law XX"]),
        gg("push", "git push origin main", expect=[ASK]),
        gg("chained", "git add . && git commit -m x && git push", expect=[ASK]),
        gg("dash-C", "git -C /some/other/repo commit -m x", expect=[ASK]),
        gg("inside-a-longer-line", "cd /tmp; git commit -m x; echo done", expect=[ASK]),
        gg("status-is-not-gated", "git status --porcelain", expect_silent=True),
        gg("commit-word-without-git", "npm run commit", expect_silent=True),
        gg("git-without-commit-or-push", "git log --oneline -5", expect_silent=True),
        # Newline is the boundary the pattern draws: `[^\n]*` means a `git` on one line
        # and a `commit` on the next is two commands, not one gated call.
        gg("git-and-commit-on-separate-lines", "git status\nnpm run commit",
           expect_silent=True),
        dict(id="git-gate/empty-stdin", world={"repo/.keep": ""},
             steps=[{"argv": ["git-gate"], "cwd": "repo", "stdin": ""}],
             expect_silent=True),
        dict(id="git-gate/unparseable-stdin", world={"repo/.keep": ""},
             steps=[{"argv": ["git-gate"], "cwd": "repo", "stdin": "not json at all"}],
             expect_silent=True),
        dict(id="git-gate/payload-without-tool-input", world={"repo/.keep": ""},
             steps=[{"argv": ["git-gate"], "cwd": "repo",
                     "stdin": _payload(tool_name="Bash")}],
             expect_silent=True),
        dict(id="git-gate/non-string-command", world={"repo/.keep": ""},
             steps=[{"argv": ["git-gate"], "cwd": "repo",
                     "stdin": _payload(tool_input={"command": 17})}],
             expect_silent=True),
        dict(id="git-gate/null-tool-input", world={"repo/.keep": ""},
             steps=[{"argv": ["git-gate"], "cwd": "repo",
                     "stdin": '{"tool_input": null}'}],
             expect_silent=True),
        gg("sovereign-bypass", "git commit -m x", root="{cfg}",
           world={"repo/.keep": "", "cfg/excludes.json":
                  '{"excludes": [{"path": "{repo/}"}]}\n'},
           expect_silent=True),
        gg("sovereign-miss-still-gates", "git commit -m x", root="{cfg}",
           world={"repo/.keep": "", "cfg/excludes.json":
                  '{"excludes": [{"path": "{sb/}/elsewhere"}]}\n'},
           expect=[ASK]),
    ]


# --------------------------------------------------------------------------------------
# rule-gate
# --------------------------------------------------------------------------------------

def _rule_gate_cells() -> list[dict]:
    # `path_value` lands inside a JSON payload, so it takes the `{repo/}` posix form; the
    # `--root` argument is ordinary argv and takes the native `{cfg}` one.
    def rg(name, path_value, root=None, world=None, key="file_path", **kw):
        argv = ["rule-gate"] + (["--root", root] if root else [])
        return dict(id=f"rule-gate/{name}", world=world or {"repo/.keep": ""},
                    steps=[{"argv": argv, "cwd": "repo",
                            "stdin": _payload(tool_name="Write",
                                              tool_input={key: path_value})}], **kw)

    ASK = "permissionDecision"
    return [
        rg("user-rules", "{repo/}/user-rules.md", expect=[ASK, "user-rules.md", "Law VI"]),
        rg("memory-index", "{repo/}/memory/MEMORY.md", expect=[ASK, "the memory index"]),
        rg("memory-index-anywhere", "{sb/}/elsewhere/MEMORY.md", expect=[ASK]),
        # The two coined names match on WHICHEVER host reads the payload, which is why the
        # split is on both separators. This cell is the POSIX-facing half and it is
        # VACUOUS on Windows — measured, not assumed: `path.basename` there already splits
        # on both, so swapping the split for a basename leaves it green (mutation M3). The
        # two cells below are what make that swap observable on this platform, and they are
        # the direction nobody would think to write: a name a BASENAME finds and a split
        # does not.
        rg("windows-path-on-any-host", "C:\\work\\repo\\user-rules.md", expect=[ASK]),
        rg("drive-relative-path-has-no-separator", "C:user-rules.md", expect_silent=True),
        rg("trailing-separator-leaves-no-name", "C:\\x\\user-rules.md\\",
           expect_silent=True),
        rg("memory-file-under-root", "{cfg/}/memory/some-fact.md", root="{cfg}",
           world={"repo/.keep": "", "cfg/memory/.keep": ""},
           expect=[ASK, "writing to memory"]),
        rg("memory-file-nested-under-root", "{cfg/}/memory/agents/explore.md", root="{cfg}",
           world={"repo/.keep": "", "cfg/memory/agents/.keep": ""}, expect=[ASK]),
        rg("unrelated-memory-dir-is-not-gated", "{repo/}/memory/notes.md", root="{cfg}",
           world={"repo/memory/.keep": "", "cfg/.keep": ""}, expect_silent=True),
        rg("memory-file-without-root", "{cfg/}/memory/some-fact.md",
           world={"repo/.keep": "", "cfg/memory/.keep": ""}, expect_silent=True),
        rg("non-markdown-under-memory", "{cfg/}/memory/notes.txt", root="{cfg}",
           world={"repo/.keep": "", "cfg/memory/.keep": ""}, expect_silent=True),
        rg("ordinary-file", "{repo/}/src/main.py", expect_silent=True),
        rg("ordinary-markdown", "{repo/}/README.md", expect_silent=True),
        rg("path-key-instead-of-file-path", "{repo/}/user-rules.md", key="path",
           expect=[ASK]),
        rg("case-insensitive-name", "{repo/}/User-Rules.MD", expect=[ASK]),
        dict(id="rule-gate/empty-stdin", world={"repo/.keep": ""},
             steps=[{"argv": ["rule-gate"], "cwd": "repo", "stdin": ""}],
             expect_silent=True),
        dict(id="rule-gate/unparseable-stdin", world={"repo/.keep": ""},
             steps=[{"argv": ["rule-gate"], "cwd": "repo", "stdin": "}{"}],
             expect_silent=True),
        dict(id="rule-gate/empty-path", world={"repo/.keep": ""},
             steps=[{"argv": ["rule-gate"], "cwd": "repo",
                     "stdin": _payload(tool_input={"file_path": ""})}],
             expect_silent=True),
        dict(id="rule-gate/non-string-path", world={"repo/.keep": ""},
             steps=[{"argv": ["rule-gate"], "cwd": "repo",
                     "stdin": _payload(tool_input={"file_path": []})}],
             expect_silent=True),
        rg("sovereign-bypass", "{repo/}/user-rules.md", root="{cfg}",
           world={"repo/.keep": "", "cfg/excludes.json":
                  '{"excludes": [{"path": "{repo/}"}]}\n'},
           expect_silent=True),
    ]


# --------------------------------------------------------------------------------------
# learn
# --------------------------------------------------------------------------------------

_LLM = {"GENESEED_LLM": "{py} {llm}", "FAKE_LLM_ECHO": "{sb}/echo/prompt.txt"}


def _learn_cells() -> list[dict]:
    def learn(name, argv, world=None, stdin="notes: the build fails on windows\n",
              env=None, steps=None, **kw):
        return dict(id=f"learn/{name}", world=world or {"repo/.keep": ""},
                    steps=steps or [{"argv": argv, "cwd": "repo", "stdin": stdin}],
                    env=env or {}, **kw)

    mem = {"repo/memory/.keep": ""}
    return [
        learn("no-llm-prints-the-prompt", ["learn"],
              # $GENESEED_LLM unset is the documented no-key path: the prompt goes to
              # stdout so it can be pasted anywhere. It carries LEARN_PROMPT_HEAD, which
              # both implementations lift out of the OpenCode plugin's source.
              expect=["$GENESEED_LLM unset", "NOTES:", "the build fails on windows"]),
        learn("no-llm-lists-existing-slugs", ["learn", "--memory", "{repo}/memory"],
              world={"repo/memory/alpha-fact.md": FACT_ONE},
              expect=["ALREADY STORED", "- alpha-fact"]),
        learn("empty-stdin", ["learn"], stdin="",
              expect_silent=True, expect=["nothing to distil"]),
        learn("whitespace-only-stdin", ["learn"], stdin="   \n\n  \n",
              expect_silent=True, expect=["nothing to distil"]),
        learn("writes-a-new-memory", ["learn", "--memory", "{repo}/memory"],
              world=dict(mem, **{"reply/out.md": FACT_ONE}),
              env=dict(_LLM, FAKE_LLM_OUT="{sb}/reply/out.md"),
              expect=["wrote 1 memory file", "alpha-fact"],
              expect_files=["repo/memory/alpha-fact.md", "repo/memory/MEMORY.md",
                            "echo/prompt.txt"]),
        learn("writes-two-memories", ["learn", "--memory", "{repo}/memory"],
              world=dict(mem, **{"reply/out.md": FACT_ONE + "---FILE---\n" + FACT_TWO}),
              env=dict(_LLM, FAKE_LLM_OUT="{sb}/reply/out.md"),
              expect=["wrote 2 memory file"],
              expect_files=["repo/memory/alpha-fact.md", "repo/memory/beta-fact.md"]),
        learn("second-run-dedups", None,
              world=dict(mem, **{"reply/out.md": FACT_ONE}),
              env=dict(_LLM, FAKE_LLM_OUT="{sb}/reply/out.md"),
              # Two invocations into one sandbox: the first writes, the second must see
              # its own slug and store nothing. Only the LAST run's streams are compared,
              # so `expect` describes the second.
              steps=[{"argv": ["learn", "--memory", "{repo}/memory"], "cwd": "repo",
                      "stdin": "notes one\n"},
                     {"argv": ["learn", "--memory", "{repo}/memory"], "cwd": "repo",
                      "stdin": "notes two\n"}],
              expect=["nothing new to store"]),
        learn("non-ascii-model-reply", ["learn", "--memory", "{repo}/memory"],
              world=dict(mem, **{"reply/out.md": FACT_ONE.replace(
                  "Body of the first fact.", "Le dépôt — résumé accentué.")}),
              env=dict(_LLM, FAKE_LLM_OUT="{sb}/reply/out.md"),
              # The model's reply is read through a pipe, and a bare `text=True` decodes it
              # with the console code page. This cell is the one that would show it: the
              # accented body is WRITTEN to the memory store, so a mis-decode outlives the
              # process instead of merely printing wrong.
              expect=["wrote 1 memory file"],
              expect_files=["repo/memory/alpha-fact.md"]),
        learn("non-ascii-model-reply-without-utf8-mode",
              ["learn", "--memory", "{repo}/memory"],
              world=dict(mem, **{"reply/out.md": FACT_ONE.replace(
                  "Body of the first fact.", "Le dépôt — résumé accentué.")}),
              # `cell_env` sets PYTHONUTF8=1, and that MASKS the defect this cell is for:
              # in UTF-8 mode `locale.getpreferredencoding(False)` is utf-8, so a bare
              # `text=True` on the model's pipe happens to be right. Nothing outside the
              # test suite sets that variable — measured across the launchers — so a real
              # Windows user is on the code-page path. Turning it off here is the mirror of
              # golden's deliberately-CLEARED-env hole: a variable the fixture SETS can
              # hide a bug just as well as one it clears. Vacuous on POSIX, where the
              # preferred encoding is UTF-8 either way.
              env=dict(_LLM, FAKE_LLM_OUT="{sb}/reply/out.md", PYTHONUTF8="0"),
              expect=["wrote 1 memory file"],
              expect_files=["repo/memory/alpha-fact.md"]),
        learn("model-says-nothing", ["learn", "--memory", "{repo}/memory"],
              world=dict(mem, **{"reply/out.md": "NOTHING\n"}),
              env=dict(_LLM, FAKE_LLM_OUT="{sb}/reply/out.md"),
              expect=["NOTHING"]),
        learn("model-fails-loudly", ["learn", "--memory", "{repo}/memory"],
              world=dict(mem, **{"reply/out.md": ""}),
              env=dict(_LLM, FAKE_LLM_OUT="{sb}/reply/out.md",
                       FAKE_LLM_ERR="model: quota exceeded\n", FAKE_LLM_RC="7"),
              # The exit code is part of the compared surface: `learn` returns the model's,
              # so a port that swallowed it would look identical on both streams.
              expect=["quota exceeded"]),
        learn("no-memory-dir-passes-output-through", ["learn"],
              world=dict({"repo/.keep": ""}, **{"reply/out.md": FACT_ONE}),
              env=dict(_LLM, FAKE_LLM_OUT="{sb}/reply/out.md"),
              expect=["alpha-fact"]),
        learn("memory-from-env", ["learn"],
              world=dict(mem, **{"reply/out.md": FACT_ONE}),
              env=dict(_LLM, FAKE_LLM_OUT="{sb}/reply/out.md",
                       GENESEED_MEMORY="{repo}/memory"),
              expect=["wrote 1 memory file"], expect_files=["repo/memory/alpha-fact.md"]),
        learn("memory-beside-cwd", ["learn"],
              world=dict(mem, **{"reply/out.md": FACT_ONE}),
              env=dict(_LLM, FAKE_LLM_OUT="{sb}/reply/out.md"),
              expect=["wrote 1 memory file"], expect_files=["repo/memory/alpha-fact.md"]),
        learn("memory-under-harness", ["learn"],
              world={"repo/Harness/memory/.keep": "", "reply/out.md": FACT_ONE},
              env=dict(_LLM, FAKE_LLM_OUT="{sb}/reply/out.md"),
              expect=["wrote 1 memory file"],
              expect_files=["repo/Harness/memory/alpha-fact.md"]),
        learn("memory-named-anamnesis", ["learn"],
              world={"repo/anamnesis/.keep": "", "reply/out.md": FACT_ONE},
              env=dict(_LLM, FAKE_LLM_OUT="{sb}/reply/out.md"),
              expect=["wrote 1 memory file"],
              expect_files=["repo/anamnesis/alpha-fact.md"]),
        learn("memory-from-geneseed-harness", ["learn"],
              world={"repo/.keep": "", "install/memory/.keep": "",
                     "reply/out.md": FACT_ONE},
              env=dict(_LLM, FAKE_LLM_OUT="{sb}/reply/out.md",
                       GENESEED_HARNESS="{sb}/install"),
              expect=["wrote 1 memory file"],
              expect_files=["install/memory/alpha-fact.md"]),
        learn("memory-from-the-opencode-global-store", ["learn"],
              # The last fallback in `_resolve_memory_dir`, and the only one that leaves
              # the sandbox's own tree: it asks the generator where an opencode-global
              # install would be. XDG is redirected by cell_env, so it lands under home.
              world={"repo/.keep": "", "home/.config/opencode/memory/.keep": "",
                     "reply/out.md": FACT_ONE},
              env=dict(_LLM, FAKE_LLM_OUT="{sb}/reply/out.md"),
              expect=["wrote 1 memory file"],
              expect_files=["home/.config/opencode/memory/alpha-fact.md"]),
        learn("notes-from-a-file", ["learn", "{sb}/notes.md"],
              world={"repo/.keep": "", "notes.md": "a fact worth keeping\n"}, stdin="",
              expect=["a fact worth keeping"]),
        learn("transcript-payload-is-flattened", ["learn"],
              stdin='{"transcript_path": "{sb/}/transcript.jsonl"}',
              world={"repo/.keep": "", "transcript.jsonl": TRANSCRIPT},
              expect=["user: why does the build fail", "assistant: cp1252"]),
        learn("transcript-path-that-does-not-exist", ["learn"],
              stdin='{"transcript_path": "{sb/}/absent.jsonl"}',
              expect_silent=True, expect=["nothing to distil"]),
        learn("json-stdin-without-a-transcript-path", ["learn"],
              stdin='{"hook_event_name": "Stop"}',
              expect=["hook_event_name"]),
        learn("notes-tail-is-kept", ["learn"],
              stdin="HEAD-MARKER\n" + ("filler line\n" * 3000) + "TAIL-MARKER\n",
              expect=["TAIL-MARKER"], expect_absent=["HEAD-MARKER"]),
        learn("notes-tail-is-counted-in-code-points", ["learn"],
              # `notes[-16000:]` counts CODE POINTS; a JS `slice(-16000)` counts UTF-16
              # units and keeps roughly half as much text once astral characters are in
              # play — and can cut a surrogate pair in half on the way. An all-BMP fixture
              # cannot tell the two apart, so this one is deliberately not all-BMP. It runs
              # on the no-LLM path so the prompt lands on stdout instead of in an argv,
              # which on Windows has a 32k ceiling this would otherwise breach.
              stdin="HEAD-MARKER\n" + ("X" * 14000) + ("\U0001F600" * 3000) + "\nTAIL\n",
              expect=["TAIL"], expect_absent=["HEAD-MARKER"]),
        learn("subagent-lesson", ["learn", "--memory", "{repo}/memory"],
              world=dict(mem, **{"reply/out.md": "Always read the target before porting.\n"}),
              env=dict(_LLM, FAKE_LLM_OUT="{sb}/reply/out.md"),
              stdin=_payload(hook_event_name="SubagentStop", agent_name="explore",
                             transcript_path=""),
              expect=["agent lesson"], expect_files=["repo/memory/agents/explore.md"]),
        learn("subagent-lesson-alternate-name-field", ["learn", "--memory", "{repo}/memory"],
              world=dict(mem, **{"reply/out.md": "Always read the target before porting.\n"}),
              env=dict(_LLM, FAKE_LLM_OUT="{sb}/reply/out.md"),
              stdin=_payload(hook_event_name="SubagentStop", subagent_type="code-reviewer"),
              expect=["agent lesson"],
              expect_files=["repo/memory/agents/code-reviewer.md"]),
        learn("subagent-unnamed-is-a-silent-no-op", ["learn", "--memory", "{repo}/memory"],
              world=mem,
              env=dict(_LLM, FAKE_LLM_OUT="{sb}/reply/out.md"),
              stdin=_payload(hook_event_name="SubagentStop"),
              expect_silent=True),
        learn("subagent-lesson-too-short-is-dropped", ["learn", "--memory", "{repo}/memory"],
              world=dict(mem, **{"reply/out.md": "ok\n"}),
              env=dict(_LLM, FAKE_LLM_OUT="{sb}/reply/out.md"),
              stdin=_payload(hook_event_name="SubagentStop", agent_name="explore"),
              expect_silent=True),
        learn("subagent-lesson-appends", None,
              world=dict(mem, **{"reply/out.md": "Always read the target before porting.\n",
                                 "reply/two.md": "Then re-measure what the brief claimed.\n"}),
              env=dict(_LLM, FAKE_LLM_OUT="{sb}/reply/out.md"),
              steps=[{"argv": ["learn", "--memory", "{repo}/memory"], "cwd": "repo",
                      "stdin": _payload(hook_event_name="SubagentStop", agent_name="explore")},
                     {"argv": ["learn", "--memory", "{repo}/memory"], "cwd": "repo",
                      "stdin": _payload(hook_event_name="SubagentStop", agent_name="explore")}],
              expect=["agent lesson"], expect_files=["repo/memory/agents/explore.md"]),
        learn("subagent-lesson-drops-the-oldest-bullet",
              ["learn", "--memory", "{repo}/memory"],
              # The 100-bullet cap needs a file that is ALREADY at the cap; running the
              # verb a hundred times to reach it would be the same assertion at a hundred
              # times the cost. Seeding the precondition is what makes an
              # empty-precondition hole reachable at all.
              world=dict(mem, **{
                  "reply/out.md": "Read the target before trusting any brief.\n",
                  "repo/memory/agents/explore.md": "# explore — lessons\n" + "".join(
                      f"- 2026-01-0{n % 9 + 1}: seeded lesson number {n:03d}\n"
                      for n in range(100))}),
              env=dict(_LLM, FAKE_LLM_OUT="{sb}/reply/out.md"),
              stdin=_payload(hook_event_name="SubagentStop", agent_name="explore"),
              expect=["agent lesson"],
              expect_files=["repo/memory/agents/explore.md"]),
        learn("sovereign-bypass", ["learn", "--memory", "{cfg}/memory"],
              world={"repo/.keep": "", "cfg/memory/.keep": "", "reply/out.md": FACT_ONE,
                     "cfg/excludes.json": '{"excludes": [{"path": "{repo/}"}]}\n'},
              env=dict(_LLM, FAKE_LLM_OUT="{sb}/reply/out.md"),
              expect_silent=True),
        learn("consolidate", ["learn", "--memory", "{repo}/memory", "--consolidate"],
              world={"repo/memory/alpha-fact.md": FACT_ONE,
                     "repo/memory/beta-fact.md": FACT_TWO,
                     "repo/memory/gamma-fact.md": FACT_TWO.replace("beta-fact", "gamma-fact"),
                     "repo/memory/README.md": "# not a fact\n",
                     "repo/memory/MEMORY.md":
                         "# Memory Index\n\n- [alpha-fact](alpha-fact.md) — old text\n"
                         "- [dead-fact](dead-fact.md) — file is gone\n"},
              stdin="",
              # +2 indexed (beta, gamma), -1 pruned (dead), 1 duplicate description —
              # beta and gamma share one, which is reported and never auto-merged.
              expect=["consolidated", "+2 indexed", "-1 pruned",
                      "1 duplicate description", "duplicate: beta-fact <-> gamma-fact"],
              expect_files=["repo/memory/MEMORY.md"]),
        learn("consolidate-without-a-store", ["learn", "--consolidate"], stdin="",
              expect_silent=True, expect=["no memory store found"]),
    ]


# --------------------------------------------------------------------------------------
# exclude  —  the first NON-hook verb, answered by `bin/geneseed-cli.mjs`
# --------------------------------------------------------------------------------------
#
# A global install is "a host config dir holding a Geneseed manifest", so every cell seeds
# that file rather than running an emit. `golden.cell_env` redirects HOME/USERPROFILE/XDG
# into `{home}` and CLEARS every `*_CONFIG_DIR` relocation variable, which is what puts the
# four hosts at fixed, seedable paths under the sandbox.

_MANIFEST = '{"owned": []}\n'
_CLAUDE = {"home/.claude/.geneseed-manifest.json": _MANIFEST}
_BOB = {"home/.bob/.geneseed-manifest.json": _MANIFEST}
_COPILOT = {"home/.copilot/.geneseed-manifest.json": _MANIFEST}
_OPENCODE = {"home/.config/opencode/.geneseed-manifest.json": _MANIFEST}


def _exclude_cells() -> list[dict]:
    def ex(name, argv, world=None, steps=None, **kw):
        return dict(id=f"exclude/{name}", bin="cli",
                    world=dict({"repo/.keep": ""}, **(world or {})),
                    steps=steps or [{"argv": argv, "cwd": "repo"}], **kw)

    def excludes(host_dir, body):
        return {f"home/{host_dir}/excludes.json": body}

    return [
        # ---- list ----
        ex("list-with-no-global-install", ["exclude", "list"],
           expect=["no global install found"]),
        ex("list-with-nothing-excluded", ["exclude", "list"], world=_CLAUDE,
           expect=["no folders excluded"]),
        ex("list-one-folder", ["exclude", "list"],
           world=dict(_CLAUDE, **excludes(".claude",
                                          '{"excludes": [{"path": "{repo/}"}]}\n')),
           expect=["repo  [claude]"]),
        ex("list-flags-a-host-that-is-missing-the-entry", ["exclude", "list"],
           # The divergence `excludes_snapshot` exists to surface: a global emit made AFTER
           # the exclusions were added starts from an empty stub, so one install knows about
           # a folder and another does not.
           world=dict(_CLAUDE, **_BOB,
                      **excludes(".claude", '{"excludes": [{"path": "{repo/}"}]}\n')),
           expect=["(MISSING from: bob", "re-run `harness exclude add`"]),
        ex("list-a-bare-string-entry", ["exclude", "list"],
           # The pre-`wired` on-disk shape, still supported by both readers.
           world=dict(_CLAUDE, **excludes(".claude", '{"excludes": ["{repo/}"]}\n')),
           expect=["repo  [claude]"]),
        ex("list-skips-unusable-entries", ["exclude", "list"],
           # A hand-edited file, and the entries are the four shapes that reached
           # `excludes_snapshot` as something other than a path. Reaching "no folders
           # excluded" IS the assertion — that line is only printed when every entry was
           # filtered out, so it cannot be produced by a reader that kept any of them.
           world=dict(_CLAUDE, **excludes(
               ".claude", '{"excludes": [7, null, {"path": 3}, "", {"nope": 1}]}\n')),
           expect=["no folders excluded"]),
        # ---- add ----
        ex("add-wires-claude", ["exclude", "add", "{repo}"], world=_CLAUDE,
           expect=["excluded."],
           expect_files=["home/.claude/excludes.json",
                         "repo/.claude/settings.local.json"]),
        ex("add-is-idempotent", None, world=_CLAUDE,
           # Two runs into one sandbox. The second is the one compared, and it is the branch
           # where `wireClaudeExcludes` reports nothing new but ownership still has to carry
           # forward from OUR own prior record — a re-add that dropped it would leave a
           # later `remove` unable to unwire what it wired.
           steps=[{"argv": ["exclude", "add", "{repo}"], "cwd": "repo"},
                  {"argv": ["exclude", "add", "{repo}"], "cwd": "repo"}],
           expect=["claudeMdExcludes already present (kept)", "excluded."],
           expect_files=["home/.claude/excludes.json",
                         "repo/.claude/settings.local.json"]),
        ex("add-writes-the-bob-shadow-stub", ["exclude", "add", "{repo}"], world=_BOB,
           expect=["excluded."],
           expect_files=["repo/.bob/rules/geneseed.md", "home/.bob/excludes.json"]),
        ex("add-keeps-a-foreign-bob-stub", ["exclude", "add", "{repo}"],
           # Ownership is decided by CONTENT: a stub that exists but is not ours must be
           # kept and recorded as not-ours, so the next remove leaves it alone.
           world=dict(_BOB, **{"repo/.bob/rules/geneseed.md": "# my own rules\n"}),
           expect=["rules/geneseed.md already exists (kept, not ours)", "excluded."],
           expect_files=["repo/.bob/rules/geneseed.md"]),
        ex("add-warns-for-copilot", ["exclude", "add", "{repo}"], world=_COPILOT,
           expect=["copilot: no native suppression exists", "excluded."]),
        ex("add-walks-every-host-in-registry-order", ["exclude", "add", "{repo}"],
           # THREE messages, one per host that has something to say, and the ORDER is the
           # point: `HOSTS` is opencode, claude, bob, copilot, and stderr carries them in
           # that sequence. `expect` cannot state an order — the byte comparison of
           # `<stderr>` is what gates it, and these substrings only keep the cell honest
           # about still producing all three.
           world=dict(_OPENCODE, **_CLAUDE, **_BOB, **_COPILOT,
                      **{"repo/.bob/rules/geneseed.md": "# my own rules\n",
                         "repo/.claude/settings.local.json":
                             '{"claudeMdExcludes": ["{home/}/.claude/CLAUDE.md"]}\n'}),
           expect=["claude: claudeMdExcludes already present (kept)",
                   "bob: rules/geneseed.md already exists (kept, not ours)",
                   "copilot: no native suppression exists"],
           expect_files=["home/.config/opencode/excludes.json",
                         "home/.claude/excludes.json", "home/.bob/excludes.json",
                         "home/.copilot/excludes.json"]),
        ex("add-with-no-global-install", ["exclude", "add", "{repo}"],
           expect=["no global Geneseed install found", "nothing done for"]),
        ex("add-a-folder-that-does-not-exist", ["exclude", "add", "{sb}/ghost"],
           # Excluded anyway — the folder may be created later — and NO host wiring is
           # attempted, because there is nowhere to put it.
           world=_CLAUDE,
           expect=["does not exist (excluded anyway)", "excluded."],
           expect_absent=["claudeMdExcludes already present"]),
        ex("add-a-relative-path", ["exclude", "add", "."], world=_CLAUDE,
           # `_canon` resolves against CWD, which is an INPUT to this harness. What is
           # stored and printed must be the absolute path, not the dot.
           expect=["repo excluded."], expect_absent=["\" . \""]),
        ex("add-without-a-path", ["exclude", "add"], world=_CLAUDE,
           # From `cmd_exclude`'s own body, not from argparse — which is why it is compared
           # rather than merely asserted. Exit code 2 is part of the compared surface.
           expect=["needs a folder path"]),
        ex("add-into-a-corrupt-excludes-file", ["exclude", "add", "{repo}"],
           # `_read_excludes` degrades to the seeded stub's shape, so the add still succeeds
           # and the file it leaves behind is valid again. The FILE comparison is the
           # assertion; `expect` only proves the cell still reaches the write.
           world=dict(_CLAUDE, **excludes(".claude", "{not json\n")),
           expect=["excluded."], expect_files=["home/.claude/excludes.json"]),
        # ---- remove ----
        ex("remove-unwires-what-add-wired", None, world=dict(_CLAUDE, **_BOB),
           steps=[{"argv": ["exclude", "add", "{repo}"], "cwd": "repo"},
                  {"argv": ["exclude", "remove", "{repo}"], "cwd": "repo"}],
           # The tree left behind is the assertion: the bob stub AND its now-empty `rules/`
           # directory are gone, and `claudeMdExcludes` is out of settings.local.json.
           expect=["re-included."],
           expect_files=["home/.claude/excludes.json", "home/.bob/excludes.json"]),
        ex("remove-a-folder-that-was-never-excluded", ["exclude", "remove", "{repo}"],
           world=_CLAUDE, expect=["was not excluded", "nothing done for"]),
        ex("remove-when-the-shadow-stub-is-already-gone",
           ["exclude", "remove", "{repo}"],
           # Hand-deleted wiring is reported, not fatal — the entry still leaves the list.
           world=dict(_BOB, **excludes(".bob", '{"excludes": [{"path": "{repo/}", '
                                               '"wired": {"bob_rules_stub": true}}]}\n')),
           expect=["shadow stub already gone", "re-included."]),
        ex("remove-does-not-match-a-dotdot-entry", ["exclude", "remove", "{repo}"],
           # `_same` compares `str(Path(stored))`, which KEEPS `..` — `Path` is not
           # `os.path.normpath`. A port built on `path.normalize` collapses it, matches, and
           # unwires a repo the reference left alone. That is the whole difference this cell
           # exists for, and it is invisible in every other one.
           world=dict(_CLAUDE, **excludes(
               ".claude", '{"excludes": [{"path": "{repo/}/../repo"}]}\n')),
           expect=["was not excluded"]),
        ex("remove-a-case-differing-entry", ["exclude", "remove", "{repo}"],
           # `os.path.normcase` folds case on Windows and is the identity on POSIX, so this
           # cell asserts OPPOSITE outcomes on the two platforms and both are real: a
           # Windows user's `C:\Repo` and `C:\repo` are one folder, a Linux user's are two.
           # Written this way rather than skipped because a port that dropped the fold would
           # be green on POSIX either way — this is the platform where it is observable.
           world=dict(_CLAUDE, **excludes(
               ".claude", '{"excludes": [{"path": "{sb/}/REPO"}]}\n')),
           expect=["re-included."] if sys.platform == "win32" else ["was not excluded"]),
    ]


# --------------------------------------------------------------------------------------
# status + version  —  and the ONE thing this fixture cannot fence off
# --------------------------------------------------------------------------------------
#
# Every other cell in this file is hermetic. These two verbs are not, and the reason is
# structural rather than an oversight:
#
#   * `_status_data` -> `_tui_inventory(theme)` -> `build.render_all(theme)` renders the
#     WHOLE of `<checkout>/src` to count agents, skills and laws, and
#     `build.source_fingerprint()` hashes `src/ themes/ adapters/` for the version row.
#   * `_installed_defaults()` and `cmd_version`'s fallback chain both walk
#     `ROOT / "Harness"` and `ROOT.parent / "Harness"` — the checkout's own bundle
#     locations, not the sandbox's.
#
# `golden.cell_env` redirects HOME/XDG/APPDATA and clears the relocation vars; none of that
# reaches ROOT. It CANNOT: `_build_core.ROOT` is `Path(__file__).resolve().parent`, every
# path under it is derived at import, there is no env override (`$GENESEED_ROOT` is
# `harness context`'s doc-discovery root, a different name for a different job), and the
# `_OWNED` redirect that tests use is an in-process write. The Node side derives the same
# ROOT from `import.meta.url`. So a fixture cannot point EITHER implementation at a
# fixture tree, and copying the checkout into the sandbox would buy nothing — its `src/`
# content is the live one, so the counts and the fingerprint would not change.
#
# Two consequences, both deliberate:
#
#   1. The counts and the fingerprint are gated by COMPARISON (both sides render the same
#      tree at the same instant, so equality is a real assertion about the counting code)
#      and absolutely only by SHAPE, via `expect_re`. A cell naming `17 agents` rots the
#      next time content lands; a cell naming a literal fingerprint rots every commit, and
#      `test_no_cell_hardcodes_a_source_fingerprint` refuses one.
#   2. Every cell seeds a marker in the FIRST candidate the walk visits, so the
#      unfenceable ones are never reached for any value the panel prints. What that leaves
#      out is recorded rather than hidden: `Harness/` is gitignored, so a "no install
#      anywhere" cell would report this developer's real install here and "(none found)" on
#      a fresh clone. `_manifest_is_claude` is worse — it is only reached for a candidate
#      with no known host, and `ROOT / "Harness"` is ordered AHEAD of the sandbox's own
#      `Harness/`, so it is unreachable from any cell on a checkout that has one.
#      `_accent_for`'s cyan fallback and `_version_verdict`'s "up to date" are unreachable
#      for their own reasons (an unknown theme is refused upstream; "up to date" needs a
#      marker holding a fingerprint no cell can know). All four are gated as PURE
#      FUNCTIONS over a corpus instead — `tests/test_pure_function_parity.py`.
#
# Cost, measured rather than assumed: 0.14 s per invocation for either verb. `render_all`
# is a text render, not an emit — it does not spawn Node on the Python side.

_STAMP = "deadbeef1234 (built 2020-01-01) [release 0.1]\n"
_OTHER_STAMP = "0123456789ab (built 2020-01-01) [release 0.1]\n"

# The theme sigil is read from the theme file rather than pasted, for the reason P5b's
# sniff markers are read from `build`: a copy of a value under test silently stops being
# the value under test. cyberpunk's accent (magenta) differs from neutral's default cyan,
# so the accent row proves the sigil path is what detected the theme.
_SIGIL_THEME = "cyberpunk"
_SIGIL = json.loads((ROOT / "themes" / f"{_SIGIL_THEME}.json").read_text(
    encoding="utf-8"))["LOADED_SIGIL"]

_FACT = "---\nname: a-fact\ndescription: one fact\n---\n\nbody\n"

# A global OpenCode install, as `_installed_defaults` recognises one: the emit marker is
# what it prefers, and the OpenCode config dir is the first candidate it visits.
_OC = "home/.config/opencode"
_INSTALL_OC = {f"{_OC}/.geneseed-emit": "opencode-global\n",
               f"{_OC}/.geneseed-theme": "imperial\n",
               f"{_OC}/.geneseed-version": _STAMP,
               f"{_OC}/AGENT.md": "# deployed\n"}


def _status_cells() -> list[dict]:
    def st(name, world, **kw):
        return dict(id=f"status/{name}", bin="cli", world=dict({"repo/.keep": ""}, **world),
                    steps=[{"argv": ["status"], "cwd": "repo"}], **kw)

    # The count line is the one row no cell may name literally — see the section header.
    counts = r"components   [1-9]\d* agents · [1-9]\d* skills · [1-9]\d* laws"
    ascii_counts = r"components   [1-9]\d* agents - [1-9]\d* skills - [1-9]\d* laws"

    return [
        st("an-opencode-global-install",
           dict(_INSTALL_OC, **{"repo/memory/one.md": _FACT, "repo/memory/two.md": _FACT}),
           expect=["theme        imperial  (accent: yellow)",
                   "install      opencode-global",
                   "(2 facts)",
                   "installed build differs from the current source",
                   "AGENT.md", "(present)"],
           expect_re=[counts]),
        st("agent-md-missing-is-called-out",
           {k: v for k, v in _INSTALL_OC.items() if not k.endswith("AGENT.md")},
           expect=["AGENT.md", "(MISSING)"], expect_re=[counts]),
        st("a-non-opencode-emit-hides-the-agent-md-row",
           # Seeded in the CLAUDE config dir, and the OpenCode one is left absent: the emit
           # marker names a host whose panel has no AGENT.md row at all.
           {"home/.claude/.geneseed-emit": "claude-global\n",
            "home/.claude/.geneseed-theme": "neutral\n",
            "home/.claude/.geneseed-version": _STAMP},
           expect=["install      claude-global", "theme        neutral  (accent: cyan)"],
           expect_absent=["AGENT.md"], expect_re=[counts]),
        st("theme-detected-from-the-agent-md-sigil",
           # No `.geneseed-theme`: the manifest supplies the emit (a known host dir names
           # its own), and the theme comes from matching a theme's LOADED_SIGIL in the
           # deployed AGENT.md — the only detection path a per-repo install ever has.
           {f"{_OC}/.geneseed-manifest.json": '{"owned": []}\n',
            f"{_OC}/.geneseed-version": _STAMP,
            f"{_OC}/AGENT.md": f"# deployed\n\n{_SIGIL}\n"},
           expect=[f"theme        {_SIGIL_THEME}  (accent: magenta)",
                   "install      opencode-global"],
           expect_re=[counts]),
        st("a-bogus-theme-marker-refuses-like-the-generator",
           # An unknown theme is not a fallback anywhere — `effective_theme` refuses and
           # the process dies. The exit code is part of the compared surface, and this is
           # the only cell in either harness that reaches that refusal: golden.py's cells
           # take `--theme` from the driver's own `choices`.
           dict(_INSTALL_OC, **{f"{_OC}/.geneseed-theme": "nosuchtheme\n"}),
           expect=["unknown theme 'nosuchtheme'", "available:"],
           expect_silent=True),
        st("a-bogus-footprint-marker-warns-on-stderr",
           # `_footprint_of_dir`'s return value is NOT consumed by the panel — `status`
           # reads only `theme` and `emit` out of `_installed_defaults`. Its WARN is, on
           # the other stream. A closure measured by what the caller consumes would have
           # dropped this function; the observation is what keeps it.
           dict(_INSTALL_OC, **{f"{_OC}/.geneseed-footprint": "enormous\n"}),
           expect=["holds unknown footprint 'enormous'", "reading it as 'full'",
                   "Known: lean, full"],
           expect_re=[counts]),
        st("posture-and-mode-in-the-carrier-change-nothing",
           # The positive control for a deliberate omission: `_installed_defaults` also
           # detects posture and mode, and the panel prints neither. This carrier says
           # `**Peer**` and `**Direct**`; a port that skipped both must still be
           # byte-identical, and this cell is what says so out loud.
           dict(_INSTALL_OC, **{f"{_OC}/AGENT.md":
                                "# deployed\n\n## Posture\n\n**Peer** — ...\n\n"
                                "## Mode\n\n**Direct** — ...\n"}),
           expect_absent=["posture", "Posture", "mode", "Mode"],
           expect_re=[counts]),
        st("no-memory-store-found",
           # `_resolve_memory_dir(None)` walks cwd, cwd/Harness, $GENESEED_HARNESS, then
           # the OpenCode config dir — which is seeded here WITHOUT a memory folder, so
           # the last fallback misses too.
           _INSTALL_OC,
           expect=["memory       (not found)", "(0 facts)"], expect_re=[counts]),
        st("a-directory-named-like-a-fact-is-not-counted",
           # `_memory_facts` skips a path whose `read_text` raises — a directory called
           # `notes.md` is matched by `glob("*.md")` and is not a fact. One fact survives,
           # so the singular is gated in the same cell.
           dict(_INSTALL_OC, **{"repo/memory/real.md": _FACT,
                                "repo/memory/notes.md/inner.txt": "not a fact\n"}),
           expect=["(1 fact)"], expect_absent=["(1 facts)"], expect_re=[counts]),
        st("memory-index-and-readme-are-not-facts",
           dict(_INSTALL_OC, **{"repo/memory/MEMORY.md": "# index\n",
                                "repo/memory/README.md": "# readme\n",
                                "repo/memory/real.md": _FACT}),
           expect=["(1 fact)"], expect_re=[counts]),
        st("the-ascii-overlay-swaps-every-glyph",
           # $GENESEED_TUI_ASCII is an env overlay, so unlike the ANSI branch this one IS
           # reachable through a pipe. Both halves need a cell; the other half is every
           # cell above.
           dict(_INSTALL_OC, **{"repo/memory/one.md": _FACT}),
           env={"GENESEED_TUI_ASCII": "1"},
           expect=["* Geneseed - status", "+-", "|  theme"],
           expect_absent=["─", "◆", "·", "│"],
           expect_re=[ascii_counts]),
    ]


# --------------------------------------------------------------------------------------
# version
# --------------------------------------------------------------------------------------

def _version_cells() -> list[dict]:
    def ve(name, argv, world, **kw):
        return dict(id=f"version/{name}", bin="cli",
                    world=dict({"repo/.keep": ""}, **world),
                    steps=[{"argv": argv, "cwd": "repo"}], **kw)

    return [
        ve("an-explicit-target", ["version", "--target", "{sb}/inst"],
           {"inst/.geneseed-version": _STAMP},
           expect=["[version] source:", "[version] installed: deadbeef1234",
                   "installed build differs from the current source"]),
        ve("no-target-uses-the-opencode-config-dir", ["version"],
           {f"{_OC}/.geneseed-version": _STAMP},
           expect=["installed: deadbeef1234", "<HOME>"]),
        ve("a-target-with-no-marker-falls-back-to-another-host",
           ["version", "--target", "{sb}/ghost"],
           # The fallback chain in order: opencode (absent), claude, bob, copilot, then the
           # bundle paths. Seeding claude keeps the walk inside the sandbox — the bundle
           # paths under ROOT are the ones no fixture can fence off.
           {"home/.claude/.geneseed-version": _OTHER_STAMP},
           expect=["installed: 0123456789ab"]),
        ve("a-relative-target-is-resolved-against-cwd", ["version", "--target", "."],
           {"repo/.geneseed-version": _STAMP},
           # `Path(args.target).expanduser().resolve()` — what is printed is the absolute
           # path, never the dot.
           expect=["installed: deadbeef1234"], expect_absent=["   (.)"]),
        ve("a-tilde-target-is-expanded", ["version", "--target", "~"],
           # `Path(target).expanduser()`. The sandbox redirects HOME, so `~` is a real
           # seedable directory here — and a port that dropped the expansion would look for
           # a literal `~` folder and fall through to the next candidate instead.
           {"home/.geneseed-version": _STAMP},
           expect=["installed: deadbeef1234", "<HOME>"]),
        ve("an-empty-marker-is-not-a-version", ["version"],
           # `txt.split()[0] if txt else None` — a whitespace-only marker reads as absent,
           # so the walk carries on to the next candidate instead of stopping on it.
           {f"{_OC}/.geneseed-version": "   \n",
            "home/.claude/.geneseed-version": _OTHER_STAMP},
           expect=["installed: 0123456789ab"]),
    ]


# --------------------------------------------------------------------------------------
# build  —  the verb whose whole observable contract is the TREE
# --------------------------------------------------------------------------------------
#
# `cmd_build` is three lines: `run([sys.executable, BUILD, *extra]).returncode`. A closure
# walk stops there, and what it cannot see is that the generator's own summary line is this
# verb's entire stdout — inherited from a child process rather than printed here.
#
# THESE CELLS FOUND A LIVE BUG IN THE REFERENCE, and the first draft of them ENCODED it.
# `harness build` printed zero bytes where `node bin/geneseed-cli.mjs build` printed the
# summary, so the cells were written `expect_silent=True` — an absolute assertion that the
# reference stays quiet, which is exactly the shape of "the fixture asserts what IS rather
# than what SHOULD be". `_harness_core.run` folded CREATE_NO_WINDOW into every spawn, and
# with all three streams inherited Python does not set `STARTF_USESTDHANDLES`, so the child
# got a fresh hidden console and everything it printed was discarded whenever the parent's
# stdout was not a terminal. Fixed at the shared `run()` rather than reproduced, following
# P5a's precedent for `learn`'s cp1252 pipe; these cells now assert the line.
#
# What makes them hermetic at all is that `build.py`'s `--out` defaults to the RELATIVE
# `"Harness"` and `cmd_build` passes no `cwd=`, so the bundle lands under the invocation's
# cwd. `cwd="repo"` therefore puts the whole tree inside the sandbox, where `_snapshot` sees
# it — the one verb here whose unfenceable dependency (`src/`) is read but never WRITTEN
# anywhere the fixture cannot reach.

def _build_cells() -> list[dict]:
    def bd(name, argv, cwd="repo", world=None, **kw):
        return dict(id=f"build/{name}", bin="cli",
                    world=dict({"repo/.keep": ""}, **(world or {})),
                    steps=[{"argv": argv, "cwd": cwd}], **kw)

    # The bundle's own marker files, which every emit writes. Named rather than a single
    # AGENT.md so a port that rendered the tree but skipped the markers fails the ABSOLUTE
    # half too, not only the comparison.
    made = ["repo/Harness/AGENT.md", "repo/Harness/.geneseed-emit",
            "repo/Harness/.geneseed-theme", "repo/Harness/.geneseed-version"]

    return [
        bd("the-default-theme", ["build"], expect_files=made,
           # The count rots with the next file added to src/; the shape is what this cell
           # can honestly assert, and the comparison gates the number.
           expect_re=[r"\[geneseed\] built theme 'neutral' -> .*Harness \([1-9]\d* files\)"]),
        # A theme the config default is not, so the rendered bytes differ from the cell
        # above and a port that ignored `--theme` fails the comparison rather than only
        # this cell. `harness.py`'s own `--theme` carries no `choices` — it forwards the
        # string to the generator, which is where the validation lives.
        bd("an-explicit-theme", ["build", "--theme", _SIGIL_THEME],
           expect_files=made, expect=[f"built theme '{_SIGIL_THEME}'"],
           expect_absent=["built theme 'neutral'"]),
        # `--out` is relative and no `cwd=` is passed, so the bundle follows the INVOCATION,
        # not the checkout. A port that resolved the destination against its own ROOT would
        # write outside the sandbox and leave this cell with nothing to snapshot — which is
        # also the only reason the two cells above are hermetic.
        bd("the-bundle-follows-cwd-not-the-checkout", ["build"], cwd="repo/nested",
           world={"repo/nested/.keep": ""},
           expect_files=["repo/nested/Harness/AGENT.md"],
           expect=["nested"]),
    ]


# --------------------------------------------------------------------------------------
# prompt
# --------------------------------------------------------------------------------------
#
# `build_prompt` wraps every rendered file in a backtick fence from `_fence_for`, and that
# helper's real arm is UNREACHABLE from any cell here. Measured over the whole rendered
# tree: the longest backtick run in any source text is 3, so `max(4, longest + 1)` picks 4
# every time, for all 96 files. A port that hardcoded four backticks is byte-identical
# across every cell below — and a cell cannot fix that, because reaching the other arm
# needs a file in `src/` and `src/` is the tree no fixture can redirect (see the status
# section). `_fence_for` is therefore gated as a pure function over a corpus, in
# `tests/test_pure_function_parity.py`, and the unreachability is measured in both
# directions rather than argued.

def _prompt_cells() -> list[dict]:
    def pr(name, argv, **kw):
        return dict(id=f"prompt/{name}", bin="cli", world={"repo/.keep": ""},
                    steps=[{"argv": argv, "cwd": "repo"}], **kw)

    return [
        pr("to-stdout", ["prompt"],
           expect=["# Geneseed Harness — install prompt (theme: neutral)",
                   "### `AGENT.md`"],
           # The count rots with the next content change; the SHAPE is what this cell can
           # honestly assert absolutely, and the byte comparison gates the number.
           expect_re=[r"## Files \([1-9]\d* text files\)"]),
        # `args.theme or "neutral"` — the default is a literal in `cmd_prompt`, NOT the
        # config's theme, so this pair also proves the fallback is not read from the config.
        pr("an-explicit-theme", ["prompt", "--theme", _SIGIL_THEME],
           expect=[f"install prompt (theme: {_SIGIL_THEME})"],
           expect_absent=["theme: neutral"]),
        pr("--out-writes-a-file-and-prints-one-line", ["prompt", "--out", "p.md"],
           expect=["[prompt] wrote p.md (neutral)"],
           # The document goes to the FILE, not to stdout: `sys.stdout.write` is the else
           # branch. Without this a port that wrote both would pass on `expect` alone.
           expect_absent=["### `AGENT.md`"],
           expect_files=["repo/p.md"]),
        pr("--out-creates-missing-parents", ["prompt", "--out", "deep/er/p.md"],
           expect=["[prompt] wrote deep/er/p.md"], expect_files=["repo/deep/er/p.md"]),
    ]


# --------------------------------------------------------------------------------------
# theme
# --------------------------------------------------------------------------------------

_PALETTE_MIN = json.dumps({"palette": {"accent": "#112233"}})


def _theme_cells() -> list[dict]:
    def th(name, argv, world=None, **kw):
        return dict(id=f"theme/{name}", bin="cli",
                    world=dict({"repo/.keep": ""}, **(world or {})),
                    steps=[{"argv": argv, "cwd": "repo"}], **kw)

    oc_themes = f"{_OC}/themes"
    return [
        # ---- where it writes ----
        th("from-a-shipped-theme-writes-both-flavours",
           ["theme", "mine", "--from", "tokyonight"],
           expect=["[theme] wrote geneseed-mine.json, geneseed-mine-transparent.json",
                   "/theme geneseed-mine  (or /theme geneseed-mine-transparent)"],
           expect_files=[f"{oc_themes}/geneseed-mine.json",
                         f"{oc_themes}/geneseed-mine-transparent.json"]),
        th("a-repo-opencode-dir-wins-over-the-global-one",
           ["theme", "mine", "--from", "tokyonight"],
           world={"repo/.opencode/.keep": ""},
           expect_files=["repo/.opencode/themes/geneseed-mine.json"]),
        th("--global-overrides-a-repo-opencode-dir",
           ["theme", "mine", "--from", "tokyonight", "--global"],
           # The repo dir EXISTS and is still not chosen — without seeding it this cell
           # would pass on an implementation that never checked for one.
           world={"repo/.opencode/.keep": ""},
           expect_files=[f"{oc_themes}/geneseed-mine.json"]),
        th("an-explicit-dir-wins-over-both",
           ["theme", "mine", "--from", "tokyonight", "--dir", "{sb}/picked"],
           world={"repo/.opencode/.keep": ""},
           expect_files=["picked/geneseed-mine.json"]),
        th("an-explicit-dir-is-created",
           ["theme", "mine", "--from", "tokyonight", "--dir", "{sb}/a/b/c"],
           expect_files=["a/b/c/geneseed-mine.json"]),

        # ---- the name ----
        th("the-geneseed-prefix-is-not-doubled",
           ["theme", "geneseed-mine", "--from", "tokyonight"],
           expect=["wrote geneseed-mine.json"],
           expect_absent=["geneseed-geneseed-mine"]),

        # ---- the flavours ----
        th("--solid-only-writes-one-file",
           ["theme", "mine", "--from", "tokyonight", "--solid-only"],
           expect=["[theme] wrote geneseed-mine.json to"],
           # The trailing hint is suppressed too, and it is the only observable difference
           # between this and `--transparent-only` on stdout.
           expect_absent=["(or /theme geneseed-mine-transparent)"],
           expect_files=[f"{oc_themes}/geneseed-mine.json"]),
        th("--transparent-only-writes-the-other-one",
           ["theme", "mine", "--from", "tokyonight", "--transparent-only"],
           expect=["[theme] wrote geneseed-mine-transparent.json to",
                   "(or /theme geneseed-mine-transparent)"],
           expect_files=[f"{oc_themes}/geneseed-mine-transparent.json"]),

        # ---- the palette ----
        th("--palette-overlays-the-shipped-one",
           ["theme", "mine", "--from", "tokyonight", "--palette", "{sb}/p.json"],
           world={"p.json": _PALETTE_MIN},
           # `pal.update(...)` — the overlay replaces one role and keeps the rest, so the
           # file must contain BOTH the override and a role only tokyonight supplied.
           expect_files=[f"{oc_themes}/geneseed-mine.json"]),
        th("--palette-accepts-a-bare-role-map",
           ["theme", "mine", "--from", "tokyonight", "--palette", "{sb}/bare.json"],
           # `raw.get("palette", raw)` — a document with no "palette" key IS the map.
           world={"bare.json": json.dumps({"accent": "#445566"})},
           expect_files=[f"{oc_themes}/geneseed-mine.json"]),

        # ---- the refusals: SystemExit, one line on stderr, exit 1 ----
        th("no-palette-at-all-refuses", ["theme", "mine"],
           expect=["[theme] need a palette: pass --from <shipped> and/or --palette"]),
        th("an-unknown-shipped-theme-refuses-and-lists-what-there-is",
           ["theme", "mine", "--from", "nosuch"],
           expect=["[theme] no shipped theme 'nosuch'. available: ", "tokyonight"]),
        th("a-palette-missing-roles-refuses-and-names-them-sorted",
           ["theme", "mine", "--palette", "{sb}/p.json"],
           world={"p.json": _PALETTE_MIN},
           # `sorted(_PALETTE_ROLES - set(pal))` — the ORDER is observable, and a port that
           # iterated a JS object's insertion order instead would differ here.
           expect=["[theme] palette missing role(s): addBg, bg,"]),
        th("a-non-hex-value-refuses-with-a-python-repr",
           ["theme", "mine", "--from", "tokyonight", "--palette", "{sb}/p.json"],
           # `f"{r}={pal[r]!r}"` — Python's repr, so a string is SINGLE-quoted and an int
           # carries no quotes at all. Both shapes in one cell because a port reaching for
           # JSON.stringify gets the string wrong and the number right.
           world={"p.json": json.dumps({"palette": {"accent": "112233", "bg": 7}})},
           expect=["[theme] non-#rrggbb value(s): ", "accent='112233'", "bg=7"]),
        th("a-three-digit-hex-is-not-a-hex", ["theme", "mine", "--from", "tokyonight",
                                              "--palette", "{sb}/p.json"],
           # `^#[0-9a-fA-F]{6}$` — anchored at both ends, so neither a short value nor a
           # long one passes, and the uppercase pair below proves the class is not narrowed.
           world={"p.json": json.dumps({"palette": {"accent": "#123",
                                                    "bg": "#1122334"}})},
           expect=["non-#rrggbb value(s): ", "accent='#123'", "bg='#1122334'"]),
        th("uppercase-hex-is-accepted",
           ["theme", "mine", "--from", "tokyonight", "--palette", "{sb}/p.json"],
           world={"p.json": json.dumps({"palette": {"accent": "#AABBCC"}})},
           # The positive control for the two refusals above: without it they pass on an
           # implementation that rejects every value it is given.
           expect=["[theme] wrote geneseed-mine.json"],
           expect_files=[f"{oc_themes}/geneseed-mine.json"]),
    ]


# --------------------------------------------------------------------------------------
# diff  —  and what a cell can and cannot say about a DIFF
# --------------------------------------------------------------------------------------
#
# Every cell here renders an 'expected' copy of the live `src/` into a temp dir and compares
# it against a deployed tree the cell seeded. Three consequences follow, and the third is the
# one that decides how these are written.
#
#   1. THEY ARE SLOW. One cell is one full global emit per side. That is the verb, not the
#      fixture: `_diff_collect` cannot answer without rendering.
#   2. THEY REPORT A HUNDRED-ODD `missing` ROWS. The seeded manifest owns two or three files;
#      the expected render owns ~119. Everything the fixture did not seed is legitimately
#      "in source, not deployed", and those rows are a real assertion — a hundred paths that
#      have to agree — as long as nothing names their COUNT, which content commits move.
#   3. **NOTHING HERE CAN VARY THE DIFF ALGORITHM.** A cell produces a whole-file replacement
#      or an append; it cannot produce the shapes where `difflib`'s choices differ from any
#      other diff's — tie resolution, the longest-block recursion's alignment, and above all
#      `autojunk`, which engages at 200 lines and rewrites the hunks of every real harness
#      file. `js/lib/pydiff.mjs` is therefore gated as a corpus in
#      `tests/test_pure_function_parity.py`, with the unreachability measured in BOTH
#      directions: 28 of its cases change when `autojunk` is switched off, and all 176 are
#      green here either way. That is the P5d rule applied to a stdlib port rather than to a
#      panel — a cell runs the PROGRAM, a corpus runs the FUNCTION.
#
# `_cmp_key`'s reason for existing is cell-unreachable for a fourth, separate reason.
# `.geneseed-version` IS an owned file, so the branch RUNS in every cell here; what it does —
# suppress a difference that is only the build DATE — needs a deployed marker carrying the
# CURRENT source fingerprint, which changes every commit and `test_no_cell_hardcodes_a_source_
# fingerprint` refuses. Corpus, for the same reason.

# A deployed global OpenCode install, as `_diff_collect` recognises one: a manifest (with no
# `scope`, which is what the real opencode-global emit writes) and the files it claims.
_DEPLOYED_AGENT = "# Deployed AGENT.md\n\nThis is a local edit that source does not have.\n"


def _diff_cells() -> list[dict]:
    def df(name, argv=("diff",), world=None, **kw):
        return dict(id=f"diff/{name}", bin="cli",
                    world=dict({"repo/.keep": ""}, **(world or {})),
                    steps=[{"argv": list(argv), "cwd": "repo"}], **kw)

    def deployed(owned, **extra):
        return dict({f"{_OC}/.geneseed-manifest.json": json.dumps({"owned": owned}),
                     f"{_OC}/.geneseed-theme": "neutral\n",
                     f"{_OC}/AGENT.md": _DEPLOYED_AGENT}, **extra)

    # The summary line's three counts all move with `src/`, so the shape is what a cell may
    # assert; the byte comparison gates the numbers.
    summary = r"\[diff\] 1 edited, \d+ added-in-deployed, [1-9]\d* missing-from-deployed"

    return [
        df("an-owned-file-edited-in-place", world=deployed(["AGENT.md"]),
           expect=["[diff] deployed ", "(theme: neutral)",
                   "~ AGENT.md   (edited in deployed — review to back-port)",
                   "- .geneseed-version   (in source, not deployed — re-emit to add)",
                   # An OpenCode-only artifact, and the positive control for the dialect
                   # cell below: without a row that HAS it, that cell's absence is vacuous.
                   "- workflows/council.js   (in source, not deployed — re-emit to add)",
                   "Run with --full to see the line-level diffs"],
           expect_re=[summary]),
        # The unified diffs themselves. `--full` is the only path that prints a hunk header,
        # and without this cell the entire diff payload is compared in no cell at all: the
        # summary above names files and never a line.
        df("--full-prints-the-unified-diffs", ("diff", "--full"),
           world=deployed(["AGENT.md"]),
           expect=["--- AGENT.md (source -> deployed)",
                   "--- source/AGENT.md", "+++ deployed/AGENT.md",
                   "+This is a local edit that source does not have."],
           expect_re=[r"@@ -\d+,\d+ \+\d+,\d+ @@"],
           # The hint is mutually exclusive with `--full`, and saying so is what keeps the
           # cell above from being the only thing that decides which branch ran.
           expect_absent=["Run with --full"]),
        df("a-file-only-the-deployment-has",
           # In the deployed manifest, rendered by nothing — the `added` arm, which is the
           # one a back-port actually cares about.
           world=deployed(["AGENT.md", "agents/mine.md"],
                          **{f"{_OC}/agents/mine.md": "# my own agent\n"}),
           expect=["+ agents/mine.md   (only in deployed — your addition)"]),
        df("the-deployed-emit-marker-picks-the-dialect",
           # A Claude install must not be diffed against an OpenCode-dialect render. With the
           # marker present the expected tree carries no AGENT.md, so the same seeded file
           # flips from `edited` to `added`, and the OpenCode-only `workflows/` and
           # `plugins/` disappear from the missing list entirely.
           world=deployed(["AGENT.md"], **{f"{_OC}/.geneseed-emit": "claude-global\n"}),
           expect=["+ AGENT.md   (only in deployed — your addition)",
                   "- skills/wayfinder/SKILL.md   (in source, not deployed — re-emit to add)"],
           expect_absent=["~ AGENT.md", "workflows/council.js", "plugins/"]),
        df("a-lean-marker-is-diffed-lean",
           # `_footprint_of_dir`'s RETURN value, consumed here where `status` consumed only
           # its WARN. The lean global emit is the only one that writes laws/universal.md, so
           # this pair of cells is what says the footprint reached the render.
           world=deployed(["AGENT.md"], **{f"{_OC}/.geneseed-footprint": "lean\n"}),
           expect=["- laws/universal.md   (in source, not deployed — re-emit to add)"]),
        df("the-default-footprint-is-not-lean", world=deployed(["AGENT.md"]),
           expect_absent=["laws/universal.md"], expect_re=[summary]),
        df("an-explicit-theme-overrides-the-marker",
           ("diff", "--theme", _SIGIL_THEME), world=deployed(["AGENT.md"]),
           expect=[f"(theme: {_SIGIL_THEME})"], expect_absent=["(theme: neutral)"]),
        df("--out-writes-the-improvements-report",
           ("diff", "--out", "rep.md"), world=deployed(["AGENT.md"]),
           # The RAW argument is printed, not a resolved path — `Path(out_path).expanduser()`
           # with no `.resolve()`. And `--out` suppresses the `--full` hint on its own, which
           # is the `elif ... and not args.out` the cell above cannot separate from `--full`.
           expect=["[diff] improvements file written: rep.md"],
           expect_absent=["Run with --full"],
           expect_files=["repo/rep.md"]),
        df("a-bare---out-picks-the-default-timestamped-path",
           # argparse's `nargs="?" const=True`: no value means "under the deployed install's
           # improvements/". A verb table that made `--out` a plain option would refuse this
           # form, and one that made it a flag would drop the filename in the cell above.
           # The stamp itself is normalised out of both the path and the report — see
           # `_STAMPS` — so what this compares is that both sides wrote ONE file, in that
           # directory, with the same contents.
           ("diff", "--out"), world=deployed(["AGENT.md"]),
           expect=["[diff] improvements file written: <HOME>", "improvements-<STAMP>.md"],
           expect_files=[f"{_OC}/improvements/improvements-<STAMP>.md"]),
        df("a-bare---out-does-not-eat-the-next-flag", ("diff", "--out", "--full"),
           # argparse consumes a token for a `nargs="?"` only if it does not LOOK like an
           # option, so this is a bare `--out` followed by `--full` and not a report named
           # `--full`. Added because the mutation that drops that guard was GREEN across
           # every other cell here: `--out` is never followed by a flag in any of them, and
           # `--out --full` is the only shape that can tell the two readings apart.
           world=deployed(["AGENT.md"]),
           expect=["improvements file written: <HOME>", "improvements-<STAMP>.md",
                   "--- AGENT.md (source -> deployed)"],
           expect_absent=["written: --full"],
           expect_files=[f"{_OC}/improvements/improvements-<STAMP>.md"]),
        df("--out-and---full-together", ("diff", "--out", "rep.md", "--full"),
           world=deployed(["AGENT.md"]),
           # `--out` suppresses the hint AND `--full` still prints, which is the one
           # combination the `elif` makes non-obvious.
           expect=["improvements file written: rep.md", "--- AGENT.md (source -> deployed)"],
           expect_absent=["Run with --full"], expect_files=["repo/rep.md"]),
        df("no-global-install-at-the-target",
           # No manifest anywhere: the refusal, on stderr, with exit 1 — and `<exit>` is a
           # compared column, so a port that returned 0 here fails even though the words match.
           expect=["[diff] no global Geneseed install at ",
                   "Pass --target, or run `--emit opencode-global` first."],
           expect_silent=True),
        df("a-project-scoped-manifest-is-refused-differently",
           # The OTHER `files is None` arm. Both print nothing on stdout and exit 1, so
           # without an `expect` naming the wording they are the same observation.
           world={f"{_OC}/.geneseed-manifest.json":
                  json.dumps({"owned": [], "scope": "project"})},
           expect=["is a PROJECT install", "opencode-global/claude-global/bob-global/"],
           expect_absent=["no global Geneseed install"],
           expect_silent=True),
        df("an-explicit-target-is-expanded-and-not-resolved",
           # `Path(target).expanduser()` with NO `.resolve()`, which is the opposite of what
           # `cmd_version` does with the same flag — and it is observable, because `target` is
           # printed. `~` is a real seedable directory here because the sandbox redirects HOME.
           ("diff", "--target", "~/inst"),
           world={"home/inst/.geneseed-manifest.json": json.dumps({"owned": ["AGENT.md"]}),
                  "home/inst/AGENT.md": _DEPLOYED_AGENT},
           expect=["[diff] deployed <HOME>", "~ AGENT.md"],
           expect_absent=["deployed ~/inst"]),
    ]


# --------------------------------------------------------------------------------------
# rebuild-all  —  every active install, re-emitted in its own everything
# --------------------------------------------------------------------------------------
#
# The most expensive cells in this file: each one runs a real emit per detected install, into
# the sandbox, and `_snapshot` then compares every file of every rebuilt tree. That is also
# what makes them worth their cost — a port that got the emit or the flags wrong for one
# install rewrites ~119 files differently and fails on the tree, not only on the label line.
#
# THE LABEL LINE IS THE CELL'S REAL SUBJECT, though. It names theme, emit, footprint, posture
# and mode, and all five are read back off the deployed install rather than defaulted. Each
# is a separate way for a rebuild to quietly re-emit something its owner never chose, and the
# `-detected-` cells below vary one at a time.
#
# The Python's `[rebuild-all]` lines used to arrive AFTER the generator output they introduce,
# because `print()` block-buffers when stdout is not a terminal while the inherited child
# writes straight through. That was the reference being wrong rather than the port — same
# shape as P5e's CREATE_NO_WINDOW, in the same helper, found the same way. Fixed at
# `_harness_core.run` (flush before an inheriting spawn), so these cells compare the order the
# code was written to produce.

_PROJECT_OC = {"repo/.opencode/.keep": "", "repo/.geneseed-emit": "opencode\n"}


def _rebuild_all_cells() -> list[dict]:
    def rb(name, world=None, **kw):
        return dict(id=f"rebuild-all/{name}", bin="cli",
                    world=dict({"repo/.keep": ""}, **(world or {})),
                    steps=[{"argv": ["rebuild-all"], "cwd": "repo"}], **kw)

    # A GLOBAL OpenCode install, as `_install_state` recognises one: the manifest is the
    # marker, and its presence alone makes the row `active`.
    glob_oc = {f"{_OC}/.geneseed-manifest.json": '{"owned": []}\n',
               f"{_OC}/.geneseed-emit": "opencode-global\n"}

    return [
        rb("no-active-installs-detected",
           # The empty answer, which must not be reached by CREATING a row: an absent install
           # is skipped, never rebuilt into existence.
           expect=["[rebuild-all] no active installs detected."]),
        rb("a-global-opencode-install", glob_oc,
           expect=["[rebuild-all] opencode:global (",
                   "theme=neutral emit=opencode-global footprint=full posture=peer mode=direct",
                   "[geneseed] opencode-global -> ",
                   "[rebuild-all] rebuilt 1 install(s)."],
           expect_files=[f"{_OC}/AGENT.md", f"{_OC}/.geneseed-version"]),
        rb("a-per-repo-install-is-rebuilt-in-place",
           dict(_PROJECT_OC, **{"repo/.geneseed-theme": "neutral\n"}),
           expect=["[rebuild-all] opencode:project (", "emit=opencode",
                   "[geneseed] opencode layer: "],
           # The per-repo emit puts the bundle at the invocation root and the layer under
           # `.opencode/` — `--out` and `--root` are BOTH the detected root, which is what
           # `_setup_build_args` does for a non-global scope and what this pair asserts.
           expect_files=["repo/AGENT.md", "repo/.opencode/agents/advocate.md"]),
        rb("the-theme-and-footprint-are-read-back-off-the-install",
           dict(glob_oc, **{f"{_OC}/.geneseed-theme": f"{_SIGIL_THEME}\n",
                            f"{_OC}/.geneseed-footprint": "lean\n"}),
           expect=[f"theme={_SIGIL_THEME} emit=opencode-global footprint=lean"],
           expect_absent=["theme=neutral", "footprint=full"]),
        rb("the-posture-and-mode-are-read-back-out-of-the-CARRIER",
           # Neither is markered — both are detected from the `**<Name>**` lead the inlined
           # section opens with. This is the debt P5d recorded against `_installed_defaults`,
           # and it comes due here rather than in the wizard, because `cmd_rebuild_all` reads
           # them per ROOT instead of through that function.
           dict(glob_oc, **{f"{_OC}/.geneseed-theme": "neutral\n",
                            f"{_OC}/AGENT.md":
                            "# deployed\n\n## Posture\n\n**Artisan** — ...\n\n"
                            "## Mode\n\n**Foreman** — ...\n"}),
           expect=["posture=artisan mode=foreman"],
           expect_absent=["posture=peer mode=direct"]),
        rb("a-marker-naming-another-host-is-not-trusted",
           # ONE `.geneseed-emit` per root, last deploy wins. Here the root marker says
           # `claude` while the row being rebuilt is the OpenCode project one, so trusting it
           # would re-emit an OpenCode install as a Claude one — turning a rebuild into a
           # host change. The marker is dropped and `_DEFAULT_EMIT` supplies `opencode`.
           {"repo/.opencode/.keep": "", "repo/.geneseed-emit": "claude\n",
            "repo/.geneseed-theme": "neutral\n"},
           expect=["opencode:project (", "emit=opencode "],
           expect_absent=["emit=claude "]),
        rb("a-dead-registry-root-is-pruned-on-read",
           # `_install_registry.roots()` REWRITES the file as it reads, dropping any root
           # that no longer exists or has lost its `.geneseed-emit`. That prune has been
           # ungated since it was written: `tests/golden.py`'s sandboxes start with an empty
           # registry, so no generator cell can ever hold a DEAD row (P4b's fresh-sandbox
           # hole). `rebuild-all` is the first verb that reads the registry rather than only
           # appending to it, so this is the first cell that can see the prune at all — the
           # mutation that disables it is green everywhere else.
           #
           # The surviving row is the cwd's own project install, re-recorded by its emit
           # AFTER the prune — so this cell gates the read and the write in one file.
           dict(_PROJECT_OC, **{
               "repo/.geneseed-theme": "neutral\n",
               "home/.config/geneseed/installs.json":
                   '[\n  "{sb/}/gone",\n  "{sb/}/also-gone"\n]\n'}),
           expect=["[rebuild-all] opencode:project ("],
           expect_absent=["gone"],
           expect_files=["home/.config/geneseed/installs.json"]),
        rb("a-disabled-install-is-skipped",
           # `.geneseed-disabled` beside the install makes the row `disabled`, and only
           # `active` rows are rebuilt. Without this cell "skipped" and "never detected" are
           # the same observation.
           dict(glob_oc, **{f"{_OC}/.geneseed-disabled/.keep": ""}),
           expect=["[rebuild-all] no active installs detected."],
           expect_absent=["opencode-global -> "]),
        rb("one-broken-install-does-not-stop-the-rest",
           # THE CELL THE DRIVER'S `die` HAD TO STOP CALLING `process.exit` FOR. The global
           # install carries a theme no `themes/` file has, so its rebuild refuses with exit
           # 2; the project install must still be rebuilt and the exit code must be 1.
           dict(glob_oc, **{f"{_OC}/.geneseed-theme": "nosuchtheme\n",
                            "repo/.opencode/.keep": "",
                            "repo/.geneseed-emit": "opencode\n",
                            "repo/.geneseed-theme": "neutral\n"}),
           expect=["[rebuild-all] FAILED opencode:global",
                   "1/2 install(s) failed",
                   "[geneseed] opencode layer: "],
           expect_files=["repo/AGENT.md", "repo/.opencode/agents/advocate.md"]),
    ]


# --------------------------------------------------------------------------------------
# doctor  —  one planted fault per check, in a checkout of this cell's own
# --------------------------------------------------------------------------------------
#
# `doctor` runs fifteen `_*_problems` checks and prints `[doctor] ok — …` when every one of
# them finds nothing. That is P4e's SILENT-ON-SUCCESS hole promoted from one stage to a whole
# verb: delete any single check and a clean run is byte-identical, in every cell, forever. So
# a comparison alone cannot tell this port from a stub, and the gate is ONE PLANTED FAULT PER
# CHECK — not a preference, the only thing that distinguishes the two.
#
# Ten of the fifteen read the CHECKOUT, which no cell could write (P5d's cannot-FENCE-OFF
# hole, applied to two thirds of a verb). `_copy_checkout` is what closed that; read its
# docblock for the cost model. Everything below follows from three properties of it:
#
#   1. A CLEAN COPY IS THE FIXTURE'S OWN POSITIVE CONTROL. `a-clean-checkout-is-clean` asserts
#      `[doctor] ok — `. A copy that dropped a directory would make some check report a fault
#      nothing planted — which reads exactly like a port bug — and that cell is what fails
#      first when it happens.
#   2. EVERY CELL NAMES ITS PROBLEM COUNT. `[doctor] N problem(s)` is asserted verbatim
#      wherever N is stable, so a plant that started tripping a SECOND check is reported
#      rather than absorbed. Where N moves with the content of `src/` (a theme key missing
#      from every other theme; a law with no ledger row) the count is asserted as a shape and
#      the specific messages carry the rest.
#   3. `--theme neutral` ON ALMOST EVERY CELL. With no `--theme` and no `--all`, doctor sweeps
#      every theme it can see — 14 builds plus 14×5 emits, ~30s per side per cell. The
#      one-theme scoping is gated by seeding an INSTALL instead of by dropping the flag
#      (`no-theme-scopes-to-the-installed-one`), and `--all` itself is gated nowhere here:
#      `_themes_to_check` is pure and its three arms live in the corpus.
#
# `--no-bundle` wherever the plant is in `src/`, and the reason is not speed: a source edit
# makes a fresh render differ from the COMMITTED bundle, so `_rendered_problems` would report
# every affected file as stale on top of the fault the cell is about. The two bundle cells
# plant in `Harness/` instead, where nothing else looks.

#: A law-ledger row, patched out of the real page. `_law_meta_problems` reads
#: `web/src/pages/Laws.jsx`, so the fault has to be planted in a copy of the real file —
#: hand-writing one would have to enumerate every law, and the count moves with `src/`.
_LAWS_JSX = (ROOT / "web" / "src" / "pages" / "Laws.jsx").read_text(encoding="utf-8")

#: registry.json with one row nothing in `src/` provides. Read and re-serialised rather than
#: hand-written for the same reason.
_REGISTRY = json.loads((ROOT / "registry.json").read_text(encoding="utf-8"))


def _registry_with_orphan() -> str:
    doc = json.loads(json.dumps(_REGISTRY))
    doc.setdefault("entities", {})["skills/zzz-doctor"] = {
        "status": "invented", "version": "one", "owner": "", "added": "yesterday",
        "last_verified": "",
    }
    return json.dumps(doc, indent=2) + "\n"


def _registry_with(row) -> str:
    """One EXISTING row replaced. The orphan above cannot reach the field checks — those run
    only over `expected & entities`, and an invented key is in neither."""
    doc = json.loads(json.dumps(_REGISTRY))
    doc["entities"]["agents/advocate"] = row
    return json.dumps(doc, indent=2) + "\n"


def _laws_jsx_with_a_reflowed_row() -> str:
    """Rule 1's row wrapped across four lines, as a prettier with a print-width limit does.

    The `_LAW_META_ROW` regex spans newlines on purpose and the docstring says why: a row too
    long for the width gets reflowed with a magic trailing comma, and a gate that only
    understood the one-line form silently lost it — leaving that law's Principle unguarded
    while `format:check` and doctor demanded contradictory formatting of the same file.

    ONE ROW IN THE REAL FILE IS ALREADY REFLOWED (rule 6 — measured: the spanning pattern
    finds 37 rows and a one-line pattern finds 36), so `a-clean-checkout-is-clean` gates the
    tolerance today and the mutation that narrows the regex turns BOTH cells red. This cell
    stays anyway, and for the reason the fence corpus stays: the clean cell's coverage is a
    fact about CONTENT that a reformatting commit can take away, and a gate that depends on
    which laws happened to be verbose is a gate that silently stops gating.
    """
    out, n = re.subn(r"(?m)^(\s*)1:\s*\[\s*((['\"]).*?\3)\s*,\s*((['\"]).*?\5)\s*,?\s*\]\s*,?\s*$",
                     lambda m: (f"{m.group(1)}1: [\n{m.group(1)}  {m.group(2)},\n"
                                f"{m.group(1)}  {m.group(4)},\n{m.group(1)}],"),
                     _LAWS_JSX, count=1)
    if n != 1:
        raise RuntimeError("Laws.jsx no longer has a one-line `1: [...]` row — the doctor "
                           "cell that reflows it cannot be built")
    return out


def _laws_jsx_with_unknown_class() -> str:
    """Rule 1's class replaced with one `LAW_CLASSES` does not carry — exactly one problem,
    because an unknown class short-circuits the LAW_CLASS comparison for the same row."""
    out, n = re.subn(r"(?m)^(\s*1:\s*\[\s*)(['\"])[a-z]+\2", r"\1'nosuchclass'", _LAWS_JSX,
                     count=1)
    if not n:
        raise RuntimeError("Laws.jsx no longer has a `1: ['<class>', …]` row — the doctor "
                           "cell that plants an unknown class cannot be built")
    return out


def _colour_theme_with_a_bad_hex() -> str:
    """A REAL colour theme, renamed, with one role's value corrupted.

    Hand-writing a minimal one does not work and the reason is worth stating: the
    opencode-global emit reads the same files (`_write_color_themes` -> `palette[role]`) and
    runs BEFORE the check does, so a palette that is missing a role — or missing entirely —
    kills the emit with a KeyError instead of reaching `_color_theme_problems`. Two of that
    check's three arms are therefore unreachable from any cell, and it is doctor's own
    ordering that makes them so: the consumer is stricter than the gate. The third arm — a
    value present but not `#rrggbb` — passes straight through the emit and is the one a cell
    can see.
    """
    spec = json.loads((ROOT / "themes" / "opencode" / "nord.json").read_text(encoding="utf-8"))
    spec["name"] = "zzz-doctor"
    spec["palette"][sorted(spec["palette"])[0]] = "not-a-hex"
    return json.dumps(spec, indent=2)


def _np(rel: str) -> str:
    """A bundle-relative path as `_check_build` prints it — `str(Path)`, so the platform's
    own separator. Every other harness path in this file is POSIX because the code that
    prints it went through `as_posix()`; this one did not, and a hardcoded `/` here would
    make every emit-scan cell vacuous on Windows."""
    return str(Path(rel))


#: A spec in the shape `_desc_block_problem` demands: title, then a one-line `>` purpose.
_GOOD_SPEC = "# Zzz Doctor\n\n> A planted spec, for the doctor cells.\n\nBody.\n"

#: A bundle `_rendered_problems` will find INCOMPLETE. `Harness/` is gitignored, so a copy of
#: the tracked set has no committed bundle at all and the check returns `[]` on its very first
#: line — which is why every clean cell above says "rendered bundle in sync" without anything
#: having been compared. `--bundle` is what points it at a tree a cell owns.
_PARTIAL_BUNDLE = {"bundle/.geneseed-theme": "neutral\n",
                   "bundle/memory/README.md": "# Not what src renders\n",
                   "bundle/memory/.gitignore": "not the seeded ignore file\n",
                   "bundle/notebook/README.md": "# The agent rewrote this, which is allowed\n"}

#: A hook shim pointing at a file that is not there — the one checkout-reading check that is
#: NOT in the checkout, because `_hook_shim_path()` is under `$GENESEED_HOME`, which
#: `golden.cell_env` redirects. Both spellings are seeded: `_shim_rel` picks `.cmd` on
#: Windows and the bare name elsewhere, and a cell that seeded only one would silently pass
#: on the other platform.
_BROKEN_SHIM = '@echo off\r\n"{sb/}/nosuchpython.exe" "{sb/}/nosuchharness.py" %*\r\n'
_SHIM_WORLD = {"home/.geneseed/bin/geneseed-hook.cmd": _BROKEN_SHIM,
               "home/.geneseed/bin/geneseed-hook": _BROKEN_SHIM}


def _doctor_cells() -> list[dict]:
    def dr(name, argv=("doctor", "--theme", "neutral"), checkout=None, world=None,
           steps=None, **kw):
        return dict(id=f"doctor/{name}", bin="cli",
                    world=dict({"repo/.keep": ""}, **(world or {})),
                    checkout=dict(checkout or {}),
                    steps=steps or [{"argv": list(argv), "cwd": "repo"}], **kw)

    src_only = ("doctor", "--theme", "neutral", "--no-bundle")

    def built(argv, seed=None):
        """Render a real bundle into `bp/Harness` first, then run doctor against it. The
        only honest source of a bundle a fresh render AGREES with — and `seed` is how a cell
        varies one of the markers that build just wrote."""
        return [{"argv": ["build"], "cwd": "bp"},
                {"argv": list(argv), "cwd": "repo", "seed": seed or {}}]

    return [
        # ------------------------------------------------------------------ the control
        dr("a-clean-checkout-is-clean",
           expect=["[doctor] ok — 1 theme(s) clean", "rendered bundle in sync"],
           expect_absent=["problem(s)"]),

        # ------------------------------------------- the three emit-scanning checks at once
        # One source fault, three labels. `_check_build` scans the `files` build,
        # `_global_emit_problems` the opencode-global pair, `_claude_bob_emit_problems` the
        # three per-repo native layers — and each stamps its own label, so this single cell
        # says all three ran. Deleting any one of them removes its lines from the output.
        dr("an-unresolved-token-and-a-dead-link-reach-every-emit-scan", src_only,
           {"src/memory/README.md":
            "# Memory\n\nA planted {{NOPE}} token and a [dead link](./nowhere.md).\n"},
           expect=[f"[neutral] unresolved token {{{{NOPE}}}} in {_np('memory/README.md')}",
                   f"[neutral] dead link './nowhere.md' in {_np('memory/README.md')}",
                   f"[neutral global/lean] unresolved token {{{{NOPE}}}} in "
                   f"{_np('memory/README.md')}",
                   f"[neutral global/full] dead link './nowhere.md' in "
                   f"{_np('memory/README.md')}",
                   # The per-repo layers nest one level deeper, under each host's own dir —
                   # the shape `build._validate_is_vendored` exists for, and the only thing
                   # that says `_claude_bob_emit_problems` scanned the ROOT and not the
                   # bundle inside it.
                   f"[neutral claude] dead link './nowhere.md' in "
                   f"{_np('.claude/memory/README.md')}",
                   f"[neutral bob] unresolved token {{{{NOPE}}}} in "
                   f"{_np('.bob/memory/README.md')}",
                   f"[neutral copilot] dead link './nowhere.md' in "
                   f"{_np('.github/memory/README.md')}",
                   "tip: dead links to skills mean your source is incomplete"],
           expect_re=[r"\[doctor\] 12 problem\(s\) across 1 theme\(s\)"]),
        # The hermeticity arm — the invariant that lets a bundle be copied into any repo.
        # A link that RESOLVES and leaves the bundle is a different message from a dead one,
        # and only this cell separates them. `../../../..` rather than a plausible-looking
        # `../../README.md`: the check is `exists() and not within(out)`, so a target that is
        # merely absent is a DEAD link — the first draft of this cell asserted the escape and
        # got the other message, in every one of the six labels.
        dr("a-link-that-escapes-the-bundle-is-not-a-dead-link", src_only,
           {"src/memory/README.md":
            "# Memory\n\nAn [escape](../../../..) and an [absolute](/etc/passwd) and a "
            "[home](~/x.md).\n"},
           expect=[f"non-hermetic link '../../../..' escapes the bundle in "
                   f"{_np('memory/README.md')}",
                   f"non-hermetic absolute link '/etc/passwd' in {_np('memory/README.md')}",
                   f"non-hermetic absolute link '~/x.md' in {_np('memory/README.md')}"],
           expect_absent=["dead link"]),

        # ------------------------------------------------------------------- the bundle
        # `Harness/` is GITIGNORED. A copy of the tracked set therefore has no committed
        # bundle, `_rendered_problems` returns on `bundle.is_dir()`, and every "rendered
        # bundle in sync" above is a sentence about nothing. That is this fixture's own
        # blind spot — what the copy makes UNREACHABLE — and `--bundle` is what closes it.
        dr("a-seeded-bundle-is-stale-and-incomplete",
           ("doctor", "--theme", "neutral", "--bundle", "{sb}/bundle"),
           world=_PARTIAL_BUNDLE,
           expect=["[rendered] bundle/memory/README.md stale (differs from a fresh render) "
                   "— rebuild",
                   # A file the render COPIES rather than renders takes the other message,
                   # from the other comparison (`read_bytes`, not text).
                   "[rendered] bundle/memory/.gitignore stale — rebuild",
                   "[rendered] bundle/AGENT.md missing — rebuild the bundle"],
           # Seed-once and agent-owned after the first build: a rewrite is not drift. The
           # only way to gate a carve-out is to assert what it leaves OUT.
           expect_absent=["bundle/notebook/README.md stale"],
           expect_re=[r"\[doctor\] \d\d problem\(s\) across 1 theme\(s\)"]),
        dr("a-bundle-that-a-build-just-wrote-is-in-sync", world={"bp/.keep": ""},
           steps=built(("doctor", "--theme", "neutral", "--bundle", "{sb}/bp/Harness")),
           expect=["[doctor] ok — 1 theme(s) clean"],
           expect_absent=["[rendered]"]),
        dr("the-bundles-own-emit-marker-picks-the-dialect", world={"bp/.keep": ""},
           steps=built(("doctor", "--theme", "neutral", "--bundle", "{sb}/bp/Harness"),
                       {"bp/Harness/.geneseed-emit": "claude-global\n"}),
           # The same in-sync bundle as above, with one marker rewritten between the build
           # and the check. A host that catalogues capabilities to the model itself gets
           # AGENT.md's tables collapsed to a pointer, so the portable file the build wrote
           # is legitimately not what a claude-global render produces — and reading the
           # marker is the only thing that stops every OpenCode install reporting AGENT.md
           # stale forever.
           expect=["[rendered] Harness/AGENT.md stale (differs from a fresh render) "
                   "— rebuild"],
           expect_re=[r"\[doctor\] 1 problem\(s\) across 1 theme\(s\)"]),
        dr("a-bundle-whose-theme-marker-names-no-theme",
           ("doctor", "--theme", "neutral", "--bundle", "{sb}/bundle"),
           world={"bundle/.geneseed-theme": "nosuchtheme\n"},
           expect=["[rendered] cannot render theme 'nosuchtheme' for bundle/"],
           expect_re=[r"\[doctor\] 1 problem\(s\) across 1 theme\(s\)"]),
        dr("--no-bundle-does-not-look-at-the-bundle-at-all",
           ("doctor", "--theme", "neutral", "--no-bundle", "--bundle", "{sb}/bundle"),
           world=_PARTIAL_BUNDLE,
           expect=["[doctor] ok — 1 theme(s) clean"],
           expect_absent=["[rendered]"]),

        # ------------------------------------------------------------------ theme parity
        # A key one theme defines and no other does. The count is every OTHER theme, which
        # moves with `themes/`, so the shape carries it and two named messages carry the rest.
        dr("a-key-one-theme-defines-and-the-others-do-not", src_only,
           {"themes/cyberpunk.json": json.dumps(
               dict(json.loads((ROOT / "themes" / "cyberpunk.json").read_text(
                   encoding="utf-8")), ZZZ_PLANTED="x"), indent=2)},
           expect=["[themes] 'neutral' missing key {ZZZ_PLANTED} (defined in another theme)",
                   "  tip: a theme is missing a key another theme defines"],
           expect_absent=["[themes] 'cyberpunk' missing key"],
           expect_re=[r"\[doctor\] 1[0-9] problem\(s\) across 1 theme\(s\)"]),

        # ------------------------------------------------------------------ colour themes
        dr("a-palette-role-that-is-not-six-hex-digits", src_only,
           {"themes/opencode/zzz-doctor.json": _colour_theme_with_a_bad_hex()},
           expect=["[colors] 'zzz-doctor' role 'accent' is not #rrggbb hex: 'not-a-hex'"],
           expect_re=[r"\[doctor\] 1 problem\(s\) across 1 theme\(s\)"]),

        # ------------------------------------------------------------------ authoring
        dr("a-spec-with-no-purpose-blockquote", src_only,
           {"src/agents/advocate.md": "# Advocate\n\nProse, and never a blockquote.\n"},
           expect=["[authoring] agents/advocate.md has no '>' purpose line "
                   "(its OpenCode description would render empty)"],
           expect_re=[r"\[doctor\] 1 problem\(s\) across 1 theme\(s\)"]),
        dr("a-purpose-blockquote-that-is-not-the-first-block", src_only,
           # `_first_blockquote` finds it, so the cell above stays silent; only
           # `_desc_block_problem` sees that the FIRST block is prose.
           {"src/agents/advocate.md":
            "# Advocate\n\nProse first.\n\n> and the purpose line only later.\n"},
           expect=["[authoring] agents/advocate.md: first block after the title is not a "
                   "'>' blockquote: 'Prose first.' — desc_of() would silently extract the "
                   "wrong description"],
           expect_re=[r"\[doctor\] 1 problem\(s\) across 1 theme\(s\)"]),
        dr("the-learn-prompt-literal-is-gone-from-the-plugin", src_only,
           {"adapters/opencode/plugins/geneseed-learn.js": "// nothing to extract\n"},
           expect=["[authoring] LEARN_PROMPT_HEAD literal not found in geneseed-learn.js "
                   "— harness.py would fall back (single source broken)"],
           expect_re=[r"\[doctor\] 1 problem\(s\) across 1 theme\(s\)"]),
        dr("the-loaded-copy-follows-the-plugin-rather-than-a-constant", src_only,
           {"adapters/opencode/plugins/geneseed-learn.js":
            "const LEARN_PROMPT_HEAD = `something else entirely`\n"},
           # THE DRIFT ARM IS UNREACHABLE, AND ASSERTING THAT IS THE POINT. Both the loaded
           # copy and the checked literal come from this one file through the same regex, so
           # a reference that reads it can never disagree with itself. What the cell gates is
           # a port that hardcoded the prompt instead of extracting it: that copy WOULD
           # differ from the planted literal, print the drift line, and fail the comparison.
           # A silent reference is the assertion; `expect_absent` is the only way to say it.
           expect=["[doctor] ok — 1 theme(s) clean"],
           expect_absent=["LEARN_PROMPT_HEAD drifted", "literal not found"]),
        dr("a-plugin-that-does-not-parse", src_only,
           {"adapters/opencode/plugins/geneseed-learn.js":
            "const LEARN_PROMPT_HEAD = `x`\nfunction ( {\n"},
           # The message ends with `node --check`'s LAST stderr line, which is its version
           # banner rather than the syntax error — faithful, surprising, and the same `node`
           # answers both sides, so it is a constant here rather than a second opinion. The
           # version itself is deliberately not named: it moves with the machine.
           expect=["[authoring] node --check failed for geneseed-learn.js: "],
           expect_re=[r"\[doctor\] 1 problem\(s\) across 1 theme\(s\)"]),

        # ------------------------------------------------------- registry / counts / prose
        dr("a-registry-row-no-spec-provides", src_only,
           {"registry.json": _registry_with_orphan()},
           expect=["[authoring] registry.json lists 'skills/zzz-doctor' but no such entity "
                   "exists"],
           # The orphan does NOT reach the field checks below — those run over
           # `expected & entities` and an invented key is in neither, which is why the two
           # cells that follow exist rather than one cell doing both.
           expect_absent=[".status ", ".version "],
           expect_re=[r"\[doctor\] 1 problem\(s\) across 1 theme\(s\)"]),
        dr("a-registry-row-with-four-malformed-fields", src_only,
           {"registry.json": _registry_with(
               {"status": "invented", "version": "one", "owner": "  ",
                "added": "yesterday", "last_verified": ""})},
           expect=["[authoring] registry.json['agents/advocate'].status 'invented' is not one "
                   "of ['experimental', 'approved', 'deprecated']",
                   "[authoring] registry.json['agents/advocate'].version 'one' is not a "
                   "semver (N.N.N)",
                   "[authoring] registry.json['agents/advocate'] has no owner",
                   "[authoring] registry.json['agents/advocate'].added 'yesterday' is not an "
                   "ISO date (YYYY-MM-DD) or empty"],
           # `last_verified` is empty and that is ALLOWED — nothing writes it yet. The
           # absence is the assertion; without it the four above could be one blanket rule.
           expect_absent=[".last_verified"],
           expect_re=[r"\[doctor\] 4 problem\(s\) across 1 theme\(s\)"]),
        dr("a-registry-row-that-is-not-an-object", src_only,
           {"registry.json": _registry_with("approved")},
           expect=["[authoring] registry.json['agents/advocate'] is not an object"],
           expect_re=[r"\[doctor\] 1 problem\(s\) across 1 theme\(s\)"]),
        dr("a-registry-with-no-entities-object", src_only,
           {"registry.json": '{"version": 1}\n'},
           # The early return: one message and none of the per-row work below it.
           expect=["[authoring] registry.json has no 'entities' object"],
           expect_absent=["has no row in registry.json"],
           expect_re=[r"\[doctor\] 1 problem\(s\) across 1 theme\(s\)"]),
        dr("a-spec-that-nothing-else-knows-about", src_only,
           # One new file, and it is missing from four separate registers at once — the
           # AGENT.md table, SKILL_CLASS, registry.json and the README's own enumeration.
           # Each message is a different check saying so.
           {"src/skills/zzz-doctor.md": _GOOD_SPEC},
           expect=["[authoring] skills/zzz-doctor.md exists but the AGENT.md table omits it",
                   "[authoring] skills/zzz-doctor.md has no category in SKILL_CLASS "
                   "(_harness_tui.py)",
                   "[authoring] skills/zzz-doctor has no row in registry.json",
                   "[authoring] README skills list omits 'zzz-doctor'"],
           expect_re=[r"\[authoring\] README skills badge says \d+ but src has \d+"]),
        dr("a-committed-credential", src_only,
           {"src/memory/README.md":
            "# Memory\n\nA planted AKIAIOSFODNN7EXAMPLE, which must never ship.\n"},
           expect=["[authoring] possible AWS access key id in src/memory/README.md:3 — a "
                   "credential must never be committed"],
           expect_re=[r"\[doctor\] 1 problem\(s\) across 1 theme\(s\)"]),
        dr("a-vendored-skill-pinned-to-a-moving-branch", src_only,
           {"src/skills/react-view-transitions/VENDOR.md":
            "# Vendor\n\n**Upstream:** https://example.invalid/x\n\n**Commit:** main\n\n"
            "**License:** MIT\n"},
           expect=["[authoring] skills/react-view-transitions/VENDOR.md pins 'main', a "
                   "moving branch — record the commit sha instead"],
           expect_re=[r"\[doctor\] 1 problem\(s\) across 1 theme\(s\)"]),
        dr("a-vendored-skill-with-no-VENDOR-md", src_only,
           {"src/skills/react-view-transitions/VENDOR.md": None},
           expect=["[authoring] skills/react-view-transitions/ has no VENDOR.md — its "
                   "upstream, pinned commit and license are unrecorded"],
           expect_re=[r"\[doctor\] 1 problem\(s\) across 1 theme\(s\)"]),
        dr("the-web-laws-ledger-has-no-LAW_META-literal", src_only,
           {"web/src/pages/Laws.jsx": "export default function Laws() { return null }\n"},
           expect=["[authoring] LAW_META literal not found in web/src/pages/Laws.jsx — the "
                   "web Laws ledger's Principle column would have no gate"],
           expect_re=[r"\[doctor\] 1 problem\(s\) across 1 theme\(s\)"]),
        dr("a-law-row-classed-as-something-that-is-not-a-class", src_only,
           {"web/src/pages/Laws.jsx": _laws_jsx_with_unknown_class()},
           expect=["[authoring] LAW_META[1] class 'nosuchclass' is not a known class "
                   "['security', 'process', 'verify', 'craft', 'context', 'comms']"],
           expect_re=[r"\[doctor\] 1 problem\(s\) across 1 theme\(s\)"]),
        dr("a-law-row-a-prettier-has-reflowed-still-counts", src_only,
           {"web/src/pages/Laws.jsx": _laws_jsx_with_a_reflowed_row()},
           # SILENCE is the assertion. A regex that stopped spanning newlines reads the
           # reflowed row as absent and reports rule I as having none, so the cell that gates
           # the tolerance is the one where the reference says nothing at all.
           expect=["[doctor] ok — 1 theme(s) clean"],
           expect_absent=["LAW_META"]),

        # ------------------------------------------------------------------ the hook shim
        # The one checkout-reading check that a cell could always have planted: the shim
        # lives under `$GENESEED_HOME`, which `golden.cell_env` redirects.
        dict(id="doctor/a-shim-pointing-at-a-file-that-is-not-there", bin="cli",
             checkout={}, world=dict({"repo/.keep": ""}, **_SHIM_WORLD),
             steps=[{"argv": ["doctor", "--theme", "neutral", "--no-bundle"], "cwd": "repo"}],
             expect=["which does not exist — every hook in every install was dead",
                     "This run's own emit has refreshed it; no further action needed."],
             expect_re=[r"\[doctor\] 2 problem\(s\) across 1 theme\(s\)"]),

        # ------------------------------------------------------------------ theme scoping
        # No `--theme` and no `--all`: the sweep scopes to the theme THIS host installed,
        # which `_installed_defaults` reads out of the redirected HOME. Without the seeded
        # install the same command sweeps all 14.
        dict(id="doctor/no-theme-scopes-to-the-installed-one", bin="cli", checkout={},
             world={"repo/.keep": "", f"{_OC}/.geneseed-theme": f"{_SIGIL_THEME}\n",
                    f"{_OC}/.geneseed-manifest.json": _MANIFEST},
             steps=[{"argv": ["doctor", "--no-bundle"], "cwd": "repo"}],
             expect=["[doctor] ok — 1 theme(s) clean",
                     f"(scoped to installed theme '{_SIGIL_THEME}'; run with --all to sweep "
                     f"every theme)"]),
        dr("an-explicit-theme-is-not-announced-as-scoped", src_only,
           expect=["[doctor] ok — 1 theme(s) clean"],
           expect_absent=["scoped to installed theme"]),
        dr("an-unknown-theme-is-refused-by-the-generator",
           ("doctor", "--theme", "nosuchtheme", "--no-bundle"),
           expect=["[nosuchtheme] build failed"],
           expect_re=[r"\[doctor\] [1-9]\d* problem\(s\) across 1 theme\(s\)"]),
    ]


# --------------------------------------------------------------------------------------
# uninstall
# --------------------------------------------------------------------------------------
# THE FIRST VERB THAT DELETES, and that changes what a cell has to say.
#
# Every cell before this group asserts what the reference PRODUCED. Here the contract runs
# both ways, and the direction that matters is the one a comparison cannot reach: two
# implementations that both stopped deleting agree perfectly, in every cell, forever. So each
# removal cell states three things and not one —
#
#   * `expect_absent_files`   what went. The sixth expectation kind, added in P5h, and the
#                             only one that can gate a deletion absolutely. It reads the
#                             `<dirs>` column as well as the file keys, so an emptied husk
#                             counts as "left behind".
#   * `expect_files`          what SURVIVED. P5c's rule — an ownership gate needs a positive
#                             control beside it — and here it is the whole difference between
#                             a manifest-driven removal and an `rmtree`. Every cell that
#                             seeds an owned file seeds an UNOWNED neighbour in the same
#                             directory and names it here.
#   * `expect` / `expect_absent`   what was said. The inventory and the preamble are the loud
#                             half and the easy half; they are gated too, but they are not
#                             what the group is for.
#
# NO CHECKOUT FIXTURE. P5g's `_copy_checkout` costs 0.31 s per cell per side and `uninstall`
# reads `$HOME`, `$XDG_CONFIG_HOME` and the registry — all of which `golden.cell_env` already
# redirects — so nothing here needs one. Measured before reaching for it, which is what the
# fixture's own docblock asks.
#
# WHAT NO CELL REACHES, stated here rather than discovered later:
#   * `_confirm`. `cmd_uninstall` only prompts when `sys.stdin.isatty()`, and the harness
#     gives every cell a pipe. The branch BESIDE it — the non-interactive refusal — is gated,
#     and its `expect` names the wording so the two cannot be confused.
#   * The `failed` list. It needs an owned file that exists, is a file, and cannot be
#     unlinked; nothing a cell can seed on either platform produces one. The INCOMPLETE
#     REPORT it feeds is a different matter — see below, it is reachable and gated.
#   * `memory="delete"`. `cmd_uninstall` passes `archive` or `keep` and no flag reaches the
#     third disposition — deliberate, and the reason the destructive verb cannot lose a
#     learned fact.
#
# AND THE FINDING THAT CAME OUT OF WRITING THE POSITIVE CONTROLS. `_owned_dirs_for` holds
# that "existence, not emptiness, is the retry signal" for `agents`/`skills` (+ `.opencode`/
# `laws`/`plugins`), so a user file that keeps one of those directories alive makes the whole
# uninstall report INCOMPLETE and KEEPS the install markers — even though every owned file
# went and nothing failed. The first draft of this group seeded its unowned neighbours inside
# `skills/` and `agents/` and every removal cell came back INCOMPLETE. That is the
# reference's behaviour, and the absolute half describes the reference rather than
# adjudicating it, so it is gated in both directions instead of designed around: the
# completion cells put their control where the sweep does not look, and
# `a-user-file-under-a-watched-dir-reports-INCOMPLETE` states the other arm on purpose. It
# also means the INCOMPLETE report the P5h brief expected to be unreachable is the
# best-covered branch in the group.

#: A hand-seeded Claude-style install. Small on purpose: the real emit's manifest lists 86
#: owned files and the point of these cells is which of a KNOWN set survives, so the fixture
#: names four and the assertions can name all four.
_CLAUDE_HOOK_GROUP = {
    "event": "PreToolUse",
    "group": {"matcher": "Bash", "hooks": [{"type": "command", "command": "geneseed-hook git-gate"}]},
}
_USER_HOOK_GROUP = {"matcher": "Write", "hooks": [{"type": "command", "command": "my-own-linter"}]}

_CLAUDE_MD = ("# My own notes\n\nProse I wrote myself.\n\n"
              "<!-- BEGIN GENESEED -->\nthe managed block\n<!-- END GENESEED -->\n\n"
              "Prose after the block.\n")


def _claude_manifest(owned, **managed) -> str:
    return json.dumps({
        "owned": owned,
        "managed": dict({"claude_md": {"rel": "CLAUDE.md"},
                         "settings_file": "settings.json",
                         "settings_hooks": [_CLAUDE_HOOK_GROUP],
                         "settings_excludes": ["geneseed/**"]}, **managed),
        "scope": "global",
    }, indent=2) + "\n"


def _uninstall_cells() -> list[dict]:
    def un(name, argv=("uninstall", "--yes"), world=None, cwd="repo", **kw):
        return dict(id=f"uninstall/{name}", bin="cli",
                    world=dict({"repo/.keep": ""}, **(world or {})),
                    steps=[{"argv": list(argv), "cwd": cwd}], **kw)

    _CLAUDE = "home/.claude"

    # A GLOBAL OpenCode install with one owned file, one owned file nested three deep, and
    # two files the manifest does NOT claim. The controls sit OUTSIDE `agents`/`skills`/
    # `plugins` so the sweep in `_owned_dirs_for` does not read them as leftovers — see the
    # section header; a control inside one of those dirs is a different cell.
    def oc_global(**extra):
        return dict({
            # `agents/gone.md` is owned and NOT seeded, which is what makes `removed` a count
            # of UNLINKS rather than of manifest entries. Free: it adds nothing to the count,
            # so no other assertion in the group moves — and without it the mutation that
            # increments before the `isFile` guard is green across all 35 cells, because
            # every other manifest here lists only files that exist.
            f"{_OC}/.geneseed-manifest.json": json.dumps(
                {"owned": ["AGENT.md", "agents/gone.md",
                           "skills/vend/references/deep.md"]}, indent=2) + "\n",
            f"{_OC}/.geneseed-emit": "opencode-global\n",
            f"{_OC}/.geneseed-theme": "neutral\n",
            f"{_OC}/.geneseed-version": _STAMP,
            f"{_OC}/AGENT.md": "# deployed\n",
            f"{_OC}/skills/vend/references/deep.md": "# nested owned\n",
            f"{_OC}/MY-OWN.md": "# my own file, unowned\n",
            f"{_OC}/prompts/mine.md": "# my own prompt, unowned\n",
            f"{_OC}/opencode.json": json.dumps(
                {"$schema": "https://opencode.ai/config.json",
                 "instructions": ["{home/}/.config/opencode/AGENT.md", "./MY-OWN.md"],
                 "theme": "mine"}, indent=2) + "\n",
        }, **extra)

    def claude_global(**extra):
        return dict({
            f"{_CLAUDE}/.geneseed-manifest.json": _claude_manifest(
                ["CLAUDE.md", "agents/advocate.md"]),
            f"{_CLAUDE}/.geneseed-emit": "claude-global\n",
            f"{_CLAUDE}/.geneseed-theme": "neutral\n",
            f"{_CLAUDE}/CLAUDE.md": _CLAUDE_MD,
            f"{_CLAUDE}/agents/advocate.md": "# owned agent\n",
            f"{_CLAUDE}/PROFILE.md": "# my own profile, unowned\n",
            f"{_CLAUDE}/settings.json": json.dumps(
                {"hooks": {"PreToolUse": [_CLAUDE_HOOK_GROUP["group"], _USER_HOOK_GROUP]},
                 "claudeMdExcludes": ["geneseed/**", "mine/**"],
                 "model": "opus"}, indent=2) + "\n",
        }, **extra)

    # A per-repo OpenCode install: the `.opencode/` layer carries a manifest, the portable
    # bundle dirs sit beside it at the repo root, and both a hand-added agent and a
    # user-owned stub are seeded to prove the two are treated differently.
    #
    # This shape reports INCOMPLETE and that is not an accident of the fixture: `.opencode/`
    # is itself one of the dirs `_owned_dirs_for` watches, so ANY user-owned file left under
    # it — `context.json` is one the emit deliberately does not claim — keeps the whole
    # install marked retry-worthy. The completion arm needs a layer that empties, which is
    # `a-layer-that-empties-completely-finishes` below.
    def oc_project(**extra):
        return dict({
            "repo/.opencode/.geneseed-manifest.json": json.dumps(
                {"owned": ["agents/advocate.md"]}, indent=2) + "\n",
            "repo/.opencode/agents/advocate.md": "# owned agent\n",
            "repo/.opencode/agents/mine.md": "# my own agent, unowned\n",
            "repo/.opencode/context.json": '{"eager": []}\n',
            "repo/.geneseed-emit": "opencode\n",
            "repo/.geneseed-theme": "neutral\n",
            "repo/AGENT.md": "# deployed\n",
            "repo/laws/universal.md": "# law\n",
            "repo/agents/advocate.md": "# bundle agent\n",
            "repo/skills/wayfinder/SKILL.md": "# bundle skill\n",
            "repo/README.md": "# my repo, untouched\n",
            "repo/opencode.json": json.dumps(
                {"instructions": ["AGENT.md", "./MY-OWN.md"]}, indent=2) + "\n",
        }, **extra)

    return [
        # ---- resolve ------------------------------------------------------------------
        un("no-target-falls-back-to-the-opencode-global-dir", world=oc_global(),
           # Rule 5, and the default a user with no flags gets. The cwd carries no project
           # install, so the resolve walks past it to the OpenCode global config dir.
           expect=["[uninstall] target: <HOME>", "(opencode:global)",
                   "[uninstall] removes: AGENT.md, agents/, skills/, plugins/, markers, and "
                   "the opencode.json instructions entry.",
                   "[uninstall] done — removed 2 file(s); opencode.json updated where "
                   "needed; memory/notebook kept in place. Start a new session to apply."],
           expect_files=[f"{_OC}/MY-OWN.md", f"{_OC}/prompts/mine.md",
                         f"{_OC}/opencode.json"],
           expect_absent_files=[f"{_OC}/AGENT.md", f"{_OC}/.geneseed-manifest.json",
                                f"{_OC}/.geneseed-emit", f"{_OC}/.geneseed-theme",
                                f"{_OC}/.geneseed-version",
                                f"{_OC}/skills/vend/references/deep.md",
                                # The ancestor climb: three husks, none of which any cell
                                # could see before the `<dirs>` column existed.
                                f"{_OC}/skills/vend/references", f"{_OC}/skills/vend",
                                f"{_OC}/skills"]),
        un("a-user-file-under-a-watched-dir-reports-INCOMPLETE",
           # The other arm of the finding in the section header, and the positive control
           # for the ancestor climb in one cell. `skills/mine/` holds nothing the manifest
           # claims, so the prune must stop at it — which leaves `skills/` standing, which
           # `_owned_dirs_for` reads as a leftover. Every owned file went and nothing
           # failed, and the verb still reports INCOMPLETE and KEEPS the markers so the
           # operator can retry. A port that pruned by NAME rather than by emptiness deletes
           # the user's skill and reports `done` — it fails on all four observations.
           world=oc_global(**{f"{_OC}/skills/mine/SKILL.md": "# my own skill, unowned\n"}),
           expect=["[uninstall] INCOMPLETE — removed 2 file(s), but 1 item(s) survived "
                   "(see the WARN above); the install marker was kept — retry "
                   "`harness uninstall` once they're removable.",
                   "[uninstall] WARN: could not fully remove the install — still present: "
                   "<HOME>"],
           expect_files=[f"{_OC}/skills/mine/SKILL.md"],
           # AND THE MARKERS ARE GONE ANYWAY, which the message says they are not.
           # `_install_uninstall`'s survivors gate guards the ROOT markers at step 3 — but
           # for a GLOBAL install `root` IS the config dir, so `_uninstall_global` has
           # already unlinked the manifest and all four markers at step 1, on its OWN gate,
           # which is `failed` and not `survivors`. The two signals are different and only
           # one of them reaches the deletion. Found by this cell's `expect_files`, which
           # was written asserting the promise and failed against the reference.
           expect_absent_files=[f"{_OC}/skills/vend", f"{_OC}/.geneseed-manifest.json",
                                f"{_OC}/.geneseed-emit", f"{_OC}/.geneseed-theme"]),
        dict(id="uninstall/the-retry-the-INCOMPLETE-message-promises-bounces-off", bin="cli",
             # The consequence, stated as behaviour rather than as a comment. The first step
             # reports INCOMPLETE and tells the operator to retry; the second finds no
             # install at all, because step 1 removed the only thing `_install_state` keys
             # on. Both implementations must agree on it — this cell exists to make sure a
             # port cannot quietly "fix" the reference and diverge, and to make the fix
             # visible the day someone takes it (the cell fails loudly on both sides).
             world=dict({"repo/.keep": ""}, **oc_global(
                 **{f"{_OC}/skills/mine/SKILL.md": "# my own skill, unowned\n"})),
             steps=[{"argv": ["uninstall", "--yes"], "cwd": "repo"},
                    {"argv": ["uninstall", "--yes"], "cwd": "repo"}],
             expect=["[uninstall] no opencode:global Geneseed install at <HOME>",
                     "(no .geneseed-manifest.json)."],
             expect_files=[f"{_OC}/skills/mine/SKILL.md"],
             expect_silent=True),
        un("--target-a-global-config-dir-beats-the-marker-name",
           ("uninstall", "--yes", "--target", "{home}/.claude"), world=claude_global(),
           # THE precedence cell. `~/.claude` is NAMED like a project marker and is the
           # global install, never `claude:project` rooted at `$HOME` — so rule 1 is checked
           # before rule 2. A resolver with the two swapped reports `claude:project` here.
           expect=["[uninstall] target: <HOME>", "(claude:global)"],
           expect_absent=["claude:project"]),
        un("--target-a-project-marker-dir",
           ("uninstall", "--yes", "--target", "{repo}/.opencode"), world=oc_project(),
           # Rule 2: the marker dir itself, root is its PARENT — which is why the target
           # line names the repo and not `.opencode`.
           expect=["[uninstall] target: <SB>", "(opencode:project)"],
           expect_absent=["/.opencode ("]),
        un("--target-a-repo-carrying-a-project-install",
           ("uninstall", "--yes", "--target", "{repo}"), world=oc_project(),
           expect=["(opencode:project)",
                   "[uninstall] removes: AGENT.md, .opencode/, laws/, agents/, skills/, and "
                   "the opencode.json instructions entry."]),
        un("an-unrecognised-target-is-refused",
           ("uninstall", "--yes", "--target", "{repo}/nowhere"),
           expect=["[uninstall] no Geneseed install detected at <SB>",
                   "[uninstall] pass --target <repo> for a project install "
                   "(.opencode/.claude/.bob/.github) or --target <config dir> for a "
                   "global one."],
           expect_silent=True),
        un("a-bare-non-geneseed-claude-dir-does-not-hijack-the-resolve",
           # Very common, and the reason `_project_qualifies` exists at all: a `.claude/`
           # with neither a manifest nor an emit marker naming claude:project is NOT a
           # Geneseed install, so the resolve must walk past it to the global default. A
           # port that qualified on the marker dir alone would "uninstall" the user's repo.
           world=dict(oc_global(), **{"repo/.claude/settings.json": '{"model": "opus"}\n'}),
           expect=["(opencode:global)"],
           expect_absent=["claude:project"],
           expect_files=["repo/.claude/settings.json"]),
        un("the-cwd-project-install-beats-the-global-default",
           # Rule 5's first half. Both installs exist; the cwd's wins, and the global one is
           # left entirely alone — which `expect_files` is what states.
           world=dict(oc_project(), **oc_global()),
           expect=["(opencode:project)"],
           expect_files=[f"{_OC}/AGENT.md", f"{_OC}/.geneseed-manifest.json"]),

        # ---- the absent gate ------------------------------------------------------------
        un("no-install-at-the-resolved-target",
           # `_install_state` says 'absent' and nothing is touched. Exit 1, and `<exit>` is a
           # compared column, so a port that returned 0 fails even with the words right.
           expect=["[uninstall] no opencode:global Geneseed install at <HOME>",
                   "(no .geneseed-manifest.json)."],
           expect_silent=True),
        un("a-project-scope-refusal-names-the-marker-dir",
           ("uninstall", "--yes", "--target", "{repo}"),
           # The `where` clause, which only a non-opencode PROJECT scope reaches. The root
           # qualifies through its `.geneseed-emit` (the pre-manifest legacy fallback) and
           # then has no manifest under `.claude/` to reverse.
           world={"repo/.claude/.keep": "", "repo/.geneseed-emit": "claude\n"},
           expect=["[uninstall] no claude:project Geneseed install at <SB>",
                   "(no .geneseed-manifest.json under .claude/)."],
           expect_silent=True),

        # ---- the confirmation gate ------------------------------------------------------
        un("refuses-without---yes-when-stdin-is-not-a-tty",
           ("uninstall",), world=oc_global(),
           # The branch BESIDE `_confirm`, which no cell can reach. Everything is still
           # there afterwards, and saying so is the point: a port that removed first and
           # refused second would print the same three lines.
           expect=["[uninstall] refusing to proceed without --yes (non-interactive).",
                   "[uninstall] target: <HOME>"],
           expect_files=[f"{_OC}/AGENT.md", f"{_OC}/.geneseed-manifest.json",
                         f"{_OC}/skills/vend/references/deep.md"]),

        # ---- the four preamble arms -----------------------------------------------------
        un("a-claude-install-names-its-carrier-and-its-settings",
           ("uninstall", "--yes", "--target", "{home}/.claude"), world=claude_global(),
           expect=["[uninstall] removes: agents/, skills/, markers, the CLAUDE.md managed "
                   "block, and Geneseed's settings.json hooks/excludes (your own "
                   "keys/hooks are kept)."]),
        un("a-bob-install-names-AGENTS-md-rather-than-CLAUDE-md",
           # The `agentFile` column, and the only thing that varies between this cell and
           # the one above. A port that hardcoded `CLAUDE.md` in the message passes there.
           ("uninstall", "--yes", "--target", "{home}/.bob"),
           world={"home/.bob/.geneseed-manifest.json": _claude_manifest(["AGENTS.md"]),
                  "home/.bob/AGENTS.md": _CLAUDE_MD},
           expect=["(bob:global)", "the AGENTS.md managed block"],
           expect_absent=["the CLAUDE.md managed block"]),
        un("a-copilot-install-has-no-settings-to-unwire",
           ("uninstall", "--yes", "--target", "{repo}"),
           world={"repo/.github/.geneseed-manifest.json": _claude_manifest(
                      ["copilot-instructions.md"]),
                  "repo/.github/copilot-instructions.md": _CLAUDE_MD,
                  "repo/.github/workflows/ci.yml": "# my own workflow\n"},
           expect=["(copilot:project)",
                   "[uninstall] removes: agents/, skills/, markers, and the AGENTS.md "
                   "managed block (Copilot has no settings.json/hooks to unwire; your own "
                   ".github files are kept)."],
           # The claim the message makes, gated: the user's own `.github` content survives.
           expect_files=["repo/.github/workflows/ci.yml"]),

        # ---- the settings unwiring ------------------------------------------------------
        un("the-recorded-hook-group-goes-and-the-users-does-not",
           ("uninstall", "--yes", "--target", "{home}/.claude"), world=claude_global(),
           # `_unwire_claude_settings` removes EXACTLY the recorded groups. The seeded
           # settings.json holds Geneseed's group, the user's group, and two keys neither
           # side owns — and the byte comparison of the rewritten file is what gates the
           # rest. Named here so the cell is not vacuous if the file stops being rewritten.
           expect=["[uninstall] done — removed 2 file(s); settings.json updated where "
                   "needed"],
           expect_files=[f"{_CLAUDE}/settings.json", f"{_CLAUDE}/PROFILE.md"]),
        un("the-claude-md-managed-block-is-excised-and-the-prose-kept",
           ("uninstall", "--yes", "--target", "{home}/.claude"),
           # CLAUDE.md is in `owned`, and it is STILL not deleted: the reversal unlinks it
           # as an owned file and `_managed_block_remove` then finds nothing — so what this
           # actually proves is the ORDER. A port that excised before unlinking leaves the
           # same absence; a port that skipped the unlink leaves the prose. Both are stated.
           world=claude_global(),
           expect_absent_files=[f"{_CLAUDE}/CLAUDE.md"],
           expect_files=[f"{_CLAUDE}/settings.json"]),
        un("prose-around-the-block-survives-when-the-carrier-is-not-owned",
           ("uninstall", "--yes", "--target", "{home}/.claude"),
           # The excision arm proper: CLAUDE.md is NOT in `owned`, so the only thing that
           # touches it is `_managed_block_remove`, which keeps the user's prose. This is
           # the cell the one above cannot be.
           world=dict(claude_global(), **{
               f"{_CLAUDE}/.geneseed-manifest.json": _claude_manifest(["agents/advocate.md"]),
           }),
           expect=["[uninstall] done — removed 1 file(s)"],
           expect_files=[f"{_CLAUDE}/CLAUDE.md"],
           expect_absent_files=[f"{_CLAUDE}/agents/advocate.md"]),
        un("a-carrier-that-is-only-the-block-is-removed-entirely",
           ("uninstall", "--yes", "--target", "{home}/.claude"),
           # `_managed_block_remove`'s last line: an excision that leaves the file empty
           # deletes it. Nothing else in this port reaches that branch.
           world=dict(claude_global(), **{
               f"{_CLAUDE}/.geneseed-manifest.json": _claude_manifest(["agents/advocate.md"]),
               f"{_CLAUDE}/CLAUDE.md":
                   "<!-- BEGIN GENESEED -->\nthe managed block\n<!-- END GENESEED -->\n",
           }),
           expect_absent_files=[f"{_CLAUDE}/CLAUDE.md"],
           expect_files=[f"{_CLAUDE}/PROFILE.md"]),

        # ---- the opencode.json unmerge --------------------------------------------------
        un("the-instructions-entry-goes-and-every-other-key-stays", world=oc_global(),
           # A global install wires the ABSOLUTE posix path, which is what the seeded
           # `instructions` carries. `./MY-OWN.md`, `$schema` and `theme` are the control:
           # the unmerge rewrites the file and must leave all three.
           expect=["opencode.json updated where needed"],
           expect_files=[f"{_OC}/opencode.json"]),
        un("a-commented-jsonc-is-not-rewritten-and-says-so",
           # Rewriting it would drop the comments, so the user is told to do it by hand and
           # the file is left byte-for-byte alone. `_opencode_target` prefers the sibling
           # `.jsonc`, which is why seeding one beside the `.json` is what reaches this.
           world=oc_global(**{
               f"{_OC}/opencode.jsonc":
                   '{\n  // my own comment\n  "instructions": '
                   '["{home/}/.config/opencode/AGENT.md"]\n}\n',
           }),
           expect=["[uninstall] opencode.jsonc has comments — not rewriting it. Remove this "
                   'from its "instructions" by hand: '],
           expect_files=[f"{_OC}/opencode.jsonc"]),
        un("the-project-entry-is-read-off-the-live-config-before-AGENT-md-goes",
           ("uninstall", "--yes", "--target", "{repo}"),
           # `_install_agent_entry` reads the wire BEFORE the deletion, and it reads the
           # RECORDED spelling rather than assuming the canonical one — so a bundle sub-dir
           # layout round-trips. A port that hardcoded `AGENT.md` leaves this entry wired.
           world=oc_project(**{
               "repo/opencode.json": json.dumps(
                   {"instructions": ["bundle/AGENT.md", "./MY-OWN.md"]}, indent=2) + "\n",
           }),
           expect=["opencode.json updated where needed"],
           expect_files=["repo/opencode.json"]),

        # ---- the opencode project reversal ----------------------------------------------
        un("a-manifest-unlinks-the-layer-file-by-file",
           ("uninstall", "--yes", "--target", "{repo}"), world=oc_project(),
           # `.opencode/` prefers its manifest: exactly the listed files go, so a hand-added
           # agent and the user-owned `context.json` stub both survive — and the directory
           # therefore survives with them. The bundle dirs beside it go WHOLE regardless,
           # because the plain build step wipes and rewrites them every run.
           expect=["[uninstall] INCOMPLETE — removed 5 file(s)"],
           expect_files=["repo/.opencode/agents/mine.md", "repo/.opencode/context.json",
                         "repo/README.md",
                         # The markers are KEPT with the layer, which is the survivors gate
                         # doing its job — `.geneseed-emit` is an OpenCode project install's
                         # ONLY qualifying signal, so dropping it would strand the leftovers.
                         "repo/.geneseed-emit"],
           expect_absent_files=["repo/.opencode/agents/advocate.md",
                                "repo/.opencode/.geneseed-manifest.json",
                                "repo/AGENT.md", "repo/laws", "repo/agents",
                                "repo/skills/wayfinder/SKILL.md", "repo/skills"]),
        un("a-layer-that-empties-completely-finishes",
           ("uninstall", "--yes", "--target", "{repo}"),
           # The completion arm of the pair above: nothing unowned is left under
           # `.opencode/`, so the manifest goes, the dir is rmdir'd, the survivors sweep
           # finds nothing and the ROOT markers finally drop. This is the only cell in the
           # group where `.geneseed-emit` is asserted absent for a PROJECT install, and it
           # is what the registry self-prunes the row by.
           world={k: v for k, v in oc_project().items()
                  if k not in ("repo/.opencode/agents/mine.md",
                               "repo/.opencode/context.json")},
           expect=["[uninstall] done — removed 5 file(s)"],
           expect_files=["repo/README.md", "repo/opencode.json"],
           expect_absent_files=["repo/.opencode", "repo/.geneseed-emit",
                                "repo/.geneseed-theme"]),
        un("a-manifest-less-layer-is-deleted-whole",
           ("uninstall", "--yes", "--target", "{repo}"),
           # The legacy fallback, for an install from before the write-before-delete rework.
           # With no manifest there is nothing to be selective WITH, so the hand-added agent
           # goes too — which is the behaviour, and is why the cell above exists beside it.
           world={k: v for k, v in oc_project().items()
                  if k != "repo/.opencode/.geneseed-manifest.json"},
           expect=["[uninstall] done — removed 5 file(s)"],
           expect_files=["repo/README.md"],
           expect_absent_files=["repo/.opencode", "repo/.opencode/agents/mine.md"]),
        un("an-emptied-marker-dir-does-not-linger-as-a-husk",
           ("uninstall", "--yes", "--target", "{repo}"),
           # `_install_uninstall` step 4. `.claude/` held nothing but Geneseed's files, so
           # the repo is left with no trace of it at all — invisible to every cell in this
           # harness until the `<dirs>` column landed.
           world={"repo/.claude/.geneseed-manifest.json": _claude_manifest(
                      ["agents/advocate.md"]),
                  "repo/.claude/agents/advocate.md": "# owned\n",
                  "repo/.geneseed-emit": "claude\n"},
           expect=["(claude:project)"],
           expect_absent_files=["repo/.claude", "repo/.claude/agents",
                                "repo/.geneseed-emit"]),
        un("a-marker-dir-with-a-user-file-in-it-stays",
           ("uninstall", "--yes", "--target", "{repo}"),
           # The positive control for the husk cell above, and the only thing that separates
           # "tidied an empty dir" from "removed the directory".
           world={"repo/.claude/.geneseed-manifest.json": _claude_manifest(
                      ["agents/advocate.md"]),
                  "repo/.claude/agents/advocate.md": "# owned\n",
                  "repo/.claude/settings.local.json": '{"model": "opus"}\n',
                  "repo/.geneseed-emit": "claude\n"},
           expect=["(claude:project)"],
           expect_files=["repo/.claude/settings.local.json"]),

        # ---- the runtime stores ---------------------------------------------------------
        un("memory-and-notebook-are-kept-in-place-by-default",
           world=oc_global(**{f"{_OC}/memory/fact.md": _FACT,
                              f"{_OC}/notebook/note.md": "# note\n"}),
           expect=["[uninstall] memory/ and notebook/ are kept in place (never deleted "
                   "here) — --archive-memory sets both aside.",
                   "memory/notebook kept in place"],
           expect_files=[f"{_OC}/memory/fact.md", f"{_OC}/notebook/note.md"]),
        un("--archive-memory-moves-both-aside-and-deletes-neither",
           ("uninstall", "--yes", "--archive-memory"),
           world=oc_global(**{f"{_OC}/memory/fact.md": _FACT,
                              f"{_OC}/notebook/note.md": "# note\n"}),
           # The timestamp in the archive path is normalised out (`_STAMPS`) — the two sides
           # run seconds apart. What is compared is that both moved the same bytes into a
           # sibling dir of the same shape; what is asserted absolutely is that the original
           # is gone and the copy is there, which is the only pair that says "moved".
           expect=["[uninstall] memory + notebook: will be ARCHIVED to a sibling "
                   "archived-<name>/<timestamp>/ (never deleted)",
                   "memory/notebook archived -> <HOME>"],
           expect_files=[f"{_OC}/archived-memory/<STAMP>/fact.md",
                         f"{_OC}/archived-notebook/<STAMP>/note.md"],
           expect_absent_files=[f"{_OC}/memory", f"{_OC}/notebook"]),
        un("with-no-stores-the-sentence-ends-differently",
           # `stores` empty: the line ends in a full stop and the ARCHIVED line never
           # prints. One `if` with two observable halves, and `expect_absent` is the only
           # thing that can state the second.
           world=oc_global(), argv=("uninstall", "--yes", "--archive-memory"),
           expect=["[uninstall] memory/ and notebook/ are kept in place (never deleted "
                   "here)."],
           expect_absent=["--archive-memory sets both aside", "will be ARCHIVED"]),

        # ---- the surviving-install inventory --------------------------------------------
        un("a-global-uninstall-lists-the-project-installs-that-remain",
           world=dict(oc_global(), **{
               "home/.config/geneseed/installs.json":
                   '["{sb/}/other", "{sb/}/other-global"]',
               "other/.geneseed-emit": "opencode\n",
               "other/.opencode/.keep": "",
               # A registered GLOBAL row that SURVIVES the read, which is the only thing
               # that makes the `scope != "project"` filter observable: the removed root's
               # own row prunes itself away when its marker goes, so a cell with only that
               # one cannot tell a filter from an empty list. Named in `expect_absent`
               # because "this row is excluded" is a claim only an absence can make.
               "other-global/.geneseed-emit": "opencode-global\n",
           }),
           # Informational, never a cascade: a global uninstall cannot touch a project
           # install, and the survivor is still there afterwards to prove it.
           expect=["[uninstall] 1 project install(s) remain — the global removal does not "
                   "affect them (each is self-contained):",
                   "(opencode:project) — remove with: harness uninstall --target"],
           expect_absent=["other-global", "(opencode:global) — remove with"],
           expect_files=["other/.geneseed-emit", "other-global/.geneseed-emit"]),
        un("the-just-removed-root-is-not-listed-as-its-own-survivor",
           # A global install that is ALSO registered — a stale legacy row. It is excluded
           # by resolved path, and with nothing else on record the whole block is silent.
           world=dict(oc_global(), **{
               "home/.config/geneseed/installs.json": '["{home/}/.config/opencode"]',
           }),
           expect=["[uninstall] done — removed 2 file(s)"],
           expect_absent=["project install(s) remain"]),
        un("a-global-uninstall-with-nothing-registered-is-silent", world=oc_global(),
           expect=["[uninstall] done — removed 2 file(s)"],
           expect_absent=["project install(s) remain"]),
        un("a-project-uninstall-names-the-other-host-at-the-same-root",
           ("uninstall", "--yes", "--target", "{repo}/.opencode"),
           # A repo can carry `.opencode/` and `.claude/` side by side and only the resolved
           # one is removed, so the operator is told there is more to do. The Claude install
           # surviving intact is the same sentence stated as files.
           world=dict(oc_project(), **{
               "repo/.claude/.geneseed-manifest.json": _claude_manifest(["CLAUDE.md"]),
               "repo/.claude/CLAUDE.md": _CLAUDE_MD,
           }),
           expect=["[uninstall] also found claude:project here — run `harness uninstall` "
                   "again to remove it."],
           expect_files=["repo/.claude/.geneseed-manifest.json", "repo/.claude/CLAUDE.md"]),
        un("a-project-uninstall-with-no-other-host-says-nothing",
           ("uninstall", "--yes", "--target", "{repo}/.opencode"), world=oc_project(),
           expect=["(opencode:project)"],
           expect_absent=["also found"]),
    ]


# --------------------------------------------------------------------------------------
# setup
#
# THE SMALLEST CELL GROUP IN THE MATRIX, AND THAT IS THE FINDING. `cmd_setup` refuses when
# `sys.stdin.isatty()` is false and every cell's stdin is a pipe, so the wizard behind it is
# unreachable here in the way `_confirm` was in P5h — except that here it is not one branch,
# it is the whole verb. What these three cells gate is the GATE: that the refusal happens,
# that it happens BEFORE anything is read or written, and that a script of answers does not
# get it to run anyway. Everything past it is gated as a stdin-seeded corpus in
# `tests/test_pure_function_parity.py`, which can vary the answers a cell cannot.
#
# AND DO NOT SMOKE-TEST THIS WITH `< /dev/null`. On Windows the null device is a CHARACTER
# device and the CRT's `_isatty` answers TRUE for one, so `python rituals/harness.py setup
# < /dev/null` from Git Bash runs the ENTIRE WIZARD on the developer's own machine — it
# EOF-defaults through all five questions and rebuilds the live global install. The cells are
# safe because `subprocess.run(input=...)` is a real pipe; the shell one-liner is not. Found
# the direct way.
# --------------------------------------------------------------------------------------

#: Both lines of the refusal, exactly as `cmd_setup` writes them in one `sys.stderr.write`.
_SETUP_REFUSAL = ["[setup] needs an interactive terminal. Non-interactive? e.g.:",
                  "  python build.py --emit opencode-global --theme neutral"]


def _setup_cells() -> list[dict]:
    def su(name, world=None, stdin="", **kw):
        return dict(id=f"setup/{name}", bin="cli",
                    world=dict({"repo/.keep": ""}, **(world or {})),
                    steps=[{"argv": ["setup"], "cwd": "repo", "stdin": stdin}], **kw)

    return [
        su("refuses-without-an-interactive-terminal",
           # The whole verb, from a cell's side of the pipe. `expect_silent` is not
           # decoration: the refusal is on STDERR, and a port that printed it on stdout would
           # be byte-identical to a shell that redirects one into the other.
           expect=_SETUP_REFUSAL, expect_silent=True),
        su("a-script-of-answers-on-stdin-is-not-consumed",
           # THE cell for the TTY gate, and the only one that can fail differently from the
           # one above. Seven answers is enough to drive the whole wizard to a confirmed
           # build: five menus, `Proceed?`, and the doctor prompt. A port that dropped the
           # isatty check does not merely print more — it EOF-defaults through the questions
           # and EMITS, which is why the assertion is `expect_absent_files` on the two places
           # a build could land rather than only `expect_absent` on the prompts.
           stdin="1\n1\n1\n1\n1\ny\ny\n",
           expect=_SETUP_REFUSAL,
           expect_absent=["Geneseed setup", "Choose", "About to run:", "Proceed?"],
           expect_silent=True,
           expect_absent_files=[f"{_OC}/AGENT.md", "repo/Harness/AGENT.md",
                                "repo/Harness"]),
        su("the-refusal-precedes-every-detection",
           # `_installed_defaults` reads these four markers and the wizard pre-selects the
           # pickers from them, so a port that gathered first and refused second would name
           # `pirate` on screen. Seeding a REAL install also makes the `expect_files` half
           # meaningful: the refusal must leave the deployed tree exactly as it found it,
           # which is the direction a comparison alone cannot state.
           world={f"{_OC}/.geneseed-emit": "opencode-global\n",
                  f"{_OC}/.geneseed-theme": "pirate\n",
                  f"{_OC}/.geneseed-footprint": "full\n",
                  f"{_OC}/AGENT.md": "# deployed\n"},
           expect=_SETUP_REFUSAL,
           # NOT `opencode-global` — the refusal's own second line names it.
           expect_absent=["pirate", "Install mode", "Footprint"],
           expect_files=[f"{_OC}/.geneseed-theme", f"{_OC}/AGENT.md"],
           expect_silent=True),
    ]


# --------------------------------------------------------------------------------------
# the runner
# --------------------------------------------------------------------------------------

#: The two spellings `harness diff --out` stamps with `datetime.now()`: the improvements
#: FILENAME (`improvements-20260809-112314.md`) and the report's own `captured:` line.
#:
#: WHY THEY ARE BLANKED. A cell runs the reference and then the candidate, one after the
#: other, and a second boundary between the two runs is a coin flip — the report differed by
#: one second on the first `--out` cell ever written. That is not a divergence between two
#: implementations, it is the clock, and a gate that reports it is a gate that gets ignored.
#: Every other input this harness has is either seeded or redirected; the clock is the one it
#: cannot fence off, so it is normalised instead of pretended away (`learn` stamps a DATE,
#: which is why nothing needed this until now — a day boundary is not a coin flip).
#:
#: WHAT THAT COSTS, AND WHERE IT IS PAID BACK. With the digits gone no cell can assert that
#: the two implementations agree on the FORMAT — `improvements-2026-08-09.md` would normalise
#: to the same thing. So that assertion moves to where an absolute per-implementation check
#: belongs: `test_the_improvements_filename_is_stamped_the_same_way_by_both` in
#: `tests/test_hook_cli_parity.py` runs both binaries and matches each against the pattern.
_STAMPS = (
    (re.compile(r"improvements-\d{8}-\d{6}\.md"), "improvements-<STAMP>.md"),
    (re.compile(r"captured: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}"), "captured: <STAMP>"),
    # `_archive_store` names the snapshot after the SECOND it ran in, and the two sides run
    # seconds apart — so an un-destamped archive is one directory only in ref and another
    # only in new, in the `<dirs>` column and in every key beneath it. Both separators:
    # the path is POSIX in a snapshot key and `str(Path)` on stdout, which is `\` here.
    (re.compile(r"(archived-(?:memory|notebook)[\\/])\d{8}-\d{6}"), r"\1<STAMP>"),
)


def _destamp(data: bytes) -> bytes:
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return data
    for pat, repl in _STAMPS:
        text = pat.sub(repl, text)
    return text.encode("utf-8")


def _subst(value, repl: dict):
    """Placeholder substitution. `str.replace`, never `str.format` — half the stdin
    payloads in this file are JSON documents and every `{` in them would be a field."""
    if isinstance(value, str):
        for k, v in repl.items():
            value = value.replace(k, v)
        return value
    if isinstance(value, list):
        return [_subst(x, repl) for x in value]
    if isinstance(value, dict):
        return {k: _subst(v, repl) for k, v in value.items()}
    return value


def _seed(sandbox: Path, world: dict, repl: dict) -> None:
    for rel, text in world.items():
        p = sandbox / _subst(rel, repl)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(_subst(text, repl), encoding="utf-8")


_TRACKED: "list[str] | None" = None


def _tracked_files() -> list[str]:
    """The checkout's file set, as `git` describes it, cached for the run.

    An `rsync`-style filter would be a second, hand-maintained answer to that question, and
    a directory it forgot would make a doctor check report a fault the fixture never
    planted — which reads exactly like a port bug. Refuses an empty answer rather than
    quietly copying nothing: every planted-fault cell would then pass against a clean
    copy of an empty tree.

    `--cached --others --exclude-standard`: the WORKING TREE, not HEAD. Committed files plus
    the ones git can see and has not been told to ignore. A plain `git ls-files` was the
    first draft and it made the gate unusable for the phase it was written for — `js/doctor.mjs`
    is untracked until it is committed, so every one of these cells reported the candidate
    crashing on ERR_MODULE_NOT_FOUND rather than comparing anything. Ignored paths stay out,
    which is what keeps `node_modules/` and the built `Harness/` from being copied 26 times.
    """
    global _TRACKED
    if _TRACKED is None:
        r = subprocess.run(["git", "ls-files", "-z", "--cached", "--others",
                            "--exclude-standard"], cwd=str(ROOT), capture_output=True)
        names = [n for n in r.stdout.decode("utf-8").split("\0") if n]
        if r.returncode != 0 or not names:
            raise RuntimeError(f"git ls-files listed nothing in {ROOT} (rc={r.returncode}) "
                               f"— the checkout fixture cannot be built")
        # A `.gitignore` that grew a line covering `js/` or `src/` would silently shrink the
        # copy, and the clean cell would then report faults nothing planted. Cheap assertion,
        # placed where the answer is produced rather than where it is consumed.
        for needed in ("build.py", "rituals/harness.py", "bin/geneseed-cli.mjs",
                       "src/AGENT.md.tmpl", "registry.json", "web/src/pages/Laws.jsx"):
            if needed not in names:
                raise RuntimeError(f"the checkout fixture's file list is missing {needed} "
                                   f"— every doctor cell would measure that instead")
        _TRACKED = names
    return _TRACKED


def _copy_checkout(dst: Path, faults: dict) -> None:
    """A private checkout for one run of one cell, with `faults` planted in it.

    WHY THIS EXISTS. `doctor` is fifteen checks and ten of them read the CHECKOUT —
    `themes/`, `src/`, `web/`, `README.md`, `registry.json`, the committed bundle. `ROOT` is
    `Path(__file__).resolve().parent.parent` on one side and `import.meta.url`'s directory
    on the other, and `golden.cell_env` moves HOME/XDG/APPDATA and clears every `GENESEED_*`
    knob without moving either. So no cell could plant a fault in two thirds of the verb,
    and `doctor` prints `[doctor] ok — …` when every check finds nothing: delete any single
    check and a clean cell is byte-identical. The gate had to become ONE PLANTED FAULT PER
    CHECK, and this is what makes planting one possible — both implementations derive
    `ROOT` from their own file's location, so a copy has its own `ROOT` and the two move
    together.

    ONE COPY PER CELL PER SIDE, MEASURED RATHER THAN ASSUMED. 511 tracked files / 5.2 MB /
    0.31 s against a `doctor` run of ~2.1 s; the copy is a seventh of the cell and the
    obvious alternative — one copy per cell GROUP, planted and reverted between runs — buys
    that seventh back by making the cells ORDER-DEPENDENT, which nothing in this harness has
    ever been. A hardlink copy measured 0.16 s and was not worth the footgun: a plant that
    forgot to unlink first would edit the real checkout through the link.

    IT LIVES OUTSIDE THE SNAPSHOTTED SANDBOX. `golden._snapshot` walks every file under
    `sb`; a copy in there would put 511 files into each side's snapshot, and the reference
    side would additionally grow the `__pycache__` its own interpreter writes — every cell
    would report hundreds of differences that are only the fixture. The cost is that nothing
    here observes a write INTO the checkout, which is the same blind spot the real `doctor`
    runs under (it emits into `tempfile` and touches the tree only through the interpreter).

    A fault of `None` DELETES the file — the only way to gate the branches that report an
    absent one.
    """
    for rel in _tracked_files():
        src = ROOT / rel
        if not src.is_file():
            continue          # a submodule or a path git knows and the disk does not
        d = dst / rel
        d.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, d)
    for rel, text in faults.items():
        p = dst / rel
        if text is None:
            p.unlink(missing_ok=True)
            continue
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")


def _repoint(cli: list[str], checkout: Path) -> list[str]:
    """Re-aim an already-resolved CLI at the copied checkout.

    `_resolve_cli` turned `rituals/harness.py` and `bin/geneseed-cli.mjs` into absolute paths
    under the real ROOT, which is the whole point of it. A checkout cell needs the same
    command answered by the copy, and both sides are addressed identically — the reference is
    a script path and so is the candidate, so one rule repoints either.
    """
    out = []
    for tok in cli:
        p = Path(tok)
        try:
            out.append(str(checkout / p.relative_to(ROOT)) if p.is_absolute() else tok)
        except ValueError:
            out.append(tok)
    return out


def run_cell(cli: list[str], cell: dict) -> "dict[str, bytes] | str":
    """Run one cell's steps in a fresh sandbox and snapshot what it left.

    Returns the snapshot, or an error string — a CLI that crashes is a finding to report
    per-cell, not an exception that ends the run.

    The snapshot carries three pseudo-files beside the real ones: `<stdout>`, `<stderr>`
    and `<exit>`. golden.py compares the first two for the generator; the third is added
    here because a hook's exit code IS its contract (0 on every path, so the host never
    breaks a tool call) and `learn` passes the model's code through. A port that returned
    1 where Python returns 0 would be invisible without it.
    """
    faults = cell.get("checkout")
    with tempfile.TemporaryDirectory() as td, tempfile.TemporaryDirectory() as ctd:
        sb = Path(td)
        home, repo, cfg = sb / "home", sb / "repo", sb / "cfg"
        for d in (home, repo, cfg):
            d.mkdir(parents=True, exist_ok=True)
        checkout = Path(ctd) / "checkout" if faults is not None else ROOT
        repl = {"{sb}": str(sb), "{home}": str(home), "{repo}": str(repo),
                "{cfg}": str(cfg), "{py}": sys.executable, "{llm}": str(FAKE_LLM),
                "{ck}": str(checkout)}
        # The forward-slash spellings, for anything that lands inside a JSON string. Added
        # BEFORE the native ones would match — `{sb}` is not a substring of `{sb/}`, so the
        # two never collide, but the posix keys are listed first to keep that obvious.
        repl = {**{k[:-1] + "/}": v.replace("\\", "/") for k, v in repl.items()}, **repl}
        if faults is not None:
            _copy_checkout(checkout, _subst(faults, repl))
            cli = _repoint(cli, checkout)
        _seed(sb, cell.get("world") or {}, repl)

        env = golden.cell_env(home)
        env.update(_subst(cell.get("env") or {}, repl))

        proc = None
        for step in cell["steps"]:
            # `seed` writes into the sandbox BETWEEN steps, which `world` cannot: it seeds
            # once, before the first. The doctor cells need it because the only honest way to
            # get a bundle that a fresh render AGREES with is to have a step build one, and
            # the markers a cell wants to vary (`.geneseed-emit`, `.geneseed-footprint`) are
            # written by that same build.
            _seed(sb, step.get("seed") or {}, repl)
            cwd = sb / step.get("cwd", ".")
            # encoding="utf-8" and never a bare text=True: the CLIs force UTF-8 on both
            # streams whatever the console code page is, and decoding that as cp1252 turns
            # every accented cell into a difference that is only the reader's.
            proc = subprocess.run(cli + _subst(step["argv"], repl), cwd=str(cwd), env=env,
                                  input=_subst(step.get("stdin", ""), repl),
                                  capture_output=True, text=True, encoding="utf-8")
        # HOME before SB: home sits UNDER the sandbox, so normalising the sandbox first
        # would leave `<SB>/home` and the two tags would stop lining up.
        #
        # The copied checkout answers to `<REPO>` too, and deliberately: it IS the repo for
        # a checkout cell, its path differs between the two sides (each gets its own copy),
        # and a message naming it must normalise to what the same message would say from the
        # real tree.
        roots = [("<HOME>", home), ("<REPO>", checkout), ("<REPO>", ROOT), ("<SB>", sb)]
        # The clock, out of the KEYS as well as the contents: a bare `--out` names the file
        # after the second it ran in, so an un-destamped key is reported as one file only in
        # ref and another only in new. See `_STAMPS`.
        snap = {_destamp(k.encode("utf-8")).decode("utf-8"): _destamp(v)
                for k, v in golden._snapshot(sb, roots).items()}
        # THE DIRECTORY COLUMN, added in P5h for the first verb that DELETES.
        #
        # `golden._snapshot` walks FILES, so an empty directory is invisible: a port that
        # removed a directory's contents and left the husk, or removed a directory the
        # reference leaves in place, was byte-identical in all 219 cells. That was a
        # standing hole (`cmdTheme`'s statement order sits in it too) and `uninstall` is
        # where it stops being theoretical — "did it clean up after itself" is literally
        # the verb, and the empty-ancestor prune is one of its four moving parts.
        #
        # A single pseudo-file rather than a sixth expectation kind for the COMPARISON
        # half: one entry closes the hole for every cell in the matrix at once, including
        # the ones written before it existed, where a per-cell assertion would only cover
        # the cells that remembered to declare it. The absolute half is a different axis
        # and is `expect_absent_files`.
        snap["<dirs>"] = "\n".join(sorted(
            _destamp(p.relative_to(sb).as_posix().encode("utf-8")).decode("utf-8")
            for p in sb.rglob("*") if p.is_dir())).encode("utf-8")
        snap["<stdout>"] = _destamp(
            golden._normalise(proc.stdout.encode("utf-8", "replace"), roots))
        snap["<stderr>"] = _destamp(
            golden._normalise(proc.stderr.encode("utf-8", "replace"), roots))
        snap["<exit>"] = str(proc.returncode).encode()
        return snap


def check_expectations(cell: dict, snap: "dict[str, bytes]") -> list[str]:
    """The absolute assertions, run against the REFERENCE side.

    This is the half a comparison cannot do. The four hook verbs are silent on almost every
    path by design, so two implementations that both stopped working would agree in every
    cell. `expect` states what the reference must actually say; when it stops saying it,
    the cell is reported as vacuous instead of banked — the same discipline as golden's
    `sovereign` carve-out, which fails when it excuses nothing.

    What it does NOT do is adjudicate. These assertions describe the reference, so a cell
    written against a reference that is wrong records the fault faithfully and passes; P5e's
    first `build` cells did exactly that. The comparison is what surfaces the disagreement,
    and a person is what decides which side of it is right.
    """
    problems = []
    text = (snap["<stdout>"] + b"\n" + snap["<stderr>"]).decode("utf-8", "replace")
    for want in cell.get("expect", ()):
        if want not in text:
            problems.append(f"the reference no longer prints {want!r} — this cell has "
                            f"stopped exercising what it names")
    for unwanted in cell.get("expect_absent", ()):
        if unwanted in text:
            problems.append(f"the reference now prints {unwanted!r}, which this cell "
                            f"exists to prove it leaves out")
    for pat in cell.get("expect_re", ()):
        if not re.search(pat, text):
            problems.append(f"the reference's output no longer matches {pat!r} — this "
                            f"cell has stopped exercising what it names")
    if cell.get("expect_silent") and snap["<stdout>"].strip():
        problems.append("the reference printed on stdout, but this cell exists to prove "
                        f"it stays silent: {snap['<stdout>'][:160]!r}")
    for want in cell.get("expect_files", ()):
        if want not in snap:
            problems.append(f"the reference did not write {want} — this cell cannot tell "
                            f"whether the candidate does")
    # The absolute half of a DELETION, and the sixth kind. `expect_files` says the
    # reference wrote something; nothing said the reference REMOVED something, and for
    # `uninstall` that is the whole contract. A cross-implementation comparison is blind
    # to a defect both sides share (P4e/M43) — two implementations that both stopped
    # deleting agree perfectly — and the seeded world makes that concrete: every one of
    # these paths EXISTS before the verb runs, so a passing `expect_absent_files` is a
    # statement about the verb rather than about the fixture. Directories count, which is
    # why it reads `<dirs>` as well as the file keys: a husk left behind is exactly the
    # failure the column above was added for, and P5c's rule applies in both directions —
    # an ownership gate needs its positive control, so a cell naming a deleted path names
    # a surviving neighbour in `expect_files` beside it.
    #
    # AND THE COLUMN IS REQUIRED, not optional. A snapshot with no `<dirs>` makes every
    # directory in `expect_absent_files` pass trivially — the fixture would stop recording
    # husks and thirty-five cells would stay green while the half of the verb they were
    # written for went unobserved. Same shape as P5g's M30, which is why it is a stated
    # failure rather than an `if "<dirs>" in snap`.
    # PRESENT *and* NON-EMPTY. The first draft checked only presence and mutation M22 —
    # the walk left in place, its input replaced by `[]` — stayed green: an empty column
    # compares equal on both sides and makes every husk assertion pass against an empty
    # set. An empty column is never legitimate, because `run_cell` creates `home`, `repo`
    # and `cfg` before any step runs, so there is no cell it could honestly describe.
    want_absent = cell.get("expect_absent_files", ())
    if want_absent and not snap.get("<dirs>", b"").strip():
        problems.append("the snapshot's <dirs> column is missing or empty, so every "
                        "directory named in expect_absent_files would pass without being "
                        "looked at — and the sandbox always holds home/repo/cfg")
        return problems
    kept = set(snap["<dirs>"].decode("utf-8").split("\n")) if want_absent else set()
    for unwanted in want_absent:
        if unwanted in snap or unwanted in kept:
            problems.append(f"the reference left {unwanted} behind, and this cell exists "
                            f"to prove it removes it")
    return problems


def compare(ref: dict, new: dict, matrix: list[dict], limit: int) -> int:
    """`ref` and `new` map a cell's `bin` ("hook"/"cli") to the command that answers it."""
    shown = " · ".join(f"new[{k}]={' '.join(v)}" for k, v in sorted(new.items()))
    print(f"[harness-golden] {len(matrix)} cells · ref={' '.join(ref['hook'])} · {shown}")
    failures: list[str] = []
    for i, cell in enumerate(matrix, 1):
        cid = cell["id"]
        which = cell.get("bin", "hook")
        a, b = run_cell(ref[which], cell), run_cell(new[which], cell)
        if isinstance(a, str) or isinstance(b, str):
            failures.append(f"  {cid}: CLI failed\n    ref: {a if isinstance(a, str) else 'ok'}"
                            f"\n    new: {b if isinstance(b, str) else 'ok'}")
            continue
        vacuous = check_expectations(cell, a)
        if vacuous:
            failures.append(f"  {cid}: VACUOUS\n" + "\n".join(f"    {p}" for p in vacuous))
            continue
        only_a, only_b = sorted(set(a) - set(b)), sorted(set(b) - set(a))
        differing = sorted(k for k in set(a) & set(b) if a[k] != b[k])
        if only_a or only_b or differing:
            parts = [f"  {cid}: {len(only_a)} missing, {len(only_b)} extra, "
                     f"{len(differing)} differing"]
            parts += [f"    - only in ref: {k}" for k in only_a[:5]]
            parts += [f"    + only in new: {k}" for k in only_b[:5]]
            parts += [golden._diff(k, a[k], b[k]) for k in differing[:3]]
            failures.append("\n".join(parts))
        if i % 20 == 0 or i == len(matrix):
            print(f"[harness-golden]   {i}/{len(matrix)} ({len(failures)} failing)")
    if not failures:
        print(f"[harness-golden] ok — {len(matrix)} cells identical")
        return 0
    print(f"\n[harness-golden] {len(failures)}/{len(matrix)} cells DIFFER:\n")
    for f in failures[:limit]:
        print(f + "\n")
    if len(failures) > limit:
        print(f"[harness-golden] ... and {len(failures) - limit} more (raise --limit)")
    return 1


def _resolve_cli(argv: list[str]) -> list[str]:
    """Make a repo-relative script path absolute, against the checkout.

    golden.py can take `node bin/geneseed.mjs` verbatim because every generator cell runs
    with `cwd=ROOT`. Here cwd is an INPUT — `context` discovers against it, `sovereign_bypass`
    compares against it, `learn` looks beside it for a memory store — so every cell runs
    from inside its own sandbox, where `bin/geneseed-hook.mjs` does not exist. Resolving
    once here keeps the acceptance command the same shape as golden's.
    """
    return [str(ROOT / tok) if (ROOT / tok).is_file() else tok for tok in argv]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--ref", default=None,
                    help="reference CLI (default: this repo's rituals/harness.py)")
    ap.add_argument("--new", default=None,
                    help="candidate CLI for the four HOOK verbs. Omitted: compare ref "
                         "against itself, which self-checks determinism.")
    ap.add_argument("--new-cli", default=None,
                    help="candidate CLI for the non-hook verbs. The Node side is two "
                         "binaries where harness.py is one; supplying --new without this "
                         "while a selected cell needs it is refused, not defaulted.")
    ap.add_argument("--only", default=None,
                    help="comma-separated verbs or cell-id prefixes to keep. For a PARTIAL "
                         "port, and for iteration. Refuses an empty selection rather than "
                         "reporting 0/0 as a pass.")
    ap.add_argument("--limit", type=int, default=5, help="failing cells to detail")
    args = ap.parse_args(argv)

    ref = _resolve_cli(golden._split(args.ref)) if args.ref else [
        sys.executable, str(ROOT / "rituals" / "harness.py")]
    matrix = cells()
    if args.only:
        keep = [p.strip() for p in args.only.split(",") if p.strip()]
        matrix = [c for c in matrix if any(c["id"].startswith(p) for p in keep)]
        if not matrix:
            print(f"[harness-golden] --only {','.join(keep)} selected 0 cells — nothing "
                  f"would be compared, which is not a pass.")
            return 2

    # The reference answers every verb from one binary; the candidate may not. A cell whose
    # binary was not supplied would silently compare the reference against ITSELF and pass,
    # which reads exactly like a ported verb — the same failure mode as `--only` matching
    # nothing, and refused the same way.
    new = {"hook": _resolve_cli(golden._split(args.new)) if args.new else ref,
           "cli": _resolve_cli(golden._split(args.new_cli)) if args.new_cli else ref}
    if args.new and not args.new_cli:
        needs = sorted({c["id"] for c in matrix if c.get("bin", "hook") == "cli"})
        if needs:
            print(f"[harness-golden] --new was given but --new-cli was not, and "
                  f"{len(needs)} selected cell(s) are answered by the non-hook binary "
                  f"({needs[0]}, ...). They would have been compared against the reference "
                  f"itself, which always passes. Pass --new-cli, or --only the hook verbs.")
            return 2
    return compare({"hook": ref, "cli": ref}, new, matrix, args.limit)


if __name__ == "__main__":
    raise SystemExit(main())
