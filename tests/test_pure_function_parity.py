#!/usr/bin/env python3
"""The pure functions no cell can reach, gated as a CORPUS.

RENAMED IN P5e, from `test_status_panel_parity` / `status_probe`. It was named for the
panel when the panel was all it held; P5d already put `pyLen`/`pyLjust` in it and P5e adds
`fenceFor` from `js/generate.mjs`, so a probe named `status_probe` importing the generator's
CLI module would be a name claiming something other than what exists — which is the class of
defect this port keeps finding. The MECHANISM is deliberately not duplicated: one corpus
gate, extended, rather than a second one per module.

WHY THIS FILE EXISTS. `tests/harness_golden.py` compares two CLIs by running them, and a
process's stdout is a pipe. `_color_enabled()` is `sys.stdout.isatty() and NO_COLOR is None
and TERM != "dumb"`, so the entire ANSI half of `_status_lines` is structurally unreachable
in every cell that can be written — deleting the escape codes would be byte-identical
across the whole matrix. The P5c handoff posed that as a choice between three bad answers:
fake a tty, ship it ungated, or drop colour from the Node CLI and regress a real terminal.

There is a fourth, and it is the shape P5c already found for `pyPathStr`: `_status_lines` is
documented PURE, so it does not need the CLI to be exercised at all. Call it directly on
both sides over a corpus of inputs and the tty question never arises. Three more functions
come along for the same ride, each unreachable from a cell for its own reason:

  * `_version_verdict`'s "up to date" branch needs a `.geneseed-version` holding the
    CURRENT source fingerprint, which changes every commit and no cell may name.
  * `_manifest_is_claude` is only consulted for a candidate with no known host, and
    `ROOT/"Harness"` is ordered ahead of the sandbox's own bundle path — and ROOT is the one
    thing `golden.cell_env` cannot redirect.
  * `_accent_for`'s cyan fallback needs a theme name `themes/` does not have, and
    `effective_theme` refuses one upstream before the accent is ever read.

And `pyLen`/`pyLjust`, because they reproduce a language primitive and P5c's rule for those
is a corpus rather than a cell: `len()` counts code points where `String.length` counts
UTF-16 units, and the panel turns both into column widths.

P5e adds `fenceFor` (`_harness_build._fence_for`), unreachable for a fifth distinct reason:
it is reachable in every `prompt` cell but never VARIES in one. Measured over the whole
rendered tree, the longest backtick run in any source text is 3, so `max(4, longest + 1)`
returns 4 for all 96 files and a port that hardcoded four backticks is byte-identical across
the matrix. Varying it needs a file in `src/`, and `src/` is the tree no fixture can
redirect. That the branch is dead is a claim about CONTENT, so it is re-derived here rather
than trusted — `test_the_fence_corpus_still_describes_the_real_tree` fails the day a source
file grows a four-backtick run, at which point a cell becomes possible and should be written.

P5f adds the largest entry so far and a sixth reason: **`difflib.unified_diff`**. `harness
diff`'s entire user-visible payload comes from it, and a cell can only produce a whole-file
replacement or an append. What separates `difflib` from any other correct diff — its
longest-block recursion rather than an edit-script minimiser, its earliest-wins tie rule, and
`autojunk`, which drops over-frequent lines once `b` reaches 200 elements — needs inputs a
fixture cannot seed. `test_the_diff_corpus_reaches_past_what_a_cell_can_seed` is the
positive control, and the unreachability is measured in BOTH directions: switching `autojunk`
off in `js/lib/pydiff.mjs` turns 28 of these cases red and leaves all 250-odd acceptance
cells green.

Four smaller ones ride along with it: `pySplitLines` (`str.splitlines()` breaks on U+2028 and
U+2029 where `split('\\n')` does not, and a deployed file acquires those from one paste),
`cmpKey` (its whole point is suppressing a BUILD-DATE difference, which needs a marker
holding the live fingerprint — the one value no cell may name), `pyCapitalize` (Python
lowercases the rest of the string and JS does not, invisible while every posture name is
already lowercase) and `setupBuildArgs` (a cell reaches only the flag combinations a deployed
install can actually be in).

The ASCII overlay gets a corpus too even though a cell CAN reach it, for a reason specific
to it: `_TUI_ASCII` is read at import time on the Python side and at call time on the Node
one, so the two probes run once per setting rather than switching inside a process.

POSITIVE CONTROL. An absolute gate needs one, or it passes on a pair of probes that both
return nothing: `test_the_probes_produce_the_panel_and_not_an_empty_echo` names literal
output, including a literal escape sequence, so a probe that answered `[]` fails.
"""
from __future__ import annotations

import json
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import golden  # noqa: E402

ROOT = golden.ROOT
PY_PROBE = ROOT / "tests" / "fixtures" / "pure_probe.py"
JS_PROBE = ROOT / "tests" / "fixtures" / "pure_probe.mjs"

# A status dict as `_status_data` returns one. Every field the panel reads, and nothing it
# does not — the panel is pure, so the corpus is its whole input.
_BASE = {
    "theme": "imperial", "accent": "yellow", "emit": "opencode-global",
    "agents": 17, "skills": 47, "laws": 37,
    "memory_dir": "/home/u/.config/opencode/memory", "facts": 3,
    "source_fp": "aaaaaaaaaaaa", "installed_fp": "aaaaaaaaaaaa",
    "version_target": "/home/u/.config/opencode",
    "version_verdict": "up to date with this source",
    "agent_md": "/home/u/.config/opencode/AGENT.md", "agent_md_present": True,
}


def _d(**kw) -> dict:
    return dict(_BASE, **kw)


def _panel_corpus() -> list[dict]:
    """The axes that change a rendered line, one case per axis rather than a product."""
    return [
        _BASE,
        # The three verdict states, which pick the mark AND its colour code.
        _d(installed_fp=None, version_verdict="no Geneseed install detected to compare"),
        _d(installed_fp="bbbbbbbbbbbb",
           version_verdict="installed build differs from the current source — run "
                           "`./geneseed update` (or rebuild) to apply it"),
        # The optional row, which changes the label column width from 7 to 8.
        _d(agent_md=None, agent_md_present=False),
        _d(agent_md_present=False),
        # Pluralisation, and the zero that is not None.
        _d(facts=1), _d(facts=0), _d(memory_dir=None, facts=0),
        # An accent with no ANSI code falls back to 36 — the `.get(x, "36")` branch.
        _d(accent="chartreuse"),
        # Width selection: a verdict LONGER than every body line, and the reverse.
        _d(version_verdict="x" * 200),
        _d(memory_dir="/" + "d" * 200),
        # len() is code POINTS. An astral theme name and an astral path shear the frame by
        # one column per character under String.length, and by nothing under pyLen.
        _d(theme="𝔤𝔬𝔱𝔥𝔦𝔠", memory_dir="/home/u/𝕄𝕖𝕞/memory"),
        # Combining marks are single code points in BOTH languages — the control that says
        # the astral case above is about surrogate pairs and not about "non-ASCII".
        _d(theme="néutral"),
        # An empty emit and an em-dash one, the two shapes `inst["emit"] or "—"` produces.
        _d(emit="—"),
        # Counts that are not two digits, so the panel's alignment is not accidentally
        # right for one width only.
        _d(agents=0, skills=1, laws=999),
    ]


def _cases() -> list[dict]:
    cases = []
    for d in _panel_corpus():
        for color in (False, True):
            cases.append({"fn": "status_lines", "args": [d, color]})
    for installed, current in ((None, "aaaaaaaaaaaa"), ("aaaaaaaaaaaa", "aaaaaaaaaaaa"),
                               ("bbbbbbbbbbbb", "aaaaaaaaaaaa"), ("", "aaaaaaaaaaaa")):
        cases.append({"fn": "version_verdict", "args": [installed, current]})
    for theme in ("imperial", "neutral", "cyberpunk", "nosuchtheme", "", "_TEMPLATE",
                  "../harness.config"):
        cases.append({"fn": "accent_for", "args": [theme]})
    cases.append({"fn": "default_theme", "args": []})
    # `len()` / `str.ljust()` against `String.length` / `padEnd`.
    for s in ("", "abc", "é", "é", "𝔊", "𝔊𝔊𝔊", "a𝔊b", "日本語", "\U0001F9EC"):
        cases.append({"fn": "py_len", "args": [s]})
        cases.append({"fn": "py_ljust", "args": [s, 6]})
        cases.append({"fn": "py_ljust", "args": [s, 1]})
    for s in _FENCE_CORPUS:
        cases.append({"fn": "fence_for", "args": [s]})
    for a, b in _DIFF_CORPUS:
        cases.append({"fn": "unified_diff", "args": [a, b]})
    for s in _SPLITLINES_CORPUS:
        cases.append({"fn": "py_split_lines", "args": [s]})
    for rel, text in _CMP_KEY_CORPUS:
        cases.append({"fn": "cmp_key", "args": [rel, text]})
    for s in ("peer", "PEER", "Peer", "foreman", "fOrEmAn", "", "a", "élan", "ÉLAN",
              "𝔤othic", "peer mode", "1st"):
        cases.append({"fn": "py_capitalize", "args": [s]})
    for args in _BUILD_ARGS_CORPUS:
        cases.append({"fn": "setup_build_args", "args": args})
    for args in _THEMES_TO_CHECK_CORPUS:
        cases.append({"fn": "themes_to_check", "args": args})
    for s in _ROMAN_CORPUS:
        cases.append({"fn": "roman_to_int", "args": [s]})
    for s in _DESC_BLOCK_CORPUS:
        cases.append({"fn": "desc_block_problem", "args": [s]})
    for args in _PROSE_MIRROR_CORPUS:
        cases.append({"fn": "prose_mirror_problems", "args": args})
    for rel in _VENDORED_CORPUS:
        cases.append({"fn": "is_vendored_path", "args": [rel]})
        cases.append({"fn": "validate_is_vendored", "args": [rel]})
    for s in _IS_ABSOLUTE_CORPUS:
        cases.append({"fn": "py_is_absolute", "args": [s]})
    for instr in _AGENT_ENTRY_CORPUS:
        cases.append({"fn": "install_agent_entry_of", "args": [instr]})
    for s in _PY_INT_CORPUS:
        cases.append({"fn": "py_int", "args": [s]})
    for s in _JAVA_BANNER_CORPUS:
        cases.append({"fn": "java_major_ok", "args": [s]})
    # The three option tables. Their INPUT is the checkout — `themes/*.json`,
    # `src/postures/`, `src/modes/` — which is the tree no fixture can redirect (P5d), so
    # they are read once and compared rather than driven over a corpus. That still catches
    # every blurb, the neutral-first sort and the discovery order.
    cases.append({"fn": "theme_options", "args": []})
    cases.append({"fn": "posture_options", "args": []})
    cases.append({"fn": "mode_options", "args": []})
    for ts in _MINUTE_STAMP_CORPUS:
        cases.append({"fn": "minute_stamp", "args": [ts]})
    for s in _UNQUOTE_CORPUS:
        cases.append({"fn": "py_unquote", "args": [s]})
    return cases


# P6c — `urllib.parse.unquote`, a language primitive reproduced, so a corpus and not a cell
# (P5c's rule).
#
# The reason it exists at all is the third entry: `decodeURIComponent` THROWS a URIError on
# a `%` that is not an escape, and the web shell would answer that as a 500 where the
# reference answers a 404 naming the literal text. `/api/item/<type>/<name>` is the first
# route whose name comes out of a URL, so this is the first phase that can be handed one.
#
# The list is ordered by what each input breaks: no `%` at all (the early return), a valid
# pair in both cases, a multi-byte sequence that must be ACCUMULATED before decoding, the
# non-escapes, a lone continuation byte and two truncated sequences (which is where
# Python's maximal-subpart replacement and the JS decoder's could disagree — measured here
# rather than assumed), `+` which `unquote` does NOT touch, a literal non-ASCII character
# beside an escape (the `([\x00-\x7f]+)` split is what keeps them apart), and the
# traversal string the item route actually receives.
_UNQUOTE_CORPUS = [
    "", "plain", "a+b", "%2F", "%2f", "%41%42", "caf%C3%A9", "%E2%9C%93",
    "a%ZZfact", "trailing%", "a%", "%%41", "%2520", "%00",
    "%80", "%C3", "%E2%82",
    "déjà%20vu", "%C3%A9%ZZ", "..%2F..%2Fbuild", "vault:notes%2Fone.md",
]


# P6b — `%Y-%m-%d %H:%M`, which `api_overview`'s `build_time` and `stamp_doctor`'s
# `checked_at` both render.
#
# A CORPUS AND NOT A CELL, because the cell cannot see it. Both values are sampled while
# the cell runs and the two sides run seconds apart, so `tests/web_golden.py` normalises
# them to `<WHEN>` — which means a Node twin formatting in UTC, or with a zero-padding bug,
# or with the month and day swapped, would compare EQUAL in every web cell. The stamp is a
# pure function of an epoch second and the local zone, so the corpus is where it can be
# compared: same machine, same zone, same instant, both formatters.
#
# The instants are chosen for what they can break: a single-digit month, day, hour and
# minute in one value (zero padding, four times over), midnight and one minute before it
# (the date rollover), a UTC noon that is a different date in some zones, and a DST
# transition. `datetime.fromtimestamp` is naive local time on the reference — the JS twin
# uses `getFullYear`/`getMonth`/… for the same reason, and `toISOString` would be UTC.
_MINUTE_STAMP_CORPUS = [
    1_704_070_861.0,     # 2024-01-01 00:01:01 UTC — single-digit month, day, hour, minute
    1_704_067_199.0,     # one second before 2024-01-01 UTC — the rollover, from the other side
    1_720_612_800.0,     # 2024-07-10 12:00:00 UTC — a different DATE in UTC+13 / UTC-12
    1_710_054_000.0,     # 2024-03-10 07:00:00 UTC — inside the US DST spring-forward hour
    1_762_064_100.5,     # a FRACTIONAL second: `st_mtime` is a float and `mtimeMs` is not
]


# --------------------------------------------------------------------------------------
# P5i — the wizard's pure halves
# --------------------------------------------------------------------------------------

#: `int(s)` against `Number(s)`, and every case here changes a wizard answer.
#:
#: `askChoice` branches three ways — an in-range index, a parsed out-of-range one, and an
#: unparseable answer that is then matched against the option KEYS — and only `pyInt` tells
#: the second from the third. `Number('')` is 0, `Number('0x2')` is 2 in hex, `Number('1_0')`
#: is NaN and `Number('٣')` is NaN; `int` disagrees with all four.
#:
#: NOTHING HERE IS PADDED, and that is the corpus stating a contract rather than dodging a
#: divergence: `int(' 1')` is 1 and `pyInt` does not strip, because both call sites run
#: `str.strip()` before the value reaches it. A padded case would be testing `_ask`, which
#: the wizard job drives for real.
_PY_INT_CORPUS = (
    "1", "5", "9", "10", "99", "0", "-1", "+3", "007",
    "", "-", "+", "_", "1_0", "1_000", "_1", "1_", "1__0",
    "1.0", "1e3", "0x2", "0b1", "1x", "x1", "neutral", "opencode-global",
    # Unicode decimals. `int` takes any `Nd`; `Number` takes none of them, and JS's `\\d`
    # would not have matched them either.
    "٣", "٥٠", "٠٣", "۲", "１",
    # `Nd` MIXED with an ASCII digit is accepted and is 13 — the scripts do not have to
    # agree, only the category. A Roman numeral one is `Nl`, not `Nd`, and is refused.
    "1٣", "Ⅰ",
    # Past a 32-bit index, to say the parse is not `parseInt`'s. Deliberately inside 2^53:
    # Python's int is arbitrary precision and a JS Number is not, and that divergence starts
    # at 9007199254740993 — a menu index the wizard could not reach in any universe, and a
    # case whose only content would be the limit of the return TYPE.
    "2147483648",
)

#: `java -version` banners. The legacy `1.8.0` shape is the whole reason the function exists:
#: it names major 1, which is never >= 21, where a naive "first number after the dot" reading
#: makes it 8. The last two are the `re.search` failing rather than the comparison.
_JAVA_BANNER_CORPUS = (
    'openjdk version "21.0.2" 2024-01-16\nOpenJDK Runtime Environment\n',
    'openjdk version "17.0.9" 2023-10-17\n',
    'java version "1.8.0_401"\n',
    'openjdk version "25-ea" 2025-09-16\n',
    'openjdk version "21"\n',
    'openjdk version "20.9.9"\n',
    "",
    "java is not recognized as an internal or external command\n",
    'version "x"\n',
    'VERSION "21"\n',
    # `\\d` is Unicode-aware in Python and ASCII-only in JS without the flag, so a banner
    # spelled in Arabic-Indic digits matches on one side and not the other unless the port
    # says `\\p{Nd}`. No JVM prints this; matching Python where it costs nothing is cheaper
    # than a comment explaining where it does not.
    'openjdk version "٢١.0.2"\n',
)


# --------------------------------------------------------------------------------------
# P5g — doctor's pure halves
# --------------------------------------------------------------------------------------
#
# `doctor` is gated cell-first, by one planted fault per check in a copied checkout. Five
# things that copy cannot reach land here instead, each for a reason already named in this
# loop, and one of them is new.
#
#   * `_themes_to_check` is REACHABLE BUT UNAFFORDABLE. `--all` sweeps every theme, and a
#     theme is one build plus five emits: 14 of those is ~30 s per side per cell against the
#     2 s a scoped run costs. The matrix would take longer than the rest of the suite to
#     assert one list. Pure over four arguments, so it is free here.
#   * `_roman_to_int`'s zero return is UNREACHABLE. Its only caller feeds it numerals matched
#     by `^### \{\{LAW\}\} ([IVXLCDM]+)`, so a character outside the value map cannot arrive —
#     and subtractive notation is exercised by the real laws, which is why the corpus carries
#     both.
#   * `_desc_block_problem` has five arms and a cell can only plant a spec that renders. Two
#     arms are cell-covered (`agents/advocate.md` in two shapes); the other three need a spec
#     that is empty, title-less, or ends at its title — and a spec in any of those shapes also
#     changes what the EMIT writes, so the cell would be measuring two things.
#   * `_prose_mirror_problems` is documented pure by its own docstring, and the arms that
#     matter read `rituals/_web_core.py` and `SHIPPED.md`. Planting drift in those means
#     hand-writing a copy of a 200 KB module in a cell.
#   * `shutil.which` is P5c's rule for a language primitive: reproduce one, gate it with a
#     CORPUS. A cell observes exactly one answer — whatever this machine's PATH says about
#     `node` — and the whole reason the port has its own lookup is the OTHER answer, where
#     `doctor` skips `node --check` entirely.

# `_themes_to_check(theme, all_themes, detected, available)`. `--all` and the two
# fall-through arms — a fresh clone with nothing installed, and a detected theme `themes/` no
# longer has (a user's install predating a theme rename).
_AVAIL = ["cyberpunk", "imperial", "neutral"]
_THEMES_TO_CHECK_CORPUS = (
    ["neutral", False, None, _AVAIL],
    ["neutral", True, "imperial", _AVAIL],          # explicit --theme beats --all
    ["zzz-not-a-theme", False, "imperial", _AVAIL],  # unvalidated here, refused downstream
    [None, False, "imperial", _AVAIL],
    [None, True, "imperial", _AVAIL],
    [None, False, None, _AVAIL],                    # fresh clone -> full sweep
    [None, False, "gone-in-a-rename", _AVAIL],      # detected but unknown -> full sweep
    [None, False, "imperial", []],
    [None, False, "imperial", ["imperial"]],
    ["", False, "imperial", _AVAIL],                # "" is falsy in both languages
    [None, False, "", _AVAIL],
)

# `_roman_to_int`. The subtractive pairs the real laws use, the boundary the ledger keys on,
# and the unparseable inputs its `return 0` exists for and nothing can deliver.
_ROMAN_CORPUS = (
    "I", "II", "III", "IV", "V", "IX", "X", "XIV", "XIX", "XX", "XXXVII", "XL", "XLIX",
    "L", "XC", "C", "CD", "D", "CM", "M", "MMXXVI",
    "i", "iv", "xxxvii",           # `.upper()` first
    "", "IIII", "VV", "IL",        # malformed but in-alphabet: arithmetic, not validation
    "A", "X1", "IVX", " IV", "IV ", "١٤",
)

# `_desc_block_problem`. The three arms no cell can plant without also changing the emit.
_DESC_BLOCK_CORPUS = (
    "",
    "   \n\n  \n",
    "<!-- authoring note -->\n",
    "<!-- note -->\n# Title\n\n> Purpose.\n",
    "# Title\n",
    "# Title\n\n\n",
    "# Title\n\n>\n",
    "# Title\n\n>   \n",
    "# Title\n\n>>> \n",
    "# Title\n\n> Purpose.\n",
    "  # Indented title\n\n> Purpose.\n",
    "Prose first.\n\n# Title\n\n> Purpose.\n",
    "# Title\n\nProse.\n\n> Purpose only later.\n",
    "# Title\n\n```\n> not a blockquote, a code sample\n```\n",
    "# Title\n> Purpose on the very next line.\n",
    "\U0001D50A Title\n\n> Purpose.\n",
    "# Title\n\n> Purpose with an apostrophe' and a \"quote\".\n",
)

# `_prose_mirror_problems(readme, web, counts, skill_stems, shipped)`. Pure over five inputs,
# and the two mirrors that live in Python source (`_web_core`) and in SHIPPED.md are the ones
# a cell would have to hand-write a module to plant.
_COUNTS = {"laws": 37, "agents": 17, "skills": 47}
_README_OK = ("Geneseed ships 37 universal laws.\n"
              "| **🤖 Agents** (17) | one per capability |\n"
              "| **🛠 Skills** (47) | workflows: alpha · beta · gamma |\n")
_PROSE_MIRROR_CORPUS = (
    [_README_OK, "", _COUNTS, ["alpha", "beta", "gamma"], ""],
    [_README_OK.replace("37 universal", "36 universal"), "", _COUNTS,
     ["alpha", "beta", "gamma"], ""],
    [_README_OK.replace("(17)", "(16)").replace("(47)", "(48)"), "", _COUNTS,
     ["alpha", "beta", "gamma"], ""],
    # A dropped name the (N) count alone cannot see, and a name with no spec behind it.
    [_README_OK, "", _COUNTS, ["alpha", "beta", "gamma", "delta"], ""],
    [_README_OK, "", _COUNTS, ["alpha", "beta"], ""],
    # No `workflows:` marker at all: the enumeration arm must not run on a reworded row.
    [_README_OK.replace("workflows:", "playbooks:"), "", _COUNTS, ["alpha"], ""],
    # The `_web_core` prose, in both spellings of the law line.
    ["", "onboarding: 37 universal laws and 17 capability specialists", _COUNTS, [], ""],
    ["", "onboarding: 36 universal Rules and 18 capability specialists", _COUNTS, [], ""],
    # The curated-subset arm: N against the wikilinks it introduces, not against the total.
    ["", "3 repeatable workflows the agent can invoke by name — [[a]], [[b]], [[c]] — each "
     "a playbook under", _COUNTS, [], ""],
    ["", "4 repeatable workflows the agent can invoke by name — [[a]], [[b]] — each "
     "a playbook under", _COUNTS, [], ""],
    # `re.S`: the wikilink list spans lines in the real file.
    ["", "2 repeatable workflows the agent can invoke by name —\n[[a]],\n[[b]]\n— a "
     "playbook under", _COUNTS, [], ""],
    # SHIPPED.md's capability row, which had drifted 1 law and 6 skills behind with no gate.
    ["", "", _COUNTS, [], "Every row below is present: 37 laws, 17 agents, 47 skills.\n"],
    ["", "", _COUNTS, [], "Every row below is present: 36 laws, 17 agents, 41 skills.\n"],
    ["", "", _COUNTS, [], "no capability row here at all"],
)

# `is_vendored_path` against `_validate_is_vendored` — the same question at two depths, and
# the pair exists because doctor asks it of a bundle and of a per-repo native layer in the
# same run. Every cell exercises exactly the two real shapes; these are the edges.
_VENDORED_CORPUS = (
    "skills/token-report/SKILL.md", "skills/token-report", "skills/brainstorm.md",
    ".claude/skills/token-report/SKILL.md", ".bob/skills/daydream/x/y.md",
    ".github/skills/react-view-transitions/README.md",
    "skills/not-vendored/SKILL.md", "agents/skills/token-report/SKILL.md",
    "skills", "skills/token-report/", "a/b/c.md", "",
    # A FILE named `skills` with a vendored-looking sibling — the `parts[:-1]` boundary.
    "token-report/skills", "skills/token-report/nested/skills/daydream/deep.md",
)


# `_setup_build_args`'s three elision rules, one case per rule and per side of it. Reachable
# through `rebuild-all` in principle — but a cell can only reach the combinations a DEPLOYED
# install can be in, and `--root` without `--out`, an empty footprint and a global emit
# carrying an `out` are not among them.
_BUILD_ARGS_CORPUS = (
    ["neutral", "opencode-global"],
    ["neutral", "opencode-global", "/repo", "/repo", "lean", "peer", "direct"],
    ["neutral", "claude-global", "/repo", "/repo", "full", "artisan", "foreman"],
    ["neutral", "opencode", "/repo", "/repo", "lean", "peer", "direct"],
    ["neutral", "opencode", "/repo", None, "full", "peer", "direct"],
    ["neutral", "opencode", None, "/repo", "lean", "peer", "direct"],
    ["neutral", "claude", None, None, "", "peer", "direct"],
    ["neutral", "bob", "/repo", "/repo", "lean", "artisan", "direct"],
    ["neutral", "copilot", "/repo", "/repo", "lean", "peer", "foreman"],
    ["neutral", "bob-global", "/ignored", "/ignored", "lean", "expert", "foreman"],
)

# `_cmp_key`'s reason for existing, and it is cell-unreachable in the direction that matters.
# `.geneseed-version` IS an owned file, so every `diff` cell runs this branch — but making it
# SUPPRESS a difference needs a deployed marker holding the CURRENT source fingerprint, which
# changes every commit and `test_no_cell_hardcodes_a_source_fingerprint` refuses to let a cell
# name. Here the two stamps share a token and differ in everything else, which is exactly the
# case the branch was written for: a rebuild is not a local edit.
_CMP_KEY_CORPUS = (
    (".geneseed-version", "abc123def456 (built 2020-01-01) [release 0.1]\n"),
    (".geneseed-version", "abc123def456 (built 2026-08-09) [release 9.9]\n"),
    (".geneseed-version", "   abc123def456   trailing\n"),
    (".geneseed-version", "\n"),
    (".geneseed-version", ""),
    (".geneseed-version", "   "),
    # `str.split()` with no argument collapses runs AND strips — `split(" ")` does neither,
    # and would answer `""` for a marker that begins with a space.
    (".geneseed-version", "\t\n  abc123def456\tx"),
    ("AGENT.md", "abc123def456 (built 2020-01-01)\n"),
    ("AGENT.md", ""),
)

# `str.splitlines()` against `split('\n')`. The two U+2028/U+2029 cases are the ones a real
# deployed file can acquire — paste a paragraph from a web page into an install's AGENT.md —
# and they shift every hunk after them by one line on the Python side only.
_SPLITLINES_CORPUS = (
    "", "a", "a\n", "a\nb", "a\nb\n", "\n", "\n\n", "a\n\nb",
    "a\r\nb\r\n", "a\rb", "a\r\n\rb",
    "para one\u2028para two", "para one\u2029para two", "a\u2028",
    "a\x0bb", "a\x0cb", "a\x1cb", "a\x1db", "a\x1eb", "a\x85b",
    "trailing spaces   \nnext",
    "\U0001D50A\n\U0001D50A",
)


# --------------------------------------------------------------------------------------
# P5h — `Path.is_absolute()`, and the entry it chooses
# --------------------------------------------------------------------------------------
#
# P5c's rule for a language primitive, third time: reproduce one, gate it with a CORPUS.
# `path.isAbsolute` is NOT `Path.is_absolute` on Windows — a ROOTLESS `/x/AGENT.md` is
# absolute to Node and relative to Python, which requires a drive or a UNC root. A cell CAN
# seed such an entry, but the answer only differs on one platform inside one branch whose
# other observable effect is nothing at all, so the shape belongs here.
#
# `install_agent_entry_of` is the caller, driven beside it: which entry `uninstall` unwires
# is the decision, and it is a first-match walk over a list the corpus can hand it whole.
_IS_ABSOLUTE_CORPUS = (
    "AGENT.md", "sub/AGENT.md", "./AGENT.md", "",
    "/x/AGENT.md",                  # rootless posix — Python False, path.isAbsolute true
    "\\x\\AGENT.md",                # rootless windows — same split
    "C:/x/AGENT.md", "C:\\x\\AGENT.md",
    "C:x/AGENT.md",                 # drive-RELATIVE: False to both, and easy to get wrong
    "//srv/share/AGENT.md", "\\\\srv\\share\\AGENT.md",
    "~/AGENT.md",                   # expanduser is a different function; this is literal
    "/", "\\", "C:", "C:/",
)

_AGENT_ENTRY_CORPUS = (
    ["AGENT.md"],
    ["bundle/AGENT.md"],
    ["./AGENT.md"],
    [],
    ["notes.md"],                                   # nothing matches -> the fallback
    ["C:/x/AGENT.md"],                              # absolute -> skipped on both sides
    ["/repo/AGENT.md"],                             # THE divergence, as the caller sees it
    ["/repo/AGENT.md", "bundle/AGENT.md"],          # ...and first-match makes it observable
    ["C:/x/AGENT.md", "bundle/AGENT.md"],
    ["agents/AGENT.md", "bundle/AGENT.md"],         # first match wins, not the shortest
    ["AGENT.MD"],                                   # case-sensitive comparison on both
    [None, 42, "bundle/AGENT.md"],                  # the isinstance guard
    ["AGENT.md/"],                                  # a trailing separator still names it
)


def _diff_corpus() -> tuple:
    """Input pairs for `difflib.unified_diff`, chosen for the choices no cell can vary.

    A `diff` cell seeds one deployed file and gets a whole-file replacement or an append. It
    cannot produce a tie between two equal-length blocks, cannot reach the recursion's
    alignment decisions, and above all cannot cross the **autojunk** threshold in a way it
    controls: `SequenceMatcher` drops any line occurring more than `len(b)//100 + 1` times
    once `b` reaches 200 elements, which is every real harness file and no fixture's.

    Deterministically random rather than hand-written past the first block: ties and near-ties
    are what separate `difflib` from any other correct diff, and they are far easier to
    generate than to think of. The seed is fixed so a failure is reproducible.
    """
    rnd = random.Random(20260809)
    out = [
        ([], []), ([], ["a"]), (["a"], []), (["a"], ["a"]),
        (["a", "b", "c"], ["a", "x", "c"]),
        (["a"] * 5, ["a"] * 5),
        (list("abcdefghij"), list("acbdefghij")),
        (["x"] * 10 + list("abc"), list("abc") + ["x"] * 10),
        # One change in the middle of a long identical run — the grouping path, and the
        # `i2-i1 > nn` split that ends a hunk.
        ([f"l{i}" for i in range(40)],
         [f"l{i}" if i != 20 else "CHANGED" for i in range(40)]),
        ([f"l{i}" for i in range(60)],
         [f"l{i}" if i not in (5, 50) else "X" for i in range(60)]),
        # The autojunk threshold, from one element below it to one above.
        ([f"l{i % 7}" for i in range(199)], [f"l{i % 7}" for i in range(199)] + ["tail"]),
        ([f"l{i % 7}" for i in range(200)], [f"l{i % 7}" for i in range(200)] + ["tail"]),
        ([f"l{i % 7}" for i in range(400)], ["head"] + [f"l{i % 7}" for i in range(400)]),
        # Blank lines between paragraphs, which is what a real markdown file looks like to
        # the popular-element purge.
        (sum(([f"p{i}", ""] for i in range(150)), []),
         sum(([f"p{i}" if i != 77 else "EDIT", ""] for i in range(150)), [])),
        # Lines that look like integers: `b2j` is a Map for the same reason `loadUserPalette`
        # holds one, and a plain object would hoist these to the front of the index.
        (["0", "1", "2", "zzz"], ["zzz", "0", "1", "2"]),
        (["a", "", "b", "", "a", "", "b"], ["a", "", "b", "", "b", "", "a"]),
    ]
    for _ in range(120):
        a = [rnd.choice("abcde") for _ in range(rnd.randrange(0, 60))]
        b = list(a)
        for _ in range(rnd.randrange(0, 8)):
            op = rnd.choice(("ins", "del", "sub"))
            if op == "ins":
                b.insert(rnd.randrange(0, len(b) + 1), rnd.choice("abcdez"))
            elif b:
                i = rnd.randrange(0, len(b))
                if op == "del":
                    del b[i]
                else:
                    b[i] = rnd.choice("abcdez")
        out.append((a, b))
    for _ in range(40):
        a = [rnd.choice(("alpha", "beta", "", "", "gamma"))
             for _ in range(rnd.randrange(150, 320))]
        b = list(a)
        for _ in range(rnd.randrange(1, 10)):
            b[rnd.randrange(0, len(b))] = "MUTATED"
        out.append((a, b))
    return tuple(out)


_DIFF_CORPUS = _diff_corpus()


# `_fence_for`'s whole job is picking a fence longer than the longest run INSIDE the text,
# and the live tree only ever exercises "shorter than four". Every case beyond the first two
# is a shape `src/` does not currently contain and a user's repo might after one commit.
_FENCE_CORPUS = (
    "",                        # no backticks at all — the `max(4, 0 + 1)` floor
    "a ``` fenced ``` block",  # the tree's real maximum: 3, so still 4
    "````",                    # exactly at the floor — the first case that must return 5
    "`````",
    "a " + "`" * 12 + " b",
    "`" * 3 + "\n" + "`" * 7 + "\n" + "`" * 2,   # the longest run is not the first
    "``` a ``` b ```",         # several runs of the same length
    "`",
    # A run at the very END of the string: an off-by-one in the loop's bookkeeping shows
    # here and nowhere else, because there is no following character to reset the count on.
    "trailing " + "`" * 6,
    "`" * 6 + " leading",
    # Astral characters around the run. The Python iterates CHARACTERS and this port
    # iterates code UNITS — identical for counting backticks, and this is the case that
    # says so rather than leaving it argued in a comment.
    "\U0001D50A\U0001D50A" + "`" * 5 + "\U0001D50A",
)


def _manifest_cases(tmp: Path) -> list[dict]:
    """`_manifest_is_claude` reads a file, so its corpus is a set of seeded directories."""
    worlds = {
        "managed-map": '{"managed": {"claude_md": true}}',
        "managed-empty-map": '{"managed": {}}',
        "managed-list": '{"managed": []}',
        "managed-null": '{"managed": null}',
        "managed-string": '{"managed": "yes"}',
        "no-managed": '{"owned": []}',
        "a-json-list": '[1, 2, 3]',
        "a-json-string": '"hello"',
        "not-json": "{nope",
        "empty": "",
    }
    cases = []
    for name, body in worlds.items():
        d = tmp / name
        d.mkdir(parents=True, exist_ok=True)
        (d / ".geneseed-manifest.json").write_text(body, encoding="utf-8")
        cases.append({"fn": "manifest_is_claude", "args": [str(d)]})
    missing = tmp / "no-manifest-at-all"
    missing.mkdir(parents=True, exist_ok=True)
    cases.append({"fn": "manifest_is_claude", "args": [str(missing)]})
    # A DIRECTORY where the manifest should be: `read_text` raises IsADirectoryError, which
    # is an OSError, and both sides must degrade to {} rather than propagate.
    weird = tmp / "manifest-is-a-directory"
    (weird / ".geneseed-manifest.json").mkdir(parents=True, exist_ok=True)
    cases.append({"fn": "manifest_is_claude", "args": [str(weird)]})
    return cases


def _which_cases(tmp: Path) -> list[dict]:
    """`shutil.which` reads the filesystem, so its corpus is a seeded PATH.

    Every case passes `path=` explicitly. Inheriting the machine's is the one thing that
    would make this untestable: the answer would be whatever is installed on the runner.
    """
    a, b = tmp / "whichA", tmp / "whichB"
    for d in (a, b):
        d.mkdir(parents=True, exist_ok=True)
    # Windows finds `zzhit` through PATHEXT; POSIX needs the name as spelled and the exec bit.
    for d, names in ((a, ("zzhit.cmd", "zzhit")), (b, ("zzhit.cmd", "zzhit", "zzonly"))):
        for n in names:
            p = d / n
            p.write_text("", encoding="utf-8")
            p.chmod(0o755)
    (a / "zzdir").mkdir(exist_ok=True)          # a DIRECTORY with a command's name
    (a / "zznotexec").write_text("", encoding="utf-8")
    (a / "zznotexec").chmod(0o644)
    sep = os.pathsep
    both = f"{a}{sep}{b}"
    return [{"fn": "py_which", "args": [cmd, p]} for cmd, p in (
        ("zzhit", str(a)),
        ("zzhit.cmd", str(a)),                  # already spelled: PATHEXT is not appended
        ("zzonly", both),                       # second entry wins only because the first misses
        ("zzonly", str(a)),                     # ...and misses entirely when it is absent
        ("zzdir", str(a)),                      # a directory is never the answer
        ("zznotexec", str(a)),                  # POSIX: no exec bit. Windows: found.
        ("zzmissing", both),
        ("zzhit", ""),                          # an empty PATH is one empty entry, not none
        ("zzhit", f"{sep}{a}"),                 # a leading empty entry is searched, as `.`
        ("zzhit", f"{a}{sep}{a}"),              # deduped by normcase
        ("zzhit", f"{a.as_posix()}{sep}{b}"),
        (str(a / "zzhit.cmd"), both),           # a path, not a name: checked as given
        ("nosuch/zzhit", both),
        # The CURRENT DIRECTORY is not searched — true since 3.12, and the first draft of
        # `pyWhich` reproduced the older behaviour. `geneseed`/`geneseed.cmd` is a real file
        # at the repo root and `_run` runs both probes with `cwd=ROOT`, so a port that
        # prepended `.` answers with it here and the reference answers None. Without this
        # case that mutation is GREEN: every other case names a directory the cwd is not.
        ("geneseed", str(a)),
        ("node", os.environ.get("PATH", "")),   # the one call the verb actually makes
    )]


def _run(cmd: list[str], cases: list[dict], ascii_mode: bool) -> list:
    with tempfile.TemporaryDirectory() as td:
        job = Path(td) / "job.json"
        job.write_text(json.dumps({"cases": cases}), encoding="utf-8")
        env = dict(os.environ, PYTHONUTF8="1")
        env.pop("GENESEED_TUI_ASCII", None)
        if ascii_mode:
            env["GENESEED_TUI_ASCII"] = "1"
        # No text=True: both probes write UTF-8 whatever the console code page is, and the
        # decoder is pinned for the same reason harness_golden pins it.
        proc = subprocess.run(cmd + [str(job)], capture_output=True, env=env, cwd=str(ROOT))
        if proc.returncode != 0:
            raise AssertionError(f"{cmd[0]} probe failed ({proc.returncode}):\n"
                                 f"{proc.stderr.decode('utf-8', 'replace')}")
        return json.loads(proc.stdout.decode("utf-8"))["results"]


# --------------------------------------------------------------------------------------
# P5i — the wizard, driven over a SEEDED FD
# --------------------------------------------------------------------------------------
#
# `setup` refuses when `sys.stdin.isatty()` is false, so the acceptance matrix reaches the
# refusal and nothing else. Everything the verb actually DOES is behind that gate, and most
# of it reads stdin — which is why this corpus is a different shape from every other one in
# this file:
#
#   * The probes are run with stdin REDIRECTED FROM A FILE, not with a string handed to a
#     pure function. `ask` reads fd 0 a byte at a time and `input()` reads a line; neither
#     can be exercised by passing an argument, and a corpus that faked the read would be
#     gating a fake.
#   * Their WHOLE STDOUT is compared, byte for byte, rather than parsed. The prompts, the
#     numbered menus, the `(default)` marker, the `About to run:` plan and the returned
#     selection are one string, so a port that got the menu right and the plan wrong fails
#     here. It also puts the newline translation under the gate: `print()` writes CRLF on
#     Windows and `process.stdout.write` writes LF, and every earlier probe comparison went
#     through `json.loads`, which cannot see the difference — the transport-normalises hole
#     P5b measured, closed for this one job.
#
# A SEEDED HOME, because `collect_setup_lines` calls `_installed_defaults`, which reads the
# host config dirs. `golden.cell_env` is the same redirection every cell runs under, and the
# seeded install is what makes the pre-selected defaults deterministic instead of whatever
# this machine happens to have installed.
#
# WHAT IT STILL DOES NOT REACH, stated rather than left implicit: `_setup_lines` itself. It
# spawns the generator and then the doctor, and both write real trees — the corpus stops at
# `_collect_setup_lines`, which is the whole of the wizard's own behaviour, and the two
# things past it (`setupBuildArgs`, `cmdDoctor`) are separately gated by their own corpus
# entry and their own 219-cell verb.

#: The install `installedDefaults` finds first — the OpenCode config dir under the seeded
#: HOME. All five markers, so all five pickers pre-select a DEPLOYED value rather than a
#: configured one, which is the debt P5i paid in `js/installs.mjs`.
_WIZARD_INSTALL = {
    # The manifest is what `_setup_summary_lines`' "a global install exists at" row keys on,
    # and it is the ONE row in that function with behaviour rather than text in it — without
    # this file the bundle and project cases are three identical shapes.
    ".config/opencode/.geneseed-manifest.json": '{"owned": []}',
    ".config/opencode/.geneseed-emit": "claude-global\n",
    ".config/opencode/.geneseed-theme": "pirate\n",
    ".config/opencode/.geneseed-footprint": "full\n",
    ".config/opencode/AGENT.md": "# deployed\n\n**Artisan** — the posture lead\n\n"
                                 "**Foreman** — the mode lead\n",
}


def _wizard_jobs() -> list[tuple[str, list[dict], str]]:
    """(name, cases, stdin) — each one its own probe process, because stdin is consumed."""
    opts = [["alpha", "the first"], ["beta", ""], ["gamma", "the third"]]
    return [
        # ---- the readers, alone, so a failure names the reader and not the wizard.
        ("ask", [{"fn": "ask", "args": ["Name", "dflt"]},
                 {"fn": "ask", "args": ["Bare", ""]},
                 {"fn": "ask", "args": ["Spaces", "d"]},
                 # ...and then EOF, twice: the branch a piped caller always takes. Python
                 # raises EOFError and returns the default; the byte reader gets a 0.
                 {"fn": "ask", "args": ["AtEof", "fallback"]},
                 {"fn": "ask", "args": ["AtEofAgain", ""]}],
         # The THIRD line is CRLF-terminated — what a Windows console sends. `input()` drops
         # the `\r` through universal-newline decoding and the byte reader drops it
         # explicitly, and the case is here to say the two agree. It is NOT the gate for that
         # branch and the comment says so rather than implying it: `_ask` runs `.trim()`
         # afterwards, which eats a stray `\r` either way, so the drop in `readLine` is a
         # faithful mirror of the transport and is INDISTINGUISHABLE from omitting it. The
         # measurement is recorded in the loop rather than dressed up as coverage.
         "typed\n\n   padded   \r\n"),
        # A last line with NO trailing newline is not EOF to either implementation — both
        # return the characters — and the read AFTER it is.
        ("ask-unterminated", [{"fn": "ask", "args": ["Last", "d"]},
                              {"fn": "ask", "args": ["Then", "d"]}],
         "no-newline"),
        ("confirm", [{"fn": "confirm", "args": ["Yes default", True]},
                     {"fn": "confirm", "args": ["No default", False]},
                     {"fn": "confirm", "args": ["Yes default", True]},
                     {"fn": "confirm", "args": ["No default", False]},
                     {"fn": "confirm", "args": ["Yes default", True]},
                     # `ans[0] == "y"` — only the FIRST character is read, so `yes` and
                     # `yellow` are both yes and `nope` is no.
                     {"fn": "confirm", "args": ["First char only", True]},
                     {"fn": "confirm", "args": ["At eof", True]}],
         "y\ny\nn\nn\nYES\nyellow\n"),
        # ---- the menu, and its three fallback arms in order.
        ("ask-choice", [
            {"fn": "ask_choice", "args": ["Pick", opts, "beta"]},   # an in-range index
            {"fn": "ask_choice", "args": ["Pick", opts, "beta"]},   # empty -> the default
            {"fn": "ask_choice", "args": ["Pick", opts, "beta"]},   # out of range -> default
            {"fn": "ask_choice", "args": ["Pick", opts, "beta"]},   # a KEY, not an index
            {"fn": "ask_choice", "args": ["Pick", opts, "beta"]},   # an unknown key
            # An answer that PARSES never reaches the key match, so a menu whose keys are
            # numbers cannot be chosen by name. `0` is parseable and out of range.
            {"fn": "ask_choice", "args": ["Pick", opts, "alpha"]},
            # A Unicode decimal index — `int` takes it and `Number` does not.
            {"fn": "ask_choice", "args": ["Pick", opts, "gamma"]},
            {"fn": "ask_choice", "args": ["Pick", opts, "alpha"]},  # EOF -> the default
        ], "3\n\n9\ngamma\nnosuch\n0\n٢\n"),
        # A menu whose KEYS are numerals, and it exists because a mutation asked for it: with
        # the corpus above alone, matching keys BEFORE parsing an index is the same function
        # — no numeric answer is also a key, so both orders agree on all eight cases. Here
        # `2` is both, and Python resolves it as an INDEX (the key match lives in
        # `except ValueError` and never sees a parseable answer), so the answer is the SECOND
        # option and not the one named `2`. A green mutation is a question about the corpus
        # of inputs before it is a question about the code.
        ("ask-choice-numeric-keys", [
            {"fn": "ask_choice", "args": ["Pick", [["2", "the key two"], ["1", "the key one"]],
                                          "1"]},
            # ...and the same menu answered `1`, which inverts the pair: index-first gives
            # `2`->"1" and `1`->"2", key-first gives `2`->"2" and `1`->"1". Two cases that
            # swap under the mutation and cannot both be right by accident.
            {"fn": "ask_choice", "args": ["Pick", [["2", "the key two"], ["1", "the key one"]],
                                          "1"]},
        ], "2\n1\n"),
        # ---- and the wizard itself, four ways through it.
        ("wizard-defaults", [{"fn": "collect_setup_lines", "args": []}],
         "\n\n\n\n\n\n"),
        ("wizard-declined", [{"fn": "collect_setup_lines", "args": []}],
         "\n\n\n\n\nn\n"),
        # A PROJECT emit, which is the arm that asks a sixth question — and `out` and `root`
        # are both set from the one answer.
        ("wizard-project", [{"fn": "collect_setup_lines", "args": []}],
         "1\n1\n1\n3\n1\n/tmp/somerepo\ny\n"),
        # `files`, the other arm: one answer, `out` only, `root` left null.
        ("wizard-files", [{"fn": "collect_setup_lines", "args": []}],
         "neutral\nexpert\nforeman\n9\nfull\n\ny\n"),
        # EOF before the first question. Every `_ask` returns its default, which is the
        # PRE-SELECTED one — so this is the case that fails if `installedDefaults` stopped
        # answering posture, mode or footprint.
        ("wizard-eof", [{"fn": "collect_setup_lines", "args": []}], ""),
    ]


def _summary_cases(home: Path) -> list[dict]:
    """`_setup_summary_lines`, over the five shapes its rows can take.

    Not a wizard job — it reads no stdin — but it runs in the same seeded HOME, because
    three of its rows name the OpenCode config dir and one branches on a manifest being
    there. `lspPrereqs` really does run `java -version`; the answer is whatever this machine
    gives, and both probes get the same one.
    """
    return [{"fn": "setup_summary_lines", "args": a} for a in (
        # opencode-global with the AGENT.md present: the ok row, the platform hint, the LSP
        # rows, the closing theme line.
        ["pirate", "opencode-global", None, None, True],
        # ...and with `ok` false, which is the only row that can say "build failed".
        ["pirate", "opencode-global", None, None, False],
        # A bundle: `resolveOut` against the probe's cwd, the "point your tool" row, AND the
        # global-install warning — the row with real behaviour in it.
        ["neutral", "files", "some/bundle", None, True],
        # A project emit, which gets neither the hint nor the warning's absence: no LSP rows
        # (not an `opencode` prefix), and the global warning still fires.
        ["imperial", "claude", "repo", "repo", True],
        # An `opencode` PROJECT emit — the prefix match, so the LSP rows come back.
        ["cyberpunk", "opencode", "repo", "repo", True],
        # `out` unset on a non-global emit falls back to the literal "Harness".
        ["neutral", "bob", None, None, True],
    )] + [{"fn": "installed_defaults", "args": []}]


def _seed(home: Path, world: dict) -> None:
    for rel, text in world.items():
        p = home / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")


def _run_seeded(cmd: list[str], cases: list[dict], home: Path, stdin: bytes) -> bytes:
    """One probe process, stdin from a seeded FILE, WHOLE stdout returned as bytes.

    A file rather than `input=`: the point is that fd 0 is a real readable descriptor the
    reader can walk a byte at a time, which is what a terminal gives it. Nothing is decoded
    on the way back, because the newline translation is part of what is being compared.
    """
    with tempfile.TemporaryDirectory() as td:
        job = Path(td) / "job.json"
        job.write_text(json.dumps({"cases": cases}), encoding="utf-8")
        answers = Path(td) / "answers.txt"
        answers.write_bytes(stdin)
        env = golden.cell_env(home)
        with answers.open("rb") as fh:
            proc = subprocess.run(cmd + [str(job)], stdin=fh, capture_output=True,
                                  env=env, cwd=str(ROOT))
        if proc.returncode != 0:
            raise AssertionError(f"{cmd[0]} probe failed ({proc.returncode}):\n"
                                 f"{proc.stderr.decode('utf-8', 'replace')}")
        return proc.stdout


@unittest.skipIf(shutil.which("node") is None, "node is not on PATH")
class TheWizardAgreesOnEveryAnswerNoCellCanGive(unittest.TestCase):
    """`setup`'s body, gated over a seeded fd — see the section header for why."""

    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        cls.home = Path(cls._tmp.name) / "home"
        _seed(cls.home, _WIZARD_INSTALL)
        cls.runs = {}
        for name, cases, stdin in _wizard_jobs():
            cls.runs[name] = (
                _run_seeded([sys.executable, str(PY_PROBE)], cases, cls.home,
                            stdin.encode("utf-8")),
                _run_seeded(["node", str(JS_PROBE)], cases, cls.home,
                            stdin.encode("utf-8")),
            )
        summary = _summary_cases(cls.home)
        cls.runs["summary"] = (
            _run_seeded([sys.executable, str(PY_PROBE)], summary, cls.home, b""),
            _run_seeded(["node", str(JS_PROBE)], summary, cls.home, b""),
        )

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def test_every_job_produces_the_same_bytes(self):
        for name, (ref, new) in self.runs.items():
            with self.subTest(job=name):
                self.assertEqual(ref.decode("utf-8"), new.decode("utf-8"))
                self.assertEqual(ref, new, "the two agree after decoding and not as BYTES, "
                                           "so the difference is the newline translation")

    def test_the_wizard_job_really_walks_the_wizard(self):
        """The positive control, and this corpus needs one more than most: every assertion
        above is an equality between two probes, and two probes that both printed nothing
        and returned null would satisfy all of them.

        It names the parts a silent port could not have produced — a menu line, the
        `(default)` marker on the PRE-SELECTED deployed value, the plan, and the selection
        itself — and it asserts the DEPLOYED defaults specifically, because those are what
        `installedDefaults`' three new keys feed."""
        out = self.runs["wizard-eof"][0].decode("utf-8")
        self.assertIn("Geneseed setup — answer a few questions", out)
        self.assertIn("1) neutral — plain professional voice", out)
        # The seeded install's five markers, each pre-selected. Theme and footprint come off
        # marker FILES, posture and mode are content-detected out of the carrier, and the
        # emit marker says `claude-global` while the install sits in the OpenCode config dir
        # — so a port that inferred the emit from the DIRECTORY answers `opencode-global`.
        self.assertIn("pirate — high-seas crew   (default)", out)
        self.assertIn("artisan — peer with toolsmith reflexes — terminal-first   (default)",
                      out)
        self.assertIn("foreman — triages tasks, spawns pipelines for substantial work   "
                      "(default)", out)
        self.assertIn("claude-global — Claude Code global config dir", out)
        self.assertIn("full — Full — every law's complete text inlined", out)
        self.assertIn("About to run:  python build.py --theme pirate --emit claude-global "
                      "--footprint full --posture artisan --mode foreman", out)
        self.assertIn('{"theme":"pirate","posture":"artisan","mode":"foreman",'
                      '"emit":"claude-global"', out)
        # And the two probes agree on all of it, which is the equality above restated at the
        # one place a reader of this test can check by eye.
        self.assertEqual(self.runs["wizard-eof"][1].decode("utf-8"), out)

    def test_the_declined_wizard_returns_null_and_the_confirmed_one_does_not(self):
        """`_collect_setup_lines` returns None when the confirm is declined, and that is the
        difference between `[setup] cancelled` and a build. Two jobs differing in one
        character of stdin — the `n` — must differ in exactly that."""
        declined = self.runs["wizard-declined"][0].decode("utf-8")
        accepted = self.runs["wizard-defaults"][0].decode("utf-8")
        self.assertTrue(declined.endswith('{"results":[null]}'), declined[-60:])
        self.assertFalse(accepted.endswith('{"results":[null]}'))
        self.assertIn('"footprint":"full"}]}', accepted)

    def test_the_choice_corpus_reaches_all_three_fallback_arms(self):
        """The measurement behind `pyInt`, in both directions.

        A menu answered only with digits and blanks never separates "parsed and out of
        range" from "unparseable", and the key-match arm is unreachable when every answer
        parses. This asserts that the corpus actually produced one of each — otherwise a
        port that dropped the `int` entirely and matched keys first would be green."""
        out = self.runs["ask-choice"][0].decode("utf-8")
        tail = out[out.rindex('{"results"'):]
        chosen = json.loads(tail)["results"]
        self.assertEqual(chosen, [
            "gamma",   # `3` — an in-range index
            "beta",    # empty — the default
            "beta",    # `9` — parsed, out of range
            "gamma",   # `gamma` — unparseable, matched as a key
            "beta",    # `nosuch` — unparseable, no key
            "alpha",   # `0` — parsed, out of range, so the keys are NEVER consulted
            "beta",    # `٢` — a Unicode decimal is an index to `int`
            "alpha",   # EOF — the default
        ])

    def test_a_numeric_key_is_resolved_as_an_index_and_not_as_a_key(self):
        """The control for the numeric-key menu, and it names the answer rather than only
        comparing: an index and a key that spell the same string are the ONE input that
        separates the two fallback orders, and a corpus that merely contained it without
        asserting the outcome would still pass if both implementations flipped together."""
        out = self.runs["ask-choice-numeric-keys"][0].decode("utf-8")
        chosen = json.loads(out[out.rindex('{"results"'):])["results"]
        self.assertEqual(chosen, ["1", "2"],
                         "`2` was resolved as the option NAMED 2 rather than as the second "
                         "index, so the key match is running before the int parse")

    def test_the_summary_job_produces_rows_and_not_an_empty_list(self):
        """The positive control for `setup_summary_lines`, and for the three keys P5i added
        to `installedDefaults` — the last case in that job is the detector itself."""
        out = self.runs["summary"][0].decode("utf-8")
        results = json.loads(out[out.rindex('{"results"'):])["results"]
        self.assertEqual(len(results), 7)
        self.assertEqual(results[0][0], ["ok", results[0][0][1]])
        self.assertIn("AGENT.md written to", results[0][0][1])
        self.assertEqual(results[1][0][0], "warn")
        self.assertIn("build failed", results[1][0][1])
        self.assertTrue(any(r[0] == "warn" and "a global install exists at" in r[1]
                            for r in results[2]),
                        "the bundle case did not reach the global-install warning, so that "
                        "branch is not covered")
        self.assertTrue(any("Java 21+ (jdtls)" in r[1] for r in results[4]),
                        "the opencode PROJECT emit did not reach the LSP rows")
        self.assertFalse(any("Java 21+ (jdtls)" in r[1] for r in results[3]),
                         "a claude emit reached the LSP rows, which are opencode-only")
        self.assertEqual(results[6], {"theme": "pirate", "posture": "artisan",
                                      "mode": "foreman", "emit": "claude-global",
                                      "footprint": "full"})


@unittest.skipIf(shutil.which("node") is None, "node is not on PATH")
class ThePureFunctionsAgreeOnEveryInputNoCellCanBuild(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        tmp = Path(cls._tmp.name)
        cls.cases = _cases() + _manifest_cases(tmp) + _which_cases(tmp)
        cls.out = {}
        for ascii_mode in (False, True):
            cls.out[ascii_mode] = (
                _run([sys.executable, str(PY_PROBE)], cls.cases, ascii_mode),
                _run(["node", str(JS_PROBE)], cls.cases, ascii_mode),
            )

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def test_every_case_agrees_in_both_glyph_modes(self):
        for ascii_mode, (ref, new) in self.out.items():
            self.assertEqual(len(ref), len(self.cases))
            self.assertEqual(len(new), len(self.cases))
            for case, a, b in zip(self.cases, ref, new):
                with self.subTest(ascii=ascii_mode, fn=case["fn"], args=case["args"]):
                    self.assertEqual(a, b)

    def test_the_probes_produce_the_panel_and_not_an_empty_echo(self):
        """The positive control. Every assertion above is an EQUALITY between two probes,
        and two probes that both returned nothing would satisfy all of them — the same hole
        `test_remove_unwires_what_add_wired` closes beside P5c's ownership gate."""
        ref, new = self.out[False]
        idx = {id(c): i for i, c in enumerate(self.cases)}
        first_panel = ref[idx[id(self.cases[0])]]
        self.assertIsInstance(first_panel, list)
        self.assertIn("┌─ ◆ Geneseed — status ", first_panel[0])
        self.assertTrue(any("17 agents · 47 skills · 37 laws" in ln for ln in first_panel))
        self.assertTrue(any("✓ up to date" in ln for ln in first_panel))

        # The COLOURED variant of the same dict — the branch that exists only here. Yellow
        # is imperial's accent (33), and the verdict line carries the up-to-date green (32).
        coloured = ref[1]
        self.assertIn("\x1b[33m", coloured[0])
        self.assertIn("\x1b[33;1m", coloured[0])
        self.assertTrue(any("\x1b[32m" in ln for ln in coloured))
        self.assertNotEqual(first_panel, coloured,
                            "the colour argument changed nothing, so this corpus is not "
                            "covering the branch it exists for")
        self.assertEqual(new[1], coloured)

        # And the ASCII overlay really swaps glyphs rather than being ignored.
        ascii_panel = self.out[True][0][0]
        self.assertIn("* Geneseed - status", ascii_panel[0])
        self.assertNotIn("◆", "".join(ascii_panel))
        self.assertEqual(self.out[True][1][0], ascii_panel)

    def test_the_fence_corpus_actually_varies_the_fence(self):
        """The positive control for `fence_for`, and it needs one for a specific reason.

        The whole point of these cases is that the LIVE tree never leaves the floor, so a
        corpus whose every case also returned four backticks would be an equality between
        two constants — green forever, and green on a port that hardcoded the floor. This
        asserts the corpus reaches past it, and names both arms.
        """
        ref, new = self.out[False]
        fences = [a for case, a in zip(self.cases, ref) if case["fn"] == "fence_for"]
        self.assertEqual(fences, [b for case, b in zip(self.cases, new)
                                  if case["fn"] == "fence_for"])
        self.assertIn("`" * 4, fences, "no case exercises the max(4, ...) floor")
        self.assertTrue(any(len(f) > 4 for f in fences),
                        "every case returned the floor — this corpus cannot tell "
                        "`_fence_for` from a hardcoded four backticks")
        self.assertEqual(max(len(f) for f in fences), 13)   # the 12-run case, + 1

    def test_the_fence_corpus_still_describes_the_real_tree(self):
        """`js/generate.mjs` states that no CELL can vary the fence, and that is a claim
        about the CONTENT of `src/` rather than about the code — so it is re-derived here
        instead of trusted. The day a source file grows a four-backtick run the claim stops
        holding, a `prompt` cell becomes able to cover the branch, and this fails to say so.
        """
        sys.path.insert(0, str(ROOT))
        import build  # noqa: PLC0415  (the checkout's own generator, not a dependency)
        _, items = build.render_all("neutral")
        longest, where = 0, None
        for rel, text, _src in items:
            if text is None:
                continue
            for m in re.finditer(r"`+", text):
                if len(m.group()) > longest:
                    longest, where = len(m.group()), rel
        self.assertLess(longest, 4,
                        f"{where} now holds a run of {longest} backticks, so `_fence_for` "
                        f"no longer always returns the floor and the matrix CAN cover it — "
                        f"write the prompt cell and relax this test")

    def test_the_diff_corpus_reaches_past_what_a_cell_can_seed(self):
        """The positive control for `unifiedDiff`, and it has to assert three things.

        A corpus of pairs that all differ trivially would be an equality between two
        one-hunk diffs — green on any correct implementation, and green on one that got
        `autojunk` or the tie rule wrong. So: some case must produce MORE THAN ONE hunk (the
        grouping path and the `i2-i1 > nn` split), some case must be at or past the 200-line
        autojunk threshold, and some case must produce no output at all (two identical
        sequences yield an empty diff, not a header).
        """
        ref, new = self.out[False]
        diffs = [(c, a) for c, a in zip(self.cases, ref) if c["fn"] == "unified_diff"]
        self.assertEqual([a for _, a in diffs],
                         [b for c, b in zip(self.cases, new) if c["fn"] == "unified_diff"])
        hunks = [sum(1 for ln in a if ln.startswith("@@")) for _, a in diffs]
        self.assertTrue(any(h > 1 for h in hunks),
                        "no case produces two hunks, so the grouping path is untested")
        self.assertTrue(any(h == 0 for h in hunks),
                        "no case produces an EMPTY diff, so 'identical' is untested")
        self.assertTrue(
            any(len(c["args"][1]) >= 200 for c, _ in diffs),
            "no case reaches the 200-element autojunk threshold, so this corpus cannot "
            "tell SequenceMatcher from a diff that never purges popular elements — which "
            "is the one difference no acceptance cell can see either")
        # And the threshold cases must actually DIFFER from each other, or "reaches 200" is
        # a length assertion about the input rather than a claim about the output.
        long_diffs = [a for c, a in diffs if len(c["args"][1]) >= 200 and a]
        self.assertTrue(long_diffs, "every long case produced an empty diff")

    def test_the_splitlines_corpus_separates_python_boundaries_from_a_newline_split(self):
        """`pySplitLines` exists for the boundaries `split('\\n')` does not break on. A corpus
        without one of those is an equality between two `split('\\n')`s."""
        cases = [c["args"][0] for c in self.cases if c["fn"] == "py_split_lines"]
        extra = [s for s in cases if len(s.splitlines()) != len(s.split("\n"))]
        self.assertTrue(extra, "no case in this corpus breaks on a boundary `split('\\n')` "
                               "misses, so the pySplitLines gate is vacuous")

    def test_the_capitalize_corpus_has_a_case_where_the_rest_matters(self):
        """`str.capitalize()` lowercases the REST; `s[0].toUpperCase() + s.slice(1)` does
        not. Every shipped posture and mode name is already lowercase, so the difference is
        invisible in the live tree — which is the whole reason this is a corpus."""
        cases = [c["args"][0] for c in self.cases if c["fn"] == "py_capitalize"]
        naive = [s for s in cases if s and s.capitalize() != s[0].upper() + s[1:]]
        self.assertTrue(naive, "no case distinguishes str.capitalize() from a naive "
                               "uppercase-first, so this corpus proves nothing")

    def test_the_corpus_separates_code_points_from_utf16_units(self):
        """`len()` is the reason this corpus has astral characters in it, and a corpus
        without one cannot tell the two lengths apart. Measured here rather than trusted:
        at least one case must be a string whose two lengths DIFFER."""
        astral = [c for c in self.cases
                  if c["fn"] == "py_len" and len(c["args"][0]) != len(
                      c["args"][0].encode("utf-16-le")) // 2]
        self.assertTrue(astral, "no case in this corpus distinguishes code points from "
                                "UTF-16 units, so the pyLen gate is vacuous")

    def test_the_is_absolute_corpus_reaches_the_rootless_shape(self):
        """`pyIsAbsolute` exists for ONE disagreement: a rootless `/x` or `\\x`, which
        `path.isAbsolute` calls absolute and `Path.is_absolute` does not. A corpus without
        one is an equality between two spellings of the same rule — and on POSIX the two
        rules genuinely coincide, so this asserts the SHAPE is present rather than that the
        answers differ on this machine."""
        cases = [c["args"][0] for c in self.cases if c["fn"] == "py_is_absolute"]
        rootless = [s for s in cases
                    if s[:1] in ("/", "\\") and not s.startswith(("//", "\\\\"))]
        self.assertTrue(rootless, "no case in this corpus is a ROOTLESS absolute path, so "
                                  "the pyIsAbsolute gate cannot tell the two rules apart")
        drive_rel = [s for s in cases if re.match(r"^[A-Za-z]:[^\\/]", s)]
        self.assertTrue(drive_rel, "no case is drive-RELATIVE (`C:x`), which is the shape a "
                                   "naive `parse().root !== ''` rule gets wrong")

    def test_the_agent_entry_corpus_can_see_the_absolute_rule_it_depends_on(self):
        """`installAgentEntryOf` SKIPS an absolute entry, so a corpus whose lists hold only
        relative ones exercises the first-match walk and never the predicate. At least one
        case must pair a rootless-absolute entry with a relative one, which is the only
        shape where the two `is_absolute` rules return different ENTRIES."""
        lists = [c["args"][0] for c in self.cases if c["fn"] == "install_agent_entry_of"]
        both = [ls for ls in lists
                if any(isinstance(e, str) and e[:1] in ("/", "\\") for e in ls)
                and any(isinstance(e, str) and e[:1] not in ("/", "\\") for e in ls)]
        self.assertTrue(both, "no case pairs a rootless-absolute entry with a relative one, "
                              "so this corpus cannot see which rule the walk applied")


if __name__ == "__main__":
    unittest.main()
