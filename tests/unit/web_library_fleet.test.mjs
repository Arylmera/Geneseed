// THE LIBRARY OVER EVERY INSTALL: `/api/catalog/skills|agents` list each id once with the
// installs that have it, and `/api/item/` serves one install's copy — the first in fleet order
// (host order, global before project), or the one the request names.
//
// The fixture is two ACTIVE globals on one daemon: opencode (theme neutral, the daemon's view)
// and claude (imperial). Both have `fleet-shared`, with different text; only opencode has
// `fleet-oc-only`, which is what a skill excluded from the claude install looks like on disk.
// Each install is active because its config dir holds the manifest (`installState`). Assertions
// name these ids only: another detected install may add rows this file does not control.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

import { makeHandler } from '../../js/web/handler.mjs';
import { webState } from '../../js/web/state.mjs';
import { apiInstalls } from '../../js/web/api.mjs';
import { JobManager } from '../../js/web/jobs.mjs';
import { GLOBAL_MANIFEST, resolvePath } from '../../js/hosts/hosts.mjs';
import { normcase } from '../../js/lib/paths.mjs';
import { makeSandbox, restoreProcessHome, sandboxProcessHome } from '../helpers/sandbox.mjs';
import { ROOT } from '../helpers/web_fixture.mjs';

const samePath = (a, b) => normcase(resolvePath(a)) === normcase(resolvePath(b));
const MOVED = ['OPENCODE_CONFIG_DIR', 'BOB_CONFIG_DIR', 'OPENCLAUDE_CONFIG_DIR'];
const saved = {};
before(() => {
  sandboxProcessHome();
  for (const v of MOVED) { saved[v] = process.env[v]; delete process.env[v]; }
});
after(() => {
  for (const v of MOVED) {
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
  }
  restoreProcessHome();
});

const skill = (root, name, text) => {
  fs.mkdirSync(path.join(root, 'skills', name), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills', name, 'SKILL.md'), `# ${name}\n\n> ${text}\n\n${text} body\n`);
};

const agent = (root, name, text) => {
  fs.mkdirSync(path.join(root, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(root, 'agents', `${name}.md`), `# ${name}\n\n> ${text}\n\n${text} body\n`);
};
const manifest = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, GLOBAL_MANIFEST), JSON.stringify({ owned: [] }));
};

/**
 * The daemon runs with its cwd in a fresh sandbox folder (`shop`), so the cwd's project installs
 * are exactly the one a test asks for (`project`: the host whose project install `installTargets`
 * must find there, first), never the checkout's own `.claude/`. `manifests: false` leaves every
 * install inactive, for the no-fleet fallback.
 */
async function withFleetServed(fn, { project = null, manifests = true } = {}) {
  const sb = makeSandbox();
  const cl = path.join(os.homedir(), '.claude');
  const cwd = process.cwd();
  try {
    const oc = path.join(sb.path, 'oc');
    const proj = path.join(sb.path, 'shop');
    fs.mkdirSync(proj, { recursive: true });
    process.chdir(proj);
    process.env.OPENCODE_CONFIG_DIR = oc;
    fs.mkdirSync(oc, { recursive: true });
    fs.mkdirSync(cl, { recursive: true });
    if (manifests) { manifest(oc); manifest(cl); }
    fs.writeFileSync(path.join(cl, '.geneseed-emit'), 'claude-global');
    fs.writeFileSync(path.join(cl, '.geneseed-theme'), 'imperial');
    skill(oc, 'fleet-shared', 'opencode copy');
    skill(cl, 'fleet-shared', 'claude copy');
    skill(oc, 'fleet-oc-only', 'only on opencode');
    agent(oc, 'fleet-agent', 'opencode agent');
    agent(cl, 'fleet-agent', 'claude agent');
    // A project install's data dir: `<root>/.claude` for claude, and for opencode
    // `<root>/.opencode`, where the emit writes.
    const projData = project ? path.join(proj, project === 'claude' ? '.claude' : '.opencode') : null;
    if (projData) {
      manifest(projData);
      skill(projData, 'fleet-shared', 'project copy');
      skill(projData, 'fleet-proj-only', 'only in the project');
    }
    const st = webState('neutral', oc);
    const pair = (host, dir) => {
      const row = apiInstalls(st).installs.find((r) => r.host === host && samePath(r.path, dir));
      assert.ok(row, `no ${host} install row for ${dir}`);
      return { host, path: row.path };
    };
    const srv = http.createServer(makeHandler(st, new JobManager(), 'tok', path.join(ROOT, 'web', 'dist')));
    await new Promise((r) => { srv.listen(0, '127.0.0.1', r); });
    const base = `http://127.0.0.1:${srv.address().port}`;
    const get = (url, p) => fetch(`${base}${url}${p ? `?${new URLSearchParams(p)}` : ''}`);
    const ocPair = manifests ? pair('opencode', oc) : null;
    const clPair = manifests ? pair('claude', cl) : null;
    try {
      return await fn({ st, get, ocPair, clPair,
        ocKey: ocPair && `opencode:global:${ocPair.path}`, clKey: clPair && `claude:global:${clPair.path}`,
        projKey: (host) => `${host}:project:${pair(host, proj).path}` });
    } finally {
      await new Promise((r) => { srv.close(r); });
    }
  } finally {
    process.chdir(cwd);
    fs.rmSync(cl, { recursive: true, force: true });
    delete process.env.OPENCODE_CONFIG_DIR;
    sb.cleanup();
  }
}

const rowOf = (items, name) => items.find((it) => it.name === name);

test('a skill in two installs is one row naming both, opencode first', async () => {
  await withFleetServed(async ({ get, ocKey, clKey }) => {
    const { items } = await (await get('/api/catalog/skills')).json();
    assert.equal(items.filter((it) => it.name === 'fleet-shared').length, 1);
    assert.deepEqual(rowOf(items, 'fleet-shared').installs, [ocKey, clKey]);
    // The row's own text is the first install's copy.
    assert.equal(rowOf(items, 'fleet-shared').desc, 'opencode copy');
  });
});

test('a skill one install lacks lists only the install that has it', async () => {
  await withFleetServed(async ({ get, ocKey }) => {
    const { items } = await (await get('/api/catalog/skills')).json();
    assert.deepEqual(rowOf(items, 'fleet-oc-only').installs, [ocKey]);
  });
});

test('the item is the first install\'s copy by default, the named install\'s on request', async () => {
  await withFleetServed(async ({ get, clPair, ocKey, clKey }) => {
    const dflt = await (await get('/api/item/skill/fleet-shared')).json();
    assert.equal(dflt.desc, 'opencode copy');
    assert.equal(dflt.install, ocKey);
    assert.deepEqual(dflt.installs, [ocKey, clKey]);
    const named = await (await get('/api/item/skill/fleet-shared', clPair)).json();
    assert.equal(named.desc, 'claude copy');
    assert.equal(named.install, clKey);
    assert.deepEqual(named.installs, [ocKey, clKey]);
  });
});

// The UI turns a row's key back into the A2 pair by splitting on the first two colons; the
// rest is the path, byte for byte, or `installView` refuses it.
test('a catalog row\'s install key, sent back as its pair, opens that copy', async () => {
  await withFleetServed(async ({ get, clKey }) => {
    const { items } = await (await get('/api/catalog/skills')).json();
    const key = rowOf(items, 'fleet-shared').installs.find((k) => k === clKey);
    const [host, , ...rest] = key.split(':');
    const res = await get('/api/item/skill/fleet-shared', { host, path: rest.join(':') });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).desc, 'claude copy');
  });
});

test('an install that lacks the id, or an unknown install, is refused with 404', async () => {
  await withFleetServed(async ({ get, clPair }) => {
    assert.equal((await get('/api/item/skill/fleet-oc-only', clPair)).status, 404);
    assert.equal((await get('/api/item/skill/fleet-shared', { host: 'claude', path: '/no/such' })).status, 404);
    assert.equal((await get('/api/item/skill/fleet-shared', { host: 'nope', path: clPair.path })).status, 404);
  });
});

// Machine-wide: the skills, agents, memory and notebook lists ignore a pair (memory and notebook
// joined them so each fact names its own install), while a per-install section still refuses one.
test('the fleet lists ignore a named install; the wiki list still checks it', async () => {
  await withFleetServed(async ({ get }) => {
    const bad = { host: 'nope', path: '/no/such' };
    for (const sec of ['skills', 'agents', 'memory', 'notebook']) {
      assert.equal((await get(`/api/catalog/${sec}`, bad)).status, 200, sec);
    }
    assert.equal((await get('/api/catalog/wiki', bad)).status, 404);
  });
});

test('agents are one row per name too, and the item is the first install\'s copy', async () => {
  await withFleetServed(async ({ get, clPair, ocKey, clKey }) => {
    const { items } = await (await get('/api/catalog/agents')).json();
    assert.deepEqual(rowOf(items, 'fleet-agent').installs, [ocKey, clKey]);
    const dflt = await (await get('/api/item/agent/fleet-agent')).json();
    assert.equal(dflt.desc, 'opencode agent');
    assert.equal(dflt.install, ocKey);
    assert.equal((await (await get('/api/item/agent/fleet-agent', clPair)).json()).desc, 'claude agent');
  });
});

// `installTargets` yields the cwd's project installs FIRST; the fleet sorts by host, then global
// before project. Unsorted, the claude project would lead every row and be the default copy.
test('a cwd project install sorts after the globals, and is not the default copy', async () => {
  await withFleetServed(async ({ get, ocKey, clKey, projKey }) => {
    const cp = projKey('claude');
    const { items } = await (await get('/api/catalog/skills')).json();
    assert.deepEqual(rowOf(items, 'fleet-shared').installs, [ocKey, clKey, cp]);
    assert.deepEqual(rowOf(items, 'fleet-proj-only').installs, [cp]);
    assert.equal((await (await get('/api/item/skill/fleet-shared')).json()).install, ocKey);
    const only = await (await get('/api/item/skill/fleet-proj-only')).json();
    assert.equal(only.desc, 'only in the project');
    assert.equal(only.install, cp);
  }, { project: 'claude' });
});

// No active install: the daemon state answers alone, rendered from source, and keyless.
test('with no active install, the lists and the item fall back to the daemon state', async () => {
  await withFleetServed(async ({ get }) => {
    const { items } = await (await get('/api/catalog/skills')).json();
    assert.ok(items.length > 0, 'the source render listed no skill');
    assert.deepEqual(items.filter((it) => it.installs.length > 0), []);
    const it = await (await get(`/api/item/skill/${encodeURIComponent(items[0].name)}`)).json();
    assert.equal(it.install, null);
    assert.deepEqual(it.installs, []);
  }, { manifests: false });
});

// F1: an OpenCode PROJECT install keeps its files in `<root>/.opencode` (`deployedLayer`,
// js/web/catalog.mjs). Read from `<root>` instead, the project's own skills went missing here.
test('an opencode project install lists its own skills', async () => {
  await withFleetServed(async ({ get, ocKey, clKey, projKey }) => {
    const op = projKey('opencode');
    const { items } = await (await get('/api/catalog/skills')).json();
    assert.deepEqual(rowOf(items, 'fleet-proj-only')?.installs, [op]);
    assert.deepEqual(rowOf(items, 'fleet-shared').installs, [ocKey, op, clKey]);
  }, { project: 'opencode' });
});
