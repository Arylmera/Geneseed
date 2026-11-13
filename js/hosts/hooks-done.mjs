/**
 * The done gate — Verify Before Asserting's boundary half, at the moment a turn ends (#289).
 *
 * Every other gate sits before an act. This one sits at Stop: a turn that edited files under a
 * project's git root is judged against that project's proof — the checks that must have run AND
 * passed after the last edit. The gate never runs a check itself — the hook path starts no
 * process of its own (ADR 0002) — it reads the turn's own tool calls in the transcript.
 *
 * WHERE THE CHECKS COME FROM (`doneChecksOf`, user decision 2026-10-29: the harness maintains
 * them, not the user). `.geneseed/done-checks.txt` at the git root, when present, is the override:
 * one command per line, and it BLOCKS (a present file that lists nothing switches the gate off for
 * that project). Absent, the checks are INFERRED from the root manifests (`inferDoneChecks`), and
 * an inferred check is ADVISORY: an unproven turn still ends, with a `systemMessage` to the user,
 * a ledger line and a stderr line — never `decision: block`. It stays advisory, with no date: an
 * inferred check is a guess at a project's proof, and only a list the project wrote may block
 * (user decision 2026-11). An inferred check is a GROUP of accepted command forms (`npm test` |
 * `npm run test` | `npm t`), satisfied by any one.
 *
 * THE OTHER ADVISORY: A WEAKENED TEST (Cure the Cause). A turn whose write tools added a skip marker
 * to a test file, or dropped an assertion (`weakenedBy`), gets a `[done-gate] advisory` line in the
 * same `systemMessage`. It needs no checks and never blocks, and `--no-done-gate` silences it as
 * it silences the inferred advisory: `cmdLearn` does not call this module at all then. On a Write
 * the old text comes from the transcript line's `toolUseResult.originalFile` (a string on an
 * update, null on a create, seen in real transcripts 2026-11); without it the text reads as new.
 *
 * WHY IT RIDES `learn` AND NOT A VERB OR A FLAG OF ITS OWN (ADR 0010). The machine-wide shim is
 * last-writer-wins: an older `geneseed-hook` would refuse a new verb or flag, and the Stop
 * command's `|| exit 0` would then skip learning too, silently. Arming on a project FILE keeps
 * every emitted settings file byte-identical, so a stale shim only means "no done gate".
 * The ONE flag is the off switch, `--no-done-gate` (user decision 2026-10-18): it is emitted
 * only on an install built with the gate off, so armed settings stay byte-identical — but on
 * such an install a stale shim refuses the flag and that install loses LEARNING too, not just a
 * gate it already switched off. Hence "run rebuild-all before switching it off" (exclusions.md).
 *
 * WHY STDOUT JSON AND NOT EXIT 2. The emitted Stop command ends in `|| exit 0`, which swallows
 * a 2. `{"decision":"block"}` on exit 0 is the one signal that survives the existing wiring.
 * Allowing prints NOTHING — on Stop a stray stdout byte is read as a verdict. The advisory prints
 * `{"systemMessage":…}` alone: Claude Code shows it to the user as a warning and the stop goes
 * ahead (code.claude.com/docs/en/hooks.md, "JSON output"; not seen live — no gate here runs a
 * model turn). `hookSpecificOutput.additionalContext` would reach the model, but it continues the
 * turn under the same loop guard as a block — a block in all but name — so the model learns of
 * inferred checks from `doneLine`, in the SessionStart context, instead.
 *
 * WHAT COUNTS (shortcut: write tools only; a shell `sed -i` or redirect is not an edit here —
 * seeing every one would need `git status`, a spawn; the rule gate reads the common forms for
 * `protected-checks.txt`, but a turn is judged on what it wrote, which a command line cannot prove):
 *   - an edit is a Write/Edit/NotebookEdit/MultiEdit whose target is under the project root and
 *     whose result is not an error (a denied write changed nothing);
 *   - a pass is a Bash/PowerShell call whose command contains one of the check's forms UNPIPED (a pipe
 *     takes the exit code of its last stage: `npm test | tail` exits 0 on a red suite), not MASKED
 *     after it (`|| true`, `; exit 0` — see `runsUnpiped`), and whose
 *     result is not `is_error` — every non-zero exit, denial and timeout carries it (checked on
 *     14 000+ real Claude Code results, 2026-10-17);
 *   - a BACKGROUND run (`run_in_background: true`) is pending, not passed: its result comes at
 *     once, `is_error` false, with `toolUseResult.backgroundTaskId` set — it says the command
 *     STARTED. It passes only when a later task notification names its tool-use id with
 *     `<status>completed</status>` and `completed (exit code 0)` (`notificationText`); any other
 *     status or code leaves it owed. Before this, 76 of 112 accepted passes in 30 days of real
 *     transcripts here were launches. The pass is still placed by the CALL: a launch before the
 *     last edit proves nothing, even when it completes after it.
 *
 * READ FROM THE END (constant-cost Stop). Only the current turn matters, so the transcript is read
 * backward in growing windows (`tailReader`) until the turn's opening prompt is inside one; a
 * turn longer than every window falls back to the whole file. Never judged on a truncated turn:
 * a window without a prompt answers "read more", not "no edit". A task notification is no prompt:
 * Claude Code writes it as a `type: "user"` line whose text opens `<task-notification>` (4 258
 * such lines in this machine's transcripts, 2026-11), and as a prompt it would open a new turn
 * and hide the edit before it.
 *
 * At most one block per turn: `stop_hook_active` is true when this Stop follows a block, and the
 * gate then lets the turn end and leaves a ledger line, so a gate that cries wolf gets found.
 */
import path from 'node:path';
import { printOut as out, printErr as err } from '../lib/fs.mjs';
import { within } from '../lib/paths.mjs';
import { gitRootOf } from './gitref.mjs';
import { recordGate } from './hooks.mjs';
import { ADVISORY_VERB } from './hosts.mjs';
import { DONE_LIST, editPairs, isTestPath, splitLines, tailReader, weakenedBy } from './hooks-prims.mjs';
import { doneChecksOf } from './done-checks.mjs';

const EDIT_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit', 'MultiEdit']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

/**
 * True when `command` runs `line` as a whole command with no pipe after it in the same segment.
 * A segment ends at `&&`, `||`, `;` or a newline; a single `|` before that end is a pipe. The
 * check must open a segment (the start, or right after one of those separators) and be followed
 * by the end, whitespace or a separator, never by more of a word (`npm run lint:fix` does not
 * prove `npm run lint`); a match inside a quoted string (`-m "ran npm test"`) is text, not a run.
 * A run whose exit code is MASKED is not a run either: `npm test || true`, `npm test; true`,
 * `npm test; exit 0` all exit 0 on a red suite, so `is_error` stays false. Masked means a `||`
 * anywhere after the check (any right-hand side, even an honest `|| exit 1`), or a `;`/newline
 * followed by `true`, `:`, `exit 0` or a bare `exit` (bash passes `$?` on, but PowerShell's bare
 * `exit` is 0, so it must count). `&&` masks nothing (a red check stops the
 * chain), so `npm test && echo ok` still passes.
 * Whitespace is collapsed on both sides. shortcut: the shell is not parsed — a prefix such as
 * `sudo`/`time`/`env X=1`, a subshell, or a `|` inside a quoted argument after the check all read
 * as "not run", and so does a `||` inside a quoted argument after the check. Every approximation
 * of the command line above refuses a pass, so the gate errs toward a reminder. That says nothing
 * of the call's mode: a `run_in_background` launch is judged by its completion, not here
 * (`missingChecks`). One known opening the other way remains:
 * `npm test; npm run lint` passes both, though `;` lets a green lint hide a red test (the line's
 * exit code is the last command's). Kept so a chained proof line still counts; upgrade by
 * requiring `&&` between checks if that opening is ever seen in a real transcript.
 */
export function runsUnpiped(command, line) {
  const cmd = String(command).replace(/[ \t]+/g, ' ');
  for (let i = cmd.indexOf(line); i !== -1; i = cmd.indexOf(line, i + 1)) {
    const next = cmd[i + line.length];
    if (next !== undefined && !/[\s;&|]/.test(next)) continue;
    const head = cmd.slice(0, i);
    // Not after `||`: `true || npm test` never runs the check.
    if (!/(^|&&|(?<!\|)\|(?!\|)|;|\n) ?$/.test(head.replace(/\|\| ?$/, '\u0000'))) continue;
    let quote = '', esc = false;
    for (const ch of head) {
      if (esc) esc = false;
      else if (ch === '\\' && quote !== "'") esc = true;
      else if (quote) { if (ch === quote) quote = ''; }
      else if (ch === '"' || ch === "'") quote = ch;
    }
    if (quote) continue;
    const rest = cmd.slice(i + line.length);
    let piped = false;
    for (let j = 0; j < rest.length; j += 1) {
      const two = rest.slice(j, j + 2);
      if (two === '&&' || two === '||' || rest[j] === ';' || rest[j] === '\n') break;
      if (rest[j] === '|') { piped = true; break; }
    }
    // MASKED when the line's exit status is not the check's: a `||` after it; behind `;` or a
    // newline, a command that always succeeds (`true`, `:`, `exit`, and `echo`/`printf`, as in
    // the common `npm test; echo "exit: $?"`, which exits 0 on a red suite); or a trailing lone
    // `&`, which backgrounds the check. A real next command is not a mask, and `&&` keeps the status.
    const masked = /\|\||[;\n] ?(?:true|:|exit(?: 0)?|(?:echo|printf)(?: [^;&|\n]*)?)(?= ?(?:$|[;&|\n]))|(?<!&)& ?$/.test(rest);
    if (!piped && !masked) return true;
  }
  return false;
}

/**
 * True when `command` proves the check group `g`: one of its forms runs unpiped and unmasked
 * (`runsUnpiped`), and — when the group names `refuse`, the flags that skip the tests
 * (`mvn install -DskipTests`, `gradle build -x test`, `cargo test --no-run`) — some unpiped
 * segment opening with a form carries none of them. shortcut: segments split on `&&`, `||`, `;`
 * and newlines without reading quotes; a quoted separator only makes a refusal more likely.
 */
export function groupPasses(command, g) {
  if (!g.forms.some((f) => runsUnpiped(command, f))) return false;
  if (!g.refuse) return true;
  return String(command).replace(/[ \t]+/g, ' ').split(/&&|\|\||;|\n/).map((s) => s.trim())
    .some((s) => !s.includes('|') && !g.refuse.test(s)
      && g.forms.some((f) => s === f || s.startsWith(`${f} `)));
}

const NOTE_OPEN = '<task-notification>';

/**
 * The text of a background task's notification, or null. Claude Code writes it twice: as a
 * `queued_command` attachment (`attachment.prompt`, a string; 174 of them here are objects, not
 * notifications) and as a `type: "user"` line holding the same text. `queue-operation` lines carry
 * it a third time and are not read.
 */
function notificationText(obj) {
  let t = null;
  if (obj.type === 'attachment') {
    const a = obj.attachment;
    if (a && a.type === 'queued_command') t = a.prompt;
  } else if (obj.type === 'user') {
    const c = obj.message && obj.message.content;
    t = typeof c === 'string' ? c
      : Array.isArray(c) && c.length === 1 && c[0] && c[0].type === 'text' ? c[0].text : null;
  }
  return typeof t === 'string' && t.trimStart().startsWith(NOTE_OPEN) ? t : null;
}

/**
 * `[tool-use id, proven]` for one notification: proven only by `<status>completed</status>` with
 * the summary ENDING `completed (exit code 0)`. The summary quotes the launched command, so a
 * match anywhere else (`"echo exit code 0" failed with exit code 1`) would be the command's text.
 */
function notified(text) {
  const id = /<tool-use-id>([^<]+)<\/tool-use-id>/.exec(text);
  if (!id) return null;
  return [id[1].trim(), /<status>completed<\/status>/.test(text)
    && /completed \(exit code 0\)<\/summary>/.test(text)];
}

/** A user line that opens a turn: the user typed it, it is not a tool result, a meta note or a task notification. */
function isPrompt(obj, sidechain = false) {
  if (obj.type !== 'user' || obj.isMeta || (obj.isSidechain && !sidechain)) return false;
  if (notificationText(obj)) return false;
  const c = obj.message && obj.message.content;
  if (typeof c === 'string') return true;
  return Array.isArray(c) && c.length > 0 && !c.some((b) => b && b.type === 'tool_result');
}

/**
 * The current turn in transcript TEXT: its tool calls in order, each result's `is_error`, and the
 * old text the host recorded for a write. `whole` false means the text is only the file's tail:
 * with no prompt in it the turn may start earlier, so the answer is null ("read more") — a turn
 * judged from its middle could miss its edit and wrongly pass.
 *
 * `sidechain` true reads a SUB-AGENT's own transcript (`agent_transcript_path` on SubagentStop).
 * Every message line there carries `isSidechain: true` — seen in 300 of 300 transcripts under
 * `~/.claude/projects/<p>/<session>/subagents/` here (2026-11) — and the turn opens on ONE user
 * line, the Agent call's prompt as a string; the `isMeta` system reminder after it opens nothing.
 * Read as a main transcript, it would hold no prompt and no call, and every sub-agent would pass.
 * `cwd` is the last `cwd` the turn's lines name: a sub-agent's is its own (its worktree), where
 * the payload's `cwd` is its parent's.
 */
function turnOf(transcript, whole, sidechain = false) {
  const entries = [];
  for (const line of splitLines(transcript)) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { /* a torn last line is not evidence */ }
  }
  let start = -1;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (isPrompt(entries[i], sidechain)) { start = i + 1; break; }
  }
  if (start === -1) {
    if (!whole) return null;
    start = 0;
  }
  const calls = [];                      // tool_use blocks, in order
  const results = new Map();             // tool_use_id -> is_error
  const originals = new Map();           // tool_use_id -> the file before a Write
  const background = new Set();          // tool_use_id of a run_in_background launch
  const finished = new Map();            // tool_use_id -> its notification proved it
  let cwd = null;
  for (const obj of entries.slice(start)) {
    if (obj.isSidechain && !sidechain) continue;
    if (typeof obj.cwd === 'string' && obj.cwd) cwd = obj.cwd;
    const note = notificationText(obj);
    const said = note && notified(note);
    // The last notification wins: an agent's task may notify more than once.
    if (said) finished.set(said[0], said[1]);
    const content = obj.message && obj.message.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'tool_use') {
        calls.push(b);
        if (b.input && b.input.run_in_background === true) background.add(b.id);
      } else if (b.type === 'tool_result') {
        results.set(b.tool_use_id, b.is_error === true);
        const before = obj.toolUseResult && obj.toolUseResult.originalFile;
        if (typeof before === 'string') originals.set(b.tool_use_id, before);
        if (obj.toolUseResult && obj.toolUseResult.backgroundTaskId) background.add(b.tool_use_id);
      }
    }
  }
  return { calls, results, originals, background, finished, cwd };
}

/**
 * The git roots a sub-agent's landed writes fall under, in first-write order: each target's own
 * root (`gitRootOf` of its folder), so a worker in `.claude/worktrees/x` is judged as its own
 * project, against its own list. A target outside every repository is no project's.
 */
function editRoots({ calls, results }, cwd) {
  const roots = [];
  const byDir = new Map();
  for (const c of calls) {
    if (!EDIT_TOOLS.has(c.name) || results.get(c.id) === true) continue;
    const p = c.input && (c.input.file_path || c.input.notebook_path || c.input.path);
    if (typeof p !== 'string' || !p) continue;
    const dir = path.dirname(path.resolve(cwd, p));
    if (!byDir.has(dir)) byDir.set(dir, gitRootOf(dir));
    const root = byDir.get(dir);
    if (root && !roots.includes(root)) roots.push(root);
  }
  return roots;
}

/** The target of a landed write under `root`, absolute, or null. A denied write changed nothing. */
function editTarget(c, results, root, cwd) {
  if (!EDIT_TOOLS.has(c.name) || results.get(c.id) === true) return null;
  const p = c.input && (c.input.file_path || c.input.notebook_path || c.input.path);
  if (typeof p !== 'string' || !p) return null;
  const abs = path.resolve(cwd, p);
  return within(abs, root) ? abs : null;
}

/** The turn's weakened tests, one `path (labels)` entry per file, the path relative to `root`. */
function weakenedTests({ calls, results, originals }, root, cwd) {
  const byFile = new Map();
  for (const c of calls) {
    const abs = editTarget(c, results, root, cwd);
    if (!abs) continue;
    const rel = path.relative(root, abs).split(path.sep).join('/');
    if (!isTestPath(rel)) continue;
    const hits = weakenedBy(editPairs(c.input, originals.get(c.id)));
    if (hits.length) byFile.set(rel, new Set([...(byFile.get(rel) || []), ...hits]));
  }
  return [...byFile].map(([rel, hits]) => `${rel} (${[...hits].join(', ')})`);
}

/**
 * The decision, over transcript TEXT: the checks that have not passed since the turn's last
 * edit, or [] when the turn may end (no edit, or every check passed after it); null when `whole`
 * is false and the tail holds no prompt (`turnOf`). Exported for the unit tier — a transcript is
 * text no CLI cell can vary cheaply. A check is a line (one form) or a `{ label, forms }` group;
 * the answer lists labels. `sidechain` reads a sub-agent's transcript (`turnOf`).
 */
export function doneDecide(transcript, checks, root, cwd = root, whole = true, sidechain = false) {
  const turn = turnOf(transcript, whole, sidechain);
  return turn && missingChecks(turn, checks, root, cwd);
}

/** `weakenedTests` over transcript TEXT, for the unit tier: `doneDecide`'s other question. */
export const weakenedIn = (transcript, root, cwd = root) => weakenedTests(turnOf(transcript, true), root, cwd);

function missingChecks({ calls, results, background, finished }, checks, root, cwd) {
  const groups = checks.map((c) => (typeof c === 'string' ? { label: c, forms: [c] } : c));
  let lastEdit = -1;
  calls.forEach((c, i) => { if (editTarget(c, results, root, cwd)) lastEdit = i; });
  if (lastEdit === -1) return [];
  const passed = new Set();
  calls.slice(lastEdit + 1).forEach((c) => {
    const command = SHELL_TOOLS.has(c.name) && c.input && c.input.command;
    // A call with no result yet (the host has not flushed it) is not a pass.
    if (typeof command !== 'string' || results.get(c.id) !== false) return;
    // A background launch's result only says it started: its notification is the verdict.
    if (background.has(c.id) && finished.get(c.id) !== true) return;
    for (const g of groups) if (groupPasses(command, g)) passed.add(g.label);
  });
  return groups.map((g) => g.label).filter((l) => !passed.has(l));
}

/**
 * The Stop-side wrapper `cmdLearn` calls first, on Stop and on SubagentStop. Returns 'block' when
 * it printed a block (the turn goes on, so `learn` must not distil yet); 'advisory' when it
 * printed the advisory `systemMessage` (the turn ends and learning runs, but `learn` must print
 * nothing more on stdout, or the JSON stops parsing); null in every other case, with nothing on
 * stdout. `install` is the root `cmdLearn` already derived from `--memory` (null without one), so
 * the ledger lands in the same root its sovereignty check read. `read` is `cmdLearn`'s per-Stop
 * transcript reader, so the distillation after an allow reuses the windows read here.
 *
 * SUBAGENTSTOP. The turn judged is the sub-agent's own, from `agent_transcript_path` (no path: not
 * judged, and a stderr line when the cwd's project lists checks, as on Bob). The payload's `cwd`
 * is the PARENT's, so the projects are the git roots of the files the sub-agent wrote
 * (`editRoots`), each judged against its own `doneChecksOf`. A block keeps the sub-agent running
 * with the reason as its next instruction (Claude Code hooks doc, SubagentStop). An advisory is
 * a stderr line and a ledger entry only: nobody sees a sub-agent's `systemMessage`, so it returns
 * null and prints nothing on stdout.
 */
export function doneGate(meta, args, install, read = tailReader()) {
  try {
    const sub = meta.hook_event_name === 'SubagentStop';
    const cwd = typeof meta.cwd === 'string' && meta.cwd ? meta.cwd : process.cwd();
    const cwdRoot = gitRootOf(cwd);
    if (!sub && !cwdRoot) return null;
    const here = cwdRoot ? doneChecksOf(cwdRoot) : null;
    const listed = Boolean(here && here.blocking && here.checks.length);
    const file = sub ? meta.agent_transcript_path : meta.transcript_path;
    // Bob's Stop payload carries no transcript (learn's I2): nothing to judge, and a listed gate
    // says so. Inferred checks stay quiet there: every repo with a manifest would log it.
    if (args.host === 'bob' || typeof file !== 'string' || (sub && !file)) {
      if (listed) {
        err(sub ? '[done-gate] no agent transcript — sub-agent turn not judged.\n'
          : `[done-gate] no transcript${args.host === 'bob' ? ' (bob)' : ''} — turn not judged.\n`);
      }
      return null;
    }
    let turn;
    try {
      turn = read(file, (text, whole) => turnOf(text, whole, sub));
    } catch {
      // No ask tier on Stop: blocking on an unreadable transcript would trap the user.
      if (sub ? listed : here.checks.length) err('[done-gate] transcript unreadable — turn not judged.\n');
      return null;
    }
    const at = sub ? turn.cwd || cwd : cwd;
    const judged = (sub ? editRoots(turn, at) : [cwdRoot]).map((root) => {
      const d = root === cwdRoot ? here : doneChecksOf(root);
      return { root, ...d, missing: missingChecks(turn, d.checks, root, at), weakened: weakenedTests(turn, root, at) };
    });
    // One project names nothing; several say whose each entry is.
    const tag = (r) => (judged.length > 1 ? `${r.root}: ` : '');
    const list = (rs) => rs.flatMap((r) => r.missing.map((m) => `${tag(r)}${m}`)).join('; ');
    // `--no-test-note`: the line goes, the done checks do not.
    const weakened = args.noTestNote ? [] : judged.flatMap((r) => r.weakened.map((w) => `${tag(r)}${w}`));
    const owed = judged.filter((r) => r.blocking && r.missing.length);
    const inferred = judged.filter((r) => !r.blocking && r.missing.length);
    const who = sub ? 'this sub-agent' : 'this turn';
    // One JSON document on stdout, whatever the advisories: Stop reads no second one.
    const advise = (...said) => {
      if (weakened.length) {
        // A stable id, not a law number: an advisory is no hook-pinned rule (`HOOK_PINNED`).
        recordGate(install, ADVISORY_VERB, 'cure-the-cause');
        const line = `[done-gate] advisory — test weakened ${sub ? 'by a sub-agent' : 'this turn'}: ${weakened.join('; ')}`;
        err(`${line}\n`);
        said.push(`${line}. Cure the Cause: fix the code, not the test.`);
      }
      if (sub) return null;
      out(`${JSON.stringify({ systemMessage: said.join(' ') })}\n`);
      return 'advisory';
    };
    const inferredSaid = () => {
      if (!inferred.length) return [];
      recordGate(install, ADVISORY_VERB, 'law-3');
      err(`[done-gate] advisory${sub ? ' (sub-agent)' : ''} — unproven since the last edit: ${list(inferred)}\n`);
      const sources = [...new Set(inferred.map((r) => r.source))].join(', ');
      return [`Geneseed done gate (advisory) — ${who} edited files, and these checks `
        + `inferred from ${sources} have not passed since the last edit: ${list(inferred)}. `
        + `List your own in ${DONE_LIST} to make the gate block.`];
    };
    const settle = () => {
      const said = inferredSaid();
      return said.length || weakened.length ? advise(...said) : null;
    };
    if (!owed.length) return settle();
    if (meta.stop_hook_active === true) {
      recordGate(install, 'done-gate-cap', 'law-3');
      err(`[done-gate] cap reached — turn ends with unproven checks: ${list(owed)}\n`);
      return settle();
    }
    // The turn goes on, so a weakened test is said at the Stop that really ends it.
    recordGate(install, 'done-gate', 'law-3');
    out(`${JSON.stringify({
      decision: 'block',
      reason: `Geneseed (Verify Before Asserting) — ${who} edited files, and these `
        + `checks from ${DONE_LIST} have not passed since the last edit: ${list(owed)}. `
        + 'Run them unpiped, or say plainly that they were not run and why.',
    })}\n`);
    return 'block';
  } catch (e) {
    err(`[done-gate] skipped: ${e && e.message}\n`);
    return null;
  }
}
