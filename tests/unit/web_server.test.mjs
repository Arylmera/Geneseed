/**
 * The web daemon at the HTTP level — keep-alive, compression, caching, the body-drain keep-alive
 * makes load-bearing — and the route SURFACE the dispatch tables declare.
 *
 * SUCCESSOR TO `tests/test_web_server.py`. Two halves, and they fail for different reasons.
 *
 * THE SOCKET HALF drove a real `ThreadingHTTPServer` because the behaviours under test only exist
 * at the socket level: a unit test of the handler cannot see connection reuse or a leftover
 * request body. The same is true of `node:http`, so these re-aim at `makeHandler` over a real
 * listener rather than moving up a layer. Connection reuse is asserted by SOCKET IDENTITY, which
 * is stronger than the reference's "the second request also answered 200" — a server that closed
 * and a client that silently redialled would satisfy that.
 *
 * THE SURFACE HALF holds the dispatch tables against lists WRITTEN OUT below — a second party,
 * because a gate scraped from the thing under test would agree with any drift. Growing or
 * shrinking the API means editing the list here in the same commit, with the reason in the
 * message. (This half descended from the Python→Node port's two-sided partition, whose
 * NOT_PORTED / DECLINED sets all emptied when the port finished and were then deleted — see git
 * history for that machinery.) A declaration is not a dispatcher, so the probe test drives the
 * REAL handler as well: one request per branch, each naming the status the dispatcher must
 * produce. `/api/restart`, `/api/pick-folder` and `/api/reveal`'s success arm are never driven
 * live — they would bounce a daemon or pop a real OS dialog/file-manager on the developer's own
 * screen; their dispatch is covered by dedicated unit tests instead.
 */
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

import { PREFIX_ROUTES, STATE_ROUTES, webState } from '../../js/web/api.mjs';
import { KINDS } from '../../js/web/docs.mjs';
import { JobManager } from '../../js/web/jobs.mjs';
import { makeHandler } from '../../js/web/handler.mjs';
import { GET_INLINE, POST_INLINE, POST_ROUTES, POST_ROUTES_CONVENTION } from '../../js/web/routes.mjs';
import { webFixture, webFixtureTeardown } from '../helpers/web_fixture.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const DIST = path.join(ROOT, 'web', 'dist');
const TOKEN = 'test-token';

// ---------------------------------------------------------------------------------------------
// THE DECLARED SURFACE, WRITTEN OUT. A second party to the dispatch tables: reading the same
// lists out of `js/web/` would make each assertion below a comparison of a value with itself.
// A route added to the daemon and not to these lists is the failure they freeze — a GET would
// otherwise answer with the SPA's index.html at a 200, where the client expects JSON. Editing
// the API means editing the matching list here, in the same commit, with the reason in the
// message. (`/api/graph` left this list when the web graph pages were retired — the last
// endpoint to leave it.)

/** Every GET path the daemon answers — 20. Trailing `/` marks a prefix route. */
const GET_SURFACE = ['/api/activity', '/api/activity/', '/api/catalog/', '/api/diff', '/api/docs',
  '/api/docs/page/', '/api/doctor', '/api/excludes', '/api/installs', '/api/item/',
  '/api/jobs', '/api/jobs/', '/api/mcp', '/api/overview', '/api/ping', '/api/profile',
  '/api/rules', '/api/setup', '/api/themes', '/api/recent'];

/** Every POST path the daemon answers — 15. */
const POST_SURFACE = ['/api/actions/', '/api/activity', '/api/excludes', '/api/install',
  '/api/jobs/', '/api/mcp', '/api/memory/delete', '/api/pick-folder', '/api/profile',
  '/api/restart', '/api/reveal', '/api/rules', '/api/rules/promote', '/api/shutdown',
  '/api/view'];

/**
 * The POST paths whose send carries a `200 if … else 409` conditional.
 *
 * `/api/activity` and `/api/memory/delete` are deliberately NOT here: their write is sent at 200
 * whatever `ok` says. Giving `/api/activity` the 409 treatment is the INVISIBLE mutation: each
 * toggle a behavioural test can perform SUCCEEDS, and the failing arm needs the flag write to
 * raise — so the column has to be checked as a column, below.
 */
const EXPECT_409 = ['/api/excludes', '/api/install', '/api/mcp', '/api/profile', '/api/rules',
  '/api/rules/promote', '/api/view'];

/** Every kind `apiDocsPage` dispatches on — 5. */
const EXPECT_KINDS = ['about', 'cli', 'concept', 'glossary', 'markdown'];

const sorted = (xs) => [...xs].sort();

// ---------------------------------------------------------------------------------------------
// ONE SERVER FOR THE SOCKET HALF, exactly as the reference's `setUpClass` built one. The fixture
// comes first: a `webState()` with no target resolves to the MACHINE's OpenCode config dir, so
// without it these read whatever harness the developer happens to have installed.
webFixture();

const holder = {};
const server = http.createServer(makeHandler(webState('neutral'), new JobManager(), TOKEN, DIST,
  holder));
holder.srv = server;
await new Promise((r) => { server.listen(0, '127.0.0.1', r); });
const PORT = server.address().port;

after(() => {
  server.closeAllConnections();
  server.close();
  webFixtureTeardown();
});

/**
 * One request, over an agent the caller owns — so a caller that wants two requests on ONE socket
 * gets them, and can prove it by identity.
 *
 * `timeout: 60_000` and not the default: `/api/doctor` walks the whole bundle, so it is
 * filesystem-bound, and a contended CI runner has taken 30x this laptop on a suite. This is a
 * CLIENT read timeout, not a service-level assertion — a server that genuinely hangs still fails,
 * just later — and nothing here asserts a latency bound.
 */
function request(method, urlPath, { agent, headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, method, path: urlPath, agent,
      timeout: 60_000, headers: { Host: `127.0.0.1:${PORT}`, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers,
        httpVersion: res.httpVersion, socket: res.socket, body: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => { req.destroy(new Error(`${method} ${urlPath} timed out`)); });
    req.on('error', reject);
    if (body !== null) req.write(body);
    req.end();
  });
}

/** A keep-alive agent capped at one socket, so "reused" is observable rather than probable. */
const oneSocket = () => new http.Agent({ keepAlive: true, maxSockets: 1 });

/** The hashed JS asset Vite emitted, and its size on disk. */
function asset() {
  const dir = path.join(DIST, 'assets');
  const js = existsSync(dir)
    ? readdirSync(dir).filter((n) => n.startsWith('index-') && n.endsWith('.js')).sort() : [];
  assert.ok(js.length > 0, 'no hashed JS asset in web/dist — the caching claims are vacuous');
  return { name: js[0], size: statSync(path.join(dir, js[0])).size };
}

// ---------------------------------------------------------------------------------------------
// THE SOCKET HALF

test('responses are HTTP/1.1 and the connection is reused', async () => {
  const agent = oneSocket();
  try {
    const r = await request('GET', '/api/ping', { agent });
    assert.equal(r.status, 200);
    assert.equal(r.httpVersion, '1.1', 'server answered HTTP/1.0');
    assert.notEqual((r.headers.connection || '').toLowerCase(), 'close');
    // THE ACTUAL PROOF, and it is stronger than the reference's. It asserted only that a second
    // request also answered 200 — which a server that closed the connection and a client that
    // silently redialled would satisfy perfectly. Socket IDENTITY cannot be satisfied that way.
    const r2 = await request('GET', '/api/ping', { agent });
    assert.equal(r2.status, 200);
    assert.equal(r2.socket, r.socket,
      'the second request opened a new socket — the connection was not reused, so keep-alive is '
      + 'off and every asset costs a fresh handshake');
  } finally {
    agent.destroy();
  }
});

test('assets are gzipped when gzip is accepted', async () => {
  const { name, size } = asset();
  const r = await request('GET', `/assets/${name}`, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(r.headers['content-encoding'], 'gzip');
  assert.equal(r.headers.vary, 'Accept-Encoding');
  assert.ok(r.body.length < size, 'the gzipped body is not smaller than the file');
  assert.equal(gunzipSync(r.body).length, size,
    'the gzipped body does not round-trip to the file');
});

test('assets are plain when gzip is not accepted', async () => {
  const { name, size } = asset();
  // `identity` rather than an absent header: Node's http client sends no Accept-Encoding of its
  // own, but a proxy or a future default that added one would make the omission stop meaning
  // "does not accept gzip" — and the assertion would then pass for the wrong reason.
  const r = await request('GET', `/assets/${name}`, { headers: { 'Accept-Encoding': 'identity' } });
  assert.equal(r.headers['content-encoding'], undefined);
  assert.equal(r.body.length, size);
});

test('hashed assets are cached forever and index.html never', async () => {
  const { name } = asset();
  const a = await request('GET', `/assets/${name}`);
  assert.match(a.headers['cache-control'] || '', /immutable/);
  // index.html carries the per-session CSRF token: caching it would hand a later session a dead
  // token, and the page would then fail every mutating request with a 403 it cannot explain.
  const r = await request('GET', '/', { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(r.headers['cache-control'], 'no-store');
  const body = r.headers['content-encoding'] === 'gzip' ? gunzipSync(r.body) : r.body;
  assert.ok(body.includes('__GENESEED_TOKEN__'),
    'index.html carries no token placeholder, so the substitution below proves nothing');
  assert.ok(body.includes(TOKEN), 'index.html was served without this session\'s token');
});

test('a path climbing out of dist serves index.html and leaks no file', async () => {
  // TWIN OF `static/a-path-climbing-out-of-dist-falls-back-to-index`, written because that cell
  // dies with the next `web/dist` rebuild — the corpus records `index.html` VERBATIM, including
  // Vite's content-hashed asset names, and there is no recorder left to re-bless it. Of the four
  // `static/` cells this is the only one with no unit twin, and it is the only one that is a
  // SECURITY claim rather than a caching or fallback claim.
  //
  // AND IT IS STRICTLY STRONGER THAN THE CELL. The recording asked for `/../../build.py` and
  // asserted the body held neither `def main(` nor `argparse` — a file P4 DELETED, so both
  // absences are now guaranteed by the file not existing, and the cell proves nothing about
  // traversal. This probes a file that is really there, and says so before trusting the absence.
  const marker = '"name": "geneseed"';
  const pkg = readFileSync(path.join(ROOT, 'package.json'), 'utf8');
  assert.ok(pkg.includes(marker),
    'package.json no longer holds the marker — the leak assertions below would be vacuous');

  // Several spellings, because they are refused by different code: `..` segments the server
  // resolves, a backslash Windows treats as a separator where POSIX does not, and a percent
  // escape that only becomes `..` AFTER decoding — the shape a normaliser applied in the wrong
  // order lets through.
  for (const p of [
    '/../package.json',
    '/../../package.json',
    '/assets/../../package.json',
    '/..%2F..%2Fpackage.json',
    '/..\\..\\package.json',
  ]) {
    const r = await request('GET', p);
    assert.equal(r.status, 200, `${p} did not fall back to the SPA`);
    assert.match(r.headers['content-type'] || '', /text\/html/,
      `${p} was served as something other than the SPA shell`);
    assert.ok(!r.body.toString('utf8').includes(marker),
      `${p} SERVED A FILE FROM OUTSIDE web/dist — this is a file-read primitive`);
  }
});

test('a rejected POST does not poison the next request on the same connection', async () => {
  // The guards answer 403 BEFORE any route reads the request body. Under keep-alive an undrained
  // body would be parsed as the next request line, so the drain is what keeps the socket usable.
  const agent = oneSocket();
  try {
    const payload = JSON.stringify({ pad: 'y'.repeat(4000) });
    const r = await request('POST', '/api/reemit', { agent,
      body: payload,
      headers: { 'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(payload)),
        'X-Geneseed-Token': 'wrong-token' } });
    assert.equal(r.status, 403);
    const r2 = await request('GET', '/api/ping', { agent });
    assert.equal(r2.status, 200,
      'the next request on the same socket did not answer — the rejected body was parsed as its '
      + 'request line');
    assert.equal(JSON.parse(r2.body.toString('utf8')).ok, true);
    assert.equal(r2.socket, r.socket, 'the socket was replaced, so nothing here tested the drain');
  } finally {
    agent.destroy();
  }
});

test('every table-driven GET route answers', async () => {
  // The plain GET routes are a map of path -> api function. A typo in a key or a handler that no
  // longer takes just `state` turns into a 404 or a 500 at runtime, so walk the table itself
  // rather than a hand-copied list of paths.
  const paths = Object.keys(STATE_ROUTES);
  assert.ok(paths.length >= 10, `route table looks truncated: ${paths.length}`);
  for (const p of paths) {
    const r = await request('GET', p, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(r.status, 200, `${p} -> ${r.status}`);
    const body = r.headers['content-encoding'] === 'gzip' ? gunzipSync(r.body) : r.body;
    const parsed = JSON.parse(body.toString('utf8'));
    assert.ok(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed),
      `${p} did not answer a JSON object`);
  }
});

test('an unknown api path falls through to the SPA', async () => {
  // An /api path with no route must not 500 — it falls to the static handler, which serves
  // index.html for anything it cannot find.
  const r = await request('GET', '/api/does-not-exist');
  assert.ok([200, 404].includes(r.status), `unknown api path answered ${r.status}`);
});

test('a foreign Host is refused', async () => {
  const r = await request('GET', '/api/overview', { headers: { Host: 'evil.com' } });
  assert.equal(r.status, 403);
});

// ---------------------------------------------------------------------------------------------
// THE SURFACE HALF

const nodeGet = () => [...Object.keys(STATE_ROUTES), ...PREFIX_ROUTES.map((r) => r[0]),
  ...GET_INLINE];

test('the GET surface is exactly the declared one', () => {
  // Set equality against the written-out list: a route added to a dispatch table and not to
  // `GET_SURFACE` fails here, and so does one deleted from a table but left on the list —
  // growing or shrinking the API is a deliberate edit in both places or it is a bug.
  assert.deepEqual(sorted(new Set(nodeGet())), sorted(GET_SURFACE),
    'the GET dispatch tables and the declared surface have drifted apart — an undeclared GET '
    + 'falls through to the SPA and answers HTML at a 200 where the client expects JSON');
});

test('the POST surface is exactly the declared one', () => {
  assert.deepEqual(sorted(new Set([...POST_ROUTES.keys(), ...POST_INLINE])),
    sorted(POST_SURFACE),
    'the POST dispatch (table + inline list) and the declared surface have drifted apart');
});

test('the declared surface is the one the dispatcher uses', async () => {
  // THE ASSERTION THE TWO TESTS ABOVE CANNOT MAKE. Both of them read the exported tables — and
  // a declaration is not a dispatcher: a route can sit in a table the dispatch stopped
  // consulting and both stay green. So this drives the REAL handler: one probe per branch,
  // each naming the status the dispatcher must actually produce.
  //
  // ITS OWN SERVER, because the last probe stops the listener. And `GIT_DIR` is pointed at a path
  // that does not exist FIRST: `preflight()` reads the developer's own checkout, and on a clean
  // tree with an upstream it would say "ready" and the `update` probe would start a REAL git pull
  // and rebuild of this repository. With every git call failing, the endpoint always takes its
  // 422 arm — a probe of the dispatch that cannot reach the transport.
  const savedGitDir = process.env.GIT_DIR;
  process.env.GIT_DIR = 'geneseed-probe-no-such-git-dir';
  const h = {};
  // `'nowhere'` for dist and a fresh JobManager with no history path: this probe must not write a
  // job file into the developer's install.
  const srv = http.createServer(makeHandler(webState('neutral'), new JobManager(), 'tok',
    'nowhere', h));
  h.srv = srv;
  await new Promise((r) => { srv.listen(0, '127.0.0.1', r); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const hit = async (method, p, tok, body) => (await fetch(base + p, { method,
    headers: tok ? { 'X-Geneseed-Token': tok, 'Content-Type': 'application/json' } : {},
    body: method === 'POST' ? (body ?? '{}') : undefined })).status;
  try {
    assert.equal(await hit('GET', '/api/profile'), 200,
      'a table GET must answer — the control, without which every refusal below is vacuous');
    assert.equal(await hit('GET', '/api/jobs'), 200, 'an inline GET must answer too');
    // A 200 means the declaration and the table agree; anything else — an HTML 200 from the
    // SPA fallback included — means the route is declared and not dispatched. (The SPA fallback
    // cannot answer 200 here: this probe's dist root is 'nowhere', so a fall-through is a 404.)
    assert.equal(await hit('GET', '/api/recent'), 200,
      'GET /api/recent must answer — a 404 means the declaration is not dispatched on');
    assert.equal(await hit('POST', '/api/excludes', 'tok'), 409,
      'a table POST must answer, and an empty body is the 409 arm of the convention — the '
      + 'control for the refusals below');
    // An empty body reaches the endpoint, misses the (host, path) allowlist and raises
    // NotFound, which the outer catch answers 404 — proof the route reaches its endpoint.
    assert.equal(await hit('POST', '/api/install', 'tok'), 404,
      'POST /api/install: an empty body names no install, so it must reach the endpoint '
      + 'and raise NotFound');
    // ONLY `/api/reveal`'s REFUSAL ARM IS PROBED: the success arm calls `openUrl`, which asks
    // the DESKTOP to open a folder, and a suite that took it would pop a file-manager window on
    // the developer's machine (and on a CI runner, spawn an opener that is not there). An empty
    // body names no path, so it misses the allowlist and must 404 — which is the interesting
    // half anyway: 200 would mean the allowlist is not consulted before something is opened.
    assert.equal(await hit('POST', '/api/reveal', 'tok'), 404,
      'POST /api/reveal must reach its allowlist and refuse — 200 means nothing checks the '
      + 'path before opening it');
    assert.notEqual(await hit('GET', '/api/reveal'), 501,
      'GET /api/reveal must fall through to the SPA, like every other POST-only declaration');
    // A REAL action and an INVENTED one. "No real action gets the 404 a typo gets" is a
    // statement about the whole table, and `tests/unit/web_jobs.test.mjs` is what proves it
    // for every row at once.
    assert.equal(await hit('POST', '/api/actions/update', 'tok'), 422,
      'POST /api/actions/update is gated on preflight: 404 means it fell through to the table, '
      + 'and 202 means the preflight was SKIPPED and a real git pull just started');
    assert.equal(await hit('POST', '/api/actions/nope', 'tok'), 404,
      'an action the table does not name answers 404');
    assert.equal(await hit('POST', '/api/actions/restore', 'tok', '{"files": []}'), 200,
      'POST /api/actions/restore is synchronous and answers 200 — the control for the refusals');
    assert.equal(await hit('GET', '/api/docs'), 200);
    assert.equal(await hit('GET', '/api/docs/page/glossary'), 200);
    assert.equal(await hit('GET', '/api/docs/page/cli'), 200,
      '404 means KIND_ROUTES has no row for the `cli` kind');
    assert.equal(await hit('GET', '/api/docs/page/about'), 200,
      'the `about` kind runs `git remote get-url` through originDisplay(), so this is also the '
      + 'probe that says the docs tree may reach the module the spawn allow-list declares');
    // LAST, always: this one stops the server, and every probe after it would fail with an
    // ECONNRESET that reads like a routing bug.
    assert.equal(await hit('POST', '/api/shutdown', 'tok'), 200, 'the shell\'s own POST answers');
  } finally {
    if (savedGitDir === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = savedGitDir;
    srv.closeAllConnections();
    srv.close();
  }
});

test('the 409 convention is per route', () => {
  // THE COLUMN NO BEHAVIOURAL TEST CAN GATE. `POST_ROUTES` is the DISPATCH, so this is not a
  // gate on a declaration — it is a gate on the table `doPost` looks up. See `EXPECT_409` for
  // why the reverse mutation is the invisible one.
  assert.deepEqual(sorted(Object.keys(POST_ROUTES_CONVENTION)), sorted([...POST_ROUTES.keys()]),
    'the convention column must name every table POST and no other');
  assert.deepEqual(sorted(Object.entries(POST_ROUTES_CONVENTION)
    .filter(([, on]) => on).map(([p]) => p)),
  sorted(EXPECT_409),
  'the 409 column has drifted from the declared conditionals — /api/activity and '
    + '/api/memory/delete answer 200 whatever `ok` says and the others do not, and no '
    + 'behavioural test can gate the difference');
});

test('the docs kinds are exactly the declared ones', () => {
  // The route surface, one level in: a SIXTH kind added to `KIND_ROUTES` cannot quietly
  // answer "page not found" — it has to be enumerated here.
  assert.deepEqual(sorted(KINDS), sorted(EXPECT_KINDS),
    'the docs kinds have drifted from the five declared');
});

test('the setup snapshot\'s missing interpreter field is gated where the snapshot is', () => {
  // RETIREMENT AND DELEGATION, MADE CHECKABLE. The server this one replaced reported the version
  // of the interpreter hosting it. There is no interpreter here, and putting this runtime's
  // version under a key named for that one would be a lie the About page prints — so the field
  // was first answered `null` and is now GONE, which is the only fully honest shape.
  //
  // The claim is owned by `tests/unit/web_api.test.mjs`, inside the full snapshot test, which is
  // the stronger site because it runs against a real snapshot rather than against source text.
  // Re-asserting it here would be a second owner of one claim; pointing at it is only worth
  // anything if the pointer is CHECKED, which is all this row does.
  const owner = readFileSync(path.join(ROOT, 'tests', 'unit', 'web_api.test.mjs'), 'utf8');
  assert.ok(owner.includes('assert.ok(!(\'python\' in s),'),
    'tests/unit/web_api.test.mjs no longer asserts the setup snapshot has NO interpreter-version '
    + 'key — a field with nothing honest to put in it would now be free to grow back by silence');
});
