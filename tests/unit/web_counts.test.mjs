// THE INVARIANT, SERVER HALF: every count `/api/overview` carries is the size of the list its page
// shows, over every install, deduped, and no index file is in either. Two real sandbox installs that
// overlap, so a count of one install, or a sum of both, is red. The console's half, that a badge
// reads these and the rows are these lists, is web/src/__tests__/railCounts.test.jsx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { loadCatalog } from '../../js/loop/catalog.mjs';
import { apiOverview, machineCounts, memoCounts } from '../../js/web/api.mjs';
import { NotFound, apiCatalog, apiItem, fleetCounts, isFurniture } from '../../js/web/catalog.mjs';
import { webState } from '../../js/web/state.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';

/** A state with a fixed inventory and store: `facts`, `notes` and `skills` are its own files. */
function install(sb, name, { facts, notes, skills }) {
  const target = path.join(sb.path, name);
  fs.mkdirSync(path.join(target, 'memory'), { recursive: true });
  fs.mkdirSync(path.join(target, 'notebook'), { recursive: true });
  for (const f of ['MEMORY', 'README', ...facts]) fs.writeFileSync(path.join(target, 'memory', `${f}.md`), `# ${f}\n`);
  for (const n of ['NOTEBOOK', 'readme', ...notes]) fs.writeFileSync(path.join(target, 'notebook', `${n}.md`), `# ${n}\n`);
  fs.writeFileSync(path.join(target, 'context.json'), '{}\n');
  const base = webState('neutral', sb.path);
  const inventory = { ...base.inventory, skills: skills.map((s) => ({ name: s, desc: '' })) };
  return { install: `claude:project:${target}`, state: { ...base, target, inventory } };
}

const fixture = (sb) => {
  const a = install(sb, 'a', { facts: ['both', 'only-a'], notes: ['plan'], skills: ['s1', 's2'] });
  const b = install(sb, 'b', { facts: ['both', 'only-b'], notes: ['plan', 'draft'], skills: ['s2', 's3'] });
  return [a, b];
};

const SECTIONS = [
  // [section, the names the fixture lists, written out]
  ['memory', ['both', 'only-a', 'only-b']],
  ['notebook', ['plan', 'draft']],
  ['skills', ['s1', 's2', 's3']],
  ['config', ['context.json']],
];

test('each count is its list, deduped over every install, with no index file', () => {
  const sb = makeSandbox('counts-');
  try {
    const fleet = fixture(sb);
    const counts = fleetCounts(fleet[0].state, fleet);
    for (const [sec, names] of SECTIONS) {
      const items = apiCatalog(fleet[0].state, sec, fleet).items.map((i) => i.name);
      assert.ok(names.length > 0, `${sec}: an empty fixture proves nothing`);
      assert.deepEqual([...items].sort(), [...names].sort(), `${sec}: the list`);
      assert.equal(counts[sec], names.length, `${sec}: the count`);
    }
  } finally { sb.cleanup(); }
});

test('the count does not depend on which install asks', () => {
  const sb = makeSandbox('counts-');
  try {
    const fleet = fixture(sb);
    assert.deepEqual(fleetCounts(fleet[0].state, fleet), fleetCounts(fleet[1].state, fleet));
  } finally { sb.cleanup(); }
});

// The constitution lists a rule whether or not an install built it in, so the count must not fall
// when one is switched off, or the rail reads below the page.
test('a narrowed install still counts every rule its page lists', () => {
  const sb = makeSandbox('counts-');
  try {
    const [{ state }] = fixture(sb);
    const rows = apiCatalog(state, 'laws').items;
    const doctrine = rows.filter((r) => r.tier === 'doctrine').length;
    const off = { ...state, inventory: { ...state.inventory, doctrines: state.inventory.doctrines
      .map((p, i) => (i === 0 ? { ...p, active: false, rules: p.rules.map((r) => ({ ...r, active: false })) } : p)) } };
    assert.ok(doctrine > 0);
    const counts = apiOverview(off).counts;
    assert.equal(counts.doctrines.rules, doctrine);
    assert.equal(counts.laws, rows.filter((r) => r.tier === 'invariant').length);
  } finally { sb.cleanup(); }
});

// One bad install must not take `/api/overview` down for the others: a retired theme fails its
// inventory, a loop file holding `null` fails its catalogue. Both are real, not stubs.
test('an install that cannot be read is skipped, and the rest count', () => {
  const sb = makeSandbox('counts-');
  try {
    const fleet = fixture(sb);
    const retired = { install: 'claude:project:/retired', state: webState('no-such-theme', path.join(sb.path, 'a')) };
    assert.throws(() => retired.state.inventory, 'the fixture must really be broken');
    const loops = path.join(sb.path, 'nulled', '.geneseed', 'loops');
    fs.mkdirSync(loops, { recursive: true });
    fs.writeFileSync(path.join(loops, 'bad.json'), 'null\n');
    const nulled = { install: 'claude:project:/nulled', state: { ...fleet[1].state, root: path.join(sb.path, 'nulled') } };
    assert.throws(() => loadCatalog({ projectRoot: nulled.state.root }), 'the fixture must really be broken');

    const good = machineCounts(fleet[0].state, fleet);
    const counts = machineCounts(fleet[0].state, [retired, ...fleet, nulled]);
    assert.ok(good.skills > 0 && good.loops > 0);
    assert.deepEqual(counts, good);
    assert.equal(apiCatalog(fleet[0].state, 'skills', [retired, ...fleet]).items.length, good.skills);
  } finally { sb.cleanup(); }
});

test('a lone state that cannot be read still fails its own request', () => {
  const sb = makeSandbox('counts-');
  try {
    const state = webState('no-such-theme', sb.path);
    assert.throws(() => apiCatalog(state, 'skills'));
  } finally { sb.cleanup(); }
});

test('the counts are memoised for seconds, and a refresh drops them', () => {
  const sb = makeSandbox('counts-');
  try {
    const fleet = fixture(sb);
    const base = webState('neutral', sb.path);
    let asked = 0;
    const read = () => { asked += 1; return fleet; };
    const first = memoCounts(base, read, 1000);
    assert.equal(memoCounts(base, read, 3000), first);
    assert.equal(asked, 1);
    memoCounts(base, read, 7000);
    assert.equal(asked, 2, 'past its lifetime the memo reads again');
    base.refreshOwn({ doctor: false });
    memoCounts(base, read, 7001);
    assert.equal(asked, 3, 'a refresh drops it');
  } finally { sb.cleanup(); }
});

// A pinned view's read must not run a doctor on the event loop: it took 12 s, measured.
test('a pinned view runs no doctor for its overview', () => {
  const sb = makeSandbox('counts-');
  try {
    const st = webState('neutral', sb.path);
    st.pinned = true;
    st.runDoctor = () => assert.fail('a pinned overview ran the doctor');
    assert.equal(apiOverview(st, {}).doctor, null);
    st._doctor = { ok: true, problems: [] };
    assert.equal(apiOverview(st, {}).doctor.ok, true);
  } finally { sb.cleanup(); }
});

test('an index file stays readable by name and out of every list', () => {
  const sb = makeSandbox('counts-');
  try {
    const fleet = fixture(sb);
    assert.match(apiItem(fleet[0].state, 'memory', 'MEMORY', fleet).body, /MEMORY/);
    assert.equal(isFurniture('MEMORY.md', 'memory'), true);
    assert.equal(isFurniture('Readme.MD', 'notebook'), true);
    assert.equal(isFurniture('memory.md', 'notebook'), false, 'a note may be called memory');
  } finally { sb.cleanup(); }
});

test('a setup file only one install holds opens from the list, and names that install', () => {
  const sb = makeSandbox('counts-');
  try {
    const fleet = fixture(sb);
    fs.rmSync(path.join(fleet[0].state.target, 'context.json'));
    // A request naming no install reads the daemon's state, which is no view of the fleet.
    const item = apiItem(webState('neutral', sb.path), 'config', 'context.json', fleet);
    assert.equal(item.install, fleet[1].install);
    assert.deepEqual(item.installs, [fleet[1].install]);
    // A request naming the install without it is refused, even with a holder beside it.
    assert.throws(() => apiItem(fleet[0].state, 'config', 'context.json', fleet), NotFound);
  } finally { sb.cleanup(); }
});
