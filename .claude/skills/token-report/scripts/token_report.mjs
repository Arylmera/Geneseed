#!/usr/bin/env node
/**
 * Generate a token usage report for the current agent session — multi-host.
 *
 * Supported hosts (auto-detected by most recent session activity):
 *
 *   claude    Claude Code      ~/.claude/projects/<slug>/<session>.jsonl   exact usage
 *   bob       IBM Bob          ~/.bob/projects/<slug>/<session>.jsonl      exact usage
 *                              (Claude-Code-shaped; $BOB_CONFIG_DIR honoured)
 *   opencode  OpenCode         ~/.local/share/opencode/opencode.db         exact usage
 *                              (SQLite, v1.2+: session/message/part tables,
 *                              JSON `data` columns; falls back to the pre-1.2
 *                              storage/ JSON files when no DB exists)
 *   copilot   GitHub Copilot   ~/.copilot/history-session-state/           best effort
 *                              (schema undocumented; token fields harvested
 *                              generically, estimates otherwise)
 *
 * The report distinguishes two kinds of numbers:
 *
 *   * exact      — recorded by the host per request (API usage fields)
 *   * estimated  — attribution of content by character count (~4 chars/token)
 *
 * Estimates are labeled as such and never presented as exact.
 *
 * ---------------------------------------------------------------------------------------
 * WHY THIS FILE CARRIES ITS OWN PYTHON PRIMITIVES
 *
 * It is the port of `token_report.py`, and it is the one piece of the port that ships
 * INSIDE a user's bundle: a rendered install contains
 * `<skills>/token-report/scripts/token_report.mjs` and no `js/` directory whatsoever
 * (measured — an emit snapshot's path list has 102 entries and not one begins `js/`). So
 * it cannot import `js/lib/pyfs.mjs`, where this repository settles Python-vs-JS
 * disagreements once. The primitives below are therefore deliberate COPIES, each naming
 * its origin, and `tests/token_report_primitives.test.mjs` imports both this file and
 * `pyfs.mjs` and asserts they agree over a corpus — so the duplication cannot drift
 * silently, which is the only real objection to it.
 *
 * Behaviour is gated by `tests/test_token_report_parity.py`, which drives this file and
 * `token_report.py` over seeded transcripts for all four hosts and compares raw stdout
 * bytes. That corpus was written BEFORE this file existed and is the only behavioural
 * coverage the script has ever had.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { EOL, homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const CHARS_PER_TOKEN = 4.0;
const USAGE_FIELDS = ['input_tokens', 'output_tokens',
  'cache_read_input_tokens', 'cache_creation_input_tokens'];

// ---------------------------------------------------------------------------
// Python primitives (copies — see the file docblock)
// ---------------------------------------------------------------------------

/** `print()` — `sys.stdout` translates `\n` to `os.linesep`; `process.stdout` does not. */
const xlate = (s) => (EOL === '\n' ? s : s.replaceAll('\n', EOL));
const pyPrint = (s) => process.stdout.write(xlate(`${s}\n`));

/** `sys.exit(msg)` — the message goes to stderr and the status is 1. */
function sysExit(msg) {
  process.stderr.write(xlate(`${msg}\n`));
  process.exit(1);
}

/**
 * `len(str)` — Python counts CODE POINTS, `String.length` counts UTF-16 units.
 *
 * Every character count in this file feeds an estimate, and a transcript full of emoji
 * or astral CJK would inflate every one of them by the number of surrogate pairs. The
 * loop is written out rather than `[...s].length` (which is what `pyfs.pyLen` uses)
 * because the strings here are whole tool results and can be megabytes: the spread
 * allocates an array of one string per character, and this does not allocate at all.
 */
function pyLen(s) {
  let n = s.length;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c < 0xdc00 && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n -= 1;
      i += 1;
    }
  }
  return n;
}

/**
 * `round()` — Python rounds HALF TO EVEN and `Math.round` rounds half UP.
 *
 * Copy of `js/tui.mjs`'s `pyRound`. This is not an exotic corner here: `est_tokens` is
 * `round(chars / 4.0)`, so EVERY character count congruent to 2 mod 4 lands exactly on
 * `.5` — a quarter of all possible inputs. `Math.round` would move a quarter of the rows
 * in every report.
 */
function pyRound(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/**
 * `f"{x:.Nf}"` — the same half-to-even rule, in the FORMATTER rather than in `round()`.
 *
 * `Number.prototype.toFixed` is specified to break ties toward the LARGER n, so
 * `(0.5).toFixed(0)` is "1" where `f"{0.5:.0f}"` is "0", and `(6.25).toFixed(1)` is
 * "6.3" where `f"{6.25:.1f}"` is "6.2".
 *
 * THE FIRST DRAFT OF THIS FILE USED `toFixed(1)` FOR `pct`, ON A WRITTEN PROOF THAT NO
 * TIE COULD EXIST: a tie needs a double exactly equal to (2k+1)/20, and 20 is not a
 * power of two. The proof is WRONG — the fraction reduces whenever (2k+1) is a multiple
 * of five, so every odd multiple of 0.25 is an exact tie and every one of them is
 * dyadic. `tests/test_token_report_parity.py` produced 6.25 from a four-character row in
 * a sixty-four-character total on the first run that reached it. The argument was
 * confident, self-consistent and false; the corpus was neither.
 *
 * AND THE SECOND DRAFT WAS WRONG TOO, in the other direction: it scaled by `10 **
 * digits` and reused `pyRound`. Scaling is not information-preserving. 5100/200000 is
 * 2.55%, which is NOT dyadic, so the double sits a hair BELOW the tie and Python
 * correctly answers "2.5" — but multiplying that double by ten lands exactly on the
 * midpoint between 25.5 and its neighbour, rounds to 25.5, and manufactures a tie that
 * the real value never had. Answer: "2.6". The corpus caught this one as well.
 *
 * So the rounding is done on the EXACT DECIMAL. `toFixed` is specified to pick the n
 * minimising |n/10^f - x| — correct rounding of the double's true value — and the kept
 * digits are then rounded half-to-even as DECIMAL text, where a tie is a literal "5
 * followed by nothing".
 *
 * TWENTY places, not `digits + 15`. The third draft used the latter and the primitive
 * corpus refuted it on its first run: 0.05, 0.15 and 0.35 are all NON-ties (their
 * doubles miss the midpoint at the 17th decimal), but sixteen places cannot see that
 * far, so each looked like an exact tie and two of the three rounded the wrong way. A
 * double of magnitude >= 0.01 has an ULP no smaller than ~1.7e-18, so twenty places
 * resolve every value this script can form, and anything smaller rounds to zero at one
 * decimal regardless.
 */
function pyFixed(x, digits) {
  const neg = x < 0 || Object.is(x, -0);
  // `toFixed` switches to exponential notation at 1e21 and the digit surgery below
  // needs positional text. Nothing here reaches it; the guard is so that it degrades
  // rather than returns nonsense if something ever does.
  if (!Number.isFinite(x) || Math.abs(x) >= 1e21) return Math.abs(x).toFixed(digits);
  const exact = Math.abs(x).toFixed(20);
  const dot = exact.indexOf('.');
  const frac = exact.slice(dot + 1);
  const rest = frac.slice(digits);
  let n = BigInt(exact.slice(0, dot) + frac.slice(0, digits));
  const first = rest.charCodeAt(0) - 48;
  const restNonZero = /[1-9]/.test(rest.slice(1));
  if (first > 5 || (first === 5 && restNonZero)) n += 1n;
  else if (first === 5 && !restNonZero && n % 2n === 1n) n += 1n;   // half to EVEN
  const s = n.toString().padStart(digits + 1, '0');
  const body = digits === 0 ? s : `${s.slice(0, -digits)}.${s.slice(-digits)}`;
  return (neg ? '-' : '') + body;
}

/** `f"{n:,}"` — round half to even, then group the integer part in threes. */
function fmt(n) {
  return String(pyRound(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** `json.dumps`'s `ensure_ascii=True`: everything from U+007F up, per UTF-16 unit. */
function escapeNonAscii(text) {
  // Built from escapes, never literals: the low end of this range is U+007F (DEL), and
  // a raw control character sitting in a shipped source file is invisible in review and
  // the first thing a well-meaning sanitiser strips.
  return text.replace(new RegExp('[\\u007f-\\uffff]', 'g'),
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** `repr(float)` — copy of `pyfs.pyFloat`, for the one branch `jsonDumps` can reach. */
function pyFloat(n) {
  if (Number.isNaN(n)) return 'NaN';
  if (!Number.isFinite(n)) return n > 0 ? 'Infinity' : '-Infinity';
  const a = Math.abs(n);
  if (a !== 0 && (a >= 1e16 || a < 1e-4)) {
    const [mantissa, exp] = n.toExponential().split('e');
    return `${mantissa}e${exp[0] === '-' ? '-' : '+'}${exp.slice(1).padStart(2, '0')}`;
  }
  const s = Object.is(n, -0) ? '-0' : String(n);
  return s.includes('.') || s.includes('e') ? s : `${s}.0`;
}

/**
 * `json.dumps(obj)` — the COMPACT form, which is the only one this script uses.
 *
 * Copy of `pyfs.jsonDumpsCompact`'s walk, narrowed to values that came out of
 * `JSON.parse`. `JSON.stringify` cannot stand in: without an indent Python's separators
 * are `(', ', ': ')`, so `{"a": 1, "b": [1, 2]}` where `JSON.stringify` writes
 * `{"a":1,"b":[1,2]}` — SIX characters fewer on that tiny object, and every use of this
 * function here is `len(json.dumps(x))` feeding a token estimate. Patching separators
 * back into serialised text would corrupt any string containing `,` or `:`.
 *
 * DECLARED RESIDUAL — an INTEGRAL FLOAT. `json.loads` keeps `1.0` a Python float and
 * `json.dumps` writes it back as `1.0`; `JSON.parse` yields the double `1` and nothing
 * downstream can tell it from an int, so this writes `1`. A tool input carrying `{"a":
 * 1.0}` is therefore counted 2 characters shorter here than by the reference. Closing it
 * needs a JSON parser that preserves the int/float distinction — a parser inside a
 * shipped skill script, to move a character count that then gets divided by four. It is
 * measured instead: `tests/test_token_report_parity.py` has a cell that asserts the two
 * implementations DIFFER on exactly this input, so the residual cannot be forgotten and
 * cannot be closed without the cell noticing.
 */
function jsonDumps(value) {
  return escapeNonAscii(dumpsImpl(value));
}

function dumpsImpl(v) {
  if (v === null || v === undefined) return 'null';
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : pyFloat(v);
  if (Array.isArray(v)) return `[${v.map(dumpsImpl).join(', ')}]`;
  if (typeof v === 'object') {
    return `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${dumpsImpl(x)}`)
      .join(', ')}}`;
  }
  return 'null';
}

/** `repr(value)` for a value out of `json.loads` — copy of `pyfs.pyReprImpl(v, false)`. */
function pyRepr(v) {
  if (typeof v === 'string') {
    let body = '';
    for (const ch of v) {
      const cp = ch.codePointAt(0);
      if (ch === '\\') body += '\\\\';
      else if (ch === '\n') body += '\\n';
      else if (ch === '\r') body += '\\r';
      else if (ch === '\t') body += '\\t';
      else if (cp < 0x20 || cp === 0x7f) body += `\\x${cp.toString(16).padStart(2, '0')}`;
      else body += ch;
    }
    return body.includes("'") && !body.includes('"')
      ? `"${body}"`
      : `'${body.replaceAll("'", "\\'")}'`;
  }
  if (v === null || v === undefined) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : pyFloat(v);
  if (Array.isArray(v)) return `[${v.map(pyRepr).join(', ')}]`;
  if (typeof v === 'object') {
    return `{${Object.entries(v).map(([k, x]) => `${pyRepr(k)}: ${pyRepr(x)}`).join(', ')}}`;
  }
  return String(v);
}

/** `str(value)` — `repr` for everything except a string, which is itself. */
const pyStrOfJson = (v) => (typeof v === 'string' ? v : pyRepr(v));

/** `int(s)` — copy of `pyfs.pyInt`; accepts a sign, `_` between digits, any Nd digit. */
function pyInt(s) {
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (trimmed === '') return null;
  let body = trimmed;
  let sign = 1;
  if (body[0] === '+' || body[0] === '-') {
    if (body[0] === '-') sign = -1;
    body = body.slice(1);
  }
  const chars = [...body];
  if (chars.length === 0) return null;
  let value = 0n;
  let prevWasDigit = false;
  for (const ch of chars) {
    if (ch === '_') {
      if (!prevWasDigit) return null;
      prevWasDigit = false;
      continue;
    }
    if (!/^\p{Nd}$/u.test(ch)) return null;
    const cp = ch.codePointAt(0);
    let zero = cp;
    while (zero > 0 && /^\p{Nd}$/u.test(String.fromCodePoint(zero - 1))) zero -= 1;
    value = value * 10n + BigInt(cp - zero);
    prevWasDigit = true;
  }
  if (!prevWasDigit) return null;
  return Number(sign === -1 ? -value : value);
}

/** `sorted()` on strings — Python compares CODE POINTS, JS `<` compares UTF-16 units. */
function pyStrCmp(a, b) {
  const A = [...a];
  const B = [...b];
  for (let i = 0; i < Math.min(A.length, B.length); i += 1) {
    const x = A[i].codePointAt(0);
    const y = B[i].codePointAt(0);
    if (x !== y) return x < y ? -1 : 1;
  }
  return A.length - B.length;
}

/** `sorted()` on Path objects — copy of `pyfs.comparePaths`: COMPONENTS, not the string. */
function comparePaths(a, b) {
  const norm = (s) => (process.platform === 'win32' ? s.toLowerCase() : s);
  const A = norm(a).split(/[\\/]/);
  const B = norm(b).split(/[\\/]/);
  for (let i = 0; i < Math.min(A.length, B.length); i += 1) {
    const c = pyStrCmp(A[i], B[i]);
    if (c !== 0) return c;
  }
  return A.length - B.length;
}

// --- small filesystem helpers (`pathlib` shapes this file actually uses) ---

const isDict = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** `d.get(k, default)` — a present-but-null value is the VALUE, not the default. */
const getOr = (o, k, d) => (isDict(o) && Object.hasOwn(o, k) ? o[k] : d);

function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function isFile(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}

function mtime(p) {
  try { return statSync(p).mtimeMs / 1000; } catch { return 0; }
}

function listDir(p) {
  try { return readdirSync(p).map((n) => path.join(p, n)); } catch { return []; }
}

/** Every file at any depth under `root` whose basename matches `pred`. */
function walkFiles(root, pred, out = []) {
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(root, e.name);
    if (e.isDirectory()) walkFiles(full, pred, out);
    else if (pred(e.name)) out.push(full);
  }
  return out;
}

/** Every DIRECTORY at any depth under `root` named `name` — `Path.rglob("<name>")`. */
function walkDirsNamed(root, name, out = []) {
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const full = path.join(root, e.name);
    if (e.name === name) out.push(full);
    walkDirsNamed(full, name, out);
  }
  return out;
}

function readTextMaybe(p) {
  try { return readFileSync(p, 'utf8'); } catch { return null; }
}

function loadJsonMaybe(text) {
  if (text === null) return undefined;
  try { return JSON.parse(text); } catch { return undefined; }
}

// ---------------------------------------------------------------------------
// Common helpers
// ---------------------------------------------------------------------------

/** Total characters of text in a message content field (str or block list). */
function textLen(content) {
  if (content === null || content === undefined) return 0;
  if (typeof content === 'string') return pyLen(content);
  if (Array.isArray(content)) {
    let total = 0;
    for (const block of content) {
      if (!isDict(block)) {
        total += pyLen(pyStrOfJson(block));
        continue;
      }
      const btype = getOr(block, 'type', undefined);
      if (btype === 'text') total += pyLen(pyStrOfJson(getOr(block, 'text', '')));
      else if (btype === 'thinking') {
        total += pyLen(pyStrOfJson(getOr(block, 'thinking', '')));
      } else if (btype === 'tool_use') total += jsonDumps(getOr(block, 'input', {})).length;
      else if (btype === 'tool_result') total += textLen(getOr(block, 'content', undefined));
      else total += jsonDumps(block).length;
    }
    return total;
  }
  return pyLen(pyStrOfJson(content));
}

const estTokens = (chars) => pyRound(chars / CHARS_PER_TOKEN);

const pct = (part, whole) => (whole ? `${pyFixed(100 * part / whole, 1)}%` : '–');

function bar(part, whole, width = 10) {
  const filled = whole ? pyRound(width * part / whole) : 0;
  return '█'.repeat(Math.min(filled, width)) + '░'.repeat(Math.max(width - filled, 0));
}

/** Input-side tokens of one request = context size at that moment. */
const contextSize = (usage) => (getOr(usage, 'input_tokens', 0) || 0)
  + (getOr(usage, 'cache_read_input_tokens', 0) || 0)
  + (getOr(usage, 'cache_creation_input_tokens', 0) || 0);

function newest(paths) {
  const live = paths.filter((p) => existsSync(p));
  if (live.length === 0) return null;
  // `max()` keeps the FIRST maximum; `reduce` with `>` does the same.
  return live.reduce((best, p) => (mtime(p) > mtime(best) ? p : best));
}

/** `defaultdict` — a Map that reads missing keys as 0 and keeps insertion order. */
class Counter {
  constructor() { this.m = new Map(); }

  get(k) { return this.m.get(k) ?? 0; }

  add(k, n) { this.m.set(k, this.get(k) + n); }

  set(k, n) { this.m.set(k, n); }

  entries() { return [...this.m.entries()]; }

  get size() { return this.m.size; }
}

/** Host-independent intermediate model the renderer consumes. */
class SessionData {
  constructor(host, label) {
    this.host = host;
    this.label = label;                  // transcript file / session id
    this.main = new Counter();           // aggregated exact usage, main thread
    this.side = new Counter();           // aggregated exact usage, subagents
    this.models = new Counter();         // output tokens per model
    this.requestsMain = 0;
    this.requestsSide = 0;
    this.firstContext = null;            // exact context size, first request
    this.lastContext = null;             // exact context size, last request
    this.peakContext = 0;
    this.cats = new Counter();           // estimated chars per category
    this.top = [];                       // [chars, label] heaviest single items
    this.firstUserChars = null;
    this.duration = null;                // seconds
    this.notes = [];                     // host-specific caveats for the report
  }

  get hasExact() { return this.requestsMain > 0 || this.requestsSide > 0; }

  addUsage(usage, model = null, side = false) {
    const bucket = side ? this.side : this.main;
    for (const f of USAGE_FIELDS) bucket.add(f, getOr(usage, f, 0) || 0);
    if (side) {
      this.requestsSide += 1;
    } else {
      this.requestsMain += 1;
      const size = contextSize(usage);
      if (this.firstContext === null) this.firstContext = size;
      this.lastContext = size;
      this.peakContext = Math.max(this.peakContext, size);
    }
    if (model) this.models.add(model, getOr(usage, 'output_tokens', 0) || 0);
  }

  span(firstTs, lastTs) {
    if (!firstTs || !lastTs || firstTs === lastTs) return;
    const parse = (t) => {
      if (typeof t === 'number') {           // epoch millis or seconds
        return t > 1e12 ? t : t * 1000;
      }
      const ms = Date.parse(String(t).replace('Z', '+00:00'));
      return Number.isNaN(ms) ? null : ms;
    };
    const a = parse(firstTs);
    const b = parse(lastTs);
    // `except (ValueError, OSError, OverflowError): pass` — an unparseable stamp
    // leaves `duration` None and the header simply omits it.
    if (a === null || b === null) return;
    this.duration = (b - a) / 1000;
  }
}

// ---------------------------------------------------------------------------
// Host: Claude Code / IBM Bob (same transcript shape, different config root)
// ---------------------------------------------------------------------------

const slugify = (p) => p.replace(/[^A-Za-z0-9]/g, '-');

function claudeShapedRoot(host) {
  const env = { claude: 'CLAUDE_CONFIG_DIR', bob: 'BOB_CONFIG_DIR' }[host];
  const root = process.env[env] || path.join(homedir(), `.${host}`);
  return isDir(path.join(root, 'projects')) ? root : null;
}

function claudeShapedFind(host, explicit = null) {
  if (explicit) return explicit;
  const root = claudeShapedRoot(host);
  if (!root) return null;
  const projects = path.join(root, 'projects');
  const candidates = [];
  const exact = path.join(projects, slugify(process.cwd()));
  const dirs = isDir(exact) ? [exact] : listDir(projects)
    .filter(isDir)
    .sort((a, b) => mtime(b) - mtime(a));
  for (const d of dirs) {
    candidates.push(...walkTop(d, (n) => n.endsWith('.jsonl')));
    if (candidates.length) break;
  }
  return newest(candidates);
}

/** `Path.glob("*.jsonl")` — one level, unlike `rglob`. */
function walkTop(dir, pred) {
  return listDir(dir).filter((p) => pred(path.basename(p)) && isFile(p));
}

function claudeShapedParse(host, file) {
  const data = new SessionData(host, path.basename(file));
  const toolNameById = new Map();
  let firstTs = null;
  let lastTs = null;

  const text = readTextMaybe(file);
  if (text === null) sysExit(`error: cannot read ${file}`);

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const rec = loadJsonMaybe(line);
    if (rec === undefined) continue;
    const rtype = getOr(rec, 'type', undefined);
    const side = Boolean(getOr(rec, 'isSidechain', false));
    const ts = getOr(rec, 'timestamp', undefined);
    if (ts) {
      firstTs = firstTs || ts;
      lastTs = ts;
    }

    if (rtype === 'assistant') {
      const msg = getOr(rec, 'message', {});
      const usage = getOr(msg, 'usage', null) || {};
      // Python's `if usage:` — an empty dict is falsy.
      if (isDict(usage) && Object.keys(usage).length) {
        data.addUsage(usage, getOr(msg, 'model', undefined), side);
      }
      if (side) continue;   // sidechain content never enters this context
      for (const block of getOr(msg, 'content', null) || []) {
        if (!isDict(block)) continue;
        const btype = getOr(block, 'type', undefined);
        if (btype === 'text') {
          data.cats.add('Assistant replies', pyLen(pyStrOfJson(getOr(block, 'text', ''))));
        } else if (btype === 'thinking') {
          data.cats.add('Assistant thinking',
            pyLen(pyStrOfJson(getOr(block, 'thinking', ''))));
        } else if (btype === 'tool_use') {
          // `pyStrOfJson`, not bare interpolation: an f-string calls `str()`, and a
          // `"name": null` in the record is `None` to Python and `null` to JS. The
          // RAW value is what goes in the id map, because Python stores it raw and
          // calls `str()` again at each use.
          const name = getOr(block, 'name', 'unknown');
          toolNameById.set(getOr(block, 'id', undefined), name);
          data.cats.add(`Tool call · ${pyStrOfJson(name)}`,
            jsonDumps(getOr(block, 'input', {})).length);
        }
      }
    } else if (rtype === 'user' && !side) {
      // isMeta marks injected content (loaded skill bodies, slash-command
      // expansions) arriving as a user turn the user didn't type.
      const userCat = getOr(rec, 'isMeta', false)
        ? 'Injected skill/command content' : 'User messages';
      const content = getOr(getOr(rec, 'message', {}), 'content', undefined);
      const blocks = Array.isArray(content) ? content : [content];
      for (const block of blocks) {
        if (isDict(block) && getOr(block, 'type', undefined) === 'tool_result') {
          // `.get(id, "unknown")` — `has`, not `??`: a name STORED as null is None,
          // and only an ABSENT id falls back to "unknown".
          const id = getOr(block, 'tool_use_id', undefined);
          const name = toolNameById.has(id) ? toolNameById.get(id) : 'unknown';
          const chars = textLen(getOr(block, 'content', undefined));
          data.cats.add(`Tool result · ${pyStrOfJson(name)}`, chars);
          data.top.push([chars, `${pyStrOfJson(name)} result`]);
        } else {
          const chars = textLen(typeof block === 'string' ? block : [block]);
          data.cats.add(userCat, chars);
          if (userCat === 'User messages' && data.firstUserChars === null) {
            data.firstUserChars = chars;
          }
        }
      }
    } else if (rtype === 'attachment' && !side) {
      data.cats.add('System attachments (reminders, listings)',
        jsonDumps(getOr(rec, 'attachment', {})).length);
    }
  }

  data.span(firstTs, lastTs);
  return data;
}

// ---------------------------------------------------------------------------
// Host: OpenCode
// ---------------------------------------------------------------------------

/**
 * Set when `node:sqlite` is present but unusable, or absent. See `loadSqlite`.
 *
 * THE ONE DELIBERATE DIVERGENCE FROM THE REFERENCE, and it is a degradation rather than
 * a behaviour change: Python's `sqlite3` is always there, `node:sqlite` is not. The
 * decision taken for this port is a guarded import plus a declared note — NOT an
 * `engines` bump, because the agent runs this file as a bare `node <skill-dir>/scripts/…`
 * per SKILL.md, so `package.json`'s `engines` gates `npm i -g geneseed` and nothing at
 * all about this script.
 */
let SQLITE_NOTE = null;

async function loadSqlite() {
  try {
    const mod = await import('node:sqlite');
    if (typeof mod.DatabaseSync !== 'function') throw new Error('no DatabaseSync');
    return mod.DatabaseSync;
  } catch {
    SQLITE_NOTE = 'OpenCode v1.2+ keeps its sessions in SQLite and this Node runtime '
      + 'cannot open one: `node:sqlite` is unavailable. It needs Node 22.5+ started with '
      + '--experimental-sqlite, or Node 22.13+, where it is on by default.';
    return null;
  }
}

function opencodeDataDir() {
  const xdg = process.env.XDG_DATA_HOME;
  const candidates = (xdg ? [path.join(xdg, 'opencode')] : [])
    .concat([path.join(homedir(), '.local', 'share', 'opencode'),
      path.join(homedir(), '.opencode')]);
  return candidates.find(isDir) ?? null;
}

function opencodeRoot() {
  const d = opencodeDataDir();
  return d && isDir(path.join(d, 'storage')) ? path.join(d, 'storage') : null;
}

/**
 * Locate the current OpenCode session.
 *
 * v1.2+ stores everything in SQLite (<data-dir>/opencode.db) — prefer that.
 * Older installs keep JSON files under storage/; fall back to walking them.
 * Returns ["db", [dbPath, sessionIdOrNull]] or ["files", [sid, files]] — and, where the
 * reference cannot go, ["nosqlite", [dbPath]] when the DB is the only source and this
 * runtime cannot read it.
 */
async function opencodeFind(explicit = null) {
  const d = opencodeDataDir();
  if (d) {
    const db = path.join(d, 'opencode.db');
    if (isFile(db)) {
      const Database = await loadSqlite();
      if (Database) return ['db', [db, explicit]];
      const fallback = opencodeFindFiles(explicit);
      if (fallback) {
        SQLITE_NOTE += ' Falling back to the pre-v1.2 storage/ JSON files, which are '
          + 'older than the SQLite store and may be missing this session entirely.';
        return fallback;
      }
      return ['nosqlite', [db]];
    }
  }
  return opencodeFindFiles(explicit);
}

/**
 * Pre-SQLite fallback: [session_id, [message files]] for the most recently active
 * session. Message files live under a `message/<sessionID>/` folder somewhere below
 * storage/ (the nesting has moved between versions, so walk).
 */
function opencodeFindFiles(explicit = null) {
  const storage = opencodeRoot();
  if (!storage) return null;
  const sessions = new Map();
  for (const msgdir of walkDirsNamed(storage, 'message')) {
    for (const sdir of listDir(msgdir)) {
      if (!isDir(sdir)) continue;
      const files = walkTop(sdir, (n) => n.endsWith('.json'));
      if (files.length) {
        sessions.set(path.basename(sdir),
          (sessions.get(path.basename(sdir)) ?? []).concat(files));
      }
    }
  }
  if (sessions.size === 0) return null;
  if (explicit && sessions.has(explicit)) return ['files', [explicit, sessions.get(explicit)]];
  let sid = null;
  let best = -Infinity;
  for (const [s, files] of sessions) {
    const m = Math.max(...files.map(mtime));
    if (m > best) { best = m; sid = s; }   // `max()` keeps the first maximum
  }
  return ['files', [sid, sessions.get(sid)]];
}

/** Map OpenCode's tokens shape onto the common usage fields. */
function ocUsageFromTokens(tok) {
  const cache = getOr(tok, 'cache', null) || {};
  return {
    input_tokens: getOr(tok, 'input', 0),
    output_tokens: (getOr(tok, 'output', 0) || 0) + (getOr(tok, 'reasoning', 0) || 0),
    cache_read_input_tokens: getOr(cache, 'read', 0),
    cache_creation_input_tokens: getOr(cache, 'write', 0),
  };
}

/**
 * Fold one OpenCode message record (the MessageV2 Info shape — identical in the old JSON
 * files and the SQLite `message.data` column) into the model.
 * Returns [message_id, role, had_tokens].
 */
function ocTakeMessage(data, msg, side = false) {
  const role = getOr(msg, 'role', undefined);
  const tok = getOr(msg, 'tokens', null) || {};
  const hasTok = isDict(tok) && Object.keys(tok).length > 0;
  if (role === 'assistant' && hasTok) {
    data.addUsage(ocUsageFromTokens(tok), getOr(msg, 'modelID', undefined), side);
  }
  return [getOr(msg, 'id', undefined), role, role === 'assistant' && hasTok];
}

/**
 * Categorise one OpenCode content part (same shape in files and DB).
 * Returns the part's `tokens` dict for step-finish parts, else null.
 */
function ocTakePart(data, role, part) {
  const ptype = getOr(part, 'type', undefined);
  if (ptype === 'text') {
    const cat = role === 'assistant' ? 'Assistant replies' : 'User messages';
    const chars = pyLen(pyStrOfJson(getOr(part, 'text', '')));
    data.cats.add(cat, chars);
    if (cat === 'User messages' && data.firstUserChars === null) {
      data.firstUserChars = chars;
    }
  } else if (ptype === 'reasoning') {
    data.cats.add('Assistant thinking', pyLen(pyStrOfJson(getOr(part, 'text', ''))));
  } else if (ptype === 'tool') {
    const name = pyStrOfJson(getOr(part, 'tool', 'unknown'));
    const state = getOr(part, 'state', null) || {};
    data.cats.add(`Tool call · ${name}`, jsonDumps(getOr(state, 'input', {})).length);
    const outChars = textLen(getOr(state, 'output', undefined));
    data.cats.add(`Tool result · ${name}`, outChars);
    data.top.push([outChars, `${name} result`]);
  } else if (ptype === 'step-finish') {
    return getOr(part, 'tokens', undefined);
  }
  return null;
}

/**
 * Parse OpenCode's SQLite store (v1.2+): `session`, `message`, `part` tables with the
 * structured payloads in JSON `data` columns. Read-only; defensive about columns, since
 * the schema is young and may evolve.
 */
async function opencodeDbParse(dbPath, explicit = null) {
  const Database = await loadSqlite();
  if (!Database) return nosqliteData(dbPath);
  let con;
  try {
    con = new Database(dbPath, { readOnly: true });
  } catch {
    con = new Database(dbPath);
  }
  try {
    const rows = (sql, args = []) => {
      try { return con.prepare(sql).all(...args); } catch { return []; }
    };

    let sid = explicit;
    if (!sid) {
      // Prefer top-level sessions (parent_id NULL = not a subagent child),
      // in the current project dir when recorded, newest activity first.
      const cwd = process.cwd();
      let cands = rows('SELECT id, directory, time_updated FROM session '
        + 'WHERE parent_id IS NULL ORDER BY time_updated DESC');
      if (!cands.length) {
        cands = rows('SELECT id, NULL AS directory, time_updated FROM session '
          + 'ORDER BY time_updated DESC');
      }
      if (!cands.length) sysExit('error: opencode.db contains no sessions');
      sid = (cands.find((r) => r.directory === cwd) ?? cands[0]).id;
    }

    const data = new SessionData('opencode', sid);
    let firstTs = null;
    let lastTs = null;
    const roleByMsg = new Map();
    const untokened = new Map();   // assistant messages with no tokens in message.data

    for (const r of rows('SELECT id, time_created, data FROM message '
      + 'WHERE session_id=? ORDER BY time_created, id', [sid])) {
      const msg = typeof r.data === 'string' ? loadJsonMaybe(r.data) : (r.data || {});
      if (msg === undefined) continue;
      if (r.time_created) {
        firstTs = firstTs || r.time_created;
        lastTs = r.time_created;
      }
      const [, role, had] = ocTakeMessage(data, msg);
      roleByMsg.set(r.id, role);
      if (role === 'assistant' && !had) untokened.set(r.id, getOr(msg, 'modelID', undefined));
    }

    const stepTokens = new Map();   // message_id -> [tokens dicts]
    for (const r of rows('SELECT p.message_id, p.data FROM part p '
      + 'JOIN message m ON p.message_id = m.id '
      + 'WHERE m.session_id=? ORDER BY p.time_created, p.id', [sid])) {
      const part = typeof r.data === 'string' ? loadJsonMaybe(r.data) : (r.data || {});
      if (part === undefined) continue;
      const tok = ocTakePart(data, roleByMsg.get(r.message_id), part);
      if (tok) {
        if (!stepTokens.has(r.message_id)) stepTokens.set(r.message_id, []);
        stepTokens.get(r.message_id).push(tok);
      }
    }
    // step-finish parts also carry usage — use them only for assistant
    // messages whose own record had none, so nothing is double-counted.
    for (const [mid, model] of untokened) {
      for (const tok of stepTokens.get(mid) ?? []) {
        data.addUsage(ocUsageFromTokens(tok), model);
      }
    }

    // Child sessions are subagent runs: aggregate their usage separately —
    // their content never enters this session's context window.
    for (const child of rows('SELECT id FROM session WHERE parent_id=?', [sid])) {
      for (const r of rows('SELECT data FROM message WHERE session_id=?', [child.id])) {
        const msg = typeof r.data === 'string' ? loadJsonMaybe(r.data) : (r.data || {});
        if (msg === undefined) continue;
        ocTakeMessage(data, msg, true);
      }
    }

    data.span(firstTs, lastTs);
    data.notes.push('Source: opencode.db (SQLite, OpenCode v1.2+). Subagent '
      + "totals aggregate this session's child sessions.");
    return data;
  } finally {
    try { con.close(); } catch { /* already closed */ }
  }
}

/** The DB is the only source and this runtime cannot read it — report that, honestly. */
function nosqliteData(dbPath) {
  const data = new SessionData('opencode', path.basename(dbPath));
  data.notes.push(SQLITE_NOTE ?? 'node:sqlite is unavailable.');
  data.notes.push('No pre-v1.2 storage/ JSON files were found either, so this report '
    + 'has no session data to attribute at all.');
  return data;
}

/** Pre-SQLite fallback: parse the per-message JSON files under storage/. */
function opencodeParse(sid, files) {
  const data = new SessionData('opencode', sid);
  const storage = opencodeRoot();
  const roleByMsg = new Map();
  let firstTs = null;
  let lastTs = null;

  const ordered = [...files].sort(
    (a, b) => pyStrCmp(path.basename(a), path.basename(b)));
  for (const f of ordered) {
    const msg = loadJsonMaybe(readTextMaybe(f));
    if (msg === undefined) continue;
    const [mid, role] = ocTakeMessage(data, msg);
    roleByMsg.set(mid, role);
    const t = getOr(msg, 'time', null) || {};
    const ts = getOr(t, 'created', undefined) || getOr(t, 'completed', undefined);
    if (ts) {
      firstTs = firstTs || ts;
      lastTs = ts;
    }
  }

  // Content parts live under part/<messageID>/ folders (walk for the same
  // version-drift reason as messages).
  if (storage) {
    for (const partdir of walkDirsNamed(storage, 'part')) {
      for (const mdir of listDir(partdir)) {
        const role = roleByMsg.get(path.basename(mdir));
        if (role === undefined || !isDir(mdir)) continue;
        for (const pf of walkTop(mdir, (n) => n.endsWith('.json'))) {
          const part = loadJsonMaybe(readTextMaybe(pf));
          if (part === undefined) continue;
          ocTakePart(data, role, part);
        }
      }
    }
  }

  data.span(firstTs, lastTs);
  data.notes.push('Source: OpenCode JSON storage (pre-v1.2). Exact per-request '
    + 'tokens from message records.');
  if (SQLITE_NOTE) data.notes.push(SQLITE_NOTE);
  return data;
}

// ---------------------------------------------------------------------------
// Host: GitHub Copilot CLI (best effort — schema undocumented)
// ---------------------------------------------------------------------------

function copilotRoot() {
  const root = process.env.COPILOT_CONFIG_DIR || path.join(homedir(), '.copilot');
  for (const sub of ['history-session-state', 'session-state', 'sessions']) {
    if (isDir(path.join(root, sub))) return path.join(root, sub);
  }
  return null;
}

/** Recursively collect numeric fields whose key mentions tokens. */
function harvestTokens(obj, sink) {
  if (isDict(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      const lk = k.toLowerCase();
      // `isinstance(v, (int, float))` — and in Python a BOOL *is* an int, so a
      // `"hasTokens": true` adds 1. Reproduced rather than tidied away.
      if ((typeof v === 'number' || typeof v === 'boolean') && lk.includes('token')) {
        sink.add(lk, typeof v === 'boolean' ? (v ? 1 : 0) : v);
      } else {
        harvestTokens(v, sink);
      }
    }
  } else if (Array.isArray(obj)) {
    for (const v of obj) harvestTokens(v, sink);
  }
}

/** Recursively estimate message-ish content by role. */
function harvestText(obj, sink, depth = 0) {
  if (depth > 12) return;
  if (isDict(obj)) {
    const roleRaw = getOr(obj, 'role', undefined);
    const role = typeof roleRaw === 'string' ? roleRaw : null;
    const body = role ? getOr(obj, 'content', undefined) : null;
    if (role && body !== null && body !== undefined) {
      const cat = { user: 'User messages', assistant: 'Assistant replies',
        tool: 'Tool result · (unattributed)' }[role] ?? `${role} messages`;
      sink.add(cat, textLen(body));
      return;
    }
    for (const v of Object.values(obj)) harvestText(v, sink, depth + 1);
  } else if (Array.isArray(obj)) {
    for (const v of obj) harvestText(v, sink, depth + 1);
  }
}

function copilotFind(explicit = null) {
  const root = copilotRoot();
  if (!root) return null;
  if (explicit) return existsSync(explicit) ? explicit : null;
  return newest(listDir(root));
}

function copilotParse(target) {
  const data = new SessionData('copilot', path.basename(target));
  // `rglob("*.json*")` — the basename must CONTAIN ".json", so .json and .jsonl both
  // match and so does anything after them.
  const files = isDir(target)
    ? walkFiles(target, (n) => n.includes('.json')).sort(comparePaths)
    : [target];
  const tokens = new Counter();
  for (const f of files.slice(0, 500)) {
    const text = readTextMaybe(f);
    if (text === null) continue;
    const docs = [];
    if (path.extname(f) === '.jsonl') {
      for (const line of pySplitLines(text)) {
        const d = loadJsonMaybe(line);
        if (d !== undefined) docs.push(d);
      }
    } else {
      const d = loadJsonMaybe(text);
      if (d !== undefined) docs.push(d);
    }
    for (const doc of docs) {
      harvestTokens(doc, tokens);
      harvestText(doc, data.cats);
    }
  }
  if (tokens.size) {
    data.notes.push('Copilot session state is undocumented; token-like fields '
      + 'found (summed, field names as stored): '
      + tokens.entries().sort((a, b) => pyStrCmp(a[0], b[0]))
        .map(([k, v]) => `${k}=${fmt(v)}`).join(', '));
  } else {
    data.notes.push('Copilot records no recognisable token counts in its session '
      + 'state — the report below is character-count estimates only.');
  }
  return data;
}

/**
 * `str.splitlines()` — copy of the rule `pyfs` settles for the generator: Python splits
 * on a dozen characters JS's `\n` split does not, and drops a trailing empty field.
 */
function pySplitLines(s) {
  if (s === '') return [];
  const parts = s.split(
    new RegExp('\\r\\n|[\\n\\r\\v\\f\\x1c\\x1d\\x1e\\x85\\u2028\\u2029]'));
  if (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

// ---------------------------------------------------------------------------
// Detection and rendering
// ---------------------------------------------------------------------------

/** Pick the host: explicit --host wins, else the most recently active. */
async function detect(hostArg, transcript, session) {
  const finders = {
    claude: () => claudeShapedFind('claude', transcript),
    bob: () => claudeShapedFind('bob', transcript),
    opencode: () => opencodeFind(session),
    copilot: () => copilotFind(transcript),
  };
  if (hostArg) {
    const found = await finders[hostArg]();
    if (!found) sysExit(`error: no session data found for host '${hostArg}'`);
    return [hostArg, found];
  }

  let best = null;
  for (const [host, finder] of Object.entries(finders)) {
    const found = await finder();
    if (!found) continue;
    let probe;
    if (host === 'opencode') {   // ["db", [dbPath, sid]] or ["files", [sid, files]]
      const [kind, payload] = found;
      probe = kind === 'files' ? payload[1][0] : payload[0];
    } else {
      probe = found;
    }
    const m = existsSync(probe) ? mtime(probe) : 0;
    if (best === null || m > best[2]) best = [host, found, m];
  }
  if (!best) {
    sysExit('error: no session data found for any supported host '
      + '(claude, bob, opencode, copilot)');
  }
  return [best[0], best[1]];
}

async function load(host, found) {
  if (host === 'claude' || host === 'bob') return claudeShapedParse(host, found);
  if (host === 'opencode') {
    const [kind, payload] = found;
    if (kind === 'db') return opencodeDbParse(...payload);
    if (kind === 'nosqlite') return nosqliteData(...payload);
    return opencodeParse(...payload);
  }
  return copilotParse(found);
}

const HOST_NAMES = { claude: 'Claude Code', bob: 'IBM Bob', opencode: 'OpenCode', copilot: 'GitHub Copilot' };

function render(d, limit, topN) {
  const out = [`# Token usage report — ${HOST_NAMES[d.host] ?? d.host}`, ''];
  // Every interpolation of a value that came out of a transcript goes through
  // `pyStrOfJson`: an f-string is `str()`, and `str(None)` is `None`, not `null`.
  out.push(`Session: \`${pyStrOfJson(d.label)}\``
    + (d.duration ? ` · duration ${pyFixed(d.duration / 60, 0)} min` : ''));
  out.push('');

  if (d.hasExact) {
    out.push('## Session totals (exact, from recorded usage)');
    out.push('');
    out.push('| Metric | Main thread | Subagents | Total |');
    out.push('|---|---:|---:|---:|');
    const rows = [['Requests', d.requestsMain, d.requestsSide]].concat(
      [['Output tokens', 'output_tokens'],
        ['Fresh input tokens', 'input_tokens'],
        ['Cache writes', 'cache_creation_input_tokens'],
        ['Cache reads', 'cache_read_input_tokens']]
        .map(([label, f]) => [label, d.main.get(f), d.side.get(f)]));
    for (const [label, m, s] of rows) {
      out.push(`| ${label} | ${fmt(m)} | ${fmt(s)} | ${fmt(m + s)} |`);
    }
    out.push('');
    if (d.models.size) {
      out.push(`Models used: ${d.models.entries()
        .sort((a, b) => b[1] - a[1])
        .map(([m, t]) => `\`${pyStrOfJson(m)}\` (${fmt(t)} out)`).join(', ')}`);
      out.push('');
    }

    const first = d.firstContext || 0;
    const last = d.lastContext || 0;
    out.push('## Context window');
    out.push('');
    out.push('| | Tokens | % of limit | |');
    out.push('|---|---:|---:|---|');
    out.push(`| Session start (harness + context) | ${fmt(first)} | ${pct(first, limit)} | ${bar(first, limit)} |`);
    out.push(`| Current context size | ${fmt(last)} | ${pct(last, limit)} | ${bar(last, limit)} |`);
    if (d.peakContext > last) {
      out.push(`| Peak context size | ${fmt(d.peakContext)} | ${pct(d.peakContext, limit)} | ${bar(d.peakContext, limit)} |`);
    }
    out.push(`| Context limit | ${fmt(limit)} | 100% | ${bar(limit, limit)} |`);
    out.push('');
    if (first) {
      const firstPrompt = estTokens(d.firstUserChars || 0);
      const harness = Math.max(first - firstPrompt, 0);
      out.push(`The session-start baseline is exact: **${fmt(first)}** tokens were `
        + `in context before any work happened — roughly ${fmt(harness)} of `
        + 'harness (system prompt, tool schemas, skill and agent listings, '
        + `memory) plus ~${fmt(firstPrompt)} for the first user message.`);
      out.push('');
      const grown = Math.max(last - first, 0);
      out.push(`Since then the persistent context grew by **${fmt(grown)}** tokens, `
        + `and the session generated **${fmt(d.main.get('output_tokens'))}** output `
        + 'tokens. The breakdown below attributes everything the session '
        + 'processed — including ephemeral thinking, which is generated and '
        + 'paid for but dropped from context after each turn.');
      out.push('');
    }
  } else {
    out.push('*(This host recorded no exact per-request usage — everything below '
      + 'is a character-count estimate.)*');
    out.push('');
  }

  // Thinking text is often not persisted (signature only) even though it IS
  // counted in the exact output totals. When absent, derive it: exact output
  // minus the visible output we can measure.
  if (d.cats.get('Assistant thinking') === 0 && d.main.get('output_tokens')) {
    let visible = 0;
    for (const [name, chars] of d.cats.entries()) {
      if (name === 'Assistant replies' || name.startsWith('Tool call')) visible += chars;
    }
    const derived = d.main.get('output_tokens') - estTokens(visible);
    if (derived > 0) {
      d.cats.set('Assistant thinking (derived)', pyRound(derived * CHARS_PER_TOKEN));
    }
  }

  let totalChars = 0;
  for (const [, chars] of d.cats.entries()) totalChars += chars;
  if (totalChars) {
    out.push('## Content breakdown (estimated, ~4 chars/token)');
    out.push('');
    out.push('| Category | Est. tokens | Share | |');
    out.push('|---|---:|---:|---|');
    // `sorted(..., key=lambda kv: -kv[1])` is STABLE, and a Map preserves insertion
    // order, so a comparator that returns 0 for equal counts reproduces Python exactly.
    for (const [name, chars] of d.cats.entries().sort((a, b) => b[1] - a[1])) {
      const t = estTokens(chars);
      if (t === 0) continue;
      out.push(`| ${name} | ${fmt(t)} | ${pct(chars, totalChars)} | ${bar(chars, totalChars)} |`);
    }
    out.push(`| **Total conversation content** | **${fmt(estTokens(totalChars))}** | 100% | |`);
    out.push('');
    out.push('*Estimates cover conversation content only — the harness baseline '
      + '(system prompt, tool schemas) is not re-counted here. Subagent '
      + 'content is excluded: it never enters this context window. Thinking '
      + 'is ephemeral — dropped from context after each turn — so it counts '
      + 'as processed output, not persistent context growth.*');
    out.push('');
  }

  // `sorted(d.top, reverse=True)` compares TUPLES: chars first, then the label.
  const heavy = [...d.top]
    .sort((a, b) => (b[0] - a[0]) || pyStrCmp(b[1], a[1]))
    .slice(0, topN);
  if (heavy.length && heavy[0][0] > 0) {
    out.push(`## Top ${heavy.length} heaviest single items`);
    out.push('');
    out.push('| Item | Est. tokens |');
    out.push('|---|---:|');
    for (const [chars, label] of heavy) out.push(`| ${label} | ${fmt(estTokens(chars))} |`);
    out.push('');
  }

  for (const note of d.notes) {
    out.push(`> ${note}`);
    out.push('');
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// The argument parser
// ---------------------------------------------------------------------------

const PROG = path.basename(process.argv[1] ?? 'token_report.mjs');
const HOST_CHOICES = ['claude', 'bob', 'opencode', 'copilot'];
const OPTIONS = [
  ['-h, --help', 'show this help message and exit'],
  [`--host {${HOST_CHOICES.join(',')}}`, 'force a host instead of auto-detecting by recency'],
  ['--transcript TRANSCRIPT', 'explicit transcript path (claude/bob/copilot)'],
  ['--session SESSION', 'explicit session id (opencode)'],
  ['--limit LIMIT', 'context window limit for % columns (default 200000)'],
  ['--top TOP', 'how many heaviest single items to list (default 5)'],
];

/**
 * `argparse`'s usage block, wrapped the way argparse wraps it at 80 columns.
 *
 * The continuation indent is `len("usage: ") + len(prog) + 1`, so it is one space wider
 * here than for `token_report.py` — the only difference between the two implementations'
 * help text, and the reason `tests/test_token_report_parity.py` normalises leading
 * whitespace on exactly the three argparse cells. The WRAP POINTS are identical for both
 * names (measured: every line has at least a character of slack at both widths).
 */
function usage() {
  const head = `usage: ${PROG} `;
  const pad = ' '.repeat(head.length);
  return [`${head}[-h] [--host {${HOST_CHOICES.join(',')}}]`,
    `${pad}[--transcript TRANSCRIPT] [--session SESSION]`,
    `${pad}[--limit LIMIT] [--top TOP]`].join('\n');
}

function helpText() {
  const lines = [usage(), '', 'Token usage report for the current agent session', '',
    'options:'];
  for (const [invocation, help] of OPTIONS) {
    const left = `  ${invocation}`;
    // argparse puts help in column 24, or on the next line when the invocation
    // reaches it.
    if (left.length + 2 <= 24) lines.push(left.padEnd(24) + help);
    else lines.push(left, ' '.repeat(24) + help);
  }
  return lines.join('\n');
}

function argError(msg) {
  process.stderr.write(xlate(`${usage()}\n${PROG}: error: ${msg}\n`));
  process.exit(2);
}

function parseArgs(argv) {
  const args = { host: null, transcript: null, session: null, limit: 200000, top: 5 };
  const takesValue = new Set(['--host', '--transcript', '--session', '--limit', '--top']);
  for (let i = 0; i < argv.length; i += 1) {
    let name = argv[i];
    let value = null;
    if (name === '-h' || name === '--help') {
      pyPrint(helpText());
      process.exit(0);
    }
    const eq = name.indexOf('=');
    if (eq > 0 && name.startsWith('--')) {
      value = name.slice(eq + 1);
      name = name.slice(0, eq);
    }
    if (!takesValue.has(name)) {
      argError(`unrecognized arguments: ${argv[i]}`);
    }
    if (value === null) {
      i += 1;
      if (i >= argv.length) argError(`argument ${name}: expected one argument`);
      value = argv[i];
    }
    if (name === '--host') {
      if (!HOST_CHOICES.includes(value)) {
        argError(`argument --host: invalid choice: '${value}' `
          + `(choose from ${HOST_CHOICES.join(', ')})`);
      }
      args.host = value;
    } else if (name === '--transcript') args.transcript = value;
    else if (name === '--session') args.session = value;
    else {
      const n = pyInt(value);
      if (n === null) {
        argError(`argument ${name}: invalid int value: '${value}'`);
      }
      if (name === '--limit') args.limit = n;
      else args.top = n;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [host, found] = await detect(args.host, args.transcript, args.session);
  pyPrint(render(await load(host, found), args.limit, args.top));
}

/**
 * The primitives above are exported for `tests/fixtures/token_report_probe.mjs`, which
 * drives each one against Python over a corpus of hand-picked values. Two `pyFixed`
 * defects reached a passing behavioural suite before that corpus existed, because a
 * transcript only produces the numbers it happens to produce.
 *
 * `main()` therefore runs only when this file IS the entry point — a plain `node
 * <skill-dir>/scripts/token_report.mjs`, which is how SKILL.md tells the agent to run
 * it. If this guard were ever wrong the script would print nothing at all, and all 49
 * cells of the parity corpus would say so on the next run.
 */
export { pyLen, pyRound, pyFixed, fmt, jsonDumps, pyRepr, pyStrOfJson, pyInt, pyStrCmp,
  comparePaths, pct, bar, estTokens, textLen, escapeNonAscii, pySplitLines };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
