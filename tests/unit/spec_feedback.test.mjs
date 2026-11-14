// The agents' self-improvement loop, closed by the hook (js/hosts/spec-feedback.mjs): on
// SubagentStop the `spec-feedback:` lines of the sub-agent's final report go into the notes its
// next dispatch reads, with no model call. Every expected value is written out below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from '../helpers/sandbox.mjs';
import {
  captureSpecFeedback, feedbackBullets, finalAssistantText, mergeFeedback, specFeedbackOf, subagentReport, today,
  MAX_GENERAL_BULLETS,
} from '../../js/hosts/spec-feedback.mjs';
import { SECRET_RE, tailReader } from '../../js/hosts/hooks-prims.mjs';
import { cmdLearn, notesRootOf } from '../../js/hosts/hooks-learn.mjs';

const withDir = async (fn) => {
  const sb = makeSandbox('specfb-');
  try { return await fn(sb.path); } finally { sb.cleanup(); }
};
// Read raw, never CRLF-folded: the notes are written LF on every platform (the tier's files are
// shared with the OpenCode plugin, which writes LF), and this read is what proves it.
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

// The line rule. A line is feedback when it STARTS with `spec-feedback:` (after a list marker, or
// an opening backtick or bold). The scope is read in each of the four ways real reports wrote it
// this month, and a missing scope, or the template's unchosen `[agent|general]`, is `agent`. A
// line that only names the protocol, says there is none, quotes someone (`>`), or quotes the
// include's template is no feedback.
const LINES = [
  ['spec-feedback: [agent] name the diff base in the brief — seen: I had to guess it',
    [{ scope: 'agent', body: 'name the diff base in the brief — seen: I had to guess it' }]],
  ['spec-feedback: [general] say the suite takes 20 minutes — seen: a timeout',
    [{ scope: 'general', body: 'say the suite takes 20 minutes — seen: a timeout' }]],
  ['spec-feedback: general — run git through PowerShell — seen: refused',
    [{ scope: 'general', body: 'run git through PowerShell — seen: refused' }]],
  ['spec-feedback: agent The brief should name the Node version — seen: a crash',
    [{ scope: 'agent', body: 'The brief should name the Node version — seen: a crash' }]],
  ['spec-feedback: the developer spec has no step for a refused shell',
    [{ scope: 'agent', body: 'the developer spec has no step for a refused shell' }]],
  ['- `spec-feedback: [agent] wrapped in backticks, kept whole`',
    [{ scope: 'agent', body: 'wrapped in backticks, kept whole' }]],
  ['**spec-feedback:** [general] bold label, closed at the colon',
    [{ scope: 'general', body: 'bold label, closed at the colon' }]],
  ['spec-feedback: agents need the base ref — seen: drift',
    [{ scope: 'agent', body: 'agents need the base ref — seen: drift' }]],
  // A bare scope word is a scope only standing alone: `agent-notes/…` and `general-purpose …` are
  // the body's own first words. And "none" opens a no-feedback line only as a whole answer.
  ['spec-feedback: agent-notes/<name>.md is never read — seen: empty folder',
    [{ scope: 'agent', body: 'agent-notes/<name>.md is never read — seen: empty folder' }]],
  ['spec-feedback: general-purpose agents need the base ref too',
    [{ scope: 'agent', body: 'general-purpose agents need the base ref too' }]],
  ['spec-feedback: none of the proof commands said which runner',
    [{ scope: 'agent', body: 'none of the proof commands said which runner' }]],
  ['spec-feedback: nothing in the brief named the base ref',
    [{ scope: 'agent', body: 'nothing in the brief named the base ref' }]],
  ['spec-feedback: None.', []],
  ['spec-feedback: none — the spec held', []],
  ['spec-feedback: none', []],
  ['spec-feedback: n/a', []],
  ['No `spec-feedback`.', []],
  ["The reviewer's spec-feedback: say a reviewer may run a scratch script", []],
  ['> Weigh any `spec-feedback:` line an agent report carries', []],
  ["> spec-feedback: [agent] the reviewer's line, quoted in my report", []],
  ['spec-feedback: [agent|general] give the base ref in the brief — seen: drift',
    [{ scope: 'agent', body: 'give the base ref in the brief — seen: drift' }]],
  ['`spec-feedback: [agent|general] <the one-line fix> [— situation: <when it applies>] — seen:', []],
  ['spec-feedback: [agent] rotate ghp_abcdefghijklmnopqrstuvwxyz0123456789 now', []],
];

test('specFeedbackOf: reads every real scope form and skips what is no feedback', () => {
  for (const [line, want] of LINES) assert.deepEqual(specFeedbackOf(line, SECRET_RE), want, line);
});

test('specFeedbackOf: a body seen twice in one report is kept once, and a runaway line is cut at 500', () => {
  const twice = 'spec-feedback: [agent] same fix twice over\nspec-feedback: agent same   fix twice over';
  assert.deepEqual(specFeedbackOf(twice, SECRET_RE), [{ scope: 'agent', body: 'same fix twice over' }]);
  const [long] = specFeedbackOf(`spec-feedback: [agent] ${'x'.repeat(600)}`, SECRET_RE);
  assert.equal(long.body, `${'x'.repeat(500)}…`);
});

// A report pasted with a code fence holds example lines, not this agent's feedback: a line inside
// ``` or ~~~ is skipped, and the fence's end puts reading back on.
test('specFeedbackOf: a line inside a code fence is no feedback', () => {
  const report = ['```', 'spec-feedback: [agent] an example inside a fence', '```',
    '~~~text', 'spec-feedback: [general] another example, tilde fence', '~~~',
    'spec-feedback: [agent] the real line, after the fences'].join('\n');
  assert.deepEqual(specFeedbackOf(report, SECRET_RE), [{ scope: 'agent', body: 'the real line, after the fences' }]);
});

// One home per line: an `agent` line goes to the agent's own note, a `general` line to
// `_general.md` only (every agent reads that file too), with the agent's name beside the date so
// the reader knows who raised it.
test('feedbackBullets: an agent line to the own file, a general line to the general file only', () => {
  const items = [{ scope: 'agent', body: 'a fix' }, { scope: 'general', body: 'b fix' }];
  assert.deepEqual(feedbackBullets(items, 'tester', '2026-11-14'), {
    own: ['- [agent] a fix (2026-11-14)'],
    general: ['- [general] b fix (tester, 2026-11-14)'],
  });
});

// Idempotent by Default: a bullet whose text is already there (whatever its date or agent, case
// or spacing) is not added again, and a merge that adds nothing returns null so nothing is written.
// New bullets are APPENDED and the old text stays as it was (CRLF folded to LF): a heading, prose,
// a nested list, blank lines. Past the cap, or past the character budget, only the oldest bullets
// of the hook's own `- [scope] … (date)` shape drop; a hand-written bullet never does.
test('mergeFeedback: appends, keeps a hand-written file as it was, and caps only the hook bullets', () => {
  const old = '# notes\n- [agent] one (2026-11-01)\n- [agent] two (2026-11-02)\n';
  assert.equal(mergeFeedback(old, ['- [agent] ONE  (2026-11-14)']), null);
  assert.equal(mergeFeedback(old, ['- [agent] three (2026-11-14)'], 2),
    '# notes\n- [agent] two (2026-11-02)\n- [agent] three (2026-11-14)\n');
  assert.equal(mergeFeedback('', ['- [general] g (tester, 2026-11-14)']), '- [general] g (tester, 2026-11-14)\n');
  assert.equal(mergeFeedback('- [general] g (reviewer, 2026-11-01)\n', ['- [general] g (tester, 2026-11-14)']), null);
  const hand = '# tester notes\r\n\r\nSome prose.\r\n- a hand bullet\r\n  - nested under it\r\n- [agent] old (2026-11-01)';
  assert.equal(mergeFeedback(hand, ['- [agent] new (2026-11-14)'], 1),
    '# tester notes\n\nSome prose.\n- a hand bullet\n  - nested under it\n- [agent] new (2026-11-14)\n');
  // The budget: 3 hook bullets of 40 characters do not fit in 100, so the oldest go first.
  const b = (n) => `- [agent] ${String(n).repeat(16)} (2026-11-0${n})`;
  assert.equal(b(1).length, 39);
  assert.equal(mergeFeedback(`${b(1)}\n${b(2)}\n`, [b(3)], 100, 100), `${b(2)}\n${b(3)}\n`);
});

// A sub-agent transcript as the host writes it: one line per content block, the final message's
// blocks under one `message.id`, and an Agent-SDK sub-agent's report inside its SubagentHandback
// call. An EARLIER message's feedback-shaped line is not the report and is not read.
const line = (o) => JSON.stringify(o);
const TRANSCRIPT = [
  line({ type: 'user', isSidechain: true, message: { role: 'user', content: 'do the task' } }),
  line({ type: 'assistant', isSidechain: true, message: { id: 'm1', role: 'assistant',
    content: [{ type: 'text', text: 'spec-feedback: [agent] an early draft line, not the report' }] } }),
  line({ type: 'user', isSidechain: true, message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } }),
  line({ type: 'assistant', isSidechain: true, message: { id: 'm2', role: 'assistant',
    content: [{ type: 'text', text: 'Done.' }] } }),
  line({ type: 'assistant', isSidechain: true, message: { id: 'm2', role: 'assistant',
    content: [{ type: 'tool_use', name: 'SubagentHandback', input: {
      message: 'STATUS: OK\nall green\nspec-feedback: [agent] name the base ref in the brief — seen: a guess\n'
        + 'spec-feedback: [general] say the suite needs the background runner — seen: a timeout' } }] } }),
].join('\n');
const REPORT = 'Done.\nSTATUS: OK\nall green\nspec-feedback: [agent] name the base ref in the brief — seen: a guess\n'
  + 'spec-feedback: [general] say the suite needs the background runner — seen: a timeout';

test('finalAssistantText: every block of the last message, a hand-back message included', () => {
  assert.equal(finalAssistantText(TRANSCRIPT), REPORT);
  assert.equal(finalAssistantText(line({ type: 'user', message: { role: 'user', content: 'x' } })), null);
});

// The host's `last_assistant_message` is the newer copy: when the transcript does not hold it, the
// transcript's last message is an older one, and the report is the host's copy alone, never both.
test('subagentReport: the transcript, or the host copy alone when the transcript lags', async () => {
  await withDir((d) => {
    const tp = path.join(d, 'a.jsonl');
    fs.writeFileSync(tp, `${TRANSCRIPT}\n`);
    const reader = tailReader();
    assert.equal(subagentReport({ agent_transcript_path: tp }, reader), REPORT);
    assert.equal(subagentReport({ agent_transcript_path: tp, last_assistant_message: 'all green' }, reader), REPORT);
    assert.equal(subagentReport({ agent_transcript_path: tp, last_assistant_message: 'spec-feedback: [agent] a newer one' }, reader),
      'spec-feedback: [agent] a newer one');
    assert.equal(subagentReport({ agent_transcript_path: path.join(d, 'missing.jsonl'), last_assistant_message: 'x y' }, reader), 'x y');
  });
});

test('captureSpecFeedback: writes each file once, a second run on the same report adds nothing', async () => {
  await withDir((d) => {
    const notes = path.join(d, 'notes');
    const report = finalAssistantText(TRANSCRIPT);
    const got = captureSpecFeedback('tester', report, notes, '2026-11-14');
    assert.deepEqual(got, [path.join(notes, 'agent-notes', 'tester.md'), path.join(notes, 'agent-notes', '_general.md')]);
    assert.equal(read(notes, 'agent-notes', 'tester.md'),
      '- [agent] name the base ref in the brief — seen: a guess (2026-11-14)\n');
    assert.equal(read(notes, 'agent-notes', '_general.md'),
      '- [general] say the suite needs the background runner — seen: a timeout (tester, 2026-11-14)\n');
    assert.deepEqual(captureSpecFeedback('tester', report, notes, '2026-11-15'), []);
    assert.deepEqual(captureSpecFeedback(null, report, notes, '2026-11-15'), [], 'an unnamed agent writes nothing');
    assert.deepEqual(captureSpecFeedback('tester', report, path.join(d, 'absent', 'notes'), '2026-11-15'), [],
      'no install or tier there: nothing is created');
    assert.equal(fs.existsSync(path.join(d, 'absent')), false);
  });
});

test('captureSpecFeedback: a notes file that is not UTF-8 is left whole', async () => {
  await withDir((d) => {
    const dir = path.join(d, 'notes', 'agent-notes');
    fs.mkdirSync(dir, { recursive: true });
    const bad = Buffer.from([0x2d, 0x20, 0xff, 0xfe, 0x0a]);
    fs.writeFileSync(path.join(dir, 'tester.md'), bad);
    assert.deepEqual(captureSpecFeedback('tester', 'spec-feedback: [agent] a fresh fix here', path.join(d, 'notes'), '2026-11-14'), []);
    assert.deepEqual(fs.readFileSync(path.join(dir, 'tester.md')), bad);
  });
});

// The general file is read by EVERY dispatch, so it keeps fewer bullets: 35 general lines from 35
// reports leave the newest MAX_GENERAL_BULLETS (30), the first five dropped.
test('captureSpecFeedback: the general file keeps the newest 30 bullets', async () => {
  assert.equal(MAX_GENERAL_BULLETS, 30);
  await withDir((d) => {
    const notes = path.join(d, 'notes');
    for (let i = 0; i < 35; i += 1) captureSpecFeedback('tester', `spec-feedback: [general] shared line number ${i}`, notes, '2026-11-14');
    const bullets = read(notes, 'agent-notes', '_general.md').split('\n').filter(Boolean);
    assert.equal(bullets.length, 30);
    assert.equal(bullets[0], '- [general] shared line number 5 (tester, 2026-11-14)');
    assert.equal(fs.existsSync(path.join(notes, 'agent-notes', 'tester.md')), false, 'a general line has one home');
  });
});

// F1: parallel sub-agents end together, so their hooks write one notes file at once. Every hook
// holds the file's lock for its read-merge-write, so N reports with one distinct line each leave
// N bullets: 12 processes in, 12 bullets out (a lost update would leave fewer). They start on one
// signal file to overlap.
test('captureSpecFeedback: 12 hooks at once keep all 12 bullets', async () => {
  const { spawn } = await import('node:child_process');
  const { pathToFileURL } = await import('node:url');
  await withDir(async (d) => {
    const notes = path.join(d, 'notes');
    const go = path.join(d, 'go');
    const mod = pathToFileURL(path.resolve('js/hosts/spec-feedback.mjs')).href;
    const script = `const fs = await import('node:fs');
const { captureSpecFeedback } = await import(${JSON.stringify(mod)});
while (!fs.existsSync(${JSON.stringify(go)})) await new Promise((r) => setTimeout(r, 2));
captureSpecFeedback('tester', 'spec-feedback: [agent] parallel line number ' + process.argv[1] + ' kept', ${JSON.stringify(notes)}, '2026-11-14');`;
    const N = 12;
    const runs = Array.from({ length: N }, (_, i) => new Promise((resolve) => {
      const p = spawn(process.execPath, ['--input-type=module', '-e', script, String(i)], { stdio: 'ignore' });
      p.on('exit', resolve);
    }));
    await new Promise((r) => setTimeout(r, 1500));
    fs.writeFileSync(go, '');
    await Promise.all(runs);
    const bullets = read(notes, 'agent-notes', 'tester.md').split('\n').filter((l) => l.startsWith('- '));
    assert.equal(bullets.length, N, bullets.join('\n'));
    assert.equal(fs.readdirSync(path.join(notes, 'agent-notes')).filter((f) => !f.endsWith('.md')).length, 0,
      'no lock or temp file is left behind');
  });
});

// ---- Through the hook: `learn` on a SubagentStop payload, `$GENESEED_LLM` unset ------------------

async function inEnv(env, fn) {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

/** A Claude-style install at <d>/cfg (memory/ beside notebook/), marked `emit`, and a tier under <d>/xdg. */
function world(d, emit, { shared }) {
  const cfg = path.join(d, 'cfg');
  fs.mkdirSync(path.join(cfg, 'memory'), { recursive: true });
  fs.mkdirSync(path.join(cfg, 'notebook'));
  fs.writeFileSync(path.join(cfg, '.geneseed-emit'), emit);
  const xdg = path.join(d, 'xdg');
  if (shared) fs.mkdirSync(path.join(xdg, 'geneseed', 'memory'), { recursive: true });
  fs.writeFileSync(path.join(d, 'agent.jsonl'), `${TRANSCRIPT}\n`);
  const empty = path.join(d, 'project');
  fs.mkdirSync(empty);
  return { cfg, xdg, empty, transcript: path.join(d, 'agent.jsonl') };
}

function subagentStop(w, d, payload) {
  const file = path.join(d, 'payload.json');
  fs.writeFileSync(file, JSON.stringify({ hook_event_name: 'SubagentStop', session_id: 's',
    agent_transcript_path: w.transcript, ...payload }));
  return inEnv({ GENESEED_LLM: undefined, GENESEED_MEMORY: undefined, GENESEED_HARNESS: undefined,
    GENESEED_LEARN_CHILD: undefined, XDG_CONFIG_HOME: w.xdg, CLAUDE_PROJECT_DIR: w.empty },
  () => cmdLearn({ memory: path.join(w.cfg, 'memory'), host: 'claude', file, noDoneGate: true }));
}

// What one stop leaves: the agent line in the agent's file, the general line in `_general.md`.
const DATE = '\\d{4}-\\d{2}-\\d{2}';
const ownNote = new RegExp(`^- \\[agent\\] name the base ref in the brief — seen: a guess \\(${DATE}\\)\\n$`);
const generalNote = new RegExp(`^- \\[general\\] say the suite needs the background runner — seen: a timeout \\(tester, ${DATE}\\)\\n$`);
const bullet = (who) => (who ? generalNote : ownNote);

test('learn hook: a global install writes to the tier notes, with $GENESEED_LLM unset', async () => {
  await withDir(async (d) => {
    const w = world(d, 'claude-global', { shared: true });
    assert.equal(await subagentStop(w, d, { agent_type: 'tester' }), 0);
    const tier = path.join(w.xdg, 'geneseed', 'notes', 'agent-notes');
    assert.match(read(tier, 'tester.md'), bullet(''));
    assert.match(read(tier, '_general.md'), bullet('tester, '));
    assert.equal(fs.existsSync(path.join(w.cfg, 'notebook', 'agent-notes')), false, 'not beside the host store too');
  });
});

test('learn hook: a project install, or a global one with no tier yet, writes to <install>/notebook', async () => {
  for (const [emit, shared] of [['claude', true], ['claude-global', false]]) {
    await withDir(async (d) => {
      const w = world(d, emit, { shared });
      await subagentStop(w, d, { agent_type: 'tester' });
      assert.match(read(w.cfg, 'notebook', 'agent-notes', 'tester.md'), bullet(''), emit);
      assert.equal(fs.existsSync(path.join(w.xdg, 'geneseed', 'notes')), false, emit);
    });
  }
});

test('learn hook: an unnamed or namespaced agent writes nothing, and a second stop adds nothing', async () => {
  await withDir(async (d) => {
    const w = world(d, 'claude', { shared: false });
    await subagentStop(w, d, {});
    await subagentStop(w, d, { agent_type: 'plug:reviewer' });
    assert.equal(fs.existsSync(path.join(w.cfg, 'notebook', 'agent-notes')), false);
    await subagentStop(w, d, { agent_type: 'tester' });
    const once = read(w.cfg, 'notebook', 'agent-notes', 'tester.md');
    await subagentStop(w, d, { agent_type: 'tester' });
    assert.equal(read(w.cfg, 'notebook', 'agent-notes', 'tester.md'), once);
  });
});

test('learn hook: a Stop (not SubagentStop) never captures', async () => {
  await withDir(async (d) => {
    const w = world(d, 'claude', { shared: false });
    await subagentStop(w, d, { hook_event_name: 'Stop', transcript_path: w.transcript, agent_type: 'tester' });
    assert.equal(fs.existsSync(path.join(w.cfg, 'notebook', 'agent-notes')), false);
  });
});

test('notesRootOf: the tier store maps to the tier notes, any other store to its install notebook', async () => {
  await withDir((d) => inEnv({ XDG_CONFIG_HOME: d }, () => {
    assert.equal(notesRootOf(path.join(d, 'geneseed', 'memory')), path.join(d, 'geneseed', 'notes'));
    assert.equal(notesRootOf(path.join(d, 'cfg', 'memory')), path.join(d, 'cfg', 'notebook'));
    assert.equal(notesRootOf(null), null);
  }));
});

test('today: a local YYYY-MM-DD', () => {
  assert.equal(today(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});
