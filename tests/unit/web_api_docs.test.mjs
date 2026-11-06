// THE WEB API'S FUNCTIONS, IN PROCESS — docs pages, harness markers and doc tables.
// One of the `web_api*.test.mjs` files split from a single file; shared fixtures live in
// `tests/helpers/web_api_fixture.mjs`.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  apiDocs, apiDocsPage, docGroups, docSources, rewriteDocLinks, parseMapTable, parseGlossaryTable, normHarness, stripHarnessBlocks, harnessBlocksBalanced, HOST_FAMILY, HARNESSES, harnessShows,
} from '../../js/web/docs.mjs';
import { HOSTS } from '../../web/src/lib/hosts.js';
import { DOC_FOLDERS } from '../../js/build/source.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';
import { webFixtureTeardown, ROOT } from '../helpers/web_fixture.mjs';
import {
  neutral, 
} from '../helpers/web_api_fixture.mjs';

after(webFixtureTeardown);

// ---------------------------------------------------------------------------------------------
// The Docs Claude/OpenCode selector: page and group tags drop from the menu, inline
// `<!--harness:X-->` blocks strip per host, and malformed markers FAIL OPEN.

test('the harness name defaults and validates', () => {
  const st = neutral();
  for (const host of ['opencode', 'claude', 'openclaude', 'bob']) {
    assert.equal(normHarness(host, st), host);
  }
  // Junk and null fall back to the install's own default rather than throwing.
  assert.ok(['opencode', 'claude', 'openclaude', 'bob'].includes(normHarness('nonsense', st)));
  assert.ok(['opencode', 'claude', 'openclaude', 'bob'].includes(normHarness(null, st)));
});

// With no choice sent, the default is the host the install was emitted for — the host itself,
// not its family: a Bob install opens on Bob's docs. `files` and unknown emits read OpenCode's.
test('the default harness is the emitted host', () => {
  for (const [emit, host] of [['opencode-global', 'opencode'], ['opencode', 'opencode'],
    ['claude-global', 'claude'], ['claude', 'claude'], ['openclaude-global', 'openclaude'],
    ['openclaude', 'openclaude'], ['bob-global', 'bob'], ['bob', 'bob'], ['files', 'opencode'],
    ['', 'opencode']]) {
    assert.equal(normHarness(null, { emit }), host, emit);
  }
});

// The server's family table, and the console's host table naming the same hosts: the
// selector must not offer a host the server cannot file pages for.
test('the docs families match the console host table', () => {
  assert.deepEqual(HOST_FAMILY, { opencode: 'opencode', claude: 'claude', openclaude: 'claude',
    bob: 'claude' });
  assert.deepEqual(HOSTS.map((h) => h.id).sort(), [...HARNESSES].sort());
});

// A tag names a host or the Claude family: `claude` shows to the three Claude-engine hosts, a
// host tag only to that host, `opencode` only to OpenCode. Inline blocks follow the same rule.
test('a harness block shows to its host, and a claude block to the whole family', () => {
  const body = 'shared\n'
    + '<!--harness:claude-->\nfamily\n<!--/harness-->\n'
    + '<!--harness:bob-->\nbob only\n<!--/harness-->\n'
    + '<!--harness:openclaude-->\nopenclaude only\n<!--/harness-->\n'
    + '<!--harness:opencode-->\nopencode only\n<!--/harness-->\ntail';
  const kept = (host) => stripHarnessBlocks(body, host).split('\n');
  assert.deepEqual(kept('opencode'), ['shared', 'opencode only', 'tail']);
  assert.deepEqual(kept('claude'), ['shared', 'family', 'tail']);
  assert.deepEqual(kept('openclaude'), ['shared', 'family', 'openclaude only', 'tail']);
  assert.deepEqual(kept('bob'), ['shared', 'family', 'bob only', 'tail']);
  assert.ok(harnessBlocksBalanced(body.split('\n')));
});

// A LIST names hosts exactly, with no family widening: `claude` inside a list is Claude Code,
// not the family, so `["claude", "openclaude"]` leaves Bob out. A block says the same list as
// `<!--harness:claude,openclaude-->`.
test('a list of hosts shows to exactly those hosts, page or block', () => {
  const shows = (tag) => HARNESSES.filter((h) => harnessShows(tag, h));
  assert.deepEqual(shows(['claude', 'openclaude']), ['claude', 'openclaude']);
  assert.deepEqual(shows(['opencode', 'bob']), ['opencode', 'bob']);
  assert.deepEqual(shows('claude'), ['claude', 'openclaude', 'bob']);
  assert.deepEqual(shows(undefined), ['opencode', 'claude', 'openclaude', 'bob']);
  const body = 'shared\n<!--harness:claude, openclaude-->\n*(Claude Code and OpenClaude only)*\n'
    + 'two hosts\n<!--/harness-->\ntail';
  const kept = (host) => stripHarnessBlocks(body, host).split('\n');
  assert.deepEqual(kept('claude'), ['shared', 'two hosts', 'tail']);
  assert.deepEqual(kept('openclaude'), ['shared', 'two hosts', 'tail']);
  assert.deepEqual(kept('bob'), ['shared', 'tail']);
  assert.deepEqual(kept('opencode'), ['shared', 'tail']);
});

test('each host sees its own machine page, and Bob not the Claude Code one', () => {
  const idsFor = (hn) => new Set(apiDocs(neutral(), hn).groups.flatMap((g) => g.pages.map((p) => p.id)));
  // machine-claude is tagged ["claude", "openclaude"]; machine-opencode `opencode`; machine-bob
  // is untagged (it also covers the plain AGENT.md bundle, whose readers default to the
  // OpenCode docs).
  const want = {
    opencode: ['machine-opencode', 'machine-bob'],
    claude: ['machine-claude', 'machine-bob'],
    openclaude: ['machine-claude', 'machine-bob'],
    bob: ['machine-bob'],
  };
  const all = ['machine-opencode', 'machine-claude', 'machine-bob'];
  for (const [hn, ids] of Object.entries(want)) {
    const vis = idsFor(hn);
    assert.deepEqual(all.filter((id) => vis.has(id)), all.filter((id) => ids.includes(id)), hn);
  }
});

// The Understand track, read top to bottom, per host: the shared pages in `order`, with the
// host's own machine page(s) between "What lands on your machine" and "Taking it back out",
// then the "Why it works this way" section: the design-choices landing page first, its five
// sub-pages after it, every host alike (none of them carries a `harness:` tag).
test('the Understand track reads in order for each host', () => {
  const track = (hn) => apiDocs(neutral(), hn).groups.find((g) => g.id === 'understand')
    .pages.map((p) => p.id);
  const head = ['harness', 'on-your-machine'];
  const tail = ['take-it-out', 'a-day', 'enforced-vs-asked', 'design-choices',
    'design-choices-shape', 'design-choices-gates', 'design-choices-hosts',
    'design-choices-install', 'design-choices-engineering'];
  assert.deepEqual(track('opencode'), [...head, 'machine-opencode', 'machine-bob', ...tail]);
  assert.deepEqual(track('claude'), [...head, 'machine-claude', 'machine-bob', ...tail]);
  assert.deepEqual(track('openclaude'), [...head, 'machine-claude', 'machine-bob', ...tail]);
  assert.deepEqual(track('bob'), [...head, 'machine-bob', ...tail]);
});

test('a harness block keeps the matching host and drops the other', () => {
  const body = 'shared\n'
    + '<!--harness:opencode-->\nopen only\n<!--/harness-->\n'
    + '<!--harness:claude-->\nclaude only\n<!--/harness-->\ntail';
  const oc = stripHarnessBlocks(body, 'opencode');
  const cc = stripHarnessBlocks(body, 'claude');

  assert.match(oc, /open only/);
  assert.ok(!oc.includes('claude only'));
  assert.match(cc, /claude only/);
  assert.ok(!cc.includes('open only'));
  // The markers themselves never survive.
  for (const out of [oc, cc]) {
    assert.ok(!out.includes('<!--harness'));
    assert.ok(!out.includes('<!--/harness'));
  }
});

test('a body with no markers passes through, and a dangling marker fails open', () => {
  assert.equal(stripHarnessBlocks('plain text', 'claude'), 'plain text');
  // An unbalanced marker must NOT blank the tail. Failing closed here would delete the rest
  // of a page over one typo.
  const broken = 'keep me\n<!--harness:claude-->\nand this too';
  assert.equal(stripHarnessBlocks(broken, 'opencode'), broken);
});

// The early-out guard must catch any marker the open regex accepts — odd whitespace included —
// or a stray-spaced marker leaks through unstripped, taking its contents with it.
test('the strip guard is not narrower than its matcher', () => {
  const out = stripHarnessBlocks('A\n<!--  harness:claude  -->\nSECRET\n<!--/harness-->\nB',
    'opencode');
  assert.ok(!out.includes('SECRET'));
  assert.ok(!out.includes('<!--'));
});

// A marker shown as EXAMPLE TEXT inside a fence is not a marker. It must survive verbatim for
// both hosts, fences intact.
test('markers inside a code fence are left alone', () => {
  const body = 'intro\n```\n<!--harness:opencode-->\nexample\n<!--/harness-->\n```\nouter';
  for (const hn of ['opencode', 'claude']) {
    const out = stripHarnessBlocks(body, hn);
    assert.ok(out.includes('<!--harness:opencode-->'), hn);
    assert.match(out, /example/);
    assert.equal((out.match(/```/g) || []).length, 2, hn);
  }
});

test('host-specific pages and groups appear only under their host', () => {
  const idsFor = (hn) => new Set(apiDocs(neutral(), hn).groups.flatMap((g) => g.pages.map((p) => p.id)));
  const oc = idsFor('opencode');
  const cc = idsFor('claude');
  const bob = idsFor('bob');
  const ocl = idsFor('openclaude');
  // A page tagged `harness:` exists for one host only (a how-to that cannot run elsewhere); the
  // four groups are shared, and so are reference pages a reader comparing hosts needs — hooks,
  // LSP and the plugin reference say their host in the title instead.
  for (const id of ['headless', 'worktree']) {
    assert.ok(oc.has(id), `${id} missing under opencode`);
    assert.ok(!cc.has(id), `${id} leaks under claude`);
    assert.ok(!bob.has(id) && !ocl.has(id), `${id} leaks under a Claude-engine host`);
  }
  for (const id of ['hooks', 'lsp', 'opencode-plugins']) {
    assert.ok(oc.has(id) && cc.has(id), `${id} must show under both hosts`);
  }
});

// The console's list groups a part's pages under `● SECTION` headings straight from this
// payload, so every page must carry its section, and one section's pages must arrive together:
// a section split in two would print its heading twice.
test('the docs menu carries each page section, one run per section', () => {
  for (const g of apiDocs(neutral(), 'opencode').groups) {
    const runs = [];
    for (const p of g.pages) {
      assert.ok(typeof p.section === 'string' && p.section, `${p.id} has no section`);
      if (runs.at(-1) !== p.section) runs.push(p.section);
    }
    assert.equal(runs.length, new Set(runs).size, `${g.id}: a section is split in two`);
  }
});

test('the docs endpoint echoes the resolved harness', () => {
  assert.equal(apiDocs(neutral(), 'claude').harness, 'claude');
  assert.equal(apiDocs(neutral(), 'opencode').harness, 'opencode');
  assert.equal(apiDocs(neutral(), 'bob').harness, 'bob');
  assert.equal(apiDocs(neutral(), 'openclaude').harness, 'openclaude');
});

test('a docs page strips for its host', () => {
  const st = neutral();
  // The MCP guide verifies per host; the opencode clause must vanish under claude.
  const oc = apiDocsPage(st, 'mcp', 'opencode').body;
  const cc = apiDocsPage(st, 'mcp', 'claude').body;
  assert.match(oc, /opencode mcp/);
  assert.ok(!cc.includes('opencode mcp'));
  assert.ok(!(oc + cc).includes('<!--harness'));
});

// FAILING OPEN IS WHY THIS CANNOT BE A RENDERING CHECK. An unbalanced marker leaves the body
// untouched — which is exactly what a correct page with no markers does — so the mistake is
// invisible in the output and only the predicate can see it. Catch it here rather than as a
// blank panel, or as a page that quietly shows the other host's text.
test('every doc source and concept body has balanced harness markers', () => {
  let checked = 0;
  for (const g of docGroups()) {
    for (const p of g.pages) {
      let where;
      let text;
      if (p.kind === 'concept') { where = `concept:${p.id}`; text = p.body || ''; } else if (p.kind === 'markdown') {
        where = p.source;
        text = fs.readFileSync(path.join(ROOT, p.source), 'utf8');
      } else continue;
      checked += 1;
      assert.ok(harnessBlocksBalanced(text.split('\n')),
        `unbalanced harness markers in ${where}`);
    }
  }
  assert.ok(checked > 0, 'no doc source was checked — the registry walk found nothing');
});

// The registry lives in `docs/<folder>/` (DOC_FOLDERS) plus `docs/_groups.json` — not in a
// source literal. A group that loses its pages, or a page whose frontmatter stops naming a real
// group, silently VANISHES from the panel. Pin the shape rather than trust the glob.
test('the docs registry loads every page from disk', () => {
  const groups = docGroups();
  assert.ok(groups.length > 0, 'docs registry loaded empty');
  const ids = groups.flatMap((g) => g.pages.map((p) => p.id));
  assert.equal(ids.length, new Set(ids).size, 'duplicate doc page id');

  const onDisk = DOC_FOLDERS.flatMap((d) => {
    const dir = path.join(ROOT, 'docs', d);
    return fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)) : [];
  });
  assert.deepEqual([...ids].sort(), [...onDisk].sort(),
    'every docs/<folder>/*.md must land in exactly one group');

  for (const g of groups) {
    assert.ok(g.pages.length > 0, `group ${g.id} has no pages`);
    assert.ok(g.label, `group ${g.id} has no label`);
  }
});

// Concept bodies carry `{N_LAWS}`/`{N_AGENTS}`/`{N_SKILLS}`, substituted at render time. Moving
// the bodies out of source must not orphan that step: an unsubstituted placeholder renders as
// literal braces on the page.
// THE ID IS THE BASENAME, so the folder a page sits in never reaches the router — and two
// pages sharing a basename in two folders would leave one unreachable. That is a build error,
// not a shadowing.
test('docSources reads every folder and refuses a duplicate id', () => {
  const sb = makeSandbox();
  const root = sb.path;
  try {
    fs.mkdirSync(path.join(root, 'understand'));
    fs.mkdirSync(path.join(root, 'guides'));
    fs.writeFileSync(path.join(root, 'understand', 'harness.md'), '');
    fs.writeFileSync(path.join(root, 'guides', 'install.md'), '');
    assert.deepEqual(docSources(root), [
      { id: 'harness', rel: 'docs/understand/harness.md' },
      { id: 'install', rel: 'docs/guides/install.md' },
    ]);
    fs.writeFileSync(path.join(root, 'understand', 'install.md'), '');
    assert.throws(() => docSources(root), /duplicate docs page id: install/);
  } finally {
    sb.cleanup();
  }
});

test('no unsubstituted count placeholder survives rendering', () => {
  const st = neutral();
  for (const g of docGroups()) {
    for (const p of g.pages) {
      if (p.kind !== 'concept') continue;
      assert.ok(!(apiDocsPage(st, p.id, null).body || '').includes('{N_'),
        `page ${p.id} rendered an unsubstituted placeholder`);
    }
  }
});

// Anti-drift, and the reason it exists: "six plugins" went stale when activity landed. A new
// adapters/opencode/plugins/geneseed-<name>.js must ship its own reference page —
// docs/reference/plugin-<name>.md, titled geneseed-<name> — linked from the plugins overview, and a
// mention in the README and SHIPPED.md rows. One page per plugin (the long overview was split
// into a section), so the gate asks for the page AND the overview's link to it: a page nothing
// links to is a page the overview reader never finds.
function pluginDocProblems(names, pages, overview) {
  const titleById = new Map(pages.map((p) => [p.id, p.title]));
  const out = [];
  for (const name of names) {
    if (titleById.get(`plugin-${name}`) !== `geneseed-${name}`) {
      out.push(`geneseed-${name} has no reference page`);
    } else if (!overview.includes(`](#/docs/plugin-${name})`)) {
      out.push(`geneseed-${name} is not linked from the plugins overview`);
    }
  }
  return out;
}

test('the plugin page gate fails on a missing page, a wrong title and a missing link', () => {
  const pages = [{ id: 'plugin-a', title: 'geneseed-a' }, { id: 'plugin-b', title: 'b' }];
  assert.deepEqual(pluginDocProblems(['a', 'b', 'c'], pages, '[x](#/docs/plugin-a)'), [
    'geneseed-b has no reference page', 'geneseed-c has no reference page']);
  assert.deepEqual(pluginDocProblems(['a'], pages, 'no links'),
    ['geneseed-a is not linked from the plugins overview']);
  assert.deepEqual(pluginDocProblems(['a'], pages, '[x](#/docs/plugin-a)'), []);
});

test('every plugin ships a reference page and its README/SHIPPED rows', () => {
  const st = neutral();
  const pluginDir = path.join(ROOT, 'adapters', 'opencode', 'plugins');
  const names = fs.readdirSync(pluginDir)
    .filter((f) => f.startsWith('geneseed-') && f.endsWith('.js'))
    .map((f) => f.slice('geneseed-'.length, -'.js'.length))
    .sort();
  assert.ok(names.length > 0, 'no plugins found — wrong directory?');

  const overview = apiDocsPage(st, 'opencode-plugins', 'opencode').body;
  const pages = docGroups().flatMap((g) => g.pages);
  assert.deepEqual(pluginDocProblems(names, pages, overview), []);

  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const shipped = fs.readFileSync(path.join(ROOT, 'SHIPPED.md'), 'utf8');
  const row = /plugins \(([^)]*)\)/.exec(shipped);
  assert.ok(row, 'SHIPPED.md lost its plugins (…) list');
  const shippedNames = new Set(row[1].split(',').map((s) => s.trim()));

  for (const name of names) {
    assert.ok(readme.includes(`geneseed-${name}`),
      `geneseed-${name} missing from the README plugins row`);
    assert.ok(shippedNames.has(name), `'${name}' missing from the SHIPPED.md plugins list`);
  }
  assert.deepEqual([...shippedNames].sort(), names,
    'SHIPPED.md plugins list is out of sync with adapters/opencode/plugins/');
});

// Counts in concept prose are `{N_*}` placeholders resolved from the SAME inventory the rail
// uses — never hardcoded numbers.
// The Docs page shows every host's pages: a host filter it could not undo would strand a page.
test('the whole menu lists every host\'s pages, each naming its hosts', () => {
  const st = neutral();
  const rows = (h) => apiDocs(st, h).groups.flatMap((g) => g.pages);
  const whole = rows('all');
  assert.ok(whole.length > rows('claude').length, 'the filter hides nothing, so this proves nothing');
  // No one host sees all of these, so a filtered menu cannot pass.
  for (const id of ['headless', 'machine-opencode', 'machine-claude', 'machine-bob']) {
    assert.ok(whole.some((p) => p.id === id), `${id} is not in the whole menu`);
  }
  const oc = whole.find((p) => p.id === 'machine-opencode');
  assert.deepEqual(oc.hosts, ['opencode']);
  assert.equal(oc.varies, true);
});

test('concept counts are substituted live from the inventory', () => {
  const st = neutral();
  const inv = st.inventory;
  for (const hn of ['opencode', 'claude', 'openclaude', 'bob']) {
    for (const g of apiDocs(st, hn).groups) {
      for (const p of g.pages) {
        const body = apiDocsPage(st, p.id, hn).body || '';
        assert.ok(!body.includes('{N_'), `${hn}/${p.id} leaked a placeholder`);
      }
    }
  }
  assert.match(apiDocsPage(st, 'skills', 'opencode').body,
    new RegExp(String(inv.skills.length)));
  assert.match(apiDocsPage(st, 'rules', 'opencode').body,
    new RegExp(String(inv.laws.length)));
});

// Every `#/docs/<id>` link in a VISIBLE page must resolve to a page visible under the SAME
// harness — no link dead-ends after filtering.
test('no cross-harness dead links', () => {
  const st = neutral();
  const dead = [];
  for (const hn of ['opencode', 'claude', 'openclaude', 'bob']) {
    const menu = apiDocs(st, hn);
    const visible = new Set(menu.groups.flatMap((g) => g.pages.map((p) => p.id)));
    for (const g of menu.groups) {
      for (const p of g.pages) {
        const body = apiDocsPage(st, p.id, hn).body || '';
        for (const target of new Set([...body.matchAll(/#\/docs\/([a-z0-9-]+)/g)]
          .map((m) => m[1]))) {
          if (!visible.has(target)) dead.push(`${hn}: ${p.id} -> ${target}`);
        }
      }
    }
  }
  assert.deepEqual(dead, [], 'a page links to a page its host hides');
});

// ---- docs tables and links ------------------------------------------------------------------

// A relative `.md` link is how a page links on GitHub. In the console a docs page becomes its
// route (anchor dropped: the console addresses pages, not headings), any other repo file opens
// on GitHub with its anchor kept, and absolute URLs and fenced examples are never touched.
test('rewriteDocLinks turns relative .md links into console routes or GitHub links', () => {
  const ids = new Map([['docs/concepts/rules.md', 'rules']]);
  const from = 'docs/guides/install.md';
  const cases = [
    ['[r](../concepts/rules.md)', '[r](#/docs/rules)'],
    ['[r](../concepts/rules.md#lean)', '[r](#/docs/rules)'],
    ['[e](../extending.md#two)',
      '[e](https://github.com/Arylmera/Geneseed/blob/main/docs/extending.md#two)'],
    ['[x](https://example.com/a.md)', '[x](https://example.com/a.md)'],
    ['[h](#on-this-page)', '[h](#on-this-page)'],
    ['```\n[r](../concepts/rules.md)\n```', '```\n[r](../concepts/rules.md)\n```'],
  ];
  for (const [body, want] of cases) assert.equal(rewriteDocLinks(body, from, ids), want, body);
});

// The map on understand page 2 is a table a GitHub reader reads as-is; the console builds the
// clickable view from the same rows. A missing column, a ragged row, or a kind outside the four
// the view has a chip for is a malformed map, and the answer is null rather than a guess.
test('parseMapTable reads the map rows and refuses a malformed table', () => {
  const head = '| Piece | What it does for you | Kind | Cost | Turn it off |\n|---|---|---|---|---|\n';
  const body = `Intro prose.\n\n${head}`
    + '| `AGENT.md` | The rules, loaded every session | asked | ~4k tokens | `--footprint lean` |\n'
    + '| tool-gate hook | Stops force-push and leaked secrets | Enforced | ~14 ms / call | drop the process pack |\n';
  assert.deepEqual(parseMapTable(body), [
    { piece: '`AGENT.md`', does: 'The rules, loaded every session', kind: 'asked',
      cost: '~4k tokens', off: '`--footprint lean`' },
    { piece: 'tool-gate hook', does: 'Stops force-push and leaked secrets', kind: 'enforced',
      cost: '~14 ms / call', off: 'drop the process pack' },
  ]);
  assert.equal(parseMapTable('| Piece | Cost |\n|---|---|\n| a | b |\n'), null);
  assert.equal(parseMapTable(`${head}| a | b | maybe | c | d |\n`), null);
  assert.equal(parseMapTable(`${head}| a | b | asked |\n`), null);
});

// The glossary moved from a source literal into docs/reference/glossary.md so GitHub readers get
// it too. `—` in the theme-key column means no theme renames the term; in the analogy column it
// means there is no analogy worth giving.
test('parseGlossaryTable reads term, theme key, meaning and analogy', () => {
  const body = '| Term | Theme key | Meaning | In dev terms |\n|---|---|---|---|\n'
    + '| Skill | SKILL | a repeatable workflow | a runbook |\n'
    + '| Tagline | TAGLINE | the theme in one line | — |\n'
    + '| Hook | — | a command run around an agent action | a git hook |\n';
  assert.deepEqual(parseGlossaryTable(body), [
    { label: 'Skill', key: 'SKILL', desc: 'a repeatable workflow', analogy: 'a runbook' },
    { label: 'Tagline', key: 'TAGLINE', desc: 'the theme in one line', analogy: null },
    { label: 'Hook', key: null, desc: 'a command run around an agent action',
      analogy: 'a git hook' },
  ]);
  assert.deepEqual(parseGlossaryTable('no table here'), []);
});

// The `*(OpenCode only)*` line under a marker is for GitHub, which hides the marker. The console
// has already filtered the block to the reader's host, so the label goes with the marker — but
// only in that slot: the same words anywhere else in a page are prose, and stay.
test('stripHarnessBlocks drops the host label that opens a kept block', () => {
  const body = 'intro\n<!--harness:claude-->\n*(Claude Code only)*\nhooks\n<!--/harness-->\n'
    + '<!--harness:opencode-->\n*(OpenCode only)*\nplugins\n<!--/harness-->\n*(OpenCode only)*\n';
  assert.equal(stripHarnessBlocks(body, 'claude'), 'intro\nhooks\n*(OpenCode only)*');
  assert.equal(stripHarnessBlocks(body, 'opencode'), 'intro\nplugins\n*(OpenCode only)*');
});
