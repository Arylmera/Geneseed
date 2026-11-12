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

import {
  claudeHookGroups, mergeClaudeSettings, ownHandler, settingsIntegrityCheck, unwireClaudeSettings,
} from '../../js/hosts/settings.mjs';
import { hookRunnerEntry, hookShimPath } from '../../js/hosts/shim.mjs';
import { claudeUninstall } from '../../js/maintain/uninstall.mjs';
import { GLOBAL_MANIFEST } from '../../js/hosts/hosts.mjs';
import { ROOT } from '../../js/build/source.mjs';
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
    [path.join(ROOT, 'bin', 'build-driver.mjs'), '--emit', 'claude', '--theme', 'neutral',
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
      hooks: [{ type: 'command', command: '"somewhere/bin/geneseed-hook" learn' }],
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
      hooks: [{ type: 'command', command: '"x/bin/geneseed-hook" learn' }],
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

// ---------------------------------------------------------------------------------------------
// WHICH HANDLERS ARE GENESEED'S — the signature, and what the merge and the unwire do with it.
//
// THE RULE. A handler is this install's when its command names the hook shim, then a hook verb,
// and carries exactly `--root "<cfg>"` or `--memory "<cfg>/memory"`. Nothing else about it is
// compared: not the flags, not `--host`, not a field beside `command`. It was deep equality with
// what this build would emit, and that failed four ways, one row each below: other gate flags
// with no manifest stacked a second group; a group already on file was never claimed, so
// uninstall left it running; a user's `"timeout": 30` made our handler a stranger; and a
// non-array event value was overwritten.
//
// Rows are written for Bob: its canonical set is the smallest (four groups, one handler each),
// so a whole file fits in a row, and the merge does not read the host. In a row `@` is the
// quoted shim path, `~` the install dir and `~/memory` its memory dir, the three parts of a
// command that differ per machine; `sub` puts the real ones in.

const BOB = {
  SessionStart: [{ hooks: [{ type: 'command', command: '@ context --root "~" --host bob || exit 0' }] }],
  PreToolUse: [{ hooks: [{ type: 'command', command: '@ tool-gate --root "~" --host bob' }] }],
  Stop: [{ hooks: [{ type: 'command', command: '@ learn --memory "~/memory" --host bob || exit 0' }] }],
  UserPromptSubmit: [{ hooks: [{ type: 'command', command: '@ activity --root "~" --host bob || exit 0' }] }],
};
/** `BOB` with one event's groups replaced. */
const bobWith = (event, groups) => ({ ...BOB, [event]: groups });

// Each row: the file `before`; `after` the emit (default gates, NO prior manifest); and `gone`,
// the file after the unwire that uninstall runs, given the claims that emit returned.
// `after: 'same'` means the emit must not write at all.
const MERGE_ROWS = [
  {
    name: 'other gate flags, no manifest: the handler is replaced where it sits, one group',
    before: { hooks: bobWith('PreToolUse', [{ hooks: [
      { type: 'command', command: '@ tool-gate --root "~" --host bob --no-deletion-gate' }] }]) },
    after: { hooks: BOB },
    gone: {},
  },
  {
    name: 'identical groups, no manifest: nothing written, all four claimed, uninstall removes them',
    before: { model: 'opus', hooks: BOB },
    after: 'same',
    gone: { model: 'opus' },
  },
  {
    name: 'a field the user set on our handler stays, and no second group appears',
    before: { hooks: bobWith('PreToolUse', [{ hooks: [
      { type: 'command', command: '@ tool-gate --root "~" --host bob', timeout: 30 }] }]) },
    after: 'same',
    gone: {},
  },
  {
    name: 'the same handler with stale flags: replaced, timeout kept, a shell we no longer set dropped',
    before: { hooks: bobWith('PreToolUse', [{ hooks: [
      { type: 'command', command: '@ tool-gate --root "~" --host bob --no-secrets-gate', timeout: 30,
        shell: 'powershell', onFailure: 'block' }] }]) },
    after: { hooks: bobWith('PreToolUse', [{ hooks: [
      { type: 'command', command: '@ tool-gate --root "~" --host bob', timeout: 30 }] }]) },
    gone: {},
  },
  {
    name: "a user's hook inside our group is never touched, and survives uninstall",
    before: { hooks: bobWith('PreToolUse', [{ hooks: [
      { type: 'command', command: '@ tool-gate --root "~" --host bob' },
      { type: 'command', command: 'echo mine' }] }]) },
    after: 'same',
    gone: { hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } },
  },
  {
    name: "another root's group is another install's: ours is added beside it, theirs outlives ours",
    before: { hooks: { Stop: [{ hooks: [
      { type: 'command', command: '@ learn --memory "/elsewhere/memory" --host bob || exit 0' }] }] } },
    after: { hooks: bobWith('Stop', [
      { hooks: [{ type: 'command', command: '@ learn --memory "/elsewhere/memory" --host bob || exit 0' }] },
      BOB.Stop[0]]) },
    gone: { hooks: { Stop: [{ hooks: [
      { type: 'command', command: '@ learn --memory "/elsewhere/memory" --host bob || exit 0' }] }] } },
    // The check's one warning here: a hook naming our shim that this manifest did not record.
    warns: /Geneseed-pattern hook present but NOT recorded .*event='Stop'/,
  },
  {
    name: 'two copies of our handler (what the old merge left): the second goes',
    before: { hooks: bobWith('Stop', [BOB.Stop[0], { hooks: [
      { type: 'command', command: '@ learn --memory "~/memory" --host bob --no-done-gate || exit 0' }] }]) },
    after: { hooks: BOB },
    gone: {},
  },
  {
    name: 'our handler under an event this host no longer wires is removed',
    before: { hooks: { ...BOB, SubagentStop: [{ hooks: [
      { type: 'command', command: '@ learn --memory "~/memory" --host bob || exit 0' }] }] } },
    after: { hooks: BOB },
    gone: {},
  },
  {
    name: 'an event value that is not an array refuses the whole wire',
    before: { hooks: { Stop: {} } },
    after: 'same',
    refused: /"hooks\.Stop" is not an array in settings\.json — NOT rewriting it .*Hooks were not wired/,
  },
  {
    name: 'a hooks value that is not an object refuses the whole wire',
    before: { hooks: [] },
    after: 'same',
    refused: /"hooks" is not an object in settings\.json — NOT rewriting it .*Hooks were not wired/,
  },
];

function mergeFixture(d) {
  const cfg = path.join(d, 'dotbob');
  fs.mkdirSync(cfg, { recursive: true });
  const real = { '@': `"${hookShimPath()}"`, '~': cfg, '~/memory': path.join(cfg, 'memory') };
  const sub = (v) => (typeof v === 'string' ? v.replace(/~\/memory|~|@/g, (t) => real[t])
    : Array.isArray(v) ? v.map(sub)
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sub(x)]))
        : v);
  return { cfg, sub, p: path.join(cfg, 'settings.json') };
}

for (const row of MERGE_ROWS) {
  test(`hook merge: ${row.name}`, () => {
    withDir((d) => {
      const { cfg, sub, p } = mergeFixture(d);
      const seed = `${JSON.stringify(sub(row.before), null, 2)}\n`;
      fs.writeFileSync(p, seed, 'utf8');
      const [[, returned], err] = capturedErr(
        () => mergeClaudeSettings(p, null, hookRunnerEntry(), null, [], 'bob', cfg));
      // Through JSON, as the manifest stores them (the reader wraps a number it parsed).
      const claims = JSON.parse(JSON.stringify(returned));
      if (row.after === 'same') assert.equal(fs.readFileSync(p, 'utf8'), seed, 'the file was rewritten');
      else assert.deepEqual(readJson(p), sub(row.after));
      if (row.refused) {
        assert.match(err, row.refused);
        assert.deepEqual(claims, [], 'a refused wire claimed something');
        return;
      }
      assert.equal(err, '');
      // THE CLAIM IS THE GROUP AS IT SITS ON FILE: the four groups holding our handlers, in
      // canonical order, whatever else the user put in them.
      const onFile = readJson(p).hooks;
      assert.deepEqual(claims, Object.keys(BOB).map((event) => ({
        event, group: onFile[event].find((g) => g.hooks.some((h) => ownHandler(h, cfg))) })));
      // A second emit over its own output, now with its manifest, changes nothing.
      const settled = fs.readFileSync(p, 'utf8');
      const [, again] = mergeClaudeSettings(p, claims, hookRunnerEntry(), null, [], 'bob', cfg);
      assert.equal(fs.readFileSync(p, 'utf8'), settled, 'the second emit rewrote the file');
      assert.deepEqual(JSON.parse(JSON.stringify(again)), claims);
      // The check agrees with the merge: nothing recorded is missing.
      const [warnings] = capturedErr(() => settingsIntegrityCheck(p, { settings_hooks: claims }, 'present'));
      if (row.warns) assert.match(warnings.join('\n'), row.warns);
      else assert.deepEqual(warnings, []);
      assert.equal(warnings.length, row.warns ? 1 : 0);
      assert.equal(unwireClaudeSettings(p, claims, cfg), true);
      assert.deepEqual(readJson(p), sub(row.gone));
    });
  });
}

test('a field the user adds AFTER the emit raises no "missing", and uninstall still removes the handler', () => {
  // The claim was recorded before the user's edit, so the group no longer equals it. Both
  // readers go by the handler's command: the check sees it present, the unwire finds it by
  // signature. By group equality the check said "missing" and the handler outlived uninstall.
  withDir((d) => {
    const { cfg, sub, p } = mergeFixture(d);
    const [, claims] = mergeClaudeSettings(p, null, hookRunnerEntry(), null, [], 'bob', cfg);
    const edited = readJson(p);
    edited.hooks.PreToolUse[0].hooks[0].timeout = 30;
    edited.hooks.PreToolUse[0].hooks.push({ type: 'command', command: 'echo mine' });
    writeJson(p, edited);
    assert.deepEqual(settingsIntegrityCheck(p, { settings_hooks: claims }, 'present'), []);
    assert.equal(unwireClaudeSettings(p, claims, cfg), true);
    assert.deepEqual(readJson(p),
      sub({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } }));
    assert.deepEqual(settingsIntegrityCheck(p, { settings_hooks: claims }, 'absent'), []);
  });
});

test('a commented settings file is told the exact hooks to merge, not sent to a sample', () => {
  // The emit cannot rewrite a commented file, so it prints what it would have written. A sample
  // file cannot carry this machine's shim path, the install's root or the build's gate flags;
  // the one that shipped (`adapters/claude-code/settings.json`) had drifted and is gone.
  withDir((d) => {
    const { cfg, sub, p } = mergeFixture(d);
    const seed = '// mine\n{ "model": "opus" }\n';
    fs.writeFileSync(p, seed, 'utf8');
    const [[, claims], err] = capturedErr(
      () => mergeClaudeSettings(p, null, hookRunnerEntry(), null, [], 'bob', cfg));
    assert.equal(fs.readFileSync(p, 'utf8'), seed);
    assert.deepEqual(claims, []);
    assert.equal(err, '[geneseed] settings.json has comments — not rewriting it (your edits are '
      + `kept). Merge this into it by hand:\n${JSON.stringify(sub({ hooks: BOB }), null, 2)}\n`);
    assert.ok(!fs.existsSync(path.join(ROOT, 'adapters', 'claude-code', 'settings.json')));
  });
});

// `ownHandler`, one command per row, for the install at `~`. A yes needs all three parts; each
// no lacks exactly one, and says which.
const OWN_ROWS = [
  ['@ git-gate --root "~"', true, 'the emitted form'],
  ['@ learn --memory "~/memory" --host bob --no-done-gate || exit 0', true, 'learn names the install by --memory'],
  ['& @ context --root "~"; exit 0', true, 'the PowerShell form'],
  ['geneseed-hook rule-gate --no-secrets-gate --root "~"', true, 'hand-written, unquoted, flags first'],
  ['@ git-gate --root "~-old"', false, 'another root: the closing quote makes it exact'],
  ['@ learn --memory "~/memory/agents"', false, 'another memory dir'],
  ['@ bogus --root "~"', false, 'no hook verb'],
  ['@ --root "~"', false, 'no verb at all'],
  ['"/opt/other/bin/gate" git-gate --root "~"', false, 'not the shim'],
  ['@ git-gate', false, 'no root'],
];

test('ownHandler: the shim, a hook verb and this install\'s root, all three', () => {
  withDir((d) => {
    const { cfg, sub } = mergeFixture(d);
    for (const [command, want, why] of OWN_ROWS) {
      assert.equal(ownHandler({ type: 'command', command: sub(command) }, cfg), want, `${why}: ${command}`);
    }
    // PowerShell backtick-escapes `$` and a backtick inside the quoted path; read back undone.
    const odd = path.join(d, 'a$b`c');
    assert.equal(ownHandler({ command: `& "x/geneseed-hook.cmd" git-gate --root "${
      odd.replace(/[`$]/g, '`$&')}"` }, odd), true);
    for (const notOne of [null, 'x', {}, { command: 7 }]) assert.equal(ownHandler(notOne, cfg), false);
  });
});

test('every handler the emitter writes carries the signature, one to a group', () => {
  // The merge keys a slot on its group's single handler, and can only replace what `ownHandler`
  // recognises: a verb added to `claudeHookGroups` but not to the signature's verb list would be
  // appended again on every emit.
  withDir((d) => {
    const cfg = path.join(d, 'cfg');
    for (const host of ['claude', 'openclaude', 'bob']) {
      for (const platform of ['linux', 'win32']) {
        const groups = claudeHookGroups(cfg, { ...hookRunnerEntry(), platform }, null, [], host);
        for (const [event, gs] of Object.entries(groups)) {
          for (const g of gs) {
            assert.equal(g.hooks.length, 1, `${host} ${event}: a group with ${g.hooks.length} handlers`);
            assert.equal(ownHandler(g.hooks[0], cfg), true, `${host} ${event}: ${g.hooks[0].command}`);
          }
        }
      }
    }
  });
});
