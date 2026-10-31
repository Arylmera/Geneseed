/**
 * WHAT THE WEB API ANSWERS — as a declaration, separate from the dispatcher that honours it.
 *
 * Four tables, two inline lists, and the two install-scope sets (`VIEW_POSTS`, `MACHINE_GETS`).
 * The two GET tables (`STATE_ROUTES`, `PREFIX_ROUTES`) used to live in `api.mjs`, which made it
 * import every route module that also imported it. None of this is documentation:
 * `tests/unit/web_server.test.mjs` holds their union against a surface list written out in the
 * test, and probes the real handler, because a declaration is not a dispatcher — a route can be
 * declared here and missing from the dispatch, and nothing but a probe notices.
 *
 * This file used to also carry the Python→Node port's NOT_PORTED / DECLINED partition — five
 * sets, all empty once the port finished. They were deleted when the port bookkeeping retired
 * (see git history); an unmatched GET falls through to `serveStatic`'s SPA fallback and an
 * unmatched POST answers 404, which is what the empty sets already produced.
 *
 * Split out of `server.mjs` because it is the half a reader consults to answer "does the console
 * expose X?", which has nothing to do with sockets, daemons or gzip.
 */
import { installTargets } from '../hosts/installs.mjs';
import { formatValue, isTruthy, parseJson } from '../lib/json.mjs';
import { percentDecode } from '../lib/text.mjs';
import { apiExcludesMutate, apiInstallToggle, apiLoopsPresetMutate, apiMcp, apiMemoryDelete, targetView } from './actions.mjs';
import { apiActivity, apiActivityDetail, apiActivityToggle } from './activity.mjs';
import {
  apiDiff, apiDoctor, apiExcludes, apiFleet, apiInstalls, apiKits, apiLoops, apiLoopsActive, apiOverview,
  apiRecent, apiSetup, apiThemes, activeInstalls, apiUpdate,
} from './api.mjs';
import { FLEET_SECTIONS, NotFound, apiCatalog, apiItem } from './catalog.mjs';
import { apiUsage } from './usage-api.mjs';
import { fleetSort } from './state.mjs';
import { apiGates } from './gates-api.mjs';
import { apiProfile, apiProfileSave, apiRules, apiRulesMutate, apiRulesPromote } from './user-files.mjs';

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
/** @type {Map<string, [(state: any, body: any) => any, boolean]>} */
export const POST_ROUTES = new Map([
  ['/api/install', [apiInstallToggle, true]],
  ['/api/excludes', [apiExcludesMutate, true]],
  ['/api/activity', [apiActivityToggle, false]],
  // The dispatch wrapper resolves `name` from the body itself; `apiMemoryDelete` takes a bare
  // slug string, not the body object, unlike the other routes here.
  ['/api/memory/delete',
    [(state, b) => apiMemoryDelete(state, isTruthy(b.name) ? formatValue(b.name) : ''), false]],
  ['/api/rules', [apiRulesMutate, true]],
  ['/api/rules/promote', [apiRulesPromote, true]],
  ['/api/profile', [apiProfileSave, true]],
  // No `ok: false` arm: success returns `{ok: true, loop}`, and both refusals (unknown root,
  // unknown preset) throw `NotFound`, which `doPost`'s catch answers 404 before this column is
  // ever consulted — the same shape as `/api/memory/delete` and `/api/activity` above.
  ['/api/loops/preset', [apiLoopsPresetMutate, false]],
]);

/**
 * The POSTs whose body `{host, path}` names the install they act on (`installView`), opt-in
 * rather than every POST: in `/api/install` and `/api/actions/install` the pair is
 * the target the route resolves itself, and in `/api/actions/deploy`, `/api/excludes` and
 * `/api/reveal` a `path` is a folder or a config file, not an install. The two `actions/` rows
 * are the only actions that read the request's install.
 */
export const VIEW_POSTS = new Set(['/api/activity', '/api/memory/delete', '/api/rules',
  '/api/rules/promote', '/api/profile', '/api/actions/restore', '/api/actions/build']);

/**
 * The GETs that answer for the whole machine, not one install: they IGNORE a `?host=&path=`
 * pair (it is neither checked nor used) and always read the daemon's state. Ignored rather
 * than refused, so a client may send its install on every read. On the daemon's state, not a
 * view, because `/api/update` keeps its daily check and the `.git`-lock guard
 * (`_behind.inflight`) there, and the update job checks only that one. `/api/activity` merges
 * every active install's sessions; its detail (`/api/activity/<sid>`, a prefix route) and its
 * toggle (a `VIEW_POSTS` write) still take the pair. Every other `/api/*` GET, ping and jobs
 * aside, takes the pair and refuses an unknown one.
 *
 * The Library's fleet lists (`/api/catalog/skills|agents|memory|notebook`) are here because they
 * read every active install (`fleetOf`), which caches one view per install on the daemon state;
 * the other catalog sections, and `/api/item/`, stay install-scoped (`PREFIX_ROUTES`).
 */
export const MACHINE_GETS = new Set(['/api/update', '/api/installs', '/api/fleet', '/api/kits',
  '/api/usage', '/api/gates', '/api/excludes', '/api/mcp', '/api/loops/active', '/api/activity',
  '/api/catalog/skills', '/api/catalog/agents', '/api/catalog/memory', '/api/catalog/notebook']);

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

/**
 * Every ACTIVE install as `{install, state}`, the Library's skills and agents source: `install`
 * is the usage ledger's `host:scope:root` key, `state` the install's cached view off the daemon
 * state `base` (`targetView`), so each install keeps its own inventory cache. ONE
 * `installTargets()` scan: the targets it yields are the allowlist, so no view re-checks its
 * pair the way a request-named one must (`installView`). In the console's install order
 * (`fleetSort`), not as `installTargets` yields, which puts the cwd's projects first. No active install leaves `base` alone, keyless, as one install answered.
 */
function fleetOf(base) {
  const views = fleetSort([...activeInstalls(installTargets())], (t) => [t[0], t[1]])
    .map(([host, scope, root]) => ({ install: `${host}:${scope}:${root}`,
      state: targetView(base, [host, scope, root]) }));
  return views.length ? views : [{ install: null, state: base }];
}

/**
 * The prefix routes — path in, response out. `base` is the daemon's own state, which `state`
 * is when the request named no install: the fleet's views are cached there, never on a view.
 *
 * `percentDecode` and not `decodeURIComponent`: the JS builtin throws a `URIError` on a `%`
 * that is not an escape, where this shell instead answers a 404 naming the literal text.
 */
/** @type {Array<[string, (state: any, path: string, base: any) => any]>} */
export const PREFIX_ROUTES = [
  // Skills and agents list every install (`MACHINE_GETS`); the other sections the named one.
  ['/api/catalog/', (state, p, base) => {
    const sec = p.split('/').pop();
    return apiCatalog(state, sec, FLEET_SECTIONS.includes(sec) ? fleetOf(base) : undefined);
  }],
  // /api/item/<type>/<name> — TYPE has no slash, the NAME keeps its slashes so a wiki
  // page's relpath survives. A missing name is a 404 here rather than a 500 two frames down.
  // Install-scoped: a skill or agent is the named install's copy, else the fleet's first.
  ['/api/item/', (state, p, base) => {
    const m = /^\/api\/item\/([^/]+)\/(.+)$/.exec(p);
    if (!m) throw new NotFound(p);
    const fleet = ['skill', 'agent', 'memory', 'notebook'].includes(m[1]) ? fleetOf(base) : undefined;
    return apiItem(state, m[1], percentDecode(m[2]), fleet);
  }],
  // The sid is passed through unquoted — `apiActivityDetail`'s safe-name scheme is what
  // makes the lookup safe, rather than a check out here.
  ['/api/activity/', (state, p) => apiActivityDetail(
    state, percentDecode(p.slice('/api/activity/'.length)))],
];

/**
 * A literal path to `api_X(state)`, table-keyed rather than a chain of `if`s — the reason
 * it is a table is `tests/unit/web_server.test.mjs`'s cross-check, which requires this
 * table plus `PREFIX_ROUTES` and `GET_INLINE` to equal a surface list written out in the
 * test, so a route cannot appear or vanish unenumerated.
 */
export const STATE_ROUTES = {
  '/api/overview': apiOverview,
  '/api/recent': apiRecent,
  '/api/themes': apiThemes,
  '/api/setup': apiSetup,
  // The one route here that reads its query: `?fresh=1` re-runs instead of serving the cache.
  '/api/doctor': (state, url) => apiDoctor(state,
    new URL(url || '', 'http://x').searchParams.has('fresh')),
  '/api/installs': apiInstalls,
  '/api/fleet': apiFleet,
  '/api/kits': apiKits,
  '/api/update': apiUpdate,
  '/api/usage': apiUsage,
  '/api/gates': apiGates,
  '/api/excludes': apiExcludes,
  '/api/profile': apiProfile,
  '/api/diff': apiDiff,
  '/api/activity': apiActivity,
  // `/api/rules` must exist as a PAIR with its POST: `apiRulesMutate` splices `parseRules`'
  // line indices, and the fingerprint every mutation must send back is what this GET
  // answers — a daemon whose POST worked and whose GET 501'd would have no way to obtain one.
  '/api/rules': apiRules,
  '/api/mcp': apiMcp,
  '/api/loops': apiLoops,
  '/api/loops/active': apiLoopsActive,
};
