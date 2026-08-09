"""HTTP-level tests for the web daemon: keep-alive, compression, caching, and
the body-drain that keep-alive makes load-bearing.

These drive a real socket against a real ThreadingHTTPServer rather than calling
the handler directly — the behaviours under test (connection reuse, leftover
request bodies) only exist at the socket level and a unit test of the handler
would not see them.

Run from the Geneseed root:  python -m unittest discover -s tests
"""
import ast
import gzip
import http.client
import json
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "rituals"))
sys.path.insert(0, str(ROOT))
import web  # noqa: E402

DIST = ROOT / "web" / "dist"
TOKEN = "test-token"


@unittest.skipUnless((DIST / "index.html").is_file(),
                     "web/dist not built — nothing to serve")
class WebServerHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.state = web.WebState(theme="neutral")
        cls.holder = {}
        handler = web.make_handler(cls.state, web.JobManager(), TOKEN, DIST,
                                   cls.holder)
        cls.srv = web.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.holder["srv"] = cls.srv
        cls.port = cls.srv.server_address[1]
        cls.thread = threading.Thread(target=cls.srv.serve_forever, daemon=True)
        cls.thread.start()
        for _ in range(50):          # wait for the listener, don't sleep blind
            try:
                c = http.client.HTTPConnection("127.0.0.1", cls.port, timeout=5)
                c.request("GET", "/api/ping", headers=cls._h(cls.port))
                c.getresponse().read()
                c.close()
                break
            except OSError:
                time.sleep(0.05)

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()

    @staticmethod
    def _h(port, **extra):
        return {"Host": f"127.0.0.1:{port}", **extra}

    def _conn(self):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        self.addCleanup(c.close)
        return c

    def _asset_name(self):
        js = sorted((DIST / "assets").glob("index-*.js"))
        if not js:
            self.skipTest("no hashed JS asset in dist")
        return js[0].name, js[0].stat().st_size

    def test_responses_are_http11_and_keep_the_connection(self):
        c = self._conn()
        c.request("GET", "/api/ping", headers=self._h(self.port))
        r = c.getresponse()
        r.read()
        self.assertEqual(r.status, 200)
        self.assertEqual(r.version, 11, "server answered HTTP/1.0")
        self.assertNotEqual((r.getheader("Connection") or "").lower(), "close")
        # A second request on the SAME connection is the actual proof.
        c.request("GET", "/api/ping", headers=self._h(self.port))
        r2 = c.getresponse()
        r2.read()
        self.assertEqual(r2.status, 200)

    def test_assets_are_gzipped_when_accepted(self):
        name, raw = self._asset_name()
        c = self._conn()
        c.request("GET", f"/assets/{name}",
                  headers=self._h(self.port, **{"Accept-Encoding": "gzip"}))
        r = c.getresponse()
        body = r.read()
        self.assertEqual(r.getheader("Content-Encoding"), "gzip")
        self.assertEqual(r.getheader("Vary"), "Accept-Encoding")
        self.assertLess(len(body), raw)
        self.assertEqual(len(gzip.decompress(body)), raw,
                         "gzipped body does not round-trip to the file")

    def test_assets_are_plain_when_gzip_not_accepted(self):
        name, raw = self._asset_name()
        c = self._conn()
        c.request("GET", f"/assets/{name}", headers=self._h(self.port))
        r = c.getresponse()
        body = r.read()
        self.assertIsNone(r.getheader("Content-Encoding"))
        self.assertEqual(len(body), raw)

    def test_hashed_assets_are_cached_forever_and_index_never(self):
        name, _ = self._asset_name()
        c = self._conn()
        c.request("GET", f"/assets/{name}", headers=self._h(self.port))
        r = c.getresponse()
        r.read()
        self.assertIn("immutable", r.getheader("Cache-Control") or "")
        # index.html carries the per-session CSRF token: caching it would hand a
        # later session a dead token.
        c.request("GET", "/", headers=self._h(self.port))
        r = c.getresponse()
        body = r.read()
        self.assertEqual(r.getheader("Cache-Control"), "no-store")
        if r.getheader("Content-Encoding") == "gzip":
            body = gzip.decompress(body)
        self.assertIn(b"__GENESEED_TOKEN__", body)
        self.assertIn(TOKEN.encode(), body)

    def test_rejected_post_does_not_poison_the_next_request(self):
        """The guards answer 403 before any route reads the request body. Under
        keep-alive an undrained body would be parsed as the next request line,
        so the drain in do_POST is what keeps the connection usable."""
        payload = json.dumps({"pad": "y" * 4000}).encode()
        c = self._conn()
        c.request("POST", "/api/reemit", body=payload,
                  headers=self._h(self.port, **{
                      "Content-Type": "application/json",
                      "Content-Length": str(len(payload)),
                      "X-Geneseed-Token": "wrong-token"}))
        r = c.getresponse()
        r.read()
        self.assertEqual(r.status, 403)
        # Same socket, immediately after.
        c.request("GET", "/api/ping", headers=self._h(self.port))
        r2 = c.getresponse()
        body = r2.read()
        self.assertEqual(r2.status, 200)
        self.assertTrue(json.loads(body).get("ok"))

    def test_every_table_driven_get_route_answers(self):
        """The plain GET routes are a dict of path -> api function. A typo in a key
        or a handler that no longer takes just `state` turns into a 404 or a 500 at
        runtime, so walk the table itself rather than a hand-copied list of paths."""
        routes = self.srv.RequestHandlerClass.STATE_ROUTES
        self.assertGreaterEqual(len(routes), 10, "route table looks truncated")
        for path in routes:
            with self.subTest(path=path):
                c = self._conn()
                c.request("GET", path, headers=self._h(self.port))
                r = c.getresponse()
                body = r.read()
                self.assertEqual(r.status, 200, f"{path} -> {r.status}")
                if r.getheader("Content-Encoding") == "gzip":
                    body = gzip.decompress(body)
                self.assertIsInstance(json.loads(body), dict, path)

    def test_unknown_api_path_falls_through_to_the_spa(self):
        """An /api path with no route must not 500 — it falls to the static
        handler, which serves index.html for anything it cannot find."""
        c = self._conn()
        c.request("GET", "/api/does-not-exist", headers=self._h(self.port))
        r = c.getresponse()
        r.read()
        self.assertIn(r.status, (200, 404))

    def test_foreign_host_is_still_refused(self):
        c = self._conn()
        c.request("GET", "/api/overview", headers={"Host": "evil.com"})
        r = c.getresponse()
        r.read()
        self.assertEqual(r.status, 403)


# ---- the Node twin's route table, cross-checked against this one ------------------------

def _reference_routes() -> "tuple[set[str], set[str]]":
    """Every path `_web_server.py` answers, split by verb, read with `ast`.

    THE TABLE HAS TO COME FROM THE THING UNDER TEST. A hand-kept list of 29 paths in this
    file would be a second answer to the question, and the failure it would hide is the
    silent one: an endpoint added to the reference and to neither list, which the Node
    daemon then answers with the SPA fallback — a 200 and an HTML page where the client
    expects JSON.

    Three shapes carry a route: a key in the `STATE_ROUTES` dict, a `path == "..."`
    comparison, and a `path.startswith("...")` prefix. The verb is decided by which
    function the node sits in, because five paths answer both with different bodies and a
    set keyed on path alone cannot tell `/api/excludes`' GET from its POST.
    """
    tree = ast.parse((ROOT / "rituals" / "_web_server.py").read_text(encoding="utf-8"))
    get: set[str] = set()
    post: set[str] = set()
    for fn in ast.walk(tree):
        if not isinstance(fn, ast.FunctionDef):
            continue
        if fn.name == "do_GET":
            bag = get
        elif fn.name == "_post_routes":
            bag = post
        else:
            continue
        for node in ast.walk(fn):
            if (isinstance(node, ast.Compare) and isinstance(node.left, ast.Name)
                    and node.left.id == "path"
                    and all(isinstance(o, ast.Eq) for o in node.ops)):
                bag.update(c.value for c in node.comparators
                           if isinstance(c, ast.Constant) and isinstance(c.value, str))
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and node.func.attr == "startswith"
                    and isinstance(node.func.value, ast.Name)
                    and node.func.value.id == "path"):
                bag.update(a.value for a in node.args
                           if isinstance(a, ast.Constant) and isinstance(a.value, str))
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id == "STATE_ROUTES" for t in node.targets):
            get.update(k.value for k in node.value.keys
                       if isinstance(k, ast.Constant) and isinstance(k.value, str))
    return get, post


def _node_routes() -> dict:
    """The candidate's own answer, asked of the modules rather than scraped out of them.

    `tests/test_node_cli_parity.py` reads its lists with a text scrape, which is right for
    a flat array of string literals. `STATE_ROUTES` maps paths to FUNCTIONS, so the keys
    only exist once the module is evaluated — and a scrape that fell out of step with the
    object the server actually dispatches on would gate nothing.
    """
    src = (
        "import {STATE_ROUTES} from './js/web/api.mjs';"
        "import {NOT_PORTED, NOT_PORTED_PREFIXES, NOT_PORTED_POST, NOT_PORTED_POST_PREFIXES}"
        "  from './js/web/server.mjs';"
        "process.stdout.write(JSON.stringify({"
        "  ported: Object.keys(STATE_ROUTES),"
        "  unportedGet: [...NOT_PORTED, ...NOT_PORTED_PREFIXES],"
        "  unportedPost: [...NOT_PORTED_POST, ...NOT_PORTED_POST_PREFIXES]}));"
    )
    r = subprocess.run([shutil.which("node") or "node", "--input-type=module",
                        "-e", src], cwd=str(ROOT), capture_output=True, text=True,
                       encoding="utf-8")
    if r.returncode != 0:
        raise AssertionError(f"could not read the Node route table: {r.stderr[-800:]}")
    return json.loads(r.stdout)


@unittest.skipUnless(shutil.which("node"), "node is not on PATH")
class TheTwoRouteTablesAgree(unittest.TestCase):
    """The partition gate P6b makes possible.

    `tests/web_golden.py` compares the routes that ARE ported, one cell at a time. It is
    structurally blind to a route that exists on the reference and on neither of the Node
    daemon's lists: no cell names it, so nothing fails, and the daemon answers it with the
    SPA's index.html at a 200. This is the other half — every path the reference answers
    is either ported or explicitly declared unported, and the two sets are disjoint.

    On the second instance of anything the gate becomes a table cross-checked against the
    source of truth; this is the second instance (P4a's verb matrix was the first).
    """

    def test_every_get_route_is_either_ported_or_declared_unported(self):
        ref_get, _ref_post = _reference_routes()
        js = _node_routes()
        # `/api/ping` is the shell's own and is answered outside the table on both sides.
        covered = {"/api/ping"} | set(js["ported"]) | set(js["unportedGet"])
        self.assertEqual(ref_get - covered, set(),
                         "the reference answers GET paths the Node daemon neither ports "
                         "nor declares unported — each would fall through to the SPA")
        self.assertEqual(covered - ref_get, set(),
                         "the Node daemon claims GET paths the reference does not answer")

    def test_every_post_route_is_either_ported_or_declared_unported(self):
        _ref_get, ref_post = _reference_routes()
        js = _node_routes()
        # `/api/shutdown` is the only POST the shell itself owns (P6a).
        covered = {"/api/shutdown"} | set(js["unportedPost"])
        self.assertEqual(ref_post, covered,
                         "the POST partition has drifted from the reference's routes")

    def test_the_declared_partition_is_the_one_the_dispatcher_uses(self):
        """The assertion the two tests above cannot make, and a mutation is why it exists.

        Both of them read the exported SETS. Collapsing `notPortedPost` back into
        `notPorted` — one line, and the whole reason the two lists exist — leaves both sets
        exactly as declared and both tests green, while POST `/api/excludes` starts
        answering `{"error": "not found"}` with a 404 instead of the 501 that says
        "unported". That is the plausible-looking answer the 501 exists to prevent, and a
        gate on a declaration cannot see it.

        So this one drives the real handler: one probe per branch of the partition, each
        naming the status the dispatcher must actually produce. `tests/web_golden.py`
        cannot ask this — it compares two implementations, and no cell may hold a 501
        against the reference's real body.
        """
        src = r"""
import {createServer} from 'node:http';
import {makeHandler, webState} from './js/web/server.mjs';
const holder = {};
const srv = createServer(makeHandler(webState('neutral'), 'tok', 'nowhere', holder));
holder.srv = srv;
srv.listen(0, '127.0.0.1', async () => {
  const base = `http://127.0.0.1:${srv.address().port}`;
  const hit = async (method, p, tok) => (await fetch(base + p, {method,
    headers: tok ? {'X-Geneseed-Token': tok, 'Content-Type': 'application/json'} : {},
    body: method === 'POST' ? '{}' : undefined})).status;
  const out = {
    unportedGet: await hit('GET', '/api/mcp'),
    portedGet: await hit('GET', '/api/profile'),
    unportedPost: await hit('POST', '/api/excludes', 'tok'),
    unportedPostPrefix: await hit('POST', '/api/actions/build', 'tok'),
    shellPost: await hit('POST', '/api/shutdown', 'tok'),
  };
  process.stdout.write(JSON.stringify(out));
  srv.close();
  srv.closeAllConnections();
});
"""
        r = subprocess.run([shutil.which("node"), "--input-type=module", "-e", src],
                           cwd=str(ROOT), capture_output=True, text=True,
                           encoding="utf-8", timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr[-800:])
        got = json.loads(r.stdout)
        self.assertEqual(got["unportedGet"], 501, "an unported GET must say so")
        self.assertEqual(got["portedGet"], 200, "a ported GET must answer — the control, "
                                                "without which every 501 below is vacuous")
        self.assertEqual(got["unportedPost"], 501,
                         "POST /api/excludes is unported even though its GET has crossed; "
                         "a 404 here means the two lists have been collapsed into one")
        self.assertEqual(got["unportedPostPrefix"], 501, "the POST prefixes too")
        self.assertEqual(got["shellPost"], 200, "the shell's own POST still answers")

    def test_a_ported_route_is_never_also_declared_unported(self):
        js = _node_routes()
        self.assertEqual(set(js["ported"]) & set(js["unportedGet"]), set())
        # The five dual-verb paths are why the two unported sets exist separately: a GET
        # that has crossed must not take its own POST out of the unported list with it.
        self.assertTrue(set(js["ported"]) & set(js["unportedPost"]),
                        "no ported GET shares a path with an unported POST — either the "
                        "dual-verb paths have all crossed, in which case delete this "
                        "assertion, or the split has been collapsed back into one set")


class TheSetupSnapshotNamesItsOwnRuntime(unittest.TestCase):
    """The absolute assertion `tests/web_golden.py` owes for a value it normalises.

    `api_setup`'s `python` is the one field in P6b with no honest twin — the reference
    reports the interpreter running the daemon and the Node one answers `null`, because
    there is not one and putting Node's version under a key named `python` would be a lie
    the About page would print. The harness normalises the field (and the Content-Length
    its four-byte width difference moves) on both sides, so nothing there says what the
    reference actually puts in it. This does.
    """

    def test_the_reference_reports_its_own_interpreter_version(self):
        with tempfile.TemporaryDirectory() as td:
            data = web.api_setup(web.WebState(theme="neutral", target=Path(td)))
        self.assertEqual(data["python"], sys.version.split()[0])

    @unittest.skipUnless(shutil.which("node"), "node is not on PATH")
    def test_the_node_daemon_reports_no_interpreter_rather_than_its_own(self):
        """The other half, and the one the harness genuinely cannot see.

        `_WEB_STAMPS` accepts a version string OR null and rewrites either to the same tag,
        because it has to produce the same tag from both sides. So a Node twin that put
        `process.versions.node` under the `python` key would match the pattern, normalise
        to `"<RUNTIME>"`, and pass every web cell while telling the About page that a
        Node install is running Python 22.11.0. This is what refuses that.
        """
        src = ("import {apiSetup, webState} from './js/web/api.mjs';"
               "process.stdout.write(JSON.stringify(apiSetup(webState('neutral'))"
               ".python));")
        r = subprocess.run([shutil.which("node"), "--input-type=module", "-e", src],
                           cwd=str(ROOT), capture_output=True, text=True,
                           encoding="utf-8")
        self.assertEqual(r.returncode, 0, r.stderr[-800:])
        self.assertEqual(r.stdout, "null",
                         "the Node daemon must answer `python: null` — there is no "
                         "interpreter behind it, and any version string under that key "
                         "is a lie the About page prints")


if __name__ == "__main__":
    unittest.main()
