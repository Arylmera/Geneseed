/**
 * WHAT THE WEB API ANSWERS — as a declaration, separate from the dispatcher that honours it.
 *
 * Eight exported sets and one map. They are not documentation: `tests/unit/web_server.mjs` reads
 * them as a TWO-SIDED PARTITION and probes the real handler against them, because a declaration is
 * not a dispatcher — mutation M23 exists precisely because a route can be declared in one and
 * missing from the other, and nothing but a probe notices.
 *
 * Split out of `server.mjs` because it is the half a reader consults to answer "does the console
 * expose X?", which has nothing to do with sockets, daemons or gzip.
 */
import { formatValue, isTruthy, parseJson } from '../lib/json.mjs';
import { apiExcludesMutate, apiInstallToggle, apiMcpToggle, apiMemoryDelete, apiProfileSave, apiRulesMutate, apiRulesPromote, apiSelectView } from './actions.mjs';
import { apiActivityToggle } from './activity.mjs';

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
export const POST_ROUTES = new Map([
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
    [(state, b) => apiMemoryDelete(state, isTruthy(b.name) ? formatValue(b.name) : ''), false]],
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

export function notPorted(path) {
  return NOT_PORTED.has(path) || NOT_PORTED_PREFIXES.some((p) => path.startsWith(p));
}

export function notPortedPost(path) {
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
export function readJsonBody(buf) {
  let obj;
  try {
    obj = parseJson((buf && buf.length ? buf : Buffer.from('{}')).toString('utf-8'));
  } catch {
    return {};
  }
  return (obj !== null && typeof obj === 'object' && obj.constructor === Object) ? obj : {};
}

