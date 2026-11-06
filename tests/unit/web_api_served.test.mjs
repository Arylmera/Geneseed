// THE WEB API'S FUNCTIONS, IN PROCESS — two installs served on one daemon.
// One of the `web_api*.test.mjs` files split from a single file; shared fixtures live in
// `tests/helpers/web_api_fixture.mjs`.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { installView } from '../../js/web/actions.mjs';
import { RULES_FILE } from '../../js/web/user-files.mjs';
import { GLOBAL_MANIFEST } from '../../js/hosts/hosts.mjs';
import { sharedPaths } from '../../js/lib/machine-dir.mjs';
import { TMP_ROOT } from '../helpers/sandbox.mjs';
import {
  MACHINE_GETS, POST_ROUTES, PREFIX_ROUTES, STATE_ROUTES, VIEW_POSTS,
} from '../../js/web/routes.mjs';
import { dropSandboxTier, webFixtureTeardown } from '../helpers/web_fixture.mjs';
import {
  withTwoViewsServed, seedFact, readLf, samePath,
} from '../helpers/web_api_fixture.mjs';

after(webFixtureTeardown);

test('two installs answer with their own data on one daemon', async () => {
  await withTwoViewsServed(async ({ st, oc, cl, ocPair, clPair, get, post }) => {
    // `/api/themes` carries the viewed install's theme and emit, `/api/setup` its target.
    const claude = (await (await get('/api/themes', clPair)).json()).current;
    assert.equal(claude.theme, 'imperial', 'the claude request was not answered from ~/.claude');
    assert.equal(claude.emit, 'claude-global');
    assert.ok(samePath((await (await get('/api/setup', clPair)).json()).target, cl));
    const opencode = (await (await get('/api/themes', ocPair)).json()).current;
    assert.equal(opencode.theme, 'neutral');
    assert.equal(opencode.emit, 'opencode-global');
    assert.ok(samePath((await (await get('/api/setup', ocPair)).json()).target, oc));

    // A write lands in the install its body names, and only there.
    const res = await post('/api/profile', { ...clPair, fingerprint: '', text: 'claude only' });
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    // `readLf`: the write uses the platform's line ending.
    assert.equal(readLf(path.join(cl, 'PROFILE.md')), 'claude only\n');
    assert.equal(fs.existsSync(path.join(oc, 'PROFILE.md')), false, 'the write leaked into opencode');
    assert.equal((await (await get('/api/profile', clPair)).json()).text, 'claude only\n');
    assert.equal((await (await get('/api/profile', ocPair)).json()).exists, false);

    // Nothing of that moved the daemon's own view.
    assert.ok(samePath(st.target, oc), 'a per-request install re-pointed the global view');
    assert.equal(st.theme, 'neutral');
  });
});

test('an unknown or half (host, path) pair is refused with 404', async () => {
  await withTwoViewsServed(async ({ oc, clPair, get, post }) => {
    for (const p of [{ host: 'claude', path: oc }, { host: 'claude', path: '/no/such/root' },
      { host: 'nope', path: clPair.path }, { host: 'claude' }, { path: clPair.path },
      { host: '', path: '' }]) {
      assert.equal((await get('/api/setup', p)).status, 404, `GET ${JSON.stringify(p)} was answered`);
      // The one per-install section; the Library's kinds are machine-wide and ignore it.
      assert.equal((await get('/api/catalog/laws', p)).status, 404, `catalog ${JSON.stringify(p)}`);
    }
    const res = await post('/api/profile', { host: 'claude', path: '/no/such/root',
      fingerprint: '', text: 'x' });
    assert.equal(res.status, 404);
    assert.equal(fs.existsSync(path.join(oc, 'PROFILE.md')), false, 'a refused write fell through');
  });
});

// A request naming no install reads the DEFAULT install (`defaultView`): opencode while it is the
// first active one. There is no selector to move it (`POST /api/view` is gone: 404); it moves
// when the installs do — opencode switched off, claude active — on the next full refresh.
test('a request naming no install answers for the default install', async () => {
  await withTwoViewsServed(async ({ st, oc, cl, clPair, get, post }) => {
    assert.equal((await (await get('/api/themes')).json()).current.theme, 'neutral');
    assert.ok(samePath((await (await get('/api/setup')).json()).target, oc));
    assert.equal((await post('/api/view', clPair)).status, 404, 'the view selector still answers');
    assert.ok(samePath(st.target, oc));

    fs.rmSync(path.join(oc, GLOBAL_MANIFEST));
    fs.writeFileSync(path.join(cl, GLOBAL_MANIFEST), JSON.stringify({ owned: [] }));
    st.refresh();
    assert.equal((await (await get('/api/themes')).json()).current.theme, 'imperial');
    assert.ok(samePath((await (await get('/api/setup')).json()).target, cl));
  });
});

// The chosen default through the real route: a request naming no install follows it at once, a
// view pinned to another install does not, and the route's refusal is the 409 arm.
test('POST /api/default-install moves what an unnamed request reads', async () => {
  await withTwoViewsServed(async ({ st, oc, cl, ocPair, clPair, get, post }) => {
    const pin = installView(st, ocPair);
    const refused = await post('/api/default-install', clPair);
    assert.equal(refused.status, 409, 'claude has no manifest here, so it is not active');
    assert.deepEqual(await refused.json(), { ok: false, error: 'not an active install (host, path)' });

    fs.writeFileSync(path.join(cl, GLOBAL_MANIFEST), JSON.stringify({ owned: [] }));
    const file = sharedPaths().defaultInstall;
    assert.ok(file.startsWith(TMP_ROOT), `the pick file is outside the sandbox: ${file}`);
    try {
      assert.equal((await post('/api/default-install', clPair)).status, 200);
      assert.ok(samePath((await (await get('/api/setup')).json()).target, cl));
      assert.equal((await (await get('/api/themes')).json()).current.theme, 'imperial');
      assert.ok(samePath(pin.target, oc), 'the pick re-pointed a pinned view');
      const rows = (await (await get('/api/installs')).json()).installs;
      assert.deepEqual(rows.filter((r) => r.default).map((r) => r.host), ['claude']);

      assert.equal((await post('/api/default-install', {})).status, 409, 'an empty body cleared the pick');
      assert.ok(samePath((await (await get('/api/setup')).json()).target, cl));
    } finally { dropSandboxTier(); } // the pick's folder would read as a tier in the next test
  });
});

// `refresh` moves the daemon state to the default install (`defaultView`) when it is elsewhere. The
// claude install here has no manifest, so an unpinned state would jump to opencode.
test('a per-install view is pinned: refresh never re-points it at another install', async () => {
  await withTwoViewsServed(async ({ st, cl, clPair }) => {
    const v = installView(st, clPair);
    assert.equal(installView(st, clPair), v, 'the per-install state is not cached');
    st.refresh();
    assert.ok(samePath(v.target, cl), 'refresh re-pointed a pinned view');
    assert.equal(v.theme, 'imperial');
    assert.equal(installView(st, {}), st, 'naming nothing is not the daemon state');
  });
});

// Every write route that reads an install (`VIEW_POSTS`), named at the claude install: the effect
// lands under ~/.claude and the opencode install (the daemon's view) is untouched. `build` is not
// run: a stub job manager records the argv it would have started.
test('each install-reading write acts on the install its body names', async () => {
  const started = [];
  const jm = { busy: false, recent: () => [], get: () => null, cancel: () => false,
    start: (action, cmds) => { started.push(JSON.stringify(cmds)); return 'j1'; } };
  await withTwoViewsServed(async ({ oc, cl, clPair, get, post }) => {
    seedFact(cl);
    seedFact(oc);
    const ok = async (res) => {
      assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
      return res.json();
    };

    await ok(await post('/api/activity', { ...clPair, enabled: false }));
    assert.equal(fs.readFileSync(path.join(cl, '.geneseed-activity'), 'utf8'), 'off');
    assert.equal(fs.existsSync(path.join(oc, '.geneseed-activity')), false, 'activity: wrong install');

    const fp = (await (await get('/api/rules', clPair)).json()).fingerprint;
    await ok(await post('/api/rules', { ...clPair, op: 'add', fingerprint: fp, title: 'Claude rule',
      body: 'Only here.' }));
    assert.match(readLf(path.join(cl, RULES_FILE)), /Claude rule/);
    assert.equal(fs.existsSync(path.join(oc, RULES_FILE)), false, 'rules: wrong install');

    const fp2 = (await (await get('/api/rules', clPair)).json()).fingerprint;
    await ok(await post('/api/rules/promote', { ...clPair, name: 'fact', fingerprint: fp2 }));
    assert.match(readLf(path.join(cl, RULES_FILE)), /The fact body\./);
    assert.equal(fs.existsSync(path.join(oc, RULES_FILE)), false, 'promote: wrong install');

    await ok(await post('/api/memory/delete', { ...clPair, name: 'fact' }));
    assert.equal(fs.existsSync(path.join(cl, 'memory', 'fact.md')), false);
    assert.equal(fs.existsSync(path.join(oc, 'memory', 'fact.md')), true, 'memory: wrong install');

    // Restore refuses an install with no manifest: claude has none, the daemon's opencode has one.
    const restored = await ok(await post('/api/actions/restore', { ...clPair, files: [] }));
    assert.deepEqual(restored.errors, ['no deployed harness'], 'restore ran on the daemon install');

    assert.equal((await post('/api/actions/build', { ...clPair })).status, 202);
    assert.equal((await post('/api/actions/build', {})).status, 202);
    assert.equal(started.length, 2);
    assert.ok(started[0].includes('claude-global') && started[0].includes('imperial'),
      `the claude build is not the claude install's: ${started[0]}`);
    assert.ok(!started[1].includes('claude-global'), 'the unnamed build left the daemon install');
  }, { jm });
});

// `doAction` dispatches on the LAST path segment, so the install lookup must too: otherwise
// `/api/actions/x/restore` restores the daemon's install while the body names another.
test('a multi-segment action path still acts on the install its body names', async () => {
  await withTwoViewsServed(async ({ clPair, post }) => {
    const res = await post('/api/actions/x/restore', { ...clPair, files: [] });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).errors, ['no deployed harness'],
      'the restore ran on the daemon install, not the one the body names');
    assert.equal((await post('/api/actions/x/restore', { host: 'claude', path: '/no/such',
      files: [] })).status, 404);
  });
});

// A write through one state refreshes the other: they may show the same files.
test('a write through a view refreshes the daemon state, and the reverse', async () => {
  await withTwoViewsServed(async ({ st, oc, cl, clPair, post }) => {
    seedFact(cl);
    seedFact(oc);
    const v = installView(st, clPair);
    st._inv = { stale: true };
    v._inv = { stale: true };
    assert.equal((await post('/api/memory/delete', { ...clPair, name: 'fact' })).status, 200);
    assert.equal(st._inv, null, 'a write through the view left the daemon inventory stale');
    assert.equal(v._inv, null);

    st._inv = { stale: true };
    v._inv = { stale: true };
    assert.equal((await post('/api/memory/delete', { name: 'fact' })).status, 200);
    assert.equal(v._inv, null, 'a write through the daemon state left the view stale');
    assert.equal(st._inv, null);
  });
});

// The marker and the unnamed reads never disagree: reading /api/installs, where the console learns
// which row is `default`, moves the daemon state to it, with no full refresh in between.
test('reading the install list moves unnamed requests to the marked default', async () => {
  await withTwoViewsServed(async ({ oc, cl, get }) => {
    fs.rmSync(path.join(oc, GLOBAL_MANIFEST));
    fs.writeFileSync(path.join(cl, GLOBAL_MANIFEST), JSON.stringify({ owned: [] }));
    const rows = (await (await get('/api/installs')).json()).installs;
    assert.deepEqual(rows.filter((r) => r.default).map((r) => r.host), ['claude']);
    assert.equal((await (await get('/api/themes')).json()).current.theme, 'imperial');
  });
});

// Memory and notebook are listed across every active install (Q3): one row per name with the
// installs that hold it, in fleet order, and an entry is read from the named install's copy, so a
// forget or a promote can name the install the fact came from.
test('memory lists every active install, and an entry reads its named copy', async () => {
  await withTwoViewsServed(async ({ oc, cl, ocPair, clPair, get }) => {
    fs.writeFileSync(path.join(cl, GLOBAL_MANIFEST), JSON.stringify({ owned: [] }));
    seedFact(oc);
    seedFact(cl);
    fs.writeFileSync(path.join(cl, 'memory', 'only-claude.md'), '---\nname: Only\n---\nClaude only.\n');
    const key = (p, host, scope) => `${host}:${scope}:${p.path}`;
    const ocKey = key(ocPair, 'opencode', 'global');
    const clKey = key(clPair, 'claude', 'global');
    const rows = (await (await get('/api/catalog/memory')).json()).items;
    const by = Object.fromEntries(rows.map((r) => [r.name, r.installs]));
    assert.deepEqual(by.fact, [ocKey, clKey]);
    assert.deepEqual(by['only-claude'], [clKey]);
    const first = await (await get('/api/item/memory/only-claude')).json();
    assert.equal(first.install, clKey, 'an entry one install holds was not read from it');
    const named = await (await get('/api/item/memory/fact', clPair)).json();
    assert.deepEqual([named.install, named.installs], [clKey, [ocKey, clKey]]);
  });
});

test('an install no longer detected is refused even when its view is cached', async () => {
  await withTwoViewsServed(async ({ st, ocPair, get }) => {
    assert.equal((await get('/api/setup', ocPair)).status, 200);
    assert.equal(st._views.size, 1, 'the view was not cached');
    // The opencode global now resolves elsewhere: the old pair is no longer an install.
    process.env.OPENCODE_CONFIG_DIR = path.join(path.dirname(ocPair.path), 'moved');
    assert.equal((await get('/api/setup', ocPair)).status, 404);
  });
});

// The machine-wide reads IGNORE a pair: neither checked nor used, so `/api/update`'s check and its
// `.git`-lock guard stay on the daemon state alone. The routes probed below make no view; the
// Library's `/api/catalog/skills|agents` do (one per active install, on the daemon state, never
// from the pair), so they are not probed here — `web_library_fleet.test.mjs` covers them. Each
// is a GET route: a table route, or a prefix route's path.
test('the machine-wide reads ignore a named install', async () => {
  for (const r of MACHINE_GETS) {
    assert.ok(r in STATE_ROUTES || PREFIX_ROUTES.some(([p]) => r.startsWith(p)), `${r} is not a GET route`);
  }
  for (const r of VIEW_POSTS) {
    const key = r.startsWith('/api/actions/') ? null : r;
    if (key) assert.ok(POST_ROUTES.has(key), `${r} is not a POST route`);
  }
  await withTwoViewsServed(async ({ st, clPair, get }) => {
    // `/api/update` makes no network ask under `node --test` (`NODE_TEST_CONTEXT`).
    for (const r of ['/api/update', '/api/installs', '/api/fleet', '/api/mcp', '/api/excludes']) {
      assert.equal((await get(r, { host: 'nope', path: '/no/such' })).status, 200, r);
      assert.equal((await get(r, clPair)).status, 200, r);
    }
    assert.deepEqual(await (await get('/api/installs', clPair)).json(),
      await (await get('/api/installs')).json(), 'a machine-wide read used the pair');
    assert.equal(st._views.size, 0, 'a machine-wide read made a per-install view');
  });
});
