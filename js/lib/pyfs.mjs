/**
 * Python-compatible primitives — the filesystem and JSON behaviour the port must match.
 *
 * The Node port has to produce bytes identical to the Python generator's, and the two
 * runtimes disagree by default in ways that are invisible in a diff viewer. This module
 * is where those disagreements are settled, once, so no caller has to remember them.
 *
 * Everything here is stdlib-only, ESM, and deliberately tiny — it is imported by hook
 * paths eventually, where load time is a per-tool-call cost.
 */
import {
  accessSync, appendFileSync, constants, writeFileSync, readFileSync, copyFileSync, statSync,
  utimesSync,
} from 'node:fs';
import { EOL } from 'node:os';
import path from 'node:path';

const { X_OK } = constants;

/**
 * `Path.write_text(text, encoding="utf-8")`.
 *
 * Python opens that file in TEXT mode with `newline=None`, so every `\n` is translated
 * to `os.linesep` on the way out — a freshly emitted AGENT.md is 504 CRLF and 0 bare LF
 * on Windows. `fs.writeFileSync` translates nothing. Without this wrapper *every* text
 * file the port emits differs from Python's on Windows, and the byte-identity gate that
 * is the whole acceptance test of the port yields exactly zero signal: it reports 100%
 * failure whether the render is right or wrong.
 *
 * Two categories must NOT go through here, and they are the reason this is a named
 * function rather than a blanket rule:
 *   - the hook shim, which Python writes with `newline=""` (raw);
 *   - anything Python copies with `shutil.copy2` (the OpenCode `plugins/*.js` and the
 *     vendored skill folders), which is a byte copy and keeps its LF.
 * The same vendored skill folder can contain files from both categories.
 */
export function writeText(path, text) {
  writeFileSync(path, EOL === '\n' ? text : text.replaceAll('\n', EOL), 'utf8');
}

/**
 * `path.open("a", encoding="utf-8").write(text)` — the APPEND half of the rule above.
 *
 * Same translation, second mode. It lives here rather than inlined at its one call site
 * (`js/update.mjs`'s install log) because the newline rule has exactly one owner in this
 * port and a second copy of it is how the rule rots: an appended line written with
 * `appendFileSync` alone is the only LF-terminated line in an otherwise CRLF file, which is
 * invisible in an editor and a whole-file difference to the gate.
 */
export function appendText(path, text) {
  appendFileSync(path, EOL === '\n' ? text : text.replaceAll('\n', EOL), 'utf8');
}

/**
 * `Path.read_text(encoding="utf-8")`.
 *
 * Python decodes text files in universal-newlines mode: `\r\n` and a lone `\r` both
 * become `\n` before any regex ever sees them. Node hands back the bytes as-is. The
 * repo's `.gitattributes` normalises `src/` to LF so today this is a no-op, but a
 * checkout with `core.autocrlf=true`, a copied tree, or an editor that rewrote one file
 * would otherwise change what `^...$` and `splitlines()` match — a divergence that shows
 * up as mangled output in one theme and nowhere else.
 */
export function readText(path) {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

/**
 * `shutil.copy2(src, dest)`.
 *
 * A byte copy, so the file keeps its own line endings — this is the OTHER half of the
 * `writeText` rule above, and the reason both exist as named functions: the vendored
 * skill folders contain files taken by each route, and picking the wrong one is a silent
 * whole-file diff. `copy2` also carries the source's mtime across, which `copyFileSync`
 * alone does not.
 *
 * Deliberate deviation: `copy2` copies the permission bits too (`copymode`), which on
 * Windows means the read-only attribute. Reproducing that would make a second emit fail
 * to overwrite its own output if a source file were ever marked read-only — a failure
 * mode the Python side has and nothing depends on. Mode is not copied here.
 */
export function copyFile(src, dest) {
  copyFileSync(src, dest);
  const st = statSync(src);
  utimesSync(dest, st.atime, st.mtime);
}

/**
 * `json.dumps(s)` for a STRING, with Python's default `ensure_ascii=True`.
 *
 * Every emitted `description:` line is built this way, and 44-50 of them per theme carry
 * an em dash today: Python writes `"a — b"`, `JSON.stringify` writes `"a — b"`. The
 * two agree on everything below U+007F — including the control-character table
 * (`\b \t \n \f \r`, then lowercase `\u00xx`) — so escaping the rest is the whole delta.
 * Astral characters fall out correctly without a special case: JS strings are UTF-16, so
 * the surrogate pair is escaped one code unit at a time, which is exactly what Python
 * emits (`😀`).
 *
 * Strings only, and loudly so — a COMPACT container is the one shape that genuinely
 * differs: Python's default separators are `(', ', ': ')`, so it writes `{"a": 1, "b": 2}`
 * where `JSON.stringify` writes `{"a":1,"b":2}`. Indented containers do NOT have that
 * problem (see `jsonDumpsIndent`), which is why the split is compact-vs-indented rather
 * than string-vs-container.
 */
export function jsonDumps(s) {
  if (typeof s !== 'string') {
    throw new TypeError('jsonDumps takes a string; a COMPACT container differs from '
      + "json.dumps by Python's ', ' / ': ' separators too \u2014 use jsonDumpsIndent or "
      + 'jsonDumpsCompact');
  }
  return escapeNonAscii(JSON.stringify(s));
}

/**
 * `ensure_ascii=True`: escape everything Python's encoder does and JS's does not.
 *
 * Applied to the SERIALISED text, which is safe because a JSON document can only carry
 * non-ASCII inside string literals. Spelled with \\u escapes, never literals: a JS source
 * file carrying a raw U+2028 or U+2029 terminates the line it sits on, and the parse
 * error points somewhere else entirely.
 */
function escapeNonAscii(text) {
  return text.replace(/[\u007f-\uffff]/g,
    (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

/**
 * `json.dumps(obj, indent=2)` \u2014 and with `{ ensureAscii: false }`, the
 * `ensure_ascii=False` variant. Those are the only two container shapes the generator
 * writes; measured across all 27 `json.dumps` call sites.
 *
 * Indentation is what makes this tractable: passing `indent` switches Python's
 * separators from `(', ', ': ')` to `(',', ': ')`, which is exactly what
 * `JSON.stringify(v, null, 2)` emits. Verified rather than argued \u2014
 * `tests/test_opencode_extras_parity.py` compares both variants against Python over a
 * corpus of container shapes.
 */
export function jsonDumpsIndent(value, { ensureAscii = true } = {}) {
  const text = JSON.stringify(value, null, 2);
  return ensureAscii ? escapeNonAscii(text) : text;
}

/**
 * `json.dumps(obj)` and `json.dumps(obj, sort_keys=True)` — the COMPACT container form.
 *
 * Deferred through three phases because guessing its signature would have been worse than
 * not having it; `js/settings.mjs` is the code that finally needs it, and the shapes were
 * counted with `ast` rather than assumed: four bare `json.dumps(container)` and two
 * `sort_keys=True`, all inside `_build_settings.py`, none of them `ensure_ascii=False`.
 *
 * It cannot delegate to `JSON.stringify` the way `jsonDumpsIndent` does. Without an indent
 * Python's separators are `(', ', ': ')` — `{"a": 1, "b": [1, 2]}` where `JSON.stringify`
 * writes `{"a":1,"b":[1,2]}` — and patching the separators back into the serialised text
 * would corrupt any string containing `,` or `:`. So the walk is written out.
 *
 * `sortKeys` sorts with JS's default comparator (UTF-16 code units) where Python sorts by
 * code point; the two disagree only above the BMP, which no settings.json key reaches. A
 * non-finite number throws rather than emitting `NaN`/`Infinity`: Python's encoder writes
 * those bare tokens, which is not valid JSON, and no caller here can produce one.
 *
 * `bareInts` admits a BARE JS number, reading it as a Python `int`. `pyStr` refuses one by
 * default and is right to: a value that came out of `json.loads` carries the int/float
 * distinction and a bare double has lost it. But P6's caller is `_send_json`, whose values
 * are COMPUTED here — counts, a port, a pid, a unix second — and Python types every one of
 * them `int`, which both languages render identically. The flag is where that claim is
 * stated; the byte gate over every endpoint body is what would catch a float. A
 * non-integral value still renders through `repr(float)`, which is the honest reading of
 * `0.5`; only an INTEGRAL float (`1.0` against JS's `1`) is unrepresentable, and it is
 * unrepresentable whatever this flag says.
 */
export function jsonDumpsCompact(value, { sortKeys = false, ensureAscii = true,
  bareInts = false } = {}) {
  const text = compactImpl(value, sortKeys, bareInts);
  return ensureAscii ? escapeNonAscii(text) : text;
}

function compactImpl(v, sortKeys, bareInts) {
  if (v === null || v === undefined) return 'null';
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (typeof v === 'string') return JSON.stringify(v);
  if (v instanceof PyNumber || typeof v === 'number') {
    const n = v instanceof PyNumber ? v.value : v;
    if (!Number.isFinite(n)) {
      throw new TypeError(`jsonDumpsCompact got ${n}; Python's encoder writes a bare `
        + 'NaN/Infinity token there, which is not JSON, and nothing here can produce one');
    }
    if (bareInts && typeof v === 'number') {
      return Number.isSafeInteger(n) ? String(n) : pyFloat(n);
    }
    return pyStr(v);
  }
  if (Array.isArray(v)) {
    return `[${v.map((x) => compactImpl(x, sortKeys, bareInts)).join(', ')}]`;
  }
  if (typeof v === 'object') {
    const keys = sortKeys ? Object.keys(v).sort() : Object.keys(v);
    return `{${keys.map((k) => `${JSON.stringify(k)}: ${compactImpl(v[k], sortKeys, bareInts)}`)
      .join(', ')}}`;
  }
  throw new TypeError(`jsonDumpsCompact has no rendering for ${typeof v}`);
}

/**
 * Python's `==` for values that came out of `json.loads` \u2014 the operator behind
 * `group in arr`, `rec in canon_flat` and `arr.remove(group)`.
 *
 * `===` is identity for containers, so a naive port of `if group in arr` never matches and
 * `_merge_claude_settings` re-adds its own hook group on every emit \u2014 the exact defect the
 * prior-claim pruning exists to prevent, reintroduced by a one-word translation.
 *
 * `PyNumber` compares by its VALUE, which is right: Python's `{"a": 1} == {"a": 1.0}` is
 * True even though `repr` renders the two differently. The one gap left is Python's
 * `1 == True`; a settings.json holding a bool where the manifest recorded a number is not
 * a shape any writer here produces.
 */
export function pyEq(a, b) {
  const x = a instanceof PyNumber ? a.value : a;
  const y = b instanceof PyNumber ? b.value : b;
  if (x === null || y === null || typeof x !== 'object' || typeof y !== 'object') {
    return x === y;
  }
  if (Array.isArray(x) !== Array.isArray(y)) return false;
  if (Array.isArray(x)) {
    return x.length === y.length && x.every((v, i) => pyEq(v, y[i]));
  }
  const kx = Object.keys(x);
  const ky = Object.keys(y);
  return kx.length === ky.length
    && kx.every((k) => Object.prototype.hasOwnProperty.call(y, k) && pyEq(x[k], y[k]));
}

/** `value in list` and `list.index(value)` under `pyEq` \u2014 Python's `in`, not `includes`. */
export function indexOfEq(arr, value) {
  return arr.findIndex((v) => pyEq(v, value));
}

/**
 * `PurePath._str_normcase` \u2014 Windows compares and sorts paths case-folded, POSIX does
 * not. This is what makes `sorted(SRC.rglob('*'))` and `sorted(d.glob('*.json'))`
 * platform-dependent, and the order is observable: the prompt emitter embeds items in
 * order, and each emit's written list becomes the ownership manifest the prune diffs.
 *
 * Two residual differences, both unreachable with this repo's ASCII filenames: Python
 * compares by code point where JS compares by UTF-16 code unit (differs only above the
 * BMP), and `str.lower()` is not `toLowerCase()` for a handful of characters.
 *
 * THE SEPARATOR CONVERSION IS NOT OPTIONAL, and it was missing until the byte-bearing
 * corpus in `tests/test_pure_function_parity.py` asked. `ntpath.normcase` is
 * `s.replace('/', '\\').lower()`, and `PurePath._str_normcase` gets the same conversion for
 * free because `Path` has already done it — so BOTH readings of the reference fold slashes
 * and this did not. Every sort call site feeds it `path.join` output or a bare `readdir`
 * name, which is why no emitted byte ever moved; `fnTranslate(normcase(pattern))` in
 * `js/hooks.mjs` is where it was reachable, because an exclude pattern is USER-WRITTEN and
 * `memory/*` never matched a native `memory\x` the way `fnmatch` does.
 */
export const normcase = process.platform === 'win32'
  ? (s) => s.replaceAll('/', '\\').toLowerCase()
  : (s) => s;

/**
 * `sorted()` over paths \u2014 one owner, so two call sites cannot drift apart.
 *
 * COMPONENT-WISE, and that was a flat string compare until P2 measured it. `PurePath.__lt__`
 * compares `_parts_normcase` \u2014 a TUPLE of path components \u2014 so the separator never takes part
 * in the comparison, and the two readings disagree in BOTH directions:
 *
 *     sorted    : skills/geneseed/SKILL.md  <  skills/geneseed-code-review/SKILL.md
 *     flat cmp  : the reverse, because '-' (0x2d) sorts before the separator '\\' (0x5c)
 *     sorted    : x/a/b.md  <  x/a.md          (component 'a' < 'a.md')
 *     flat cmp  : the reverse again
 *
 * Nothing in the emitted tree could see it: `js/render.mjs` sorts a list whose members share
 * a directory depth, and `golden.py` compares CONTENT rather than order. It became visible
 * the first time a full path list was PRINTED \u2014 `geneseed validate -v` \u2014 against a real
 * skills tree that happens to contain both `skills/geneseed/` and `skills/geneseed-code-review/`.
 * `tests/test_maintainer_tools_parity.py` is the gate that found it and the one that holds it.
 */
export function comparePaths(a, b) {
  const A = normcase(a).split(/[\\/]/);
  const B = normcase(b).split(/[\\/]/);
  for (let i = 0; i < Math.min(A.length, B.length); i += 1) {
    if (A[i] !== B[i]) return A[i] < B[i] ? -1 : 1;
  }
  return A.length - B.length;
}

/**
 * `_harness_core._within` \u2014 containment through `normcase`, segment-wise.
 *
 * MOVED HERE IN P6i, from `js/web/api.mjs` where P6b first needed it. The Python is a harness
 * CORE primitive (`child.relative_to(parent)` in a try/except), and its second caller is
 * `_install_move_list` in `js/uninstall.mjs` \u2014 a CLI-level module that must not import the
 * web tree to reach it. Beside `normcase`, which is the thing it is actually about.
 * `js/web/api.mjs` re-exports it so its existing importers are unchanged.
 */
export function within(child, parent) {
  const c = normcase(child).split(/[\\/]/);
  const p = normcase(parent).split(/[\\/]/);
  return p.length <= c.length && p.every((seg, i) => c[i] === seg);
}

/**
 * A number as `json.loads` produced it, carrying the literal it was parsed from.
 *
 * `json.loads` yields an `int` for `20` and a `float` for `1.0`, and Python's `str()`
 * renders those as `20` and `1.0`. `JSON.parse` collapses both to the IEEE double `1`,
 * and `String(1.0)` is `"1"` — so an `agent-overrides.json` carrying `"temperature": 1.0`
 * emits `temperature: 1.0` from Python and `temperature: 1` from Node.
 *
 * That divergence is invisible to the golden harness: the emit always writes an EMPTY
 * overrides stub, so no golden cell has ever had an override to render. It is only
 * reachable on a real user's machine, which is the worst place to find it.
 */
class PyNumber {
  constructor(value, source) { this.value = value; this.source = source; }
  valueOf() { return this.value; }
  toString() { return pyStr(this); }

  /**
   * Re-serialising parsed JSON must round-trip the way Python's does. Without this,
   * `JSON.stringify` would walk the wrapper and emit `{"value":1,"source":"1.0"}`.
   * `JSON.rawJSON` (Node >= 21) writes the text verbatim, and `pyStr` supplies the text
   * Python would have \u2014 NOT the original literal, because `json.dumps(json.loads('1.50'))`
   * is `1.5`: Python re-formats through repr rather than echoing the source.
   */
  toJSON() { return JSON.rawJSON(pyStr(this)); }
}

/**
 * `json.loads(text)`, preserving the int/float distinction (see `PyNumber`).
 *
 * Uses the reviver's `context.source` (Node >= 21). Where it is unavailable the numbers
 * come back bare and `pyStr` throws rather than formatting them wrongly — a loud failure
 * on an old runtime beats bytes that differ from Python's only for some values.
 */
export function parseJson(text) {
  return JSON.parse(text, function (key, value, context) {
    return typeof value === 'number' && context && typeof context.source === 'string'
      ? new PyNumber(value, context.source)
      : value;
  });
}

/** `repr(float)` — the half of `pyStr` where the two languages disagree most. */
function pyFloat(n) {
  if (Number.isNaN(n)) return 'nan';
  if (!Number.isFinite(n)) return n > 0 ? 'inf' : '-inf';
  const a = Math.abs(n);
  if (a !== 0 && (a >= 1e16 || a < 1e-4)) {
    // Python leaves positional notation outside [1e-4, 1e16); JS's own thresholds are
    // 1e-6 and 1e21, and it writes a one-digit exponent where Python pads to two.
    const [mantissa, exp] = n.toExponential().split('e');
    return `${mantissa}e${exp[0] === '-' ? '-' : '+'}${exp.slice(1).padStart(2, '0')}`;
  }
  // Both engines print the shortest round-tripping decimal, but JS drops the fractional
  // part of an integral value: `String(1.0)` is '1' where `repr(1.0)` is '1.0'. And
  // `String(-0)` is '0' where `repr(-0.0)` keeps the sign.
  const s = Object.is(n, -0) ? '-0' : String(n);
  return s.includes('.') || s.includes('e') ? s : `${s}.0`;
}

/**
 * `str(value)` for a value that came out of `json.loads` — what an f-string interpolates.
 *
 * Only the types the generator actually renders are handled. A list, dict or bool reaching
 * here would print as `[object Object]` / `true` where Python prints `[1, 2]` / `True`, so
 * it throws instead: an override file with a value nobody has decided the semantics for is
 * a question to answer, not a byte to guess at.
 */
/**
 * Python truthiness — `if value:` — for a value that came out of `json.loads`.
 *
 * `Boolean()` is not it, and the gap is not academic: a `PyNumber` is an OBJECT, so
 * `Boolean(PyNumber(0))` is `true` where Python's `if 0` is false. In the other direction
 * `Number('0')` is `0` where Python's `if "0"` is true. Both spellings appear in the
 * override tests, so neither shortcut is safe.
 */
export function pyTruthy(value) {
  if (value === undefined || value === null || value === false) return false;
  if (typeof value === 'string') return value !== '';
  if (value instanceof PyNumber) return value.value !== 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return Boolean(value);
}

export function pyStr(value) {
  if (typeof value === 'string') return value;
  if (value instanceof PyNumber) {
    // `json.decoder` picks parse_float for any literal carrying a fraction or an exponent
    // and parse_int otherwise — so the literal, not the resulting double, is what decides.
    // Ints are exact in Python at any width; BigInt keeps that (and normalises `-0`).
    return /[.eE]/.test(value.source) ? pyFloat(value.value) : BigInt(value.source).toString();
  }
  if (typeof value === 'number') {
    throw new TypeError(`pyStr got a bare number (${value}); parse JSON with parseJson so `
      + `int 1 and float 1.0 stay distinguishable, as they are in Python`);
  }
  throw new TypeError(`pyStr has no Python-agreeing rendering for ${typeof value}`);
}

/**
 * `repr(value)` for the values a theme or an override file can hold.
 *
 * Python quotes strings with `'`, switching to `"` only when the string contains a `'`
 * and no `"`, and spells the three singletons with a capital. Anything else is a
 * container, whose repr differs structurally; guessing at a rendering would be worse
 * than failing, so it falls through to `pyStr`.
 *
 * Lives here rather than beside its first caller because `pyAscii` below is the same
 * function with one more escaping rule, and two copies of the quote choice would be two
 * things to keep in agreement.
 *
 * Containers ARE rendered, unlike in `pyStr`, and the difference is not an inconsistency.
 * `pyStr` interpolates into an emitted file, where a shape nobody decided the semantics
 * for must be a question rather than a guessed byte. `repr` renders a value into a WARNING
 * about that very value — a list in `.geneseed-srcdirs.json` is precisely what the warning
 * exists to report, and throwing there would turn "this file is corrupt" into a crash. The
 * value always came from JSON, so the type set is closed and the rendering is exact.
 */
function pyReprImpl(v, ascii) {
  if (typeof v === 'string') {
    let body = '';
    for (const ch of v) {                 // by CODE POINT: `\U########` is one escape
      const cp = ch.codePointAt(0);
      if (ch === '\\') body += '\\\\';
      else if (ch === '\n') body += '\\n';
      else if (ch === '\r') body += '\\r';
      else if (ch === '\t') body += '\\t';
      else if (cp < 0x20 || cp === 0x7f) body += `\\x${cp.toString(16).padStart(2, '0')}`;
      else if (cp < 0x7f) body += ch;
      else if (!ascii) body += ch;        // repr() keeps printable non-ASCII verbatim
      else if (cp <= 0xff) body += `\\x${cp.toString(16).padStart(2, '0')}`;
      else if (cp <= 0xffff) body += `\\u${cp.toString(16).padStart(4, '0')}`;
      else body += `\\U${cp.toString(16).padStart(8, '0')}`;
    }
    // The quote choice reads the ESCAPED body, which is safe: no escape sequence above
    // introduces a quote character, so a `'` or `"` in it came from the input.
    return body.includes("'") && !body.includes('"')
      ? `"${body}"`
      : `'${body.replaceAll("'", "\\'")}'`;
  }
  if (v === null) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (Array.isArray(v)) return `[${v.map((x) => pyReprImpl(x, ascii)).join(', ')}]`;
  if (typeof v === 'object' && !(v instanceof PyNumber)) {
    // JSON object keys are always strings, so `repr(key)` is the string branch above.
    return `{${Object.entries(v)
      .map(([k, x]) => `${pyReprImpl(k, ascii)}: ${pyReprImpl(x, ascii)}`)
      .join(', ')}}`;
  }
  return pyStr(v);
}

export function pyRepr(v) {
  return pyReprImpl(v, false);
}

/**
 * `ascii(value)` — `repr()` with every non-ASCII character escaped as well.
 *
 * Used where a warning quotes a value that came out of a file a user (or another tool)
 * may have written: `build`'s prune guard names the suspicious dir name it refused to
 * delete from `.geneseed-srcdirs.json`. Escaping is the point — a dir name carrying a
 * newline or a right-to-left override must be readable in the warning, not act on the
 * terminal, and Python already made that choice by spelling it `ascii()` rather than an
 * f-string.
 *
 * The two share ONE implementation on purpose. The first draft gave `pyAscii` its own
 * container and quote handling, and a mutation exposed the consequence immediately:
 * `pyRepr`'s container branches became unreachable, so half of the code was dead and
 * neither copy's escaping could drift without the other silently keeping the gate green.
 */
export function pyAscii(v) {
  return pyReprImpl(v, true);
}

/**
 * `print()` — the two output funnels, with Python's newline translation reproduced.
 *
 * The STREAM twin of `writeText` above, and it lives beside it because it is the same rule:
 * `sys.stdout` is a TextIOWrapper with `newline=None`, so on Windows every `\n` a CLI prints
 * leaves the process as `\r\n` — and `harness.py`'s `reconfigure(encoding="utf-8")` changes
 * the encoding only, not that. `process.stdout` translates nothing, so a Node CLI would hand
 * its caller different BYTES than the Python one: measured at 176 vs 171 for one `context`
 * run before this existed.
 *
 * `harness_golden.py` structurally cannot see the difference — `subprocess` decodes with
 * universal newlines on the way back, folding both shapes to `\n` before any cell compares
 * them, the same shape as the shim's exclusion from `golden.py`. So the gate for it is
 * `test_the_two_entry_points_agree_on_stdout_BYTES`, which captures raw bytes. Moved here
 * from `js/hooks.mjs` in P5c, when `js/excludes.mjs` became the second caller: a translation
 * that exists twice is a translation that can be fixed once.
 */
const xlate = (s) => (EOL === '\n' ? s : s.replaceAll('\n', EOL));
export const pyPrint = (s) => process.stdout.write(xlate(s));
export const pyPrintErr = (s) => process.stderr.write(xlate(s));

/**
 * Hold `fn`'s stderr, and emit it only if `fn` RETURNS.
 *
 * The reproduction of `except SystemExit` for a port that writes its refusal at the raise
 * site (`js/generate.mjs`'s `sysExit` docblock states the convention). `sys.exit(msg)`
 * attaches the message to the EXCEPTION and the interpreter prints it on the way out, so a
 * Python caller that catches sees no output at all — which makes write-at-the-raise-site
 * identical for every caller that lets the throw propagate, and wrong for every caller that
 * catches.
 *
 * MOVED HERE beside `pyPrintErr`, whose writes it intercepts, when the hook became the
 * second and third such caller: `js/hosts.mjs`'s `expanduser` refuses a `~user` path by
 * printing and throwing, and `js/hooks.mjs` catches it twice — once per `excludes.json`
 * entry and once around `$GENESEED_ROOT`/`--root`. Its old docblock in `js/doctor.mjs`
 * warned that a general helper "would invite a second caller that wanted silence the
 * noise". That warning stands and is the contract: this is for a message that belonged to
 * an exception NOBODY LET ESCAPE, never for quieting output a call legitimately makes —
 * which is why the held chunks are replayed in full on the success path.
 */
export function withDiscardableStderr(fn) {
  const real = process.stderr.write.bind(process.stderr);
  const held = [];
  process.stderr.write = (chunk) => { held.push(chunk); return true; };
  try {
    const value = fn();
    process.stderr.write = real;
    for (const chunk of held) real(chunk);
    return value;
  } finally {
    process.stderr.write = real;
  }
}

/**
 * The same rule applied to a whole CALL rather than to one string — `bin/geneseed.mjs`'s
 * answer to the newline item P5e recorded and could not gate.
 *
 * WHY THE DRIVER NEEDS A FUNNEL WHERE EVERY OTHER CALLER NEEDS `pyPrint`. The generator
 * prints from ~25 sites across `bin/geneseed.mjs`, `js/emit.mjs`, `js/settings.mjs`,
 * `js/opencode.mjs`, `js/native.mjs` and `js/render.mjs`, and those modules are ALSO the
 * body of the `GENESEED_NO_JS` seam child, whose `main` buffers both streams and hands them
 * to a Python parent that re-prints them through `print()`. Converting those sites to
 * `pyPrint` would translate once in Node and again in Python — `\r\r\n` on every line, on the
 * path `tests/golden.py` drives 259 times. So the translation belongs to whichever process
 * OWNS the stream, and the seam child does not own it. This wraps the driver's `main`, and
 * only the driver's `main`.
 *
 * The item it closes: a plain `--emit files` handed its caller 104 bytes where `python
 * build.py` handed over 105, and `tests/golden.py`'s `text=True` capture folds both to the
 * same string. `test_the_two_entry_points_agree_on_stdout_BYTES` grew a `build` row (through
 * `harness build`, which calls this `main` in-process) and a `rebuild-all` row, and those are
 * what can see it.
 *
 * A Buffer chunk passes through untouched: `writeText` owns file bytes and nothing on this
 * path writes binary to a stream, so translating one would be corrupting data rather than
 * reproducing Python.
 */
export function withPyNewlines(fn) {
  if (EOL === '\n') return fn();
  const outW = process.stdout.write.bind(process.stdout);
  const errW = process.stderr.write.bind(process.stderr);
  const wrap = (real) => (chunk, ...rest) => real(
    typeof chunk === 'string' ? xlate(chunk) : chunk, ...rest,
  );
  process.stdout.write = wrap(outW);
  process.stderr.write = wrap(errW);
  try {
    return fn();
  } finally {
    process.stdout.write = outW;
    process.stderr.write = errW;
  }
}

/**
 * `len(s)` — CODE POINTS, where `String.length` counts UTF-16 units.
 *
 * They differ on every astral character: `len("𝔊")` is 1 and `"𝔊".length` is 2. Only
 * matters where a length becomes layout, which is exactly what the status panel does with
 * it — a theme name or a memory path outside the BMP would shear the frame by one column
 * per character under `.length`.
 */
export const pyLen = (s) => [...s].length;

/**
 * `str.ljust(width)` — pad with spaces to `width` CODE POINTS, never truncate.
 *
 * `String.padEnd` counts UTF-16 units, so it is `pyLen`'s difference again, one call later.
 */
export const pyLjust = (s, width) => s + ' '.repeat(Math.max(0, width - pyLen(s)));

/**
 * `str(PurePath(s))` — separators normalised to the platform's, `.` components dropped,
 * duplicate separators collapsed, a trailing one removed.
 *
 * `path.normalize` is NOT this: it also collapses `a/../b` to `b`, and `PurePath` keeps the
 * `..` because a symlinked `a` makes those two different directories. The distinction is
 * live in `js/excludes.mjs`, where a hand-edited `excludes.json` entry is compared against a
 * RESOLVED repo path — Python never matches a `..` entry there, and a normalising port would
 * match it and unwire a file the reference would have left alone.
 */
/**
 * `shutil.which(cmd, path=None)` — the first executable named `cmd` on PATH, or null.
 *
 * `doctor` runs `node --check` over the OpenCode plugins and SKIPS the whole check when node
 * is not on PATH. `process.execPath` is not that: it is always set, so a port that used it
 * would run the check in a world where the reference silently declines to — the divergence a
 * PATH-removal refutation is aimed at, and the reason this is a real lookup rather than one
 * line of "we are node, we know where node is".
 *
 * The Windows half is the part with behaviour in it, and three of its four rules were
 * MEASURED against CPython 3.13 rather than assumed. `PATHEXT` supplies the suffixes, and the
 * returned path carries PATHEXT's OWN SPELLING of the extension rather than the file's
 * (`zzcmd.CMD` for a `zzcmd.cmd` on disk). An extension already in that set means the command
 * is spelled in full. An EMPTY PATH entry is not skipped either: `join('', cmd)` is a
 * relative path, and Python answers with one.
 *
 * THE FOURTH RULE IS THE CURRENT DIRECTORY, and it was measured on a machine that could not
 * see it. `shutil.which` prepends `os.curdir` to the search — even to a `path=` given
 * explicitly — when `_winapi.NeedCurrentDirectoryForExePath` says so, and that Win32 call
 * answers TRUE unless `NoDefaultCurrentDirectoryInExePath` is DEFINED in the environment.
 * Git Bash and this repo's developer machine both define it, so the reference answered None
 * there and the first draft's "the current directory is NOT prepended — it was until 3.12"
 * described an environment variable it had mistaken for a version change. GitHub's Windows
 * runner does not define it: the reference answered `.\\geneseed.CMD` for a `geneseed` looked
 * up beside the repo root, this returned null, and the parity corpus said so on the first CI
 * run. The variable is an INPUT, so it is read here rather than baked, and
 * `test_the_curdir_rule_agrees_in_both_environment_states` runs the corpus with it both ways.
 *
 * Gated as a pure function over a seeded directory in `tests/test_pure_function_parity.py`:
 * a cell can only ever observe the one answer this machine's PATH gives.
 */
export function pyWhich(cmd, searchPath = null) {
  const win = process.platform === 'win32';
  const isExec = (p) => {
    try {
      if (!statSync(p).isFile()) return false;
      accessSync(p, X_OK);
      return true;
    } catch { return false; }
  };
  // A command with a directory separator is not looked up at all — Python checks it as given.
  if (cmd.includes('/') || (win && cmd.includes('\\'))) return isExec(cmd) ? cmd : null;
  const exts = win
    ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [];
  const spelled = win && exts.some((e) => cmd.toLowerCase().endsWith(e.toLowerCase()));
  // `os.path.join`, which CONCATENATES where `path.join` NORMALISES. The difference shows the
  // moment a PATH entry is spelled with the other separator — routine on Windows, where Git
  // Bash and MSYS put forward-slash entries in it — and the answer is the string a caller
  // then spawns. Measured: the corpus case with a posix-spelled directory was the one that
  // differed, and `path.join` had rewritten the whole path rather than appending to it.
  const joinRaw = (dir, name) => (
    dir === '' || /[\\/]$/.test(dir) || (win && dir.endsWith(':'))
      ? dir + name : dir + path.sep + name);
  const dirs = (searchPath ?? process.env.PATH ?? '').split(path.delimiter);
  // `NeedCurrentDirectoryForExePath(cmd)`: TRUE — so `.` goes in FRONT — unless the variable
  // is defined. Only reachable with a separator-free `cmd`, which is the only way execution
  // gets this far. Inserted before the dedupe, exactly where `shutil.which` inserts it, so a
  // PATH that already names `.` is searched once.
  if (win && process.env.NoDefaultCurrentDirectoryInExePath === undefined) dirs.unshift('.');
  const seen = new Set();
  for (const dir of dirs) {
    const key = win ? dir.toLowerCase() : dir;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const ext of (!win || spelled ? [''] : exts)) {
      const candidate = joinRaw(dir, cmd + ext);
      if (isExec(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * `pathlib.Path(s).is_absolute()`, which is NOT `path.isAbsolute(s)` on Windows.
 *
 * MEASURED against CPython 3.13, and the two disagree on exactly one shape: a ROOTLESS
 * absolute path. `/x/AGENT.md` and `\x\AGENT.md` are `True` to `path.isAbsolute` and `False`
 * to Python, which requires a DRIVE (`C:/x`) or a UNC root (`//server/share/x`) before it
 * calls a Windows path absolute. `C:x/AGENT.md` — a drive-RELATIVE path — is False to both.
 * On POSIX the two rules coincide and this is `s.startsWith('/')`.
 *
 * Written in P5h for `installAgentEntry`, which filters an OpenCode config's `instructions`
 * for the entries that are NOT absolute in order to tell a project install's relative
 * `…/AGENT.md` from a global install's absolute one. A hand-edited config naming
 * `/repo/AGENT.md` is the reachable input: Python keeps that entry and Node would have
 * skipped it and fallen through to the literal `AGENT.md`, unwiring nothing.
 *
 * ONE OWNER, and the five pre-existing `path.isAbsolute` calls in `js/` were READ rather than
 * assumed to be copies. Three cannot reach the divergence — `js/doctor.mjs` and
 * `bin/geneseed.mjs` test the output of `path.relative`, which is never rootless-absolute,
 * and `js/emit.mjs`'s `safePriorDirName` is `&&`-guarded by `basename(p) === p` immediately
 * after. The two in `js/hooks.mjs` (a context entry's `path`) DO carry the same hazard and
 * are deliberately not repointed here: that is the hook entry's shipped behaviour, no
 * `context` cell varies it, and changing it in this phase would be an ungated edit to a verb
 * that crossed three phases ago. Recorded in the spec's "Still owed" with this reproduction.
 *
 * Gated by a corpus in `tests/test_pure_function_parity.py`: no cell can vary the shape.
 */
export function pyIsAbsolute(s) {
  if (process.platform !== 'win32') return s.startsWith('/');
  // Python is absolute iff the path has a DRIVE (or UNC share) *and* a root — `C:x` has the
  // drive and no root, `/x` has the root and no drive, and neither is absolute. In
  // `path.parse` terms that is exactly "the root is longer than a bare separator AND ends in
  // one": `C:` for `C:x`, `\` for `\x`, `C:\` for `C:\x`, `\\srv\share\` for a UNC path.
  // The first draft tested `root !== '\\'`, which called `C:x` absolute; the corpus caught
  // it on the two drive-relative cases and nothing else would have.
  const root = path.parse(s).root;
  return root.length > 1 && /[\\/]$/.test(root);
}

/**
 * `int(s)` for a base-10 string — the VALUE, or null where Python raises `ValueError`.
 *
 * Null rather than a throw because both call sites branch on the failure rather than
 * propagate it: `askChoice` falls through to matching the answer against the option KEYS,
 * and `javaMajorOk` treats an unparseable major as "not new enough". Python spells the same
 * two branches as `except ValueError`.
 *
 * Three things separate this from `Number(s)` and each one changes an answer:
 *
 *   * `Number('')` is 0 and `int('')` raises. So is `Number(' ')`, and `Number('0x10')` is
 *     16 where `int('0x10')` raises — a wizard answer of `0x2` must fall through to the key
 *     match, not select option 16.
 *   * PEP 515 underscores: `int('1_0')` is 10, `Number('1_0')` is NaN. Leading, trailing and
 *     doubled ones still raise, so the rule is "between digits" and not "strip them".
 *   * `int()` accepts any Unicode decimal digit — `int('٣')` is 3 — and `Number('٣')` is NaN.
 *     Every `Nd` block is exactly ten contiguous code points, so a digit's value is its
 *     offset from the first `Nd` code point at or below it, which is what the walk finds.
 *
 * Surrounding whitespace is Python's to strip and both callers have already done it, so this
 * does NOT strip: `int(' 1')` is 1, but reproducing that here would need Python's
 * `str.isspace()` set, which is a separate standing item.
 *
 * Gated by a corpus in `tests/test_pure_function_parity.py` — a primitive reproduction gets
 * one owner and a corpus, never a cell (P5c).
 */
export function pyInt(s) {
  if (typeof s !== 'string' || s === '') return null;
  let body = s;
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
      // Only BETWEEN digits: a leading, trailing or doubled underscore is a ValueError.
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
  if (!prevWasDigit) return null;   // a trailing underscore
  return Number(sign === -1 ? -value : value);
}

/**
 * `str(Path(x))` — and it is PLATFORM-SHAPED, because `Path` is.
 *
 * `Path` is `WindowsPath` on Windows and `PosixPath` everywhere else, and the two parsers
 * disagree about the two things below. A body that is right on one host is therefore wrong
 * on the other, which is exactly how this one passed a whole Windows suite and failed two
 * cases on the first Linux run of `tests/test_pure_function_parity.py`:
 *
 *   * SEPARATORS. `ntpath` treats `\` and `/` alike; `posixpath` treats `\` as an ordinary
 *     filename character. `str(PurePosixPath('C:\\x\\bin\\'))` is that string VERBATIM —
 *     one component, trailing backslash and all — where splitting on both answered
 *     `C:/x/bin`. A backslash is legal in a Linux filename, so this is not academic.
 *   * THE DOUBLE-SLASH ROOT. POSIX gives EXACTLY two leading slashes an
 *     implementation-defined meaning and `PurePosixPath` preserves them; three or more
 *     collapse to one. `path.posix.parse` reports a one-character root for every case, so
 *     `//server/share` came back as `/server/share`.
 *
 * NOT reproduced, and named here rather than left as a gap nobody wrote down: `//` and
 * `///x` on WINDOWS, where `PureWindowsPath` answers `\\` and `\\\x` and this answers `\`
 * and `\x`. Those are incomplete UNC prefixes and matching them needs ntpath's share-name
 * parsing; both inputs are kept OUT of the corpus in `tests/test_pure_function_parity.py`
 * instead of sitting in it wrong.
 *
 * The root's separators are still rewritten ONE AT A TIME, never `replace(/[\\/]+/g, sep)`:
 * a UNC root's leading pair is part of it, so collapsing runs turns `//server/share/x` into
 * `\server\share\x`.
 */
export function pyPathStr(s) {
  const win = path.sep === '\\';
  let raw = path.parse(s).root;
  if (!win && raw && /^\/\/(?!\/)/.test(s)) raw = '//';
  const root = raw.replace(/[\\/]/g, path.sep);
  const seps = win ? /[\\/]+/ : /\/+/;
  const parts = s.slice(raw.length).split(seps).filter((p) => p !== '' && p !== '.');
  const tail = parts.join(path.sep);
  if (!root) return tail || '.';
  return root + tail;
}

/**
 * `urllib.parse.unquote(s)` — percent-decoding as Python does it, which is NOT
 * `decodeURIComponent`.
 *
 * The whole difference is what happens to a sequence that is not an escape.
 * `decodeURIComponent('a%ZZ')` throws a `URIError`, and so does a trailing bare `%`; the
 * web shell would answer both as a 500 where the reference answers a 404 naming the
 * literal text. `unquote` leaves them alone: CPython builds a table of every two-hex-digit
 * pair in both cases and treats a `KeyError` as "this was not an escape", emitting `%` and
 * the rest of the fragment verbatim.
 *
 * The outer split on `([\x00-\x7f]+)` is Python's too, and it is not decoration: only the
 * ASCII runs are candidates for decoding, so a literal non-ASCII character already in the
 * path is passed through rather than mixed into the byte buffer. Consecutive escapes ARE
 * accumulated before decoding, which is what makes `%C3%A9` one `é` and not two
 * replacement characters.
 *
 * `Buffer.toString('utf-8')` substitutes U+FFFD for an undecodable sequence, which is
 * `errors='replace'`. The two decoders can disagree on HOW MANY replacement characters a
 * truncated multi-byte sequence yields — Python's maximal-subpart rule against WHATWG's —
 * and the corpus in `tests/test_pure_function_parity.py` is where that is measured rather
 * than assumed.
 */
const HEX_PAIR = /^[0-9A-Fa-f]{2}$/;

function unquoteToBytes(run) {
  const bits = run.split('%');
  if (bits.length === 1) return Buffer.from(run, 'latin1');
  const out = [Buffer.from(bits[0], 'latin1')];
  for (const item of bits.slice(1)) {
    const pair = item.slice(0, 2);
    if (HEX_PAIR.test(pair)) {
      out.push(Buffer.from([parseInt(pair, 16)]), Buffer.from(item.slice(2), 'latin1'));
    } else {
      out.push(Buffer.from(`%${item}`, 'latin1'));
    }
  }
  return Buffer.concat(out);
}

export function pyUnquote(s) {
  if (!s.includes('%')) return s;
  // `re.split` with ONE capture group alternates [gap, group, gap, group, …], so the ASCII
  // runs are the odd indices on both sides.
  const bits = s.split(/([\x00-\x7f]+)/);
  let res = bits[0];
  for (let i = 1; i < bits.length; i += 2) {
    res += unquoteToBytes(bits[i]).toString('utf-8');
    res += bits[i + 1] ?? '';
  }
  return res;
}

/**
 * Python's `\s` for a `str` pattern, as a character-class BODY — measured, not recalled.
 *
 * The two languages' whitespace classes are nearly the same and the difference had been
 * carried as a standing item reading "differing from JS `\s` only at U+FEFF". That was
 * incomplete in both directions, and a corpus over `slugifyHeading` is what found it:
 *
 *     python \s = js \s  -  U+FEFF  +  U+001C..U+001F  +  U+0085
 *
 * JavaScript counts the byte-order mark as whitespace and Python does not; Python counts
 * the four C0 information separators and the NEL, and JavaScript does not. Neither shows
 * up in a docs heading anyone has written — which is exactly why it took a corpus rather
 * than a cell, and why it is spelled out here rather than approximated with `\s`.
 */
export const PY_SPACE = '\t\n\v\f\r \u001c-\u001f\u0085\u00a0\u1680'
  + '\u2000-\u200a\u2028\u2029\u202f\u205f\u3000';

const PY_STRIP_RE = new RegExp(`^[${PY_SPACE}]+|[${PY_SPACE}]+$`, 'g');
const PY_LSTRIP_RE = new RegExp(`^[${PY_SPACE}]+`);
const PY_RSTRIP_RE = new RegExp(`[${PY_SPACE}]+$`);

/** `str.strip()` — Python's whitespace set, which `String.trim()`'s is not. */
export function pyStripSpace(s) {
  return s.replace(PY_STRIP_RE, '');
}

/**
 * `str.lstrip()` / `str.rstrip()` — the ONE-SIDED halves, over the same `PY_SPACE`.
 *
 * P2 added them for `_build_render._insert_theme_keys`, which uses all three spellings within
 * four lines (`lines[0].strip()`, `ln.lstrip().startswith('"')`,
 * `lines[pred].rstrip().endswith(",")`). They are here rather than in `js/themes.mjs` for the
 * reason this file exists at all: `js/settings.mjs` already carries a private second copy of
 * the character class, and a THIRD one — in the module that decides where a comma goes in a
 * committed theme file — is how the three drift apart. One owner of the set, three views of it.
 */
export function pyLStripSpace(s) {
  return s.replace(PY_LSTRIP_RE, '');
}

export function pyRStripSpace(s) {
  return s.replace(PY_RSTRIP_RE, '');
}
