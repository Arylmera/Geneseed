/**
 * Quoting and the parsed-value model — `json.dumps`, `json.loads`, and the `str`/`repr`
 * rules that decide what a parsed number renders as.
 *
 * These are definitions, not an adaptation of somebody else's; see `fs.mjs` for why the
 * measurements against CPython are recorded per function, and why NONE of these is the Node
 * default — the warning the retired `py` prefix used to carry now lives in each docblock.
 * A rule here is a frozen fact about what this tool emits — the corpora under
 * `tests/__snapshots__/` compare it byte for byte and can never be re-recorded.
 *
 * `JsonNumber` is why this module holds both the parser and the renderers: the wrapper is
 * created by `parseJson` and read by `formatValue`, `formatRepr`, `isTruthy` and `deepEquals`, so the
 * four cannot be separated from it without a cycle.
 */
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
class JsonNumber {
  constructor(value, source) { this.value = value; this.source = source; }
  valueOf() { return this.value; }
  toString() { return formatValue(this); }

  /**
   * Re-serialising parsed JSON must round-trip the way Python's does. Without this,
   * `JSON.stringify` would walk the wrapper and emit `{"value":1,"source":"1.0"}`.
   * `JSON.rawJSON` (Node >= 21) writes the text verbatim, and `formatValue` supplies the text
   * Python would have \u2014 NOT the original literal, because `json.dumps(json.loads('1.50'))`
   * is `1.5`: Python re-formats through repr rather than echoing the source.
   */
  toJSON() { return JSON.rawJSON(formatValue(this)); }
}

/**
 * `json.loads(text)`, preserving the int/float distinction (see `JsonNumber`).
 *
 * Uses the reviver's `context.source` (Node >= 21). Where it is unavailable the numbers
 * come back bare and `formatValue` throws rather than formatting them wrongly — a loud failure
 * on an old runtime beats bytes that differ from Python's only for some values.
 */
export function parseJson(text) {
  return JSON.parse(text, function (key, value, context) {
    return typeof value === 'number' && context && typeof context.source === 'string'
      ? new JsonNumber(value, context.source)
      : value;
  });
}

/** `repr(float)` — the half of `formatValue` where the two languages disagree most. */
function formatFloat(n) {
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
export function formatValue(value) {
  if (typeof value === 'string') return value;
  if (value instanceof JsonNumber) {
    // `json.decoder` picks parse_float for any literal carrying a fraction or an exponent
    // and parse_int otherwise — so the literal, not the resulting double, is what decides.
    // Ints are exact in Python at any width; BigInt keeps that (and normalises `-0`).
    return /[.eE]/.test(value.source) ? formatFloat(value.value) : BigInt(value.source).toString();
  }
  if (typeof value === 'number') {
    throw new TypeError(`formatValue got a bare number (${value}); parse JSON with parseJson so `
      + `int 1 and float 1.0 stay distinguishable, as they are in Python`);
  }
  throw new TypeError(`formatValue has no Python-agreeing rendering for ${typeof value}`);
}

/**
 * Python truthiness — `if value:` — for a value that came out of `json.loads`.
 *
 * `Boolean()` is not it, and the gap is not academic: a `JsonNumber` is an OBJECT, so
 * `Boolean(JsonNumber(0))` is `true` where Python's `if 0` is false. In the other direction
 * `Number('0')` is `0` where Python's `if "0"` is true. Both spellings appear in the
 * override tests, so neither shortcut is safe.
 */
export function isTruthy(value) {
  if (value === undefined || value === null || value === false) return false;
  if (typeof value === 'string') return value !== '';
  if (value instanceof JsonNumber) return value.value !== 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return Boolean(value);
}

/**
 * `repr(value)` for the values a theme or an override file can hold.
 *
 * Python quotes strings with `'`, switching to `"` only when the string contains a `'`
 * and no `"`, and spells the three singletons with a capital. Anything else is a
 * container, whose repr differs structurally; guessing at a rendering would be worse
 * than failing, so it falls through to `formatValue`.
 *
 * Lives here rather than beside its first caller because `formatReprAscii` below is the same
 * function with one more escaping rule, and two copies of the quote choice would be two
 * things to keep in agreement.
 *
 * Containers ARE rendered, unlike in `formatValue`, and the difference is not an inconsistency.
 * `formatValue` interpolates into an emitted file, where a shape nobody decided the semantics
 * for must be a question rather than a guessed byte. `repr` renders a value into a WARNING
 * about that very value — a list in `.geneseed-srcdirs.json` is precisely what the warning
 * exists to report, and throwing there would turn "this file is corrupt" into a crash. The
 * value always came from JSON, so the type set is closed and the rendering is exact.
 */
function formatReprImpl(v, ascii) {
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
  if (Array.isArray(v)) return `[${v.map((x) => formatReprImpl(x, ascii)).join(', ')}]`;
  if (typeof v === 'object' && !(v instanceof JsonNumber)) {
    // JSON object keys are always strings, so `repr(key)` is the string branch above.
    return `{${Object.entries(v)
      .map(([k, x]) => `${formatReprImpl(k, ascii)}: ${formatReprImpl(x, ascii)}`)
      .join(', ')}}`;
  }
  return formatValue(v);
}

export function formatRepr(v) {
  return formatReprImpl(v, false);
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
 * The two share ONE implementation on purpose. The first draft gave `formatReprAscii` its own
 * container and quote handling, and a mutation exposed the consequence immediately:
 * `formatRepr`'s container branches became unreachable, so half of the code was dead and
 * neither copy's escaping could drift without the other silently keeping the gate green.
 */
export function formatReprAscii(v) {
  return formatReprImpl(v, true);
}

/**
 * Python's `==` for values that came out of `json.loads` \u2014 the operator behind
 * `group in arr`, `rec in canon_flat` and `arr.remove(group)`.
 *
 * `===` is identity for containers, so a naive port of `if group in arr` never matches and
 * `_merge_claude_settings` re-adds its own hook group on every emit \u2014 the exact defect the
 * prior-claim pruning exists to prevent, reintroduced by a one-word translation.
 *
 * `JsonNumber` compares by its VALUE, which is right: Python's `{"a": 1} == {"a": 1.0}` is
 * True even though `repr` renders the two differently. The one gap left is Python's
 * `1 == True`; a settings.json holding a bool where the manifest recorded a number is not
 * a shape any writer here produces.
 */
export function deepEquals(a, b) {
  const x = a instanceof JsonNumber ? a.value : a;
  const y = b instanceof JsonNumber ? b.value : b;
  if (x === null || y === null || typeof x !== 'object' || typeof y !== 'object') {
    return x === y;
  }
  if (Array.isArray(x) !== Array.isArray(y)) return false;
  if (Array.isArray(x)) {
    return x.length === y.length && x.every((v, i) => deepEquals(v, y[i]));
  }
  const kx = Object.keys(x);
  const ky = Object.keys(y);
  return kx.length === ky.length
    && kx.every((k) => Object.prototype.hasOwnProperty.call(y, k) && deepEquals(x[k], y[k]));
}

/** `value in list` and `list.index(value)` under `deepEquals` \u2014 Python's `in`, not `includes`. */
export function indexOfDeepEqual(arr, value) {
  return arr.findIndex((v) => deepEquals(v, value));
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
 * not having it; `js/hosts/settings.mjs` is the code that finally needs it, and the shapes were
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
 * `bareInts` admits a BARE JS number, reading it as a Python `int`. `formatValue` refuses one by
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
  if (v instanceof JsonNumber || typeof v === 'number') {
    const n = v instanceof JsonNumber ? v.value : v;
    if (!Number.isFinite(n)) {
      throw new TypeError(`jsonDumpsCompact got ${n}; Python's encoder writes a bare `
        + 'NaN/Infinity token there, which is not JSON, and nothing here can produce one');
    }
    if (bareInts && typeof v === 'number') {
      return Number.isSafeInteger(n) ? String(n) : formatFloat(n);
    }
    return formatValue(v);
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

