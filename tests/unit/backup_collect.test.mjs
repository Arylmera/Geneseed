// What `geneseed backup` puts in the archive (js/maintain/backup.mjs `collectBackup`). One real
// sandboxed `claude-global` emit gives a real manifest and a seeded tier; the rows then add the
// user's own files and machine state, and state what must and must not travel. The tier never
// touched is the real one: every path below is under the sandbox home.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT } from '../../js/build/source.mjs';
import { homeOverrides, makeSandbox } from '../helpers/sandbox.mjs';

const ENV_KEYS = ['OPENCODE_CONFIG_DIR', 'BOB_CONFIG_DIR', 'OPENCLAUDE_CONFIG_DIR', 'CLAUDE_CONFIG_DIR',
  'GENESEED_MEMORY', 'GENESEED_HARNESS', 'GENESEED_WIKI'];

let sb; let home; let cfg; let tier; let saved; let mod; let profiles; let installs;

const put = (p, text) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };

before(async () => {
  sb = makeSandbox('bk-');
  home = sb.path;
  const env = { ...homeOverrides(home) };
  saved = Object.fromEntries([...Object.keys(env), ...ENV_KEYS].map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'build-driver.mjs'), '--emit', 'claude-global',
    '--theme', 'neutral', '--footprint', 'lean', '--out', path.join(home, 'bundle')],
  { cwd: ROOT, env: process.env, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  cfg = path.join(home, '.claude');
  tier = path.join(home, '.config', 'geneseed');
  // The user's own state in the tier.
  put(path.join(tier, 'memory', 'nas-ports.md'), '---\nname: nas-ports\n---\nport 8080\n');
  put(path.join(tier, 'notes', 'skill-notes', 'ship.md'), 'a lesson\n');
  put(path.join(tier, 'notebook', 'ledger.md'), 'scratch\n');
  put(path.join(tier, 'profiles', 'mine.json'), '{}\n');
  put(path.join(tier, 'bricks', 'b.md'), 'brick\n');
  put(path.join(tier, 'loops', 'l.md'), 'loop\n');
  put(path.join(tier, 'factories', 'f.md'), 'factory\n');
  put(path.join(tier, 'user-rules-retired.md'), '## R9 — old\n');
  // Machine state and another tool's file: must not travel.
  put(path.join(tier, 'cache', 'x'), 'x');
  put(path.join(tier, 'backups', 'y'), 'y');
  put(path.join(tier, 'installs.json'), '[]');
  put(path.join(tier, 'default-install.json'), '{}');
  put(path.join(tier, 'terra-memory-sync.json'), '{}');
  // The user's own skill and agent, a shipped-looking unowned skill, and a linked skill.
  put(path.join(cfg, 'skills', 'my-skill', 'SKILL.md'), '---\nname: my-skill\n---\nmine\n');
  put(path.join(cfg, 'skills', 'my-skill', 'refs', 'a.md'), 'side file\n');
  put(path.join(cfg, 'agents', 'my-agent.md'), '---\nname: my-agent\n---\nmine\n');
  fs.rmSync(path.join(cfg, 'skills', 'ship'), { recursive: true, force: true });
  put(path.join(cfg, 'skills', 'ship', 'SKILL.md'), '---\nname: ship\n---\nedited by the user\n');
  put(path.join(cfg, 'agents', 'tester.md'), '---\nname: tester\n---\nedited by the user\n');
  const linked = path.join(home, 'vault', 'nas');
  put(path.join(linked, 'SKILL.md'), '---\nname: nas\n---\n');
  fs.symlinkSync(linked, path.join(cfg, 'skills', 'nas'), 'junction');

  mod = await import('../../js/maintain/backup.mjs');
  ({ profileFromInstall: profiles } = await import('../../js/maintain/profiles.mjs'));
  ({ installProfile: installs } = await import('../../js/build/profile.mjs'));
});

after(() => {
  for (const [k, v] of Object.entries(saved ?? {})) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  sb?.cleanup();
});

const collect = () => mod.collectBackup({ targets: [['claude', 'global', cfg], ['claude', 'project', path.join(home, 'repo')]] });
const names = (b) => b.entries.map((e) => e.name);

// The allowlist reads its owners; adding a name to one of them adds it here. `root` and
// `defaultInstall` are the two `sharedPaths()` keys that never travel.
test('tier allowlist, both directions', async () => {
  const { sharedPaths } = await import('../../js/lib/machine-dir.mjs');
  const { USER_LOOP_DIRS } = await import('../../js/loop/catalog.mjs');
  const { RETIRED_RULES_FILE } = await import('../../js/build/rule-decide.mjs');
  const allowed = new Set(mod.TIER_IN.map((e) => e.name));
  const sp = sharedPaths();
  for (const [k, p] of Object.entries(sp)) {
    if (k === 'root' || k === 'defaultInstall') assert.ok(!allowed.has(path.relative(sp.root, p)), k);
    else assert.ok(allowed.has(path.relative(sp.root, p)), k);
  }
  for (const n of ['profiles', RETIRED_RULES_FILE, ...USER_LOOP_DIRS]) assert.ok(allowed.has(n), n);
  const b = collect();
  assert.deepEqual([...b.manifest.skipped].sort(),
    ['backups', 'cache', 'default-install.json', 'installs.json', 'terra-memory-sync.json']);
  for (const s of b.manifest.skipped) assert.ok(!names(b).some((n) => n === `tier/${s}` || n.startsWith(`tier/${s}/`)), s);
  for (const n of ['tier/memory/nas-ports.md', 'tier/notes/skill-notes/ship.md', 'tier/notebook/ledger.md',
    'tier/profiles/mine.json', 'tier/bricks/b.md', 'tier/loops/l.md', 'tier/factories/f.md',
    'tier/user-rules-retired.md', 'tier/user-rules.md', 'tier/PROFILE.md']) assert.ok(names(b).includes(n), n);
});

// A skill or agent no manifest owns was written by the user; an owned one is Geneseed's.
test('user skills and agents', () => {
  const n = names(collect());
  assert.ok(n.includes('skills/claude/my-skill/SKILL.md'));
  assert.ok(n.includes('skills/claude/my-skill/refs/a.md'));
  assert.ok(n.includes('agents/claude/my-agent.md'));
  assert.ok(!n.some((x) => x.startsWith('skills/claude/council/')), 'an owned skill stays out');
  assert.ok(!n.includes('agents/claude/reviewer.md'), 'an owned agent stays out');
});

// A linked skill belongs to wherever it points: named with its target, never copied.
test('links are listed, not copied', () => {
  const b = collect();
  assert.ok(!names(b).some((x) => x.startsWith('skills/claude/nas/')));
  assert.deepEqual(b.manifest.links, [{ host: 'claude', kind: 'skill', name: 'nas', target: path.join(home, 'vault', 'nas') }]);
});

// A shipped skill or agent the user edited in place (its hash no longer the recorded one) is
// carried, and named: a fresh install would write the shipped text over the edit, and dropping
// user work costs more than carrying shipped text. The restore's rebuild keeps it by claim-on-create.
test('ambiguous skill', () => {
  const b = collect();
  assert.ok(names(b).includes('skills/claude/ship/SKILL.md'));
  assert.ok(names(b).includes('agents/claude/tester.md'));
  assert.deepEqual(b.manifest.ambiguous, ['skills/claude/ship', 'agents/claude/tester.md']);
});

// A global install travels as the profile `profile apply` builds from; a project install is only named.
test('installs recorded as profiles', () => {
  const b = collect();
  assert.deepEqual(b.manifest.installs, [{ host: 'claude', profile: profiles(installs('claude', 'global', cfg)) }]);
  assert.deepEqual(b.manifest.projects, [{ host: 'claude', root: path.join(home, 'repo') }]);
});

// Each listed file carries the sha256 and size of the bytes in the archive.
test('sha256 and size', () => {
  const b = collect();
  const byName = new Map(b.entries.map((e) => [e.name, e.data]));
  assert.ok(b.manifest.files.length > 10);
  for (const f of b.manifest.files) {
    const data = byName.get(f.name);
    assert.equal(f.size, data.length, f.name);
    assert.equal(f.sha256, createHash('sha256').update(data).digest('hex'), f.name);
  }
  assert.equal(b.manifest.format, 1);
  assert.equal(b.manifest.home, home);
  assert.equal(b.manifest.tier, tier);
});
