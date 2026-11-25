// THE CONSOLE'S MEMORY PAGE (`js/web/memory-api.mjs`): one read of the store's state, the decisions on what the
// cleanup left waiting, a restore out of the archive, and the `memory-clean` job's argv. The store here is a
// project-style target's `memory/` (no global manifest, so no shared tier), filled by hand; no model runs, and the
// job is only asked for its argv. Every expectation is written out, with the rule above it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ARCHIVE_HITS, apiMemory, apiMemoryArchive, apiMemoryDecide, apiMemoryRestore, memoryCleanCmd } from '../../js/web/memory-api.mjs';
import { writePlan } from '../../js/hosts/memory-consolidate.mjs';
import { NotFound } from '../../js/web/catalog.mjs';
import { makeSandbox } from '../helpers/sandbox.mjs';

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const fact = (name, desc, topic = 'build') => `---\nname: ${name}\ndescription: ${desc}\ntopic: ${topic}\n---\n${desc}.\n`;

function rig({ learnCommand = 'claude -p --model haiku' } = {}) {
  const sb = makeSandbox('gs-webmem-');
  const target = path.join(sb.path, '.claude');
  const mem = path.join(target, 'memory');
  fs.mkdirSync(path.join(mem, 'archive'), { recursive: true });
  fs.mkdirSync(path.join(mem, 'topics'));
  fs.writeFileSync(path.join(mem, 'a-fact.md'), fact('a-fact', 'first'));
  fs.writeFileSync(path.join(mem, 'b-fact.md'), fact('b-fact', 'second'));
  fs.writeFileSync(path.join(mem, 'c-fact.md'), fact('c-fact', 'third', 'release'));
  fs.writeFileSync(path.join(mem, 'topics', 'build.md'), '# build\n\n- [a-fact](../a-fact.md) — first\n');
  fs.writeFileSync(path.join(mem, 'MEMORY.md'), '# Memory Index\n');
  fs.writeFileSync(path.join(mem, 'archive', 'old-fact.md'), fact('old-fact', 'an archived one'));
  fs.writeFileSync(path.join(mem, '.gate-log.jsonl'),
    '{"at":"2026-11-24T10:00:00.000Z","source":"learn","host":"claude","decision":"created","slug":"a-fact"}\nnot json\n');
  if (learnCommand) {
    fs.writeFileSync(path.join(target, '.geneseed-manifest.json'), JSON.stringify({ managed: { learn_command: learnCommand } }));
  }
  const state = { target, emit: 'claude-project', refresh: () => {} };
  return { sb, mem, state };
}

// The read: counts, topics largest first with their file size (0 when the topic file is missing), the map's
// size, the archive counted (in total and per topic, never listed), the plan without the update texts, and the
// gate log's parseable lines.
test('GET /api/memory: the store\'s state as the page reads it', () => {
  const r = rig();
  try {
    writePlan(r.mem, { v: 1, at: '2026-11-25T08:00:00.000Z', reviewed: { 'a-fact': 1 },
      pending: [{ slug: 'b-fact', action: 'update', text: '---\nname: b-fact\n---\nx', low: true }] });
    const m = apiMemory(r.state, '', []);
    assert.equal(m.store, r.mem);
    assert.equal(m.facts, 3);
    assert.deepEqual(m.topics.map((t) => [t.topic, t.n, t.bytes > 0]), [['build', 2, true], ['release', 1, false]]);
    assert.equal(m.mapBytes, '# Memory Index\n'.length);
    assert.equal(m.archivedCount, 1);
    assert.deepEqual(m.archivedTopics, [{ topic: 'build', n: 1 }]);
    assert.equal(m.archived, undefined, 'the archive is never listed whole');
    assert.equal(m.learnWhy, null);
    assert.deepEqual(m.plan, { at: '2026-11-25T08:00:00.000Z', reviewed: 1, pending: [{ slug: 'b-fact', action: 'update', low: true }] });
    assert.deepEqual(m.log.map((e) => e.decision), ['created']);
    assert.deepEqual(m.learn, { host: 'claude', model: 'haiku', command: 'claude -p --model haiku' });
  } finally { r.sb.cleanup(); }
  const gone = rig();
  try {
    fs.rmSync(gone.mem, { recursive: true });
    assert.throws(() => apiMemory(gone.state, '', []), NotFound);
  } finally { gone.sb.cleanup(); }
});

// The job runs the hook binary's cleanup on this store with the install's own model; a preview adds --dry-run;
// an install that bakes no model (and a console with no $GENESEED_LLM) is refused before any job starts.
test('memory-clean: the argv, the dry run, and the refusal', () => {
  const r = rig();
  try {
    const hook = path.join(ROOT, 'bin', 'geneseed-hook.mjs');
    assert.deepEqual(memoryCleanCmd(r.state, {}, {}, []).cmd,
      [process.execPath, hook, 'learn', '--consolidate', '--merge', '--memory', r.mem, '--host', 'claude', '--learn-model', 'haiku']);
    assert.deepEqual(memoryCleanCmd(r.state, { dryRun: true }, {}, []).cmd.slice(-1), ['--dry-run']);
  } finally { r.sb.cleanup(); }
  const none = rig({ learnCommand: null });
  try {
    assert.match(memoryCleanCmd(none.state, {}, {}, []).error, /^No install records a learn model\. Run geneseed rebuild-all/);
    assert.deepEqual(memoryCleanCmd(none.state, {}, { GENESEED_LLM: 'llm -m x' }, []).cmd.slice(-2), ['--memory', none.mem]);
    // Another active Claude-family install that records a model lends it: the store is the one this page shows.
    const other = path.join(none.sb.path, 'other-claude');
    fs.mkdirSync(other);
    fs.writeFileSync(path.join(other, '.geneseed-manifest.json'), JSON.stringify({ managed: { learn_command: 'openclaude -p' } }));
    const lent = memoryCleanCmd(none.state, {}, {}, [['opencode', 'global', '/nowhere'], ['openclaude', 'global', other]]).cmd;
    assert.deepEqual(lent.slice(-4), ['--host', 'openclaude', '--learn-model', 'session']);
    assert.equal(apiMemory(none.state, '', [['openclaude', 'global', other]]).learn.from, other);
    // An OpenCode install runs the cleanup on its own config's model (small_model, else model), through an isolated
    // `opencode run` (js/hosts/opencode-run.mjs); with no model in its config, the reason says where to set one.
    const oc = path.join(none.sb.path, 'opencode');
    fs.mkdirSync(path.join(oc, 'memory'), { recursive: true });
    const ocState = { target: oc, emit: 'opencode-global', refresh: () => {} };
    assert.match(apiMemory(ocState, '', []).learnWhy, /^Set a model in your OpenCode config \(small_model, or model\)/);
    fs.writeFileSync(path.join(oc, 'opencode.json'), JSON.stringify({ model: 'p/big', small_model: 'p/small' }));
    assert.deepEqual(apiMemory(ocState, '', []).learn, { host: 'opencode', model: 'p/small', command: 'opencode run --model p/small' });
    assert.deepEqual(memoryCleanCmd(ocState, {}, {}, []).cmd.slice(-4), ['--host', 'opencode', '--learn-model', 'p/small']);
  } finally { none.sb.cleanup(); }
});

// Decide applies a waiting archive (after a backup) or rejects it; a body that names nothing is refused with
// ok: false (409). Restore brings an archived fact back and indexes it, and refuses a name that is no fact name.
test('POST /api/memory/decide and /api/memory/restore', () => {
  const r = rig();
  try {
    writePlan(r.mem, { v: 1, at: null, reviewed: {}, pending: [{ slug: 'b-fact', action: 'archive', low: true },
      { slug: 'c-fact', action: 'archive', low: true }] });
    assert.equal(apiMemoryDecide(r.state, {}).ok, false);
    const a = apiMemoryDecide(r.state, { names: ['b-fact'] });
    assert.deepEqual([a.ok, a.applied, a.rejected], [true, ['b-fact'], []]);
    assert.ok(fs.existsSync(path.join(r.mem, 'archive', 'b-fact.md')));
    assert.ok(a.backup.startsWith(path.join(r.mem, 'archived-cleanup')));
    const j = apiMemoryDecide(r.state, { all: true, reject: true });
    assert.deepEqual([j.applied, j.rejected], [[], ['c-fact']]);
    assert.ok(fs.existsSync(path.join(r.mem, 'c-fact.md')), 'a rejected action changes nothing');

    assert.deepEqual(apiMemoryRestore(r.state, { name: '../x' }), { ok: false, error: 'not an archived fact name' });
    assert.deepEqual(apiMemoryRestore(r.state, { name: 'old-fact' }), { ok: true, restored: 'old-fact' });
    assert.match(fs.readFileSync(path.join(r.mem, 'topics', 'build.md'), 'utf8'), /\(\.\.\/old-fact\.md\)/);
  } finally { r.sb.cleanup(); }
});

// The archive answers a search only: no words and no topic is no fact; words rank by BM25 over every archived fact;
// a topic lists that topic newest first, or narrows the words' matches; at most ARCHIVE_HITS facts come back.
test('GET /api/memory/archive: search only, by words, by topic, capped', () => {
  const r = rig();
  try {
    const arch = path.join(r.mem, 'archive');
    fs.writeFileSync(path.join(arch, 'cp-page.md'), fact('cp-page', 'the windows console code page is cp1252', 'windows'));
    fs.writeFileSync(path.join(arch, 'release-notes.md'), fact('release-notes', 'release notes fold from fragments', 'release'));
    const t = new Date(Date.now() - 60000);
    fs.utimesSync(path.join(arch, 'old-fact.md'), t, t);
    const q = (query) => apiMemoryArchive(r.state, `/api/memory/archive?${query}`);
    assert.deepEqual(q(''), { q: '', topic: '', total: 0, hits: [] });
    assert.deepEqual(q('q=code+page').hits.map((h) => [h.name, h.topic]), [['cp-page', 'windows']]);
    assert.deepEqual(q('topic=build').hits.map((h) => h.name), ['old-fact']);
    assert.deepEqual(q('q=code+page&topic=release').hits, []);
    for (let i = 0; i < ARCHIVE_HITS + 5; i += 1) fs.writeFileSync(path.join(arch, `bulk-${i}.md`), fact(`bulk-${i}`, `bulk fact ${i}`, 'bulk'));
    const many = q('topic=bulk');
    assert.equal(many.total, ARCHIVE_HITS + 5);
    assert.equal(many.hits.length, ARCHIVE_HITS);
  } finally { r.sb.cleanup(); }
});
