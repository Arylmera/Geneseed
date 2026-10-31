// AN OPENCODE PROJECT INSTALL IS DEPLOYED, AND THE CONSOLE MUST SAY SO. That emit writes the plain
// bundle (AGENT.md, skills/, agents/, memory/…) at the repo root and its manifest one level down,
// at `<repo>/.opencode/.geneseed-manifest.json`. The console views the ROOT (`viewCfg`), so a
// check for `<root>/.geneseed-manifest.json` alone read every such install as "not deployed", and
// the inventory fell back to the SOURCE render: a skill the install left out was listed anyway.
//
// The rules this file pins, each written out below:
// - `deployed` is true, on the overview as everywhere else;
// - the inventory is what the install HAS: its specs read off the OpenCode layer the host loads,
//   `<repo>/.opencode/skills/<name>/SKILL.md` (the root bundle's `skills/` is flat `<name>.md`, the
//   plain-bundle shape), the excluded skill absent — while the source render does list it, so the
//   test cannot pass vacuously;
// - diff stays what it is for every project install: no drift check (`diffable: false`), and
//   restore refuses every file and touches none;
// - Build rebuilds the install in place: emit `opencode`, `--out` the repo, its exclusion kept;
// - a refresh does not jump the view to another install (`fallbackView` answers null);
// - the usage "never fired" list reads the same OpenCode layer: a deployed, unused skill is in
//   it, the excluded skill is not, and neither are the root bundle's `_template`-style files.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { deployed, inventoryFor } from '../../js/web/catalog.mjs';
import { apiDiff, apiOverview } from '../../js/web/api.mjs';
import { apiRestore, buildActionCmds } from '../../js/web/actions.mjs';
import { fallbackView, webState } from '../../js/web/state.mjs';
import { usageSummary } from '../../js/web/usage-api.mjs';
import { tuiInventory } from '../../js/inspect/inventory.mjs';
import { ROOT } from '../../js/build/source.mjs';
import {
  homeOverrides, makeSandbox, restoreProcessHome, sandboxProcessHome,
} from '../helpers/sandbox.mjs';

const EXCLUDED = 'quiz';

let home;
let sb;
let repo;
before(() => {
  home = sandboxProcessHome();
  sb = makeSandbox('gs-ocproj-');
  repo = path.join(sb.path, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'build-driver.mjs'),
    '--emit', 'opencode', '--theme', 'neutral', '--out', repo, '--root', repo,
    '--exclude-skills', EXCLUDED], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...homeOverrides(home) },
    maxBuffer: 1 << 26, windowsHide: true,
  });
  assert.equal(r.status, 0, (r.stderr || r.stdout || '').slice(-1200));
});
after(() => {
  sb.cleanup();
  restoreProcessHome();
});

/** The console's view of the repo, as `installView` builds it: target and root are the repo. */
const view = () => {
  const st = webState(null, repo);
  st.selectView(repo, repo);
  st.stampDoctor([]); // a verdict, so the overview does not pay a real doctor run
  return st;
};

test('the fixture is the layout the bug is about', () => {
  assert.ok(fs.existsSync(path.join(repo, '.opencode', '.geneseed-manifest.json')));
  assert.ok(!fs.existsSync(path.join(repo, '.geneseed-manifest.json')));
  assert.ok(fs.existsSync(path.join(repo, '.opencode', 'skills', 'brainstorm', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(repo, '.opencode', 'agents', 'architect.md')));
  assert.ok(!fs.existsSync(path.join(repo, '.opencode', 'skills', EXCLUDED)));
});

test('an OpenCode project install is deployed, on the overview too', () => {
  const st = view();
  assert.equal(deployed(st), true);
  assert.equal(apiOverview(st).deployed, true);
});

test('its inventory is the deployed skills, without the excluded one', () => {
  const st = view();
  // The source render lists the excluded skill: without that, "absent" proves nothing.
  assert.ok(tuiInventory(st.theme).skills.some((s) => s.name === EXCLUDED));
  const skills = inventoryFor(st).skills;
  const names = skills.map((s) => s.name);
  assert.ok(names.includes('brainstorm'), names.join(','));
  assert.ok(!names.includes(EXCLUDED), `${EXCLUDED} is listed but was not deployed`);
  // Read off the install, not rendered: every entry's file is in the OpenCode layer.
  const layer = path.join(fs.realpathSync.native(repo), '.opencode');
  for (const s of [...skills, ...inventoryFor(st).agents]) {
    assert.ok(fs.realpathSync.native(s.source).startsWith(layer), s.source);
  }
  assert.ok(inventoryFor(st).agents.some((a) => a.name === 'architect'));
});

test('diff offers no drift check, and restore refuses every file and touches none', () => {
  const st = view();
  const d = apiDiff(st);
  assert.deepEqual([d.deployed, d.diffable, d.files], [true, false, []]);
  const agentMd = path.join(repo, 'AGENT.md');
  const before = fs.readFileSync(agentMd, 'utf8');
  const r = apiRestore(st, ['AGENT.md']);
  assert.deepEqual([r.restored, r.deleted, r.errors],
    [[], [], ['AGENT.md: not a drifted file restore may touch']]);
  assert.equal(fs.readFileSync(agentMd, 'utf8'), before);
});

test('Build rebuilds it in place, its exclusion kept', () => {
  const plan = buildActionCmds(view(), {});
  assert.ok(Array.isArray(plan) && plan.length === 1, JSON.stringify(plan));
  const cmd = plan[0].map(String);
  const arg = (flag) => cmd[cmd.indexOf(flag) + 1];
  assert.equal(arg('--emit'), 'opencode');
  assert.equal(fs.realpathSync.native(arg('--out')), fs.realpathSync.native(repo));
  assert.equal(arg('--exclude-skills'), EXCLUDED);
});

test('a refresh keeps viewing it rather than falling back to another install', () => {
  // A second, ACTIVE install for it to fall back to — with none, null would prove nothing.
  const elsewhere = path.join(home, 'elsewhere');
  fs.mkdirSync(elsewhere, { recursive: true });
  fs.writeFileSync(path.join(elsewhere, '.geneseed-manifest.json'), JSON.stringify({ owned: [] }));
  const targets = [['opencode', 'global', elsewhere]];
  assert.notEqual(fallbackView(path.join(home, 'nothing-here'), targets), null);
  assert.equal(fallbackView(repo, targets), null);
});

test('the never-fired list reads the OpenCode layer, not the root bundle', () => {
  const { never } = usageSummary({ now: Date.parse('2026-10-31T12:00:00Z'),
    targets: [['opencode', 'project', repo]] });
  const has = (kind, name) => never.some((e) => e.kind === kind && e.name === name);
  assert.ok(has('skill', 'brainstorm'), JSON.stringify(never.slice(0, 5)));
  assert.ok(has('agent', 'architect'));
  assert.ok(!has('skill', EXCLUDED), `${EXCLUDED} was never deployed`);
  // The root bundle's `agents/` carries `_template.md`; the layer OpenCode loads does not.
  assert.ok(!has('agent', '_template'), 'the root bundle was read');
});
