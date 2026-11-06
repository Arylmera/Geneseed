/**
 * `geneseed memory` — a destructive verb with no oracle.
 *
 * ⚠ THERE IS NOTHING TO COMPARE IT TO. The reference had no `memory` subcommand: a fact was
 * written by the `learn` hook and removed from the web console, and that was all. So there is
 * no recorded help text and no acceptance cell, and no way to make either — every claim below
 * is absolute, which for a verb that REMOVES (archives by default, deletes with `--purge`)
 * means each one states what survived as well as what went. `tests/unit/uninstall*.test.mjs` learned that shape first: a removal needs the
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

import { isFactName, memoryDelete, memoryFacts, memoryPurgeArchived } from '../../js/maintain/memory.mjs';
import { migrateMemoryIndex } from '../../js/hosts/memory-files.mjs';
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

// REMOVING ARCHIVES: the fact moves to archive/ (returned as its new path) and leaves the
// index; only `purge` unlinks it. A second archive of the same name never overwrites the first.
test('removing a fact archives its file and drops its line in the index, and nothing else', () => {
  withStore((d) => {
    assert.equal(memoryDelete(d, 'a-fact'), path.join(d, 'archive', 'a-fact.md'));
    assert.ok(!existsSync(path.join(d, 'a-fact.md')), 'the fact file survived');
    assert.equal(readFileSync(path.join(d, 'archive', 'a-fact.md'), 'utf8'), 'first\n',
      'the archived copy is not the fact');
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

test('purge unlinks the fact, and a same-name archive is never overwritten', () => {
  withStore((d) => {
    mkdirSync(path.join(d, 'archive'));
    writeFileSync(path.join(d, 'archive', 'b-fact.md'), 'older\n', 'utf8');
    assert.equal(memoryDelete(d, 'b-fact'), path.join(d, 'archive', 'b-fact-2.md'));
    assert.equal(readFileSync(path.join(d, 'archive', 'b-fact.md'), 'utf8'), 'older\n');
    assert.equal(memoryDelete(d, 'a-fact', true), '', 'a purge reported an archive path');
    assert.ok(!existsSync(path.join(d, 'a-fact.md')), 'the purged fact survived');
    assert.ok(!existsSync(path.join(d, 'archive', 'a-fact.md')), 'the purge archived instead');
    assert.ok(!readFileSync(path.join(d, 'MEMORY.md'), 'utf8').includes('(a-fact.md)'));
    // Purging from archive/ takes exactly the named file.
    assert.equal(memoryPurgeArchived(d, 'b-fact'), true);
    assert.ok(!existsSync(path.join(d, 'archive', 'b-fact.md')));
    assert.ok(existsSync(path.join(d, 'archive', 'b-fact-2.md')), 'the purge took a sibling');
    for (const bad of ['b-fact', 'MEMORY', '../a-fact', 'nope']) {
      assert.equal(memoryPurgeArchived(d, bad), false, `${bad} reported a purge`);
    }
  });
});

// The same removal through a TWO-LEVEL index (the seeded flat one, migrated as a build would).
// The fact's line leaves its topic file and the map's count drops by one; the sibling's line,
// title and hook included, stays where it was.
test('removing a fact from a two-level index takes its topic line and recounts the map', () => {
  withStore((d) => {
    assert.equal(migrateMemoryIndex(d), true);
    const lf = (p) => readFileSync(p, 'utf8').replaceAll('\r\n', '\n');
    const hint = 'Each topic file lists its facts; open the one the task needs.';
    assert.equal(lf(path.join(d, 'MEMORY.md')),
      `# Memory Index\n\n${hint}\n\n- [misc](topics/misc.md) — 2 facts\n`);
    assert.equal(memoryDelete(d, 'a-fact'), path.join(d, 'archive', 'a-fact.md'));
    assert.ok(!existsSync(path.join(d, 'a-fact.md')), 'the fact file survived');
    assert.equal(lf(path.join(d, 'topics', 'misc.md')),
      '# misc\n\n- [Another](../b-fact.md) — the second one\n');
    assert.equal(lf(path.join(d, 'MEMORY.md')),
      `# Memory Index\n\n${hint}\n\n- [misc](topics/misc.md) — 1 fact\n`);
  });
});

test('a name the store does not hold, or must not give up, removes nothing', () => {
  withStore((d) => {
    for (const name of ['nope', 'MEMORY', 'memory', 'README', '../a-fact', 'sub/a-fact']) {
      assert.equal(memoryDelete(d, name), null, `${name} reported a removal`);
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
    assert.match(gone.stdout, /archived a-fact -> /);
    assert.ok(!existsSync(path.join(d, 'a-fact.md')));

    const again = run(d, 'rm', 'a-fact');
    assert.equal(again.status, 1, 'removing a fact twice reported success the second time');
    assert.match(again.stderr, /no such fact 'a-fact'/);

    // --archived lists archive/, and there a fact can only be purged: without --purge the verb
    // refuses with the usage code and the file stays.
    const arch = run(d, 'list', '--archived');
    assert.equal(arch.status, 0, arch.stderr);
    assert.match(arch.stdout, /^ {2}a-fact$/m);
    assert.ok(!/b-fact/.test(arch.stdout), 'a live fact was listed as archived');
    const refused = run(d, 'rm', 'a-fact', '--archived');
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /add --purge/);
    assert.ok(existsSync(path.join(d, 'archive', 'a-fact.md')), 'a refused purge deleted the file');
    const purged = run(d, 'rm', 'a-fact', '--archived', '--purge');
    assert.equal(purged.status, 0, purged.stderr);
    assert.match(purged.stdout, /deleted a-fact\./);
    assert.ok(!existsSync(path.join(d, 'archive', 'a-fact.md')));

    const hard = run(d, 'rm', 'b-fact', '--purge');
    assert.equal(hard.status, 0, hard.stderr);
    assert.match(hard.stdout, /deleted b-fact\./);
    assert.ok(!existsSync(path.join(d, 'b-fact.md')));
    assert.ok(!existsSync(path.join(d, 'archive', 'b-fact.md')), '--purge archived instead');
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

/** `memory <argv>` from `cwd` with a sandboxed home: only what is under `home` can be found. */
const inRepo = (home, cwd, ...argv) => spawnSync(process.execPath, [ENTRY, 'memory', ...argv],
  { cwd, encoding: 'utf8', windowsHide: true, env: cellEnv(home) });

/** What every real emit leaves: the seeded index in the store, the version marker beside it. */
function installed(store) {
  mkdirSync(store, { recursive: true });
  writeFileSync(path.join(store, 'MEMORY.md'), '# Memory Index\n', 'utf8');
  writeFileSync(path.join(path.dirname(store), '.geneseed-version'), 'abc (built 2026-01-01)\n', 'utf8');
}

test('a repo\'s own memory/ is no store: rm --purge leaves it, and --memory still reaches it', () => {
  // I4: the resolver put a `memory/` beside the cwd ahead of the tier, so this deleted a design
  // note in a repo that has nothing to do with Geneseed.
  const sb = makeSandbox('gs-memory-repo-');
  try {
    const repo = path.join(sb.path, 'repo');
    mkdirSync(path.join(repo, 'memory'), { recursive: true });
    mkdirSync(path.join(repo, 'Harness', 'memory'), { recursive: true });
    const note = path.join(repo, 'memory', 'design-notes.md');
    writeFileSync(note, 'mine\n', 'utf8');
    writeFileSync(path.join(repo, 'Harness', 'memory', 'design-notes.md'), 'mine too\n', 'utf8');
    const r = inRepo(sb.path, repo, 'rm', 'design-notes', '--purge');
    assert.equal(r.status, 1, `expected a refusal, got ${r.status}: ${r.stdout}${r.stderr}`);
    assert.ok(existsSync(note), 'rm --purge deleted a file of a repo that is no install');
    assert.ok(existsSync(path.join(repo, 'Harness', 'memory', 'design-notes.md')), './Harness counted by itself');
    const named = inRepo(sb.path, repo, 'list', '--memory', path.join(repo, 'memory'));
    assert.match(named.stdout, /design-notes/, '--memory no longer reaches it');
    // With a tier, the same command acts on the tier and never looks at the repo.
    const tier = path.join(sb.path, '.config', 'geneseed', 'memory');
    mkdirSync(tier, { recursive: true });
    writeFileSync(path.join(tier, 'tier-fact.md'), 'x\n', 'utf8');
    assert.match(inRepo(sb.path, repo, 'list').stdout, /tier-fact/);
    assert.equal(inRepo(sb.path, repo, 'rm', 'design-notes', '--purge').status, 1);
    assert.ok(existsSync(note), 'the tier run reached the repo');
  } finally {
    sb.cleanup();
  }
});

test('a project install inside its own repo finds its own store, ahead of the tier', () => {
  // Each row is where that emit puts the marker and the store. `memory/` beside the cwd stays a
  // repo folder for a Claude-family install, whose store sits under its layer; for OpenCode and
  // the plain bundle it IS the store, because the marker and the evidence beside it say so.
  const rows = [
    ['claude', '', '.claude/memory'], ['bob', '', '.bob/memory'], ['openclaude', '', '.openclaude/memory'],
    ['opencode', '', 'memory'], ['files', '', 'memory'],
    ['files', 'Harness', 'Harness/memory'], ['opencode', 'Harness', 'Harness/memory'],
  ];
  for (const [emit, base, store] of rows) {
    const sb = makeSandbox('gs-memory-own-');
    try {
      const repo = path.join(sb.path, 'repo');
      const tier = path.join(sb.path, '.config', 'geneseed', 'memory');
      mkdirSync(path.join(repo, store), { recursive: true });
      mkdirSync(path.join(repo, 'memory'), { recursive: true });
      mkdirSync(tier, { recursive: true });
      writeFileSync(path.join(repo, base, '.geneseed-emit'), `${emit}\n`, 'utf8');
      installed(path.join(repo, store));
      writeFileSync(path.join(repo, store, 'own-fact.md'), 'x\n', 'utf8');
      writeFileSync(path.join(tier, 'tier-fact.md'), 'x\n', 'utf8');
      const out = inRepo(sb.path, repo, 'list').stdout;
      assert.match(out, /own-fact/, `${emit} at ${base || '.'} lost its store: ${out}`);
      assert.doesNotMatch(out, /tier-fact/, `${emit} at ${base || '.'} read the tier`);
    } finally {
      sb.cleanup();
    }
  }
});

test('a marker alone proves no install: rm --purge leaves the repo\'s file, and the tier answers', () => {
  // Blind review of I4: any non-empty marker made the folder a store. Each row is a repo that a
  // real emit never produced, and each deleted `design-notes.md` then.
  const rows = [
    ['junk text', 'garbage-text', () => {}],
    ['a stale files marker over a bare folder', 'files', () => {}],
    ['a stale opencode marker over a bare folder', 'opencode', () => {}],
    ['an index and no version', 'files', (repo) => writeFileSync(path.join(repo, 'memory', 'MEMORY.md'), '# Memory Index\n', 'utf8')],
    ['a version and no index', 'files', (repo) => writeFileSync(path.join(repo, '.geneseed-version'), 'abc\n', 'utf8')],
    ['a real install under a junk marker', 'garbage-text', (repo) => installed(path.join(repo, 'memory'))],
  ];
  for (const [name, emit, extra] of rows) {
    const sb = makeSandbox('gs-memory-stale-');
    try {
      const repo = path.join(sb.path, 'repo');
      const tier = path.join(sb.path, '.config', 'geneseed', 'memory');
      const note = path.join(repo, 'memory', 'design-notes.md');
      mkdirSync(path.dirname(note), { recursive: true });
      mkdirSync(tier, { recursive: true });
      writeFileSync(note, 'mine\n', 'utf8');
      writeFileSync(path.join(repo, '.geneseed-emit'), `${emit}\n`, 'utf8');
      extra(repo);
      const r = inRepo(sb.path, repo, 'rm', 'design-notes', '--purge');
      assert.equal(r.status, 1, `${name}: ${r.stdout}${r.stderr}`);
      assert.ok(existsSync(note), `${name}: the file is gone`);
      assert.ok(r.stderr.includes(tier), `${name}: ${r.stderr}`);
    } finally {
      sb.cleanup();
    }
  }
});

test('two hosts in one repo: the marker\'s host answers, and a marker that names a dead layer falls to the live one', () => {
  const sb = makeSandbox('gs-memory-dual-');
  try {
    const repo = path.join(sb.path, 'repo');
    const claude = path.join(repo, '.claude', 'memory');
    const bob = path.join(repo, '.bob', 'memory');
    installed(claude);
    writeFileSync(path.join(repo, '.geneseed-emit'), 'bob\n', 'utf8');
    assert.ok(inRepo(sb.path, repo, 'list').stdout.includes(claude), 'the live layer was not found');
    installed(bob);
    assert.ok(inRepo(sb.path, repo, 'list').stdout.includes(bob), 'the marker lost to another layer');
  } finally {
    sb.cleanup();
  }
});

test('rm names the store it acted on, because --purge cannot be undone', () => {
  withStore((d) => {
    for (const argv of [['a-fact'], ['b-fact', '--purge']]) {
      const { stdout } = run(d, 'rm', ...argv);
      assert.ok(stdout.split(/\r?\n/).includes(`[memory] ${d}`), stdout);
    }
  });
});

test('a real project emit is found where it seeded its store', () => {
  // The rows above state where each emit puts its marker, store and evidence. This asks the emits.
  const rows = [['claude', 'repo', '.claude/memory'], ['bob', 'repo', '.bob/memory'], ['openclaude', 'repo', '.openclaude/memory'],
    ['opencode', 'repo', 'memory'], ['files', 'repo/Harness', 'Harness/memory']];
  for (const [emit, out, store] of rows) {
    const sb = makeSandbox('gs-memory-emit-');
    try {
      const repo = path.join(sb.path, 'repo');
      mkdirSync(repo);
      const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'build-driver.mjs'), '--emit', emit,
        '--theme', 'neutral', '--footprint', 'lean', '--out', path.join(sb.path, out)],
      { cwd: repo, encoding: 'utf8', windowsHide: true, env: cellEnv(sb.path), maxBuffer: 1 << 26 });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(existsSync(path.join(repo, store, 'MEMORY.md')), `${emit} seeded no ${store}`);
      assert.ok(inRepo(sb.path, repo, 'list').stdout.includes(path.join(repo, store)), emit);
    } finally {
      sb.cleanup();
    }
  }
});

test('a global marker in the cwd is no project: the tier answers', () => {
  const sb = makeSandbox('gs-memory-global-');
  try {
    const cfg = path.join(sb.path, 'cfg');
    const tier = path.join(sb.path, '.config', 'geneseed', 'memory');
    mkdirSync(path.join(cfg, 'memory'), { recursive: true });
    mkdirSync(tier, { recursive: true });
    writeFileSync(path.join(cfg, '.geneseed-emit'), 'claude-global\n', 'utf8');
    writeFileSync(path.join(tier, 'tier-fact.md'), 'x\n', 'utf8');
    assert.match(inRepo(sb.path, cfg, 'list').stdout, /tier-fact/);
  } finally {
    sb.cleanup();
  }
});

test('status names the store memory acts on, not a repo folder', () => {
  const sb = makeSandbox('gs-memory-status-');
  try {
    const repo = path.join(sb.path, 'repo');
    const tier = path.join(sb.path, '.config', 'geneseed', 'memory');
    mkdirSync(path.join(repo, 'memory'), { recursive: true });
    mkdirSync(tier, { recursive: true });
    const r = spawnSync(process.execPath, [ENTRY, 'status', '--json'],
      { cwd: repo, encoding: 'utf8', windowsHide: true, env: cellEnv(sb.path) });
    assert.equal(JSON.parse(r.stdout).memory_dir, tier, r.stderr);
  } finally {
    sb.cleanup();
  }
});

test('the entry dispatches `memory` at this module, with the actions the table declares', () => {
  const src = readFileSync(ENTRY, 'utf8');
  // The row is a lazy loader since the CLI slim pass (`memory: cmdMemory,` after Task 5
  // flattened the table, `memory: { fn: cmdMemory, },` before that) — the claim is
  // unchanged: the verb routes to THIS module's cmdMemory and no other.
  assert.match(src, /\n {2}memory: \(\) => import\('\.\.\/js\/maintain\/memory\.mjs'\)\.then\(\(m\) => m\.cmdMemory\),/,
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
  // Deleting for good is opt-in: both switches are flags that default off.
  for (const flag of ['--archived', '--purge']) {
    const opt = cmd.options.find((o) => o.names.includes(flag));
    assert.ok(opt?.is_flag && opt.default === false, `${flag} is not an off-by-default flag`);
  }
});
