/**
 * THE AGENT OUTCOME LEDGER — did a spec refinement make an agent better? One line per finished
 * sub-agent, appended to `<install>/notebook/agent-runs.jsonl` beside `usage.jsonl`:
 * `{"ts":"2026-11-14","agent":"developer","spec":"56510da85fb8","done":"ended","blocks":0,
 * "tools":42,"refused":1,"feedback":0,"report":true}`. `spec` is a short hash of the agent's
 * rendered spec, so the runs before and after a spec edit fall into two rows of
 * `geneseed catalog agents --scores` (js/inspect/agent-scores.mjs).
 *
 * MECHANICAL ONLY (user decision 2026-11-14, "v1 mechanical only"). Every field is a fact the hook
 * reads off the transcript, the install or the done gate's own state, never a score the agent gives
 * itself, and nothing waits on a model remembering a step: that is what kept the spec-feedback loop
 * empty until the hook captured it (./spec-feedback.mjs).
 *
 * WHAT `done` CAN SAY. On SubagentStop, `doneGate` (./hooks-done.mjs) returns 'block' or null, and
 * a block returns before this runs, so a line is written only for a stop that ended the turn.
 * Pass, advisory, cap reached and a skipped gate all return null, so they cannot be told apart
 * here: `done` is "ended" (the gate ran over a transcript and let the turn end), "not-judged" (the
 * gate ran with no transcript to read, or on Bob) or null (the gate did not run: switched off, or a
 * manual `--file` run). `blocks` is how many times the gate blocked this turn before it ended, read
 * from the cap state the gate itself wrote (`blocksOf`). A richer verdict needs a richer `doneGate`
 * return, which is that file's change to make.
 *
 * The same privacy rules as `usage.jsonl` (./usage.mjs): counts only, the day not the instant,
 * never a prompt, an argument or a path. Off when `GENESEED_NO_USAGE` is set or `.usage-off` exists,
 * and only when `<install>/notebook` exists (never created here).
 *
 * ON THE HOOK PATH: builtins and sibling hook modules only, no spawn, nothing printed, and every
 * error swallowed. Parallel sub-agents end together, so the append runs under the notes lock
 * (`withLock`, ./spec-feedback.mjs); a hook that cannot get it in a second drops the line.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { GLOBAL_MANIFEST } from './hosts.mjs';
import { SECRET_RE, splitLines } from './hooks-prims.mjs';
import { specFeedbackOf, withLock } from './spec-feedback.mjs';
import { USAGE_OFF } from './usage.mjs';

export const RUNS_LEDGER = path.join('notebook', 'agent-runs.jsonl');

// ---- agent-runs twin: BEGIN — adapters/opencode/plugins/geneseed-learn.js carries everything down
// to the END marker verbatim, with `export ` dropped (`node tests/twins.mjs --write` after a change).

/**
 * A refused tool call: the result text a host or a gate gives a call it did not run. A red test
 * or any other non-zero exit is an error, not a refusal, and matches none of these. One row each,
 * with where its text comes from:
 *   - Geneseed's own refusal (`gateText` mode `refused`, js/hosts/hooks-prims.mjs), and the text
 *     said when that text fails (`GATE_UNSAID`). Matched anywhere: a host may prefix a hook's words.
 *   - Claude Code's auto-mode classifier, seen live 2026-11-14: "Permission for this action was
 *     denied by the Claude Code auto mode classifier."
 *   - Claude Code's worktree isolation, seen live 2026-11-14: "... Refusing to run it — a
 *     worktree-isolated agent's git operations must target its own worktree."
 *   - Claude Code's permission rule deny and a user's "no" to an ask: UNVERIFIED wording.
 *   - OpenCode 2's guard, which renames a refused call (geneseed-guard.js): the tool NAME opens so.
 */
export const REFUSAL_MARKERS = [
  /Tell the user this, word for word:/,
  /Geneseed could not describe this call\./,
  /^Permission for this action was denied\b/,
  /\bRefusing to run it\b/,
  /^Permission to use \S[^\n]{0,300}? has been denied\b/,
  /^The user doesn't want to (?:proceed with|take) this/,
  /^BLOCKED, not a missing tool:/,
];

/** True when `text` (a tool result, or an OpenCode tool name) says the call was refused. */
export function isRefusal(text) {
  const t = String(text ?? '').trimStart();
  return REFUSAL_MARKERS.some((re) => re.test(t));
}

/** The short hash of a rendered spec: sha256 of its text with line endings folded to LF, 12 hex. */
export function specHashOf(text) {
  return createHash('sha256').update(String(text).replace(/\r\n?/g, '\n'), 'utf8').digest('hex').slice(0, 12);
}

/** The ledger line, field order fixed. `ts` is the UTC day, as `usage.jsonl` stamps it. */
export function agentRunLine(run, now = new Date()) {
  return `${JSON.stringify({
    ts: now.toISOString().slice(0, 10), agent: run.agent, spec: run.spec ?? null, done: run.done ?? null,
    blocks: run.blocks ?? null, tools: run.tools ?? null, refused: run.refused ?? null,
    feedback: run.feedback ?? 0, report: Boolean(run.report),
  })}\n`;
}
// ---- agent-runs twin: END

/**
 * `<install>/agents/<agent>.md`'s hash when Geneseed ships it there (its manifest's `owned` names
 * it), else null: general-purpose, Explore and a user's own agent have no rendered spec to compare.
 */
export function specOf(install, agent) {
  try {
    const owned = JSON.parse(readFileSync(path.join(install, GLOBAL_MANIFEST), 'utf8')).owned;
    const rel = `agents/${agent}.md`;
    if (!Array.isArray(owned) || !owned.includes(rel)) return null;
    return specHashOf(readFileSync(path.join(install, 'agents', `${agent}.md`), 'utf8'));
  } catch { return null; }
}

const NOTE_OPEN = '<task-notification>';
// Hand twin of ./hooks-done.mjs `FEEDBACK_OPENS` (not exported): a block's feedback opens no turn.
const FEEDBACK_OPENS = ['Stop hook feedback', 'SubagentStop hook feedback', 'Geneseed (Verify Before Asserting)'];

/** A user line's single text, or null. */
const userText = (c) => (typeof c === 'string' ? c
  : Array.isArray(c) && c.length === 1 && c[0] && c[0].type === 'text' ? c[0].text : null);

/**
 * Hand twin of ./hooks-done.mjs `isPrompt` with `sidechain` true: the line that opens a sub-agent's
 * turn. A resumed sub-agent (SendMessage) appends its next turn to the same file, so the counts are
 * the CURRENT turn's, as the gate judges it, and a second line never counts the first turn again.
 */
function isPrompt(obj) {
  if (!obj || obj.type !== 'user' || obj.isMeta) return false;
  const c = obj.message && obj.message.content;
  const t = userText(c);
  if (typeof t === 'string' && (t.trimStart().startsWith(NOTE_OPEN) || FEEDBACK_OPENS.some((p) => t.trimStart().startsWith(p)))) return false;
  if (typeof c === 'string') return true;
  return Array.isArray(c) && c.length > 0 && !c.some((b) => b && b.type === 'tool_result');
}

/** A tool result's text: a string, or its text blocks joined. */
function resultText(b) {
  if (typeof b.content === 'string') return b.content;
  if (!Array.isArray(b.content)) return '';
  return b.content.filter((x) => x && x.type === 'text' && typeof x.text === 'string').map((x) => x.text).join('\n');
}

/**
 * `{ tools, refused, opening }` for the current turn of a sub-agent transcript's TEXT, or null when
 * `whole` is false and the text holds no prompt (the tail reader then reads further back).
 * `opening` is the gate's key for the turn (`turnOf`): the prompt line's `uuid`, else its content.
 */
export function runCounts(raw, whole = true) {
  const entries = [];
  for (const line of splitLines(raw)) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { /* a torn line is no call */ }
  }
  let start = -1;
  for (let i = entries.length - 1; i >= 0; i -= 1) if (isPrompt(entries[i])) { start = i + 1; break; }
  if (start === -1) {
    if (!whole) return null;
    start = 0;
  }
  const first = entries[start - 1];
  const opening = !first ? '' : typeof first.uuid === 'string' ? first.uuid
    : JSON.stringify(first.message && first.message.content).slice(0, 300);
  let tools = 0;
  let refused = 0;
  for (const obj of entries.slice(start)) {
    const content = obj.message && obj.message.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'tool_use') tools += 1;
      else if (b.type === 'tool_result' && b.is_error === true && isRefusal(resultText(b))) refused += 1;
    }
  }
  return { tools, refused, opening };
}

/**
 * How many times the done gate blocked this sub-agent's turn: `total` in the cap state it saved
 * at `<install>/notebook/done-gate/<session~agent>.json`, when that state is this turn's (same
 * `opening`); 0 with no state, or another turn's. A hand twin of ./hooks-done.mjs `capFile`'s
 * path, which is not exported: tests/unit/agent_runs.test.mjs drives a real block and reads it back,
 * so a change there turns that test red.
 */
export function blocksOf(install, meta, opening) {
  const key = [meta.session_id, meta.agent_id].filter((k) => typeof k === 'string' && k).join('~');
  if (!install || !key) return 0;
  const file = path.join(install, 'notebook', 'done-gate', `${key.replace(/[^\w.~-]/g, '_').slice(0, 160)}.json`);
  try {
    const state = JSON.parse(readFileSync(file, 'utf8'));
    if (!state || state.opening !== opening) return 0;
    return Number.isInteger(state.total) ? state.total : Number.isInteger(state.blocks) ? state.blocks : 0;
  } catch { return 0; }
}

/** True when the ledger is switched off for `install`, or has nowhere to go. */
function ledgerOff(install) {
  if (!install || process.env.GENESEED_NO_USAGE) return true;
  if (existsSync(path.join(install, USAGE_OFF))) return true;
  try { return !statSync(path.join(install, 'notebook')).isDirectory(); } catch { return true; }
}

/**
 * The SubagentStop write: one line for `agent`'s finished turn. `done` is `cmdLearn`'s reading of
 * the gate (see the header), `report` the sub-agent's final report text (`subagentReport`), `read`
 * the Stop's shared transcript reader. Returns the line written, or null. Never throws.
 * @param {string | null} install
 * @param {string | null} agent
 * @param {Record<string, any>} meta
 * @param {{ done?: string | null, report?: string, read?: Function | null }} [opts]
 * @param {Date} [now]
 */
export function recordAgentRun(install, agent, meta, { done = null, report = '', read } = {}, now = new Date()) {
  try {
    if (!agent || ledgerOff(install)) return null;
    const tp = typeof meta.agent_transcript_path === 'string' && meta.agent_transcript_path ? meta.agent_transcript_path : null;
    let counts = null;
    if (tp && read) {
      try { counts = read(tp, (raw, whole) => runCounts(raw, whole)); } catch { counts = null; }
    }
    const line = agentRunLine({
      agent, spec: specOf(install, agent), done,
      blocks: done === 'ended' && counts ? blocksOf(install, meta, counts.opening) : null,
      tools: counts ? counts.tools : null, refused: counts ? counts.refused : null,
      feedback: specFeedbackOf(report, SECRET_RE).length, report: Boolean(String(report || '').trim()),
    }, now);
    const file = path.join(install, RUNS_LEDGER);
    return withLock(file, () => { appendFileSync(file, line); return line; }) || null;
  } catch { return null; }
}
