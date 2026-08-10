"""The Node host-config wiring layer produces the same bytes, returns and streams.

`js/settings.mjs` ports `_build_settings.py` — the JSONC reader, the `opencode.json` and
`settings.json` merges, the hook shim, the managed-block machinery and the integrity
check. Nothing imports it yet: P3a proves the unit, P3b flips the call sites.

WHY THIS UNIT NEEDED ITS OWN GATE, beyond "everything does":

  * **It edits the USER's files, and no byte-comparison gate has ever driven it outside
    emit time.** The five runtime verbs (remerge, deactivate, reactivate, uninstall,
    exclude) reach it through `rituals/_harness_mcp.py`, and nothing in this repo compares
    two runtimes across any of them. The states they hit — a settings.json carrying the
    user's own hooks, a commented JSONC, a prior claim set that is no longer canonical, a
    settings file that is not valid JSON, the migration branch where the recorded
    `settings_file` is not the one this scope writes — had never existed on either side of
    a comparison, in this repo or in golden.
  * **The stdout rule binds hardest here.** These functions write the hooks whose verdict
    channel IS stdout: git-gate and rule-gate return 0 on EVERY path and signal via a JSON
    object, so a stray byte does not make noise, it silently disables a gate. Both streams
    are compared for every cell, and the asymmetry between them
    (`_warn_commented_jsonc` prints to STDOUT, everything else to stderr) is the Python's
    own and is reproduced, not tidied.
  * **`GENESEED_HOOK_SNIFF` has to match two shapes.** The legacy interpreter+checkout form
    and the shim form are both in the wild; dropping either strands live hooks in every
    config emitted before the change. `integrity/legacy-orphan` is the cell.

WHAT THE GATE DOES ABOUT THE SHIM, stated rather than skipped. `_hook_shim_body` is the one
function here whose Python output is legitimately runtime-DEPENDENT: it bakes
`sys.executable` and `<checkout>/rituals/harness.py`, and a Node twin at GA bakes
`process.execPath` and a different entry point. Golden refuses to compare the emitted shim
for exactly that reason (`_SHIM_GLOB`) and asserts `_shim_health` instead. Here the two
volatile values are ARGUMENTS to the Node twin, and the gate feeds it the two Python
computed — which makes every byte comparable: the `@echo off`, the CRLF, `exit /b` vs
`exec`, the quoting that keeps `--root "<cfg>"` intact, the unchanged-content fast path,
the pid-suffixed temp name and the chmod. Both PLATFORM branches are compared in one run
too, since `_hook_shim_body` reads `sys.platform` at call time and the Node twin takes it
as a parameter — otherwise the `sh` form would be unreachable on this machine. What is NOT
proven is which values a Node driver will pass; that is one line at P3b's call site, not
anything in this body.

WHAT IS HELD FIXED. Every cell seeds identical files into two sibling dirs and runs the
same scripted sequence against each runtime. Paths are normalised (each side's own dir
becomes `<CELL>`), because the two sides must differ there and nowhere else.

Known weak spot: with no `node` on PATH this class SKIPS and a skipped suite still reports
OK. CI must have Node.

Run from the Geneseed root:  python -m unittest discover -s tests
"""
import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import build  # noqa: E402
import _build_core  # noqa: E402

NODE = shutil.which("node")
_NO_WINDOW = {"creationflags": subprocess.CREATE_NO_WINDOW} if sys.platform == "win32" else {}

RUNNER = sys.executable
ENTRY = str(_build_core.ROOT / "rituals" / "harness.py")
MOVED_ROOT = Path(str(_build_core.ROOT) + "-moved")
ENTRY_MOVED = str(MOVED_ROOT / "rituals" / "harness.py")

# JSONC shapes. The `//` inside a string is the one that matters most in production — the
# OpenCode `$schema` value carries one, and a scanner that is not string-aware truncates
# the user's whole config at it and reports `had_comments` for a file with none.
JSONC_CORPUS = [
    '{"a": 1}',
    '{}',
    '',
    '   ',
    '// leading\n{"a": 1}',
    '{"a": 1} // trailing',
    '{/* block */ "a": 1}',
    '{"a": 1, /* multi\nline */ "b": 2}',
    '{"$schema": "https://opencode.ai/config.json"}',
    '{"note": "it\'s a // not-comment"}',
    '{"note": "escaped \\" then // still a string"}',
    '{"a": [1, 2, 3,], }',
    '{"a": [1, 2, 3,],\n  }',
    '{"nested": {"b": [ {"c": 1,}, ],}}',
    '{"a": 1,,}',
    '{ not json at all',
    '[1, 2, 3]',
    '"just a string"',
    'null',
    '{"float": 1.0, "int": 20, "exp": 1e3}',
    '{"unicode": "a \u2014 b", "emoji": "\U0001F600"}',
    '{"2": "numeric key", "b": 1}',
    '{"a": 1 /* unterminated',
    '{"a": "trailing backslash in string \\\\"}',
]

# A hook group in the shape `_merge_claude_settings` records, but naming an interpreter and
# checkout this machine does not have: a prior claim that is NO LONGER CANONICAL. The prune
# exists for exactly this — without it a re-emit stacks the new group beside the stale one
# and `learn` runs twice per Stop, the second time against a dead python path.
STALE_PRIOR = {
    "event": "Stop",
    "group": {"hooks": [{"type": "command",
                         "command": '"C:\\old\\python.exe" "C:\\old\\rituals\\harness.py" '
                                    'learn --memory "C:\\old\\memory" || exit 0'}]},
}
# The user's own hooks, in the same file. Nothing may touch these.
USER_HOOKS = {
    "hooks": {
        "Stop": [{"hooks": [{"type": "command", "command": "echo mine"}]}],
        "PreToolUse": [{"matcher": "Bash",
                        "hooks": [{"type": "command", "command": "my-own-linter"}]}],
    },
    "model": "opus",
    "theme": "dark",
}


def _settings_with(*groups, **extra):
    """A settings.json holding `groups` (recorded as event -> [group]) plus other keys."""
    hooks = {}
    for rec in groups:
        hooks.setdefault(rec["event"], []).append(rec["group"])
    data = {"hooks": hooks} if hooks else {}
    data.update(extra)
    return json.dumps(data, indent=2) + "\n"


# ---- P10d: the three shapes in the wild, shaped from configs actually on disk ----------
# Every one of these was read off a real machine and rewritten with neutral paths, rather
# than produced by calling the emitter. P6c's lesson — a machine-written fixture hides the
# hand-written case — applies hardest here, because the emitter cannot produce shape 1 at all
# (nothing has written it since P0) and cannot produce a third party's hook by construction.
_LEGACY_CMD = '"C:/Python313/python.exe" "C:/src/Geneseed/rituals/harness.py" git-gate'
_SHIM_CMD = '"C:/Users/x/.geneseed/bin/geneseed-hook.cmd" git-gate --root "C:/Users/x/.claude"'
_SHIM_BODY_PY = (
    "@echo off\r\n"
    "rem Generated by Geneseed - do not edit. Rewritten on every emit.\r\n"
    "setlocal\r\n"
    '"C:\\Python313\\python.exe" "C:\\src\\Geneseed\\rituals\\harness.py" %*\r\n'
    "exit /b\r\n"
)
_SHIM_BODY_NODE = (
    "@echo off\r\n"
    "rem Generated by Geneseed - do not edit. Rewritten on every emit.\r\n"
    "setlocal\r\n"
    '"C:\\Program Files\\nodejs\\node.exe" "C:\\src\\Geneseed\\bin\\geneseed-hook.mjs" %*\r\n'
    "exit /b\r\n"
)
_STARTUP_VBS = (
    "' geneseed-web.vbs - start the Geneseed web daemon at login (hidden, no browser).\r\n"
    'CreateObject("Wscript.Shell").Run '
    '"""C:\\src\\Geneseed\\geneseed.cmd"" web --no-browser", 0, False\r\n'
)
_LAUNCH_AGENT_PLIST = """<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>Label</key><string>dev.geneseed.web</string>
  <key>ProgramArguments</key>
  <array><string>/Users/someone/.local/bin/geneseed</string><string>web</string></array>
</dict></plist>
"""


def cells() -> list:
    """The matrix. Every cell names a state that had no comparison before this phase."""
    legacy_group = {"matcher": "Bash", "hooks": [{"type": "command",
                    "command": '"py" "/somewhere/rituals/harness.py" git-gate'}]}
    shim_group = {"hooks": [{"type": "command",
                             "command": '"/home/.geneseed/bin/geneseed-hook" learn'}]}
    return [
        {"name": "jsonc/corpus", "kind": "jsonc", "corpus": JSONC_CORPUS},

        # P10d. `_migrate_shape` over the three shapes actually in the wild, plus the two a
        # real machine carries that none of them is: a config whose only hooks are somebody
        # else's, and one with no hooks at all.
        #
        # ROWS 2 AND 3 ARE THE POINT. Their COMMAND LISTS ARE IDENTICAL and only the shim
        # body differs, which is the whole argument for the body being an input: a classifier
        # reading the settings file alone would answer `current` for both and `migrate` would
        # no-op on exactly the machines it exists for. No cell can reach this — the snapshot
        # excludes every `geneseed-hook*` file because its body differs between the two
        # implementations by design.
        {"name": "migrate/shapes", "kind": "migrate",
         "corpus": [
             # 1. pre-shim direct: the command names the checkout's harness.py.
             ([_LEGACY_CMD], ""),
             # 2. shim + a PYTHON body — the literal artefact found on a real machine.
             ([_SHIM_CMD], _SHIM_BODY_PY),
             # 3. shim + a NODE body: the same command, the migrated answer.
             ([_SHIM_CMD], _SHIM_BODY_NODE),
             # A third party's hook and a hand-written multi-command shell hook, both from a
             # real settings.json. Neither is Geneseed's; classifying either as `legacy`
             # would make `migrate` re-emit a machine that has no Geneseed install at all.
             (["rtk hook claude"], _SHIM_BODY_PY),
             (['[ -n "$GUARD" ] && exit 0; [ -f Codex.md ] && exit 0; cd "/vault"'], ""),
             # No hooks whatsoever — an OpenCode-only or Copilot-only machine.
             ([], _SHIM_BODY_NODE),
             # Legacy WINS over current when both are present: a half-rewired file must not
             # read as done. `harness.py` is checked before the shim marker for this reason.
             ([_SHIM_CMD, _LEGACY_CMD], _SHIM_BODY_NODE),
             # An unreadable/empty shim with a shim-form command: the body cannot prove the
             # runner, so the honest answer is `legacy` (re-emit repairs it) rather than a
             # `current` that would strand the machine forever.
             ([_SHIM_CMD], ""),
         ],
         # `_autostart_stale` — every input is one a fixture must invent, because nothing in
         # this repository has ever written an autostart entry. Strict in one direction (it
         # clears only when the CURRENT root appears verbatim) and weak in the other (it
         # never fires on a file that does not mention geneseed at all).
         "autostart": [
             [_STARTUP_VBS, "C:\\now\\Geneseed"],        # names another checkout -> stale
             [_STARTUP_VBS, "C:\\src\\Geneseed"],        # names THIS root -> not stale
             # The forward-slash spelling of the same root, which is how every tool run from
             # Git Bash writes one. Both must clear, or a migration nags forever.
             ["run C:/src/Geneseed/geneseed.cmd web", "C:\\src\\Geneseed"],
             ["notepad.exe", "C:\\now\\Geneseed"],       # not ours -> never named
             [_LAUNCH_AGENT_PLIST, "/opt/geneseed"],     # the macOS arm, gated from Windows
         ]},

        {"name": "shim/writes", "kind": "shim", "platforms": ["win32", "linux", "darwin"]},
        # The shim cannot be written: GENESEED_HOME resolves THROUGH a regular file, so the
        # mkdir raises and `_hook_prefix` falls back to the pre-shim direct form. Emitting
        # hooks that name a shim which does not exist would fail on every hook (9009 under
        # cmd.exe, 127 under sh) and take both gates down at once.
        {"name": "shim/unwritable", "kind": "shim", "platforms": ["win32"],
         "files": {"blocker": "not a directory\n"}, "home_under": "blocker/home"},

        {"name": "opencode/absent", "kind": "opencode-wire"},
        {"name": "opencode/already-wired", "kind": "opencode-wire",
         "files": {"opencode.json": json.dumps(
             {"$schema": "https://opencode.ai/config.json",
              "instructions": ["AGENT.md"], "permission": {"bash": {}}, "lsp": False},
             indent=2)}},
        {"name": "opencode/user-keys-kept", "kind": "opencode-wire",
         "files": {"opencode.json": json.dumps(
             {"theme": "mine", "instructions": ["other.md"], "model": "x/y"}, indent=2)}},
        # A float and a numeric key in a file we WRITE BACK. `1.0` must not become `1`.
        {"name": "opencode/float-round-trip", "kind": "opencode-wire",
         "files": {"opencode.json": '{"instructions": [], "temperature": 1.0, '
                                    '"steps": 20, "small": 0.5}'}},
        {"name": "opencode/jsonc-commented", "kind": "opencode-wire",
         "files": {"opencode.jsonc": '// mine\n{"instructions": ["a.md"],}\n'}},
        {"name": "opencode/jsonc-clean", "kind": "opencode-wire",
         "files": {"opencode.jsonc": '{"instructions": ["a.md"]}\n'}},
        {"name": "opencode/malformed", "kind": "opencode-wire",
         "files": {"opencode.json": "{ not json"}},
        {"name": "opencode/not-an-object", "kind": "opencode-wire",
         "files": {"opencode.json": "[1, 2, 3]"}},
        {"name": "opencode/instructions-not-a-list", "kind": "opencode-wire",
         "files": {"opencode.json": '{"instructions": "AGENT.md"}'}},

        {"name": "claude/fresh", "kind": "claude-emit"},
        # Re-emit with the manifest's own claims: nothing added, nothing pruned, the file
        # left untouched. The idempotence the runtime's `remerge` depends on.
        {"name": "claude/re-emit", "kind": "claude-emit", "prior": "canonical"},
        # The prior claim set is no longer canonical. Seeded INTO the file, so the prune
        # has something to remove rather than a record with no counterpart.
        {"name": "claude/stale-prior", "kind": "claude-emit",
         "priorHooks": [STALE_PRIOR],
         "files": {"settings.json": _settings_with(STALE_PRIOR, model="opus")}},
        {"name": "claude/user-hooks-survive", "kind": "claude-emit",
         "files": {"settings.json": json.dumps(USER_HOOKS, indent=2) + "\n"}},
        {"name": "claude/commented-settings", "kind": "claude-emit",
         "files": {"settings.json": '// mine\n{"model": "opus"}\n'}},
        {"name": "claude/invalid-json", "kind": "claude-emit",
         "files": {"settings.json": "{ not json at all"}},
        # The migration branch: an older install recorded settings.json, this scope writes
        # settings.local.json. The claims in the OLD file have to be unwired there or they
        # linger and keep firing forever.
        {"name": "claude/migration", "kind": "claude-emit", "scope": "project",
         "settingsName": "settings.local.json", "oldSf": "settings.json",
         "priorHooks": [STALE_PRIOR], "priorExcludes": ["/old/CLAUDE.md"],
         "files": {"settings.json": _settings_with(
             STALE_PRIOR, claudeMdExcludes=["/old/CLAUDE.md", "/mine/CLAUDE.md"])}},
        {"name": "claude/excludes", "kind": "claude-emit", "scope": "project",
         "wantExcludes": ["/repo/CLAUDE.md"]},
        {"name": "claude/excludes-already-there", "kind": "claude-emit", "scope": "project",
         "wantExcludes": ["/repo/CLAUDE.md"],
         "files": {"settings.json": json.dumps(
             {"claudeMdExcludes": ["/repo/CLAUDE.md"]}, indent=2)}},
        # TWO excludes into a COMMENTED file: the wire refuses to rewrite it and prints the
        # entries instead. Two, not one, because the printed array is the only place a
        # compact multi-element container is rendered here — with a single entry, Python's
        # `', '` separator and JSON.stringify's `,` produce identical bytes.
        {"name": "claude/excludes-commented", "kind": "claude-emit", "scope": "project",
         "wantExcludes": ["/repo/CLAUDE.md", "/repo/two/CLAUDE.md"],
         "files": {"settings.json": '// mine\n{"model": "opus"}\n'}},
        {"name": "claude/excludes-stack-global", "kind": "claude-emit", "scope": "project",
         "wantExcludes": ["/repo/CLAUDE.md"], "stackGlobal": True,
         "files": {"settings.json": json.dumps(
             {"claudeMdExcludes": ["/repo/CLAUDE.md", "/mine/CLAUDE.md"]}, indent=2)}},

        {"name": "teardown/clean", "kind": "teardown", "prior": "canonical",
         "priorExcludes": ["/repo/CLAUDE.md"],
         "files": {"CLAUDE.md": "user prose\n\n<!-- BEGIN GENESEED -->\nblock\n"
                                "<!-- END GENESEED -->\n"}},
        # A commented settings.json: the unwire BAILS silently, which is exactly how hooks
        # linger after an uninstall — and the integrity check is the only thing that says so.
        {"name": "teardown/commented-bails", "kind": "teardown", "prior": "canonical",
         "commented": True},
        {"name": "teardown/absent", "kind": "teardown", "prior": "canonical"},

        {"name": "managed/created", "kind": "managed-block", "contents": ["one"]},
        {"name": "managed/updated", "kind": "managed-block", "contents": ["one", "two"]},
        {"name": "managed/merged", "kind": "managed-block", "contents": ["one"],
         "files": {"CLAUDE.md": "the user's own prose, no trailing newline"}},
        {"name": "managed/merged-trailing-nl", "kind": "managed-block", "contents": ["one"],
         "files": {"CLAUDE.md": "the user's own prose\n"}},
        # rstrip()/strip() are not trim(), and the difference is on both sides of the set.
        # The content's LEADING spaces must survive the read (`strip("\n")` keeps them,
        # `trim()` eats them), and the U+FEFF the user's editor put at the top of their
        # CLAUDE.md must survive the excision (`trim()` eats it, Python's `strip()` does
        # not). Both mutations stayed green while this cell was only trailing blank lines.
        {"name": "managed/whitespace", "kind": "managed-block",
         "contents": ["  indented and padded  \n\n  \n"],
         "files": {"CLAUDE.md": "﻿before\n\n\n<!-- BEGIN GENESEED -->\nold\n"
                                "<!-- END GENESEED -->\n\n\nafter\n"}},
        {"name": "managed/custom-id", "kind": "managed-block", "contents": ["x"],
         "blockId": "OTHER"},
        {"name": "managed/whole", "kind": "managed-block", "contents": ["x"], "whole": True},
        # Excising the only content deletes the file rather than leaving an empty one.
        {"name": "managed/empties-the-file", "kind": "managed-block", "contents": ["x"],
         "files": {"CLAUDE.md": "<!-- BEGIN GENESEED -->\nold\n<!-- END GENESEED -->\n"}},

        # The orphan scan, both sniff shapes. `harness.py` is the LEGACY direct form every
        # install emitted before the shim; `geneseed-hook` is the shim's filename. A sniff
        # that lost either entry stops seeing half the installs in the wild.
        {"name": "integrity/legacy-orphan", "kind": "integrity",
         "files": {"settings.json": _settings_with(
             {"event": "PreToolUse", "group": legacy_group})},
         "managed": {"settings_hooks": []}},
        {"name": "integrity/shim-orphan", "kind": "integrity",
         "files": {"settings.json": _settings_with({"event": "Stop", "group": shim_group})},
         "managed": {"settings_hooks": []}},
        {"name": "integrity/recorded-is-not-an-orphan", "kind": "integrity",
         "files": {"settings.json": _settings_with({"event": "Stop", "group": shim_group})},
         "managed": {"settings_hooks": [{"event": "Stop", "group": shim_group}]}},
        # The orphan scan keys on `json.dumps(group, sort_keys=True)` where the check above
        # it uses plain equality, and the difference is only observable when the recorded
        # group and the file's spell the same group in a DIFFERENT key order. Every other
        # cell writes both from one literal, which makes the sort unreachable — so without
        # this cell a port that dropped `sort_keys` would report the install's own hook as
        # an unrecorded orphan on every check, and nothing would say so.
        {"name": "integrity/recorded-key-order", "kind": "integrity",
         "files": {"settings.json": _settings_with(
             {"event": "Stop", "group": {"matcher": "x", "hooks": [
                 {"type": "command",
                  "command": '"/home/.geneseed/bin/geneseed-hook" learn'}]}})},
         "managed": {"settings_hooks": [{"event": "Stop", "group": {
             "hooks": [{"command": '"/home/.geneseed/bin/geneseed-hook" learn',
                        "type": "command"}], "matcher": "x"}}]}},
        {"name": "integrity/missing-group", "kind": "integrity",
         "files": {"settings.json": '{"model": "opus"}'},
         "managed": {"settings_hooks": [{"event": "Stop", "group": shim_group}],
                     "settings_excludes": ["/repo/CLAUDE.md"]}},
        {"name": "integrity/absent-file", "kind": "integrity",
         "managed": {"settings_hooks": [{"event": "Stop", "group": shim_group}]}},
        {"name": "integrity/not-an-object", "kind": "integrity",
         "files": {"settings.json": "[1, 2]"},
         "managed": {"settings_hooks": []}},
        {"name": "integrity/unparseable", "kind": "integrity",
         "files": {"settings.json": "{ nope"}, "managed": {"settings_hooks": []}},
        # A COMMENTED file is still checked — the one state emit and unwire refuse to touch
        # is the one that must not escape verification.
        {"name": "integrity/commented-is-still-checked", "kind": "integrity",
         "files": {"settings.json": "// mine\n"
                                    + _settings_with({"event": "Stop", "group": shim_group})},
         "managed": {"settings_hooks": [{"event": "Stop", "group": shim_group}]}},
        {"name": "integrity/managed-is-not-a-dict", "kind": "integrity",
         "files": {"settings.json": '{"model": "opus"}'}, "managed": ["not", "a", "dict"]},
    ]


# ---- the Python side of each scenario, in the order a real caller runs it -------------

def _py_jsonc(cell, d):
    out = []
    for text in cell["corpus"]:
        data, had = build._read_jsonc(text)
        out.append({"data": json.dumps(data, indent=2), "hadComments": had})
    return out


def _py_shim(cell, d):
    bodies = []
    for plat in cell["platforms"]:
        with mock.patch.object(sys, "platform", plat):
            bodies.append(build._hook_shim_body())
    out = {"bodies": bodies, "home": str(build._shim_home()),
           "shimPath": str(build._hook_shim_path())}
    first = build._write_hook_shim()
    again = build._write_hook_shim()
    with mock.patch.object(_build_core, "ROOT", MOVED_ROOT):
        changed = build._write_hook_shim()
    out["first"] = None if first is None else str(first)
    out["again"] = None if again is None else str(again)
    out["changed"] = None if changed is None else str(changed)
    out["prefix"] = build._hook_prefix()
    return out


def _py_opencode_wire(cell, d):
    # Resolved directly as well as through the merge: `_opencode_target` has EIGHT runtime
    # call sites in `rituals/_harness_mcp.py`, more than any other name in the unit, and
    # the merge only ever shows its answer indirectly.
    picked = build._opencode_target(d / "opencode.json").name
    target = build._merge_opencode_json(d / "opencode.json", cell.get("agentPath", "AGENT.md"))
    return {"picked": picked, "target": target.name}


def _py_claude_emit(cell, d):
    managed = {}
    prior_hooks = cell.get("priorHooks") or []
    prior_excl = cell.get("priorExcludes") or []
    settings_name = cell.get("settingsName", "settings.json")
    old_sf = cell.get("oldSf", settings_name)
    if old_sf != settings_name:
        build._unwire_claude_settings(d / old_sf, prior_hooks)
        build._unwire_claude_excludes(d / old_sf, prior_excl)
    settings_path = d / settings_name
    managed["settings_file"] = settings_name
    _t, managed_hooks = build._merge_claude_settings(
        settings_path, cell.get("scope", "global"),
        prior_hooks=(prior_hooks if old_sf == settings_name else None))
    managed["settings_hooks"] = managed_hooks
    added = []
    want = cell.get("wantExcludes") or []
    if want:
        if cell.get("stackGlobal"):
            build._unwire_claude_excludes(settings_path, want)
            managed["settings_excludes"] = []
        else:
            added = build._wire_claude_excludes(settings_path, want)
            managed["settings_excludes"] = sorted(set(prior_excl) | set(added))
    elif prior_excl:
        managed["settings_excludes"] = prior_excl
    problems = build._settings_integrity_check(settings_path, managed, expect="present")
    return {"managed": json.dumps(managed, indent=2), "added": added, "problems": problems}


def _py_teardown(cell, d):
    settings_name = cell.get("settingsName", "settings.json")
    settings_path = d / settings_name
    unwired = build._unwire_claude_settings(settings_path, cell.get("priorHooks") or [])
    build._unwire_claude_excludes(settings_path, cell.get("priorExcludes") or [])
    stashed = build._managed_block_read(d / "CLAUDE.md")
    build._managed_block_remove(d / "CLAUDE.md", "GENESEED", bool(cell.get("whole")))
    managed = {"settings_hooks": cell.get("priorHooks") or [],
               "settings_excludes": cell.get("priorExcludes") or []}
    problems = build._settings_integrity_check(settings_path, managed, expect="absent")
    return {"unwired": unwired, "stashed": stashed, "problems": problems}


def _py_managed_block(cell, d):
    p = d / "CLAUDE.md"
    block_id = cell.get("blockId", "GENESEED")
    statuses = [build._managed_block_write(p, c, block_id) for c in cell["contents"]]
    read = build._managed_block_read(p, block_id)
    missing = build._managed_block_read(p, "NOT-A-BLOCK")
    build._managed_block_remove(p, block_id, bool(cell.get("whole")))
    return {"statuses": statuses, "read": read, "missing": missing}


def _py_integrity(cell, d):
    p = d / cell.get("settingsName", "settings.json")
    return {
        "present": build._settings_integrity_check(p, cell["managed"], expect="present"),
        "absent": build._settings_integrity_check(p, cell["managed"], expect="absent"),
    }


def _py_migrate(cell, d):
    return {
        "shapes": [build._migrate_shape(cmds, body) for cmds, body in cell["corpus"]],
        "autostart": [build._autostart_stale(text, Path(root))
                      for text, root in cell["autostart"]],
        # Relative to home — the absolute answer embeds this machine's own home directory and
        # the two sides would differ on nothing that matters. The pair of RELATIVE locations
        # is what the function decides, and comparing them states that both platforms' paths
        # come back on one platform: how the macOS arm is reachable from Windows at all.
        "paths": [Path(p).relative_to(Path.home()).as_posix()
                  for p in build._autostart_paths()],
    }


_PY = {"jsonc": _py_jsonc, "shim": _py_shim, "opencode-wire": _py_opencode_wire,
       "claude-emit": _py_claude_emit, "teardown": _py_teardown,
       "managed-block": _py_managed_block, "integrity": _py_integrity,
       "migrate": _py_migrate}


def _norm(text: str, root: Path) -> str:
    """Blank the cell's own dir so the two sides compare equal everywhere else.

    Four spellings, and the fourth is not paranoia: the streams carry the native form, a
    result travels as JSON (one level of backslash escaping), and a result that is ITSELF a
    JSON document — `managed`, dumped so its key order is compared too — arrives
    double-escaped. Blanking only the first three leaves the shim path in `managed`
    unnormalised, which fails eight cells for the one reason the two sides must differ."""
    s = str(root)
    for spelling in (s, s.replace("\\", "/"), s.replace("\\", "\\\\"),
                     s.replace("\\", "\\\\\\\\")):
        text = text.replace(spelling, "<CELL>")
    return text


def _tree(d: Path) -> dict:
    return {p.relative_to(d).as_posix(): p for p in d.rglob("*") if p.is_file()}


def _read(p: Path, root: Path) -> bytes:
    """One file's bytes with the cell's own dir blanked, in every spelling it can appear
    in: native separators for prose, forward slashes, and the JSON-escaped form the
    settings writes carry."""
    data = p.read_bytes()
    s = str(root).encode("utf-8")
    for spelling in (s, s.replace(b"\\", b"/"), s.replace(b"\\", b"\\\\")):
        data = data.replace(spelling, b"<CELL>")
    return data


@unittest.skipUnless(NODE, "node is not on PATH — the settings parity gate cannot run")
class SettingsParityTests(unittest.TestCase):
    maxDiff = None

    def test_node_and_python_wire_identically(self):
        matrix = cells()
        with tempfile.TemporaryDirectory(prefix="geneseed-settings-") as tmp_s:
            tmp = Path(tmp_s)
            jobs, expected = [], []
            for i, cell in enumerate(matrix):
                py, js = tmp / f"py{i}", tmp / f"js{i}"
                # `prior: canonical` is resolved PER SIDE: the recorded hook commands name
                # the cell's own dir, so one shared literal would compare unequal by
                # construction and the re-emit cells would prove nothing.
                py_cell, js_cell = self._seed(cell, py), self._seed(cell, js)
                home = py / (cell.get("home_under") or ".geneseed")
                out, err = io.StringIO(), io.StringIO()
                with mock.patch.dict(os.environ, {"GENESEED_HOME": str(home)}, clear=False):
                    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                        result = _PY[cell["kind"]](py_cell, py)
                expected.append({
                    "result": json.loads(_norm(json.dumps(result), py)),
                    "stdout": _norm(out.getvalue(), py),
                    "stderr": _norm(err.getvalue(), py)})

                name = js_cell.get("settingsName", "settings.json")
                job = dict(js_cell)
                job.pop("files", None)
                job.update({"dir": str(js), "runner": RUNNER, "entry": ENTRY,
                            "entryMoved": ENTRY_MOVED, "settingsName": name,
                            "geneseedHome": str(js / (cell.get("home_under")
                                                      or ".geneseed")),
                            "resultFile": str(tmp / f"res{i}.json"),
                            "oldSf": js_cell.get("oldSf", name),
                            "scope": js_cell.get("scope", "global"),
                            "agentPath": js_cell.get("agentPath", "AGENT.md")})
                jobs.append(job)

            r = self._run_node(tmp, jobs)

            for i, cell in enumerate(matrix):
                with self.subTest(cell=cell["name"]):
                    py, js = tmp / f"py{i}", tmp / f"js{i}"
                    got = _norm((tmp / f"res{i}.json").read_text(encoding="utf-8"), js)
                    self.assertEqual(expected[i]["result"], json.loads(got),
                                     f"{cell['name']}: return value differs")
                    py_files, js_files = _tree(py), _tree(js)
                    self.assertEqual(sorted(py_files), sorted(js_files),
                                     f"{cell['name']}: different files written")
                    # BYTES, with only the cell's own dir blanked. Line endings are part of
                    # the comparison: the shim is written raw so its CRLF survives verbatim,
                    # while every JSON write goes through the newline-translating writer, and
                    # a port that picked the wrong one for either is a silent whole-file diff.
                    differing = [rel for rel in sorted(py_files)
                                 if _read(py_files[rel], py) != _read(js_files[rel], js)]
                    if differing:
                        self.fail(self._report(cell["name"], differing, py, js, py_files,
                                               js_files))

            self.assertEqual("".join(e["stdout"] for e in expected),
                             _norm_streams(r.stdout, tmp, len(matrix)),
                             "the stdout streams differ — this is the channel the emitted "
                             "hook gates signal their verdict on")
            self.assertEqual("".join(e["stderr"] for e in expected),
                             _norm_streams(r.stderr, tmp, len(matrix)),
                             "the stderr streams differ")

    def _seed(self, cell, side: Path) -> dict:
        """Create one side's dir, write the cell's seed files, and expand the
        `prior: canonical` shorthand into the claim set THIS checkout really records —
        which is why it is resolved per side rather than written as a literal.

        The hook groups are computed with GENESEED_HOME pointed at THIS side's dir, which
        is not a tidiness measure: the emitted commands name the shim, so computing them
        against the developer's real home makes every recorded claim non-canonical and the
        re-emit cells quietly become stale-prior cells. A mutation replacing `pyEq` with
        identity stayed green the whole time that was true, because with nothing canonical
        there was never a match to miss."""
        side.mkdir(parents=True, exist_ok=True)
        out = dict(cell)
        prior = None
        if cell.get("prior") == "canonical":
            home = side / (cell.get("home_under") or ".geneseed")
            with mock.patch.dict(os.environ, {"GENESEED_HOME": str(home)}, clear=False):
                groups = build._claude_hook_groups(side)
            prior = [{"event": e, "group": g} for e, gs in groups.items() for g in gs]
            out["priorHooks"] = prior
        for rel, text in (cell.get("files") or {}).items():
            dest = side / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(text, encoding="utf-8")
        if cell.get("commented"):
            (side / "settings.json").write_text(
                "// mine\n" + json.dumps({"hooks": {}}, indent=2), encoding="utf-8")
        elif prior is not None:
            # The file a PREVIOUS emit left, not just the manifest record of it. Written for
            # the re-emit cells as well as the teardown ones: with the file absent, `hooks`
            # starts empty, nothing the merge looks for is ever found, and the whole
            # already-present branch — the one a re-emit exists to exercise — is
            # unreachable. A mutation swapping `pyEq` for identity stayed green until this
            # line stopped checking the cell's kind.
            hooks = {}
            for rec in prior:
                hooks.setdefault(rec["event"], []).append(rec["group"])
            data = {"hooks": hooks}
            if cell.get("priorExcludes"):
                data["claudeMdExcludes"] = list(cell["priorExcludes"])
            (side / "settings.json").write_text(json.dumps(data, indent=2) + "\n",
                                                encoding="utf-8")
        out.pop("prior", None)
        out.pop("commented", None)
        return out

    def _run_node(self, tmp: Path, jobs: list):
        jobs_file = tmp / "jobs.json"
        jobs_file.write_text(json.dumps(jobs), encoding="utf-8")
        env = dict(os.environ)
        env.pop("GENESEED_HOME", None)
        r = subprocess.run([NODE, str(ROOT / "tests" / "settings_dump.mjs"), str(jobs_file)],
                           capture_output=True, text=True, encoding="utf-8",
                           cwd=ROOT, env=env, **_NO_WINDOW)
        self.assertEqual(r.returncode, 0,
                         f"node settings_dump failed:\n{r.stdout}\n{r.stderr}")
        return r

    def _report(self, name, differing, py, js, py_files, js_files):
        rel = differing[0]
        a, b = _read(py_files[rel], py), _read(js_files[rel], js)
        at = next((n for n, (x, y) in enumerate(zip(a, b)) if x != y), min(len(a), len(b)))
        return (f"{name}: {len(differing)} of {len(py_files)} file(s) differ.\n"
                f"  first: {rel} at char {at}\n"
                f"  python: {a[max(0, at - 80):at + 80]!r}\n"
                f"  node:   {b[max(0, at - 80):at + 80]!r}")


def _norm_streams(text: str, tmp: Path, n: int) -> str:
    """The Node run's streams, with each cell's own dir blanked the way the Python side's
    were. Node writes `\\r\\n` through the console on Windows; the Python side is captured
    in memory and never sees one."""
    text = text.replace("\r\n", "\n")
    # LONGEST first: `js1` is a prefix of `js14`, and blanking it first leaves a stray `4`
    # in the message — which reads as a content difference and hides the real one.
    for i in sorted(range(n), key=lambda k: -len(str(k))):
        text = _norm(text, tmp / f"js{i}")
    return text


# The one externally-consumed name this gate deliberately does not drive, and why.
#
# `_hook_runner_entry` returns the interpreter and entry point the shim bakes. It has no
# JS twin ON PURPOSE: the child cannot compute either value — its own `process.execPath` is
# node while the hooks it wires are Python — so the Node side takes them as ARGUMENTS
# (`hookShimBody(runner, entry, platform)`) and the driver sends what this function
# returns. There is nothing to compare: a parity cell would feed both sides the same two
# strings and assert they came back equal. What the values must BE is checked where it is
# observable instead — `tests/test_emit_boundary.py` compares the shim body the Node child
# actually wrote against the one Python wrote, and asserts it names the Python interpreter.
_NO_TWIN_BY_DESIGN = {"_hook_runner_entry"}


def _consumed_outside_the_unit() -> set:
    """Every `_build_settings` name that some OTHER module calls, measured with `ast`.

    TWO SPELLINGS, and the first version of this function only counted one. The runtime
    reaches these names as ATTRIBUTES (`build._read_jsonc`, `_build_emit._wire_claude_...`),
    but the emit tree reaches them as BARE NAMES, because `build.py` splices every submodule
    into one shared namespace. So an attribute-only scan measured the eleven runtime names
    and *zero* of the emit tree's eleven crossings — while the docstring claimed both. A new
    bare call added in `_build_global.py` would have shipped ungated, which is precisely the
    failure this gate exists to prevent, one module over from where it was looking.

    A bare `Name` load counts only when the module does not bind that name itself, which is
    what keeps a local variable or a same-named helper out of the count."""
    import ast
    names = set()
    tree = ast.parse((ROOT / "_build_settings.py").read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.FunctionDef):
            names.add(node.name)

    consumed = set()
    for p in list(ROOT.glob("_build_*.py")) + list((ROOT / "rituals").glob("*.py")):
        if p.name == "_build_settings.py":
            continue
        tree = ast.parse(p.read_text(encoding="utf-8"))
        bound = set()
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                bound.add(node.name)
            elif isinstance(node, (ast.Import, ast.ImportFrom)):
                for a in node.names:
                    bound.add(a.asname or a.name.split(".")[0])
            elif isinstance(node, ast.Assign):
                for target in node.targets:
                    for sub in ast.walk(target):
                        if isinstance(sub, ast.Name):
                            bound.add(sub.id)
        for node in ast.walk(tree):
            if isinstance(node, ast.Attribute) and node.attr in names:
                consumed.add(node.attr)
            elif isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load) \
                    and node.id in names and node.id not in bound:
                consumed.add(node.id)
    return consumed - _NO_TWIN_BY_DESIGN


class SettingsMatrixTests(unittest.TestCase):
    """A gate on the gate: each of these axes covers something nothing else reaches."""

    def test_every_name_with_a_consumer_outside_the_unit_is_driven(self):
        """The gate has to reach every name a caller outside `_build_settings` can hold.
        The list is not hand-maintained: it is re-derived from the emit tree and the
        runtime by `ast`, so a new call site added anywhere fails here rather than shipping
        ungated. `_hook_prefix` and `_hook_shim_body` are in it because the shim is the one
        thing a runtime-dependence argument could have excused into having no gate."""
        src = Path(__file__).read_text(encoding="utf-8")
        for name in sorted(_consumed_outside_the_unit()):
            self.assertIn(f"build.{name}(", src, f"{name} has a consumer outside "
                          "_build_settings.py but no cell in this gate drives it")

    def test_the_matrix_reaches_the_states_no_other_gate_can(self):
        names = {c["name"] for c in cells()}
        for required in ("claude/stale-prior", "claude/user-hooks-survive",
                         "claude/commented-settings", "claude/invalid-json",
                         "claude/migration", "teardown/commented-bails",
                         "integrity/legacy-orphan", "integrity/shim-orphan",
                         "opencode/jsonc-commented", "opencode/float-round-trip"):
            self.assertIn(required, names)

    def test_both_hook_sniff_shapes_are_covered(self):
        """`_GENESEED_HOOK_SNIFF` carries two markers and both must stay recognisable: the
        legacy interpreter+checkout form every pre-shim install emitted, and the shim's
        filename. A cell per marker, so dropping either fails."""
        blob = json.dumps(cells())
        for marker in build._GENESEED_HOOK_SNIFF:
            self.assertIn(marker, blob, f"no cell carries a {marker!r} hook command")

    def test_the_jsonc_corpus_keeps_its_hard_shapes(self):
        joined = "".join(JSONC_CORPUS)
        self.assertIn("https://", joined, "no `//` inside a string — the shape that "
                                          "truncates a user's whole config")
        self.assertTrue(any(c.strip() == "" for c in JSONC_CORPUS), "no empty input")
        self.assertTrue(any("/*" in c for c in JSONC_CORPUS), "no block comment")
        self.assertTrue(any(",]" in c or ",}" in c or ",\n" in c for c in JSONC_CORPUS),
                        "no trailing comma")
        self.assertTrue(any("1.0" in c for c in JSONC_CORPUS),
                        "no float — the int/float distinction has to survive a round trip "
                        "through a user's real config")


if __name__ == "__main__":
    unittest.main()
