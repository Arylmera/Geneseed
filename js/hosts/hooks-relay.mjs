/**
 * THE RELAY CEILING, measured by the harness instead of guessed by the model.
 *
 * WHY. A Foreman task worker re-reads its whole context on every turn, so its cost grows with the
 * square of its length. The developer spec told it to hand off (`STATUS: RELAY`) "at about 150k
 * tokens", and over 14 workers after that rule shipped (2026-11-17 to 2026-11-21) none did: 9 went
 * past 150k, one to 635k. A model does not see the size of its own context. So the gates read it.
 *
 * WHY 300k. Replayed over a month of worker transcripts (notebook/foreman-cost/relay.mjs and
 * combined.mjs), one relay at 150k saves about 2 % of worker cost: a fresh worker starts near
 * 110k, so the gap left to save is small, and 177 of 215 workers pass 150k after ~18 tool calls.
 * At 300k the saving is 20–40 % (the range is the unknown cost of the fresh worker re-reading).
 *
 * WHAT IT READS. Claude Code writes a sub-agent's transcript to
 * `<project>/<session_id>/subagents/agent-<agent_id>.jsonl` (seen in 702 of 702 sub-agent
 * transcripts here, 2026-11). The hooks doc does not say whether a sub-agent's `transcript_path`
 * names that file or its parent's, so both are handled: a path already ending in
 * `agent-<agent_id>.jsonl` is taken as is, any other is the parent's and the file is derived from
 * it. Only the last `TAIL_BYTES` are read, and the context is the last assistant line's
 * `input + cache_read + cache_creation` tokens: what the next turn will re-read.
 *
 * NEVER THROWS, NEVER PRINTS. It runs inside `guardGate`, which turns a throw into an ask, and a
 * hook's stdout is its verdict. Anything it cannot read is "no ceiling": the relay is a cost bound,
 * not a safety gate, so failing open costs tokens and never a loss.
 */
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import path from 'node:path';

/** The context, in tokens, past which a task worker must hand off. Its one home: developer.md reads as this. */
export const RELAY_CEILING = 300_000;

// A worker's last assistant line sits near the end; a tool result after it can be large (a file
// read), so the window is generous. A window holding no assistant line reads as unknown.
export const TAIL_BYTES = 512 * 1024;

/** The sub-agent's own transcript for this payload, or null. Pure path work: nothing is opened. */
export function agentTranscript(payload) {
  const id = payload && payload.agent_id;
  const tp = payload && payload.transcript_path;
  if (typeof id !== 'string' || !/^[\w-]{1,128}$/.test(id) || typeof tp !== 'string' || !tp) return null;
  const own = `agent-${id}.jsonl`;
  if (path.basename(tp) === own) return tp;
  const sid = payload.session_id;
  if (typeof sid !== 'string' || !/^[\w-]{1,128}$/.test(sid)) return null;
  return path.join(path.dirname(tp), sid, 'subagents', own);
}

/**
 * The context of the last assistant turn in `text`, a transcript's tail, or null. The first line
 * of a tail is usually torn: it is skipped by the parse, not mistaken for evidence.
 */
export function lastContext(text) {
  if (typeof text !== 'string') return null;
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line.includes('"usage"') || !line.includes('"assistant"')) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    const u = obj && obj.type === 'assistant' && obj.message && obj.message.usage;
    if (!u || typeof u !== 'object') continue;
    const n = [u.input_tokens, u.cache_read_input_tokens, u.cache_creation_input_tokens]
      .reduce((s, v) => s + (Number.isFinite(v) && v > 0 ? v : 0), 0);
    return n > 0 ? n : null;
  }
  return null;
}

/** The last `bytes` of `file` as text, or null when it cannot be read. */
function tail(file, bytes) {
  let fd = null;
  try {
    fd = openSync(file, 'r');
    const size = fstatSync(fd).size;
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd !== null) { try { closeSync(fd); } catch { /* nothing to undo */ } }
  }
}

/**
 * The worker's context when it is past the ceiling, else null. Only a `developer` sub-agent: the
 * relay is the task worker's contract (developer.md), and the main session, a reviewer or a
 * read-only seat has no one to hand off to.
 */
export function relayDue(payload, ceiling = RELAY_CEILING) {
  try {
    if (!payload || payload.agent_type !== 'developer') return null;
    const file = agentTranscript(payload);
    if (!file) return null;
    const n = lastContext(tail(file, TAIL_BYTES));
    return n !== null && n > ceiling ? n : null;
  } catch {
    return null;
  }
}

/** The deny's words. The worker reads them: they name the one way out, and end its turn in one step. */
export function relayReason(n) {
  return `Relay ceiling: your context is ${Math.round(n / 1000)}k tokens, past ${RELAY_CEILING / 1000}k, `
    + 'and every turn re-reads all of it. Hand off now: commit your work in progress in your own '
    + 'worktree (git add / git commit still run), then end with `STATUS: RELAY` and a handoff note '
    + '(the failing tests, what you tried, the next step). Do not run the checks first: the next '
    + 'worker owes them, and the parent re-runs them before any merge.';
}
