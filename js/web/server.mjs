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
 * WHAT IS DELIBERATELY NOT HERE. The API functions (P6b-P6f), the job manager (P6g), and
 * the `web` VERB with its daemon lifecycle, browser open and npm build (P6h). No call
 * site reaches this file yet: `bin/geneseed-cli.mjs` carries no `web` verb, so the only
 * caller is the acceptance harness, which runs it as a module. `NOT_PORTED` below is what
 * keeps that partial state loud instead of plausible.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync, unlinkSync, chmodSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve as pathResolve, extname, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { GLOBAL_MANIFEST, pyResolve } from '../hosts.mjs';
import {
  jsonDumpsCompact, parseJson, pyInt, pyPrint, pyStr, pyTruthy, pyUnquote, writeText,
} from '../lib/pyfs.mjs';
import { NotFound, PREFIX_ROUTES, STATE_ROUTES, webState } from './api.mjs';
import {
  apiDeployCmd, apiExcludesMutate, apiInstallCmd, apiMcpToggle, apiMemoryDelete, apiProfileSave,
  apiRestore, apiRulesMutate, apiRulesPromote, apiSelectView, buildOverride,
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
 * The POSTs that have not crossed YET. P6h empties the first; the second has its own due date.
 *
 * `/api/restart` hands off to a detached `web restart`, which is the daemon lifecycle P6h
 * owns. `/api/install` is `api_install_toggle` — 27 endpoint lines over 293 lines of
 * unported all-or-nothing tree moves with rollback, a stash layout and a host fork; see
 * `js/web/actions.mjs`'s header for the measurement and why a web phase is the wrong place
 * for it.
 *
 * THE PREFIX LIST IS EMPTY SINCE P6g — `/api/jobs/` and `/api/actions/` both dispatch now.
 * It stays for the reason the GET pair above stays.
 */
export const NOT_PORTED_POST = new Set([
  '/api/restart', '/api/install',
]);
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
export const PORTED_POST_INLINE = ['/api/shutdown', '/api/jobs/', '/api/actions/'];

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
   * THEN the three unported rows, and only then the table. Order matters: `update` is a REAL
   * action whose verb has not crossed, and letting it fall through to `actionCommands` would
   * answer `{"error": "unknown action update"}` — the same thing a typo gets.
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
    if (NOT_PORTED_ACTIONS.has(action)) {
      return sendJson(res, { error: `not ported yet: /api/actions/${action}` }, 501, ae);
    }
    // Build can be re-themed/re-targeted from the UI picker; the other actions self-resolve
    // the deployed theme downstream. Footprint, posture and mode always follow the current
    // install, so a re-theme preserves lean/full, the register and the operating mode.
    const [theme, emit] = action === 'build'
      ? buildOverride(state, body) : [state.theme, state.emit];
    const cmds = actionCommands(action, {
      theme, emit, footprint: state.footprint, posture: state.posture, mode: state.mode,
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

// ---- serve -----------------------------------------------------------------

/**
 * Pure: what `serve()` should do about the UI bundle. Ported ahead of the rest of the
 * verb because it decides whether a server starts at all, and because it is the second
 * interactive prompt in this port — `interactive` is an ARGUMENT, which is what makes it
 * gateable by a corpus rather than only by a cell.
 */
export function buildPlan(dist, webDir, npm, interactive) {
  if (isFile(join(dist, 'index.html'))) return 'serve';
  if (!isFile(join(webDir, 'package.json'))) return 'no-source';
  if (!npm) return 'no-npm';
  if (!interactive) return 'no-tty';
  return 'ask';
}

export function serve({ theme = null, port = 4747, daemon = false } = {}) {
  const dist = join(ROOT, 'web', 'dist');
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

// ---- entry -----------------------------------------------------------------
//
// A module entry, not a `bin/` binary and not a `geneseed-cli.mjs` verb. Wiring `web`
// into the CLI's verb table is P6h's, and doing it early would fire
// `test_the_matrix_covers_every_verb_it_claims` — which demands a cell group per verb in
// `tests/harness_golden.py`, where a server cell does not belong. The acceptance harness
// takes both sides' commands as arguments, so it needs no binary here.

async function main(argv) {
  let theme = null;
  let port = 4747;
  let daemon = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--theme') { theme = argv[i + 1]; i += 1; } else if (argv[i] === '--port') { port = pyInt(String(argv[i + 1])) ?? 4747; i += 1; } else if (argv[i] === '--daemon-internal') daemon = true;
    else if (argv[i] === '--no-browser') { /* the only supported mode until P6h */ }
  }
  return serve({ theme, port, daemon });
}

if (process.argv[1] && pyResolve(process.argv[1]) === pyResolve(fileURLToPath(import.meta.url))) {
  process.exitCode = await main(process.argv.slice(2));
}
