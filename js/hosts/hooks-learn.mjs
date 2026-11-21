/**
 * `learn` — the Stop/SubagentStop/PreCompact/SessionEnd verb: distil notes or a transcript into
 * memory entries (a new fact, or an update or archive of a stored one) through the model CLI
 * `$GENESEED_LLM` names. THE MODEL SPAWN in the hook entry's closure (ADR 0002 names it and its
 * detached twin); the store's file format it writes through lives in `./memory-files.mjs`, which does
 * not spawn and is what the CLI imports. See `js/hosts/hooks.mjs`'s header for the contract.
 *
 * WHEN THE MODEL RUNS (spec 2026-11-18-learn-model-row, D8/D12). A turn's Stop and a sub-agent's
 * SubagentStop do their no-model work only (the spec-feedback copy, the done check, the change report,
 * the outcome line) and return: a model call after every reply was the cost the spec ruled out. The
 * distil runs on PreCompact and SessionEnd, once, in a DETACHED WORKER: a SessionEnd hook is killed
 * when the session ends (S1b), and a compaction must not wait 5-10 s for a model, so the hook writes a
 * small job file and starts `geneseed-hook learn-worker <job>` apart from itself (S1c). A sub-agent's
 * lesson is queued at its SubagentStop and distilled by that worker, so a session pays for one run.
 */
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { readText, isDir, printOut as out, printErr as err } from '../lib/fs.mjs';
import { toPlatformPath } from '../lib/paths.mjs';
import { NO_WINDOW, resolveCommand } from '../lib/proc.mjs';
import {
  GLOBAL_MANIFEST, globalHookStandingDown, hookProjectDir, isGlobalInstall, resolveMemoryDir, sovereignBypass,
} from './hosts.mjs';
import { sharedPaths } from '../lib/machine-dir.mjs';
import { readStdin, splitLines, splitWords, tailReader } from './hooks-prims.mjs';
import { doneGate } from './hooks-done.mjs';
import { recordOwnWrites, storeReport } from './store-watch.mjs';
import {
  existingSlugs, readFacts, writeMemories, consolidateMemory, appendAgentLesson, writeLearnLast,
} from './memory-files.mjs';
import { captureSpecFeedback, projectNotesDir, subagentReport, turnReply } from './spec-feedback.mjs';
import { gitRootOf } from './gitref.mjs';
import { pickStored, storedLine } from './memory-search.mjs';
import { learnCommandFor } from './learn-command.mjs';
import { recordAgentRun } from './agent-runs.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');

const AGENT_NAME_RE = /^[a-z][a-z0-9-]{1,40}$/;
const MAX_NOTES_CHARS = 16000;
const MIN_NOTES_CHARS = 200;   // below this, the new part of a session is too trivial to mine

// ---- learn cursor twin: BEGIN
/** Messages before the cursor that ride along as context, so the first new turn is not read cold. */
export const CONTEXT_MESSAGES = 2;

/**
 * Split a session's messages at its cursor (how many were already mined): `fresh` is what a distil mines, `context`
 * the last CONTEXT_MESSAGES before it, and `next` the cursor a successful distil moves to. A cursor that is not a
 * whole number inside the list (a compacted session now holds fewer messages than it did) starts over at 0.
 *
 * WHY: every distil re-read the last 16k of the whole session, so a 3-turn session was mined 3 times over turn 1
 * and a long one by each PreCompact and SessionEnd over the same text. Each region is now mined once.
 */
export function freshWindow(items, cursor) {
  const at = Number.isInteger(cursor) && cursor >= 0 && cursor <= items.length ? cursor : 0;
  return { context: items.slice(Math.max(0, at - CONTEXT_MESSAGES), at), fresh: items.slice(at), next: items.length };
}

/** The notes of a window: the context marked as not to be mined, then the new turns; no marks without context. */
export function windowNotes(contextText, freshText) {
  if (!contextText) return freshText;
  return `CONTEXT (earlier turns, already mined; read them to follow the new ones, never distil from them):\n${contextText}\n\nNEW TURNS (distil from these):\n${freshText}`;
}
// ---- learn cursor twin: END
// Host payloads name the finished subagent inconsistently. Never `agent_id`: it is one dispatch's
// id, so a lesson keyed on it is a file per dispatch that no later dispatch ever reads.
const SUBAGENT_NAME_FIELDS = ['agent_name', 'agent_type', 'subagent_type', 'agent'];

const PLUGIN_LEARN = path.join(ROOT, 'adapters', 'opencode', 'plugins', 'geneseed-learn.js');

/** `s[-n:]` in CODE POINTS. JS slices UTF-16 units and can cut a surrogate pair in half. */
function tail(s, n) {
  const cps = Array.from(s);
  return cps.length <= n ? s : cps.slice(-n).join('');
}

/**
 * `_load_learn_prompt_head` / `_load_agent_lesson_prompt`.
 *
 * The single source of truth for both prompts is the OpenCode plugin — the artifact that
 * ships to the primary runtime — and both CLIs extract the template literal from its
 * SOURCE rather than keeping a copy. Reading it means this port cannot drift from the
 * plugin either; a copied constant here would be a third place to edit.
 *
 * READ ON FIRST USE, ONCE. These were module-level constants, so every process that loaded
 * this code paid two reads of the 17 KB plugin and two regex scans before doing anything — and
 * until the verbs were split, that was every GATE call. A `--consolidate` run needs neither.
 */
let pluginSource = null;
function pluginLiteral(name, fallback) {
  if (pluginSource === null) {
    try {
      pluginSource = readText(PLUGIN_LEARN);
    } catch {
      pluginSource = '';  // an unreadable plugin must never crash a Stop hook
    }
  }
  const m = new RegExp(`const ${name} = \`([\\s\\S]*?)\``).exec(pluginSource);
  return m ? m[1] : fallback;
}

export const learnPromptHead = () => pluginLiteral('LEARN_PROMPT_HEAD',
  'Distil at most one durable, reusable memory from the notes below. '
  + 'When in doubt, output exactly: NOTHING.');
const agentLessonPrompt = () => pluginLiteral('AGENT_LESSON_PROMPT',
  'Output AT MOST ONE line: a durable lesson about how this agent should '
  + 'operate on a future dispatch. Else output exactly: NOTHING.');

/** `resolve_agent_name` — a safe agent slug from a raw field value, or null. */
export function resolveAgentName(raw) {
  const name = typeof raw === 'string' ? raw.trim().toLowerCase() : null;
  return name && AGENT_NAME_RE.test(name) ? name : null;
}

/**
 * The agent a SubagentStop payload names, as a safe slug, or null. The FIRST field present
 * decides, and a value that is no slug yields no lesson: a plugin's agent arrives namespaced
 * (`plug:rev`), and falling through to a later field would file its lesson under another name.
 * Exported for the unit tier, like `readNotes` below.
 */
export function subagentNameOf(meta) {
  const field = SUBAGENT_NAME_FIELDS.find((f) => meta[f] !== undefined && meta[f] !== null && meta[f] !== '');
  return field ? resolveAgentName(meta[field]) : null;
}

/** The lifecycle-hook payload if stdin is one, else `{}`. */
function hookMeta(raw) {
  const s = raw.trim();
  if (s.slice(0, 1) !== '{') return {};
  try { return JSON.parse(s); } catch { return {}; }
}
/** Flatten a message `content` field (string, or a list of blocks) to text. */
function contentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = [];
    for (const block of content) {
      if (typeof block === 'string') parts.push(block);
      else if (block && typeof block === 'object' && block.type === 'text') {
        parts.push(block.text === undefined ? '' : block.text);
      }
    }
    return parts.join('\n');
  }
  return '';
}

/**
 * Render a Claude-Code-style JSONL transcript into `role: text` notes, read from the END: the
 * window grows until its notes hold twice MAX_NOTES_CHARS UTF-16 units (so at least
 * MAX_NOTES_CHARS code points) or it is the whole file. The window's notes are a suffix of the
 * whole file's, so the tail `cmdLearn` keeps is the one a full read would give — and a tail of
 * tool output, which flattens to nothing, just reads further back.
 */
function flattenTranscript(p, read) {
  try {
    // `errors="replace"`: Node's utf8 decoder already substitutes U+FFFD.
    return read(p, (raw, whole) => {
      const flat = flattenText(raw);
      return whole || flat.length >= 2 * MAX_NOTES_CHARS ? flat : null;
    });
  } catch {
    return '';
  }
}

const flattenText = (raw) => flattenMessages(raw).join('\n\n');

/** A JSONL transcript as its `role: text` messages, one entry per message that has text. */
function flattenMessages(raw) {
  const acc = [];
  for (let line of splitLines(raw)) {
    line = line.trim();
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    const msg = obj.message || {};
    const role = msg.role || obj.role || obj.type;
    if (role !== 'user' && role !== 'assistant') continue;
    const text = contentText(msg.content === undefined ? obj.content : msg.content).trim();
    if (text) acc.push(`${role}: ${text}`);
  }
  return acc;
}

/**
 * `_read_notes` — a lifecycle-hook payload naming a transcript is read and flattened (this is
 * what makes wiring `learn` to a Stop hook work with no redirection); anything else is used
 * as-is. `meta` is that payload as `hookMeta` parsed it — passed in by `cmdLearn`, which needs
 * it again, so the raw text is parsed once.
 *
 * B10 (Claude verdict, host-compat-2026-10): on SubagentStop, `transcript_path` is the MAIN
 * session's transcript — the subagent's own turn lives in `agent_transcript_path` instead, in
 * a nested `subagents/` folder (docs `hooks.md`). Flattening the parent's file distils a lesson
 * about the wrong conversation, so the agent's own path wins whenever both are given; Stop/
 * PreCompact never send `agent_transcript_path`, so they fall through to `transcript_path`
 * unchanged.
 *
 * `last_assistant_message` (Stop and SubagentStop) is the host's own copy of the final turn. It
 * is never preferred over the transcript — `learn` distils from the whole exchange, and
 * `last_assistant_message` is Claude's reply alone, with the user's side of the turn gone, so
 * using it as the default would trade lesson quality for a read it does not need to save. It is
 * used in two cases only, both strictly additive: as the whole of `notes` when the transcript
 * file cannot be read at all (missing, or the host has not flushed it yet); and APPENDED when
 * the file DID read but the write lagged behind the live conversation enough to miss the final
 * turn (docs `hooks.md`) — detected by the flattened text not already ending in it, so a
 * transcript that already has the final turn never gets a duplicate.
 *
 * EXPORTED FOR THE UNIT TIER, and the rule this follows is written down once here for it and
 * for `./memory-files.mjs`'s `existingSlugs` and `writeMemories`.
 *
 * `docs/specs`'s P3 rule is: drive a property through the PUBLIC entry by default, and export a
 * decision only when the property is invisible through that face. The `learn` verb's WIRING is
 * already gated — 78 cells in the CLI matrix drive it end to end — so what a unit test would add
 * there is nothing. What no cell can see is these three functions' behaviour on inputs a cell
 * cannot produce: a model that answers NOTHING, a duplicate slug, a `README.md` beside the
 * store, a transcript payload that is not JSON. Those are decisions over text, and the corpus
 * reaches none of them.
 */
export function readNotes(raw, meta = hookMeta(raw), read = tailReader()) {
  if (!raw.trim()) return '';
  const tp = meta.agent_transcript_path || meta.transcript_path;
  if (!tp) return raw;
  const flat = flattenTranscript(tp, read);
  const lastMsg = typeof meta.last_assistant_message === 'string'
    ? meta.last_assistant_message.trim() : '';
  if (!flat) return lastMsg || flat;
  if (lastMsg && !flat.endsWith(lastMsg)) return `${flat}\n\nassistant: ${lastMsg}`;
  return flat;
}

/**
 * The prompt: the plugin's head, the stored facts as `slug — description` (so the model can
 * merge into one or archive it), the topics in use, then the notes.
 *
 * THE FACT LINES ARE CAPPED at MAX_STORED_CHARS. A store of hundreds of facts would otherwise
 * outgrow the notes, and the prompt rides on the model CLI's command line, which Windows caps
 * at 32 767 characters (16 000 of notes + the head + this stays under it). WHICH facts fit is
 * `pickStored`'s call: the newest ten, then the best matches for the notes. An alphabetical cut
 * showed 94 of 1 200 and hid the fact the previous distil had just written, so it was created again
 * (F12). A fact past the cap is only unlisted: `writeMemories` still refuses to create its slug and
 * skips a near-duplicate of it. The plugin's `buildPrompt` is the twin.
 */
const MAX_STORED_CHARS = 8000;
export function buildLearnPrompt(notes, facts) {
  const parts = [learnPromptHead(), ''];
  if (facts.size) {
    parts.push('ALREADY STORED — \'slug — description\', to update or archive, never to create:');
    const shown = pickStored(facts, notes, MAX_STORED_CHARS);
    for (const slug of shown) parts.push(storedLine(slug, facts.get(slug).desc));
    if (shown.length < facts.size) {
      parts.push(`(${facts.size - shown.length} more stored facts not shown: the newest and the closest to the notes are listed)`);
    }
    parts.push('', 'TOPICS IN USE:',
      [...new Set([...facts.values()].map((f) => f.topic))].sort().join(', '), '');
  }
  parts.push('NOTES:', notes);
  return parts.join('\n');
}

/**
 * The model CLI, run as `$GENESEED_LLM`'s words plus the prompt.
 *
 * `encoding="utf-8"` on the Python side and `'utf8'` here, never the console code page: a
 * distilled memory carrying an accent or an em dash is WRITTEN to the store, so a
 * mis-decode outlives the process. `maxBuffer` is lifted off Node's 1 MB default, which
 * would truncate a long reply into a silently-half-parsed set of memory files.
 *
 * BOUNDED: a model CLI that hangs (a login prompt, a dead network) used to hold Stop until the
 * host's own hook timeout killed the hook, and that kill loses whatever the hook had still to
 * say. `$GENESEED_LLM_TIMEOUT` is the limit in seconds, 120 unless it names a positive number.
 * A CLI stopped at the limit has said nothing usable, so its partial reply is dropped, never
 * parsed into half a memory file: one stderr line, and the run ends as if it answered nothing.
 */
const LLM_TIMEOUT_S = 120;
function llmTimeoutSeconds() {
  const n = Number(process.env.GENESEED_LLM_TIMEOUT);
  return Number.isFinite(n) && n > 0 ? n : LLM_TIMEOUT_S;
}

/**
 * The lean child (D13, S1e). A bare `claude -p` loads the user's whole harness (CLAUDE.md, hooks,
 * MCP servers: ~68k tokens, 8 s); with these flags it reads ~3k tokens and answers in 5 s, still on the
 * subscription login. `--bare` is NOT among them: it reads Anthropic auth from an API key only, and
 * the machine rule is subscription only. Appended only when the command's first word is `claude`, or
 * `openclaude` AND its own `--help` lists the flag (a flag it does not know would end the call in a usage
 * error). Any other command is used as given. A flag the user's command already names is left alone.
 *
 * ORDER MATTERS: `--tools` is variadic and would take the prompt as a tool name, so a flag follows it.
 */
const DISTIL_ROLE = 'You distil durable memories from notes. Follow the instructions in the user message '
  + 'exactly, and reply with only what they ask for.';
const LEAN_FLAGS = [
  ['--setting-sources', ''], ['--strict-mcp-config'], ['--tools', ''], ['--disable-slash-commands'],
  ['--no-session-persistence'], ['--system-prompt', DISTIL_ROLE],
];
const HELP_SECONDS = 20;
const helpCache = new Map();

/**
 * The command's name without its folder or Windows extension, lower case. `path.win32.basename` splits on `/`
 * AND `\`, so a Windows path names the same command on every platform (`path.basename` on POSIX kept
 * `C:\bin\Claude.EXE` whole and missed it).
 */
const binName = (word) => path.win32.basename(word).toLowerCase().replace(/[.](?:exe|cmd|bat)$/, '');

/** `<cli> --help`'s text, or '' when it will not run: the flags an `openclaude` of this machine knows. */
function helpOf(cli) {
  if (!helpCache.has(cli)) {
    const proc = runLlm(`${cli} --help`, null, { seconds: HELP_SECONDS, track: false });
    helpCache.set(cli, proc.returncode === 0 ? proc.stdout : '');
  }
  return helpCache.get(cli);
}

/** Whether `--help` text lists `flag` as a flag of its own, not as the tail of a longer one (`--append-system-prompt`). */
const listsFlag = (help, flag) => new RegExp(`(^|[\\s,\\[])${flag}(?=[\\s,=\\]<]|$)`, 'm').test(help);

/** Exported for the unit tier: `help` is the probe, so a test names the `--help` text it reads. */
export function leanArgv(argv, help = helpOf) {
  const bin = binName(argv[0] ?? '');
  if (bin !== 'claude' && bin !== 'openclaude') return argv;
  const known = bin === 'openclaude' ? help(argv[0]) : null;
  const lean = [...argv];
  for (const [flag, ...value] of LEAN_FLAGS) {
    if (argv.includes(flag) || (known !== null && !listsFlag(known, flag))) continue;
    lean.push(flag, ...value);
  }
  return lean;
}

/**
 * What to hand `spawnSync` for the words `words` and the prompt (F5) — pure, so a table states every row.
 *
 * Off Windows the OS resolves the word at spawn time and the words run as they are. On Windows a word that
 * resolves to nothing on PATH refuses the call (S-F4: CreateProcess would look in the current folder first). On Windows `CreateProcess` runs only `.exe`, so
 * an npm-installed CLI (`claude.cmd`) was "not found" and learning silently did nothing: the word is
 * resolved against PATH and PATHEXT (`resolveCommand`, which `doctor` shares), an `.exe` is run directly,
 * and a `.cmd`/`.bat` goes through `cmd.exe /d /s /c "<line>"` with every word double-quoted. THE PROMPT
 * NEVER RIDES THAT LINE: it goes over stdin, so the notes of a session (anything a person or a web page
 * typed) are never parsed by cmd.exe. What remains on the line is the command's own words and the fixed
 * lean flags, and a word cmd.exe could still read inside quotes (`"`, `%`, a line break, a trailing
 * backslash) refuses the call instead of being passed on.
 */
export function spawnPlan(words, prompt, { platform = process.platform, env = process.env, exists = undefined } = {}) {
  // The prompt goes over stdin for `claude` and `openclaude` on every path (`claude -p` reads it there; spec S1):
  // a Windows command line holds 32 767 characters, and a long session's notes overran it (ENOENT/E2BIG, silently).
  // Any other command keeps it as the last argument, which is what `$GENESEED_LLM="llm -m x"` and the CLI cells expect.
  const viaStdin = prompt !== null && ['claude', 'openclaude'].includes(binName(words[0] ?? ''));
  const direct = { file: words[0], args: [...words.slice(1), ...(prompt === null || viaStdin ? [] : [prompt])],
    input: viaStdin ? prompt : undefined, verbatim: false, refuse: null };
  if (platform !== 'win32') return direct;
  const found = resolveCommand(words[0], env, exists, platform);
  // Nothing on PATH: the bare word would be handed to CreateProcess, which looks in the CURRENT folder first, and a
  // `claude.exe` planted in a repository would then run at every session end. So nothing runs.
  if (!found) return { ...direct, refuse: `could not run ${words[0]}: not found on PATH - nothing learned` };
  if (!/[.](?:cmd|bat)$/i.test(found)) return { ...direct, file: found };
  const parts = [found, ...words.slice(1)];
  const bad = parts.find((a) => /["%\r\n\0]|[\\]$/.test(a));
  if (bad !== undefined) {
    return { ...direct, refuse: `${JSON.stringify(bad)} cannot be passed through cmd.exe safely - nothing learned` };
  }
  const shell = path.join(env.SystemRoot || env.windir || 'C:\\Windows', 'System32', 'cmd.exe');
  return { file: shell, args: ['/d', '/s', '/c', `"${parts.map((a) => `"${a}"`).join(' ')}"`],
    input: prompt === null ? undefined : prompt, verbatim: true, refuse: null };
}

/**
 * The run in flight (`runJob`): its first failure, and the facts it stored. null outside a run, so a manual
 * `learn` and the `--help` probe record nothing. `runJob` writes it to `learn-last.json` when it ends.
 */
let run = null;
function noteFail(reason) { if (run && !run.fail) run.fail = reason; }

/**
 * `prompt` null runs the words as they are (the `--help` probe above); a string is appended after the
 * lean flags. The ONE `spawnSync` call site of this module: the test that pins it reads this line.
 */
function runLlm(llm, prompt, { seconds = llmTimeoutSeconds(), track = true } = {}) {
  const argv = splitWords(llm);
  // `NO_WINDOW` folds in `CREATE_NO_WINDOW`; a model CLI invoked from the windowless daemon
  // otherwise pops a console for as long as it takes to answer.
  //
  // `GENESEED_LEARN_CHILD=1` (Claude B2): `$GENESEED_LLM="claude -p"` with hooks not disabled
  // starts a child Claude session that loads this SAME install's Stop hook, which re-runs
  // `learn` — one recursion per nested session, stopped only by the host's 600 s timeout
  // killing the outermost call. The marker rides in the child's own environment (inherited by
  // every grandchild too), and `cmdLearn`'s first line stands down the instant it sees it.
  const plan = spawnPlan(prompt === null ? argv : leanArgv(argv), prompt);
  if (plan.refuse) {
    if (track) noteFail(plan.refuse);
    return { stdout: '', stderr: `[learn] ${plan.refuse}\n`, returncode: 1, error: null };
  }
  // The answer goes to FILES, not pipes. On the Windows `.cmd` path the timeout kills cmd.exe but not the node the
  // shim started under it; that orphan keeps a pipe's write end open, and `spawnSync` waits for the pipe to close, so
  // a hung CLI held the wait for as long as it lived (measured: 15.7 s for a 2 s timeout). A file has no reader to
  // wait for: `spawnSync` returns when cmd.exe is gone. The prompt comes from a file for the same reason (an orphan
  // would hold a stdin pipe too).
  // The scratch folder holds the prompt (transcript text), so every exit, a throw included, removes it.
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'geneseed-learn-'));
  const outFile = path.join(scratch, 'out');
  const errFile = path.join(scratch, 'err');
  const inFile = path.join(scratch, 'in');
  const fds = [];
  const closeAll = () => { for (const fd of fds.splice(0)) { try { closeSync(fd); } catch { /* already closed */ } } };
  let proc;
  try {
    writeFileSync(inFile, plan.input ?? '');
    fds.push(openSync(inFile, 'r'), openSync(outFile, 'w'), openSync(errFile, 'w'));
    try {
      proc = spawnSync(plan.file, plan.args,
        { windowsVerbatimArguments: plan.verbatim, stdio: [...fds], timeout: seconds * 1000, killSignal: 'SIGKILL',
          env: { ...process.env, GENESEED_LEARN_CHILD: '1' }, ...NO_WINDOW });
    } finally {
      closeAll();
    }
    const slurp = (f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
    proc = { ...proc, stdout: slurp(outFile), stderr: slurp(errFile) };
  } finally {
    closeAll();
    try { rmSync(scratch, { recursive: true, force: true }); } catch { /* an orphan may still hold it open: the OS temp sweep gets it */ }
  }
  if (proc.error && /** @type {NodeJS.ErrnoException} */ (proc.error).code === 'ETIMEDOUT') {
    if (track) noteFail(`${argv[0]} gave no answer in ${seconds} s and was stopped`);
    err(`[learn] ${argv[0]} gave no answer in ${seconds} s and was stopped - nothing learned.\n`);
    return { stdout: '', stderr: '', returncode: 0, error: null };
  }
  // Universal newlines, because Python reads the pipe in TEXT mode: a model CLI that is
  // itself a Python script emits CRLF on Windows, `subprocess` folds it to `\n`, and
  // `write_text` expands it again on the way into the memory file. Node hands back the raw
  // bytes, so without this the stored fact is written with `\r\r\n` on every line.
  const universal = (s) => (s === null || s === undefined ? ''
    : String(s).replaceAll('\r\n', '\n').replaceAll('\r', '\n'));
  if (track && (proc.error || proc.status !== 0)) {
    const said = universal(proc.stderr).split('\n').find((l) => l.trim()) || '';
    noteFail(proc.error ? `could not run ${argv[0]}: ${proc.error.message}`
      : `${argv[0]} exited ${proc.status === null ? 'by signal' : proc.status}${said ? `: ${said.trim()}` : ''}`);
  }
  return {
    stdout: universal(proc.stdout),
    stderr: proc.error ? `[learn] could not run ${argv[0]}: ${proc.error.message}\n`
      : universal(proc.stderr),
    // A spawn that never started is Python's FileNotFoundError, which propagates there;
    // here it surfaces as a non-zero code with the reason on stderr rather than a stack.
    returncode: proc.error ? 1 : (proc.status === null ? 1 : proc.status),
    error: proc.error,
  };
}

/**
 * `_learn_agent_lesson` — at most one per-agent lesson into `memory/agents/<name>.md`, from the notes
 * of that agent's final turn. Run by the detached worker, once per queued agent (`runJob`).
 */
function learnAgentLesson(agent, notes, memDir, llm) {
  const prompt = [agentLessonPrompt(), '', 'NOTES:', notes].join('\n');
  const proc = runLlm(llm, prompt);
  // A model that failed (a lapsed login, a usage error) said nothing: what it printed is never a lesson.
  const text = proc.returncode === 0 ? proc.stdout.trim() : '';
  if (proc.returncode === 0 && !text) noteFail(`${splitWords(llm)[0]} returned an empty reply`);
  if (text && text.toUpperCase() !== 'NOTHING') {
    const lesson = splitLines(text)[0].replace(/^[-*]+/, '').trim();
    const n = Array.from(lesson).length;   // code points, as `len()` counts them
    if (n >= 10 && n <= 300) {
      const written = recordOwnWrites(path.dirname(memDir), () => appendAgentLesson(memDir, agent, lesson));
      if (written && run) run.facts += 1;
      err(written ? `[learn] agent lesson -> ${written}\n`
        : `[learn] ${agent}'s lesson file is not UTF-8 - left as it is, lesson dropped\n`);
    }
  }
  if (proc.returncode !== 0 && proc.stderr) err(proc.stderr);
}

/** `--memory` of a global install's hook, swapped for the shared store when that exists. */
function sharedStoreFor(install, args) {
  if (!install) return args.memory;
  try {
    const shared = sharedPaths().memory;
    return isDir(shared) && isGlobalInstall(args.host ?? null, install) ? shared : args.memory;
  } catch { return args.memory; }
}

/**
 * The two notes roots a line can go to (./spec-feedback.mjs `feedbackTargets`), as the render
 * names them: MACHINE is the tier's `notes/` (`{{PATH_NOTES}}`) for every host and install kind;
 * PROJECT is `<project>/notebook` (`{{PATH_PROJECT_NOTES}}`), one folder for every host.
 *
 * The project is the install's parent for a project install (`<repo>/.claude`, `.bob`,
 * `.openclaude`), and for a global install the git root of the session's project
 * (`hookProjectDir`); either way a linked worktree's main checkout, since a worktree and its notes
 * go when it is removed. A global session outside any repo (home, a temp folder) has no project:
 * its project lines are dropped, never sent to the machine notes, where every repo would read them.
 *
 * The machine notes need the tier's folder to exist; it does on any machine an emit has run on
 * (the install registry lives there), and only `notes/<sub>/` is ever created under it, never
 * `memory/`, whose presence is what `sharedStoreFor` reads as "the tier is seeded".
 */
export function notesRootsOf(install, host, payloadCwd) {
  if (!install) return { machine: null, project: null };
  let machine = null;
  try { machine = sharedPaths().notes; } catch { /* no home directory: no tier */ }
  let base = null;
  try {
    base = isGlobalInstall(host ?? null, install) ? gitRootOf(hookProjectDir(payloadCwd)) : path.dirname(install);
  } catch { base = null; }
  return { machine, project: projectNotesDir(base) };
}

/**
 * SubagentStop: the `spec-feedback:` lines of the sub-agent's final report into the notes its next
 * dispatch reads (./spec-feedback.mjs). Stop: the `[skill:<name>]` lines of the main session's
 * final reply into the notes that skill reads (`agent` null). Skill lines are checked against
 * `<install>/skills/`. No model, so `$GENESEED_LLM` does not gate it. Silent on stdout, which an
 * advisory verdict or the change report may hold, and a failure costs only the capture.
 */
function captureFeedback(agent, report, args, install, meta) {
  // Most replies hold no feedback line: then the two roots are never resolved (two fs walks).
  if (!/spec-feedback/i.test(report || '')) return;
  try {
    const skills = install ? path.join(install, 'skills') : null;
    const written = captureSpecFeedback(agent, report, notesRootsOf(install, args.host, meta.cwd), undefined, skills);
    if (written.length) err(`[learn] spec-feedback -> ${written.join(', ')}\n`);
  } catch { /* a note never fails the hook */ }
}

/**
 * SubagentStop: the report's feedback lines into the notes at every stop (`subagentFeedback`, a
 * blocked one included), then, past the done gate, the turn's line into the outcome ledger
 * (./agent-runs.mjs, `subagentEnded`), both off ONE read of the report. `done` is what
 * the gate can say through its return (that file's header): null when it did not run, 'not-judged'
 * when it had no transcript to judge, else 'ended'. Unnamed agents get neither. (Bob sends no
 * SubagentStop, so no Bob case reaches this.)
 */
function subagentFeedback(meta, args, read, install) {
  const agent = subagentNameOf(meta);
  if (!agent) return null;
  let report = '';
  try { report = subagentReport(meta, read); } catch { /* no report: nothing to capture */ }
  captureFeedback(agent, report, args, install, meta);
  return { agent, report };
}
function subagentEnded(meta, args, read, install, { agent, report }) {
  const ran = !args.file && !args.noDoneGate;
  const judged = typeof meta.agent_transcript_path === 'string' && meta.agent_transcript_path;
  recordAgentRun(install, agent, meta, { done: !ran ? null : judged ? 'ended' : 'not-judged', report, read });
}

export function cmdLearn(args) {
  // B2: stand straight down inside a model-CLI child `runLlm` just spawned (see its comment).
  // Checked before anything else — a child never gets as far as reading its own stdin, let
  // alone deciding whether there is a store to write to.
  if (process.env.GENESEED_LEARN_CHILD) return 0;

  if (args.consolidate) {
    const memDir = resolveMemoryDir(args.memory);
    if (!memDir) {
      err('[learn] no memory store found \u2014 nothing to consolidate.\n');
      return 0;
    }
    const report = recordOwnWrites(path.dirname(memDir), () => consolidateMemory(memDir));
    err(`[learn] consolidated ${memDir}: +${report.added.length} indexed, `
      + `-${report.pruned.length} pruned, `
      + `${report.duplicates.length} duplicate description(s)\n`);
    for (const [a, b] of report.duplicates) err(`  duplicate: ${a} <-> ${b}\n`);
    return 0;
  }

  // The Stop/SubagentStop hook always passes `--memory <cfg>/memory`; inside an excluded
  // folder the global install must not learn. The done gate's ledger lives in the same root.
  const install = args.memory ? path.dirname(toPlatformPath(args.memory)) : null;
  if (install && sovereignBypass(install)) return 0;
  // Same install root, and a project install of this host beside it learns on its own Stop: a
  // second LLM call, and the global store learning facts the project owns (Claude B4).
  if (install && globalHookStandingDown(install, hookProjectDir(), args.host, 'learn')) return 0;

  const raw = args.file ? readText(args.file) : readStdin();
  const meta = hookMeta(raw);
  // A genuine lifecycle-hook call names its own event — `hook_event_name` (Claude/OpenClaude)
  // or `event` (Bob, whose docs give the Stop payload as `{"event":"Stop","session_id":...}`).
  // A MANUAL invocation (plain notes text, a `--file`, or a hand-typed JSON note such as
  // `{"foo": 1}` — `readNotes`'s own rule, kept for it below) carries neither and is unaffected
  // by either check in this block.
  const hookEvent = typeof meta.hook_event_name === 'string' ? meta.hook_event_name
    : (typeof meta.event === 'string' ? meta.event : null);

  // A global install's hook passes its own host store; the shared store is where its facts live
  // once it exists, or they land in the seeded host store and wait for the next fold. Only a hook
  // call is redirected: it names its event or carries a transcript, and a person who typed
  // `--memory` meant that store. Empty stdin is neither, and has no notes to write anywhere.
  if (hookEvent || typeof meta.transcript_path === 'string') {
    args = { ...args, memory: sharedStoreFor(install, args) };
  }

  // The done gate (#289) judges the turn BEFORE anything here spawns, on Stop and on SubagentStop
  // (the sub-agent's own turn). A block means the turn goes on, so there is nothing to distil
  // yet, and no agent lesson either: the next Stop will.
  // `--no-done-gate` (the install switched Law III's gate off) skips the check, never the
  // distillation below.
  // One reader for this Stop: an allowed turn's distillation reuses the windows the gate read.
  const read = tailReader();
  // An advisory verdict already holds stdout: nothing below may print there after it.
  const verdict = (hookEvent === 'Stop' || hookEvent === 'SubagentStop') && !args.file && !args.noDoneGate
    ? doneGate(meta, args, install, read) : null;

  // The feedback lines are kept at EVERY stop, a blocked one included, model or none: the reply a
  // block sends back to work is the one that carries the line, and the reply that finally ends the
  // turn ("lint and suite green") does not repeat it, so capturing only after the block lost it for
  // good. Silent on stdout, so the verdict stays the one document there; a line seen again at the
  // next stop adds no note. A sub-agent's lines come from its report, a skill's `[skill:<name>]`
  // lines (it runs in the main context) from the turn's final reply.
  const sub = hookEvent === 'SubagentStop' ? subagentFeedback(meta, args, read, install) : null;
  if (hookEvent === 'Stop') {
    let reply = '';
    try { reply = turnReply(meta, read); } catch { /* no reply: nothing to capture */ }
    if (reply) captureFeedback(null, reply, args, install, meta);
  }
  if (verdict === 'block') return 0;

  // The sub-agent's turn is over: its outcome line is written. A blocked turn returned above, so a
  // ledger line is one finished turn.
  if (sub) subagentEnded(meta, args, read, install, sub);

  // The change report, at the turn's real end (./store-watch.mjs). One JSON document on stdout, so an
  // advisory already there keeps it, and Bob reads no stdout here at all: those go to stderr.
  if (hookEvent === 'Stop' && !args.file && install) {
    const said = storeReport(install, meta.session_id, {
      transcript: typeof meta.transcript_path === 'string' ? meta.transcript_path : null,
      cwd: meta.cwd, host: args.host || 'claude', ruleStore: !args.noRuleStore,
    });
    if (said && (verdict === 'advisory' || args.host === 'bob')) err(`[geneseed] ${said}\n`);
    else if (said) out(`${JSON.stringify({ systemMessage: said })}\n`);
  }

  // I2 (Bob): its Stop payload never carries `transcript_path`, so there is never a transcript
  // to distil — and the bare envelope itself is not notes text (that would waste a model call
  // on `{"event":"Stop","session_id":"s"}`). Scoped to `--host bob`: every other host's Stop/
  // PreCompact genuinely carries `transcript_path` (docs `hooks.md`), so a bare envelope there
  // is either a hand-typed note (no event field at all) or a bug upstream, neither of which this
  // should swallow. SubagentStop is excluded too — its own transcript is `agent_transcript_path`,
  // which `readNotes` now reads instead (B10), and it is routed below on the
  // agent-name fields alone. Kept rather than dropping Bob's Stop group (js/hosts/settings.mjs):
  // the group costs nothing once this returns immediately, and if Bob ever starts sending a
  // transcript, learning starts working there with no emit change.
  if (args.host === 'bob' && hookEvent && hookEvent !== 'SubagentStop' && !args.file
    && typeof meta.transcript_path !== 'string') {
    err('[learn] no transcript available (bob) \u2014 nothing to distil.\n');
    return 0;
  }

  // B3: a real hook call with `$GENESEED_LLM` unset has nothing to send a prompt to — stdout on
  // Stop/SubagentStop/PreCompact reaches only the debug log, never the user (docs `hooks.md`) —
  // so reading and flattening the transcript (a 2 MB tail or more) just to print it nowhere
  // is pure waste. A manual invocation keeps printing the prompt on an unset `$GENESEED_LLM` — that
  // is the documented, deliberate behaviour (docs/reference/env-context.md) for someone running
  // `learn` by hand to see what would have been sent, and `hookEvent` being unset is exactly what
  // tells the two apart.
  // O13: the user's `$GENESEED_LLM` wins (a custom CLI or model); else the command the emit's `--learn-model`
  // names on this host (js/hosts/learn-command.mjs); neither means learning is off for this install.
  const llm = process.env.GENESEED_LLM || learnCommandFor(args.host, args.learnModel);
  if (hookEvent && !llm) {
    err('[learn] no learn model (--learn off, and $GENESEED_LLM unset) — nothing to distil.\n');
    return 0;
  }

  // D8: the model runs at the end of a session or before a compaction, never after a turn. A Stop
  // has done its no-model work above; a sub-agent's stop queues its lesson for the session's one run.
  if (hookEvent === 'Stop') return 0;
  if (hookEvent === 'SubagentStop') {
    queueAgentLesson(meta, args, install);
    return 0;
  }
  if (hookEvent === 'PreCompact' || hookEvent === 'SessionEnd') {
    return startDistil(meta, args, install, hookEvent, llm);
  }
  // Any other event name is no moment this verb knows to learn at.
  if (hookEvent) return 0;

  // A person running `learn` by hand: notes on stdin, a file or a transcript, distilled now, and the
  // reply (or the prompt, with no model set) printed for them.
  let notes = readNotes(raw, meta, read);
  if (!notes.trim()) {
    err('[learn] no notes or transcript content — nothing to distil.\n');
    return 0;
  }
  notes = tail(notes, MAX_NOTES_CHARS);   // keep the tail: most recent, most durable
  return distil(notes, resolveMemoryDir(args.memory), llm, null);
}

/**
 * The distil itself: the prompt, the model CLI, and what it said into the store. `hookEvent` is the
 * event the worker runs for, or null for a person at a terminal. On a hook run stdout is the host's
 * and the model CLI's code is not the hook's (exit 2 would block a compaction), so it returns 0 and
 * speaks on stderr; a manual run keeps the model's code, so a script can test it.
 */
function distil(notes, memDir, llm, hookEvent) {
  const existing = memDir ? existingSlugs(memDir) : new Set();
  const prompt = buildLearnPrompt(notes, memDir ? readFacts(memDir) : new Map());
  if (!llm) {
    err('[learn] $GENESEED_LLM unset — printing prompt instead.\n\n');
    out(`${prompt}\n`);
    return 0;
  }

  const proc = runLlm(llm, prompt);
  // On a hook run a failed model said nothing (S1f: a lapsed login prints on stdout or stderr alike).
  const output = hookEvent && proc.returncode !== 0 ? '' : proc.stdout;
  const said = output.trim();
  // A zero exit with nothing said is a lapsed login or a swallowed error, never an answer: NOTHING is the answer.
  if (hookEvent && proc.returncode === 0 && !output.trim()) noteFail(`${splitWords(llm)[0]} returned an empty reply`);
  if (memDir && output.trim() && output.trim().toUpperCase() !== 'NOTHING') {
    const { created, updated, archived, skipped } = recordOwnWrites(path.dirname(memDir), () => writeMemories(output, memDir, existing));
    if (run) run.facts += created.length + updated.length;
    // Prose is no memory file: a model that answers "Please run /login" exited 0 and stored nothing. A reply with
    // a name: line that merely repeats stored facts is a duplicate, not a failure.
    if (hookEvent && !created.length && !updated.length && !archived.length && !/^name:\s*\S/m.test(output)) {
      noteFail(`unparseable reply: ${said.split(/\r?\n/)[0].slice(0, 80)}`);
    }
    if (created.length) {
      err(`[learn] wrote ${created.length} memory file(s) to `
        + `${memDir}: ${created.join(', ')}\n`);
    }
    if (updated.length) err(`[learn] updated ${updated.length} memory file(s): ${updated.join(', ')}\n`);
    if (archived.length) {
      err(`[learn] archived ${archived.length} memory file(s) to `
        + `${path.join(memDir, 'archive')}: ${archived.join(', ')}\n`);
    }
    for (const line of skipped) err(`[learn] ${line}\n`);
    if (!created.length && !updated.length && !archived.length) {
      err('[learn] nothing new to store (all duplicates).\n');
    }
  } else if (!hookEvent) {
    // A person running `learn` by hand with no store: the reply is what they asked to see.
    out(output);
  } else if (output.trim() && output.trim().toUpperCase() !== 'NOTHING') {
    // On a hook run stdout is the host's, so the model's words go to stderr; a bare NOTHING says
    // nothing and is dropped.
    err(output);
  }
  if (proc.returncode !== 0 && proc.stderr) err(proc.stderr);
  return hookEvent ? 0 : proc.returncode;
}

// ---- the job: what a hook hands the detached worker ------------------------------------------------

/**
 * Where the jobs and the queued lessons live: the machine tier's `cache/learn-jobs`, never an install's own
 * folder (a project install's folder is the user's repo, and holds nothing of ours that uninstall would not
 * take). A stale file there is swept after a week. null when the account has no home directory.
 */
const JOB_DIR = 'learn-jobs';
function jobDir() {
  try { return path.join(sharedPaths().root, 'cache', JOB_DIR); } catch { return null; }
}
const JOB_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
/** The most sub-agents one run asks a lesson of: each is one model call, and a session pays once. */
const MAX_LESSON_AGENTS = 3;
const MAX_QUEUED_LESSONS = 40;
const MAX_QUEUED_LINE_CHARS = 4000;
const MAX_QUEUED_REPLY_CHARS = 3000;
const sessionKey = (id) => (typeof id === 'string' && id ? id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) : 'nosession');

function sweepJobs(dir) {
  try {
    for (const name of readdirSync(dir)) {
      const file = path.join(dir, name);
      if (Date.now() - statSync(file).mtimeMs > JOB_MAX_AGE_MS) unlinkSync(file);
    }
  } catch { /* a sweep is a favour */ }
}

/**
 * SubagentStop: queue the finished sub-agent for the session's one run, no model. The agent's notes are
 * read later, by the worker, from the paths kept here (its own transcript, never the parent's: B10).
 */
function queueAgentLesson(meta, args, install) {
  const agent = subagentNameOf(meta);
  const dir = jobDir();
  if (!agent || !install || !dir) return;
  const payload = {};
  for (const k of ['agent_transcript_path', 'transcript_path', 'last_assistant_message']) {
    if (typeof meta[k] === 'string' && meta[k]) payload[k] = meta[k];
  }
  if (!payload.agent_transcript_path && !payload.transcript_path && !payload.last_assistant_message) return;
  // One queued line stays small (the tail of the report is what a lesson is about); a line still over the
  // cap, a path too long to be one, is dropped rather than written.
  if (payload.last_assistant_message) payload.last_assistant_message = tail(payload.last_assistant_message, MAX_QUEUED_REPLY_CHARS);
  const line = JSON.stringify({ agent, payload });
  if (line.length > MAX_QUEUED_LINE_CHARS) return;
  try {
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `agents-${sessionKey(meta.session_id)}.jsonl`);
    appendFileSync(file, `${line}\n`);
  } catch { /* a lesson is a favour, never a failed hook */ }
}

/**
 * The queued lessons of a session: the latest per agent, at most `MAX_LESSON_AGENTS`, and the queue's file. The
 * queue is NOT removed here: `startDistil` removes it once the job is written and started, so a failed write or
 * start leaves the lessons for the next PreCompact or SessionEnd.
 */
function readQueuedLessons(session) {
  const dir = jobDir();
  if (!dir) return { agents: [], file: null };
  const file = path.join(dir, `agents-${sessionKey(session)}.jsonl`);
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return { agents: [], file: null }; }
  const latest = new Map();
  for (const line of splitLines(text).slice(-MAX_QUEUED_LESSONS)) {
    try {
      const row = JSON.parse(line);
      if (typeof row.agent === 'string' && row.payload && typeof row.payload === 'object') latest.set(row.agent, row);
    } catch { /* a torn line is skipped */ }
  }
  return { agents: [...latest.values()].slice(-MAX_LESSON_AGENTS), file };
}

/**
 * PreCompact and SessionEnd: write the job, start the worker apart from this process, return at once
 * (D12, D14). Nothing here waits on the model, and nothing reads the transcript: a SessionEnd hook is
 * killed when its session ends (S1b), and a compaction must not wait. `GENESEED_LEARN_INLINE=1` runs the
 * same job in this process instead: for a test, or a person debugging the distil.
 */
function startDistil(meta, args, install, hookEvent, llm) {
  const transcript = typeof meta.transcript_path === 'string' && meta.transcript_path ? meta.transcript_path : null;
  const { agents, file: queue } = readQueuedLessons(meta.session_id);
  if (!transcript && !agents.length) return 0;
  const job = {
    v: 1, event: hookEvent, host: args.host || 'claude', memory: args.memory ?? null, transcript, agents,
    session: typeof meta.session_id === 'string' && meta.session_id ? meta.session_id : null,
  };
  const dropQueue = () => { if (queue) { try { unlinkSync(queue); } catch { /* the sweep gets it */ } } };
  const dir = jobDir();
  if (process.env.GENESEED_LEARN_INLINE) {
    runJob(job, llm);
    dropQueue();
    return 0;
  }
  // Never inline on a real hook event: it would hold the session on the model (D12). No folder to put the job
  // in, or no install to name its store: skip, say so, and let status and doctor say so too.
  if (!install || !dir) {
    const why = !install ? 'no Geneseed install found for this hook' : 'no machine cache folder';
    err(`[learn] ${why} - distil skipped.
`);
    writeLearnLast(false, `${why}; distil skipped`);
    return 0;
  }
  try {
    mkdirSync(dir, { recursive: true });
    sweepJobs(dir);
    const file = path.join(dir, `job-${Date.now()}-${process.pid}.json`);
    writeFileSync(file, `${JSON.stringify(job)}\n`);
    // The worker takes its model command from its OWN env, never from the job (ADR 0002: a job is data). A
    // command derived from `--learn-model` is put there for it to inherit; the spawn itself is unchanged.
    if (!process.env.GENESEED_LLM) process.env.GENESEED_LLM = llm;
    spawnWorker(file);
    dropQueue();
  } catch (e) {
    err(`[learn] could not start the distil worker: ${e instanceof Error ? e.message : e}\n`);
    writeLearnLast(false, `could not start the distil worker: ${e instanceof Error ? e.message : e}`);
  }
  return 0;
}

/**
 * THE SECOND SPAWN on the hook path (ADR 0002): this process's own node, running this checkout's hook
 * entry with one verb, detached and unref'd with no stdio, so it outlives the session's end (S1c). The
 * argv is fixed: no `$GENESEED_LLM` word, no payload text, reaches it but the job file's path.
 */
function spawnWorker(jobFile) {
  const child = spawn(process.execPath, [path.join(ROOT, 'bin', 'geneseed-hook.mjs'), 'learn-worker', jobFile],
    { detached: true, windowsHide: true, stdio: 'ignore' });
  child.on('error', (e) => { writeLearnLast(false, `could not start the distil worker: ${e.message}`); });
  child.unref();
}

/** The job's run: the transcript's distil, then each queued sub-agent's lesson. Always 0. */
function runJob(job, llm) {
  if (!job) return 0;
  if (typeof llm !== 'string' || !llm.trim()) {
    writeLearnLast(false, '$GENESEED_LLM is not set for the distil worker');
    return 0;
  }
  run = { fail: null, facts: 0 };
  // Marked running BEFORE the model is called, with the latest time the run may end (every call can take the
  // timeout): a hung CLI never reaches the line below, so this mark is what `status` finds.
  writeLearnLast(null, '', 0, { runningFor: (1 + MAX_LESSON_AGENTS) * llmTimeoutSeconds() + 60 });
  try { return runJobIn(job, llm); } finally {
    const { fail, facts } = run;
    run = null;
    writeLearnLast(!fail, fail || '', facts);
  }
}

/**
 * THE SESSION CURSOR (D5): how many of a session's messages a distil has already mined, kept per session in the
 * job folder (`cursor-<session>.json`, swept after a week with the jobs). PreCompact and SessionEnd each used to
 * re-read the last 16k of the same transcript; now each mines only what the other left. A missing or unreadable
 * file is cursor 0, which re-mines once: the cost of losing it is one repeated read, never a lost fact.
 */
function cursorFile(session) {
  const dir = jobDir();
  return dir ? path.join(dir, `cursor-${sessionKey(session)}.json`) : null;
}
function readCursor(session) {
  try {
    const n = JSON.parse(readFileSync(cursorFile(session), 'utf8')).n;
    return Number.isInteger(n) && n >= 0 ? n : 0;
  } catch { return 0; }
}
function writeCursor(session, n) {
  try {
    mkdirSync(jobDir(), { recursive: true });
    writeFileSync(cursorFile(session), `${JSON.stringify({ n })}\n`);
  } catch { /* a cursor is a favour: without it the next run re-mines */ }
}
const CONTEXT_CHARS = 2000;

/**
 * The transcript's distil for a session: only the messages past its cursor, with the last two before it as marked
 * context. New text under MIN_NOTES_CHARS is no distil and moves no cursor, so small turns pile up until they are
 * worth one. The cursor moves only after a distil that said something usable (`run.fail` unset): a failed model call
 * leaves the region to the next run. A job with no session id has no cursor and reads the tail, as before.
 */
function distilTranscript(job, memDir, llm) {
  const event = job.event || 'SessionEnd';
  const session = typeof job.session === 'string' && job.session ? job.session : null;
  if (!session) {
    const payload = { transcript_path: job.transcript };
    const notes = tail(readNotes(JSON.stringify(payload), payload), MAX_NOTES_CHARS);
    if (notes.trim()) distil(notes, memDir, llm, event);
    return;
  }
  let all = [];
  try { all = flattenMessages(readText(job.transcript)); } catch { /* an unreadable transcript has nothing new */ }
  const { context, fresh, next } = freshWindow(all, readCursor(session));
  const freshText = fresh.join('\n\n');
  if (freshText.length < MIN_NOTES_CHARS) return;
  const kept = tail(freshText, MAX_NOTES_CHARS);
  const notes = windowNotes(tail(context.join('\n\n'), CONTEXT_CHARS), kept);
  distil(notes, memDir, llm, event);
  if (!run?.fail) writeCursor(session, next);
}

function runJobIn(job, llm) {
  const memDir = typeof job.memory === 'string' ? resolveMemoryDir(job.memory) : null;
  try {
    if (typeof job.transcript === 'string' && job.transcript) distilTranscript(job, memDir, llm);
    for (const row of Array.isArray(job.agents) ? job.agents.slice(0, MAX_LESSON_AGENTS) : []) {
      const agent = resolveAgentName(row?.agent);
      if (!agent || !memDir || !row.payload) continue;
      const notes = tail(readNotes(JSON.stringify(row.payload), row.payload), MAX_NOTES_CHARS);
      if (notes.trim()) learnAgentLesson(agent, notes, memDir, llm);
    }
  } catch (e) {
    err(`[learn] the distil stopped: ${e instanceof Error ? e.message : e}\n`);
    noteFail(`the distil stopped: ${e instanceof Error ? e.message : e}`);
  }
  return 0;
}

/** `a` and `b` name one folder, symlinks and Windows short names resolved; false when either cannot be resolved. */
function sameDir(a, b) {
  try { return realpathSync.native(a) === realpathSync.native(b); } catch { return false; }
}

/**
 * Whether `memory` is a store a job may write: the machine tier's `memory/`, or the `memory/` of a Geneseed
 * install (its folder holds the install's manifest). A job names a write target, so it never names an arbitrary one.
 */
function allowedMemory(memory) {
  try {
    // The path as the hook was given it: an install's `memory/` may be a junction or a symlink to a folder of another
    // name, and its name and manifest are those of the install, not of where it points. The real path is for the
    // machine-tier comparison only.
    const abs = path.resolve(memory);
    if (path.basename(abs) !== 'memory' || !isDir(abs)) return false;
    if (sameDir(abs, sharedPaths().memory)) return true;
    return existsSync(path.join(path.dirname(abs), GLOBAL_MANIFEST));
  } catch { return false; }
}

/**
 * `learn-worker <job>` — the detached process's verb: run the job file a hook wrote, then delete it.
 * Nothing it prints is read (stdio is ignored), and nothing here exits non-zero: no host waits on it.
 *
 * A JOB IS DATA, NEVER A COMMAND. The path arrives on an argv an agent could be talked into running, and a
 * repository can ship a file of that name, so three things hold: the file sits in the machine cache's own
 * learn-jobs folder (its real path equals `jobDir()`'s, so a folder merely NAMED learn-jobs does not count);
 * the model command is this process's own `$GENESEED_LLM`, inherited from the hook that started it, and a job
 * holds none; and the store it names is the machine tier's memory or an install's. A file outside that folder
 * or not named job-*.json is left exactly as it is; a job inside it that names a foreign store is deleted without being run.
 */
export function cmdLearnWorker(args) {
  if (process.env.GENESEED_LEARN_CHILD || !args.file) return 0;
  const file = path.resolve(args.file);
  const dir = jobDir();
  if (!dir || !sameDir(path.dirname(file), dir) || !/^job-[\w.-]+\.json$/.test(path.basename(file))) return 0;
  try {
    const job = JSON.parse(readFileSync(file, 'utf8'));
    if (!job || typeof job.memory !== 'string' || !allowedMemory(job.memory)) {
      err('[learn] the job names no memory store of ours - refused.\n');
      writeLearnLast(false, 'the job names no memory store of ours - refused');
    } else {
      runJob(job, process.env.GENESEED_LLM);
    }
  } catch (e) {
    // An unreadable job is no job, but the last verdict must not go on saying the run before it was fine.
    writeLearnLast(false, `the job could not be read: ${e instanceof Error ? e.message : e}`);
  } finally {
    try { if (existsSync(file)) unlinkSync(file); } catch { /* the sweep gets it */ }
  }
  return 0;
}
