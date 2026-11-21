// THE RELAY CEILING (js/hosts/hooks-relay.mjs): a Foreman task worker past RELAY_CEILING tokens of
// context may only commit its work in progress and hand off. Every expected value is written out.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT } from '../../js/build/source.mjs';
import { RELAY_CEILING, TAIL_BYTES, agentTranscript, lastContext, relayDue } from '../../js/hosts/hooks-relay.mjs';
import { relayMayRun } from '../../js/hosts/hooks.mjs';
import { makeSandbox, homeOverrides } from '../helpers/sandbox.mjs';
import { spawnHook } from '../helpers/hook_run.mjs';

// One assistant line as Claude Code writes it, holding `n` tokens of context: 2 uncached, the rest
// split between a cache read and a cache write, as a real turn's usage is.
const assistant = (n) => JSON.stringify({ type: 'assistant', message: { role: 'assistant',
  usage: { input_tokens: 2, cache_read_input_tokens: n - 1002, cache_creation_input_tokens: 1000, output_tokens: 50 } } });
const toolResult = (chars) => JSON.stringify({ type: 'user', message: { role: 'user',
  content: [{ type: 'tool_result', tool_use_id: 't', content: 'x'.repeat(chars) }] } });

// The ceiling's one other home is the developer spec's prose: it must say the same number.
test('the developer spec names the ceiling the gate enforces', () => {
  const spec = fs.readFileSync(path.join(ROOT, 'src', 'agents', 'developer.md'), 'utf8');
  assert.equal(RELAY_CEILING, 300000);
  assert.match(spec, new RegExp(`${RELAY_CEILING / 1000}k tokens of context`));
});

// The transcript: a sub-agent's own path is kept; the parent's names `<session>/subagents/agent-<id>.jsonl`
// beside it; no id, a path-like id or no session id names nothing.
test('agentTranscript: the sub-agent file, from either path the host may send', () => {
  const proj = path.join('p', 'proj');
  assert.equal(agentTranscript({ agent_id: 'a1', session_id: 's1', transcript_path: path.join(proj, 's1.jsonl') }),
    path.join(proj, 's1', 'subagents', 'agent-a1.jsonl'));
  const own = path.join(proj, 's1', 'subagents', 'agent-a1.jsonl');
  assert.equal(agentTranscript({ agent_id: 'a1', session_id: 's1', transcript_path: own }), own);
  assert.equal(agentTranscript({ session_id: 's1', transcript_path: own }), null, 'no agent_id: the main session');
  assert.equal(agentTranscript({ agent_id: '../x', session_id: 's1', transcript_path: own }), null);
  assert.equal(agentTranscript({ agent_id: 'a1', transcript_path: path.join(proj, 's1.jsonl') }), null);
  assert.equal(agentTranscript(null), null);
});

// The context: the LAST assistant line's input + cache read + cache write. A torn first line, a
// user line and a line that is not JSON are skipped; a tail with no assistant usage is unknown.
test('lastContext: the last assistant turn, summed; anything else is null', () => {
  assert.equal(lastContext([assistant(120000), toolResult(10), assistant(310000), toolResult(10)].join('\n')), 310000);
  assert.equal(lastContext(`ge":{"input_tokens":5}}}\n${assistant(200000)}`), 200000, 'the torn first line is skipped');
  assert.equal(lastContext(toolResult(10)), null);
  assert.equal(lastContext('not json\n{"usage"'), null);
  assert.equal(lastContext(''), null);
  assert.equal(lastContext(undefined), null);
});

/** A developer's transcript under a sandboxed project, from `lines`; returns the payload that names it. */
function workerPayload(sb, lines, extra = {}) {
  const proj = path.join(sb, 'proj');
  const file = path.join(proj, 's1', 'subagents', 'agent-a1.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  return { session_id: 's1', agent_id: 'a1', agent_type: 'developer', transcript_path: path.join(proj, 's1.jsonl'), ...extra };
}

test('relayDue: past the ceiling only, a developer only, and an unreadable file is no ceiling', () => {
  const sb = makeSandbox();
  try {
    assert.equal(relayDue(workerPayload(sb.path, [assistant(RELAY_CEILING)])), null, 'at the ceiling: not past it');
    assert.equal(relayDue(workerPayload(sb.path, [assistant(RELAY_CEILING + 1)])), RELAY_CEILING + 1);
    assert.equal(relayDue(workerPayload(sb.path, [assistant(400000)], { agent_type: 'reviewer' })), null);
    assert.equal(relayDue(workerPayload(sb.path, [assistant(400000)], { agent_id: undefined })), null);
    // One tool result larger than the window after the assistant line: the window holds no assistant line.
    assert.equal(relayDue(workerPayload(sb.path, [assistant(400000), toolResult(TAIL_BYTES + 10)])), null);
    assert.equal(relayDue({ ...workerPayload(sb.path, []), session_id: 'gone' }), null, 'a missing file');
  } finally { sb.cleanup(); }
});

// Past the ceiling the worker may still commit: the git gate's own segment classes, nothing more.
test('relayMayRun: add, read-only git and commit, after at most one cd; nothing else', () => {
  const yes = ['git add -A && git commit -m "wip: relay"', 'cd ../wt && git status', 'git diff --stat',
    'git log --oneline -3', 'git commit -q -m \'wip\''];
  const no = ['npm test', 'git commit -m x; npm test', 'git merge main', 'git push origin HEAD:x',
    'git commit -m "$(rm -rf x)"', 'cd a && cd b && git status', 'node tests/heavy.mjs suite', ''];
  for (const c of yes) assert.equal(relayMayRun(c), true, c);
  for (const c of no) assert.equal(relayMayRun(c), false, c);
});

// Through the real binary: past the ceiling a test run and an edit are denied, with the reason the
// MODEL reads (a deny, not an ask); a commit passes the relay; under the ceiling nothing changes.
test('the gates deny a worker past the ceiling, and let its commit through', () => {
  const sb = makeSandbox();
  try {
    const env = { ...process.env, ...homeOverrides(path.join(sb.path, 'home')) };
    fs.mkdirSync(path.join(sb.path, 'home'), { recursive: true });
    const run = (verb, toolName, input, ctx) => {
      const payload = { ...workerPayload(sb.path, [assistant(ctx)]), hook_event_name: 'PreToolUse',
        tool_name: toolName, tool_input: input, cwd: sb.path };
      const p = spawnHook([verb], JSON.stringify(payload), { cwd: sb.path, env });
      assert.equal(p.status, 0, p.stderr);
      return p.stdout ? JSON.parse(p.stdout).hookSpecificOutput : null;
    };
    const test = run('git-gate', 'Bash', { command: 'npm test' }, 310000);
    assert.equal(test.permissionDecision, 'deny');
    assert.match(test.permissionDecisionReason, /^Relay ceiling: your context is 310k tokens, past 300k/);
    assert.match(test.permissionDecisionReason, /end with `STATUS: RELAY`/);
    const write = run('rule-gate', 'Write', { file_path: path.join(sb.path, 'a.js'), content: 'x' }, 310000);
    assert.equal(write.permissionDecision, 'deny');
    assert.equal(run('git-gate', 'Bash', { command: 'git status' }, 310000), null, 'a read-only look passes');
    assert.equal(run('git-gate', 'Bash', { command: 'npm test' }, 290000), null, 'under the ceiling');
    assert.equal(run('rule-gate', 'Write', { file_path: path.join(sb.path, 'a.js'), content: 'x' }, 290000), null);
  } finally { sb.cleanup(); }
});
