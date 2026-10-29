// A3 (audit 2026-10-28): a PROJECT emit, on every host, seeds `<git root>/.geneseed/protected-checks.txt`
// with the checks that exist there, so the protected-checks gate is armed from the first session.
// The list is claim-on-create: a user's list is never touched, an edited seed is the user's, an
// unmodified seed is owned (rewritten when the candidates change, removed on uninstall). The
// manifest records only its hash (`seeded_checks`) — the path is a constant, never manifest data.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test, { after } from 'node:test';

import { emitGlobalInto, emitProjectInto } from '../../js/build/driver.mjs';
import {
  GENESEED_GITIGNORE, protectedChecksSeed, writeGeneseedGitignore,
} from '../../js/hosts/geneseed-dir.mjs';
import { GLOBAL_MANIFEST } from '../../js/hosts/hosts.mjs';
import { textHash } from '../../js/hosts/owned.mjs';
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
const HEADER = '# Seeded by Geneseed with the checks found in this project. Edit or delete it freely.\n'
  + '# A write tool aimed at a listed path asks you first (External Gate). One repo-relative\n'
  + '# file or folder per line; `#` starts a comment. A shell command is not seen: CI holds that.\n';
// Candidate order — CI, then lint/type/test config, then the done gate's manifests — and a
// pattern's matches in name order. `.circleci` (a file) and the lockfile are absent by design.
const MIX_SEED = `${HEADER}.github/workflows/\nJenkinsfile\neslint.config.js\n.eslintrc.json\n`
  + 'tsconfig.json\nvitest.config.ts\npackage.json\n';

const seedOf = (repo) => path.join(repo, '.geneseed', 'protected-checks.txt');
const gitignoreOf = (repo) => path.join(repo, '.geneseed', '.gitignore');
const manifestOf = (repo, layer) => JSON.parse(readFileSync(path.join(repo, layer, GLOBAL_MANIFEST), 'utf8'));
const LAYER = { claude: '.claude', bob: '.bob', openclaude: '.openclaude', opencode: '.opencode' };
const emit = (host, repo) => quietErr(() => emitProjectInto(host, { theme: 'neutral', out: repo, root: repo }))[1];

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

// Host parity: every host that emits into a project seeds, records the hash, re-emits without
// rewriting a byte, and takes the unmodified seed back on uninstall — leaving `.gitignore`, which
// guards personal state other writers keep in `.geneseed/`.
for (const host of ['claude', 'bob', 'openclaude', 'opencode']) {
  test(`${host}: a project emit seeds, re-emits idempotently, and uninstall takes the seed back`, () => {
    withDir((repo) => {
      plant(repo, MIX);
      emit(host, repo);
      assert.equal(readFileSync(seedOf(repo), 'utf8'), MIX_SEED);
      assert.equal(readFileSync(gitignoreOf(repo), 'utf8'), GENESEED_GITIGNORE);
      assert.equal(manifestOf(repo, LAYER[host]).seeded_checks, textHash(MIX_SEED));
      assert.ok(!manifestOf(repo, LAYER[host]).owned.some((r) => r.includes('protected-checks')),
        'the seed sits outside the install dir: it must not be an `owned` rel');

      const mtime = statSync(seedOf(repo)).mtimeMs;
      const man = readFileSync(path.join(repo, LAYER[host], GLOBAL_MANIFEST), 'utf8');
      emit(host, repo);
      assert.equal(statSync(seedOf(repo)).mtimeMs, mtime, 'a re-emit rewrote an unchanged seed');
      assert.equal(readFileSync(path.join(repo, LAYER[host], GLOBAL_MANIFEST), 'utf8'), man);

      const [s] = quietErr(() => installUninstall(repo, host, 'project', 'keep'));
      assert.equal(s.ok, true);
      assert.ok(!existsSync(seedOf(repo)), 'uninstall left the unmodified seed');
      assert.equal(readFileSync(gitignoreOf(repo), 'utf8'), GENESEED_GITIGNORE, 'uninstall took .gitignore');
    });
  });
}

test('no git root: nothing seeded, no key in the manifest', () => {
  withDir((repo) => {
    plant(repo, { 'package.json': '{}', 'tsconfig.json': '{}' });
    emit('claude', repo);
    assert.ok(!existsSync(path.join(repo, '.geneseed')));
    assert.ok(!('seeded_checks' in manifestOf(repo, '.claude')));
  });
});

test('no candidate: nothing seeded, no .geneseed/ created', () => {
  withDir((repo) => {
    plant(repo, { '.git/': '', 'README.md': '' });
    emit('claude', repo);
    assert.ok(!existsSync(path.join(repo, '.geneseed')));
    assert.ok(!('seeded_checks' in manifestOf(repo, '.claude')));
  });
});

test('a global emit seeds nothing, even with its config dir inside a repo', () => {
  withDir((repo) => {
    plant(repo, MIX);
    const cfgDir = path.join(repo, 'cfg');
    quietErr(() => emitGlobalInto('claude', { theme: 'neutral', out: repo, cfgDir }));
    assert.ok(!existsSync(path.join(repo, '.geneseed')));
    assert.ok(!('seeded_checks' in JSON.parse(readFileSync(path.join(cfgDir, GLOBAL_MANIFEST), 'utf8'))));
  });
});

test("a user's existing list is never touched, silently, and survives uninstall", () => {
  withDir((repo) => {
    const mine = '# ours\r\nci/\n';
    plant(repo, { ...MIX, '.geneseed/protected-checks.txt': mine });
    const err = emit('claude', repo);
    assert.equal(readFileSync(seedOf(repo), 'utf8'), mine);
    assert.doesNotMatch(err, /protected-checks/, 'a team list must not cost a warning on every emit');
    assert.ok(!existsSync(gitignoreOf(repo)), 'Geneseed wrote nothing into .geneseed/, so no .gitignore');
    assert.ok(!('seeded_checks' in manifestOf(repo, '.claude')));
    quietErr(() => installUninstall(repo, 'claude', 'project', 'keep'));
    assert.equal(readFileSync(seedOf(repo), 'utf8'), mine);
  });
});

test('an edited seed is kept on re-emit, becomes the user\'s, and survives uninstall', () => {
  withDir((repo) => {
    plant(repo, MIX);
    emit('claude', repo);
    const edited = `${MIX_SEED}src/fixtures/\n`;
    writeFileSync(seedOf(repo), edited);
    const err = emit('claude', repo);
    assert.match(err, /kept your edited \.geneseed\/protected-checks\.txt/);
    assert.equal(readFileSync(seedOf(repo), 'utf8'), edited);
    assert.ok(!('seeded_checks' in manifestOf(repo, '.claude')), 'an edited seed is the user\'s now');
    quietErr(() => installUninstall(repo, 'claude', 'project', 'keep'));
    assert.equal(readFileSync(seedOf(repo), 'utf8'), edited);
  });
});

test('a seed edited after the last emit is kept by uninstall and reported', () => {
  withDir((repo) => {
    plant(repo, MIX);
    emit('opencode', repo);
    writeFileSync(seedOf(repo), 'mine\n');
    const [s] = quietErr(() => installUninstall(repo, 'opencode', 'project', 'keep'));
    assert.equal(readFileSync(seedOf(repo), 'utf8'), 'mine\n');
    assert.ok(s.kept.includes('.geneseed/protected-checks.txt'), `kept: ${JSON.stringify(s.kept)}`);
  });
});

test('a deleted seed stays deleted on re-emit: the user opted out', () => {
  withDir((repo) => {
    plant(repo, MIX);
    emit('claude', repo);
    rmSync(seedOf(repo));
    emit('claude', repo);
    assert.ok(!existsSync(seedOf(repo)), 'a re-emit seeded the list the user deleted');
    assert.equal(manifestOf(repo, '.claude').seeded_checks, textHash(MIX_SEED), 'the tombstone was lost');
  });
});

test('an unmodified seed follows the candidates: rewritten when they change, removed when none is left', () => {
  withDir((repo) => {
    plant(repo, { '.git/': '', 'package.json': '{}' });
    emit('claude', repo);
    assert.equal(readFileSync(seedOf(repo), 'utf8'), `${HEADER}package.json\n`);
    plant(repo, { 'go.mod': '' });
    emit('claude', repo);
    assert.equal(readFileSync(seedOf(repo), 'utf8'), `${HEADER}package.json\ngo.mod\n`);
    assert.equal(manifestOf(repo, '.claude').seeded_checks, textHash(`${HEADER}package.json\ngo.mod\n`));
    rmSync(path.join(repo, 'package.json'));
    rmSync(path.join(repo, 'go.mod'));
    emit('claude', repo);
    assert.ok(!existsSync(seedOf(repo)), 'a seed with no candidate left was kept');
    assert.ok(!('seeded_checks' in manifestOf(repo, '.claude')));
  });
});

test('a project below its git root seeds at the git root', () => {
  withDir((d) => {
    plant(d, { '.git/': '', 'pom.xml': '' });
    const sub = path.join(d, 'app');
    mkdirSync(sub);
    emit('claude', sub);
    assert.equal(readFileSync(seedOf(d), 'utf8'), `${HEADER}pom.xml\n`);
    quietErr(() => installUninstall(sub, 'claude', 'project', 'keep'));
    assert.ok(!existsSync(seedOf(d)));
  });
});
