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
import { apiFleet } from '../../js/web/api.mjs';
import { apiCatalog, apiItem, configItems, memoryDir, memoryItems, tierOf } from '../../js/web/catalog.mjs';
import { webState } from '../../js/web/state.mjs';
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

test('a global install reads the tier: rules, profile, memory and wiki (legacy name too)', async () => {
  await withTier(({ cfg }) => {
    const state = { target: cfg, refresh() {} };
    const rules = apiRules(state);
    assert.deepEqual(rules.rules.map((r) => r.title), ['Shared rule']);
    assert.equal(rules.shared, true);
    assert.match(apiProfile(state).text, /shared profile/);
    assert.deepEqual(memoryItems(state).map((m) => m.name).filter((n) => n.endsWith('fact')), ['shared-fact']);
    assert.ok(configItems(state).some((c) => c.name === 'wiki.json'), 'B5: the console must find wiki.json');
  });
});

// The draft as the fold writes it (fold.test.mjs pins those bytes): a header, then blocks. The
// rule Rite's record in `## Renumbered` is no draft, and a `Choose` block is a question, not a rule.
const DRAFT = '# User rules — draft\n\nNot active. The rule Rite applies decisions.\n\n'
  + '## Rule from claude: Mine\n(source: /h/user-rules.md | old: R2 | sha256: aa)\n'
  + '(scope: global | trial until: 2026-12-01)\nBe terse.\nAlways.\n\n'
  + '## Renumbered\n- bob R3 -> R4: Done\n\n'
  + '## Choose: PROFILE.md\n(hosts: shared, bob | paths: /t/PROFILE.md, /b/PROFILE.md | sha256: bb)\n'
  + 'Which one becomes the shared file?\n\n'
  + '## Rule from bob: Theirs: with a colon\n(source: /b/user-rules.md | old: R1 | sha256: cc)\nStay.\n';

test('apiRules lists the draft blocks: rule text, a Choose by title, and no Renumbered record', async () => {
  await withTier(({ cfg, tier }) => {
    const state = { target: cfg, refresh() {} };
    assert.deepEqual(apiRules(state).drafts, [], 'no draft file is no drafts');
    fs.writeFileSync(path.join(tier, 'user-rules.draft.md'), DRAFT);
    assert.deepEqual(apiRules(state).drafts, [
      { title: 'Mine', host: 'claude', body: '(scope: global | trial until: 2026-12-01)\nBe terse.\nAlways.' },
      { title: 'Choose: PROFILE.md', host: null, body: '' },
      { title: 'Theirs: with a colon', host: 'bob', body: 'Stay.' },
    ]);
    fs.rmSync(path.join(tier, 'user-rules.md'));
    assert.equal(apiRules(state).drafts.length, 3, 'a draft outlives a missing rule file');
  });
});

// A block the ledger holds as decided is what a stopped Rite write leaves: not pending. A block
// with no row is shown, and so is every block when the ledger does not parse.
test('apiRules leaves out a draft block the ledger already decided', async () => {
  await withTier(({ cfg, tier }) => {
    const state = { target: cfg, refresh() {} };
    const titles = () => apiRules(state).drafts.map((d) => d.title);
    fs.writeFileSync(path.join(tier, 'user-rules.draft.md'), DRAFT);
    const ledger = path.join(tier, '.fold-state.json');
    fs.writeFileSync(ledger, JSON.stringify({ version: 1, items: {
      aa: { kind: 'rule', host: 'claude', state: 'approved' },
      bb: { kind: 'profile', host: 'bob', state: 'pending' } } }));
    assert.deepEqual(titles(), ['Choose: PROFILE.md', 'Theirs: with a colon']);
    fs.writeFileSync(ledger, JSON.stringify({ version: 1, items: {
      bb: { kind: 'profile', host: 'bob', state: 'rejected' } } }));
    assert.deepEqual(titles(), ['Mine', 'Theirs: with a colon']);
    fs.writeFileSync(ledger, 'not json');
    assert.deepEqual(titles(), ['Mine', 'Choose: PROFILE.md', 'Theirs: with a colon']);
  });
});

// Each rule's cost is its own block, code points / 4; the file's total also holds the header. The
// emoji is one code point and two UTF-16 units, so `String.length` would put the second row at 12.
test('apiRules prices each rule on its own block, and the file total holds the header', async () => {
  await withTier(({ cfg, tier }) => {
    fs.writeFileSync(path.join(tier, 'user-rules.md'),
      '# User rules\n\n## R1 — Shared rule\n(scope: global)\nBe terse.\n\n## R2 — Emoji\n🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉🎉\n');
    const { rules, stats } = apiRules({ target: cfg, refresh() {} });
    // '## R1 — Shared rule\n(scope: global)\nBe terse.' is 44 code points;
    // '## R2 — Emoji\n' is 14, and the 30 emoji make it 44 too.
    assert.deepEqual(rules.map((r) => r.tokens), [11, 11]);
    // 105 code points: the two blocks, their blank separator, the 14 of '# User rules\n\n', the
    // final newline. Eight lines, the blank ones counted.
    assert.deepEqual(stats, { rules: 2, lines: 8, tokens: 26 });
  });
});

test('apiProfile says whether it answers with the shared file', async () => {
  await withTier(({ home, cfg }) => {
    assert.equal(apiProfile({ target: cfg, refresh() {} }).shared, true);
    const repo = path.join(home, 'repo');
    fs.mkdirSync(repo);
    assert.equal(apiProfile({ target: repo, refresh() {} }).shared, false);
  });
});

// Two global installs read one store: one row, under the first, and a project install's own store
// beside it. The list says which installs share, so the console can name none of them.
test('a machine dir with no tier in it leaves the console on the host files', async () => {
  // I3: a 4.x machine already has this folder, for what is no tier at all. `default-install.json`
  // is the one console write that can make it. Neither is a tier: the hook reads the host files
  // there, and the console must edit what the hook reads.
  await withTier(async ({ cfg, tier }) => {
    fs.rmSync(tier, { recursive: true });
    fs.mkdirSync(path.join(tier, 'bricks'), { recursive: true });
    fs.mkdirSync(path.join(tier, 'loops'));
    fs.writeFileSync(path.join(tier, 'installs.json'), '{"roots": []}\n');
    const state = webState('neutral', cfg);
    assert.equal(tierOf(state), null, 'installs.json made a tier');
    assert.equal(memoryDir(state), path.join(cfg, 'memory'));
    assert.ok(memoryItems(state).some((i) => i.name === 'host-fact'), 'the host fact is not listed');
    assert.equal(apiProfileSave(state, { text: 'host self', fingerprint: apiProfile(state).fingerprint }).ok, true);
    assert.match(fs.readFileSync(path.join(cfg, 'PROFILE.md'), 'utf8'), /^host self/);
    assert.ok(!fs.existsSync(path.join(tier, 'PROFILE.md')), 'the console wrote into the machine dir');
    fs.writeFileSync(path.join(tier, 'default-install.json'), '{"host": "claude", "path": "x"}\n');
    assert.equal(tierOf(state), null, 'default-install.json made a tier');
    fs.mkdirSync(path.join(tier, 'memory'));
    assert.equal(tierOf(state)?.root, tier, 'the tier itself no longer counts');
  });
});

test('the memory list folds the installs that read the tier into one', async () => {
  await withTier(({ home, cfg, tier }) => {
    const bob = path.join(home, '.bob');
    fs.mkdirSync(path.join(bob, 'memory'), { recursive: true });
    const repo = path.join(home, 'repo');
    fs.mkdirSync(path.join(repo, 'memory'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'memory', 'local-fact.md'), '---\nname: local-fact\n---\nbody\n');
    const fleet = [
      { install: 'claude:global:c', state: webState('neutral', cfg) },
      { install: 'bob:global:b', state: webState('neutral', bob) },
      { install: 'bob:project:r', state: webState('neutral', repo) },
    ];
    const list = apiCatalog(fleet[0].state, 'memory', fleet);
    assert.deepEqual(list.sharedInstalls, ['claude:global:c', 'bob:global:b']);
    const installsOf = (name) => list.items.find((i) => i.name === name).installs;
    assert.deepEqual(installsOf('shared-fact'), ['claude:global:c']);
    assert.deepEqual(installsOf('local-fact'), ['bob:project:r']);
    fs.writeFileSync(path.join(repo, 'memory', 'shared-fact.md'), '---\nname: shared-fact\n---\nmine\n');
    const item = apiItem(fleet[1].state, 'memory', 'shared-fact', fleet);
    assert.deepEqual([item.install, item.installs, item.shared],
      ['bob:global:b', ['claude:global:c', 'bob:project:r'], true]);
    assert.equal(apiItem(fleet[2].state, 'memory', 'shared-fact', fleet).shared, false);
    assert.ok(fs.existsSync(path.join(tier, 'memory', 'shared-fact.md')));
  });
});

test('the wiki list says when its manifest is the shared one', async () => {
  await withTier(({ home, cfg }) => {
    assert.equal(apiCatalog({ target: cfg, refresh() {} }, 'wiki').shared, true);
    assert.equal(apiCatalog({ target: path.join(home, 'repo'), refresh() {} }, 'wiki').shared, false);
  });
});

test('the Overview counts the facts the tier holds, not the host store', async () => {
  // Two in the tier and one in the host store, so the two stores cannot give the same figure.
  await withTier(({ tier }) => {
    fs.writeFileSync(path.join(tier, 'memory', 'second-fact.md'), '---\nname: second-fact\ndescription: k\n---\nb\n');
    const row = apiFleet(webState()).installs.find((i) => i.host === 'claude' && i.scope === 'global');
    assert.equal(row?.facts, 2);
    assert.equal(row?.shared, true, 'the row must say its facts are the shared store');
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

test('a project install keeps its own files and reports no drafts', async () => {
  await withTier(({ home, tier }) => {
    const repo = path.join(home, 'repo');
    fs.mkdirSync(repo);
    fs.writeFileSync(path.join(repo, 'user-rules.md'), '# User rules\n\n## R1 — Local\n(scope: project)\nLocal only.\n');
    const state = { target: repo, refresh() {} };
    const rules = apiRules(state);
    assert.deepEqual(rules.rules.map((r) => r.title), ['Local']);
    assert.equal(rules.shared, false);
    assert.deepEqual(rules.drafts, []);
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
