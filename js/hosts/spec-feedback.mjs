/**
 * The agents' self-improvement loop, captured by the hook: every `spec-feedback:` line a sub-agent
 * ends its report with (src/agents/_self-improvement.md) goes into the notes the agent reads at its
 * next dispatch, `<notes>/agent-notes/<agent>.md`, or for a `general` one `_general.md`, which every agent reads.
 * The skills' loop is the same line tagged `[skill:<name>]` (src/skills/_self-improvement.md),
 * read off the main session's final reply on Stop (`turnReply`) and off a sub-agent's report on
 * SubagentStop, into `<notes>/skill-notes/<name>.md` or `skill-notes/_general.md`: the skills'
 * notes stayed empty the same way (73 runs in 30 days, 20 with friction, no note written).
 * Each line also names its scope: the machine notes (the tier) or this project's
 * (`<project>/notebook`), `PROJECT_NOTES_DIR` below.
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
import { gitCommonDirOf, gitRootOf, mainWorktreeOf } from './gitref.mjs';

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
// `[agent:project]` (or bare `agent:project`) is the agent's own line kept for this repo only, and
// `[general:project]` (or bare `general:project`) the line every agent reads in this repo only.
const FEEDBACK_SCOPE_RE = /^(?:\[[ \t]*(?<own>agent|general)[ \t]*\]|\[[ \t]*agent[ \t]*\|[ \t]*general[ \t]*\]|\[[ \t]*(?<pw>agent|general)[ \t]*:[ \t]*project[ \t]*\]|(?<pb>agent|general):project(?![\w-])|(?<bare>agent|general)(?![\w-]))[ \t]*(?:[—–:-][ \t]*)?/i;
// What opens an agent's tag at all, parsed or not: `[project]`, `[agent project]`, `[agent:local]`
// do not parse, and are dropped rather than filed, tag and all, in the machine notes.
const AGENT_OPENING_RE = /^\[[ \t]*(?:agent|general|project)\b/i;
/**
 * A skill's scope, which always names the skill: `[skill:<name>]` for that skill's own notes,
 * `[skill:<name>:general]` (or `, general` / ` general`) for the notes every skill shares, and
 * `[skill:<name>:project]` for its own notes in this repo only, and `[skill:<name>:general:project]`
 * for the notes every skill shares in this repo only. The
 * name is required because the main session's reply, where a skill's line is read, also relays
 * sub-agents' `[agent]` and `[general]` lines: only a line naming a skill is a skill's. A `|`
 * before `general` is the template's unchosen alternative, as `[agent|general]` is: own notes.
 * The bracket's content is taken whole, and a name that is no slug (the template's `<name>`, a
 * path) drops the line rather than letting `[skill:…]` fall through into an agent's notes. The
 * brackets may be dropped (`skill:debug — …`), as reports drop them around `agent`, scope and all (`skill:debug:project — …`).
 */
const SKILL_SCOPE_RE = /^(?:\[[ \t]*skill[ \t]*:[ \t]*([^\]|,; \t:]*)[ \t]*(?:([|,;:]|[ \t])[ \t]*(general[ \t]*:[ \t]*project|general|project)[ \t]*)?\]|skill:([a-z][a-z0-9-]*)(?::(general:project|general|project))?(?![\w-]))[ \t]*(?:[—–:-][ \t]*)?/i;
const SKILL_NAME_RE = /^[a-z][a-z0-9-]{0,63}$/;
// What opens a skill's tag at all, parsed or not.
const SKILL_OPENING_RE = /^(?:\[[ \t]*skill\b|skill[ \t]*:)/i;
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
/**
 * TWO SCOPES, chosen by the line, never by the install (the owner's ruling, 2026-11-15). A flaw of
 * the spec is true in every repo: `[agent]`, `[general]`, `[skill:<id>]`, `[skill:<id>:general]` go
 * to the MACHINE notes, the tier's `notes/`. A fact true only in this repo, `[agent:project]`,
 * `[general:project]`, `[skill:<id>:project]` or `[skill:<id>:general:project]`, goes to the
 * PROJECT notes, `<project root>/notebook/`, one folder for every host, with its own `_general.md`
 * files. The render names this folder relative to the project root (`{{PATH_PROJECT_NOTES}}`).
 */
export const PROJECT_NOTES_DIR = 'notebook';
/**
 * THE PROJECT NOTES NEVER REACH A COMMIT, and Geneseed writes no file into the user's tree to say so
 * (the owner's ruling, 2026-11-15): the ignore entries go into the clone's own `.git/info/exclude`,
 * per clone and never committed. That covers a fresh repo, a repo whose `notebook/` is tracked, and an
 * unrelated `notebook/` folder alike, since only the notes folders and the migration's archives are
 * named. `rel` is the notebook's path from the git root, `/`-separated. The exclude file's new text,
 * or null when every entry is already there: the block is added once, and only its missing lines after.
 */
export const EXCLUDE_HEAD = '# Geneseed: the project notes stay on this clone, never committed';
export function excludeWithNotes(text, rel) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim());
  const want = ['agent-notes', 'skill-notes', 'archived-agent-notes', 'archived-skill-notes'].map((sub) => `/${rel}/${sub}/`);
  const missing = want.filter((w) => !lines.includes(w));
  if (!missing.length) return null;
  const old = String(text || '').replace(/\r\n?/g, '\n');
  const add = [...(lines.includes(EXCLUDE_HEAD) ? [] : [EXCLUDE_HEAD]), ...missing];
  return `${old}${old && !old.endsWith('\n') ? '\n' : ''}${add.join('\n')}\n`;
}
// A bullet's dated tail, `(2026-11-14)` or `(tester, 2026-11-14)`: not part of what it says.
const DATED_TAIL_RE = /[ \t]*\((?:[a-z][a-z0-9-]*, )?\d{4}-\d{2}-\d{2}\)[ \t]*$/;
// A bullet in the shape this capture writes: the only kind the caps may drop.
// Every bullet the hook writes names its writer beside the date, `(<agent or skill>, date)`: that
// is what tells it from a line written by hand (the notes were hand-written as `- [skill] … (date)`
// before the hook), and a hand-written line is never dropped (the owner's ruling, 2026-11-15).
// `[agent]` bullets written before the name was added read as hand lines now: kept, never pruned.
const HOOK_BULLET_RE = /^- \[(?:agent|general|skill)\] .*\([a-z][a-z0-9-]*, \d{4}-\d{2}-\d{2}\)[ \t]*$/;

/**
 * Every feedback line in `text` as `{ scope, body }`, in order, each body once. `secret` is Law
 * I's pattern: a line that carries a credential is dropped whole, never written to a note. An
 * agent's scope is `agent`, `general`, `project` or `project-general`. A skill's line also carries
 * `skill: <name>`, its scope `skill` (own notes), `general`, `project` or `project-general`.
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
      // A skill line wrapped in inline code is an example the reply quotes (a summary of this very
      // format), not the reply's own line: the main session discusses the format, an agent's
      // report does not. A whole-line `spec-feedback:` in backticks stays an agent's line.
      if (m[1] === '`') continue;
      const tag = (k[3] && k[2] !== '|' ? k[3] : k[5] ?? '').toLowerCase().replace(/[ \t]/g, '');
      scope = tag === 'general:project' ? 'project-general' : tag || 'skill';
      body = body.slice(k[0].length);
    } else if (SKILL_OPENING_RE.test(body)) {
      continue; // a skill tag that does not parse (`[skill:a:b]`, `[skill:a, b]`) is no agent's line
    } else {
      const s = FEEDBACK_SCOPE_RE.exec(body);
      if (!s && AGENT_OPENING_RE.test(body)) continue;
      const g = s ? s.groups : {};
      const projectTag = g.pw || g.pb;
      if (projectTag) scope = projectTag.toLowerCase() === 'general' ? 'project-general' : 'project';
      else if (g.own || g.bare) scope = (g.own || g.bare).toLowerCase();
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
  const own = (scope) => mine.filter((f) => f.scope === scope).map((f) => `- [agent] ${f.body} (${agent}, ${day})`);
  const general = (scope) => mine.filter((f) => f.scope === scope).map((f) => `- [general] ${f.body} (${agent}, ${day})`);
  return {
    own: own('agent'),
    general: general('general'),
    // The same bullet shapes in the project's files: where a bullet sits says its scope.
    project: own('project'),
    projectGeneral: general('project-general'),
  };
}

/**
 * The same for the skills' lines, into `skill-notes/`: `own` maps each skill to its bullets,
 * `- [skill] … (<skill>, date)`; a general line goes to `skill-notes/_general.md`, which every
 * skill reads, in the same shape as `[general]`. The name beside the date is what tells a hook
 * bullet from the `- [skill] … (date)` lines written by hand before the hook: those are never
 * dropped, and the duplicate check reads past both tails, so the same words are one note.
 */
export function skillBullets(items, day) {
  const own = new Map();
  const project = new Map();
  const general = [];
  const projectGeneral = [];
  for (const f of items) {
    if (!f.skill) continue;
    if (f.scope === 'general' || f.scope === 'project-general') {
      (f.scope === 'general' ? general : projectGeneral).push(`- [general] ${f.body} (${f.skill}, ${day})`);
      continue;
    }
    const into = f.scope === 'project' ? project : own;
    if (!into.has(f.skill)) into.set(f.skill, []);
    into.get(f.skill).push(`- [skill] ${f.body} (${f.skill}, ${day})`);
  }
  return { own, general, project, projectGeneral };
}

/**
 * Every file one report writes, `{ root, sub, name, bullets, cap }` in the order the capture
 * writes them: `root` is `machine` (the tier's notes) or `project` (`<project>/notebook`). A Stop
 * passes no agent, so an agent's line there (relayed from a sub-agent) has no target. The one
 * routing table: the hook and the OpenCode plugin both write what this returns.
 */
export function feedbackTargets(items, agent, day) {
  const targets = [];
  const put = (root, sub, name, bullets, cap) => { if (bullets.length) targets.push({ root, sub, name, bullets, cap }); };
  if (agent) {
    const { own, general, project, projectGeneral } = feedbackBullets(items, agent, day);
    put('machine', 'agent-notes', `${agent}.md`, own, MAX_FEEDBACK_BULLETS);
    put('machine', 'agent-notes', GENERAL_NOTES, general, MAX_GENERAL_BULLETS);
    put('project', 'agent-notes', `${agent}.md`, project, MAX_FEEDBACK_BULLETS);
    put('project', 'agent-notes', GENERAL_NOTES, projectGeneral, MAX_GENERAL_BULLETS);
  }
  const skills = skillBullets(items, day);
  for (const [skill, bullets] of skills.own) put('machine', 'skill-notes', `${skill}.md`, bullets, MAX_FEEDBACK_BULLETS);
  put('machine', 'skill-notes', GENERAL_NOTES, skills.general, MAX_GENERAL_BULLETS);
  for (const [skill, bullets] of skills.project) put('project', 'skill-notes', `${skill}.md`, bullets, MAX_FEEDBACK_BULLETS);
  put('project', 'skill-notes', GENERAL_NOTES, skills.projectGeneral, MAX_GENERAL_BULLETS);
  return targets;
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
 * A skill this install serves under that name: `<skillsDir>/<name>/SKILL.md` names its OWN notes
 * file, `skill-notes/<name>.md`, which the render writes from the skill's id
 * (`{{SKILL_NAME}}`, src/skills/_self-improvement.md). An alias folder an older build rendered
 * (`deps-audit/`, whose body is `dependencies`'), a skill rendered before the id was, or any folder
 * that is not a Geneseed skill names another file or `<name>`, so no note is kept for it: nothing
 * would read it. Read only when a line names a skill, which is rare.
 */
export function liveSkill(skillsDir, name) {
  if (!skillsDir) return false;
  try {
    return readFileSync(path.join(skillsDir, name, 'SKILL.md'), 'utf8').includes(`skill-notes/${name}.md`);
  } catch { return false; }
}

/**
 * THE ONE RESOLVER of a project's notes folder, for the hook, the migration and `diff`:
 * `<base>/notebook`, where a `base` inside a linked git worktree is mapped to the same place in
 * the main checkout, since a worktree and its notes go when it is removed. Read off disk, never
 * by spawning git. The OpenCode learn plugin keeps an async hand twin (`notesRootsOf`).
 */
export function projectNotesDir(base) {
  if (!base) return null;
  let at = base;
  try {
    const main = mainWorktreeOf(at);
    if (main) at = path.join(main, path.relative(gitRootOf(at), at));
  } catch { at = base; }
  return path.join(at, PROJECT_NOTES_DIR);
}

/**
 * The project notes, kept out of every commit: their entries in the clone's own `.git/info/exclude`
 * (`excludeWithNotes`). A linked worktree's notes are the main checkout's, whose `.git` is the shared
 * one; a submodule's gitdir is named by its `.git` file. Outside a git repo nothing is written. Never
 * throws: an exclude that cannot be written costs only the ignore line, never the note.
 */
export function excludeProjectNotes(notebookDir) {
  try {
    const root = gitRootOf(path.dirname(notebookDir));
    if (!root) return false;
    const rel = path.relative(root, notebookDir).split(path.sep).join('/');
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;
    const file = path.join(gitCommonDirOf(root), 'info', 'exclude');
    const next = excludeWithNotes(existsSync(file) ? readFileSync(file, 'utf8') : '', rel);
    if (next === null) return false;
    mkdirSync(path.dirname(file), { recursive: true });
    writeAtomic(file, next);
    return true;
  } catch { return false; }
}

/**
 * The capture: the feedback lines in `report` into the notes `feedbackTargets` names. `roots` is
 * `{ machine, project }`, each a notes root or null (that scope writes nothing), or one string for
 * both. An agent's lines are kept when `agent` names one (a SubagentStop); a skill's either way, a
 * sub-agent's or the main session's (a Stop passes no agent, so a relayed `[agent]` or `[general]`
 * line there is no note). A skill line is kept only for a `liveSkill` of `skillsDir`, the install's
 * own `skills/`, so an invented or misspelt name, an alias, or a skill another install serves
 * writes no file nobody reads. A root whose parent does not exist (no tier, no project there)
 * writes nothing. Returns the files it changed.
 */
export function captureSpecFeedback(agent, report, roots, day = today(), skillsDir = null) {
  const at = typeof roots === 'string' ? { machine: roots, project: roots } : (roots || {});
  const usable = (dir) => Boolean(dir) && existsSync(path.dirname(dir));
  if (!usable(at.machine) && !usable(at.project)) return [];
  const items = specFeedbackOf(report, SECRET_RE)
    .filter((f) => (f.skill ? liveSkill(skillsDir, f.skill) : Boolean(agent)));
  if (!items.length) return [];
  const written = [];
  for (const t of feedbackTargets(items, agent, day)) {
    const root = at[t.root];
    if (!usable(root)) continue;
    if (t.root === 'project' && typeof roots !== 'string') excludeProjectNotes(root);
    const dir = path.join(root, t.sub);
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, t.name);
    if (addTo(file, t.bullets, t.cap)) written.push(file);
  }
  return written;
}

/**
 * The migration's merge (`js/build/notes-migrate.mjs`): `source`'s lines appended after `target`'s.
 * A source line is left out only when the target already holds that EXACT line (a trailing CR
 * aside): case and inner spacing are never folded, and two equal lines inside the source both stay,
 * since the user may have written them so. Blank lines travel with the lines they sit between. NO cap
 * and no budget: a moved note is never dropped. null when the target already holds every line.
 * (The capture's own duplicate check, `feedbackKey` in `mergeFeedback`, folds case and spacing for
 * the hook's bullets; it did so before the two scopes, and this merge does not use it.)
 */
export function mergeNotesText(target, source) {
  const text = String(target || '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  const lines = text ? text.split('\n') : [];
  const have = new Set(lines);
  const src = String(source || '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  const add = (src ? src.split('\n') : []).filter((l) => !l.trim() || !have.has(l));
  if (!add.some((l) => l.trim())) return null;
  while (add.length && !add[0].trim()) add.shift();
  return `${[...lines, ...add].join('\n')}\n`;
}
