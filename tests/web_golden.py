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
import concurrent.futures
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
    # ---- P6g's job id, which is the same WIDTH on both sides ------------------------------
    #
    # 16 hex characters, `secrets.token_hex(8)` against `randomBytes(8).toString('hex')`, so
    # it belongs above the line rather than below it: the Content-Length it produces IS
    # comparable, and a cell that SEEDS a history file can name its own ids in any other
    # spelling and have them compared literally — which is what gates the ordering and the
    # running-job drop in `_load_history`.
    (re.compile(r'"(job_id|id)": "[0-9a-f]{16}"'), r'"\1": "<JOBID>"'),
)

# The same idea for values whose WIDTH differs too, which is a second question and not a
# tidier spelling of the first.
#
# `Content-Length` is a consequence of the body, so a normalised value of a DIFFERENT LENGTH
# on the two sides moves the header as well — and comparing the header would then
# re-introduce, through the back door, the comparison this file has already decided it cannot
# make. `checked_at` and `build_time` are exactly 16 characters on both sides forever, so
# their cells still gate the header exactly. These four are not:
#
#   * `python` — `"3.13.5"` against `null`, the P6b field with no honest twin.
#   * `started` / `duration` — a job's wall clock and its measured runtime. `time.time()`
#     yields seven decimals and `Date.now() / 1000` yields three, and BOTH are spelt without
#     a decimal point when they land on a whole second (`json.dumps(1754.0)` is `1754.0`,
#     `JSON.stringify(1754)` is `1754`) — so the pattern must accept a bare integer or it
#     misses the Node side about one run in a thousand, which is the flakiest possible gate.
#     `null` is deliberately NOT matched: that is the RUNNING state, and it must stay visible.
#   * the `$ <argv>` echo — see below.
_WEB_STAMPS_WIDTH = (
    # The one field in P6b with no honest twin: the reference reports the interpreter
    # running the daemon and a Node daemon has none. Both spellings are accepted so the
    # tag appears on both sides; the reference's actual value is asserted absolutely in
    # `tests/test_web_server.py`, which is the debt a tolerant comparison owes.
    (re.compile(r'"python": (?:"\d+\.\d+\.\d+[^"]*"|null)'), '"python": "<RUNTIME>"'),
    (re.compile(r'"started": \d+(?:\.\d+)?'), '"started": <T>'),
    (re.compile(r'"duration": \d+(?:\.\d+)?'), '"duration": <SECS>'),
    # THE `$ <argv>` ECHO, and it is the one normalisation this phase had to argue for.
    #
    # `JobManager._run` writes `$ ` + the argv it is about to start as the job's first output
    # line. The two argvs cannot be byte-equal by construction — the reference runs
    # `C:\Python313\python.exe …\rituals\harness.py doctor` and the twin runs
    # `node …\bin\geneseed-cli.mjs doctor` — and that is the POINT of the port, not a defect
    # in it. Byte-comparing it would demand the twin name `python harness.py`, which is
    # exactly the passthrough this port exists to remove.
    #
    # So it is normalised here and asserted ABSOLUTELY on each side in
    # `tests/test_web_jobs.py`: the reference's argv head is its own interpreter and
    # `harness.py`/`build.py`, the twin's is `node` and `bin/geneseed-cli.mjs`/
    # `bin/geneseed.mjs`, and the TAIL — every argument after the head, where a real port bug
    # would live — is compared literally. That is the P6b `python` precedent, now with a name.
    #
    # ANCHORED ON `"output": "` OR ON AN ESCAPED NEWLINE, never on a bare `$ `: the job's
    # output is arbitrary text and a `$ ` inside it is not an echo line. The body is JSON, so
    # the line ends at the first `\n` ESCAPE and can carry no raw newline.
    (re.compile(r'(?<=: ")\$ (?:[^"\\]|\\.)*?\\n'), '$ <ARGV>\\\\n'),
    (re.compile(r'(?<=\\n)\$ (?:[^"\\]|\\.)*?\\n'), '$ <ARGV>\\\\n'),
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

# The catalog's memory ordering, which is the PLATFORM'S ordering and not a preference.
#
# Both implementations sort through `os.path.normcase` / `normcase` — case-folded on Windows,
# the identity on POSIX — so `MEMORY.md` files under `m` on Windows and under `M` (0x4D, ahead
# of `a`) everywhere else. The two sides agree on either host; what could not be written once
# is the ABSOLUTE assertion, and these two names are it. The first Linux run of this harness
# reported both cells as VACUOUS, which is the correct report for an assertion that named one
# platform's answer: the comparison passed and the claim about the reference did not.
_MEM_CASE_FOLDED = sys.platform == "win32"
_ORDER_MEM_ANOTHER = (r'"name": "another".*"name": "MEMORY"' if _MEM_CASE_FOLDED
                      else r'"name": "MEMORY".*"name": "another"')
_ORDER_MEM_ALL = (r'"name": "a-fact".*"name": "another".*"name": "MEMORY"'
                  if _MEM_CASE_FOLDED
                  else r'"name": "MEMORY".*"name": "a-fact".*"name": "another"')

# `poll=True`'s budget. A job cell starts a REAL child process — P6g's is `doctor`, which
# renders a theme, runs five emits and syntax-checks every plugin — so the wait is seconds,
# not milliseconds. 240 × 0.25 s is four minutes per poll, which is long enough that
# exhausting it means the job wedged rather than that the machine was busy; the cell's own
# `expect` names `"status": "done"`, so an exhausted poll is reported as a VACUOUS cell
# rather than compared as a pair of matching `running` bodies.
_POLL_MAX = 240
_POLL_EVERY = 0.25


def _clock_repl(now: int) -> dict:
    """P6f's DATES, derived from the cell's own shared clock rather than destamped.

    `api_rules_promote` stamps two dates into the rule it writes: `promoted <today>` in the
    provenance line, and `today + 30 days` as the trial expiry. Both are read from the
    system clock INSIDE the server, so nothing a request carries can seed them — and a
    destamp is exactly the wrong tool, because it would erase the one rule this endpoint
    owns (a month of probation, not a week and not none) and leave two servers that both
    wrote the wrong date agreeing forever. That is P6b's lesson about the clock, one phase
    on: ask what the destamp would make invisible.

    So the two dates are COMPUTED from `now` — the same second `run_cell` seeds both sides
    with — and named in the cell's absolute expectations. The cross-implementation
    comparison is untouched and still exact: both servers read the real clock seconds apart,
    so they write the same date except across a midnight boundary, which this harness has in
    common with `checked_at` and states rather than hides.
    """
    import datetime
    today = datetime.date.fromtimestamp(now)
    return {"{today}": today.isoformat(),
            "{trial}": (today + datetime.timedelta(days=30)).isoformat()}


def _web_destamp(data: bytes) -> bytes:
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return data
    for pat, repl in _WEB_STAMPS + _WEB_STAMPS_WIDTH:
        text = pat.sub(repl, text)
    return text.encode("utf-8")


def _width_varies(body: bytes) -> bool:
    """Does this body carry a normalised value whose LENGTH differs between the two sides?

    The question `Content-Length` asks. See `_WEB_STAMPS_WIDTH`.
    """
    try:
        text = body.decode("utf-8")
    except UnicodeDecodeError:
        return False
    return any(pat.search(text) for pat, _ in _WEB_STAMPS_WIDTH)


# ---- cells -----------------------------------------------------------------

def _req(method="GET", path="/api/ping", headers=None, body=None, reconnect=False,
         token=False, from_body=None, poll=False):
    """One request.

    `token=True` sends the running server's real CSRF token, which the cell cannot know
    when it is written.

    `from_body="fingerprint"` is P6f's sibling of that mechanism, and it exists for the
    same reason one step further in: the fingerprint-guarded writes require the client to
    send back a value the SERVER computed from the file on disk, so a cell cannot write it
    down either. The named field is read out of the PREVIOUS response's JSON body and
    substituted for `{FROM_BODY}` in this request's body — which makes the fingerprint arm
    a TWO-REQUEST cell: GET the resource, then POST with what it answered.

    AND THE SUBSTITUTED VALUE IS AN OBSERVATION, which is not decoration. If the field were
    missing the substitution would quietly send an empty string, the endpoint would take
    its STALE arm, and a cell written to gate the fresh arm would compare two 409s and look
    green. `<rN sent>` puts the bytes that actually went on the wire into the snapshot, so
    the two sides are compared on what they SENT as well as on what came back — and an
    EMPTY substitution is reported as a vacuity finding rather than left to be discovered.

    `{FROM_BODY}` IS SUBSTITUTED INTO THE PATH TOO, which P6g needs and P6f did not: a job
    is polled at `GET /api/jobs/<id>` and the id arrives in the 202's body. The same
    mechanism, one field over.

    `poll=True` re-sends this request until the response body's `status` stops being
    `"running"`, and records only the LAST one. A job is asynchronous by design — that is the
    whole reason it is a job and not a synchronous endpoint — so a single GET after the 202
    would race the child process and record `running` or `done` depending on how the machine
    felt. Only the final response is an observation; the intermediate ones are the wait. The
    attempt cap turns a wedged job into a reported difference rather than a hung harness.
    """
    return {"method": method, "path": path, "headers": dict(headers or {}),
            "body": body, "reconnect": reconnect, "token": token, "from_body": from_body,
            "poll": poll}


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
    out += _mutate_cells(cell)
    out += _job_cells(cell)
    out += _install_cells(cell)
    return out


# ---- P6g — the job runner and the action table -----------------------------------------
#
# A JOB CELL IS A THREE-REQUEST SCRIPT and the harness reuses one connection, so it is ONE
# cell: POST `/api/actions/<x>` answers 202 with a fresh id, `GET /api/jobs/<id>` is polled
# until it stops saying `running`, and `GET /api/jobs` reads the history back. The id is
# carried across by `from_body`, which P6f built for a request BODY and P6g needed in a PATH.
#
# WHICH ACTIONS A CELL MAY RUN, and the answer is not "the cheapest". A job starts a REAL
# child process against the REAL checkout (`cwd=ROOT`, which is the reference's own choice),
# so the criterion is what that child may TOUCH. `doctor` and `build` render; `uninstall`
# DELETES, and `_install_targets()` walks the job's cwd — so a cell that ran it would be one
# stray manifest in the developer's own checkout away from deleting their harness. The two
# rows below run against a world with NO install, where each is a refusal that writes
# nothing: `rebuild-all` prints "no active installs" and exits 0, `diff --out` writes one
# line to STDERR and exits 1. Between them they gate both exit-code arms, both streams and
# the `[web] ✗` epilogue, for the price of two sub-second children.
#
# THE OTHER THREE ROWS ARE GATED BY A CORPUS, not by a cell — `tests/test_web_jobs.py` calls
# `action_commands` and `actionCommands` directly and compares all eight rows. A cell runs the
# PROGRAM; a corpus runs the FUNCTION, and the argv is a function's return value that no
# response body ever carries.
#
# AND THE `$ <argv>` ECHO CANNOT BE COMPARED. See `_WEB_STAMPS`' last two entries: the two
# argvs differ by construction and that difference IS the port. Normalised here, asserted
# absolutely per side there.
_OC_PATH = "{homeJ}{sepJ}.config{sepJ}opencode"

# A history file as `_save_history` writes one, seeded so `_load_history` has something to
# read. Key ORDER is the file's order on both sides (`json.dumps` and `JSON.stringify` both
# preserve insertion order, and neither sorts), so the whole record shape is comparable.
#
# FOUR ENTRIES, THREE OF THEM NEGATIVE. `seed-live` is `running`, which means the server died
# mid-job and the entry must be DROPPED rather than resurrected as a job that will never
# finish. The `id`-less object and the bare string are the two `isinstance` guards. And the
# two survivors are seeded OUT OF ORDER so the `started` sort has work to do — their ids are
# not 16 hex, so `_WEB_STAMPS` leaves them alone and the order is compared literally.
_SEEDED_HISTORY = json.dumps([
    {"id": "seed-b", "action": "build", "status": "failed", "output": "the newer one\n",
     "returncode": 1, "started": 200, "duration": 2.5},
    {"id": "seed-a", "action": "doctor", "status": "done", "output": "the older one\n",
     "returncode": 0, "started": 100, "duration": 1.5},
    {"id": "seed-live", "action": "update", "status": "running", "output": "orphaned\n",
     "returncode": None, "started": 300, "duration": None},
    {"action": "doctor", "status": "done", "output": "no id at all\n"},
    "not a dict",
])


def _job_cells(cell) -> list[dict]:
    return [
        # ---- the read side, before anything has run -------------------------------------
        cell("jobs/nothing-has-run-so-the-list-is-empty-and-an-unknown-id-is-a-404",
             [_req(path="/api/jobs"),
              _req(path="/api/jobs/0123456789abcdef"),
              _req("POST", path="/api/jobs/0123456789abcdef/cancel", body=b"{}", token=True),
              _req("POST", path="/api/actions/nope", body=b"{}", token=True)],
             world={"repo/.keep": ""},
             # The four answers that need no child process, and the last two are the
             # partition's own shape. `cancel` on an id that never existed is a 404 and not a
             # 500; an action the TABLE does not name is `{"error": "unknown action nope"}` at
             # 404 — which is the SAME shape the three unported rows would take if they were
             # left to fall through, and precisely why they are declared as 501 instead. The
             # dispatcher probe in tests/test_web_server.py holds the two apart.
             expect=['{"jobs": []}', '{"error": "no such job"}', '404 Not Found',
                     '{"error": "no running job by that id"}',
                     '{"error": "unknown action nope"}'],
             expect_absent=['not ported yet']),

        cell("jobs/a-persisted-history-is-restored-and-a-running-entry-is-dropped",
             [_req(path="/api/jobs"), _req(path="/api/jobs/seed-a")],
             world={"repo/.keep": "", f"{_OC}/.geneseed-web-runs.json": _SEEDED_HISTORY},
             # `_load_history` is the only thing standing between a reload and an empty
             # console, and every one of its rules is a silent failure: a port that skipped
             # the `running` filter shows a job that will never finish, one that skipped the
             # sort shows the newest first, one that skipped the `id` guard crashes on the
             # object that has none. The second request proves the restored entries are
             # addressable and not merely listed.
             expect=['{"jobs": [{"id": "seed-a", "action": "doctor", "status": "done", '
                     '"output": "the older one\\n", "returncode": 0, "started": <T>, '
                     '"duration": <SECS>}, {"id": "seed-b", "action": "build"',
                     '{"id": "seed-a", "action": "doctor"'],
             expect_absent=['seed-live', 'orphaned', 'no id at all', 'not a dict'],
             # A read must not rewrite the file it read.
             expect_files=[f"{_OC}/.geneseed-web-runs.json"]),

        # ---- the runner, end to end ------------------------------------------------------
        cell("jobs/two-actions-run-in-turn-stream-both-streams-and-persist-their-history",
             [_req("POST", path="/api/actions/build-all", body=b"{}", token=True),
              _req(path="/api/jobs/{FROM_BODY}", from_body="job_id", poll=True),
              _req("POST", path="/api/actions/export", body=b"{}", token=True),
              _req(path="/api/jobs/{FROM_BODY}", from_body="job_id", poll=True),
              _req(path="/api/jobs")],
             # NO INSTALL, deliberately — see the block above. `.keep` under the config dir
             # is what makes the directory exist, which `_save_history`'s `write_text` needs
             # and which an empty world would silently deny (its OSError is swallowed, so the
             # history file would simply never appear and this cell's file gate would be
             # vacuous).
             world={"repo/.keep": "", f"{_OC}/.keep": ""},
             expect=[
                 # The 202 and its fresh id — normalised, but its SHAPE is the assertion:
                 # a side that answered 200, or answered no id, leaves no tag here.
                 '{"job_id": "<JOBID>"}',
                 # rc 0, on STDOUT, from `[[py, h, "rebuild-all"]]`.
                 '"action": "build-all", "status": "done"',
                 '[rebuild-all] no active installs detected.',
                 '"returncode": 0',
                 # rc 1, on STDERR — which is the merge `stderr=STDOUT` performs and which a
                 # port reading only stdout would drop entirely — plus the epilogue the
                 # RUNNER appends when a step fails.
                 '"action": "export", "status": "failed"',
                 '[diff] no global Geneseed install at <HOME>',
                 # `\\u2717`, not `✗`: `_send_json` is `json.dumps` with its default
                 # `ensure_ascii=True`, so the epilogue reaches the wire escaped — and
                 # `jsonDumpsCompact` had to agree, which P4b measured the hard way.
                 '[web] \\u2717 command exited with code 1.',
                 '"returncode": 1',
                 # The echo line, once per job, normalised. Its ABSOLUTE form is
                 # tests/test_web_jobs.py's.
                 '"output": "$ <ARGV>\\n',
             ],
             # The finished-job order in the history, oldest first — `recent()` sorts by
             # `started` and the console appends in that order. Anchored on the ARRAY, so it
             # reads r5 and not a pair of single-job details two requests apart.
             expect_re=[r'\{"jobs": \[\{"id": "<JOBID>", "action": "build-all".*'
                        r'"action": "export"'],
             expect_files=[f"{_OC}/.geneseed-web-runs.json"]),

        # ---- /api/actions/restore — synchronous, not a job -------------------------------
        cell("restore/the-source-render-wins-and-an-unknown-or-climbing-path-is-an-error",
             [_req("POST", path="/api/actions/restore", token=True,
                   body=b'{"files": ["AGENT.md", "nope.md", "../escaped.md", ""]}'),
              _req(path="/api/diff")],
             world=_installed(),
             # `api_restore` renders the EXPECTED tree with the install's own host emit and
             # footprint and then, per path: present in expected -> overwrite; absent from
             # expected but present in deployed -> delete; neither -> an error. The seeded
             # AGENT.md is a local edit, so the restore must replace it — and the `/api/diff`
             # that follows is what proves it: the drift the first cell of this world reports
             # is GONE. A restore nothing reads back is a restore no cell can see.
             expect=['{"restored": ["AGENT.md"], "deleted": [],',
                     '"nope.md: not in the source render nor deployed"',
                     '"../escaped.md: outside the deployed tree"',
                     '": outside the deployed tree"',
                     '"deployed": true'],
             # AGENT.md is the ONLY file the seeded manifest owns, so before the restore it
             # is the diff's one `edited` row and after it there is no row for it at all —
             # `_diff_collect` records nothing for a file that matches. The seeded body is
             # named too, because it is what the unified diff would carry.
             expect_absent=['A local edit the source render does not have',
                            '"rel": "AGENT.md"'],
             expect_files=[f"{_OC}/AGENT.md"]),

        # ---- the two command RESOLVERS, on their refusal arms ----------------------------
        cell("actions/install-and-deploy-refuse-every-body-they-cannot-validate",
             [_req("POST", path="/api/actions/install", token=True,
                   body=b'{"host": "opencode", "path": "nowhere"}'),
              _req("POST", path="/api/actions/install", token=True,
                   body=b'{"host": "opencode", "path": "' + _OC_PATH.encode() + b'"}'),
              _req("POST", path="/api/actions/deploy", token=True, body=b'{}'),
              _req("POST", path="/api/actions/deploy", token=True,
                   body=b'{"host": "opencode"}'),
              _req("POST", path="/api/actions/deploy", token=True,
                   body=b'{"host": "opencode", "path": "{repoJ}{sepJ}nope"}'),
              _req("POST", path="/api/actions/deploy", token=True,
                   body=b'{"host": "opencode", "path": "' + _OC_PATH.encode() + b'"}'),
              _req(path="/api/jobs")],
             # A DISABLED install, so request two reaches the arm that exists only for it.
             # Every request here is a refusal, and the last one is the control that says so:
             # not one of them started a job.
             world=_installed(**{f"{_OC}/.geneseed-disabled/.keep": ""}),
             expect=['{"error": "not found: unknown install (host, path)"}',
                     # `\\u2014`, not the em dash itself — `ensure_ascii=True`, as with the
                     # `[web] \\u2717` epilogue three cells up. The ref-vs-ref self-check
                     # reported this one as VACUOUS before the port existed.
                     '{"error": "install is disabled \\u2014 reactivate it before '
                     '(re)building"}', '409 Conflict',
                     '{"error": "unknown host: (none)"}', '400 Bad Request',
                     '{"error": "no folder given"}',
                     '{"error": "not a folder: <SB>',
                     '{"error": "that\'s a host global config dir',
                     '{"jobs": []}'],
             expect_absent=['"job_id"']),
    ]


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


# ---- P6f — the mutating endpoints ------------------------------------------------------
#
# THE FIRST WEB WRITES, and three things arrive with them.
#
# THE 409 CONVENTION. `ok: False` maps to 409 on five paths, and it covers two different
# faults with one status: a STALE FINGERPRINT (an agent session edited the same file since
# the client loaded it) and a MALFORMED BODY. Both are gated below, and the second is what
# `_read_json_body` is for — a body that is not JSON must reach the endpoint as `{}` and be
# refused by the endpoint's own validation, never as a 500 from a parse two frames down.
# `POST /api/activity` is the counter-example that makes the convention gateable at all: it
# answers 200 whatever `ok` says, so a port applying the rule uniformly fails there.
#
# THE FINGERPRINT ARM IS A TWO-REQUEST CELL, because the value is one the SERVER computed
# and the cell cannot know. `from_body="fingerprint"` is the mechanism (see `_req`), and the
# MISSING observation is what stops it from failing open.
#
# A WRITE CELL NEEDS THE FILE DIRECTIONS. `api_memory_delete` unlinks a fact AND rewrites
# MEMORY.md, and P5h's three directions are all three needed: `expect_absent_files` for what
# went, `expect_files` for what survived, and — because a listing cannot see a line inside a
# file — a request that READS MEMORY.md back through `/api/item/memory/MEMORY`, which is the
# only way an index line dropped or kept becomes a response byte.
_RULES_TEXT = (
    "# User rules\n"
    "\n"
    "## R1 — Always run the tests\n"
    "(scope: project | source: a session | trial until: 2020-01-01)\n"
    "Run the suite before you claim it works.\n"
    "\n"
    "## R2 — Prefer the stdlib\n"
    "(scope: user)\n"
    "Reach for a dependency last.\n"
    "\n"
    "## R3 — On probation\n"
    "(trial until: 2999-01-01)\n"
    "Not overdue yet.\n"
    "\n"
    # A DUPLICATE ID, and no metadata line under it — two axes in one block. The duplicate
    # is the only thing that produces a `warnings` entry, and the missing `(…)` line is the
    # arm where `_parse_rule_meta` returns `{}` and `k` does NOT advance, so the body starts
    # on the line the metadata would have been.
    "## R2 — a duplicate id\n"
    "No metadata line at all.\n"
)
# sha256(_RULES_TEXT)[:16] — stated so the cells gate the digest and its TRUNCATION rather
# than merely that some hex came back, and so a mutation cell can carry a CORRECT fingerprint
# as a literal without a preceding GET.
_RULES_FP = "a1927eeaa2b464c3"

# `_memory_drop_index` drops every line carrying `(<name>.md)`. Two facts, so the surviving
# line is a positive control: a port that rewrote the whole index, or truncated it, or
# dropped nothing, each answers differently.
_MEMORY_INDEX = ("# Memory\n\n- [a fact](a-fact.md) — the one being promoted\n"
                 "- [another](another.md) — the one that must survive\n")


def _rules_world(**extra) -> dict:
    return _installed(**{f"{_OC}/user-rules.md": _RULES_TEXT, **extra})


def _mem_world(**extra) -> dict:
    return _installed(**{
        f"{_OC}/memory/MEMORY.md": _MEMORY_INDEX,
        f"{_OC}/memory/a-fact.md":
            "---\nname: a-fact\ndescription: one fact\n---\n\nthe fact's body\n",
        f"{_OC}/memory/another.md": "---\nname: another\n---\n\nsurvives\n",
        **extra,
    })


# The OpenCode global install's MCP config, as `_mcp_config_for` resolves it and as
# `api_mcp_toggle`'s allowlist spells it: `str(Path)`, so the platform separator and the
# JSON-escaped root. See `run_cell`'s `{xJ}` block for why this cannot be `{home/}`.
_OC_MCP = "{homeJ}{sepJ}.config{sepJ}opencode{sepJ}opencode.json"
_CLAUDE_MCP = "{homeJ}{sepJ}.claude.json"


def _mutate_cells(cell) -> list[dict]:
    """P6f — every POST that owns its own path, plus the two GETs that came with them."""
    return [
        # ---- POST /api/activity — the cheapest of the nine ------------------------------
        cell("toggle/the-activity-flag-is-written-read-back-and-defaults-on",
             [_req("POST", path="/api/activity", body=b'{"enabled": false}', token=True),
              _req(path="/api/activity"),
              _req("POST", path="/api/activity", body=b'{"enabled": true}', token=True),
              _req(path="/api/activity"),
              _req("POST", path="/api/activity", body=b'{}', token=True),
              _req("POST", path="/api/activity", body=b'{"enabled": 1}', token=True),
              _req("POST", path="/api/activity", body=b'{"enabled": ""}', token=True)],
             world=_installed(**{
                 f"{_OC}/activity/s-one.json": _act("s-one", "{now}", "{pid}")}),
             # SEVEN requests over one connection, and each one is an axis. The pair of
             # toggles is the flag written in both directions and READ BACK through the GET
             # that follows it — a write nothing reads is a write no cell can see. The empty
             # body is `bool(body.get("enabled", True))`'s DEFAULT: it enables.
             #
             # AND THE LAST TWO ARE `bool()` ITSELF, added because a mutation survived
             # without them. `body.enabled === true` answers identically to `pyTruthy` for
             # every JSON boolean, so three cells' worth of `true`/`false` could not tell the
             # two apart — the survivor was a question about the CORPUS OF INPUTS, not about
             # the code. `1` is truthy to Python and not `=== true`; `""` is falsy to both,
             # which is what makes the pair a control rather than a single leading case.
             #
             # AND THIS PATH ANSWERS 200 WHATEVER `ok` SAYS. Every other POST here maps
             # `ok: false` to 409; this one does not, which is why the dispatcher carries the
             # convention as a per-route COLUMN rather than as a rule about bodies. No cell
             # can reach its `ok: false` arm (it needs the flag write to raise, and the two
             # runtimes word an OSError differently), so the COLUMN itself is cross-checked
             # against the reference by `ast` in `tests/test_web_server.py`.
             expect=['{"ok": true, "enabled": false}', "200 OK",
                     '{"enabled": false, "activity": []}',
                     '{"ok": true, "enabled": true}',
                     '{"session_id": "s-one"'],
             expect_files=[f"{_OC}/.geneseed-activity",
                           f"{_OC}/activity/s-one.json"]),

        # ---- POST /api/excludes ---------------------------------------------------------
        cell("excludes/an-add-and-a-remove-round-trip-through-every-global-install",
             [_req("POST", path="/api/excludes", token=True,
                   body=b'{"action": "add", "path": "{repo/}"}'),
              _req(path="/api/excludes"),
              _req("POST", path="/api/excludes", token=True,
                   body=b'{"action": "remove", "path": "{repo/}"}'),
              _req(path="/api/excludes")],
             world=_installed(),
             # `api_excludes_mutate` owns no exclusion logic — it validates the body and
             # hands off to the same `exclude_add`/`exclude_remove` the CLI verb calls. So
             # the cell's job is the round trip: the add lands in `excludes.json`, the GET in
             # between proves it is READABLE (a write no read confirms is a write to
             # nowhere), and the remove takes it out again. The final GET is the negative
             # control the first one cannot be.
             #
             # `wired` is EMPTY for an OpenCode install and that is the reference's answer,
             # not an omission: the per-host suppression `exclude_add` records is Claude's
             # `claudeMdExcludes` and Bob's rules stub, and OpenCode has neither. P6b's
             # `excludes/a-seeded-exclusion-is-listed-with-its-host` HAND-SEEDS
             # `"wired": {"opencode": true}` into the file, which is a shape the engine never
             # writes — so this is also the cell that says what a real add produces.
             expect=['{"ok": true, "path": "<SB>', '"messages": []}', "200 OK",
                     '"hosts": ["opencode"]', '"wired": {}',
                     '{"excludes": [], "installs": [{'],
             expect_files=[f"{_OC}/excludes.json"]),
        cell("excludes/a-malformed-body-is-409-and-never-reaches-the-engine",
             [_req("POST", path="/api/excludes", token=True, body=b"not json at all"),
              _req("POST", path="/api/excludes", token=True,
                   body=b'{"action": "nope", "path": "{repo/}"}'),
              _req("POST", path="/api/excludes", token=True,
                   body=b'{"action": "add", "path": "   "}'),
              _req(path="/api/excludes")],
             world=_installed(),
             # THE `_read_json_body` GATE, which is what P6a's retained drain was for. A body
             # that is not JSON must arrive at the endpoint as `{}` and be refused by its own
             # validation — the SAME 409 body as a well-formed body with a bad action. A port
             # that let the parse error escape answers 500 with a message the two runtimes
             # word differently, and P5a's one un-portable line is the precedent for why that
             # matters.
             #
             # The blank path is the third arm: `str(...).strip()` is what turns "   " into
             # the empty string the guard rejects, and without it the path reaches
             # `exclude_add`, which assumes a real one.
             expect=["409 Conflict",
                     '{"ok": false, "path": "", "messages": ["body must be '
                     '{action: add|remove, path: <folder>}"]}'],
             # Nothing was excluded, so no install grew a list. The direction the response
             # cannot carry.
             expect_absent=["500 Internal", '"ok": true'],
             expect_absent_files=[f"{_OC}/excludes.json"]),

        # ---- POST /api/view -------------------------------------------------------------
        cell("view/selecting-a-detected-install-repoints-every-later-read",
             [_req(path="/api/docs"),
              _req("POST", path="/api/view", token=True,
                   body=b'{"host": "claude", "path": "{repoJ}"}'),
              _req(path="/api/docs"),
              _req(path="/api/overview"),
              _req(path="/api/catalog/agents"),
              _req("POST", path="/api/view", token=True,
                   body=b'{"host": "opencode", "path": "{repoJ}"}')],
             world=_installed(**{
                 # A Claude PROJECT install: the data dir is `<repo>/.claude` and the markers
                 # land at `<repo>/` — which is the whole reason `_view_cfg` is host-driven,
                 # and the case a port reading the bare root mis-detects as opencode/neutral.
                 "repo/.claude/.geneseed-manifest.json": json.dumps({"owned": ["AGENT.md"]}),
                 "repo/.claude/AGENT.md": "# Claude project AGENT.md\n",
                 "repo/.claude/agents/only-here.md":
                     "---\nname: only-here\n---\n\n> only in the project install\n\nb\n",
                 "repo/.geneseed-emit": "claude\n",
                 "repo/.geneseed-theme": "neutral\n",
             }),
             # THE CELL THAT PAYS P6d's DEBT. `_norm_harness` resolves the Docs selector's
             # default from `state.emit`, and `state.emit` is exactly what a select_view
             # moves — so the two `/api/docs` requests around the POST are the interaction
             # neither phase could gate alone: opencode before, claude after, with nothing
             # but the view change between them.
             #
             # The overview and the catalog afterwards are the second direction: the
             # console's whole target moved, so the theme and the agent set now come from the
             # project install's own dirs.
             #
             # And the last request is the allowlist: `(host, path)` is a PAIR, and `repo` is
             # a real detected path — for `claude`, not for `opencode`. Pointing the same
             # path at the wrong host must 404, which is what says the pair is the key rather
             # than the path.
             expect=['"harness": "opencode"',
                     '{"ok": true, "target": "<SB>',
                     '"theme": "neutral", "emit": "claude"}',
                     '"harness": "claude"',
                     '"name": "only-here"',
                     '{"error": "not found: unknown install (host, path)"}',
                     "404 Not Found"],
             # The imperial global's own voice must be gone from the overview once the view
             # has moved — otherwise "re-pointed" is indistinguishable from "answered ok and
             # changed nothing".
             expect_absent=['"theme": "imperial", "accent": "yellow"']),
        cell("view/an-unknown-pair-and-a-malformed-body-are-both-404",
             [_req("POST", path="/api/view", token=True,
                   body=b'{"host": "vim", "path": "{repoJ}"}'),
              _req("POST", path="/api/view", token=True, body=b"}{"),
              _req(path="/api/overview")],
             world=_installed(),
             # `known.get((body.get("host") or "", body.get("path") or ""))` — an unknown
             # host and an empty pair take the same arm, which is what `_read_json_body`
             # returning `{}` buys: the malformed body is a 404 naming the install, not a 500
             # naming a parser. The GET afterwards is what says nothing moved.
             expect=['{"error": "not found: unknown install (host, path)"}', "404 Not Found",
                     '"theme": "imperial"'],
             expect_absent=["500 Internal"]),

        # ---- POST /api/memory/delete ----------------------------------------------------
        cell("memory/deleting-a-fact-drops-its-file-and-its-index-line",
             [_req("POST", path="/api/memory/delete", token=True,
                   body=b'{"name": "a-fact"}'),
              _req(path="/api/item/memory/MEMORY"),
              _req(path="/api/catalog/memory"),
              _req("POST", path="/api/memory/delete", token=True,
                   body=b'{"name": "a-fact"}')],
             world=_mem_world(),
             # ALL THREE OF P5h's DIRECTIONS, and the third one is the reason this cell has
             # four requests. `expect_absent_files` says the fact went; `expect_files` says
             # its neighbour and the index survived; but a directory listing cannot see a
             # LINE, and `_memory_drop_index` rewrites MEMORY.md in place. So the index is
             # read back through the catalog's own item route — the only way a dropped or
             # kept index line becomes a response byte.
             #
             # The last request is the idempotence arm: a second delete of the same name is a
             # 404, not a second success, and it is what says the first one really removed
             # the file rather than merely reporting so.
             expect=['{"deleted": "a-fact"}', "200 OK",
                     "- [another](another.md)",
                     '"name": "another", "title": "another"',
                     '{"error": "not found: a-fact"}', "404 Not Found"],
             expect_absent=["- [a fact](a-fact.md)", '"name": "a-fact"'],
             # AND THE ORDER, absolutely — the reference sorts `Path` objects, whose
             # comparison is case-FOLDED on Windows, so `MEMORY.md` files under `m` and comes
             # last. This is the first cell in the whole port with an upper-case name in a
             # catalog directory, and it found a live bug: the Node twin sorted with JS's
             # default comparator (UTF-16 code units), which puts `M` before `a`. Naming the
             # order here is what keeps the fix gated rather than incidental.
             #
             # THE ORDER IS THE PLATFORM'S, and both are right. `PurePath.__lt__` compares
             # `os.path.normcase` parts, which folds case on Windows and is the identity on
             # POSIX — so `MEMORY` sorts LAST on Windows (`m`) and FIRST on Linux (`M` is
             # 0x4D, `a` is 0x61). `comparePaths` spells the same `normcase`, so the two
             # implementations agree on both hosts and it is only this ABSOLUTE assertion
             # that had to learn the second answer. Written as a conditional rather than
             # relaxed to an unordered match, because the ordering is the whole reason the
             # `expect_re` is here: `_exclude_cells`' `remove-a-case-differing-entry` is the
             # same shape.
             expect_re=[_ORDER_MEM_ANOTHER],
             expect_files=[f"{_OC}/memory/MEMORY.md", f"{_OC}/memory/another.md"],
             expect_absent_files=[f"{_OC}/memory/a-fact.md"]),
        cell("memory/a-reserved-or-climbing-name-is-refused-and-touches-nothing",
             [_req("POST", path="/api/memory/delete", token=True, body=b'{"name": "MEMORY"}'),
              _req("POST", path="/api/memory/delete", token=True, body=b'{"name": "README"}'),
              _req("POST", path="/api/memory/delete", token=True,
                   body=b'{"name": "../../build"}'),
              _req("POST", path="/api/memory/delete", token=True,
                   body=b'{"name": "..\\\\..\\\\build"}'),
              _req("POST", path="/api/memory/delete", token=True, body=b'{}'),
              _req("POST", path="/api/memory/delete", token=True, body=b"not json")],
             world=_mem_world(**{f"{_OC}/memory/README.md": "# how memory works\n"}),
             # THE SECURITY BRANCH, and a refusal cell whose target does not exist proves
             # nothing (P6c). So `MEMORY.md` and `README.md` are both REALLY THERE: the
             # reserved-name clause is the only thing between this endpoint and deleting the
             # index the agent reads at session start. Both separators are sent, because the
             # reference tests them separately and `\\` is the one a POSIX-only port drops.
             #
             # The blank name and the unparseable body are the same arm from two directions,
             # and the second is `_read_json_body` again: `{}` in, `not found: ` out — the
             # message ends with a space and nothing after it, which is what says the name was
             # empty rather than that the parse failed.
             expect=['{"error": "not found: MEMORY"}', '{"error": "not found: README"}',
                     '{"error": "not found: ../../build"}',
                     '{"error": "not found: ..\\\\..\\\\build"}',
                     '{"error": "not found: "}', "404 Not Found"],
             expect_absent=["500 Internal"],
             expect_files=[f"{_OC}/memory/MEMORY.md", f"{_OC}/memory/README.md",
                           f"{_OC}/memory/a-fact.md", f"{_OC}/memory/another.md"]),

        # ---- GET/POST /api/rules --------------------------------------------------------
        cell("rules/the-page-payload-parses-blocks-metadata-and-the-budget",
             [_req(path="/api/rules")], world=_rules_world(),
             # The GET half, which had to cross with the POST: the mutation endpoint splices
             # `parse_rules`' line indices, and the fingerprint the POST requires back is what
             # this answers. Every field here is one of the parser's rules — the em-dash
             # heading, the optional `(…)` metadata line with its `trial until` →
             # `trial_until` key rewrite, the default scope for a block that declares none,
             # the duplicate-id warning, and `overdue` as a STRING comparison against today
             # (2020 is past, 2999 is not — neither ever flips).
             expect=['"exists": true', f'"fingerprint": "{_RULES_FP}"',
                     '{"id": 1, "title": "Always run the tests", "scope": "project", '
                     '"source": "a session", "trial_until": "2020-01-01", '
                     '"status": "trial", "overdue": true, '
                     '"body": "Run the suite before you claim it works."}',
                     '{"id": 2, "title": "Prefer the stdlib", "scope": "user", '
                     '"source": "", "trial_until": "", "status": "active", '
                     '"overdue": false',
                     '"trial_until": "2999-01-01", "status": "trial", "overdue": false',
                     '"title": "a duplicate id", "scope": "project"',
                     '"body": "No metadata line at all."',
                     '"warnings": ["duplicate rule id R2"]',
                     '"stats": {"rules": 4, "lines": 16, "tokens": 82, '
                     '"max_rules": 15, "max_tokens": 1500}']),
        cell("rules/an-absent-file-reports-the-empty-shape-and-its-budget",
             [_req(path="/api/rules")], world=_installed(),
             # A REQUIRED field's emptiness, defined — the same debt P6b's profile cell pays:
             # `fingerprint` is "" and not the sha256 of the empty string, and the budget is
             # still reported so the meter has something to render.
             expect=['{"exists": false,', '"rules": [], "warnings": [], "fingerprint": ""',
                     '"stats": {"rules": 0, "lines": 0, "tokens": 0, "max_rules": 15']),
        cell("rules/an-add-assigns-the-next-free-id-and-returns-a-fresh-fingerprint",
             [_req(path="/api/rules"),
              _req("POST", path="/api/rules", token=True, from_body="fingerprint",
                   body=b'{"op": "add", "fingerprint": "{FROM_BODY}", '
                        b'"title": "  Write   it  down ", "body": "  the new body.  ", '
                        b'"scope": "nope", "source": " from  a  session ", '
                        b'"trial_until": "2031-02-03"}'),
              _req(path="/api/rules")],
             world=_rules_world(),
             # THE TWO-REQUEST FINGERPRINT CELL. The POST carries a value the GET before it
             # produced, and the MISSING observation is what proves it carried the real one
             # rather than an empty string that would have taken the 409 arm and looked green.
             #
             # `max(ids) + 1` is 4 and NOT 5, which is the whole point of seeding a duplicate
             # R2: a port counting rules instead of maxing their ids answers 5 here.
             #
             # Every normalisation in `_rule_fields` is varied at once: the title's runs of
             # whitespace collapse, the body is stripped, an unrecognised scope falls back to
             # `project` (never to the raw value — a bogus scope must not reach the file), the
             # source collapses too, and a well-formed trial date survives.
             expect=[f'"fingerprint": "{_RULES_FP}"',
                     '"op": "add", "id": 4,',
                     '"title": "Write it down", "scope": "project", '
                     '"source": "from a session", "trial_until": "2031-02-03", '
                     '"status": "trial", "overdue": false, "body": "the new body."'],
             expect_re=[r'\{"ok": true, "op": "add", "id": 4, "fingerprint": "[0-9a-f]{16}"\}'],
             expect_absent=['"id": 5', '"scope": "nope"']),
        cell("rules/an-update-splices-one-block-and-a-delete-swallows-its-separator",
             [_req("POST", path="/api/rules", token=True,
                   body=b'{"op": "update", "id": 2, "fingerprint": "' + _RULES_FP.encode()
                        + b'", "title": "Renamed", "body": "Replaced text.", '
                          b'"scope": "user"}'),
              _req("POST", path="/api/rules", token=True, from_body="fingerprint",
                   body=b'{"op": "delete", "id": 1, "fingerprint": "{FROM_BODY}"}'),
              _req(path="/api/rules")],
             world=_rules_world(),
             # THE CHAIN IS THE CONTRACT. The delete's fingerprint comes from the UPDATE's own
             # response, not from a re-fetch — which is what "returns the fresh fingerprint so
             # the client can chain edits" means, and a port that answered a stale one would
             # 409 on the second request.
             #
             # NO LEADING GET, and that is what makes `expect_absent` mean anything here.
             # `_RULES_FP` is a literal this file already knows, so the cell's only read is
             # the final one — a cell that fetched the rules first would carry "Prefer the
             # stdlib" in its own transcript and could never say the update replaced it.
             #
             # The splice is line-anchored: R3 keeps every byte including its metadata line,
             # while R2's block is replaced whole. The delete then swallows the ONE blank
             # separator line before its block — without that, repeated deletes leave a
             # growing run of blank lines in the user's file.
             expect=['"op": "update", "id": 2', '"op": "delete", "id": 1',
                     '"title": "Renamed", "scope": "user", "source": "", '
                     '"trial_until": "", "status": "active", "overdue": false, '
                     '"body": "Replaced text."',
                     '"id": 3, "title": "On probation"',
                     '"warnings": ["duplicate rule id R2"]'],
             expect_absent=['"title": "Prefer the stdlib"', '"id": 1, "title": "Always run',
                            "409 Conflict"]),
        cell("rules/a-stale-fingerprint-is-409-and-never-clobbers",
             [_req("POST", path="/api/rules", token=True,
                   body=b'{"op": "add", "fingerprint": "deadbeefdeadbeef", '
                        b'"title": "sneaked in", "body": "should never land"}'),
              _req("POST", path="/api/rules", token=True,
                   body=b'{"op": "delete", "id": 1, "fingerprint": ""}'),
              _req(path="/api/rules")],
             world=_rules_world(),
             # THE OTHER HALF OF THE 409 CONVENTION. An agent session editing user-rules.md
             # mid-flight is the case this exists for, and the empty fingerprint beside the
             # wrong one is the arm a port defaulting `body.get("fingerprint", "")` to
             # something else would let through — on an ABSENT file "" is the CORRECT
             # fingerprint, so only a seeded file can tell the two apart.
             expect=["409 Conflict",
                     '{"ok": false, "error": "conflict", "detail": "user-rules.md changed '
                     'since you loaded it \\u2014 reloading"}',
                     f'"fingerprint": "{_RULES_FP}"'],
             expect_absent=["sneaked in", "should never land", '"ok": true']),
        cell("rules/every-unusable-mutation-names-its-own-fault",
             [_req("POST", path="/api/rules", token=True, body=b'{"op": "nope"}'),
              _req("POST", path="/api/rules", token=True, body=b"not json at all"),
              _req("POST", path="/api/rules", token=True,
                   body=b'{"op": "update", "id": "abc", "fingerprint": ""}'),
              _req("POST", path="/api/rules", token=True,
                   body=b'{"op": "update", "id": 99, "fingerprint": ""}'),
              _req("POST", path="/api/rules", token=True,
                   body=b'{"op": "add", "fingerprint": "", "title": "   ", "body": "b"}'),
              _req("POST", path="/api/rules", token=True,
                   body=b'{"op": "add", "fingerprint": "", "title": "t", "body": "  "}'),
              _req("POST", path="/api/rules", token=True,
                   body=b'{"op": "add", "fingerprint": "", "title": "t", "body": "b", '
                        b'"trial_until": "next tuesday"}'),
              _req(path="/api/rules")],
             world=_installed(),
             # THE FILE IS ABSENT ON PURPOSE, which is what makes seven refusals fit in one
             # cell: `_rules_fingerprint("")` is "", so every request can carry the CORRECT
             # fingerprint as a literal and reach the validation behind it. With a seeded file
             # each would 409 first and six of the seven arms would be unreachable.
             #
             # The faults are three different statuses, and that is the point: an unknown op
             # and an unusable id are 404s (`NotFound`), an unusable FIELD is a 500 carrying
             # the ValueError's own message, and the unparseable body is the 404 that says
             # `_read_json_body` handed the endpoint `{}`. A port that funnelled all of them
             # into one status would pass a cell that only counted refusals.
             expect=['{"error": "not found: rules op \'nope\'"}',
                     '{"error": "not found: rules op None"}',
                     '{"error": "not found: rule id"}',
                     '{"error": "not found: rule R99"}',
                     '{"error": "a rule needs a title"}', "500 Internal Server Error",
                     '{"error": "a rule needs body text"}',
                     '{"error": "trial until must be YYYY-MM-DD"}',
                     '{"exists": false,'],
             expect_absent=['"ok": true'],
             expect_absent_files=[f"{_OC}/user-rules.md"]),
        cell("rules/an-add-to-a-file-that-does-not-exist-seeds-the-heading",
             [_req("POST", path="/api/rules", token=True,
                   body=b'{"op": "add", "fingerprint": "", "title": "First", '
                        b'"body": "the only rule."}'),
              _req(path="/api/rules")],
             world=_installed(),
             # `if not text: text = "# User rules\\n"` — the seed the build normally writes,
             # re-created here because the user deleted it. R1 rather than R4, because
             # `max(..., default=0) + 1` is the other arm of the id assignment.
             expect=['{"ok": true, "op": "add", "id": 1', '"exists": true',
                     '{"id": 1, "title": "First", "scope": "project"',
                     '"body": "the only rule."'],
             expect_files=[f"{_OC}/user-rules.md"]),

        # ---- POST /api/rules/promote ----------------------------------------------------
        cell("promote/a-memory-fact-becomes-a-trial-rule-with-its-provenance",
             [_req(path="/api/rules"),
              _req("POST", path="/api/rules/promote", token=True, from_body="fingerprint",
                   body=b'{"name": "a-fact", "fingerprint": "{FROM_BODY}", '
                        b'"delete_memory": true}'),
              _req(path="/api/rules"),
              _req(path="/api/item/memory/MEMORY")],
             world=_mem_world(**{f"{_OC}/user-rules.md": _RULES_TEXT}),
             # THE DATES COME FROM THE CELL'S OWN SHARED CLOCK, not from a destamp — see
             # `_clock_repl`. A month of probation is the rule this endpoint owns, and a
             # destamp on the date would erase exactly it.
             #
             # The title and body are the fallback chain with no overrides in the request: the
             # frontmatter `name`, then the memory body stripped. And `delete_memory` is
             # opt-in and composes with `api_memory_delete` — the fact goes AND its index line
             # goes with it, which the last request reads back.
             expect=['{"ok": true, "op": "add", "id": 4',
                     '"deleted_memory": "a-fact"',
                     '"title": "a-fact", "scope": "project", '
                     '"source": "memory a-fact, promoted {today}", '
                     '"trial_until": "{trial}", "status": "trial", "overdue": false, '
                     '"body": "the fact\'s body"',
                     "- [another](another.md)"],
             expect_absent=["- [a fact](a-fact.md)"],
             expect_files=[f"{_OC}/memory/another.md"],
             expect_absent_files=[f"{_OC}/memory/a-fact.md"]),
        cell("promote/without-the-opt-in-the-fact-stays-and-a-bad-name-is-a-404",
             [_req(path="/api/rules"),
              _req("POST", path="/api/rules/promote", token=True, from_body="fingerprint",
                   body=b'{"name": "a-fact", "fingerprint": "{FROM_BODY}", '
                        b'"title": " an  override ", "body": "an override body", '
                        b'"scope": "user"}'),
              _req("POST", path="/api/rules/promote", token=True,
                   body=b'{"name": "nope", "fingerprint": ""}'),
              _req("POST", path="/api/rules/promote", token=True,
                   body=b'{"name": "MEMORY", "fingerprint": ""}'),
              _req("POST", path="/api/rules/promote", token=True, body=b'{}'),
              _req(path="/api/catalog/memory"),
              _req(path="/api/rules")],
             world=_mem_world(**{f"{_OC}/user-rules.md": _RULES_TEXT}),
             # The opt-in's negative half — `delete_memory` absent means the fact SURVIVES,
             # which the catalog request confirms and which no `expect_absent` on the response
             # could. And the three overrides are the other arm of every `or` in the body: a
             # title, a body and a scope supplied by the client win over the frontmatter.
             #
             # `MEMORY` is the reserved name again, checked HERE and not only in
             # `api_memory_delete` — promote resolves the source file itself, so the guard is
             # duplicated in the reference and a port that reached for the delete endpoint's
             # copy would leave this one open.
             expect=['{"ok": true, "op": "add"',
                     '"title": "an override", "scope": "user"',
                     '"body": "an override body"',
                     '{"error": "not found: nope"}', '{"error": "not found: MEMORY"}',
                     '{"error": "not found: "}', "404 Not Found",
                     '"name": "a-fact"'],
             # The full three-name ordering, which the cell above can only show two of.
             # Case-folded on Windows, code-point ordered on POSIX — see `_ORDER_MEM_ANOTHER`.
             expect_re=[_ORDER_MEM_ALL],
             expect_files=[f"{_OC}/memory/a-fact.md", f"{_OC}/memory/MEMORY.md"]),
        cell("promote/with-no-memory-store-at-all-the-endpoint-says-so",
             [_req("POST", path="/api/rules/promote", token=True,
                   body=b'{"name": "a-fact", "fingerprint": ""}'),
              _req("POST", path="/api/memory/delete", token=True,
                   body=b'{"name": "a-fact"}')],
             world=_installed(),
             # `if not d.is_dir(): raise NotFound("memory store")` — the arm before the name
             # is even looked at, and it is worded differently from a missing FACT. Both
             # endpoints carry it, so both are asked.
             expect=['{"error": "not found: memory store"}', "404 Not Found"],
             expect_absent=['{"error": "not found: a-fact"}']),

        # ---- POST /api/profile ----------------------------------------------------------
        cell("profile/a-save-round-trips-and-appends-the-missing-newline",
             [_req(path="/api/profile"),
              _req("POST", path="/api/profile", token=True, from_body="fingerprint",
                   body=b'{"fingerprint": "{FROM_BODY}", '
                        b'"text": "# Me\\n\\nI write Rust and Zig.\\n"}'),
              _req(path="/api/profile"),
              _req("POST", path="/api/profile", token=True, from_body="fingerprint",
                   body=b'{"fingerprint": "{FROM_BODY}", "text": "no trailing newline"}'),
              _req(path="/api/profile")],
             world=_installed(**{f"{_OC}/PROFILE.md": "# Me\n\nI write Rust.\n"}),
             # The whole file is written, not spliced — Profile has no structure. The two
             # saves chain off each other's fingerprints, and the second one is the
             # `if new and not new.endswith("\\n")` arm: the stored text gains a newline the
             # client never sent, so the fingerprint the save RETURNS is the one of the text
             # ON DISK. A port that hashed the request's text instead would answer a
             # fingerprint the next save then 409s on — which is why the chain is the gate and
             # not the response alone.
             expect=['"fingerprint": "3557095f088da537"',
                     '"text": "# Me\\n\\nI write Rust and Zig.\\n"',
                     '"fingerprint": "bd32ddab00fa0410"',
                     '"text": "no trailing newline\\n"',
                     '"fingerprint": "b53299c6afe067dd"', "200 OK"],
             expect_absent=["409 Conflict"],
             expect_files=[f"{_OC}/PROFILE.md"]),
        cell("profile/a-stale-fingerprint-is-409-and-a-malformed-body-is-not-a-500",
             [_req("POST", path="/api/profile", token=True,
                   body=b'{"fingerprint": "0000000000000000", "text": "clobbered"}'),
              _req("POST", path="/api/profile", token=True, body=b"not json at all"),
              _req(path="/api/profile")],
             world=_installed(**{f"{_OC}/PROFILE.md": "# Me\n\nI write Rust.\n"}),
             # Both 409 arms on one path: the wrong fingerprint, and the body that never
             # parsed — which reaches the endpoint as `{}`, whose `fingerprint` is "" and is
             # therefore stale against a file that exists. The GET afterwards is what says the
             # file was never touched.
             expect=["409 Conflict",
                     '{"ok": false, "error": "conflict", "detail": "PROFILE.md changed '
                     'since you loaded it \\u2014 reloading"}',
                     '"text": "# Me\\n\\nI write Rust.\\n"'],
             expect_absent=["clobbered", "500 Internal"]),
        cell("profile/an-absent-file-is-created-by-a-save-with-the-empty-fingerprint",
             [_req("POST", path="/api/profile", token=True,
                   body=b'{"fingerprint": "", "text": "seeded by the editor"}'),
              _req(path="/api/profile")],
             world=_installed(),
             # "" is the CORRECT fingerprint of a file that is not there, so the editor can
             # re-create a PROFILE.md the user deleted. The cell above is what stops that from
             # being read as "the guard does nothing".
             expect=['{"ok": true, "path": "<HOME>', '"exists": true',
                     '"text": "seeded by the editor\\n"'],
             expect_files=[f"{_OC}/PROFILE.md"]),

        # ---- GET/POST /api/mcp ----------------------------------------------------------
        cell("mcp/one-target-per-active-install-lists-the-presets",
             [_req(path="/api/mcp")], world=_installed(),
             # The GET half. Only ACTIVE installs contribute a target — an absent or disabled
             # one has no live config to wire — so the seeded OpenCode global is the one row
             # here and the other three hosts are silent. Each preset carries its metadata and
             # `absent` state, which is what the toggle then changes.
             expect=['"label": "global config", "path": "<HOME>',
                     '"host": "opencode"', '"exists": false, "commented": false',
                     '{"name": "markitdown", "label": "MarkItDown"',
                     '"preset": true, "state": "absent"}',
                     '{"name": "gitlab", "label": "GitLab"',
                     '"name": "gitlab-2"', '"name": "filesystem", "label": "Filesystem"',
                     '"default": 0}'],
             expect_absent=['"host": "claude"', '"host": "bob"', '"host": "copilot"']),
        cell("mcp/a-user-defined-server-joins-the-presets-and-keeps-its-state",
             [_req(path="/api/mcp")],
             world=_installed(**{
                 f"{_OC}/opencode.json": json.dumps({
                     "$schema": "https://opencode.ai/config.json",
                     "mcp": {"markitdown": {"type": "local", "command": ["uvx"],
                                            "enabled": False},
                             "mine-own": {"type": "local", "command": ["x"]}}}) + "\n"}),
             # `_mcp_known_names` appends whatever is already in the config, so a server the
             # user added by hand is visible and manageable rather than invisible — and
             # `_mcp_meta` gives it the generic label. The disabled preset beside it is
             # `_mcp_state`'s third value, which no other cell reaches: absent and enabled are
             # the two a fresh config can produce.
             expect=['"exists": true', '"name": "markitdown"', '"state": "disabled"',
                     '{"name": "mine-own", "label": "mine-own", '
                     '"desc": "User-defined MCP server (not a Harness preset).',
                     '"preset": false, "state": "enabled"}']),
        cell("mcp/toggling-a-preset-writes-it-flips-it-and-reports-each-state",
             [_req("POST", path="/api/mcp", token=True,
                   body=b'{"name": "markitdown", "path": "' + _OC_MCP.encode()
                        + b'", "enabled": true}'),
              _req(path="/api/mcp"),
              _req("POST", path="/api/mcp", token=True,
                   body=b'{"name": "markitdown", "path": "' + _OC_MCP.encode()
                        + b'", "enabled": false}'),
              _req(path="/api/mcp")],
             world=_installed(),
             # THE WRITE, and the file it creates is the point: OpenCode's config gets a
             # `$schema` stamped onto it on first creation, the preset block lands verbatim
             # under `mcp`, and the toggle-off is NON-destructive here (the entry stays with
             # `enabled: false`) — which is the branch that differs from Claude's and the
             # reason `api_mcp_toggle` is host-aware at all.
             expect=['{"ok": true, "name": "markitdown", "state": "enabled"}', "200 OK",
                     '"exists": true', '"name": "markitdown", "label": "MarkItDown"',
                     '{"ok": true, "name": "markitdown", "state": "disabled"}'],
             expect_files=[f"{_OC}/opencode.json"]),
        cell("mcp/every-refusal-is-409-or-404-and-changes-no-file",
             [_req("POST", path="/api/mcp", token=True,
                   body=b'{"name": "nope", "path": "' + _OC_MCP.encode()
                        + b'", "enabled": true}'),
              _req("POST", path="/api/mcp", token=True,
                   body=b'{"name": "gitlab", "path": "' + _OC_MCP.encode()
                        + b'", "enabled": false}'),
              _req("POST", path="/api/mcp", token=True,
                   body=b'{"name": "markitdown", "path": "{repoJ}{sepJ}nowhere.json", '
                        b'"enabled": true}'),
              _req("POST", path="/api/mcp", token=True,
                   body=b'{"path": "' + _OC_MCP.encode() + b'", "enabled": true}'),
              _req("POST", path="/api/mcp", token=True, body=b"not json at all")],
             world=_installed(),
             # FOUR DIFFERENT REFUSALS AND TWO STATUSES. An unknown server name and a disable
             # of something that was never configured are 409s from the endpoint's own
             # `ok: False`; a path outside the detected allowlist and a request with no name
             # at all are 404s from `NotFound` — and the allowlist is what stops this endpoint
             # from writing JSON to an arbitrary file, since it takes a path straight from the
             # body.
             #
             # The unparseable body is `_read_json_body` once more: `{}` has no name, so it
             # takes the same 404 as the missing one, and the message names the path as
             # `(none)` rather than blowing up on it.
             expect=["409 Conflict",
                     '{"ok": false, "error": "unknown server \'nope\'"}',
                     '{"ok": false, "error": "\'gitlab\' is not configured"}',
                     "404 Not Found", '{"error": "not found: mcp target <SB>',
                     '{"error": "not found: mcp target (none)"}'],
             expect_absent=["500 Internal", '"ok": true'],
             expect_absent_files=[f"{_OC}/opencode.json"]),
        cell("mcp/a-commented-jsonc-is-refused-rather-than-rewritten",
             [_req(path="/api/mcp"),
              _req("POST", path="/api/mcp", token=True,
                   body=b'{"name": "markitdown", '
                        b'"path": "{homeJ}{sepJ}.config{sepJ}opencode{sepJ}opencode.jsonc", '
                        b'"enabled": true}')],
             world=_installed(**{
                 f"{_OC}/opencode.jsonc":
                     '// my own comment, which a rewrite would drop\n'
                     '{"$schema": "https://opencode.ai/config.json"}\n'}),
             # `_mcp_commented` is the one guard whose whole purpose is to LOSE a feature
             # rather than lose the user's comments, and a `.jsonc` sibling is also what
             # `_opencode_target` prefers — so seeding it moves the GET's target too, which is
             # why both requests are here. The comment must survive on disk, and the snapshot
             # is what says so.
             expect=['"commented": true',
                     '{"ok": false, "error": "config holds comments \\u2014 edit it by hand '
                     'to keep them"}', "409 Conflict"],
             expect_files=[f"{_OC}/opencode.jsonc"]),
        cell("mcp/a-claude-config-is-strict-json-and-an-unparseable-one-is-not-clobbered",
             [_req(path="/api/mcp"),
              _req("POST", path="/api/mcp", token=True,
                   body=b'{"name": "markitdown", "path": "' + _CLAUDE_MCP.encode()
                        + b'", "enabled": true}'),
              _req(path="/api/mcp")],
             world=_installed(**{
                 "home/.claude/.geneseed-manifest.json": json.dumps({"owned": ["CLAUDE.md"]}),
                 "home/.claude/CLAUDE.md": "# Claude\n",
                 # NOT valid JSON, and deliberately shaped like the file it stands in for:
                 # `~/.claude.json` holds projects and history far beyond MCP wiring, so a
                 # comment-tolerant read followed by a rewrite would be data loss.
                 "home/.claude.json": '{"projects": {"a": 1},}\n',
             }),
             # THE HOST FORK, and the case that made the reference parse strictly. Claude's
             # config has no `enabled` flag, so the shapes differ — but the branch that
             # matters here is the refusal: a file that does not parse is left exactly as it
             # was. `expect_files` cannot see the CONTENT, so the snapshot's byte comparison
             # is the direction that gates it, and the second GET is what says the server
             # still lists the target rather than having crashed on it.
             expect=['"host": "claude"', '"path": "<HOME>',
                     '{"ok": false, "error": "couldn\'t parse this config \\u2014 edit it '
                     'by hand to avoid data loss"}', "409 Conflict"],
             expect_absent=["500 Internal"],
             expect_files=["home/.claude.json"]),
    ]


def _docs_cells(cell) -> list[dict]:
    """P6d — `/api/docs` and `/api/docs/page/<id>`, and the `?harness=` selector.

    THE QUERY PARAM IS THE ONLY INPUT THESE ENDPOINTS HAVE that is not the checkout, so it
    is the only thing a cell can vary — and every filtering rule in `_web_docs.py` is
    downstream of it. P6a skipped the param because nothing called it; this is the phase
    that does, and the cells send it in all four shapes the reference distinguishes
    (a valid value, the other valid value, an unknown one, and blank).

    ONE KIND IS NOT PORTED AND HAS NO CELL, deliberately, for the reason the shell's
    `NOT_PORTED` set has none: a cell holding a 501 against the reference's real body would
    fail, and one holding two 501s would be waiting to go stale.
    `tests/test_web_server.py` cross-checks the kind partition instead. `about` was the other
    one until P8c, and its cell is below.
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
        cell("docs/the-about-page-reads-the-installs-own-git-origin",
             [_req(path="/api/docs/page/about")], world=_full(),
             # P8c'S SECOND PAYMENT, and the cell the deferral owed. `about` is the only docs
             # kind that leaves the checkout's files: `_origin_display()` runs
             # `git remote get-url origin` against ROOT — the DEVELOPER'S repository, which
             # both sides read identically because it is one repository and the call is a
             # read. (No cell here may WRITE to it; `harness_golden`'s `git` fixture exists
             # for the verbs that do.)
             #
             # `repo_is_github` IS THE FIELD THIS CELL IS FOR. It gates every github-shaped
             # deep link in the UI, its value is a `github_slug`/`githubSlug` spelling away
             # from `false` on either side, and `false` is a perfectly plausible answer that
             # nothing else would report — the About page would simply render fewer links.
             # Found exactly that way before the cell existed.
             #
             # `python` is the P6b field with no honest twin (`"3.13.5"` against `null`);
             # `_WEB_STAMPS_WIDTH` tags both spellings and
             # `test_web_server.py::test_the_reference_reports_its_own_interpreter_version`
             # is the absolute half. Naming the tag here is what says the field is PRESENT.
             expect=['"kind": "about"', '"version": {}', '"license": "MIT"',
                     '"repo": "https://github.com/', '"repo_is_github": true',
                     '"python": "<RUNTIME>"', '"deployed": true', '"theme": "imperial"'],
             expect_absent=['not ported yet', '"repo_is_github": false', '"repo": null']),
        cell("docs/the-cli-page-is-the-parser-minus-what-argparse-hides",
             [_req(path="/api/docs/page/cli")], world=_full(),
             # P6d'S DEFERRAL, PAID IN P10c — and the cell has to earn more than "200 now",
             # because both implementations answer this page out of ONE FILE (`cli.json`).
             # The byte comparison is therefore close to vacuous here by construction, which
             # is exactly the case discipline #8 covers: a tolerant comparison owes an
             # absolute assertion, and so does an over-agreeable one.
             #
             # So what this cell states is the FILTER, in both directions. The file carries
             # the FULL parser including `help=argparse.SUPPRESS` arguments — four of them,
             # and `bin/geneseed-cli.mjs` cannot parse `web --daemon-internal` or
             # `bootstrap main imperial` without them — and the PAGE is the file with those
             # removed and the generator's own bookkeeping (`hidden`, `type`, `mutex`) left
             # behind. A reader that forgot to filter shows the user flags argparse hides;
             # one that filtered the FILE instead breaks the CLI and no page would say so.
             expect=['"kind": "cli"', '"prog": "harness"',
                     '"name": "doctor"', '"names": ["--no-bundle"]',
                     '"name": "exclude"', '"choices": ["add", "remove", "list"]',
                     # argparse's alias is a command of its own, with no help of its own:
                     # `_choices_actions` registers the text under the canonical name only.
                     # Both readers inherit that from the file, and the Node entry dispatches
                     # `update` as a row because of it.
                     '{"name": "update", "help": "", "description": ""',
                     '{"name": "upgrade", "help": "self-update: git pull'],
             expect_absent=['not ported yet', '"--daemon-internal"', '"dest": "extra"',
                            '"hidden"', '"type":', '"mutex"']),
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

# ---- P6i — `api_install_toggle` and the tree-move/rollback engine under it ---------------
#
# THE FIRST WEB CELLS THAT MOVE FILES, and they are why the `<dirs>` column exists at all:
# a third of `_install_deactivate` is `_prune_empty_ancestors`, and a FILE snapshot cannot
# see a husk. Every one of these cells therefore names what went, what SURVIVED, and — where
# the engine prunes — the directory that must not still be standing. P5h's three directions,
# arriving in the web harness.
#
# THE ROLLBACK ARM IS DRIVEN, not declared. `_install_deactivate` is ALL-OR-NOTHING: a move
# that fails puts every earlier move back and leaves the install `active` rather than
# half-gutted. Reaching it needs the SECOND move to fail, and the only shape a seeded world
# can produce is a manifest whose `owned` names a file AND its parent directory — the first
# move creates `<stash>/a/`, and the second then finds its destination already there, which
# is exactly what `_move_tree` refuses. Without that shape the rollback loop, the
# `rolled_back` count and the `rmtree(stash)` beside them are twelve lines no cell reaches
# and no mutation can kill.
#
# EVERY REFUSAL CELL SEEDS A REAL INSTALL (the plan's rule 6). A 404 for an unknown
# (host, path) proves nothing against an empty sandbox — the refusal and the miss give the
# same answer — so each refusal runs against a world where a live install is one field away,
# and names in `expect_files` the artifact that must still be there afterwards.
_CL = "home/.claude"
_INSTALL_PATH = "{homeJ}{sepJ}.config{sepJ}opencode"
_CLAUDE_PATH = "{homeJ}{sepJ}.claude"
# `_install_agent_entry(root, "global")` is `(root / "AGENT.md").as_posix()` — an ABSOLUTE
# posix path carrying the sandbox. Seeded in the spelling the emit would have written, so
# `_unmerge_opencode_json` really finds an entry to drop rather than no-oping.
_OC_ENTRY = "{home/}/.config/opencode/AGENT.md"
_STALE = "# STALE — the snapshot taken when the install was disabled\n"
_FRESH = "# FRESH — re-emitted live while the install was disabled\n"
_CLAUDE_MD = ("# my own notes\n\nprose the user added, which a disable must not eat.\n\n"
              "<!-- BEGIN GENESEED -->\nthe managed preamble\n<!-- END GENESEED -->\n")


def _oc_json(*entries) -> str:
    return json.dumps({"$schema": "https://opencode.ai/config.json",
                       "instructions": list(entries)}, indent=2) + "\n"


def _oc_install(owned: list, **extra) -> dict:
    """An opencode-GLOBAL install at `home/.config/opencode`, with `owned` as its manifest
    says. The markers are seeded because they are the half that must NOT move: a global
    deactivate leaves every marker in place (theme/emit/version detection keeps working
    while disabled), which is what `expect_files` names beside each stashed path."""
    return dict({
        "repo/.keep": "",
        f"{_OC}/.geneseed-manifest.json": json.dumps({"owned": owned}),
        f"{_OC}/.geneseed-emit": "opencode-global\n",
        f"{_OC}/.geneseed-theme": "imperial\n",
        f"{_OC}/.geneseed-version": _VERSION,
        f"{_OC}/opencode.json": _oc_json(_OC_ENTRY),
    }, **extra)


def _claude_install(owned=("agents/scribe.md",), **extra) -> dict:
    """A claude-GLOBAL install at `home/.claude` — the other half of the host fork.

    `managed` is what makes it Claude-shaped: there is no `instructions` array to unmerge,
    so the reversal is the manifest's owned list plus the CLAUDE.md managed block plus the
    settings.json hooks, and the stash is tagged by HOST so a root carrying two installs can
    disable each independently.

    `owned` is a PARAMETER because a mutation asked for it. Emptying it (with no CLAUDE.md
    beside it) is the only world in which `stash.mkdir` is load-bearing — see the cell that
    uses it."""
    return dict({
        "repo/.keep": "",
        f"{_CL}/.geneseed-manifest.json": json.dumps({
            "owned": list(owned),
            "managed": {"claude_md": {"rel": "CLAUDE.md"}, "settings_file": "settings.json",
                        "settings_hooks": [], "settings_excludes": []}}),
        f"{_CL}/.geneseed-emit": "claude-global\n",
        f"{_CL}/.geneseed-theme": "imperial\n",
        f"{_CL}/.geneseed-version": _VERSION,
        f"{_CL}/settings.json": '{\n  "hooks": {}\n}\n',
    }, **extra)


def _toggle(action, host="opencode", path=_INSTALL_PATH, **extra) -> bytes:
    return json.dumps({"host": host, "path": path, "action": action, **extra}).encode()


def _install_cells(cell) -> list[dict]:
    installs = _req(path="/api/installs")
    return [
        cell("install/deactivating-a-global-install-stashes-its-tree-and-prunes-the-husk",
             [_req("POST", path="/api/install", body=_toggle("deactivate"), token=True),
              installs],
             world=_oc_install(
                 ["AGENT.md", "skills/deep/nested/SKILL.md"],
                 **{f"{_OC}/AGENT.md": _DEPLOYED_AGENT,
                    f"{_OC}/skills/deep/nested/SKILL.md": "# a vendored skill\n"}),
             # The nested owned file is the whole reason this cell is not just `AGENT.md`:
             # `_prune_empty_ancestors` climbs from the moved file's PARENT, so a flat
             # move-list exercises none of it (`AGENT.md`'s parent IS the root, and the loop
             # stops immediately). Three husk levels, and all three are directories no file
             # snapshot could ever have reported.
             expect=['{"ok": true, "kind": "global", "moved": 2}', "200 OK",
                     '"state": "disabled"'],
             expect_files=[f"{_OC}/.geneseed-disabled/AGENT.md",
                           f"{_OC}/.geneseed-disabled/skills/deep/nested/SKILL.md",
                           # The markers STAY. They are the positive control beside the
                           # deletions (P5c's rule): without them a port that moved the whole
                           # directory would satisfy every `expect_absent_files` below.
                           f"{_OC}/.geneseed-emit", f"{_OC}/.geneseed-theme",
                           f"{_OC}/.geneseed-manifest.json"],
             expect_absent_files=[f"{_OC}/AGENT.md", f"{_OC}/skills",
                                  f"{_OC}/skills/deep", f"{_OC}/skills/deep/nested"]),

        cell("install/a-deactivate-whose-second-move-collides-rolls-the-first-one-back",
             [_req("POST", path="/api/install", body=_toggle("deactivate"), token=True),
              _req("POST", path="/api/install", body=_toggle("activate"), token=True),
              installs],
             # `owned` names `a/one.md` AND `a`. The first move creates `<stash>/a/`; the
             # second finds `<stash>/a` already there and `_move_tree` refuses rather than
             # overwrite a destination it is responsible for restoring. That is the ONLY
             # rollback trigger a seeded world can produce — see this section's header.
             world=_oc_install(
                 ["a/one.md", "a"],
                 **{f"{_OC}/AGENT.md": _DEPLOYED_AGENT,
                    f"{_OC}/a/one.md": "# the file the rollback must put back\n"}),
             # Request 2 is not decoration: `install is not disabled (active)` is the
             # assertion that the rollback left the install genuinely active rather than
             # cosmetically so — and it is the second refusal string of the pair, which no
             # other cell reaches.
             expect=['"ok": false', '"failed": ["a (', '"rolled_back": 1', "409 Conflict",
                     '{"ok": false, "error": "install is not disabled (active)"}',
                     '"state": "active"'],
             expect_files=[f"{_OC}/a/one.md", f"{_OC}/AGENT.md", f"{_OC}/opencode.json"],
             # The stash goes with the rollback — a failed deactivate leaves no trace at all.
             expect_absent_files=[f"{_OC}/.geneseed-disabled"]),

        cell("install/reactivating-restores-every-stashed-file-and-removes-the-stash",
             [_req("POST", path="/api/install", body=_toggle("activate"), token=True),
              installs],
             world=_oc_install(
                 ["AGENT.md", "skills/deep/nested/SKILL.md"],
                 **{f"{_OC}/.geneseed-disabled/AGENT.md": _DEPLOYED_AGENT,
                    f"{_OC}/.geneseed-disabled/skills/deep/nested/SKILL.md": "# a skill\n",
                    # No live AGENT.md and no instructions entry: the disabled shape.
                    f"{_OC}/opencode.json": _oc_json()}),
             expect=['{"ok": true, "kind": "global", "moved": 2}', "200 OK",
                     '"state": "active"'],
             expect_files=[f"{_OC}/AGENT.md", f"{_OC}/skills/deep/nested/SKILL.md"],
             # `rmtree(stash)` runs LAST and the tree it removes is directories only by
             # then — invisible to a file snapshot, which is the column's second customer.
             expect_absent_files=[f"{_OC}/.geneseed-disabled",
                                  f"{_OC}/.geneseed-disabled/skills"]),

        cell("install/a-reactivate-collision-keeps-the-stash-and-reports-the-leftover",
             [_req("POST", path="/api/install", body=_toggle("activate"), token=True),
              installs],
             world=_oc_install(
                 ["skills/x.md"],
                 **{f"{_OC}/.geneseed-disabled/skills/x.md": _STALE,
                    f"{_OC}/skills/x.md": _FRESH,
                    f"{_OC}/opencode.json": _oc_json()}),
             # "Never delete the stash while anything is unrestored." The install stays
             # DISABLED and the stashed bytes stay put, so the operator can retry by hand —
             # a port that removed the stash on the failure path would strand them forever
             # and every response byte would still match.
             expect=['{"ok": false, "failed": ["skills/x.md"], "moved": 0}', "409 Conflict",
                     '"state": "disabled"'],
             expect_files=[f"{_OC}/.geneseed-disabled/skills/x.md", f"{_OC}/skills/x.md"]),

        cell("install/a-rebuild-while-disabled-discards-the-stale-stash",
             [_req("POST", path="/api/install", body=_toggle("activate"), token=True),
              installs],
             world=_oc_install(
                 ["AGENT.md"],
                 **{f"{_OC}/.geneseed-disabled/AGENT.md": _STALE,
                    f"{_OC}/AGENT.md": _FRESH,
                    f"{_OC}/opencode.json": _oc_json()}),
             # `_install_relive` — the user ran `build` while disabled, so the live files are
             # newer than the snapshot. The stash is DISCARDED rather than moved back over
             # them, and the instructions entry is re-added so the install is whole.
             #
             # WHAT THIS CELL CANNOT SEE ABSOLUTELY: that `AGENT.md` still holds the FRESH
             # bytes rather than the stale ones. `expect`/`expect_absent` read responses, and
             # no ported endpoint serves an install's file content. The cross-implementation
             # comparison covers a clobber (the two seeds differ by their first word); a port
             # that clobbered on BOTH sides would not be caught here, which is what the
             # `_STALE`/`_FRESH` naming is for when someone reads the snapshot.
             expect=['{"ok": true, "note": "install was re-created while disabled; '
                     'discarded the stashed snapshot"}', "200 OK", '"state": "active"'],
             expect_files=[f"{_OC}/AGENT.md", f"{_OC}/opencode.json"],
             expect_absent_files=[f"{_OC}/.geneseed-disabled",
                                  f"{_OC}/.geneseed-disabled/AGENT.md"]),

        cell("install/a-commented-opencode-jsonc-refuses-before-anything-moves",
             [_req("POST", path="/api/install", body=_toggle("deactivate"), token=True),
              installs],
             world=_oc_install(
                 ["AGENT.md"],
                 **{f"{_OC}/AGENT.md": _DEPLOYED_AGENT,
                    # `_opencode_target` prefers a `.jsonc` sibling when one exists.
                    f"{_OC}/opencode.jsonc": "{\n  // the user's own note\n  "
                                             '"instructions": ["' + _OC_ENTRY + '"]\n}\n'}),
             # The refusal is CHECKED UP FRONT, before the loop — rewriting a commented
             # config would drop the user's comments, and a deactivate that moved the tree
             # and then refused to unwire would leave an install that is neither on nor off.
             # `\\u2014`, not the character. `_send_json` is `json.dumps` with
             # `ensure_ascii=True`, so the em dash reaches the wire escaped — P6g's third
             # gate defect, and the self-check caught this one the same way. The sibling
             # cell below keeps the raw character because its message is a `print`, on the
             # daemon's stdout, where nothing encodes it.
             expect=['"ok": false',
                     'opencode.jsonc has comments \\u2014 refusing to rewrite it.',
                     "409 Conflict", '"state": "active"'],
             expect_files=[f"{_OC}/AGENT.md", f"{_OC}/opencode.jsonc"],
             expect_absent_files=[f"{_OC}/.geneseed-disabled"]),

        cell("install/a-reactivate-into-a-commented-jsonc-restores-the-files-and-says-so",
             [_req("POST", path="/api/install", body=_toggle("activate"), token=True)],
             world=_oc_install(
                 ["AGENT.md"],
                 **{f"{_OC}/.geneseed-disabled/AGENT.md": _DEPLOYED_AGENT,
                    f"{_OC}/opencode.jsonc": "{\n  // the user's own note\n}\n"}),
             # The asymmetry is deliberate in the reference and must survive the port: a
             # DEACTIVATE refuses outright, a REACTIVATE restores every byte and only then
             # tells the operator to add the entry by hand. `_install_readd_entry`'s print is
             # the engine's ONE line of stdout, and it lands on the daemon's stream.
             expect=['{"ok": true, "kind": "global", "moved": 1}',
                     "[activate] opencode.jsonc has comments — not rewriting it. Add this "
                     'to its "instructions" by hand: "<HOME>'],
             expect_files=[f"{_OC}/AGENT.md"],
             expect_absent_files=[f"{_OC}/.geneseed-disabled"]),

        cell("install/an-unknown-host-over-a-live-install-is-a-404",
             [_req("POST", path="/api/install",
                   body=_toggle("deactivate", host="bogus"), token=True), installs],
             world=_oc_install(["AGENT.md"], **{f"{_OC}/AGENT.md": _DEPLOYED_AGENT}),
             # The PAIR is the key, and the path here is a real detected install's — so this
             # is a refusal over a target that exists, not a miss dressed as one. `known` is
             # built from `_install_targets()` precisely so a body can never name a root the
             # engine will then move.
             expect=['{"error": "not found: unknown install (host, path)"}', "404 Not Found",
                     '"state": "active"'],
             expect_files=[f"{_OC}/AGENT.md"],
             expect_absent_files=[f"{_OC}/.geneseed-disabled"]),

        cell("install/deactivating-an-already-disabled-install-is-refused",
             [_req("POST", path="/api/install", body=_toggle("deactivate"), token=True),
              installs],
             world=_oc_install(["AGENT.md"],
                               **{f"{_OC}/.geneseed-disabled/AGENT.md": _DEPLOYED_AGENT,
                                  f"{_OC}/opencode.json": _oc_json()}),
             expect=['{"ok": false, "error": "install is not active (disabled)"}',
                     "409 Conflict", '"state": "disabled"'],
             expect_files=[f"{_OC}/.geneseed-disabled/AGENT.md"]),

        cell("install/an-unknown-action-is-refused-and-moves-nothing",
             [_req("POST", path="/api/install", body=_toggle("nope"), token=True), installs],
             world=_oc_install(["AGENT.md"], **{f"{_OC}/AGENT.md": _DEPLOYED_AGENT}),
             # `{action!r}` — Python's repr, single-quoted. The twin needs `pyRepr`, and a
             # naive `JSON.stringify` would double-quote it inside a JSON string.
             expect=['{"ok": false, "error": "unknown action \'nope\'"}', "409 Conflict",
                     '"state": "active"'],
             expect_files=[f"{_OC}/AGENT.md"],
             expect_absent_files=[f"{_OC}/.geneseed-disabled"]),

        cell("install/an-absolute-manifest-entry-escapes-the-root-and-is-never-moved",
             [_req("POST", path="/api/install", body=_toggle("deactivate"), token=True)],
             world=_oc_install(
                 ["/evil.md", "AGENT.md"],
                 **{f"{_OC}/AGENT.md": _DEPLOYED_AGENT,
                    f"{_OC}/evil.md": "# NOT owned — a manifest entry that escapes\n"}),
             # THE CONTAINMENT GUARD, and the cell exists because the guard is one character
             # wide. `(rroot / r)` is pathlib's `/`, which REPLACES the base when `r` is
             # absolute: `/evil.md` resolves to `C:\evil.md`, lands outside the root, and is
             # dropped. `path.join` would have concatenated it back INSIDE the root
             # (`<root>\evil.md`) — a path that exists here on purpose — and the endpoint
             # would then move a file the manifest never legitimately owned.
             #
             # `/evil.md` rather than `C:/evil.md` deliberately: the rooted-but-driveless
             # spelling is the one that behaves identically on both platforms (POSIX
             # `Path('/home/x') / '/evil.md'` is `/evil.md` too), so this cell discriminates
             # everywhere rather than on Windows alone.
             expect=['{"ok": true, "kind": "global", "moved": 1}', "200 OK"],
             expect_files=[f"{_OC}/evil.md", f"{_OC}/.geneseed-disabled/AGENT.md"],
             expect_absent_files=[f"{_OC}/.geneseed-disabled/evil.md"]),

        cell("install/removing-an-install-deletes-the-tree-and-de-lists-it",
             [_req("POST", path="/api/install", body=_toggle("remove"), token=True),
              installs],
             world=_oc_install(
                 ["AGENT.md", "skills/deep/nested/SKILL.md"],
                 **{f"{_OC}/AGENT.md": _DEPLOYED_AGENT,
                    f"{_OC}/skills/deep/nested/SKILL.md": "# a vendored skill\n",
                    # The POSITIVE CONTROL (P5c): a file the manifest does NOT own, in a
                    # directory the reversal sweeps. A port that deleted by glob rather than
                    # by manifest takes this with it, and every deletion below still passes.
                    f"{_OC}/skills/mine.md": "# the user's own skill\n"}),
             # The DESTRUCTIVE third action. `installUninstall` crossed in P5h with
             # `harness uninstall` as its only caller; this is the first cell that reaches it
             # through the web layer, which is the partition `api_install_toggle`'s three-arm
             # dispatch is — without it, `remove` is a branch the endpoint's two other cells
             # cannot distinguish from a typo.
             expect=['"ok": true', '"removed": 2', '"memory": "keep"', "200 OK",
                     '"state": "absent"'],
             expect_files=[f"{_OC}/skills/mine.md"],
             expect_absent_files=[f"{_OC}/AGENT.md", f"{_OC}/.geneseed-manifest.json",
                                  f"{_OC}/.geneseed-emit", f"{_OC}/skills/deep",
                                  f"{_OC}/skills/deep/nested"]),

        cell("install/deactivating-a-claude-global-install-stashes-under-its-host",
             [_req("POST", path="/api/install",
                   body=_toggle("deactivate", host="claude", path=_CLAUDE_PATH), token=True),
              installs],
             world=_claude_install(**{f"{_CL}/agents/scribe.md": "# an owned agent\n",
                                      f"{_CL}/CLAUDE.md": _CLAUDE_MD}),
             # The host fork, and it is a different engine rather than a flag: no
             # `instructions` array, a host-TAGGED stash, the settings hooks unwired and
             # verified, and the CLAUDE.md block excised into the stash for an exact restore.
             expect=['{"ok": true, "kind": "claude", "moved": 1}', "200 OK",
                     '"id": "claude:global"', '"state": "disabled"'],
             expect_files=[f"{_CL}/.geneseed-disabled/claude/agents/scribe.md",
                           f"{_CL}/.geneseed-disabled/claude/_claude_md_block.txt",
                           # ALWAYS EXCISED, NEVER DELETED. The user's prose around the block
                           # survives a disable, and this is the file that proves it.
                           f"{_CL}/CLAUDE.md", f"{_CL}/.geneseed-manifest.json"],
             expect_absent_files=[f"{_CL}/agents"]),

        cell("install/a-claude-deactivate-with-nothing-to-move-still-marks-it-disabled",
             [_req("POST", path="/api/install",
                   body=_toggle("deactivate", host="claude", path=_CLAUDE_PATH), token=True),
              installs],
             # NO owned files and NO CLAUDE.md, so nothing moves and no block is stashed —
             # and `stash.mkdir` is then the ONLY thing that makes the install disabled,
             # because presence of the dir IS the flag. THE CELL EXISTS BECAUSE A MUTATION
             # SURVIVED: deleting that mkdir was invisible in the two Claude cells above,
             # where the owned move and the block write both create the stash on the way
             # past. Without it the endpoint answers `ok: true` while the install stays on.
             world=_claude_install(owned=()),
             expect=['{"ok": true, "kind": "claude", "moved": 0}', "200 OK",
                     '"id": "claude:global"', '"state": "disabled"'],
             expect_files=[f"{_CL}/.geneseed-manifest.json"]),

        cell("install/reactivating-a-claude-global-install-restores-the-block-and-rewires",
             [_req("POST", path="/api/install",
                   body=_toggle("activate", host="claude", path=_CLAUDE_PATH), token=True),
              installs],
             world=_claude_install(**{
                 f"{_CL}/.geneseed-disabled/claude/agents/scribe.md": "# an owned agent\n",
                 f"{_CL}/.geneseed-disabled/claude/_claude_md_block.txt":
                     "the managed preamble",
                 f"{_CL}/CLAUDE.md": "# my own notes\n\nprose the user added.\n"}),
             # `_claude_md_block.txt` is SKIPPED by the restore walk and written back through
             # `_managed_block_write` instead — a port that let it through would leave a
             # stray `.txt` in the config dir and no block in CLAUDE.md. `moved` counts 1,
             # not 2, and that number is the assertion.
             expect=['{"ok": true, "kind": "claude", "moved": 1}', "200 OK",
                     '"state": "active"'],
             expect_files=[f"{_CL}/agents/scribe.md", f"{_CL}/CLAUDE.md"],
             expect_absent_files=[f"{_CL}/.geneseed-disabled",
                                  f"{_CL}/.geneseed-disabled/claude",
                                  f"{_CL}/_claude_md_block.txt"]),
    ]


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
    # THE RECORD'S `started` IS NOT HERE, and P6g is why. It used to be, as a literal
    # `"started": <the integer second>` — and a JOB's `started` is a float whose integer part
    # is that same second whenever the two were sampled inside one tick, so the literal bit a
    # prefix out of it and left a per-run tail behind. `_WEB_STAMPS_WIDTH`'s
    # `"started": \d+(?:\.\d+)?` covers the record too (its value is a bare integer, which
    # that pattern accepts on purpose), so the field is still normalised — by the rule that
    # can see BOTH spellings rather than by a literal that could only see one.
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
    # The last response parsed as a JSON object, for `from_body`. `{}` whenever the body was
    # not a JSON object, so a missing field substitutes empty rather than raising — and the
    # MISSING observation below is what makes that loud instead of silently green.
    last: dict = {}
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
            path = r["path"]
            if r.get("from_body") is not None and "{FROM_BODY}" in path:
                val = last.get(r["from_body"])
                if val is None or val == "":
                    obs[f"<r{i} from_body {r['from_body']} MISSING>"] = (
                        b"the previous response carried no such field")
                # NOT recorded as an observation. The id is destamped everywhere else it
                # appears, so recording the path would only re-introduce the per-run value
                # this harness normalises — and the linkage the substitution makes is gated
                # by the STATUS instead: a request that carried the wrong id answers 404.
                path = path.replace("{FROM_BODY}", str("" if val is None else val))
            if r.get("from_body") is not None and body is not None:
                val = last.get(r["from_body"])
                if val is None or val == "":
                    # FAIL LOUD, and this is the whole failure mode `from_body` has. An
                    # empty substitution sends a stale fingerprint, the endpoint takes its
                    # 409 arm, and a cell written to gate the FRESH arm compares two 409s
                    # and looks green. `check_expectations` refuses this key by name.
                    obs[f"<r{i} from_body {r['from_body']} MISSING>"] = (
                        b"the previous response carried no such field")
                body = body.replace(b"{FROM_BODY}",
                                    str("" if val is None else val).encode("utf-8"))
                obs[f"<r{i} sent>"] = body
            if body is not None:
                headers.setdefault("Content-Type", "application/json")
                headers.setdefault("Content-Length", str(len(body)))
            for attempt in range(_POLL_MAX if r.get("poll") else 1):
                if attempt:
                    time.sleep(_POLL_EVERY)
                # `skip_accept_encoding`: http.client adds `Accept-Encoding: identity` on its
                # own, and a cell that says nothing about the header must send nothing — the
                # gzip branch is chosen by its presence.
                conn.putrequest(r["method"], path, skip_accept_encoding=True,
                                skip_host=("Host" in headers))
                for k, v in headers.items():
                    conn.putheader(k, v)
                conn.endheaders(body if body is not None else None)
                resp = conn.getresponse()
                data = resp.read()
                if not r.get("poll"):
                    break
                try:
                    if json.loads(data.decode("utf-8")).get("status") != "running":
                        break
                except (UnicodeDecodeError, json.JSONDecodeError, AttributeError):
                    break
            enc = resp.getheader("Content-Encoding") or ""
            body_out = _decode_body(data, enc)
            # Content-Length is tagged in exactly two situations, and both are the same
            # rule: the length is a CONSEQUENCE of a value this harness has already
            # decided it cannot compare, so comparing the length would re-introduce the
            # comparison through the back door. `gzip` is the compressed stream (see
            # `_decode_body`); the other is any body carrying a WIDTH-VARIABLE normalised
            # value (see `_WEB_STAMPS_WIDTH`). Its PRESENCE stays gated, which is what the
            # tag is for, and the body itself is still compared byte for byte with the
            # value normalised.
            #
            # P6g GENERALISED THE SECOND ARM, and it was a defect until it did: the test was
            # `b'"python": ' not in body_out`, one field named by hand, and a job body's
            # `started` (seven decimals against three) and `duration` moved Content-Length by
            # one byte in the ref-vs-ref self-check before a line of the port existed.
            untagged = ('gzip' not in enc) and not _width_varies(body_out)
            obs[f"<r{i} status>"] = f"{resp.status} {resp.reason}".encode()
            obs[f"<r{i} headers>"] = "\n".join(
                f"{k}: {v if (untagged or k.title() != 'Content-Length') else '<CLEN>'}"
                for k, v in resp.getheaders() if k.title() in _HEADERS
            ).encode()
            obs[f"<r{i} body>"] = body_out
            try:
                parsed = json.loads(body_out.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                parsed = None
            last = parsed if isinstance(parsed, dict) else {}
    except (http.client.HTTPException, OSError) as e:
        obs["<transport>"] = f"{type(e).__name__}: {e}".encode()
    finally:
        conn.close()
    return obs


def _subst_requests(requests: list[dict], repl: dict) -> list[dict]:
    """`harness_golden._subst` over a request script, including its BYTES body.

    P6f is the first phase whose requests carry sandbox paths — `api_select_view` and
    `api_mcp_toggle` are keyed on the (host, path) pair of a DETECTED install, which is
    what stops a body from steering a write to an arbitrary file, and a detected path is
    `<sandbox>/home/.config/opencode`, which no cell can spell. `_subst` is str/list/dict
    only, so the body is decoded, substituted and re-encoded here; a body that is not UTF-8
    is left alone rather than being made into one that is.
    """
    out = []
    for r in requests:
        r = {**r, "path": harness_golden._subst(r["path"], repl),
             "headers": harness_golden._subst(r["headers"], repl)}
        if isinstance(r.get("body"), bytes):
            try:
                r["body"] = harness_golden._subst(
                    r["body"].decode("utf-8"), repl).encode("utf-8")
            except UnicodeDecodeError:
                pass
        out.append(r)
    return out


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
        # JSON-ESCAPED variants, and P6f is the first phase that needs them. Three of its
        # endpoints match the body's `path` against `str(Path)` EXACTLY — `api_select_view`,
        # `api_mcp_toggle` and `api_install_toggle` all key on a (host, path) pair taken from
        # a DETECTED install, which is the whole reason a bogus body can never reach a build
        # argv or a tree move. So the forward-slash spelling cannot be used here, and a raw
        # Windows path inside a JSON string is not valid JSON (`\U` is not an escape). These
        # are the same values with their backslashes doubled, which is what `json.dumps`
        # would write, plus the platform separator in the same spelling.
        repl.update({k[:-1] + "J}": v.replace("\\", "\\\\")
                     for k, v in list(repl.items()) if not k.endswith("/}")})
        repl["{sepJ}"] = os.sep.replace("\\", "\\\\")
        repl.update(_clock_repl(now))
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
                obs = _drive(record["port"], record.get("token", ""),
                             _subst_requests(cell["requests"], repl))
        finally:
            _stop(record, proc)
        if record is None:
            out, err = proc.communicate(timeout=10)
            return f"server did not start (rc={proc.returncode}): {out[-400:]}{err[-400:]}"
        out, err = proc.communicate(timeout=10)

        stamps = _dyn_stamps(record, record["port"], record["pid"])
        roots = [("<HOME>", home), ("<REPO>", checkout), ("<REPO>", ROOT), ("<SB>", sb)]

        def clean(b: bytes) -> bytes:
            # `_web_destamp` FIRST, which P6g moved and which is not a tidy-up. `_dyn_stamps`
            # carries a literal `"started": <the record's integer second>`, and a JOB's
            # `started` is a FLOAT whose integer part is that same second whenever the two
            # were sampled inside one tick. The literal replacement therefore ate the integer
            # part and left `"started": <STARTED>.090433` behind — a per-run tail no later
            # pattern could match, and one that only appeared when the clocks happened to
            # agree. Running the field-and-value patterns first makes the whole number a tag
            # before any literal can bite a prefix out of it.
            return harness_golden._destamp(
                _apply(golden._normalise(_apply(_web_destamp(b), stamps), roots), stamps))

        snap = {k: clean(v) for k, v in golden._snapshot(sb, roots).items()}
        snap.update({k: clean(v) for k, v in obs.items()})
        # THE DIRECTORY COLUMN, and P6i is the first web phase that MOVES files.
        #
        # `harness_golden` grew one in P5h for the first verb that DELETES; `web_golden` never
        # did, and P6h's handoff flagged the gap rather than paying it. It is the same hole in
        # the same shape: `golden._snapshot` walks FILES, so an empty directory is invisible,
        # and `_install_deactivate`'s ancestor prune leaves NOTHING in a file snapshot to look
        # at — a port that moved every owned file and left `skills/<name>/` standing was
        # byte-identical in all 95 cells. Half of the engine this phase ports is the prune.
        #
        # One pseudo-file rather than a sixth expectation kind, for the same reason as there:
        # it closes the hole for every cell in the matrix at once, including the 95 written
        # before it existed, where a per-cell declaration would only cover the cells that
        # remembered to make one.
        snap["<dirs>"] = clean("\n".join(sorted(
            p.relative_to(sb).as_posix() for p in sb.rglob("*") if p.is_dir())
        ).encode("utf-8"))
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


def check_expectations(cell: dict, snap: "dict[str, bytes]",
                       now: "int | None" = None) -> list[str]:
    """The absolute assertions, run against the REFERENCE side.

    Same discipline as `harness_golden.check_expectations`, and needed for the same reason:
    a cross-implementation comparison is blind to a defect both sides share. It is sharper
    here — two servers that both stopped enforcing the CSRF token would agree in every
    guard cell, forever. So each cell states what the reference actually answers.

    And, as there, it describes the reference; it never adjudicates it.
    """
    problems = []
    # The same clock the world was seeded from — see `_clock_repl`. `{today}` and `{trial}`
    # are the only placeholders an EXPECTATION carries, and they are substituted here rather
    # than in `run_cell` because an expectation is never seeded into the sandbox.
    clock = _clock_repl(int(time.time()) if now is None else now)
    cell = {**cell, **{k: harness_golden._subst(cell.get(k) or [], clock)
                       for k in ("expect", "expect_absent", "expect_re")}}
    # RESPONSES ONLY. `<rN sent>` is a REQUEST, and folding it in here would let a cell's own
    # request body satisfy its `expect` and trip its `expect_absent` — measured, not feared:
    # the rules add cell sends `"scope": "nope"` precisely to prove the endpoint DROPS it,
    # and reading the request back made the cell report the reference as answering it. The
    # sent bytes stay in the snapshot, where they gate the two sides against each other,
    # which is the question they exist to answer.
    text = b"\n".join(
        v for k, v in sorted(snap.items())
        if (k.startswith("<r") and not k.endswith(" sent>"))
        or k in ("<server stdout>", "<server stderr>")
    ).decode("utf-8", "replace")
    for k in sorted(snap):
        if k.endswith("MISSING>"):
            problems.append(f"{k[1:-1]} — a `from_body` request substituted an EMPTY value, "
                            f"so it sent a stale fingerprint and this cell is gating the 409 "
                            f"arm it was not written for")
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
    # DIRECTORIES COUNT, since P6i. `expect_absent_files` used to read the file keys only,
    # which made every DIRECTORY named in it pass trivially — and the husk an
    # `_prune_empty_ancestors` failure leaves behind is exactly a directory. Same rule as
    # `harness_golden`'s: the column is REQUIRED and NON-EMPTY when a cell names anything
    # absent, because an empty column compares equal on both sides and makes every husk
    # assertion pass against an empty set. `run_cell` creates `home`, `repo` and `cfg` before
    # the server starts, so there is no cell an empty column could honestly describe.
    want_absent = cell.get("expect_absent_files", ())
    if want_absent and not snap.get("<dirs>", b"").strip():
        problems.append("the snapshot's <dirs> column is missing or empty, so every "
                        "directory named in expect_absent_files would pass without being "
                        "looked at — and the sandbox always holds home/repo/cfg")
        return problems
    kept = set(snap["<dirs>"].decode("utf-8").split("\n")) if want_absent else set()
    for rel in want_absent:
        if rel in snap or rel in kept:
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


def compare(ref: list[str], new: list[str], matrix: list[dict], limit: int,
            jobs: int = 1) -> int:
    print(f"[web-golden] {len(matrix)} cells · ref={' '.join(ref)} · new={' '.join(new)}"
          f" · jobs={jobs}")
    failures: list[str] = []

    def _pair(cell: dict) -> tuple:
        """Both sides of ONE cell, and the CLOCK stays inside it.

        `now` is sampled here rather than in `run_cell` precisely so the two sides of a cell
        seed the same seconds — that is unchanged by the pool, and it is why the sample must
        be per-cell-per-worker rather than one value hoisted out of the loop: under
        concurrency a hoisted clock would drift arbitrarily far from the cell that used it,
        and `_clock_repl`'s `{stale}`/`{older}` offsets are relative to it.

        Every cell binds `--port 0`, so the OS hands each server its own free port and two
        cells running at once can no more collide than a cell and the developer's own
        daemon could."""
        now = int(time.time())
        return run_cell(ref, cell, now), run_cell(new, cell, now), now

    pool = concurrent.futures.ThreadPoolExecutor(max_workers=jobs)
    with pool:
        for i, (cell, (a, b, now)) in enumerate(zip(matrix, pool.map(_pair, matrix)), 1):
            cid = cell["id"]
            if isinstance(a, str) or isinstance(b, str):
                failures.append(f"  {cid}: server failed\n    ref: {a if isinstance(a, str) else 'ok'}"
                                f"\n    new: {b if isinstance(b, str) else 'ok'}")
            elif (vacuous := check_expectations(cell, a, now)):
                failures.append(f"  {cid}: VACUOUS\n" + "\n".join(f"    {p}" for p in vacuous))
            else:
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
    ap.add_argument("--jobs", type=int, default=golden.DEFAULT_JOBS, metavar="N",
                    help="cells to run CONCURRENTLY (default: %(default)s on this "
                         "machine). Each cell starts its own server on its own OS-chosen "
                         "port inside its own sandbox, so this changes only how long the "
                         "gate takes, never what it compares.")
    args = ap.parse_args(argv)
    if args.jobs < 1:
        print(f"[web-golden] --jobs must be at least 1, got {args.jobs}")
        return 2

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
    return compare(ref, new, matrix, args.limit, jobs=args.jobs)


if __name__ == "__main__":
    raise SystemExit(main())
