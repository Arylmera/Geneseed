// THE GLOBAL-EXCLUDES GUARD — thirteen claims that HAVE NEVER RUN.
//
// `tests/test_harness.py:1997-2194` carries thirteen tests written in the pytest style: module
// level `def test_...` taking `tmp_path`/`monkeypatch`/`capsys`. This repository's only Python
// runner is `python -m unittest discover`, which collects `TestCase` METHODS and nothing else,
// and pytest appears in no workflow and no config file here. 199 of that file's tests run; 212
// are written. `tests/unit/ported.test.mjs` re-derives both counts and records the split, which is
// how the gap was found at all.
//
// SO THESE ARE NOT COVERAGE BEING TRANSLATED. They are UNPROVEN CLAIMS. The port's job is to
// write the gate first and then find out whether the behaviour is actually there — which is the
// opposite of the usual porting posture, where a green reference is the thing you are trying to
// reproduce.
//
// PREDICTIONS, WRITTEN BEFORE THE FIRST RUN, because §7's rule is that a green run you predicted
// is evidence and one you did not is a coincidence:
//   * The three `sovereignBypass` groups PASS. The code reads correctly for all of them — the
//     prefix trap is guarded by `cwd.startsWith(base + path.sep)` rather than a bare prefix
//     test, and the non-list case by `Array.isArray(data.excludes)`.
//   * `git-gate` PASSES: `sovereignBypass` is the literal first line of `cmdGitGate`.
//   * `context` UNKNOWN — the bypass is not obviously first, and the verb has several other
//     ways to say nothing, so a silent pass here could be silent for the wrong reason.
//   * The eight `exclude add|remove|list` claims UNKNOWN. They are the ones that have never
//     been observed at all, on either implementation.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { sovereignBypass } from '../../js/hooks.mjs';
import { excludeAdd, excludeRemove, excludesSnapshot, cmdExclude } from '../../js/excludes.mjs';
import { pyResolve } from '../../js/hosts.mjs';
import { makeSandbox, sandboxProcessHome, restoreProcessHome } from '../helpers/sandbox.mjs';
import { withGlobalInstalls } from '../helpers/installs_fixture.mjs';
import { ROOT } from '../helpers/web_fixture.mjs';

const asPosix = (p) => p.split(path.sep).join('/');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

// `monkeypatch.chdir` with a `finally`, because `process.chdir` is process-wide and this file
// runs beside others in the same worker.
function inDir(dir, fn) {
  const cwd = process.cwd();
  try { process.chdir(dir); return fn(); } finally { process.chdir(cwd); }
}

function excludesCfg(tmp, folders) {
  const cfg = path.join(tmp, 'cfg');
  fs.mkdirSync(cfg, { recursive: true });
  fs.writeFileSync(path.join(cfg, 'excludes.json'),
    JSON.stringify({ excludes: folders.map((f) => ({ path: f })) }));
  return cfg;
}

// ---------------------------------------------------------------------------------------------
// sovereignBypass

test('sovereignBypass is true inside an excluded tree, subdirectories included', () => {
  const sb = makeSandbox();
  try {
    const repo = path.join(sb.path, 'vault');
    fs.mkdirSync(path.join(repo, 'sub'), { recursive: true });
    const cfg = excludesCfg(sb.path, [repo]);
    inDir(path.join(repo, 'sub'), () => {
      assert.equal(sovereignBypass(cfg), true);
    });
  } finally { sb.cleanup(); }
});

// THE PREFIX TRAP IS THE POINT of the sibling: `vault-sibling` starts with `vault`, so a guard
// written as a bare `startswith` with no separator test excludes a directory nobody asked to
// exclude — and the failure is SILENT, because being excluded means the hooks go quiet.
test('sovereignBypass is false outside, and degrades to false rather than raising', () => {
  const sb = makeSandbox();
  try {
    const repo = path.join(sb.path, 'vault');
    const other = path.join(sb.path, 'vault-sibling');
    fs.mkdirSync(repo);
    fs.mkdirSync(other);
    const cfg = excludesCfg(sb.path, [repo]);
    inDir(other, () => {
      assert.equal(sovereignBypass(cfg), false, 'the prefix trap fired');
      assert.equal(sovereignBypass(null), false);
      fs.writeFileSync(path.join(cfg, 'excludes.json'), '{not json');
      assert.equal(sovereignBypass(cfg), false, 'a malformed file must not exclude');
      assert.equal(sovereignBypass(path.join(sb.path, 'no-such')), false);
    });
  } finally { sb.cleanup(); }
});

// A truthy SCALAR is not iterable. Iterating it raises, and a raise here would be read by the
// callers as a clean pass while gating nothing — the guard fails OPEN in the dangerous direction.
test('sovereignBypass survives a non-list excludes value', () => {
  const sb = makeSandbox();
  try {
    const cfg = path.join(sb.path, 'cfg');
    fs.mkdirSync(cfg, { recursive: true });
    inDir(sb.path, () => {
      for (const bad of [5, true, 3.14]) {
        fs.writeFileSync(path.join(cfg, 'excludes.json'), JSON.stringify({ excludes: bad }));
        assert.equal(sovereignBypass(cfg), false, `excludes: ${JSON.stringify(bad)}`);
      }
    });
  } finally { sb.cleanup(); }
});

// ---------------------------------------------------------------------------------------------
// The two hook verbs, driven as the CHILD PROCESSES they really are.
//
// `cmdGitGate` reads stdin, and P5i's finding was that faking a TTY or a pipe in process is
// where this kind of test goes wrong. The hook binary with stdin from a seeded file is what the
// host actually runs, and it makes "silent" mean bytes rather than a mock's call count.

function hookRun(verb, { cwd, root, stdin = '' }) {
  const sb = makeSandbox();
  try {
    const inFile = path.join(sb.path, 'stdin.json');
    fs.writeFileSync(inFile, stdin);
    const fd = fs.openSync(inFile, 'r');
    try {
      const proc = spawnSync(process.execPath,
        [path.join(ROOT, 'bin', 'geneseed-hook.mjs'), verb, '--root', root],
        { cwd, encoding: 'utf8', windowsHide: true, stdio: [fd, 'pipe', 'pipe'] });
      return { rc: proc.status, out: proc.stdout, err: proc.stderr };
    } finally { fs.closeSync(fd); }
  } finally { sb.cleanup(); }
}

test('context says nothing at all inside an excluded tree', () => {
  const sb = makeSandbox();
  try {
    const repo = path.join(sb.path, 'vault');
    fs.mkdirSync(repo, { recursive: true });
    fs.writeFileSync(path.join(repo, 'README.md'), '# v');
    const cfg = excludesCfg(sb.path, [repo]);

    const r = hookRun('context', { cwd: repo, root: cfg });
    assert.equal(r.rc, 0);
    assert.equal(r.out, '', `context printed on stdout: ${JSON.stringify(r.out)}`);
    assert.equal(r.err, '', `context printed on stderr: ${JSON.stringify(r.err)}`);
  } finally { sb.cleanup(); }
});

// THE CONTROL FOR THE ROW ABOVE, and without it that test is satisfied by a `context` that
// never says anything anywhere. An excluded tree must be silent BECAUSE it is excluded.
test('context is not silent in the same tree when it is not excluded', () => {
  const sb = makeSandbox();
  try {
    const repo = path.join(sb.path, 'vault');
    fs.mkdirSync(repo, { recursive: true });
    fs.writeFileSync(path.join(repo, 'README.md'), '# v');
    fs.writeFileSync(path.join(repo, 'context.json'), JSON.stringify({
      context: [{ path: 'README.md', load: 'eager', description: 'the readme' }],
    }));
    const cfg = excludesCfg(sb.path, []);        // nothing excluded

    const r = hookRun('context', { cwd: repo, root: cfg });
    assert.equal(r.rc, 0);
    assert.notEqual(r.out, '',
      'context said nothing with an empty excludes list either — the silence test above is '
      + 'passing for the wrong reason and proves nothing about the guard');
  } finally { sb.cleanup(); }
});

test('git-gate says nothing inside an excluded tree', () => {
  const sb = makeSandbox();
  try {
    const repo = path.join(sb.path, 'vault');
    fs.mkdirSync(repo, { recursive: true });
    const cfg = excludesCfg(sb.path, [repo]);

    const r = hookRun('git-gate', { cwd: repo, root: cfg,
      stdin: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git commit -m x' } }) });
    assert.equal(r.rc, 0);
    assert.equal(r.out, '', 'an ask-decision was printed inside an excluded tree');
  } finally { sb.cleanup(); }
});

// Same control, same reason: the gate must fire when the tree is NOT excluded, or "silent" is
// a property of the verb rather than of the guard.
test('git-gate DOES ask in the same tree when it is not excluded', () => {
  const sb = makeSandbox();
  try {
    const repo = path.join(sb.path, 'vault');
    fs.mkdirSync(repo, { recursive: true });
    const cfg = excludesCfg(sb.path, []);

    const r = hookRun('git-gate', { cwd: repo, root: cfg,
      stdin: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git commit -m x' } }) });
    assert.equal(r.rc, 0);
    assert.match(r.out, /Law XX/,
      'the gate stayed silent with an empty excludes list — the silence test above proves '
      + 'nothing about the guard');
  } finally { sb.cleanup(); }
});

// ---------------------------------------------------------------------------------------------
// `harness exclude add|remove|list`.
//
// Every test below runs under its OWN sandboxed home: `excludeAdd` writes into each detected
// global install, and `claudeConfigDir()` is `~/.claude` with no relocation variable.

function withExcludes(hosts, fn) {
  sandboxProcessHome();
  try {
    return withGlobalInstalls(hosts, fn);
  } finally { restoreProcessHome(); }
}

const entryFor = (cfg, repo) => readJson(path.join(cfg, 'excludes.json')).excludes
  .find((e) => pyResolve(e.path) === pyResolve(repo));

test('exclude add and remove round-trip across every detected install', () => {
  withExcludes(['claude', 'bob'], ({ tmp, cfgs }) => {
    const repo = path.join(tmp, 'vault');
    fs.mkdirSync(repo, { recursive: true });

    assert.equal(excludeAdd(repo).ok, true);
    for (const cfg of Object.values(cfgs)) {
      assert.ok(entryFor(cfg, repo), `${cfg} did not record the exclude`);
    }

    // claude wiring: `claudeMdExcludes` in the EXCLUDED repo's own settings.local.json.
    const localPath = path.join(repo, '.claude', 'settings.local.json');
    assert.ok(readJson(localPath).claudeMdExcludes
      .includes(asPosix(pyResolve(path.join(cfgs.claude, 'CLAUDE.md')))));
    // bob wiring: the shadow stub.
    assert.ok(fs.statSync(path.join(repo, '.bob', 'rules', 'geneseed.md')).isFile());

    // Idempotent — a second add must not duplicate the entry.
    assert.equal(excludeAdd(repo).ok, true);
    assert.equal(readJson(path.join(cfgs.claude, 'excludes.json')).excludes.length, 1);

    assert.equal(excludeRemove(repo).ok, true);
    for (const cfg of Object.values(cfgs)) {
      assert.deepEqual(readJson(path.join(cfg, 'excludes.json')).excludes, []);
    }
    assert.ok(!(readJson(localPath).claudeMdExcludes || []).length);
    assert.ok(!fs.existsSync(path.join(repo, '.bob', 'rules', 'geneseed.md')));
  });
});

// The user's own file at the path this tool would write. Never clobbered on add, never deleted
// on remove — the same ownership rule the emit follows.
test('exclude never clobbers a user-written bob stub', () => {
  withExcludes(['claude', 'bob'], ({ tmp }) => {
    const repo = path.join(tmp, 'vault');
    fs.mkdirSync(path.join(repo, '.bob', 'rules'), { recursive: true });
    const own = path.join(repo, '.bob', 'rules', 'geneseed.md');
    fs.writeFileSync(own, 'USER CONTENT');

    excludeAdd(repo);
    assert.equal(fs.readFileSync(own, 'utf8'), 'USER CONTENT', 'the user file was clobbered');
    excludeRemove(repo);
    assert.ok(fs.existsSync(own), 'a file this tool never wrote was deleted');
  });
});

test('the excludes snapshot unions the hosts that carry the entry', () => {
  withExcludes(['claude', 'bob'], ({ tmp }) => {
    const repo = path.join(tmp, 'vault');
    fs.mkdirSync(repo, { recursive: true });
    excludeAdd(repo);
    const snap = excludesSnapshot();
    assert.equal(snap.excludes.length, 1);
    assert.deepEqual([...snap.excludes[0].hosts].sort(), ['bob', 'claude']);
  });
});

// A path that is not there yet is a legitimate thing to exclude in advance. It WARNS and
// proceeds — and it must not create the directory just to hang wiring off it.
test('excluding a path that does not exist warns but proceeds', () => {
  withExcludes(['claude', 'bob'], ({ tmp, cfgs }) => {
    const ghost = path.join(tmp, 'does-not-exist');
    const res = excludeAdd(ghost);
    assert.equal(res.ok, true);
    assert.ok(res.messages.some((m) => m.includes('does not exist')),
      `no warning in ${JSON.stringify(res.messages)}`);
    assert.ok(entryFor(cfgs.claude, ghost));
    assert.ok(!fs.existsSync(path.join(ghost, '.claude')),
      'the path was materialised just to wire excludes');
  });
});

// A repo that ALREADY carries the global CLAUDE.md in its own `claudeMdExcludes` — a
// project-bypasses-global install's wiring, or a user's manual edit — must not have that entry
// claimed as this tool's own, or a later remove strips wiring it never created.
test('exclude add does not claim pre-existing claude wiring', () => {
  withExcludes(['claude', 'bob'], ({ tmp, cfgs }) => {
    const repo = path.join(tmp, 'vault');
    fs.mkdirSync(repo, { recursive: true });
    const claudeMd = asPosix(pyResolve(path.join(cfgs.claude, 'CLAUDE.md')));
    const settingsDir = path.join(repo, '.claude');
    fs.mkdirSync(settingsDir, { recursive: true });
    const localPath = path.join(settingsDir, 'settings.local.json');
    fs.writeFileSync(localPath, JSON.stringify({ claudeMdExcludes: [claudeMd] }));

    assert.equal(excludeAdd(repo).ok, true);
    const entry = entryFor(cfgs.claude, repo);
    assert.ok(!((entry.wired || {}).claude_md_excludes || []).length,
      "pre-existing wiring was claimed as this tool's own");

    assert.equal(excludeRemove(repo).ok, true);
    assert.ok(readJson(localPath).claudeMdExcludes.includes(claudeMd),
      'pre-existing wiring was stripped by a remove that never created it');
  });
});

// The contrast with the row above, and the harder half: when `excludeAdd` DID wire
// `claudeMdExcludes` on the first call, a second idempotent call must still record ownership —
// even though the wiring step reports nothing NEW added the second time — so a later remove
// still unwires it.
test('an idempotent re-add still records ownership of its own wiring', () => {
  withExcludes(['claude', 'bob'], ({ tmp, cfgs }) => {
    const repo = path.join(tmp, 'vault');
    fs.mkdirSync(repo, { recursive: true });

    assert.equal(excludeAdd(repo).ok, true);
    assert.equal(excludeAdd(repo).ok, true);

    const entry = entryFor(cfgs.claude, repo);
    const claudeMd = asPosix(pyResolve(path.join(cfgs.claude, 'CLAUDE.md')));
    assert.ok(((entry.wired || {}).claude_md_excludes || []).includes(claudeMd),
      'the second add dropped the ownership record the first one earned');

    assert.equal(excludeRemove(repo).ok, true);
    const local = readJson(path.join(repo, '.claude', 'settings.local.json'));
    assert.ok(!(local.claudeMdExcludes || []).length, 'our own wiring was left behind');
  });
});

// TRUE END TO END: the file `excludeAdd` actually wrote — not a hand-built fixture — must make
// `sovereignBypass` report true for a cwd under the excluded repo. Every other test in this file
// builds one side or reads the other; this one closes the loop.
test('the guard reads the file the add actually wrote', () => {
  withExcludes(['claude', 'bob'], ({ tmp, cfgs }) => {
    const repo = path.join(tmp, 'vault');
    fs.mkdirSync(path.join(repo, 'sub'), { recursive: true });
    assert.equal(excludeAdd(repo).ok, true);

    inDir(path.join(repo, 'sub'), () => {
      assert.equal(sovereignBypass(cfgs.claude), true);
      assert.equal(sovereignBypass(cfgs.bob), true);
    });
  });
});

test('exclude list refuses when there is no global install', () => {
  withExcludes([], () => {
    const chunks = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (c) => { chunks.push(String(c)); return true; };
    let rc;
    try { rc = cmdExclude({ action: 'list', path: null }); } finally {
      process.stdout.write = original;
    }
    assert.equal(rc, 1);
    assert.match(chunks.join(''), /no global install/);
  });
});
