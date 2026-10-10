/**
 * `learn` — the Stop/SubagentStop/PreCompact verb: distil notes or a transcript into deduped
 * memory entries through the model CLI `$GENESEED_LLM` names. THE ONE SPAWN in the hook entry's
 * closure; the store's file format it writes through lives in `./memory-files.mjs`, which does
 * not spawn and is what the CLI imports. See `js/hosts/hooks.mjs`'s header for the contract.
 */
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readText, printOut as out, printErr as err } from '../lib/fs.mjs';
import { toPlatformPath } from '../lib/paths.mjs';
import { NO_WINDOW } from '../lib/proc.mjs';
import {
  globalHookStandingDown, hookProjectDir, resolveMemoryDir, sovereignBypass,
} from './hosts.mjs';
import { readStdin, splitLines, splitWords } from './hooks-prims.mjs';
import {
  existingSlugs, writeMemories, consolidateMemory, appendAgentLesson,
} from './memory-files.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');

const AGENT_NAME_RE = /^[a-z][a-z0-9-]{1,40}$/;
const MAX_NOTES_CHARS = 16000;
// Host payloads name the finished subagent inconsistently; try each.
const SUBAGENT_NAME_FIELDS = ['agent_name', 'agent_type', 'subagent_type', 'agent',
  'agent_id'];

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

/** Render a Claude-Code-style JSONL transcript into `role: text` notes. */
function flattenTranscript(p) {
  let raw;
  try {
    // `errors="replace"`: Node's utf8 decoder already substitutes U+FFFD.
    raw = readText(p);
  } catch {
    return '';
  }
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
 * `_read_notes` — a lifecycle-hook payload with a `transcript_path` is read and flattened
 * (this is what makes wiring `learn` to a Stop hook work with no redirection); anything
 * else is used as-is. `meta` is that payload as `hookMeta` parsed it — passed in by
 * `cmdLearn`, which needs it again, so the raw text is parsed once.
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
export function readNotes(raw, meta = hookMeta(raw)) {
  if (!raw.trim()) return '';
  const tp = meta.transcript_path;
  return tp ? flattenTranscript(tp) : raw;
}

function buildLearnPrompt(notes, existing) {
  const parts = [learnPromptHead(), ''];
  if (existing.size) {
    parts.push('ALREADY STORED \u2014 do NOT emit a memory matching any of these '
      + 'slugs (skip updates too; only genuinely new facts):');
    parts.push(...[...existing].sort().map((slug) => `- ${slug}`));
    parts.push('');
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
 */
function runLlm(llm, prompt) {
  const argv = splitWords(llm);
  // `_harness_learn.py:85` runs this through the wrapped `run(..., capture_output=True)`,
  // which folds in `CREATE_NO_WINDOW`; a model CLI invoked from the windowless daemon
  // otherwise pops a console for as long as it takes to answer.
  //
  // `GENESEED_LEARN_CHILD=1` (Claude B2): `$GENESEED_LLM="claude -p"` with hooks not disabled
  // starts a child Claude session that loads this SAME install's Stop hook, which re-runs
  // `learn` — one recursion per nested session, stopped only by the host's 600 s timeout
  // killing the outermost call. The marker rides in the child's own environment (inherited by
  // every grandchild too), and `cmdLearn`'s first line stands down the instant it sees it.
  const proc = spawnSync(argv[0], [...argv.slice(1), prompt],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, GENESEED_LEARN_CHILD: '1' }, ...NO_WINDOW });
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
  let agent = null;
  for (const field of SUBAGENT_NAME_FIELDS) {
    agent = resolveAgentName(meta[field]);
    if (agent) break;
  }
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
      err(`[learn] agent lesson -> ${appendAgentLesson(memDir, agent, lesson)}\n`);
    }
  }
  if (proc.returncode !== 0 && proc.stderr) err(proc.stderr);
  return proc.returncode;
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
    const report = consolidateMemory(memDir);
    err(`[learn] consolidated ${memDir}: +${report.added.length} indexed, `
      + `-${report.pruned.length} pruned, `
      + `${report.duplicates.length} duplicate description(s)\n`);
    for (const [a, b] of report.duplicates) err(`  duplicate: ${a} <-> ${b}\n`);
    return 0;
  }

  // The Stop/SubagentStop hook always passes `--memory <cfg>/memory`; inside an excluded
  // folder the global install must not learn.
  if (args.memory && sovereignBypass(path.dirname(toPlatformPath(args.memory)))) return 0;
  // Same install root, and a project install of this host beside it learns on its own Stop: a
  // second LLM call, and the global store learning facts the project owns (Claude B4).
  if (args.memory && globalHookStandingDown(path.dirname(toPlatformPath(args.memory)),
    hookProjectDir(), args.host, 'learn')) return 0;

  const raw = args.file ? readText(args.file) : readStdin();
  const meta = hookMeta(raw);
  // A genuine lifecycle-hook call names its own event — `hook_event_name` (Claude/OpenClaude)
  // or `event` (Bob, whose docs give the Stop payload as `{"event":"Stop","session_id":...}`).
  // A MANUAL invocation (plain notes text, a `--file`, or a hand-typed JSON note such as
  // `{"foo": 1}` — `readNotes`'s own rule, kept for it below) carries neither and is unaffected
  // by either check in this block.
  const hookEvent = typeof meta.hook_event_name === 'string' ? meta.hook_event_name
    : (typeof meta.event === 'string' ? meta.event : null);

  // I2 (Bob): its Stop payload never carries `transcript_path`, so there is never a transcript
  // to distil — and the bare envelope itself is not notes text (that would waste a model call
  // on `{"event":"Stop","session_id":"s"}`). Scoped to `--host bob`: every other host's Stop/
  // PreCompact genuinely carries `transcript_path` (docs `hooks.md`), so a bare envelope there
  // is either a hand-typed note (no event field at all) or a bug upstream, neither of which this
  // should swallow. SubagentStop is excluded too — it legitimately has no `transcript_path`
  // (it carries `agent_transcript_path` instead, B10 — undone) and is routed below on the
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
  // so reading and flattening the transcript (up to 16 KB, every turn) just to print it nowhere
  // is pure waste. Checked BEFORE `readNotes`, which is what does that read. A manual
  // invocation keeps printing the prompt on an unset `$GENESEED_LLM` — that is the documented,
  // deliberate behaviour (docs/reference/env-context.md) for someone running `learn` by hand to
  // see what would have been sent, and `hookEvent` being unset is exactly what tells the two
  // apart.
  if (hookEvent && !process.env.GENESEED_LLM) {
    err('[learn] $GENESEED_LLM unset \u2014 nothing to distil.\n');
    return 0;
  }

  let notes = readNotes(raw, meta);
  if (!notes.trim()) {
    err('[learn] no notes or transcript content \u2014 nothing to distil.\n');
    return 0;
  }
  notes = tail(notes, MAX_NOTES_CHARS);   // keep the tail: most recent, most durable

  if (meta.hook_event_name === 'SubagentStop') return learnAgentLesson(meta, notes, args);

  const memDir = resolveMemoryDir(args.memory);
  const existing = memDir ? existingSlugs(memDir) : new Set();
  const prompt = buildLearnPrompt(notes, existing);

  const llm = process.env.GENESEED_LLM;
  if (!llm) {
    err('[learn] $GENESEED_LLM unset \u2014 printing prompt instead.\n\n');
    out(`${prompt}\n`);
    return 0;
  }

  const proc = runLlm(llm, prompt);
  const output = proc.stdout;
  if (memDir && output.trim() && output.trim().toUpperCase() !== 'NOTHING') {
    const written = writeMemories(output, memDir, existing);
    if (written.length) {
      err(`[learn] wrote ${written.length} memory file(s) to `
        + `${memDir}: ${written.join(', ')}\n`);
    } else {
      err('[learn] nothing new to store (all duplicates).\n');
    }
  } else {
    out(output);
  }
  if (proc.returncode !== 0 && proc.stderr) err(proc.stderr);
  return proc.returncode;
}
