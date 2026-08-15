// `tests/test_harness.py`'s `HookIntegrityCheckerTests` — after any settings merge or unwire,
// does what the manifest CLAIMS still match what the settings file actually contains?
//
// LOUD WARNING, NEVER AN AUTO-FIX, and that is the whole design rather than a limitation. The
// file is the user's: their own hooks live in it beside Geneseed's, and a checker that
// "repaired" a mismatch would be deleting hand-written configuration to make its own bookkeeping
// true. So every assertion below is about what it SAYS, and the last one is about what it must
// not do.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { settingsIntegrityCheck } from '../../js/settings.mjs';
import { claudeUninstall } from '../../js/uninstall.mjs';
import { GLOBAL_MANIFEST } from '../../js/hosts.mjs';
import { ROOT } from '../../js/checkout.mjs';
import {
  makeSandbox, homeOverrides, sandboxProcessHome, restoreProcessHome,
} from '../helpers/sandbox.mjs';

// `claudeUninstall` runs in process and reaches the emit path's shim writer.
sandboxProcessHome();
test.after(() => { restoreProcessHome(); });

function withDir(fn) {
  const sb = makeSandbox('gs-integ-');
  try { return fn(sb.path); } finally { sb.cleanup(); }
}

/** A real `.claude` project install, and the manifest's `managed` block that describes it. */
function claudeInstall(d) {
  const repo = path.join(d, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  const r = spawnSync(process.execPath,
    [path.join(ROOT, 'bin', 'geneseed.mjs'), '--emit', 'claude', '--theme', 'neutral',
      '--out', repo, '--root', repo],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, ...homeOverrides(path.join(d, 'home')) },
      maxBuffer: 1 << 26,
      windowsHide: true,
    });
  if (r.status !== 0) throw new Error(`claude emit (${r.status}): ${(r.stderr || '').slice(-1200)}`);
  const cfg = path.join(repo, '.claude');
  const managed = JSON.parse(fs.readFileSync(path.join(cfg, GLOBAL_MANIFEST), 'utf8')).managed;
  return { repo, cfg, managed, settingsPath: path.join(cfg, managed.settings_file) };
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJson = (p, v) => fs.writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`, 'utf8');

/** stderr only — the warning's whole job is to be loud on the stream a user notices. */
function capturedErr(fn) {
  const errw = process.stderr.write.bind(process.stderr);
  let err = '';
  process.stderr.write = (c) => { err += c; return true; };
  try { return [fn(), err]; } finally { process.stderr.write = errw; }
}

test('a clean emit raises no integrity warning', () => {
  // The control, and it has to come first: four tests below assert the checker SPEAKS, and
  // all of them are satisfied by a checker that complains about everything.
  withDir((d) => {
    const { managed, settingsPath } = claudeInstall(d);
    assert.deepEqual(settingsIntegrityCheck(settingsPath, managed, 'present'), []);
  });
});

test('a hand-stripped hook group is flagged missing, loudly', () => {
  withDir((d) => {
    const { managed, settingsPath } = claudeInstall(d);
    const settings = readJson(settingsPath);
    // Strip the PreToolUse (git-gate) group the manifest claims. This is what a user editing
    // their settings by hand really does, and the install then silently has no git gate.
    delete settings.hooks.PreToolUse;
    writeJson(settingsPath, settings);
    const [warnings, err] = capturedErr(
      () => settingsIntegrityCheck(settingsPath, managed, 'present'));
    assert.ok(warnings.some((w) => w.includes('missing') && w.includes('PreToolUse')),
      JSON.stringify(warnings));
    assert.ok(err.includes('WARN'), `the warning never reached stderr:\n${err}`);
  });
});

test('a Geneseed-shaped entry the manifest never claimed is flagged', () => {
  withDir((d) => {
    const { managed, settingsPath } = claudeInstall(d);
    const settings = readJson(settingsPath);
    settings.hooks.PostToolUse = [{
      matcher: 'Bash',
      hooks: [{ type: 'command', command: '"python" "somewhere/rituals/harness.py" learn' }],
    }];
    writeJson(settingsPath, settings);
    const warnings = settingsIntegrityCheck(settingsPath, managed, 'present');
    assert.ok(warnings.some((w) => w.includes('NOT recorded')), JSON.stringify(warnings));
  });
});

test("a user's own hook is never flagged as an orphan", () => {
  // THE ASSERTION THAT KEEPS THE CHECKER USABLE. A checker that flagged every hook it did not
  // write would fire on every developer who has ever added one, and would be silenced within
  // a week — after which the real orphans go unreported too.
  withDir((d) => {
    const settingsPath = path.join(d, 'settings.json');
    writeJson(settingsPath, {
      hooks: {
        PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }],
      },
    });
    assert.deepEqual(settingsIntegrityCheck(settingsPath, {}, 'present'), []);
  });
});

test('an orphan survives the unwire and is flagged afterwards, never removed', () => {
  // The pattern the claude uninstall follows: the unwire removes only the groups the manifest
  // RECORDED, so an orphan is still there afterwards and an `expect: absent` check is what
  // reports it. Both halves matter — flagged, AND still on disk.
  withDir((d) => {
    const { cfg, managed, settingsPath } = claudeInstall(d);
    const settings = readJson(settingsPath);
    settings.hooks.PostToolUse = [{
      hooks: [{ type: 'command', command: '"python" "x/rituals/harness.py" learn' }],
    }];
    writeJson(settingsPath, settings);

    claudeUninstall(cfg, false);

    const warnings = settingsIntegrityCheck(settingsPath, managed, 'absent');
    assert.ok(warnings.some((w) => w.includes('NOT recorded')), JSON.stringify(warnings));
    // NEVER AUTO-REMOVED. The uninstall walked past a hook it did not write and left it
    // alone, which is the only safe answer when the file belongs to somebody else.
    const survivor = readJson(settingsPath);
    assert.ok('PostToolUse' in (survivor.hooks ?? {}),
      'the uninstall deleted a hook group Geneseed never recorded');
  });
});
