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
import { jsonDumpsCompact, pyInt, pyPrint, writeText } from '../lib/pyfs.mjs';
import { NotFound, PREFIX_ROUTES, STATE_ROUTES, webState } from './api.mjs';

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
 * It shrinks to empty as P6b-P6g land. `tests/web_golden.py` has no cell for any path in
 * here, deliberately: a cell comparing a 501 against the reference's real body would
 * fail, and one comparing two 501s would be waiting to go stale.
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
export const NOT_PORTED = new Set([
  '/api/activity', '/api/graph', '/api/mcp', '/api/rules', '/api/docs', '/api/jobs',
]);
export const NOT_PORTED_PREFIXES = ['/api/activity/', '/api/docs/page/', '/api/jobs/'];

/** Every POST route but `/api/shutdown`, which is the shell's own. P6f-P6g empty this. */
export const NOT_PORTED_POST = new Set([
  '/api/restart', '/api/pick-folder', '/api/mcp', '/api/install', '/api/excludes',
  '/api/view', '/api/activity', '/api/memory/delete', '/api/rules', '/api/rules/promote',
  '/api/profile',
]);
export const NOT_PORTED_POST_PREFIXES = ['/api/jobs/', '/api/actions/'];

function notPorted(path) {
  return NOT_PORTED.has(path) || NOT_PORTED_PREFIXES.some((p) => path.startsWith(p));
}

function notPortedPost(path) {
  return NOT_PORTED_POST.has(path)
    || NOT_PORTED_POST_PREFIXES.some((p) => path.startsWith(p));
}

// ---- the request handler ---------------------------------------------------

export function makeHandler(state, token, dist, holder = null) {
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
    if (notPortedPost(path)) {
      return sendJson(res, { error: `not ported yet: ${path}` }, 501, ae);
    }
    return sendJson(res, { error: 'not found' }, 404, ae);
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
  const srv = createServer(makeHandler(state, token, dist, holder));
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
