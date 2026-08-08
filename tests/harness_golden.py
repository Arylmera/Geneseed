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
    python tests/harness_golden.py --new "node bin/geneseed-hook.mjs"    # the P5 gate

DO NOT MISTAKE THE SELF-CHECK FOR A REGRESSION GATE — the same warning golden.py carries.
With no --new this runs the reference CLI against ITSELF and proves only that the cells are
deterministic. It is still worth running: several of these verbs read the clock
(`append_agent_lesson` stamps a date), the environment, and the user's own files, and a
cell that is not deterministic cannot gate anything.

WHY THE CELLS CARRY `expect` AS WELL AS COMPARING
-------------------------------------------------
P4e/M43: a cross-implementation comparison is structurally blind to a defect BOTH sides
share. That risk is higher here than it was for the generator, because these four verbs
are silent on almost every path by design — a hook must never break a tool call, so every
unreadable payload, every missing file and every bypass exits 0 with no output. Two CLIs
that both stopped gating would agree perfectly, in every cell, forever.

So each cell also states, ABSOLUTELY, what the reference must produce: `expect` substrings
that have to appear, `expect_silent` for the paths whose whole contract is saying nothing,
and `expect_files` for the ones that write. Those run against the REFERENCE side and fail
the cell when they do not hold — a cell that has stopped exercising what it names is
reported as vacuous rather than banked as a pass. `test_hook_cli_parity.py` asserts that
every cell carries at least one of the three.

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
import os
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import golden  # noqa: E402  (needs tests/ on the path first)

ROOT = golden.ROOT
FAKE_LLM = ROOT / "tests" / "fixtures" / "fake_llm.py"

VERBS = ("context", "git-gate", "rule-gate", "learn")

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
    import json
    return json.dumps(kw)


def cells() -> list[dict]:
    """Every cell, grouped by verb. A cell is a dict:

        id            "<verb>/<name>", the display key and the --only prefix
        world         {relative path: text} seeded into the sandbox before the run
        steps         [{argv, stdin, cwd}] — more than one runs them in order into the
                      SAME sandbox, and only the LAST step's streams are compared (the
                      others' effects survive in the tree, which is the point)
        env           overlay on golden.cell_env — the knobs this cell depends on
        expect        substrings the REFERENCE must print on stdout+stderr
        expect_absent substrings the reference must NOT print — the direction `expect`
                      cannot express, and the only way to gate a filter (EXCLUDE_DIRS, a
                      manifest replacing discovery) whose whole job is leaving things out
        expect_silent the reference must print NOTHING on stdout
        expect_files  paths that must exist in the sandbox afterwards

    Placeholders `{sb}` `{home}` `{repo}` `{cfg}` `{py}` `{llm}` are substituted in world
    contents, argv, stdin and env values once the sandbox exists. Each path one also has a
    `{sb/}` form spelling the same path with forward slashes, and JSON contexts MUST use
    it: a Windows sandbox root inside a JSON string literal is `C:\\Users\\...`, whose `\\U`
    is an invalid escape, so the document fails to parse and the cell silently tests the
    unparseable-input path instead of the one it names. Six cells were written that way
    and every one of them was caught by its own `expect` rather than by review.
    """
    return _context_cells() + _git_gate_cells() + _rule_gate_cells() + _learn_cells()


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
        # split is on both separators. A POSIX `Path(r"C:\x\user-rules.md").name` is the
        # whole string, so a `.name` implementation goes silent here and nowhere else.
        rg("windows-path-on-any-host", "C:\\\\work\\\\repo\\\\user-rules.md", expect=[ASK]),
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
              expect=["TAIL-MARKER"]),
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
# the runner
# --------------------------------------------------------------------------------------

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
    with tempfile.TemporaryDirectory() as td:
        sb = Path(td)
        home, repo, cfg = sb / "home", sb / "repo", sb / "cfg"
        for d in (home, repo, cfg):
            d.mkdir(parents=True, exist_ok=True)
        repl = {"{sb}": str(sb), "{home}": str(home), "{repo}": str(repo),
                "{cfg}": str(cfg), "{py}": sys.executable, "{llm}": str(FAKE_LLM)}
        # The forward-slash spellings, for anything that lands inside a JSON string. Added
        # BEFORE the native ones would match — `{sb}` is not a substring of `{sb/}`, so the
        # two never collide, but the posix keys are listed first to keep that obvious.
        repl = {**{k[:-1] + "/}": v.replace("\\", "/") for k, v in repl.items()}, **repl}
        _seed(sb, cell.get("world") or {}, repl)

        env = golden.cell_env(home)
        env.update(_subst(cell.get("env") or {}, repl))

        proc = None
        for step in cell["steps"]:
            cwd = sb / step.get("cwd", ".")
            # encoding="utf-8" and never a bare text=True: the CLIs force UTF-8 on both
            # streams whatever the console code page is, and decoding that as cp1252 turns
            # every accented cell into a difference that is only the reader's.
            proc = subprocess.run(cli + _subst(step["argv"], repl), cwd=str(cwd), env=env,
                                  input=_subst(step.get("stdin", ""), repl),
                                  capture_output=True, text=True, encoding="utf-8")
        # HOME before SB: home sits UNDER the sandbox, so normalising the sandbox first
        # would leave `<SB>/home` and the two tags would stop lining up.
        roots = [("<HOME>", home), ("<REPO>", ROOT), ("<SB>", sb)]
        snap = golden._snapshot(sb, roots)
        snap["<stdout>"] = golden._normalise(proc.stdout.encode("utf-8", "replace"), roots)
        snap["<stderr>"] = golden._normalise(proc.stderr.encode("utf-8", "replace"), roots)
        snap["<exit>"] = str(proc.returncode).encode()
        return snap


def check_expectations(cell: dict, snap: "dict[str, bytes]") -> list[str]:
    """The absolute assertions, run against the REFERENCE side.

    This is the half a comparison cannot do. These four verbs are silent on almost every
    path by design, so two implementations that both stopped working would agree in every
    cell. `expect` states what the reference must actually say; when it stops saying it,
    the cell is reported as vacuous instead of banked — the same discipline as golden's
    `sovereign` carve-out, which fails when it excuses nothing.
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
    if cell.get("expect_silent") and snap["<stdout>"].strip():
        problems.append("the reference printed on stdout, but this cell exists to prove "
                        f"it stays silent: {snap['<stdout>'][:160]!r}")
    for want in cell.get("expect_files", ()):
        if want not in snap:
            problems.append(f"the reference did not write {want} — this cell cannot tell "
                            f"whether the candidate does")
    return problems


def compare(ref: list[str], new: list[str], matrix: list[dict], limit: int) -> int:
    print(f"[harness-golden] {len(matrix)} cells · ref={' '.join(ref)} · new={' '.join(new)}")
    failures: list[str] = []
    for i, cell in enumerate(matrix, 1):
        cid = cell["id"]
        a, b = run_cell(ref, cell), run_cell(new, cell)
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
                    help="candidate CLI. Omitted: compare ref against itself, which "
                         "self-checks determinism.")
    ap.add_argument("--only", default=None,
                    help="comma-separated verbs or cell-id prefixes to keep. For a PARTIAL "
                         "port, and for iteration. Refuses an empty selection rather than "
                         "reporting 0/0 as a pass.")
    ap.add_argument("--limit", type=int, default=5, help="failing cells to detail")
    args = ap.parse_args(argv)

    ref = _resolve_cli(golden._split(args.ref)) if args.ref else [
        sys.executable, str(ROOT / "rituals" / "harness.py")]
    new = _resolve_cli(golden._split(args.new)) if args.new else ref
    matrix = cells()
    if args.only:
        keep = [p.strip() for p in args.only.split(",") if p.strip()]
        matrix = [c for c in matrix if any(c["id"].startswith(p) for p in keep)]
        if not matrix:
            print(f"[harness-golden] --only {','.join(keep)} selected 0 cells — nothing "
                  f"would be compared, which is not a pass.")
            return 2
    return compare(ref, new, matrix, args.limit)


if __name__ == "__main__":
    raise SystemExit(main())
