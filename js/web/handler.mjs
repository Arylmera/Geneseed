/**
 * The request handler — one function per request, from method dispatch to bytes on the wire.
 *
 * `makeHandler(state, jm, token, dist, holder)` is a FACTORY and the shape is load-bearing: three
 * test call sites build one directly and drive it without a socket, which is what makes the web
 * surface testable at all. Keep the arity.
 *
 * What it actually uses of HTTP is small and deliberate — a whole-buffer `gzipSync` over a few
 * content types, two Cache-Control policies, one set of security headers (CSP with a per-response
 * nonce) on every response, and one request guard (`requestGuard`) in front of every route. No
 * streaming, no SSE, no ranges, no cookies, no CORS. The routes it honours are
 * declared next door in `routes.mjs`; the daemon that starts it is in `daemon.mjs`.
 */
import { resolvePath } from '../hosts/hosts.mjs';
import { isTruthy, jsonDumpsCompact } from '../lib/json.mjs';
import { parseIntStrict, percentDecode } from '../lib/text.mjs';
import {
  apiDeployCmd, apiInstallCmd, apiPickFolder, apiRestore, buildActionCmds, installView, mcpTargetPaths,
  rebuildCmds,
} from './actions.mjs';
import { BadRequest, NotFound } from './catalog.mjs';
import { openFolder, requestRestart } from './daemon.mjs';
import { apiDocs, apiDocsPage } from './docs.mjs';
import { actionCommands, updatePlan } from './jobs.mjs';
import {
  MACHINE_GETS, POST_ROUTES, PREFIX_ROUTES, STATE_ROUTES, VIEW_POSTS, readJsonBody,
} from './routes.mjs';
import { installKind } from './update-check.mjs';
import { isFile } from '../lib/fs.mjs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

/**
 * DNS-rebinding guard, HOSTNAME ONLY. `h.split(":", 1)[0]` keeps everything before the FIRST
 * colon, so `localhost:4747` passes and a bare IPv6 literal would not — which is what the `[::1]`
 * prefix check above it is for. The server itself no longer calls it: `requestGuard` matches the
 * exact `name:port` instead, which this looser predicate cannot express.
 */
export function localHost(host) {
  const h = (host || '').trim().toLowerCase();
  if (h.startsWith('[::1]')) return true;
  return ['127.0.0.1', 'localhost'].includes(h.split(':', 1)[0]);
}

/**
 * Sent on EVERY response, merged last so no caller's `extra` can weaken one. `frame-ancestors` +
 * `X-Frame-Options` stop a foreign page from framing the console and clickjacking its buttons; the
 * CSP admits the one inline script (the token) by `nonce`, so an injected `<script>` cannot run
 * and read the token. `style-src 'unsafe-inline'` because the React UI sets `style=` attributes.
 */
export function securityHeaders(nonce) {
  return {
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "frame-ancestors 'none'; default-src 'self'; "
      + `script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; `
      + "img-src 'self' data:; font-src 'self' data:; connect-src 'self'; worker-src 'self'; "
      + "manifest-src 'self'; base-uri 'none'; form-action 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
}

/**
 * THE one request guard, answered before dispatch (and before a POST body is read). `null` =
 * pass, else `{ code, body }`.
 *
 * - Host must be an allowed hostname AT THIS SOCKET'S PORT, exactly: the hostname stops DNS
 *   rebinding, the port stops another local server's page from posing as this origin.
 * - `/api/*`: a cross-site or same-site fetch, or a foreign `Origin`, is refused even on GET —
 *   the reads expose paths and memories. A request with neither header (curl, Node) passes.
 * - Any non-GET: the CSRF token, compared in constant time so its bytes cannot be timed out.
 */
export function requestGuard(req, token) {
  const host = req.headers.host || '';
  // Exact `name:port`, not `localHost` + a suffix test: that pair let `[::1]x.evil:4747` and
  // `localhost:1:4747` through. Lower-cased the way browsers send it.
  const want = `:${req.socket.localPort}`;
  const h = host.trim().toLowerCase();
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(h.endsWith(want) ? h.slice(0, -want.length) : '')) {
    return { code: 403, body: { error: 'forbidden host' } };
  }
  const path = (req.url || '').split('?', 1)[0];
  if (path.startsWith('/api/')) {
    const site = req.headers['sec-fetch-site'];
    const origin = req.headers.origin;
    if (site === 'cross-site' || site === 'same-site'
        || (origin !== undefined && origin !== `http://${host}`)) {
      return { code: 403, body: { error: 'forbidden origin' } };
    }
  }
  if (req.method !== 'GET') {
    const got = Buffer.from(String(req.headers['x-geneseed-token'] ?? ''), 'utf-8');
    const want = Buffer.from(token, 'utf-8');
    if (got.length !== want.length || !timingSafeEqual(got, want)) {
      return { code: 403, body: { error: 'forbidden' } };
    }
  }
  return null;
}

const GZIP_TYPES = ['application/json', 'text/', 'image/svg+xml',
  'application/manifest+json', 'application/javascript'];
const GZIP_MIN = 1024;

/**
 * The largest POST body read, in bytes. Every real body is a few KB of JSON (a rule, a profile,
 * a path); without a cap any web page could `no-cors` POST an arbitrary blob and this process
 * would buffer all of it before the token check refused it.
 */
export const MAX_BODY = 1024 * 1024;

const BUSY = { error: 'a job is running — wait for it to finish (or cancel it) first' };

const CTYPES = {
  '.html': 'text/html', '.js': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
};

// ---- the request handler ---------------------------------------------------

export function makeHandler(state, jm, token, dist, holder = null) {
  // fp -> { mtime, data, gz }. Keyed by path but VALIDATED by mtime on every hit, so a
  // rebuilt web/dist serves fresh bytes without `web restart` — the re-stat costs one
  // syscall against the readFileSync + gzipSync it saves. `gz` is the gzipped body,
  // computed once on the first gzip-accepting request instead of per request.
  const staticCache = new Map();
  // `dist` RESOLVED ONCE, because every path compared against it below is resolved too.
  // `resolvePath` is `realpathSync.native`, so a checkout reached by any path that is not its
  // canonical one — a symlink, a Windows junction, a `subst` or mapped drive, an 8.3 short name,
  // a lowercase drive letter — made `fp.startsWith(dist + sep)` false for EVERY asset. Each one
  // then fell back to index.html at `text/html`, the browser refused the module script, and the
  // page stayed blank with nothing logged on either side.
  const distReal = resolvePath(dist);

  function sendBytes(res, body, ctype, code = 200, extra = null, acceptEncoding = '', gzStore = null,
    nonce = randomBytes(16).toString('base64')) {
    const headers = { ...(extra || {}) };
    if (body.length >= GZIP_MIN && GZIP_TYPES.some((t) => ctype.startsWith(t))
        && (acceptEncoding || '').includes('gzip')) {
      body = gzStore ? (gzStore.gz ??= gzipSync(body, { level: 6 })) : gzipSync(body, { level: 6 });
      headers['Content-Encoding'] = 'gzip';
      headers.Vary = 'Accept-Encoding';
    }
    res.writeHead(code, {
      'Content-Type': ctype,
      'Content-Length': String(body.length),
      ...headers,
      ...securityHeaders(nonce),
    });
    res.end(body);
  }

  function sendJson(res, obj, code = 200, acceptEncoding = '') {
    sendBytes(res, Buffer.from(jsonDumpsCompact(obj, { bareInts: true }), 'utf-8'),
      'application/json', code, null, acceptEncoding);
  }

  function serveStatic(res, path, acceptEncoding) {
    const rel = (path === '/' || path === '') ? 'index.html' : path.replace(/^\/+/, '');
    const index = join(distReal, 'index.html');
    let fp = resolvePath(join(distReal, rel));
    // STRICTLY under `dist`: `fp === dist` itself must also take the fallback below, which
    // is why this checks `fp !== distReal` and not just the prefix.
    if (!(fp.startsWith(distReal + sep) && fp !== distReal) && fp !== index) fp = index;
    // A missing /assets/* file is a 404, never the HTML shell: served as 200, a rebuild's
    // momentary gap got cached under a chunk URL and broke the page (SH-27).
    if (!isFile(fp) && rel.startsWith('assets/')) {
      return sendJson(res, { error: 'not found' }, 404, acceptEncoding);
    }
    if (!isFile(fp)) fp = index;
    if (!isFile(fp)) {
      return sendJson(res, { error: 'web/dist missing — run the UI build' }, 500, acceptEncoding);
    }
    const mtime = statSync(fp).mtimeMs;
    let entry = staticCache.get(fp);
    if (entry === undefined || entry.mtime !== mtime) {
      entry = { mtime, data: readFileSync(fp), gz: null };
      staticCache.set(fp, entry);
    }
    let data = entry.data;
    let extra = null;
    // Fresh per response; for index.html the same value goes in the token script and its CSP.
    const nonce = randomBytes(16).toString('base64');
    if (basename(fp) === 'index.html') {
      const inject = Buffer.from(`<script nonce="${nonce}">window.__GENESEED_TOKEN__="${token}";</script>`, 'utf-8');
      data = replaceOnce(data, Buffer.from('</head>'), Buffer.concat([inject, Buffer.from('</head>')]));
      extra = { 'Cache-Control': 'no-store' };
      // The injected bytes differ from `entry.data`, so the gz cache must not serve them.
      entry = null;
    } else if (path.includes('/assets/')) {
      extra = { 'Cache-Control': 'public, max-age=31536000, immutable' };
    }
    return sendBytes(res, data, CTYPES[extname(fp)] || 'application/octet-stream',
      200, extra, acceptEncoding, entry, nonce);
  }

  function doGet(req, res, path, ae) {
    // The install the request names (`?host=&path=`), else the daemon's view; an unknown pair
    // throws `NotFound` here, before any route reads a dir. Not for ping, jobs, static files or
    // the machine-wide reads (`MACHINE_GETS`), which ignore the pair.
    const st = (path.startsWith('/api/') && path !== '/api/ping' && !path.startsWith('/api/jobs')
      && !MACHINE_GETS.has(path)) ? installView(state, installParams(req.url)) : state;
    const route = STATE_ROUTES[path];
    if (route !== undefined) return sendJson(res, route(st, req.url), 200, ae);
    // `pid` is what a restarting client waits on: the OLD server keeps answering this ping for
    // a moment after `/api/restart` returns, and a reload onto it fetches the old token.
    if (path === '/api/ping') {
      return sendJson(res, { ok: true, theme: state.theme, pid: process.pid }, 200, ae);
    }
    for (const [prefix, handler] of PREFIX_ROUTES) {
      if (path.startsWith(prefix)) return sendJson(res, handler(st, path, state), 200, ae);
    }
    if (path === '/api/docs') {
      return sendJson(res, apiDocs(st, harnessParam(req.url)), 200, ae);
    }
    if (path.startsWith('/api/docs/page/')) {
      const pid = percentDecode(path.slice('/api/docs/page/'.length));
      return sendJson(res, apiDocsPage(st, pid, harnessParam(req.url)), 200, ae);
    }
    if (path === '/api/jobs') return sendJson(res, { jobs: jm.recent() }, 200, ae);
    if (path.startsWith('/api/jobs/')) {
      // The LAST segment: `/api/jobs/a/b` looks up `b` and misses (no such job) rather than
      // 404ing on the URL shape.
      const j = jm.get(path.slice(path.lastIndexOf('/') + 1));
      return j ? sendJson(res, j, 200, ae)
        : sendJson(res, { error: 'no such job' }, 404, ae);
    }
    return serveStatic(res, path, ae);
  }

  function doPost(req, res, path, ae, body) {
    if (path === '/api/shutdown') {
      if (jm.busy) return sendJson(res, BUSY, 409, ae);
      // The one POST route the SHELL owns. It must answer BEFORE it stops, so closing is
      // deferred to `res.on('finish', ...)` so the response flushes first.
      // `closeAllConnections` is the other half: `close()` alone waits for idle keep-alive
      // sockets, and the client that just sent this request is holding one open.
      res.on('finish', () => {
        holder.srv.close();
        holder.srv.closeAllConnections();
      });
      return sendJson(res, { stopping: true }, 200, ae);
    }
    if (path === '/api/restart') {
      // THE SUCCESS ARM NO TEST MAY REACH. `requestRestart` spawns a DETACHED `web restart`,
      // which stops whatever daemon the record names and starts a fresh one that outlives the
      // caller — driven from a test, it would orphan a real daemon on 4747 in the developer's
      // own environment. Its two REFUSALS are reachable and probed: a running job (409, it
      // would be orphaned), and a server that is not the recorded daemon (409, see
      // `requestRestart`) — which a test's server never is.
      if (jm.busy) return sendJson(res, BUSY, 409, ae);
      if (!requestRestart(state.theme)) {
        return sendJson(res,
          { error: 'foreground server: restart it from its terminal' }, 409, ae);
      }
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
      // nothing else. (No shell sees the path: on Windows `openFolder` hands it to explorer.exe
      // as one argv element, so a `%VAR%` in a folder name is never expanded.)
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
      // `openFolder` SWALLOWS EVERY FAILURE BY DESIGN (a headless box has no opener), so `ok` here
      // means "the path was allowed and the request was made", never "a window appeared". The
      // response says which directory, so the UI can print it as the fallback instruction.
      openFolder(dir);
      return sendJson(res, { ok: true, dir }, 200, ae);
    }
    if (path === '/api/pick-folder') {
      // INLINE, NOT `POST_ROUTES`: that table's `fn(state, body) -> object` shape answers the
      // instant `fn` returns, and this endpoint cannot — it spawns a native dialog that a human
      // may sit in front of for a while. `doPost` returns to its caller immediately, unresolved;
      // `apiPickFolder`'s `done` calls `sendJson` whenever the child actually exits, which is
      // what lets the daemon keep answering every OTHER request while the dialog is open — see
      // `apiPickFolder` in `js/web/actions.mjs` for the async-spawn reasoning.
      apiPickFolder((result) => sendJson(res, result, 200, ae));
      return;
    }
    // The install a body `{host, path}` names, on the routes that read one (`VIEW_POSTS`).
    // An action is looked up on the SAME segment `doAction` dispatches on (the last), so
    // `/api/actions/x/restore` cannot run a restore on the daemon's install instead.
    const key = path.startsWith('/api/actions/')
      ? `/api/actions/${path.slice(path.lastIndexOf('/') + 1)}` : path;
    const st = VIEW_POSTS.has(key) ? installView(state, readJsonBody(body)) : state;
    const route = POST_ROUTES.get(path);
    if (route !== undefined) {
      const [fn, okIs409] = route;
      const obj = fn(st, readJsonBody(body));
      return sendJson(res, obj, (okIs409 && !isTruthy(obj.ok)) ? 409 : 200, ae);
    }
    if (path.startsWith('/api/jobs/') && path.endsWith('/cancel')) {
      // Positional: `/api/jobs/<id>/cancel` takes `<id>` and a deeper path takes its third
      // segment regardless.
      const jid = path.split('/')[3];
      return jm.cancel(jid) ? sendJson(res, { cancelled: jid }, 200, ae)
        : sendJson(res, { error: 'no running job by that id' }, 404, ae);
    }
    if (path.startsWith('/api/actions/')) {
      return doAction(res, path.slice(path.lastIndexOf('/') + 1), readJsonBody(body), ae, st);
    }
    return sendJson(res, { error: 'not found' }, 404, ae);
  }

  /**
   * `/api/actions/<x>` dispatch order, and the order is deliberate rather than incidental.
   *
   * `restore` is answered BEFORE anything else because it is synchronous and returns a result
   * rather than a job id. `install` and `deploy` resolve their argv from the body, and their
   * refusal statuses DIFFER — 409 for install (its target came from an allowlist, so a refusal
   * means the world changed under the client) and 400 for deploy (its path came from the body,
   * so a refusal means the body was wrong). Unifying the two would be wrong for one of them.
   *
   * `rebuild` follows them: the named installs' argv (`rebuildCmds`), 409 on a refusal for the
   * install reason, and the build-all restart on a stale server. Its job is several steps, and
   * `_run` stops at the first failed one where `rebuild-all` is best-effort: a click names the
   * installs it wants, so a failure should stop and be read rather than be stepped past.
   *
   * `update` COMES NEXT AND IS INLINE: it is gated on a LOCAL-ONLY preflight before a job is
   * ever started, so a dirty tree or a zip-download install gets a friendly 422 the UI renders
   * as an info popup instead of a job that spawns and then fails. Its finish handler is its own
   * too — the child skips its own daemon bounce (`GENESEED_WEB_JOB`, set by `_run` in
   * `jobs.mjs`), so the restart happens HERE, after the job is saved as finished, and only when
   * it succeeded: a failed update changed nothing worth reloading and bouncing would disconnect
   * the PWA for no reason.
   *
   * THEN the table, which answers a 404 for any action it does not name.
   */
  function doAction(res, action, body, ae, st = state) {
    if (action === 'restore') {
      return sendJson(res, apiRestore(st, isTruthy(body.files) ? body.files : []), 200, ae);
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
    if (action === 'rebuild') {
      const plan = rebuildCmds(body);
      if (Object.hasOwn(plan, 'error')) return sendJson(res, plan, 409, ae);
      // A STALE server is refused, not restarted afterwards as build-all is: `rebuildCmds` built
      // each argv with THIS (old) process's `installProfile`, while the build-driver it spawns is
      // the new code on disk, so an axis or marker the pull added would be dropped. build-all
      // spawns the new CLI, which builds every profile with the new code; this path cannot.
      if (state.daemonStale?.()) {
        return sendJson(res, { error: 'the console is running older code than the disk — restart it first (Installs › Server › Restart), then rebuild' }, 422, ae);
      }
      return startJob(res, 'rebuild', plan.cmds, ae);
    }
    if (action === 'update') {
      // The route follows the install (`updatePlan`); a refusal is the same friendly 422.
      // The daily background `git fetch` still running would hold `.git` locks the update's own
      // fetch needs, and fail it as `fetch_failed`; it ends within GENESEED_NET_TIMEOUT.
      if (state._behind?.inflight) {
        return sendJson(res, { precondition: 'checking', kind: 'info',
          message: 'The console is checking upstream right now. Try Update again in a moment.' },
        422, ae);
      }
      const plan = updatePlan(installKind());
      if (plan.refuse) return sendJson(res, plan.refuse, 422, ae);
      // `requestRestart` declines on a foreground server, which then shows its stale banner.
      const jid = jm.start('update', plan.cmds, (rc) => {
        state.refresh();
        if (rc === 0) {
          // The old answers ("3 commits to pull") are about the code just replaced.
          delete state._behind;
          delete state._update;
          requestRestart(state.theme);
        }
      }, plan.opts);
      if (jid === null) return sendJson(res, { error: 'busy' }, 409, ae);
      return sendJson(res, { job_id: jid }, 202, ae);
    }
    // A rebuild-all on a STALE server (a manual `git pull` under it) restarts it afterwards, as
    // an update does: otherwise the rebuild lands and the page keeps serving the old code.
    // `restarts` tells the console to wait for the new server and reload.
    if (action === 'build-all' && state.daemonStale?.()) {
      const jid = jm.start(action, actionCommands(action), (rc) => {
        state.refresh();
        if (rc === 0) requestRestart(state.theme);
      });
      if (jid === null) return sendJson(res, { error: 'busy' }, 409, ae);
      return sendJson(res, { job_id: jid, restarts: true }, 202, ae);
    }
    // Build resolves its argv off the install (`buildActionCmds`); the other actions take no
    // axes and self-resolve the deployed theme downstream.
    const cmds = action === 'build' ? buildActionCmds(st, body) : actionCommands(action);
    if (cmds && Object.hasOwn(cmds, 'error')) return sendJson(res, cmds, 400, ae);
    if (!isTruthy(cmds)) {
      return sendJson(res, { error: `unknown action ${action}` }, 404, ae);
    }
    return startJob(res, action, cmds, ae);
  }

  /**
   * The 202/409 pair every job route ends in. `state.refresh()` on finish is not optional: a
   * Build may re-theme the install, and the re-detect must read the new `.geneseed-emit` or
   * the console keeps serving the old mode.
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
      // GUARD FIRST, BODY SECOND: a refused request is DISCARDED (`resume`, nothing buffered).
      const refused = requestGuard(req, token);
      if (refused) {
        sendJson(res, refused.body, refused.code, ae);
        return req.resume();
      }
      if (req.method === 'GET') {
        try {
          return doGet(req, res, path, ae);
        } catch (e) {
          // The `NotFound` → 404 convention wraps the ROUTE DISPATCH as a whole, not each
          // handler individually: an endpoint several frames down raises and this decides
          // the status. Anything else still falls to the outer 500.
          if (e instanceof NotFound) {
            return sendJson(res, { error: `not found: ${e.message}` }, 404, ae);
          }
          throw e;
        }
      }
      if (req.method === 'POST') {
        // The guard above needed no body, so it answered before one was read. A body over
        // `MAX_BODY` is refused on its declared length, and the socket is closed rather than drained. Otherwise the body is buffered before routing regardless
        // of what the route needs it for: Node's parser owns the message boundary, so unread
        // bytes are discarded when the response ends rather than mis-parsed as the next request.
        const length = parseIntStrict(String(req.headers['content-length'] ?? '')) ?? 0;
        if (length > MAX_BODY) {
          res.setHeader('Connection', 'close');
          sendJson(res, { error: `request body over ${MAX_BODY} bytes` }, 413, ae);
          return req.resume();
        }
        return readBody(req, length, (buf) => {
          req._body = buf;
          try {
            return doPost(req, res, path, ae, buf);
          } catch (e) {
            // `installView`, `apiMemoryDelete`, `apiRulesMutate` and `apiRulesPromote` all
            // raise `NotFound` for an unknown target, mapped to 404
            // here; anything else falls to the generic 500 (`SERVER_FAULT`, below).
            if (e instanceof NotFound) {
              return sendJson(res, { error: `not found: ${e.message}` }, 404, ae);
            }
            // A body the route refused on its content (a rule body with a `## ` heading) is
            // the caller's to fix: 400, not the 500 of a server fault.
            if (e instanceof BadRequest) return sendJson(res, { error: e.message }, 400, ae);
            logFault(req, path, e);
            return sendJson(res, SERVER_FAULT, 500, ae);
          }
        });
      }
      return sendJson(res, { error: 'not found' }, 404, ae);
    } catch (e) {
      logFault(req, path, e);
      return sendJson(res, SERVER_FAULT, 500, ae);
    }
  };
}

/** What every 500 answers: one fixed string, so no fault ever echoes its own message. */
const SERVER_FAULT = { error: 'internal error — the details are in the server log' };

/**
 * A server fault: the detail to stderr, a fixed string to the client. A thrown message carries
 * whatever the route held — `path.join` puts an absolute path in it — and the page that shows
 * `error` is no place for that. The daemon's stderr IS `.geneseed-web.log` (`spawnDetached`);
 * a foreground server prints it to its terminal, which is why the message names neither.
 * Method and path only, never headers or body: the token rides in a header.
 */
function logFault(req, path, e) {
  process.stderr.write(`[geneseed web] 500 ${req.method} ${path}: ${(e && e.stack) || String(e)}\n`);
}

/**
 * `Handler._harness` — the `?harness=` query param, `null` when absent.
 *
 * `urllib.parse.parse_qs` with its defaults, reproduced only as far as this one caller
 * needs and no further: values unquoted with `+` meaning a space, and a BLANK value dropped
 * (`keep_blank_values=False`), so `?harness=` resolves to the installed default rather than
 * to the empty string — `''  || null` is what drops it below. The first occurrence wins,
 * because `parse_qs` returns a list and the reference takes `[0]`, and so does
 * `URLSearchParams.get`.
 *
 * `new URL(url, 'http://x')` rather than a hand-split on `&`/`=`: the base is a throwaway,
 * needed only because `URL` refuses a bare path-plus-query with no scheme. One measured
 * difference from the hand-split version this replaced — found by diffing both against a
 * battery of query strings before this landed — and it is a FIX, not a regression: a literal
 * `#` in the query is a URL FRAGMENT, which `URLSearchParams` correctly excludes and the old
 * split-on-`&` did not, because a fragment is a client-side-only construct an HTTP request
 * line can never actually carry — no `req.url` this handler ever sees can contain one.
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
  return new URL(url || '', 'http://x').searchParams.get('harness') || null;
}

/**
 * `{host, path}` off the query, each `null` when absent — two params, not one string, because a
 * Windows path holds a colon. A BLANK value is kept as `''`, unlike `harnessParam`: `?host=` names
 * an install, a bad one, and `installView` must refuse it rather than read it as "none named".
 */
function installParams(url) {
  const q = new URL(url || '', 'http://x').searchParams;
  return { host: q.get('host'), path: q.get('path') };
}

function readBody(req, length, done) {
  if (!(length > 0)) {
    req.resume();
    return done(Buffer.alloc(0));
  }
  const chunks = [];
  let seen = 0;
  req.on('data', (c) => {
    // Exactly `Content-Length` bytes: any more belongs to the next request and is the HTTP
    // parser's concern, not this handler's.
    if (seen >= length) return;
    chunks.push(c.subarray(0, length - seen));
    seen += c.length;
  });
  req.on('end', () => done(Buffer.concat(chunks)));
}

/** Replaces the first occurrence only. */
function replaceOnce(buf, find, repl) {
  const at = buf.indexOf(find);
  if (at < 0) return buf;
  return Buffer.concat([buf.subarray(0, at), repl, buf.subarray(at + find.length)]);
}

