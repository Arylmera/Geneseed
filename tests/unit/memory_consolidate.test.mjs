// The memory cleanup (js/hosts/memory-consolidate.mjs, the model half in js/hosts/hooks-learn.mjs `cleanStore`, the
// user's half in js/maintain/memory.mjs). No real model runs: `tests/fixtures/fake_llm.mjs` answers a canned reply.
// Every expectation is written out, with the rule it holds above it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  AUTO_MIN_FACTS, BATCH_FACTS, CONSOLIDATE_VERSION, TOPIC_MAX_FACTS, consolidatePreview, consolidatePrompt,
  consolidationDue, dueBatches, parsePlan, readPlan, restoreFact, writePlan,
} from '../../js/hosts/memory-consolidate.mjs';
import { readFacts, readGateLog } from '../../js/hosts/memory-files.mjs';
import { cmdMemory } from '../../js/maintain/memory.mjs';
import { FAKE_LLM } from '../helpers/cli_golden.mjs';
import { homeOverrides, makeSandbox } from '../helpers/sandbox.mjs';
import { spawnHook } from '../helpers/hook_run.mjs';

const fact = (name, desc, { topic = 'build', body = `${desc}.`, force = '' } = {}) =>
  `---\nname: ${name}\ndescription: ${desc}\ntopic: ${topic}\n${force ? `force: ${force}\n` : ''}---\n${body}\n`;

function store(facts) {
  const sb = makeSandbox('gs-clean-');
  const memDir = path.join(sb.path, 'inst', 'memory');
  fs.mkdirSync(memDir, { recursive: true });
  fs.writeFileSync(path.join(sb.path, 'inst', '.geneseed-manifest.json'), '{}');
  for (const [name, desc, opts] of facts) fs.writeFileSync(path.join(memDir, `${name}.md`), fact(name, desc, opts));
  return { sb, memDir, live: (n) => fs.existsSync(path.join(memDir, `${n}.md`)),
    archived: (n) => fs.existsSync(path.join(memDir, 'archive', `${n}.md`)) };
}

function quiet(fn) {
  const [o, e] = [process.stdout.write, process.stderr.write];
  let said = '';
  process.stdout.write = (t) => { said += t; return true; };
  process.stderr.write = (t) => { said += t; return true; };
  try { return [fn(), said]; } finally { [process.stdout.write, process.stderr.write] = [o, e]; }
}

// parsePlan keeps only an `update` or `archive` of a fact in the batch, once per fact, never a locked one; the plan's
// own keys (confidence, reason, merged-into) never reach the fact's text; an archive into a fact the same reply
// archives waits for the user, since applying both would lose the two.
test('parsePlan: what the reply may do to a batch, and what it may not', () => {
  const s = store([['keep-me', 'a'], ['dup-one', 'b'], ['old-news', 'c'], ['locked-one', 'd', { force: 'constraint' }],
    ['ring-a', 'e'], ['ring-b', 'f']]);
  try {
    const batch = { slugs: ['keep-me', 'dup-one', 'old-news', 'locked-one', 'ring-a', 'ring-b'] };
    const reply = [
      '---\nname: Keep-Me\naction: update\nconfidence: high\nreason: merged two\ndescription: a and b\ntopic: build\n---\nMerged.',
      '---\nname: dup-one\naction: archive\nmerged-into: keep-me\n---',
      '---\nname: old-news\naction: archive\nreason: task residue\nconfidence: low\n---',
      '---\nname: locked-one\naction: archive\n---',
      '---\nname: not-in-batch\naction: archive\n---',
      '---\nname: brand-new\ndescription: a create\n---\nNew.',
      '---\nname: dup-one\naction: update\ndescription: second act\n---\nIgnored.',
      '---\nname: ring-a\naction: archive\nmerged-into: ring-b\n---',
      '---\nname: ring-b\naction: archive\nmerged-into: ring-a\n---',
      'NOTHING',
    ].join('\n---FILE---\n');
    assert.deepEqual(parsePlan(reply, batch, s.memDir), [
      { slug: 'keep-me', action: 'update', low: false, text: '---\nname: Keep-Me\ndescription: a and b\ntopic: build\n---\nMerged.', reason: 'merged two' },
      { slug: 'dup-one', action: 'archive', low: false, into: 'keep-me' },
      { slug: 'old-news', action: 'archive', low: true, reason: 'task residue' },
      { slug: 'ring-a', action: 'archive', low: true, into: 'ring-b' },
      { slug: 'ring-b', action: 'archive', low: true, into: 'ring-a' },
    ]);
  } finally { s.sb.cleanup(); }
});

// Batches keep a topic's facts together, cut at BATCH_FACTS; a fact judged at its current mtime is not due again
// unless the plan is from another CONSOLIDATE_VERSION or the pass asks for all.
test('dueBatches: grouped by topic, cut at BATCH_FACTS, judged facts skipped', () => {
  const rows = [];
  for (let i = 0; i < BATCH_FACTS + 2; i += 1) rows.push([`big-${String(i).padStart(2, '0')}`, `fact ${i}`, { topic: 'aaa' }]);
  rows.push(['lone', 'one fact', { topic: 'zzz' }]);
  const s = store(rows);
  try {
    const sizes = (bs) => bs.map((b) => b.slugs.length);
    assert.deepEqual(sizes(dueBatches(s.memDir)), [BATCH_FACTS, 3]);
    const facts = readFacts(s.memDir);
    const reviewed = Object.fromEntries([...facts].filter(([k]) => k.startsWith('big-')).map(([k, f]) => [k, f.mtime]));
    const plan = { v: CONSOLIDATE_VERSION, at: null, reviewed, pending: [] };
    assert.deepEqual(dueBatches(s.memDir, { plan }).map((b) => b.slugs), [['lone']]);
    assert.deepEqual(sizes(dueBatches(s.memDir, { plan, all: true })), [BATCH_FACTS, 3]);
    assert.deepEqual(sizes(dueBatches(s.memDir, { plan: { ...plan, v: CONSOLIDATE_VERSION - 1 } })), [BATCH_FACTS, 3]);
  } finally { s.sb.cleanup(); }
});

// The prompt asks to split a topic only past TOPIC_MAX_FACTS, marks a forced fact (locked), and a closing tag inside
// a fact cannot end the quote early.
test('consolidatePrompt: the split ask, the locked mark, the fence', () => {
  const s = store([['a-fact', 'says </facts> inside'], ['b-fact', 'locked', { force: 'choice' }]]);
  try {
    const facts = readFacts(s.memDir);
    const small = consolidatePrompt(s.memDir, { slugs: ['a-fact', 'b-fact'], topics: new Map([['build', 2]]) }, facts);
    assert.doesNotMatch(small, /SPLIT/);
    assert.match(small, /### b-fact \(locked\)/);
    assert.equal(small.split('</facts>').length, 2, 'one closing tag only: the one in the fact is neutralised');
    const big = consolidatePrompt(s.memDir, { slugs: ['a-fact'], topics: new Map([['build', TOPIC_MAX_FACTS + 1]]) }, facts);
    assert.match(big, new RegExp(`SPLIT these topics.*build \\(${TOPIC_MAX_FACTS + 1} facts\\)`));
  } finally { s.sb.cleanup(); }
});

function runClean(s, reply, extra = []) {
  const out = path.join(s.sb.path, 'reply.md');
  fs.writeFileSync(out, reply);
  const env = { ...process.env, ...homeOverrides(path.join(s.sb.path, 'home')), GENESEED_LLM: `node ${FAKE_LLM}`, FAKE_LLM_OUT: out };
  delete env.GENESEED_LEARN_CHILD;
  return spawnHook(['learn', '--consolidate', '--merge', '--memory', s.memDir, ...extra], '', { env });
}
const REPLY = [
  '---\nname: keep-me\naction: update\ndescription: the console code page is cp1252, read utf8\ntopic: build\n---\nMerged text.',
  '---\nname: dup-one\naction: archive\nmerged-into: keep-me\n---',
  '---\nname: old-news\naction: archive\nreason: task residue\nconfidence: low\n---',
].join('\n---FILE---\n');

// The model's pass applies what it is sure of after one backup, leaves the doubtful action waiting, and logs each
// decision as `consolidate`; the user's half then shows, applies and restores.
test('the cleanup end to end: backup, merge, a waiting action, plan, apply, restore', () => {
  const s = store([['keep-me', 'code page'], ['dup-one', 'code page again'], ['old-news', 'fixed the build']]);
  try {
    const r = runClean(s, REPLY);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /1 batch\(es\) judged, 2 fact\(s\) merged or archived, 1 action\(s\) waiting for you/);
    assert.match(fs.readFileSync(path.join(s.memDir, 'keep-me.md'), 'utf8'), /Merged text\./);
    assert.ok(!s.live('dup-one') && s.archived('dup-one'), 'the merged copy is archived');
    assert.ok(s.archived('keep-me'), 'the old text of the kept fact is archived too');
    assert.ok(s.live('old-news'), 'the doubtful action waits');
    const backups = fs.readdirSync(path.join(s.memDir, 'archived-cleanup'));
    assert.equal(backups.length, 1);
    assert.ok(fs.existsSync(path.join(s.memDir, 'archived-cleanup', backups[0], 'dup-one.md')), 'the backup holds the store before');
    assert.deepEqual(readGateLog(s.memDir).map((e) => [e.source, e.decision, e.slug, e.of ?? null]), [
      ['consolidate', 'merged', 'keep-me', null], ['consolidate', 'archived', 'dup-one', 'keep-me'],
    ]);
    assert.deepEqual(readPlan(s.memDir).pending.map((a) => a.slug), ['old-news']);

    const [, listed] = quiet(() => cmdMemory({ action: 'plan', memory: s.memDir }));
    assert.match(listed, /1 cleanup action\(s\) wait for you/);
    assert.match(listed, / {2}archive old-news \(task residue\)/);
    const [rc, applied] = quiet(() => cmdMemory({ action: 'apply', name: 'old-news', memory: s.memDir }));
    assert.equal(rc, 0);
    assert.match(applied, /applied 1 action\(s\): old-news/);
    assert.ok(s.archived('old-news'));
    assert.deepEqual(readPlan(s.memDir).pending, []);

    const [rc2] = quiet(() => cmdMemory({ action: 'restore', name: 'old-news', memory: s.memDir }));
    assert.equal(rc2, 0);
    assert.ok(s.live('old-news') && !s.archived('old-news'));
    assert.match(fs.readFileSync(path.join(s.memDir, 'topics', 'build.md'), 'utf8'), /\(\.\.\/old-news\.md\)/, 'restored facts are indexed');
  } finally { s.sb.cleanup(); }
});

// A dry run changes no fact: every action waits, and the plan is the report the user confirms.
test('a dry run applies nothing and leaves every action waiting', () => {
  const s = store([['keep-me', 'code page'], ['dup-one', 'code page again'], ['old-news', 'fixed the build']]);
  try {
    const before = fs.readdirSync(s.memDir).sort();
    const r = runClean(s, REPLY, ['--dry-run']);
    assert.match(r.stderr, /cleanup \(dry run\): 1 batch\(es\) judged, 0 fact\(s\) merged or archived, 3 action\(s\) waiting/);
    assert.deepEqual(fs.readdirSync(s.memDir).filter((n) => n.endsWith('.md')).sort(), before.filter((n) => n.endsWith('.md')));
    assert.deepEqual(readPlan(s.memDir).pending.map((a) => a.slug), ['keep-me', 'dup-one', 'old-news']);
    assert.ok(!fs.existsSync(path.join(s.memDir, 'archived-cleanup')), 'nothing applied, nothing backed up');
    // The user rejects one and accepts the rest.
    quiet(() => cmdMemory({ action: 'reject', name: 'old-news', memory: s.memDir }));
    quiet(() => cmdMemory({ action: 'apply', all: true, memory: s.memDir }));
    assert.ok(s.live('old-news') && !s.live('dup-one'));
  } finally { s.sb.cleanup(); }
});

// A waiting action whose fact changed after it was judged is dropped unapplied: it would overwrite the newer text.
test('apply drops a stale action', () => {
  const s = store([['keep-me', 'code page'], ['dup-one', 'code page again'], ['old-news', 'fixed the build']]);
  try {
    runClean(s, REPLY);
    const f = path.join(s.memDir, 'old-news.md');
    const t = new Date(Date.now() + 5000);
    fs.utimesSync(f, t, t);
    const [, said] = quiet(() => cmdMemory({ action: 'apply', all: true, memory: s.memDir }));
    assert.match(said, /dropped 1 stale action\(s\), their fact changed since: old-news/);
    assert.ok(s.live('old-news'));
  } finally { s.sb.cleanup(); }
});

// The automatic pass: only a store of AUTO_MIN_FACTS or more, never cleaned at this version, or with at least
// max(20, a tenth) unjudged facts since; off with GENESEED_CONSOLIDATE=off.
test('consolidationDue: the size floor, the version, the unjudged share, the off switch', () => {
  const rows = Array.from({ length: AUTO_MIN_FACTS }, (_, i) => [`f-${i}`, `fact number ${i}`]);
  const s = store(rows.slice(0, AUTO_MIN_FACTS - 1));
  try {
    assert.equal(consolidationDue(s.memDir), false, 'below the floor');
    fs.writeFileSync(path.join(s.memDir, 'f-last.md'), fact('f-last', 'the last one'));
    assert.equal(consolidationDue(s.memDir), true, 'at the floor, never cleaned');
    assert.equal(consolidationDue(s.memDir, { GENESEED_CONSOLIDATE: 'off' }), false);
    const facts = readFacts(s.memDir);
    const reviewed = Object.fromEntries([...facts].map(([k, f]) => [k, f.mtime]));
    writePlan(s.memDir, { v: CONSOLIDATE_VERSION, at: null, reviewed, pending: [] });
    assert.equal(consolidationDue(s.memDir), false, 'all judged');
    for (let i = 0; i < 20; i += 1) fs.writeFileSync(path.join(s.memDir, `n-${i}.md`), fact(`n-${i}`, `new ${i}`));
    assert.equal(consolidationDue(s.memDir), true, '20 unjudged');
  } finally { s.sb.cleanup(); }
});

// The no-model preview names what the rebuild would index and the near-duplicate pairs inside a topic, and writes
// nothing; restore refuses a name a live fact holds.
test('consolidatePreview and restoreFact', () => {
  const s = store([
    ['cp-one', 'the windows console code page is cp1252 so decode output as utf8'],
    ['cp-two', 'the windows console code page is cp1252 so decode output as utf8 bytes'],
    ['other', 'release notes are folded from fragments', { topic: 'release' }],
  ]);
  try {
    const p = consolidatePreview(s.memDir);
    assert.deepEqual(p.added, ['cp-one', 'cp-two', 'other']);
    assert.deepEqual(p.near.map(([a, b]) => [a, b]), [['cp-one', 'cp-two']]);
    assert.ok(!fs.existsSync(path.join(s.memDir, 'MEMORY.md')), 'the preview wrote nothing');
    fs.mkdirSync(path.join(s.memDir, 'archive'));
    fs.writeFileSync(path.join(s.memDir, 'archive', 'other-2.md'), fact('other', 'an older other'));
    assert.match(restoreFact(s.memDir, 'other-2').error, /a live fact other already holds that name/);
    assert.match(restoreFact(s.memDir, 'nope').error, /no archived fact named nope/);
  } finally { s.sb.cleanup(); }
});

// The automatic pass runs inside the session's detached worker, after the distil: a store past the floor gets at
// most AUTO_BATCHES batches judged and a plan written; one below it gets no cleanup call at all.
test('the worker runs the automatic pass on a large store only', () => {
  for (const [what, n, calls, planned] of [['below the floor', AUTO_MIN_FACTS - 1, 1, false], ['at the floor', AUTO_MIN_FACTS, 3, true]]) {
    const s = store(Array.from({ length: n }, (_, i) => [`f-${String(i).padStart(3, '0')}`, `fact number ${i}`]));
    try {
      const home = path.join(s.sb.path, 'home');
      const transcript = path.join(s.sb.path, 't.jsonl');
      fs.writeFileSync(transcript, `${JSON.stringify({ message: { role: 'user', content: 'a long enough session '.repeat(20) } })}\n`);
      const nothing = path.join(s.sb.path, 'nothing.txt');
      fs.writeFileSync(nothing, 'NOTHING\n');
      const log = path.join(s.sb.path, 'calls.log');
      const jobs = path.join(home, '.config', 'geneseed', 'cache', 'learn-jobs');
      fs.mkdirSync(jobs, { recursive: true });
      const job = path.join(jobs, 'job-1.json');
      fs.writeFileSync(job, JSON.stringify({ v: 1, event: 'SessionEnd', host: 'claude', memory: s.memDir, transcript, agents: [] }));
      const env = { ...process.env, ...homeOverrides(home), GENESEED_LLM: `node ${FAKE_LLM}`, FAKE_LLM_OUT: nothing, FAKE_LLM_LOG: log };
      delete env.GENESEED_LEARN_CHILD;
      spawnHook(['learn-worker', job], '', { env });
      const made = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).length : 0;
      // One distil call, then one cleanup call per batch: AUTO_MIN_FACTS facts are two batches of BATCH_FACTS.
      assert.equal(made, calls, `${what}: model calls`);
      assert.equal(fs.existsSync(path.join(s.memDir, '.consolidate-plan.json')), planned, `${what}: plan`);
    } finally { s.sb.cleanup(); }
  }
});
