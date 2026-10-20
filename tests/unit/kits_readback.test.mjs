// Kits read back off a deployed install — the marker, the replay, the warning and status.
//
// Written out, not recorded. The properties this file holds:
//   1. round trip: a build `--kits fx` writes `Active kits: fx`, `installProfile` reads `['fx']`
//      back and its rebuild argv ends `--kits fx`
//   2. B3: a plain build without `--kits` over that install prints, once per kit it drops,
//      `[geneseed] WARN: this install has kit fx; this build turns it off — pass --kits fx to keep it`
//      on stderr, and a build that keeps the kit prints no such line
//   3. R2: a marker naming a retired kit (`none`) or one this checkout does not ship (`ghost`)
//      reads back as no kits, with one notice per dropped name, and the replayed argv rebuilds
//      with exit 0 — never the `--kits` refusal (exit 2) that would fail `rebuild-all`
//   4. `status` shows `kits: a,b` in an install's row only when it has kits
//   5. B3 on a GLOBAL target (`claude-global --config-dir`): the same one line, read off the
//      config dir rather than `--out`, and none when `--kits fx` keeps the kit
//   6. R6: kit on, a member edited, kit turned off: the edited file is kept (pruneOwned) and
//      `status` names it — `keptKitFiles: { fx: ['agents/fx-agent.md'] }` in `--json` and the
//      row `kept from inactive kit fx: agents/fx-agent.md`; the unedited members are gone and
//      named nowhere. An install with nothing kept carries no such key and no such row
// The shipped tree has no kit, so 1 and 2 run in a private checkout with the fixture kit `fx`
// planted (the `kits_render.test.mjs` plant), its modules imported from there so their ROOT is it.
// If a rule below is wrong, change the row AND the sentence above it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { main as driverMain } from '../../js/build/driver.mjs';
import { installProfile } from '../../js/build/generate.mjs';
import { statusLines } from '../../js/inspect/status.mjs';
import { copyCheckout } from '../helpers/cli_golden.mjs';
import { makeSandbox, restoreProcessHome, sandboxProcessHome } from '../helpers/sandbox.mjs';

// FIRST: a per-repo replay writes the hook shim and the registry into the environment's home.
sandboxProcessHome();
const sandboxes = [];
after(() => { for (const sb of sandboxes) sb.cleanup(); restoreProcessHome(); });

function sandbox(prefix) {
  const sb = makeSandbox(prefix);
  sandboxes.push(sb);
  return sb.path;
}

/** Runs `fn`, returning its value and everything it wrote to stderr; stdout is swallowed. */
function capture(fn) {
  const o = process.stdout.write; const e = process.stderr.write;
  let err = '';
  process.stdout.write = () => true;
  process.stderr.write = (s) => { err += String(s); return true; };
  try { return { value: fn(), err }; } finally { process.stdout.write = o; process.stderr.write = e; }
}

const SKILL_ROW = '| [fx-skill]({{DIR_SKILLS}}/fx-skill.md) | the fixture kit skill is wanted |';
const AGENT_ROW = '| [fx-agent]({{DIR_AGENTS}}/fx-agent.md) | the fixture kit agent is wanted |';
const FX = {
  'src/kits/fx.json': JSON.stringify({
    description: 'Fixture kit', skills: ['fx-skill'], agents: ['fx-agent'], rules: 'kits/fx/rules.md',
    rulesWordBudget: 300, catalogue: { skills: [SKILL_ROW], agents: [AGENT_ROW] },
  }),
  'src/kits/fx/rules.md': '### Fixture kit\n\nKit rule: read {{DIR_SKILLS}}/fx-skill.md first.\n',
  'src/skills/fx-skill.md': '# {{SKILL}}: fx-skill\n\n> The fixture kit skill.\n',
  'src/agents/fx-agent.md': '# {{AGENT}}: fx-agent\n\n> The fixture kit agent.\n\n## When to dispatch\n- never\n',
};

const co = path.join(sandbox('gskits-co-'), 'checkout');
copyCheckout(co, FX);
const at = (rel) => pathToFileURL(path.join(co, rel)).href;
const fxDriver = await import(at('js/build/driver.mjs'));
const fxGenerate = await import(at('js/build/generate.mjs'));
const fxStatus = await import(at('js/inspect/status.mjs'));

const WARN = '[geneseed] WARN: this install has kit fx; this build turns it off — pass --kits fx to keep it';

test('round trip: a build with --kits fx reads back as fx, and the rebuild argv keeps it', () => {
  const d = sandbox('gskits-rt-');
  assert.equal(capture(() => fxDriver.main(['--emit', 'files', '--out', d, '--kits', 'fx'])).value, 0);
  assert.match(fs.readFileSync(path.join(d, 'AGENT.md'), 'utf8'), /^Active kits: fx$/m);
  const p = fxGenerate.installProfile('opencode', 'project', d);
  assert.deepEqual(p.kits, ['fx']);
  assert.deepEqual(p.argv.slice(-2), ['--kits', 'fx']);
});

test('B3: a build without --kits over a kit install warns, once, in the exact words', () => {
  const d = sandbox('gskits-warn-');
  capture(() => fxDriver.main(['--emit', 'files', '--out', d, '--kits', 'fx']));
  const keep = capture(() => fxDriver.main(['--emit', 'files', '--out', d, '--kits', 'fx']));
  assert.equal(keep.value, 0);
  assert.ok(!keep.err.includes('WARN: this install has kit'), keep.err);
  const drop = capture(() => fxDriver.main(['--emit', 'files', '--out', d]));
  assert.equal(drop.value, 0);
  assert.deepEqual(drop.err.split(/\r?\n/).filter((l) => l.includes('WARN: this install has kit')), [WARN]);
  // The kit is off now (B3: the build does what its flags say), so a second plain build is quiet.
  const again = capture(() => fxDriver.main(['--emit', 'files', '--out', d]));
  assert.ok(!again.err.includes('WARN: this install has kit'), again.err);
});

test('R2: a retired or unshipped kit in the marker is dropped with a notice, and the replay builds', () => {
  const d = sandbox('gskits-r2-');
  assert.equal(capture(() => driverMain(['--emit', 'opencode', '--out', d, '--root', d])).value, 0);
  const carrier = path.join(d, 'AGENT.md');
  fs.appendFileSync(carrier, '\nActive kits: none, ghost\n');
  const notices = [];
  const p = installProfile('opencode', 'project', d, (n) => notices.push(n));
  assert.deepEqual(p.kits, []);
  assert.ok(!p.argv.includes('--kits'), p.argv.join(' '));
  assert.deepEqual(notices, [
    "kit 'ghost' is not shipped by this Geneseed — dropped",
    "kit 'none' was retired (reserved: --kits none switches every kit off) — dropped",
  ]);
  const replay = capture(() => driverMain(p.argv));
  assert.equal(replay.value, 0, replay.err);
  assert.ok(!replay.err.includes('WARN: this install has kit'), replay.err);
});

test('status shows kits in an install row only when it has some', () => {
  const base = {
    version_verdict: 'up to date', theme: 'neutral', accent: 'x', emit: 'claude-global', agents: 1,
    skills: 1, laws: 1, memory_dir: null, facts: 0, installed_fp: 'a', source_fp: 'a',
  };
  const row = { host: 'claude', scope: 'global', root: 'r', state: 'ok', theme: 'neutral',
    footprint: 'full', posture: 'peer', mode: 'direct', trust: 't', doctrines: ['craft'] };
  const withKits = statusLines({ ...base, installs: [{ ...row, kits: ['fx', 'gx'] }] }).join('\n');
  assert.match(withKits, /kits: fx,gx/);
  const without = statusLines({ ...base, installs: [{ ...row, kits: [] }] }).join('\n');
  assert.ok(!without.includes('kits:'), without);
});

test('B3 on a global target: claude-global --config-dir warns once, and not with --kits', () => {
  const cfgDir = sandbox('gskits-gwarn-');
  const build = (...extra) => capture(() => fxDriver.main(['--emit', 'claude-global', '--config-dir', cfgDir, ...extra]));
  assert.equal(build('--kits', 'fx').value, 0);
  const keep = build('--kits', 'fx');
  assert.equal(keep.value, 0);
  assert.ok(!keep.err.includes('WARN: this install has kit'), keep.err);
  const drop = build();
  assert.equal(drop.value, 0);
  assert.deepEqual(drop.err.split(/\r?\n/).filter((l) => l.includes('WARN: this install has kit')), [WARN]);
});

test('R6: an edited member of a kit turned off is kept, and status names it', () => {
  // The default Claude config dir under the sandboxed home, so `installTargets` finds the row.
  const claudeDir = path.join(process.env.HOME ?? process.env.USERPROFILE, '.claude');
  const build = (...extra) => capture(() => fxDriver.main(['--emit', 'claude-global', ...extra]));
  assert.equal(build('--kits', 'fx').value, 0);
  const row = () => fxStatus.statusData().installs.find((p) => p.host === 'claude' && p.scope === 'global');
  assert.ok(!('keptKitFiles' in row()), 'a kit that is on keeps nothing');
  const agent = path.join(claudeDir, 'agents', 'fx-agent.md');
  fs.appendFileSync(agent, '\nmy own note\n');
  const off = build();
  assert.equal(off.value, 0);
  assert.ok(fs.existsSync(agent), 'the edited member was deleted');
  assert.ok(!fs.existsSync(path.join(claudeDir, 'skills', 'fx-skill')), 'an unedited member was kept');
  const p = row();
  assert.deepEqual(p.keptKitFiles, { fx: ['agents/fx-agent.md'] });
  const text = fxStatus.statusLines({
    version_verdict: 'up to date', theme: 'neutral', accent: 'x', emit: 'claude-global', agents: 1,
    skills: 1, laws: 1, memory_dir: null, facts: 0, installed_fp: 'a', source_fp: 'a', installs: [p],
  }).join('\n');
  assert.match(text, /kept from inactive kit fx: agents\/fx-agent\.md/);
});

test('a kit manifest that does not parse degrades status and the wizard to one warning line, not a stack trace', async () => {
  const bad = path.join(sandbox('gskits-bad-'), 'checkout');
  copyCheckout(bad, { 'src/kits/fx.json': '{ nope' });
  const atBad = (rel) => pathToFileURL(path.join(bad, rel)).href;
  const { keptKitFiles } = await import(atBad('js/inspect/status.mjs'));
  const { askKits } = await import(atBad('js/maintain/setup.mjs'));
  const kept = capture(() => keptKitFiles('claude', 'global', sandbox('gskits-root-'), []));
  assert.equal(kept.value, null);
  assert.match(kept.err, /^warning: kit rows skipped — src\/kits\/fx\.json: .*\n$/);
  const asked = capture(() => askKits(null));
  assert.equal(asked.value, null);
  assert.match(asked.err, /^warning: kit question skipped — src\/kits\/fx\.json: .*\n$/);
});

test('a broken kit manifest does not crash installedDefaults for a machine whose install has the kit on', async () => {
  const bad = path.join(sandbox('gskits-badinst-'), 'checkout');
  copyCheckout(bad, { 'src/kits/fx.json': '{ nope' });
  const { installedDefaults } = await import(pathToFileURL(path.join(bad, 'js/hosts/installs.mjs')).href);
  const work = sandbox('gskits-badcwd-');
  fs.mkdirSync(path.join(work, 'Harness'));
  fs.writeFileSync(path.join(work, 'Harness', 'AGENT.md'), 'Active kits: fx\n');
  const was = process.cwd();
  process.chdir(work);
  try { assert.deepEqual(installedDefaults().kits, []); } finally { process.chdir(was); }
});
