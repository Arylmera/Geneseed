/**
 * WHAT THE WEB API ANSWERS — as a declaration, separate from the dispatcher that honours it.
 *
 * Two tables and two inline lists. They are not documentation: `tests/unit/web_server.test.mjs`
 * holds their union against a surface list written out in the test, and probes the real handler,
 * because a declaration is not a dispatcher — a route can be declared here and missing from the
 * dispatch, and nothing but a probe notices.
 *
 * This file used to also carry the Python→Node port's NOT_PORTED / DECLINED partition — five
 * sets, all empty once the port finished. They were deleted when the port bookkeeping retired
 * (see git history); an unmatched GET falls through to `serveStatic`'s SPA fallback and an
 * unmatched POST answers 404, which is what the empty sets already produced.
 *
 * Split out of `server.mjs` because it is the half a reader consults to answer "does the console
 * expose X?", which has nothing to do with sockets, daemons or gzip.
 */
import { formatValue, isTruthy, parseJson } from '../lib/json.mjs';
import { apiExcludesMutate, apiInstallToggle, apiMcpToggle, apiMemoryDelete, apiProfileSave, apiRulesMutate, apiRulesPromote, apiSelectView } from './actions.mjs';
import { apiActivityToggle } from './activity.mjs';

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
 * The GET paths answered OUTSIDE the two tables, declared so the surface cross-check can
 * see them: `/api/ping` is the shell's own, and the two Docs routes take the `?harness=`
 * query param, which a `(state)` table entry has no way to receive. A probe checks all
 * three against the running handler too, not merely against this list.
 */
export const GET_INLINE = ['/api/ping', '/api/docs', '/api/docs/page/',
  '/api/jobs', '/api/jobs/'];

/**
 * The POSTs that answer outside `POST_ROUTES`, because they don't fit its shape:
 * `/api/jobs/<id>/cancel` answers 200 or 404 on a lookup, not an `ok` field, and
 * `/api/actions/<x>` spans five statuses (202, 409, 404, 400, 200) over one prefix, none
 * read off `ok`. Bending the 409 column to fit either would make it lie about the routes it
 * already describes correctly. `/api/reveal` answers 200/404 on an allowlist lookup, and
 * `/api/pick-folder` cannot fit the table's `fn(state, body) -> object` shape at all: it
 * spawns a native folder dialog and answers only once a human (or a timeout) closes it. See
 * `apiPickFolder` in `js/web/actions.mjs`, dispatched inline from `js/web/handler.mjs`'s
 * `doPost` the same way the other rows here are.
 */
export const POST_INLINE = ['/api/shutdown', '/api/restart', '/api/jobs/',
  '/api/actions/', '/api/pick-folder', '/api/reveal'];

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

