// `--context-window 200k|1m` — the model context an install is built for, and the Claude Code
// skill-listing settings it writes (`CONTEXT_WINDOWS`, js/build/source.mjs, says why and why
// these values).
//
// Written out, not recorded. The properties this file holds:
//   1. the flag takes `200k` or `1m` only; `200k` is the default
//   2. a Claude Code emit writes the listing keys into the settings file it already merges:
//        200k -> skillListingMaxDescChars 80, skillListingBudgetFraction 0.013
//        1m   -> skillListingMaxDescChars 120, no fraction
//      and records exactly what it wrote in `managed.settings_listing`
//   3. ownership: a rebuild in another window updates or removes only the keys it owns (the
//      recorded value still on file); a key the user set, even to Geneseed's value, stays theirs,
//      unrecorded, and uninstall leaves it; a second pass writes nothing; a commented file is
//      never rewritten
//   4. OpenClaude, Bob and OpenCode write no listing key (neither reads one); every host records
//      the choice in the carrier marker, written only off the default
//   5. the marker reads back (`contextWindowOfDir`, `installProfile`), the rebuild argv keeps
//      `--context-window 1m` and elides the default, and the preserve guard refuses a bare
//      build that would drop 1m
//   6. profiles: `starter` ships 200k, `guillaume-claude-global` 1m; an apply passes the value,
//      `profile save` reads it back, and an unknown value is refused
// If a rule below is wrong, change the row AND the sentence above it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';

import { main as driverMain } from '../../js/build/driver.mjs';
import { installProfile, setupBuildArgs } from '../../js/build/generate.mjs';
import { CONTEXT_WINDOWS } from '../../js/build/source.mjs';
import { claudeConfigDir } from '../../js/hosts/hosts.mjs';
import { contextWindowOfDir } from '../../js/hosts/installs.mjs';
import { unwireClaudeListing, wireClaudeListing } from '../../js/hosts/settings.mjs';
import { claudeUninstall } from '../../js/maintain/uninstall.mjs';
import { targetContextWindow } from '../../js/maintain/setup.mjs';
import { apiDeployCmd } from '../../js/web/actions.mjs';
import {
  loadProfile, profileBuildArgs, profileDiff, profileFromInstall, profileProblems,
} from '../../js/maintain/profiles.mjs';
import { makeSandbox, restoreProcessHome, sandboxProcessHome } from '../helpers/sandbox.mjs';

// FIRST: every emit writes the hook shim and the registry into the environment's home.
sandboxProcessHome();
const sandboxes = [];
after(() => { for (const sb of sandboxes) sb.cleanup(); restoreProcessHome(); });
const sandbox = (prefix) => { const sb = makeSandbox(prefix); sandboxes.push(sb); return sb.path; };

function capture(fn) {
  const o = process.stdout.write; const e = process.stderr.write;
  let out = ''; let err = '';
  process.stdout.write = (s) => { out += String(s); return true; };
  process.stderr.write = (s) => { err += String(s); return true; };
  try { return { value: fn(), out, err }; } finally { process.stdout.write = o; process.stderr.write = e; }
}
const build = (...argv) => capture(() => driverMain(argv));
const readJson = (...p) => JSON.parse(fs.readFileSync(path.join(...p), 'utf8'));
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const KEYS = ['skillListingMaxDescChars', 'skillListingBudgetFraction'];
/** The listing keys a settings object holds, absent ones left out. */
const listing = (s) => Object.fromEntries(KEYS.filter((k) => Object.hasOwn(s, k)).map((k) => [k, s[k]]));
const W200K = { skillListingMaxDescChars: 80, skillListingBudgetFraction: 0.013 };
const W1M = { skillListingMaxDescChars: 120 };

/** A claude-global emit into its own config dir. */
function claudeGlobal(cfg, ...flags) {
  const r = build('--emit', 'claude-global', '--theme', 'neutral', '--config-dir', cfg, ...flags);
  assert.equal(r.value, 0, r.err);
  return r;
}

// ---- 1. the flag ------------------------------------------------------------------------------------

test('the flag takes 200k or 1m, and refuses anything else by name', () => {
  const r = build('--emit', 'claude', '--out', sandbox('gscw-bad-'), '--context-window', '128k');
  assert.equal(r.value, 2);
  assert.match(r.err, /argument --context-window: invalid choice: '128k' \(choose from '200k', '1m'\)/);
});

test('the two values are the table the docs state', () => {
  assert.deepEqual(Object.keys(CONTEXT_WINDOWS), ['200k', '1m']);
  assert.deepEqual({ ...CONTEXT_WINDOWS['200k'] }, W200K);
  assert.deepEqual({ ...CONTEXT_WINDOWS['1m'] }, W1M);
});

// ---- 2. what a Claude Code emit writes ---------------------------------------------------------------

test('a default claude-global emit writes the 200k keys and records them; no marker', () => {
  const cfg = sandbox('gscw-g-');
  claudeGlobal(cfg);
  assert.deepEqual(listing(readJson(cfg, 'settings.json')), W200K);
  assert.deepEqual(readJson(cfg, '.geneseed-manifest.json').managed.settings_listing, W200K);
  assert.doesNotMatch(read(cfg, 'CLAUDE.md'), /^Context window:/m);
});

test('a 1m claude-global emit writes 120 and no fraction, and marks the carrier', () => {
  const cfg = sandbox('gscw-g1m-');
  claudeGlobal(cfg, '--context-window', '1m');
  assert.deepEqual(listing(readJson(cfg, 'settings.json')), W1M);
  assert.deepEqual(readJson(cfg, '.geneseed-manifest.json').managed.settings_listing, W1M);
  assert.match(read(cfg, 'CLAUDE.md'), /^Context window: 1m$/m);
});

test('a claude project emit writes the keys into settings.local.json, the file it merges', () => {
  const d = sandbox('gscw-p-');
  assert.equal(build('--emit', 'claude', '--out', d, '--theme', 'neutral').value, 0);
  assert.deepEqual(listing(readJson(d, '.claude', 'settings.local.json')), W200K);
  assert.equal(fs.existsSync(path.join(d, '.claude', 'settings.json')), false);
});

// ---- 3. ownership ------------------------------------------------------------------------------------

test('200k -> 1m -> 200k moves the owned keys both ways; a second pass writes nothing', () => {
  const cfg = sandbox('gscw-sw-');
  claudeGlobal(cfg);
  claudeGlobal(cfg, '--context-window', '1m', '--reset');
  assert.deepEqual(listing(readJson(cfg, 'settings.json')), W1M, 'the fraction was not taken back');
  const before = read(cfg, 'settings.json');
  claudeGlobal(cfg, '--context-window', '1m');
  assert.equal(read(cfg, 'settings.json'), before, 'a second pass rewrote settings.json');
  claudeGlobal(cfg, '--reset');
  assert.deepEqual(listing(readJson(cfg, 'settings.json')), W200K);
});

test('a key the user changed by hand stays, leaves the record, and survives uninstall', () => {
  const cfg = sandbox('gscw-hand-');
  claudeGlobal(cfg);
  const s = readJson(cfg, 'settings.json');
  s.skillListingMaxDescChars = 200;
  fs.writeFileSync(path.join(cfg, 'settings.json'), JSON.stringify(s, null, 2));
  claudeGlobal(cfg, '--context-window', '1m', '--reset');
  assert.deepEqual(listing(readJson(cfg, 'settings.json')), { skillListingMaxDescChars: 200 });
  assert.deepEqual(readJson(cfg, '.geneseed-manifest.json').managed.settings_listing, undefined);
  capture(() => claudeUninstall(cfg, false));
  assert.deepEqual(listing(readJson(cfg, 'settings.json')), { skillListingMaxDescChars: 200 });
});

test("a value the user set before the install is theirs, even when it equals Geneseed's", () => {
  const cfg = sandbox('gscw-pre-');
  fs.writeFileSync(path.join(cfg, 'settings.json'), JSON.stringify({ skillListingMaxDescChars: 80 }));
  claudeGlobal(cfg);
  assert.deepEqual(readJson(cfg, '.geneseed-manifest.json').managed.settings_listing,
    { skillListingBudgetFraction: 0.013 });
  capture(() => claudeUninstall(cfg, false));
  assert.deepEqual(listing(readJson(cfg, 'settings.json')), { skillListingMaxDescChars: 80 });
});

test('uninstall removes exactly the keys the install wrote', () => {
  const cfg = sandbox('gscw-un-');
  claudeGlobal(cfg);
  capture(() => claudeUninstall(cfg, false));
  const p = path.join(cfg, 'settings.json');
  assert.deepEqual(fs.existsSync(p) ? listing(readJson(p)) : {}, {});
});

// The merge alone, on a file, row by row: [file before, recorded, want, file after, returned record].
const MERGE_ROWS = [
  ['absent keys are written', {}, {}, W200K, W200K, W200K],
  ['owned keys move to the new value; an owned key not wanted goes', W200K, W200K, W1M, W1M, W1M],
  ['a recorded key the user changed is theirs', { skillListingMaxDescChars: 99 }, W1M, W200K,
    { skillListingMaxDescChars: 99, skillListingBudgetFraction: 0.013 }, { skillListingBudgetFraction: 0.013 }],
  ['an unrecorded key equal to want is still theirs', { skillListingMaxDescChars: 120 }, {}, W1M,
    { skillListingMaxDescChars: 120 }, {}],
  ['want empty takes back only the owned keys', { ...W200K, other: 1 }, W200K, {}, { other: 1 }, {}],
];
for (const [name, before, recorded, want, afterKeys, record] of MERGE_ROWS) {
  test(`wireClaudeListing: ${name}`, () => {
    const p = path.join(sandbox('gscw-m-'), 'settings.json');
    fs.writeFileSync(p, JSON.stringify(before));
    assert.deepEqual(JSON.parse(JSON.stringify(wireClaudeListing(p, want, recorded))), record);
    const got = readJson(p);
    assert.deepEqual({ ...listing(got), ...(Object.hasOwn(got, 'other') ? { other: got.other } : {}) }, afterKeys);
  });
}

test('wireClaudeListing never rewrites a commented file, and says what to merge', () => {
  const p = path.join(sandbox('gscw-c-'), 'settings.json');
  const text = '{\n  // mine\n  "model": "x"\n}\n';
  fs.writeFileSync(p, text);
  const r = capture(() => wireClaudeListing(p, W200K, {}));
  assert.equal(fs.readFileSync(p, 'utf8'), text);
  assert.deepEqual(r.value, {});
  assert.match(r.err, /has comments — not rewriting it .*skillListingMaxDescChars/);
});

test('wireClaudeListing keeps the record when the file cannot be read, and writes nothing', () => {
  const p = path.join(sandbox('gscw-inv-'), 'settings.json');
  fs.writeFileSync(p, '{ not json');
  const r = capture(() => wireClaudeListing(p, W1M, W200K));
  assert.deepEqual(r.value, W200K);
  assert.equal(fs.readFileSync(p, 'utf8'), '{ not json');
});

test('the first build that writes the keys says so in one line; the next says nothing', () => {
  const cfg = sandbox('gscw-say-');
  const first = claudeGlobal(cfg);
  const said = first.out.split(/\r?\n/).filter((l) => l.startsWith('[geneseed] skill listing:'));
  assert.deepEqual(said, ['[geneseed] skill listing: wrote skillListingMaxDescChars 80, '
    + 'skillListingBudgetFraction 0.013 into settings.json for a 200k context window; '
    + 'on a 1M-token model, rebuild with --context-window 1m.']);
  assert.doesNotMatch(claudeGlobal(cfg).out, /skill listing:/);
});

test('unwireClaudeListing removes a recorded key only while it holds the recorded value', () => {
  const p = path.join(sandbox('gscw-u-'), 'settings.json');
  fs.writeFileSync(p, JSON.stringify({ skillListingMaxDescChars: 80, skillListingBudgetFraction: 0.02 }));
  unwireClaudeListing(p, W200K);
  assert.deepEqual(listing(readJson(p)), { skillListingBudgetFraction: 0.02 });
});

// ---- 4. the other hosts ------------------------------------------------------------------------------

for (const [emit, file] of [['openclaude', ['.openclaude', 'settings.local.json']], ['bob', ['.bob', 'settings.json']]]) {
  test(`${emit}: the flag is accepted, recorded in the carrier, and writes no listing key`, () => {
    const d = sandbox(`gscw-${emit}-`);
    assert.equal(build('--emit', emit, '--out', d, '--theme', 'neutral', '--context-window', '1m').value, 0);
    assert.deepEqual(listing(readJson(d, ...file)), {});
    assert.equal(contextWindowOfDir(d, emit), '1m');
  });
}

test('opencode: the flag is accepted and recorded, and the install writes no listing key', () => {
  const d = sandbox('gscw-oc-');
  assert.equal(build('--emit', 'opencode', '--out', d, '--theme', 'neutral', '--context-window', '1m').value, 0);
  assert.equal(contextWindowOfDir(d, 'opencode'), '1m');
  const oc = fs.readdirSync(d).filter((n) => n.startsWith('opencode.json'));
  for (const n of oc) assert.doesNotMatch(read(d, n), /skillListing/);
});

// ---- 5. read-back, rebuild, guard --------------------------------------------------------------------

test('1m reads back, the rebuild argv keeps it, and a replay changes nothing', () => {
  const d = sandbox('gscw-rt-');
  assert.equal(build('--emit', 'claude', '--out', d, '--theme', 'neutral', '--context-window', '1m').value, 0);
  const p = installProfile('claude', 'project', d);
  assert.equal(p.contextWindow, '1m');
  assert.deepEqual(p.argv.slice(-2), ['--context-window', '1m']);
  const before = [read(d, 'CLAUDE.md'), read(d, '.claude', 'settings.local.json')];
  assert.equal(build(...p.argv).value, 0);
  assert.deepEqual([read(d, 'CLAUDE.md'), read(d, '.claude', 'settings.local.json')], before);
});

test('a default install reads 200k and its argv names no flag', () => {
  const d = sandbox('gscw-def-');
  assert.equal(build('--emit', 'claude', '--out', d, '--theme', 'neutral').value, 0);
  assert.equal(contextWindowOfDir(d, 'claude'), '200k');
  assert.ok(!installProfile('claude', 'project', d).argv.includes('--context-window'));
});

test('an unknown marker value reads as the default, so a rebuild never refuses on it', () => {
  const d = sandbox('gscw-odd-');
  assert.equal(build('--emit', 'claude', '--out', d, '--theme', 'neutral', '--context-window', '1m').value, 0);
  fs.writeFileSync(path.join(d, 'CLAUDE.md'), read(d, 'CLAUDE.md').replace('Context window: 1m', 'Context window: 2m'));
  assert.equal(contextWindowOfDir(d, 'claude'), '200k');
});

test('the preserve guard refuses a bare build that would drop 1m, naming the change', () => {
  const d = sandbox('gscw-guard-');
  assert.equal(build('--emit', 'claude', '--out', d, '--theme', 'neutral', '--context-window', '1m').value, 0);
  const r = build('--emit', 'claude', '--out', d, '--theme', 'neutral');
  assert.equal(r.value, 1);
  assert.match(r.err, /context-window: 1m -> 200k/);
  assert.match(r.err, /--context-window 1m/);
});

test('setupBuildArgs spells --context-window last, and only off the default', () => {
  const base = ['neutral', 'claude', '/r', '/r', 'lean', 'peer', 'direct', null, ['craft'],
    null, undefined, null, {}, null, false];
  assert.ok(!setupBuildArgs(...base).includes('--context-window'));
  assert.ok(!setupBuildArgs(...base, '200k').includes('--context-window'));
  assert.deepEqual(setupBuildArgs(...base, '1m').slice(-2), ['--context-window', '1m']);
});

// ---- 6. profiles -------------------------------------------------------------------------------------

test('the shipped profiles: starter is 200k, guillaume-claude-global is 1m', () => {
  assert.equal(loadProfile('starter').profile.contextWindow, '200k');
  assert.equal(loadProfile('guillaume-claude-global').profile.contextWindow, '1m');
});

test('an apply passes the profile value; an absent key is the default', () => {
  const p = loadProfile('guillaume-claude-global').profile;
  assert.deepEqual(profileBuildArgs(p, 'claude').slice(-5, -3), ['--context-window', '1m']);
  const { contextWindow: _, ...noKey } = p;
  assert.ok(!profileBuildArgs(noKey, 'claude').includes('--context-window'));
});

test('profile save reads the value back, and the diff names it', () => {
  const cfg = sandbox('gscw-save-');
  claudeGlobal(cfg, '--context-window', '1m');
  const saved = profileFromInstall(installProfile('claude', 'global', cfg));
  assert.equal(saved.contextWindow, '1m');
  const starter = loadProfile('starter').profile;
  assert.deepEqual(profileDiff(saved, starter).find((d) => d.key === 'contextWindow'),
    { key: 'contextWindow', base: '200k', now: '1m' });
});

test('an unknown value in a profile is refused, naming the valid ones', () => {
  const p = { ...loadProfile('starter').profile, contextWindow: '128k' };
  assert.deepEqual(profileProblems(p), ["'contextWindow': invalid value '128k' (valid: '200k', '1m')"]);
});

// ---- 7. a project install beside the user level ------------------------------------------------------
// Project settings outrank `~/.claude/settings.json`, so a project emit must never undercut a key
// the user level sets, and a new project takes the machine's window. These tests use the sandboxed
// DEFAULT Claude dir (the user level) and empty it after each, so no other test sees it.

/** Run `fn` with the sandboxed user-level Claude dir, removed afterwards. */
function withUserLevel(fn) {
  const dir = claudeConfigDir();
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('a global 1m install: a new project with no flag is 1m and leaves the cap to the global file', () => {
  withUserLevel((dir) => {
    const r = build('--emit', 'claude-global', '--theme', 'neutral', '--context-window', '1m');
    assert.equal(r.value, 0, r.err);
    assert.deepEqual(listing(readJson(dir, 'settings.json')), W1M);
    const d = sandbox('gscw-under-');
    assert.equal(build('--emit', 'claude', '--out', d, '--theme', 'neutral').value, 0);
    assert.equal(contextWindowOfDir(d, 'claude'), '1m');
    assert.deepEqual(listing(readJson(d, '.claude', 'settings.local.json')), {});
  });
});

test('a hand-set user-level cap is not undercut; the project still writes the key the user left', () => {
  withUserLevel((dir) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ skillListingMaxDescChars: 300 }));
    const d = sandbox('gscw-hand-user-');
    assert.equal(build('--emit', 'claude', '--out', d, '--theme', 'neutral').value, 0);
    assert.equal(contextWindowOfDir(d, 'claude'), '200k');
    assert.deepEqual(listing(readJson(d, '.claude', 'settings.local.json')), { skillListingBudgetFraction: 0.013 });
    assert.deepEqual(readJson(dir, 'settings.json'), { skillListingMaxDescChars: 300 });
  });
});

// The replays on a 1m machine. Each passes `--reset` and resolves the window itself, and
// `setupBuildArgs` elides `200k`: the driver must read that silence as 200k, not as "take the
// machine's". Rows: [path, what it is given, the window the new project must get].
/** A machine whose global Claude Code install is built `1m`. */
const oneMachine = () => {
  const r = build('--emit', 'claude-global', '--theme', 'neutral', '--context-window', '1m');
  assert.equal(r.value, 0, r.err);
};

test('profile apply starter --project on a 1m machine builds 200k, and again 200k', () => {
  withUserLevel(() => {
    oneMachine();
    const d = sandbox('gscw-apply-');
    const starter = loadProfile('starter').profile;
    for (const pass of [1, 2]) {
      assert.equal(build(...profileBuildArgs(starter, 'claude', d)).value, 0);
      assert.equal(contextWindowOfDir(d, 'claude'), '200k', `apply #${pass}`);
    }
    assert.deepEqual(listing(readJson(d, '.claude', 'settings.local.json')), { skillListingBudgetFraction: 0.013 });
  });
});

for (const [said, want] of [['200k', '200k'], ['1m', '1m'], [undefined, '1m']]) {
  test(`the console deploy on a 1m machine, contextWindow ${said ?? 'not sent'} -> ${want}`, () => {
    withUserLevel(() => {
      oneMachine();
      const d = sandbox('gscw-deploy-');
      const plan = apiDeployCmd({ theme: 'neutral' },
        { host: 'claude', path: d, ...(said ? { contextWindow: said } : {}) });
      assert.ok(plan.cmd, JSON.stringify(plan));
      assert.equal(build(...plan.cmd.slice(2).map(String)).value, 0);
      assert.equal(contextWindowOfDir(d, 'claude'), want);
    });
  });
}

for (const [existing, want] of [[null, '1m'], ['200k', '200k']]) {
  test(`the wizard on a 1m machine, target ${existing ?? 'not installed'} -> ${want}`, () => {
    withUserLevel(() => {
      oneMachine();
      const d = sandbox('gscw-wiz-');
      if (existing) assert.equal(build('--emit', 'claude', '--out', d, '--theme', 'neutral', '--context-window', existing).value, 0);
      const cw = targetContextWindow('claude', d, '1m');
      assert.equal(cw, want);
      const argv = setupBuildArgs('neutral', 'claude', d, d, 'lean', 'peer', 'direct', null, undefined,
        null, undefined, null, {}, null, false, cw);
      assert.equal(build(...argv, '--reset').value, 0);
      assert.equal(contextWindowOfDir(d, 'claude'), want);
    });
  });
}

test('an existing 200k project keeps 200k when a global 1m install arrives later', () => {
  withUserLevel(() => {
    const d = sandbox('gscw-later-');
    assert.equal(build('--emit', 'claude', '--out', d, '--theme', 'neutral').value, 0);
    assert.equal(build('--emit', 'claude-global', '--theme', 'neutral', '--context-window', '1m').value, 0);
    assert.equal(build('--emit', 'claude', '--out', d, '--theme', 'neutral').value, 0);
    assert.equal(contextWindowOfDir(d, 'claude'), '200k');
  });
});
