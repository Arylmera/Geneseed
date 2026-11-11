// THE WEB API'S FUNCTIONS, IN PROCESS — user rules and loops.
// One of the `web_api*.test.mjs` files split from a single file; shared fixtures live in
// `tests/helpers/web_api_fixture.mjs`.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { apiLoops, apiLoopsActive, apiFactoriesCatalog, apiFactoriesActive } from '../../js/web/api.mjs';
import { NotFound, wikiItems } from '../../js/web/catalog.mjs';
import { apiRules, apiRulesMutate, apiRulesPromote } from '../../js/web/user-files.mjs';
import { apiLoopsPresetMutate } from '../../js/web/actions.mjs';
import { POST_ROUTES, POST_ROUTES_CONVENTION, STATE_ROUTES } from '../../js/web/routes.mjs';
import { recordLoop } from '../../js/loop/registry.mjs';
import { recordFactory } from '../../js/factory/registry.mjs';
import { initFactory, renderFactoryFile } from '../../js/factory/state.mjs';
import { PRESETS } from '../../js/loop/score.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';
import { webFixtureTeardown } from '../helpers/web_fixture.mjs';
import {
  withRules, readLf, withLoopsXdg, makeLoopWorktree, webState, emitInto, ACTIVE_TAB_GRAPH,
} from '../helpers/web_api_fixture.mjs';

after(webFixtureTeardown);

test('the rules stub is seeded once and never overwritten', () => {
  withRules((box) => {
    assert.ok(fs.statSync(box.file).isFile());
    fs.writeFileSync(box.file, 'MINE\n');
    emitInto(box.cfg);                      // a rebuild, the way a user re-runs it
    assert.equal(fs.readFileSync(box.file, 'utf8'), 'MINE\n',
      "a rebuild overwrote the user's own rules file");
  });
});

// `/api/profile`'s `seeded` flag is what the console's Overview reads to ask for the profile
// to be filled in. It is true exactly while PROFILE.md is still the template the emit wrote:
// the seeded file says true, the same text with CRLF endings (an editor that only re-saved
// it on Windows) still says true, one edited word says false, and a missing file carries
// no flag at all, only `exists: false`.
test('the profile reads seeded until its first real edit', () => {
  withRules((box) => {
    const profile = () => STATE_ROUTES['/api/profile'](box.state);
    const file = path.join(box.cfg, 'PROFILE.md');
    assert.equal(profile().seeded, true);
    const seed = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    fs.writeFileSync(file, seed.replace(/\n/g, '\r\n'));
    assert.equal(profile().seeded, true);
    fs.writeFileSync(file, seed.replace('Who I am', 'Who I really am'));
    assert.equal(profile().seeded, false);
    fs.rmSync(file);
    assert.deepEqual([profile().exists, profile().seeded], [false, undefined]);
  });
});

// The seeded format example is INDENTED, and the parser is anchored at column 0 — so the
// example must not read as a live rule.
test('the stub example does not parse as a rule', () => {
  withRules((box) => {
    const res = apiRules(box.state);
    assert.equal(res.exists, true);
    assert.deepEqual(res.rules, []);
    assert.deepEqual(res.warnings, []);
  });
});

test('a missing rules file reports not-seeded', () => {
  withRules((box) => {
    fs.rmSync(box.file);
    const res = apiRules(box.state);
    assert.equal(res.exists, false);
    assert.deepEqual(res.rules, []);
  });
});

// SPLICE FIDELITY: after add → update → retire (op `delete`) user-rules.md is the seeded stub
// again, and the retired rule's text is in user-rules-retired.md. A mutation that rewrote the
// whole document would pass every other assertion here.
test('add, update and retire round-trip while preserving the prose', () => {
  withRules((box) => {
    const before = readLf(box.file);

    const r1 = apiRulesMutate(box.state, {
      op: 'add', fingerprint: apiRules(box.state).fingerprint,
      title: 'No emoji', body: 'Plain text only.', scope: 'project',
    });
    assert.equal(r1.ok, true, JSON.stringify(r1));
    assert.equal(Number(r1.id), 1);

    const r2 = apiRulesMutate(box.state, {
      op: 'update', id: 1, fingerprint: r1.fingerprint,
      title: 'No emoji anywhere', body: 'Ever.', scope: 'user', trial_until: '2026-12-31',
    });
    assert.equal(r2.ok, true, JSON.stringify(r2));

    const parsed = apiRules(box.state).rules;
    assert.equal(parsed[0].title, 'No emoji anywhere');
    assert.equal(parsed[0].scope, 'user');
    assert.equal(parsed[0].status, 'trial');

    const r3 = apiRulesMutate(box.state, { op: 'delete', id: 1, fingerprint: r2.fingerprint });
    assert.equal(r3.ok, true, JSON.stringify(r3));

    assert.equal(readLf(box.file).replace(/\n+$/, ''), before.replace(/\n+$/, ''),
      'the file did not come back to the seeded stub — a mutation touched prose it does not own');
    assert.equal(readLf(retiredOf(box)),
      `${RETIRED_HEADER}\n## R1 — No emoji anywhere\n(scope: user | trial until: 2026-12-31)\nEver.\n`,
      'the retired text was lost');
  });
});

const retiredOf = (box) => path.join(path.dirname(box.file), 'user-rules-retired.md');

const RETIRED_HEADER = '# Retired rules — not in force, never loaded into any session.\n';

const RULES_TWO = '# User rules\n\nProse.\n\n## R1 — One\n(scope: project)\nBody one.\n\n'
  + '## R2 — Two\n(scope: user)\nBody two.\n';

test('retire moves rules to user-rules-retired.md, in order, and never twice', () => {
  withRules((box) => {
    fs.writeFileSync(box.file, RULES_TWO);
    const fp = () => apiRules(box.state).fingerprint;
    const r1 = apiRulesMutate(box.state, { op: 'delete', id: 1, fingerprint: fp() });
    assert.deepEqual([r1.ok, r1.op, r1.id], [true, 'delete', 1]);
    assert.equal(readLf(box.file), '# User rules\n\nProse.\n\n## R2 — Two\n(scope: user)\nBody two.\n');
    assert.equal(readLf(retiredOf(box)), `${RETIRED_HEADER}\n## R1 — One\n(scope: project)\nBody one.\n`);
    apiRulesMutate(box.state, { op: 'delete', id: 2, fingerprint: fp() });
    const rules = '# User rules\n\nProse.\n';
    const retired = `${RETIRED_HEADER}\n## R1 — One\n(scope: project)\nBody one.\n\n`
      + '## R2 — Two\n(scope: user)\nBody two.\n';
    assert.equal(readLf(box.file), rules);
    assert.equal(readLf(retiredOf(box)), retired);
    assert.deepEqual(apiRules(box.state).rules, []);
    assert.throws(() => apiRulesMutate(box.state, { op: 'delete', id: 1, fingerprint: fp() }),
      NotFound);
    assert.equal(readLf(box.file), rules, 'a retire of a gone rule wrote user-rules.md');
    assert.equal(readLf(retiredOf(box)), retired, 'a retire of a gone rule wrote the retired file');
  });
});

// A NEW RULE NEVER REUSES A RETIRED ID: a retired R2 means the next rule is R3, so an id in the
// user's history always names one rule. Promote goes through add and gets the same guarantee.
test('add and promote after a retire take an id above every retired one', () => {
  withRules((box) => {
    fs.writeFileSync(box.file, RULES_TWO);
    const fp = () => apiRules(box.state).fingerprint;
    apiRulesMutate(box.state, { op: 'delete', id: 2, fingerprint: fp() });
    const add = apiRulesMutate(box.state,
      { op: 'add', fingerprint: fp(), title: 'Three', body: 'Body three.' });
    assert.equal(add.id, 3);
    const mem = path.join(box.cfg, 'memory');
    fs.mkdirSync(mem, { recursive: true });
    fs.writeFileSync(path.join(mem, 'MEMORY.md'), '# Memory Index\n- [tabs](tabs.md) — x\n');
    fs.writeFileSync(path.join(mem, 'tabs.md'), '---\nname: Tabs\n---\nUse tabs.\n');
    const pro = apiRulesPromote(box.state, { name: 'tabs', fingerprint: fp() });
    assert.equal(pro.id, 4);
    assert.deepEqual(apiRules(box.state).rules.map((r) => r.id), [1, 3, 4]);
  });
});

// AN UPDATE KEEPS THE SEAM: the blank line after a rule separates it from the next one, so an
// update of a middle rule replaces the block's own lines and leaves that blank where it was.
test('update of a middle rule keeps the blank line before the next rule', () => {
  withRules((box) => {
    fs.writeFileSync(box.file, RULES_TWO);
    const up = apiRulesMutate(box.state, { op: 'update', id: 1,
      fingerprint: apiRules(box.state).fingerprint, title: 'One again', body: 'New body.' });
    assert.equal(up.ok, true, JSON.stringify(up));
    assert.equal(readLf(box.file),
      '# User rules\n\nProse.\n\n## R1 — One again\n(scope: project)\nNew body.\n\n'
      + '## R2 — Two\n(scope: user)\nBody two.\n');
  });
});

// The fingerprint is the whole concurrency story: two console tabs, or a hand edit between a
// read and a write, must CONFLICT rather than clobber.
test('a stale fingerprint conflicts instead of clobbering', () => {
  withRules((box) => {
    const fp = apiRules(box.state).fingerprint;
    apiRulesMutate(box.state, { op: 'add', fingerprint: fp, title: 'First', body: 'Wins.' });

    const res = apiRulesMutate(box.state,
      { op: 'add', fingerprint: fp, title: 'Second', body: 'Loses.' });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'conflict');
    assert.deepEqual(apiRules(box.state).rules.map((r) => r.title), ['First']);
  });
});

test('add rejects an empty title or an empty body', () => {
  withRules((box) => {
    const fp = apiRules(box.state).fingerprint;
    for (const bad of [{ title: '', body: 'x' }, { title: 'x', body: ' ' }]) {
      assert.throws(() => apiRulesMutate(box.state, { op: 'add', fingerprint: fp, ...bad }),
        `${JSON.stringify(bad)} was accepted`);
    }
  });
});

test('duplicate rule ids warn', () => {
  withRules((box) => {
    fs.writeFileSync(box.file, '## R1 — A\nBody a.\n\n## R1 — B\nBody b.\n');
    assert.ok(apiRules(box.state).warnings.includes('duplicate rule id R1'),
      JSON.stringify(apiRules(box.state).warnings));
  });
});

// A stated rule's `source:` carries the user's quoted words (rule.md step 6). The metadata
// line splits on `|` with no escape, which is why the skill writes a `|` in a quote as `/`:
// colons and parentheses inside the quote survive, a pipe cuts it.
test('a quoted rule source round-trips, and a pipe inside it cuts the quote', () => {
  withRules((box) => {
    fs.writeFileSync(box.file, '## R1 — Green before push\n'
      + '(scope: user | source: user 2026-10-16 "never push red: (ever)")\nRun the suite.\n\n'
      + '## R2 — Piped\n(scope: user | source: user 2026-10-16 "a | b")\nBody.\n');
    const [quoted, piped] = apiRules(box.state).rules;
    assert.equal(quoted.source, 'user 2026-10-16 "never push red: (ever)"');
    assert.equal(piped.source, 'user 2026-10-16 "a');
  });
});

test('promote moves a memory into a trial rule', () => {
  withRules((box) => {
    const mem = path.join(box.cfg, 'memory');
    fs.mkdirSync(mem, { recursive: true });
    fs.writeFileSync(path.join(mem, 'MEMORY.md'),
      '# Memory Index\n- [prefer-tabs](prefer-tabs.md) — hook\n');
    fs.writeFileSync(path.join(mem, 'prefer-tabs.md'),
      '---\nname: prefer-tabs\ndescription: use tabs\ntype: feedback\n---\n\n'
      + 'Always use tabs here.\n');

    const res = apiRulesPromote(box.state, {
      name: 'prefer-tabs', fingerprint: apiRules(box.state).fingerprint, delete_memory: true,
    });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.deleted_memory, 'prefer-tabs');
    assert.ok(!fs.existsSync(path.join(mem, 'prefer-tabs.md')));
    // The memory README's rule: a promoted fact is archived, not lost.
    assert.ok(fs.existsSync(path.join(mem, 'archive', 'prefer-tabs.md')), 'the promoted fact was not archived');

    const rule = apiRules(box.state).rules[0];
    assert.equal(rule.status, 'trial', 'a promoted memory must start on trial, not approved');
    assert.match(rule.source, /memory prefer-tabs/);
    assert.equal(rule.body, 'Always use tabs here.');
  });
});

// The name comes out of a request body and is joined onto the memory dir, so a separator or a
// `..` would be an arbitrary-file read. `MEMORY` is in the list because the index is not a fact,
// in every case: on Windows and macOS `memory` opens MEMORY.md, and `delete_memory` deletes it.
test('promote rejects traversal and index names', () => {
  withRules((box) => {
    fs.mkdirSync(path.join(box.cfg, 'memory'), { recursive: true });
    for (const bad of ['', 'a/b', '..\\x', 'MEMORY', 'memory', 'Readme']) {
      assert.throws(() => apiRulesPromote(box.state, { name: bad, fingerprint: '' }), NotFound,
        `${JSON.stringify(bad)} resolved instead of 404ing`);
    }
  });
});

test('a wiki manifest whose entries is not a list is skipped, not a crash', () => {
  // `wikiItems` feeds `/api/status`; `(entries || []).filter` threw on `{"x": 1}`, so one
  // hand-edited geneseed-wiki.jsonc failed the whole dashboard. The malformed vault lists nothing; the
  // well-formed one beside it still lists its note.
  const sb = makeSandbox();
  const prev = process.env.GENESEED_WIKI;
  try {
    const bad = path.join(sb.path, 'bad');
    const good = path.join(sb.path, 'good');
    fs.mkdirSync(bad, { recursive: true });
    fs.mkdirSync(good, { recursive: true });
    fs.writeFileSync(path.join(good, 'note.md'), '# n\n');
    const manifest = path.join(sb.path, 'geneseed-wiki.jsonc');
    fs.writeFileSync(manifest, JSON.stringify({ wikis: [
      { name: 'bad', path: bad, entries: { x: 1 } },
      { name: 'good', path: good, entries: [{ path: '', load: 'lazy' }] },
    ] }));
    process.env.GENESEED_WIKI = manifest;
    const items = wikiItems({ target: sb.path });
    assert.ok(Array.isArray(items));
    assert.ok(!items.some((i) => JSON.stringify(i).includes(`${path.sep}bad`)), JSON.stringify(items));
  } finally {
    if (prev === undefined) delete process.env.GENESEED_WIKI; else process.env.GENESEED_WIKI = prev;
    sb.cleanup();
  }
});

// A project template that parses but fails the graph rules is listed AND reported: the Loops
// page renders `problems`, so a broken team graph says why `loop init` would refuse it. The
// template is the shipped bugfix with one bad weight override, prefixed like `loop check` does.
test('the loops endpoint reports graph problems in a template, as loop check does', () => {
  const sb = makeSandbox();
  const prevXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = path.join(sb.path, 'xdg');
  try {
    const loops = path.join(sb.path, '.geneseed', 'loops');
    fs.mkdirSync(loops, { recursive: true });
    const graph = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../../src/loops/bugfix.json'), 'utf8'));
    fs.writeFileSync(path.join(loops, 'team.json'), JSON.stringify({ ...graph, name: 'team', weights: { vibes: 1 } }));
    const { templates, problems } = apiLoops(webState('neutral', sb.path));
    assert.deepEqual(templates.map((t) => t.name), ['api-endpoint', 'architecture-decision', 'bugfix', 'ci-repair', 'deps-upgrade', 'enforce-architecture-rule', 'feature', 'fix-flaky-tests', 'legacy-refactor', 'legacy-tests', 'refactor', 'remove-dead-code', 'spec-first-feature', 'tdd', 'team', 'update-contract']);
    assert.deepEqual(problems, ['loops/team: weights: vibes is not an action']);
  } finally {
    if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prevXdg;
    sb.cleanup();
  }
});

test('GET /api/loops/active returns the registry rows — one running, one finished', () => {
  const sb = makeSandbox();
  try {
    withLoopsXdg(sb, () => {
      const running = makeLoopWorktree(sb, 'running');
      recordLoop({ root: running, branch: 'loop/a', title: 'Running loop',
        now: new Date('2026-10-01T00:00:00Z') });
      const gone = path.join(sb.path, 'finished');
      fs.mkdirSync(gone, { recursive: true });
      recordLoop({ root: gone, branch: 'loop/b', title: 'Finished loop',
        now: new Date('2026-10-01T00:00:00Z') });
      // No LOOP.md in `gone` — `activeLoops` reports it `finished` (see registry docblock).
      const { loops } = apiLoopsActive();
      assert.equal(loops.length, 2);
      const row = loops.find((l) => l.root === running);
      assert.equal(row.status, 'running');
      assert.equal(row.preset, 'balanced');
      assert.deepEqual(row.threshold, PRESETS.balanced);
      const finished = loops.find((l) => l.root === gone);
      assert.deepEqual(finished,
        { root: gone, branch: 'loop/b', title: 'Finished loop', started: '2026-10-01T00:00:00.000Z',
          status: 'finished' });
      assert.equal(STATE_ROUTES['/api/loops/active'], apiLoopsActive);
    });
  } finally { sb.cleanup(); }
});

test('POST /api/loops/preset success: LOOP.md is rewritten and the updated row is returned', () => {
  const sb = makeSandbox();
  try {
    withLoopsXdg(sb, () => {
      const root = makeLoopWorktree(sb, 'proj', 'balanced');
      recordLoop({ root, branch: 'loop/a', title: 'My loop' });
      const res = apiLoopsPresetMutate(null, { root, preset: 'aggressive' });
      assert.equal(res.ok, true);
      assert.equal(res.loop.preset, 'aggressive');
      assert.deepEqual(res.loop.threshold, PRESETS.aggressive);
      const text = fs.readFileSync(path.join(root, 'LOOP.md'), 'utf8');
      assert.match(text, /"preset":\s*"aggressive"/);
    });
  } finally { sb.cleanup(); }
});

test('POST /api/loops/preset refuses an unknown root with a 4xx-shaped NotFound', () => {
  const sb = makeSandbox();
  try {
    withLoopsXdg(sb, () => {
      const root = makeLoopWorktree(sb, 'proj'); // never recordLoop'd
      assert.throws(() => apiLoopsPresetMutate(null, { root, preset: 'balanced' }),
        (e) => e instanceof NotFound && e.message === 'unknown loop');
    });
  } finally { sb.cleanup(); }
});

test('POST /api/loops/preset refuses a preset outside PRESETS with a 4xx-shaped NotFound', () => {
  const sb = makeSandbox();
  try {
    withLoopsXdg(sb, () => {
      const root = makeLoopWorktree(sb, 'proj');
      recordLoop({ root, branch: 'loop/a', title: 'My loop' });
      assert.throws(() => apiLoopsPresetMutate(null, { root, preset: 'yolo' }),
        (e) => e instanceof NotFound && e.message === 'unknown preset "yolo"');
    });
  } finally { sb.cleanup(); }
});

test('POST /api/loops/preset lets a corrupt LOOP.md surface as a 500, not a 404', () => {
  const sb = makeSandbox();
  try {
    withLoopsXdg(sb, () => {
      const root = makeLoopWorktree(sb, 'proj');
      recordLoop({ root, branch: 'loop/a', title: 'My loop' });
      // Corrupt the file AFTER recordLoop: setLoopPreset still finds the registry row and the
      // file, but `parseLoopFile` throws its own message — that is not one of the two refusals
      // (`unknown loop` / `unknown preset …`) `apiLoopsPresetMutate` is allowed to turn into a
      // NotFound, so it must be rethrown and fall through to the handler's 500 instead.
      fs.writeFileSync(path.join(root, 'LOOP.md'), 'not a loop file at all');
      assert.throws(() => apiLoopsPresetMutate(null, { root, preset: 'balanced' }),
        (e) => !(e instanceof NotFound) && /loop-state block/.test(e.message));
    });
  } finally { sb.cleanup(); }
});

test('POST /api/loops/preset is wired through POST_ROUTES with the handler\'s NotFound/404 convention, not the 409 column', () => {
  assert.equal(POST_ROUTES.get('/api/loops/preset')[0], apiLoopsPresetMutate);
  assert.equal(POST_ROUTES_CONVENTION['/api/loops/preset'], false,
    'this route never returns {ok: false} — both refusals throw NotFound instead');
});

// The Factories page's catalogue: the shipped `bug-report-to-fix` exactly as its file reads (the
// file is the reference, read here, not a copy), every brick (the graph badges `gate: human`),
// the graph of the one loop it names, and a project factory that fails the graph rules listed
// AND reported, prefixed as `factory check` prints it.
test('GET /api/factories/catalog: factories, bricks, the loops they name, and graph problems', () => {
  const sb = makeSandbox();
  try {
    withLoopsXdg(sb, () => {
      const shipped = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../../src/factories/bug-report-to-fix.json'), 'utf8'));
      const dir = path.join(sb.path, '.geneseed', 'factories');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'team.json'), JSON.stringify({
        ...shipped, name: 'team', edges: [...shipped.edges, { from: 'retro', on: 'fail', to: 'nowhere' }],
      }));
      const { factories, bricks, loops, problems } = apiFactoriesCatalog(webState('neutral', sb.path));
      const { description, ...graph } = shipped;
      assert.deepEqual(factories.find((f) => f.name === 'bug-report-to-fix'),
        { name: 'bug-report-to-fix', description, origin: 'shipped', factory: { ...graph, description } });
      assert.equal(factories.find((f) => f.name === 'team').origin, 'project');
      assert.deepEqual(bricks.find((b) => b.name === 'merge-gate').outcomes, ['pass', 'fail', 'none']);
      assert.ok(loops.some((l) => l.name === 'bugfix' && l.graph.name === 'bugfix'), 'loop:bugfix has no graph to draw');
      assert.ok(!loops.some((l) => l.name === 'tdd'), 'a loop no factory names is not sent');
      assert.deepEqual(problems.filter((p) => /^factories\/(team|bug-report-to-fix):/.test(p)),
        ['factories/team: edge retro --fail--> nowhere: nowhere is not a stage, $close or $stop']);
      assert.equal(STATE_ROUTES['/api/factories/catalog'], apiFactoriesCatalog);
    });
  } finally { sb.cleanup(); }
});

// Factories › Active: each registered run read off its FACTORY.md, its graph included, and the
// loop running in the same worktree joined in by root; a run with no live LOOP.md has none.
test('GET /api/factories/active joins each run to the loop running in its worktree', () => {
  const sb = makeSandbox();
  try {
    withLoopsXdg(sb, () => {
      const factory = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../fixtures/factories/fixture-fix.json'), 'utf8'));
      const withLoop = makeLoopWorktree(sb, 'with-loop');
      const bare = path.join(sb.path, 'bare');
      fs.mkdirSync(bare, { recursive: true });
      for (const root of [withLoop, bare]) {
        fs.writeFileSync(path.join(root, 'FACTORY.md'), renderFactoryFile(initFactory({ title: 'T', requirement: 'R', factory })));
        recordFactory({ root, branch: 'loop/factory-x', factory: 'fixture-fix', title: 'Run', now: new Date('2026-11-01T00:00:00Z') });
      }
      recordLoop({ root: withLoop, branch: 'loop/factory-x', title: 'Child loop', factory: 'x' });
      const { factories } = apiFactoriesActive();
      assert.equal(factories.length, 2);
      const run = factories.find((r) => r.root === withLoop);
      assert.equal(run.stage, 'plan');
      assert.deepEqual(run.graph, factory);
      assert.deepEqual(run.loop, { title: 'Child loop', status: 'running', node: 'a', iteration: 1, graph: ACTIVE_TAB_GRAPH });
      assert.equal(factories.find((r) => r.root === bare).loop, null);
      assert.equal(STATE_ROUTES['/api/factories/active'], apiFactoriesActive);
    });
  } finally { sb.cleanup(); }
});

// D7: the board's read. A held run carries its gate, its counters and `runMetrics` of its state:
// started 10:00, `plan` recorded at 10:01 (1 minute of work), the loop at 10:11 (10 minutes), the
// review that failed at 10:13 (2 minutes) and still held, so it has spent no cycle. A FACTORY.md
// that does not parse is a row with status `unreadable`, and a run whose FACTORY.md is gone is
// `finished`: identity only, and the read does not throw. The read changes no FACTORY.md.
test('GET /api/factories/active carries the board fields, and survives an unparsable or a missing FACTORY.md', () => {
  const sb = makeSandbox();
  try {
    withLoopsXdg(sb, () => {
      const factory = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../fixtures/factories/fixture-fix.json'), 'utf8'));
      const at = (hhmm) => `2026-11-11T${hhmm}:00.000Z`;
      const roots = Object.fromEntries(['held', 'broken', 'gone'].map((name) => {
        const root = path.join(sb.path, name);
        fs.mkdirSync(root, { recursive: true });
        recordFactory({ root, branch: `loop/factory-${name}`, factory: 'fixture-fix', title: name, now: new Date('2026-11-11T10:00:00Z') });
        return [name, root];
      }));
      const held = {
        ...initFactory({ title: 'T', requirement: 'R', factory, now: at('10:00') }),
        stage: 'review', status: 'awaiting', awaiting: { kind: 'gate', stage: 'review', outcome: 'fail', note: 'review.md' },
        transitions: 2, runTransitions: 2,
        history: [
          { stage: 'plan', outcome: 'pass', task: 0, tokens: 300, at: at('10:01') },
          { stage: 'loop:bugfix', outcome: 'pass', task: 0, at: at('10:11') },
          { stage: 'review', outcome: 'fail', task: 0, carry: 'review.md', at: at('10:13') },
        ],
      };
      const heldFile = renderFactoryFile(held);
      fs.writeFileSync(path.join(roots.held, 'FACTORY.md'), heldFile);
      fs.writeFileSync(path.join(roots.broken, 'FACTORY.md'), '# Factory\n\nno state block here\n');
      const { factories } = apiFactoriesActive();
      const row = (name) => factories.find((r) => r.root === roots[name]);
      const { status, stage, awaiting, counters, tasks, metrics } = row('held');
      assert.deepEqual({ status, stage, awaiting, counters, tasks }, {
        status: 'awaiting', stage: 'review', awaiting: { kind: 'gate', stage: 'review', outcome: 'fail', note: 'review.md' }, counters: {}, tasks: null,
      });
      assert.deepEqual(metrics, {
        started: at('10:00'),
        stages: [
          { stage: 'plan', runs: 1, reworks: 0, workMs: 60000, tokens: 300 },
          { stage: 'loop:bugfix', runs: 1, reworks: 0, workMs: 600000, tokens: null },
          { stage: 'review', runs: 1, reworks: 0, workMs: 120000, tokens: null },
        ],
        workMs: 780000, waitMs: 0, tokens: 300, transitions: 2,
        entries: [{ ms: 60000, wait: false, rework: false }, { ms: 600000, wait: false, rework: false }, { ms: 120000, wait: false, rework: false }],
      });
      const id = (name) => ({ root: roots[name], branch: `loop/factory-${name}`, factory: 'fixture-fix', title: name, started: '2026-11-11T10:00:00.000Z', loop: null });
      assert.deepEqual(row('broken'), { ...id('broken'), status: 'unreadable' });
      assert.deepEqual(row('gone'), { ...id('gone'), status: 'finished' });
      assert.equal(fs.readFileSync(path.join(roots.held, 'FACTORY.md'), 'utf8'), heldFile);
    });
  } finally { sb.cleanup(); }
});