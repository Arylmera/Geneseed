// `tests/test_harness.py`'s `RetryGapUninstallTests` — an owned file that refuses to be removed
// must not take the install's own findability down with it.
//
// THE FAILURE IT GUARDS. A partial uninstall that dropped `.geneseed-emit` (or, for claude/bob,
// the manifest) would leave a half-removed install that nothing can find: `installState` keys on
// those files, so the very retry the warning PROMISES would bounce off the resolver's "nothing
// installed here" gate, stranding `agents/`, the markers and the registry row forever. The
// marker is what makes the operation retriable, so it is the last thing to go.
//
// THE LOCK IS REAL, NOT A FAKE, and getting there took measuring rather than reasoning. The
// reference monkeypatches `Path.unlink` to raise for one filename; `js/uninstall.mjs` imports
// `unlinkSync` as a NAMED BINDING, which ESM cannot rebind, so that door is shut. Three
// candidate mechanisms were measured on this platform:
//
//   * an open file handle — does NOT block unlink. Node/libuv passes FILE_SHARE_DELETE, so the
//     obvious "hold it open like another process would" simply does not work on Windows.
//   * the read-only attribute (`chmod 0o444`) — does NOT block unlink on Windows.
//   * a non-empty DIRECTORY where the owned file should be — EPERM on Windows, and the same
//     refusal on POSIX. This is the one, and it is portable.
//
// It is also a better gate than the monkeypatch: a fake `unlink` cannot catch a port that
// removes the file through some OTHER call, because the fake is keyed to the function the test
// already assumed was used. A path that genuinely will not go catches whatever the product
// really does.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { installUninstall, cmdUninstall } from '../../js/maintain/uninstall.mjs';
import { registryRecord, registryRoots } from '../../js/inspect/registry.mjs';
import { GLOBAL_MANIFEST } from '../../js/hosts/hosts.mjs';
import { ROOT } from '../../js/build/source.mjs';
import {
  makeSandbox, homeOverrides, sandboxProcessHome, restoreProcessHome,
} from '../helpers/sandbox.mjs';

sandboxProcessHome();
test.after(() => { restoreProcessHome(); });

function withDir(fn) {
  const sb = makeSandbox('gs-retry-');
  try { return fn(sb.path); } finally { sb.cleanup(); }
}

function emit(kind, repo, home) {
  const r = spawnSync(process.execPath,
    [path.join(ROOT, 'bin', 'geneseed.mjs'), '--emit', kind, '--theme', 'neutral',
      '--out', repo, '--root', repo],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, ...homeOverrides(home) },
      maxBuffer: 1 << 26,
      windowsHide: true,
    });
  if (r.status !== 0) throw new Error(`${kind} emit (${r.status}): ${(r.stderr || '').slice(-1200)}`);
}

/**
 * Make one owned file refuse to be unlinked — WITHOUT it ceasing to be a file.
 *
 * THAT SECOND CLAUSE IS THE WHOLE DIFFICULTY, and the first draft of this fixture got it wrong
 * in a way worth recording. Replacing the file with a non-empty DIRECTORY does make `unlinkSync`
 * throw EPERM — but `unlinkOwned` guards every removal with `isFile(victim)`, deliberately, so a
 * manifest entry naming a directory is SKIPPED rather than attempted. Nothing failed, `failed`
 * stayed empty, the reversal considered itself complete and dropped the manifest — and the test
 * read that as a port defect. The reference, asked directly, keeps the manifest; the port does
 * too, once the obstacle is the one the reference actually simulates.
 *
 * So the file has to stay a file and still refuse. Measured on this platform, three of the
 * obvious mechanisms do NOT work: an open file handle (Node/libuv passes FILE_SHARE_DELETE),
 * the read-only attribute, and a read-only parent directory. What does:
 *
 *   * Windows — `icacls <file> /deny <user>:(D)`, released with `/remove:d`. EPERM.
 *   * POSIX  — a parent directory without write permission. EACCES.
 *
 * Returns a release function, or `null` when neither mechanism takes (running as root, an
 * exotic filesystem), so the caller can skip LOUDLY instead of testing an ordinary uninstall.
 */
function jam(p) {
  const win = process.platform === 'win32';
  const user = process.env.USERNAME || process.env.USER || '';
  let release;
  if (win) {
    const r = spawnSync('icacls', [p, '/deny', `${user}:(D)`], { encoding: 'utf8' });
    if (r.status !== 0) return null;
    release = () => { spawnSync('icacls', [p, '/remove:d', user], { encoding: 'utf8' }); };
  } else {
    const dir = path.dirname(p);
    const mode = fs.statSync(dir).mode;
    fs.chmodSync(dir, 0o555);
    release = () => { fs.chmodSync(dir, mode); };
  }
  // PROVE IT TOOK, here rather than at the call site: a jam that silently stopped jamming
  // turns every test below into an assertion about an ordinary, complete uninstall.
  let blocked = false;
  try { fs.unlinkSync(p); } catch { blocked = true; }
  if (!blocked || !fs.existsSync(p) || !fs.statSync(p).isFile()) {
    release();
    return null;
  }
  return release;
}

const JAM_SKIP = 'this platform cannot make a real file refuse to be unlinked';

function capturedErr(fn) {
  const errw = process.stderr.write.bind(process.stderr);
  const outw = process.stdout.write.bind(process.stdout);
  let err = '';
  let out = '';
  process.stderr.write = (c) => { err += c; return true; };
  process.stdout.write = (c) => { out += c; return true; };
  try { return [fn(), out, err]; } finally {
    process.stderr.write = errw;
    process.stdout.write = outw;
  }
}

test('a leftover owned path keeps the marker, warns, and the retry finishes the job', (t) => {
  withDir((d) => {
    const repo = path.join(d, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    emit('opencode', repo, path.join(d, 'home'));
    fs.writeFileSync(path.join(repo, '.geneseed-emit'), 'opencode\n', 'utf8');

    const stuck = path.join(repo, '.opencode', 'agents', 'reviewer.md');
    const release = jam(stuck);
    if (release === null) { t.skip(JAM_SKIP); return; }
    let summary;
    let err;
    try {
      [summary, , err] = capturedErr(() => installUninstall(repo, 'opencode', 'project', 'keep'));
    } finally {
      // Released here rather than in the assertions, so a failing assertion cannot leave the
      // sandbox un-cleanable.
      release();
    }

    assert.ok(JSON.stringify(summary).includes('incomplete'),
      `the summary did not report an incomplete removal: ${JSON.stringify(summary)}`);
    // THE THREE THINGS THAT MUST SURVIVE, because each is what the retry needs to find.
    assert.ok(fs.statSync(path.join(repo, '.geneseed-emit')).isFile(),
      'the root marker went with the failed removal — the install is now unfindable');
    assert.ok(fs.statSync(path.join(repo, '.opencode')).isDirectory());
    assert.ok(fs.statSync(path.join(repo, '.opencode', GLOBAL_MANIFEST)).isFile(),
      'the manifest went — installState would report absent and the retry would be refused');
    assert.ok(err.toLowerCase().includes('retried'),
      `the warning never told the user to retry:\n${err}`);

    // …and the retry the warning PROMISES actually completes the teardown now the obstacle is
    // gone. A warning that promised a retry which then bounced would be worse than silence.
    const [summary2] = capturedErr(
      () => installUninstall(repo, 'opencode', 'project', 'keep'));
    assert.ok(!JSON.stringify(summary2).includes('incomplete'),
      `the retry did not complete: ${JSON.stringify(summary2)}`);
    assert.ok(!fs.existsSync(path.join(repo, '.opencode')));
    assert.ok(!fs.existsSync(path.join(repo, '.geneseed-emit')));
  });
});

test('a claude partial uninstall keeps the manifest, and the retry completes', (t) => {
  // The claude/bob reversal must mirror the OpenCode survivors gate. `claudeState` keys on the
  // MANIFEST, so losing it to a stuck file reports "absent" — and the promised retry then
  // bounces off the uninstall's own gate, stranding agents/, the markers and the registry row
  // with no command left that will touch them.
  withDir((d) => {
    const repo = path.join(d, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    emit('claude', repo, path.join(d, 'home'));
    fs.writeFileSync(path.join(repo, '.geneseed-emit'), 'claude\n', 'utf8');
    const cfg = path.join(repo, '.claude');

    const release = jam(path.join(cfg, 'agents', 'reviewer.md'));
    if (release === null) { t.skip(JAM_SKIP); return; }
    let summary;
    try {
      [summary] = capturedErr(() => installUninstall(repo, 'claude', 'project', 'keep'));
    } finally {
      release();
    }
    assert.ok(JSON.stringify(summary).includes('incomplete'), JSON.stringify(summary));
    assert.ok(fs.statSync(path.join(cfg, GLOBAL_MANIFEST)).isFile(),
      'the manifest was removed despite an incomplete teardown');
    assert.ok(fs.statSync(path.join(repo, '.geneseed-emit')).isFile(),
      'the root marker was removed despite an incomplete teardown');

    const [summary2] = capturedErr(() => installUninstall(repo, 'claude', 'project', 'keep'));
    assert.ok(!JSON.stringify(summary2).includes('incomplete'), JSON.stringify(summary2));
    assert.ok(!fs.existsSync(path.join(cfg, GLOBAL_MANIFEST)));
    assert.ok(!fs.existsSync(path.join(cfg, 'agents')));
  });
});

test('an unobstructed uninstall reports no incompleteness', () => {
  // The control on both tests above: "reports incomplete" is only evidence if the same call
  // reports COMPLETE when nothing is in its way.
  withDir((d) => {
    const repo = path.join(d, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    emit('opencode', repo, path.join(d, 'home'));
    fs.writeFileSync(path.join(repo, '.geneseed-emit'), 'opencode\n', 'utf8');
    const [summary, , err] = capturedErr(
      () => installUninstall(repo, 'opencode', 'project', 'keep'));
    assert.ok(!JSON.stringify(summary).includes('incomplete'), JSON.stringify(summary));
    assert.ok(!err.toLowerCase().includes('retried'), err);
    assert.ok(!fs.existsSync(path.join(repo, '.geneseed-emit')));
  });
});

/** The resolved spelling, which is what the registry stores and compares. */
const resolved = (p) => fs.realpathSync.native(p);

/** Move this process's home for the test's duration, so the registry is its own. */
function withHome(dir, fn) {
  const vars = homeOverrides(dir);
  const saved = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('a locked file OUTSIDE agents/skills keeps the markers and the registry row', (t) => {
  // THE HOLE THIS CLOSED, and it is the sharpest test in the class. `ownedDirsFor` only
  // watches agents/ and skills/, so a locked owned file anywhere else — Bob's
  // `rules/geneseed.md` — used to slip the survivors gate completely: step 3 deleted the ROOT
  // markers the reversal had just promised were KEPT, the registry pruned the row while the
  // install was still half-alive, and the command printed "done" with no incomplete flag. The
  // user was then left with a broken install that nothing could find and no warning that
  // anything had gone wrong.
  //
  // The reversal's `failed` list is what closes it, which is why this must be driven through
  // `cmdUninstall` rather than the reversal alone: the bug lived in the step AFTER it.
  withDir((d) => {
    withHome(path.join(d, 'home'), () => {
      const repo = path.join(d, 'repo');
      fs.mkdirSync(repo, { recursive: true });
      emit('bob', repo, path.join(d, 'home'));
      fs.writeFileSync(path.join(repo, '.geneseed-emit'), 'bob\n', 'utf8');
      registryRecord(repo);
      const cfg = path.join(repo, '.bob');
      const stuck = path.join(cfg, 'rules', 'geneseed.md');
      assert.ok(fs.existsSync(stuck), 'the bob emit wrote no rules/geneseed.md to lock');

      const release = jam(stuck);
      if (release === null) { t.skip(JAM_SKIP); return; }
      let out;
      let err;
      try {
        let rc;
        [rc, out, err] = capturedErr(() => cmdUninstall({
          target: repo, yes: true, archiveMemory: false,
        }));
        assert.equal(rc, 0, err);
      } finally {
        release();
      }

      assert.ok(out.includes('INCOMPLETE'), `a half-removed install reported done:\n${out}`);
      assert.ok(fs.statSync(path.join(cfg, GLOBAL_MANIFEST)).isFile(), 'the manifest went');
      assert.ok(fs.statSync(path.join(repo, '.geneseed-emit')).isFile(), 'the root marker went');
      // THE REGISTRY ROW IS THE THIRD CASUALTY and the least visible: pruned, the install is
      // gone from `upgrade`'s list while its files are still on disk.
      assert.deepEqual(registryRoots().map((p) => resolved(p)), [resolved(repo)],
        'the registry pruned a row whose install is still half-present');
      // The reversal already warned twice; step 3 must not stack a third overlapping WARN.
      assert.ok(!err.includes('could not fully remove'),
        `a third overlapping warning was printed:\n${err}`);

      // Obstacle gone -> the promised retry completes the whole teardown, registry included.
      const [rc2] = capturedErr(() => cmdUninstall({
        target: repo, yes: true, archiveMemory: false,
      }));
      assert.equal(rc2, 0);
      assert.ok(!fs.existsSync(path.join(cfg, GLOBAL_MANIFEST)));
      assert.ok(!fs.existsSync(path.join(repo, '.geneseed-emit')));
      assert.deepEqual(registryRoots(), [], 'the row survived a completed uninstall');
    });
  });
});

test('the jam fixture blocks removal of a file that is STILL A FILE', (t) => {
  // THE FIXTURE'S OWN CONTROL, and it earned its place twice over. Three of the four
  // mechanisms measured for this file do not block unlink on Windows at all, and the one that
  // does by accident — replacing the file with a directory — is silently useless here,
  // because `unlinkOwned` skips a manifest entry that is not a file. Both halves are asserted:
  // the unlink refuses, AND the path is still a regular file when it does.
  withDir((d) => {
    const p = path.join(d, 'reviewer.md');
    fs.writeFileSync(p, 'x');
    const release = jam(p);
    if (release === null) { t.skip(JAM_SKIP); return; }
    try {
      assert.throws(() => fs.unlinkSync(p),
        'the jam fixture no longer blocks unlink on this platform');
      assert.ok(fs.statSync(p).isFile(),
        'the jam stopped the path being a file, which `unlinkOwned` skips rather than fails on');
    } finally {
      release();
    }
    fs.unlinkSync(p);   // releasing really releases
  });
});
