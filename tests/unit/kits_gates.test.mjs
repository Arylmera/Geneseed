// Kits through the gates — the doctor's kit arm, the CLI's exclusion check and the count tables.
//
// Written out, not recorded. Every case runs on a copy of the shipped `src/` (and `registry.json`
// beside it) with ONE clean fixture kit planted — `fx`: a skill `fx-skill`, an agent `fx-agent`,
// a `rules.md` that links its own skill and the core `debug`, and a registry row per member — and
// then ONE fault planted on top:
//   1. `kitProblems` is silent on the clean kit, and on a tree with no kit at all
//   2. it refuses, each with the message written out below: a manifest missing `description`,
//      `rules`, `skills` or `agents` (a missing member list makes its member a core file again, so
//      that file's link to the other member is R4 too); `rules` naming a file that is not there; a kit id that is
//      reserved (`none`, `RETIRED_KIT_IDS`); a member in two kits and a core skill (one with a
//      row in AGENT.md.tmpl) claimed by a kit (spec R3); a core file, or another kit's file,
//      linking a kit member (R4: links run kit → core only; under `kits/`, only `<kit>.json`
//      and `<kit>/**` are a kit's, so a stray `kits/README.md` counts as core);
//      a member whose spec does not exist; a member with no registry.json row; a catalogue row
//      naming something that is not the kit's own member (spec A6); a manifest that
//      does not parse; and a `rules.md` over its `rulesWordBudget` (default 300, spec B7)
//   3. the word budget is counted on the RENDERED rules: `{{VOICE}}` is one word in the source
//      and twelve once the neutral theme renders it, so a raw count of 8 would pass a budget of
//      10 that the rendered 19 fails; 19 itself is within budget
//   4. a kit skill that only kit files link (its kit's rules.md, another member) is NOT
//      protected: `--exclude-skills fx-skill` is accepted (spec R5) and still refuses a core
//      skill the harness links (`council`); a CORE skill a kit file links stays protected
//      (excluding it would leave the kit's link dead)
// If a rule below is wrong, change the row AND the sentence above it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { parseExcludeSkills } from '../../js/build/args.mjs';
import { ROOT, SRC, linkedSkillIds, loadKits } from '../../js/build/source.mjs';
import { kitProblems } from '../../js/inspect/checks-counts.mjs';
import { withSandbox } from '../helpers/sandbox.mjs';

const RULES = '### Fx rules\n\n{{VOICE}}\n\n'
  + 'Read [fx-skill]({{DIR_SKILLS}}/fx-skill.md) before [debug]({{DIR_SKILLS}}/debug.md).\n';
const MANIFEST = {
  description: 'Fixture kit', skills: ['fx-skill'], agents: ['fx-agent'], rules: 'kits/fx/rules.md',
  catalogue: {
    skills: ['| [fx-skill]({{DIR_SKILLS}}/fx-skill.md) | the fixture kit skill |'],
    agents: ['| [fx-agent]({{DIR_AGENTS}}/fx-agent.md) | the fixture kit agent is wanted |'],
  },
};
const SKILL_HEAD = '# {{SKILL}}: fx-skill\n\n> The fixture kit skill.\n\n';
const SKILL_TAIL = 'Hand off to [fx-agent]({{DIR_AGENTS}}/fx-agent.md).\n';
const skillRow = (n) => `| [${n}]({{DIR_SKILLS}}/${n}.md) | a row |`;
const ROW = { status: 'approved', version: '1.0.0', owner: 'Fixture', added: '2026-10-20', last_verified: '' };

/**
 * `<d>/src` (a copy of the shipped one) and `<d>/registry.json`, with the clean `fx` kit planted,
 * then `fault` applied: `{ manifest?, files?, registry? }` — a manifest patch, extra or replaced
 * files under src, and a registry patch (`null` deletes a row). Returns the src path.
 */
function tree(d, fault = {}) {
  const src = path.join(d, 'src');
  fs.cpSync(SRC, src, { recursive: true });
  fs.rmSync(path.join(src, 'kits'), { recursive: true, force: true }); // the fixture is the only kit, whatever the checkout ships
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'registry.json'), 'utf8'));
  Object.assign(registry.entities, { 'skills/fx-skill': ROW, 'agents/fx-agent': ROW }, fault.registry);
  for (const [k, v] of Object.entries(registry.entities)) if (v === null) delete registry.entities[k];
  fs.writeFileSync(path.join(d, 'registry.json'), JSON.stringify(registry));
  const manifest = { ...MANIFEST, ...fault.manifest };
  for (const [k, v] of Object.entries(manifest)) if (v === undefined) delete manifest[k];
  const files = {
    'kits/fx.json': JSON.stringify(manifest),
    'kits/fx/rules.md': RULES,
    'skills/fx-skill.md': '# {{SKILL}}: fx-skill\n\n> The fixture kit skill.\n\n'
      + 'Hand off to [fx-agent]({{DIR_AGENTS}}/fx-agent.md).\n',
    'agents/fx-agent.md': '# {{AGENT}}: fx-agent\n\n> The fixture kit agent.\n\n'
      + 'Load [fx-skill]({{DIR_SKILLS}}/fx-skill.md) first.\n',
    ...fault.files,
  };
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(src, rel)), { recursive: true });
    fs.writeFileSync(path.join(src, rel), text);
  }
  return src;
}

const debugMd = () => fs.readFileSync(path.join(SRC, 'skills', 'debug.md'), 'utf8');

/** [what the row proves, the fault, the exact problems kitProblems must return]. */
const ROWS = [
  ['the clean kit', {}, []],
  ...['description', 'rules'].map((k) => [`a manifest with no '${k}'`,
    { manifest: { [k]: undefined } }, [`[authoring] src/kits/fx.json has no '${k}'`]]),
  // With no member list, that member is a core file again — and it links the other kind's member.
  ["a manifest with no 'skills'", { manifest: { skills: undefined } }, [
    "[authoring] src/kits/fx.json has no 'skills'",
    '[authoring] src/skills/fx-skill.md links agents/fx-agent, a kit member — the link dangles when the kit is off']],
  ["a manifest with no 'agents'", { manifest: { agents: undefined } }, [
    "[authoring] src/kits/fx.json has no 'agents'",
    '[authoring] src/agents/fx-agent.md links skills/fx-skill, a kit member — the link dangles when the kit is off']],
  ['rules naming a missing file', { manifest: { rules: 'kits/fx/nope.md' } },
    ["[authoring] src/kits/fx.json: rules 'kits/fx/nope.md' does not exist"]],
  ['a reserved kit id', { files: { 'kits/none.json': JSON.stringify({ ...MANIFEST, skills: [], agents: [], catalogue: {} }) } },
    ["[authoring] src/kits/none.json: kit id 'none' is reserved (reserved: --kits none switches every kit off)"]],
  ['a member in two kits (R3)', {
    files: { 'kits/fy.json': JSON.stringify({ ...MANIFEST, skills: ['fx-skill'], agents: [], catalogue: { skills: [skillRow('fx-skill')] } }) },
  }, ["[authoring] skills/fx-skill is in two kits: 'fx' and 'fy'"]],
  ['a core skill in a kit (R3)', { manifest: { skills: ['fx-skill', 'debug'], catalogue: { ...MANIFEST.catalogue, skills: [...MANIFEST.catalogue.skills, skillRow('debug')] } } },
    ["[authoring] skills/debug is core (AGENT.md.tmpl lists it), but kit 'fx' claims it"]],
  ["a kit file linking another kit's member (R4: links run kit → core only)", {
    files: {
      'kits/fy.json': JSON.stringify({ ...MANIFEST, skills: ['fy-skill'], agents: [], rules: 'kits/fy/rules.md', catalogue: { skills: [skillRow('fy-skill')] } }),
      'kits/fy/rules.md': '### Fy rules\n',
      'skills/fy-skill.md': '# {{SKILL}}: fy-skill\n\n> The second kit skill.\n\nSee [fx-skill]({{DIR_SKILLS}}/fx-skill.md).\n',
    },
    registry: { 'skills/fy-skill': ROW },
  }, ["[authoring] src/skills/fy-skill.md (kit 'fy') links skills/fx-skill, a member of kit 'fx' — links run kit → core only"]],
  ['a core file linking a kit member (R4)', {
    files: { 'skills/debug.md': `${debugMd()}\nSee {{DIR_SKILLS}}/fx-skill.md.\n` },
  }, ['[authoring] src/skills/debug.md links skills/fx-skill, a kit member — the link dangles when the kit is off']],
  ['a stray file directly under kits/ belongs to no kit (R4)', {
    files: { 'kits/README.md': '# Kits\n\nSee {{DIR_SKILLS}}/fx-skill.md.\n' },
  }, ['[authoring] src/kits/README.md links skills/fx-skill, a kit member — the link dangles when the kit is off']],
  ['a member whose spec does not exist', {
    manifest: { agents: ['fx-agent', 'fx-ghost'], catalogue: { ...MANIFEST.catalogue, agents: [...MANIFEST.catalogue.agents, '| [fx-ghost]({{DIR_AGENTS}}/fx-ghost.md) | a row |'] } }, registry: { 'agents/fx-ghost': ROW },
  }, ["[authoring] kit 'fx' lists agents/fx-ghost, but src/agents/fx-ghost.md does not exist"]],
  ['a member with no registry row', { registry: { 'skills/fx-skill': null } },
    ["[authoring] skills/fx-skill (kit 'fx') has no row in registry.json"]],
  ['a catalogue row for a skill the kit does not own (A6)', { manifest: { catalogue: {
    skills: [...MANIFEST.catalogue.skills, '| [debug]({{DIR_SKILLS}}/debug.md) | x |'], agents: MANIFEST.catalogue.agents,
  } } }, ["[authoring] src/kits/fx.json catalogue lists skills/debug, which is not a member of kit 'fx'"]],
  ['a member that is a vendored folder skill', {
    manifest: { skills: ['fx-skill', 'token-report'], catalogue: { ...MANIFEST.catalogue, skills: [...MANIFEST.catalogue.skills, skillRow('token-report')] } },
    registry: { 'skills/token-report': ROW },
  }, [
    "[authoring] kit 'fx' lists token-report, a vendored folder skill; kit members must be flat specs"]],
  ['a catalogue row with a link target that is not the member name', { manifest: { catalogue: { ...MANIFEST.catalogue,
    skills: ['| [fx-skill]({{DIR_SKILLS}}/other.md) | text |'] } } }, [
    "[authoring] src/kits/fx.json catalogue lists skills/other, which is not a member of kit 'fx'",
    "[authoring] src/kits/fx.json catalogue.skills has 0 rows for fx-skill, want exactly one"]],
  ['a catalogue skill row using the agents path', { manifest: { catalogue: { ...MANIFEST.catalogue,
    skills: ['| [fx-skill]({{DIR_AGENTS}}/fx-skill.md) | text |'] } } }, [
    "[authoring] src/kits/fx.json catalogue.skills row is not `| [<member>]({{DIR_SKILLS}}/<member>.md) | <text> |`: | [fx-skill]({{DIR_AGENTS}}/fx-skill.md) | text |",
    "[authoring] src/kits/fx.json catalogue.skills has 0 rows for fx-skill, want exactly one"]],
  ['a catalogue row with no text', { manifest: { catalogue: { ...MANIFEST.catalogue, skills: ['| [fx-skill]({{DIR_SKILLS}}/fx-skill.md) |  |'] } } }, [
    "[authoring] src/kits/fx.json catalogue.skills row is not `| [<member>]({{DIR_SKILLS}}/<member>.md) | <text> |`: | [fx-skill]({{DIR_SKILLS}}/fx-skill.md) |  |",
    "[authoring] src/kits/fx.json catalogue.skills has 0 rows for fx-skill, want exactly one"]],
  ['a member with no catalogue row', { manifest: { catalogue: { skills: [], agents: MANIFEST.catalogue.agents } } },
    ["[authoring] src/kits/fx.json catalogue.skills has 0 rows for fx-skill, want exactly one"]],
  ['a member with two catalogue rows', { manifest: { catalogue: { ...MANIFEST.catalogue,
    skills: [...MANIFEST.catalogue.skills, ...MANIFEST.catalogue.skills] } } },
  ["[authoring] src/kits/fx.json catalogue.skills has 2 rows for fx-skill, want exactly one"]],
  ['a banned string in a skill spec (names file and line)', { manifest: { banned: ['@MockBean'] }, files: {
    'skills/fx-skill.md': `${SKILL_HEAD}Use @MockBean here.\n${SKILL_TAIL}` } },
  ["[authoring] src/skills/fx-skill.md:5 contains '@MockBean', banned by kit 'fx'"]],
  ['a banned string in an agent, a side file and the rules', { manifest: { banned: ['javax.persistence'] }, files: {
    'agents/fx-agent.md': '# {{AGENT}}: fx-agent\n\n> x.\n\nimport javax.persistence.Entity;\nLoad [fx-skill]({{DIR_SKILLS}}/fx-skill.md) first.\n',
    'skills/fx-skill/side.md': 'a\njavax.persistence\n',
    'kits/fx/rules.md': `${RULES}javax.persistence\n` } }, [
    "[authoring] src/kits/fx/rules.md:6 contains 'javax.persistence', banned by kit 'fx'",
    "[authoring] src/skills/fx-skill/side.md:2 contains 'javax.persistence', banned by kit 'fx'",
    "[authoring] src/agents/fx-agent.md:5 contains 'javax.persistence', banned by kit 'fx'"]],
  ['the same fixture without the banned string', { manifest: { banned: ['@MockBean', 'javax.persistence'] } }, []],
  ['a line carrying <!-- banned: ok --> is exempt, the next line without it is not', { manifest: { banned: ['@MockBean'] }, files: {
    'skills/fx-skill.md': `${SKILL_HEAD}| @MockBean | @MockitoBean | <!-- banned: ok -->\n@MockBean again\n${SKILL_TAIL}` } },
  ["[authoring] src/skills/fx-skill.md:6 contains '@MockBean', banned by kit 'fx'"]],
  ['rules over the budget, counted rendered', { manifest: { rulesWordBudget: 10 } },
    ["[authoring] src/kits/fx/rules.md renders to 19 words, over kit 'fx' rulesWordBudget of 10"]],
  ['rules exactly at the budget', { manifest: { rulesWordBudget: 19 } }, []],
];

for (const [name, fault, want] of ROWS) {
  test(`kitProblems: ${name}`, async () => {
    await withSandbox('gskitgate-', (d) => { assert.deepEqual(kitProblems(tree(d, fault)), want); });
  });
}

test('kitProblems: a manifest that does not parse is a problem, not a crash', async () => {
  await withSandbox('gskitgate-', (d) => {
    const got = kitProblems(tree(d, { files: { 'kits/fx.json': '{ nope' } }));
    assert.equal(got.length, 1);
    assert.match(got[0], /^\[authoring\] src\/kits\/fx\.json: /);
  });
});

// The shipped tree has exactly one kit, `spring-boot` (nine members, a registry row each, a catalogue row
// each), and the kit gate reports nothing on it.
test('kitProblems: the shipped tree, which has exactly the spring-boot kit, is clean', async () => {
  assert.deepEqual([...loadKits().keys()], ['spring-boot']);
  assert.deepEqual(kitProblems(), []);
});

test('--exclude-skills accepts a kit skill only kit files link (R5), and keeps core protection', async () => {
  await withSandbox('gskitgate-', (d) => {
    const src = tree(d);
    assert.deepEqual(parseExcludeSkills('fx-skill', src), ['fx-skill']);
    const linked = linkedSkillIds(src);
    assert.ok(!linked.includes('fx-skill'), 'a kit-only link protected its kit skill');
    assert.ok(linked.includes('debug'), 'a core skill linked by core files lost its protection');
    let msg = null;
    try { parseExcludeSkills('council', src); } catch (e) { msg = e.message; }
    assert.match(msg ?? '', /'council' cannot be excluded/);
  });
});

test('a core skill linked only from a kit file stays protected', async () => {
  await withSandbox('gskitgate-', (d) => {
    // `zz-core` is linked by nothing core — only by the kit's rules.md.
    const src = tree(d, {
      files: {
        'skills/zz-core.md': '# {{SKILL}}: zz-core\n\n> core.\n',
        'kits/fx/rules.md': `${RULES}Then [zz-core]({{DIR_SKILLS}}/zz-core.md).\n`,
      },
    });
    assert.ok(linkedSkillIds(src).includes('zz-core'));
  });
});

test('loadKits: a manifest whose banned is not an array of non-empty strings is a loader error naming the file', async () => {
  for (const banned of ['@MockBean', [1], ['']]) {
    await withSandbox('gskitgate-', (d) => {
      assert.throws(() => loadKits(tree(d, { manifest: { banned } })),
        /^Error: src\/kits\/fx\.json: 'banned' must be an array of non-empty strings$/);
    });
  }
});

test('loadKits: only an absent src/kits is "no kits"; a kits path that cannot be read, or a non-object manifest, is an error', async () => {
  await withSandbox('gskitgate-', (d) => {
    assert.equal(loadKits(path.join(d, 'nowhere')).size, 0);
    fs.writeFileSync(path.join(d, 'kits'), 'a file where the folder should be');
    assert.throws(() => loadKits(d), /^Error: src\/kits: /);
    fs.rmSync(path.join(d, 'kits'));
    fs.mkdirSync(path.join(d, 'kits'));
    fs.writeFileSync(path.join(d, 'kits', 'x.json'), '[1]');
    assert.throws(() => loadKits(d), /^Error: src\/kits\/x\.json: a manifest must be a JSON object$/);
  });
});
