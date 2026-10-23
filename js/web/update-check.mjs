/**
 * IS A NEWER GENESEED RELEASED? — the Overview's "4.2.0 available" chip.
 *
 * Route handlers answer synchronously, so this never waits on the network: it answers from the
 * last result it holds and, when that is missing or a day old, starts ONE background fetch whose
 * answer the next poll reads. The console refetches after every mutation and on mount, so the
 * chip appears within a poll or two of the daemon starting.
 *
 * Every failure is `latest: null` and says nothing more: a corporate proxy, an offline laptop and
 * a registry outage all read "update check unavailable", never an error. `GENESEED_NO_UPDATE_CHECK`
 * turns the fetch off for a machine that must not phone out at all.
 *
 * ponytail: the cache lives on the daemon's state, in memory. A restart costs one more request;
 * a disk cache would be a file to version for a figure that is free to re-ask.
 *
 * THE SAME FILE ANSWERS TWO MORE QUESTIONS the Update button needs: HOW this copy was installed
 * (`installKind`, so the button runs the route that can update it) and, for a clone, whether
 * upstream has anything to pull (`gitBehind`, the clone's own "up to date" — a release label
 * says nothing about `main`, which moves between releases).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';

import { ROOT } from '../build/source.mjs';
import { measureUpstream } from '../maintain/update.mjs';
import { normcase, which } from '../lib/paths.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
/** A failed ask is retried sooner than a good answer is refreshed: a proxy hiccup is not a day. */
const RETRY_MS = 60 * 60 * 1000;
const REGISTRY = 'https://registry.npmjs.org/geneseed/latest';

/** x.y.z only; a pre-release tag or a malformed label compares as nothing newer. */
export function semverGreater(a, b) {
  const parse = (v) => (/^(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim()) || []).slice(1).map(Number);
  const x = parse(a);
  const y = parse(b);
  if (x.length !== 3 || y.length !== 3) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

async function npmLatest() {
  const res = await fetch(REGISTRY, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) return null;
  const body = await res.json();
  return typeof body?.version === 'string' ? body.version : null;
}

/**
 * `{ current, latest, available, checked_at }`. `available` is true only when `latest` is
 * semver-greater than `current`, so a checkout ahead of the last release never shows one;
 * null when either side is unknown. `fetcher` and `now` are injectable for the tests, which
 * must never reach the network.
 */
export function updateStatus(state, current, { fetcher = npmLatest, now = Date.now() } = {}) {
  // Under `node --test` (NODE_TEST_CONTEXT) the real registry is never asked: the route probes in
  // tests/unit/web_server.test.mjs reach this handler, and a suite must not depend on the network.
  const c = daily(state, '_update', fetcher, now,
    fetcher === npmLatest && process.env.NODE_TEST_CONTEXT);
  const available = current && c.value ? semverGreater(c.value, current) : null;
  return { current: current ?? null, latest: c.value, available, checked_at: c.checked_at };
}

/**
 * The once-a-day cache both checks share: answer from `state[slot]` at once and, when that is
 * missing or stale, start ONE background ask whose answer the next poll reads. A null answer
 * (every failure) is re-asked after RETRY_MS, a good one after DAY_MS.
 */
function daily(state, slot, ask, now, off) {
  const c = state[slot] || (state[slot] = { value: null, checked_at: null, inflight: false });
  const stale = c.checked_at === null
    || now - c.checked_at > (c.value === null ? RETRY_MS : DAY_MS);
  if (stale && !c.inflight && !off && !process.env.GENESEED_NO_UPDATE_CHECK) {
    c.inflight = true;
    Promise.resolve()
      .then(ask)
      .then((v) => { c.value = v ?? null; }, () => { c.value = null; })
      .finally(() => { c.checked_at = now; c.inflight = false; });
  }
  return c;
}

/** `measureUpstream`'s verdict as a count: 0 up to date, N to pull, null when unknown. */
async function fetchBehind() {
  const [code, behind] = await measureUpstream();
  if (code === 'uptodate') return 0;
  return code === 'ready' ? behind : null;
}

/**
 * Commits the clone's upstream holds that it does not: `upgrade`'s own `git fetch` (timeboxed by
 * `GENESEED_NET_TIMEOUT`, 120 s by default) then a count, once a day, in the background. Null
 * until the first answer lands and on every failure — an unreachable remote, no upstream, a
 * branch that diverged — and the console then keeps its "a clone can always pull" button.
 *
 * `busy` skips the ask while a job runs: a fetch beside the update job's own pull would race it
 * for `.git` locks. `measure` and `now` are injectable for the tests.
 */
export function gitBehind(state, { measure = fetchBehind, now = Date.now(), busy = false } = {}) {
  return daily(state, '_behind', measure, now,
    busy || (measure === fetchBehind && process.env.NODE_TEST_CONTEXT)).value;
}

/** The command the console shows for a copy it cannot update itself. */
export const MANUAL_UPDATE = 'npm install -g geneseed@latest';

/** `npm root -g`, or null when npm is absent or does not answer. Asked once per daemon. */
export function npmGlobalRoot() {
  const npm = which('npm');
  if (!npm) return null;
  const win = process.platform === 'win32';
  // `shell` on Windows for the reason `npmBuild` gives (js/web/server.mjs): `npm` resolves to
  // `npm.cmd`, which Node refuses to spawn directly. The argv is a constant.
  const r = spawnSync(win ? `"${npm}"` : npm, ['root', '-g'], {
    encoding: 'utf8', shell: win, timeout: 15000, windowsHide: true,
  });
  const out = r.status === 0 ? String(r.stdout || '').trim() : '';
  return out || null;
}

/** The real path, so a symlinked prefix and the folder it points at compare equal. */
const real = (p) => {
  try {
    return normcase(realpathSync.native(p));
  } catch {
    return normcase(path.resolve(p));
  }
};

let kindMemo = null;
/**
 * `git` (a clone or a worktree: `.git` is a folder in one, a file in the other), `npm-global`
 * (this package IS `<npm root -g>/geneseed`), or `other` — an npx cache, a project's own
 * `node_modules`, a vendored or unzipped copy — which the console cannot update itself.
 *
 * `npm root -g` is asked only when the parent folder is a `node_modules`, so a clone never pays
 * for the spawn, and the answer is kept for the process: `ROOT` never moves under it.
 * `root`/`npmRoot` are injectable for the tests, and an injected call is not kept.
 */
export function installKind({ root = ROOT, npmRoot = npmGlobalRoot } = {}) {
  const mine = root === ROOT && npmRoot === npmGlobalRoot;
  if (mine && kindMemo) return kindMemo;
  let kind = 'other';
  let unanswered = false;
  if (existsSync(path.join(root, '.git'))) kind = 'git';
  else if (path.basename(path.dirname(root)).toLowerCase() === 'node_modules') {
    const g = npmRoot();
    unanswered = !g;
    if (g && real(g) === real(path.dirname(root))) kind = 'npm-global';
  }
  // An npm that did not answer (a timeout, npm briefly off PATH) is asked again next poll, so
  // one bad moment does not hide the button until the daemon restarts.
  if (mine && !unanswered) kindMemo = kind;
  return kind;
}
