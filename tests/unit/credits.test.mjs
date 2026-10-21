/**
 * Upstream credits — the `{{CREDIT:<key>:<path>}}` token and the licence copy it carries.
 *
 * Four properties, each written out rather than recorded:
 *   1. a known key renders one exact attribution line, built from its `src/upstreams.json` entry
 *   2. an unknown key stays literal, so the doctor can name it — `constructor` included, which
 *      is a key of every plain object's prototype
 *   3. `renderAll` adds ONE `skills/<stem>/LICENSE-<key>.txt` per (skill, key) whose entry has a
 *      `licenseFile`: however many of the skill's files carry the token, none for an entry
 *      without one, none for an agent (its line carries the URL)
 *   4. END TO END, through a real Claude emit: the copy lands beside the skill's SKILL.md byte for
 *      byte, and the install manifest's `owned` lists it, so prune and uninstall track it
 *   5. the two third-party vendored folders credit their upstream in VENDOR.md (user rule R2: an
 *      install names where every import came from), and get NO licence copy — they ship the
 *      upstream's own LICENSE verbatim.
 *   6. the shipped `src/` credits exactly the retro-credit list (docs/specs/2026-10-19-retro-credits.md
 *      in the main repo) plus later ports: the two VENDOR.md files plus 21 adapted files —
 *      the list's 19, then skill-forge and wiki (2026-10-21) — and one licence copy per
 *      (skill, key) among them.
 *
 * 3 and 4 run on a copy of `src/` with daydream tokens planted, and look only at the planted keys;
 * 5 and 6 run on the shipped `src/`.
 * If a rule below is wrong, change the row AND the sentence above it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { emitClaudeRender } from '../../js/build/emit-claude.mjs';
import { renderAll } from '../../js/build/render.mjs';
import { SRC, makeCfg, resolveCredits } from '../../js/build/source.mjs';
import { hookRunnerEntry } from '../../js/hosts/shim.mjs';
import { checkBuild } from '../../js/inspect/checks-build.mjs';
import { creditProblems } from '../../js/inspect/checks-repo.mjs';
import { restoreProcessHome, sandboxProcessHome, withSandbox } from '../helpers/sandbox.mjs';

sandboxProcessHome();
test.after(() => { restoreProcessHome(); });

const DAYDREAM_LINE = '*Adapted from [glebis/claude-skills](https://github.com/glebis/claude-skills) '
  + '(`skills/daydream/SKILL.md`) by Gleb Kalinin — MIT, modified.*';

test('a known key renders the exact attribution line', () => {
  assert.equal(resolveCredits('{{CREDIT:daydream:skills/daydream/SKILL.md}}\n'), `${DAYDREAM_LINE}\n`);
  // An entry without a licence file still renders its line: the line is the credit.
  assert.equal(resolveCredits('{{CREDIT:react-view-transitions:skills/react-view-transitions/SKILL.md}}'),
    '*Adapted from [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) '
    + '(`skills/react-view-transitions/SKILL.md`) by Vercel Engineering — MIT, modified.*');
});

test('an unknown key stays literal', () => {
  for (const t of ['{{CREDIT:nope:a/b.md}}', '{{CREDIT:constructor:a.md}}', 'no token here']) {
    assert.equal(resolveCredits(t), t);
  }
});

/** A copy of `src/` with the daydream token on debug's spec AND its side file, and on an agent. */
function plantedSrc(d) {
  const src = path.join(d, 'src');
  fs.cpSync(SRC, src, { recursive: true });
  const token = '\n{{CREDIT:daydream:skills/daydream/SKILL.md}}\n';
  for (const f of ['skills/debug.md', 'skills/debug/ci.md', 'agents/reviewer.md']) {
    fs.appendFileSync(path.join(src, f), token);
  }
  fs.appendFileSync(path.join(src, 'skills/plan.md'),
    '\n{{CREDIT:react-view-transitions:skills/react-view-transitions/SKILL.md}}\n');
  return src;
}

test('renderAll adds one licence copy per credited skill whose entry has a licence file', async () => {
  await withSandbox('gscredit-', (d) => {
    const src = plantedSrc(d);
    const { items } = renderAll({ ...makeCfg(), src }, 'neutral');
    // Only the planted keys: the shipped skills' own credits are property 6's.
    assert.deepEqual(items.filter((i) => /LICENSE-(daydream|react-view-transitions)\./.test(i.rel))
      .map((i) => i.rel), ['skills/debug/LICENSE-daydream.txt']);
    const lic = items.find((i) => i.rel === 'skills/debug/LICENSE-daydream.txt');
    assert.equal(lic.text, null, 'a licence is copied, not rendered');
    assert.equal(lic.src, path.join(src, 'skills', 'daydream', 'LICENSE'));
    assert.ok(items.find((i) => i.rel === 'skills/debug.md').text.includes(DAYDREAM_LINE));
  });
});

test('a Claude emit writes the licence copy byte for byte and owns it', async () => {
  await withSandbox('gscredit-', (d) => {
    const src = plantedSrc(d);
    const cfgDir = path.join(d, 'claude');
    const o = process.stdout.write;
    process.stdout.write = () => true;
    let owned;
    try {
      ({ owned } = emitClaudeRender({ ...makeCfg(), src }, {
        theme: 'neutral', cfgDir, claudeMd: path.join(cfgDir, 'CLAUDE.md'), scope: 'global',
        host: 'claude', out: cfgDir, footprint: 'full', nativeCatalog: true, oldOwned: [],
        hookOpts: hookRunnerEntry(),
      }));
    } finally { process.stdout.write = o; }
    assert.ok(owned.includes('skills/debug/LICENSE-daydream.txt'), 'the licence copy is not owned');
    assert.ok(fs.readFileSync(path.join(cfgDir, 'skills', 'debug', 'LICENSE-daydream.txt'))
      .equals(fs.readFileSync(path.join(src, 'skills', 'daydream', 'LICENSE'))));
    assert.deepEqual(fs.readdirSync(path.join(cfgDir, 'agents')).filter((f) => /LICENSE/.test(f)), []);
  });
});

// ---------------------------------------------------------------------------------------------
// THE DOCTOR ARMS. `creditProblems` refuses every way a credit can ship wrong, each row a fault
// planted on the same clean fixture tree with its message written out: a token whose key
// `upstreams.json` lacks (the gate itself: delete one key, it must go red), an entry nothing
// credits, a licence file that is not there (the emit would throw ENOENT mid-build), a commit
// that is not a 40-hex sha or is a moving branch, and a token in a file the licence copy is
// never derived for (a `_` partial is included into other files, so its credit would ship
// without the licence). Then `checkBuild` names a token that survived the render.

/** A clean credit tree: alpha credited by a skill token, beta by a VENDOR.md key. */
const ENTRY = (over = {}) => ({ repo: 'o/a', commit: 'a'.repeat(40), author: 'A', license: 'MIT',
  licenseFile: null, ...over });
function creditTree(d, { entries = (e) => e, files = {} } = {}) {
  const src = path.join(d, 'src');
  const base = { alpha: ENTRY({ licenseFile: 'licenses/alpha.txt' }), beta: ENTRY() };
  const plant = {
    'upstreams.json': JSON.stringify(entries(base)),
    'licenses/alpha.txt': 'MIT\n',
    'skills/one.md': '# one\n{{CREDIT:alpha:skills/x.md}}\n',
    'skills/vend/VENDOR.md': '- **Upstream key:** beta\n',
    ...files,
  };
  for (const [rel, text] of Object.entries(plant)) {
    fs.mkdirSync(path.dirname(path.join(src, rel)), { recursive: true });
    fs.writeFileSync(path.join(src, rel), text);
  }
  return src;
}

const CREDIT_ROWS = [
  ['the clean fixture', {}, []],
  // A second pin of one repo (a later commit for skills the first pin predates) points at the
  // SAME licence file: two keys sharing one licenseFile is clean, not a duplicate.
  ['two keys sharing one licenseFile',
    { entries: (e) => ({ ...e, alpha2: ENTRY({ commit: 'b'.repeat(40), licenseFile: 'licenses/alpha.txt' }) }),
      files: { 'skills/two.md': '# two\n{{CREDIT:alpha2:skills/y.md}}\n' } },
    []],
  ['a key deleted from upstreams.json', { entries: ({ alpha, ...rest }) => rest },
    ["[authoring] skills/one.md credits 'alpha', which src/upstreams.json does not define"]],
  ['an entry nothing credits', { entries: (e) => ({ ...e, gamma: ENTRY() }) },
    ["[authoring] src/upstreams.json entry 'gamma' is credited by no {{CREDIT:}} token and no VENDOR.md"]],
  ['a licenseFile that does not exist',
    { entries: (e) => ({ ...e, alpha: ENTRY({ licenseFile: 'licenses/gone.txt' }) }) },
    ["[authoring] src/upstreams.json entry 'alpha' names licenseFile 'licenses/gone.txt', which does not exist under src/"]],
  ['a moving-branch commit', { entries: (e) => ({ ...e, beta: ENTRY({ commit: 'main' }) }) },
    ["[authoring] src/upstreams.json entry 'beta' pins 'main', a moving branch — record the commit sha instead"]],
  ['a short commit', { entries: (e) => ({ ...e, beta: ENTRY({ commit: 'abc1234' }) }) },
    ["[authoring] src/upstreams.json entry 'beta' pin 'abc1234' is not a 40-character commit sha"]],
  ['a token in an included partial', { files: { 'skills/_partial.md': '{{CREDIT:alpha:x.md}}\n' } },
    ['[authoring] skills/_partial.md carries a {{CREDIT:}} token, but only skills/<stem>.md, '
      + 'skills/<stem>/*.md and agents/*.md may — the licence copy is derived for those alone']],
  // A `_` side file in a skill folder is a partial too, though its folder is creditable.
  ['a token in a skill folder partial', { files: { 'skills/one/_x.md': '{{CREDIT:alpha:x.md}}\n' } },
    ['[authoring] skills/one/_x.md carries a {{CREDIT:}} token, but only skills/<stem>.md, '
      + 'skills/<stem>/*.md and agents/*.md may — the licence copy is derived for those alone']],
  // Spec P3: the licence text ships with the work. A null licenseFile is for a key credited
  // from a vendored folder alone (it ships the upstream LICENSE); a skill token needs a file.
  ['a null licenseFile credited outside a vendored folder',
    { files: { 'skills/two.md': '# two\n{{CREDIT:beta:skills/y.md}}\n' } },
    ["[authoring] src/upstreams.json entry 'beta' has licenseFile null, but skills/two.md credits it "
      + 'outside a vendored folder — its licence text must ship with the work']],
  ['an entry missing repo', { entries: (e) => ({ ...e, beta: { ...ENTRY(), repo: undefined } }) },
    ["[authoring] src/upstreams.json entry 'beta' has no 'repo'"]],
  ['an entry missing author', { entries: (e) => ({ ...e, beta: { ...ENTRY(), author: '' } }) },
    ["[authoring] src/upstreams.json entry 'beta' has no 'author'"]],
  ['an entry missing license', { entries: (e) => ({ ...e, beta: { ...ENTRY(), license: undefined } }) },
    ["[authoring] src/upstreams.json entry 'beta' has no 'license'"]],
  ['a licenseFile outside src/', { entries: (e) => ({ ...e, alpha: ENTRY({ licenseFile: '../outside.txt' }) }),
    files: { '../outside.txt': 'MIT\n' } },
    ["[authoring] src/upstreams.json entry 'alpha' names licenseFile '../outside.txt', which resolves outside src/"]],
  ['an upstreams.json that is not JSON', { files: { 'upstreams.json': '{' } },
    ['[authoring] src/upstreams.json is not valid JSON']],
];

for (const [name, fault, expected] of CREDIT_ROWS) {
  test(`creditProblems: ${name}`, async () => {
    await withSandbox('gscredit-', (d) => {
      assert.deepEqual(creditProblems(creditTree(d, fault)), expected);
    });
  });
}

test('creditProblems: the shipped src is clean', () => {
  assert.deepEqual(creditProblems(), []);
});

test('checkBuild names a credit token that survived the render', async () => {
  await withSandbox('gscredit-', (d) => {
    fs.writeFileSync(path.join(d, 'a.md'), 'x {{CREDIT:nope:a.md}} y\n');
    assert.deepEqual(checkBuild('files', d), ['[files] unresolved token {{CREDIT:nope:a.md}} in a.md']);
  });
});

// ---------------------------------------------------------------------------------------------
// THE VENDORED FOLDERS' CREDITS (property 5), on the shipped `src/`.

const VENDOR_LINES = {
  'skills/daydream/VENDOR.md': '*Adapted from [glebis/claude-skills](https://github.com/glebis/claude-skills) '
    + '(`daydream`) by Gleb Kalinin — MIT, modified.*',
  'skills/react-view-transitions/VENDOR.md': '*Adapted from [vercel-labs/agent-skills]'
    + '(https://github.com/vercel-labs/agent-skills) (`skills/react-view-transitions`) '
    + 'by Vercel Engineering — MIT, modified.*',
};

/** Property 6: the files the retro-credit list gives a token, by key. */
const MP = 'mattpocock-skills';
const SP = 'superpowers';
const RETRO_CREDITED = {
  'agents/reviewer.md': [SP],
  'skills/brainstorm.md': [SP, MP],
  'skills/brainstorm/builder-check.md': [SP],
  'skills/codebase-design.md': [MP],
  'skills/debug.md': [SP, MP],
  'skills/develop.md': [MP],
  'skills/geneseed-code-review.md': [MP, SP],
  'skills/git-history.md': ['mattpocock-skills-frozen'],
  'skills/handoff.md': [MP],
  'skills/learn-mode.md': ['vibe-wise'],
  'skills/parallel-agents.md': [SP, MP],
  'skills/pipeline.md': [SP],
  'skills/plan.md': [SP, MP],
  'skills/prototype.md': [MP],
  'skills/research.md': [MP],
  'skills/review-response.md': [SP],
  'skills/rule.md': ['mattpocock-skills-2509'],
  'skills/ship.md': ['mattpocock-skills-2509'],
  'skills/skill-forge.md': [MP],
  'skills/wayfinder.md': [MP],
  'skills/wiki.md': [MP],
};

test('the shipped render credits the vendored VENDOR.md files and the retro-credit list', () => {
  const { items } = renderAll(makeCfg(), 'neutral');
  const credited = items.filter((i) => i.text?.includes('*Adapted from ['));
  assert.deepEqual(credited.map((i) => i.rel).sort(),
    [...Object.keys(VENDOR_LINES), ...Object.keys(RETRO_CREDITED)].sort());
  for (const rel of Object.keys(VENDOR_LINES)) {
    assert.ok(credited.find((i) => i.rel === rel).text.includes(VENDOR_LINES[rel]), rel);
  }
  // One copy per (skill, key): a skill's side file adds none, an agent gets none (its line
  // carries the URL), and a vendored stem gets none though daydream's entry has a licenseFile.
  const want = new Set();
  for (const [rel, keys] of Object.entries(RETRO_CREDITED)) {
    if (!rel.startsWith('skills/')) continue;
    for (const k of keys) want.add(`skills/${rel.split('/')[1].replace(/\.md$/, '')}/LICENSE-${k}.txt`);
  }
  assert.deepEqual(items.filter((i) => /LICENSE-/.test(i.rel)).map((i) => i.rel).sort(), [...want].sort());
  // The second mattpocock pin shares the first one's licence file: one copy per key, one text.
  const shipLic = items.find((i) => i.rel === 'skills/ship/LICENSE-mattpocock-skills-2509.txt');
  assert.equal(path.resolve(shipLic.src), path.resolve(makeCfg().src, 'licenses', 'mattpocock-skills.txt'));
});

test('a Claude emit installs the vendored VENDOR.md with its rendered credit line', async () => {
  await withSandbox('gscredit-', (d) => {
    const cfgDir = path.join(d, 'claude');
    const o = process.stdout.write;
    process.stdout.write = () => true;
    try {
      emitClaudeRender(makeCfg(), {
        theme: 'neutral', cfgDir, claudeMd: path.join(cfgDir, 'CLAUDE.md'), scope: 'global',
        host: 'claude', out: cfgDir, footprint: 'full', nativeCatalog: true, oldOwned: [],
        hookOpts: hookRunnerEntry(),
      });
    } finally { process.stdout.write = o; }
    for (const [rel, line] of Object.entries(VENDOR_LINES)) {
      const text = fs.readFileSync(path.join(cfgDir, rel), 'utf8');
      assert.ok(text.includes(line), `${rel} lacks its credit line`);
      assert.ok(!text.includes('{{CREDIT:'), `${rel} kept a raw token`);
      const dir = path.dirname(path.join(cfgDir, rel));
      assert.deepEqual(fs.readdirSync(dir).filter((f) => /^LICENSE-/.test(f)), [], `${dir} got a licence copy`);
    }
  });
});
