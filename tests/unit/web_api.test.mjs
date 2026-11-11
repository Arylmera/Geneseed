// THE WEB API'S FUNCTIONS, IN PROCESS — overview, fleet and doctor (every test that reads a doctor verdict) plus the local-host guard.
// One of the `web_api*.test.mjs` files split from a single file; shared fixtures live in
// `tests/helpers/web_api_fixture.mjs`.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { localHost, makeHandler } from '../../js/web/handler.mjs';
import { apiOverview, apiDoctor, apiFleet, apiLoops } from '../../js/web/api.mjs';
import { NotFound, apiCatalog } from '../../js/web/catalog.mjs';
import { defaultView, warmDoctor, webState as realWebState } from '../../js/web/state.mjs';
import { buildActionCmds } from '../../js/web/actions.mjs';
import { apiRules, apiRulesMutate } from '../../js/web/user-files.mjs';
import { tuiInventory } from '../../js/inspect/inventory.mjs';
import { apiInstallToggle, apiMemoryDelete } from '../../js/web/actions.mjs';
import { GLOBAL_MANIFEST } from '../../js/hosts/hosts.mjs';
import { autostartFile } from '../../js/hosts/shim.mjs';
import { makeCfg } from '../../js/build/source.mjs';
import { sourceFingerprint } from '../../js/build/version.mjs';
import { STATE_ROUTES } from '../../js/web/routes.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';
import { webFixtureTeardown, ROOT } from '../helpers/web_fixture.mjs';
import { withGlobalInstalls as withGlobalInstallsFixture } from '../helpers/installs_fixture.mjs';
import {
  DISABLED, neutral, withGlobalRoot, seedGlobal, withThreeInstalls, withTwoViews, seedFact, fetchStatus, withRules, webState,
} from '../helpers/web_api_fixture.mjs';

after(webFixtureTeardown);

// The DNS-rebinding guard: only loopback Host headers reach the API.

test('loopback hosts pass the local-host guard', () => {
  for (const h of ['127.0.0.1', '127.0.0.1:4747', 'localhost', 'LOCALHOST:80',
    '[::1]:4747', '[::1]']) {
    assert.ok(localHost(h), `${h} was rejected`);
  }
});

// THE SUFFIX CASES ARE THE POINT. `127.0.0.1.evil.com` and `localhost.evil.com` are what a
// naive `startsWith`/`includes` guard lets through, and they are the whole DNS-rebinding attack:
// an attacker's DNS name that resolves to loopback, so the browser sends it and the origin check
// is the only thing standing between a web page and this API.
test('foreign hosts are rejected by the local-host guard', () => {
  for (const h of ['evil.com', 'evil.com:4747', '127.0.0.1.evil.com',
    'localhost.evil.com', '', null, undefined]) {
    assert.ok(!localHost(h), `${JSON.stringify(h)} was accepted`);
  }
});

test('the overview says whether the server is running code older than the files on disk', () => {
  // `serve` installs `daemonStale` (its start stamp against `codeStamp()` read now); a state
  // built without a server has none and reports false rather than a guess.
  const st = neutral();
  assert.equal(apiOverview(st).daemon_stale, false);
  st.daemonStale = () => true;
  assert.equal(apiOverview(st).daemon_stale, true);
  st.daemonStale = () => false;
  assert.equal(apiOverview(st).daemon_stale, false);
});

// The Server tab's header reads the process answering it: this test process is that process, so
// its pid is the expected value, and its start lies at or before now. `autostart` reads the home's
// login launcher, so only its shape is pinned: this platform's file and one of the four states. The daemon record beside the target holds
// the write token, and a GET must never carry it: the fields are built one by one, and a record
// spread into them would put `secret-xyz` in the JSON.
test('the overview names the server process and never the daemon record token', () => {
  const sb = makeSandbox();
  try {
    fs.writeFileSync(path.join(sb.path, '.geneseed-web.json'),
      JSON.stringify({ pid: 1, port: 4747, token: 'secret-xyz', started: 1, code: 'x' }));
    const ov = apiOverview(webState('neutral', sb.path));
    assert.equal(ov.server.pid, process.pid);
    assert.ok(ov.server.started <= Math.floor(Date.now() / 1000), 'a start in the future');
    assert.ok(ov.server.started > 1, 'the start came from the daemon record, not the process');
    const file = autostartFile();
    if (file === null) assert.equal(ov.server.autostart, null);
    else {
      assert.equal(ov.server.autostart.file, file);
      assert.ok(['absent', 'ours', 'stale', 'hand'].includes(ov.server.autostart.state));
    }
    assert.ok(!JSON.stringify(ov).includes('secret-xyz'), 'the write token reached a GET');
  } finally { sb.cleanup(); }
});

test('the overview carries counts, a doctor verdict and an accent', () => {
  const ov = apiOverview(neutral());

  assert.ok('counts' in ov);
  assert.equal(typeof ov.counts.agents, 'number');
  assert.ok(ov.counts.agents > 0,
    'zero agents — the shared fixture did not build, and every count assertion in this file '
    + 'is now measuring an empty directory rather than the port');
  assert.equal(typeof ov.counts.config, 'number');

  assert.ok('doctor' in ov);
  assert.ok('ok' in ov.doctor);
  assert.ok(Array.isArray(ov.doctor.problems));
  assert.ok('checked_at' in ov.doctor);

  assert.ok('theme' in ov);
  // The UI tints itself with the deployed theme's accent.
  assert.ok(['red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'].includes(ov.accent),
    `accent ${JSON.stringify(ov.accent)} is not one of the seven`);
});

// A doctor run walks the whole install. Doing it per REQUEST would make every page load pay for
// it, so the verdict is memoised on the state and only `refresh()` drops it.
test('the doctor verdict is cached until refresh', () => {
  const st = neutral();
  const first = apiOverview(st).doctor;
  assert.equal(st.doctor, st.doctor, 'the getter recomputed between two reads');
  const second = apiOverview(st).doctor;
  assert.deepEqual(first, second);

  st.refresh();
  assert.equal(st._doctor, null, 'refresh() left the previous verdict in place');
});

test('a catalog section answers with named, titled, described items', () => {
  const cat = apiCatalog(neutral(), 'agents');
  assert.equal(cat.section, 'agents');
  assert.ok(cat.items.length > 0);
  const first = cat.items[0];
  for (const k of ['name', 'title', 'desc']) assert.ok(k in first, `no ${k} on a catalog row`);
});

test('an unknown catalog section raises NotFound', () => {
  assert.throws(() => apiCatalog(neutral(), 'bogus'), NotFound);
});

test('the overview counts the tiers without moving the laws badge', () => {
  const o = apiOverview(neutral());
  // ⚠ `counts.laws` STAYS THE INVARIANT COUNT. The rail badge reads it, `{N_LAWS}` mirrors it,
  // and the doctor's FROZEN `proseMirrorProblems` holds README and SHIPPED.md prose to the
  // same number — widening it to the whole constitution moves all four at once, and one of
  // the four cannot be re-blessed.
  assert.equal(o.counts.laws, 9); // 9 since IX and XI were removed (2026-09-30)
  assert.equal(o.counts.ontology, 5); // 5 since Ownership joined the Credo (2026-10-26)
  assert.deepEqual(o.counts.doctrines, { active: 5, total: 5, rules: 30 });
  const narrowed = apiOverview({ ...neutral(), inventory: tuiInventory('neutral', ['craft', 'rigor']) });
  assert.equal(narrowed.counts.laws, 9, 'a pack toggle moved the invariant count');
  // The two packs it built in, but all 30 rules: the Constitution page lists a rule that is off,
  // with its switch, and the rail's count is what the page lists.
  assert.deepEqual(narrowed.counts.doctrines, { active: 2, total: 5, rules: 30 });
});

// ---------------------------------------------------------------------------------------------
// Doctor: the grouped view and the flat list are the same set.

test('the doctor groups are exactly the flat problem list', () => {
  const d = apiDoctor(neutral());
  assert.ok('groups' in d);
  assert.ok(d.groups.length > 0);
  for (const g of d.groups) {
    assert.ok('check' in g);
    assert.ok('label' in g);
    assert.ok(Array.isArray(g.problems));
  }
  const checks = new Set(d.groups.map((g) => g.check));
  for (const need of ['build', 'global', 'parity', 'authoring']) {
    assert.ok(checks.has(need), `no ${need} group`);
  }
  // The flat list is exactly the union of the groups, deduped and sorted. Two renderings of
  // one verdict that can disagree is a console that reports a different number of problems
  // depending on which panel you look at.
  const union = [...new Set(d.groups.flatMap((g) => g.problems))].sort();
  assert.deepEqual(d.problems, union);
  assert.equal(d.ok, d.problems.length === 0);
});

test('the overview reports the viewed install\'s deletion gate', () => {
  withThreeInstalls(({ st, oc }) => {
    const ov = apiOverview(st);
    assert.ok(ov.install, 'the fixture\'s active install is not the viewed one, so this proves nothing');
    assert.equal(ov.install.deletionGate, true, 'no marker must read as armed');
    fs.writeFileSync(path.join(oc, 'AGENT.md'), '# x\n\nActive packs: craft\nDeletion gate: off\n');
    assert.equal(apiOverview(st).install.deletionGate, false);
  });
});

test('the overview reports the viewed install\'s secrets and done gates', () => {
  withThreeInstalls(({ st, oc }) => {
    const ov = apiOverview(st);
    assert.ok(ov.install, 'the fixture\'s active install is not the viewed one, so this proves nothing');
    assert.equal(ov.install.secretsGate, true, 'no marker must read as armed');
    assert.equal(ov.install.doneGate, true, 'no marker must read as armed');
    fs.writeFileSync(path.join(oc, 'AGENT.md'), '# x\n\nActive packs: craft\nDone gate: off\n');
    const next = apiOverview(st).install;
    assert.deepEqual([next.secretsGate, next.doneGate, next.deletionGate], [true, false, true]);
  });
});

// The fleet rows carry each install's own posture and mode: the Overview shows them per row.
test('the fleet rows carry each install its own posture, mode and fact count', () => {
  withTwoViews(({ st, oc, cl }) => {
    // The fleet lists ACTIVE installs only: a manifest is what makes each view one.
    for (const d of [oc, cl]) fs.writeFileSync(path.join(d, GLOBAL_MANIFEST), JSON.stringify({ owned: [] }));
    // Posture and mode are read off the carrier's prose; opencode's has none, so it answers null.
    fs.writeFileSync(path.join(cl, 'CLAUDE.md'), '**Artisan** — a posture.\n\n**Foreman** — a mode.\n');
    const rows = apiFleet(st).installs;
    assert.equal(rows.some((r) => 'selected' in r), false, 'a fleet row still claims a viewed install');
    assert.deepEqual(rows.map((r) => [r.host, r.posture, r.mode]),
      [['opencode', null, null], ['claude', 'artisan', 'foreman']]);
    // Its memory facts too: MEMORY.md is the index, not a fact; no memory folder is none.
    seedFact(cl);
    assert.deepEqual(apiFleet(st).installs.map((r) => [r.host, r.facts]), [['opencode', 0], ['claude', 1]]);
  });
});

// Session start is measured where the hook's stdout is capped and no repo is needed: an active
// global Claude-style install. 136 is `claude.test.mjs`'s hand count of the same `ab\ncd` rules.
test('the fleet measures session start on an active global hook install only', () => {
  withTwoViews(({ st, oc, cl }) => {
    const proj = path.join(path.dirname(oc), 'proj');
    fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
    for (const d of [oc, cl, path.join(proj, '.claude')]) {
      fs.writeFileSync(path.join(d, GLOBAL_MANIFEST), JSON.stringify({ owned: [] }));
      fs.writeFileSync(path.join(d, 'user-rules.md'), 'ab\ncd\n');
    }
    const cwd = process.cwd();
    process.chdir(proj);
    try {
      const read = () => Object.fromEntries(apiFleet(st).installs
        .map((r) => [`${r.host} ${r.scope}`, r.session_start]));
      assert.deepEqual(read(), {
        'opencode global': null,
        'claude global': { chars: 136, budget: 9000, cut: false },
        'claude project': null,
      });
      fs.mkdirSync(path.join(cl, DISABLED, 'claude'), { recursive: true });
      assert.equal(read()['claude global'], null);
    } finally { process.chdir(cwd); }
  });
});

// An eager wiki walks a whole vault, and both the cost and the session-start measure render it, so a
// poll serves them from one memo. Rows: inside the 30 s window it is served as it was, at 30 s it is
// read again, whatever no `refresh` reported. A refresh clears it inside the window, by both ways out:
// `refreshOwn`, and `selectView` (a refresh that follows the default install ends there). Hand count,
// `[session start, context]`: `ab\ncd` is 136 and 5; each added line adds 4 and 3.
const AB = 'ab\ncd\n';
test('the fleet serves its session-file reads from a memo for 30 s, and until a refresh', () => {
  withTwoViews(({ st, cl }) => {
    fs.writeFileSync(path.join(cl, GLOBAL_MANIFEST), JSON.stringify({ owned: [] }));
    fs.writeFileSync(path.join(cl, 'CLAUDE.md'), 'a carrier\n');
    const rules = path.join(cl, 'user-rules.md');
    const at = (now) => {
      const row = apiFleet(st, { now }).installs.find((r) => r.host === 'claude');
      return [row.session_start.chars, row.cost.context];
    };
    const T = 1_000_000;
    fs.writeFileSync(rules, AB);
    assert.deepEqual(at(T), [136, 5]);
    fs.writeFileSync(rules, `${AB}ef\n`);
    assert.deepEqual(at(T + 29_999), [136, 5]);
    assert.deepEqual(at(T + 30_000), [140, 8]);
    fs.writeFileSync(rules, `${AB}ef\ngh\n`);
    assert.deepEqual(at(T + 30_001), [140, 8]);
    st.refresh({ doctor: false });
    assert.deepEqual(at(T + 30_001), [144, 11]);
    fs.writeFileSync(rules, `${AB}ef\ngh\nij\n`);
    st.selectView(st.target, st.root);
    assert.deepEqual(at(T + 30_001), [148, 14]);
  });
});

// GET /api/fleet — every INSTALLED harness, each judged by its OWN version marker. Three seeded
// hosts cover the three verdicts: bob's marker carries the source fingerprint (synced),
// opencode's an older one (behind), openclaude has none (unknown — never "synced" by default).
// claude is not seeded, and a host with nothing installed is not listed at all: installing is
// the Installs page's job, not the Overview's. A global install is drift-checkable, so its row
// carries a figure; the marker's mtime is the build time, and no marker means no build time.
// No host here has a root file, so every cost is null (cost.test.mjs covers the arithmetic).
test('the fleet lists only installed harnesses, each with its own sync verdict', () => {
  withGlobalInstallsFixture(['bob', 'opencode', 'openclaude'], ({ cfgs }) => {
    const st = neutral();
    st.stampDoctor([]);
    const source = sourceFingerprint(makeCfg());
    fs.writeFileSync(path.join(cfgs.bob, '.geneseed-version'), `${source} (built x)\n`);
    fs.writeFileSync(path.join(cfgs.opencode, '.geneseed-version'), '000000000000 (built x)\n');

    const fleet = apiFleet(st);
    assert.equal(fleet.source_fp, source);
    // The release a behind row names ("Behind 4.19.0"): the overview's own label, so the Hosts
    // table and the topbar never name two releases. `in` first: a missing key reads as undefined.
    assert.ok('version' in fleet, 'the fleet carries no source release label');
    assert.equal(fleet.version, apiOverview(st).version);
    const by = Object.fromEntries(fleet.installs.map((r) => [r.host, r]));
    assert.deepEqual(Object.keys(by).sort(), ['bob', 'openclaude', 'opencode'],
      'claude has nothing installed and must not be listed');
    assert.equal(by.bob.verdict, 'synced');
    assert.equal(by.opencode.verdict, 'behind');
    assert.equal(by.openclaude.verdict, 'unknown');
    assert.equal(by.openclaude.installed_fp, null);
    assert.equal(by.openclaude.built_epoch, null, 'no marker, no build time');
    assert.equal(by.bob.built_epoch,
      Math.floor(fs.statSync(path.join(cfgs.bob, '.geneseed-version')).mtimeMs / 1000));
    for (const r of fleet.installs) {
      assert.equal(r.state, 'active');
      assert.equal(r.diffable, true, `${r.host}: a global install is drift-checkable`);
      for (const k of ['edited', 'added', 'missing']) assert.equal(typeof r.drift[k], 'number');
      // The fixture seeds a manifest and no root file, so there is nothing to measure.
      assert.equal(r.cost, null, `${r.host}: no carrier on disk, so no cost figure`);
    }
  });
});

// THE LOOPS PAGE READS THE CATALOGUE THE CLI READS, from the console's install ROOT — the repo for
// a project install, where `.geneseed/` lives. Hermetic: the root is a sandbox carrying one
// project brick that overrides the shipped `apply`, and XDG points into the sandbox so a
// developer's own global bricks cannot leak in. Shipped templates come through with their graph;
// a brick carries its body; the override is reported, never silent.
test('the loops endpoint lists templates, bricks and overrides from the install root', () => {
  const sb = makeSandbox();
  const prevXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(sb.path, 'xdg');
  try {
    const bricks = path.join(sb.path, '.geneseed', 'bricks');
    fs.mkdirSync(bricks, { recursive: true });
    fs.writeFileSync(path.join(bricks, 'apply.md'), '---\nname: apply\ndescription: Team apply.\n'
      + 'effect: mutate\nagent: developer\noutcomes: pass\n---\nDo it our way.\n');
    const { templates, bricks: rows, overridden } = apiLoops(webState('neutral', sb.path));
    assert.deepEqual(templates.map((t) => t.name), ['api-endpoint', 'architecture-decision', 'bugfix', 'ci-repair', 'deps-upgrade', 'enforce-architecture-rule', 'feature', 'fix-flaky-tests', 'legacy-refactor', 'legacy-tests', 'refactor', 'remove-dead-code', 'spec-first-feature', 'tdd', 'update-contract']);
    const bugfix = templates.find((t) => t.name === 'bugfix');
    assert.equal(bugfix.origin, 'shipped');
    assert.equal(bugfix.graph.start, 'reproduce');
    assert.equal(bugfix.graph.loops[0].name, 'iterations');
    assert.equal(typeof bugfix.description, 'string');
    // The graph is passed whole, so a template's `rules` reach the page with it.
    assert.deepEqual(templates.find((t) => t.name === 'legacy-tests').graph.rules,
      ['Tests only: production code is never touched.']);
    // `category` is passed through on the graph too: the page groups templates by it.
    assert.deepEqual(Object.fromEntries(templates.map((t) => [t.name, t.graph.category])), {
      'api-endpoint': 'development', 'architecture-decision': 'architecture', bugfix: 'development',
      'ci-repair': 'day-to-day', 'deps-upgrade': 'day-to-day', 'enforce-architecture-rule': 'architecture',
      feature: 'development', 'fix-flaky-tests': 'tests', 'legacy-refactor': 'refactoring',
      'legacy-tests': 'tests', refactor: 'refactoring', 'remove-dead-code': 'refactoring',
      'spec-first-feature': 'development', tdd: 'tests', 'update-contract': 'architecture',
    });
    const apply = rows.find((b) => b.name === 'apply');
    assert.deepEqual(
      { origin: apply.origin, description: apply.description, effect: apply.effect,
        agent: apply.agent, skill: apply.skill, outcomes: apply.outcomes, body: apply.body,
        available: apply.available },
      { origin: 'project', description: 'Team apply.', effect: 'mutate', agent: 'developer',
        skill: null, outcomes: ['pass'], body: 'Do it our way.', available: true });
    assert.deepEqual(overridden, ['apply (project, overrides shipped)']);
    // A malformed project brick is skipped by the catalogue — and SAID, not dropped silently.
    fs.writeFileSync(path.join(bricks, 'broken.md'), '---\nname: broken\neffect: maybe\n---\n');
    assert.deepEqual(apiLoops(webState('neutral', sb.path)).problems, [
      'bricks/broken.md (project): broken: description is empty',
      'bricks/broken.md (project): broken: effect must be read or mutate, not "maybe"',
      'bricks/broken.md (project): broken: exactly one of agent or skill',
      'bricks/broken.md (project): broken: outcomes is empty',
    ]);
    assert.ok(rows.every((b, i) => i === 0 || rows[i - 1].name < b.name), 'bricks sorted by name');
    assert.equal(STATE_ROUTES['/api/loops'], apiLoops);
    // The rail badge: the fifteen shipped templates, counted on the overview it already polls.
    assert.equal(apiOverview(webState('neutral', sb.path)).counts.loops, 15);
  } finally {
    if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prevXdg;
    sb.cleanup();
  }
});

// ---------------------------------------------------------------------------------------------
// The doctor cache survives what the doctor cannot see. A doctor run costs ~3.6 s, and the console
// refetches the overview after EVERY mutation — so a mutation that drops the verdict puts that
// run on the very next request. The rule: a memory delete and a rule write keep the cached
// verdict (the doctor reads the checkout, the hook shim, the hook shell, the OpenCode config dirs
// and the deployed install — never the memory store or user-rules.md); a finished job, an install
// toggle and a view switch drop it, since each can change something the doctor reads. A planted
// SENTINEL verdict stands in for a real run, so "kept" and "dropped" are both one equality.

const SENTINEL = '[sentinel] planted by the test, never by doctorCollect';

const plant = (st) => st.stampDoctor([SENTINEL], ['neutral'],
  [{ check: 'build', label: 'Build scan (neutral)', problems: [SENTINEL] }]);

test('a memory delete keeps the cached doctor verdict', () => {
  const sb = makeSandbox();
  try {
    const mem = path.join(sb.path, 'memory');
    fs.mkdirSync(mem, { recursive: true });
    fs.writeFileSync(path.join(mem, 'MEMORY.md'), '# Memory Index\n- [a](a.md) — x\n');
    fs.writeFileSync(path.join(mem, 'a.md'), 'a fact\n');
    const st = webState('neutral', sb.path);
    plant(st);
    assert.deepEqual(apiMemoryDelete(st, 'a'), { archived: 'a' });
    assert.deepEqual(st.doctor.problems, [SENTINEL],
      'a memory delete dropped the doctor verdict — the next overview pays a full doctor run');
  } finally { sb.cleanup(); }
});

test('a rule write keeps the cached doctor verdict', () => {
  withRules((box) => {
    plant(box.state);
    const r = apiRulesMutate(box.state, {
      op: 'add', fingerprint: apiRules(box.state).fingerprint,
      title: 'No emoji', body: 'Plain text only.', scope: 'project',
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(box.state.doctor.problems, [SENTINEL], 'a rule write dropped the verdict');
  });
});

test('an install toggle drops the cached doctor verdict', () => {
  withGlobalRoot(({ root }) => {
    seedGlobal(root);
    const st = neutral();
    plant(st);
    const res = apiInstallToggle(st, { host: 'opencode', path: root, action: 'deactivate' });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(st._doctor, null, 'an install toggle kept a verdict about the old install');
  });
});

test('a view switch and a plain refresh drop the cached doctor verdict', () => {
  const st = neutral();
  plant(st);
  st.refresh();
  assert.equal(st._doctor, null, 'refresh() with no argument must stay the safe default');
  plant(st);
  st.selectView(st.target);
  assert.equal(st._doctor, null, 'a view switch kept the previous view\'s verdict');
});

// The job path through the real handler, with a manager whose job "finishes" the moment it
// starts — the onFinish callback is the thing under test, not the subprocess.
test('a finished job drops the cached doctor verdict', async () => {
  const st = neutral();
  plant(st);
  const jm = { busy: false, recent: () => [], get: () => null,
    start: (_action, _cmds, onFinish) => { onFinish(0); return 'j1'; } };
  const srv = http.createServer(makeHandler(st, jm, 'tok', path.join(ROOT, 'web', 'dist')));
  await new Promise((r) => { srv.listen(0, '127.0.0.1', r); });
  try {
    const res = await fetchStatus(srv.address().port, '/api/actions/doctor',
      { method: 'POST', body: '{}', headers: { 'x-geneseed-token': 'tok' } });
    assert.equal(res.status, 202, await res.text());
    assert.equal(st._doctor, null, 'a finished job kept the verdict from before it ran');
  } finally {
    await new Promise((r) => { srv.close(r); });
  }
});

// `/api/doctor` serves the cached run — groups and themes included — and re-runs only on
// `?fresh=1`, the Doctor page's Re-run button. The fresh call is a real doctor run: no shared verdict.
test('the doctor endpoint serves the cache, and re-runs only when fresh', () => {
  const st = realWebState('neutral');
  plant(st);
  const cached = STATE_ROUTES['/api/doctor'](st, '/api/doctor');
  assert.deepEqual(cached.problems, [SENTINEL]);
  assert.deepEqual(cached.themes, ['neutral']);
  assert.deepEqual(cached.groups.map((g) => g.check), ['build']);
  const fresh = STATE_ROUTES['/api/doctor'](st, '/api/doctor?fresh=1');
  assert.ok(!fresh.problems.includes(SENTINEL), 'a fresh run returned the planted verdict');
  assert.ok(fresh.groups.length > 1, 'a fresh run carried no per-check groups');
  assert.deepEqual(st.doctor.problems, fresh.problems, 'the fresh run was not cached');
});

// `serve()` calls `warmDoctor` once it is listening. The run is on its own thread, so the event
// loop keeps turning for the whole of it and a cold daemon answers at once. Until it lands the
// verdict is null (pending), never a guess; `/api/doctor`, which needs the groups, waits for it.
// The interval is also what holds the loop open: the worker is unref'd.
test('the warm-up fills the doctor cache without holding the event loop', async () => {
  const st = neutral();
  const start = performance.now();
  const longest = { gap: 0, at: start };
  const beat = setInterval(() => {
    const now = performance.now();
    longest.gap = Math.max(longest.gap, now - longest.at);
    longest.at = now;
  }, 20);
  try {
    const job = warmDoctor(st);
    assert.equal(st.doctor, null, 'a pending verdict must read as pending');
    assert.equal(warmDoctor(st), job, 'a second warm-up started another run');
    const page = STATE_ROUTES['/api/doctor'](st, '/api/doctor');
    assert.ok(page instanceof Promise, '/api/doctor answered without the run it needs');
    const { groups, ok } = await page;
    assert.ok(Array.isArray(groups) && groups.length > 0);
    assert.equal(ok, st.doctor.ok);
    assert.ok(Array.isArray(st._doctor.problems), 'the warm-up left the cache cold');
    assert.equal(st._doctorJob, null);
    // Relative, so a loaded machine cannot redden it: a loop the run held shows one gap as long
    // as the whole run.
    const took = performance.now() - start;
    assert.ok(longest.gap < took / 2, `the event loop stalled ${longest.gap} ms of ${took}`);
  } finally { clearInterval(beat); }
});

// A hung run must end: the page waiting on it gets a failed verdict that says so, never a green.
// A limit of 1 ms stands for the hang, as no real run finishes inside it.
test('a warm-up past its limit is stopped and reads as failed', async () => {
  const st = neutral();
  const beat = setInterval(() => {}, 50);
  try {
    warmDoctor(st, 1);
    const { ok, problems, groups } = await STATE_ROUTES['/api/doctor'](st, '/api/doctor');
    assert.equal(ok, false);
    assert.match(problems[0], /did not finish/);
    assert.equal(groups.length, 1);
    assert.equal(st._doctorJob, null);
    assert.equal(st.doctor.ok, false);
  } finally { clearInterval(beat); }
});

// A mutation that lands mid-run may have changed what the run read: its verdict is dropped, and
// the next ask runs afresh. The planted run stands for that next ask.
test('a refresh during the warm-up drops its verdict', async () => {
  const st = neutral();
  const beat = setInterval(() => {}, 50);
  try {
    const job = warmDoctor(st);
    st.refresh();
    assert.equal(st._doctorJob, null);
    await job;
    assert.equal(st._doctor, null, 'a run older than the mutation stamped its verdict');
    st.runDoctor = () => st.stampDoctor(['planted']);
    assert.deepEqual(st.doctor.problems, ['planted']);
  } finally { clearInterval(beat); }
});

// A SERVING daemon (`warm`) never runs the doctor in a request. Every job ends in `refresh`, and
// the console asks the overview right after: that ask used to run the doctor in line, ~12 s of a
// frozen console. Now the refresh starts the run on its thread, the overview answers at once with
// a pending verdict (null, which the console polls on), and `?fresh=1` waits on the thread too.
// Relative timings, so a loaded machine cannot redden it: the request must take well under the run.
test('after a refresh, a serving daemon answers the overview without running the doctor', async () => {
  const st = neutral();
  st.warm = true;
  st.stampDoctor(['before the job']);
  const beat = setInterval(() => {}, 50);
  try {
    const start = performance.now();
    st.refresh();
    const job = st._doctorJob;
    assert.ok(job instanceof Promise, 'the refresh started no warm-up run');
    const asked = performance.now();
    const ov = apiOverview(st);
    const took = performance.now() - asked;
    assert.equal(ov.doctor, null, 'the overview did not read the verdict as pending');
    await job;
    const run = performance.now() - start;
    assert.ok(took < run / 2, `the overview took ${took} ms of a ${run} ms doctor run`);
    assert.ok(Array.isArray(st._doctor.problems) && !st._doctor.problems.includes('before the job'));

    const page = STATE_ROUTES['/api/doctor'](st, '/api/doctor?fresh=1');
    assert.ok(page instanceof Promise, 'a fresh run went on the event loop');
    assert.equal(st._doctor, null);
    const { groups } = await page;
    assert.ok(groups.length > 1, 'the fresh run carried no per-check groups');
  } finally { clearInterval(beat); }
});

// THE DEFAULT INSTALL, e.g. ON A MACHINE WITHOUT OPENCODE (reported 2026-10: IBM Bob only). The
// console opened on the OpenCode global dir, found nothing deployed there and showed the
// onboarding form over a working ~/.bob. The default is the first ACTIVE install in the console's
// one install order (`fleetSort`): host order first (opencode before bob, even a project before
// a later host's global), then global before project of one host (even when the project comes
// first); a project's view is its data dir (`<root>/.bob`) with the root and its emit beside it (the
// emit is `<host>` for a project, `<host>-global` for a global); nothing when no install is active.
test('the default install is the first active one in the fixed order', () => {
  const sb = makeSandbox();
  const d = sb.path;
  try {
    const manifest = (dir) => {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, '.geneseed-manifest.json'), '{}', 'utf8');
    };
    const empty = path.join(d, 'opencode');
    fs.mkdirSync(empty);
    const bobGlobal = path.join(d, 'dot-bob');
    const proj = path.join(d, 'repo');
    manifest(path.join(proj, '.bob'));
    const projRow = ['bob', 'project', proj];
    assert.deepEqual(defaultView([['opencode', 'global', empty], projRow]),
      [path.join(proj, '.bob'), proj, 'bob']);
    manifest(bobGlobal);
    assert.deepEqual(defaultView([projRow, ['bob', 'global', bobGlobal]]),
      [bobGlobal, bobGlobal, 'bob-global']);
    const ocGlobal = path.join(d, 'dot-opencode');
    manifest(ocGlobal);
    assert.deepEqual(defaultView([projRow, ['bob', 'global', bobGlobal], ['opencode', 'global', ocGlobal]]),
      [ocGlobal, ocGlobal, 'opencode-global']);
    // Host order outranks scope: a claude PROJECT comes before a bob GLOBAL.
    const clProj = path.join(d, 'repo-cl');
    manifest(path.join(clProj, '.claude'));
    assert.deepEqual(defaultView([['bob', 'global', bobGlobal], ['claude', 'project', clProj]]),
      [path.join(clProj, '.claude'), clProj, 'claude']);
    assert.equal(defaultView([['opencode', 'global', empty]]), null);
  } finally { sb.cleanup(); }
});

// A non-global emit through Build carried no folder, so the generator's ./Harness landed in the
// Geneseed checkout (the job's cwd). Build now refuses it with a pointer to Deploy, and a global
// emit still builds.
test('Build refuses a project emit when no install of it is in view', () => {
  const st = { theme: 'neutral', emit: 'opencode-global', target: path.join(os.tmpdir(), 'gs-none'),
    root: path.join(os.tmpdir(), 'gs-none'), footprint: 'full', posture: 'peer', mode: 'direct',
    trust: 'balanced' };
  const refused = buildActionCmds(st, { theme: 'neutral', emit: 'bob' });
  assert.match(refused.error, /^bob installs into a folder you choose/);
  assert.ok(Array.isArray(buildActionCmds(st, { theme: 'neutral', emit: 'bob-global' })));
});
