/**
 * WHAT THE WEB API ANSWERS — as a declaration, separate from the dispatcher that honours it.
 *
 * Eight exported sets and one map. They are not documentation: `tests/unit/web_server.mjs` reads
 * them as a TWO-SIDED PARTITION and probes the real handler against them, because a declaration is
 * not a dispatcher — a route can be declared in one and missing from the other, and nothing but
 * a probe notices.
 *
 * Split out of `server.mjs` because it is the half a reader consults to answer "does the console
 * expose X?", which has nothing to do with sockets, daemons or gzip.
 */
import { formatValue, isTruthy, parseJson } from '../lib/json.mjs';
import { apiExcludesMutate, apiInstallToggle, apiMcpToggle, apiMemoryDelete, apiProfileSave, apiRulesMutate, apiRulesPromote, apiSelectView } from './actions.mjs';
import { apiActivityToggle } from './activity.mjs';

/**
 * The API paths this daemon does not answer — currently empty, but the DECLARATION STAYS:
 * without it, an unmatched GET falls through to `serveStatic`'s SPA fallback (200 +
 * index.html) instead of a clear failure. Half of a partition test, so an empty set still
 * asserts there is nothing left to declare.
 *
 * Declared separately from the POST sets below because five paths — `/api/mcp`,
 * `/api/excludes`, `/api/rules`, `/api/profile`, `/api/activity` — answer both verbs with
 * different bodies, so one set keyed on path alone could not track GET and POST status
 * independently.
 */
export const NOT_PORTED = new Set([]);
export const NOT_PORTED_PREFIXES = [];

/**
 * The POSTs that have not crossed yet — currently empty, for the same reason the GET pair
 * above stays declared: deleting it would let an unrouted POST fall through to a
 * plausible-looking 404 instead of the 501 this set exists to produce.
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
 * The POSTs this daemon answers — and this table IS the dispatch, not a declaration beside
 * it: `doPost` looks routes up HERE, so a hand-kept declaration and the running dispatcher
 * cannot drift.
 *
 * THE SECOND COLUMN IS THE 409 CONVENTION: `ok: false` means the write did not happen, and
 * the client must re-fetch rather than retry — which 409 says and 200 does not. Two
 * exceptions: `/api/activity` answers 200 whatever `ok` says (unifying the rule would be
 * wrong there), and `/api/memory/delete` carries no `ok` at all (it deletes, or raises
 * `NotFound` for a 404).
 *
 * `NotFound` is caught once, in `handler`, not per route — repeating the catch here would
 * only duplicate it.
 */
export const POST_ROUTES = new Map([
  ['/api/mcp', [apiMcpToggle, true]],
  ['/api/install', [apiInstallToggle, true]],
  ['/api/excludes', [apiExcludesMutate, true]],
  ['/api/view', [apiSelectView, true]],
  ['/api/activity', [apiActivityToggle, false]],
  // The dispatch wrapper resolves `name` from the body itself; `apiMemoryDelete` takes a bare
  // slug string, not the body object, unlike the other routes here.
  ['/api/memory/delete',
    [(state, b) => apiMemoryDelete(state, isTruthy(b.name) ? formatValue(b.name) : ''), false]],
  ['/api/rules', [apiRulesMutate, true]],
  ['/api/rules/promote', [apiRulesPromote, true]],
  ['/api/profile', [apiProfileSave, true]],
]);

export const PORTED_POST = [...POST_ROUTES.keys()];

/**
 * The 409 column, exported so a test can assert it directly. Giving `/api/activity` the 409
 * treatment is the invisible mutation: nothing in normal use can force the `ok: false` arm
 * to raise, so the convention has to be checked on its own rather than inferred from
 * behaviour.
 */
export const POST_ROUTES_CONVENTION = Object.fromEntries(
  [...POST_ROUTES].map(([p, [, okIs409]]) => [p, okIs409]),
);

/**
 * The GET paths answered OUTSIDE the two tables, declared so the partition cross-check can
 * see them: `/api/ping` is the shell's own, and the two Docs routes take the `?harness=`
 * query param, which a `(state)` table entry has no way to receive. A probe checks all
 * three against the running handler too, not merely against this list.
 */
export const PORTED_INLINE = ['/api/ping', '/api/docs', '/api/docs/page/',
  '/api/jobs', '/api/jobs/'];

/**
 * The POSTs that answer outside `POST_ROUTES`, because they don't fit its shape:
 * `/api/jobs/<id>/cancel` answers 200 or 404 on a lookup, not an `ok` field, and
 * `/api/actions/<x>` spans six statuses (202, 409, 404, 501, 400, 200) over one prefix, none
 * read off `ok`. Bending the 409 column to fit either would make it lie about the routes it
 * already describes correctly.
 */
export const PORTED_POST_INLINE = ['/api/shutdown', '/api/restart', '/api/jobs/',
  '/api/actions/'];

/**
 * POST routes added after the ported reference surface was frozen. Kept separate from
 * `NOT_PORTED_POST` so that frozen record stays honest, while a new route is still
 * enumerated rather than appearing unchecked. Belongs here only once dispatched below — a
 * probe, not just this declaration, is what keeps that true.
 */
export const POST_BEYOND_REF = new Set([
  '/api/reveal',
]);

/**
 * GET routes added after the ported reference surface was frozen — the same reason
 * `POST_BEYOND_REF` above exists, one verb over. `/api/recent` is a genuine gap: no catalog
 * row carries a date and a browser cannot stat the `source` path it is handed, so "what
 * changed lately" needed a server that looks. See `apiRecent` in `api.mjs` for what it will
 * and will not date.
 */
export const GET_BEYOND_REF = new Set([
  '/api/recent',
]);

export function notPorted(path) {
  return NOT_PORTED.has(path) || NOT_PORTED_PREFIXES.some((p) => path.startsWith(p));
}

export function notPortedPost(path) {
  return NOT_PORTED_POST.has(path) || DECLINED_POST.has(path)
    || NOT_PORTED_POST_PREFIXES.some((p) => path.startsWith(p));
}

/**
 * The drained request body as a plain object, `{}` for ANYTHING else — never a raise, so a
 * malformed body becomes a 409/404 from the endpoint's own validation, not a 500.
 *
 * `parseJson`, not `JSON.parse`: a body value can be written straight into a user's file
 * (`apiProfileSave`'s `text`, `apiRulesMutate`'s `title`), and `parseJson` keeps the
 * int/float distinction plain `JSON.parse` loses (see `lib/json.mjs`).
 */
export function readJsonBody(buf) {
  let obj;
  try {
    obj = parseJson((buf && buf.length ? buf : Buffer.from('{}')).toString('utf-8'));
  } catch {
    return {};
  }
  return (obj !== null && typeof obj === 'object' && obj.constructor === Object) ? obj : {};
}

