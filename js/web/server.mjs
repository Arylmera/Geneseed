/**
 * The web console's HTTP shell — `rituals/_web_server.py`'s handler, static route and
 * `serve()` entry. P6a: the shell and `/api/ping`, and nothing that answers a real
 * endpoint.
 *
 * WHY THE SHELL FIRST, AND ALONE. `_web_server.py` is 654 lines and none of it is an API
 * function: it is routing, two security guards, gzip negotiation, the static route with
 * its per-request token injection, and the daemon record. Every one of those is invisible
 * to a test that calls `api_X(state)` in process — which is how `tests/test_web.py`
 * reaches all 136 of its assertions — so the shell is both the part with no existing
 * coverage and the part every later sub-phase builds on. `tests/web_golden.py` is its
 * gate and was written before this file.
 *
 * THE SERIALISER, WHICH TOUCHES ALL 29 PATHS. `_send_json` is a bare `json.dumps(obj)`:
 * Python's DEFAULT separators, `(', ', ': ')`, and `ensure_ascii=True`. That is exactly
 * `jsonDumpsCompact` — whose name says "compact" meaning "no indent", not "no spaces";
 * read its body, it joins on `', '`. So the twin needs no new helper and the response
 * bodies stay byte-comparable.
 *
 * Its one condition is the int/float distinction. `pyStr` refuses a BARE JS number
 * because `json.loads` tells `20` from `1.0` and `JSON.parse` does not — but the numbers
 * in a response body are not parsed from JSON, they are computed here (counts, a port, a
 * pid, a unix second), and every one of them is a Python `int`, which renders identically
 * in both languages. `bareInts` says that out loud rather than wrapping several dozen
 * call sites in a factory. A Python float would be the counter-example — `1.0` against
 * JS's `1` — and the byte gate over every endpoint body is what would catch one.
 *
 * P6h FINISHED IT, and the file grew a second half rather than a second module. The
 * reference keeps the handler and the daemon lifecycle in ONE file under a
 * `# ---- daemon mode` banner, and splitting them here would have made `serve()` (which
 * needs `npmBuild`) and the launcher (which needs `readDaemon`) import each other. So
 * `_probe`, `_live_daemon`, `_spawn_detached`, `start|stop|status|restart_daemon`,
 * `_npm_build` and `cmd_web` all live below, and `bin/geneseed-cli.mjs` is finally a
 * caller — which is what put this tree on the CLI's import graph and moved
 * `js/web/jobs.mjs`'s spawn row to `entry: "cli"`.
 *
 * WHAT IS STILL NOT HERE, SINCE P6i: `/api/pick-folder` alone, and it is DECLINED rather than
 * deferred — an OS-native folder chooser has no Node twin that is not a new GUI dependency.
 * `NOT_PORTED_POST` is empty and stays declared, because an empty half of a partition is the
 * partition asserting there is nothing left; `DECLINED_POST` is what still has a member.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  existsSync, readFileSync, statSync, unlinkSync, chmodSync, mkdirSync, openSync,
} from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { join, resolve as pathResolve, dirname, extname, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { GLOBAL_MANIFEST, pyResolve } from '../hosts.mjs';
import {
  jsonDumpsCompact, parseJson, pyInt, pyPrint, pyStr, pyTruthy, pyUnquote, pyWhich, writeText,
} from '../lib/fs.mjs';
import { promptLine } from '../setup.mjs';
// P8c. The reference imports `_update` LAZILY inside the handler, to keep `build` and its
// `sys.path` side effect out of web-import time; ESM has no such side effect and the import is
// static. `js/update.mjs` imports `restartDaemon` from THIS module, so the two form a cycle —
// which resolves because everything either side needs of the other is a hoisted function
// declaration, not a value read at module-evaluation time.
import { preflight } from '../update.mjs';
import { doctrinesForBuild } from '../installs.mjs';
import { NotFound, PREFIX_ROUTES, STATE_ROUTES, webState } from './api.mjs';
import {
  apiDeployCmd, apiExcludesMutate, apiInstallCmd, apiInstallToggle, apiMcpToggle,
  apiMemoryDelete, apiProfileSave,
  apiRestore, apiRulesMutate, apiRulesPromote, apiSelectView, buildOverride, mcpTargetPaths,
} from './actions.mjs';
import { apiActivityToggle } from './activity.mjs';
import { apiDocs, apiDocsPage } from './docs.mjs';
import { JobManager, NOT_PORTED_ACTIONS, actionCommands } from './jobs.mjs';

export { webState };

const ROOT = pathResolve(fileURLToPath(import.meta.url), '..', '..', '..');

/**
 * DNS-rebinding guard. The reference's own comment carries the why; the shape is the
 * part a port gets wrong. `h.split(":", 1)[0]` keeps everything before the FIRST colon,
 * so `localhost:4747` passes and a bare IPv6 literal would not — which is what the
 * `[::1]` prefix test above it is for.
 */
export function localHost(host) {
  const h = (host || '').trim().toLowerCase();
  if (h.startsWith('[::1]')) return true;
  return ['127.0.0.1', 'localhost'].includes(h.split(':', 1)[0]);
}

const GZIP_TYPES = ['application/json', 'text/', 'image/svg+xml',
  'application/manifest+json', 'application/javascript'];
const GZIP_MIN = 1024;

const CTYPES = {
  '.html': 'text/html', '.js': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
};

/**
 * The API paths this phase does not answer yet.
 *
 * Without it every one of them would fall through to `serveStatic`, which answers ANY
 * unknown path with index.html and a 200 — the SPA fallback. An unported endpoint would
 * therefore return a plausible HTML page instead of failing, and the first cell written
 * against it in P6b would be the thing that discovered the route was missing. A 501
 * naming the phase costs one lookup and cannot be mistaken for a working endpoint.
 *
 * It shrank to empty in P6g and the DECLARATION STAYS. Every GET the reference answers is now
 * answered here, so the two sets hold nothing — but they are half of a partition
 * (`test_every_get_route_is_either_ported_or_declared_unported`), and deleting them would let
 * the next GET route added to the reference fall through to the SPA with nothing to say so.
 * An empty declaration is the partition asserting that there is nothing left to declare.
 */
/**
 * SPLIT BY VERB SINCE P6b, and the split is the point rather than a tidy-up. Five paths
 * answer BOTH verbs with different bodies — `/api/mcp`, `/api/excludes`, `/api/rules`,
 * `/api/profile`, `/api/activity` — and P6b ports the GET half of two of them. One set
 * keyed on path alone would have taken `/api/excludes` out of the unported list the
 * moment its GET landed, and its POST would then have answered `{"error": "not found"}`
 * with a 404: a plausible-looking response where the reference returns 200 or 409, which
 * is exactly the failure the 501 exists to prevent.
 */
/** EMPTY SINCE P6g — every GET the reference answers is answered here. */
export const NOT_PORTED = new Set([]);
export const NOT_PORTED_PREFIXES = [];

/**
 * The POSTs that have not crossed YET — and EMPTY SINCE P6i, which took `/api/install`.
 *
 * IT STAYS DECLARED, for the same reason the GET pair above stays and the prefix lists have
 * stayed since P6g: this set is half of a partition
 * (`test_every_post_route_is_either_ported_or_declared_unported`), so an empty set is the
 * partition ASSERTING that there is nothing left to declare. Delete it and the next POST route
 * added to the reference falls through to `{"error": "not found"}` at 404 — a plausible-looking
 * answer where the reference returns 200 or 409 — with nothing to say so.
 *
 * THE DISPATCHER PROBE NEEDS A TARGET, which an empty set no longer supplies.
 * `tests/test_web_server.py` retired its `unportedGet` probe when `NOT_PORTED` emptied in P6g;
 * `unportedPost` is retired here for the same reason, and `declinedPost` (`/api/pick-folder`,
 * which never crosses) is what keeps the 501 arm of the dispatcher under a live probe.
 */
export const NOT_PORTED_POST = new Set([]);
export const NOT_PORTED_POST_PREFIXES = [];

/**
 * The POSTs that will NEVER cross, which is a different claim from the set above.
 *
 * `/api/pick-folder` opens an OS-NATIVE folder chooser on the daemon host — `osascript` on
 * macOS, a one-shot `tkinter` subprocess elsewhere. There is no Node twin that is not a new
 * GUI dependency, and reaching for one would also be a sixth `_ALLOWED_SPAWNS` row for a
 * modal dialog. The UI already falls back to its editable path field when this endpoint
 * fails, which is what a 501 gives it.
 *
 * SEPARATE FROM `NOT_PORTED_POST` ON PURPOSE. That set is a to-do list every later phase
 * shrinks, and folding a permanent decline into it would make the list wrong in the one
 * direction nobody checks: a phase that emptied it would have to either port a GUI dialog
 * or quietly delete a declaration. Both sets are unioned into the partition the reference's
 * routes are cross-checked against, so neither can drift.
 */
export const DECLINED_POST = new Set([
  '/api/pick-folder',
]);

/**
 * The POSTs P6f answers — and this table IS the dispatch, not a declaration beside it.
 *
 * M23's lesson, applied one verb over: `test_the_declared_partition_is_the_one_the_dispatcher_uses`
 * exists because a hand-kept list can agree with the reference while the running handler
 * does something else. `doPost` looks routes up HERE, and `PORTED_POST` is this table's own
 * keys, so the two cannot drift — the same reason `STATE_ROUTES` is a table on the GET side.
 *
 * THE SECOND COLUMN IS THE 409 CONVENTION, and it is a column because it is not uniform.
 * `ok: false` means the write did not happen — a stale fingerprint, a body that never
 * parsed, nothing to remove — and the client must re-fetch rather than retry, which is what
 * 409 says and 200 does not. Five routes map it. `/api/activity` does NOT: its flag write
 * answers 200 whatever `ok` says, and a port that unified the rule would be wrong exactly
 * there. `/api/memory/delete` carries no `ok` at all — it deletes, or it raises `NotFound`
 * and the outer catch answers 404 — so it is `false` here for a third reason again.
 *
 * `NotFound` IS NOT CAUGHT PER ROUTE. The reference wraps six of these calls in their own
 * `except NotFound` AND wraps the whole of `_post_routes` in another inside `do_POST`. The
 * inner six are redundant — every one produces the same `{"error": "not found: …"}` at 404
 * — so the twin keeps the outer one only, in `handler`, where `do_POST`'s is.
 */
const POST_ROUTES = new Map([
  ['/api/mcp', [apiMcpToggle, true]],
  // P6i. `_post_routes` wraps this one in its own `except NotFound` and then maps
  // `ok: false` to 409 — the same shape as `/api/mcp` beside it, so it fits the table's
  // second column exactly and needs no third inline dispatch. The inner catch is redundant
  // (see this table's docblock); `handler`'s outer one answers identically.
  ['/api/install', [apiInstallToggle, true]],
  ['/api/excludes', [apiExcludesMutate, true]],
  ['/api/view', [apiSelectView, true]],
  ['/api/activity', [apiActivityToggle, false]],
  // `(self._read_json_body().get("name") or "")` — the SHELL resolves the name, and the
  // endpoint takes a bare slug rather than a body.
  ['/api/memory/delete',
    [(state, b) => apiMemoryDelete(state, pyTruthy(b.name) ? pyStr(b.name) : ''), false]],
  ['/api/rules', [apiRulesMutate, true]],
  ['/api/rules/promote', [apiRulesPromote, true]],
  ['/api/profile', [apiProfileSave, true]],
]);

export const PORTED_POST = [...POST_ROUTES.keys()];

/**
 * The 409 column, exported so it can be cross-checked against the reference's own `200 if
 * res.get("ok") else 409` conditionals by `ast`.
 *
 * A MUTATION IS WHY THIS EXISTS. Giving `/api/activity` the 409 treatment survived the whole
 * cell matrix: every toggle a cell can perform succeeds, and reaching the `ok: false` arm
 * needs the flag write to raise — which the two runtimes word differently, so no byte
 * comparison could hold it. The column is the thing under test and no cell can see it, so
 * the gate reads it out of both implementations instead.
 */
export const POST_ROUTES_CONVENTION = Object.fromEntries(
  [...POST_ROUTES].map(([p, [, okIs409]]) => [p, okIs409]),
);

/**
 * The GET paths the dispatcher answers OUTSIDE the two tables, declared so the partition
 * cross-check can see them: `/api/ping` is the shell's own, and the two Docs routes take
 * the `?harness=` query param, which a `(state)` table entry has no way to receive.
 *
 * A declaration is not a dispatcher — M23 — so
 * `test_the_declared_partition_is_the_one_the_dispatcher_uses` probes all three against
 * the running handler as well.
 */
export const PORTED_INLINE = ['/api/ping', '/api/docs', '/api/docs/page/',
  '/api/jobs', '/api/jobs/'];

/**
 * The POSTs P6g answers outside `POST_ROUTES`, and they are outside it for a reason the
 * table's SECOND COLUMN makes plain.
 *
 * `POST_ROUTES` maps a route to `(fn, okIs409)` — one handler taking `(state, body)`, one
 * boolean deciding 200 against 409. The jobs routes fit neither half. `/api/jobs/<id>/cancel`
 * answers 200 or 404 on a lookup, not on an `ok` field; `/api/actions/<x>` answers 202 with a
 * job id, 409 when the runner is busy, 404 for an action the table does not name, 501 for one
 * that has not crossed, 400 or 409 for a resolver's refusal, and 200 for `restore` — six
 * statuses over one prefix, none of them read off `ok`. Bending the column to fit would make
 * it lie about the five routes it currently describes exactly, so these dispatch beside the
 * table and `tests/test_web_jobs.py` reads them out of `PORTED_POST_INLINE` instead.
 */
export const PORTED_POST_INLINE = ['/api/shutdown', '/api/restart', '/api/jobs/',
  '/api/actions/'];

/**
 * POST routes THAT NEVER EXISTED ON THE REFERENCE — the first of them, and the reason this set
 * has to exist at all.
 *
 * `test_every_post_route_is_either_ported_or_declared_unported` asserts SET EQUALITY against
 * `REF_POST`, a frozen literal of the paths the Python daemon answered. That was exactly right
 * while the port was in flight: a route on one side and not the other was a defect either way.
 * The port is finished and the reference is deleted, so the assertion now says something else —
 * "this daemon may never grow a route" — which is a rule nobody chose.
 *
 * SO THE PARTITION GAINS A FOURTH PART RATHER THAN LOSING ITS EQUALITY. Widening `REF_POST` would
 * have been the cheap edit and it would have been a lie: that list is a RECORD of what the
 * reference answered, and a route added in 2026 was never in it. Keeping the record honest and
 * declaring the additions beside it keeps both claims checkable — the reference's surface is
 * still pinned, and everything past it is enumerated here instead of merely appearing.
 *
 * A route belongs here only once it is dispatched below; the dispatcher probe is what keeps this
 * from becoming a declaration nobody honours.
 */
export const POST_BEYOND_REF = new Set([
  '/api/reveal',
]);

function notPorted(path) {
  return NOT_PORTED.has(path) || NOT_PORTED_PREFIXES.some((p) => path.startsWith(p));
}

function notPortedPost(path) {
  return NOT_PORTED_POST.has(path) || DECLINED_POST.has(path)
    || NOT_PORTED_POST_PREFIXES.some((p) => path.startsWith(p));
}

/**
 * `Handler._read_json_body` — the drained body as a dict, `{}` for ANYTHING else.
 *
 * P6a retained the drain with a note that it was measured indistinguishable and stayed
 * because "`_read_json_body` needs the bytes from P6f on". This is that caller.
 *
 * `{}` AND NEVER A RAISE is the contract, and it is what makes a malformed body a 409 or a
 * 404 from the endpoint's own validation rather than a 500 from a parser. That matters
 * beyond tidiness: P5a's one un-portable line is a `json` error message, because CPython
 * and V8 word them differently AND report different offsets — so a 500 carrying a parse
 * error is a response the two implementations can never agree on.
 *
 * `parseJson`, not `JSON.parse`: a body value can be written straight into a user's file
 * (`api_profile_save`'s `text`, `api_rules_mutate`'s `title`) and `str(1.0)` is `"1.0"`
 * where `String(1)` is `"1"`. A non-object body — a bare list, a number, `null` — takes the
 * same `{}` arm as garbage, because `isinstance(obj, dict)` is what the reference asks.
 */
function readJsonBody(buf) {
  let obj;
  try {
    obj = parseJson((buf && buf.length ? buf : Buffer.from('{}')).toString('utf-8'));
  } catch {
    return {};
  }
  return (obj !== null && typeof obj === 'object' && obj.constructor === Object) ? obj : {};
}

// ---- the request handler ---------------------------------------------------

/**
 * `make_handler(state, jm, token, dist, holder)` — `jm` is the SECOND argument here as it is
 * there. P6a shipped this without it because there was no `JobManager` to pass; every caller
 * moved in the same commit that added one.
 */
export function makeHandler(state, jm, token, dist, holder = null) {
  const staticCache = new Map();

  function sendBytes(res, body, ctype, code = 200, extra = null, acceptEncoding = '') {
    const headers = { ...(extra || {}) };
    if (body.length >= GZIP_MIN && GZIP_TYPES.some((t) => ctype.startsWith(t))
        && (acceptEncoding || '').includes('gzip')) {
      body = gzipSync(body, { level: 6 });
      headers['Content-Encoding'] = 'gzip';
      headers.Vary = 'Accept-Encoding';
    }
    res.writeHead(code, {
      'Content-Type': ctype,
      'Content-Length': String(body.length),
      ...headers,
    });
    res.end(body);
  }

  function sendJson(res, obj, code = 200, acceptEncoding = '') {
    sendBytes(res, Buffer.from(jsonDumpsCompact(obj, { bareInts: true }), 'utf-8'),
      'application/json', code, null, acceptEncoding);
  }

  function serveStatic(res, path, acceptEncoding) {
    const rel = (path === '/' || path === '') ? 'index.html' : path.replace(/^\/+/, '');
    const index = pyResolve(join(dist, 'index.html'));
    let fp = pyResolve(join(dist, rel));
    // `dist not in fp.parents`: STRICTLY under dist. `Path.parents` never contains the
    // path itself, so `fp == dist` takes the fallback too.
    if (!(fp.startsWith(dist + sep) && fp !== dist) && fp !== index) fp = join(dist, 'index.html');
    if (!isFile(fp)) fp = join(dist, 'index.html');
    if (!isFile(fp)) {
      return sendJson(res, { error: 'web/dist missing — run the UI build' }, 500, acceptEncoding);
    }
    let data = staticCache.get(fp);
    if (data === undefined) {
      data = readFileSync(fp);
      staticCache.set(fp, data);
    }
    let extra = null;
    if (basename(fp) === 'index.html') {
      const inject = Buffer.from(`<script>window.__GENESEED_TOKEN__="${token}";</script>`, 'utf-8');
      data = replaceOnce(data, Buffer.from('</head>'), Buffer.concat([inject, Buffer.from('</head>')]));
      extra = { 'Cache-Control': 'no-store' };
    } else if (path.includes('/assets/')) {
      extra = { 'Cache-Control': 'public, max-age=31536000, immutable' };
    }
    return sendBytes(res, data, CTYPES[extname(fp)] || 'application/octet-stream',
      200, extra, acceptEncoding);
  }

  function doGet(req, res, path, ae) {
    // The reference's own table first, then the routes that parse the path — and `ping`
    // sits between them there too, so the order here is its order.
    const route = STATE_ROUTES[path];
    if (route !== undefined) return sendJson(res, route(state), 200, ae);
    if (path === '/api/ping') return sendJson(res, { ok: true, theme: state.theme }, 200, ae);
    for (const [prefix, handler] of PREFIX_ROUTES) {
      if (path.startsWith(prefix)) return sendJson(res, handler(state, path), 200, ae);
    }
    if (path === '/api/docs') {
      return sendJson(res, apiDocs(state, harnessParam(req.url)), 200, ae);
    }
    if (path.startsWith('/api/docs/page/')) {
      const pid = pyUnquote(path.slice('/api/docs/page/'.length));
      try {
        return sendJson(res, apiDocsPage(state, pid, harnessParam(req.url)), 200, ae);
      } catch (e) {
        // A kind P6d does not answer says so, rather than falling through to the
        // `NotFound` at the bottom of `apiDocsPage` and claiming the page is missing.
        if (e && e.notPorted) return sendJson(res, { error: e.message }, 501, ae);
        throw e;
      }
    }
    if (path === '/api/jobs') return sendJson(res, { jobs: jm.recent() }, 200, ae);
    if (path.startsWith('/api/jobs/')) {
      // `path.rsplit("/", 1)[1]` — the LAST segment, so `/api/jobs/a/b` looks up `b` and
      // misses, rather than 404ing on the shape.
      const j = jm.get(path.slice(path.lastIndexOf('/') + 1));
      return j ? sendJson(res, j, 200, ae)
        : sendJson(res, { error: 'no such job' }, 404, ae);
    }
    if (notPorted(path)) {
      return sendJson(res, { error: `not ported yet: ${path}` }, 501, ae);
    }
    return serveStatic(res, path, ae);
  }

  function doPost(req, res, path, ae, body) {
    if (!localHost(req.headers.host)) {
      return sendJson(res, { error: 'forbidden host' }, 403, ae);
    }
    if (req.headers['x-geneseed-token'] !== token) {
      return sendJson(res, { error: 'forbidden' }, 403, ae);
    }
    if (path === '/api/shutdown') {
      // The one POST route the SHELL owns. It must answer BEFORE it stops, which is why
      // the reference runs `srv.shutdown()` on its own thread — called inline it would
      // deadlock against `serve_forever`. Here the equivalent is closing after the
      // response has flushed. `closeAllConnections` is the other half: `close()` alone
      // waits for idle keep-alive sockets, and the client that just sent this request is
      // holding one open. The reference drops them by exiting.
      res.on('finish', () => {
        holder.srv.close();
        holder.srv.closeAllConnections();
      });
      return sendJson(res, { stopping: true }, 200, ae);
    }
    if (path === '/api/restart') {
      // THE ONE ROUTE IN THIS FILE NO TEST MAY REACH, and it is declared rather than probed.
      // `requestRestart` spawns a DETACHED `web restart`, which stops whatever daemon the
      // record names and starts a fresh one that outlives the caller. Every way of asking it
      // a question runs it: `tests/web_golden.py` would have its own server stopped and a
      // replacement orphaned into a sandbox about to be deleted, and
      // `tests/test_web_server.py`'s dispatcher probe runs in the DEVELOPER'S environment,
      // where the replacement would bind 4747 and serve the checkout forever. That is the
      // same reasoning P6g used to ban a job cell that starts real work, one step further:
      // there the child was merely orphaned, here it is a second daemon.
      //
      // So the gate is `tests/test_web_daemon.py`, which reads both implementations and
      // asserts they dispatch this path to `request_restart(state.theme)` and answer the
      // same body. Rule 7 says a declaration is not a dispatcher — this is the one route
      // where probing the dispatcher costs more than the assurance is worth, and saying so
      // beats a silently missing probe.
      requestRestart(state.theme);
      return sendJson(res, { restarting: true }, 200, ae);
    }
    if (path === '/api/reveal') {
      // "It asks for a token and a URL and I don't know where to put them." The screen already
      // PRINTS the config path above each target's rows; what it could not do is take you there.
      //
      // THE ALLOWLIST IS THE WHOLE SECURITY OF THIS ENDPOINT, same as the toggle beside it, and
      // it is the same allowlist — `mcpTargetPaths()`, one function with two callers rather than
      // two copies that drift. An unlisted path is a 404 before anything is opened. Without it
      // this is "ask the desktop to open any path on the machine", behind a CSRF token and
      // nothing else, and on Windows `openUrl` interpolates into a `cmd` command line with
      // `windowsVerbatimArguments` — so the exact-match lookup is also what bounds the strings
      // that can ever reach a shell to the ones the machine's own install registry produced.
      //
      // THE FOLDER, NOT THE FILE. `open`/`start`/`xdg-open` on a `.json` hands it to whatever
      // claims that extension — which on a stock Windows box is a browser, i.e. a read-only view
      // of the exact file the user is trying to EDIT. The containing folder lands in Explorer /
      // Finder / the file manager every time, and the filename is already on screen beside the
      // button.
      const want = String(readJsonBody(body).path ?? '');
      if (!mcpTargetPaths().has(want)) {
        return sendJson(res, { error: `not found: ${want || '(none)'}` }, 404, ae);
      }
      const dir = dirname(want);
      // `openUrl` SWALLOWS EVERY FAILURE BY DESIGN (a headless box has no opener), so `ok` here
      // means "the path was allowed and the request was made", never "a window appeared". The
      // response says which directory, so the UI can print it as the fallback instruction.
      openUrl(dir);
      return sendJson(res, { ok: true, dir }, 200, ae);
    }
    const route = POST_ROUTES.get(path);
    if (route !== undefined) {
      const [fn, okIs409] = route;
      const obj = fn(state, readJsonBody(body));
      return sendJson(res, obj, (okIs409 && !pyTruthy(obj.ok)) ? 409 : 200, ae);
    }
    if (path.startsWith('/api/jobs/') && path.endsWith('/cancel')) {
      // `path.split("/")[3]`, positional — so `/api/jobs/<id>/cancel` takes `<id>` and a
      // deeper path takes its third segment, which is what the reference looks up.
      const jid = path.split('/')[3];
      return jm.cancel(jid) ? sendJson(res, { cancelled: jid }, 200, ae)
        : sendJson(res, { error: 'no running job by that id' }, 404, ae);
    }
    if (path.startsWith('/api/actions/')) {
      return doAction(res, path.slice(path.lastIndexOf('/') + 1), readJsonBody(body), ae);
    }
    if (notPortedPost(path)) {
      return sendJson(res, { error: `not ported yet: ${path}` }, 501, ae);
    }
    return sendJson(res, { error: 'not found' }, 404, ae);
  }

  /**
   * `/api/actions/<x>` — the reference's own order, which is the part a port gets wrong.
   *
   * `restore` is answered BEFORE anything else because it is synchronous and returns a result
   * rather than a job id. `install` and `deploy` resolve their argv from the body, and their
   * refusal statuses DIFFER — 409 for install (its target came from an allowlist, so a refusal
   * means the world changed under the client) and 400 for deploy (its path came from the body,
   * so a refusal means the body was wrong). That asymmetry is the reference's; a port that
   * unified them would be wrong on one of the two and no cell would say which.
   *
   * `update` COMES NEXT AND IS INLINE, since P8c: it is gated on a LOCAL-ONLY preflight before
   * a job is ever started, so a dirty tree or a zip-download install gets a friendly 422 the UI
   * renders as an info popup instead of a job that spawns and then fails. Its finish handler is
   * its own too — the child skips its own daemon bounce (`GENESEED_WEB_JOB`, set by `_run`), so
   * the restart happens HERE, after the job is saved as finished, and only when it succeeded: a
   * failed update changed nothing worth reloading and bouncing would disconnect the PWA for no
   * reason.
   *
   * THEN the unported rows, and only then the table. Order matters: `link`/`unlink` are REAL
   * actions whose verb has not crossed, and letting them fall through to `actionCommands` would
   * answer `{"error": "unknown action link"}` — the same thing a typo gets.
   */
  function doAction(res, action, body, ae) {
    if (action === 'restore') {
      return sendJson(res, apiRestore(state, pyTruthy(body.files) ? body.files : []), 200, ae);
    }
    if (action === 'install') {
      const plan = apiInstallCmd(state, body);
      if (Object.hasOwn(plan, 'error')) return sendJson(res, plan, 409, ae);
      return startJob(res, 'install', [plan.cmd], ae);
    }
    if (action === 'deploy') {
      const plan = apiDeployCmd(state, body);
      if (Object.hasOwn(plan, 'error')) return sendJson(res, plan, 400, ae);
      return startJob(res, 'deploy', [plan.cmd], ae);
    }
    if (action === 'update') {
      const pre = preflight();
      if (!pre.ok) {
        return sendJson(res,
          { precondition: pre.code, kind: pre.kind, message: pre.message }, 422, ae);
      }
      const jid = jm.start('update', actionCommands('update'), (rc) => {
        state.refresh();
        if (rc === 0) requestRestart(state.theme);
      });
      if (jid === null) return sendJson(res, { error: 'busy' }, 409, ae);
      return sendJson(res, { job_id: jid }, 202, ae);
    }
    if (NOT_PORTED_ACTIONS.has(action)) {
      return sendJson(res, { error: `not ported yet: /api/actions/${action}` }, 501, ae);
    }
    // Build can be re-themed/re-targeted from the UI picker; the other actions self-resolve
    // the deployed theme downstream. Footprint, posture and mode always follow the current
    // install, so a re-theme preserves lean/full, the register and the operating mode.
    const [theme, emit] = action === 'build'
      ? buildOverride(state, body) : [state.theme, state.emit];
    // The pack selection follows the install like footprint/posture/mode, and is read here
    // rather than left to the table's default: a console Build must re-emit the constitution
    // the deployment already carries. Unknown (no `Active packs:` marker) resolves to ALL
    // packs — never to `harness.config.json`, which would drop the consent gate.
    const cmds = actionCommands(action, {
      theme, emit, footprint: state.footprint, posture: state.posture, mode: state.mode,
      doctrines: doctrinesForBuild(state.target),
    });
    if (!pyTruthy(cmds)) {
      return sendJson(res, { error: `unknown action ${action}` }, 404, ae);
    }
    return startJob(res, action, cmds, ae);
  }

  /**
   * The 202/409 pair every job route ends in. `state.refresh()` on finish is not optional: a
   * Build may re-theme the install, and the re-detect must read the new `.geneseed-emit` or
   * the console keeps serving the old mode (the line P6b dropped and P6f restored).
   */
  function startJob(res, action, cmds, ae) {
    const jid = jm.start(action, cmds, () => state.refresh());
    if (jid === null) return sendJson(res, { error: 'busy' }, 409, ae);
    return sendJson(res, { job_id: jid }, 202, ae);
  }

  return function handler(req, res) {
    const ae = req.headers['accept-encoding'] || '';
    const path = (req.url || '').split('?', 1)[0];
    try {
      if (req.method === 'GET') {
        if (!localHost(req.headers.host)) {
          return sendJson(res, { error: 'forbidden host' }, 403, ae);
        }
        try {
          return doGet(req, res, path, ae);
        } catch (e) {
          // The `NotFound` → 404 convention, which P6c is the first phase to raise. It
          // wraps the ROUTE DISPATCH and not each handler, exactly as the reference's
          // `try` around `do_GET`'s body does — an endpoint several frames down raises and
          // the shell decides the status. Anything else is still the outer 500.
          if (e instanceof NotFound) {
            return sendJson(res, { error: `not found: ${e.message}` }, 404, ae);
          }
          throw e;
        }
      }
      if (req.method === 'POST') {
        // Drain the body BEFORE routing, as the reference does and for its stated
        // reason — under keep-alive an unread body is parsed as the next request line,
        // and both guards answer without ever reaching a route that would read it.
        //
        // THIS HALF OF IT IS INDISTINGUISHABLE HERE, and measured rather than assumed:
        // two mutations — reading zero bytes, then neither reading nor resuming the
        // stream — both survived the keep-alive cell, which the reference needs the
        // drain to pass. Node's HTTP parser owns the message boundary, so unread body
        // bytes are discarded when the response ends instead of being re-parsed. It
        // stays because `_read_json_body` needs the bytes from P6f on, and because a
        // shell whose two implementations diverged only under load would be the worst
        // kind of divergence to carry. UNREACHABLE is not the word for it: the branch
        // runs on every POST, it simply cannot be observed to matter on this runtime.
        const length = pyInt(String(req.headers['content-length'] ?? '')) ?? 0;
        return readBody(req, length, (buf) => {
          req._body = buf;
          try {
            return doPost(req, res, path, ae, buf);
          } catch (e) {
            // `do_POST`'s own two-armed catch, and P6f is the phase that needs the first
            // arm: `api_mcp_toggle`, `api_select_view`, `api_memory_delete`,
            // `api_rules_mutate` and `api_rules_promote` all raise `NotFound` for an
            // unknown target, and the reference answers 404. The 500 arm below it is what
            // carries `_rule_fields`' ValueError message, which is a 500 there too.
            if (e instanceof NotFound) {
              return sendJson(res, { error: `not found: ${e.message}` }, 404, ae);
            }
            return sendJson(res, { error: String(e && e.message ? e.message : e) }, 500, ae);
          }
        });
      }
      return sendJson(res, { error: 'not found' }, 404, ae);
    } catch (e) {
      return sendJson(res, { error: String(e && e.message ? e.message : e) }, 500, ae);
    }
  };
}

/**
 * `Handler._harness` — the `?harness=` query param, `null` when absent.
 *
 * `urllib.parse.parse_qs` with its defaults, reproduced only as far as this one caller
 * needs and no further: pairs split on `&` then `=`, values unquoted with `+` meaning a
 * space, and a BLANK value dropped (`keep_blank_values=False`), so `?harness=` resolves to
 * the installed default rather than to the empty string. The first occurrence wins,
 * because `parse_qs` returns a list and the reference takes `[0]`.
 *
 * THE BLANK-VALUE DROP IS INDISTINGUISHABLE HERE, measured rather than assumed: a
 * mutation removing it survived, because `normHarness('')` and `normHarness(null)` both
 * fall through to the installed default. It stays for the reason `parse_qs`' own default
 * exists — the next parameter read through this function may be one whose empty string
 * means something — and because a shell whose two implementations agreed only by accident
 * is the kind of agreement that stops holding when a caller is added. UNREACHABLE is not
 * the word: the branch runs on every `?harness=`, it simply cannot be observed to matter
 * through the one consumer it has.
 */
function harnessParam(url) {
  const at = (url || '').indexOf('?');
  if (at < 0) return null;
  for (const pair of url.slice(at + 1).split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const k = pyUnquote((eq < 0 ? pair : pair.slice(0, eq)).replace(/\+/g, ' '));
    const v = eq < 0 ? '' : pyUnquote(pair.slice(eq + 1).replace(/\+/g, ' '));
    if (k === 'harness' && v !== '') return v;
  }
  return null;
}

function readBody(req, length, done) {
  if (!(length > 0)) {
    req.resume();
    return done(Buffer.alloc(0));
  }
  const chunks = [];
  let seen = 0;
  req.on('data', (c) => {
    // Exactly `Content-Length` bytes, as `rfile.read(length)` takes: a longer body is
    // the next request's bytes and belongs to the parser, not to this handler.
    if (seen >= length) return;
    chunks.push(c.subarray(0, length - seen));
    seen += c.length;
  });
  req.on('end', () => done(Buffer.concat(chunks)));
}

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** `bytes.replace(old, new, 1)` — the first occurrence only. */
function replaceOnce(buf, find, repl) {
  const at = buf.indexOf(find);
  if (at < 0) return buf;
  return Buffer.concat([buf.subarray(0, at), repl, buf.subarray(at + find.length)]);
}

// ---- the daemon record -----------------------------------------------------

const statePath = (target) => join(target, '.geneseed-web.json');

export function readDaemon(target) {
  try {
    return JSON.parse(readFileSync(statePath(target), 'utf-8'));
  } catch {
    return null;
  }
}

export function writeDaemon(target, data) {
  try {
    mkdirSync(target, { recursive: true });
    const p = statePath(target);
    writeText(p, jsonDumpsCompact(data, { bareInts: true }));
    // Owner-only: the record carries the API token. A no-op on Windows, where the
    // mode only maps to the read-only attribute — same as the reference's os.chmod.
    chmodSync(p, 0o600);
  } catch { /* the reference swallows OSError here too */ }
}

export function clearDaemon(target) {
  try {
    unlinkSync(statePath(target));
  } catch { /* already gone */ }
}

// ---- daemon mode -----------------------------------------------------------
//
// `geneseed web start|stop|status|restart`. The reference's own banner explains the design
// — the running server records pid/port/token/url in a small JSON file and control is over
// HTTP, so nothing here needs OS process-kill semantics, only a localhost request with the
// token. Two things about the TWIN, neither of which is in that banner:
//
//   * `_probe` and `_post_shutdown` are `urllib.request.urlopen` with a timeout, which is
//     synchronous. Node has no synchronous HTTP client, so every function below that
//     reaches one is `async` and `cmdWeb` awaits it — which is why `bin/geneseed-cli.mjs`
//     awaits its dispatch. Nothing about the ORDER of the reference's steps changes.
//   * `agent: false` on both requests. Node's global agent has kept sockets alive by
//     default since v19, and a pooled idle socket keeps the event loop referenced — a
//     `web status` that answered correctly would then hang for the keep-alive timeout
//     instead of exiting. Python's `urlopen` opens and closes a connection per call.

/** `f"{url}/api/ping"` answered 200 — the cheap liveness probe both `status` and the
 *  launcher's wait loop are built on. Every failure mode is False, as the reference's
 *  `(URLError, OSError, ValueError)` catch is. */
export function probe(url, timeout = 1.5) {
  return new Promise((done) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; done(v); } };
    let req;
    try {
      req = httpRequest(`${url}/api/ping`, { method: 'GET', agent: false }, (res) => {
        res.resume();          // drain, or the socket never closes
        finish(res.statusCode === 200);
      });
    } catch {
      return finish(false);    // a malformed url is `ValueError` there and a throw here
    }
    req.setTimeout(Math.round(timeout * 1000), () => { req.destroy(); finish(false); });
    req.on('error', () => finish(false));
    req.end();
    return undefined;
  });
}

/** The token-carrying POST `geneseed web stop` and the in-page Stop button both send. */
export function postShutdown(url, token, timeout = 3.0) {
  return new Promise((done) => {
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; done(v); } };
    let req;
    try {
      req = httpRequest(`${url}/api/shutdown`, {
        method: 'POST',
        agent: false,
        headers: { 'X-Geneseed-Token': token, 'Content-Type': 'application/json' },
      }, (res) => {
        res.resume();
        finish(res.statusCode === 200);
      });
    } catch {
      return finish(false);
    }
    req.setTimeout(Math.round(timeout * 1000), () => { req.destroy(); finish(false); });
    req.on('error', () => finish(false));
    req.end('{}');
    return undefined;
  });
}

/**
 * The record ONLY if a server is answering; otherwise the stale file is deleted.
 *
 * The deletion is the part a port drops, and it is what stops a machine that crashed with
 * a daemon running from re-probing a dead URL on every `status` forever. Both of its arms
 * are gated by a `harness_golden` cell — a record whose url nothing answers, and a record
 * carrying no url at all, which skips the probe and still clears.
 */
export async function liveDaemon(target) {
  const st = readDaemon(target);
  if (st && pyTruthy(st.url) && await probe(st.url)) return st;
  if (pyTruthy(st)) clearDaemon(target);
  return null;
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** `st.get(k)` rendered as Python renders it — a missing key prints `None`, not
 *  `undefined`. Only reachable through a hand-edited record, and one character of
 *  divergence in a message is still a divergence. */
const none = (v) => (v === undefined || v === null ? 'None' : String(v));

/**
 * `_spawn_detached` — the daemon launcher, and the second `_ALLOWED_SPAWNS` entry this
 * module owns.
 *
 * WHY THERE IS NO IN-PROCESS EQUIVALENT: the whole contract is that the server OUTLIVES
 * the process that started it. `geneseed web start` prints a URL and returns to the shell;
 * the server it started must still be there. A thread, a `worker_thread` or an in-process
 * `serve()` all die with the launcher.
 *
 * WHAT IT STARTS IS THIS PROGRAM, named as `process.execPath` + `bin/geneseed-cli.mjs` —
 * the running interpreter by absolute path and this repo's own CLI. The reference names
 * `sys.executable` + `rituals/harness.py`; each side re-executes ITSELF, which is what
 * makes this not the passthrough the port exists to remove, and
 * `tests/test_web_daemon.py` asserts the twin's argv contains no `python`, no `harness.py`
 * and no `build.py` at all.
 */
function spawnDetached(webArgs, log) {
  const cmd = [process.execPath, join(ROOT, 'bin', 'geneseed-cli.mjs'), 'web', ...webArgs];
  let out = 'ignore';
  try {
    out = openSync(log, 'a');       // `open(log, "ab")`; DEVNULL on OSError, as there
  } catch { /* the reference falls back to DEVNULL on exactly this failure */ }
  const child = spawn(cmd[0], cmd.slice(1), {
    // `DETACHED_PROCESS | NEW_PROCESS_GROUP` on Windows and `start_new_session` on POSIX
    // are both `detached` here; `unref()` is what lets the launcher's event loop end while
    // the child runs on, which is `Popen`'s default and Node's is not.
    detached: true, windowsHide: true, stdio: ['ignore', out, out],
  });
  child.unref();
}

/** The `web` argv the launcher passes. Pure, and compared against `_daemon_args` by the
 *  corpus: the binary differs per side by design, the FLAGS may not. */
export function daemonArgs(port, theme) {
  const args = ['--daemon-internal', '--port', String(port), '--no-browser'];
  if (pyTruthy(theme)) args.push('--theme', theme);
  return args;
}

/** The same for the out-of-band restart — `_restart_args`. */
export function restartArgs(theme) {
  const args = ['restart', '--no-browser'];
  if (pyTruthy(theme)) args.push('--theme', theme);
  return args;
}

/** `request_restart` — a detached `web restart`, so the new server survives the exit of
 *  the very process asking for it. Called by POST `/api/restart`. */
export function requestRestart(theme) {
  const target = webState(theme).target;
  spawnDetached(restartArgs(theme), join(target, '.geneseed-web.log'));
}

/**
 * `webbrowser.open(url)`, which has no Node equivalent at all — there is no stdlib module
 * that knows what a desktop's default browser is.
 *
 * IT IS A MACHINE PRIMITIVE, the same class as `taskkill` and `java -version` and the
 * opposite of a passthrough: it asks the OS to open a URL and hands it nothing of this
 * program's work. Declining it instead would have been a silent regression in the one verb
 * whose job is to put a UI on screen — `geneseed web` would print an address and do
 * nothing, and no cell would say so because every cell passes `--no-browser`.
 *
 * The reference swallows every failure here (`contextlib.suppress(Exception)` in two call
 * sites and a bare `except` in the third), and so does this.
 */
function openUrl(url) {
  const [file, args, extra] = process.platform === 'win32'
    // `start` is a cmd BUILTIN, not a program. The empty `""` is its title argument —
    // without it `start "http://…"` treats the quoted URL as the window title and opens
    // nothing. Verbatim args because Node would otherwise re-quote the whole string.
    ? [process.env.COMSPEC || 'cmd.exe', ['/d', '/s', '/c', `start "" "${url}"`],
      { windowsVerbatimArguments: true }]
    : (process.platform === 'darwin' ? ['open', [url], {}] : ['xdg-open', [url], {}]);
  try {
    const child = spawn(file, args, {
      detached: true, stdio: 'ignore', windowsHide: true, ...extra,
    });
    // ⚠ ENOENT ARRIVES AS AN EVENT, NOT AS A THROW, AND THE `try` ABOVE CANNOT SEE IT.
    // This is where the reference's suppression failed to survive translation: Python's
    // `subprocess` raises `FileNotFoundError` synchronously, so `contextlib.suppress(Exception)`
    // really did swallow a missing opener. Node's `spawn` reports the same condition on the
    // child's `error` event, and an 'error' with no listener is re-thrown as an uncaught
    // exception. So the port's `try/catch` read as equivalent and suppressed nothing.
    //
    // MEASURED, in the packaged no-python container: `geneseed web` on a headless Linux box
    // printed `Error: spawn xdg-open ENOENT`. Found by the acceptance gate rather than by the
    // 690-cell corpus, and the docblock above says why the corpus never could — every cell
    // passes `--no-browser`, so no recorded cell has ever executed this line.
    child.on('error', () => { /* no opener on this machine; the daemon is still serving */ });
    child.unref();
  } catch { /* the reference suppresses every exception from this call too */ }
}

export async function startDaemon(theme, port, openBrowser = true) {
  const { target } = webState(theme);
  const st = await liveDaemon(target);
  if (st) {
    pyPrint(`[web] already running on ${st.url}  (pid ${none(st.pid)})\n`);
    if (openBrowser) openUrl(st.url);
    return 0;
  }
  clearDaemon(target);
  const log = join(target, '.geneseed-web.log');
  spawnDetached(daemonArgs(port, theme), log);
  // `for _ in range(60): ... time.sleep(0.2)` — twelve seconds for the child to bind and
  // write its record. The probe timeout is the reference's shorter 0.5 here, not 1.5.
  for (let i = 0; i < 60; i += 1) {
    const rec = readDaemon(target);
    // eslint-disable-next-line no-await-in-loop
    if (rec && pyTruthy(rec.url) && await probe(rec.url, 0.5)) {
      pyPrint(`[web] Geneseed UI on ${rec.url}  (theme: ${none(rec.theme)}, `
        + `pid ${none(rec.pid)})\n`);
      pyPrint('[web] running in the background — `geneseed web stop` to stop it.\n');
      if (openBrowser) openUrl(rec.url);
      return 0;
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(200);
  }
  pyPrint('[web] daemon did not come up in time — check the log:\n');
  pyPrint(`      ${log}\n`);
  return 1;
}

export async function stopDaemon(theme = null) {
  const { target } = webState(theme);
  const st = readDaemon(target);
  if (!pyTruthy(st) || !pyTruthy(st.url)) {
    // NO `clearDaemon` HERE, and the asymmetry with `liveDaemon` is the reference's. A
    // record that names no url is left exactly where it is; `web status` on the same file
    // deletes it. Both directions are cells, because a port that unified them would delete
    // a file the reference keeps and stdout would look identical.
    pyPrint('[web] no running server recorded.\n');
    return 0;
  }
  if (await postShutdown(st.url, pyTruthy(st.token) ? st.token : '')) {
    clearDaemon(target);
    pyPrint(`[web] stopped (pid ${none(st.pid)}).\n`);
    return 0;
  }
  clearDaemon(target);
  pyPrint('[web] no live server (cleared a stale record).\n');
  return 0;
}

export async function statusDaemon(theme = null) {
  const { target } = webState(theme);
  const st = await liveDaemon(target);
  if (st) {
    pyPrint(`[web] running on ${st.url}  (theme: ${none(st.theme)}, pid ${none(st.pid)})\n`);
    return 0;
  }
  // EXIT 1, which is the verb's whole contract for a script. The snapshot's `<exit>`
  // column is what gates it.
  pyPrint('[web] not running.\n');
  return 1;
}

export async function restartDaemon(theme = null, port = 4747, openBrowser = true,
  onlyIfRunning = false) {
  const { target } = webState(theme);
  const st = readDaemon(target);
  const live = (await liveDaemon(target)) !== null;
  if (onlyIfRunning && !live) return 0;
  const usePort = (st && pyTruthy(st.port) ? st.port : null) || port;
  let open = openBrowser;
  if (live) {
    // A live daemon means a tab is already open on this (preserved) port and will
    // reconnect on its own — the reference's `ponytail:` note, kept.
    open = false;
    await stopDaemon(theme);
    for (let i = 0; i < 50; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      if (!await probe(`http://127.0.0.1:${usePort}`, 0.2)) break;
      // eslint-disable-next-line no-await-in-loop
      await sleep(100);
    }
  }
  return startDaemon(theme, usePort, open);
}

// ---- serve -----------------------------------------------------------------

/**
 * Pure: what `serve()` should do about the UI bundle. Ported ahead of the rest of the
 * verb because it decides whether a server starts at all, and because it is the second
 * interactive prompt in this port — `interactive` is an ARGUMENT, which is what makes it
 * gateable by a corpus rather than only by a cell.
 *
 * P6h GAVE IT BOTH KINDS OF GATE AND FOUND THE CLAIM ABOVE HAD NEVER BEEN PAID. It had a
 * Python unit test (`tests/test_web.py`) and nothing cross-implementation until now: the
 * corpus in `tests/test_pure_function_parity.py` covers all five answers, and two
 * `harness_golden` cells cover the two arms that TERMINATE — which are also the only two
 * that let a `web` cell exist at all, since every other arm of `serve` binds a socket.
 */
export function buildPlan(dist, webDir, npm, interactive) {
  if (isFile(join(dist, 'index.html'))) return 'serve';
  if (!isFile(join(webDir, 'package.json'))) return 'no-source';
  if (!npm) return 'no-npm';
  if (!interactive) return 'no-tty';
  return 'ask';
}

/**
 * `npm install` then `npm run build` in `web/`, streams inherited — the third spawn this
 * module declares, and the one NO test reaches.
 *
 * THAT IS A DECLARED PARTITION, not an omission. `web/dist/index.html` is TRACKED (asserted
 * by `tests/test_web_daemon.py` against `git ls-files`, so the claim cannot rot), which
 * means `buildPlan` answers `serve` in every checkout a cell can build and the `ask` arm is
 * reachable only from a partial checkout on an interactive terminal. There is no npm
 * library to call instead; a Node twin that reimplemented `npm install` is not a thing that
 * exists.
 *
 * `shell` ON WINDOWS, and it is required rather than stylistic: `pyWhich('npm')` resolves
 * to `npm.CMD` through PATHEXT, and Node refuses to `spawn` a `.cmd` directly. The path is
 * quoted because Node wraps the whole command in one more pair and `cmd /s` strips only
 * the outermost — `C:\Program Files\…` would otherwise split at the space.
 */
export function npmBuild(npm, webDir) {
  const win = process.platform === 'win32';
  for (const step of [['install'], ['run', 'build']]) {
    pyPrint(`[web] npm ${step.join(' ')} ...\n`);
    const r = spawnSync(win ? `"${npm}"` : npm, step, {
      cwd: webDir, stdio: 'inherit', shell: win,
    });
    const code = r.status === null || r.status === undefined ? 1 : r.status;
    if (code) {
      pyPrint(`[web] npm ${step.join(' ')} failed (exit ${code}).\n`);
      return code;
    }
  }
  return 0;
}

export async function serve({ theme = null, port = 4747, openBrowser = true,
  daemon = false } = {}) {
  const dist = join(ROOT, 'web', 'dist');
  const webDir = join(ROOT, 'web');
  const manual = '        cd web && npm install && npm run build';
  // `sys.stdin.isatty()`. `process.stdin.isTTY` is `undefined` rather than false on a pipe,
  // which is the same trap `cmdSetup` documents.
  const plan = buildPlan(dist, webDir, pyWhich('npm'), Boolean(process.stdin.isTTY));
  if (plan === 'no-source') {
    pyPrint(`[web] web/ sources are missing from ${ROOT}.\n`);
    pyPrint('      Run `geneseed upgrade` to fetch them (twice on installs whose\n');
    pyPrint('      updater predates web/ in the sync list).\n');
    return 1;
  }
  if (plan === 'no-npm') {
    pyPrint('[web] web/dist is missing and npm was not found. Install Node.js,\n');
    pyPrint('      then build the UI:\n');
    pyPrint(`${manual}\n`);
    return 1;
  }
  if (plan === 'no-tty') {
    pyPrint('[web] web/dist is missing. Build the UI first:\n');
    pyPrint(`${manual}\n`);
    return 1;
  }
  if (plan === 'ask') {
    // `except (EOFError, KeyboardInterrupt): answer = "n"`. EOF is the arm that matters and
    // it is the one a naive port gets backwards: `input()` RAISES at EOF, so the reference
    // reads it as "no", while a read that returned `''` would fall into the empty-answer
    // arm and start an npm install nobody asked for. `promptLine` returns null for exactly
    // that case — see its docblock in js/setup.mjs.
    const line = promptLine('[web] UI not built — run npm install && npm run build now? [Y/n] ');
    const answer = line === null ? 'n' : line;
    if (['', 'y', 'yes'].includes(answer.trim().toLowerCase())) {
      const code = npmBuild(pyWhich('npm'), webDir);
      if (code) return code;
    } else {
      pyPrint('[web] skipped. Build the UI manually:\n');
      pyPrint(`${manual}\n`);
      return 0;
    }
  }
  const state = webState(theme);
  if (!existsSync(join(state.target, GLOBAL_MANIFEST))) {
    pyPrint(`[web] no deployed harness at ${state.target}.\n`);
    pyPrint('      Run `geneseed setup` first — serving anyway (read-only UI).\n');
  }
  const token = randomBytes(24).toString('base64url');
  const holder = {};
  // `JobManager(history_path=state.target / ".geneseed-web-runs.json")` — the console's job
  // list survives a reload and a restart because it is a FILE, not a process's memory.
  const jm = new JobManager(join(state.target, '.geneseed-web-runs.json'));
  const srv = createServer(makeHandler(state, jm, token, dist, holder));
  holder.srv = srv;
  return new Promise((done) => {
    srv.on('error', () => {
      // The reference retries on port 0; the same fallback, one level in.
      srv.listen(0, '127.0.0.1', () => ready());
    });
    srv.listen(port, '127.0.0.1', () => ready());

    function ready() {
      const hostPort = srv.address().port;
      const url = `http://127.0.0.1:${hostPort}`;
      if (daemon) {
        writeDaemon(state.target, {
          pid: process.pid, port: hostPort, url,
          token, theme: state.theme, started: Math.floor(Date.now() / 1000),
        });
      }
      pyPrint(`[web] Geneseed UI on ${url}  (theme: ${state.theme})\n`);
      pyPrint(daemon ? '[web] daemon ready.\n' : '[web] Ctrl-C to stop.\n');
      if (openBrowser) openUrl(url);
      // `except KeyboardInterrupt: print("\n[web] stopped.")` around `serve_forever`. Node
      // kills on SIGINT by default, which would skip the message AND the record cleanup in
      // the `finally` below — a foreground `--daemon-internal` server stopped with Ctrl-C
      // would leave a record pointing at a dead port.
      process.on('SIGINT', () => {
        pyPrint('\n[web] stopped.\n');
        srv.close();
        srv.closeAllConnections();
      });
      srv.on('close', () => {
        if (daemon) {
          const st = readDaemon(state.target);
          if (!st || st.pid === process.pid) clearDaemon(state.target);
        }
        done(0);
      });
    }
  });
}

/**
 * `cmd_web` — the verb `bin/geneseed-cli.mjs` dispatches to, and the reason this module is
 * on the CLI's import graph at all (which is what moved `js/web/jobs.mjs`'s
 * `_ALLOWED_SPAWNS` row from `entry: "web"` to `entry: "cli"`).
 *
 * The reference's `cmd_web` does `import web` INSIDE the function; the ESM equivalent would
 * be a dynamic `import()`, and it is deliberately NOT used — a static import is what lets
 * `test_the_cli_reaches_child_process_only_where_it_is_declared` walk the CLI's graph and
 * find the two spawning modules under `js/web/`. The cost is parsing the web tree on every
 * CLI invocation; `bin/geneseed-cli.mjs` is user-invoked and carries no latency budget (the
 * hook entry, which does, is a different binary for exactly this reason).
 */
export async function cmdWeb(args) {
  // `--port` is `type=int` on the reference, and `bin/geneseed-cli.mjs`'s `ints` column
  // refuses a non-integer before this runs — so `pyInt` cannot be null here.
  const port = args.port === null ? 4747 : pyInt(args.port);
  const openBrowser = !args.noBrowser;
  if (args.action === 'start') return startDaemon(args.theme, port, openBrowser);
  if (args.action === 'stop') return stopDaemon(args.theme);
  if (args.action === 'restart') return restartDaemon(args.theme, port, openBrowser);
  if (args.action === 'status') return statusDaemon(args.theme);
  return serve({ theme: args.theme, port, openBrowser, daemon: args.daemonInternal });
}

// ---- entry -----------------------------------------------------------------
//
// KEPT AFTER P6h, and it is not a duplicate of the verb above. `tests/web_golden.py` drove
// this module directly for all of P6a–P6g, and its 95 cells are what license the MOVE: the
// same matrix now runs against `node bin/geneseed-cli.mjs web` as well, and a byte gate
// that passed against one command proves nothing about the other until it is re-aimed. The
// module entry is also what a debugging session reaches for when the CLI's argument layer
// is the thing under suspicion.

async function main(argv) {
  let theme = null;
  let port = 4747;
  let daemon = false;
  let openBrowser = true;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--theme') { theme = argv[i + 1]; i += 1; } else if (argv[i] === '--port') { port = pyInt(String(argv[i + 1])) ?? 4747; i += 1; } else if (argv[i] === '--daemon-internal') daemon = true;
    else if (argv[i] === '--no-browser') openBrowser = false;
  }
  return serve({ theme, port, openBrowser, daemon });
}

if (process.argv[1] && pyResolve(process.argv[1]) === pyResolve(fileURLToPath(import.meta.url))) {
  process.exitCode = await main(process.argv.slice(2));
}
