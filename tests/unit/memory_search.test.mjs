// O9 (spec 2026-11-21-memory-load-and-dedupe): the BM25 search behind learn's ALREADY STORED list and
// its near-duplicate guard. Every expected value is written out with the sentence that defends it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from '../helpers/sandbox.mjs';
import {
  DUPLICATE_SIMILARITY, MAP_TOPIC_LINES, RECENT_FACTS, isMapText, mapBody, nearestFact, pickStored, rankFacts, searchLines, tokenize,
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

// ---- O10: the bounded map and the search verb's lines ---------------------------------------------------

const HINT = 'Each topic file lists its facts; open the one the task needs, or search every fact: '
  + '`geneseed memory search "<words>"` (OpenCode: the `memory_search` tool).';

test('mapBody: under the cap every topic is listed by name, with no fold line', () => {
  // Three topics fit in MAP_TOPIC_LINES (25), so the map is the old one plus the hint that names the search.
  assert.equal(MAP_TOPIC_LINES, 25);
  assert.deepEqual(mapBody(new Map([['web', 2], ['build', 1], ['tooling', 3]])), [HINT, '',
    '- [build](topics/build.md) — 1 fact', '- [tooling](topics/tooling.md) — 3 facts', '- [web](topics/web.md) — 2 facts']);
  // No topic, no map: an empty store goes back to the seed.
  assert.deepEqual(mapBody(new Map()), []);
});

test('mapBody: over the cap the largest 25 are listed by name and the rest are counted on one line', () => {
  // 30 topics t00..t29 holding 30..1 facts: t00..t24 (30..6 facts) are the largest 25; t25..t29 hold 5+4+3+2+1 = 15.
  const counts = new Map(Array.from({ length: 30 }, (_, i) => [`t${String(i).padStart(2, '0')}`, 30 - i]));
  const body = mapBody(counts);
  assert.equal(body.length, 2 + 25 + 1, 'hint, blank, 25 topics, the fold line');
  assert.equal(body[2], '- [t00](topics/t00.md) — 30 facts');
  assert.equal(body[26], '- [t24](topics/t24.md) — 6 facts');
  assert.equal(body[27], '- … 5 more topics (15 facts) under topics/, reached by the search above');
});

test('mapBody: misc is always listed, in place of the smallest kept topic, because its line fires the nudge', () => {
  // 26 topics of 10 facts and a misc of 1: misc is the smallest, so the cap would drop it; it takes the slot of
  // the last of the 25 by size (ties by name: z24), and the fold counts z24 and z25.
  const counts = new Map([...Array.from({ length: 26 }, (_, i) => [`z${String(i).padStart(2, '0')}`, 10]), ['misc', 1]]);
  const body = mapBody(counts);
  assert.ok(body.includes('- [misc](topics/misc.md) — 1 fact'), 'misc is listed');
  assert.ok(!body.some((l) => l.startsWith('- [z24]')), 'the smallest kept topic gave misc its slot');
  assert.equal(body.at(-1), '- … 2 more topics (20 facts) under topics/, reached by the search above');
});

test('isMapText: the hint, the older hint and the fold line are generated; a line a person wrote is not', () => {
  // A rebuild drops what it generates and carries the rest, so the hint an older build wrote must read as generated,
  // or an upgraded store would carry it under the new one forever.
  assert.equal(isMapText(HINT), true);
  assert.equal(isMapText('Each topic file lists its facts; open the one the task needs.'), true);
  assert.equal(isMapText('- … 1 more topic (1 fact) under topics/, reached by the search above'), true);
  assert.equal(isMapText('## Notes'), false);
});

test('searchLines: best match first, slug — description (topic), cut at the limit, nothing on no match', () => {
  // "stdin prompt" names windows-cmd-quoting's body words; no other fact holds both.
  assert.deepEqual(searchLines(STORE, 'stdin prompt', 1),
    ['- windows-cmd-quoting — cmd.exe reads percent signs inside quotes, so a prompt never rides the command line (windows)']);
  assert.deepEqual(searchLines(STORE, 'zzzz-nothing'), []);
});

test('a rebuild over 300 topics writes a map under 2 KB, and a second rebuild carries nothing twice', () => {
  // The F13 case: 300 topics made a 13.4 KB map, which the OpenCode context plugin injects whole up to 16 KB and
  // drops whole above it. Bounded, it is the hint, 25 topic lines and one fold line.
  withDir((d) => {
    const out = Array.from({ length: 300 }, (_, i) =>
      `---\nname: f${i}\ndescription: fact number ${i} of its own\ntopic: topic-${i}\n---\nbody ${i} ${'x'.repeat(i)}`).join('\n---FILE---\n');
    writeMemories(out, d, new Set());
    fs.appendFileSync(path.join(d, 'MEMORY.md'), '\n## Notes\nA line a person wrote.\n');
    writeMemories('---\nname: f300\ndescription: one more distinct fact about the release train\ntopic: release\n---\nShip on Fridays never.', d, new Set());
    const map = fs.readFileSync(path.join(d, 'MEMORY.md'), 'utf8').replace(/\r\n/g, '\n');
    assert.ok(map.length < 2048, `the map is ${map.length} bytes`);
    assert.equal(map.split('\n').filter((l) => l.startsWith('- … ')).length, 1, 'one fold line, not carried twice');
    assert.equal(map.split('\n').filter((l) => l === 'A line a person wrote.').length, 1, 'the person\'s line is carried once');
    assert.equal(fs.readdirSync(path.join(d, 'topics')).length, 301, 'every topic keeps its file');
  });
});
