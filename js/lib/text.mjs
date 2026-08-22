/**
 * String primitives — measuring, padding, stripping, decoding and reading an integer.
 *
 * These are definitions, not an adaptation of somebody else's; see `fs.mjs` for why the
 * measurements against CPython are recorded per function and why the `py` prefix stays.
 * Every function here is where Python's answer and the Node default DIVERGE: `pyLen` counts
 * code points where `.length` counts units, `PY_SPACE` is a wider set than `String.trim`'s,
 * `pyInt` accepts what `Number()` does not and rejects what it does, and `pyUnquote` leaves
 * a bad escape alone where `decodeURIComponent` throws.
 */
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

