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
    return out


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


def run_cell(cli: list[str], cell: dict) -> "dict[str, bytes] | str":
    """Start one server in a fresh sandbox, drive it, stop it, and snapshot everything."""
    faults = cell.get("checkout")
    with tempfile.TemporaryDirectory() as td, tempfile.TemporaryDirectory() as ctd:
        sb = Path(td)
        home, repo, cfg = sb / "home", sb / "repo", sb / "cfg"
        for d in (home, repo, cfg):
            d.mkdir(parents=True, exist_ok=True)
        checkout = Path(ctd) / "checkout" if faults is not None else ROOT
        repl = {"{sb}": str(sb), "{home}": str(home), "{repo}": str(repo),
                "{cfg}": str(cfg), "{py}": sys.executable, "{ck}": str(checkout)}
        repl = {**{k[:-1] + "/}": v.replace("\\", "/") for k, v in repl.items()}, **repl}
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
        a, b = run_cell(ref, cell), run_cell(new, cell)
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
