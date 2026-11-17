// The `superpowers` kit: five vendored Rites that an install has either as this kit or as the
// official plugin, never both.
//
// Written out, not recorded. The rules this file holds, each with the sentence that states it:
//   1. KIT ON ships the five members, KIT OFF ships none of them, and nothing else moves. The four
//      expected skill lists below (Claude Code and OpenCode, each way) are typed out in full, so a
//      skill added to the core must be added here on purpose. Claude Code also lists `ci-fix`, the
//      user-only alias folder of `debug`, which exists only while `debug` does.
//   2. NO RENDERED FILE LINKS A SKILL OR AGENT THE BUILD DOES NOT SHIP, in either state, on either
//      host. With the kit off a core link to a member becomes the plugin's skill in the host's
//      spelling (`superpowers:<name>` on Claude Code, the bare name on OpenCode) and plain text on
//      Bob, which has no plugin. The checker is itself shown to fail on a planted dead link.
//   3. THE WORKFLOW PROVIDER BLOCK exists only with the kit off: the full block where a plugin can
//      be pointed at, the missing-provider line on Bob.
//   4. `--exclude-skills` refuses a member core files link to, and a relative link protects as a
//      token link does (`prototype`, linked by `wayfinder` as `(prototype.md)`).
//   5. KIT OFF LEAVES NO MEMBER FILE AND NO `LICENSE-superpowers.txt` BESIDE A REMOVED SKILL; the
//      credited core skills (`parallel-agents`, `pipeline`) keep theirs in both states.
//   6. Turning the kit off removes the five, turning it on writes them back (the deletion cells).
// Every install here lives in a sandbox HOME; no test reads the machine's own settings.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { restoreProcessHome, sandboxProcessHome, withSandbox } from '../helpers/sandbox.mjs';

sandboxProcessHome();
test.after(() => { restoreProcessHome(); });

const { emitGlobalInto } = await import('../../js/build/driver.mjs');
const { parseExcludeSkills } = await import('../../js/build/args.mjs');
const { linkedSkillIds, loadKits } = await import('../../js/build/source.mjs');

const MEMBERS = ['brainstorm', 'debug', 'geneseed-code-review', 'plan', 'review-response'];

// Every skill both hosts write with the kit off, partials (`_x.md`) left out.
const OPENCODE_OFF = ['adhd', 'brick-forge', 'bruno', 'codebase-design', 'commit', 'council', 'daydream', 'deck',
  'dependencies', 'develop', 'diagram-design', 'document-project', 'explain-changes', 'factory', 'factory-forge',
  'forge-mcp', 'fresh-eyes', 'frontend-design', 'geneseed', 'git-history', 'handoff', 'ingest', 'learn-mode', 'loop',
  'ownership', 'parallel-agents', 'pipeline', 'ponytail', 'profile', 'prose', 'prototype', 'react-view-transitions',
  'refactor', 'release', 'research', 'roast-me', 'rule', 'security-audit', 'ship', 'skill-forge', 'teach',
  'token-report', 'wayfinder', 'wiki', 'workflow', 'worktree'];
// Claude Code adds the user-only alias folders of its merged skills.
const CLAUDE_OFF = [...OPENCODE_OFF, 'bruno-collection-generator', 'bruno-test-writer', 'consolidate-memory',
  'deps-audit', 'domain-modeling', 'git-archaeology', 'git-rescue', 'migrate', 'opencode-theme', 'presentation',
  'quiz', 'repo-map', 'slides'].sort();
const OPENCODE_ON = [...OPENCODE_OFF, ...MEMBERS].sort();
const CLAUDE_ON = [...CLAUDE_OFF, ...MEMBERS, 'ci-fix'].sort();

const skillsOf = (cfg) => fs.readdirSync(path.join(cfg, 'skills')).filter((n) => !n.startsWith('_')).sort();
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

/** One global emit into `d/<host>`, quiet. */
function emit(d, host, kits, name = host) {
  const cfgDir = path.join(d, name);
  const w = process.stdout.write;
  const e = process.stderr.write;
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  try {
    emitGlobalInto(host, { theme: 'neutral', out: path.join(d, `bundle-${name}`), cfgDir, footprint: 'full', kits });
  } finally { process.stdout.write = w; process.stderr.write = e; }
  return cfgDir;
}

/** Every relative markdown link under skills/ and agents/ whose target lies in the install and is missing. */
function deadLinks(cfg) {
  const dead = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) { walk(f); continue; }
      if (!e.name.endsWith('.md')) continue;
      for (const m of fs.readFileSync(f, 'utf8').matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = m[1].split('#')[0];
        if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || path.isAbsolute(target)) continue;
        const to = path.resolve(path.dirname(f), target);
        if (to.startsWith(cfg + path.sep) && !fs.existsSync(to)) dead.push(`${path.relative(cfg, f)} -> ${m[1]}`);
      }
    }
  };
  for (const sub of ['skills', 'agents']) if (fs.existsSync(path.join(cfg, sub))) walk(path.join(cfg, sub));
  return dead;
}

test('the shipped kit has exactly the five members, mapped to the plugin skills they stand for', () => {
  const kit = loadKits().get('superpowers');
  assert.deepEqual(kit.skills, ['brainstorm', 'debug', 'plan', 'geneseed-code-review', 'review-response']);
  assert.deepEqual(kit.agents, []);
  assert.deepEqual(kit.replacedBy.skills, {
    brainstorm: 'brainstorming', debug: 'systematic-debugging', plan: 'writing-plans',
    'geneseed-code-review': 'requesting-code-review', 'review-response': 'receiving-code-review',
  });
  assert.deepEqual(kit.replacedBy.hosts, { claude: 'superpowers:{name}', opencode: '{name}' });
  assert.equal(kit.replacedBy.upstream, 'superpowers');
  assert.match(kit.description, /obra\/superpowers.*Jesse Vincent.*MIT/);
});

test('each host lists exactly its expected skills, kit on and kit off', async () => {
  await withSandbox('gs-sp-sets-', (d) => {
    assert.deepEqual(skillsOf(emit(d, 'claude', [], 'c-off')), CLAUDE_OFF, 'claude, kit off');
    assert.deepEqual(skillsOf(emit(d, 'claude', ['superpowers'], 'c-on')), CLAUDE_ON, 'claude, kit on');
    assert.deepEqual(skillsOf(emit(d, 'opencode', [], 'o-off')), OPENCODE_OFF, 'opencode, kit off');
    assert.deepEqual(skillsOf(emit(d, 'opencode', ['superpowers'], 'o-on')), OPENCODE_ON, 'opencode, kit on');
  });
});

test('no rendered file links a skill or agent the build does not ship, kit on or off, on every host', async () => {
  await withSandbox('gs-sp-links-', (d) => {
    for (const [host, kits] of [['claude', []], ['claude', ['superpowers']], ['opencode', []], ['opencode', ['superpowers']],
      ['bob', []], ['bob', ['superpowers']], ['openclaude', []]]) {
      const cfg = emit(d, host, kits, `${host}-${kits.length}`);
      assert.deepEqual(deadLinks(cfg), [], `${host}, kits [${kits}]`);
    }
  });
});

test('the dead-link checker fails on a link to a skill the kit-off build dropped', async () => {
  // The control for the test above: a checker that finds nothing proves nothing.
  await withSandbox('gs-sp-control-', (d) => {
    const cfg = emit(d, 'claude', [], 'c');
    const file = path.join(cfg, 'skills', 'develop', 'SKILL.md');
    fs.appendFileSync(file, '\nSee [debug](../debug/SKILL.md).\n');
    assert.deepEqual(deadLinks(cfg), [`${path.join('skills', 'develop', 'SKILL.md')} -> ../debug/SKILL.md`]);
  });
});

test('kit off: a core link to a member names the plugin skill in the host\'s spelling, and Bob names none', async () => {
  await withSandbox('gs-sp-rewrite-', (d) => {
    const claude = read(emit(d, 'claude', [], 'c'), 'skills', 'develop', 'SKILL.md');
    assert.match(claude, /debug Skill \(`superpowers:systematic-debugging`\)/);
    const opencode = read(emit(d, 'opencode', [], 'o'), 'skills', 'develop', 'SKILL.md');
    assert.match(opencode, /debug Skill \(`systematic-debugging`\)/);
    assert.doesNotMatch(opencode, /superpowers:/);
    const bob = read(emit(d, 'bob', [], 'b'), 'skills', 'develop', 'SKILL.md');
    assert.match(bob, /A red baseline is a debug Skill\s+task first/);
    assert.doesNotMatch(bob, /systematic-debugging/);
    // Kit on: the link is the link it always was, to the member's own file.
    const on = read(emit(d, 'claude', ['superpowers'], 'c-on'), 'skills', 'develop', 'SKILL.md');
    assert.doesNotMatch(on, /systematic-debugging/);
  });
});

test('the Workflow provider block exists only with the kit off, and Bob gets the missing-provider line only', async () => {
  await withSandbox('gs-sp-provider-', (d) => {
    const claudeOff = read(emit(d, 'claude', [], 'c'), 'CLAUDE.md');
    assert.match(claudeOff, /### Workflow provider/);
    assert.match(claudeOff, /`superpowers:dispatching-parallel-agents`/);
    assert.match(claudeOff, /never rank/);
    assert.match(claudeOff, /turn on the `superpowers` kit or install the superpowers plugin/);
    const claudeOn = read(emit(d, 'claude', ['superpowers'], 'c2'), 'CLAUDE.md');
    assert.doesNotMatch(claudeOn, /### Workflow provider/);
    assert.match(claudeOn, /### Superpowers kit/);
    assert.match(claudeOn, /Active kits: superpowers/);
    const opencodeOff = read(emit(d, 'opencode', [], 'o'), 'AGENT.md');
    assert.match(opencodeOff, /`dispatching-parallel-agents`/);
    assert.doesNotMatch(opencodeOff, /superpowers:dispatching/);
    const bobCfg = emit(d, 'bob', [], 'b');
    const bobRules = read(bobCfg, 'rules', 'geneseed.md');
    assert.match(bobRules, /### Workflow provider/);
    assert.match(bobRules, /has no superpowers plugin to stand in for it/);
    assert.doesNotMatch(bobRules, /dispatching-parallel-agents/);
  });
});

test('--exclude-skills refuses a kit member core files link to, and counts a relative link as a link', () => {
  for (const name of MEMBERS) {
    assert.throws(() => parseExcludeSkills(name), new RegExp(`'${name}' cannot be excluded`), name);
  }
  // `wayfinder` links the prototype Rite as `(prototype.md)`, a relative link; excluding it shipped a dead one.
  assert.ok(linkedSkillIds().includes('prototype'));
  assert.throws(() => parseExcludeSkills('prototype'), /'prototype' cannot be excluded/);
  // A skill nothing links stays excludable.
  assert.deepEqual(parseExcludeSkills('adhd'), ['adhd']);
});

test('kit off writes no member and no licence beside a removed skill; credited core skills keep theirs', async () => {
  await withSandbox('gs-sp-credit-', (d) => {
    const off = emit(d, 'claude', [], 'c-off');
    for (const m of MEMBERS) {
      assert.equal(fs.existsSync(path.join(off, 'skills', m)), false, `${m} shipped with the kit off`);
    }
    for (const core of ['parallel-agents', 'pipeline']) {
      assert.ok(fs.existsSync(path.join(off, 'skills', core, 'LICENSE-superpowers.txt')), `${core} lost its credit`);
    }
    const on = emit(d, 'claude', ['superpowers'], 'c-on');
    for (const m of MEMBERS) {
      assert.ok(fs.existsSync(path.join(on, 'skills', m, 'LICENSE-superpowers.txt')), `${m} has no superpowers licence`);
      assert.match(read(on, 'skills', m, 'SKILL.md'), /Adapted from \[obra\/superpowers\]/);
    }
  });
});

test('turning the kit off removes the five Rites and turning it on writes them back', async () => {
  await withSandbox('gs-sp-flip-', (d) => {
    const cfg = emit(d, 'claude', ['superpowers'], 'c');
    assert.deepEqual(skillsOf(cfg), CLAUDE_ON);
    emit(d, 'claude', [], 'c');
    assert.deepEqual(skillsOf(cfg), CLAUDE_OFF, 'kit off over kit on');
    emit(d, 'claude', ['superpowers'], 'c');
    assert.deepEqual(skillsOf(cfg), CLAUDE_ON, 'kit on over kit off');
  });
});
