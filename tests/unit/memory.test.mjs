/**
 * `geneseed memory` — a destructive verb with no oracle.
 *
 * ⚠ THERE IS NOTHING TO COMPARE IT TO. The reference had no `memory` subcommand: a fact was
 * written by the `learn` hook and removed from the web console, and that was all. So there is
 * no recorded help text and no acceptance cell, and no way to make either — every claim below
 * is absolute, which for a verb that DELETES means each one states what survived as well as
 * what went. `tests/unit/uninstall*.test.mjs` learned that shape first: a removal needs the
 * gate pointed at both directions or it only ever proves that something happened.
 *
 * THE SEMANTICS ARE THE DELETE ENDPOINT'S, and the two places they part company are both
 * gated here by name: the store is RESOLVED rather than configured, and the reserved-name check
 * is CASE-INSENSITIVE where the endpoint's is exact. The second is the one that matters — on
 * every Windows install and the default macOS one, an exact comparison lets `rm memory` resolve
 * to `MEMORY.md` and delete the index the agent reads at session start.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { isFactName, memoryDelete, memoryFacts } from '../../js/maintain/memory.mjs';
import { makeSandbox, cellEnv } from '../helpers/sandbox.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const ENTRY = path.join(ROOT, 'bin', 'geneseed-cli.mjs');

const INDEX = ['# Memory Index', '',
  '- [A fact](a-fact.md) — the first one',
  '- [Another](b-fact.md) — the second one', ''].join('\n');

/** A memory store with two facts, the index that names both, and the README beside them. */
function seed(dir) {
  const d = path.join(dir, 'memory');
  mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, 'a-fact.md'), 'first\n', 'utf8');
  writeFileSync(path.join(d, 'b-fact.md'), 'second\n', 'utf8');
  writeFileSync(path.join(d, 'MEMORY.md'), INDEX, 'utf8');
  writeFileSync(path.join(d, 'README.md'), 'how the store works\n', 'utf8');
  return d;
}

function withStore(fn) {
  const sb = makeSandbox('gs-memory-');
  try { return fn(seed(sb.path), sb.path); } finally { sb.cleanup(); }
}

test('a fact name is a bare slug, and the two store files are not facts', () => {
  for (const ok of ['a-fact', 'b_fact', 'Fact2', 'memories']) {
    assert.ok(isFactName(ok), `${ok} should be a fact name`);
  }
  // ⚠ BOTH CASES OF BOTH RESERVED NAMES. The endpoint compares `MEMORY` and `README` exactly;
  // on a case-insensitive filesystem — Windows always, macOS by default — `memory` then resolves
  // to the index file, passes an exact guard, and the agent's session-start index is gone. This
  // is the one deliberate narrowing in the verb, and it is a data-loss guard, not tidiness.
  for (const no of ['', 'MEMORY', 'memory', 'Memory', 'README', 'readme', 'ReadMe',
    'a/b', 'a\\b', '../escape', null, undefined]) {
    assert.ok(!isFactName(no), `${JSON.stringify(no)} must not be a fact name`);
  }
});

test('the listing offers exactly the names the removal accepts', () => {
  withStore((d) => {
    assert.deepEqual(memoryFacts(d), ['a-fact', 'b-fact']);
    // The two directions that make that an equality rather than a coincidence: every listed
    // name is removable, and every file that was NOT listed is still there afterwards.
    for (const name of memoryFacts(d)) assert.ok(isFactName(name), `${name} was listed`);
    assert.ok(!memoryFacts(d).includes('MEMORY'), 'the index was offered as a fact');
    assert.ok(!memoryFacts(d).includes('README'), 'the store README was offered as a fact');
  });
  // A store that is not there is an empty listing, not a throw — `list` must be able to answer
  // for a path that does not exist.
  assert.deepEqual(memoryFacts(path.join(ROOT, 'no', 'such', 'dir')), []);
});

test('removing a fact takes its file and its line in the index, and nothing else', () => {
  withStore((d) => {
    assert.equal(memoryDelete(d, 'a-fact'), true);
    assert.ok(!existsSync(path.join(d, 'a-fact.md')), 'the fact file survived');
    const idx = readFileSync(path.join(d, 'MEMORY.md'), 'utf8');
    assert.ok(!idx.includes('(a-fact.md)'), 'the index still names the deleted fact');
    // THE OTHER DIRECTION, which is the half a "did it delete" assertion cannot give: the
    // sibling fact, its index line, the heading and the README are all untouched.
    assert.ok(idx.includes('(b-fact.md)'), 'the sibling fact lost its index line');
    assert.ok(idx.startsWith('# Memory Index'), 'the index heading was eaten');
    assert.ok(existsSync(path.join(d, 'b-fact.md')), 'the sibling fact was deleted');
    assert.ok(existsSync(path.join(d, 'README.md')), 'the store README was deleted');
  });
});

test('a name the store does not hold, or must not give up, removes nothing', () => {
  withStore((d) => {
    for (const name of ['nope', 'MEMORY', 'memory', 'README', '../a-fact', 'sub/a-fact']) {
      assert.equal(memoryDelete(d, name), false, `${name} reported a deletion`);
    }
    // The refusals are absolute about what SURVIVED — a guard that answered false after
    // unlinking would satisfy a return-value check on its own.
    for (const f of ['a-fact.md', 'b-fact.md', 'MEMORY.md', 'README.md']) {
      assert.ok(existsSync(path.join(d, f)), `${f} was removed by a refused name`);
    }
    assert.equal(readFileSync(path.join(d, 'MEMORY.md'), 'utf8'), INDEX,
      'a refused removal rewrote the index');
  });
});

/** The verb, run as a user would run it, with the store named explicitly. */
function run(store, ...argv) {
  const home = path.dirname(store);
  return spawnSync(process.execPath, [ENTRY, 'memory', ...argv, '--memory', store],
    { cwd: home, encoding: 'utf8', windowsHide: true, env: cellEnv(home) });
}

test('the verb lists, deletes, and says which store it acted on', () => {
  withStore((d) => {
    const listed = run(d, 'list');
    assert.equal(listed.status, 0, listed.stderr);
    assert.match(listed.stdout, /a-fact/);
    assert.match(listed.stdout, /b-fact/);
    assert.ok(!/MEMORY/.test(listed.stdout.replace(d, '')),
      'the listing offered the index file');
    // NAMING THE STORE IS PART OF THE OUTPUT, not decoration: the resolver has five candidate
    // locations, so a user who cannot see which one answered cannot tell an empty store from
    // the wrong store.
    assert.ok(listed.stdout.includes(d), 'the listing does not say which store it read');

    const gone = run(d, 'rm', 'a-fact');
    assert.equal(gone.status, 0, gone.stderr);
    assert.match(gone.stdout, /deleted a-fact/);
    assert.ok(!existsSync(path.join(d, 'a-fact.md')));

    const again = run(d, 'rm', 'a-fact');
    assert.equal(again.status, 1, 'removing a fact twice reported success the second time');
    assert.match(again.stderr, /no such fact 'a-fact'/);
  });
});

test('rm with no name refuses, and refusing is not deleting', () => {
  withStore((d) => {
    const r = run(d, 'rm');
    assert.equal(r.status, 2, `expected the usage exit code, got ${r.status}`);
    assert.match(r.stderr, /rm needs the name of a fact/);
    assert.deepEqual(memoryFacts(d), ['a-fact', 'b-fact'], 'a nameless rm removed something');
  });
});

test('with no store anywhere the verb refuses and says how to point it at one', () => {
  const sb = makeSandbox('gs-memory-none-');
  try {
    const r = spawnSync(process.execPath, [ENTRY, 'memory', 'list'],
      { cwd: sb.path, encoding: 'utf8', windowsHide: true, env: cellEnv(sb.path) });
    assert.equal(r.status, 1, `expected a refusal, got ${r.status}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /no memory store found/);
    assert.match(r.stderr, /--memory/, 'the refusal does not name the override');
  } finally {
    sb.cleanup();
  }
});

test('the entry dispatches `memory` at this module, with the actions the table declares', () => {
  const src = readFileSync(ENTRY, 'utf8');
  // The row is `memory: cmdMemory,` since Task 5 flattened the VERBS table (it was
  // `memory: { fn: cmdMemory, },` before).
  assert.match(src, /\n {2}memory: cmdMemory,/,
    "bin/geneseed-cli.mjs's VERBS table no longer routes `memory` to cmdMemory");
  const table = JSON.parse(readFileSync(path.join(ROOT, 'js', 'cli-table.json'), 'utf8'));
  const cmd = table.commands.find((c) => c.name === 'memory');
  assert.ok(cmd, 'js/cli-table.json no longer declares `memory`');
  // THE ACTION LIST IS A CHOICES SET, WHICH IS WHAT MAKES A TYPO A REFUSAL RATHER THAN A NO-OP.
  // Every Geneseed CLI path exits 0 and signals through stdout, so an unrecognised action that
  // fell through to the end of the dispatch would be indistinguishable from a successful run.
  assert.deepEqual(cmd.positionals[0].choices, ['list', 'rm']);
  assert.equal(cmd.positionals[0].required, true, 'the action became optional');
  assert.equal(cmd.positionals[1].nargs, '?', 'the fact name became required for `list` too');
});
