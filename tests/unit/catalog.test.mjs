/**
 * `geneseed catalog` — a verb with no oracle, gated absolutely.
 *
 * ⚠ THERE IS NOTHING TO COMPARE IT TO AND THERE NEVER WILL BE. The reference had no `catalog`
 * subcommand: the roster reached a user only through the web console's catalog endpoint or
 * through the full-screen panel, so there is no recorded help text, no acceptance cell, and no
 * way to make either. Every claim here therefore states what the verb DOES rather than that it
 * agrees with something — the discipline `tests/snapshot/cli_help.test.mjs` names for this population.
 *
 * THE RENDERING IS PINNED AS LITERAL LINES, over a fixture inventory this file builds. That is
 * the only form of "absolute" available for a layout: an assertion that the output "contains
 * the agent's name" passes for a column layout that has silently collapsed, and the columns are
 * the entire product here.
 *
 * `GENESEED_TUI_ASCII` IS SET BEFORE THE MODULE LOADS, WHICH IS WHY THE IMPORT IS DYNAMIC. The
 * glyph tier is read once at import time, so a static import would bake whatever tier the
 * developer's terminal implies and the pinned lines would be machine-dependent. Pinning the
 * ASCII tier also gates the tier itself — `@`, `*` and `#` are the ASCII stand-ins, and a
 * rendering that ignored the tier would print emoji here.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

process.env.GENESEED_TUI_ASCII = '1';
const { catalogLines, CATALOG_KINDS } = await import('../../js/catalog.mjs');
const { tuiInventory } = await import('../../js/inventory.mjs');
const { dwidth } = await import('../../js/tui.mjs');

/** A fixture inventory in `tuiInventory`'s shape — one row per section, all fields present. */
const INV = () => ({
  agents: [{ name: 'alpha', desc: 'first', source: '/src/agents/alpha.md', status: 'approved' }],
  skills: [{ name: 'bee', desc: 'second', source: '/src/skills/bee.md', status: 'personal',
    klass: 'ship' }],
  laws: [{ num: 'I', title: 'Sealed', klass: 'security', body: '' }],
  theme: 'neutral',
});

test('the whole roster renders as three labelled, aligned blocks', () => {
  assert.deepEqual(catalogLines(INV(), null, 100), [
    'AGENTS (1)',
    '  @ alpha            approved       first',
    '',
    'SKILLS (1)',
    '  * bee              ship/personal  second',
    '',
    'LAWS (1)',
    '  # Rule I — Sealed  security',
  ]);
  // Every column above is load-bearing and each says something different:
  //   * the heading counts come from `tuiEntries`, so the listing and the panel agree;
  //   * the glyph is the ASCII tier's, so the tier is honoured;
  //   * the name column is one width across ALL THREE sections, which is what makes the badges
  //     line up when the sections are printed together;
  //   * a skill carries category AND status where an agent carries status alone — the catalog
  //     endpoint's own shape;
  //   * a law has no purpose line, so its row ends at the badge with no trailing spaces.
});

test('one section is measured on its own rows, not on the widest law title', () => {
  // The bug this forbids is a gutter: filtering to `agents` while the name column stayed 15
  // wide because a law title elsewhere in the inventory was.
  assert.deepEqual(catalogLines(INV(), 'agents', 100), [
    'AGENTS (1)',
    '  @ alpha  approved  first',
  ]);
  assert.deepEqual(catalogLines(INV(), 'laws', 100), [
    'LAWS (1)',
    '  # Rule I — Sealed  security',
  ]);
});

test('a section with nothing in it renders no heading at all', () => {
  // AN EMPTY LIST, NOT A HEADING OVER NOTHING — which is what lets `cmdCatalog` tell "there is
  // nothing here" apart from "here is a section" and say so on stdout with a non-zero exit.
  const empty = { agents: [], skills: [], laws: [], theme: 'neutral' };
  assert.deepEqual(catalogLines(empty, 'agents', 100), []);
  assert.deepEqual(catalogLines(empty, null, 100), []);
  // …and the control: the same filter over a populated inventory is not empty, so the line
  // above is about the rows and not about the filter refusing everything.
  assert.ok(catalogLines(INV(), 'agents', 100).length > 0);
});

test('the purpose column is cut at the terminal edge and the source column never is', () => {
  const narrow = catalogLines(INV(), 'agents', 30);
  assert.deepEqual(narrow, ['AGENTS (1)', '  @ alpha  approved  first'.slice(0, 30)]);
  for (const line of narrow) assert.ok(line.length <= 30, `"${line}" is wider than 30`);
  // ⚠ THE ONE COLUMN THAT MUST SURVIVE A NARROW TERMINAL. Half a purpose line still reads;
  // half a path is not a path, and the reason to ask for one is to hand it to something else.
  const src = catalogLines(INV(), 'agents', 30, true);
  assert.deepEqual(src, ['AGENTS (1)', '  @ alpha  approved  /src/agents/alpha.md']);
  assert.ok(src[1].length > 30, 'the source column was truncated to the terminal width');
});

test('the name column is measured in display columns, not in code units', () => {
  // `dwidth` is the whole reason the layout helpers were used rather than `padEnd`: a CJK name
  // is two terminal columns per character, and a byte-counted pad puts the badge column of that
  // row two places left of every other one.
  const inv = INV();
  inv.agents = [{ name: '日本', desc: 'wide', source: '/x.md', status: 'approved' },
    { name: 'abcd', desc: 'narrow', source: '/y.md', status: 'approved' }];
  const [, wide, narrow] = catalogLines(inv, 'agents', 100);
  // ⚠ MEASURED IN COLUMNS, WHICH IS THE POINT. `String.prototype.indexOf` answers in CODE
  // UNITS, and `日本` is two of those and four columns — so an index comparison reports the
  // correct layout as broken. The first draft of this test did exactly that. The instrument has
  // to be the same one the code under test uses.
  const columnOf = (line) => dwidth(line.slice(0, line.indexOf('approved')));
  assert.equal(columnOf(wide), columnOf(narrow),
    'the badge column moved between a wide-glyph name and an ASCII one — the pad counted code '
    + 'units instead of terminal columns');
  assert.notEqual(wide.indexOf('approved'), narrow.indexOf('approved'),
    'the two rows agree by code-unit index too, so this fixture no longer contains a character '
    + 'whose width and length differ and the assertion above proves nothing');
});

test('the section names are the endpoint\'s, and the entry dispatches at this module', () => {
  // THE WIRING, plus the one claim that keeps the CLI and the console talking about the same
  // three things: a `catalog` verb whose sections drifted from the endpoint's would be a second
  // vocabulary for one roster.
  assert.deepEqual(Object.keys(CATALOG_KINDS), ['agents', 'skills', 'laws']);
  const table = JSON.parse(readFileSync(path.join(ROOT, 'js', 'cli-table.json'), 'utf8'));
  const cmd = table.commands.find((c) => c.name === 'catalog');
  assert.ok(cmd, 'js/cli-table.json no longer declares `catalog`');
  assert.deepEqual(cmd.positionals[0].choices, Object.keys(CATALOG_KINDS),
    'the table offers different sections than the renderer knows how to filter');
  const src = readFileSync(path.join(ROOT, 'bin', 'geneseed-cli.mjs'), 'utf8');
  assert.match(src, /\n {2}catalog: \{\n {4}fn: cmdCatalog,/,
    "bin/geneseed-cli.mjs's VERBS table no longer routes `catalog` to cmdCatalog");
});

test('the verb runs against the real render and prints one row per entry', () => {
  // THE END-TO-END ARM, and the reason it is not a literal comparison: the roster is `src/`,
  // which moves whenever a skill is added. What is absolute is the RELATIONSHIP — the listing
  // and the walk every other consumer reads must agree on how many agents there are.
  const inv = tuiInventory('neutral');
  assert.ok(inv.agents.length > 3, 'the render produced almost no agents');
  const r = spawnSync(process.execPath,
    [path.join(ROOT, 'bin', 'geneseed-cli.mjs'), 'catalog', 'agents'],
    { cwd: ROOT, encoding: 'utf8', windowsHide: true,
      env: { ...process.env, GENESEED_TUI_ASCII: '1', COLUMNS: '200' } });
  assert.equal(r.status, 0, `catalog agents exited ${r.status}: ${r.stderr}`);
  const lines = r.stdout.split(/\r?\n/).filter(Boolean);
  assert.equal(lines[0], `AGENTS (${inv.agents.length})`);
  assert.equal(lines.length, inv.agents.length + 1,
    'the listing has a different number of rows than the inventory has agents');
  for (const e of inv.agents) {
    assert.ok(lines.some((l) => l.includes(` ${e.name} `) || l.endsWith(` ${e.name}`)),
      `${e.name} is in the inventory and not in the listing`);
  }
});

test('the listing paints nothing', () => {
  // The dropped panel stays dropped. `tests/unit/no_panel.test.mjs` makes this claim for the
  // modules that once had screens; `js/catalog.mjs` is the new consumer of the panel's own
  // layout helpers, so it is the obvious place for one to come back through.
  const src = readFileSync(path.join(ROOT, 'js', 'catalog.mjs'), 'utf8');
  for (const seq of ['\\x1b', '\\u001b', '\\033', '\\e[']) {
    assert.ok(!src.includes(seq), `js/catalog.mjs contains ${seq} — it has grown a panel`);
  }
});
