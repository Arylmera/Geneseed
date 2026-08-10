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
        "import {PREFIX_ROUTES, STATE_ROUTES} from './js/web/api.mjs';"
        "import {NOT_PORTED_KINDS, PORTED_KINDS} from './js/web/docs.mjs';"
        "import {NOT_PORTED, NOT_PORTED_PREFIXES, NOT_PORTED_POST, DECLINED_POST,"
        "  NOT_PORTED_POST_PREFIXES, PORTED_INLINE, PORTED_POST,"
        "  PORTED_POST_INLINE} from './js/web/server.mjs';"
        "process.stdout.write(JSON.stringify({"
        "  ported: [...Object.keys(STATE_ROUTES), ...PREFIX_ROUTES.map((r) => r[0]),"
        "           ...PORTED_INLINE],"
        "  unportedGet: [...NOT_PORTED, ...NOT_PORTED_PREFIXES],"
        "  portedPostInline: [...PORTED_POST_INLINE],"
        "  portedPost: [...PORTED_POST],"
        "  declinedPost: [...DECLINED_POST],"
        "  unportedPost: [...NOT_PORTED_POST, ...NOT_PORTED_POST_PREFIXES],"
        "  portedKinds: PORTED_KINDS, unportedKinds: [...NOT_PORTED_KINDS]}));"
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
        covered = set(js["ported"]) | set(js["unportedGet"])
        self.assertEqual(ref_get - covered, set(),
                         "the reference answers GET paths the Node daemon neither ports "
                         "nor declares unported — each would fall through to the SPA")
        self.assertEqual(covered - ref_get, set(),
                         "the Node daemon claims GET paths the reference does not answer")

    def test_every_post_route_is_either_ported_or_declared_unported(self):
        _ref_get, ref_post = _reference_routes()
        js = _node_routes()
        # Since P6f the partition has FOUR parts, not two, and the third is the point:
        # `declinedPost` is a route that will never cross (`/api/pick-folder` is an OS-native
        # folder dialog), which is a different claim from `unportedPost`'s "not yet". Folding
        # them would make the to-do list wrong in the one direction nobody checks — a later
        # phase emptying it would have to either port a GUI dialog or quietly delete a row.
        #
        # P6g ADDED THE FIFTH, and it is a DECLARATION rather than the hardcoded
        # `{"/api/shutdown"}` this line used to carry. Three POST routes dispatch outside
        # `POST_ROUTES` because the table's second column is the 409 convention and none of
        # them answers on `ok`: the shell's own `/api/shutdown`, and the two job prefixes,
        # which answer 202/409/404/501/400/200. Bending the column to fit would make it lie
        # about the five routes it describes exactly.
        covered = (set(js["portedPostInline"]) | set(js["portedPost"])
                   | set(js["declinedPost"]) | set(js["unportedPost"]))
        self.assertEqual(ref_post, covered,
                         "the POST partition has drifted from the reference's routes")
        self.assertEqual(set(js["portedPost"]) & set(js["unportedPost"]), set())
        self.assertEqual(set(js["portedPost"]) & set(js["declinedPost"]), set())
        self.assertEqual(set(js["unportedPost"]) & set(js["declinedPost"]), set())

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

        P6f RE-AIMED IT, because the probe it was built on crossed. POST `/api/excludes` is
        no longer unported, and with all five dual-verb paths answering both verbs there is
        no path left where a ported GET shares its path with an unported POST — which was
        the shape that made a collapse observable. `declinedGet` is the replacement and it
        asks the collapse question from the other side: `/api/pick-folder` is declared in a
        POST-only set, so a GET to it must fall through to the SPA. Collapse the POST sets
        into `notPorted` and it answers 501 instead, which is what this refuses.
        """
        src = r"""
import {createServer} from 'node:http';
// BEFORE the imports below are USED, and the ordering is the safety: `preflight()` reads the
// developer's own checkout, and on a clean tree with an upstream it would say "ready" and the
// `update` probe would start a REAL `git pull` + rebuild of this repository. Pointing `GIT_DIR`
// at a path that does not exist makes every git call in it fail, so the endpoint always takes
// the 422 arm — a probe of the dispatch that cannot reach the transport.
process.env.GIT_DIR = 'geneseed-probe-no-such-git-dir';
import {makeHandler, webState} from './js/web/server.mjs';
import {JobManager} from './js/web/jobs.mjs';
const holder = {};
// No history path: this probe must not write a job file into the developer's install.
const srv = createServer(makeHandler(webState('neutral'), new JobManager(), 'tok',
                                     'nowhere', holder));
holder.srv = srv;
srv.listen(0, '127.0.0.1', async () => {
  const base = `http://127.0.0.1:${srv.address().port}`;
  const hit = async (method, p, tok, body) => (await fetch(base + p, {method,
    headers: tok ? {'X-Geneseed-Token': tok, 'Content-Type': 'application/json'} : {},
    body: method === 'POST' ? (body ?? '{}') : undefined})).status;
  const out = {
    portedGet: await hit('GET', '/api/profile'),
    portedPost: await hit('POST', '/api/excludes', 'tok'),
    crossedPost: await hit('POST', '/api/install', 'tok'),
    declinedPost: await hit('POST', '/api/pick-folder', 'tok'),
    declinedGet: await hit('GET', '/api/pick-folder'),
    // P6g's three, and none of them may START anything: this probe runs against the
    // DEVELOPER'S OWN environment, so `/api/actions/build` (which the retired
    // `unportedPostPrefix` probe used) would spawn a real build here.
    jobsGet: await hit('GET', '/api/jobs'),
    // P8c: `update` crossed, so this is a POSITIVE probe now — and it MUST stay one that
    // starts nothing. `GIT_DIR` is set to a path that does not exist before the handler is
    // built, so every `git -C ROOT …` in `preflight()` fails and the endpoint takes its 422
    // arm. A regression that skipped the preflight would answer 202 and this asserts 422,
    // which is the same thing said twice: the gate fails, and it fails before a job exists.
    updateAction: await hit('POST', '/api/actions/update', 'tok'),
    // P10b RETIRED THE `unportedAction` PROBE AND COULD NOT RE-POINT IT. It asked for an
    // action whose verb had not crossed and required 501; `link` was its last target and
    // `NOT_PORTED_ACTIONS` is now empty, so no target exists. Nor can one be borrowed: every
    // remaining action either STARTS A JOB in the developer's checkout or, for `link` and
    // `unlink` themselves, writes a shim and edits the real user PATH. The 501 arm's claim
    // moves to `tests/test_web_jobs.py`, which reads the set out of the module — a gate on
    // the declaration, which is weaker than a probe and is declared as such.
    unknownAction: await hit('POST', '/api/actions/nope', 'tok'),
    inlineAction: await hit('POST', '/api/actions/restore', 'tok', '{"files": []}'),
    docsMenu: await hit('GET', '/api/docs'),
    portedKind: await hit('GET', '/api/docs/page/glossary'),
    aboutKind: await hit('GET', '/api/docs/page/about'),
    // P10c: THIS PROBE USED TO REQUIRE 501, and `NOT_PORTED_KINDS` is empty now, so no page
    // has an unported kind and none can be borrowed — the same retirement `unknownAction`
    // took above, for the same reason. It stays as the POSITIVE CONTROL for the last kind to
    // cross; the 501 arm's claim rests on the declaration cross-check below, which is a gate
    // on a declaration and therefore weaker than a probe, and is declared as such.
    cliKind: await hit('GET', '/api/docs/page/cli'),
    // LAST, always: this one stops the server, and every probe after it would fail with
    // an ECONNRESET that reads like a routing bug.
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
        self.assertEqual(got["portedGet"], 200, "a ported GET must answer — the control, "
                                                "without which every 501 below is vacuous")
        # THE `unportedGet` PROBE IS RETIRED, on its own terms: P6g crossed `/api/jobs`, which
        # was the last one, so `NOT_PORTED` is empty and there is no path left to ask. The two
        # sets stay declared (see `js/web/server.mjs`) and the partition test above is what
        # keeps them honest; asking a 501 of a route that answers 200 would be the assertion
        # going stale rather than the gate holding.
        self.assertEqual(got["jobsGet"], 200, "GET /api/jobs crossed in P6g")
        self.assertEqual(got["portedPost"], 409,
                         "a ported POST must answer, and an empty body is the 409 arm of "
                         "the convention — the control for the two 501s below")
        # P6i RETIRED THE `unportedPost` PROBE, on the same terms P6g retired `unportedGet`:
        # `/api/install` crossed, `NOT_PORTED_POST` is empty, and there is no unported POST
        # left to ask. Asking a 501 of a route that now answers would be the assertion going
        # stale rather than the gate holding. What replaces it is the OPPOSITE assertion over
        # the same path — an empty body reaches the endpoint, misses the (host, path)
        # allowlist and raises `NotFound`, which the outer catch answers 404. That is a live
        # probe of the route the set no longer names, and it fails if the row is ever removed
        # from `POST_ROUTES` (it would answer 404 with a different body — or 501 if someone
        # re-added the declaration without the dispatch).
        self.assertEqual(got["crossedPost"], 404,
                         "POST /api/install crossed in P6i: an empty body names no install, "
                         "so it must reach the endpoint and raise NotFound — a 501 here "
                         "means the row went back into NOT_PORTED_POST")
        self.assertEqual(got["declinedPost"], 501,
                         "POST /api/pick-folder never crosses and must say so — a 404 here "
                         "means DECLINED_POST is declared but not dispatched on")
        self.assertNotEqual(got["declinedGet"], 501,
                            "GET /api/pick-folder must fall through to the SPA: the POST "
                            "sets must not be consulted on a GET, which is what collapsing "
                            "them back into NOT_PORTED would do")
        # P6g's action partition, and the FOUR answers are the assertion. `link` is a real
        # action whose verb (`harness.py link`) has not crossed, so it says 501; `nope` is not
        # an action at all, so it gets the reference's own `unknown action` 404; `restore`
        # proves the prefix reaches a real handler, without which both refusals would be
        # satisfied by a dispatcher that answered nothing; and `update` is the payment.
        #
        # P8c REPLACED `update` HERE WITH `link`, and the swap is what keeps this test asking
        # its own question. Its subject is the partition — a real action must not get the 404 a
        # typo gets — and that needs a row that is STILL declared. `update`'s new assertion
        # below is a different claim about a different thing.
        # THE 501 PROBE IS GONE — see the comment beside its retired line in the source
        # above. What survives here is the pair it existed to hold apart: a REAL action
        # (`update`, 422) and an INVENTED one (`nope`, 404). With `NOT_PORTED_ACTIONS`
        # empty, "no real action gets the 404 a typo gets" is now a statement about the
        # whole table rather than about one row, and `test_web_jobs.py`'s `ast` cross-check
        # is what proves it for every row at once.
        # THE POSITIVE HALF OF P8c'S FIRST PAYMENT. `update` left `NOT_PORTED_ACTIONS`, and a
        # payment nothing observes is not a payment: without this the removal is visible only
        # as the ABSENCE of a 501, which a dispatcher that answered 404 would also produce.
        # 422 is the arm the probe's `GIT_DIR` forces (see the source above) and it is the arm
        # this endpoint is really about — a local-only preflight ahead of the job, so a dirty
        # tree gets an explanation instead of a spawn that fails.
        self.assertEqual(got["updateAction"], 422,
                         "POST /api/actions/update crossed in P8c and is gated on preflight: "
                         "501 means the row went back into NOT_PORTED_ACTIONS, 404 means it "
                         "fell through to the table, and 202 means the preflight was skipped "
                         "and a real `git pull` just started")
        self.assertEqual(got["unknownAction"], 404,
                         "an action the table does not name is the reference's own 404")
        self.assertEqual(got["inlineAction"], 200,
                         "POST /api/actions/restore is synchronous and answers 200 — the "
                         "control for the two refusals above")
        self.assertEqual(got["shellPost"], 200, "the shell's own POST still answers")
        # P6d's two inline routes and the KIND partition inside the second of them. Every
        # kind answers as of P10c, so all three of these are 200 and the set they come from
        # is empty — the 501 arm has no reachable target left, said out loud where the probe
        # is built and in `js/web/docs.mjs`'s own docblock.
        self.assertEqual(got["docsMenu"], 200)
        self.assertEqual(got["portedKind"], 200)
        self.assertEqual(got["cliKind"], 200,
                         "P6d's deferral was paid in P10c — 501 means `cli` is back in "
                         "NOT_PORTED_KINDS, 404 means KIND_ROUTES has no row for it")
        # P8c'S SECOND PAYMENT, and the same shape as `updateAction` above: `about` left
        # `NOT_PORTED_KINDS`, and "not 501 any more" is satisfied by a 404 as well. The page
        # runs `git remote get-url` through `originDisplay()`, so this is also the probe that
        # says the docs tree may reach the module `_ALLOWED_SPAWNS` declares.
        self.assertEqual(got["aboutKind"], 200,
                         "the docs `about` kind crossed in P8c — 501 means it is back in "
                         "NOT_PORTED_KINDS, 404 means KIND_ROUTES has no row for it")

    def test_the_409_convention_is_per_route_and_matches_the_reference(self):
        """The column no cell can gate, cross-checked against the source of truth.

        `_post_routes` maps `ok: False` to 409 on five paths and NOT on `/api/activity`,
        whose flag write is sent at 200 whatever it says. A port that unified the rule is
        caught by four cells — but only in one direction. The reverse mutation, giving
        `/api/activity` the 409 treatment, is INVISIBLE to `tests/web_golden.py`: every
        toggle a cell can perform succeeds, and the failing arm needs the flag write to
        raise, which the two runtimes word differently and no byte comparison can hold.

        So the CONVENTION is read out of the reference by `ast` — a path is in the set when
        its send carries a `200 if … else 409` conditional — and required to equal the Node
        table's own second column. `POST_ROUTES` is the dispatch, so this is not a gate on a
        declaration; it is a gate on the table `doPost` looks up.
        """
        tree = ast.parse((ROOT / "rituals" / "_web_server.py").read_text(encoding="utf-8"))
        fn = next(n for n in ast.walk(tree)
                  if isinstance(n, ast.FunctionDef) and n.name == "_post_routes")
        conditional: set[str] = set()
        path_now = None
        for node in fn.body:
            # Each route is `if path == "...": <body>`. Walking the body for an IfExp whose
            # orelse is 409 is what says "this route maps ok to a status".
            if not isinstance(node, ast.If):
                continue
            for cmp_ in ast.walk(node.test):
                if (isinstance(cmp_, ast.Compare) and isinstance(cmp_.left, ast.Name)
                        and cmp_.left.id == "path"
                        and all(isinstance(o, ast.Eq) for o in cmp_.ops)):
                    path_now = next((c.value for c in cmp_.comparators
                                     if isinstance(c, ast.Constant)), None)
            if path_now is None:
                continue
            for inner in ast.walk(node):
                if (isinstance(inner, ast.IfExp) and isinstance(inner.orelse, ast.Constant)
                        and inner.orelse.value == 409):
                    conditional.add(path_now)
            path_now = None
        self.assertTrue(conditional, "no 409 conditionals found — the ast reader is stale")
        src = ("import {POST_ROUTES_CONVENTION} from './js/web/server.mjs';"
               "process.stdout.write(JSON.stringify(POST_ROUTES_CONVENTION));")
        r = subprocess.run([shutil.which("node"), "--input-type=module", "-e", src],
                           cwd=str(ROOT), capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(r.returncode, 0, r.stderr[-800:])
        js = json.loads(r.stdout)
        ported = set(_node_routes()["portedPost"])
        self.assertEqual(set(js), ported,
                         "the convention column must name every ported POST and no other")
        self.assertEqual({p for p, on in js.items() if on}, conditional & ported,
                         "the 409 column has drifted from the reference's own conditionals "
                         "— /api/activity answers 200 whatever `ok` says and the others do "
                         "not, and no cell can gate the difference")

    def test_every_docs_kind_is_either_ported_or_declared_unported(self):
        """The route partition, one level in.

        `api_docs_page` dispatches on five KINDS. P6d crossed three, P8c `about`, and P10c
        the last one — `cli`, which used to walk `harness.build_argparser()` (24 subparsers
        and 43 `add_argument` calls, none of which a Node twin can introspect) and now reads
        the generated `cli.json` on both sides.

        SO `NOT_PORTED_KINDS` IS EMPTY, AND THIS CHECK IS AT ITS STRONGEST THERE: it now says
        every kind the reference dispatches on is answered by the port, and a SIXTH kind
        added to the reference still cannot quietly answer "page not found". It is also the
        only surviving gate on the 501 arm, since an empty set leaves the running probe above
        nothing to aim at — a gate on a declaration, weaker than a probe, and named as such
        in all three places that carry the claim.
        """
        src = (ROOT / "rituals" / "_web_docs.py").read_text(encoding="utf-8")
        tree = ast.parse(src)
        kinds = set()
        for fn in ast.walk(tree):
            if not (isinstance(fn, ast.FunctionDef) and fn.name == "api_docs_page"):
                continue
            for node in ast.walk(fn):
                if (isinstance(node, ast.Compare) and isinstance(node.left, ast.Name)
                        and node.left.id == "kind"):
                    kinds.update(c.value for c in node.comparators
                                 if isinstance(c, ast.Constant))
        self.assertTrue(kinds, "no kinds found — the ast reader has gone stale")
        js = _node_routes()
        self.assertEqual(kinds, set(js["portedKinds"]) | set(js["unportedKinds"]))
        self.assertEqual(set(js["portedKinds"]) & set(js["unportedKinds"]), set())

    def test_a_ported_route_is_never_also_declared_unported(self):
        js = _node_routes()
        self.assertEqual(set(js["ported"]) & set(js["unportedGet"]), set())
        # THE OLD ASSERTION HERE HAS BEEN RETIRED, on its own instruction. It required some
        # ported GET to share its path with an unported POST — the shape that made a
        # collapse of the two sets observable — and said "either the dual-verb paths have
        # all crossed, in which case delete this assertion, or the split has been collapsed
        # back into one set". P6f is the phase where the first arm became true: all five
        # answer both verbs now. The collapse question moved to the DISPATCHER probe above,
        # where `declinedGet` asks it from the GET side instead.
        #
        # What still belongs here is the other direction, and it is new: a POST-only
        # declaration must never appear in the GET partition, or the GET dispatcher would
        # 501 a path the SPA owns.
        self.assertEqual(
            (set(js["unportedPost"]) | set(js["declinedPost"])) & set(js["ported"]), set(),
            "a POST declaration has leaked into the ported GET table")


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
