// Kits through the render — the skip set, the Kits block, the catalogue rows and the marker.
//
// Written out, not recorded. Every case runs on a copy of the shipped `src/` with ONE fixture kit
// planted (`fx`: a skill `fx-skill` with a side file `fx-skill/notes.md`, an agent `fx-agent`, a
// `rules.md` and one catalogue row per table), through the real `renderAll` and the real Claude and
// OpenCode native layers:
//   1. kit off: no member file reaches the bundle or either host, AGENT.md is byte for byte the
//      render of the untouched `src/` (no marker, no block, no row), and `kits/` itself never ships
//   2. kit on: AGENT.md carries the rendered `rules.md` after §2's `Active packs:` line and before
//      §3, the marker line `Active kits: fx` beside the skills catalogue, and the kit's rows in the
//      §3 and §4 tables of the plain bundle; the skill, its side file and the agent land on both
//      hosts and in each host's `owned`, and each host's written carrier (Claude's CLAUDE.md,
//      OpenCode's AGENT.md) holds the same block and marker. Rows reach a host carrier only for a
//      kind the host does not catalogue natively (`hostCatalogsNatively`); Claude and OpenCode
//      catalogue both kinds, so their carriers show the pointer and no kit row
//   3. kit on and `--exclude-skills fx-skill` (spec R5, exclusion wins): the skill, its side file
//      and its catalogue row are gone; the agent, the block and the marker stay
// "Default build unchanged" is proven by the A/B byte check, not here.
// If a rule below is wrong, change the row AND the sentence above it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { emitClaudeRender } from '../../js/build/emit-claude.mjs';
import { emitOpencodeRender } from '../../js/build/emit-opencode.mjs';
import { renderAll } from '../../js/build/render.mjs';
import { SRC, makeCfg } from '../../js/build/source.mjs';
import { hostCatalogsNatively } from '../../js/hosts/hosts.mjs';
import { hookRunnerEntry } from '../../js/hosts/shim.mjs';
import { restoreProcessHome, sandboxProcessHome, withSandbox } from '../helpers/sandbox.mjs';

// FIRST: the emits below write the hook shim into the environment's home.
sandboxProcessHome();
test.after(() => { restoreProcessHome(); });

const SKILL_ROW = '| [fx-skill]({{DIR_SKILLS}}/fx-skill.md) | the fixture kit skill is wanted |';
const AGENT_ROW = '| [fx-agent]({{DIR_AGENTS}}/fx-agent.md) | the fixture kit agent is wanted |';

/** A copy of `src/` with the `fx` kit planted. */
function kitSrc(d) {
  const src = path.join(d, 'src');
  fs.cpSync(SRC, src, { recursive: true });
  const plant = {
    'kits/fx.json': JSON.stringify({
      description: 'Fixture kit', skills: ['fx-skill'], agents: ['fx-agent'], rules: 'kits/fx/rules.md',
      rulesWordBudget: 300, catalogue: { skills: [SKILL_ROW], agents: [AGENT_ROW] },
    }),
    'kits/fx/rules.md': '### Fixture kit\n\nKit rule: read {{DIR_SKILLS}}/fx-skill.md first.\n',
    'skills/fx-skill.md': '# {{SKILL}}: fx-skill\n\n> The fixture kit skill.\n\nSee [notes](fx-skill/notes.md).\n',
    'skills/fx-skill/notes.md': '# fx notes\n\nA side file.\n',
    'agents/fx-agent.md': '# {{AGENT}}: fx-agent\n\n> The fixture kit agent.\n\n## When to dispatch\n- never\n',
  };
  for (const [rel, text] of Object.entries(plant)) {
    fs.mkdirSync(path.dirname(path.join(src, rel)), { recursive: true });
    fs.writeFileSync(path.join(src, rel), text);
  }
  return src;
}

function quiet(fn) {
  const o = process.stdout.write; const e = process.stderr.write;
  process.stdout.write = () => true; process.stderr.write = () => true;
  try { return fn(); } finally { process.stdout.write = o; process.stderr.write = e; }
}

/** Both host native layers into `d`; returns each host's `owned`, its root and its written carrier. */
function emitBoth(cfg, d) {
  const cfgDir = path.join(d, 'claude');
  const claude = quiet(() => emitClaudeRender(cfg, {
    theme: 'neutral', cfgDir, claudeMd: path.join(cfgDir, 'CLAUDE.md'), scope: 'global',
    host: 'claude', out: cfgDir, footprint: 'full', nativeCatalog: hostCatalogsNatively('claude'), oldOwned: [],
    hookOpts: hookRunnerEntry(),
  }));
  const root = path.join(d, 'repo');
  fs.mkdirSync(root, { recursive: true });
  const oc = quiet(() => emitOpencodeRender(cfg, {
    theme: 'neutral', out: path.join(d, 'bundle'), root, footprint: 'full',
    nativeCatalog: hostCatalogsNatively('opencode'), oldOwned: [], manifestExisted: false,
    agentPath: null, oldDenies: [],
  }));
  return {
    claude: { owned: claude.owned, dir: cfgDir, carrier: path.join(cfgDir, 'CLAUDE.md') },
    opencode: { owned: oc.owned, dir: path.join(root, '.opencode'), carrier: path.join(d, 'bundle', 'AGENT.md') },
  };
}

const MEMBER_RELS = ['skills/fx-skill/SKILL.md', 'skills/fx-skill/notes.md', 'agents/fx-agent.md'];
const agentMd = (items) => items.find((i) => i.rel === 'AGENT.md').text;
const MARKER = /^Active kits:[ \t]*(.+?)[ \t]*$/m;

test('kit off: no member, no marker, no block, no row, and kits/ never ships', async () => {
  await withSandbox('gskitr-', (d) => {
    const src = kitSrc(d);
    const cfg = { ...makeCfg(), src };
    const { items } = renderAll(cfg, 'neutral');
    const base = renderAll(makeCfg(), 'neutral');
    // The planted kit vanishes entirely: the same rels and the same AGENT.md as the untouched src.
    assert.deepEqual(items.map((i) => i.rel), base.items.map((i) => i.rel));
    assert.equal(agentMd(items), agentMd(base.items));
    assert.doesNotMatch(agentMd(items), MARKER);
    assert.ok(!agentMd(items).includes('fx-'));
    const hosts = emitBoth(cfg, d);
    for (const [host, { owned, dir }] of Object.entries(hosts)) {
      for (const rel of MEMBER_RELS) {
        assert.ok(!owned.includes(rel), `${host} owns ${rel} with the kit off`);
        assert.ok(!fs.existsSync(path.join(dir, rel)), `${host} wrote ${rel} with the kit off`);
      }
    }
  });
});

test('kit on: block, marker, rows, and every member file on both hosts', async () => {
  await withSandbox('gskitr-', (d) => {
    const src = kitSrc(d);
    const cfg = { ...makeCfg({ kits: ['fx'] }), src };
    const text = agentMd(renderAll(cfg, 'neutral').items);
    // The block: rules.md rendered (its token substituted) after `Active packs:`, before §3.
    const block = text.indexOf('### Fixture kit\n\nKit rule: read skills/fx-skill.md first.\n');
    assert.ok(block > text.indexOf('\nActive packs: '), 'the Kits block is not after Active packs');
    assert.ok(block < text.indexOf('\n## 3. '), 'the Kits block is not before §3');
    // The marker, parsed the way `excludedSkillsOfDir` parses its twin.
    assert.equal(MARKER.exec(text)?.[1], 'fx');
    // The rows, substituted, inside each table (before the section that follows it).
    const agentRow = text.indexOf('| [fx-agent](agents/fx-agent.md) | the fixture kit agent is wanted |\n');
    const skillRow = text.indexOf('| [fx-skill](skills/fx-skill.md) | the fixture kit skill is wanted |\n');
    assert.ok(agentRow > text.indexOf('\n## 3. ') && agentRow < text.indexOf('\n## 4. '), 'agent row not in §3');
    assert.ok(skillRow > text.indexOf('\n## 4. ') && skillRow < text.indexOf('\n## 5. '), 'skill row not in §4');
    // Each row is the LAST row of its table: the line before it is a table row, and the line
    // after it the blank line that ends the table (in §4, before the folder-skills list) —
    // never appended after a bullet list, where it renders as broken markup.
    for (const at of [agentRow, skillRow]) {
      const prev = text.slice(0, at).split('\n').at(-2);
      const next = text.slice(at).split('\n')[1];
      assert.ok(prev.startsWith('| '), `a kit row follows ${JSON.stringify(prev)}, not a table row`);
      assert.equal(next, '', `a kit row is not the end of its table; the next line is ${JSON.stringify(next)}`);
    }
    // Same block at lean: no LEAN halves in a kit's rules.
    assert.ok(agentMd(renderAll(cfg, 'neutral', { footprint: 'lean' }).items)
      .includes('Kit rule: read skills/fx-skill.md first.'));
    const hosts = emitBoth(cfg, d);
    for (const [host, { owned, dir, carrier }] of Object.entries(hosts)) {
      for (const rel of MEMBER_RELS) {
        assert.ok(owned.includes(rel), `${host} does not own ${rel}`);
        assert.ok(fs.existsSync(path.join(dir, rel)), `${host} did not write ${rel}`);
      }
      const written = fs.readFileSync(carrier, 'utf8');
      assert.equal(MARKER.exec(written)?.[1], 'fx', `${host}'s carrier lacks the marker`);
      assert.ok(written.includes('Kit rule: read skills/fx-skill.md first.'), `${host}'s carrier lacks the block`);
      assert.ok(!written.includes('fx-agent') && !written.includes('| [fx-skill]'),
        `${host} catalogues natively, so its carrier holds the pointer, not kit rows`);
    }
    // kits/ is the build's input, never bundle content.
    assert.ok(!renderAll(cfg, 'neutral').items.some((i) => i.rel.startsWith('kits/')));
  });
});

// A project-scope Claude carrier sits one level above `.claude/`, so every DIR_* link it holds
// gains the `.claude/` prefix — the Kits block's links included, or they dangle.
test('kit on, Claude project scope: the block links through .claude/', async () => {
  await withSandbox('gskitr-', (d) => {
    const src = kitSrc(d);
    const proj = path.join(d, 'proj');
    const cfgDir = path.join(proj, '.claude');
    quiet(() => emitClaudeRender({ ...makeCfg({ kits: ['fx'] }), src }, {
      theme: 'neutral', cfgDir, claudeMd: path.join(proj, 'CLAUDE.md'), scope: 'project',
      host: 'claude', out: cfgDir, footprint: 'full', nativeCatalog: hostCatalogsNatively('claude'),
      oldOwned: [], hookOpts: hookRunnerEntry(),
    }));
    const written = fs.readFileSync(path.join(proj, 'CLAUDE.md'), 'utf8');
    assert.ok(written.includes('Kit rule: read .claude/skills/fx-skill.md first.'),
      'the project-scope Kits block kept an unprefixed (dead) link');
    assert.equal(MARKER.exec(written)?.[1], 'fx');
  });
});

// Bob GLOBAL's carrier is `rules/geneseed.md`, one level below the config dir, so the Kits
// block's links reach the skill through `../` — or they dangle.
test('kit on, Bob global scope: rules/geneseed.md links ../skills/fx-skill.md', async () => {
  await withSandbox('gskitr-', (d) => {
    const src = kitSrc(d);
    const cfgDir = path.join(d, 'bob');
    quiet(() => emitClaudeRender({ ...makeCfg({ kits: ['fx'] }), src }, {
      theme: 'neutral', cfgDir, claudeMd: path.join(cfgDir, 'AGENTS.md'), scope: 'global',
      host: 'bob', out: cfgDir, footprint: 'full', nativeCatalog: hostCatalogsNatively('bob'),
      oldOwned: [], hookOpts: hookRunnerEntry(),
    }));
    const written = fs.readFileSync(path.join(cfgDir, 'rules', 'geneseed.md'), 'utf8');
    assert.ok(written.includes('Kit rule: read ../skills/fx-skill.md first.'),
      'the Bob global Kits block does not link ../skills/fx-skill.md');
    assert.equal(MARKER.exec(written)?.[1], 'fx');
  });
});

test('kit on with --exclude-skills fx-skill: only the skill goes (R5)', async () => {
  await withSandbox('gskitr-', (d) => {
    const src = kitSrc(d);
    const cfg = { ...makeCfg({ kits: ['fx'], excludeSkills: ['fx-skill'] }), src };
    const { items } = renderAll(cfg, 'neutral');
    const text = agentMd(items);
    assert.ok(!items.some((i) => i.rel.startsWith('skills/fx-skill')));
    assert.ok(!text.includes('| [fx-skill]('), 'the excluded kit skill kept its row');
    assert.ok(text.includes('| [fx-agent](agents/fx-agent.md) |'));
    assert.ok(text.includes('Kit rule: read skills/fx-skill.md first.'));
    assert.equal(MARKER.exec(text)?.[1], 'fx');
    const hosts = emitBoth(cfg, d);
    for (const [host, { owned }] of Object.entries(hosts)) {
      assert.ok(!owned.some((r) => r.startsWith('skills/fx-skill')), `${host} owns the excluded skill`);
      assert.ok(owned.includes('agents/fx-agent.md'), `${host} dropped the kit agent`);
    }
  });
});
