/**
 * The done gate — Verify Before Asserting's boundary half, at the moment a turn ends (#289).
 *
 * Every other gate sits before an act. This one sits at Stop: a turn that edited files under a
 * project which lists its proof in `.geneseed/done-checks.txt` may not end until every listed
 * check has run AND passed after the last edit. The gate never runs a check itself — the hook
 * path starts no process of its own (ADR 0002) — it reads the turn's own tool calls in the transcript.
 *
 * WHY IT RIDES `learn` AND NOT A VERB OR A FLAG OF ITS OWN (ADR 0010). The machine-wide shim is
 * last-writer-wins: an older `geneseed-hook` would refuse a new verb or flag, and the Stop
 * command's `|| exit 0` would then skip learning too, silently. Arming on a project FILE keeps
 * every emitted settings file byte-identical, so a stale shim only means "no done gate".
 *
 * WHY STDOUT JSON AND NOT EXIT 2. The emitted Stop command ends in `|| exit 0`, which swallows
 * a 2. `{"decision":"block"}` on exit 0 is the one signal that survives the existing wiring.
 * Allowing prints NOTHING — on Stop a stray stdout byte is read as a verdict.
 *
 * WHAT COUNTS (shortcut: write tools only; a shell `sed -i` or redirect is not an edit here —
 * seeing those would need `git status`, a spawn. Same limit as `protected-checks.txt`):
 *   - an edit is a Write/Edit/NotebookEdit/MultiEdit whose target is under the project root and
 *     whose result is not an error (a denied write changed nothing);
 *   - a pass is a Bash/PowerShell call whose command contains the declared line UNPIPED (a pipe
 *     takes the exit code of its last stage: `npm test | tail` exits 0 on a red suite) and whose
 *     result is not `is_error` — every non-zero exit, denial and timeout carries it (checked on
 *     14 000+ real Claude Code results, 2026-10-17).
 *
 * At most one block per turn: `stop_hook_active` is true when this Stop follows a block, and the
 * gate then lets the turn end and leaves a ledger line, so a gate that cries wolf gets found.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { readText, printOut as out, printErr as err } from '../lib/fs.mjs';
import { within } from '../lib/paths.mjs';
import { gitRootOf } from './gitref.mjs';
import { DONE_LIST, recordGate } from './hooks.mjs';
import { splitLines } from './hooks-prims.mjs';

const EDIT_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit', 'MultiEdit']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

/** The declared checks, one per line, `#` comments; null when the project has no list. */
export function readDoneChecks(root) {
  const file = path.join(root, DONE_LIST);
  if (!existsSync(file)) return null;
  try {
    return splitLines(readText(file)).map((l) => l.trim().replace(/\s+/g, ' '))
      .filter((l) => l && !l.startsWith('#'));
  } catch {
    return null;
  }
}

/**
 * True when `command` runs `line` with no pipe after it in the same segment. A segment ends at
 * `&&`, `||`, `;` or a newline; a single `|` before that end is a pipe. Whitespace is collapsed
 * on both sides. shortcut: quotes are not parsed — a `|` inside a quoted argument after the
 * check reads as a pipe, which only ever refuses a pass, never grants one.
 */
export function runsUnpiped(command, line) {
  const cmd = String(command).replace(/[ \t]+/g, ' ');
  for (let i = cmd.indexOf(line); i !== -1; i = cmd.indexOf(line, i + 1)) {
    const rest = cmd.slice(i + line.length);
    let piped = false;
    for (let j = 0; j < rest.length; j += 1) {
      const two = rest.slice(j, j + 2);
      if (two === '&&' || two === '||' || rest[j] === ';' || rest[j] === '\n') break;
      if (rest[j] === '|') { piped = true; break; }
    }
    if (!piped) return true;
  }
  return false;
}

/** A user line that opens a turn: the user typed it, it is not a tool result or a meta note. */
function isPrompt(obj) {
  if (obj.type !== 'user' || obj.isMeta || obj.isSidechain) return false;
  const c = obj.message && obj.message.content;
  if (typeof c === 'string') return true;
  return Array.isArray(c) && c.length > 0 && !c.some((b) => b && b.type === 'tool_result');
}

/**
 * The decision, over transcript TEXT: the checks that have not passed since the turn's last
 * edit, or [] when the turn may end (no edit, or every check passed after it). Exported for the
 * unit tier — a transcript is text no CLI cell can vary cheaply.
 */
export function doneDecide(transcript, checks, root, cwd = root) {
  const entries = [];
  for (const line of splitLines(transcript)) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { /* a torn last line is not evidence */ }
  }
  let start = 0;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (isPrompt(entries[i])) { start = i + 1; break; }
  }
  const calls = [];                      // tool_use blocks, in order
  const results = new Map();             // tool_use_id -> is_error
  for (const obj of entries.slice(start)) {
    if (obj.isSidechain) continue;
    const content = obj.message && obj.message.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'tool_use') calls.push(b);
      else if (b.type === 'tool_result') results.set(b.tool_use_id, b.is_error === true);
    }
  }
  let lastEdit = -1;
  calls.forEach((c, i) => {
    if (!EDIT_TOOLS.has(c.name) || results.get(c.id) === true) return;
    const p = c.input && (c.input.file_path || c.input.notebook_path || c.input.path);
    if (typeof p === 'string' && p && within(path.resolve(cwd, p), root)) lastEdit = i;
  });
  if (lastEdit === -1) return [];
  const passed = new Set();
  calls.slice(lastEdit + 1).forEach((c) => {
    const command = SHELL_TOOLS.has(c.name) && c.input && c.input.command;
    // A call with no result yet (the host has not flushed it) is not a pass.
    if (typeof command !== 'string' || results.get(c.id) !== false) return;
    for (const check of checks) if (runsUnpiped(command, check)) passed.add(check);
  });
  return checks.filter((c) => !passed.has(c));
}

/**
 * The Stop-side wrapper `cmdLearn` calls first. Returns true when it printed a block (the turn
 * goes on, so `learn` must not distil yet); false in every other case, with nothing on stdout.
 */
export function doneGate(meta, args) {
  try {
    const cwd = typeof meta.cwd === 'string' && meta.cwd ? meta.cwd : process.cwd();
    const root = gitRootOf(cwd);
    const checks = root ? readDoneChecks(root) : null;
    if (!checks || !checks.length) return false;
    // Bob's Stop payload carries no transcript (learn's I2): nothing to judge, and it says so.
    if (args.host === 'bob' || typeof meta.transcript_path !== 'string') {
      err(`[done-gate] no transcript${args.host === 'bob' ? ' (bob)' : ''} — turn not judged.\n`);
      return false;
    }
    let transcript;
    try {
      transcript = readText(meta.transcript_path);
    } catch {
      // No ask tier on Stop: blocking on an unreadable transcript would trap the user.
      err('[done-gate] transcript unreadable — turn not judged.\n');
      return false;
    }
    const missing = doneDecide(transcript, checks, root, cwd);
    if (!missing.length) return false;
    const install = args.memory ? path.dirname(args.memory) : null;
    if (meta.stop_hook_active === true) {
      recordGate(install, 'done-gate-cap', 'law-3');
      err(`[done-gate] cap reached — turn ends with unproven checks: ${missing.join('; ')}\n`);
      return false;
    }
    recordGate(install, 'done-gate', 'law-3');
    out(`${JSON.stringify({
      decision: 'block',
      reason: 'Geneseed (Verify Before Asserting) — this turn edited files, and these '
        + `checks from ${DONE_LIST} have not passed since the last edit: ${missing.join('; ')}. `
        + 'Run them unpiped, or say plainly that they were not run and why.',
    })}\n`);
    return true;
  } catch (e) {
    err(`[done-gate] skipped: ${e && e.message}\n`);
    return false;
  }
}
