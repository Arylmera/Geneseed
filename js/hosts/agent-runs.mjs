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
 * error swallowed. Parallel sub-agents end together; each line is one `appendFileSync` of well
 * under a page, as `usage.jsonl` is written, so each lands whole without a lock.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { GLOBAL_MANIFEST } from './hosts.mjs';
import { SECRET_RE, splitLines } from './hooks-prims.mjs';
import { specFeedbackOf } from './spec-feedback.mjs';
import { capFile, isPrompt } from './hooks-done.mjs';
import { RUNS_LEDGER, USAGE_OFF } from './usage.mjs';

export { RUNS_LEDGER };

// ---- agent-runs twin: BEGIN — adapters/opencode/plugins/geneseed-learn.js carries everything down
// to the END marker verbatim, with `export ` dropped (`node tests/twins.mjs --write` after a change).

/**
 * A refused tool call: the result text a host or a gate gives a call it did not run. Only the
 * result's FIRST line is read, and every marker is anchored at its start (a host prefix of at most
 * 80 characters allowed for Geneseed's own words): a red test or a search that QUOTES a gate's text
 * further down its output is an error, not a refusal. One row each, with where its text comes from:
 *   - Geneseed's own refusal (`gateText` mode `refused`, js/hosts/hooks-prims.mjs), and the text
 *     said when that text fails (`GATE_UNSAID`), behind a host's prefix ("PreToolUse:Bash hook …").
 *   - The OpenCode guard: V1 throws `[geneseed-guard] blocked: …`; V2 renames the call, and core
 *     answers `No tool named "BLOCKED, not a missing tool: …"` (geneseed-guard.js, seen on 2.2.6).
 *   - Claude Code's auto-mode classifier, seen live 2026-11-14: "Permission for this action was
 *     denied by the Claude Code auto mode classifier."
 *   - Claude Code's worktree isolation, seen live 2026-11-14: "This agent is isolated in the
 *     worktree …, but this command … Refusing to run it — …".
 *   - Claude Code's permission rule deny and a user's "no" to an ask: UNVERIFIED wording.
 */
export const REFUSAL_MARKERS = [
  /^.{0,80}?Tell the user this, word for word:/,
  /^.{0,80}?Geneseed could not describe this call\./,
  /^\[geneseed-guard\] blocked:/,
  /^No tool named "BLOCKED, not a missing tool:/,
  /^Permission for this action was denied\b/,
  /^This agent is isolated in the worktree .{1,600}? Refusing to run it\b/,
  /^Permission to use \S.{0,300}? has been denied\b/,
  /^The user doesn't want to (?:proceed with|take) this/,
];

/**
 * True when the first line of `text` (a tool result) says the call was refused. Each marker is
 * anchored with `^` (no `m` flag) and its `.` never crosses a line break, so a marker can only
 * match on the first line.
 */
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
  // The gate's own rule (./hooks-done.mjs `isPrompt`, sidechain mode). A resumed sub-agent appends
  // its next turn to the same file, so the counts are the CURRENT turn's, as the gate judges it.
  for (let i = entries.length - 1; i >= 0; i -= 1) if (entries[i] && isPrompt(entries[i], true)) { start = i + 1; break; }
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
 * (./hooks-done.mjs `capFile`), when that state is this turn's (same `opening`); 0 with no state,
 * or another turn's.
 */
export function blocksOf(install, meta, opening) {
  const file = install ? capFile(install, { ...meta, hook_event_name: 'SubagentStop' }) : null;
  if (!file) return 0;
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
      // The agent's own lines: a `[skill:…]` line it relays is about a skill, not its spec.
      feedback: specFeedbackOf(report, SECRET_RE).filter((f) => !f.skill).length, report: Boolean(String(report || '').trim()),
    }, now);
    const file = path.join(install, RUNS_LEDGER);
    // One line in one `appendFileSync` (O_APPEND), as usage.jsonl is written: parallel stops each
    // land a whole line, so there is no lock to wait on.
    appendFileSync(file, line);
    return line;
  } catch { return null; }
}
