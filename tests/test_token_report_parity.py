"""Behavioural parity for the `token-report` skill script: Python vs Node.

THE ONLY BEHAVIOURAL GATE THIS SCRIPT HAS EVER HAD.

`src/skills/token-report/scripts/token_report.py` was 746 lines that nothing in `tests/`
has ever executed. The 518 emit cells carry it as a path key and compare its BYTES — which
means they compare the file to itself and say nothing whatever about what it computes. A
port graded only by those cells would be graded on `cp`.

So this file is the oracle, and it exists BEFORE the port does. Every cell drives BOTH
implementations over the same seeded transcript and compares raw stdout BYTES, stderr
BYTES and the exit code. Nothing is normalised except two declared exceptions, each with
its reason and an absolute assertion beside it (see `_compare`).

The reference is no longer part of the product — it sits frozen in `tests/fixtures/` (see
`REFERENCE` below), which is what lets this file keep gating the port after the shipped
Python is gone rather than expiring the moment it first passed.

THE FENCE. Every host root this script can reach is steered by the environment:

  claude    $CLAUDE_CONFIG_DIR  else ~/.claude
  bob       $BOB_CONFIG_DIR     else ~/.bob
  opencode  $XDG_DATA_HOME/opencode else ~/.local/share/opencode else ~/.opencode
  copilot   $COPILOT_CONFIG_DIR else ~/.copilot

`~` is `Path.home()` in Python and `os.homedir()` in Node, and BOTH read `$USERPROFILE`
first on Windows and `$HOME` first elsewhere (measured, not assumed). So every cell
repoints HOME *and* USERPROFILE at a fixture home and deletes all four config variables —
which fences the developer's real `~/.claude` out, and exercises the default resolution
path that a user actually hits. A handful of cells set a config variable back, to reach
the override branch.

The cwd is an INPUT too — `claude_shaped_find` slugifies it to pick a project directory
and `opencode_db_parse` matches it against `session.directory` — so every cell runs both
processes from the same fixture project directory.

There is no clock in the output: the duration comes from timestamps inside the transcript,
never from `now`. This surface is fully deterministic and needs no destamp.
"""

import argparse
import contextlib
import io
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path, PurePath

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "src" / "skills" / "token-report" / "scripts"

#: THE ORACLE, KEPT. `token_report.py` used to live beside the port in `src/`, where it
#: shipped inside every bundle and was the last Python in the product. P2 Task 3 removed
#: it from the product — but DELETING it outright would have taken 40 behavioural cells
#: with it, since a comparison needs something to compare to. So it moved here instead,
#: frozen, never shipped (`tests/` is excluded from the npm tarball and from
#: `test_package_manifest`'s product scan) and never run by anything but this file.
#:
#: The precedent is Task 2's `tests/fixtures/sync_themes_probe.py`: a ported tool keeps
#: its Python twin as a fixture so the parity gate outlives the port. Without it this
#: file would have been a one-shot check that went stale the moment it passed.
REFERENCE = ROOT / "tests" / "fixtures" / "token_report_oracle.py"
PORT = SCRIPTS / "token_report.mjs"

# Node prints its own experimental-feature warnings on stderr when `node:sqlite` loads.
# They are the RUNTIME's, not the port's, and Python has no counterpart, so the sqlite
# cells strip them — but only after asserting that the reference wrote no stderr at all,
# so the filter can never be hiding a message the port invented.
# `node:\d+` for the warning itself, `(Use \`...\`` for its follow-up line — and the
# executable it names is whatever launched the process, `node.EXE` on Windows.
_NODE_WARNING = re.compile(rb"^\((?:node:\d+|Use `)[^\n]*\r?\n", re.M)

# Both implementations translate `\n` to `os.linesep` on the way out (Python because
# `sys.stdout` is a TextIOWrapper with `newline=None`, the port because it reproduces
# that). A needle written with `\n` therefore has to be expanded before it is looked
# for — the alternative is decoding the captured bytes with universal newlines, which
# is exactly the transport normalisation that would blind this file to a CRLF split.
def _nl(b: bytes, prog: bytes = b"") -> bytes:
    # `@PROG@` because argparse's prog is the script's own FILENAME, and both filenames
    # are facts about where the files live rather than about what they print. Hardcoding
    # either one made three cells fail the moment the oracle moved into `tests/fixtures`.
    return b.replace(b"@PROG@", prog).replace(b"\n", os.linesep.encode())


# ---------------------------------------------------------------------------
# Fixture construction
# ---------------------------------------------------------------------------

def _slug(path: str) -> str:
    """`_slugify` in the script under test — the project-directory name."""
    return re.sub(r"[^A-Za-z0-9]", "-", path)


def _jsonl(records) -> str:
    return "".join(json.dumps(r) + "\n" for r in records)


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # newline="" so the fixture bytes are what this file says they are on every platform.
    path.write_text(text, encoding="utf-8", newline="")


def _assistant(usage=None, model="claude-opus-5", content=(), ts=None, side=False):
    rec = {"type": "assistant", "message": {"model": model, "content": list(content)}}
    if usage is not None:
        rec["message"]["usage"] = usage
    if ts is not None:
        rec["timestamp"] = ts
    if side:
        rec["isSidechain"] = True
    return rec


def _user(content, ts=None, meta=False, side=False):
    rec = {"type": "user", "message": {"content": content}}
    if ts is not None:
        rec["timestamp"] = ts
    if meta:
        rec["isMeta"] = True
    if side:
        rec["isSidechain"] = True
    return rec


def _usage(inp=0, out=0, read=0, write=0):
    return {"input_tokens": inp, "output_tokens": out,
            "cache_read_input_tokens": read, "cache_creation_input_tokens": write}


def _oc_db(path: Path, sessions, messages, parts):
    """Build an OpenCode v1.2+ store. The FIXTURE is the input to both sides — neither
    implementation writes it, so the SQLite file cannot encode one side's assumptions."""
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    con.executescript(
        "CREATE TABLE session (id TEXT PRIMARY KEY, parent_id TEXT, directory TEXT,"
        " time_updated INTEGER);"
        "CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER,"
        " data TEXT);"
        "CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, time_created INTEGER,"
        " data TEXT);")
    con.executemany("INSERT INTO session VALUES (?,?,?,?)", sessions)
    con.executemany("INSERT INTO message VALUES (?,?,?,?)",
                    [(m[0], m[1], m[2], json.dumps(m[3])) for m in messages])
    con.executemany("INSERT INTO part VALUES (?,?,?,?)",
                    [(p[0], p[1], p[2], json.dumps(p[3])) for p in parts])
    con.commit()
    con.close()


# ---------------------------------------------------------------------------
# The corpus
# ---------------------------------------------------------------------------

TOOL_INPUT = {"file_path": "/tmp/x.md", "limit": 40}

FULL_TRANSCRIPT = [
    _user("summarise the repo", ts="2026-08-11T10:00:00.000Z"),
    _assistant(
        _usage(inp=1200, out=300, read=18000, write=2400),
        content=[{"type": "thinking", "thinking": "weigh the options"},
                 {"type": "text", "text": "Reading the tree."},
                 {"type": "tool_use", "id": "t1", "name": "Read", "input": TOOL_INPUT}],
        ts="2026-08-11T10:00:20.000Z"),
    _user([{"type": "tool_result", "tool_use_id": "t1",
            "content": "line one\nline two\nline three"}],
          ts="2026-08-11T10:00:25.000Z"),
    _user("<skill body>", ts="2026-08-11T10:00:26.000Z", meta=True),
    {"type": "attachment", "attachment": {"kind": "reminder", "text": "stay on task"}},
    _assistant(_usage(inp=90, out=1500, read=21000, write=0),
               content=[{"type": "text", "text": "Done — three files."}],
               ts="2026-08-11T10:05:00.000Z"),
    # A sidechain pair: its USAGE is aggregated as subagent, its CONTENT never counted.
    _assistant(_usage(inp=500, out=800, read=4000), side=True,
               content=[{"type": "text", "text": "x" * 4000}],
               ts="2026-08-11T10:03:00.000Z"),
    _user("subagent prompt that must not be counted", side=True),
]


def _claude_home(home: Path, project: str, records=FULL_TRANSCRIPT, host="claude",
                 name="sess-a.jsonl"):
    _write(home / f".{host}" / "projects" / _slug(project) / name, _jsonl(records))


def _copilot_home(home: Path, docs):
    for rel, text in docs.items():
        _write(home / ".copilot" / "history-session-state" / rel, text)


CELLS = []


def cell(name, **kw):
    CELLS.append(dict(name=name, **kw))


# --- Claude / Bob ----------------------------------------------------------

cell("claude: a full transcript, every record type at once",
     build=lambda home, proj: _claude_home(home, proj),
     # `duration 3 min`, not 5: `span` takes the LAST timestamp in file order and the
     # sidechain record at 10:03 is the last one, even though its CONTENT is excluded.
     # A subagent finishing after the main thread therefore shortens the reported
     # duration. Measured against the reference, not assumed.
     expect=[b"# Token usage report \xe2\x80\x94 Claude Code",
             b"Session: `sess-a.jsonl`", b"duration 3 min",
             b"## Session totals (exact, from recorded usage)",
             b"| Requests | 2 | 1 | 3 |",
             b"Models used: `claude-opus-5`",
             b"## Context window", b"## Content breakdown",
             b"Tool call \xc2\xb7 Read", b"Tool result \xc2\xb7 Read",
             b"Injected skill/command content",
             b"System attachments (reminders, listings)",
             b"## Top 1 heaviest single items"],
     # The sidechain's 4000-char reply is aggregated as subagent OUTPUT but never
     # attributed as content — the one property a summing bug would erase silently.
     expect_absent=[b"| Assistant replies | 1,0"])

cell("bob: the identical transcript under ~/.bob",
     build=lambda home, proj: _claude_home(home, proj, host="bob"),
     expect=[b"# Token usage report \xe2\x80\x94 IBM Bob", b"Session: `sess-a.jsonl`"])

cell("claude: thinking absent from the record is DERIVED from the exact output total",
     build=lambda home, proj: _claude_home(home, proj, records=[
         _user("hello"),
         _assistant(_usage(inp=100, out=9000, read=5000),
                    content=[{"type": "text", "text": "short answer"}]),
     ]),
     expect=[b"Assistant thinking (derived)"])

cell("claude: blank lines, truncated JSON and a non-dict content block are skipped",
     build=lambda home, proj: _write(
         home / ".claude" / "projects" / _slug(proj) / "s.jsonl",
         "\n   \n{\"type\": \"assistant\", \"message\": {\"usage\": \n"
         + _jsonl([_assistant(_usage(inp=10, out=20)),
                   _user([{"type": "text", "text": "kept"}, 42, None, True,
                          ["a", "b"], {"nested": {"k": 1}}])])),
     expect=[b"# Token usage report", b"| Requests | 1 | 0 | 1 |"])

cell("claude: a peak above the last request earns its own row",
     build=lambda home, proj: _claude_home(home, proj, records=[
         _assistant(_usage(inp=100, out=10, read=90000)),
         _assistant(_usage(inp=100, out=10, read=1000)),
     ]),
     expect=[b"| Peak context size |"])

cell("claude: a transcript with no usage at all is the estimate-only banner",
     build=lambda home, proj: _claude_home(home, proj, records=[
         _user("only words here"),
         _assistant(None, content=[{"type": "text", "text": "and here"}]),
     ]),
     expect=[b"*(This host recorded no exact per-request usage",
             b"## Content breakdown"],
     expect_absent=[b"## Session totals", b"## Context window"])

cell("claude: --limit and --top move the percentage columns and the tail",
     argv=["--limit", "40000", "--top", "2"],
     build=lambda home, proj: _claude_home(home, proj, records=[
         _assistant(_usage(inp=1000, out=100, read=19000),
                    content=[{"type": "tool_use", "id": "t1", "name": "Bash",
                              "input": {"command": "ls"}}]),
         _user([{"type": "tool_result", "tool_use_id": "t1", "content": "a" * 900}]),
         _user([{"type": "tool_result", "tool_use_id": "t1", "content": "b" * 500}]),
         _user([{"type": "tool_result", "tool_use_id": "t1", "content": "c" * 100}]),
     ]),
     expect=[b"| Context limit | 40,000 | 100% |", b"## Top 2 heaviest single items"],
     expect_absent=[b"## Top 3"])

cell("claude: the cwd slug names the project directory, beating a newer sibling",
     build=lambda home, proj: (
         _claude_home(home, proj, records=[_user("the right one"),
                                           _assistant(_usage(inp=7, out=7))]),
         _write(home / ".claude" / "projects" / "some-other-project" / "z.jsonl",
                _jsonl([_user("the wrong one"), _assistant(_usage(inp=9, out=9))]))),
     # The DIRECTORY's mtime is what `claude_shaped_find` sorts on, not the file's.
     # Stamping only the file left this cell unable to see the exact-match branch
     # disappear: both directories then carried ~now and the tie fell the right way by
     # accident of readdir order. Found by mutation, not by reading.
     mtimes={".claude/projects/some-other-project/z.jsonl": 2_000_000_000,
             ".claude/projects/some-other-project": 2_000_000_000},
     expect=[b"Session: `sess-a.jsonl`"])

cell("TRAP .get(k, default): a key present with a NULL value takes the VALUE, "
     "not the default",
     # `block.get("name", "unknown")` on `{"name": null}` is None, so the category is
     # `Tool call · None`; `block["name"] ?? "unknown"` would say `unknown`. Likewise
     # `json.dumps(None)` is 4 characters and `json.dumps({})` is 2 — enough to move
     # the row across `est_tokens`' rounding boundary and out of the table.
     build=lambda home, proj: _claude_home(home, proj, records=[
         _assistant(_usage(inp=1, out=1), content=[
             {"type": "tool_use", "id": "t1", "name": None, "input": None}]),
         # The RESULT must carry real content: a zero-character row is dropped by
         # `est_tokens` before it is printed, and the category NAME goes with it —
         # which is how the `?? 'unknown'` mutation first survived this cell.
         _user([{"type": "tool_result", "tool_use_id": "t1", "content": "r" * 60}]),
     ]),
     expect=[b"Tool call \xc2\xb7 None", b"Tool result \xc2\xb7 None",
             b"| None result | 15 |"],
     expect_absent=[b"unknown"])

cell("TRAP stable sort: two categories of EQUAL size keep INSERTION order",
     # Python's `sorted` is stable and `d.cats` is insertion-ordered, so the user turn
     # (seen first) outranks the equally-sized reply. Any comparator with a name
     # tie-break would put `Assistant replies` above it.
     build=lambda home, proj: _claude_home(home, proj, records=[
         _user("u" * 40),
         _assistant(None, content=[{"type": "text", "text": "a" * 40}]),
     ]),
     expect=[b"| User messages | 10 | 50.0% | \xe2\x96\x88\xe2\x96\x88\xe2\x96\x88"
             b"\xe2\x96\x88\xe2\x96\x88\xe2\x96\x91\xe2\x96\x91\xe2\x96\x91\xe2\x96\x91"
             b"\xe2\x96\x91 |\n| Assistant replies | 10 |"])

cell("claude: with no directory for this cwd the newest project directory wins",
     build=lambda home, proj: (
         _write(home / ".claude" / "projects" / "aaa-old" / "old.jsonl",
                _jsonl([_assistant(_usage(inp=1, out=1))])),
         _write(home / ".claude" / "projects" / "zzz-new" / "new.jsonl",
                _jsonl([_assistant(_usage(inp=2, out=2))]))),
     mtimes={".claude/projects/aaa-old": 1_000_000_000,
             ".claude/projects/zzz-new": 2_000_000_000},
     expect=[b"Session: `new.jsonl`"])

cell("claude: --transcript names the file outright",
     argv=["--host", "claude", "--transcript", "@HOME@/elsewhere/named.jsonl"],
     build=lambda home, proj: _write(home / "elsewhere" / "named.jsonl",
                                     _jsonl([_assistant(_usage(inp=5, out=5))])),
     expect=[b"Session: `named.jsonl`"])

cell("claude: epoch-millis timestamps span the same way ISO ones do",
     build=lambda home, proj: _claude_home(home, proj, records=[
         _assistant(_usage(inp=1, out=1), ts=1_754_900_000_000),
         _assistant(_usage(inp=1, out=1), ts=1_754_900_600_000),
     ]),
     expect=[b"duration 10 min"])

cell("claude: an unparseable timestamp leaves the duration off entirely",
     build=lambda home, proj: _claude_home(home, proj, records=[
         _assistant(_usage(inp=1, out=1), ts="not-a-time"),
         _assistant(_usage(inp=1, out=1), ts="also-not"),
     ]),
     expect=[b"Session: `sess-a.jsonl`"],
     expect_absent=[b"duration"])

# --- The arithmetic traps --------------------------------------------------

cell("TRAP round(): 30 seconds is 0.5 minutes, and Python's .0f rounds it to EVEN",
     build=lambda home, proj: _claude_home(home, proj, records=[
         _assistant(_usage(inp=1, out=1), ts="2026-08-11T10:00:00.000Z"),
         _assistant(_usage(inp=1, out=1), ts="2026-08-11T10:00:30.000Z"),
     ]),
     # `f"{0.5:.0f}"` is "0"; `(0.5).toFixed(0)` is "1".
     expect=[b"duration 0 min"])

cell("TRAP round(): 90 seconds is 1.5 minutes and rounds to 2",
     build=lambda home, proj: _claude_home(home, proj, records=[
         _assistant(_usage(inp=1, out=1), ts="2026-08-11T10:00:00.000Z"),
         _assistant(_usage(inp=1, out=1), ts="2026-08-11T10:01:30.000Z"),
     ]),
     expect=[b"duration 2 min"])

cell("TRAP .1f: a percentage of exactly x.25 rounds to EVEN, not up",
     # 4 characters out of 64 is 6.25% EXACTLY — dyadic, so the tie is real and not an
     # artefact of binary error. `f"{6.25:.1f}"` is "6.2"; `(6.25).toFixed(1)` is "6.3".
     # Found by the corpus against a written proof that said this could not happen.
     build=lambda home, proj: _claude_home(home, proj, records=[
         _assistant(None, content=[{"type": "text", "text": "abcd"}]),
         _user("u" * 60),
     ]),
     expect=[b"| Assistant replies | 1 | 6.2% |"])

cell("TRAP round(): character counts on the .5 boundary round to EVEN, not up",
     # 2 chars -> 0.5 -> 0 tokens (the row vanishes); 10 -> 2.5 -> 2; 6 -> 1.5 -> 2;
     # 14 -> 3.5 -> 4.  Math.round would give 1, 3, 2, 4 — two of the four differ.
     build=lambda home, proj: _claude_home(home, proj, records=[
         _user("ab"),
         _assistant(None, content=[
             {"type": "text", "text": "0123456789"},
             {"type": "thinking", "thinking": "abcdef"}]),
     ]),
     expect=[b"| Assistant replies | 2 |", b"| Assistant thinking | 2 |"],
     expect_absent=[b"| User messages |"])

cell("TRAP len(): a code point is one character, not one UTF-16 unit",
     # An emoji is len 1 to Python and .length 2 to JS. Four of them plus CJK.
     build=lambda home, proj: _claude_home(home, proj, records=[
         _assistant(None, content=[{"type": "text", "text": "\U0001f600" * 8}]),
         _assistant(None, content=[{"type": "thinking", "thinking": "世界" * 6}]),
     ]),
     expect=[b"| Assistant replies | 2 |", b"| Assistant thinking | 3 |"])

cell("TRAP json.dumps(): ensure_ascii escapes, so a tool input's LENGTH is the escaped one",
     # "é" is 1 char but `json.dumps` writes é — 6. The estimate is built from the
     # escaped length, and `JSON.stringify` would emit the raw character.
     build=lambda home, proj: _claude_home(home, proj, records=[
         _assistant(_usage(inp=1, out=1), content=[
             {"type": "tool_use", "id": "t1", "name": "Write",
              "input": {"text": "éééé"}}]),
     ]),
     expect=[b"Tool call \xc2\xb7 Write"])

cell("TRAP str(): a bare value inside a content list goes through Python's str(), "
     "where True is 'True' and a list is '[1, 2]'",
     build=lambda home, proj: _claude_home(home, proj, records=[
         _user([True, False, None, 1.5, [1, 2], {"a": "b"}]),
     ]),
     expect=[b"| User messages |"])

cell("TRAP thousands: a million tokens is grouped",
     build=lambda home, proj: _claude_home(home, proj, records=[
         _assistant(_usage(inp=1_234_567, out=2_500_000, read=9_876_543)),
     ]),
     expect=[b"| Output tokens | 2,500,000 |", b"1,234,567", b"9,876,543"])

cell("TRAP bar(): exactly half a cell fills to EVEN",
     # 10 * 1 / 20 is exactly 0.5 -> round-half-even -> 0 filled blocks.
     argv=["--limit", "20"],
     build=lambda home, proj: _claude_home(home, proj, records=[
         _assistant(_usage(inp=1, out=1)),
     ]),
     expect=[b"| Session start (harness + context) | 1 | 5.0% | "
             b"\xe2\x96\x91\xe2\x96\x91\xe2\x96\x91\xe2\x96\x91\xe2\x96\x91"
             b"\xe2\x96\x91\xe2\x96\x91\xe2\x96\x91\xe2\x96\x91\xe2\x96\x91 |"])

cell("TRAP bar(): a part above the whole clamps at full width",
     argv=["--limit", "10"],
     build=lambda home, proj: _claude_home(home, proj, records=[
         _assistant(_usage(inp=500, out=1)),
     ]),
     # `pct` is a plain `.1f` — no thousands separator, unlike every `fmt` column.
     expect=[b"5000.0%"])

cell("KNOWN RESIDUAL: an INTEGRAL FLOAT in a tool input is 3 chars to Python and 1 to JS",
     # `json.loads` keeps 1.0 a float and `json.dumps` writes "1.0"; `JSON.parse` yields
     # the double 1 and nothing downstream can tell it from an int. Declared, measured,
     # and deliberately NOT hidden — see the port's `jsonDumps` docblock.
     build=lambda home, proj: _claude_home(home, proj, records=[
         _assistant(_usage(inp=1, out=1), content=[
             {"type": "tool_use", "id": "t1", "name": "Edit",
              "input": {"a": 1.0, "b": 2.0, "c": 3.0, "d": 4.0}}]),
     ]),
     expect=[b"Tool call \xc2\xb7 Edit"],
     residual=True)

cell("claude: $CLAUDE_CONFIG_DIR replaces the home root",
     env={"CLAUDE_CONFIG_DIR": "@HOME@/custom-claude"},
     build=lambda home, proj: (
         _write(home / "custom-claude" / "projects" / _slug(proj) / "env.jsonl",
                _jsonl([_assistant(_usage(inp=3, out=3))])),
         # The home-rooted one must LOSE — proof the variable is read, not merged.
         _write(home / ".claude" / "projects" / _slug(proj) / "home.jsonl",
                _jsonl([_assistant(_usage(inp=4, out=4))]))),
     expect=[b"Session: `env.jsonl`"])

cell("bob: $BOB_CONFIG_DIR replaces the home root",
     argv=["--host", "bob"],
     env={"BOB_CONFIG_DIR": "@HOME@/custom-bob"},
     build=lambda home, proj: _write(
         home / "custom-bob" / "projects" / _slug(proj) / "env.jsonl",
         _jsonl([_assistant(_usage(inp=3, out=3))])),
     expect=[b"IBM Bob", b"Session: `env.jsonl`"])

# --- OpenCode --------------------------------------------------------------

OC_MSGS = [
    ("m1", "s1", 1_754_900_000_000, {"id": "m1", "role": "user"}),
    ("m2", "s1", 1_754_900_060_000, {
        "id": "m2", "role": "assistant", "modelID": "big-model",
        "tokens": {"input": 800, "output": 200, "reasoning": 50,
                   "cache": {"read": 12000, "write": 400}}}),
]
OC_PARTS = [
    ("p1", "m1", 1, {"type": "text", "text": "please refactor the parser"}),
    ("p2", "m2", 2, {"type": "reasoning", "text": "consider the grammar"}),
    ("p3", "m2", 3, {"type": "text", "text": "Here is the plan."}),
    ("p4", "m2", 4, {"type": "tool", "tool": "Grep",
                     "state": {"input": {"pattern": "def "},
                               "output": "match one\nmatch two"}}),
]

cell("opencode: the v1.2 SQLite store",
     build=lambda home, proj: _oc_db(
         home / ".local" / "share" / "opencode" / "opencode.db",
         [("s1", None, "/nowhere", 1_754_900_060_000)], OC_MSGS, OC_PARTS),
     expect=[b"# Token usage report \xe2\x80\x94 OpenCode", b"Session: `s1`",
             b"Models used: `big-model`", b"| Requests | 1 | 0 | 1 |",
             b"| Output tokens | 250 | 0 | 250 |",
             b"Tool call \xc2\xb7 Grep", b"Tool result \xc2\xb7 Grep",
             b"> Source: opencode.db (SQLite, OpenCode v1.2+)."],
     sqlite=True)

cell("opencode: --session names the session outright",
     argv=["--host", "opencode", "--session", "s2"],
     build=lambda home, proj: _oc_db(
         home / ".local" / "share" / "opencode" / "opencode.db",
         [("s1", None, "/nowhere", 2_000_000_000_000),
          ("s2", None, "/elsewhere", 1_000_000_000_000)],
         OC_MSGS + [("m9", "s2", 5, {"id": "m9", "role": "assistant",
                                     "modelID": "small", "tokens": {"input": 11, "output": 22}})],
         OC_PARTS),
     expect=[b"Session: `s2`", b"Models used: `small`"],
     sqlite=True)

cell("opencode: the session recorded in THIS directory beats the newest one",
     build=lambda home, proj: _oc_db(
         home / ".local" / "share" / "opencode" / "opencode.db",
         [("newest", None, "/somewhere-else", 9_000_000_000_000),
          ("here", None, proj, 1_000_000_000_000)],
         [("m1", "here", 1, {"id": "m1", "role": "assistant", "modelID": "m",
                             "tokens": {"input": 5, "output": 5}})],
         []),
     expect=[b"Session: `here`"],
     sqlite=True)

cell("opencode: step-finish tokens fill in a message whose own record had none",
     build=lambda home, proj: _oc_db(
         home / ".local" / "share" / "opencode" / "opencode.db",
         [("s1", None, "/nowhere", 1)],
         [("m1", "s1", 1, {"id": "m1", "role": "assistant", "modelID": "stepper"})],
         [("p1", "m1", 1, {"type": "step-finish",
                           "tokens": {"input": 60, "output": 40,
                                      "cache": {"read": 5, "write": 6}}}),
          ("p2", "m1", 2, {"type": "step-finish",
                           "tokens": {"input": 10, "output": 5}})]),
     expect=[b"| Requests | 2 | 0 | 2 |", b"| Output tokens | 45 | 0 | 45 |",
             b"Models used: `stepper`"],
     sqlite=True)

cell("opencode: a child session is a subagent — usage aggregated, content never",
     build=lambda home, proj: _oc_db(
         home / ".local" / "share" / "opencode" / "opencode.db",
         [("s1", None, "/nowhere", 1), ("kid", "s1", "/nowhere", 1)],
         OC_MSGS + [("k1", "kid", 1, {"id": "k1", "role": "assistant", "modelID": "sub",
                                      "tokens": {"input": 70, "output": 30}})],
         OC_PARTS + [("kp", "k1", 1, {"type": "text", "text": "z" * 3000})]),
     expect=[b"| Requests | 1 | 1 | 2 |", b"| Output tokens | 250 | 30 | 280 |",
             b"totals aggregate this session's child sessions."],
     sqlite=True)

cell("opencode: the pre-1.2 JSON storage is the fallback when no db file exists",
     build=lambda home, proj: [
         _write(home / ".local" / "share" / "opencode" / "storage" / "message" / "sX"
                / "msg-0001.json",
                json.dumps({"id": "m1", "role": "user",
                            "time": {"created": 1_754_900_000_000}})),
         _write(home / ".local" / "share" / "opencode" / "storage" / "message" / "sX"
                / "msg-0002.json",
                json.dumps({"id": "m2", "role": "assistant", "modelID": "legacy",
                            "tokens": {"input": 300, "output": 90,
                                       "cache": {"read": 7000, "write": 0}},
                            "time": {"created": 1_754_900_120_000}})),
         _write(home / ".local" / "share" / "opencode" / "storage" / "part" / "m1"
                / "a.json", json.dumps({"type": "text", "text": "old style question"})),
         _write(home / ".local" / "share" / "opencode" / "storage" / "part" / "m2"
                / "b.json", json.dumps({"type": "text", "text": "old style answer"})),
     ],
     expect=[b"Session: `sX`", b"Models used: `legacy`",
             b"> Source: OpenCode JSON storage (pre-v1.2)."])

cell("opencode: $XDG_DATA_HOME picks the data directory",
     env={"XDG_DATA_HOME": "@HOME@/xdg"},
     build=lambda home, proj: _oc_db(
         home / "xdg" / "opencode" / "opencode.db",
         [("xdg-session", None, "/nowhere", 1)],
         [("m1", "xdg-session", 1, {"id": "m1", "role": "assistant", "modelID": "x",
                                    "tokens": {"input": 1, "output": 1}})],
         []),
     expect=[b"Session: `xdg-session`"],
     sqlite=True)

# --- Copilot ---------------------------------------------------------------

cell("copilot: token-like fields anywhere in the tree are harvested and summed",
     build=lambda home, proj: _copilot_home(home, {
         "a.json": json.dumps({
             # Each body must clear FOUR characters or `est_tokens` rounds its row to
             # zero and `render` drops it — the first cell this corpus cost me.
             "messages": [{"role": "user", "content": "how many tokens?"},
                          {"role": "assistant", "content": "hard to say"},
                          {"role": "tool", "content": "42 matches found here"}],
             "usage": {"promptTokens": 1200, "completionTokens": 340},
             "deep": {"nested": {"cachedTokens": 60}}}),
     }),
     expect=[b"GitHub Copilot", b"token-like fields", b"cachedtokens=60",
             b"completiontokens=340", b"prompttokens=1,200",
             b"| User messages |", b"| Assistant replies |",
             b"Tool result \xc2\xb7 (unattributed)"])

cell("copilot: no recognisable token field is the estimates-only note",
     build=lambda home, proj: _copilot_home(home, {
         "a.json": json.dumps({"messages": [{"role": "user", "content": "hi there"}]})}),
     expect=[b"records no recognisable token counts"],
     expect_absent=[b"token-like fields"])

cell("copilot: .jsonl is read line by line and .json whole, in sorted order",
     # MEASURED, not assumed: `copilot_find` returns ONE entry of the state directory
     # (`newest(root.iterdir())`), so a sibling directory is never opened. Both files
     # must live under the SAME top-level entry or half this cell is unreachable.
     build=lambda home, proj: _copilot_home(home, {
         "run-1/second.jsonl": '{"role": "user", "content": "one question here"}\n'
                               'not json\n'
                               '{"role": "assistant", "content": "two answers here"}\n',
         "run-1/first.json": json.dumps({"role": "user", "content": "zero and more"}),
     }),
     expect=[b"Session: `run-1`", b"| User messages |", b"| Assistant replies |"])

cell("TRAP sorted(paths): Python compares path COMPONENTS, not the flat string",
     # The exact defect Task 2 found in `pyfs.comparePaths`. `"a b.json"` vs
     # `"a/b.json"`: flat, `' '` (0x20) sorts before `'/'` (0x2f) so `a b.json` wins;
     # by components, `["a"]` is a prefix of `["a b.json"]` so `a/b.json` wins. The two
     # bodies carry EQUAL character counts under different role names, so the stable
     # sort leaves the FILE ORDER visible in the table.
     build=lambda home, proj: _copilot_home(home, {
         "run/a b.json": json.dumps({"role": "alpha", "content": "x" * 40}),
         "run/a/b.json": json.dumps({"role": "beta", "content": "y" * 40}),
     }),
     expect=[b"| beta messages | 10 | 50.0%", b"| alpha messages | 10 |"])

cell("TRAP isinstance(True, int): a BOOLEAN field whose name mentions tokens counts as 1",
     build=lambda home, proj: _copilot_home(home, {
         "a.json": json.dumps({"hasTokens": True, "lostTokens": False,
                               "realTokens": 5})}),
     expect=[b"hastokens=1", b"losttokens=0", b"realtokens=5"])

cell("copilot: --transcript names one file rather than the directory",
     argv=["--host", "copilot", "--transcript", "@HOME@/single.json"],
     build=lambda home, proj: (
         _write(home / "single.json",
                json.dumps({"role": "user", "content": "just this one"})),
         # The directory must exist or the host is undetectable — but must not be read.
         _copilot_home(home, {"ignored.json": json.dumps({"role": "user",
                                                          "content": "n" * 5000})})),
     expect=[b"Session: `single.json`"],
     expect_absent=[b"1,2"])

# --- Detection and refusals ------------------------------------------------

cell("detect: with all four hosts present the most recently touched one wins",
     build=lambda home, proj: (
         _claude_home(home, proj, records=[_assistant(_usage(inp=1, out=1))]),
         _claude_home(home, proj, host="bob",
                      records=[_assistant(_usage(inp=2, out=2))]),
         _copilot_home(home, {"c.json": json.dumps({"role": "user", "content": "c"})}),
         _oc_db(home / ".local" / "share" / "opencode" / "opencode.db",
                [("s1", None, "/nowhere", 1)],
                [("m1", "s1", 1, {"id": "m1", "role": "assistant", "modelID": "o",
                                  "tokens": {"input": 1, "output": 1}})], [])),
     mtimes={".claude/projects/@SLUG@/sess-a.jsonl": 1_000_000_000,
             ".bob/projects/@SLUG@/sess-a.jsonl": 1_500_000_000,
             ".copilot/history-session-state": 1_200_000_000,
             ".local/share/opencode/opencode.db": 1_900_000_000},
     expect=[b"# Token usage report \xe2\x80\x94 OpenCode"],
     sqlite=True)

cell("detect: nothing anywhere is a refusal on stderr, not an empty report",
     build=lambda home, proj: None,
     expect_rc=1,
     expect_err=[b"error: no session data found for any supported host "
                 b"(claude, bob, opencode, copilot)"],
     expect_stdout_empty=True)

cell("detect: --host naming a host with no data is its own refusal",
     argv=["--host", "opencode"],
     build=lambda home, proj: _claude_home(home, proj),
     expect_rc=1,
     expect_err=[b"error: no session data found for host 'opencode'"],
     expect_stdout_empty=True)

# --- The argument parser ---------------------------------------------------

cell("argparse: --help is the whole option list at 80 columns",
     argv=["--help"],
     build=lambda home, proj: None,
     prog_subst=True,
     expect=[b"usage: @PROG@ [-h] [--host {claude,bob,opencode,copilot}]",
             b"Token usage report for the current agent session",
             b"--limit LIMIT         context window limit for % columns (default 200000)",
             b"--top TOP             how many heaviest single items to list (default 5)"],
     expect_port=[b"usage: @PROG@ [-h] [--host {claude,bob,opencode,copilot}]",
                  b"\n                        [--transcript TRANSCRIPT] "
                  b"[--session SESSION]\n",
                  b"\noptions:\n  -h, --help            show this help message and exit\n",
                  b"\n  --host {claude,bob,opencode,copilot}\n"
                  b"                        force a host instead of auto-detecting "
                  b"by recency\n",
                  b"\n  --session SESSION     explicit session id (opencode)\n"])

def _argparse_choose_from(choices: "list[str]") -> bytes:
    """argparse's OWN rendering of the choice list, asked rather than guessed.

    CPython changed this between 3.13 patch releases: the choices used to render
    bare (`choose from claude, bob`) and now render quoted (`choose from 'claude',
    'bob'`). `.github/workflows/ci.yml` pins `python-version: "3.13"` with no patch
    digit, so a laptop on 3.13.5 and a runner on 3.13.14 disagree about what the
    REFERENCE prints — and a literal here asserts one machine's interpreter, not
    argparse's behaviour. This is the same shape as gh-139065's `_handle_long_word`
    skew, which `tests/test_cli_reference.py` answers the same way: probe, do not pin.

    Only the REFERENCE's expectation is derived. `expect_port` stays a literal on
    purpose — after P4 there is no argparse to track, so the port's message is its
    own frozen contract and must not silently follow CPython."""
    p = argparse.ArgumentParser(prog="p", add_help=False)
    p.add_argument("--x", choices=list(choices))
    err = io.StringIO()
    with contextlib.redirect_stderr(err):
        try:
            p.parse_args(["--x", "nope"])
        except SystemExit:
            pass
    m = re.search(r"\(choose from ([^)]*)\)", err.getvalue())
    assert m, f"argparse did not render a choice list: {err.getvalue()!r}"
    return m.group(1).encode()


cell("argparse: an invalid --host choice is argparse's own refusal, exit 2",
     argv=["--host", "nope"],
     build=lambda home, proj: None,
     prog_subst=True,
     expect_rc=2,
     expect_stdout_empty=True,
     expect_err=[b"usage: @PROG@ [-h]",
                 b"@PROG@: error: argument --host: invalid choice: 'nope' "
                 b"(choose from " + _argparse_choose_from(
                     ["claude", "bob", "opencode", "copilot"]) + b")"],
     expect_port=[b"@PROG@: error: argument --host: invalid choice: 'nope' "
                  b"(choose from claude, bob, opencode, copilot)"])

cell("argparse: a non-integer --limit is refused before any host is probed",
     argv=["--limit", "xx"],
     build=lambda home, proj: _claude_home(home, proj),
     prog_subst=True,
     expect_rc=2,
     expect_stdout_empty=True,
     expect_err=[b"@PROG@: error: argument --limit: invalid int value: 'xx'"],
     expect_port=[b"@PROG@: error: argument --limit: invalid int value: 'xx'"])

cell("argparse: --limit accepts what Python's int() accepts, underscores included",
     argv=["--limit", " 1_000 "],
     build=lambda home, proj: _claude_home(home, proj, records=[
         _assistant(_usage(inp=100, out=1))]),
     expect=[b"| Context limit | 1,000 | 100% |"])


# ---------------------------------------------------------------------------
# The runner
# ---------------------------------------------------------------------------

class TokenReportParity(unittest.TestCase):
    """Both implementations, one seeded transcript, raw bytes compared."""

    maxDiff = None

    def _stage(self, spec):
        # `.resolve()`: on Windows `%TEMP%` is an 8.3 short path, and `os.getcwd()` in
        # the child reports the LONG form. `session.directory` is compared against that
        # cwd verbatim, so an unresolved fixture path never matches.
        tmp = Path(tempfile.mkdtemp(prefix="tokrep-")).resolve()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        home = tmp / "home"
        proj = tmp / "project"
        home.mkdir(parents=True)
        proj.mkdir(parents=True)
        if spec["build"] is not None:
            spec["build"](home, str(proj))
        for rel, when in (spec.get("mtimes") or {}).items():
            target = home / rel.replace("@SLUG@", _slug(str(proj)))
            os.utime(target, (when, when))
        return home, proj

    def _env(self, spec, home, proj):
        env = dict(os.environ)
        env["PYTHONUTF8"] = "1"
        env["PYTHONIOENCODING"] = "utf-8"
        # THE FENCE — every default root this script can reach.
        for var in ("CLAUDE_CONFIG_DIR", "BOB_CONFIG_DIR", "COPILOT_CONFIG_DIR",
                    "XDG_DATA_HOME", "HOMEDRIVE", "HOMEPATH"):
            env.pop(var, None)
        env["HOME"] = str(home)
        env["USERPROFILE"] = str(home)
        for k, v in (spec.get("env") or {}).items():
            env[k] = v.replace("@HOME@", str(home)).replace("@PROJ@", str(proj))
        return env

    def _argv(self, spec, home, proj):
        return [a.replace("@HOME@", str(home)).replace("@PROJ@", str(proj))
                for a in (spec.get("argv") or [])]

    def _run(self, cmd, cwd, env):
        p = subprocess.run(cmd, cwd=str(cwd), env=env, capture_output=True)
        return p.returncode, p.stdout, p.stderr

    def _compare(self, spec):
        home, proj = self._stage(spec)
        env = self._env(spec, home, proj)
        argv = self._argv(spec, home, proj)

        rc_p, out_p, err_p = self._run(
            [sys.executable, str(REFERENCE)] + argv, proj, env)
        rc_n, out_n, err_n = self._run([_node(), str(PORT)] + argv, proj, env)

        # ---- absolute assertions on the REFERENCE ---------------------------
        # A comparison alone cannot see a defect BOTH sides share, and cannot see a
        # fixture that made the whole cell vacuous. Every cell states what the
        # reference does before either side is compared to the other.
        self.assertEqual(rc_p, spec.get("expect_rc", 0),
                         f"reference exit code\nstdout: {out_p[:400]!r}\n"
                         f"stderr: {err_p[:400]!r}")
        if spec.get("expect_stdout_empty"):
            self.assertEqual(out_p, b"", "the reference printed a report it should not")
        else:
            self.assertTrue(out_p, "the reference printed NOTHING — the fixture never "
                                   "reached the renderer and this cell is vacuous")
        ref_prog = REFERENCE.name.encode()
        for needle in spec.get("expect", ()):
            self.assertIn(_nl(needle, ref_prog), out_p,
                          "the reference's own output lacks this — the "
                          "cell does not exercise what it claims")
        for needle in spec.get("expect_absent", ()):
            self.assertNotIn(_nl(needle, ref_prog), out_p)
        for needle in spec.get("expect_err", ()):
            self.assertIn(_nl(needle, ref_prog), err_p)

        # ---- the two declared normalisations --------------------------------
        if spec.get("sqlite"):
            # Node's own ExperimentalWarning for `node:sqlite`. Stripped only after
            # proving the reference wrote nothing at all, so the filter cannot be
            # covering for a message the port invented.
            self.assertEqual(err_p, b"", "a sqlite cell whose reference DID write to "
                                         "stderr — the warning filter would hide it")
            stripped = _NODE_WARNING.sub(b"", err_n)
            self.assertNotEqual(stripped, err_n if err_n else b"\x00",
                                "no Node warning was present, so this cell does not "
                                "need the filter — drop `sqlite=True`")
            err_n = stripped
        if spec.get("prog_subst"):
            # argparse's prog is the script's own filename, and the port's is `.mjs` by
            # construction — one character longer, which also widens the usage block's
            # continuation indent by one space. Both are substituted, never ignored, and
            # the substitution must actually FIRE so it can never be a silent no-op.
            #
            # This is the WEAKEST comparison in the file, so the argparse cells carry
            # `expect_port` as well: the port's RAW bytes are asserted absolutely, which
            # is what actually holds the help text still once the reference is gone.
            port_prog = PORT.name.encode()
            self.assertIn(port_prog, out_n + err_n,
                          "prog_subst is declared but the port never names itself")
            for needle in spec.get("expect_port", ()):
                self.assertIn(_nl(needle, port_prog), out_n + err_n,
                              "the PORT's own bytes lack this — the normalisation "
                              "below would otherwise hide it")
            out_n = out_n.replace(port_prog, ref_prog)
            err_n = err_n.replace(port_prog, ref_prog)
            squash = lambda b: re.sub(rb"\n +", b"\n ", b)   # noqa: E731
            out_p, out_n = squash(out_p), squash(out_n)
            err_p, err_n = squash(err_p), squash(err_n)

        # ---- the comparison -------------------------------------------------
        if spec.get("residual"):
            self.assertNotEqual(out_p, out_n,
                                "the declared residual has been CLOSED — delete the "
                                "`residual` flag and the docblock that explains it")
            return
        self.assertEqual(out_p, out_n, "stdout bytes differ")
        self.assertEqual(err_p, err_n, "stderr bytes differ")
        self.assertEqual(rc_p, rc_n, "exit codes differ")


def _node() -> str:
    return shutil.which("node") or "node"


def _mk(spec):
    def test(self):
        self._compare(spec)
    test.__doc__ = spec["name"]
    return test


for _i, _spec in enumerate(CELLS):
    _slugname = re.sub(r"[^a-z0-9]+", "_", _spec["name"].lower()).strip("_")[:80]
    setattr(TokenReportParity, f"test_{_i:02d}_{_slugname}", _mk(_spec))


PROBE = ROOT / "tests" / "fixtures" / "token_report_probe.mjs"


def _py_bar(part, whole, width=10):
    filled = round(width * part / whole) if whole else 0
    return "█" * min(filled, width) + "░" * max(width - filled, 0)


def _py_int(s):
    try:
        return int(s)
    except (ValueError, TypeError):
        return None


def _sign(n):
    return (n > 0) - (n < 0)


class ThePythonPrimitivesAreReproduced(unittest.TestCase):
    """Each borrowed primitive against Python's own builtin, over a CORPUS.

    The behavioural corpus above can only exercise the numbers a seeded transcript
    happens to produce, and that is not the same property. TWO `pyFixed` defects reached
    a fully green behavioural suite before this class existed — the first because a
    written proof that `.1f` could not tie was false, the second because the fix scaled
    by ten and manufactured a tie the real value never had. Both are one line in the
    table below.
    """

    maxDiff = None

    #: (export, [args], python answer)
    def _corpus(self):
        cases = []

        def add(fn, args, want):
            cases.append((fn, list(args), want))

        # --- f"{x:.Nf}" — exact ties, near-ties, and the two that got through ---------
        for x in (0.0, 0.5, 1.5, 2.5, 3.5, 4.5, -0.5, -1.5, -2.5, 0.4999999999,
                  0.5000000001, 30 / 60, 90 / 60, 150 / 60, 210 / 60, 0.0166666,
                  99999.5, 100000.5, -0.4):
            add("pyFixed", [x, 0], f"{x:.0f}")
        for x in (6.25, 6.75, 0.25, 0.75, 1.25, 12.5, 2.55, 5100 * 100 / 200000,
                  0.05, 0.15, 0.35, 33.333333333, 66.66666666, 99.95, 99.99,
                  100.0, 0.0, 5000.0, 0.049999, 1e-9, 37.9, 55.2, 6.2499999999,
                  6.2500000001, -6.25, 4 * 100 / 64, 1 * 100 / 8, 3 * 100 / 8):
            add("pyFixed", [x, 1], f"{x:.1f}")

        # --- round(), and the estimate built on it ------------------------------------
        for x in (0.5, 1.5, 2.5, -0.5, -1.5, 0.0, 2.4999, 2.5001, 1e15 + 0.5):
            add("pyRound", [x], round(x))
        for c in range(0, 33):
            add("estTokens", [c], round(c / 4.0))

        # --- f"{round(n):,}" -----------------------------------------------------------
        for n in (0, 1, 999, 1000, 1234, 1000000, 1234567, 2500000, 999999999,
                  -1234, -1000, 0.5, 1.5, 1234.5, 1000.4):
            add("fmt", [n], f"{round(n):,}")

        # --- the percentage and the bar ------------------------------------------------
        for part, whole in ((0, 0), (5, 0), (1, 20), (1, 3), (2, 3), (4, 64), (5100, 200000),
                            (1, 8), (3, 8), (5, 8), (7, 8), (500, 10), (1, 1), (0, 100),
                            (1, 7), (99, 100), (1, 200000)):
            add("pct", [part, whole], f"{100 * part / whole:.1f}%" if whole else "–")
            add("bar", [part, whole], _py_bar(part, whole))

        # --- len() in code points --------------------------------------------------------
        for s in ("", "abc", "é", "éé", "世界", "\U0001f600", "\U0001f600" * 8,
                  "a\U0001f600b", "é", " ", "tab\there"):
            add("pyLen", [s], len(s))

        # --- json.dumps (INTEGRAL FLOATS EXCLUDED — the declared residual, and the JSON
        #     transport of this very corpus cannot carry them either) ---------------------
        for v in ({}, [], {"a": 1}, {"a": 1, "b": [1, 2]}, [1, 2, 3], "x", None, True,
                  False, 0, -5, 1.5, -0.25, {"é": "ü"}, {"k": "a\nb\tc"}, {"k": ""},
                  {"k": "\U0001f600"}, [{"a": [1, {"b": None}]}], {"a": "with, comma"},
                  {"a": "with: colon"}, {"": ""}, {"a": 1e-7}, {"a": -1e-7},
                  {"a": 1.7976931348623157e308}):
            add("jsonDumps", [v], json.dumps(v))

        # --- repr() and str() ------------------------------------------------------------
        for v in ("", "abc", "it's", 'say "hi"', "both ' and \"", "a\nb", "a\\b", "a\tb",
                  "", "é", "\U0001f600", None, True, False, 0, -5, 1.5,
                  [1, "a", None, True], {"a": 1, "b": "x"}, [[1, [2, [3]]]],
                  {"a": [None, False]}):
            add("pyRepr", [v], repr(v))
            add("pyStrOfJson", [v], str(v))

        # --- int() -------------------------------------------------------------------------
        for s in ("0", "12", "+5", "-5", " 42 ", "1_000", " 1_000 ", "_1", "1_", "1__0",
                  "", "abc", "0x10", "1 2", "١٢", "12.0", "  ", "-0", "007",
                  "9007199254740991"):
            add("pyInt", [s], _py_int(s))

        # --- str.splitlines() ----------------------------------------------------------------
        for s in ("", "a", "a\n", "a\nb", "a\r\nb", "a\rb", "a\n\nb", "a\vb", "a\fb",
                  "a\x1cb", "a\x1db", "a\x1eb", "a\x85b", "a b", "a b",
                  "a\nb\n", "\n", "\n\n"):
            add("pySplitLines", [s], s.splitlines())

        # --- sorted() comparators: only the SIGN is defined -----------------------------------
        for a, b in (("a", "b"), ("b", "a"), ("a", "a"), ("a", "ab"), ("ab", "a"),
                     ("A", "a"), ("\U0001f600", "￿"), ("é", "z")):
            add("pyStrCmp", [a, b], _sign((a > b) - (a < b)))
        for a, b in (("a b.json", "a/b.json"), ("a/b.json", "a b.json"),
                     ("x/y", "x/y"), ("x", "x/y"), ("a/z", "b")):
            want = _sign((PurePath(a).parts > PurePath(b).parts)
                         - (PurePath(a).parts < PurePath(b).parts))
            add("comparePaths", [a, b], want)
        return cases

    def test_every_primitive_matches_python(self):
        cases = self._corpus()
        tmp = Path(tempfile.mkdtemp(prefix="tokrep-prim-"))
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        payload = tmp / "corpus.json"
        payload.write_text(json.dumps([[fn, args] for fn, args, _ in cases]),
                           encoding="utf-8", newline="")
        p = subprocess.run([_node(), str(PROBE), str(payload)],
                           capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(p.returncode, 0, f"probe failed: {p.stderr}")
        got = json.loads(p.stdout)
        self.assertEqual(len(got), len(cases), "the probe dropped cases")

        bad = []
        for (fn, args, want), have in zip(cases, got):
            if fn in ("pyStrCmp", "comparePaths"):
                have = _sign(have)
            if have != want:
                bad.append(f"{fn}({', '.join(map(repr, args))}) -> {have!r}, python {want!r}")
        self.assertEqual(bad, [], "primitives disagree with Python:\n  "
                                  + "\n  ".join(bad))

    def test_the_known_limits_are_still_exactly_these_two(self):
        """The inputs deliberately kept OUT of the corpus above, asserted to still DIFFER.

        Excluding a case and hiding it are the same act unless the exclusion is written
        down and checked. Both of these are consequences of the int/float distinction
        that `JSON.parse` and a JS double cannot carry, and neither is fixable without
        machinery far larger than the character count it would move.
        """
        cases = [
            # `json.loads` keeps 1e20 a float, so `json.dumps` writes `1e+20`;
            # `JSON.parse` yields a double indistinguishable from the integer.
            ("jsonDumps", [{"a": 1e20}], json.dumps({"a": 1e20})),
            # `int()` is arbitrary precision; `pyInt` ends in `Number()`, exactly as
            # `js/lib/pyfs.mjs`'s does — this is the SHARED ceiling, not a new one.
            ("pyInt", ["99999999999999999999"], _py_int("99999999999999999999")),
        ]
        tmp = Path(tempfile.mkdtemp(prefix="tokrep-lim-"))
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        payload = tmp / "corpus.json"
        payload.write_text(json.dumps([[fn, args] for fn, args, _ in cases]),
                           encoding="utf-8", newline="")
        p = subprocess.run([_node(), str(PROBE), str(payload)],
                           capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(p.returncode, 0, p.stderr)
        for (fn, args, want), have in zip(cases, json.loads(p.stdout)):
            self.assertNotEqual(
                have, want,
                f"{fn}{args} now AGREES with Python — a declared limit has been closed. "
                "Move the case into the corpus above and delete this row.")

    def test_the_corpus_reaches_every_exported_primitive(self):
        """A table of cases nobody adds to is a table that stops covering the file."""
        covered = {fn for fn, _, _ in self._corpus()}
        self.assertGreaterEqual(len(self._corpus()), 250,
                                "the primitive corpus has shrunk")
        for required in ("pyFixed", "pyRound", "fmt", "pct", "bar", "estTokens", "pyLen",
                         "jsonDumps", "pyRepr", "pyStrOfJson", "pyInt", "pySplitLines",
                         "pyStrCmp", "comparePaths"):
            self.assertIn(required, covered, f"{required} is exported but never driven")


class TheCorpusItselfIsSound(unittest.TestCase):
    """Guards against the corpus quietly becoming a list of cells that run nothing."""

    def test_both_implementations_exist(self):
        self.assertTrue(REFERENCE.is_file(), "the ORACLE is gone — this whole file is "
                                             "vacuous without it, and after P4 there is "
                                             "no way to write it again")
        self.assertTrue(PORT.is_file())

    def test_every_host_and_every_trap_is_covered(self):
        names = " | ".join(c["name"] for c in CELLS)
        for host in ("claude:", "bob:", "opencode:", "copilot:", "detect:", "argparse:"):
            self.assertIn(host, names, f"no cell covers {host}")
        self.assertGreaterEqual(sum("TRAP" in c["name"] for c in CELLS), 8,
                                "the arithmetic traps are what a naive port fails; "
                                "they are not decoration")
        self.assertEqual(len(names.split(" | ")), len({c["name"] for c in CELLS}),
                         "two cells share a name — one of them is shadowed")


if __name__ == "__main__":
    unittest.main()
