/**
 * The web daemon at the HTTP level — keep-alive, compression, caching, the body-drain keep-alive
 * makes load-bearing — and the route PARTITION that the 114 recorded cells are structurally blind
 * to.
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
 * THE PARTITION HALF read the reference's routes with `ast` on the argument that "the table has
 * to come from the thing under test", and it was right: a hand-kept list in the test would be a
 * second answer to the same question. The thing under test is now the only implementation, so a
 * gate scraped from it would agree with any drift — the same wall `test_node_cli_parity.py`'s
 * help-flag scrape hit, and the same answer. THE FROZEN SETS BELOW WERE READ OUT OF THE REFERENCE
 * ON 2026-08-16 with its own `ast` readers, and the test is the second party now.
 *
 * ⚠ LIMITS ROW 3 LIVES IN THIS FILE, in `the declared partition is the one the dispatcher
 * uses`. It exists because a declaration is not a dispatcher: collapsing the POST sets back
 * into `NOT_PORTED` leaves every declaration exactly as written and every set-reading test
 * green, while quietly changing what the real dispatcher does. It used to be PROVED with
 * `/api/pick-folder` (DECLINED, so POST had to answer 501 and GET had to fall through to the
 * SPA) — `DECLINED_POST` is EMPTY now (pick-folder crossed 2026-08-27, a user override; see
 * `js/web/routes.mjs`), so there is no member left to probe that way here. Hitting the live
 * route would no longer prove the same thing anyway: it now spawns a REAL OS folder dialog on
 * the daemon host, which this suite must not pop on the developer's own screen (the same
 * reason `/api/restart` and `/api/reveal`'s success arm are never driven, two probes below) —
 * its dispatch (and the non-desktop error path) is covered instead by a dedicated unit test
 * that overrides `process.platform` rather than hitting a live server.
 */
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

import { PREFIX_ROUTES, STATE_ROUTES, webState } from '../../js/web/api.mjs';
import { NOT_PORTED_KINDS, PORTED_KINDS } from '../../js/web/docs.mjs';
import { JobManager } from '../../js/web/jobs.mjs';
import { makeHandler } from '../../js/web/handler.mjs';
import { DECLINED_POST, GET_BEYOND_REF, NOT_PORTED, NOT_PORTED_POST, NOT_PORTED_POST_PREFIXES, NOT_PORTED_PREFIXES, PORTED_INLINE, PORTED_POST, PORTED_POST_INLINE, POST_BEYOND_REF, POST_ROUTES_CONVENTION } from '../../js/web/routes.mjs';
import { webFixture, webFixtureTeardown } from '../helpers/web_fixture.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const DIST = path.join(ROOT, 'web', 'dist');
const TOKEN = 'test-token';

// ---------------------------------------------------------------------------------------------
// THE REFERENCE'S OWN ANSWERS, MEASURED WHILE IT EXISTED (2026-08-16), with the `ast` readers
// `tests/test_web_server.py` carried. Frozen rather than re-derived: `_web_server.py` is deleted
// by P4, and reading the same sets out of `js/web/` would make each assertion below a comparison
// of a value with itself. A new route added to the port and to neither of these lists is the
// failure these freeze — it would otherwise answer with the SPA's index.html at a 200, where the
// client expects JSON.

/** Every path `do_GET` + `STATE_ROUTES` answered — 20. */
const REF_GET = ['/api/activity', '/api/activity/', '/api/catalog/', '/api/diff', '/api/docs',
  '/api/docs/page/', '/api/doctor', '/api/excludes', '/api/graph', '/api/installs', '/api/item/',
  '/api/jobs', '/api/jobs/', '/api/mcp', '/api/overview', '/api/ping', '/api/profile',
  '/api/rules', '/api/setup', '/api/themes'];

/** Every path `_post_routes` answered — 14. */
const REF_POST = ['/api/actions/', '/api/activity', '/api/excludes', '/api/install', '/api/jobs/',
  '/api/mcp', '/api/memory/delete', '/api/pick-folder', '/api/profile', '/api/restart',
  '/api/rules', '/api/rules/promote', '/api/shutdown', '/api/view'];

/**
 * The POST paths whose send carried a `200 if … else 409` conditional.
 *
 * `/api/activity` and `/api/memory/delete` are deliberately NOT here: their write is sent at 200
 * whatever `ok` says. A port that unified the rule is caught by four recorded cells — but only in
 * one direction. The reverse mutation, giving `/api/activity` the 409 treatment, is INVISIBLE to
 * every cell: each toggle a cell can perform SUCCEEDS, and the failing arm needs the flag write
 * to raise, which the two runtimes word differently and no byte comparison can hold.
 */
const REF_409 = ['/api/excludes', '/api/install', '/api/mcp', '/api/profile', '/api/rules',
  '/api/rules/promote', '/api/view'];

/** Every kind `api_docs_page` dispatched on — 5. */
const REF_KINDS = ['about', 'cli', 'concept', 'glossary', 'markdown'];

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
// THE PARTITION HALF

const nodeGet = () => [...Object.keys(STATE_ROUTES), ...PREFIX_ROUTES.map((r) => r[0]),
  ...PORTED_INLINE];
const nodeUnportedGet = () => [...NOT_PORTED, ...NOT_PORTED_PREFIXES];
const nodeUnportedPost = () => [...NOT_PORTED_POST, ...NOT_PORTED_POST_PREFIXES];

test('every GET route is either ported or declared unported', () => {
  // THREE PARTS, and the third is `GET_BEYOND_REF` — the GET half of the argument
  // `POST_BEYOND_REF` makes below. `REF_GET` is a RECORD of what the Python daemon answered,
  // so it is not the thing to widen when this daemon grows a route; widening it would forge
  // the record, and leaving the equality unqualified would say this daemon may never grow a
  // GET at all. The comparison is therefore against the reference's surface PLUS the declared
  // additions: the reference's routes stay pinned exactly, and anything past them has to be
  // enumerated rather than merely appear.
  const covered = new Set([...nodeGet(), ...nodeUnportedGet()]);
  assert.deepEqual(REF_GET.filter((p) => !covered.has(p)), [],
    'the reference answered GET paths the daemon neither ports nor declares unported — each '
    + 'falls through to the SPA and answers HTML at a 200 where the client expects JSON');
  assert.deepEqual(sorted([...covered].filter((p) => !REF_GET.includes(p)
    && !GET_BEYOND_REF.has(p))), [],
  'the daemon claims GET paths the reference did not answer and does not declare as additions');
  // AND NO ADDITION MAY HIDE A REFERENCE ROUTE — the same guard the POST side carries. Moving a
  // path the reference really did answer into `GET_BEYOND_REF` would keep the check above green
  // while quietly deleting the claim that the path is ported; the set is for routes with NO
  // reference, only.
  assert.deepEqual(sorted([...GET_BEYOND_REF].filter((p) => REF_GET.includes(p))), [],
    'a route the reference answered was declared as a post-port addition');
  // Every declared addition must actually be dispatched — a declaration is not a dispatcher.
  assert.deepEqual(sorted([...GET_BEYOND_REF].filter((p) => !covered.has(p))), [],
    'a GET declared beyond the reference is not in any dispatch table');
});

test('every POST route is either ported or declared unported', () => {
  // FOUR PARTS, NOT TWO, and the third is the point: `DECLINED_POST` is a route that will never
  // cross, which is a different claim from `NOT_PORTED_POST`'s "not yet". Folding them would make
  // the to-do list wrong in the one direction nobody checks — a later phase emptying it would
  // have to either port a GUI folder dialog or quietly delete a row.
  //
  // The FIFTH is `PORTED_POST_INLINE`, a declaration rather than a hardcoded set: three POST
  // routes dispatch outside `POST_ROUTES` because that table's second column is the 409
  // convention and none of them answers on `ok` — the shell's own `/api/shutdown` and
  // `/api/restart`, and the job prefixes, which answer 202/409/404/501/400/200.
  // The SIXTH is `POST_BEYOND_REF` — routes that never existed on the reference. `REF_POST` is a
  // RECORD of what the Python daemon answered, so it is not the thing to widen when this daemon
  // grows a route; widening it would forge the record. The equality below therefore compares the
  // covered set against the reference's surface PLUS the declared additions, which keeps both
  // halves checkable: the reference's routes stay pinned exactly, and anything past them has to
  // be enumerated rather than merely appear.
  const covered = new Set([...PORTED_POST_INLINE, ...PORTED_POST, ...DECLINED_POST,
    ...POST_BEYOND_REF, ...nodeUnportedPost()]);
  assert.deepEqual(sorted(covered), sorted([...REF_POST, ...POST_BEYOND_REF]),
    'the POST partition has drifted from the routes the reference answered plus the declared '
    + 'post-port additions');
  // AND NO ADDITION MAY HIDE A REFERENCE ROUTE. Without this, moving a path the reference really
  // did answer into `POST_BEYOND_REF` would keep the equality above green while quietly deleting
  // the claim that the path is ported — the set is for routes with NO reference, only.
  assert.deepEqual(sorted([...POST_BEYOND_REF].filter((p) => REF_POST.includes(p))), [],
    'a route the reference answered was declared as a post-port addition');
  const inter = (a, b) => sorted([...a].filter((p) => [...b].includes(p)));
  assert.deepEqual(inter(PORTED_POST, nodeUnportedPost()), []);
  assert.deepEqual(inter(PORTED_POST, DECLINED_POST), []);
  assert.deepEqual(inter(nodeUnportedPost(), DECLINED_POST), []);
  assert.deepEqual(inter(POST_BEYOND_REF, DECLINED_POST), []);
  assert.deepEqual(inter(POST_BEYOND_REF, nodeUnportedPost()), []);
});

test('the declared partition is the one the dispatcher uses', async () => {
  // ⚠ LIMITS ROW 3. THE ASSERTION THE TWO TESTS ABOVE CANNOT MAKE, and a mutation is why it
  // exists. Both of them read the exported SETS. Collapsing `NOT_PORTED_POST` back into
  // `NOT_PORTED` — one line, and the whole reason two lists exist — leaves every set exactly as
  // declared and both tests green, while a GET to a POST-only declaration starts answering 501
  // instead of falling through to the SPA. A gate on a declaration cannot see it.
  //
  // So this drives the REAL handler: one probe per branch, each naming the status the dispatcher
  // must actually produce. No recorded cell can ask it — a cell compares two implementations, and
  // none may hold a 501 against the reference's real body.
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
      'a ported GET must answer — the control, without which every refusal below is vacuous');
    // `NOT_PORTED` is empty since P6g crossed `/api/jobs`, so there is no unported GET left to
    // ask for a 501. The set stays declared and the partition test above keeps it honest.
    assert.equal(await hit('GET', '/api/jobs'), 200, 'GET /api/jobs crossed in P6g');
    // THE `GET_BEYOND_REF` PROBE. `/api/recent` has no reference body to be held to, so this
    // dispatch check is the only gate that it is wired at all: a 200 means the declaration and
    // the table agree, and anything else — an HTML 200 from the SPA fallback included — means
    // the route is declared and not dispatched. (The SPA fallback cannot answer 200 here: this
    // probe's dist root is 'nowhere', so a fall-through is a 404.)
    assert.equal(await hit('GET', '/api/recent'), 200,
      'GET /api/recent must answer — GET_BEYOND_REF declares it, so a 404 means the '
      + 'declaration is not dispatched on');
    assert.equal(await hit('POST', '/api/excludes', 'tok'), 409,
      'a ported POST must answer, and an empty body is the 409 arm of the convention — the '
      + 'control for the refusals below');
    // `NOT_PORTED_POST` is empty too. What replaces its probe is the OPPOSITE assertion over the
    // same path: an empty body reaches the endpoint, misses the (host, path) allowlist and raises
    // NotFound, which the outer catch answers 404. A 501 here means the row went back.
    assert.equal(await hit('POST', '/api/install', 'tok'), 404,
      'POST /api/install crossed: an empty body names no install, so it must reach the endpoint '
      + 'and raise NotFound — a 501 means the row is declared unported again');
    // THE ROW-3 PAIR used to live here, against `/api/pick-folder` while `DECLINED_POST` still
    // had a member. It crossed 2026-08-27 (a user override — see `js/web/routes.mjs`) and
    // `DECLINED_POST` is empty now, so there is nothing left in this partition to probe that
    // way. It is not replaced with a live hit on `/api/pick-folder` either: unlike
    // `/api/install` above (which safely 404s on an empty body), pick-folder takes NO client
    // input at all and spawns a REAL OS folder dialog on every hit regardless of body — the
    // same reason `/api/restart` and `/api/reveal`'s success arm below are never driven. Its
    // dispatch and non-desktop error path are covered by a dedicated unit test instead, one
    // that overrides `process.platform` rather than hitting a live server.
    // THE `POST_BEYOND_REF` PAIR. `/api/reveal` is the first route with no reference at all, so
    // there is no recorded body to hold it to and this dispatch probe is the only gate on it.
    //
    // ONLY THE REFUSAL ARM IS PROBED, for `/api/restart`'s reason one door over: the success arm
    // calls `openUrl`, which asks the DESKTOP to open a folder, and a suite that took it would
    // pop a file-manager window on the developer's machine (and on a CI runner, spawn an opener
    // that is not there). An empty body names no path, so it misses the allowlist and must 404 —
    // which is the interesting half anyway: 501 means the route is declared but not dispatched,
    // and 200 would mean the allowlist is not consulted before something is opened.
    assert.equal(await hit('POST', '/api/reveal', 'tok'), 404,
      'POST /api/reveal must reach its allowlist and refuse — 501 means POST_BEYOND_REF is '
      + 'declared but not dispatched, 200 means nothing checks the path before opening it');
    assert.notEqual(await hit('GET', '/api/reveal'), 501,
      'GET /api/reveal must fall through to the SPA, like every other POST-only declaration');
    // A REAL action and an INVENTED one. With `NOT_PORTED_ACTIONS` empty, "no real action gets
    // the 404 a typo gets" is a statement about the whole table, and
    // `tests/unit/web_jobs.test.mjs` is what proves it for every row at once.
    assert.equal(await hit('POST', '/api/actions/update', 'tok'), 422,
      'POST /api/actions/update is gated on preflight: 501 means it is declared unported again, '
      + '404 means it fell through to the table, and 202 means the preflight was SKIPPED and a '
      + 'real git pull just started');
    assert.equal(await hit('POST', '/api/actions/nope', 'tok'), 404,
      'an action the table does not name gets the reference\'s own 404');
    assert.equal(await hit('POST', '/api/actions/restore', 'tok', '{"files": []}'), 200,
      'POST /api/actions/restore is synchronous and answers 200 — the control for the refusals');
    assert.equal(await hit('GET', '/api/docs'), 200);
    assert.equal(await hit('GET', '/api/docs/page/glossary'), 200);
    assert.equal(await hit('GET', '/api/docs/page/cli'), 200,
      'the `cli` kind crossed in P10c — 501 means it is back in NOT_PORTED_KINDS, 404 means '
      + 'KIND_ROUTES has no row for it');
    assert.equal(await hit('GET', '/api/docs/page/about'), 200,
      'the `about` kind crossed in P8c — it runs `git remote get-url` through originDisplay(), '
      + 'so this is also the probe that says the docs tree may reach the module the spawn '
      + 'allow-list declares');
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
  // THE COLUMN NO CELL CAN GATE. `POST_ROUTES` is the DISPATCH, so this is not a gate on a
  // declaration — it is a gate on the table `doPost` looks up. See `REF_409` for why the reverse
  // mutation is the invisible one.
  assert.deepEqual(sorted(Object.keys(POST_ROUTES_CONVENTION)), sorted(PORTED_POST),
    'the convention column must name every ported POST and no other');
  assert.deepEqual(sorted(Object.entries(POST_ROUTES_CONVENTION)
    .filter(([, on]) => on).map(([p]) => p)),
  sorted(REF_409.filter((p) => PORTED_POST.includes(p))),
  'the 409 column has drifted from the reference\'s own conditionals — /api/activity and '
    + '/api/memory/delete answer 200 whatever `ok` says and the others do not, and no cell can '
    + 'gate the difference');
});

test('every docs kind is either ported or declared unported', () => {
  // The route partition, one level in. `NOT_PORTED_KINDS` is empty since P10c crossed `cli`, so
  // this says every kind the reference dispatched on is answered — and a SIXTH kind added to the
  // port still cannot quietly answer "page not found".
  assert.deepEqual(sorted([...PORTED_KINDS, ...NOT_PORTED_KINDS]), sorted(REF_KINDS),
    'the docs kinds have drifted from the five the reference dispatched on');
  assert.deepEqual(PORTED_KINDS.filter((k) => [...NOT_PORTED_KINDS].includes(k)), []);
});

test('a ported route is never also declared unported', () => {
  assert.deepEqual(nodeGet().filter((p) => nodeUnportedGet().includes(p)), []);
  // The direction the GET partition cannot give: a POST-only declaration must never appear in the
  // GET table, or the GET dispatcher would 501 a path the SPA owns.
  assert.deepEqual(
    sorted([...nodeUnportedPost(), ...DECLINED_POST].filter((p) => nodeGet().includes(p))), [],
    'a POST declaration has leaked into the ported GET table');
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
