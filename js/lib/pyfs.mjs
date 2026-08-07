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
import { writeFileSync, readFileSync, copyFileSync, statSync, utimesSync } from 'node:fs';
import { EOL } from 'node:os';

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
      + "json.dumps by Python's ', ' / ': ' separators too \u2014 use jsonDumpsIndent, or "
      + 'write the compact-container form when something actually needs it');
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
 * `PurePath._str_normcase` \u2014 Windows compares and sorts paths case-folded, POSIX does
 * not. This is what makes `sorted(SRC.rglob('*'))` and `sorted(d.glob('*.json'))`
 * platform-dependent, and the order is observable: the prompt emitter embeds items in
 * order, and each emit's written list becomes the ownership manifest the prune diffs.
 *
 * Two residual differences, both unreachable with this repo's ASCII filenames: Python
 * compares by code point where JS compares by UTF-16 code unit (differs only above the
 * BMP), and `str.lower()` is not `toLowerCase()` for a handful of characters.
 */
export const normcase = process.platform === 'win32' ? (s) => s.toLowerCase() : (s) => s;

/** `sorted()` over paths \u2014 one owner, so two call sites cannot drift apart. */
export function comparePaths(a, b) {
  const A = normcase(a);
  const B = normcase(b);
  return A < B ? -1 : A > B ? 1 : 0;
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
