// THE WEB API'S FUNCTIONS, IN PROCESS — install toggling, install commands and kits.
// One of the `web_api*.test.mjs` files split from a single file; shared fixtures live in
// `tests/helpers/web_api_fixture.mjs`.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { apiDefaultInstallSet, apiInstalls, apiKits } from '../../js/web/api.mjs';
import { defaultView } from '../../js/web/state.mjs';
import { statusData } from '../../js/inspect/status.mjs';
import { sharedPaths } from '../../js/lib/machine-dir.mjs';
import { NotFound, apiCatalog, apiItem } from '../../js/web/catalog.mjs';
import { installView } from '../../js/web/actions.mjs';
import { apiInstallToggle, apiInstallCmd } from '../../js/web/actions.mjs';
import { GLOBAL_MANIFEST, VERSION_MARKER } from '../../js/hosts/hosts.mjs';
import { pathToFileURL } from 'node:url';
import { copyCheckout } from '../helpers/cli_golden.mjs';
import { readJsonBody } from '../../js/web/routes.mjs';
import { TMP_ROOT, makeSandbox } from '../helpers/sandbox.mjs';
import { dropSandboxTier, webFixtureTeardown } from '../helpers/web_fixture.mjs';
import {
  neutral, DISABLED, withGlobalRoot, agentEntry, seedGlobal, rowFor, withThreeInstalls, withTwoViews, samePath,
} from '../helpers/web_api_fixture.mjs';

after(webFixtureTeardown);

const instructionsOf = (root) => (JSON.parse(
  fs.readFileSync(path.join(root, 'opencode.json'), 'utf8')).instructions || []);

test('an install row carries its identity and its state per scope', () => {
  withGlobalRoot(({ root, tmp }) => {
    seedGlobal(root);
    const row = rowFor(neutral(), root);
    for (const key of ['id', 'host', 'scope', 'path', 'state']) assert.ok(key in row, `no ${key}`);
    assert.equal(row.host, 'opencode');
    assert.equal(row.scope, 'global');
    assert.equal(row.state, 'active', 'manifest present and no stash must read active');

    // `absent`: a root with neither a manifest nor a marker dir.
    const empty = path.join(tmp, 'empty');
    fs.mkdirSync(empty);
    process.env.OPENCODE_CONFIG_DIR = empty;
    assert.equal(rowFor(neutral(), empty).state, 'absent');
  });
});

test('deactivate then reactivate restores the exact bytes', () => {
  withGlobalRoot(({ root }) => {
    seedGlobal(root);
    const stash = path.join(root, DISABLED);
    const agentBytes = fs.readFileSync(path.join(root, 'AGENT.md'));
    const xBytes = fs.readFileSync(path.join(root, 'agents', 'x.md'));
    const st = neutral();

    let res = apiInstallToggle(st, { host: 'opencode', path: root, action: 'deactivate' });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.kind, 'global');
    assert.equal(res.moved, 2, 'AGENT.md + agents/x.md');

    // The artifacts live under the stash at their ORIGINAL rel paths...
    assert.ok(fs.statSync(stash).isDirectory());
    assert.ok(fs.statSync(path.join(stash, 'AGENT.md')).isFile());
    assert.ok(fs.statSync(path.join(stash, 'agents', 'x.md')).isFile());
    // ...and NO file was deleted — the bytes are preserved in the stash.
    assert.deepEqual(fs.readFileSync(path.join(stash, 'AGENT.md')), agentBytes);
    assert.deepEqual(fs.readFileSync(path.join(stash, 'agents', 'x.md')), xBytes);
    // The live copies are gone from the discovery path...
    assert.ok(!fs.existsSync(path.join(root, 'AGENT.md')));
    assert.ok(!fs.existsSync(path.join(root, 'agents', 'x.md')));
    // ...and the emptied owned dir is pruned by uninstall's ancestor climb.
    assert.ok(!fs.existsSync(path.join(root, 'agents')));
    // The AGENT.md instructions entry is stripped.
    assert.ok(!instructionsOf(root).includes(agentEntry(root)));
    // VERSION_MARKER stays put — markers are excluded from the move.
    assert.ok(fs.statSync(path.join(root, VERSION_MARKER)).isFile());
    assert.ok(!fs.existsSync(path.join(stash, VERSION_MARKER)));
    // The stash dir IS the flag.
    assert.equal(rowFor(neutral(), root).state, 'disabled');

    res = apiInstallToggle(st, { host: 'opencode', path: root, action: 'activate' });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.deepEqual(fs.readFileSync(path.join(root, 'AGENT.md')), agentBytes);
    assert.deepEqual(fs.readFileSync(path.join(root, 'agents', 'x.md')), xBytes);
    assert.ok(instructionsOf(root).includes(agentEntry(root)), 'the entry was not restored');
    assert.ok(!fs.existsSync(stash), 'the stash survived a complete restore');
    assert.equal(rowFor(neutral(), root).state, 'active');
  });
});

// Plant a plain FILE named like the stash dir. `installState` gates on `isDir(root/DISABLED)`,
// so a file leaves the state `active` and the operation is allowed to START — but every
// `mkdir(stash/rel)` then fails, forcing a mid-operation failure and a full roll-back.
test('deactivate rolls back on a failed move', () => {
  withGlobalRoot(({ root }) => {
    seedGlobal(root);
    const stash = path.join(root, DISABLED);
    const agentBytes = fs.readFileSync(path.join(root, 'AGENT.md'));
    const xBytes = fs.readFileSync(path.join(root, 'agents', 'x.md'));
    fs.writeFileSync(stash, 'not a dir\n');

    const res = apiInstallToggle(neutral(),
      { host: 'opencode', path: root, action: 'deactivate' });
    assert.equal(res.ok, false);
    assert.ok('failed' in res);
    assert.ok(res.failed.length > 0);

    // Everything is back where it started — no half-gutted install.
    assert.deepEqual(fs.readFileSync(path.join(root, 'AGENT.md')), agentBytes);
    assert.deepEqual(fs.readFileSync(path.join(root, 'agents', 'x.md')), xBytes);
    // The config edit is the LAST step, so a move failure leaves it intact.
    assert.ok(instructionsOf(root).includes(agentEntry(root)));
    // Still ACTIVE — the blocking file is not a stash dir.
    assert.equal(rowFor(neutral(), root).state, 'active');
    // The blocking artifact is untouched: the engine deleted nothing.
    assert.equal(fs.readFileSync(stash, 'utf8'), 'not a dir\n');
  });
});

test('reactivate discards a stale stash when the files were re-created', () => {
  withGlobalRoot(({ root }) => {
    seedGlobal(root);
    const stash = path.join(root, DISABLED);
    const st = neutral();

    let res = apiInstallToggle(st, { host: 'opencode', path: root, action: 'deactivate' });
    assert.equal(res.ok, true);
    assert.ok(fs.statSync(stash).isDirectory());

    // `geneseed build` re-creating the live install while it is disabled: the manifest,
    // AGENT.md and agents/ are all back on the discovery path.
    seedGlobal(root);
    assert.ok(fs.statSync(path.join(root, 'AGENT.md')).isFile());

    res = apiInstallToggle(st, { host: 'opencode', path: root, action: 'activate' });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.ok('note' in res);
    assert.match(res.note, /discarded/);
    // The stale stash goes, the live files are untouched...
    assert.ok(!fs.existsSync(stash));
    assert.ok(fs.statSync(path.join(root, 'AGENT.md')).isFile());
    // ...and the instructions entry is ensured present.
    assert.ok(instructionsOf(root).includes(agentEntry(root)));
    assert.equal(rowFor(neutral(), root).state, 'active');
  });
});

// OpenCode prefers a present `opencode.jsonc`; a commented one must not be rewritten, because
// that would drop the comments — so deactivate aborts up front.
test('deactivate refuses a commented jsonc and moves nothing', () => {
  withGlobalRoot(({ root }) => {
    seedGlobal(root);
    fs.rmSync(path.join(root, 'opencode.json'));
    fs.writeFileSync(path.join(root, 'opencode.jsonc'),
      `// my notes\n{\n  "instructions": ["${agentEntry(root)}"]\n}\n`);

    const res = apiInstallToggle(neutral(),
      { host: 'opencode', path: root, action: 'deactivate' });
    assert.equal(res.ok, false);
    assert.ok('error' in res);
    // Nothing moved: live files in place, no stash created, comments intact.
    assert.ok(fs.statSync(path.join(root, 'AGENT.md')).isFile());
    assert.ok(fs.statSync(path.join(root, 'agents', 'x.md')).isFile());
    assert.ok(!fs.existsSync(path.join(root, DISABLED)));
    assert.match(fs.readFileSync(path.join(root, 'opencode.jsonc'), 'utf8'), /\/\/ my notes/);
    assert.equal(rowFor(neutral(), root).state, 'active');
  });
});

test('the install toggle rejects an unknown path', () => {
  withGlobalRoot(({ root }) => {
    seedGlobal(root);
    assert.throws(() => apiInstallToggle(neutral(),
      { path: '/no/such/root', action: 'deactivate' }), NotFound);
  });
});

test('an unknown install action is not ok', () => {
  withGlobalRoot(({ root }) => {
    seedGlobal(root);
    const res = apiInstallToggle(neutral(),
      { host: 'opencode', path: root, action: 'bogus' });
    assert.equal(res.ok, false);
  });
});

test('the install command for an absent global target', () => {
  withThreeInstalls(({ st, cl }) => {
    const plan = apiInstallCmd(st, { host: 'claude', path: cl });
    assert.ok('cmd' in plan, JSON.stringify(plan));
    const cmd = plan.cmd.map(String);
    assert.ok(cmd.includes('claude-global'));
    assert.ok(cmd.includes('neutral'), 'a new install must inherit the current voice');
    assert.ok(!cmd.includes('--out'), 'a global install takes no out/root');
  });
});

test('the install command honours a valid picked theme', () => {
  withThreeInstalls(({ st, cl }) => {
    const plan = apiInstallCmd(st, { host: 'claude', path: cl, theme: 'imperial' });
    assert.ok(plan.cmd.map(String).includes('imperial'));
  });
});

// The theme comes out of a request body and lands in an argv, so a bogus one must never reach
// the command line — it falls back to the state's theme instead.
test('the install command rejects a bogus theme and falls back', () => {
  withThreeInstalls(({ st, cl }) => {
    const plan = apiInstallCmd(st, { host: 'claude', path: cl, theme: '../evil' });
    const cmd = plan.cmd.map(String);
    assert.ok(!cmd.includes('../evil'), 'a path-shaped theme reached the argv');
    assert.ok(cmd.includes('neutral'));
  });
});

test('an active install rebuilds in place with the same build command', () => {
  withThreeInstalls(({ st, oc }) => {
    const plan = apiInstallCmd(st, { host: 'opencode', path: oc, theme: 'imperial' });
    assert.ok('cmd' in plan, JSON.stringify(plan));
    const cmd = plan.cmd.map(String);
    assert.ok(cmd.includes('opencode-global'));
    assert.ok(cmd.includes('imperial'));
  });
});

test('a disabled install is refused rather than rebuilt', () => {
  withThreeInstalls(({ st, proj }) => {
    const plan = apiInstallCmd(st, { host: 'opencode', path: proj });
    assert.ok('error' in plan, JSON.stringify(plan));
    assert.match(plan.error, /disabled/);
  });
});

test('an unknown (host, path) pair raises NotFound', () => {
  withThreeInstalls(({ st }) => {
    assert.throws(() => apiInstallCmd(st, { host: 'claude', path: '/no/such/root' }), NotFound);
  });
});

// ---------------------------------------------------------------------------------------------
// The Kits tab: `GET /api/kits` (`apiKits`) and the `kits` body of the install command. The real
// `spring-boot` kit ships, so the fixture only needs the `Active kits:` line on the active carrier.

/** `withThreeInstalls`, the active `oc` carrier already naming `spring-boot` as on. */
function withKitInstalls(fn) {
  return withThreeInstalls((ctx) => {
    fs.writeFileSync(path.join(ctx.oc, 'AGENT.md'), '# Rules\nActive kits: spring-boot\n');
    return fn(ctx);
  });
}

/** The value following `--kits` in an argv, or `undefined` when the flag is absent. */
const kitsFlag = (cmd) => (cmd.includes('--kits') ? cmd[cmd.indexOf('--kits') + 1] : undefined);

test('GET /api/kits lists the shipped kits and each present install with its own kits', () => {
  withKitInstalls(({ oc, proj }) => {
    const res = apiKits(neutral());
    assert.equal(res.error, undefined);
    assert.deepEqual(res.kits.map((k) => k.name), ['react', 'spring-boot']);
    const spring = res.kits.find((k) => k.name === 'spring-boot');
    assert.equal(spring.skills.length, 3);
    assert.equal(spring.agents.length, 6);
    assert.ok(spring.description);
    const active = res.installs.find((r) => samePath(r.path, oc));
    assert.deepEqual(active.kits, ['spring-boot']);
    assert.equal(active.editable, true);
    assert.equal(active.reason, null);
    assert.equal(active.keptKitFiles, null);
    const off = res.installs.find((r) => samePath(r.path, proj));
    assert.equal(off.state, 'disabled');
    assert.equal(off.editable, false);
    assert.match(off.reason, /reactivate it first/);
    assert.ok(!res.installs.some((r) => r.host === 'claude'), 'an absent install was listed');
  });
});

test('GET /api/kits names an edited member kept from a kit that is off', () => {
  withThreeInstalls(({ oc }) => {
    fs.mkdirSync(path.join(oc, 'agents'), { recursive: true });
    fs.writeFileSync(path.join(oc, 'agents', 'spring-reviewer.md'), 'edited by its owner\n');
    const row = apiKits(neutral()).installs.find((r) => samePath(r.path, oc));
    assert.deepEqual(row.kits, []);
    assert.deepEqual(row.keptKitFiles, { 'spring-boot': ['agents/spring-reviewer.md'] });
  });
});

test('GET /api/kits lists an install whose row cannot be built as unreadable, with the error', async () => {
  // No fixture makes the real readers throw (they all swallow), so the copied checkout's
  // `keptKitFiles` throws: reddens if the per-row catch is dropped (the whole call would throw).
  const sb = makeSandbox();
  const savedOc = process.env.OPENCODE_CONFIG_DIR;
  try {
    const co = path.join(sb.path, 'checkout');
    const statusSrc = fs.readFileSync(path.join(import.meta.dirname, '../../js/inspect/status.mjs'), 'utf8');
    const head = 'export function keptKitFiles(host, scope, root, active) {';
    assert.ok(statusSrc.includes(head), 'the anchor moved');
    copyCheckout(co, { 'js/inspect/status.mjs': statusSrc.replace(head, `${head} throw new Error('boom');`) });
    const oc = path.join(sb.path, 'oc');
    fs.mkdirSync(oc, { recursive: true });
    fs.writeFileSync(path.join(oc, GLOBAL_MANIFEST), JSON.stringify({ owned: [] }));
    process.env.OPENCODE_CONFIG_DIR = oc;
    const mod = await import(pathToFileURL(path.join(co, 'js/web/api.mjs')).href);
    const row = mod.apiKits(neutral()).installs.find((r) => samePath(r.path, oc));
    assert.equal(row.state, 'unreadable');
    assert.match(row.error, /boom/);
    assert.equal(row.kits, undefined);
  } finally {
    if (savedOc === undefined) delete process.env.OPENCODE_CONFIG_DIR; else process.env.OPENCODE_CONFIG_DIR = savedOc;
    sb.cleanup();
  }
});

test('GET /api/kits answers 200-shaped error and empty lists for a malformed manifest', async () => {
  const sb = makeSandbox();
  try {
    const co = path.join(sb.path, 'checkout');
    copyCheckout(co, { 'src/kits/x.json': '{' });
    const mod = await import(pathToFileURL(path.join(co, 'js/web/api.mjs')).href);
    const res = mod.apiKits(neutral());
    assert.deepEqual([res.kits, res.installs], [[], []]);
    assert.match(res.error, /src\/kits\/x\.json/);
  } finally { sb.cleanup(); }
});

// The Kits pages read rules, budget, banned list and credits straight from `/api/kits`, and the
// Library reads `kit` off each skill/agent row. Values are those of the shipped spring-boot and react
// kits: each manifest's own banned list, and the one upstream its members credit.
test('GET /api/kits carries rules, budget, banned list and resolved credits per kit', () => {
  const k = apiKits(neutral()).kits.find((x) => x.name === 'spring-boot');
  assert.match(k.rules, /^\S/);
  assert.equal(k.rulesWordBudget, 300);
  assert.deepEqual(k.banned,
    ['@MockBean', '@SpyBean', 'javax.persistence', 'ClientHttpRequestFactories', 'Spring Security 6']);
  assert.deepEqual(k.credits, [{
    key: 'piomin-spring-boot', repo: 'piomin/claude-ai-spring-boot', author: 'Piotr Mińkowski',
    license: 'Apache-2.0', commit: 'cf876a1041ac4692f32422261f6d67d7f12140d5',
    compareUrl: 'https://github.com/piomin/claude-ai-spring-boot/compare/'
      + 'cf876a1041ac4692f32422261f6d67d7f12140d5...HEAD' }]);
  const r = apiKits(neutral()).kits.find((x) => x.name === 'react');
  assert.equal(r.rulesWordBudget, 300);
  assert.deepEqual(r.banned,
    ['ReactDOM.render(', 'findDOMNode', 'enzyme', 'react-test-renderer', '@testing-library/react-hooks']);
  assert.deepEqual(r.credits.map((c) => [c.key, c.license]), [['everything-claude-code', 'MIT']]);
});

test('GET /api/kits skips a credit key src/upstreams.json does not know instead of failing', async () => {
  const sb = makeSandbox();
  try {
    const co = path.join(sb.path, 'checkout');
    const rules = 'x {{CREDIT:no-such-key:a.md}}';
    copyCheckout(co, { 'src/kits/spring-boot/rules.md': rules });
    const mod = await import(pathToFileURL(path.join(co, 'js/web/api.mjs')).href);
    const k = mod.apiKits(neutral()).kits.find((x) => x.name === 'spring-boot');
    assert.equal(k.rules, rules);
    assert.deepEqual(k.credits.map((c) => c.key), ['piomin-spring-boot']);
  } finally { sb.cleanup(); }
});

// The default render leaves kit members out (kits are opt-in), so the fixture adds one of each.
test('catalog skill/agent rows and items name their kit, or null outside every kit', () => {
  const base = neutral();
  const inv = base.inventory;
  const member = (name) => ({ name, desc: 'd', body: 'b', status: 'active', klass: 'build' });
  const st = { ...base, inventory: { ...inv,
    skills: [...inv.skills, member('spring-boot'), member('spring-testing')],
    agents: [...inv.agents, member('spring-reviewer'), member('docker-expert')] } };
  const skills = apiCatalog(st, 'skills').items;
  assert.equal(skills.find((r) => r.name === 'spring-boot').kit, 'spring-boot');
  assert.equal(skills.find((r) => r.name === 'plan').kit, null);
  const agents = apiCatalog(st, 'agents').items;
  assert.equal(agents.find((r) => r.name === 'spring-reviewer').kit, 'spring-boot');
  assert.equal(agents.find((r) => r.name === 'reviewer').kit, null);
  assert.equal(apiItem(st, 'skill', 'spring-testing').kit, 'spring-boot');
  assert.equal(apiItem(st, 'agent', 'docker-expert').kit, 'spring-boot');
  assert.equal(apiItem(st, 'skill', 'plan').kit, null);
});

test('a kits body REPLACES the install kits: [] and "none" drop them, a name sets them', () => {
  withKitInstalls(({ st, oc }) => {
    for (const none of [[], 'none']) {
      const cmd = apiInstallCmd(st, { host: 'opencode', path: oc, kits: none }).cmd.map(String);
      assert.equal(kitsFlag(cmd), undefined, `${JSON.stringify(none)} still carried --kits`);
    }
    const replay = apiInstallCmd(st, { host: 'opencode', path: oc }).cmd.map(String);
    assert.equal(kitsFlag(replay), 'spring-boot', 'an omitted key must keep the install kits');
  });
  withThreeInstalls(({ st, oc }) => {
    const cmd = apiInstallCmd(st, { host: 'opencode', path: oc, kits: ['spring-boot'] }).cmd.map(String);
    assert.deepEqual(cmd.slice(-2), ['--kits', 'spring-boot']);
  });
});

test('an unknown kit is refused with an error and no command', () => {
  withKitInstalls(({ st, oc }) => {
    const res = apiInstallCmd(st, { host: 'opencode', path: oc, kits: ['ghost'] });
    assert.ok(!('cmd' in res), JSON.stringify(res));
    assert.match(res.error, /ghost/);
    assert.match(res.error, /spring-boot/);
  });
});

test('a kits body on a disabled or unknown install gets the existing refusals', () => {
  withKitInstalls(({ st, proj }) => {
    assert.match(apiInstallCmd(st, { host: 'opencode', path: proj, kits: [] }).error, /disabled/);
    assert.throws(() => apiInstallCmd(st, { host: 'claude', path: '/no/such/root', kits: [] }), NotFound);
  });
});

// The doctrine packs are the fourth value a build command carries out of a request body, and the
// first that is a LIST. `includes(x)` closes a scalar in one call; a list has to be closed member
// by member, or one bogus name rides into an argv beside three good ones.

test('a picked pack list reaches the install command, normalised into PACK_ORDER', () => {
  withThreeInstalls(({ st, cl }) => {
    const cmd = apiInstallCmd(st, { host: 'claude', path: cl, doctrines: ['process', 'craft'] })
      .cmd.map(String);
    assert.equal(cmd[cmd.indexOf('--doctrines') + 1], 'craft,process',
      'the packs arrived in request-body order — the `Active packs:` marker a later reader '
      + 'parses back must not depend on the order a client happened to send');
    // A comma string is the same request by hand, and answers identically.
    const typed = apiInstallCmd(st, { host: 'claude', path: cl, doctrines: 'process, craft' })
      .cmd.map(String);
    assert.deepEqual(typed, cmd);
  });
});

test('a body that says nothing usable falls back to the INSTALL, never to the config', () => {
  withThreeInstalls(({ st, cl }) => {
    // ⚠ THIS CELL USED TO ASSERT THE OPPOSITE — that the flag was elided so the generator could
    // read `harness.config.json`. That is the fail-OPEN hole: the fixture's install carries no
    // `Active packs:` marker, exactly like every pre-2.3 install, and with
    // `{"doctrines":["craft"]}` in that file the rebuild dropped its commit/push consent gate.
    // Unknown resolves to ALL PACKS here, as it does at every other build-side consumer.
    const all = 'craft,rigor,ops,process,comms';
    const cmd0 = apiInstallCmd(st, { host: 'claude', path: cl }).cmd.map(String);
    assert.equal(cmd0[cmd0.indexOf('--doctrines') + 1], all,
      'a markerless install was left to a machine-wide config file to describe');
    // A bogus member poisons the WHOLE list rather than being filtered out of it: a request
    // asking for craft and something that does not exist is a request this endpoint does not
    // understand, and silently building three-quarters of it is the wrong repair. It then falls
    // back the same way a missing key does — to the install, not to the config.
    for (const bad of [['craft', '../evil'], ['nope'], [7], 'craft,nope', 42, {}]) {
      const cmd = apiInstallCmd(st, { host: 'claude', path: cl, doctrines: bad }).cmd.map(String);
      assert.equal(cmd[cmd.indexOf('--doctrines') + 1], all,
        `a bogus doctrines value reached the argv: ${JSON.stringify(bad)}`);
      assert.ok(!cmd.some((a) => a.includes('evil')), 'a path-shaped pack name reached the argv');
    }
  });
});

test('an empty pack list is a real answer and is spelled none', () => {
  withThreeInstalls(({ st, cl }) => {
    for (const empty of [[], ['none'], 'none']) {
      const cmd = apiInstallCmd(st, { host: 'claude', path: cl, doctrines: empty }).cmd.map(String);
      assert.equal(cmd[cmd.indexOf('--doctrines') + 1], 'none',
        `${JSON.stringify(empty)} did not reach the deliberate empty selection`);
    }
  });
});

test('a full pack list is SPELLED OUT, so the config cannot reinterpret the console\'s answer', () => {
  // This asserted the opposite until the elision came out, and the reason it flipped is the
  // point: a `--doctrines`-less command line falls through to `harness.config.json`, so a
  // console user who ticked every pack on a machine configured `{"doctrines":["craft"]}`
  // got an install with one — and no commit/push consent gate. The console knows the answer;
  // the command line has to carry it.
  withThreeInstalls(({ st, cl }) => {
    const cmd = apiInstallCmd(st,
      { host: 'claude', path: cl, doctrines: ['craft', 'rigor', 'ops', 'process', 'comms'] }).cmd.map(String);
    assert.equal(cmd[cmd.indexOf('--doctrines') + 1], 'craft,rigor,ops,process,comms');
  });
});

// The SECOND doctrine axis across the same boundary. Same shape as the four cells above and
// closed the same way — member by member against what this checkout actually ships — but its
// unknown resolves to the OTHER end: absence of an `Excluded rules:` line is a statement
// ("nothing"), not a silence, so an unreadable body falls back to `[]` rather than to a
// fail-closed full set.

test('a picked rule list reaches the install command, in render order', () => {
  withThreeInstalls(({ st, cl }) => {
    const cmd = apiInstallCmd(st,
      { host: 'claude', path: cl, excludeRules: ['process.7', 'craft.2'] }).cmd.map(String);
    assert.equal(cmd[cmd.indexOf('--exclude-rules') + 1], 'craft.2,process.7',
      'the rules arrived in request-body order — the `Excluded rules:` marker a later reader '
      + 'parses back must not depend on the order a client happened to send');
    // The SPACED spelling is the same request written the way the marker and every citation
    // write an address, and it must answer identically — a value copied off a carrier cannot
    // be rejected by the flag that wrote it.
    const spaced = apiInstallCmd(st,
      { host: 'claude', path: cl, excludeRules: 'process 7, craft 2' }).cmd.map(String);
    assert.deepEqual(spaced, cmd);
    // ...and the PACK axis is untouched by it. Two axes that moved together would make
    // "exclude one rule" and "drop its pack" the same request, which is the control this whole
    // feature exists to remove.
    assert.equal(cmd[cmd.indexOf('--doctrines') + 1], 'craft,rigor,ops,process,comms');
  });
});

test('a bogus rule list poisons the whole value and falls back to the install', () => {
  withThreeInstalls(({ st, cl }) => {
    // One address that does not exist is a request this endpoint does not understand, and
    // building three-quarters of it is the wrong repair — the same rule the pack list follows.
    for (const bad of [['craft.2', '../evil'], ['process.99'], ['nope.1'], [7], 'craft.2,nope.1',
      42, {}]) {
      const cmd = apiInstallCmd(st, { host: 'claude', path: cl, excludeRules: bad }).cmd.map(String);
      assert.equal(cmd[cmd.indexOf('--exclude-rules') + 1], 'none',
        `a bogus excludeRules value reached the argv: ${JSON.stringify(bad)}`);
      assert.ok(!cmd.some((a) => a.includes('evil')), 'a path-shaped address reached the argv');
    }
    // A body that says nothing at all falls back to the INSTALL's own line, which this
    // markerless fixture leaves empty — and the flag is SPELLED, never elided, or
    // `harness.config.json` would get to describe an install it knows nothing about.
    const cmd0 = apiInstallCmd(st, { host: 'claude', path: cl }).cmd.map(String);
    assert.equal(cmd0[cmd0.indexOf('--exclude-rules') + 1], 'none');
  });
});

// Law IV's gate switch across the same boundary (the Constitution page's toggle on row IV). Only a
// real JSON boolean counts; anything else falls back to the install's own `Deletion gate:` line,
// so a malformed body can never disarm a gate — and a body that says nothing (the pack Apply, the
// footprint switch) keeps the switch exactly as deployed, in both directions.
test('the deletion gate switch reaches the install command only as a boolean, else the install keeps it', () => {
  withThreeInstalls(({ st, cl }) => {
    const argv = (body) => apiInstallCmd(st, { host: 'claude', path: cl, ...body }).cmd.map(String);
    assert.equal(argv({ deletionGate: false }).at(-1), '--no-deletion-gate', 'false did not disarm');
    for (const bad of ['false', 0, null, 'off', {}]) {
      assert.ok(!argv({ deletionGate: bad }).includes('--no-deletion-gate'),
        `a non-boolean ${JSON.stringify(bad)} disarmed an armed install`);
    }
    assert.ok(!argv({}).includes('--no-deletion-gate'), 'an armed install lost its gate on a plain rebuild');
    // A disarmed install: its carrier says so, and a body that says nothing keeps it off.
    fs.mkdirSync(cl, { recursive: true });
    fs.writeFileSync(path.join(cl, 'CLAUDE.md'), '# x\n\nActive packs: craft\nDeletion gate: off\n');
    assert.equal(argv({}).at(-1), '--no-deletion-gate', 'a plain rebuild re-armed a disarmed install');
    assert.equal(argv({ deletionGate: 'true' }).at(-1), '--no-deletion-gate', 'a string re-armed it');
    assert.ok(!argv({ deletionGate: true }).includes('--no-deletion-gate'), 'true did not re-arm');
  });
});

// Laws I and III get the same two switches (user decision 2026-10-18). Each key is parsed ON ITS
// OWN: the console spreads the whole install into every body, so a key it did not name, or one
// that is not a boolean, must fall back to THAT gate's own carrier line — never to a neighbour's.
test('the secrets and done gate switches each reach the install command only as a boolean', () => {
  withThreeInstalls(({ st, cl }) => {
    const argv = (body) => apiInstallCmd(st, { host: 'claude', path: cl, ...body }).cmd.map(String);
    const flags = (a) => a.filter((t) => /^--no-(secrets|done|deletion)-gate$/.test(t));
    // The sandboxed ~/.claude outlives one cell (the deletion cell above leaves a carrier there),
    // so this one starts from an armed carrier of its own.
    fs.mkdirSync(cl, { recursive: true });
    fs.writeFileSync(path.join(cl, 'CLAUDE.md'), '# x\n\nActive packs: craft\n');
    assert.deepEqual(flags(argv({})), [], 'an armed install grew a gate flag on a plain rebuild');
    assert.deepEqual(flags(argv({ secretsGate: false })), ['--no-secrets-gate'], 'secrets: false');
    assert.deepEqual(flags(argv({ doneGate: false })), ['--no-done-gate'], 'done: false');
    assert.deepEqual(flags(argv({ secretsGate: false, doneGate: false, deletionGate: false })),
      ['--no-secrets-gate', '--no-done-gate', '--no-deletion-gate'], 'all three, in law order');
    for (const bad of ['false', 0, null, 'off', {}]) {
      assert.deepEqual(flags(argv({ secretsGate: bad, doneGate: bad })), [],
        `a non-boolean ${JSON.stringify(bad)} disarmed a gate`);
    }
    // A carrier with Law I off: a body naming only the done gate keeps Law I off.
    fs.writeFileSync(path.join(cl, 'CLAUDE.md'), '# x\n\nActive packs: craft\nSecrets gate: off\n');
    assert.deepEqual(flags(argv({ doneGate: false })), ['--no-secrets-gate', '--no-done-gate']);
    assert.deepEqual(flags(argv({ secretsGate: 'true' })), ['--no-secrets-gate'], 'a string re-armed it');
    assert.deepEqual(flags(argv({ secretsGate: true })), [], 'true did not re-arm');
  });
});

test('a named install reads its own target, theme and emit', () => {
  withTwoViews(({ st, cl }) => {
    const v = installView(st, { host: 'claude', path: cl });
    assert.ok(samePath(v.target, cl));
    assert.equal(v.theme, 'imperial', "the theme was not read from the named install");
    assert.equal(v.emit, 'claude-global', 'the emit was not read from the named install');
    assert.equal(st.theme, 'neutral', 'naming an install moved the daemon state');
  });
});

test('a kits change for the non-viewed install keeps THAT install theme, not the view theme', () => {
  withTwoViews(({ st, cl }) => {
    const cmd = apiInstallCmd(st, { host: 'claude', path: cl, kits: ['spring-boot'] }).cmd.map(String);
    assert.equal(cmd[cmd.indexOf('--theme') + 1], 'imperial',
      'the view theme (neutral) leaked into the other install rebuild');
  });
});

test('naming an unknown pair raises NotFound', () => {
  withTwoViews(({ st }) => {
    assert.throws(() => installView(st, { host: 'claude', path: '/no/such/root' }), NotFound);
  });
});

// The install list marks the DEFAULT install (`defaultView`), which the console's pickers start
// on: the first active one, opencode before claude. Only an active install can be it, so with
// both manifests gone no row is marked.
test('the install list marks exactly the default install', () => {
  withTwoViews(({ oc, cl }) => {
    const marked = () => apiInstalls().installs.filter((r) => r.default).map((r) => r.host);
    assert.deepEqual(marked(), [], 'an install that is not active was marked the default');
    for (const d of [oc, cl]) fs.writeFileSync(path.join(d, GLOBAL_MANIFEST), JSON.stringify({ owned: [] }));
    assert.deepEqual(marked(), ['opencode']);
    fs.rmSync(path.join(oc, GLOBAL_MANIFEST));
    assert.deepEqual(marked(), ['claude'], 'the default did not move when opencode stopped being active');
  });
});

// THE CHOSEN DEFAULT. Writing it creates the tier folder, which the console reads as a tier, so each
// case drops the folder (dropSandboxTier): one fixture home
// serves the whole file, and the case above expects the fleet order.
const pickFile = () => {
  const file = sharedPaths().defaultInstall;
  assert.ok(file.startsWith(TMP_ROOT), `the pick file is outside the sandbox: ${file}`);
  return file;
};
const markedDefault = () => apiInstalls().installs.filter((r) => r.default).map((r) => r.host);
const withBothActive = (fn) => withTwoViews(({ st, oc, cl }) => {
  pickFile(); // the sandbox guard, before anything can write a pick
  for (const d of [oc, cl]) fs.writeFileSync(path.join(d, GLOBAL_MANIFEST), JSON.stringify({ owned: [] }));
  try { return fn({ st, oc, cl }); } finally { dropSandboxTier(); }
});

test('a chosen install beats the fleet order, in the console and in status', () => {
  withBothActive(({ st, cl }) => {
    assert.deepEqual(markedDefault(), ['opencode'], 'the control: no pick reads the fleet order');
    assert.equal(statusData().emit, 'opencode-global');
    assert.deepEqual(apiDefaultInstallSet(st, { host: 'claude', path: cl }), { ok: true });
    assert.deepEqual(markedDefault(), ['claude']);
    assert.ok(samePath(defaultView()[1], cl));
    assert.equal(statusData().emit, 'claude-global', 'the status line kept the fleet order');
    assert.ok(samePath(st.target, cl), 'the daemon state stayed on the old default');
    assert.equal(st.theme, 'imperial');
    const stored = JSON.parse(fs.readFileSync(pickFile(), 'utf8'));
    assert.equal(stored.host, 'claude');
    assert.ok(samePath(stored.path, cl));
    assert.deepEqual(Object.keys(stored), ['host', 'path']);
  });
});

test('a project install can be the default: its data dir and its root stay apart', () => {
  withBothActive(({ st, oc }) => {
    const proj = path.join(path.dirname(oc), 'proj');
    fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(proj, '.claude', GLOBAL_MANIFEST), JSON.stringify({ owned: [] }));
    fs.writeFileSync(path.join(proj, '.geneseed-emit'), 'claude');
    const cwd = process.cwd();
    process.chdir(proj);
    try {
      assert.deepEqual(apiDefaultInstallSet(st, { host: 'claude', path: proj }), { ok: true });
      assert.ok(samePath(st.target, path.join(proj, '.claude')));
      assert.ok(samePath(st.root, proj));
      assert.equal(statusData().emit, 'claude');
      assert.deepEqual(apiInstalls().installs.filter((r) => r.default).map((r) => r.scope), ['project']);
    } finally { process.chdir(cwd); }
  });
});

test('a stale or unreadable pick falls back to the fleet order, and a pick comes back with its install', () => {
  withBothActive(({ st, cl }) => {
    apiDefaultInstallSet(st, { host: 'claude', path: cl });
    const manifest = path.join(cl, GLOBAL_MANIFEST);
    fs.rmSync(manifest);
    assert.deepEqual(markedDefault(), ['opencode'], 'a removed install stayed the default');
    assert.equal(statusData().emit, 'opencode-global');
    fs.writeFileSync(manifest, JSON.stringify({ owned: [] }));
    assert.deepEqual(markedDefault(), ['claude'], 'the pick did not survive its install going away');
    const good = fs.readFileSync(pickFile(), 'utf8');
    for (const bad of ['{ torn', 'null', '[]', '{"host": 1, "path": 2}', '{"host": "claude"}',
      '{"host": "claude", "path": "/no/such/install"}', '{"host": "bob", "path": "/x"}',
      good.replace('claude', 'bob')]) {
      fs.writeFileSync(pickFile(), bad);
      assert.deepEqual(markedDefault(), ['opencode'], `the pick file ${bad} changed the default`);
    }
  });
});

test('a pair that is not an active install is refused, and the pick stays as it was', () => {
  withThreeInstalls(({ st, oc, cl, proj }) => {
    const refused = { ok: false, error: 'not an active install (host, path)' };
    pickFile(); // the sandbox guard, before anything can write a pick
    try {
      for (const body of [
        { host: 'opencode', path: proj }, // disabled
        { host: 'claude', path: cl }, // absent
        { host: 'claude', path: oc }, // an active path under another host
        { host: 'opencode', path: '/no/such/install' },
        { host: 'opencode' }, { path: oc }, { host: 'opencode', path: '' }, { host: 'opencode', path: 5 },
      ]) {
        assert.deepEqual(apiDefaultInstallSet(st, body), refused, JSON.stringify(body));
        assert.equal(fs.existsSync(pickFile()), false, `${JSON.stringify(body)} wrote a pick`);
      }
      assert.deepEqual(apiDefaultInstallSet(st, { host: 'opencode', path: oc }), { ok: true });
      const kept = fs.readFileSync(pickFile(), 'utf8');
      assert.deepEqual(apiDefaultInstallSet(st, { host: 'opencode' }), refused);
      assert.equal(fs.readFileSync(pickFile(), 'utf8'), kept, 'a half pair cleared the pick');
    } finally { dropSandboxTier(); }
  });
});

// The route has no clearing body: a malformed request reaches it as `{}` (`readJsonBody`), and a
// broken client must not erase a choice.
test('an empty, malformed, null or half body is refused and the pick stays', () => {
  withBothActive(({ st, cl }) => {
    apiDefaultInstallSet(st, { host: 'claude', path: cl });
    const kept = fs.readFileSync(pickFile(), 'utf8');
    for (const body of [{}, readJsonBody(Buffer.from('{ torn')), { host: null, path: null },
      { host: 'claude' }, { path: cl }]) {
      assert.deepEqual(apiDefaultInstallSet(st, body),
        { ok: false, error: 'not an active install (host, path)' }, JSON.stringify(body));
      assert.equal(fs.readFileSync(pickFile(), 'utf8'), kept, `${JSON.stringify(body)} touched the pick`);
    }
    assert.deepEqual(markedDefault(), ['claude']);
    assert.ok(samePath(st.target, cl));
  });
});

// `install` and `theme` follow the pick. `agent_md` does not: it reports whether OpenCode's carrier
// is there, and that is still worth a row when another install is the default.
test('status names the picked install and its voice, and keeps the agent_md health row', () => {
  withBothActive(({ st, oc, cl }) => {
    fs.writeFileSync(path.join(oc, '.geneseed-theme'), 'neutral');
    const before = statusData();
    assert.equal(before.theme, 'neutral', 'the control: no pick reads the walk');
    assert.ok(samePath(before.agent_md, path.join(oc, 'AGENT.md')));
    apiDefaultInstallSet(st, { host: 'claude', path: cl });
    const after = statusData();
    assert.equal(after.emit, 'claude-global');
    assert.equal(after.theme, 'imperial');
    assert.equal(after.agent_md, before.agent_md, 'a preference hid the health row');
  });
});

// A repo's root marker is the LAST emit's, so with Claude and Bob in one repo it cannot say which
// install was picked. `bob` here is that later emit; the pick is the other one.
test('a project pick in a repo with two project installs reads its own dialect', () => {
  withBothActive(({ st, oc }) => {
    const repo = path.join(path.dirname(oc), 'two');
    for (const marker of ['.claude', '.bob']) {
      fs.mkdirSync(path.join(repo, marker), { recursive: true });
      fs.writeFileSync(path.join(repo, marker, GLOBAL_MANIFEST), JSON.stringify({ owned: [] }));
    }
    fs.writeFileSync(path.join(repo, '.geneseed-emit'), 'bob');
    const cwd = process.cwd();
    process.chdir(repo);
    try {
      assert.deepEqual(apiDefaultInstallSet(st, { host: 'claude', path: repo }), { ok: true });
      assert.ok(samePath(st.target, path.join(repo, '.claude')));
      assert.equal(st.emit, 'claude', 'the root marker of the other install set the dialect');
      st.refresh({ doctor: false });
      assert.equal(st.emit, 'claude', 'a refresh went back to the root marker');
      assert.deepEqual(apiDefaultInstallSet(st, { host: 'bob', path: repo }), { ok: true });
      assert.equal(st.emit, 'bob');
    } finally { process.chdir(cwd); }
  });
});
