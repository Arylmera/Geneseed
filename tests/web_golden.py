#!/usr/bin/env python3
"""Web acceptance harness — prove two web SERVERS behave the same.

    python tests/web_golden.py                                   # determinism self-check
    python tests/web_golden.py --new "node js/web/server.mjs"     # the P6 gate
    python tests/web_golden.py --only guard --limit 20            # while iterating

WHY A THIRD HARNESS. `tests/golden.py` compares the TREE a generator writes.
`tests/harness_golden.py` compares one VERB invocation on stdout/stderr/exit/files.
Neither question transfers to an HTTP endpoint: nothing is written, the process does not
exit, and the whole observable is a response. So a cell here is

    one seeded world + one SEQUENCE of requests against a freshly started server,
    compared on
      * the status line
      * the response BODY, as BYTES
      * the response HEADERS that carry behaviour
      * the daemon record the running server wrote
      * the server's own stdout/stderr, and every file it left behind

and the two sides are two SERVER PROCESSES, started and driven and stopped, twice per
cell.

WHY NOT CALL `api_X(state)` IN PROCESS. That is how all 136 tests in `tests/test_web.py`
reach their assertions, and it is worth having — the API functions are pure-ish over a
`WebState` and a corpus over them is the right gate for their bodies. It just cannot see
any of `_web_server.py`: not the routing, not the CSRF check, not the DNS-rebinding guard,
not the 403/404/409/501 conventions, not gzip negotiation, not keep-alive, and not the
token injected into `index.html`. Those are the 654 lines this harness exists for. Cells
for the shell, corpus for the functions — the same split P5 made.

THE CONNECTION IS REUSED ACROSS A CELL'S REQUESTS, deliberately. `do_POST` drains the
request body BEFORE routing, and its comment says why: under keep-alive an unread body is
parsed as the next request line, and both guards answer without reading it. A harness that
opened a fresh socket per request could not observe that at all, and
`protocol_version = "HTTP/1.1"` would be untested. A request can ask for a fresh
connection with `reconnect=True`; nothing does yet.

FOUR THINGS ARE FRESH PER RUN AND ALL FOUR HAVE TO BE DESTAMPED. The CSRF token
(`secrets.token_urlsafe(24)`), the port (both sides bind 0 — a fixed 4747 would collide
with the developer's own daemon, which is a real and very confusing failure mode), the
pid, and the `started` second. They appear in the daemon record, in the served
`index.html`, in the server's stdout and in the request headers, so each is replaced in
every spelling it can take — see `_dyn_stamps`, and note the replacements are TARGETED
(`"port": 4747`, not `4747`) because a bare port number would also match a
Content-Length.

A COMPRESSED BODY IS THE ONE THING HERE THAT CANNOT BE COMPARED AS BYTES, and it would
have read as a port bug twice over. The member header carries a clock and an OS byte the
two runtimes spell differently, and — measured, after a small payload matched by luck —
the DEFLATE streams differ too: 753 bytes against 751 for the same 1.5 kB input at the
same level. That is the zlib build each runtime links, which neither implementation chose
and no port can fix. So `_decode_body` inflates it and compares what a client actually
ends up with, and the compressed length is normalised to a tag so its PRESENCE stays
gated. Everything uncompressed is still compared byte for byte.

AND A DESTAMP CANNOT REACH INSIDE ONE, which decides a cell rather than the harness: the
token is injected into `index.html` before compression and its 32 random characters
compress to a different LENGTH every run, so the reference differed from itself. The gzip
pair therefore runs over a payload carrying no per-run value. `/api/themes` is the JSON
side of the same pair for the same reason — it is the one body over `_GZIP_MIN` that
carries no path, no clock and no token.

THREE MORE VALUES ARE PER-RUN, AND THEY LIVE IN A BODY RATHER THAN IN THE RECORD.
`checked_at` and `build_time` are both `%Y-%m-%d %H:%M` sampled while the cell runs, and
the two sides run seconds apart — a cell straddling a minute boundary would fail at
random. `python` is `sys.version.split()[0]`, which a Node daemon has no honest answer for
(see `js/web/api.mjs`; it answers `null`). All three are normalised by `_WEB_STAMPS`, and
each pattern matches only a WELL-FORMED value, so a side that stopped emitting the field
leaves the tag absent and the cell's `expect` fails instead of quietly agreeing. The value
`python` is tolerant of has its absolute assertion in
`tests/test_web_server.py::test_the_reference_reports_its_own_interpreter_version`.

SAFETY. Every cell runs under `golden.cell_env`, so the server resolves its target inside
a throwaway HOME. And every server this file starts is stopped in a `finally`: `web/` has
a recorded operational failure where a foreground server leaves no record, `web stop`
misses it, and a second daemon orphans on the port — a harness that leaked one process per
failed cell would eat the port and then the machine.
"""
from __future__ import annotations

import argparse
import gzip
import http.client
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import golden            # noqa: E402  (needs tests/ on the path first)
import harness_golden    # noqa: E402

ROOT = golden.ROOT

# The headers a cell compares. Not all of them: `Date` and `Server` differ by construction
# (Python sends `BaseHTTP/0.6 Python/3.13.x`, Node sends neither) and `Connection` /
# `Keep-Alive` are the runtime's own transport bookkeeping. These five are the ones the
# handler CHOOSES, so they are the ones a port can get wrong. Compared in the order the
# server sent them, which gates their relative order without gating the noise around them.
_HEADERS = ("Content-Type", "Content-Length", "Content-Encoding", "Vary", "Cache-Control")

# The per-run values that live in a RESPONSE BODY rather than in the daemon record, so
# `_dyn_stamps` (which reads its values out of that record) cannot reach them.
#
# TARGETED, like every stamp in this file, and targeted twice over: each pattern names the
# FIELD and requires a well-formed VALUE. `"checked_at": "2026-08-09 18:42"` is rewritten;
# `"checked_at": null` is not, and neither is a bare `2026-08-09 18:42` appearing in some
# other field. That is what lets a cell assert the tag is PRESENT — a side that answered
# null, or an empty string, or a differently-formatted clock, would leave no tag and fail
# the `expect` rather than compare equal to nothing.
_WEB_STAMPS = (
    (re.compile(r'"checked_at": "\d{4}-\d{2}-\d{2} \d{2}:\d{2}"'), '"checked_at": "<WHEN>"'),
    (re.compile(r'"build_time": "\d{4}-\d{2}-\d{2} \d{2}:\d{2}"'), '"build_time": "<WHEN>"'),
    # The one field in P6b with no honest twin: the reference reports the interpreter
    # running the daemon and a Node daemon has none. Both spellings are accepted so the
    # tag appears on both sides; the reference's actual value is asserted absolutely in
    # `tests/test_web_server.py`, which is the debt a tolerant comparison owes.
    (re.compile(r'"python": (?:"\d+\.\d+\.\d+[^"]*"|null)'), '"python": "<RUNTIME>"'),
)


# ---- P6e's two seeded inputs that are not files: a CLOCK and a PID ----------------------
#
# `_is_live(entry, now)` compares `now - entry["updated_at"]` against
# `ACTIVITY_STALE_SECONDS` (1800) AND probes the writer's pid. Neither input is something a
# request can carry, and both are the kind a destamp would ERASE rather than gate: normalise
# `updated_at` and the live/stale split becomes invisible, which is P6b's lesson about the
# clock applied one endpoint later.
#
# So they are SEEDED instead, and the seed is shared: `compare` samples one `now` per cell
# and hands the SAME value to both sides, so the two runs read identical bytes off disk and
# the comparison stays exact — no third destamp, and `updated_at` is compared as the number
# it is.
#
# WHAT THIS CANNOT REACH, said out loud: the exact `<=` boundary. The server samples its own
# `time.time()` when the request arrives, one to three seconds after the seed is written, so
# an entry seeded at `now - 1800` is already past 1800 by the time it is read. The margins
# below are wide on purpose (0 and 600 seconds live, 3600 stale) and the off-by-one in the
# comparison operator is the one rule here no cell can gate.
#
# `_LIVE_PID` is this harness's OWN pid — alive for the whole run, and identical on both
# sides because both runs happen in this process. `_DEAD_PID` is a positive integer no
# operating system can have handed out: Linux caps `pid_max` at 4,194,304 and Windows pids
# are DWORDs that never come near two billion. It is deliberately not 0 and not -1 — 0 hits
# `_pid_alive`'s own `pid <= 0` guard before any syscall (which is its own seeded case), and
# a negative would be `kill(-1)` on POSIX, which signals every process the user owns.
_DEAD_PID = 2000000000


def _web_destamp(data: bytes) -> bytes:
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return data
    for pat, repl in _WEB_STAMPS:
        text = pat.sub(repl, text)
    return text.encode("utf-8")


# ---- cells -----------------------------------------------------------------

def _req(method="GET", path="/api/ping", headers=None, body=None, reconnect=False,
         token=False):
    """One request. `token=True` sends the running server's real CSRF token, which the
    cell cannot know when it is written."""
    return {"method": method, "path": path, "headers": dict(headers or {}),
            "body": body, "reconnect": reconnect, "token": token}


def _an_asset() -> str:
    """One real file under `web/dist/assets/`, resolved rather than named.

    Every name in there is content-hashed, so a hardcoded one breaks the day the UI is
    rebuilt — and it would break as a MISSING FILE served as the SPA fallback, which is a
    200 and reads like a pass on the wrong cell.
    """
    names = sorted(p.name for p in (ROOT / "web" / "dist" / "assets").glob("*.js"))
    if not names:
        raise RuntimeError("web/dist/assets holds no .js — the static cells cannot be built")
    return names[0]


# ---- the seeded worlds P6b's endpoints read -------------------------------------------
#
# A deployed opencode-global install, as every detector in the harness recognises one: the
# emit marker names the host, the theme marker names the voice, the manifest is what
# `_deployed` and `_diff_collect` look for, and the version marker is what `status`
# compares. `imperial` rather than `neutral` deliberately — `neutral` is also the FALLBACK
# every one of those detectors returns when it finds nothing, so a cell seeded with it
# cannot tell detection from default.
_OC = "home/.config/opencode"
# A fingerprint no source render can ever produce, so the version verdict is the stable
# "differs" arm rather than a race against whatever the checkout currently hashes to.
_VERSION = "0000000000000000"
_DEPLOYED_AGENT = "# Deployed AGENT.md\n\nA local edit the source render does not have.\n"


def _installed(**extra) -> dict:
    return dict({
        "repo/.keep": "",
        f"{_OC}/.geneseed-manifest.json": json.dumps({"owned": ["AGENT.md"]}),
        f"{_OC}/.geneseed-emit": "opencode-global\n",
        f"{_OC}/.geneseed-theme": "imperial\n",
        f"{_OC}/.geneseed-version": _VERSION,
        f"{_OC}/AGENT.md": _DEPLOYED_AGENT,
    }, **extra)


def cells() -> list[dict]:
    """The matrix. `argv` are extra flags for the server under test; `world` seeds the
    sandbox before it starts."""
    def cell(cid, requests, **kw):
        return {"id": cid, "requests": requests, **kw}

    out = [
        cell("ping/answers-ok-and-the-detected-theme", [_req()],
             # The whole of P6a's payload endpoint, and the shape every later cell reuses:
             # a body compared as bytes, so the serialiser is gated here rather than argued.
             # `', '` and `': '` are Python's DEFAULT separators — the reason this reads
             # spaced and not compact.
             expect=['{"ok": true, "theme": "neutral"}', "200 OK"]),
        cell("ping/the-theme-flag-reaches-the-body", [_req()], argv=["--theme", "imperial"],
             # The flag VARIED rather than merely reachable: with only the cell above, a
             # port that hardcoded "neutral" would pass. P5's tenth coverage hole.
             expect=['"theme": "imperial"']),

        cell("guard/a-forged-host-is-refused-on-get",
             [_req(headers={"Host": "evil.example.com"})],
             # `_local_host` is a DNS-rebinding guard: a page whose own hostname resolves
             # to 127.0.0.1 becomes same-origin and can read the token out of index.html.
             # One request with a forged header is the whole gate, and it is the kind of
             # security branch a later sub-phase would assume someone else had covered.
             expect=['{"error": "forbidden host"}', "403 Forbidden"]),
        cell("guard/a-forged-host-beats-a-valid-token-on-post",
             [_req("POST", path="/api/shutdown", headers={"Host": "evil.example.com"},
                   body=b"{}", token=True)],
             # The host guard is not excused by authentication: a request from a rebound
             # page would carry the real token, because reading it out of index.html is
             # exactly what the guard exists to stop.
             expect=['{"error": "forbidden host"}']),
        cell("guard/the-two-refusals-are-ordered-host-first",
             [_req("POST", path="/api/shutdown", headers={"Host": "evil.example.com"},
                   body=b"{}")],
             # A request failing BOTH checks is the only one that can tell their order
             # apart, and the cell above could not: with a valid token, host-first and
             # token-first answer identically. M2 — swapping the two — survived until this
             # cell existed. `expect_absent` distinguishes them by the closing brace, since
             # `forbidden host` contains `forbidden`.
             expect=['{"error": "forbidden host"}'],
             expect_absent=['{"error": "forbidden"}']),
        cell("guard/a-post-without-the-token-is-refused",
             [_req("POST", path="/api/shutdown", body=b"{}")],
             expect=['{"error": "forbidden"}', "403 Forbidden"]),
        cell("guard/a-post-with-the-wrong-token-is-refused",
             [_req("POST", path="/api/shutdown", body=b"{}",
                   headers={"X-Geneseed-Token": "not-the-token"})],
             expect=['{"error": "forbidden"}']),

        cell("keepalive/a-rejected-post-does-not-eat-the-next-request",
             [_req("POST", path="/api/shutdown", body=b'{"padding": "' + b"x" * 200 + b'"}'),
              _req()],
             # THE two-request cell. The rejected POST's body is drained before routing;
             # without that drain the 210 unread bytes sit in the socket and the GET that
             # follows is parsed out of the middle of them. Invisible to any harness that
             # opens a fresh connection per request, which is why this one does not.
             expect=['{"error": "forbidden"}', '{"ok": true, "theme": "neutral"}']),

        cell("static/index-html-carries-the-injected-token",
             [_req(path="/")],
             # The token is injected per request rather than baked, so the served bytes
             # differ from the file on disk. `<TOKEN>` is what the destamp leaves.
             expect=['window.__GENESEED_TOKEN__="<TOKEN>"', "Cache-Control: no-store",
                     "Content-Type: text/html"]),
        cell("static/an-unknown-path-falls-back-to-index",
             [_req(path="/agents/some-agent")],
             # The SPA fallback: a client-side route is not a file, and it must not 404.
             expect=["window.__GENESEED_TOKEN__=", "Content-Type: text/html"]),
        cell("static/a-path-climbing-out-of-dist-falls-back-to-index",
             [_req(path="/../../build.py")],
             # `dist not in fp.parents` is the containment check. A port that only
             # normalised the string would serve the repo's own source here.
             expect=["Content-Type: text/html"],
             expect_absent=["def main(", "argparse"]),

        cell("gzip/a-body-under-the-threshold-stays-uncompressed",
             [_req(headers={"Accept-Encoding": "gzip"})],
             # `_GZIP_MIN` is 1024 and a ping body is ~30 bytes: the client ASKED and the
             # server declined. The negative half of the pair below.
             expect=["200 OK"], expect_absent=["Content-Encoding"]),
        # NOT index.html, and the self-check is what said so. A DESTAMP CANNOT REACH INSIDE
        # A COMPRESSED BODY: the token is injected before compression, its 32 random
        # characters compress to a different length every run, and the reference differed
        # from ITSELF by three bytes here. So the gzip pair runs over a payload with no
        # per-run value in it. `sw.js` is 1.5 kB, above `_GZIP_MIN`, and its name is stable
        # across UI rebuilds where every name under `assets/` is content-hashed.
        cell("gzip/a-static-script-over-the-threshold-is-compressed",
             [_req(path="/sw.js", headers={"Accept-Encoding": "gzip"})],
             expect=["Content-Encoding: gzip", "Vary: Accept-Encoding",
                     "Content-Type: text/javascript"]),
        cell("gzip/the-same-request-without-accept-encoding-is-not",
             [_req(path="/sw.js")],
             # The flag varied in both directions over ONE payload — the only shape that
             # tells "never compresses" from "always compresses" apart.
             expect=["Content-Type: text/javascript"], expect_absent=["Content-Encoding"]),

        cell("static/an-asset-is-cached-forever",
             [_req(path=f"/assets/{_an_asset()}")],
             # Vite content-hashes everything under `/assets/`, so the URL changes whenever
             # the bytes do and caching forever is safe. The other arm of the same `elif`
             # index.html's `no-store` covers.
             expect=["Cache-Control: public, max-age=31536000, immutable"]),

        cell("shutdown/the-stop-endpoint-answers-before-it-stops",
             [_req("POST", path="/api/shutdown", body=b"{}", token=True)],
             # The one POST route the SHELL owns (the rest are P6b-P6g). It answers, then
             # stops the server off the request path — the response must arrive first.
             expect=['{"stopping": true}', "200 OK"]),
    ]
    out += _read_cells(cell)
    out += _catalog_cells(cell)
    out += _docs_cells(cell)
    out += _graph_cells(cell)
    out += _activity_cells(cell)
    return out


# The body of a deployed-only skill, which is the ONE arbitrary text `api_graph` will parse
# that a cell gets to write. Everything else it reads is the checkout.
#
# `probe` has no counterpart in `src/`, so `src_body.get(node, e["body"])` takes its FALLBACK
# arm and this text is what the edge walk sees — which makes it the corpus P6d would have
# written as a corpus, run through the real endpoint instead. Each line is an axis:
#
#   * `[[wayfinder]]` twice — the `seen` de-duplication; `[[probe]]` — the `dst != src`
#     guard; `[[nowhere]]` — a name not in `known`.
#   * `[council](council.md)` and `[plan](../skills/plan.md)` — MDLINK_RE and its
#     `rsplit("/", 1)[-1]`, which is why the second one resolves at all.
#   * `Dictate III` / `dictate IV` — the THEMED law noun, and IGNORECASE on the noun.
#     `Rule V` / `Law VI` — the canonical fallback pair, which under `imperial` is the only
#     thing that makes them match and which a port keyed on the theme alone would drop.
#   * `dictate vii` — IGNORECASE does NOT extend to the numeral: `m.group(1)` comes back
#     `vii` and `law_nums` holds `VII`, so this one is dropped. The pair with `dictate IV`
#     is what says so.
#   * `DictateVIII` (no space), `Dictate ZZZ` (not a numeral), `Dictate MMM` (a well-formed
#     numeral no law has) — three ways to be refused.
#   * THE BOUNDARY. `\b` is UNICODE-aware in Python and ASCII-only in JS, so `eDictate` with
#     an accent, a digit, a trailing `_` and a CJK character are four inputs where a literal
#     `\b` in the port answers differently from the reference. All four must produce nothing.
#   * THE SPACING. `\s` is not the same class in the two languages (P6d measured it):
#     U+001C and U+0085 are whitespace to Python and not to JS, U+FEFF is the reverse. So
#     XVIII/XIX/XXI must appear and XX must not.
_GRAPH_PROBE_BODY = (
    "---\nname: probe\n---\n\n> a probe\n\n"
    "Wikilinks: [[wayfinder]] and [[wayfinder]] again, [[probe]] itself, [[nowhere]].\n"
    "Markdown: [council](council.md) and [plan](../skills/plan.md) and [gone](gone.md).\n"
    "Themed: Dictate III, dictate IV. Canonical: Rule V and Law VI.\n"
    "Refused: dictate vii, DictateVIII, Dictate ZZZ, Dictate MMM.\n"
    "Boundary: éDictate XIV, Dictate XVé, 3Dictate XVI, Dictate XVII_, "
    "一Dictate XXII.\n"
    "Spacing: Dictate XVIII, DictateXIX, Dictate﻿XX, DictateXXI.\n"
)


def _graph_cells(cell) -> list[dict]:
    """P6e — `/api/graph`, whose two halves read two different inventories.

    THE SUBTLETY IS THE WHOLE PHASE. Nodes come from `state.inventory` — the DEPLOYED set on
    a deployed install — and edges are parsed from the SOURCE render's bodies, because
    deploying a skill flattens its `[…](….md)` markup to prose. A port that walked one
    inventory for both would answer a single-banded matrix on a deployed install and every
    cell over an UNDEPLOYED one would still pass, since there the two inventories are the
    same object. So the first cell deploys, and seeds a skill (`wayfinder`) whose deployed
    body carries no links at all while its source body carries four.

    AND THE LAW PATTERN IS THEME-DEPENDENT. `_law_ref_re` builds its alternation from the
    theme's own word for a law, so `imperial` prose says "Dictate III" where `neutral` says
    "Rule III". Measured: a hardcoded `Rule|Law` finds 46 references in the neutral render's
    law bodies and ZERO in the imperial one. One cell per voice, or the edge set is gated
    for one of the two and the other silently returns nodes with nothing between them.
    """
    return [
        cell("graph/nodes-come-from-the-deployed-set-and-edges-from-the-source-render",
             [_req(path="/api/graph")],
             world=_full(**{
                 # Two skills whose SOURCE bodies `wayfinder` links to. They are seeded here
                 # only so those links have somewhere to land: `add_edge` drops a target
                 # that is not in `known`, and `known` is the deployed set.
                 f"{_OC}/skills/council/SKILL.md":
                     "---\nname: council\n---\n\n> deployed council\n\nflat prose.\n",
                 f"{_OC}/skills/plan/SKILL.md":
                     "---\nname: plan\n---\n\n> deployed plan\n\nflat prose.\n",
                 f"{_OC}/skills/probe/SKILL.md": _GRAPH_PROBE_BODY,
             }),
             expect=[
                 # NODES: the deployed skills, and no agent — `mine` is deployed as both and
                 # the skills loop writes the name map second, so it lands as a skill. The
                 # deployed agent dir holds only `mine` and the `_`-prefixed template.
                 '"nodes": [{"id": "I", "type": "law"}',
                 '{"id": "council", "type": "skill"}, {"id": "mine", "type": "skill"}',
                 '{"id": "probe", "type": "skill"}, {"id": "wayfinder", "type": "skill"}',
                 # THE SEPARATOR. `wayfinder`'s DEPLOYED body is `> shipped\n\nb\n` — no
                 # links, no law references. These four edges can only have come from the
                 # source render, and a port reading the deployed body answers none of them.
                 '{"source": "wayfinder", "target": "council"}',
                 '{"source": "wayfinder", "target": "plan"}',
                 '{"source": "wayfinder", "target": "II"}',
                 # The OTHER arm: `mine` has no source counterpart, so its deployed body is
                 # what gets walked — the `src_body.get(node, e["body"])` fallback.
                 '{"source": "mine", "target": "wayfinder"}',
                 # The probe body's positive axes, in walk order: wikilinks, then markdown
                 # links, then law prose.
                 '{"source": "probe", "target": "wayfinder"}, '
                 '{"source": "probe", "target": "council"}, '
                 '{"source": "probe", "target": "plan"}, '
                 '{"source": "probe", "target": "III"}, '
                 '{"source": "probe", "target": "IV"}, '
                 '{"source": "probe", "target": "V"}, '
                 '{"source": "probe", "target": "VI"}, '
                 '{"source": "probe", "target": "XVIII"}, '
                 '{"source": "probe", "target": "XIX"}, '
                 '{"source": "probe", "target": "XXI"}',
                 # Law-to-law, from the rendered law bodies under the IMPERIAL noun.
                 '{"source": "XII", "target": "V"}',
             ],
             expect_absent=[
                 # Every refusal in the probe body, named as the pair it would produce. The
                 # bare numeral would be useless: other sources legitimately cite most of
                 # these.
                 '{"source": "probe", "target": "probe"}',
                 '{"source": "probe", "target": "nowhere"}',
                 '{"source": "probe", "target": "gone"}',
                 '{"source": "probe", "target": "vii"}',
                 '{"source": "probe", "target": "VII"}',
                 '{"source": "probe", "target": "VIII"}',
                 '{"source": "probe", "target": "MMM"}',
                 '{"source": "probe", "target": "XIV"}',
                 '{"source": "probe", "target": "XV"}',
                 '{"source": "probe", "target": "XVI"}',
                 '{"source": "probe", "target": "XVII"}',
                 '{"source": "probe", "target": "XXII"}',
                 '{"source": "probe", "target": "XX"}',
                 # A second edge for the same pair — `seen` is what stops the duplicate
                 # `[[wayfinder]]` from producing one.
                 '{"source": "probe", "target": "wayfinder"}, '
                 '{"source": "probe", "target": "wayfinder"}',
                 # The deployed agent template, and the agent-typed `mine` the skills loop
                 # overwrote.
                 '"_template"', '{"id": "mine", "type": "agent"}',
             ]),
        cell("graph/the-law-noun-follows-the-theme-and-the-source-render-is-the-node-set",
             [_req(path="/api/graph")], world={"repo/.keep": ""},
             # The neutral voice, over the whole catalogue. Nothing is deployed, so
             # `state.inventory` IS the source render and both halves read the same tree —
             # which is exactly why this cell cannot stand alone and the deployed one above
             # exists. What it adds is the second law noun: these edges come from prose that
             # says "Rule N", and the cell above's come from prose that says "Dictate N".
             expect=['{"id": "wayfinder", "type": "skill"}', '"type": "agent"',
                     '{"source": "XII", "target": "V"}',
                     '{"source": "wayfinder", "target": "council"}'],
             expect_re=[r'"edges": \[\{"source": "[a-z][a-z0-9-]*", "target": ']),
    ]


# ---- the activity surface --------------------------------------------------------------
#
# One seeded world with every arm of `_is_live` and `_read_entry` in it. Written as raw JSON
# TEXT rather than through `json.dumps`, because the placeholders (`{now}`, `{pid}`, …) are
# numbers and would have to be strings to survive a dict — and because two of these files
# are deliberately not JSON at all.
def _act(sid: str, when: str, pid: str, extra: str = "") -> str:
    return ('{"session_id": "%s", "updated_at": %s, "pid": %s%s}\n'
            % (sid, when, pid, (", " + extra) if extra else ""))


_ENRICHED = ('"agent": "wayfinder", "title": "hello", "cwd": "{repo/}", "status": "working", '
             '"model": "opus", "phase": "edit", "turn_started_at": {now}, '
             # `1.0` is the case the whole int/float apparatus exists for: Python's
             # `json.loads` types it float and re-renders it `1.0`, and a Node twin that
             # reached for `JSON.parse` would answer a bare `1`. `bareInts` cannot save it —
             # only reading the file with `parseJson` can.
             '"cost": 1.0, "tokens": 1200, "files": ["a.py"], '
             '"todos": [{"text": "one", "done": false}], "blocked_on": null, "error": null')


def _activity_world(**extra) -> dict:
    return _installed(**{
        # LIVE — the fully-enriched shape, and the newest.
        f"{_OC}/activity/s-live.json": _act("s-live", "{now}", "{pid}", _ENRICHED),
        f"{_OC}/activity/s-live.detail.json": json.dumps({
            "session_id": "s-live-detail-leak", "pid": os.getpid(),
            "timeline": [{"t": 1, "step": "read"}, {"t": 2, "step": "edit"}],
            "files": ["a.py", "b.py", "c.py"],
            "todos": [{"text": "one"}, {"text": "two"}],
            "conversation": [{"role": "user", "text": "hello"},
                             {"role": "assistant", "text": "hi"}]}) + "\n",
        # A TIE on `updated_at`, which is the only thing that can tell a stable sort from an
        # unstable one. `sorted(reverse=True)` keeps the glob order for equal keys, and the
        # glob is sorted by name, so `s-live` must still come first.
        f"{_OC}/activity/s-tie.json": _act("s-tie", "{now}", "{pid}"),
        # LIVE but older — the ordering's positive control.
        f"{_OC}/activity/s-older.json": _act("s-older", "{older}", "{pid}",
                                             '"cost": 0.0, "tokens": 0'),
        # LIVE through a pid written as a STRING. `int(pid)` accepts it; a port comparing
        # types would prune a session that is running.
        f"{_OC}/activity/s-strpid.json": _act("s-strpid", "{now}", '"{pid}"'),
        # STALE — pid alive, clock old. Its DETAIL file must go with it.
        f"{_OC}/activity/s-stale.json": _act("s-stale", "{stale}", "{pid}"),
        f"{_OC}/activity/s-stale.detail.json": '{"timeline": []}\n',
        # DEAD — clock fresh, writer gone. The other half of the `and`.
        f"{_OC}/activity/s-dead.json": _act("s-dead", "{now}", "{deadpid}"),
        # The three refusals INSIDE `_pid_alive`, before any syscall.
        f"{_OC}/activity/s-zero.json": _act("s-zero", "{now}", "0"),
        f"{_OC}/activity/s-nopid.json": '{"session_id": "s-nopid", "updated_at": {now}}\n',
        f"{_OC}/activity/s-badpid.json": _act("s-badpid", "{now}", '"not-a-pid"'),
        # SKIPPED, not pruned: `_read_entry` returns None and the loop `continue`s without
        # unlinking. Two shapes — unparseable, and parseable but not a dict.
        f"{_OC}/activity/s-garbage.json": "this is not json at all\n",
        f"{_OC}/activity/s-notdict.json": "[1, 2, 3]\n",
        # A v1 writer: no enrichment keys at all, and no session_id either, so the file STEM
        # is what names it.
        f"{_OC}/activity/s-min.json": '{"updated_at": {now}, "pid": {pid}}\n',
        **extra,
    })


def _activity_cells(cell) -> list[dict]:
    """P6e — `/api/activity` (GET) and `/api/activity/<sid>`.

    NO CHECKOUT FIXTURE, and measured rather than assumed: `_activity_dir` is
    `<target>/activity` and `_activity_flag` is `<target>/.geneseed-activity`, both inside
    the sandbox, and nothing on this path renders a theme or reads `src/`.

    THE ENDPOINT DELETES, which is new for the web layer and is why `expect_files` /
    `expect_absent_files` arrive with this phase. `_activity_entries` unlinks every snapshot
    it prunes so the directory self-cleans, and that is a side effect the RESPONSE is
    completely silent about: two servers that both stopped unlinking answer identically
    forever. P5h's three directions — what went, what survived, and the listing the snapshot
    compares — are the gate.

    THE POST HALF IS NOT PORTED. `/api/activity` answers both verbs, and `api_activity_toggle`
    is a WRITE, so the path stays in `NOT_PORTED_POST` and the partition test keeps it honest.
    That means the flag can only be READ here, never flipped, so the two flag arms are two
    cells rather than two requests.
    """
    live = [f"home/.config/opencode/activity/{n}.json"
            for n in ("s-live", "s-live.detail", "s-tie", "s-older", "s-strpid", "s-min",
                      "s-garbage", "s-notdict")]
    pruned = [f"home/.config/opencode/activity/{n}.json"
              for n in ("s-stale", "s-stale.detail", "s-dead", "s-zero", "s-nopid",
                        "s-badpid")]
    return [
        cell("activity/live-sessions-are-listed-newest-first-and-the-rest-are-pruned",
             [_req(path="/api/activity")], world=_activity_world(),
             expect=[
                 # Absent flag file → `except OSError: return True`. The default every user
                 # who has never toggled is on.
                 '"enabled": true',
                 '{"session_id": "s-live", "agent": "wayfinder", "title": "hello"',
                 '"cost": 1.0, "tokens": 1200, "files": ["a.py"]',
                 # The v1 defaults, spelled out: the enrichment keys the writer omitted come
                 # back null/0 rather than missing, and the STEM names the session.
                 '{"session_id": "s-min", "agent": null, "title": null, "cwd": null, '
                 '"status": "idle",',
                 '"cost": 0, "tokens": 0, "files": null, "todos": null',
                 '{"session_id": "s-strpid"',
             ],
             expect_absent=[
                 '"s-stale"', '"s-dead"', '"s-zero"', '"s-nopid"', '"s-badpid"',
                 '"s-garbage"', '"s-notdict"',
                 # The `.detail.json` filter. Without it the detail file parses as a
                 # snapshot — it carries a pid and no clock of its own — and this leaks.
                 's-live-detail-leak', '"s-live.detail"',
             ],
             # Newest first, and the tie broken by the glob order rather than by luck.
             expect_re=[r'"s-live".*"s-tie".*"s-older"'],
             expect_files=live, expect_absent_files=pruned),

        cell("activity/a-flag-that-says-no-gates-the-surface-and-prunes-nothing",
             [_req(path="/api/activity")],
             world=_activity_world(**{f"{_OC}/.geneseed-activity": "  No \n"}),
             # `raw not in ("off", "0", "false", "no")` after `.strip().lower()`, so this one
             # value gates the strip, the lower AND a member of the tuple that is not the
             # obvious "off". And the pruning is SHORT-CIRCUITED when the surface is off:
             # every file the cell above deletes is still here, which is the behaviour and
             # not an accident of ordering.
             expect=['{"enabled": false, "activity": []}'],
             expect_absent=['"s-live"'],
             expect_files=live + pruned),

        cell("activity/an-explicit-on-flag-reads-the-same-as-no-flag-at-all",
             [_req(path="/api/activity")],
             world=_installed(**{
                 f"{_OC}/.geneseed-activity": "on\n",
                 f"{_OC}/activity/s-one.json": _act("s-one", "{now}", "{pid}")}),
             # The arm the two cells above cannot reach between them: the flag file EXISTS
             # and is readable, and its content is not one of the four off words. A port that
             # treated any flag file as "off" would pass both of them.
             expect=['"enabled": true', '{"session_id": "s-one"']),

        cell("activity/a-detail-request-merges-the-uncapped-lists-and-the-transcript",
             [_req(path="/api/activity/s-live"), _req(path="/api/activity/s-titled"),
              _req(path="/api/activity/s-baddetail"), _req(path="/api/activity/s-min"),
              _req(path="/api/activity/s-stale"), _req(path="/api/activity/nope"),
              _req(path="/api/activity/a%2Fb"),
              _req(path="/api/activity/..%2F..%2Fleak")],
             world=_activity_world(**{
                 # A title but no detail file: the conversation falls back to the title as
                 # the opening user turn.
                 f"{_OC}/activity/s-titled.json":
                     _act("s-titled", "{now}", "{pid}", '"title": "a titled session"'),
                 # …and a detail file whose two lists are the WRONG TYPE. Both isinstance
                 # guards fire, and the conversation still falls back.
                 f"{_OC}/activity/s-titled.detail.json":
                     '{"timeline": "not-a-list", "conversation": "not-a-list"}\n',
                 # A detail file that is garbage: an empty timeline, and the SNAPSHOT's own
                 # capped lists survive rather than being blanked.
                 f"{_OC}/activity/s-baddetail.json":
                     _act("s-baddetail", "{now}", "{pid}",
                          '"files": ["only.py"], "todos": [{"text": "kept"}]'),
                 f"{_OC}/activity/s-baddetail.detail.json": "}{\n",
                 # The safe-name scheme's POSITIVE CONTROL: `a/b` sanitises to `a_b`, and
                 # this is the file it must find. Without it the request 404s whether the
                 # sanitiser ran or not, which is the shape of refusal cell P6c had to fix.
                 f"{_OC}/activity/a_b.json": '{"updated_at": {now}, "pid": {pid}}\n',
                 # And the traversal's target, which EXISTS and is a live entry: a port that
                 # joined the raw sid would answer it.
                 "home/.config/leak.json":
                     _act("leak", "{now}", "{pid}", '"title": "LEAKED FROM OUTSIDE"'),
             }),
             expect=[
                 '{"session": {"session_id": "s-live", "agent": "wayfinder"',
                 # The detail file's UNCAPPED lists replace the snapshot's capped ones.
                 '"files": ["a.py", "b.py", "c.py"], '
                 '"todos": [{"text": "one"}, {"text": "two"}]',
                 '"timeline": [{"t": 1, "step": "read"}, {"t": 2, "step": "edit"}]',
                 '"conversation": [{"role": "user", "text": "hello"}, '
                 '{"role": "assistant", "text": "hi"}]',
                 # No detail file at all, and a title: the fallback transcript.
                 '"timeline": [], "conversation": [{"role": "user", '
                 '"text": "a titled session"}]',
                 # Garbage detail: the snapshot's own lists are what come back.
                 '"files": ["only.py"], "todos": [{"text": "kept"}]',
                 # No title either — the fallback has nothing to fall back to.
                 '{"session": {"session_id": "s-min"',
                 '"timeline": [], "conversation": []}',
                 # A stale session is a 404 here too: `_is_live` gates the detail as well as
                 # the list, so a pruned id cannot be read back by name.
                 '{"error": "not found: s-stale"}', "404 Not Found",
                 '{"error": "not found: nope"}',
                 # The sanitiser, proved by the file it FINDS.
                 '{"session": {"session_id": "a_b"',
                 '{"error": "not found: ../../leak"}',
             ],
             expect_absent=["LEAKED FROM OUTSIDE",
                            # The capped spelling, which must have been replaced.
                            '"files": ["a.py"], "todos": [{"text": "one", "done": false}]'],
             ),
    ]


def _docs_cells(cell) -> list[dict]:
    """P6d — `/api/docs` and `/api/docs/page/<id>`, and the `?harness=` selector.

    THE QUERY PARAM IS THE ONLY INPUT THESE ENDPOINTS HAVE that is not the checkout, so it
    is the only thing a cell can vary — and every filtering rule in `_web_docs.py` is
    downstream of it. P6a skipped the param because nothing called it; this is the phase
    that does, and the cells send it in all four shapes the reference distinguishes
    (a valid value, the other valid value, an unknown one, and blank).

    TWO KINDS ARE NOT PORTED AND HAVE NO CELL, deliberately, for the reason the shell's
    `NOT_PORTED` set has none: a cell holding a 501 against the reference's real body would
    fail, and one holding two 501s would be waiting to go stale.
    `tests/test_web_server.py` cross-checks the kind partition instead.
    """
    # A markdown page that SLICES: its anchor names a section of SETUP.md, and a successful
    # slice drops the anchor so the client does not also scroll.
    sliced = "/api/docs/page/autostart"
    # A concept page whose body carries `{N_AGENTS}` — the count substitution.
    counted = "/api/docs/page/agents"
    # A concept page carrying INLINE `<!--harness:X-->` blocks, one per host.
    tagged = "/api/docs/page/model"
    return [
        cell("docs/the-menu-is-filtered-to-the-active-harness",
             [_req(path="/api/docs?harness=opencode"),
              _req(path="/api/docs?harness=claude")], world=_full(),
             # Two requests over one connection, because the pair is the gate: each names a
             # page the other must not carry. A single request could not tell filtering
             # from a menu that happens to list everything.
             expect=['"harness": "opencode"', '"harness": "claude"',
                     '"id": "adapters-opencode"', '"id": "adapters-claude-code"',
                     '"label": "Language servers"']),
        cell("docs/an-unknown-or-blank-selector-falls-back-to-the-install",
             [_req(path="/api/docs?harness=vim"), _req(path="/api/docs?harness="),
              _req(path="/api/docs")],
             world=_installed(**{f"{_OC}/.geneseed-emit": "claude-global\n"}),
             # `_norm_harness` has one fallback and three ways to reach it. The install is
             # seeded CLAUDE so the fallback is distinguishable from the `opencode`
             # default — with an OpenCode emit all three answers would be right by
             # accident. `keep_blank_values=False` is why the empty one falls back too.
             expect=['"harness": "claude"'],
             expect_absent=['"harness": "vim"', '"harness": "opencode"']),
        cell("docs/a-sliced-page-is-trimmed-to-its-section-and-drops-the-anchor",
             [_req(path=sliced)], world=_full(),
             # `slice: true` + `anchor` — the body starts AT the heading and stops before
             # the next one of equal-or-lesser depth, and `anchor` comes back null because
             # the heading is already at the top.
             # The heading carries an emoji, which the slug strips and the body keeps — so
             # the cell names the marker and the words separately rather than pasting a
             # surrogate pair. That the anchor MATCHED at all is what the emoji proves.
             expect=['"kind": "markdown"', '"source": "SETUP.md"', '"anchor": null',
                     '"body": "## ', 'Start the web UI at login'],
             expect_absent=['"anchor": "start-the-web-ui-at-login"']),
        cell("docs/a-concept-page-substitutes-the-live-counts",
             [_req(path=counted)], world=_full(),
             # `{N_AGENTS}` is replaced from the SAME inventory the rail counts, so the
             # prose cannot drift from it. The token must be gone and a number in its
             # place — naming the number would tie the cell to `src/`.
             expect=['"kind": "concept"', '"link": {"hash": "#/section/agents"'],
             expect_absent=["{N_AGENTS}", "{N_PLUGINS}"],
             expect_re=[r'"body": "\d+ capability specialists']),
        cell("docs/an-inline-harness-block-is-stripped-per-host",
             [_req(path=f"{tagged}?harness=opencode"),
              _req(path=f"{tagged}?harness=claude")], world=_full(),
             # The other granularity: a span INSIDE a shared body, wrapped in HTML-comment
             # markers that are invisible to a GitHub reader of the same prose. Each
             # request must carry its own host's sentence and neither must carry a marker.
             expect=["On OpenCode,", "On Claude Code, three settings.json"],
             expect_absent=["<!--harness:", "<!--/harness-->"]),
        cell("docs/the-glossary-follows-the-deployed-theme",
             [_req(path="/api/docs/page/glossary")], world=_full(),
             # The themed column reads the DEPLOYED theme's JSON, so the same key answers
             # differently from the neutral one — which is the whole point of the page and
             # the reason the seeded install is `imperial` rather than `neutral`.
             expect=['"kind": "glossary"', '"theme": "imperial"',
                     '"label": "Rule (Law)", "neutral": "Rule", "themed": "Dictate"',
                     # An un-themed term: the same word in both columns, lower-cased.
                     '"label": "Posture", "neutral": "posture", "themed": "posture"']),
        cell("docs/an-unknown-page-is-a-404",
             [_req(path="/api/docs/page/nope")], world=_full(),
             expect=['{"error": "not found: nope"}', "404 Not Found"]),
    ]


# A deployed install with something in every section, plus a wiki vault outside it. `mine`
# is BOTH an agent and a skill on purpose: `_resolve_links` builds one name→type map with
# the agents first and the skills second, so a name in both resolves as a skill — the kind
# of thing a port reproduces by accident in the other order.
def _full(**extra) -> dict:
    return _installed(**{
        f"{_OC}/agents/mine.md":
            "---\nname: mine\nmode: all\n---\n\n> my own agent\n\n"
            "Body with a [[wayfinder]] link and a [[mine]] self-link.\n",
        # `_*` is the template convention `_spec_entries` skips.
        f"{_OC}/agents/_template.md": "> not an agent\n",
        f"{_OC}/skills/mine/SKILL.md": "---\nname: mine\n---\n\n> my own skill\n\nbody\n",
        # A name the shipped catalogue knows, so `klass` and `status` come from
        # SKILL_CLASS and registry.json rather than from the personal fallback.
        f"{_OC}/skills/wayfinder/SKILL.md": "---\nname: wayfinder\n---\n\n> shipped\n\nb\n",
        # `_spec_desc`'s two FALLBACKS, which exist for the vendored skill folders: they
        # ride in verbatim with no blockquote and would otherwise show a blank Purpose.
        # Without these two the blockquote arm is the only one any cell reaches.
        f"{_OC}/skills/no-quote/SKILL.md":
            "---\nname: no-quote\ndescription:  from   the frontmatter \n---\n\nbody\n",
        f"{_OC}/skills/no-desc/SKILL.md":
            "---\nname: no-desc\n---\n\n# A heading first\n\nThe first prose paragraph\nwins.\n",
        f"{_OC}/memory/a-fact.md":
            "---\nname: a-fact\ndescription: one fact\n---\n\nbody\n",
        f"{_OC}/notebook/scratch.md": "# scratch\n",
        f"{_OC}/context.json": '{"context": [{"path": "README.md", "load": "eager"}]}\n',
        f"{_OC}/wiki.jsonc": json.dumps({"wikis": [
            {"name": "vault", "path": "{sb/}/vault",
             "entries": [{"path": "notes", "description": "my notes"},
                         {"path": "notes/private", "load": "exclude"}]}]}),
        "vault/notes/one.md": "# One\n\nlinks to [[mine]].\n",
        "vault/notes/two.md": "# Two\n",
        "vault/notes/private/secret.md": "# Secret\n",
        # OUTSIDE the vault, and a real `.md` file — see the two containment cells. A
        # traversal cell whose target does not exist proves nothing: `isFile` refuses it
        # for the wrong reason and the containment check can be deleted with no effect.
        "outside-the-vault.md": "# Outside\n\nnot the vault's to serve.\n",
        # A flat name CONTAINING `..` but no separator. `_flat_name` refuses it; without
        # that clause the file would be served, and with no such file on disk the refusal
        # and the miss produce the same 404 — which is why both mutations survived until
        # this file existed.
        f"{_OC}/memory/we..ird.md": "---\nname: we..ird\n---\n\nreachable only by name.\n",
        **extra,
    })


def _catalog_cells(cell) -> list[dict]:
    """P6c — `/api/catalog/<section>`, `/api/item/<type>/<name>` and the wiki reader.

    THE FIRST ENDPOINTS THAT PARSE THE PATH, and the first that raise. Everything in P6b
    was a literal key in a table; here the section, the type and the name come out of the
    URL, which brings three things no earlier cell could reach: `urllib.parse.unquote`,
    the `NotFound` → 404 convention, and `_flat_name`'s traversal refusal — a GET needs no
    token, so before that check the name was an arbitrary-file read.
    """
    return [
        # ---- /api/catalog/<section> ----------------------------------------------------
        cell("catalog/an-undeployed-target-lists-the-source-render",
             [_req(path="/api/catalog/agents")], world={"repo/.keep": ""},
             # `state.inventory`'s fallback arm, read through the catalog rather than
             # counted: names, purposes and lifecycle badges of the agents `src/` renders.
             expect=['"section": "agents"', '"status": "approved"'],
             expect_re=[r'"items": \[\{"name": "[a-z][a-z0-9-]*", "title":']),
        cell("catalog/a-deployed-install-lists-what-is-installed",
             [_req(path="/api/catalog/agents")], world=_full(),
             # One agent, and the `_`-prefixed template beside it that must not appear.
             expect=['{"name": "mine", "title": "mine", "desc": "my own agent"',
                     '"status": "personal"'],
             expect_absent=["_template"]),
        cell("catalog/a-skill-carries-its-class-and-its-lifecycle-status",
             [_req(path="/api/catalog/skills")], world=_full(),
             # The two arms of the taxonomy in one body: a skill the registry knows
             # (approved, class from SKILL_CLASS) and one it does not (personal, and
             # `klass` personal too — filing it under the "build" fallback would claim a
             # Geneseed taxonomy slot it was never given).
             expect=['"name": "mine"', '"klass": "personal", "status": "personal"',
                     '"name": "wayfinder"', '"klass": "design", "status": "approved"',
                     # `_spec_desc`'s other two arms: the frontmatter `description`, with
                     # its whitespace collapsed by `" ".join(desc.split())`, and the first
                     # PROSE paragraph — the heading above it is skipped.
                     '"name": "no-quote", "title": "no-quote", '
                     '"desc": "from the frontmatter"',
                     '"name": "no-desc", "title": "no-desc", '
                     '"desc": "The first prose paragraph wins."']),
        cell("catalog/laws-are-numbered-titled-and-classed",
             [_req(path="/api/catalog/laws")], world=_full(),
             # Laws come from the RENDER even on a deployed install — once deployed they
             # live inside AGENT.md rather than as files — so this is also what says the
             # deployed arm replaces two of the three and not all three.
             expect=['"section": "laws"',
                     '{"name": "I", "title": "Rule I \\u2014 Arcana Sigillata',
                     '"klass": "security"', '"klass": "context"']),
        cell("catalog/memory-notebook-and-config-list-what-is-there",
             [_req(path="/api/catalog/memory"), _req(path="/api/catalog/notebook"),
              _req(path="/api/catalog/config")], world=_full(),
             # Three sections in one cell: their bodies are small and they share a shape.
             # `title`/`desc` come from the fact's frontmatter, which is the first thing
             # in this port to consume `frontmatter`'s second owner.
             expect=['"name": "a-fact", "title": "a-fact", "desc": "one fact"',
                     '"name": "scratch", "title": "scratch", "desc": ""',
                     '"name": "context.json", "title": "Project context"',
                     '"name": "wiki.jsonc", "title": "Wiki manifest"']),
        cell("catalog/the-wiki-walks-the-manifest-and-honours-its-excludes",
             [_req(path="/api/catalog/wiki")], world=_full(),
             # The vault is OUTSIDE the install, reached through `wiki.jsonc`. An entry
             # marked `load: exclude` is dropped, and the cell names the file it drops —
             # an exclusion gate with no positive control is a gate on nothing.
             expect=['"name": "vault:notes/one.md", "title": "one"',
                     '"desc": "notes/one.md"', '"group": "vault"',
                     '"name": "vault:notes/two.md"'],
             expect_absent=["secret"]),
        cell("catalog/the-wiki-manifest-tolerates-comments",
             [_req(path="/api/catalog/wiki"),
              _req(path="/api/item/config/wiki.jsonc")],
             world=_full(**{f"{_OC}/wiki.jsonc":
                            "// my vaults\n" + json.dumps({"wikis": [
                                {"name": "vault", "path": "{sb/}/vault",
                                 "entries": [{"path": "notes/two.md",
                                              "description": "just one"}]}]}) + "\n"}),
             # `wiki.jsonc` is `.jsonc` because it is HAND-MAINTAINED, and the reference
             # reads it through the comment-tolerant loader. Every other manifest this
             # phase seeds is plain JSON, so without this cell a port using `JSON.parse`
             # would list nothing and answer an empty `manifest` — both of which read as
             # "the user has no wikis" rather than as a parse failure. The second request
             # is what says the CONFIG item goes through the same loader.
             expect=['"name": "vault:notes/two.md"', '"desc": "just one"',
                     '"manifest": {"kind": "wiki", "wikis": [{"name": "vault"']),
        cell("catalog/an-unknown-section-is-a-404",
             [_req(path="/api/catalog/nope")], world=_full(),
             # The `NotFound` → 404 convention, first exercised here. `SECTIONS` is a
             # closed list and the message carries what was asked for.
             expect=['{"error": "not found: nope"}', "404 Not Found"]),

        # ---- /api/item/<type>/<name> ---------------------------------------------------
        cell("item/an-agent-carries-its-body-and-its-resolved-links",
             [_req(path="/api/item/agent/mine")], world=_full(),
             # `[[mine]]` is both an agent and a skill here, and resolves as a SKILL:
             # `_resolve_links` writes agents into the name map first and skills second.
             # A port that built the map in the other order answers `"type": "agent"` and
             # nothing else in the body moves.
             expect=['"type": "agent", "name": "mine"',
                     '"body": "> my own agent\\n\\nBody with a [[wayfinder]] link',
                     '"links": [{"label": "wayfinder", "type": "skill", "name": '
                     '"wayfinder"}, {"label": "mine", "type": "skill", "name": "mine"}]']),
        cell("item/a-law-is-fetched-by-its-numeral",
             [_req(path="/api/item/law/XVIII")], world=_full(),
             expect=['"type": "law", "name": "XVIII"',
                     '"title": "Rule XVIII \\u2014', '"klass": "context"',
                     '"links": []']),
        cell("item/a-config-manifest-is-parsed-and-fenced",
             [_req(path="/api/item/config/context.json")], world=_full(),
             # Two representations of the same file: the structured `manifest` the detail
             # pane renders as cards, and the raw body inside a ```json fence.
             expect=['"manifest": {"kind": "context", "context": '
                     '[{"path": "README.md", "load": "eager"}]}',
                     '"body": "```json\\n{\\"context\\"']),
        cell("item/a-wiki-page-is-read-out-of-its-vault",
             [_req(path="/api/item/wiki/vault:notes%2Fone.md")], world=_full(),
             # `%2F` — the name carries a separator, so the URL must be unquoted before
             # the vault lookup and the traversal check applies inside the vault instead
             # of to the segment.
             expect=['"type": "wiki", "name": "vault:notes/one.md", "title": "one"',
                     '"body": "# One\\n\\nlinks to [[mine]].\\n"',
                     '"links": [{"label": "mine", "type": "skill"']),
        cell("item/a-wiki-page-outside-the-vault-is-a-404",
             [_req(path="/api/item/wiki/vault:..%2Foutside-the-vault.md")], world=_full(),
             # `_within(p, root)` after the join, and the target EXISTS — which is the
             # whole cell. Pointed at a path with no file behind it, `is_file()` refuses
             # first and deleting the containment check changes nothing; that version of
             # this cell let the mutation through. A GET carries no token, so this is the
             # only thing between a crafted name and an arbitrary read.
             expect=['{"error": "not found: vault:../outside-the-vault.md"}',
                     "404 Not Found"],
             expect_absent=["not the vault's to serve"]),
        cell("item/a-flat-name-that-climbs-out-is-a-404",
             [_req(path="/api/item/memory/..%2F..%2Fbuild"),
              _req(path="/api/item/memory/a/b"),
              _req(path="/api/item/memory/we..ird")], world=_full(),
             # `_flat_name`: a separator, a `..` or a drive colon in the segment is
             # someone steering the join outside the catalog dir. Its own cell, because
             # it is a security branch and a corpus over the helper cannot see the route.
             #
             # The second request is what gates the router's `split("/", 4)` MAXSPLIT. An
             # unbounded split would hand `api_item` the name `a` and answer
             # `not found: a`; the reference keeps the remainder whole and answers
             # `not found: a/b`, which is also what lets a wiki relpath survive the route.
             #
             # And the third names a file that IS there, whose name carries `..` and no
             # separator. Without it the `".." in name` clause is unreachable: every other
             # `..` this cell sends also carries a `/`, which the clause before it catches,
             # and a `..` name with nothing behind it 404s with the same message either
             # way. `expect_absent` is what separates "refused" from "missed".
             expect=['{"error": "not found: ../../build"}', "404 Not Found",
                     '{"error": "not found: a/b"}',
                     '{"error": "not found: we..ird"}'],
             expect_absent=["reachable only by name"]),
        cell("item/an-unknown-type-and-a-missing-name-are-both-404",
             [_req(path="/api/item/nope/x"), _req(path="/api/item/")], world=_full(),
             # The two ends of the parse: an unknown TYPE falls off `api_item`'s chain,
             # and a path with no name at all is caught in the router before it can
             # IndexError its way to a 500.
             expect=['{"error": "not found: nope"}',
                     '{"error": "not found: /api/item/"}']),
        cell("item/a-percent-sequence-that-is-not-an-escape-stays-literal",
             [_req(path="/api/item/memory/a%ZZfact"), _req(path="/api/item/memory/caf%C3%A9"),
              _req(path="/api/item/memory/trailing%")], world=_full(),
             # `urllib.parse.unquote` is NOT `decodeURIComponent`: an invalid escape and a
             # trailing bare `%` are left alone where the JS builtin throws a URIError —
             # which the shell would answer as a 500. The valid UTF-8 pair beside them is
             # the positive control, without which "leaves everything alone" would pass.
             expect=['{"error": "not found: a%ZZfact"}',
                     '{"error": "not found: caf\\u00e9"}',
                     '{"error": "not found: trailing%"}']),
    ]


def _read_cells(cell) -> list[dict]:
    """P6b — the eight read endpoints whose closure P5 had already crossed.

    WHICH OF THEM NEEDS THE CHECKOUT FIXTURE, measured rather than assumed (P5h asked the
    same question and the answer there was no). Only the two that run DOCTOR:
    `_doctor_collect` reads `Harness/`, which is gitignored and therefore absent from the
    copy, and reads the working tree for every other check — so a cell asserting "no
    problems" against the live `ROOT` passes or fails with whatever the developer has open
    in their editor. `checkout={}` makes those two reproducible, and a planted fault is
    what stops the clean pair from being the fixture-too-plain hole (eight groups, every
    one of them empty, and deleting any check is invisible).

    Everything else reads `ROOT` too — `src/`, `themes/` — but both sides read the SAME
    `ROOT`, so a dirty tree moves them together. The copy costs 0.31 s per cell per side
    and buys nothing there.
    """
    return [
        # ---- /api/themes ---------------------------------------------------------------
        cell("themes/every-theme-carries-its-accent-tagline-and-sigil",
             [_req(path="/api/themes")], world={"repo/.keep": ""},
             expect=['"name": "imperial", "blurb": "Warhammer 40k", "accent": "yellow"',
                     '"name": "neutral", "blurb": "plain professional voice"',
                     '"name": "files", "desc": "Plain bundle for any AGENT.md tool."',
                     # `ensure_ascii=True` is `json.dumps`' default and the sigils are all
                     # emoji, so the escaped spelling is the one on the wire. `JSON.stringify`
                     # does NOT escape, which is exactly the divergence `jsonDumpsCompact`
                     # exists to close — and this is the body that would show it.
                     '\\ud83e\\uddec Gene-seed implanted']),
        cell("themes/an-undeployed-host-still-reports-a-current-pair",
             [_req(path="/api/themes")], world={"repo/.keep": ""},
             # Describing the reference, not adjudicating it: with nothing deployed the
             # detected pair is whatever `_installed_defaults` finds, and the theme falls
             # back to `neutral`. The cell below is what tells detection from fallback.
             expect=['"current": {"theme": "neutral"']),
        cell("themes/the-detected-install-is-the-current-pair",
             [_req(path="/api/themes")], world=_installed(),
             expect=['"current": {"theme": "imperial", "emit": "opencode-global"}']),
        cell("themes/a-json-body-over-the-threshold-is-gzipped",
             [_req(path="/api/themes", headers={"Accept-Encoding": "gzip"})],
             world={"repo/.keep": ""},
             # THE `application/json` GZIP BRANCH, which P6a recorded as unreachable
             # because a ping body is 30 bytes. `/api/themes` is 4.5 kB and — unlike every
             # other body this phase adds — carries no path, no clock and no token, which
             # is what a compressed payload has to be: a destamp cannot reach inside one.
             expect=["Content-Encoding: gzip", "Vary: Accept-Encoding",
                     "Content-Type: application/json"]),

        # ---- /api/setup ----------------------------------------------------------------
        cell("setup/reports-the-deployed-install-snapshot",
             [_req(path="/api/setup")], world=_installed(),
             expect=['"theme": "imperial", "accent": "yellow", "emit": "opencode-global"',
                     '"installed_fp": "0000000000000000"',
                     '"agent_md_present": true', '"deployed": true',
                     # The tolerant field, asserted PRESENT here and asserted absolutely in
                     # tests/test_web_server.py — see `_WEB_STAMPS`. `<CLEN>` is the tag
                     # its four-byte width difference forces onto the header, stated at
                     # the cell rather than left to be discovered in `_drive`.
                     '"python": "<RUNTIME>"', 'Content-Length: <CLEN>']),
        cell("setup/an-undeployed-target-says-so",
             [_req(path="/api/setup")], world={"repo/.keep": ""},
             # `installed_fp` is deliberately NOT named: with no host dir seeded, the
             # candidate chain walks on to the checkout's own `Harness/` and finds a real
             # fingerprint there. Both sides read the same one, so the byte comparison
             # still gates it; naming it would tie this cell to the developer's tree.
             expect=['"deployed": false',
                     '"agent_md": null, "agent_md_present": false',
                     '"theme": "neutral", "accent": "cyan"',
                     '"target": "<HOME>']),

        # ---- /api/installs -------------------------------------------------------------
        cell("installs/one-row-per-detected-host-carries-its-state",
             [_req(path="/api/installs")], world=_installed(),
             expect=['"id": "opencode:global", "host": "opencode", "scope": "global"',
                     '"state": "active"', '"theme": "imperial"', '"selected": true',
                     '"id": "claude:global"', '"state": "absent"',
                     '"postures": ["peer", "artisan", "assistant", "expert", "mentor"]',
                     '"modes": ["direct", "foreman"]']),
        cell("installs/a-stashed-install-is-reported-disabled",
             [_req(path="/api/installs")],
             world=_installed(**{f"{_OC}/.geneseed-disabled/.keep": ""}),
             # `_install_state`'s third arm. Without it `active` and `absent` are the only
             # two values any cell ever sees, and a port that dropped the stash check
             # would answer `active` here and be invisible.
             expect=['"host": "opencode", "scope": "global", "path": "<HOME>',
                     '"state": "disabled"']),

        # ---- /api/excludes -------------------------------------------------------------
        cell("excludes/no-global-install-means-no-installs-to-union",
             [_req(path="/api/excludes")], world={"repo/.keep": ""},
             expect=['{"excludes": [], "installs": []}']),
        cell("excludes/a-seeded-exclusion-is-listed-with-its-host",
             [_req(path="/api/excludes")],
             # `{repo/}`, not `{repo}`: the substitution lands INSIDE a JSON string, and a
             # Windows path's backslashes make `\U` an invalid escape — `_read_excludes`
             # then swallows the JSONDecodeError and returns the empty stub, which is a
             # seeded file that reads exactly like a working one. The self-check is what
             # caught it.
             world=_installed(**{f"{_OC}/excludes.json": json.dumps(
                 {"excludes": [{"path": "{repo/}", "wired": {"opencode": True}}]})}),
             # The union view: one record per path, carrying the hosts that hold it. The
             # empty cell above is its positive control — without it, a port that always
             # answered the stub would pass here on the strength of the seeded file alone.
             expect=['"path": "<SB>/repo"', '"hosts": ["opencode"]',
                     '"wired": {"opencode": true}', '"host": "opencode", "cfg": "<HOME>']),

        # ---- /api/profile --------------------------------------------------------------
        cell("profile/an-absent-profile-reports-exists-false",
             [_req(path="/api/profile")], world={"repo/.keep": ""},
             # A REQUIRED field's emptiness, defined: `fingerprint` is "" and not the
             # sha256 of the empty string, which is a different sixteen characters.
             expect=['{"exists": false,', '"text": "", "fingerprint": ""}',
                     'PROFILE.md']),
        cell("profile/a-seeded-profile-carries-its-fingerprint",
             [_req(path="/api/profile")],
             world=_installed(**{f"{_OC}/PROFILE.md": "# Me\n\nI write Rust.\n"}),
             expect=['"exists": true', '"text": "# Me\\n\\nI write Rust.\\n"',
                     # sha256("# Me\n\nI write Rust.\n")[:16], stated so the cell gates the
                     # TRUNCATION and the digest, not merely that some hex came back.
                     '"fingerprint": "3557095f088da537"']),

        # ---- /api/diff -----------------------------------------------------------------
        cell("diff/a-deployed-install-reports-its-drift",
             [_req(path="/api/diff")], world=_installed(),
             expect=['"deployed": true', '"theme": "imperial"',
                     '"rel": "AGENT.md", "status": "edited"',
                     '"rel": ".geneseed-version", "status": "edited"',
                     '"status": "missing"',
                     '"+++ deployed/AGENT.md"']),
        cell("diff/no-deployed-harness-reports-deployed-false",
             [_req(path="/api/diff")], world={"repo/.keep": ""},
             expect=['"deployed": false', '"files": []']),

        # ---- /api/doctor ---------------------------------------------------------------
        cell("doctor/every-check-reports-its-own-group",
             [_req(path="/api/doctor")], world=_installed(), checkout={},
             # The group list is the whole reason this endpoint is not `doctor`'s stdout:
             # `_doctor_collect(groups=)` is the parameter P6b decided to grow, and eight
             # labels in order are what say it filled.
             expect=['"themes": ["imperial"], "ok": true, "problems": []',
                     '"check": "build", "label": "Build scan (imperial)"',
                     '"check": "global", "label": "Global install (imperial)"',
                     '"check": "claude_bob"', '"check": "parity", "label": "Theme parity"',
                     '"check": "colors"', '"check": "authoring"',
                     '"check": "shim", "label": "Hook shim"',
                     '"check": "bundle", "label": "Committed bundle drift"',
                     '"checked_at": "<WHEN>"']),
        cell("doctor/a-planted-fault-lands-in-its-own-group-and-in-the-flat-list",
             [_req(path="/api/doctor")], world=_installed(),
             checkout={"src/memory/README.md":
                       "# Memory\n\nA planted {{NOPE}} token and a [dead link](./nowhere.md).\n"},
             # The fixture-too-plain hole, closed. Eight empty groups compare equal to eight
             # empty groups however the accumulator is wired — including not being wired at
             # all. One fault proves the problems reach BOTH the group and the flat list,
             # and that `ok` follows the flat list rather than being hardcoded.
             #
             # TWO faults rather than one, and the reason is `sorted(probs)`: the reference
             # sorts each group's problems, and a single problem per group cannot tell a
             # sorted list from an insertion-ordered one. Two messages beginning `dead
             # link` and `unresolved token`, over two footprints, put four out-of-order
             # entries in the `global` group.
             expect=['"ok": false',
                     '"check": "build", "label": "Build scan (imperial)", "problems": '
                     '["[imperial] dead link \'./nowhere.md\'',
                     '"[imperial] unresolved token {{NOPE}}',
                     '"check": "global", "label": "Global install (imperial)", "problems": '
                     '["[imperial global/full] dead link',
                     '"[imperial global/lean] unresolved token'],
             expect_absent=['"problems": [], "groups"']),

        # ---- /api/overview -------------------------------------------------------------
        cell("overview/an-undeployed-target-counts-the-source-render",
             [_req(path="/api/overview")], world={"repo/.keep": ""}, checkout={},
             # `state.inventory`'s fallback arm: nothing is installed, so the counts come
             # from a fresh render of `src/` rather than from the deployed dirs. The cell
             # below is the other arm, and the two numbers must differ or neither is gated.
             # `install` is NOT null here, which is worth saying out loud: `_install_targets`
             # lists every host's global config dir whether or not anything is installed in
             # it, so the current view still resolves to a row. `deployed` is the field that
             # carries the answer, and the two are independent.
             expect=['"deployed": false', '"diff": null', '"build_time": null',
                     '"install": {"host": "opencode", "scope": "global"'],
             expect_re=[r'"counts": \{"agents": [1-9]\d*, "skills": [1-9]\d*, '
                        r'"laws": [1-9]\d*']),
        cell("overview/a-deployed-install-counts-what-is-installed",
             [_req(path="/api/overview")], checkout={},
             world=_installed(**{
                 f"{_OC}/agents/mine.md": "---\nname: mine\n---\n\n> my agent\n\nbody\n",
                 f"{_OC}/agents/_template.md": "> not an agent\n",
                 f"{_OC}/skills/mine/SKILL.md": "---\nname: mine\n---\n\n> my skill\n",
                 f"{_OC}/memory/a-fact.md":
                     "---\nname: a-fact\ndescription: one fact\n---\n\nbody\n",
                 f"{_OC}/notebook/scratch.md": "# scratch\n",
                 f"{_OC}/context.json": '{"context": []}\n',
             }),
             # ONE of each, and an `_`-prefixed agent that must NOT be counted — the
             # template convention `_spec_entries` skips. `laws` still comes from the
             # render, which is what says the deployed arm replaces two of the three
             # counts and not all three.
             expect=['"counts": {"agents": 1, "skills": 1, "laws": ',
                     '"memory": 1, "notebook": 1, "wiki": 0, "config": 1}',
                     '"deployed": true', '"build_time": "<WHEN>"',
                     '"install": {"host": "opencode", "scope": "global"',
                     '"diff": {"edited": ']),
        cell("overview/the-cached-doctor-verdict-is-the-stamped-shape",
             [_req(path="/api/doctor"), _req(path="/api/overview")],
             world=_installed(), checkout={},
             # Two requests, and the second is the point. `api_doctor` STAMPS the verdict
             # and `api_overview` reads `state.doctor` — which holds three keys, not the
             # eight-group payload the first request returned. A port that cached the whole
             # `api_doctor` body would answer this cell with `themes` and `groups` inside
             # overview's `doctor` object.
             #
             # WHAT THIS CELL DOES NOT GATE, stated rather than implied: that the second
             # request REUSES the first's run instead of recomputing it. Both answers are
             # identical either way — the cache is a cost, and a cell cannot see a cost.
             # `test_doctor_verdict_is_cached_until_refresh` in tests/test_web.py is its
             # gate on the reference; the Node twin's is `js/web/api.mjs`'s own shape.
             expect=['"doctor": {"ok": true, "problems": [], "checked_at": "<WHEN>"}'],
             expect_absent=['"doctor": {"themes"']),
    ]


# ---- running one cell ------------------------------------------------------

def _dyn_stamps(record: dict, port: int, pid: int) -> list[tuple[bytes, bytes]]:
    """The four per-run values, in every spelling a cell can observe them in.

    TARGETED, not global. The token is 32 random URL-safe characters and can be replaced
    anywhere; a port is four or five digits and a bare replacement of it would also rewrite
    any Content-Length that happened to contain them. So the port is replaced only where it
    is syntactically a port, and the pid and the started-second only where they are that
    field of the daemon record.
    """
    out: list[tuple[bytes, bytes]] = []
    token = str(record.get("token") or "")
    if token:
        out.append((token.encode(), b"<TOKEN>"))
    out.append((f"http://127.0.0.1:{port}".encode(), b"http://127.0.0.1:<PORT>"))
    out.append((f'"port": {port}'.encode(), b'"port": <PORT>'))
    out.append((f'"pid": {pid}'.encode(), b'"pid": <PID>'))
    started = record.get("started")
    if started is not None:
        out.append((f'"started": {started}'.encode(), b'"started": <STARTED>'))
    return out


def _decode_body(body: bytes, encoding: str) -> bytes:
    """A gzipped response, compared as the bytes a CLIENT ends up with.

    THE COMPRESSED FORM IS NOT COMPARABLE AND CHASING IT WOULD BE THE WRONG WORK. Three
    things differ inside it and only the first two are cosmetic: `gzip.compress(data, 6)`
    stamps the clock into the member header's MTIME field and `0xff` into its OS byte where
    `zlib.gzipSync` writes zeros and its own; and then the DEFLATE STREAMS THEMSELVES
    differ — 753 bytes against 751 for `sw.js`. Neither side chose that. It is the zlib
    build each runtime links, at identical level, window and memory settings, and a port
    cannot fix it or be blamed for it. (A 500-byte payload happened to match exactly, which
    is how the first draft of this function talked itself into normalising ten bytes and
    comparing the rest.)

    So the gzip branch is gated on what it MEANS instead, which is the stronger question
    anyway: the header says gzip, the body inflates, and it inflates to exactly the bytes
    the uncompressed cell serves. The compressed LENGTH is normalised to a tag in
    `_drive` rather than dropped, so "Content-Length is still set" — which is what
    keep-alive depends on — stays gated.
    """
    if "gzip" not in (encoding or ""):
        return body
    return gzip.decompress(body)


def _apply(data: bytes, stamps: list[tuple[bytes, bytes]]) -> bytes:
    for old, new in stamps:
        data = data.replace(old, new)
    return data


def _wait_for_record(sb: Path, proc: subprocess.Popen, timeout: float = 30.0):
    """Poll the sandbox for the daemon record the started server writes.

    Found by GLOB rather than by resolving the config dir here: the target is
    `_opencode_config_dir()` under a redirected environment, and a second implementation of
    that resolution in the gate is a second thing that can be wrong. Also catches a server
    that dies on startup, which would otherwise be a 30-second hang per cell.
    """
    deadline = time.time() + timeout
    while time.time() < deadline:
        if proc.poll() is not None:
            return None
        hits = list(sb.rglob(".geneseed-web.json"))
        if hits:
            try:
                rec = json.loads(hits[0].read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                rec = None
            if rec and rec.get("port"):
                return rec
        time.sleep(0.05)
    return None


def _drive(port: int, token: str, requests: list[dict]) -> dict:
    """Run a cell's request script over ONE connection and return its observations."""
    obs: dict[str, bytes] = {}
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=15)
    try:
        for i, r in enumerate(requests, 1):
            if r["reconnect"]:
                conn.close()
                conn = http.client.HTTPConnection("127.0.0.1", port, timeout=15)
            headers = dict(r["headers"])
            if r["token"]:
                headers["X-Geneseed-Token"] = token
            body = r["body"]
            if body is not None:
                headers.setdefault("Content-Type", "application/json")
                headers.setdefault("Content-Length", str(len(body)))
            # `skip_accept_encoding`: http.client adds `Accept-Encoding: identity` on its
            # own, and a cell that says nothing about the header must send nothing — the
            # gzip branch is chosen by its presence.
            conn.putrequest(r["method"], r["path"], skip_accept_encoding=True,
                            skip_host=("Host" in headers))
            for k, v in headers.items():
                conn.putheader(k, v)
            conn.endheaders(body if body is not None else None)
            resp = conn.getresponse()
            data = resp.read()
            enc = resp.getheader("Content-Encoding") or ""
            body_out = _decode_body(data, enc)
            # Content-Length is tagged in exactly two situations, and both are the same
            # rule: the length is a CONSEQUENCE of a value this harness has already
            # decided it cannot compare, so comparing the length would re-introduce the
            # comparison through the back door. `gzip` is the compressed stream (see
            # `_decode_body`); `"python": ` is `/api/setup`'s runtime field, where the
            # reference sends `"3.13.5"` and the Node daemon sends `null` — four bytes
            # apart, for the one field in P6b with no honest twin. Its PRESENCE stays
            # gated, which is what the tag is for, and the body itself is still compared
            # byte for byte with the value normalised.
            untagged = ('gzip' not in enc) and (b'"python": ' not in body_out)
            obs[f"<r{i} status>"] = f"{resp.status} {resp.reason}".encode()
            obs[f"<r{i} headers>"] = "\n".join(
                f"{k}: {v if (untagged or k.title() != 'Content-Length') else '<CLEN>'}"
                for k, v in resp.getheaders() if k.title() in _HEADERS
            ).encode()
            obs[f"<r{i} body>"] = body_out
    except (http.client.HTTPException, OSError) as e:
        obs["<transport>"] = f"{type(e).__name__}: {e}".encode()
    finally:
        conn.close()
    return obs


def _stop(record: "dict | None", proc: subprocess.Popen) -> None:
    """Graceful stop, then a kill. NEVER raises.

    It runs in a `finally`, so anything it throws replaces the finding the cell was about
    to report — and worse, it throws BEFORE the kill, leaving the server running. M11 is
    what found that: a mutation that stopped writing the daemon record left `record` None,
    `_stop` raised an IndexError parsing a port out of `""`, and the whole run died with
    one orphaned server per cell instead of reporting fifteen cells whose server never came
    up. A harness that leaks a process per failed cell eats the port and then the machine,
    which is the failure this function exists to prevent. So: a bare `except Exception`, and
    the kill outside it.
    """
    try:
        if record and record.get("port"):
            conn = http.client.HTTPConnection("127.0.0.1", int(record["port"]), timeout=3)
            conn.request("POST", "/api/shutdown", body=b"{}",
                         headers={"X-Geneseed-Token": record.get("token", ""),
                                  "Content-Type": "application/json"})
            conn.getresponse().read()
            conn.close()
    except Exception:  # noqa: BLE001  — see the docstring; nothing here may escape
        pass
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            pass


def run_cell(cli: list[str], cell: dict, now: "int | None" = None) -> "dict[str, bytes] | str":
    """Start one server in a fresh sandbox, drive it, stop it, and snapshot everything.

    `now` is the cell's shared clock — see `_DEAD_PID`'s block. It is an ARGUMENT rather
    than a `time.time()` call here precisely so the reference run and the candidate run seed
    the same seconds; sampling it per side would make every activity body differ by the time
    the first server took to start.
    """
    faults = cell.get("checkout")
    now = int(time.time()) if now is None else now
    with tempfile.TemporaryDirectory() as td, tempfile.TemporaryDirectory() as ctd:
        sb = Path(td)
        home, repo, cfg = sb / "home", sb / "repo", sb / "cfg"
        for d in (home, repo, cfg):
            d.mkdir(parents=True, exist_ok=True)
        checkout = Path(ctd) / "checkout" if faults is not None else ROOT
        repl = {"{sb}": str(sb), "{home}": str(home), "{repo}": str(repo),
                "{cfg}": str(cfg), "{py}": sys.executable, "{ck}": str(checkout)}
        repl = {**{k[:-1] + "/}": v.replace("\\", "/") for k, v in repl.items()}, **repl}
        # Added AFTER the `{x/}` slash-variants above: these four are numbers, so a
        # forward-slash spelling of one would be a placeholder nothing could ever use.
        repl.update({"{now}": str(now), "{older}": str(now - 600), "{stale}": str(now - 3600),
                     "{pid}": str(os.getpid()), "{deadpid}": str(_DEAD_PID)})
        if faults is not None:
            harness_golden._copy_checkout(checkout, harness_golden._subst(faults, repl))
            cli = harness_golden._repoint(cli, checkout)
        harness_golden._seed(sb, cell.get("world") or {}, repl)

        env = golden.cell_env(home)
        env.update(harness_golden._subst(cell.get("env") or {}, repl))

        # `--port 0` on both sides: the OS picks a free port, so two cells can never
        # collide with each other or with the developer's own running daemon.
        argv = cli + ["--daemon-internal", "--port", "0", "--no-browser"] \
            + harness_golden._subst(cell.get("argv") or [], repl)
        proc = subprocess.Popen(argv, cwd=str(repo), env=env, stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, encoding="utf-8")
        record, obs = None, {}
        try:
            record = _wait_for_record(sb, proc)
            if record is not None:
                obs = _drive(record["port"], record.get("token", ""), cell["requests"])
        finally:
            _stop(record, proc)
        if record is None:
            out, err = proc.communicate(timeout=10)
            return f"server did not start (rc={proc.returncode}): {out[-400:]}{err[-400:]}"
        out, err = proc.communicate(timeout=10)

        stamps = _dyn_stamps(record, record["port"], record["pid"])
        roots = [("<HOME>", home), ("<REPO>", checkout), ("<REPO>", ROOT), ("<SB>", sb)]

        def clean(b: bytes) -> bytes:
            return _web_destamp(harness_golden._destamp(
                _apply(golden._normalise(_apply(b, stamps), roots), stamps)))

        snap = {k: clean(v) for k, v in golden._snapshot(sb, roots).items()}
        snap.update({k: clean(v) for k, v in obs.items()})
        # The record, as a column of its own. It is DELETED by a graceful stop, so the file
        # snapshot above cannot see it — and it carries the token, the port, the pid and the
        # started second, which is the only place four of this harness's destamps are
        # observable at all. Its absence from the file snapshot is what gates the cleanup.
        snap["<daemon-record>"] = clean(
            json.dumps(record, sort_keys=True).encode("utf-8"))
        snap["<server stdout>"] = clean(out.encode("utf-8", "replace"))
        snap["<server stderr>"] = clean(err.encode("utf-8", "replace"))
        snap["<exit>"] = str(proc.returncode).encode()
        return snap


def check_expectations(cell: dict, snap: "dict[str, bytes]") -> list[str]:
    """The absolute assertions, run against the REFERENCE side.

    Same discipline as `harness_golden.check_expectations`, and needed for the same reason:
    a cross-implementation comparison is blind to a defect both sides share. It is sharper
    here — two servers that both stopped enforcing the CSRF token would agree in every
    guard cell, forever. So each cell states what the reference actually answers.

    And, as there, it describes the reference; it never adjudicates it.
    """
    problems = []
    text = b"\n".join(
        v for k, v in sorted(snap.items())
        if k.startswith("<r") or k in ("<server stdout>", "<server stderr>")
    ).decode("utf-8", "replace")
    for want in cell.get("expect", ()):
        if want not in text:
            problems.append(f"the reference no longer answers {want!r} — this cell has "
                            f"stopped exercising what it names")
    for unwanted in cell.get("expect_absent", ()):
        if unwanted in text:
            problems.append(f"the reference now answers {unwanted!r}, which this cell "
                            f"exists to prove it leaves out")
    for pat in cell.get("expect_re", ()):
        if not re.search(pat, text):
            problems.append(f"the reference's answer no longer matches {pat!r}")
    # P6e — the first endpoint that DELETES, so P5h's three gate directions arrive here:
    # what went, what survived, and (through the snapshot the two sides compare) the
    # directory listing. A cross-implementation compare cannot make either of the first two,
    # because two servers that both stopped pruning agree perfectly; and `expect`/
    # `expect_absent` above read only the RESPONSE, which is silent about a file the endpoint
    # left behind. `_activity_entries` self-cleans as a side effect of a GET, and a side
    # effect no assertion names is a side effect that can be deleted.
    for rel in cell.get("expect_files", ()):
        if rel not in snap:
            problems.append(f"the reference no longer leaves {rel!r} behind — this cell "
                            f"names it as a file the endpoint must NOT remove")
    for rel in cell.get("expect_absent_files", ()):
        if rel in snap:
            problems.append(f"the reference now leaves {rel!r} behind, which this cell "
                            f"exists to prove it prunes")
    if "<transport>" in snap:
        problems.append(f"the reference's connection failed: "
                        f"{snap['<transport>'].decode('utf-8', 'replace')}")
    # The record is not optional. Every cell's server runs with `--daemon-internal`, so a
    # missing or empty record means the run was not observed at all — and four of this
    # harness's destamps read their values out of it, so an empty one would make them all
    # no-ops and every cell would compare two un-normalised runs.
    rec = snap.get("<daemon-record>", b"")
    if not rec.strip() or b"<TOKEN>" not in rec:
        problems.append("the daemon record is missing, empty, or carries no token — the "
                        "destamps read their values out of it, so every cell would then "
                        "compare two un-normalised runs")
    return problems


def compare(ref: list[str], new: list[str], matrix: list[dict], limit: int) -> int:
    print(f"[web-golden] {len(matrix)} cells · ref={' '.join(ref)} · new={' '.join(new)}")
    failures: list[str] = []
    for i, cell in enumerate(matrix, 1):
        cid = cell["id"]
        # One clock per CELL, shared by both sides — see `_DEAD_PID`'s block.
        now = int(time.time())
        a, b = run_cell(ref, cell, now), run_cell(new, cell, now)
        if isinstance(a, str) or isinstance(b, str):
            failures.append(f"  {cid}: server failed\n    ref: {a if isinstance(a, str) else 'ok'}"
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
            parts += [golden._diff(k, a[k], b[k]) for k in differing[:4]]
            failures.append("\n".join(parts))
        if i % 5 == 0 or i == len(matrix):
            print(f"[web-golden]   {i}/{len(matrix)} ({len(failures)} failing)")
    if not failures:
        print(f"[web-golden] ok — {len(matrix)} cells identical")
        return 0
    print(f"\n[web-golden] {len(failures)}/{len(matrix)} cells DIFFER:\n")
    for f in failures[:limit]:
        print(f + "\n")
    if len(failures) > limit:
        print(f"[web-golden] ... and {len(failures) - limit} more (raise --limit)")
    return 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--ref", default=None,
                    help="reference server command (default: this repo's harness.py web)")
    ap.add_argument("--new", default=None,
                    help="candidate server command. Omitted: compare ref against itself, "
                         "which self-checks that the cells are deterministic.")
    ap.add_argument("--only", default=None,
                    help="comma-separated cell-id prefixes to keep. Refuses an empty "
                         "selection rather than reporting 0/0 as a pass.")
    ap.add_argument("--limit", type=int, default=5, help="failing cells to detail")
    args = ap.parse_args(argv)

    ref = harness_golden._resolve_cli(golden._split(args.ref)) if args.ref else [
        sys.executable, str(ROOT / "rituals" / "harness.py"), "web"]
    new = harness_golden._resolve_cli(golden._split(args.new)) if args.new else ref
    matrix = cells()
    if args.only:
        keep = [p.strip() for p in args.only.split(",") if p.strip()]
        matrix = [c for c in matrix if any(c["id"].startswith(p) for p in keep)]
        if not matrix:
            print(f"[web-golden] --only {','.join(keep)} selected 0 cells — nothing would "
                  f"be compared, which is not a pass.")
            return 2
    return compare(ref, new, matrix, args.limit)


if __name__ == "__main__":
    raise SystemExit(main())
