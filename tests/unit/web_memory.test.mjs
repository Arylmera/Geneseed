// THE CONSOLE'S MEMORY PAGE (`js/web/memory-api.mjs`): one read of the store's state, the decisions on what the
// cleanup left waiting, a restore out of the archive, and the `memory-clean` job's argv. The store here is a
// project-style target's `memory/` (no global manifest, so no shared tier), filled by hand; no model runs, and the
// job is only asked for its argv. Every expectation is written out, with the rule above it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { apiMemory, apiMemoryDecide, apiMemoryRestore, memoryCleanCmd } from '../../js/web/memory-api.mjs';
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
// size, the archive, the plan without the update texts, and the gate log's parseable lines.
test('GET /api/memory: the store\'s state as the page reads it', () => {
  const r = rig();
  try {
    writePlan(r.mem, { v: 1, at: '2026-11-25T08:00:00.000Z', reviewed: { 'a-fact': 1 },
      pending: [{ slug: 'b-fact', action: 'update', text: '---\nname: b-fact\n---\nx', low: true }] });
    const m = apiMemory(r.state);
    assert.equal(m.store, r.mem);
    assert.equal(m.facts, 3);
    assert.deepEqual(m.topics.map((t) => [t.topic, t.n, t.bytes > 0]), [['build', 2, true], ['release', 1, false]]);
    assert.equal(m.mapBytes, '# Memory Index\n'.length);
    assert.equal(m.archivedCount, 1);
    assert.deepEqual(m.archived.map((a) => [a.name, a.desc]), [['old-fact', 'an archived one']]);
    assert.deepEqual(m.plan, { at: '2026-11-25T08:00:00.000Z', reviewed: 1, pending: [{ slug: 'b-fact', action: 'update', low: true }] });
    assert.deepEqual(m.log.map((e) => e.decision), ['created']);
    assert.deepEqual(m.learn, { host: 'claude', model: 'haiku', command: 'claude -p --model haiku' });
  } finally { r.sb.cleanup(); }
  const gone = rig();
  try {
    fs.rmSync(gone.mem, { recursive: true });
    assert.throws(() => apiMemory(gone.state), NotFound);
  } finally { gone.sb.cleanup(); }
});

// The job runs the hook binary's cleanup on this store with the install's own model; a preview adds --dry-run;
// an install that bakes no model (and a console with no $GENESEED_LLM) is refused before any job starts.
test('memory-clean: the argv, the dry run, and the refusal', () => {
  const r = rig();
  try {
    const hook = path.join(ROOT, 'bin', 'geneseed-hook.mjs');
    assert.deepEqual(memoryCleanCmd(r.state, {}, {}).cmd,
      [process.execPath, hook, 'learn', '--consolidate', '--merge', '--memory', r.mem, '--host', 'claude', '--learn-model', 'haiku']);
    assert.deepEqual(memoryCleanCmd(r.state, { dryRun: true }, {}).cmd.slice(-1), ['--dry-run']);
  } finally { r.sb.cleanup(); }
  const none = rig({ learnCommand: null });
  try {
    assert.match(memoryCleanCmd(none.state, {}, {}).error, /no learn model/);
    assert.deepEqual(memoryCleanCmd(none.state, {}, { GENESEED_LLM: 'llm -m x' }).cmd.slice(-2), ['--memory', none.mem]);
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
