// The agents' self-improvement loop, closed by the hook (js/hosts/spec-feedback.mjs): on
// SubagentStop the `spec-feedback:` lines of the sub-agent's final report go into the notes its
// next dispatch reads, with no model call. Every expected value is written out below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { homeOverrides, makeSandbox } from '../helpers/sandbox.mjs';
import {
  captureSpecFeedback, feedbackBullets, finalAssistantText, liveSkill, mergeFeedback, skillBullets, specFeedbackOf, subagentReport,
  today, turnReply, withLock, MAX_GENERAL_BULLETS,
} from '../../js/hosts/spec-feedback.mjs';
import { spawnHook } from '../helpers/hook_run.mjs';
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

// A skill's line always NAMES the skill: `[skill:<name>]` for its own notes, `[skill:<name>:general]`
// (or `, general` / ` general`) for the file every skill shares. The name is folded to lower case
// and must be a slug; the template's `<name>`, a path or an empty name drops the line whole, so a
// `[skill:…]` tag never falls through into an agent's notes. `|general` is the template's
// unchosen pair and reads as the skill's own, as `[agent|general]` reads as agent. The brackets
// may be dropped. The agents' rules hold too: a quoted, protocol-naming, "none" or secret line is
// no note, and `skill-notes/…` (no colon after `skill`) is an agent body, not a tag.
const SKILL_LINES = [
  ['spec-feedback: [skill:debug] run the failing test alone first — seen: a flaky run',
    [{ scope: 'skill', skill: 'debug', body: 'run the failing test alone first — seen: a flaky run' }]],
  ['spec-feedback: [skill:debug:general] name the base ref in every brief — seen: drift',
    [{ scope: 'general', skill: 'debug', body: 'name the base ref in every brief — seen: drift' }]],
  ['spec-feedback: [skill: Debug , general] case and spacing are folded — seen: x',
    [{ scope: 'general', skill: 'debug', body: 'case and spacing are folded — seen: x' }]],
  ['spec-feedback: [skill:debug general] a space before general works too',
    [{ scope: 'general', skill: 'debug', body: 'a space before general works too' }]],
  ['spec-feedback: [skill:debug|general] the unchosen pair reads as its own',
    [{ scope: 'skill', skill: 'debug', body: 'the unchosen pair reads as its own' }]],
  ['spec-feedback: skill:debug — the bare tag is the skill\'s too',
    [{ scope: 'skill', skill: 'debug', body: 'the bare tag is the skill\'s too' }]],
  ['- **spec-feedback:** [skill:plan] bold label and a list marker',
    [{ scope: 'skill', skill: 'plan', body: 'bold label and a list marker' }]],
  ['spec-feedback: skill-notes/debug.md is never read — seen: empty',
    [{ scope: 'agent', body: 'skill-notes/debug.md is never read — seen: empty' }]],
  ['spec-feedback: [skill:<name>] a filled body under the template name', []],
  ['spec-feedback: [skill:<name>] <the one-line fix> [— situation: <when it applies>] — seen: <what happened>', []],
  ['spec-feedback: [skill:../evil] a path is no skill name at all', []],
  ['spec-feedback: [skill:] an empty name is no skill name', []],
  ['spec-feedback: [skill:9lives] a name opens with a letter', []],
  ['spec-feedback: [skill:debug] none', []],
  ['> spec-feedback: [skill:debug] a quoted line is someone else\'s', []],
  ['The debug skill\'s spec-feedback: [skill:debug] only names the protocol', []],
  ['spec-feedback: [skill:debug] rotate ghp_abcdefghijklmnopqrstuvwxyz0123456789 now', []],
  // A tag that opens like a skill's but does not parse is dropped whole, never an agent's line.
  ['spec-feedback: [skill:superpowers:brainstorming] a namespaced plugin skill — seen: x', []],
  ['spec-feedback: [skill:debug, plan] two skills in one tag — seen: x', []],
  ['spec-feedback: skill: debug a bare tag with a space — seen: x', []],
  // A skill line in inline code is an example the reply quotes, not its own line; in a fence too.
  ['`spec-feedback: [skill:debug] quoted as inline code in a summary — seen: x`', []],
  ['- `spec-feedback: [skill:debug:general] a listed example — seen: x`', []],
];

test('specFeedbackOf: a fenced skill line is an example, not a note', () => {
  const reply = ['The format:', '```', 'spec-feedback: [skill:debug] an example inside a fence — seen: x', '```',
    'spec-feedback: [skill:debug] the real line, after the fence — seen: y'].join('\n');
  assert.deepEqual(specFeedbackOf(reply, SECRET_RE),
    [{ scope: 'skill', skill: 'debug', body: 'the real line, after the fence — seen: y' }]);
});

test('specFeedbackOf: a skill line names its skill, and every near miss is no note', () => {
  for (const [line, want] of SKILL_LINES) assert.deepEqual(specFeedbackOf(line, SECRET_RE), want, line);
});

test('specFeedbackOf: one body for two skills is two notes, for one skill twice is one', () => {
  const report = 'spec-feedback: [skill:debug] the same words here\nspec-feedback: [skill:plan] the same words here\n'
    + 'spec-feedback: [skill:debug] the same  words here';
  assert.deepEqual(specFeedbackOf(report, SECRET_RE), [
    { scope: 'skill', skill: 'debug', body: 'the same words here' },
    { scope: 'skill', skill: 'plan', body: 'the same words here' },
  ]);
});

// A skill's line has one home: its own `skill-notes/<name>.md` as `- [skill] … (<skill>, date)`, or
// `skill-notes/_general.md` as `- [general] … (<skill>, date)`. The name beside the date marks the
// hook's bullet. The agent's bullets never take a skill line, and the skills' never take an agent line.
test('skillBullets and feedbackBullets: each line to its one home', () => {
  const items = [{ scope: 'skill', skill: 'debug', body: 'a fix' }, { scope: 'general', skill: 'plan', body: 'b fix' },
    { scope: 'agent', body: 'c fix' }, { scope: 'skill', skill: 'debug', body: 'd fix' }];
  const s = skillBullets(items, '2026-11-14');
  assert.deepEqual([...s.own], [['debug', ['- [skill] a fix (debug, 2026-11-14)', '- [skill] d fix (debug, 2026-11-14)']]]);
  assert.deepEqual(s.general, ['- [general] b fix (plan, 2026-11-14)']);
  assert.deepEqual(feedbackBullets(items, 'tester', '2026-11-14'), { own: ['- [agent] c fix (tester, 2026-11-14)'], general: [] });
});

// The owner's ruling: a hand-written line is never dropped. The skills' notes were written by hand
// as `- [skill] … (date)` before the hook; the hook's own bullets carry `(<skill>, date)`. So a hook
// bullet with the same words is one note (the tails are read past), and the cap and the budget drop
// only the hook's bullets: with a cap of 1, the hand line stays and the older hook bullet goes.
test('mergeFeedback: a hand-written [skill] line is never dropped, and is the same note as the hook\'s', () => {
  const hand = '- [skill] Name the git ref each unit reviews — seen: six units measured 5.1.0 (2026-11-11)\n';
  assert.equal(mergeFeedback(hand, ['- [skill] name the git ref each unit reviews — seen: six units measured 5.1.0 (parallel-agents, 2026-11-15)']), null);
  const one = mergeFeedback(hand, ['- [skill] a newer one (parallel-agents, 2026-11-15)'], 1);
  assert.equal(one, `${hand}- [skill] a newer one (parallel-agents, 2026-11-15)\n`);
  assert.equal(mergeFeedback(one, ['- [skill] the newest (parallel-agents, 2026-11-16)'], 1),
    `${hand}- [skill] the newest (parallel-agents, 2026-11-16)\n`);
  // The same for a hand `[general]` line with no writer's name, and under the character budget.
  const gen = '- [general] a hand general line (2026-11-11)\n';
  assert.equal(mergeFeedback(gen, ['- [general] x'.padEnd(60, 'x') + ' (debug, 2026-11-15)'], 30, 10),
    `${gen}${'- [general] x'.padEnd(60, 'x')} (debug, 2026-11-15)\n`);
});

// The capture with no agent (a Stop): only skill lines, and only for a skill the install ships
// (`skillsDir/<name>/`), so an invented name writes no file. With an agent (a SubagentStop), the
// agent's lines go to agent-notes and the skill lines still go to skill-notes.
const MIXED = ['spec-feedback: [skill:debug] read the stack trace before the diff — seen: a guess',
  'spec-feedback: [skill:debug:general] say which runner the repo uses — seen: a wrong runner',
  'spec-feedback: [skill:ghost] a skill this install does not ship — seen: x',
  'spec-feedback: [agent] relayed from a worker — seen: y',
  'spec-feedback: [general] relayed general from a worker — seen: z'].join('\n');
/** A rendered skill as an install ships it: its SKILL.md names its own notes file. */
const shipSkill = (skills, name, notesOf = name) => {
  fs.mkdirSync(path.join(skills, name), { recursive: true });
  fs.writeFileSync(path.join(skills, name, 'SKILL.md'), `# ${name}\n\nRead \`notebook/skill-notes/${notesOf}.md\` first.\n`);
};

// Live means the install's SKILL.md under that name reads that name's notes. An alias folder an
// older build left (`deps-audit/`, whose body is `dependencies`'), a skill rendered before its id
// was (`<name>`), a folder with no SKILL.md: none of them is live, so no note is written for it.
test('liveSkill: only a SKILL.md that reads its own notes file', async () => {
  await withDir((d) => {
    shipSkill(d, 'debug');
    shipSkill(d, 'deps-audit', 'dependencies');
    shipSkill(d, 'old', '<name>');
    fs.mkdirSync(path.join(d, 'empty'));
    assert.deepEqual(['debug', 'deps-audit', 'old', 'empty', 'absent'].map((n) => liveSkill(d, n)),
      [true, false, false, false, false]);
    assert.equal(liveSkill(null, 'debug'), false);
  });
});

test('captureSpecFeedback: no agent writes skill lines only, and only for a shipped skill', async () => {
  await withDir((d) => {
    const notes = path.join(d, 'notes');
    const skills = path.join(d, 'skills');
    shipSkill(skills, 'debug');
    assert.deepEqual(captureSpecFeedback(null, MIXED, notes, '2026-11-14'), [], 'no skills dir: no skill line counts');
    assert.equal(fs.existsSync(notes), false);
    assert.deepEqual(captureSpecFeedback(null, MIXED, notes, '2026-11-14', skills),
      [path.join(notes, 'skill-notes', 'debug.md'), path.join(notes, 'skill-notes', '_general.md')]);
    assert.equal(read(notes, 'skill-notes', 'debug.md'), '- [skill] read the stack trace before the diff — seen: a guess (debug, 2026-11-14)\n');
    assert.equal(read(notes, 'skill-notes', '_general.md'), '- [general] say which runner the repo uses — seen: a wrong runner (debug, 2026-11-14)\n');
    assert.deepEqual(fs.readdirSync(notes), ['skill-notes']);
    assert.deepEqual(fs.readdirSync(path.join(notes, 'skill-notes')).sort(), ['_general.md', 'debug.md']);
    assert.deepEqual(captureSpecFeedback(null, MIXED, notes, '2026-11-15', skills), [], 'the same lines again add nothing');
    assert.deepEqual(captureSpecFeedback('tester', MIXED, notes, '2026-11-15', skills),
      [path.join(notes, 'agent-notes', 'tester.md'), path.join(notes, 'agent-notes', '_general.md')]);
    assert.equal(read(notes, 'agent-notes', 'tester.md'), '- [agent] relayed from a worker — seen: y (tester, 2026-11-15)\n');
  });
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
    own: ['- [agent] a fix (tester, 2026-11-14)'],
    general: ['- [general] b fix (tester, 2026-11-14)'],
  });
});

// Idempotent by Default: a bullet whose text is already there (whatever its date or agent, case
// or spacing) is not added again, and a merge that adds nothing returns null so nothing is written.
// New bullets are APPENDED and the old text stays as it was (CRLF folded to LF): a heading, prose,
// a nested list, blank lines. Past the cap, or past the character budget, only the oldest bullets
// of the hook's own shape drop, `- [scope] … (<writer>, date)`; a hand-written line never does,
// even one dated `(date)` with no writer's name (the shape the hook used before 2026-11-15).
test('mergeFeedback: appends, keeps a hand-written file as it was, and caps only the hook bullets', () => {
  const old = '# notes\n- [agent] one (tester, 2026-11-01)\n- [agent] two (tester, 2026-11-02)\n';
  assert.equal(mergeFeedback(old, ['- [agent] ONE  (tester, 2026-11-14)']), null);
  assert.equal(mergeFeedback(old, ['- [agent] three (tester, 2026-11-14)'], 2),
    '# notes\n- [agent] two (tester, 2026-11-02)\n- [agent] three (tester, 2026-11-14)\n');
  assert.equal(mergeFeedback('', ['- [general] g (tester, 2026-11-14)']), '- [general] g (tester, 2026-11-14)\n');
  assert.equal(mergeFeedback('- [general] g (reviewer, 2026-11-01)\n', ['- [general] g (tester, 2026-11-14)']), null);
  const hand = '# tester notes\r\n\r\nSome prose.\r\n- a hand bullet\r\n  - nested under it\r\n- [agent] old (tester, 2026-11-01)';
  assert.equal(mergeFeedback(hand, ['- [agent] new (tester, 2026-11-14)'], 1),
    '# tester notes\n\nSome prose.\n- a hand bullet\n  - nested under it\n- [agent] new (tester, 2026-11-14)\n');
  // A dated line with no writer's name is a hand line: with a cap of 1 it stays, past any count.
  const dated = '- [agent] written by hand (2026-11-01)\n';
  assert.equal(mergeFeedback(dated, ['- [agent] a (tester, 2026-11-14)'], 1), `${dated}- [agent] a (tester, 2026-11-14)\n`);
  // The budget: 3 hook bullets of 47 characters do not fit in 100, so the oldest go first.
  const b = (n) => `- [agent] ${String(n).repeat(16)} (tester, 2026-11-0${n})`;
  assert.equal(b(1).length, 47);
  assert.equal(mergeFeedback(`${b(1)}\n${b(2)}\n`, [b(3)], 100, 100), `${b(2)}\n${b(3)}\n`);
  // A bullet this call adds never drops: when hand-written text alone is over the budget (9 000
  // characters against 8 000), the new bullet is kept and the file goes over, rather than a write
  // that claims a note it threw away.
  const prose = `${'p'.repeat(8999)}`;
  assert.equal(mergeFeedback(prose, ['- [agent] kept anyway (2026-11-14)']), `${prose}\n- [agent] kept anyway (2026-11-14)\n`);
});

// The lock's two safety rules. A lock older than the stale age is a dead hook's: it is broken and
// the write goes on. And a holder removes the lock on release only while it holds its OWN token:
// a lock replaced under it (here by hand, inside the critical section) belongs to someone else
// and stays.
test('withLock: a stale lock is broken, and a lock that is no longer yours is not removed', async () => {
  await withDir((d) => {
    const file = path.join(d, 'n.md');
    fs.writeFileSync(`${file}.lock`, 'dead.hook');
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(`${file}.lock`, old, old);
    assert.equal(withLock(file, () => 'ran'), 'ran');
    assert.equal(fs.existsSync(`${file}.lock`), false, 'the stale lock was broken, then released');
    assert.equal(withLock(file, () => { fs.writeFileSync(`${file}.lock`, 'someone.else'); return 'ran'; }), 'ran');
    assert.equal(fs.readFileSync(`${file}.lock`, 'utf8'), 'someone.else');
    assert.deepEqual(fs.readdirSync(d).sort(), ['n.md.lock'], 'no renamed stale lock is left behind');
  });
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

// The report is the UNION of the transcript's final message and the host's
// `last_assistant_message` when the transcript does not hold it. The host copy may be NEWER (a
// lagging transcript) or OLDER (the final message is a hand-back call with no text block, so the
// host's "last text" is an earlier line): either way the side holding the report is kept, and a
// stray earlier line costs at most a deduplicated bullet.
test('subagentReport: the transcript plus the host copy when the transcript does not hold it', async () => {
  await withDir((d) => {
    const tp = path.join(d, 'a.jsonl');
    fs.writeFileSync(tp, `${TRANSCRIPT}\n`);
    const reader = tailReader();
    assert.equal(subagentReport({ agent_transcript_path: tp }, reader), REPORT);
    assert.equal(subagentReport({ agent_transcript_path: tp, last_assistant_message: 'all green' }, reader), REPORT);
    assert.equal(subagentReport({ agent_transcript_path: tp, last_assistant_message: 'spec-feedback: [agent] a newer one' }, reader),
      `${REPORT}\nspec-feedback: [agent] a newer one`);
    assert.equal(subagentReport({ agent_transcript_path: path.join(d, 'missing.jsonl'), last_assistant_message: 'x y' }, reader), 'x y');
    // The hand-back case: the host's copy is an earlier text, the report sits in the tool call.
    const handback = path.join(d, 'h.jsonl');
    fs.writeFileSync(handback, [
      line({ type: 'assistant', message: { id: 'e', role: 'assistant', content: [{ type: 'text', text: 'Let me read the file.' }] } }),
      line({ type: 'assistant', message: { id: 'f', role: 'assistant', content: [{ type: 'tool_use', name: 'SubagentHandback',
        input: { message: 'STATUS: OK\nspec-feedback: [agent] give the worktree path in the brief — seen: a guess' } }] } }),
    ].join('\n'));
    const got = subagentReport({ agent_transcript_path: handback, last_assistant_message: 'Let me read the file.' }, tailReader());
    assert.deepEqual(specFeedbackOf(got, SECRET_RE), [{ scope: 'agent', body: 'give the worktree path in the brief — seen: a guess' }]);
  });
});

test('captureSpecFeedback: writes each file once, a second run on the same report adds nothing', async () => {
  await withDir((d) => {
    const notes = path.join(d, 'notes');
    const report = finalAssistantText(TRANSCRIPT);
    const got = captureSpecFeedback('tester', report, notes, '2026-11-14');
    assert.deepEqual(got, [path.join(notes, 'agent-notes', 'tester.md'), path.join(notes, 'agent-notes', '_general.md')]);
    assert.equal(read(notes, 'agent-notes', 'tester.md'),
      '- [agent] name the base ref in the brief — seen: a guess (tester, 2026-11-14)\n');
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
const ownNote = new RegExp(`^- \\[agent\\] name the base ref in the brief — seen: a guess \\(tester, ${DATE}\\)\\n$`);
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

// A Stop is the main session's: it has no agent, and its `[agent]` and plain `[general]` lines are
// relayed from sub-agents, so neither agent notes nor skill notes get them.
test('learn hook: a Stop (not SubagentStop) never captures an agent\'s line', async () => {
  await withDir(async (d) => {
    const w = world(d, 'claude', { shared: false });
    await subagentStop(w, d, { hook_event_name: 'Stop', transcript_path: w.transcript, agent_type: 'tester' });
    assert.equal(fs.existsSync(path.join(w.cfg, 'notebook', 'agent-notes')), false);
    assert.equal(fs.existsSync(path.join(w.cfg, 'notebook', 'skill-notes')), false);
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

// ---- Skills: `learn` on a Stop, through the real hook binary ------------------------------------
// A skill runs in the main context, so no SubagentStop sees it: its `[skill:<name>]` line is read off
// the main session's final reply at Stop and copied into the notes that skill reads. Each run spawns
// bin/geneseed-hook.mjs with the payload on stdin, every home sandboxed and `$GENESEED_LLM` unset.

const asst = (text, id = 'fin') => JSON.stringify({ type: 'assistant', message: { id, role: 'assistant', content: [{ type: 'text', text }] } });
const usr = (text) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
const SKILL_REPLY = ['Done, the bug is fixed.',
  'spec-feedback: [skill:debug] read the stack trace before the diff — seen: a guess',
  'spec-feedback: [skill:debug:general] say which runner the repo uses — seen: a wrong runner',
  'spec-feedback: [agent] relayed from a worker — seen: y'].join('\n');
const SKILL_NOTE = new RegExp(`^- \\[skill\\] read the stack trace before the diff — seen: a guess \\(debug, ${DATE}\\)\\n$`);
const SKILL_GENERAL = new RegExp(`^- \\[general\\] say which runner the repo uses — seen: a wrong runner \\(debug, ${DATE}\\)\\n$`);

/** A project (a git root, `checks` its done list), an install shipping `skills`, and a Stop runner. */
function stopWorld({ emit = 'claude', tier = false, skills = ['debug'], checks = null, exclude = false } = {}) {
  const sb = makeSandbox('skillfb-');
  const home = path.join(sb.path, 'home');
  const proj = path.join(sb.path, 'proj');
  fs.mkdirSync(path.join(proj, '.git'), { recursive: true });
  if (checks) {
    fs.mkdirSync(path.join(proj, '.geneseed'));
    fs.writeFileSync(path.join(proj, '.geneseed', 'done-checks.txt'), checks);
  }
  const install = path.join(sb.path, 'install');
  fs.mkdirSync(path.join(install, 'memory'), { recursive: true });
  fs.mkdirSync(path.join(install, 'notebook'));
  for (const s of skills) shipSkill(path.join(install, 'skills'), s);
  fs.writeFileSync(path.join(install, '.geneseed-emit'), emit);
  if (tier) fs.mkdirSync(path.join(home, '.config', 'geneseed', 'memory'), { recursive: true });
  if (exclude) fs.writeFileSync(path.join(install, 'excludes.json'), JSON.stringify({ excludes: [proj] }));
  const transcript = path.join(sb.path, 't.jsonl');
  const env = { ...process.env, ...homeOverrides(home), CLAUDE_PROJECT_DIR: proj };
  for (const k of ['GENESEED_LLM', 'GENESEED_LEARN_CHILD', 'GENESEED_MEMORY', 'GENESEED_HARNESS']) delete env[k];
  const stop = (rows, payload = {}, { argv = [], body = null } = {}) => {
    fs.writeFileSync(transcript, `${rows.join('\n')}\n`);
    const sent = body ?? { hook_event_name: 'Stop', session_id: 's', cwd: proj, transcript_path: transcript, ...payload };
    const p = spawnHook(['learn', '--memory', path.join(install, 'memory'), ...argv], JSON.stringify(sent), { cwd: proj, env });
    return { rc: p.status, out: p.stdout, err: p.stderr };
  };
  const notes = tier ? path.join(home, '.config', 'geneseed', 'notes') : path.join(install, 'notebook');
  const note = (name) => {
    const f = path.join(notes, 'skill-notes', name);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  };
  return { sb, proj, install, notes, stop, note };
}
const inWorld = (opts, fn) => { const w = stopWorld(opts); try { return fn(w); } finally { w.sb.cleanup(); } };

test('learn on Stop: a skill line is copied with no model, stdout stays empty, and a re-read adds nothing', () => {
  inWorld({}, (w) => {
    const r = w.stop([usr('fix it'), asst(SKILL_REPLY)]);
    assert.equal(r.rc, 0, r.err);
    assert.equal(r.out, '', 'the capture printed on stdout');
    assert.match(w.note('debug.md') ?? '', SKILL_NOTE, r.err);
    assert.match(w.note('_general.md') ?? '', SKILL_GENERAL);
    assert.equal(fs.existsSync(path.join(w.notes, 'agent-notes')), false, 'a relayed [agent] line is no note on Stop');
    // The same Stop again, and a resumed session whose newest reply repeats the lines: nothing added.
    const once = [w.note('debug.md'), w.note('_general.md')];
    w.stop([usr('fix it'), asst(SKILL_REPLY)]);
    w.stop([usr('fix it'), asst(SKILL_REPLY), usr('again'), asst(SKILL_REPLY, 'fin2')]);
    assert.deepEqual([w.note('debug.md'), w.note('_general.md')], once);
    // Only the final reply is read: an earlier reply's line is not this turn's.
    w.stop([usr('a'), asst('spec-feedback: [skill:debug] an earlier turn\'s line here', 'e1'), usr('b'), asst('ok', 'e2')]);
    assert.deepEqual([w.note('debug.md'), w.note('_general.md')], once);
  });
});

// The host copy, `last_assistant_message`: with no `spec-feedback` in it the transcript is never read
// (the common Stop costs a substring test), and it is read alone when the transcript lags.
test('learn on Stop: the host copy decides whether the transcript is read', () => {
  inWorld({}, (w) => {
    w.stop([usr('fix it'), asst(SKILL_REPLY)], { last_assistant_message: 'Done, the bug is fixed.' });
    assert.equal(w.note('debug.md'), null, 'the transcript was read past a host copy with no feedback');
    w.stop([], { transcript_path: path.join(w.install, 'missing.jsonl'), last_assistant_message: SKILL_REPLY });
    assert.match(w.note('debug.md') ?? '', SKILL_NOTE);
  });
});

// A turn the done gate blocks: the blocked reply is the one that carries the line, and the reply
// that finally ends the turn ("lint green") does not repeat it. So the line is kept at the BLOCKED
// Stop, with the verdict still the one document on stdout, and the passing Stop adds nothing.
test('learn on Stop: a blocked turn keeps its skill line, and the Stop that passes adds nothing', () => {
  const editRows = (proj) => [usr('fix it'),
    JSON.stringify({ type: 'assistant', message: { id: 'ed', role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: path.join(proj, 'a.js') } }] } }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', is_error: false }] } }),
    asst(SKILL_REPLY)];
  const lint = [JSON.stringify({ type: 'assistant', message: { id: 'ln', role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm run lint' } }] } }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', is_error: false }] } }),
    asst('lint green', 'fin2')];
  inWorld({ checks: 'npm run lint\n' }, (w) => {
    const r = w.stop(editRows(w.proj));
    assert.deepEqual(Object.keys(JSON.parse(r.out)).sort(), ['decision', 'reason'], r.err);
    assert.equal(JSON.parse(r.out).decision, 'block');
    assert.match(w.note('debug.md') ?? '', SKILL_NOTE, 'the blocked reply\'s line was lost');
    const once = w.note('debug.md');
    const pass = w.stop([...editRows(w.proj), ...lint], { stop_hook_active: true });
    assert.equal(pass.out, '', pass.err);
    assert.equal(w.note('debug.md'), once);
  });
});

// Each row: what the world is, then the Stop. None of them writes a skill note.
test('learn on Stop: an excluded folder, an unshipped skill, an alias and Bob write no skill note', () => {
  inWorld({ skills: [] }, (w) => {
    shipSkill(path.join(w.install, 'skills'), 'debug', 'dependencies'); // an alias folder left by an older build
    w.stop([usr('fix it'), asst(SKILL_REPLY)]);
    assert.equal(fs.existsSync(path.join(w.notes, 'skill-notes')), false, 'an alias folder counted as a live skill');
  });
  inWorld({ exclude: true }, (w) => {
    assert.equal(w.stop([usr('fix it'), asst(SKILL_REPLY)]).out, '');
    assert.equal(fs.existsSync(path.join(w.notes, 'skill-notes')), false, 'an excluded folder captured a note');
  });
  inWorld({ skills: ['plan'] }, (w) => {
    w.stop([usr('fix it'), asst(SKILL_REPLY)]);
    assert.equal(fs.existsSync(path.join(w.notes, 'skill-notes')), false, 'a skill this install does not ship got a note');
  });
  inWorld({}, (w) => {
    const r = w.stop([], {}, { argv: ['--host', 'bob'], body: { event: 'Stop', session_id: 's' } });
    assert.equal(r.rc, 0);
    assert.match(r.err, /no transcript available \(bob\)/);
    assert.equal(fs.existsSync(path.join(w.notes, 'skill-notes')), false);
  });
});

test('learn on Stop: a global install with the shared tier writes to the tier\'s skill notes', () => {
  inWorld({ emit: 'claude-global', tier: true }, (w) => {
    const r = w.stop([usr('fix it'), asst(SKILL_REPLY)]);
    assert.match(w.note('debug.md') ?? '', SKILL_NOTE, r.err);
    assert.equal(fs.existsSync(path.join(w.install, 'notebook', 'skill-notes')), false, 'not beside the host store too');
  });
});

// The render writes each skill's own id into its include ({{SKILL_NAME}}), so the notes path and
// the tag are literal and the capture's `liveSkill` can read them back; the include rendered on its
// own keeps the `<name>` placeholder. Both footprints, every skill that carries the include.
test('render: every skill names its own notes file and tag, the include alone keeps <name>', async () => {
  const { renderAll } = await import('../../js/build/render.mjs');
  const { makeCfg } = await import('../../js/build/source.mjs');
  for (const footprint of ['full', 'lean']) {
    const { items } = renderAll(makeCfg(), 'neutral', { footprint });
    const skills = items.filter((i) => /^skills\/[a-z][a-z0-9-]*\.md$/.test(i.rel) && i.text.includes('spec-feedback:'));
    assert.ok(skills.length >= 40, `${footprint}: only ${skills.length} skills carry the include`);
    for (const { rel, text } of skills) {
      const id = rel.slice('skills/'.length, -'.md'.length);
      assert.ok(text.includes(`skill-notes/${id}.md`) && text.includes(`[skill:${id}]`), `${footprint} ${rel}`);
      assert.ok(!text.includes('{{SKILL_NAME}}') && !text.includes('[skill:<name>]'), `${footprint} ${rel}`);
    }
    const include = items.find((i) => i.rel === 'skills/_self-improvement.md');
    assert.ok(include && include.text.includes('skill-notes/<name>.md'), footprint);
  }
});

test('turnReply: the host copy alone decides when it holds no feedback', () => {
  assert.equal(turnReply({ last_assistant_message: 'all done', transcript_path: '/nowhere' }, tailReader()), '');
  assert.equal(turnReply({ last_assistant_message: 'spec-feedback: [skill:x] y' }, tailReader()), 'spec-feedback: [skill:x] y');
  assert.equal(turnReply({}, tailReader()), '');
});
