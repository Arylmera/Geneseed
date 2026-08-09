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
pair therefore runs over a payload carrying no per-run value.

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
        cell("guard/a-forged-host-is-refused-on-post-before-the-token-is-looked-at",
             [_req("POST", headers={"Host": "evil.example.com"}, body=b"{}", token=True)],
             # Order matters and is observable: the host check runs FIRST, so a request
             # carrying a VALID token still gets the host refusal. A port that checked the
             # token first would answer `forbidden` here instead of `forbidden host`.
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
    return out


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
            obs[f"<r{i} status>"] = f"{resp.status} {resp.reason}".encode()
            obs[f"<r{i} headers>"] = "\n".join(
                f"{k}: {'<GZLEN>' if (k.title() == 'Content-Length' and 'gzip' in enc) else v}"
                for k, v in resp.getheaders() if k.title() in _HEADERS
            ).encode()
            obs[f"<r{i} body>"] = _decode_body(data, enc)
    except (http.client.HTTPException, OSError) as e:
        obs["<transport>"] = f"{type(e).__name__}: {e}".encode()
    finally:
        conn.close()
    return obs


def _stop(url: str, token: str, proc: subprocess.Popen) -> None:
    """Best-effort graceful stop, then a kill. Never raises: this runs in a `finally` and
    a harness that leaks a server per failed cell eats the port and then the machine."""
    try:
        conn = http.client.HTTPConnection("127.0.0.1", int(url.rsplit(":", 1)[1]), timeout=3)
        conn.request("POST", "/api/shutdown", body=b"{}",
                     headers={"X-Geneseed-Token": token, "Content-Type": "application/json"})
        conn.getresponse().read()
        conn.close()
    except (http.client.HTTPException, OSError, ValueError, socket.timeout):
        pass
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=10)


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
            if record is None:
                out, err = proc.communicate(timeout=10)
                return f"server did not start (rc={proc.returncode}): {out[-400:]}{err[-400:]}"
            obs = _drive(record["port"], record.get("token", ""), cell["requests"])
        finally:
            _stop(record["url"] if record else "", record.get("token", "") if record else "",
                  proc)
        out, err = proc.communicate(timeout=10)

        stamps = _dyn_stamps(record, record["port"], record["pid"])
        roots = [("<HOME>", home), ("<REPO>", checkout), ("<REPO>", ROOT), ("<SB>", sb)]

        def clean(b: bytes) -> bytes:
            return harness_golden._destamp(_apply(golden._normalise(_apply(b, stamps), roots),
                                                  stamps))

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
