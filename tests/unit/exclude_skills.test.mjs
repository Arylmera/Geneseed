// `--exclude-skills` — drop rarely used skills from one install, on every host.
//
// Written out, not recorded. Four properties, each with a cell:
//   1. an excluded skill leaves the install — its file, its catalogue row, its command — and
//      nothing else does; the carrier names it on an `Excluded skills:` line
//   2. the default build writes no such line, so every existing install stays byte-identical
//   3. a skill this checkout does not ship, or one the harness links to by path, is refused
//   4. the exclusion survives a rebuild: `installProfile` reads it back into the argv
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { build } from '../../js/build/bundle.mjs';
import { makeCfg, knownSkillIds, linkedSkillIds } from '../../js/build/source.mjs';
import { parseDriverArgs, emitGlobalInto } from '../../js/build/driver.mjs';
import { installProfile, setupBuildArgs } from '../../js/build/generate.mjs';
import { excludedSkillsOfDir } from '../../js/hosts/installs.mjs';
import { writeCommandLayer } from '../../js/hosts/opencode.mjs';
import { renderAll } from '../../js/build/render.mjs';
import { makeSandbox, sandboxProcessHome, restoreProcessHome } from '../helpers/sandbox.mjs';

// The global emit writes the machine hook shim into the environment's home.
sandboxProcessHome();
test.after(() => { restoreProcessHome(); });

function quiet(fn) {
  const o = process.stdout.write; const e = process.stderr.write;
  process.stdout.write = () => true; process.stderr.write = () => true;
  try { return fn(); } finally { process.stdout.write = o; process.stderr.write = e; }
}

function withDir(fn) {
  const sb = makeSandbox('gsxskill-');
  try { return fn(sb.path); } finally { sb.cleanup(); }
}

const agentText = (dir) => fs.readFileSync(path.join(dir, 'AGENT.md'), 'utf8').replace(/\r\n/g, '\n');

// One flat skill (`bruno`) and one folder skill (`daydream`) are excluded by their own names;
// `research.md` is an unrelated flat sibling that must survive, proving the filter took nothing else.
test('an excluded flat and folder skill leave the bundle, its catalogue rows, and nothing else', () => {
  withDir((d) => {
    quiet(() => build(makeCfg({ excludeSkills: ['bruno', 'daydream'] }), 'neutral', d));
    const skills = fs.readdirSync(path.join(d, 'skills'));
    assert.ok(!skills.includes('bruno.md'), 'the flat skill was written');
    assert.ok(!skills.includes('daydream'), 'the folder skill was written');
    assert.ok(skills.includes('research.md'), 'a sibling skill went with it');
    const agent = agentText(d);
    assert.ok(!agent.includes('skills/bruno.md'), 'its catalogue row is still there');
    assert.ok(!agent.includes('skills/daydream/SKILL.md'), "the folder skill's bullet is still there");
    // The bullet's indented continuation line goes with it, or it dangles under the previous one.
    assert.ok(!agent.includes('non-obvious connections between notes'), 'a continuation line stayed');
    assert.ok(agent.includes('skills/token-report/SKILL.md'), 'a sibling folder bullet went too');
    assert.ok(agent.split('\n').includes('Excluded skills: bruno, daydream'),
      'the Excluded skills: marker is missing or misspelled');
    assert.deepEqual(excludedSkillsOfDir(d), ['bruno', 'daydream'], 'read-back');
  });
});

test('the default build writes no Excluded skills line and reads back as nothing excluded', () => {
  withDir((d) => {
    quiet(() => build(makeCfg(), 'neutral', d));
    assert.ok(!agentText(d).includes('Excluded skills:'), 'a default build grew a marker line');
    assert.deepEqual(excludedSkillsOfDir(d), []);
    // Counted by stem: a skill with side files ships as both `debug.md` and `debug/`.
    assert.equal(new Set(fs.readdirSync(path.join(d, 'skills')).filter((n) => !n.startsWith('_'))
      .map((n) => n.replace(/\.md$/, ''))).size, knownSkillIds().length, 'a default build lost a skill');
  });
});

test('the flag refuses an unknown skill and a linked one, and normalises the rest', () => {
  const refuse = (value, re) => assert.throws(
    () => quiet(() => parseDriverArgs(['--emit', 'files', '--exclude-skills', value])), re);
  refuse('no-such-skill', /unknown skill 'no-such-skill'/);
  // Every linked skill is protected — the constitution would ship a dead link to it.
  for (const name of linkedSkillIds()) refuse(name, new RegExp(`'${name}' cannot be excluded`));
  assert.ok(linkedSkillIds().includes('council'), 'the scan found none of the known links');
  const args = parseDriverArgs(['--emit', 'files', '--exclude-skills', 'herdr, daydream,herdr']);
  assert.deepEqual(args.excludeSkills, ['daydream', 'herdr'], 'not sorted and deduped');
  assert.deepEqual(parseDriverArgs(['--emit', 'files', '--exclude-skills', 'none']).excludeSkills, []);
});

test('setupBuildArgs elides an empty exclusion and spells a non-empty one', () => {
  const at = (skills) => setupBuildArgs('neutral', 'files', null, null, 'lean', 'peer', 'direct',
    null, undefined, null, undefined, skills);
  for (const none of [null, []]) {
    assert.ok(!at(none).includes('--exclude-skills'), `${JSON.stringify(none)} grew a flag`);
  }
  const argv = at(['daydream', 'herdr']);
  assert.equal(argv[argv.indexOf('--exclude-skills') + 1], 'daydream,herdr');
});

test('a global install keeps its excluded skills through a rebuild', () => {
  withDir((d) => {
    const cfgDir = path.join(d, 'cfg');
    quiet(() => emitGlobalInto('opencode', {
      theme: 'neutral', out: path.join(d, 'out'), cfgDir, footprint: 'lean',
      excludeSkills: ['herdr'],
    }));
    assert.ok(!fs.existsSync(path.join(cfgDir, 'skills', 'herdr')), 'the skill was emitted');
    const p = installProfile('opencode', 'global', cfgDir);
    assert.deepEqual(p.excludeSkills, ['herdr']);
    assert.equal(p.argv[p.argv.indexOf('--exclude-skills') + 1], 'herdr',
      'the rebuild argv would put the skill back');
  });
});

test('a command whose skill was excluded is skipped, not a build failure', () => {
  withDir((d) => {
    const prev = process.env.GENESEED_COMMANDS;
    process.env.GENESEED_COMMANDS = '1';
    try {
      const cfg = makeCfg({ excludeSkills: ['ship'] });
      const { items } = renderAll(cfg, 'neutral');
      const written = writeCommandLayer(cfg, items, d).map((p) => path.basename(p));
      assert.ok(!written.includes('ship.md'), 'the /ship command outlived its skill');
      assert.ok(written.includes('commit.md'), 'the other commands went with it');
    } finally {
      if (prev === undefined) delete process.env.GENESEED_COMMANDS;
      else process.env.GENESEED_COMMANDS = prev;
    }
  });
});
