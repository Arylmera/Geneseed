// S5: the web console reads and writes the shared tier on a global install, and uninstall never
// reaches it. Every test here populates the tier first: an assertion that "the tier survived"
// over an empty one passes by describing an absence nobody created (D8, B5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT } from '../../js/build/source.mjs';
import { cmdUninstall, installUninstall } from '../../js/maintain/uninstall.mjs';
import { apiMemoryDelete } from '../../js/web/actions.mjs';
import { configItems, memoryItems } from '../../js/web/catalog.mjs';
import { apiProfile, apiProfileSave, apiRules, apiRulesMutate } from '../../js/web/user-files.mjs';
import { homeOverrides, makeSandbox } from '../helpers/sandbox.mjs';

const ENV_KEYS = ['OPENCODE_CONFIG_DIR', 'BOB_CONFIG_DIR', 'OPENCLAUDE_CONFIG_DIR', 'CLAUDE_CONFIG_DIR',
  'GENESEED_MEMORY', 'GENESEED_HARNESS', 'GENESEED_WIKI'];

/** Run `fn` with a sandboxed home, a real claude-global install in it, and the tier populated. */
async function withTier(fn) {
  const sb = makeSandbox('s5-');
  const home = sb.path;
  const env = { ...homeOverrides(home) };
  for (const k of ENV_KEYS) env[k] = undefined;
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try {
    const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'build-driver.mjs'), '--emit',
      'claude-global', '--theme', 'neutral', '--footprint', 'lean', '--out', path.join(home, 'bundle')],
    { cwd: ROOT, encoding: 'utf8', env: { ...process.env }, windowsHide: true, maxBuffer: 1 << 26 });
    assert.equal(r.status, 0, r.stderr);
    const cfg = path.join(home, '.claude');
    const tier = path.join(home, '.config', 'geneseed');
    fs.writeFileSync(path.join(tier, 'user-rules.md'), '# User rules\n\n## R1 — Shared rule\n(scope: global)\nBe terse.\n');
    fs.writeFileSync(path.join(tier, 'PROFILE.md'), 'I am the shared profile.\n');
    fs.rmSync(path.join(tier, 'geneseed-wiki.jsonc'));       // the seed would win over a legacy name
    fs.writeFileSync(path.join(tier, 'wiki.json'), '{"wikis": [{"name": "legacy"}]}\n');
    fs.writeFileSync(path.join(tier, 'memory', 'shared-fact.md'), '---\nname: shared-fact\ndescription: kept\n---\nbody\n');
    fs.writeFileSync(path.join(tier, 'notes', 'skill-notes', 'n.md'), 'a note\n');
    fs.writeFileSync(path.join(tier, '.fold-state.json'), JSON.stringify({ version: 1, items: {
      a: { kind: 'rule', host: 'bob', state: 'pending' },
      b: { kind: 'profile', host: 'bob', state: 'pending' },
      c: { kind: 'rule', host: 'bob', state: 'approved' } } }));
    fs.writeFileSync(path.join(cfg, 'memory', 'host-fact.md'), '---\nname: host-fact\ndescription: h\n---\nh\n');
    return await fn({ home, cfg, tier });
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    sb.cleanup();
  }
}

/** Every file under `dir` with its bytes: a before/after of this must be equal. */
function snapshot(dir) {
  const out = {};
  for (const e of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (e.isFile()) {
      const p = path.join(e.parentPath, e.name);
      out[path.relative(dir, p)] = fs.readFileSync(p, 'utf8');
    }
  }
  return out;
}

const quiet = (fn) => {
  const ow = process.stdout.write.bind(process.stdout);
  const ew = process.stderr.write.bind(process.stderr);
  let out = '';
  process.stdout.write = (c) => { out += c; return true; };
  process.stderr.write = () => true;
  try { return [fn(), out]; } finally { process.stdout.write = ow; process.stderr.write = ew; }
};

test('a global install reads the tier: rules, profile, memory, wiki (legacy name too) and the pending count', async () => {
  await withTier(({ cfg }) => {
    const state = { target: cfg, refresh() {} };
    const rules = apiRules(state);
    assert.deepEqual(rules.rules.map((r) => r.title), ['Shared rule']);
    assert.equal(rules.shared, true);
    assert.equal(rules.pending, 2, 'two pending, one approved');
    assert.match(apiProfile(state).text, /shared profile/);
    assert.deepEqual(memoryItems(state).map((m) => m.name).filter((n) => n.endsWith('fact')), ['shared-fact']);
    assert.ok(configItems(state).some((c) => c.name === 'wiki.json'), 'B5: the console must find wiki.json');
  });
});

test('a global install writes the tier, never the host seed', async () => {
  await withTier(({ cfg, tier }) => {
    const state = { target: cfg, refresh() {} };
    const hostRules = fs.readFileSync(path.join(cfg, 'user-rules.md'), 'utf8');
    const hostProfile = fs.readFileSync(path.join(cfg, 'PROFILE.md'), 'utf8');
    const res = apiRulesMutate(state, { op: 'add', fingerprint: apiRules(state).fingerprint,
      title: 'Second', body: 'Be brief.', scope: 'project' });
    assert.equal(res.ok, true);
    assert.match(fs.readFileSync(path.join(tier, 'user-rules.md'), 'utf8'), /Second/);
    const p = apiProfileSave(state, { fingerprint: apiProfile(state).fingerprint, text: 'new profile' });
    assert.equal(p.ok, true);
    assert.match(fs.readFileSync(path.join(tier, 'PROFILE.md'), 'utf8'), /new profile/);
    assert.equal(fs.readFileSync(path.join(cfg, 'user-rules.md'), 'utf8'), hostRules);
    assert.equal(fs.readFileSync(path.join(cfg, 'PROFILE.md'), 'utf8'), hostProfile);
    assert.equal(apiMemoryDelete(state, 'shared-fact').archived, 'shared-fact');
    assert.ok(!fs.existsSync(path.join(tier, 'memory', 'shared-fact.md')));
    assert.ok(fs.existsSync(path.join(cfg, 'memory', 'host-fact.md')), 'the host store is not the console\'s target');
  });
});

test('a project install keeps its own files and reports no pending count', async () => {
  await withTier(({ home, tier }) => {
    const repo = path.join(home, 'repo');
    fs.mkdirSync(repo);
    fs.writeFileSync(path.join(repo, 'user-rules.md'), '# User rules\n\n## R1 — Local\n(scope: project)\nLocal only.\n');
    const state = { target: repo, refresh() {} };
    const rules = apiRules(state);
    assert.deepEqual(rules.rules.map((r) => r.title), ['Local']);
    assert.equal(rules.shared, false);
    assert.equal(rules.pending, 0);
    assert.deepEqual(memoryItems(state), []);
    assert.ok(fs.existsSync(path.join(tier, 'user-rules.md')));
  });
});

for (const memory of ['keep', 'archive', 'delete']) {
  test(`installUninstall with memory=${memory} leaves a populated tier byte for byte`, async () => {
    await withTier(({ cfg, tier }) => {
      const before = snapshot(tier);
      assert.ok(Object.keys(before).length >= 6, 'sanity: the tier is populated');
      const res = installUninstall(cfg, 'claude', 'global', memory, true);
      assert.equal(res.ok, true, JSON.stringify(res));
      assert.deepEqual(snapshot(tier), before);
      assert.equal(fs.existsSync(path.join(cfg, 'memory', 'host-fact.md')), memory === 'keep',
        'the host store follows the flag; only the tier is exempt');
    });
  });
}

test('geneseed uninstall names where the tier lives and says it stays', async () => {
  await withTier(({ cfg, tier }) => {
    const [rc, out] = quiet(() => cmdUninstall({ target: cfg, yes: true, archiveMemory: true, force: true }));
    assert.equal(rc, 0);
    assert.ok(out.includes(`the shared tier at ${tier} is never touched`), out);
    assert.ok(fs.existsSync(path.join(tier, 'memory', 'shared-fact.md')));
  });
});
