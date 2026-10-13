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
 */
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
  const c = state._update || (state._update = { latest: null, checked_at: null, inflight: false });
  const stale = c.checked_at === null
    || now - c.checked_at > (c.latest === null ? RETRY_MS : DAY_MS);
  // Under `node --test` (NODE_TEST_CONTEXT) the real registry is never asked: the route probes in
  // tests/unit/web_server.test.mjs reach this handler, and a suite must not depend on the network.
  const off = process.env.GENESEED_NO_UPDATE_CHECK
    || (fetcher === npmLatest && process.env.NODE_TEST_CONTEXT);
  if (stale && !c.inflight && !off) {
    c.inflight = true;
    Promise.resolve()
      .then(fetcher)
      .then((v) => { c.latest = v ?? null; }, () => { c.latest = null; })
      .finally(() => { c.checked_at = now; c.inflight = false; });
  }
  const available = current && c.latest ? semverGreater(c.latest, current) : null;
  return { current: current ?? null, latest: c.latest, available, checked_at: c.checked_at };
}
