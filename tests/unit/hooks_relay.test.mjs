// THE RELAY CEILING (js/hosts/hooks-relay.mjs): a Foreman task worker past its ceiling may only
// commit its work in progress and hand off. The ceiling follows the install's `--context-window`.
// Every expected value is written out.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT, CONTEXT_WINDOWS, DEFAULT_CONTEXT_WINDOW } from '../../js/build/source.mjs';
import {
  RELAY_CEILINGS, RELAY_DEFAULT_WINDOW, TAIL_BYTES, agentTranscript, lastContext, relayDue, windowOfRoot,
} from '../../js/hosts/hooks-relay.mjs';
import { relayMayRun } from '../../js/hosts/hooks.mjs';
import { makeSandbox, homeOverrides } from '../helpers/sandbox.mjs';
import { spawnHook } from '../helpers/hook_run.mjs';

// One assistant line as Claude Code writes it, holding `n` tokens of context: 2 uncached, the rest
// split between a cache read and a cache write, as a real turn's usage is.
const assistant = (n) => JSON.stringify({ type: 'assistant', message: { role: 'assistant',
  usage: { input_tokens: 2, cache_read_input_tokens: n - 1002, cache_creation_input_tokens: 1000, output_tokens: 50 } } });
const toolResult = (chars) => JSON.stringify({ type: 'user', message: { role: 'user',
  content: [{ type: 'tool_result', tool_use_id: 't', content: 'x'.repeat(chars) }] } });

// 300k on a 1M window is the measured value; 60 % of a smaller window (150k on 250k, 120k on
// 200k) is past a worker's ~80k start and before the host compacts. One ceiling per window value,
// no more and no fewer, and the same default.
test('one ceiling per --context-window value, and the same default', () => {
  assert.deepEqual({ ...RELAY_CEILINGS }, { '200k': 120000, '250k': 150000, '1m': 300000 });
  assert.deepEqual(Object.keys(RELAY_CEILINGS).sort(), Object.keys(CONTEXT_WINDOWS).sort());
  assert.equal(RELAY_DEFAULT_WINDOW, DEFAULT_CONTEXT_WINDOW);
});

// The ceilings' other home is the developer spec's prose: it names all three.
test('the developer spec names every ceiling the gate enforces', () => {
  const spec = fs.readFileSync(path.join(ROOT, 'src', 'agents', 'developer.md'), 'utf8');
  assert.match(spec, /300k tokens of context on a\s+1M-token window, 150k on 250k, 120k on 200k/);
});

// The window: the first carrier that exists decides; a missing line or an unknown value is 200k.
test('windowOfRoot: the install carrier\'s Context window line', () => {
  const sb = makeSandbox();
  try {
    const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(sb.path, rel)), { recursive: true }); fs.writeFileSync(path.join(sb.path, rel), text); };
    assert.equal(windowOfRoot(sb.path), '200k', 'no carrier');
    put('CLAUDE.md', 'x\nContext window: 1m\n');
    assert.equal(windowOfRoot(sb.path), '1m');
    put('AGENT.md', 'Context window: 250k\r\n');
    assert.equal(windowOfRoot(sb.path), '250k', 'AGENT.md comes first');
    put('AGENT.md', 'no marker');
    assert.equal(windowOfRoot(sb.path), '200k', 'the first carrier has no line: the default, not the next carrier');
    put('AGENT.md', 'Context window: 128k\n');
    assert.equal(windowOfRoot(sb.path), '200k', 'an unknown value');
    assert.equal(windowOfRoot(null), '200k');
  } finally { sb.cleanup(); }
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

/** An install dir whose carrier declares `window` (null: no line, the default). */
function install(sb, window) {
  const d = path.join(sb, `install-${window ?? 'default'}`);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'AGENT.md'), window ? `# x\nContext window: ${window}\n` : '# x\n');
  return d;
}

test('relayDue: past the window\'s ceiling only, a developer only, and an unreadable file is no ceiling', () => {
  const sb = makeSandbox();
  try {
    const m1 = install(sb.path, '1m');
    const due = (lines, root, extra) => relayDue(workerPayload(sb.path, lines, extra), root);
    assert.equal(due([assistant(300000)], m1), null, 'at the ceiling: not past it');
    assert.deepEqual(due([assistant(300001)], m1), { context: 300001, ceiling: 300000 });
    assert.deepEqual(due([assistant(150001)], install(sb.path, '250k')), { context: 150001, ceiling: 150000 });
    assert.equal(due([assistant(150000)], install(sb.path, '250k')), null);
    assert.deepEqual(due([assistant(120001)], install(sb.path, null)), { context: 120001, ceiling: 120000 }, 'the default window');
    assert.equal(due([assistant(400000)], m1, { agent_type: 'reviewer' }), null);
    assert.equal(due([assistant(400000)], m1, { agent_id: undefined }), null);
    // One tool result larger than the window after the assistant line: the window holds no assistant line.
    assert.equal(due([assistant(400000), toolResult(TAIL_BYTES + 10)], m1), null);
    assert.equal(relayDue({ ...workerPayload(sb.path, []), session_id: 'gone' }, m1), null, 'a missing file');
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

// Through the real binary, on a 1m install (`--root`): past 300k a test run and an edit are denied,
// with the reason the MODEL reads (a deny, not an ask); a read-only look passes; under the ceiling
// nothing changes. On a 250k install the same 160k worker is past its 150k ceiling.
test('the gates deny a worker past its window\'s ceiling, and let its commit through', () => {
  const sb = makeSandbox();
  try {
    const env = { ...process.env, ...homeOverrides(path.join(sb.path, 'home')) };
    fs.mkdirSync(path.join(sb.path, 'home'), { recursive: true });
    const m1 = install(sb.path, '1m');
    const run = (verb, toolName, input, ctx, root = m1) => {
      const payload = { ...workerPayload(sb.path, [assistant(ctx)]), hook_event_name: 'PreToolUse',
        tool_name: toolName, tool_input: input, cwd: sb.path };
      const p = spawnHook([verb, '--root', root], JSON.stringify(payload), { cwd: sb.path, env });
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
    const small = run('git-gate', 'Bash', { command: 'npm test' }, 160000, install(sb.path, '250k'));
    assert.match(small.permissionDecisionReason, /^Relay ceiling: your context is 160k tokens, past 150k/);
  } finally { sb.cleanup(); }
});
