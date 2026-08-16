// `tests/test_harness.py`'s `HookIntegrityCheckerTests` AND `tests/test_claude.py`'s
// `SettingsIntegrityCheckTests` — after any settings merge or unwire, does what the manifest
// CLAIMS still match what the settings file actually contains?
//
// Two Python rows, one subject: the second class was found to overlap this file almost entirely
// when its row came up, so its four remaining claims were added here rather than copied into a
// second file. They are grouped under their own heading below.
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

import { settingsIntegrityCheck, unwireClaudeSettings } from '../../js/settings.mjs';
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
    // FLAGGED IS NOT REMOVED, asserted of the CHECKER itself and not only of the uninstall
    // below. `tests/test_claude.py`'s version of this makes that its second half, and it is a
    // different claim: a checker that tidied away what it reported would be rewriting the
    // user's file to make its own bookkeeping true.
    assert.ok('PostToolUse' in (readJson(settingsPath).hooks ?? {}),
      'the integrity check deleted the entry it had just reported');
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

// ---------------------------------------------------------------------------------------------
// `tests/test_claude.py`'s `SettingsIntegrityCheckTests` — the four claims its version makes that
// `HookIntegrityCheckerTests` above does not.
//
// FIVE OF ITS SEVEN WERE ALREADY HERE, which is the finding rather than a coincidence: this file
// was written for a different Python row and the two classes overlap almost entirely. What was
// missing is the whole `absent`/missing-file half — every test above asks the checker about a
// file that EXISTS, and three of the four below are about the states it reaches when one does
// not, or when the unwire that was supposed to clean it up declined to run.

test('a clean uninstall leaves nothing for the absent check to report', () => {
  // THE CONTROL FOR THE OTHER DIRECTION, and the counterpart to the orphan test above. That one
  // proves `expect: absent` SPEAKS when something lingers; without this, a checker that
  // complained about every unwired install would satisfy it just as well. The manifest is read
  // BEFORE the uninstall on purpose — the uninstall deletes it, and the claims it recorded are
  // exactly what the settings file must no longer satisfy.
  withDir((d) => {
    const { cfg, managed, settingsPath } = claudeInstall(d);
    assert.ok((managed.settings_hooks ?? []).length > 0,
      'the install recorded no hooks, so "they are all gone" is vacuous');
    claudeUninstall(cfg, false);
    // The settings file is the USER'S and survives the uninstall; only the claims go.
    assert.ok(fs.existsSync(settingsPath), 'the uninstall deleted the user\'s settings file');
    assert.deepEqual(settingsIntegrityCheck(settingsPath, managed, 'absent'), []);
  });
});

test('a settings file that should exist and does not is flagged', () => {
  withDir((d) => {
    const managed = { settings_hooks: [{ event: 'Stop', group: { hooks: [] } }] };
    const missing = path.join(d, 'never-created', 'settings.json');   // the dir is absent too
    assert.ok(settingsIntegrityCheck(missing, managed, 'present').length > 0,
      'hooks were claimed to be wired into a file that is not there, and nothing said so');
  });
});

test('a settings file that should be gone and is missing entirely is clean', () => {
  // The same absence, the opposite expectation — and the pair is the point. A checker that
  // keyed on the file rather than on the EXPECTATION would be red here after every uninstall
  // that removed the file, which is the ordinary case.
  withDir((d) => {
    const managed = { settings_hooks: [{ event: 'Stop', group: { hooks: [] } }] };
    const missing = path.join(d, 'never-created', 'settings.json');
    assert.deepEqual(settingsIntegrityCheck(missing, managed, 'absent'), []);
  });
});

test('a commented settings file the unwire refused to touch is still checked', () => {
  // THE CASE WHERE TWO SILENCES WOULD COMPOUND. `unwireClaudeSettings` will not rewrite a file
  // carrying comments — it cannot preserve them through a JSON round trip, and dropping a
  // user's comments to remove a hook is not a trade it may make on its own. So it returns false
  // and the hooks LINGER after an uninstall. If the checker also went quiet on `hadComments`,
  // the install would report itself cleanly removed while still wired, which is precisely the
  // state the call sites claim to guard against.
  withDir((d) => {
    const cfg = path.join(d, 'dotclaude');
    fs.mkdirSync(cfg, { recursive: true });
    const sp = path.join(cfg, 'settings.json');
    const group = {
      hooks: [{ type: 'command', command: '"python" "x/rituals/harness.py" learn' }],
    };
    fs.writeFileSync(sp,
      `// my precious comments\n${JSON.stringify({ hooks: { Stop: [group] } }, null, 2)}`,
      'utf8');
    const managed = { settings_hooks: [{ event: 'Stop', group }] };

    // The unwire bails on the comments — and SAYS so through its return value, which is what
    // lets the caller know the removal did not happen.
    assert.equal(unwireClaudeSettings(sp, managed.settings_hooks), false);

    const [problems, err] = capturedErr(() => settingsIntegrityCheck(sp, managed, 'absent'));
    assert.ok(problems.some((w) => w.includes('still present')), JSON.stringify(problems));
    assert.ok(err.includes('WARN'), `the warning never reached stderr:\n${err}`);
    // READ-ONLY. The checker looked at the user's commented file and did not rewrite it either.
    assert.ok(fs.readFileSync(sp, 'utf8').includes('my precious comments'),
      'the integrity check rewrote the commented file the unwire had declined to touch');
  });
});
