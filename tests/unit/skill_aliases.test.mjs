/**
 * Skill ALIASES and RETIRED skill ids — how a merged or removed skill's old name keeps working.
 *
 * Four properties, each written out rather than recorded:
 *   1. the `<!-- aliases: a, b -->` marker parses only as a line of its own
 *   2. `--exclude-skills` resolution: an alias maps to its target, a retired name drops out,
 *      an alias of a protected skill drops out, and only a never-shipped name is unknown
 *   3. the emit: the Claude dialect (Claude Code, OpenClaude and Bob all route through
 *      `writeNativeLayer` with `host: 'claude'`) writes a user-only alias skill; OpenCode
 *      writes no alias skill but an unconditional `command/<alias>.md`; neither counts it
 *   4. the doctor's `aliasProblems` refuses every collision an alias could cause on disk, and a
 *      second marker line that `aliasesOf` would silently ignore
 *
 * EVERY INPUT IS SYNTHETIC but three. `src/skills/` is the content tree and changes with every
 * skill merge, so the resolver gets its tables as arguments, the writers get literal items, and
 * the doctor gate runs over a fixture `src/` in a sandbox. The exceptions read the live tree on
 * purpose, through the two real entry points: the retired `tickets` and the `deps-audit` alias
 * of `dependencies` (each says why it is stable). Carriers live in a sandbox, never the home.
 * If a rule below is wrong, change the row AND the sentence above it, in the same commit.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { RETIRED_SKILL_IDS, aliasesOf, resolveSkillNames } from '../../js/build/source.mjs';
import { parseDriverArgs } from '../../js/build/driver.mjs';
import { excludedSkillsOfDir } from '../../js/hosts/installs.mjs';
import * as generate from '../../js/build/generate.mjs';
import { installAxes } from '../../js/maintain/update.mjs';
import { writeNativeLayer } from '../../js/hosts/native.mjs';
import { writeAliasCommands } from '../../js/hosts/opencode.mjs';
import { aliasProblems } from '../../js/inspect/checks-repo.mjs';
import { withSandbox } from '../helpers/sandbox.mjs';

const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');

test('the aliases marker parses as a line of its own, and only then', () => {
  assert.deepEqual(aliasesOf('# s\n\n> Purpose.\n<!-- aliases: deps-audit, migrate -->\n'),
    ['deps-audit', 'migrate']);
  // Whitespace around names and the comment is not part of a name; CRLF sources parse too.
  assert.deepEqual(aliasesOf('<!--aliases:  ci-fix ,  -->\r\nbody'), ['ci-fix']);
  // A skill that QUOTES the syntax in prose declares nothing.
  assert.deepEqual(aliasesOf('Write `<!-- aliases: x -->` under the blockquote.'), []);
  assert.deepEqual(aliasesOf('# s\n\n> Purpose.\n'), []);
});

test('exclude-skills resolution maps old names instead of refusing them', () => {
  const tables = {
    known: ['bruno', 'debug', 'herdr'],
    aliases: new Map([['bruno-test-writer', 'bruno'], ['bruno-collection-generator', 'bruno'],
      ['ci-fix', 'debug']]),
    retired: { tickets: 'gone' },
    linked: ['debug'],
  };
  assert.deepEqual(resolveSkillNames(['herdr', 'bruno-test-writer', 'tickets', 'nope'], tables), {
    ids: ['bruno', 'herdr'],
    notices: [
      "'bruno-test-writer' is now part of 'bruno' — excluding 'bruno'",
      "'tickets' no longer ships (gone) — exclusion dropped",
    ],
    unknown: ['nope'],
  });
  // Two old halves of one merged skill collapse to one exclusion.
  assert.deepEqual(resolveSkillNames(['bruno-test-writer', 'bruno-collection-generator', 'bruno'],
    tables).ids, ['bruno']);
  // An alias of a protected skill cannot be honoured — dropped, never refused, so a replay of
  // an install made before the merge still rebuilds.
  assert.deepEqual(resolveSkillNames(['ci-fix'], tables), {
    ids: [],
    notices: ["'ci-fix' is now part of 'debug', which cannot be excluded — exclusion dropped"],
    unknown: [],
  });
});

// The one cell that reads the live tree: `tickets` is retired, so no checkout may ship it (the
// doctor's `aliasProblems` refuses a live skill with a retired id), which makes this stable.
test('a replayed install drops a retired name and says so only when asked', async () => {
  await withSandbox('gsalias-', (d) => {
    fs.writeFileSync(path.join(d, 'AGENT.md'), '# Agent\n\nExcluded skills: tickets\n');
    assert.deepEqual(excludedSkillsOfDir(d), [], 'the silent read');
    const heard = [];
    assert.deepEqual(excludedSkillsOfDir(d, (n) => heard.push(n)), []);
    assert.deepEqual(heard, [`'tickets' no longer ships (${RETIRED_SKILL_IDS.tickets}) — exclusion dropped`]);
  });
});

// The live alias `deps-audit` -> `dependencies`, read back from a carrier and typed on the flag.
// Stable for as long as the merge stands: removing the alias would strand every install that
// excluded `deps-audit`, and `dependencies` is not linked by path, so the exclusion is honoured
// (mapped to the merged skill) rather than dropped.
const DEPS_NOTICE = "'deps-audit' is now part of 'dependencies' — excluding 'dependencies'";

test('a replayed install that excluded one half of a merged skill excludes the whole skill', async () => {
  await withSandbox('gsalias-', (d) => {
    fs.writeFileSync(path.join(d, 'AGENT.md'), '# Agent\n\nExcluded skills: deps-audit\n');
    const heard = [];
    assert.deepEqual(excludedSkillsOfDir(d, (n) => heard.push(n)), ['dependencies']);
    assert.deepEqual(heard, [DEPS_NOTICE]);
  });
});

// `upgrade` replays an install's axes through `installAxes`; it was the one replay besides
// `migrate` that read the old name silently, so the owner never learned the exclusion moved.
test('upgrade replays an old excluded name with the same notice rebuild-all prints', async () => {
  await withSandbox('gsalias-', async (d) => {
    fs.writeFileSync(path.join(d, '.geneseed-emit'), 'opencode-global\n');
    fs.writeFileSync(path.join(d, 'AGENT.md'), '# Agent\n\nExcluded skills: deps-audit\n');
    const heard = [];
    const axes = await installAxes(d, generate, (n) => heard.push(n));
    assert.deepEqual(heard, [DEPS_NOTICE]);
    assert.equal(axes[axes.indexOf('--exclude-skills') + 1], 'dependencies');
  });
});

test('--exclude-skills maps an alias to its target and says so on stderr', () => {
  const said = [];
  const e = process.stderr.write;
  process.stderr.write = (s) => { said.push(String(s)); return true; };
  let args;
  try { args = parseDriverArgs(['--emit', 'files', '--exclude-skills', 'deps-audit']); }
  finally { process.stderr.write = e; }
  assert.deepEqual(args.excludeSkills, ['dependencies']);
  // The CLI's line writer ends lines with the platform EOL; normalise it before comparing.
  assert.deepEqual(said.map((s) => s.replace(/\r\n/g, '\n')),
    [`[geneseed] --exclude-skills: ${DEPS_NOTICE}\n`]);
});

const SKILL = '# Skill: bruno\n\n> Write Bruno collections and tests.\n'
  + '<!-- aliases: bruno-test-writer, bruno-collection-generator -->\n\n**Trigger:** bruno\n';
const items = (src) => [{ rel: 'skills/bruno.md', text: SKILL, src: path.join(src, 'skills', 'bruno.md') }];

test('the Claude dialect writes one user-only alias skill per old name, uncounted', async () => {
  await withSandbox('gsalias-', (d) => {
    const src = path.join(d, 'src');
    const skills = path.join(d, 'skills');
    const r = writeNativeLayer(items(src), path.join(d, 'agents'), skills, null, { host: 'claude', src });
    assert.equal(r.nSkills, 1, 'an alias was counted as a skill');
    assert.equal(r.written.length, 3);
    assert.equal(read(path.join(skills, 'bruno-test-writer', 'SKILL.md')),
      '---\nname: bruno-test-writer\ndescription: "Alias of bruno."\n'
      + 'disable-model-invocation: true\n---\n\n' + SKILL);
    assert.equal(read(path.join(skills, 'bruno-collection-generator', 'SKILL.md')),
      '---\nname: bruno-collection-generator\ndescription: "Alias of bruno."\n'
      + 'disable-model-invocation: true\n---\n\n' + SKILL);
  });
});

// A user's own file at the target refuses the target's claim; its aliases must go with it, or
// `/bruno-test-writer` would answer with a skill this install never wrote.
test('no alias skill is written when the target itself was not claimed', async () => {
  await withSandbox('gsalias-', (d) => {
    const src = path.join(d, 'src');
    const skills = path.join(d, 'skills');
    const target = path.join(skills, 'bruno', 'SKILL.md');
    const r = writeNativeLayer(items(src), path.join(d, 'agents'), skills, null,
      { host: 'claude', src, claim: (dest) => dest !== target });
    assert.deepEqual(r.written, []);
    assert.equal(r.nSkills, 0);
  });
});

test('OpenCode gets no alias skill, but an unconditional alias command', async () => {
  await withSandbox('gsalias-', (d) => {
    const src = path.join(d, 'src');
    const skills = path.join(d, 'skills');
    const r = writeNativeLayer(items(src), path.join(d, 'agents'), skills, null, { host: 'opencode', src });
    assert.deepEqual(fs.readdirSync(skills), ['bruno'], 'OpenCode grew an alias skill');
    assert.equal(r.nSkills, 1);
    // GENESEED_COMMANDS is not consulted: an old name behind an opt-in is a name that broke.
    const saved = process.env.GENESEED_COMMANDS;
    delete process.env.GENESEED_COMMANDS;
    try {
      const cmd = path.join(d, 'command');
      const written = writeAliasCommands({ src }, items(src), cmd);
      assert.deepEqual(written.map((p) => path.basename(p)),
        ['bruno-test-writer.md', 'bruno-collection-generator.md']);
      assert.equal(read(path.join(cmd, 'bruno-test-writer.md')),
        '---\ndescription: "Alias of bruno."\n---\n\n' + SKILL);
      // An excluded target is absent from the filtered items, so its aliases go with it.
      assert.deepEqual(writeAliasCommands({ src }, [], path.join(d, 'none')), []);
      // claim() refuses a user's own file: nothing is written over it.
      assert.deepEqual(writeAliasCommands({ src }, items(src), path.join(d, 'c2'), () => false), []);
    } finally {
      if (saved !== undefined) process.env.GENESEED_COMMANDS = saved;
    }
  });
});

test('the doctor refuses every alias that would collide on disk', async () => {
  await withSandbox('gsalias-', (d) => {
    const dir = path.join(d, 'skills');
    fs.mkdirSync(dir, { recursive: true });
    const spec = (name, aliases) => fs.writeFileSync(path.join(dir, `${name}.md`),
      `# Skill: ${name}\n\n> Purpose.\n<!-- aliases: ${aliases} -->\n`);
    spec('alpha', 'old-alpha, Bad_Name, beta, tickets, code-review, ponytail');
    spec('beta', 'old-alpha, old-beta');
    fs.writeFileSync(path.join(dir, 'tickets.md'), '# Skill: tickets\n\n> Purpose.\n');
    fs.writeFileSync(path.join(dir, '_template.md'), '<!-- aliases: ignored -->\n');
    assert.deepEqual(aliasProblems(d), [
      "[authoring] skill 'tickets' reuses a retired skill id (RETIRED_SKILL_IDS)",
      "[authoring] skills/alpha.md alias 'Bad_Name' is not [a-z0-9-]+",
      "[authoring] skills/alpha.md alias 'beta' is already a skill",
      "[authoring] skills/alpha.md alias 'tickets' is already a skill",
      "[authoring] skills/alpha.md alias 'code-review' is an OpenCode command name",
      "[authoring] skills/alpha.md alias 'ponytail' is an OpenCode command name",
      "[authoring] skills/beta.md alias 'old-alpha' is already declared by skills/alpha.md",
    ]);
    fs.rmSync(path.join(dir, 'tickets.md'));
    spec('alpha', 'tickets');
    spec('beta', 'old-beta');
    assert.deepEqual(aliasProblems(d), [
      "[authoring] skills/alpha.md alias 'tickets' is a retired skill id (RETIRED_SKILL_IDS)",
    ]);
    // A second marker line would be ignored by `aliasesOf` (first line wins), so its names
    // would silently stop working: the doctor names the file instead.
    fs.writeFileSync(path.join(dir, 'alpha.md'),
      '# Skill: alpha\n\n> Purpose.\n<!-- aliases: old-alpha -->\n<!-- aliases: older-alpha -->\n');
    assert.deepEqual(aliasProblems(d), [
      '[authoring] skills/alpha.md declares aliases on more than one line — merge them',
    ]);
    spec('alpha', 'old-alpha');
    assert.deepEqual(aliasProblems(d), [], 'a clean tree reported a problem');
  });
});
