/**
 * The agents' self-improvement loop, captured by the hook: every `spec-feedback:` line a sub-agent
 * ends its report with (src/agents/_self-improvement.md) goes into the notes the agent reads at its
 * next dispatch, `<notes>/agent-notes/<agent>.md`, or for a `general` one `_general.md`, which every agent reads.
 * The skills' loop is the same line tagged `[skill:<name>]` (src/skills/_self-improvement.md),
 * read off the main session's final reply on Stop (`turnReply`) and off a sub-agent's report on
 * SubagentStop, into `<notes>/skill-notes/<name>.md` or `skill-notes/_general.md`: the skills'
 * notes stayed empty the same way (73 runs in 30 days, 20 with friction, no note written).
 *
 * WHY A HOOK AND NOT THE CALLER. The include used to tell the caller to write the line down. That
 * is model discipline, and it never happened: the tier's `agent-notes/` stayed empty for weeks
 * while sub-agents kept emitting the lines. So the capture is mechanical, on SubagentStop, and it
 * needs no model: it copies what the agent wrote, it does not judge it. `$GENESEED_LLM` decides
 * only the separate lesson distil into `memory/agents/` (`./hooks-learn.mjs`).
 *
 * Builtins and `./hooks-prims.mjs` only, no spawn: `learn` imports this on every Stop and SubagentStop.
 * Nothing here prints. The caller swallows a throw, so a bad file never fails a hook.
 */
import { isUtf8 } from 'node:buffer';
import {
  closeSync, existsSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { SECRET_RE, splitLines } from './hooks-prims.mjs';

// ---- spec-feedback twin: BEGIN — adapters/opencode/plugins/geneseed-learn.js carries everything down
// to the END marker verbatim, with `export ` dropped (`node tests/twins.mjs --write` after a change).

/**
 * One report line: `spec-feedback: [agent|general] <fix> [— situation: …] — seen: …`, at the start
 * of the line after an optional list marker, and optionally wrapped in backticks or bold. A line
 * that only names the protocol ("No spec-feedback.", "The reviewer's spec-feedback: …") does not
 * start with it, so it is no feedback; nor is a quoted (`>`) line or one inside a code fence: both
 * show someone else's line. Real reports write the scope four ways (`[agent]`, `agent`,
 * `agent —`, none), and some copy the template's `[agent|general]`; a missing or unchosen scope
 * reads as `agent`.
 */
const FEEDBACK_LINE_RE = /^[ \t]*(?:[-*+][ \t]+)*(\*\*|`)?spec-feedback[ \t]*:(\*\*|`)?[ \t]*(.*)$/i;
const FENCE_RE = /^[ \t]*(?:```|~~~)/;
// A bare scope word stands alone: `agent-notes/…` and `general-purpose …` open a body, not a scope.
const FEEDBACK_SCOPE_RE = /^(?:\[[ \t]*(agent|general)[ \t]*\]|\[[ \t]*agent[ \t]*\|[ \t]*general[ \t]*\]|(agent|general)(?![\w-]))[ \t]*(?:[—–:-][ \t]*)?/i;
/**
 * A skill's scope, which always names the skill: `[skill:<name>]` for that skill's own notes,
 * `[skill:<name>:general]` (or `, general` / ` general`) for the notes every skill shares. The
 * name is required because the main session's reply, where a skill's line is read, also relays
 * sub-agents' `[agent]` and `[general]` lines: only a line naming a skill is a skill's. A `|`
 * before `general` is the template's unchosen alternative, as `[agent|general]` is: own notes.
 * The bracket's content is taken whole, and a name that is no slug (the template's `<name>`, a
 * path) drops the line rather than letting `[skill:…]` fall through into an agent's notes. The
 * brackets may be dropped (`skill:debug — …`), as reports drop them around `agent`.
 */
const SKILL_SCOPE_RE = /^(?:\[[ \t]*skill[ \t]*:[ \t]*([^\]|,; \t:]*)[ \t]*(?:([|,;:]|[ \t])[ \t]*(general)[ \t]*)?\]|skill:([a-z][a-z0-9-]*)(?![\w-]))[ \t]*(?:[—–:-][ \t]*)?/i;
const SKILL_NAME_RE = /^[a-z][a-z0-9-]{0,63}$/;
// "none" as the whole answer, or before punctuation or a dash; "none of the proof commands…" is feedback.
const FEEDBACK_NONE_RE = /^(?:none|n\/a|nothing|no friction)[ \t]*(?:$|[.,;:!—–-])/i;
/** The include's own template, which a report may quote: never a note. */
export const FEEDBACK_PLACEHOLDER = '<the one-line fix>';
/**
 * The step-0 footprint: every dispatch reads its own notes and `_general.md`. Past the bullet cap,
 * or past the character budget, the oldest of the HOOK'S bullets drop (a hand-written line is
 * never dropped). An agent's own file keeps 100, as `memory/agents/` does; the general file 30.
 */
export const MAX_FEEDBACK_BULLETS = 100;
export const MAX_GENERAL_BULLETS = 30;
export const MAX_NOTE_FILE_CHARS = 8000;
/** A body past this many characters is cut, so one runaway line cannot fill the file. */
export const MAX_FEEDBACK_CHARS = 500;
/** The general file's name. `_` keeps it apart from every agent: an agent name starts with a letter. */
export const GENERAL_NOTES = '_general.md';
// A bullet's dated tail, `(2026-11-14)` or `(tester, 2026-11-14)`: not part of what it says.
const DATED_TAIL_RE = /[ \t]*\((?:[a-z][a-z0-9-]*, )?\d{4}-\d{2}-\d{2}\)[ \t]*$/;
// A bullet in the shape this capture writes: the only kind the caps may drop.
const HOOK_BULLET_RE = /^- \[(?:agent|general|skill)\] .*\((?:[a-z][a-z0-9-]*, )?\d{4}-\d{2}-\d{2}\)[ \t]*$/;

/**
 * Every feedback line in `text` as `{ scope, body }`, in order, each body once. `secret` is Law
 * I's pattern: a line that carries a credential is dropped whole, never written to a note. A
 * skill's line also carries `skill: <name>`, its scope `skill` (own notes) or `general`.
 */
export function specFeedbackOf(text, secret) {
  const found = [];
  let fenced = false;
  for (const line of String(text || '').split(/\r?\n/)) {
    if (FENCE_RE.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const m = FEEDBACK_LINE_RE.exec(line);
    if (!m) continue;
    let body = m[3].trim();
    // `**spec-feedback:** …` closed its wrapper at the colon; `` `spec-feedback: …` `` closes it at the end.
    if (m[1] && !m[2] && body.endsWith(m[1])) body = body.slice(0, -m[1].length).trim();
    let scope = 'agent';
    let skill = null;
    const k = SKILL_SCOPE_RE.exec(body);
    if (k) {
      skill = (k[1] ?? k[4]).toLowerCase();
      if (!SKILL_NAME_RE.test(skill)) continue;
      scope = k[3] && k[2] !== '|' ? 'general' : 'skill';
      body = body.slice(k[0].length);
    } else {
      const s = FEEDBACK_SCOPE_RE.exec(body);
      if (s && (s[1] || s[2])) scope = (s[1] || s[2]).toLowerCase();
      if (s) body = body.slice(s[0].length);
    }
    body = body.replace(/\s+/g, ' ').trim();
    if (body.length < 10 || FEEDBACK_NONE_RE.test(body) || body.includes(FEEDBACK_PLACEHOLDER)) continue;
    if (secret && secret.test(body)) continue;
    if (body.length > MAX_FEEDBACK_CHARS) body = `${body.slice(0, MAX_FEEDBACK_CHARS).trimEnd()}…`;
    if (found.some((f) => f.body === body && (f.skill ?? null) === skill)) continue;
    found.push(skill ? { scope, skill, body } : { scope, body });
  }
  return found;
}

/**
 * The note bullets for one report: an `agent` line goes to the agent's own file, a `general` line
 * to `_general.md` only (with the agent's name), which every agent reads too. One home each. A
 * skill's line is not the agent's: `skillBullets` takes it.
 */
export function feedbackBullets(items, agent, day) {
  const mine = items.filter((f) => !f.skill);
  return {
    own: mine.filter((f) => f.scope === 'agent').map((f) => `- [agent] ${f.body} (${day})`),
    general: mine.filter((f) => f.scope === 'general').map((f) => `- [general] ${f.body} (${agent}, ${day})`),
  };
}

/**
 * The same for the skills' lines, into `skill-notes/`: `own` maps each skill to its bullets, in
 * the `- [skill] … (date)` shape the notes held when they were written by hand; a general line
 * goes to `skill-notes/_general.md` with the skill's name, which every skill reads.
 */
export function skillBullets(items, day) {
  const own = new Map();
  const general = [];
  for (const f of items) {
    if (!f.skill) continue;
    if (f.scope === 'general') { general.push(`- [general] ${f.body} (${f.skill}, ${day})`); continue; }
    if (!own.has(f.skill)) own.set(f.skill, []);
    own.get(f.skill).push(`- [skill] ${f.body} (${day})`);
  }
  return { own, general };
}

/** What a bullet says, for the duplicate check: its date and agent off, spacing and case folded. */
export const feedbackKey = (bullet) => bullet.replace(DATED_TAIL_RE, '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * A notes file's new text with `bullets` appended, or null when every one is already there (a
 * second run on the same report writes nothing). The old text is kept as it was, line endings
 * folded to LF; past `cap` bullets of the hook's own shape, or past `budget` characters, the
 * oldest hook bullets drop. A hand-written line is never moved or dropped, and neither is a bullet
 * this call adds: when hand-written text alone fills the budget, the file goes over it rather
 * than lose the note just written.
 */
export function mergeFeedback(old, bullets, cap = MAX_FEEDBACK_BULLETS, budget = MAX_NOTE_FILE_CHARS) {
  const text = String(old || '').replace(/\r\n?/g, '\n');
  const lines = text ? text.replace(/\n$/, '').split('\n') : [];
  let oldCount = lines.length;
  const seen = new Set(lines.filter((l) => l.startsWith('- ')).map(feedbackKey));
  let added = 0;
  for (const b of bullets) {
    const k = feedbackKey(b);
    if (seen.has(k)) continue;
    seen.add(k);
    lines.push(b);
    added += 1;
  }
  if (!added) return null;
  const size = () => lines.reduce((n, l) => n + l.length + 1, 0);
  let hooks = lines.filter((l) => HOOK_BULLET_RE.test(l)).length;
  while (hooks > cap || size() > budget) {
    const i = lines.slice(0, oldCount).findIndex((l) => HOOK_BULLET_RE.test(l));
    if (i < 0) break;
    lines.splice(i, 1);
    oldCount -= 1;
    hooks -= 1;
  }
  return `${lines.join('\n')}\n`;
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
 * `last_assistant_message` when the transcript does not hold it. THE UNION, never one of the two:
 * the host copy may be the newer message (a lagging transcript), or an OLDER text one (the final
 * message is a hand-back tool call with no text block). A stray earlier line costs at most a
 * deduplicated bullet; dropping the side that holds the report would lose the whole note.
 *
 * `field` names the transcript: a Stop's reply is the main session's, `transcript_path`
 * (`turnReply`). The same union holds there: the host copy covers a transcript that lags.
 */
export function subagentReport(meta, read, field = 'agent_transcript_path') {
  let text = '';
  const tp = typeof meta[field] === 'string' ? meta[field] : null;
  if (tp) {
    try { text = read(tp, (raw, whole) => finalAssistantText(raw) ?? (whole ? '' : null)) || ''; } catch { text = ''; }
  }
  const last = typeof meta.last_assistant_message === 'string' ? meta.last_assistant_message.trim() : '';
  if (!last || text.includes(last)) return text;
  return text ? `${text}\n${last}` : last;
}

/**
 * The main session's final reply at a Stop, where a skill's `spec-feedback:` line is read (a skill
 * runs in the main context, so no SubagentStop sees it). The host's `last_assistant_message` is
 * that reply's text: when it holds no `spec-feedback` at all, the turn has nothing to capture and
 * the transcript is never read, so the common Stop costs one substring test. Otherwise, or with no
 * host copy (an older host; Bob sends neither), the transcript's final message is read too.
 */
export function turnReply(meta, read) {
  const last = meta.last_assistant_message;
  if (typeof last === 'string' && !/spec-feedback/i.test(last)) return '';
  return subagentReport(meta, read, 'transcript_path');
}

/** Today as `YYYY-MM-DD`, local time, as `appendAgentLesson` dates a lesson. */
export function today(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * THE FILE LOCK. Parallel sub-agents end together, and their hooks read-merge-write one notes file:
 * without a lock the last writer drops the others' bullets (7 of 12 kept, measured). `<file>.lock`
 * is created exclusively and holds its owner's token (pid and a nonce). The wait is bounded
 * (LOCK_TRIES x LOCK_WAIT_MS, one second) and a hook that never gets the lock gives up silently: a
 * note is worth less than a stalled SubagentStop.
 *
 * A STALE LOCK (older than LOCK_STALE_MS: a dead hook) is broken by RENAMING it to a name only this
 * hook uses, so of two waiters that both saw it stale only one rename succeeds. The one that
 * renamed checks what it took: a fresh lock (another waiter broke the stale one and took the file
 * between this hook's stat and its rename) is put back with a link that cannot overwrite. On
 * release a hook removes the lock only when it still holds its own token, so a holder that outlived
 * the stale age never removes the next holder's lock.
 */
const LOCK_TRIES = 100;
const LOCK_WAIT_MS = 10;
const LOCK_STALE_MS = 10000;
const SLEEPER = new Int32Array(new SharedArrayBuffer(4));
const lockToken = () => `${process.pid}.${Math.random().toString(36).slice(2)}`;
function breakStale(lock) {
  const taken = `${lock}.${lockToken()}.stale`;
  try { renameSync(lock, taken); } catch { return; /* another waiter broke it first, or it was released */ }
  try {
    if (Date.now() - statSync(taken).mtimeMs <= LOCK_STALE_MS) linkSync(taken, lock); // a live lock: put it back
  } catch { /* the slot is taken again: the live holder's token is in the new lock */ }
  try { unlinkSync(taken); } catch { /* gone */ }
}
/** Exported for the unit tier: ownership on release is invisible through `captureSpecFeedback`. */
export function withLock(file, fn) {
  const lock = `${file}.lock`;
  const token = lockToken();
  for (let i = 0; i < LOCK_TRIES; i += 1) {
    let fd;
    try {
      fd = openSync(lock, 'wx');
    } catch (e) {
      const code = /** @type {NodeJS.ErrnoException} */ (e).code;
      // Windows refuses to create a file whose last holder just unlinked it while a handle was
      // still open (delete pending): EPERM or EACCES, not EEXIST. That is a busy lock, not a fault.
      if (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY') { Atomics.wait(SLEEPER, 0, 0, LOCK_WAIT_MS); continue; }
      if (code !== 'EEXIST') return false;
      let stale = false;
      try { stale = Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS; } catch { continue; /* released */ }
      if (stale) { breakStale(lock); continue; }
      Atomics.wait(SLEEPER, 0, 0, LOCK_WAIT_MS);
      continue;
    }
    try {
      try { writeFileSync(fd, token); } finally { closeSync(fd); }
      return fn();
    } finally {
      try { if (readFileSync(lock, 'utf8') === token) unlinkSync(lock); } catch { /* broken as stale */ }
    }
  }
  return false;
}

/** LF on every platform: the tier's file is shared with the OpenCode plugin, which writes LF. */
function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmp, text, 'utf8');
  // A rename onto a file a reader (an agent at step 0, a scanner) holds open fails EPERM on
  // Windows for a moment: three tries, 10 ms apart, then the error.
  for (let i = 0; ; i += 1) {
    try { renameSync(tmp, file); return; } catch (e) {
      if (i < 2 && /** @type {NodeJS.ErrnoException} */ (e).code === 'EPERM') { Atomics.wait(SLEEPER, 0, 0, LOCK_WAIT_MS); continue; }
      try { unlinkSync(tmp); } catch { /* gone */ }
      throw e;
    }
  }
}

/** Add `bullets` to one notes file, under its lock. A file that is not UTF-8 is left whole (the fold's rule). */
function addTo(file, bullets, cap) {
  if (!bullets.length) return false;
  return withLock(file, () => {
    let old = '';
    if (existsSync(file)) {
      const raw = readFileSync(file);
      if (!isUtf8(raw)) return false;
      old = raw.toString('utf8');
    }
    const next = mergeFeedback(old, bullets, cap);
    if (next === null) return false;
    writeAtomic(file, next);
    return true;
  });
}

/**
 * The capture: the feedback lines in `report` into the notes under `notesRoot`. An agent's lines
 * go to `agent-notes/` when `agent` names one (a SubagentStop); a skill's lines go to
 * `skill-notes/` either way, a sub-agent's or the main session's (a Stop passes no agent, so a
 * relayed `[agent]` or `[general]` line there is no note). A skill line is kept only when
 * `skillsDir` holds that skill: the install's own `skills/<name>/`, whose `{{PATH_NOTES}}` is this
 * notes root, so an invented or misspelt name, or a skill another install serves, writes no file
 * nobody reads. Writes nothing when the notes root's parent does not exist (no install or tier
 * there to serve), and returns the files it changed.
 */
export function captureSpecFeedback(agent, report, notesRoot, day = today(), skillsDir = null) {
  if (!notesRoot || !existsSync(path.dirname(notesRoot))) return [];
  const items = specFeedbackOf(report, SECRET_RE)
    .filter((f) => (f.skill ? Boolean(skillsDir) && existsSync(path.join(skillsDir, f.skill)) : Boolean(agent)));
  if (!items.length) return [];
  const written = [];
  const add = (dir, name, bullets, cap) => {
    if (!bullets.length) return;
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    if (addTo(file, bullets, cap)) written.push(file);
  };
  if (agent) {
    const dir = path.join(notesRoot, 'agent-notes');
    const { own, general } = feedbackBullets(items, agent, day);
    add(dir, `${agent}.md`, own, MAX_FEEDBACK_BULLETS);
    add(dir, GENERAL_NOTES, general, MAX_GENERAL_BULLETS);
  }
  const dir = path.join(notesRoot, 'skill-notes');
  const skills = skillBullets(items, day);
  for (const [skill, bullets] of skills.own) add(dir, `${skill}.md`, bullets, MAX_FEEDBACK_BULLETS);
  add(dir, GENERAL_NOTES, skills.general, MAX_GENERAL_BULLETS);
  return written;
}
