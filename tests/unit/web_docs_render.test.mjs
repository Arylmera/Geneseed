// The Docs pages a `markdown` page serves are SOURCE files (`src/memory/README.md`,
// `src/notebook/README.md`), written for the build's renderer. The console must render them the
// way an install would: theme words and the DIR_* structure substituted, rule citations named,
// the body's own H1 dropped (MarkdownPage prints the page title), and no link rewritten into a
// GitHub URL for a repo file that does not exist (the READMEs show example links in code spans).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { webFixture } from '../helpers/web_fixture.mjs';
import { webState } from '../../js/web/state.mjs';
import { apiDocs, apiDocsPage } from '../../js/web/docs.mjs';
import { isFile } from '../../js/lib/fs.mjs';
import { ROOT } from '../../js/build/source.mjs';

// The fixture first: a `webState()` with no target resolves to the machine's OpenCode dir.
webFixture();

const HOSTS = ['opencode', 'claude', 'openclaude', 'bob'];
const BLOB = 'https://github.com/Arylmera/Geneseed/blob/main/';

function everyPage(st) {
  const out = [];
  for (const hn of HOSTS) {
    for (const g of apiDocs(st, hn).groups) {
      for (const p of g.pages) out.push([`${hn}/${p.id}`, apiDocsPage(st, p.id, hn)]);
    }
  }
  return out;
}

test('no page serves an unrendered {{token}}', () => {
  const pages = everyPage(webState('neutral'));
  assert.ok(pages.length > 20, `walked only ${pages.length} pages`);
  const leaked = pages.filter(([, d]) => JSON.stringify(d).includes('{{')).map(([k]) => k);
  assert.deepEqual(leaked, []);
});

test('no GitHub link points at a repo file that does not exist', () => {
  const dead = [];
  for (const [k, d] of everyPage(webState('neutral'))) {
    for (const m of (d.body ?? '').matchAll(/\]\(https:\/\/github\.com\/Arylmera\/Geneseed\/blob\/main\/([^)#\s]+)/g)) {
      if (!isFile(path.join(ROOT, m[1]))) dead.push(`${k} -> ${BLOB}${m[1]}`);
    }
  }
  assert.deepEqual(dead, []);
});

test('a markdown page drops its own H1 — the page prints its title', () => {
  for (const id of ['memory', 'notebook']) {
    const d = apiDocsPage(webState('neutral'), id, 'opencode');
    assert.equal(d.kind, 'markdown');
    assert.ok(!/^\s*# /.test(d.body), `${id} opens with: ${d.body.split('\n')[0]}`);
  }
});

// Written out: imperial names memory "Reliquary" and the skill "Rite"; the citation
// `{{LAW:verify-before-asserting}}` renders as its principle in italics, as an install shows it.
test('the deployed theme words and rule names are rendered', () => {
  const imp = apiDocsPage(webState('imperial'), 'memory', 'opencode').body;
  assert.match(imp, /the rule Rite/);
  assert.match(imp, /\*Verify Before Asserting\*/);
  assert.match(imp, /\*Persist Insight\*/);
  const neu = apiDocsPage(webState('neutral'), 'memory', 'opencode').body;
  assert.match(neu, /the rule Skill/);
  assert.match(apiDocsPage(webState('imperial'), 'notebook', 'opencode').body, /Reliquary/);
});
