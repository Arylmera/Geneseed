// THE WEB API'S FUNCTIONS, IN PROCESS — catalog, items, wiki, MCP, drift and restore.
// One of the `web_api*.test.mjs` files split from a single file; shared fixtures live in
// `tests/helpers/web_api_fixture.mjs`.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { apiDiff, apiRecent } from '../../js/web/api.mjs';
import { NotFound, apiCatalog, apiItem, specDesc } from '../../js/web/catalog.mjs';
import { tuiInventory } from '../../js/inspect/inventory.mjs';
import { apiDocsPage, docCounts } from '../../js/web/docs.mjs';
import { apiRestore, apiMcp, apiMemoryDelete } from '../../js/web/actions.mjs';
import { GLOBAL_MANIFEST } from '../../js/hosts/hosts.mjs';
import { JobManager } from '../../js/web/jobs.mjs';
import { diffCollect } from '../../js/inspect/diff.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';
import { webFixtureTeardown } from '../helpers/web_fixture.mjs';
import {
  neutral, FIXTURE, webState, emitInto,
} from '../helpers/web_api_fixture.mjs';

after(webFixtureTeardown);

// ---------------------------------------------------------------------------------------------
// The constitution: ONE section carrying three tiers, and one item arm resolving three address
// shapes off the very same list.

test('the laws section carries all three tiers, in constitutional order', () => {
  const items = apiCatalog(neutral(), 'laws').items;
  const tiers = [...new Set(items.map((i) => i.tier))];
  assert.deepEqual(tiers, ['ontology', 'invariant', 'doctrine'],
    `the tiers are missing or out of order: ${JSON.stringify(tiers)}`);
  const by = (t) => items.filter((i) => i.tier === t);
  assert.equal(by('ontology').length, 5); // 5 since Ownership joined the Credo (2026-10-26)
  assert.equal(by('invariant').length, 9); // 9 since the retired IX and XI were removed (2026-09-30)
  assert.equal(by('doctrine').length, 31); // 31 since comms 5 (2026-10-23)
  // ⚠ THE THREE ADDRESS SHAPES MUST NOT COLLIDE — they share one `type=law` route, so a
  // duplicate name makes one item unreachable.
  assert.equal(new Set(items.map((i) => i.name)).size, items.length, 'two items share a name');
  assert.deepEqual(by('ontology').map((i) => i.name),
    ['ont:telos', 'ont:evidence', 'ont:decisions', 'ont:ownership', 'ont:conduct']);
  assert.deepEqual(by('invariant').map((i) => i.name),
    ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX']);
  assert.ok(by('doctrine').every((i) => /^[a-z]+\.\d+$/.test(i.name)),
    'a doctrine address is not `<pack>.<n>`');
  // A doctrine row carries its pack's header material, so the page groups without a second
  // fetch — and its class IS the pack, not one of the six invariant classes.
  const one = by('doctrine')[0];
  for (const k of ['pack', 'packTitle', 'packDesc', 'active', 'klass']) {
    assert.ok(k in one, `no ${k} on a doctrine row`);
  }
  assert.equal(one.klass, one.pack);
});

test('every catalog address opens, and only those', () => {
  // THE PAIRING IS THE CLAIM. `apiItem` builds the list `apiCatalog` publishes, so a name in
  // the listing always opens and a name outside it always 404s. Two lists would let a row
  // render and then dead-end on click, which is the failure a deep link makes permanent.
  const st = neutral();
  for (const item of apiCatalog(st, 'laws').items) {
    const got = apiItem(st, 'law', item.name);
    assert.equal(got.name, item.name);
    assert.equal(got.tier, item.tier);
    assert.ok(got.body && got.body.length > 20, `${item.name} opened with no body`);
    assert.deepEqual(got.links, [], 'a constitution body was link-resolved');
  }
  for (const bogus of ['ont:nosuch', 'XLII', 'craft.99', 'nosuch.1', '']) {
    assert.throws(() => apiItem(st, 'law', bogus), NotFound, `${bogus} resolved`);
  }
});

test('an inactive pack stays in the payload and says so', () => {
  // A pack that is off must be LISTED and MARKED. Dropping it makes "not built in"
  // indistinguishable from "does not exist", and the console could not then show the command
  // that turns it back on.
  // `state.inventory` is a lazy GETTER, so the override is a spread — which evaluates every
  // other getter into a plain value and leaves the rest of the state intact.
  const st = { ...neutral(), inventory: tuiInventory('neutral', ['craft']) };
  const doctrine = apiCatalog(st, 'laws').items.filter((i) => i.tier === 'doctrine');
  assert.equal(doctrine.length, 31, 'a narrowed install lost rows instead of marking them');
  // craft alone is active, and craft carries 7 rules since craft 7 (one writer per value).
  assert.equal(doctrine.filter((i) => i.active).length, 7);
  assert.ok(doctrine.every((i) => (i.pack === 'craft') === i.active),
    'the active flag does not follow the selection');
  assert.ok(apiItem(st, 'law', 'process.5').body.length > 20,
    'a rule from an inactive pack no longer opens — its text still ships, so it must');
});

test('the doc tokens count each tier separately, and a pack toggle moves only two', () => {
  const st = neutral();
  // ⚠ `{N_LAWS}` MUST STAY THE INVARIANT COUNT — the doctor's FROZEN `proseMirrorProblems`
  // holds README and SHIPPED.md prose to the same number, and it cannot be re-blessed. So the
  // other tiers get their own tokens rather than widening this one.
  assert.deepEqual(docCounts(st), {
    '{N_LAWS}': 9, // the invariants, 9 since IX and XI were removed (2026-09-30)
    '{N_AGENTS}': st.inventory.agents.length,
    '{N_SKILLS}': st.inventory.skills.length,
    '{N_PLUGINS}': docCounts(st)['{N_PLUGINS}'],
    '{N_ONTOLOGY}': 5, // 5 since Ownership joined the Credo (2026-10-26)
    '{N_PACKS}': 5,
    '{N_PACKS_ACTIVE}': 5,
    '{N_DOCTRINE_RULES}': 31,
  });
  // A narrowed install moves the two tokens that describe THIS install and none of the three
  // that describe the catalogue. `{N_PACKS}` is what ships; `{N_PACKS_ACTIVE}` is what binds.
  const narrowed = docCounts({ ...st, inventory: tuiInventory('neutral', ['craft']) });
  assert.equal(narrowed['{N_PACKS_ACTIVE}'], 1);
  assert.equal(narrowed['{N_DOCTRINE_RULES}'], 7); // craft alone: 7 rules
  assert.equal(narrowed['{N_PACKS}'], 5, 'a pack that is off left the catalogue count');
  assert.equal(narrowed['{N_LAWS}'], 9, 'a pack toggle moved the invariant count');
  assert.equal(narrowed['{N_ONTOLOGY}'], 5);
  // ...and a page that spends one really is substituted. `concept` is the only kind
  // `subCounts` runs over, and `rules.md` is the page carrying `{N_LAWS}` today.
  assert.ok(!/\{N_[A-Z_]*\}/.test(apiDocsPage(st, 'rules').body ?? ''),
    'a count token survived substitution on the one page that spends one');
});

test('the glossary names all three tiers, and the Pact says where it now lives', () => {
  // The glossary is the reader's only map of the vocabulary. A constitution split into three
  // tiers whose glossary defines one of them leaves the other two as unexplained nouns in
  // every citation the agent prints.
  const rows = apiDocsPage(neutral(), 'glossary').rows;
  const labels = rows.map((r) => r.label);
  // `Ethos (Ontology)` and `Rule (Law)` carry their old name in the parenthesis because the
  // neutral theme renamed the NOUN a reader sees while the address — `src/ontology/`, the
  // `ONTOLOGY` key, every identifier — did not move. A row that dropped the parenthesis would
  // leave a reader holding a path no glossary entry names.
  for (const label of ['Ethos (Ontology)', 'Rule (Law)', 'Doctrine', 'Doctrines', 'Pact']) {
    assert.ok(labels.includes(label), `the glossary has no ${label} row: ${labels.join(', ')}`);
  }
  // The three tier nouns are THEMED, so each must resolve to its voice rather than print the
  // token — that is what the `neutral`/`themed` columns are for.
  for (const label of ['Ethos (Ontology)', 'Doctrine', 'Doctrines']) {
    const row = rows.find((r) => r.label === label);
    assert.ok(row.themed && !row.themed.includes('{'), `${label} did not resolve: ${row.themed}`);
  }
  assert.match(rows.find((r) => r.label === 'Pact').desc, /Telos/,
    'the Pact still reads as a peer of the Rules — it is a concept inside the Ethos now');
});

// A skill the lifecycle registry never heard of — dropped into the install by hand — must be
// tagged `personal` on BOTH axes. Filing it under the `build` class fallback would claim a
// Geneseed taxonomy slot it was never given.
test('a skill of your own reads personal and keeps out of the taxonomy', () => {
  const mine = path.join(FIXTURE, 'skills', 'my-own-thing');
  fs.mkdirSync(mine, { recursive: true });
  fs.writeFileSync(path.join(mine, 'SKILL.md'), '---\nname: my-own-thing\n---\n\nMine.\n');
  let items;
  try {
    items = apiCatalog(webState('neutral'), 'skills').items;
  } finally {
    fs.rmSync(mine, { recursive: true, force: true });
  }
  const byName = Object.fromEntries(items.map((e) => [e.name, e]));
  assert.equal(byName['my-own-thing'].status, 'personal');
  assert.equal(byName['my-own-thing'].klass, 'personal');
  // A shipped skill next to it is untouched — still classed, still approved. Without this half
  // a classifier that answered `personal` for EVERYTHING would pass the two rows above.
  assert.equal(byName.commit.klass, 'ship');
  assert.equal(byName.commit.status, 'approved');
});

// An alias folder (an old skill name kept answering `/name`, emitted user-only with the
// description "Alias of <target>.") is the target skill under a second name, not a skill of
// the user's own: it must not appear in the roster at all. A user-only skill whose description
// does not start "Alias of " is a real skill and stays.
test('an alias folder is not listed as a skill', () => {
  const alias = path.join(FIXTURE, 'skills', 'old-name');
  const userOnly = path.join(FIXTURE, 'skills', 'user-only-thing');
  fs.mkdirSync(alias, { recursive: true });
  fs.mkdirSync(userOnly, { recursive: true });
  fs.writeFileSync(path.join(alias, 'SKILL.md'),
    '---\nname: old-name\ndescription: "Alias of commit."\ndisable-model-invocation: true\n---\n\nBody.\n');
  fs.writeFileSync(path.join(userOnly, 'SKILL.md'),
    '---\nname: user-only-thing\ndescription: "Mine."\ndisable-model-invocation: true\n---\n\nBody.\n');
  let names;
  try {
    names = apiCatalog(webState('neutral'), 'skills').items.map((e) => e.name);
  } finally {
    fs.rmSync(alias, { recursive: true, force: true });
    fs.rmSync(userOnly, { recursive: true, force: true });
  }
  assert.ok(!names.includes('old-name'), 'the alias folder is listed as a skill');
  assert.ok(names.includes('user-only-thing'), 'a user-only skill of your own was dropped');
  assert.ok(names.includes('commit'), 'the alias target was dropped');
});

test('an item answers with its body and its links', () => {
  const st = neutral();
  const { name } = apiCatalog(st, 'agents').items[0];
  const item = apiItem(st, 'agent', name);
  assert.equal(item.name, name);
  assert.ok(item.body);
  assert.ok(Array.isArray(item.links));
});

// A control character in a name is refused as NotFound before any fs call (SE-8: a NUL threw
// inside fs and surfaced as a 500).
test('a name holding a control character raises NotFound', () => {
  for (const bad of ['a b', 'tab	here', 'del']) {
    assert.throws(() => apiItem(neutral(), 'memory', bad), NotFound, JSON.stringify(bad));
  }
});

test('a missing item raises NotFound', () => {
  assert.throws(() => apiItem(neutral(), 'agent', 'does-not-exist-xyz'), NotFound);
});

// ---------------------------------------------------------------------------------------------
// /api/recent — the dashboard's "freshly grown" card.

// ⚠ THE REGRESSION THIS EXISTS FOR, AND IT SHIPPED FOR AN AFTERNOON. `apiRecent` first asked six
// sections, skills and agents among them. On a real install those two ARE the answer by volume —
// 67 rows against a handful of notes — and their `source` is the EMITTED artefact, so every one
// of them carries the mtime of the last build, to the second. Sorted newest-first they filled the
// whole list with the alphabetical head of the rebuild (`advocate, architect, brainstorm…`) and
// pushed out every genuinely recent note. A live check found it; nothing else could have, which
// is why the claim is written down here.
//
// THE ASSERTION IS THE PARTITION, not the ordering: the fixture is a real emitted install whose
// inventory is full of skills and agents, and none of them may appear.
test('recency answers only the sections a person writes by hand', () => {
  const st = neutral();
  assert.ok(st.inventory.skills.length > 0 && st.inventory.agents.length > 0,
    'the fixture has no skills or agents — this test would pass vacuously');
  const { items, skipped, limit } = apiRecent(st);
  assert.equal(limit, 8);
  assert.deepEqual(items.filter((i) => i.section === 'skills' || i.section === 'agents'), [],
    'a rendered artefact was dated: its mtime belongs to the BUILD, which the overview '
    + 'already states once and correctly as build_time');
  for (const i of items) {
    assert.ok(['memory', 'notebook', 'wiki', 'config'].includes(i.section),
      `unexpected section ${i.section}`);
  }
  assert.ok(Array.isArray(skipped));
});

// Newest first, and the shape each row must carry for the card to build a route out of it.
// Hermetic: three files with mtimes a day apart, written in an order that is NOT the answer, so
// a sort that silently did nothing would come back in creation order and fail.
test('recency sorts newest first and carries a routable name', () => {
  const sb = makeSandbox();
  try {
    const nb = path.join(sb.path, 'notebook');
    fs.mkdirSync(nb);
    const DAY = 86400;
    const now = Math.floor(Date.now() / 1000) - 10;
    // Written oldest-name-first but stamped middle / oldest / newest.
    for (const [name, ago] of [['alpha', 1], ['beta', 2], ['gamma', 0]]) {
      const f = path.join(nb, `${name}.md`);
      fs.writeFileSync(f, `# ${name}
`);
      fs.utimesSync(f, now - ago * DAY, now - ago * DAY);
    }
    const { items } = apiRecent(webState('neutral', sb.path));
    assert.deepEqual(items.map((i) => i.name), ['gamma', 'alpha', 'beta']);
    assert.equal(items[0].type, 'notebook',
      'the row must carry the SINGULAR type: the card builds `#/item/<type>/<name>` from it, '
      + 'and the plural section key resolves to nothing');
    assert.equal(items[0].mtime, now);
  } finally { sb.cleanup(); }
});

// Agents and skills expose their `src/` file too, so the UI shows the real path instead of
// guessing one — uniform with memory/notebook.
test('an agent carries the same source in the catalog and in the item', () => {
  const st = neutral();
  const row = apiCatalog(st, 'agents').items[0];
  assert.ok(fs.statSync(row.source).isFile(), `${row.source} is not a file`);
  assert.equal(apiItem(st, 'agent', row.name).source, row.source);
});

// The detail pane shows where a document lives on disk, so the file-backed branch (shared by
// memory and notebook) must return the absolute, RESOLVED path to the file it read. Driven
// through notebook because its directory hangs off `state.target` and so is hermetic to control.
test('a file-backed item carries the resolved source path', () => {
  const sb = makeSandbox();
  try {
    const nb = path.join(sb.path, 'notebook');
    fs.mkdirSync(nb);
    fs.writeFileSync(path.join(nb, 'ritual.md'), '# Ritual\n');
    const st = webState('neutral', sb.path);

    const item = apiItem(st, 'notebook', 'ritual');
    assert.equal(item.source, fs.realpathSync.native(path.join(nb, 'ritual.md')));
    // The catalog row carries the same source, so the list and the detail pane agree without
    // the UI having to guess the path.
    assert.equal(apiCatalog(st, 'notebook').items[0].source, item.source);
  } finally { sb.cleanup(); }
});

// The console groups the memory list by topic, so each fact row carries the topic the store
// files it under: `topic:`, else `type:` (Claude Code's own shape nests it under `metadata:`),
// else `misc`, slugged to `[a-z0-9-]`. The store's own MEMORY and README rows are not facts and
// carry no topic, which keeps them ungrouped.
test('a memory row carries the topic the store files it under', () => {
  const sb = makeSandbox();
  try {
    const mem = path.join(sb.path, 'memory');
    fs.mkdirSync(mem);
    const write = (n, fm) => fs.writeFileSync(path.join(mem, `${n}.md`), `---\n${fm}\n---\nbody\n`);
    write('a-topic', 'name: A\ntopic: Web UI\ntype: project');
    write('b-type', 'name: B\nmetadata:\n  type: feedback');
    write('c-none', 'name: C\ndescription: none');
    write('d-empty', 'name: D\ntopic: ---');
    fs.writeFileSync(path.join(mem, 'MEMORY.md'), '# Memory Index\n');
    fs.writeFileSync(path.join(mem, 'README.md'), '# Readme\n');
    const st = webState('neutral', sb.path);
    const topics = Object.fromEntries(apiCatalog(st, 'memory').items.map((i) => [i.name, i.topic]));
    assert.deepEqual(topics, {
      'a-topic': 'web-ui', 'b-type': 'feedback', 'c-none': 'misc', 'd-empty': 'misc',
      MEMORY: undefined, README: undefined,
    });
  } finally { sb.cleanup(); }
});

// GET /api/item NEEDS NO TOKEN, so a separator, a `..`, or a drive colon in the name segment was
// an arbitrary-file read: `config` joined `state.target / name` raw, and memory/notebook resolved
// the `..` through the appended `.md`. Every flat-name type must 404 rather than resolve.
test('an item name may not traverse outside its catalog directory', () => {
  const sb = makeSandbox();
  try {
    fs.mkdirSync(path.join(sb.path, 'notebook'));
    fs.writeFileSync(path.join(sb.path, 'secret.txt'), 's3cret');
    const st = webState('neutral', sb.path);
    for (const type of ['notebook', 'memory', 'config']) {
      for (const name of ['../secret.txt', '..\\secret.txt', 'C:evil', 'a/b', '..']) {
        assert.throws(() => apiItem(st, type, name), NotFound,
          `${type}/${JSON.stringify(name)} resolved instead of 404ing`);
      }
    }
  } finally { sb.cleanup(); }
});

// ---------------------------------------------------------------------------------------------
// Purpose derivation for deployed specs: blockquote first, then the frontmatter description,
// then the first prose paragraph — so vendored skills with no blockquote never show a blank
// Purpose.

// THE FRONTMATTER IS A `Map`, NOT AN OBJECT, and that is not a translation detail: the parser
// returns one so the document's key ORDER survives, which a plain object cannot promise for
// integer-like keys. Every case here passes a Map for the same reason the product does.
const fm = (o) => new Map(Object.entries(o));

test('a blockquote wins the purpose', () => {
  assert.equal(specDesc(fm({ description: 'fm desc' }),
    '# Title\n\n> the curated purpose\n\nMore text.'), 'the curated purpose');
});

test('the purpose falls back to the frontmatter description', () => {
  assert.equal(
    specDesc(fm({ description: 'Guide for view\ntransitions' }),
      '# React View Transitions\n\nAnimate between UI states.'),
    'Guide for view transitions');
});

test('the purpose falls back to the first paragraph', () => {
  assert.equal(specDesc(fm({}),
    '# Vault Daydream Skill\n\nMines the vault\nfor connections.\n\n## Usage'),
    'Mines the vault for connections.');
});

// ---------------------------------------------------------------------------------------------
// Diff, and the footprint regression that is the reason this class is not a cell.

// A harness that was just built must report ZERO local edits, at EVERY footprint. The expected
// copy is rendered from the install's own markers — theme, emit and footprint — and getting any
// of the three wrong invents drift the user cannot clear by rebuilding.
//
// THE REGRESSION: footprint was the one not read. Every lean install therefore reported two
// permanent edits — AGENT.md (the terse §1 digest against the inlined full laws) and
// laws/universal.md, which only the lean global emit writes — from the moment it finished
// building.
for (const footprint of ['lean', 'full']) {
  test(`a freshly emitted ${footprint} install shows no drift`, () => {
    const sb = makeSandbox();
    try {
      const cfg = emitInto(path.join(sb.path, 'cfg'), { footprint });
      assert.equal(fs.readFileSync(path.join(cfg, '.geneseed-footprint'), 'utf8').trim(),
        footprint, 'the emit did not record the footprint it was asked for');

      const { files } = diffCollect({ target: cfg });
      const drift = (files || []).filter((f) => f.status !== 'same');
      assert.deepEqual(drift.map((f) => [f.status, f.rel]), [],
        `a just-built ${footprint} install reports drift`);
    } finally { sb.cleanup(); }
  });
}

// Restore renders its expected copy at the install's OWN footprint. Rendered at `full` on a lean
// install it rewrites AGENT.md with the inlined laws and DELETES laws/universal.md — which only
// the lean emit writes — so "discard my local edit" silently converted the install to full.
// `laws/universal.md` is unedited, so the diff does not offer it and naming it is an error.
test('restore keeps a lean install lean', () => {
  const sb = makeSandbox();
  try {
    const cfg = emitInto(path.join(sb.path, 'cfg'), { footprint: 'lean' });
    const agent = path.join(cfg, 'AGENT.md');
    const leanAgent = fs.readFileSync(agent, 'utf8');
    fs.writeFileSync(agent, `${leanAgent}\nlocal edit\n`);

    const res = apiRestore(webState('neutral', cfg), ['AGENT.md', 'laws/universal.md']);

    assert.equal(res.errors.length, 1);
    assert.match(res.errors[0], /^laws\/universal\.md: /);
    assert.deepEqual(res.deleted, [],
      'restore deleted a file the lean emit writes — it rendered at the wrong footprint');
    assert.ok(fs.statSync(path.join(cfg, 'laws', 'universal.md')).isFile());
    assert.equal(fs.readFileSync(agent, 'utf8'), leanAgent,
      'restore did not put the lean AGENT.md back byte for byte');
  } finally { sb.cleanup(); }
});

// Restore renders its expected copy WITHOUT the install's excluded rules. Rendered with them, a
// restored AGENT.md re-states `process 5` while the hooks still lack its gate — prompt and
// boundary disagreeing by a write. The restored file must equal the excluded render byte for byte.
test('restore keeps an excluded rule excluded', () => {
  const sb = makeSandbox();
  try {
    const cfg = emitInto(path.join(sb.path, 'cfg'), { extra: ['--exclude-rules', 'process 5'] });
    const agent = path.join(cfg, 'AGENT.md');
    const built = fs.readFileSync(agent, 'utf8');
    assert.match(built, /^Excluded rules: process 5$/m, 'the emit did not exclude the rule');
    fs.writeFileSync(agent, `${built}
local edit
`);

    const res = apiRestore(webState('neutral', cfg), ['AGENT.md']);

    assert.deepEqual(res.errors, []);
    assert.equal(fs.readFileSync(agent, 'utf8'), built,
      'restore re-admitted the excluded rule into AGENT.md');
  } finally { sb.cleanup(); }
});

test('diff against a directory with no install reports not-deployed', () => {
  const sb = makeSandbox();
  try {
    const res = apiDiff(webState('neutral', sb.path));
    assert.equal(res.deployed, false);
    assert.deepEqual(res.files, []);
  } finally { sb.cleanup(); }
});

// ---------------------------------------------------------------------------------------------
// The wiki.

function wikiFixture() {
  const sb = makeSandbox();
  const vault = path.join(sb.path, 'vault');
  fs.mkdirSync(path.join(vault, 'sub'), { recursive: true });
  fs.mkdirSync(path.join(vault, 'Hidden'));
  fs.writeFileSync(path.join(vault, 'Note.md'), '# Note\nSee [[learn]].');
  fs.writeFileSync(path.join(vault, 'sub', 'Page.md'), '# Page');
  fs.writeFileSync(path.join(vault, 'Hidden', 'Secret.md'), '# Secret');
  const manifest = path.join(sb.path, 'geneseed-wiki.jsonc');
  fs.writeFileSync(manifest, JSON.stringify({
    wikis: [{
      name: 'test',
      path: vault,
      entries: [
        { path: 'Note.md', load: 'eager', description: 'the note' },
        { path: 'sub/', load: 'lazy' },
        { path: 'Hidden/', load: 'exclude' },
      ],
    }],
  }));
  const saved = process.env.GENESEED_WIKI;
  process.env.GENESEED_WIKI = manifest;
  return {
    sb,
    root: sb.path,
    done() {
      if (saved === undefined) delete process.env.GENESEED_WIKI;
      else process.env.GENESEED_WIKI = saved;
      sb.cleanup();
    },
  };
}

test('the wiki catalog lists pages minus the excluded folder', () => {
  const w = wikiFixture();
  try {
    const names = apiCatalog(webState('neutral'), 'wiki').items.map((i) => i.name);
    assert.ok(names.includes('test:Note.md'));
    assert.ok(names.includes('test:sub/Page.md'));
    assert.ok(!names.includes('test:Hidden/Secret.md'),
      'an `exclude` entry was listed — the manifest is advisory rather than enforced');
  } finally { w.done(); }
});

test('a wiki item reads its page and blocks traversal and unknown vaults', () => {
  const w = wikiFixture();
  try {
    const st = webState('neutral');
    const item = apiItem(st, 'wiki', 'test:Note.md');
    assert.match(item.body, /# Note/);
    assert.equal(item.title, 'Note');
    assert.throws(() => apiItem(st, 'wiki', 'test:../geneseed-wiki.jsonc'), NotFound);
    assert.throws(() => apiItem(st, 'wiki', 'nope:Note.md'), NotFound);
  } finally { w.done(); }
});

// The console groups the Knowledge list by vault and routes each row by its own type, so pages
// must be tagged with both.
test('wiki pages carry their group and their type', () => {
  const w = wikiFixture();
  try {
    const rows = apiCatalog(webState('neutral'), 'wiki').items;
    const row = rows.find((i) => i.name === 'test:Note.md');
    assert.equal(row.type, 'wiki');
    assert.equal(row.kind, 'page');
    assert.equal(row.group, 'test');
  } finally { w.done(); }
});

// The setup files render as parsed manifests — cards plus an entries table — not a raw JSON
// dump, so `apiItem` must hand back a structured `manifest`.
test('a config item returns the parsed manifest', () => {
  const w = wikiFixture();
  try {
    fs.writeFileSync(path.join(w.root, 'context.json'), JSON.stringify({
      context: [{ path: 'README.md', load: 'eager', description: 'x' }],
    }));
    const st = webState(null, w.root);

    const ctx = apiItem(st, 'config', 'context.json');
    assert.equal(ctx.title, 'Project context');
    assert.equal(ctx.manifest.kind, 'context');
    assert.equal(ctx.manifest.context[0].load, 'eager');

    const wk = apiItem(st, 'config', 'geneseed-wiki.jsonc');
    assert.equal(wk.manifest.kind, 'wiki');
    assert.equal(wk.manifest.wikis[0].name, 'test');

    // Both surface as Setup manifests in the catalog.
    const rows = Object.fromEntries(apiCatalog(st, 'config').items.map((i) => [i.name, i]));
    assert.equal(rows['context.json'].kind, 'manifest');
    assert.equal(rows['geneseed-wiki.jsonc'].title, 'Wiki manifest');
  } finally { w.done(); }
});

// The manifest was `wiki.jsonc` before the `geneseed-` prefix. In an install not yet re-emitted,
// with $GENESEED_WIKI unset, the console finds it under that name: the Setup list shows it under its
// real name (so it opens), it parses as a wiki, and the Knowledge section lists its pages. With both
// names present, only the new one is listed.
test('the console reads a legacy wiki.jsonc, and prefers the new name', () => {
  const w = wikiFixture();
  const saved = process.env.GENESEED_WIKI;
  try {
    delete process.env.GENESEED_WIKI;
    fs.renameSync(path.join(w.root, 'geneseed-wiki.jsonc'), path.join(w.root, 'wiki.jsonc'));
    const st = webState(null, w.root);
    assert.deepEqual(apiCatalog(st, 'config').items.map((i) => i.name), ['wiki.jsonc']);
    assert.equal(apiItem(st, 'config', 'wiki.jsonc').manifest.kind, 'wiki');
    assert.ok(apiCatalog(st, 'wiki').items.some((i) => i.name === 'test:Note.md'));

    fs.writeFileSync(path.join(w.root, 'geneseed-wiki.jsonc'), '{"wikis": []}');
    assert.deepEqual(apiCatalog(st, 'config').items.map((i) => i.name), ['geneseed-wiki.jsonc']);
    assert.deepEqual(apiCatalog(st, 'wiki').items, []);
  } finally {
    process.env.GENESEED_WIKI = saved;
    w.done();
  }
});

// ---------------------------------------------------------------------------------------------
// MCP — READ-ONLY since 2026-10.
//
// Which servers to wire depends on the user and on the host, so the console shows what each
// active install's config already holds and where it lives, and offers nothing to add or toggle.
// The toggle's tests (allowlist, commented-jsonc refusal, `~/.claude.json` round-trip) went with
// it: there is no writer left to guard. What is left to state is that the listing is EXACTLY the
// config's own servers — no preset row, no `absent` state — and that the POST is gone.

test('the MCP listing carries every active install with its servers', () => {
  // The shared fixture IS an active opencode-global install, which is what makes this
  // structural check hold on any machine.
  const m = apiMcp();
  assert.ok(m.targets.length > 0, 'no active install was listed — the fixture is not active');
  for (const t of m.targets) {
    assert.ok('path' in t);
    assert.ok('commented' in t);
    assert.ok(['opencode', 'claude', 'bob', 'openclaude'].includes(t.host));
    assert.ok('root' in t);
    for (const s of t.servers) {
      assert.ok(['enabled', 'disabled'].includes(s.state),
        `${s.name} is ${s.state}: a server the config does not hold was listed`);
    }
  }
  assert.equal(typeof m.default, 'number');
});

test('the MCP listing is exactly the servers the config holds, with their state', () => {
  // The shared fixture's own config is what the endpoint reads. Saved and restored
  // byte-for-byte — a leaked probe server would follow this process into every later test.
  const before = apiMcp();
  assert.ok(before.targets.length > 0, 'no active install was listed — the fixture is not active');
  const target = before.targets[0];
  assert.equal(target.host, 'opencode', 'the fixture is no longer the opencode install');
  const had = fs.existsSync(target.path);
  const original = had ? fs.readFileSync(target.path) : null;
  try {
    fs.writeFileSync(target.path, JSON.stringify({ mcp: {
      'gs-probe-on': { type: 'local', command: ['x'] },
      'gs-probe-off': { type: 'local', command: ['y'], enabled: false },
    } }));
    const t = apiMcp().targets.find((x) => x.path === target.path);
    assert.ok(t, 'the target disappeared from the listing once it held servers');
    // EXACTLY these two, in file order: no preset row beside them, which is the whole change.
    assert.deepEqual(t.servers, [
      { name: 'gs-probe-on', state: 'enabled' },
      { name: 'gs-probe-off', state: 'disabled' },
    ]);

    // And an empty config lists nothing at all, rather than three presets to Add.
    fs.writeFileSync(target.path, '{}');
    assert.deepEqual(apiMcp().targets.find((x) => x.path === target.path).servers, []);
  } finally {
    if (original === null) fs.rmSync(target.path, { force: true });
    else fs.writeFileSync(target.path, original);
  }
});

// ---------------------------------------------------------------------------------------------
// The memory-delete guard is CASE-FOLDED. On Windows and the default macOS filesystem
// `memory.md` IS `MEMORY.md`, so a guard comparing `MEMORY` exactly let `memory` through and
// deleted the index the agent reads at session start. Every spelling of a reserved name is a
// 404 and leaves both reserved files in place; a real fact is still archived. (On a case-sensitive
// filesystem the lowercase names 404 for a second reason — no such file — and the row still
// holds.)
test('memory delete refuses every case of the reserved names', () => {
  const sb = makeSandbox();
  try {
    const mem = path.join(sb.path, 'memory');
    fs.mkdirSync(mem, { recursive: true });
    fs.writeFileSync(path.join(mem, 'MEMORY.md'), '# Memory Index\n- [a](a.md) — x\n');
    fs.writeFileSync(path.join(mem, 'README.md'), 'the store\n');
    fs.writeFileSync(path.join(mem, 'a.md'), 'a fact\n');
    const st = webState('neutral', sb.path);
    for (const bad of ['MEMORY', 'memory', 'Memory', 'README', 'readme']) {
      assert.throws(() => apiMemoryDelete(st, bad), NotFound, `${bad} was not refused`);
    }
    assert.ok(fs.existsSync(path.join(mem, 'MEMORY.md')), 'the index was deleted');
    assert.ok(fs.existsSync(path.join(mem, 'README.md')), 'the store README was deleted');
    // A real fact is ARCHIVED, not unlinked: it leaves the store's top level for archive/.
    assert.deepEqual(apiMemoryDelete(st, 'a'), { archived: 'a' });
    assert.equal(fs.existsSync(path.join(mem, 'a.md')), false);
    assert.equal(fs.existsSync(path.join(mem, 'archive', 'a.md')), true, 'the fact was not archived');
  } finally { sb.cleanup(); }
});

// `/api/item/config/<name>` is a GET — no token — so it may open only the two manifests the
// catalogue lists. Before the allowlist, any flat top-level name read: the daemon record (which
// carries the CSRF token) and the host's settings.json among them.
test('a config item outside the listed manifests is a 404', () => {
  const sb = makeSandbox();
  try {
    fs.writeFileSync(path.join(sb.path, '.geneseed-web.json'), '{"token":"secret"}');
    fs.writeFileSync(path.join(sb.path, 'settings.json'), '{}');
    fs.writeFileSync(path.join(sb.path, 'context.json'), '{"context":[]}');
    const st = webState('neutral', sb.path);
    for (const name of ['.geneseed-web.json', 'settings.json', 'AGENT.md']) {
      assert.throws(() => apiItem(st, 'config', name), NotFound, `${name} was served`);
    }
    assert.equal(apiItem(st, 'config', 'context.json').name, 'context.json',
      'the control: a listed manifest still opens');
  } finally { sb.cleanup(); }
});

// `deployed` is whether an install is there; `diffable` is whether the drift check can run on
// it. A PROJECT install is the first and not the second (diffCollect re-renders global emits
// only), and the page used to call it "No deployed harness".
test('a project install is deployed but not diffable', () => {
  const sb = makeSandbox();
  try {
    fs.writeFileSync(path.join(sb.path, GLOBAL_MANIFEST),
      JSON.stringify({ scope: 'project', owned: [] }));
    const res = apiDiff(webState('neutral', sb.path));
    assert.equal(res.deployed, true);
    assert.equal(res.diffable, false);
    assert.deepEqual(res.files, []);
  } finally { sb.cleanup(); }
});

// The history FILE was always capped at HISTORY_MAX; the in-memory map was not, so a daemon
// running for weeks kept every job it ever ran. Memory now holds what the file holds, plus any
// running job — which is never dropped, because nothing would then finish it.
test('the job map is trimmed to the persisted history', () => {
  const jm = new JobManager();
  for (let i = 0; i < JobManager.HISTORY_MAX + 5; i += 1) {
    jm._jobs.set(`j${i}`, { id: `j${i}`, action: 'doctor', status: 'done', output: '',
      returncode: 0, started: i, duration: 0 });
  }
  jm._jobs.set('live', { id: 'live', action: 'build', status: 'running', output: '',
    returncode: null, started: 0, duration: null });
  jm._saveHistory();
  assert.equal(jm._jobs.size, JobManager.HISTORY_MAX + 1);
  assert.ok(jm._jobs.has('live'), 'the running job was dropped');
  assert.equal(jm._jobs.has('j4'), false, 'the oldest finished jobs were kept');
  assert.ok(jm._jobs.has(`j${JobManager.HISTORY_MAX + 4}`), 'the newest finished job was dropped');
});
