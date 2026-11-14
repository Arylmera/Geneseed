/**
 * The agents' self-improvement loop, captured by the hook: every `spec-feedback:` line a sub-agent
 * ends its report with (src/agents/_self-improvement.md) goes into the notes the agent reads at its
 * next dispatch, `<notes>/agent-notes/<agent>.md`, and a `general` one into `_general.md` as well.
 *
 * WHY A HOOK AND NOT THE CALLER. The include used to tell the caller to write the line down. That
 * is model discipline, and it never happened: the tier's `agent-notes/` stayed empty for weeks
 * while sub-agents kept emitting the lines. So the capture is mechanical, on SubagentStop, and it
 * needs no model: it copies what the agent wrote, it does not judge it. `$GENESEED_LLM` decides
 * only the separate lesson distil into `memory/agents/` (`./hooks-learn.mjs`).
 *
 * Builtins and `./hooks-prims.mjs` only, no spawn: `learn` imports this on every SubagentStop.
 * Nothing here prints. The caller swallows a throw, so a bad file never fails a hook.
 */
import { isUtf8 } from 'node:buffer';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { writeText } from '../lib/fs.mjs';
import { SECRET_RE, splitLines } from './hooks-prims.mjs';

// ---- spec-feedback twin: BEGIN — adapters/opencode/plugins/geneseed-learn.js carries everything down
// to the END marker verbatim, with `export ` dropped (`node tests/twins.mjs --write` after a change).

/**
 * One report line: `spec-feedback: [agent|general] <fix> [— situation: …] — seen: …`, at the start
 * of the line after an optional list marker or quote, and optionally wrapped in backticks or bold.
 * A line that only names the protocol ("No spec-feedback.", "The reviewer's spec-feedback: …")
 * does not start with it, so it is no feedback. Real reports write the scope four ways (`[agent]`,
 * `agent`, `agent —`, none); a missing scope reads as `agent`.
 */
const FEEDBACK_LINE_RE = /^[ \t]*(?:[-*+>][ \t]+)*(\*\*|`)?spec-feedback[ \t]*:(\*\*|`)?[ \t]*(.*)$/i;
// A bare scope word stands alone: `agent-notes/…` and `general-purpose …` open a body, not a scope.
const FEEDBACK_SCOPE_RE = /^(?:\[[ \t]*(agent|general)[ \t]*\]|(agent|general)(?![\w-]))[ \t]*(?:[—–:-][ \t]*)?/i;
// "none" as the whole answer, or before punctuation or a dash; "none of the proof commands…" is feedback.
const FEEDBACK_NONE_RE = /^(?:none|n\/a|nothing|no friction)[ \t]*(?:$|[.,;:!—–-])/i;
/** The include's own template, which a report may quote: never a note. */
export const FEEDBACK_PLACEHOLDER = '<the one-line fix>';
/** Oldest bullets drop past this, as `memory/agents/` files do (MAX_AGENT_BULLETS). */
export const MAX_FEEDBACK_BULLETS = 100;
/** A body past this many characters is cut, so one runaway line cannot fill the file. */
export const MAX_FEEDBACK_CHARS = 500;
/** The general file's name. `_` keeps it apart from every agent: an agent name starts with a letter. */
export const GENERAL_NOTES = '_general.md';
// A bullet's dated tail, `(2026-11-14)` or `(tester, 2026-11-14)`: not part of what it says.
const DATED_TAIL_RE = /[ \t]*\((?:[a-z][a-z0-9-]*, )?\d{4}-\d{2}-\d{2}\)[ \t]*$/;

/**
 * Every feedback line in `text` as `{ scope, body }`, in order, each body once. `secret` is Law
 * I's pattern: a line that carries a credential is dropped whole, never written to a note.
 */
export function specFeedbackOf(text, secret) {
  const found = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = FEEDBACK_LINE_RE.exec(line);
    if (!m) continue;
    let body = m[3].trim();
    // `**spec-feedback:** …` closed its wrapper at the colon; `` `spec-feedback: …` `` closes it at the end.
    if (m[1] && !m[2] && body.endsWith(m[1])) body = body.slice(0, -m[1].length).trim();
    const s = FEEDBACK_SCOPE_RE.exec(body);
    const scope = s ? (s[1] || s[2]).toLowerCase() : 'agent';
    if (s) body = body.slice(s[0].length);
    body = body.replace(/\s+/g, ' ').trim();
    if (body.length < 10 || FEEDBACK_NONE_RE.test(body) || body.includes(FEEDBACK_PLACEHOLDER)) continue;
    if (secret && secret.test(body)) continue;
    if (body.length > MAX_FEEDBACK_CHARS) body = `${body.slice(0, MAX_FEEDBACK_CHARS).trimEnd()}…`;
    if (!found.some((f) => f.body === body)) found.push({ scope, body });
  }
  return found;
}

/** The note bullets for one report: `own` for the agent's file, `general` for `_general.md`. */
export function feedbackBullets(items, agent, day) {
  return {
    own: items.map((f) => `- [${f.scope}] ${f.body} (${day})`),
    general: items.filter((f) => f.scope === 'general').map((f) => `- [general] ${f.body} (${agent}, ${day})`),
  };
}

/** What a bullet says, for the duplicate check: its date and agent off, spacing and case folded. */
export const feedbackKey = (bullet) => bullet.replace(DATED_TAIL_RE, '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * A notes file's new text with `bullets` added, or null when every one is already there (a second
 * run on the same report writes nothing). Lines that are not bullets stay first, in their order;
 * past `cap` the oldest bullets drop.
 */
export function mergeFeedback(old, bullets, cap = MAX_FEEDBACK_BULLETS) {
  const lines = String(old || '').split(/\r?\n/);
  const head = lines.filter((l) => l.trim() && !l.startsWith('- '));
  let kept = lines.filter((l) => l.startsWith('- '));
  const seen = new Set(kept.map(feedbackKey));
  let added = 0;
  for (const b of bullets) {
    const k = feedbackKey(b);
    if (seen.has(k)) continue;
    seen.add(k);
    kept.push(b);
    added += 1;
  }
  if (!added) return null;
  kept = kept.slice(-cap);
  return `${[...head, ...kept].join('\n')}\n`;
}
// ---- spec-feedback twin: END

/**
 * The text of a sub-agent's FINAL message in a Claude-Code JSONL transcript, or null when the
 * text holds no assistant line (the tail reader then reads further back). The host writes one
 * message as one line per content block, all under one `message.id`, so every line of the last
 * id counts. Its text blocks count, and so does a tool call's `input.message`: an Agent-SDK
 * sub-agent ends with `SubagentHandback({ message })`, and its report lives there, not in a text
 * block (seen in 330 of 500 sub-agent transcripts here, 2026-11).
 */
export function finalAssistantText(raw) {
  const entries = [];
  for (const line of splitLines(raw)) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { /* a torn line is no message */ }
  }
  const isAssistant = (o) => o && (o.type === 'assistant' || (o.message && o.message.role === 'assistant'));
  let last = -1;
  for (let i = entries.length - 1; i >= 0; i -= 1) if (isAssistant(entries[i])) { last = i; break; }
  if (last < 0) return null;
  const id = entries[last].message && entries[last].message.id;
  const lines = id ? entries.filter((o) => isAssistant(o) && o.message && o.message.id === id) : [entries[last]];
  const parts = [];
  for (const o of lines) {
    const c = o.message ? o.message.content : o.content;
    if (typeof c === 'string') parts.push(c);
    else if (Array.isArray(c)) {
      for (const b of c) {
        if (!b || typeof b !== 'object') continue;
        if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
        else if (b.type === 'tool_use' && b.input && typeof b.input.message === 'string') parts.push(b.input.message);
      }
    }
  }
  return parts.join('\n');
}

/**
 * The final report a SubagentStop payload points at: the sub-agent's own transcript
 * (`agent_transcript_path`), read through the Stop's shared reader, plus the host's
 * `last_assistant_message` when it says something the transcript does not (a write that lagged).
 */
export function subagentReport(meta, read) {
  let text = '';
  const tp = typeof meta.agent_transcript_path === 'string' ? meta.agent_transcript_path : null;
  if (tp) {
    try { text = read(tp, (raw, whole) => finalAssistantText(raw) ?? (whole ? '' : null)) || ''; } catch { text = ''; }
  }
  const last = typeof meta.last_assistant_message === 'string' ? meta.last_assistant_message.trim() : '';
  return last && !text.includes(last) ? `${text}\n${last}` : text;
}

/** Today as `YYYY-MM-DD`, local time, as `appendAgentLesson` dates a lesson. */
export function today(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Add `bullets` to one notes file. A file that is not UTF-8 is left whole (the fold's rule). */
function addTo(file, bullets) {
  if (!bullets.length) return false;
  let old = '';
  if (existsSync(file)) {
    const raw = readFileSync(file);
    if (!isUtf8(raw)) return false;
    old = raw.toString('utf8');
  }
  const next = mergeFeedback(old, bullets);
  if (next === null) return false;
  writeText(file, next);
  return true;
}

/**
 * The capture: `agent`'s feedback lines in `report` into `<notesRoot>/agent-notes/`. Writes
 * nothing when the notes root's parent does not exist (no install or tier there to serve), and
 * returns the files it changed.
 */
export function captureSpecFeedback(agent, report, notesRoot, day = today()) {
  if (!agent || !notesRoot || !existsSync(path.dirname(notesRoot))) return [];
  const items = specFeedbackOf(report, SECRET_RE);
  if (!items.length) return [];
  const dir = path.join(notesRoot, 'agent-notes');
  mkdirSync(dir, { recursive: true });
  const { own, general } = feedbackBullets(items, agent, day);
  const written = [];
  const ownFile = path.join(dir, `${agent}.md`);
  if (addTo(ownFile, own)) written.push(ownFile);
  const gen = path.join(dir, GENERAL_NOTES);
  if (addTo(gen, general)) written.push(gen);
  return written;
}
