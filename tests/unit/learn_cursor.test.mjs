// O8 on the Claude family (D5): PreCompact and SessionEnd each mine only the transcript past a per-session cursor.
// Before, each re-read the last 16k of the same transcript, so a long session was mined twice over its older half.
//
// Every expectation is written out. No real model runs: `llm.mjs` below logs the prompt it is given and answers
// NOTHING (or exits 1 when told to), standing in for `$GENESEED_LLM`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from '../helpers/sandbox.mjs';
import { cmdLearn, freshWindow, windowNotes } from '../../js/hosts/hooks-learn.mjs';

const turn = (n) => `turn ${n}: ${String.fromCharCode(96 + n).repeat(120)}`;
const line = (n) => JSON.stringify({ type: n % 2 ? 'user' : 'assistant', message: { role: n % 2 ? 'user' : 'assistant', content: turn(n) } });

/** A sandbox: an install `cfg` with its memory/, a transcript, and the stand-in model. */
function world() {
  const sb = makeSandbox('learn-cursor-');
  const cfg = path.join(sb.path, 'cfg');
  fs.mkdirSync(path.join(cfg, 'memory'), { recursive: true });
  fs.writeFileSync(path.join(cfg, '.geneseed-emit'), 'claude');
  const log = path.join(sb.path, 'prompts.jsonl');
  const llm = path.join(sb.path, 'llm.mjs');
  fs.writeFileSync(llm, `import fs from 'node:fs';
if (fs.existsSync(${JSON.stringify(path.join(sb.path, 'FAIL'))})) process.exit(1);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.at(-1)) + '\\n');
console.log('NOTHING');
`);
  const transcript = path.join(sb.path, 't.jsonl');
  const xdg = path.join(sb.path, 'xdg');
  const say = (...ns) => { fs.appendFileSync(transcript, ns.map((n) => `${line(n)}\n`).join('')); };
  const prompts = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const fire = (event, session = 's1') => {
    const payload = path.join(sb.path, 'payload.json');
    fs.writeFileSync(payload, JSON.stringify({ hook_event_name: event, transcript_path: transcript, session_id: session }));
    const saved = Object.fromEntries(['GENESEED_LEARN_INLINE', 'GENESEED_LLM', 'XDG_CONFIG_HOME', 'GENESEED_MEMORY', 'GENESEED_HARNESS',
      'GENESEED_LEARN_CHILD', 'CLAUDE_PROJECT_DIR'].map((k) => [k, process.env[k]]));
    Object.assign(process.env, { GENESEED_LEARN_INLINE: '1', GENESEED_LLM: `node ${llm}`, XDG_CONFIG_HOME: xdg,
      CLAUDE_PROJECT_DIR: path.join(sb.path, 'empty') });
    for (const k of ['GENESEED_MEMORY', 'GENESEED_HARNESS', 'GENESEED_LEARN_CHILD']) delete process.env[k];
    const w = process.stderr.write;
    process.stderr.write = () => true;
    try { cmdLearn({ memory: path.join(cfg, 'memory'), host: 'claude', file: payload }); } finally {
      process.stderr.write = w;
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  };
  return { sb, say, fire, prompts, fail: (on) => (on ? fs.writeFileSync(path.join(sb.path, 'FAIL'), '') : fs.rmSync(path.join(sb.path, 'FAIL'))) };
}
const windowOf = (prompt) => {
  const notes = prompt.slice(prompt.indexOf('NOTES:\n') + 7);
  const at = notes.indexOf('NEW TURNS (distil from these):\n');
  return at < 0 ? ['', notes] : [notes.slice(0, at), notes.slice(at)];
};

test('freshWindow: the cursor splits fresh from context; a cursor outside the list starts over', () => {
  const items = ['a', 'b', 'c', 'd', 'e'];
  const rows = [
    ['no cursor: everything is new, no context', undefined, { context: [], fresh: items, next: 5 }],
    ['cursor 0: the same', 0, { context: [], fresh: items, next: 5 }],
    ['cursor 1: one message of context', 1, { context: ['a'], fresh: ['b', 'c', 'd', 'e'], next: 5 }],
    ['cursor 3: the 2 messages before it', 3, { context: ['b', 'c'], fresh: ['d', 'e'], next: 5 }],
    ['cursor at the end: nothing new', 5, { context: ['d', 'e'], fresh: [], next: 5 }],
    ['cursor past the end (a compacted session): starts over', 9, { context: [], fresh: items, next: 5 }],
    ['cursor not a whole number: starts over', 1.5, { context: [], fresh: items, next: 5 }],
  ];
  for (const [what, cursor, want] of rows) assert.deepEqual(freshWindow(items, cursor), want, what);
  assert.equal(windowNotes('', 'new'), 'new', 'no context, no marks');
  assert.match(windowNotes('old', 'new'), /^CONTEXT \(.*never distil from them\):\nold\n\nNEW TURNS \(distil from these\):\nnew$/);
});

test('PreCompact then SessionEnd: each mines only what came after the last distil, with 2 messages of context', () => {
  const w = world();
  try {
    w.say(1, 2, 3, 4);
    w.fire('PreCompact');
    w.say(5, 6);
    w.fire('SessionEnd');
    const [first, second] = w.prompts();
    for (const n of [1, 2, 3, 4]) assert.ok(first.includes(turn(n)), `the first distil holds turn ${n}`);
    assert.ok(!first.includes('NEW TURNS'), 'no cursor yet: no context marks');
    const [context, fresh] = windowOf(second);
    assert.ok(fresh.includes(turn(5)) && fresh.includes(turn(6)), 'the second holds the new turns');
    assert.ok(![1, 2, 3, 4].some((n) => fresh.includes(turn(n))), 'and none of the mined ones as new');
    assert.ok(context.includes(turn(3)) && context.includes(turn(4)) && !context.includes(turn(2)), 'context: exactly the 2 messages before');
    w.fire('SessionEnd');
    assert.equal(w.prompts().length, 2, 'nothing new: no model call');
  } finally { w.sb.cleanup(); }
});

test('a failed distil leaves its region to the next run; a trivial new tail runs no model and keeps the cursor', () => {
  const w = world();
  try {
    w.say(1, 2);
    w.fail(true);
    w.fire('PreCompact');
    assert.equal(w.prompts().length, 0, 'the model failed');
    w.fail(false);
    w.fire('SessionEnd');
    const [first] = w.prompts();
    assert.ok(first.includes(turn(1)) && first.includes(turn(2)), 'the failed region is mined by the next run, cursor unmoved');
    fs.appendFileSync(path.join(w.sb.path, 't.jsonl'), `${JSON.stringify({ type: 'user', message: { role: 'user', content: 'ok thanks' } })}\n`);
    w.fire('SessionEnd');
    assert.equal(w.prompts().length, 1, 'under 200 new characters: no distil');
    w.say(3, 4);
    w.fire('SessionEnd');
    const [context, fresh] = windowOf(w.prompts()[1]);
    assert.ok(fresh.includes('ok thanks') && fresh.includes(turn(4)), 'the small tail piled up into the next distil');
    assert.ok(context.includes(turn(2)) || context.includes(turn(1)), 'with context');
  } finally { w.sb.cleanup(); }
});

test('two sessions keep two cursors', () => {
  const w = world();
  try {
    w.say(1, 2);
    w.fire('PreCompact', 'a');
    w.fire('PreCompact', 'b');
    assert.equal(w.prompts().length, 2, 'session b has its own cursor and mines the same transcript once');
    w.fire('PreCompact', 'a');
    assert.equal(w.prompts().length, 2, 'session a is up to date');
  } finally { w.sb.cleanup(); }
});
