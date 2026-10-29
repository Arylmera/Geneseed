// A3 (audit 2026-10-28): a PROJECT emit, on every host, seeds `<git root>/.geneseed/protected-checks.txt`
// with the checks that exist there, so the protected-checks gate is armed from the first session.
// SEED ONCE: created only when absent, then the user's — never rewritten, pruned, deleted on
// uninstall or recorded in a manifest (review 2026-10-29, F2/F3: owning it let one host's
// uninstall delete another's seed, and a committed manifest rewrite a team's list). Opt-out is an
// emptied file; a missing one is seeded again. Every write is guarded: the emit never fails on it.
import assert from 'node:assert/strict';
import {
  existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import test, { after } from 'node:test';

import { emitGlobalInto, emitProjectInto } from '../../js/build/driver.mjs';
import {
  GENESEED_GITIGNORE, protectedChecksSeed, writeGeneseedGitignore,
} from '../../js/hosts/geneseed-dir.mjs';
import { GLOBAL_MANIFEST } from '../../js/hosts/hosts.mjs';
import { ROOT } from '../../js/build/source.mjs';
import { installUninstall } from '../../js/maintain/uninstall.mjs';
import { makeSandbox, restoreProcessHome, sandboxProcessHome } from '../helpers/sandbox.mjs';

// The emit's hook-shim writer targets the environment's home; keep it off the real machine.
sandboxProcessHome();
after(restoreProcessHome);

/** Run `fn`, returning `[result, stderr]` with stdout swallowed. */
function quietErr(fn) {
  const ro = process.stdout.write.bind(process.stdout);
  const re = process.stderr.write.bind(process.stderr);
  let err = '';
  process.stdout.write = () => true;
  process.stderr.write = (s) => { err += String(s); return true; };
  try { return [fn(), err]; } finally {
    process.stdout.write = ro;
    process.stderr.write = re;
  }
}

function withDir(fn) {
  const sb = makeSandbox('seed-');
  try { return fn(sb.path); } finally { sb.cleanup(); }
}

/** As `tests/unit/owned.test.mjs`: a Windows account without the privilege skips, never fails. */
function trySymlink(t, target, link, type = undefined) {
  try {
    symlinkSync(target, link, type);
    return true;
  } catch (e) {
    if (process.platform === 'win32' && e.code === 'EPERM') {
      t.skip('symlinks need privileges here');
      return false;
    }
    throw e;
  }
}

/** Write `files` (rel -> text) under `dir`; a rel ending `/` is a directory. */
function plant(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    const p = path.join(dir, rel);
    if (rel.endsWith('/')) { mkdirSync(p, { recursive: true }); continue; }
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
}

// A repo holding a mix: candidates that exist, a candidate in the wrong shape (`.circleci` as a
// FILE, where the candidate is a folder), a lockfile (never listed) and a plain file.
const MIX = {
  '.git/': '', 'package.json': '{}', 'package-lock.json': '{}', 'tsconfig.json': '{}',
  'eslint.config.js': '', '.eslintrc.json': '{}', 'vitest.config.ts': '', 'Jenkinsfile': '',
  '.github/workflows/ci.yml': '', '.circleci': '', 'README.md': '',
};
const HEADER = '# Seeded once by Geneseed with the checks found in this project; it is yours now.\n'
  + '# A write tool aimed at a listed path asks you first (External Gate). One repo-relative\n'
  + '# file or folder per line; `#` starts a comment. A shell command is not seen: CI holds that.\n'
  + '# To opt out, delete these lines but keep the file: a missing file is seeded again.\n';
// Candidate order — CI, then lint/type/test config, then the done gate's manifests — and a
// pattern's matches in name order. `.circleci` (a file) and the lockfile are absent by design.
const MIX_SEED = `${HEADER}.github/workflows/\nJenkinsfile\neslint.config.js\n.eslintrc.json\n`
  + 'tsconfig.json\nvitest.config.ts\npackage.json\n';
const OPTED_OUT = '# we opted out\n';

const seedOf = (repo) => path.join(repo, '.geneseed', 'protected-checks.txt');
const gitignoreOf = (repo) => path.join(repo, '.geneseed', '.gitignore');
const LAYER = { claude: '.claude', bob: '.bob', openclaude: '.openclaude', opencode: '.opencode' };
const manifestText = (repo, host) => readFileSync(path.join(repo, LAYER[host], GLOBAL_MANIFEST), 'utf8');
const emit = (host, repo) => quietErr(() => emitProjectInto(host, { theme: 'neutral', out: repo, root: repo }))[1];
const uninstall = (host, repo) => quietErr(() => installUninstall(repo, host, 'project', 'keep'))[0];

test('the seed lists exactly the candidates that exist, in candidate order', () => {
  withDir((d) => {
    plant(d, MIX);
    assert.equal(protectedChecksSeed(d), MIX_SEED);
  });
});

test('no candidate at the root: no seed', () => {
  withDir((d) => {
    plant(d, { '.git/': '', 'README.md': '', 'package-lock.json': '{}' });
    assert.equal(protectedChecksSeed(d), null);
  });
});

// The Node writer mirrors the OpenCode `writeGitignore`: create when absent, upgrade only an exact
// `*` (Geneseed's former output, which hid team bricks), keep anything else, never throw.
test('writeGeneseedGitignore: created, exact-* upgraded, custom kept, never throws', () => {
  withDir((d) => {
    const f = path.join(d, '.gitignore');
    writeGeneseedGitignore(f);
    assert.equal(readFileSync(f, 'utf8'), GENESEED_GITIGNORE, 'absent: created');
    for (const old of ['*', '*\n', '*\r\n']) {
      writeFileSync(f, old);
      writeGeneseedGitignore(f);
      assert.equal(readFileSync(f, 'utf8'), GENESEED_GITIGNORE, `${JSON.stringify(old)}: upgraded`);
    }
    for (const mine of ['*\nnotes/\n', 'build/\n', '']) {
      writeFileSync(f, mine);
      writeGeneseedGitignore(f);
      assert.equal(readFileSync(f, 'utf8'), mine, `${JSON.stringify(mine)}: the user's, kept`);
    }
    writeGeneseedGitignore(path.join(d, 'missing', 'dir', '.gitignore'));
  });
});

// One allowlist, four homes: this Node constant, the two OpenCode copies (a plugin cannot share
// a file — V2 loads every .js in plugins/ as a plugin) and the Rites' block. Read as text.
test('the Node .gitignore constant is the same string as both OpenCode copies and the Rites block', () => {
  for (const rel of ['adapters/opencode/plugins/geneseed-workflow.js', 'adapters/opencode/workflows/_runtime.js']) {
    const m = /const GENESEED_GITIGNORE = ("(?:[^"\\]|\\.)*")/.exec(readFileSync(path.join(ROOT, rel), 'utf8'));
    assert.ok(m, `${rel} lost its GENESEED_GITIGNORE literal`);
    assert.equal(JSON.parse(m[1]), GENESEED_GITIGNORE, `${rel} drifted from js/hosts/geneseed-dir.mjs`);
  }
  const block = /```gitignore\r?\n([\s\S]*?)```/.exec(readFileSync(path.join(ROOT, 'src/skills/_checkpoints.md'), 'utf8'));
  assert.equal(block[1].split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join('\n') + '\n', GENESEED_GITIGNORE);
});

// Host parity: every host that emits into a project seeds; a re-emit leaves the seed byte-identical
// and unwritten; uninstall leaves it (and `.gitignore`) in place; no manifest ever mentions it.
for (const host of ['claude', 'bob', 'openclaude', 'opencode']) {
  test(`${host}: a project emit seeds once; re-emit and uninstall leave the seed alone`, () => {
    withDir((repo) => {
      plant(repo, MIX);
      emit(host, repo);
      assert.equal(readFileSync(seedOf(repo), 'utf8'), MIX_SEED);
      assert.equal(readFileSync(gitignoreOf(repo), 'utf8'), GENESEED_GITIGNORE);
      assert.doesNotMatch(manifestText(repo, host), /protected-checks|seeded/,
        'seed once: no manifest may record the seed');

      const mtime = statSync(seedOf(repo)).mtimeMs;
      plant(repo, { 'go.mod': '' });   // a new candidate changes nothing: the file is the user's
      emit(host, repo);
      assert.equal(readFileSync(seedOf(repo), 'utf8'), MIX_SEED);
      assert.equal(statSync(seedOf(repo)).mtimeMs, mtime, 'a re-emit rewrote the seed');

      assert.equal(uninstall(host, repo).ok, true);
      assert.equal(readFileSync(seedOf(repo), 'utf8'), MIX_SEED, 'uninstall touched the seed');
      assert.equal(readFileSync(gitignoreOf(repo), 'utf8'), GENESEED_GITIGNORE, 'uninstall took .gitignore');
    });
  });
}

test('two hosts in one repo: one seed, never deleted by either uninstall, an opt-out never undone', () => {
  withDir((repo) => {
    plant(repo, MIX);
    emit('claude', repo);
    emit('opencode', repo);
    assert.equal(readFileSync(seedOf(repo), 'utf8'), MIX_SEED);
    uninstall('claude', repo);
    assert.equal(readFileSync(seedOf(repo), 'utf8'), MIX_SEED, 'one host\'s uninstall deleted the shared seed');
    writeFileSync(seedOf(repo), OPTED_OUT);
    emit('opencode', repo);
    emit('claude', repo);
    uninstall('opencode', repo);
    uninstall('claude', repo);
    assert.equal(readFileSync(seedOf(repo), 'utf8'), OPTED_OUT, 'an opt-out came back or was deleted');
  });
});

test('opt-out is an emptied file, kept as is; a deleted file is seeded again', () => {
  withDir((repo) => {
    plant(repo, { '.git/': '', 'pom.xml': '' });
    emit('claude', repo);
    writeFileSync(seedOf(repo), '');
    emit('claude', repo);
    assert.equal(readFileSync(seedOf(repo), 'utf8'), '', 'an emptied list was re-seeded');
    rmSync(seedOf(repo));
    emit('claude', repo);
    assert.equal(readFileSync(seedOf(repo), 'utf8'), `${HEADER}pom.xml\n`);
  });
});

test('no git root: nothing seeded, the manifest is unchanged in shape', () => {
  withDir((repo) => {
    plant(repo, { 'package.json': '{}', 'tsconfig.json': '{}' });
    emit('claude', repo);
    assert.ok(!existsSync(path.join(repo, '.geneseed')));
    assert.doesNotMatch(manifestText(repo, 'claude'), /seeded/);
  });
});

test('no candidate: nothing seeded, no .geneseed/ created', () => {
  withDir((repo) => {
    plant(repo, { '.git/': '', 'README.md': '' });
    emit('claude', repo);
    assert.ok(!existsSync(path.join(repo, '.geneseed')));
  });
});

test('a global emit seeds nothing, even with its config dir inside a repo', () => {
  withDir((repo) => {
    plant(repo, MIX);
    quietErr(() => emitGlobalInto('claude', { theme: 'neutral', out: repo, cfgDir: path.join(repo, 'cfg') }));
    assert.ok(!existsSync(path.join(repo, '.geneseed')));
  });
});

// F5: `.gitignore` is ensured whenever `.geneseed/` is a real directory — not only on a fresh seed.
test("a user's existing list is never touched, silently, and .geneseed/ gets its .gitignore", () => {
  withDir((repo) => {
    const mine = '# ours\r\nci/\n';
    plant(repo, { ...MIX, '.geneseed/protected-checks.txt': mine });
    const err = emit('claude', repo);
    assert.equal(readFileSync(seedOf(repo), 'utf8'), mine);
    assert.doesNotMatch(err, /protected-checks/, 'a team list must not cost a warning on every emit');
    assert.equal(readFileSync(gitignoreOf(repo), 'utf8'), GENESEED_GITIGNORE);
    uninstall('claude', repo);
    assert.equal(readFileSync(seedOf(repo), 'utf8'), mine);
  });
});

test('an exact-* .gitignore in .geneseed/ is upgraded by an emit; a custom one is kept', () => {
  withDir((repo) => {
    plant(repo, { ...MIX, '.geneseed/.gitignore': '*\n' });
    emit('claude', repo);
    assert.equal(readFileSync(gitignoreOf(repo), 'utf8'), GENESEED_GITIGNORE);
    writeFileSync(gitignoreOf(repo), 'scratch/\n');
    emit('claude', repo);
    assert.equal(readFileSync(gitignoreOf(repo), 'utf8'), 'scratch/\n');
  });
});

// F1: the seed must never cost the emit its manifest. With `.geneseed` a FILE, the old code threw
// EEXIST from mkdir before MANIFEST; the next emit then read the whole install as the user's.
test('.geneseed as a file: the emit completes, writes its manifest, owns what a normal emit owns, and warns', () => {
  withDir((d) => {
    const normal = path.join(d, 'normal');
    plant(normal, MIX);
    emit('claude', normal);
    const blocked = path.join(d, 'blocked');
    plant(blocked, { ...MIX, '.geneseed': 'not a dir' });
    const err = emit('claude', blocked);
    assert.match(err, /\.geneseed is not a directory — the protected-checks list was not seeded/);
    assert.equal(readFileSync(path.join(blocked, '.geneseed'), 'utf8'), 'not a dir');
    const owned = (repo) => JSON.parse(manifestText(repo, 'claude')).owned;
    assert.deepEqual(owned(blocked), owned(normal), 'the manifest lost what the emit owns');
    const again = emit('claude', blocked);
    assert.doesNotMatch(again, /kept your existing/, 'the re-emit read the install as the user\'s');
  });
});

test('a directory where the seed should be: nothing written, nothing thrown', () => {
  withDir((repo) => {
    // The existence check sees it, so nothing is written; `.gitignore` still lands because
    // `.geneseed/` is a real directory.
    plant(repo, { ...MIX, '.geneseed/protected-checks.txt/': '' });
    emit('claude', repo);
    assert.ok(statSync(seedOf(repo)).isDirectory());
    assert.equal(readFileSync(gitignoreOf(repo), 'utf8'), GENESEED_GITIGNORE);
  });
});

// F4: nothing is written through a link — neither a linked `.geneseed/` nor a linked seed leaf.
test('a symlinked .geneseed/ is never written through', (t) => {
  withDir((d) => {
    const repo = path.join(d, 'repo');
    const outside = path.join(d, 'outside');
    plant(repo, MIX);
    mkdirSync(outside);
    if (!trySymlink(t, outside, path.join(repo, '.geneseed'), 'junction')) return;
    const err = emit('claude', repo);
    assert.ok(!existsSync(path.join(outside, 'protected-checks.txt')), 'seeded through a linked .geneseed');
    assert.ok(!existsSync(path.join(outside, '.gitignore')), '.gitignore written through a linked .geneseed');
    assert.match(err, /not a directory/);
  });
});

test('a symlinked seed leaf, even dangling, is never written through', (t) => {
  withDir((d) => {
    const repo = path.join(d, 'repo');
    plant(repo, { ...MIX, '.geneseed/': '' });
    const target = path.join(d, 'victim.txt');
    if (!trySymlink(t, target, seedOf(repo))) return;
    emit('claude', repo);
    assert.ok(!existsSync(target), 'the seed was written through a dangling link');
  });
});

test('a project below its git root seeds at the git root', () => {
  withDir((d) => {
    plant(d, { '.git/': '', 'pom.xml': '' });
    const sub = path.join(d, 'app');
    mkdirSync(sub);
    emit('claude', sub);
    assert.equal(readFileSync(seedOf(d), 'utf8'), `${HEADER}pom.xml\n`);
  });
});
