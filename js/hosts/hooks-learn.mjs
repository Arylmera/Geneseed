/**
 * `learn` — the Stop/SubagentStop/PreCompact verb: distil notes or a transcript into memory
 * entries (a new fact, or an update or archive of a stored one) through the model CLI
 * `$GENESEED_LLM` names. THE ONE SPAWN in the hook entry's closure; the store's file format it writes through lives in `./memory-files.mjs`, which does
 * not spawn and is what the CLI imports. See `js/hosts/hooks.mjs`'s header for the contract.
 */
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readText, isDir, printOut as out, printErr as err } from '../lib/fs.mjs';
import { toPlatformPath } from '../lib/paths.mjs';
import { NO_WINDOW } from '../lib/proc.mjs';
import {
  globalHookStandingDown, hookProjectDir, isGlobalInstall, resolveMemoryDir, sovereignBypass,
} from './hosts.mjs';
import { sharedPaths } from '../lib/machine-dir.mjs';
import { readStdin, splitLines, splitWords, tailReader } from './hooks-prims.mjs';
import { doneGate } from './hooks-done.mjs';
import { recordOwnWrites, storeReport } from './store-watch.mjs';
import {
  existingSlugs, readFacts, writeMemories, consolidateMemory, appendAgentLesson,
} from './memory-files.mjs';
import { captureSpecFeedback, subagentReport } from './spec-feedback.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');

const AGENT_NAME_RE = /^[a-z][a-z0-9-]{1,40}$/;
const MAX_NOTES_CHARS = 16000;
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

function flattenText(raw) {
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
  return acc.join('\n\n');
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
 * The prompt: the plugin's head, the stored facts as `slug \u2014 description` (so the model can
 * merge into one or archive it), the topics in use, then the notes.
 *
 * THE FACT LINES ARE CAPPED at MAX_STORED_CHARS. A store of hundreds of facts would otherwise
 * outgrow the notes, and the prompt rides on the model CLI's command line, which Windows caps
 * at 32 767 characters (16 000 of notes + the head + this stays under it). A fact past the
 * cap is only unlisted: `writeMemories` still refuses to create its slug. The plugin's
 * `buildPrompt` is the twin.
 */
const MAX_STORED_CHARS = 8000;
export function buildLearnPrompt(notes, facts) {
  const parts = [learnPromptHead(), ''];
  if (facts.size) {
    parts.push('ALREADY STORED \u2014 \'slug \u2014 description\', to update or archive, never to create:');
    let used = 0;
    let shown = 0;
    for (const [slug, { desc }] of facts) {
      const line = desc ? `- ${slug} \u2014 ${desc}` : `- ${slug}`;
      if (used + line.length > MAX_STORED_CHARS) break;
      parts.push(line);
      used += line.length + 1;
      shown += 1;
    }
    if (shown < facts.size) parts.push(`(${facts.size - shown} more stored facts not shown)`);
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

function runLlm(llm, prompt) {
  const argv = splitWords(llm);
  const seconds = llmTimeoutSeconds();
  // `NO_WINDOW` folds in `CREATE_NO_WINDOW`; a model CLI invoked from the windowless daemon
  // otherwise pops a console for as long as it takes to answer.
  //
  // `GENESEED_LEARN_CHILD=1` (Claude B2): `$GENESEED_LLM="claude -p"` with hooks not disabled
  // starts a child Claude session that loads this SAME install's Stop hook, which re-runs
  // `learn` — one recursion per nested session, stopped only by the host's 600 s timeout
  // killing the outermost call. The marker rides in the child's own environment (inherited by
  // every grandchild too), and `cmdLearn`'s first line stands down the instant it sees it.
  const proc = spawnSync(argv[0], [...argv.slice(1), prompt],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: seconds * 1000, killSignal: 'SIGKILL',
      env: { ...process.env, GENESEED_LEARN_CHILD: '1' }, ...NO_WINDOW });
  if (proc.error && /** @type {NodeJS.ErrnoException} */ (proc.error).code === 'ETIMEDOUT') {
    err(`[learn] ${argv[0]} gave no answer in ${seconds} s and was stopped - nothing learned.\n`);
    return { stdout: '', stderr: '', returncode: 0, error: null };
  }
  // Universal newlines, because Python reads the pipe in TEXT mode: a model CLI that is
  // itself a Python script emits CRLF on Windows, `subprocess` folds it to `\n`, and
  // `write_text` expands it again on the way into the memory file. Node hands back the raw
  // bytes, so without this the stored fact is written with `\r\r\n` on every line.
  const universal = (s) => (s === null || s === undefined ? ''
    : String(s).replaceAll('\r\n', '\n').replaceAll('\r', '\n'));
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
 * `_learn_agent_lesson` — the SubagentStop path: at most one per-agent lesson into
 * `memory/agents/<name>.md`. Skips silently when the host does not name the subagent:
 * parity of mechanism, degrading to a no-op, never a crash.
 */
function learnAgentLesson(meta, notes, args) {
  const agent = subagentNameOf(meta);
  if (!agent) return 0;
  const memDir = resolveMemoryDir(args.memory);
  if (!memDir) return 0;
  const prompt = [agentLessonPrompt(), '', 'NOTES:', notes].join('\n');
  const llm = process.env.GENESEED_LLM;
  // Unreachable through the hook path: `cmdLearn` already returned above when `$GENESEED_LLM`
  // was unset, because a SubagentStop payload always names its own event. Left in as the same
  // defensive no-op `resolveMemoryDir`'s check above is, should this ever be called directly.
  if (!llm) {
    err('[learn] $GENESEED_LLM unset \u2014 printing agent-lesson prompt.\n\n');
    out(`${prompt}\n`);
    return 0;
  }
  const proc = runLlm(llm, prompt);
  const text = proc.stdout.trim();
  if (text && text.toUpperCase() !== 'NOTHING') {
    const lesson = splitLines(text)[0].replace(/^[-*]+/, '').trim();
    const n = Array.from(lesson).length;   // code points, as `len()` counts them
    if (n >= 10 && n <= 300) {
      const written = recordOwnWrites(path.dirname(memDir), () => appendAgentLesson(memDir, agent, lesson));
      err(written ? `[learn] agent lesson -> ${written}\n`
        : `[learn] ${agent}'s lesson file is not UTF-8 - left as it is, lesson dropped\n`);
    }
  }
  if (proc.returncode !== 0 && proc.stderr) err(proc.stderr);
  // Only a SubagentStop hook reaches this, and the model CLI's code is not the hook's: exit 2
  // there sends the subagent back to work. The failure is on stderr above.
  return 0;
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
 * The notes root an install's agents read, `PATH_NOTES` as the render spells it: the tier's
 * `notes/` when `--memory` (after `sharedStoreFor`) is the shared store, else `<install>/notebook`,
 * the folder the fold copies from (js/build/fold.mjs `foldNotes`). So a global install whose tier
 * is not seeded yet keeps its notes beside its own store until the next fold, as its facts wait.
 *
 * `notebook` IS ASSUMED, NOT DERIVED: the render's `DIR_NOTEBOOK` (js/build/render.mjs STRUCTURE)
 * defaults to it, no theme overrides it, and the fold reads the same literal. Deriving it would mean
 * loading the build's render module on every SubagentStop; if a theme ever renames the notebook,
 * this line and `foldNotes` move together.
 */
export function notesRootOf(memory) {
  if (!memory) return null;
  const mem = path.resolve(toPlatformPath(memory));
  try {
    const shared = sharedPaths();
    if (mem === path.resolve(shared.memory)) return shared.notes;
  } catch { /* no home directory: no tier */ }
  return path.join(path.dirname(mem), 'notebook');
}

/**
 * SubagentStop: the `spec-feedback:` lines of the sub-agent's final report into the notes its next
 * dispatch reads (./spec-feedback.mjs). No model, so `$GENESEED_LLM` does not gate it. Silent on
 * stdout, which an advisory verdict may already hold, and a failure costs only the capture.
 */
function captureFeedback(meta, args, read) {
  try {
    const agent = subagentNameOf(meta);
    if (!agent) return;
    const written = captureSpecFeedback(agent, subagentReport(meta, read), notesRootOf(args.memory));
    if (written.length) err(`[learn] spec-feedback -> ${written.join(', ')}\n`);
  } catch { /* a note never fails the hook */ }
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
  if (verdict === 'block') return 0;

  // The sub-agent's turn is over: its report's feedback lines are kept now, model or none. A
  // blocked turn returned above, and the re-run of a turn that is captured twice adds nothing.
  if (hookEvent === 'SubagentStop') captureFeedback(meta, args, read);

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
  // so reading and flattening the transcript (a 2 MB tail or more, every turn) just to print it nowhere
  // is pure waste. Checked BEFORE `readNotes`, which is what does that read. A manual
  // invocation keeps printing the prompt on an unset `$GENESEED_LLM` — that is the documented,
  // deliberate behaviour (docs/reference/env-context.md) for someone running `learn` by hand to
  // see what would have been sent, and `hookEvent` being unset is exactly what tells the two
  // apart.
  if (hookEvent && !process.env.GENESEED_LLM) {
    err('[learn] $GENESEED_LLM unset \u2014 nothing to distil.\n');
    return 0;
  }

  let notes = readNotes(raw, meta, read);
  if (!notes.trim()) {
    err('[learn] no notes or transcript content \u2014 nothing to distil.\n');
    return 0;
  }
  notes = tail(notes, MAX_NOTES_CHARS);   // keep the tail: most recent, most durable

  if (meta.hook_event_name === 'SubagentStop') return learnAgentLesson(meta, notes, args);

  const memDir = resolveMemoryDir(args.memory);
  const existing = memDir ? existingSlugs(memDir) : new Set();
  const prompt = buildLearnPrompt(notes, memDir ? readFacts(memDir) : new Map());

  const llm = process.env.GENESEED_LLM;
  if (!llm) {
    err('[learn] $GENESEED_LLM unset \u2014 printing prompt instead.\n\n');
    out(`${prompt}\n`);
    return 0;
  }

  const proc = runLlm(llm, prompt);
  const output = proc.stdout;
  if (memDir && output.trim() && output.trim().toUpperCase() !== 'NOTHING') {
    const { created, updated, archived } = recordOwnWrites(path.dirname(memDir), () => writeMemories(output, memDir, existing));
    if (created.length) {
      err(`[learn] wrote ${created.length} memory file(s) to `
        + `${memDir}: ${created.join(', ')}\n`);
    }
    if (updated.length) err(`[learn] updated ${updated.length} memory file(s): ${updated.join(', ')}\n`);
    if (archived.length) {
      err(`[learn] archived ${archived.length} memory file(s) to `
        + `${path.join(memDir, 'archive')}: ${archived.join(', ')}\n`);
    }
    if (!created.length && !updated.length && !archived.length) {
      err('[learn] nothing new to store (all duplicates).\n');
    }
  } else if (!hookEvent) {
    // A person running `learn` by hand with no store: the reply is what they asked to see.
    out(output);
  } else if (output.trim() && output.trim().toUpperCase() !== 'NOTHING') {
    // On a hook call stdout is the host's: it holds at most ONE JSON document (the change report
    // or an advisory above), and the model's raw words after it made two, which no host parses,
    // so the report was lost. A bare NOTHING says nothing and is dropped.
    err(output);
  }
  if (proc.returncode !== 0 && proc.stderr) err(proc.stderr);
  // On a hook call the model CLI's code is not this hook's: exit 2 on Stop or PreCompact blocks
  // the turn's end or the compaction, and any non-zero drops the JSON already on stdout. The
  // failure is on stderr above. A manual run keeps the code, so a script can test it.
  return hookEvent ? 0 : proc.returncode;
}
