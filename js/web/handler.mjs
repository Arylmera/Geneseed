/**
 * The request handler — one function per request, from method dispatch to bytes on the wire.
 *
 * `makeHandler(state, jm, token, dist, holder)` is a FACTORY and the shape is load-bearing: three
 * test call sites build one directly and drive it without a socket, which is what makes the web
 * surface testable at all. Keep the arity.
 *
 * What it actually uses of HTTP is small and deliberate — a whole-buffer `gzipSync` over a few
 * content types, two Cache-Control policies, a CSRF token on POST only, and a Host guard against
 * DNS rebinding. No streaming, no SSE, no ranges, no cookies, no CORS. The routes it honours are
 * declared next door in `routes.mjs`; the daemon that starts it is in `daemon.mjs`.
 */
import { resolvePath } from '../hosts/hosts.mjs';
import { doctrinesForBuild } from '../hosts/installs.mjs';
import { isTruthy, jsonDumpsCompact } from '../lib/json.mjs';
import { parseIntStrict, percentDecode } from '../lib/text.mjs';
import { preflight } from '../maintain/update.mjs';
import { apiDeployCmd, apiInstallCmd, apiPickFolder, apiRestore, buildOverride, mcpTargetPaths } from './actions.mjs';
import { NotFound, PREFIX_ROUTES, STATE_ROUTES } from './api.mjs';
import { openUrl, requestRestart } from './daemon.mjs';
import { apiDocs, apiDocsPage } from './docs.mjs';
import { actionCommands } from './jobs.mjs';
import { POST_ROUTES, readJsonBody } from './routes.mjs';
import { isFile } from '../lib/fs.mjs';
import { readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

// `isFile` is owned by `js/lib/fs.mjs` now (single owner). Re-exported here so
// `js/web/server.mjs`'s existing `import { isFile, ... } from './handler.mjs'` keeps working.
export { isFile };

/**
 * DNS-rebinding guard. `h.split(":", 1)[0]` keeps everything before the FIRST colon, so
 * `localhost:4747` passes and a bare IPv6 literal would not — which is what the `[::1]`
 * prefix check above it is for.
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

// ---- the request handler ---------------------------------------------------

export function makeHandler(state, jm, token, dist, holder = null) {
  // fp -> { mtime, data, gz }. Keyed by path but VALIDATED by mtime on every hit, so a
  // rebuilt web/dist serves fresh bytes without `web restart` — the re-stat costs one
  // syscall against the readFileSync + gzipSync it saves. `gz` is the gzipped body,
  // computed once on the first gzip-accepting request instead of per request.
  const staticCache = new Map();

  function sendBytes(res, body, ctype, code = 200, extra = null, acceptEncoding = '', gzStore = null) {
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
    });
    res.end(body);
  }

  function sendJson(res, obj, code = 200, acceptEncoding = '') {
    sendBytes(res, Buffer.from(jsonDumpsCompact(obj, { bareInts: true }), 'utf-8'),
      'application/json', code, null, acceptEncoding);
  }

  function serveStatic(res, path, acceptEncoding) {
    const rel = (path === '/' || path === '') ? 'index.html' : path.replace(/^\/+/, '');
    const index = resolvePath(join(dist, 'index.html'));
    let fp = resolvePath(join(dist, rel));
    // STRICTLY under `dist`: `fp === dist` itself must also take the fallback below, which
    // is why this checks `fp !== dist` and not just the prefix.
    if (!(fp.startsWith(dist + sep) && fp !== dist) && fp !== index) fp = join(dist, 'index.html');
    if (!isFile(fp)) fp = join(dist, 'index.html');
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
    if (basename(fp) === 'index.html') {
      const inject = Buffer.from(`<script>window.__GENESEED_TOKEN__="${token}";</script>`, 'utf-8');
      data = replaceOnce(data, Buffer.from('</head>'), Buffer.concat([inject, Buffer.from('</head>')]));
      extra = { 'Cache-Control': 'no-store' };
      // The injected bytes differ from `entry.data`, so the gz cache must not serve them.
      entry = null;
    } else if (path.includes('/assets/')) {
      extra = { 'Cache-Control': 'public, max-age=31536000, immutable' };
    }
    return sendBytes(res, data, CTYPES[extname(fp)] || 'application/octet-stream',
      200, extra, acceptEncoding, entry);
  }

  function doGet(req, res, path, ae) {
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
      const pid = percentDecode(path.slice('/api/docs/page/'.length));
      return sendJson(res, apiDocsPage(state, pid, harnessParam(req.url)), 200, ae);
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
    if (!localHost(req.headers.host)) {
      return sendJson(res, { error: 'forbidden host' }, 403, ae);
    }
    if (req.headers['x-geneseed-token'] !== token) {
      return sendJson(res, { error: 'forbidden' }, 403, ae);
    }
    if (path === '/api/shutdown') {
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
      // THE ONE ROUTE IN THIS FILE NO TEST MAY REACH, and it is declared rather than probed.
      // `requestRestart` spawns a DETACHED `web restart`, which stops whatever daemon the
      // record names and starts a fresh one that outlives the caller. Actually driving this
      // route from a test would either stop the test's own server or, worse, orphan a real
      // daemon that binds 4747 and serves the checkout forever in the developer's own
      // environment.
      //
      // So the gate asserts this dispatches to `requestRestart(state.theme)` directly rather
      // than by hitting the route through a live request — a declaration is not normally
      // enough to stand in for a dispatcher, but here probing the dispatcher costs more than
      // the assurance is worth.
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
    const route = POST_ROUTES.get(path);
    if (route !== undefined) {
      const [fn, okIs409] = route;
      const obj = fn(state, readJsonBody(body));
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
      return doAction(res, path.slice(path.lastIndexOf('/') + 1), readJsonBody(body), ae);
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
  function doAction(res, action, body, ae) {
    if (action === 'restore') {
      return sendJson(res, apiRestore(state, isTruthy(body.files) ? body.files : []), 200, ae);
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
      if (req.method === 'GET') {
        if (!localHost(req.headers.host)) {
          return sendJson(res, { error: 'forbidden host' }, 403, ae);
        }
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
        // The body is drained before routing regardless of what the route needs it for:
        // `readJsonBody` needs the bytes for a real POST body, and Node's own HTTP parser
        // owns the message boundary anyway — unread bytes are discarded when the response
        // ends rather than mis-parsed as the next request line, so this is where the bytes
        // have to come from either way.
        const length = parseIntStrict(String(req.headers['content-length'] ?? '')) ?? 0;
        return readBody(req, length, (buf) => {
          req._body = buf;
          try {
            return doPost(req, res, path, ae, buf);
          } catch (e) {
            // `apiMcpToggle`, `apiSelectView`, `apiMemoryDelete`, `apiRulesMutate` and
            // `apiRulesPromote` all raise `NotFound` for an unknown target, mapped to 404
            // here; anything else falls to the 500 arm below, carrying its own message.
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

