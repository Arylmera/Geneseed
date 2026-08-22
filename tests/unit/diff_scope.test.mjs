// `tests/test_harness.py`'s `ProjectManifestDiffRefusalTests` and `MigrationHeaderTests` — the
// two places where an install's SHAPE, not its contents, decides what a command may do.
//
// `diff` compares a deployed install against a fresh render of the GLOBAL config-dir shape. A
// PROJECT install is a different shape entirely — a repo-root carrier plus a `.opencode`/
// `.claude`/`.bob` layer — so diffing one against the global render reports spurious drift on
// nearly every row. Since an OpenCode PROJECT install started carrying a manifest too, a
// `--target <repo>/.opencode` newly LOOKS diffable, which is exactly why the refusal has to be
// keyed on the recorded scope rather than on the presence of a manifest.
//
// The refusal must also stay DISTINGUISHABLE from the generic "no install here" one: they send
// the user to different fixes, and a single message for both would send half of them the wrong
// way.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { cmdDiff, diffCollect, manifestScope } from '../../js/inspect/diff.mjs';
import { GLOBAL_MANIFEST } from '../../js/hosts/hosts.mjs';
import { ROOT } from '../../js/build/source.mjs';
import {
  makeSandbox, homeOverrides, sandboxProcessHome, restoreProcessHome,
} from '../helpers/sandbox.mjs';

// `cmdDiff` and `diffCollect` run IN PROCESS and render through the emit path, whose hook-shim
// writer targets the environment's home. Same reason as lifecycle.test.mjs.
sandboxProcessHome();
test.after(() => { restoreProcessHome(); });

function withDir(fn) {
  const sb = makeSandbox('gs-diff-');
  try { return fn(sb.path); } finally { sb.cleanup(); }
}

function emit(argv, home, extraEnv = {}) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'build-driver.mjs'), ...argv], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...homeOverrides(home), ...extraEnv },
    maxBuffer: 1 << 26,
    windowsHide: true,
  });
  return { rc: r.status, out: r.stdout || '', err: r.stderr || '' };
}

function mustEmit(argv, home, extraEnv = {}) {
  const r = emit(argv, home, extraEnv);
  if (r.rc !== 0) throw new Error(`emit ${argv.join(' ')} (${r.rc}): ${(r.err || r.out).slice(-1200)}`);
  return r;
}

/** stdout and stderr, separately — which stream carried a refusal is part of the claim. */
function captured(fn) {
  const outw = process.stdout.write.bind(process.stdout);
  const errw = process.stderr.write.bind(process.stderr);
  let out = '';
  let err = '';
  process.stdout.write = (c) => { out += c; return true; };
  process.stderr.write = (c) => { err += c; return true; };
  try { return [fn(), out, err]; } finally {
    process.stdout.write = outw;
    process.stderr.write = errw;
  }
}

const diffArgs = (target, { theme = null, full = false, out = null } = {}) =>
  ({ target, theme, full, out });

const manifestAt = (dir) =>
  JSON.parse(fs.readFileSync(path.join(dir, GLOBAL_MANIFEST), 'utf8'));

// ---------------------------------------------------------------------------------------------
// The manifest records its own scope.

test('an OpenCode project manifest records scope: project', () => {
  withDir((d) => {
    const repo = path.join(d, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    mustEmit(['--emit', 'opencode', '--theme', 'neutral', '--out', repo, '--root', repo],
      path.join(d, 'home'));
    assert.equal(manifestAt(path.join(repo, '.opencode')).scope, 'project');
  });
});

test('a Claude project manifest records scope: project', () => {
  withDir((d) => {
    const repo = path.join(d, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    mustEmit(['--emit', 'claude', '--theme', 'neutral', '--out', repo, '--root', repo],
      path.join(d, 'home'));
    assert.equal(manifestAt(path.join(repo, '.claude')).scope, 'project');
  });
});

test('a global manifest has NO scope key, and reads as global', () => {
  // BACKWARD COMPATIBILITY IS THE CLAIM. Every install written before the key existed has no
  // `scope`, and those are all global — so a missing key must mean global rather than
  // "unknown". Writing `scope: "global"` instead would have been the readable choice and the
  // wrong one: it makes every pre-existing manifest indistinguishable from a project install.
  withDir((d) => {
    const gcfg = path.join(d, 'gcfg');
    fs.mkdirSync(gcfg, { recursive: true });
    mustEmit(['--emit', 'opencode-global', '--theme', 'neutral'], path.join(d, 'home'),
      { OPENCODE_CONFIG_DIR: gcfg });
    assert.ok(!('scope' in manifestAt(gcfg)), 'the global manifest grew a scope key');
    assert.equal(manifestScope(gcfg), 'global');
  });
});

// ---------------------------------------------------------------------------------------------
// The refusal, and the refusal it must not be confused with.

test('diffCollect refuses a project-scoped target', () => {
  withDir((d) => {
    const repo = path.join(d, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    mustEmit(['--emit', 'opencode', '--theme', 'neutral', '--out', repo, '--root', repo],
      path.join(d, 'home'));
    const { files } = diffCollect({ target: path.join(repo, '.opencode') });
    assert.equal(files, null, 'a project layer was diffed against the global render');
  });
});

test('the project refusal is distinct from the missing-install refusal', () => {
  withDir((d) => {
    const repo = path.join(d, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    mustEmit(['--emit', 'opencode', '--theme', 'neutral', '--out', repo, '--root', repo],
      path.join(d, 'home'));
    const [rc, , err] = captured(() => cmdDiff(diffArgs(path.join(repo, '.opencode'))));
    assert.equal(rc, 1);
    assert.ok(err.includes('PROJECT install'), err);
    // THE TWO MESSAGES SEND THE USER TO DIFFERENT FIXES — one says "pass a global config
    // dir", the other says "install something first". One message for both sends half of
    // them the wrong way, so the distinctness is asserted rather than assumed.
    assert.ok(!err.includes('no global Geneseed install'), err);
  });
});

test('a directory with no install still gets the generic refusal', () => {
  withDir((d) => {
    const empty = path.join(d, 'nothing-here');
    fs.mkdirSync(empty, { recursive: true });
    const [rc, , err] = captured(() => cmdDiff(diffArgs(empty)));
    assert.equal(rc, 1);
    assert.ok(err.includes('no global Geneseed install'), err);
    assert.ok(!err.includes('PROJECT install'), err);
  });
});

test('diff still works for a global install', () => {
  // The control on all three refusals above: they are equally satisfied by a `diff` that
  // refuses everything.
  withDir((d) => {
    const gcfg = path.join(d, 'gcfg');
    fs.mkdirSync(gcfg, { recursive: true });
    mustEmit(['--emit', 'opencode-global', '--theme', 'neutral'], path.join(d, 'home'),
      { OPENCODE_CONFIG_DIR: gcfg });
    const [rc, out] = captured(() => cmdDiff(diffArgs(gcfg)));
    assert.equal(rc, 0, out);
    assert.ok(out.includes('[diff] deployed'), out);
  });
});

// ---------------------------------------------------------------------------------------------
// The migration header.
//
// When an emit bootstraps a manifest over a manifest-LESS legacy install, the claim-on-create
// machinery treats every already-existing agent/skill file as the user's own and skips it —
// one "kept your existing …" line per file. That wall of lines has to be preceded by ONE header
// explaining why, or it reads as the emit refusing to do its job.

const LEGACY_HEADER = 'first emit over a pre-manifest install';

test('the header is printed exactly once, before the first skip line', () => {
  withDir((d) => {
    const repo = path.join(d, 'repo');
    const home = path.join(d, 'home');
    fs.mkdirSync(repo, { recursive: true });
    mustEmit(['--emit', 'opencode', '--theme', 'neutral', '--out', repo, '--root', repo], home);
    // A pre-manifest legacy install is exactly this: the agent/skill files already on disk,
    // and no manifest to say who wrote them.
    fs.rmSync(path.join(repo, '.opencode', GLOBAL_MANIFEST));

    const r = mustEmit(['--emit', 'opencode', '--theme', 'neutral',
      '--out', repo, '--root', repo], home);
    const err = r.err;
    assert.equal((err.match(new RegExp(LEGACY_HEADER, 'g')) ?? []).length, 1,
      `the header appeared ${(err.match(new RegExp(LEGACY_HEADER, 'g')) ?? []).length} times:\n${err}`);
    assert.ok(err.includes('kept your existing'), err);
    assert.ok(err.indexOf(LEGACY_HEADER) < err.indexOf('kept your existing'),
      `the explanation came after the wall of lines it explains:\n${err}`);
  });
});

test('an ordinary re-emit prints no header', () => {
  withDir((d) => {
    const repo = path.join(d, 'repo');
    const home = path.join(d, 'home');
    fs.mkdirSync(repo, { recursive: true });
    mustEmit(['--emit', 'opencode', '--theme', 'neutral', '--out', repo, '--root', repo], home);
    const r = mustEmit(['--emit', 'opencode', '--theme', 'neutral',
      '--out', repo, '--root', repo], home);   // the manifest is already there
    assert.ok(!r.err.includes(LEGACY_HEADER), r.err);
  });
});

test('a fresh install with nothing to skip prints no header', () => {
  // The third arm matters because the trigger is TWO conditions, not one: no manifest AND
  // pre-existing files. A header keyed on the missing manifest alone would fire on every
  // first install anybody ever does.
  withDir((d) => {
    const repo = path.join(d, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    const r = mustEmit(['--emit', 'opencode', '--theme', 'neutral',
      '--out', repo, '--root', repo], path.join(d, 'home'));
    assert.ok(!r.err.includes(LEGACY_HEADER), r.err);
  });
});
