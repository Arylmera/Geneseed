// The project half of a backup: what Geneseed keeps inside a project that git does not carry — its
// memory, notebook, rules and profile — found by scanning the folders the user names. The projects
// here are real git repositories, because "git does not track it" is read off the index git wrote.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT } from '../../js/build/source.mjs';
import { trackedFiles } from '../../js/hosts/gitref.mjs';
import { cmdRestore, collectBackup } from '../../js/maintain/backup.mjs';
import { HOSTS } from '../../js/hosts/hosts.mjs';
import { writeZip } from '../../js/lib/zip.mjs';
import { homeOverrides, makeSandbox } from '../helpers/sandbox.mjs';

const ENV_KEYS = ['OPENCODE_CONFIG_DIR', 'BOB_CONFIG_DIR', 'OPENCLAUDE_CONFIG_DIR', 'CLAUDE_CONFIG_DIR',
  'GENESEED_MEMORY', 'GENESEED_HARNESS', 'GENESEED_WIKI'];
const put = (p, text) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const read = (p) => fs.readFileSync(p, 'utf8');

function envOf(home) {
  const env = { ...process.env, ...homeOverrides(home) };
  for (const k of ENV_KEYS) delete env[k];
  return env;
}
function inHome(home, fn) {
  const env = homeOverrides(home);
  const saved = Object.fromEntries([...Object.keys(env), ...ENV_KEYS].map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
function captured(fn) {
  const out = [];
  const [o, e] = [process.stdout.write, process.stderr.write];
  process.stdout.write = (s) => { out.push(String(s)); return true; };
  process.stderr.write = (s) => { out.push(String(s)); return true; };
  try { return { rc: fn(), out: out.join('') }; } finally { process.stdout.write = o; process.stderr.write = e; }
}
let sb; let a; let git;
const g = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, env: envOf(a), encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
};

before(() => {
  sb = makeSandbox('bp-');
  a = path.join(sb.path, 'a'); git = path.join(a, 'git');
  // A repository whose notebook Geneseed wrote: one file tracked, the rest personal.
  const api = path.join(git, 'team', 'api');
  put(path.join(api, 'notebook', 'skill-notes', 'ship.md'), 'lesson\n');
  put(path.join(api, 'notebook', 'mine.md'), 'mine\n');
  put(path.join(api, 'notebook', 'shared.md'), 'tracked\n');
  put(path.join(api, 'notebook', 'archive', 'old.md'), 'old\n');
  put(path.join(api, 'notebook', 'gates.jsonl'), '{}\n');
  put(path.join(api, 'user-rules.md'), '## R1 — project rule\nBody.\n');
  put(path.join(api, '.claude', 'agent-memory', 'x', 'm.md'), 'agent memory\n');
  put(path.join(api, 'src', 'a.js'), 'code\n');
  g(api, 'init', '-q'); g(api, 'add', '-f', 'notebook/shared.md', 'src/a.js');
  // Another tool's `notebook/` and `memory/`: nothing in them is Geneseed's.
  const lab = path.join(git, 'lab');
  put(path.join(lab, 'notebook', 'train.ipynb'), '{}');
  put(path.join(lab, 'memory', 'dump.bin'), 'x');
  put(path.join(lab, 'PROFILE.md'), 'an org profile\n');
  g(lab, 'init', '-q');
  // A project the global harness works in (`.geneseed/`), whose notebook holds only free notes.
  const cog = path.join(git, 'cog');
  put(path.join(cog, '.geneseed', 'ownership.md'), 'x\n');
  put(path.join(cog, 'notebook', 'strip.html'), 'free note\n');
  g(cog, 'init', '-q');
  // The same folder name twice: their entries must not collide in the archive.
  put(path.join(git, 'other', 'API', 'notebook', 'agent-notes', 'x.md'), 'other api\n');
  // A linked worktree: its `.git` is a file, and its tracked notebook is still git's.
  g(api, 'commit', '-qm', 'x'); g(api, 'worktree', 'add', '-q', '-f', path.join(git, 'api-wt'));
  // A vault's own `Memory/`, spelled its way: not the `memory/` Geneseed keeps.
  put(path.join(git, 'vault', 'Memory', 'MEMORY.md'), 'vault\n');
  // A dependency's folders are never walked.
  put(path.join(git, 'cog', 'node_modules', 'dep', 'notebook', 'skill-notes', 'x.md'), 'no\n');
  // A bundle outside git, as `geneseed build --out` leaves one.
  const bundle = path.join(git, 'bundle');
  put(path.join(bundle, '.geneseed-emit'), 'files\n');
  put(path.join(bundle, 'memory', 'fact.md'), '---\nname: fact\n---\nf\n');
  put(path.join(bundle, 'PROFILE.md'), '# me\n');
});
after(() => sb?.cleanup());

const collect = (projects = [git]) => inHome(a, () => collectBackup({ targets: [], projects }));
const own = (b) => Object.fromEntries(b.manifest.stores.map((s) => [path.basename(s.root),
  b.entries.map((e) => e.name).filter((n) => n.startsWith(`projects/${s.id}/`)).map((n) => n.slice(`projects/${s.id}/`.length)).sort()]));

// Index versions 2, 3 (an intent-to-add entry sets the extended flag) and 4 (names share a prefix; the
// long name makes the next entry drop more than 127 bytes, a two-byte count).
test('trackedFiles reads what git tracks, in every index version', () => {
  const repo = path.join(sb.path, 'idx');
  const names = ['a.txt', 'dir/long-name-one.txt', 'dir/long-name-two.txt', 'dir/é.txt', `e/${'a'.repeat(75)}/${'b'.repeat(75)}`, 'z'];
  for (const n of names) put(path.join(repo, n), n);
  put(path.join(repo, 'untracked.txt'), 'u');
  g(repo, 'init', '-q'); g(repo, 'add', ...names);
  for (const v of ['2', '4', '2']) {
    g(repo, 'update-index', '--index-version', v);
    assert.deepEqual([...trackedFiles(repo)].sort(), [...names].sort(), `version ${v}`);
  }
  put(path.join(repo, 'later.txt'), 'l'); g(repo, 'add', '-N', 'later.txt');
  assert.equal(fs.readFileSync(path.join(repo, '.git', 'index')).readUInt32BE(4), 3, 'the control: this is version 3');
  assert.deepEqual([...trackedFiles(repo)].sort(), [...names, 'later.txt'].sort());
  assert.equal(trackedFiles(path.join(sb.path, 'nowhere')), null);
  fs.mkdirSync(path.join(sb.path, 'fresh')); g(path.join(sb.path, 'fresh'), 'init', '-q');
  assert.deepEqual([...trackedFiles(path.join(sb.path, 'fresh'))], [], 'a repository with no index yet tracks nothing');
  const wt = path.join(sb.path, 'idx-wt');
  g(repo, 'commit', '-qm', 'x'); g(repo, 'worktree', 'add', '-q', wt);
  assert.ok(trackedFiles(wt).has('dir/long-name-one.txt'), 'a linked worktree reads its own index');
  // SHA-256 repositories hold 32-byte ids.
  const s256 = path.join(sb.path, 's256');
  put(path.join(s256, 'one'), '1'); put(path.join(s256, 'two'), '2');
  g(s256, 'init', '-q', '--object-format=sha256'); g(s256, 'add', '.');
  assert.deepEqual([...trackedFiles(s256)].sort(), ['one', 'two']);
});

// What git carries is left to git, and another tool's folders are not Geneseed's to take.
test('only what Geneseed keeps and git does not carry travels', () => {
  const b = collect();
  assert.deepEqual(own(b), {
    api: ['.claude/agent-memory/x/m.md', 'notebook/mine.md', 'notebook/skill-notes/ship.md', 'user-rules.md'],
    bundle: ['PROFILE.md', 'memory/fact.md'],
    cog: ['notebook/strip.html'],
    API: ['notebook/agent-notes/x.md'],
  });
  assert.deepEqual(b.manifest.hostSkipped.sort(), [`${path.join(git, 'team', 'api')} notebook/archive`,
    `${path.join(git, 'team', 'api')} notebook/gates.jsonl`].sort());
});

test('two projects with one folder name never share an archive path', () => {
  const b = collect();
  assert.deepEqual(b.manifest.stores.map((s) => s.id).sort(), ['API', 'api-2', 'bundle', 'cog'].sort());
  const names = b.entries.map((e) => e.name.toLowerCase());
  assert.equal(new Set(names).size, names.length);
});

// Every host's own project install, as its emit leaves it: named, and its untouched seeds stay.
test('each host\'s project install is named and carries nothing of its own', () => {
  for (const { host } of HOSTS) {
    const dir = path.join(sb.path, 'inst', host);
    fs.mkdirSync(dir, { recursive: true });
    const r = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'build-driver.mjs'), '--emit', host, '--theme', 'neutral',
      '--footprint', 'lean', '--out', dir], { cwd: dir, env: envOf(a), encoding: 'utf8', windowsHide: true });
    assert.equal(r.status, 0, r.stderr);
    const b = collect([dir]);
    assert.deepEqual(b.manifest.projects, [{ host, root: dir }]);
    assert.deepEqual(b.entries.map((e) => e.name).filter((n) => n.startsWith('projects/') && !n.endsWith('notebook/README.md')), [], host);
  }
});

test('a scanned install is named, and no folder scanned carries no project', () => {
  assert.deepEqual(collect().manifest.projects, [{ host: 'files', root: path.join(git, 'bundle') }]);
  assert.deepEqual(collect([]).manifest.stores, []);
});

const archive = (name) => {
  const b = collect();
  const file = path.join(sb.path, name);
  fs.writeFileSync(file, writeZip([{ name: 'manifest.json', data: Buffer.from(JSON.stringify({ ...b.manifest, projects: [] })) }, ...b.entries]));
  return file;
};

// A project that is here gets its files; one that is not yet cloned keeps them in a named folder,
// and a restore run again after the clone puts them in place.
test('restore puts each project back, or aside when it is not here', () => {
  const file = archive('one.zip');
  const home = path.join(sb.path, 'b');
  const api = path.join(home, 'git', 'team', 'api');
  put(path.join(api, 'notebook', 'mine.md'), 'B own\n');
  const r = inHome(home, () => captured(() => cmdRestore({ file }, { apply: () => 0 })));
  assert.equal(r.rc, 0, r.out);
  assert.equal(read(path.join(api, 'notebook', 'mine.md')), 'B own\n');
  assert.equal(read(path.join(api, 'notebook', 'mine-restored.md')), 'mine\n');
  assert.equal(read(path.join(api, 'user-rules.md')), '## R1 — project rule\nBody.\n');
  const aside = path.join(home, 'geneseed-restored-projects', 'bundle');
  assert.equal(read(path.join(aside, 'memory', 'fact.md')), '---\nname: fact\n---\nf\n');
  assert.ok(r.out.includes(`project not here: ${path.join(home, 'git', 'bundle')}`) && r.out.includes(aside), r.out);
  assert.ok(!fs.existsSync(path.join(home, 'git', 'bundle')), 'no project folder is invented');
  fs.mkdirSync(path.join(home, 'git', 'bundle'));
  inHome(home, () => captured(() => cmdRestore({ file }, { apply: () => 0 })));
  assert.equal(read(path.join(home, 'git', 'bundle', 'PROFILE.md')), '# me\n');
  assert.ok(!fs.existsSync(path.join(api, 'notebook', 'mine-restored-2.md')));
});

// The archive names the project folder, so a forged one could aim anywhere: only the names a
// backup writes are accepted there, whatever the manifest says.
test('a project entry outside the stores is refused by name', () => {
  const data = Buffer.from('x');
  const file = path.join(sb.path, 'forged.zip');
  const home = path.join(sb.path, 'c');
  fs.mkdirSync(path.join(home, 'p'), { recursive: true });
  const base = collect([]).manifest;
  const name = 'projects/p/src/evil.js';
  fs.writeFileSync(file, writeZip([{ name: 'manifest.json', data: Buffer.from(JSON.stringify({ ...base, home,
    files: [{ name, size: 1, sha256: '2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881' }],
    stores: [{ id: 'p', root: path.join(home, 'p') }] })) }, { name, data }]));
  const r = inHome(home, () => captured(() => cmdRestore({ file }, { apply: () => 0 })));
  assert.equal(r.rc, 2, r.out);
  assert.deepEqual(fs.readdirSync(path.join(home, 'p')), []);
});

// `--projects` is remembered, so the console and the next backup scan the same folders.
test('--projects is checked, remembered and cleared', () => {
  const cli = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'bin', 'geneseed-cli.mjs'), 'backup', ...args],
    { cwd: sb.path, env: envOf(a), encoding: 'utf8', windowsHide: true });
  const kept = () => JSON.parse(read(path.join(a, '.config', 'geneseed', 'backup.json'))).projects;
  assert.equal(cli('--projects', path.join(a, 'missing'), '--dry-run').status, 1);
  assert.equal(cli('--projects', git, '--dry-run').status, 0);
  assert.ok(!fs.existsSync(path.join(a, '.config', 'geneseed', 'backup.json')), 'a dry run writes nothing');
  assert.equal(cli('--projects', git, '--out', path.join(sb.path, 'r1.zip')).status, 0);
  assert.deepEqual(kept(), [git]);
  assert.match(cli('--dry-run').stdout, /projects\/api-2\/notebook\/mine\.md/);
  assert.equal(cli('--projects', 'none', '--out', path.join(sb.path, 'r2.zip')).status, 0);
  assert.deepEqual(kept(), []);
});
