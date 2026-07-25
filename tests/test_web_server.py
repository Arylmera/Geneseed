"""HTTP-level tests for the web daemon: keep-alive, compression, caching, and
the body-drain that keep-alive makes load-bearing.

These drive a real socket against a real ThreadingHTTPServer rather than calling
the handler directly — the behaviours under test (connection reuse, leftover
request bodies) only exist at the socket level and a unit test of the handler
would not see them.

Run from the Geneseed root:  python -m unittest discover -s tests
"""
import gzip
import http.client
import json
import sys
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


if __name__ == "__main__":
    unittest.main()
