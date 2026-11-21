// O9 (spec 2026-11-21-memory-load-and-dedupe): the BM25 search behind learn's ALREADY STORED list and
// its near-duplicate guard. Every expected value is written out with the sentence that defends it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from '../helpers/sandbox.mjs';
import {
  DUPLICATE_SIMILARITY, RECENT_FACTS, nearestFact, pickStored, rankFacts, tokenize,
} from '../../js/hosts/memory-search.mjs';
import { readFacts, writeMemories } from '../../js/hosts/memory-files.mjs';
import { buildLearnPrompt } from '../../js/hosts/hooks-learn.mjs';

const withDir = (fn) => {
  const sb = makeSandbox('mem-search-');
  try { return fn(sb.path); } finally { sb.cleanup(); }
};
const fact = (desc, topic, body, mtime) => ({ desc, topic, body, mtime });

const STORE = new Map([
  ['windows-cmd-quoting', fact('cmd.exe reads percent signs inside quotes, so a prompt never rides the command line', 'windows',
    'Send the prompt over stdin. **Why:** a note typed by a web page once ran a command.')],
  ['prefer-small-diffs', fact('The user wants the smallest diff that satisfies the task', 'working-style',
    'No drive-by refactors. **Why:** reviews stay short. **How to apply:** state a widening and wait.')],
  ['release-needs-green-ci', fact('Publish a release only after push CI on the release commit is green', 'release',
    'npm view lags minutes after publish.')],
  ['web-dist-tracked', fact('web/dist is tracked and must be rebuilt when web/src changes', 'web',
    'Run npm ci first; chunks are content hashed.')],
  ['opencode-plugin-shape', fact('Every OpenCode plugin exports id, server and setup from one file', 'opencode',
    'V2 loads only default export with setup; V1 loads server.')],
  ['git-main-via-pr', fact('main changes only through a pull request with green checks', 'git',
    'Never push to main directly.')],
]);

test('tokenize: lower case, split on non-letters and non-digits, one-letter words dropped, no stemming', () => {
  assert.deepEqual(tokenize('Web/dist is TRACKED, v2 loads x-files: naïve 32767'),
    ['web', 'dist', 'is', 'tracked', 'v2', 'loads', 'files', 'naïve', '32767']);
  assert.deepEqual(tokenize('running runs'), ['running', 'runs'], 'no stemming: two words stay two');
  assert.deepEqual(tokenize(undefined), []);
});

test('rankFacts: the fact the query is about comes first, a fact sharing no word is absent', () => {
  const hits = rankFacts(STORE, 'rebuild the web dist after changing web src');
  assert.equal(hits[0].slug, 'web-dist-tracked', 'its slug, description and topic all carry the words');
  assert.ok(!hits.some((h) => h.slug === 'git-main-via-pr'), 'no shared word, no entry');
  assert.deepEqual(rankFacts(STORE, 'zebra quartz'), [], 'a query the store has never seen ranks nothing');
  assert.deepEqual(rankFacts(new Map(), 'anything'), [], 'an empty store ranks nothing');
});

// The threshold's rows. SIMILARITY is the stored fact's BM25 score for the candidate's words over the score
// of an identical document, so each row says how much of the candidate the store already holds.
test('nearestFact: a copy or a reword is above the threshold; a paraphrase, a same-topic fact and a stranger are below', () => {
  const stdin = 'cmd.exe reads percent signs inside quotes, so a prompt never rides the command line';
  const rows = [
    ['identical text under a new slug: says the same, in the same words', 'windows-cmd-quoting-2',
      fact(stdin, 'windows', 'Send the prompt over stdin. **Why:** a note typed by a web page once ran a command.'),
      'windows-cmd-quoting', (s) => s === 1],
    ['the same claim reworded, most words kept: a duplicate', 'prompt-over-stdin',
      fact('A prompt never rides the command line because cmd.exe reads percent signs inside quotes', 'windows',
        'Send the prompt over stdin instead. **Why:** a web page note once ran a command.'),
      'windows-cmd-quoting', (s) => s > 0.8 && s >= DUPLICATE_SIMILARITY],
    // BM25 matches words, not meaning: a paraphrase in other words gets through. That is the conservative side
    // (a false create costs one duplicate; a false skip loses a fact), and the model's own merge step is the net.
    ['the same claim paraphrased in other words: NOT caught', 'stdin-for-prompts',
      fact('Pass the prompt on stdin, as cmd.exe parses percent signs even inside quotes', 'windows',
        'Never put it on the command line. **Why:** pasted web text could run a command.'),
      'windows-cmd-quoting', (s) => s > 0.3 && s < DUPLICATE_SIMILARITY],
    ['another fact of the same topic: shares a topic and a few words, no more', 'windows-path-length',
      fact('A Windows command line holds 32767 characters, so long prompts overran it', 'windows',
        'Cap the stored-fact list. **Why:** E2BIG was silent.'),
      'windows-cmd-quoting', (s) => s < 0.35],
    ['an unrelated fact', 'bob-has-no-resume', fact('Bob has no subagent resume and no nesting', 'bob', 'Hand a fresh worker the note.'),
      'prefer-small-diffs', (s) => s < 0.2],
  ];
  for (const [what, slug, f, nearest, inRange] of rows) {
    const got = nearestFact(STORE, { slug, ...f });
    assert.equal(got.slug, nearest, `${what}: the closest stored fact`);
    assert.ok(inRange(got.similarity), `${what}: similarity ${got.similarity}`);
  }
  assert.equal(nearestFact(new Map(), { slug: 'x', desc: 'anything' }), null, 'an empty store has no neighbour');
});

// F12: with a large store the alphabetical cut hid the fact the previous distil wrote a minute earlier.
test('pickStored: with 1200 stored facts, the newest ten and the matches for the notes are listed', () => {
  const facts = new Map();
  for (let i = 0; i < 1200; i += 1) {
    facts.set(`topic-${String(i).padStart(4, '0')}`, fact(`generic lesson number ${i} about filler subject ${i % 17}`, `t${i % 9}`, '', i));
  }
  // `zz-` sorts last, so an alphabetical list never reached it; it is also the newest by mtime.
  facts.set('zz-just-written', fact('Rebuild web dist whenever web src changes', 'web', 'npm ci first.', 5000));
  facts.set('zz-old-match', fact('Chunks of the web dist are content hashed by vite', 'web', 'A new lazy chunk is untracked.', 1));
  const picked = pickStored(facts, 'we changed web src and rebuilt the dist chunks', 8000);
  assert.equal(picked[0], 'zz-just-written', 'the newest fact leads');
  assert.deepEqual(picked.slice(0, RECENT_FACTS).slice(1, 3), ['topic-1199', 'topic-1198'], 'then the next newest');
  assert.ok(picked.includes('zz-old-match'), 'an old fact the notes are about is listed past the newest ten');
  assert.equal(new Set(picked).size, picked.length, 'each fact once');
  const chars = picked.reduce((n, s) => n + `- ${s} — ${facts.get(s).desc}`.length + 1, 0);
  assert.ok(chars <= 8000 + 200, `${chars} chars inside the cap`);
  assert.ok(picked.length < facts.size, 'and the cap still cuts');
});

test('buildLearnPrompt: a fact written a minute ago is listed even with 1200 stored (F12)', () => {
  withDir((d) => {
    for (let i = 0; i < 1200; i += 1) {
      const slug = `fact-${String(i).padStart(4, '0')}`;
      fs.writeFileSync(path.join(d, `${slug}.md`), `---\nname: ${slug}\ndescription: filler lesson ${i} on subject ${i % 31}\n---\nbody ${i}\n`);
    }
    fs.writeFileSync(path.join(d, 'zz-fresh.md'), '---\nname: zz-fresh\ndescription: The fresh claim\n---\nbody\n');
    const old = Date.now() / 1000 - 3600;
    for (const f of fs.readdirSync(d)) if (f !== 'zz-fresh.md') fs.utimesSync(path.join(d, f), old, old);
    const prompt = buildLearnPrompt('notes about something else entirely', readFacts(d));
    assert.ok(prompt.includes('- zz-fresh — The fresh claim'), 'alphabetically last, yet listed: it is the newest');
    assert.match(prompt, /\(\d+ more stored facts not shown: the newest and the closest to the notes are listed\)/);
  });
});

const chunk = (name, desc, body = 'body', topic = 'windows') => `---\nname: ${name}\ndescription: ${desc}\ntopic: ${topic}\n---\n${body}`;
const SAID = 'cmd.exe reads percent signs inside quotes, so a prompt never rides the command line';

test('writeMemories: a create that repeats a stored fact is skipped and named, never silent (D9)', () => {
  withDir((d) => {
    fs.writeFileSync(path.join(d, 'windows-cmd-quoting.md'), `${chunk('windows-cmd-quoting', SAID, 'Send the prompt over stdin.')}\n`);
    fs.writeFileSync(path.join(d, 'prefer-small-diffs.md'), `${chunk('prefer-small-diffs', 'The user wants the smallest diff', 'No drive-by refactors.', 'working-style')}\n`);
    const out = [
      chunk('prompt-over-stdin', 'A prompt never rides the command line because cmd.exe reads percent signs inside quotes', 'Send the prompt over stdin.'),
      chunk('bob-has-no-resume', 'Bob has no subagent resume and no nesting', 'Hand a fresh worker the note.', 'bob'),
    ].join('\n---FILE---\n');
    const res = writeMemories(out, d, new Set(['windows-cmd-quoting', 'prefer-small-diffs']));
    assert.deepEqual(res.created, ['bob-has-no-resume'], 'the stranger is created');
    assert.deepEqual(res.skipped, ['prompt-over-stdin: near-duplicate of windows-cmd-quoting, skipped']);
    assert.ok(!fs.existsSync(path.join(d, 'prompt-over-stdin.md')), 'the duplicate is not written');
  });
});

test('writeMemories: two near-identical creates in one reply write the first and skip the second', () => {
  withDir((d) => {
    fs.writeFileSync(path.join(d, 'prefer-small-diffs.md'), `${chunk('prefer-small-diffs', 'The user wants the smallest diff', 'No drive-by refactors.', 'working-style')}\n`);
    const out = [chunk('stdin-a', SAID, 'Send the prompt over stdin.'), chunk('stdin-b', SAID, 'Send the prompt over stdin.')].join('\n---FILE---\n');
    const res = writeMemories(out, d, new Set(['prefer-small-diffs']));
    assert.deepEqual(res.created, ['stdin-a']);
    assert.deepEqual(res.skipped, ['stdin-b: near-duplicate of stdin-a, skipped']);
  });
});

test('writeMemories: an update is never judged a duplicate, and an empty store creates freely', () => {
  withDir((d) => {
    fs.writeFileSync(path.join(d, 'windows-cmd-quoting.md'), `${chunk('windows-cmd-quoting', SAID, 'Send the prompt over stdin.')}\n`);
    const upd = `---\nname: windows-cmd-quoting\ndescription: ${SAID}\naction: update\ntopic: windows\n---\nSend the prompt over stdin. Merged.`;
    const res = writeMemories(upd, d, new Set(['windows-cmd-quoting']));
    assert.deepEqual([res.updated, res.skipped], [['windows-cmd-quoting'], []]);
  });
  withDir((d) => {
    const res = writeMemories(chunk('first-fact', SAID), d, new Set());
    assert.deepEqual([res.created, res.skipped], [['first-fact'], []]);
  });
});
