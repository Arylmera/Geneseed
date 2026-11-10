// `geneseed export` — a render of `src/` as catalogue entities for a library that is not an
// install. A native verb, so there is no recorded cell to compare it with: every expectation
// below is stated here, against the layout the module's docblock promises.
//
// The rules, each with a test:
//   1. A skill is `<skillsDir>/<name>/SKILL.md` + `metadata.yaml`, an agent the same under
//      `<agentsDir>` with `AGENT.md`, and the constitution is one `laws` entity.
//   2. Frontmatter is `name` and `description` and nothing else; `name` is the folder's name.
//   3. `metadata.yaml` carries the governance fields and, for a skill or an agent, neither
//      `name` nor `description`.
//   4. A reference to another exported entity is rewritten to its exported name and listed in
//      `requires`; a citation of a rule requires the constitution.
//   5. A skill's side files sit under `references/` and it loses its Self-improvement footer;
//      an agent keeps its seven sections whole.
//   6. Writes are claim-on-create: a file no earlier export wrote is kept, and a file an
//      earlier export wrote and this one does not is pruned.
//   7. The profile is the only source of a library's own values, and a misspelt key is refused.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_PROFILE, EXPORT_MANIFEST, loadProfile, planExport, writeExport, cmdExport,
} from '../../js/build/export.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';

const PROFILE = {
  prefix: 'acme-', owner: 'Platform Team', maintainer: '@jdoe', compatibleTools: ['claude', 'bob'],
};
const withProfile = (over = {}) => ({ ...loadProfile(null), ...PROFILE, ...over });
const plan = planExport({ profile: withProfile() });
const file = (rel, p = plan) => p.files.find((f) => f.rel === rel);
const text = (rel, p = plan) => {
  const f = file(rel, p);
  assert.ok(f, `the export did not plan ${rel}`);
  return f.text;
};
const frontmatterOf = (t) => /^---\n([\s\S]*?)\n---\n/.exec(t)[1].split('\n');

test('a skill, an agent and the constitution each land in their own folder', () => {
  for (const rel of [
    'skills/acme-commit/SKILL.md', 'skills/acme-commit/metadata.yaml',
    'agents/personas/acme-reviewer/AGENT.md', 'agents/personas/acme-reviewer/metadata.yaml',
    'laws/acme-laws/LAWS.md', 'laws/acme-laws/metadata.yaml',
    // The constitution is one file per category, and LAWS.md is their index.
    'laws/acme-laws/ontology.md', 'laws/acme-laws/laws.md', 'laws/acme-laws/doctrines-craft.md',
    'laws/acme-laws/doctrines-rigor.md', 'laws/acme-laws/doctrines-ops.md',
    'laws/acme-laws/doctrines-process.md', 'laws/acme-laws/doctrines-comms.md',
  ]) assert.ok(file(rel), `${rel} is missing`);
  const types = plan.entities.map((e) => e.type);
  assert.ok(types.includes('skill') && types.includes('persona'));
  assert.equal(types.filter((t) => t === 'laws').length, 1);
  // Nothing of an install comes along.
  assert.deepEqual(plan.files.filter((f) => /settings|CLAUDE\.md|AGENT\.md$/.test(f.rel)
    && !f.rel.startsWith('agents/personas/')), []);
});

test('frontmatter is name and description only, and the name is the folder', () => {
  for (const f of plan.files.filter((x) => /\/(SKILL|AGENT)\.md$/.test(x.rel))) {
    const lines = frontmatterOf(f.text);
    assert.equal(lines.length, 2, `${f.rel} frontmatter: ${lines.join(' | ')}`);
    assert.equal(lines[0], `name: ${f.rel.split('/').at(-2)}`);
    const desc = JSON.parse(lines[1].replace(/^description: /, ''));
    assert.ok(desc.length >= 10 && desc.length <= 1024, `${f.rel}: description of ${desc.length}`);
  }
  // No host key, no unresolved token, no authoring marker reaches a library.
  for (const f of plan.files.filter((x) => x.text)) {
    assert.doesNotMatch(f.text, /disable-model-invocation|disallowedTools|\{\{[A-Z_]+|<this-skill-directory>/, f.rel);
    assert.doesNotMatch(f.text, /^[ \t]*<!--[ \t]*(aliases|invocation):/m, f.rel);
  }
});

test('metadata.yaml holds the governance fields, and no name or description for a skill or an agent', () => {
  const meta = text('skills/acme-commit/metadata.yaml');
  assert.match(meta, /^type: skill\nowner: "Platform Team"\nmaintainer: "@jdoe"\nversion: \d+\.\d+\.\d+\nstatus: experimental\n/);
  assert.match(meta, /^compatible-tools:\n {2}- claude\n {2}- bob\n/m);
  assert.doesNotMatch(meta, /^(name|description):/m);
  assert.match(text('agents/personas/acme-reviewer/metadata.yaml'), /^type: persona\n/);
  assert.doesNotMatch(text('agents/personas/acme-reviewer/metadata.yaml'), /^(name|description):/m);
  // The constitution is the one type whose name and description live here.
  const laws = text('laws/acme-laws/metadata.yaml');
  assert.match(laws, /^name: acme-laws\ntype: laws\n/);
  assert.match(laws, /^description: ".{10,}"$/m);
});

test('a credited port carries its licence and origin', () => {
  const meta = text('skills/acme-debug/metadata.yaml');
  assert.match(meta, /^license: MIT$/m);
  assert.match(meta, /^origin: "https:\/\/github\.com\/obra\/superpowers/m);
  assert.ok(file('skills/acme-debug/LICENSE-superpowers.txt')?.copy, 'the upstream licence file did not travel');
  // And an uncredited one claims neither.
  assert.doesNotMatch(text('skills/acme-commit/metadata.yaml'), /^(license|origin):/m);
});

test('a reference to another entity takes its exported name and becomes a requirement', () => {
  // The reviewer points at the architect; the commit skill cites laws.
  const reviewer = text('agents/personas/acme-reviewer/AGENT.md');
  assert.match(reviewer, /use `acme-architect`/);
  assert.doesNotMatch(reviewer, /\]\(architect\.md\)/);
  assert.match(text('agents/personas/acme-reviewer/metadata.yaml'), /^requires:\n(?: {2}- .*\n)* {2}- acme-architect\n/m);
  assert.match(text('skills/acme-commit/metadata.yaml'), /^ {2}- acme-laws$/m);
  // Every requirement names an entity this export wrote.
  const exported = new Set(plan.entities.map((e) => e.name));
  for (const f of plan.files.filter((x) => x.rel.endsWith('metadata.yaml'))) {
    const req = /^requires:\n((?: {2}- .*\n)+)/m.exec(f.text);
    for (const name of (req ? req[1].trim().split('\n').map((l) => l.replace(/^\s*- /, '')) : [])) {
      assert.ok(exported.has(name), `${f.rel} requires ${name}, which was not exported`);
    }
  }
});

test('a skill keeps its side files under references/ and drops its footer; an agent keeps its sections', () => {
  assert.ok(file('skills/acme-debug/references/ci.md'));
  assert.match(text('skills/acme-debug/SKILL.md'), /read `references\/ci\.md`/);
  assert.match(text('skills/acme-debug/SKILL.md'), /^# Skill: acme-debug$/m);
  assert.doesNotMatch(text('skills/acme-commit/SKILL.md'), /## Self-improvement|notebook\//);
  const reviewer = text('agents/personas/acme-reviewer/AGENT.md');
  for (const h of ['When to dispatch', 'When NOT to dispatch', 'Inputs', 'Allowed tools', 'Procedure',
    'Output contract', 'Self-improvement']) assert.match(reviewer, new RegExp(`^## ${h}$`, 'm'));
  assert.match(reviewer, /memory\/agents\/<your-name>\.md/);
  // The profile can keep the footer.
  const kept = planExport({ profile: withProfile({ keepSkillSelfImprovement: true }) });
  assert.match(text('skills/acme-commit/SKILL.md', kept), /## Self-improvement/);
});

test('only, exclude and laws narrow the export, and a dropped reference is reported', () => {
  const p = planExport({ profile: withProfile({ only: ['reviewer', 'commit'], laws: false }) });
  assert.deepEqual(p.entities.map((e) => e.name), ['acme-commit', 'acme-reviewer']);
  // The reviewer still names the architect, which is now left out: as written, and reported.
  assert.match(text('agents/personas/acme-reviewer/AGENT.md', p), /\[architect\]\(architect\.md\)/);
  assert.deepEqual(p.missing.get('acme-reviewer'), ['architect']);
  assert.doesNotMatch(text('skills/acme-commit/metadata.yaml', p), /requires/);
  const q = planExport({ profile: withProfile({ exclude: ['commit'] }) });
  assert.ok(!q.entities.some((e) => e.name === 'acme-commit'));
});

test('a vendored folder skill and an alias are named as left out, never written', () => {
  assert.ok(plan.skipped.some((l) => /^daydream: a vendored folder skill/.test(l)));
  assert.ok(plan.skipped.some((l) => /grill-me.*aliases/.test(l)));
  assert.ok(!plan.files.some((f) => /acme-(daydream|grill-me)\//.test(f.rel)));
});

test('writes are claim-on-create: a stranger is kept, an earlier export is replaced and pruned', () => {
  const sb = makeSandbox('gs-export-');
  try {
    const out = path.join(sb.path, 'library');
    const theirs = path.join(out, 'skills', 'acme-commit', 'SKILL.md');
    fs.mkdirSync(path.dirname(theirs), { recursive: true });
    fs.writeFileSync(theirs, 'already in the library\n');
    const small = planExport({ profile: withProfile({ only: ['commit', 'plan'], laws: false }) });
    const first = writeExport(small, out);
    assert.equal(fs.readFileSync(theirs, 'utf8'), 'already in the library\n');
    assert.deepEqual(first.kept, ['skills/acme-commit/SKILL.md']);
    const record = JSON.parse(fs.readFileSync(path.join(out, EXPORT_MANIFEST), 'utf8'));
    assert.ok(record.files.includes('skills/acme-plan/SKILL.md'));
    assert.ok(!record.files.includes('skills/acme-commit/SKILL.md'), 'a kept file was recorded as written');

    // The next export leaves `plan` out: its files go, the stranger and its neighbours stay.
    const smaller = planExport({ profile: withProfile({ only: ['commit'], laws: false }) });
    const second = writeExport(smaller, out);
    assert.ok(second.pruned.includes('skills/acme-plan/SKILL.md'));
    assert.ok(!fs.existsSync(path.join(out, 'skills', 'acme-plan')));
    assert.equal(fs.readFileSync(theirs, 'utf8'), 'already in the library\n');
    assert.ok(fs.existsSync(path.join(out, 'skills', 'acme-commit', 'metadata.yaml')));
  } finally { sb.cleanup(); }
});

test('the profile is checked: an unknown key, a bad list and an escaping folder are refused', () => {
  const sb = makeSandbox('gs-export-profile-');
  try {
    const write = (o) => { const p = path.join(sb.path, 'p.json'); fs.writeFileSync(p, JSON.stringify(o)); return p; };
    assert.equal(loadProfile(write({ prefix: 'acme-' })).prefix, 'acme-');
    assert.throws(() => loadProfile(write({ prefx: 'acme-' })), /unknown key\(s\) prefx/);
    assert.throws(() => loadProfile(write({ exclude: 'commit' })), /exclude must be a list/);
    assert.throws(() => loadProfile(write({ skillsDir: '../elsewhere' })), /skillsDir must be a relative folder/);
    assert.throws(() => loadProfile(path.join(sb.path, 'absent.json')), /no such file/);
    // A prefix that makes a name the library would refuse is caught before anything is written.
    assert.throws(() => planExport({ profile: withProfile({ prefix: 'Acme_' }) }), /cannot be exported/);
  } finally { sb.cleanup(); }
});

test('the verb needs --out, and reports what it wrote', () => {
  const sb = makeSandbox('gs-export-verb-');
  const chunks = [];
  const orig = [process.stdout.write.bind(process.stdout), process.stderr.write.bind(process.stderr)];
  process.stdout.write = (c) => { chunks.push(String(c)); return true; };
  process.stderr.write = (c) => { chunks.push(String(c)); return true; };
  try {
    assert.equal(cmdExport({}), 2);
    assert.equal(cmdExport({ out: path.join(sb.path, 'o'), kits: 'none', profile: 'none' }), 0);
  } finally {
    [process.stdout.write, process.stderr.write] = orig;
    sb.cleanup();
  }
  const said = chunks.join('');
  assert.match(said, /--out <folder> is required/);
  assert.match(said, /\[export\] \d+ skill\(s\), \d+ agent\(s\), the constitution -> /);
  assert.match(said, /no owner or maintainer in the profile/);
});

// THE CHECKOUT'S OWN PROFILE. `export.profile.json` at the repository root is what the verb
// reads when no `--profile` is given; `--profile none` exports without one (the test above).
// It is the maintainer's, tracked on purpose and withheld from the npm package. What is held
// here is that it loads, and that the names it produces are ones a library can take.
test('the checkout profile loads, and is the default the verb names', () => {
  const profile = loadProfile(DEFAULT_PROFILE);
  assert.match(profile.prefix, /^[a-z0-9]+(-[a-z0-9]+)*-$/);
  assert.match(profile.maintainer, /^@/);
  assert.ok(planExport({ profile: { ...profile, only: ['commit'], laws: false } }).entities.length === 1);
  const sb = makeSandbox('gs-export-default-');
  const chunks = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (c) => { chunks.push(String(c)); return true; };
  try {
    assert.equal(cmdExport({ out: path.join(sb.path, 'o'), kits: 'none' }), 0);
    assert.ok(fs.existsSync(path.join(sb.path, 'o', 'skills', `${profile.prefix}commit`, 'SKILL.md')));
  } finally { process.stdout.write = orig; sb.cleanup(); }
  assert.match(chunks.join(''), /\[export\] profile: .*export\.profile\.json/);
});

test('the constitution index names every category file, and holds no rule text itself', () => {
  const index = text('laws/acme-laws/LAWS.md');
  const named = [...index.matchAll(/^- `([a-z-]+\.md)`/gm)].map((m) => m[1]);
  const written = plan.files.map((f) => f.rel).filter((r) => r.startsWith('laws/acme-laws/')
    && !/(LAWS\.md|metadata\.yaml)$/.test(r)).map((r) => r.split('/').at(-1));
  assert.deepEqual(named.sort(), written.sort());
  assert.equal(named.length, 7);
  assert.ok(index.length < 1000, 'the index carries rule text');
  assert.match(text('laws/acme-laws/laws.md'), /Sealed Secrets/);
});
