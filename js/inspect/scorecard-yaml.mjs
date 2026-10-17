/**
 * The YAML subset `geneseed scorecard` reads CI configs with — PyYAML's YAML 1.1 behaviour for
 * the shapes upstream's `ci_parser.py` meets, and Python's `str()`/`bool()` over the result.
 *
 * WHY ITS OWN FILE: it is a parser, not a port of a scorecard module — nothing in it knows what
 * a CI job is. `scorecard.mjs` re-exports its public names, so callers keep one import site.
 * The `ponytail:` note on `parseYamlSubset` states its ceiling.
 */

class YamlError extends Error {}

/** A flow mapping (`{a: b}`), kept as its source text — the subset does not look inside one. */
export class FlowMap {
  constructor(raw) { this.raw = raw; }
}

const NULLS = new Set(['', '~', 'null', 'Null', 'NULL']);
const TRUES = new Set(['yes', 'Yes', 'YES', 'true', 'True', 'TRUE', 'on', 'On', 'ON']);
const FALSES = new Set(['no', 'No', 'NO', 'false', 'False', 'FALSE', 'off', 'Off', 'OFF']);

/**
 * PyYAML's YAML 1.1 resolver for a plain scalar: null, the eighteen booleans (`on` is `True`,
 * which is why upstream looks the GitHub trigger key up under both `"on"` and `True`), ints and
 * floats. Everything else stays a string.
 */
function resolvePlain(s) {
  if (NULLS.has(s)) return null;
  if (TRUES.has(s)) return true;
  if (FALSES.has(s)) return false;
  if (/^[-+]?(0|[1-9][0-9_]*)$/.test(s)) return Number(s.replaceAll('_', ''));
  if (/^[-+]?([0-9][0-9_]*)?\.[0-9_]*([eE][-+][0-9]+)?$/.test(s) && /[0-9]/.test(s)) {
    return Number(s.replaceAll('_', ''));
  }
  return s;
}

/**
 * `str(value)` for what the subset produces. A collection prints as Python's `repr`, because
 * that is the command text upstream matches: `- echo "a: b"` in a GitLab script is a MAPPING
 * to YAML, and `str()` of it is `{'echo "a': 'b"'}`.
 */
export function pyStr(v) {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (v instanceof FlowMap) return v.raw;
  if (Array.isArray(v)) return `[${v.map(pyRepr).join(', ')}]`;
  if (v instanceof Map) return `{${[...v].map(([k, x]) => `${pyRepr(k)}: ${pyRepr(x)}`).join(', ')}}`;
  return String(v);
}

function pyRepr(v) {
  if (typeof v !== 'string') return pyStr(v);
  const q = v.includes("'") && !v.includes('"') ? '"' : "'";
  const body = v.replace(/[\\\n\r\t]/g, (c) => ({ '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\t': '\\t' })[c])
    .replaceAll(q, `\\${q}`);
  return `${q}${body}${q}`;
}

/** `bool(value)` — `allow_failure: {exit_codes: [1]}` and `"false"` are both TRUE upstream. */
export function pyTruthy(v) {
  if (v === null || v === undefined || v === false) return false;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string' || Array.isArray(v)) return v.length > 0;
  if (v instanceof Map) return v.size > 0;
  if (v instanceof FlowMap) return v.raw.replace(/\s/g, '') !== '{}';
  return true;
}

/** Fold the line breaks inside a multi-line flow or quoted scalar: one break is a space. */
function foldBreaks(s) {
  return s.replace(/[ \t]*\n([ \t]*\n)*[ \t]*/g, (m) => {
    const n = m.split('\n').length - 1;
    return n === 1 ? ' ' : '\n'.repeat(n - 1);
  });
}

const ESCAPES = { n: '\n', t: '\t', r: '\r', 0: '\0', '"': '"', '\\': '\\', '/': '/', ' ': ' ', e: '\x1b', a: '\x07', b: '\b', f: '\f', v: '\v', N: '\x85', _: '\xa0' };

function unescapeDouble(s) {
  return s.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/gs, (m, e) => {
    if (e.length > 1) return String.fromCodePoint(parseInt(e.slice(1), 16));
    if (e in ESCAPES) return ESCAPES[e];
    throw new YamlError(`unknown escape \\${e}`);
  });
}

/** Index just past the closing quote of the quoted scalar starting at `s[0]`, or -1. */
function quoteEnd(s) {
  const q = s[0];
  for (let i = 1; i < s.length; i += 1) {
    if (q === '"' && s[i] === '\\') { i += 1; continue; }
    if (s[i] === q) {
      if (q === "'" && s[i + 1] === "'") { i += 1; continue; }
      return i + 1;
    }
  }
  return -1;
}

function quotedValue(span) {
  const body = span.slice(1, -1);
  if (span[0] === "'") return foldBreaks(body).replaceAll("''", "'");
  // A `\` before a line break escapes the break itself: no space is folded in for it.
  return unescapeDouble(foldBreaks(body.replace(/(?<!\\)\\\n[ \t]*/g, '')));
}

/** Index just past the bracket that closes `s[0]`, honouring quotes; -1 while still open. */
function flowEnd(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if ((c === '"' || c === "'") && /^$|[\s[{,]/.test(s[i - 1] ?? '')) {
      const e = quoteEnd(s.slice(i));
      if (e < 0) return -1;
      i += e - 1;
    } else if (c === '[' || c === '{') depth += 1;
    else if (c === ']' || c === '}') { depth -= 1; if (depth === 0) return i + 1; }
  }
  return -1;
}

/** A flow sequence of scalars becomes an array; a flow mapping anywhere stays opaque. */
function parseFlow(src) {
  if (src[0] === '{') return new FlowMap(src);
  const items = [];
  let i = 1;
  while (i < src.length - 1) {
    while (/[\s,]/.test(src[i]) && i < src.length - 1) i += 1;
    if (i >= src.length - 1) break;
    const rest = src.slice(i, -1);
    let end;
    if (rest[0] === '[' || rest[0] === '{') {
      end = flowEnd(rest);
      items.push(parseFlow(rest.slice(0, end)));
    } else if (rest[0] === '"' || rest[0] === "'") {
      end = quoteEnd(rest);
      items.push(quotedValue(rest.slice(0, end)));
    } else {
      end = rest.search(/,|$/);
      items.push(resolvePlain(foldBreaks(rest.slice(0, end)).trim()));
    }
    i += end;
  }
  return items;
}

/**
 * The CI-config YAML subset upstream's checks read, parsed into Maps, arrays and scalars.
 *
 * Returns the document, or `undefined` where PyYAML's `safe_load` would RAISE — and upstream
 * then drops the whole file (`_load_yaml` answers `None`), so a raise is behaviour to keep, not
 * an error to paper over. Raised here: a second document, a local tag such as GitLab's
 * `!reference` (unknown to `safe_load`), a plain value holding `: `, a tab used as indentation.
 *
 * Handles block mappings and sequences (including a sequence at its key's own indent, and a
 * mapping that starts on the `- ` line), `|`/`>` block scalars with chomping and indentation
 * indicators, plain scalars (multi-line, ` #` comments), single- and double-quoted scalars
 * (escapes, multi-line), flow sequences of scalars, `&anchor` prefixes and `!!` tags.
 *
 * ponytail: a subset, not YAML. Its ceiling: flow MAPPINGS are kept opaque (`FlowMap`), so a
 * job or rule written `{...}` is invisible; aliases (`*x`) and merge keys (`<<: *x`) are not
 * resolved — an alias reads as the string `*x` — which is the likeliest real miss on GitLab
 * files that share `before_script` through anchors; `? ` complex keys are refused;
 * multi-document files are refused as PyYAML refuses them. Upgrade path: vendor a YAML parser
 * under `js/vendor/` (CLAUDE.md: never install one) once a scored repo needs any of those.
 */
export function parseYamlSubset(text) {
  try {
    return new YamlParser(text).document();
  } catch (e) {
    if (e instanceof YamlError) return undefined;
    throw e;
  }
}

class YamlParser {
  constructor(text) {
    this.raw = text.replace(/^\uFEFF/, '').split('\n');
    this.lines = this.raw.map((r) => {
      const indent = r.length - r.replace(/^ +/, '').length;
      const text = r.slice(indent).replace(/\s+$/, '');
      // A tab where indentation goes is a YAML error — raised by `peek`, on content lines only.
      return { indent, text: text.replace(/^\t+/, ''), tab: text.startsWith('\t') };
    });
    this.pos = 0;
  }

  document() {
    let started = false;
    let i = 0;
    for (; i < this.lines.length; i += 1) {
      const { indent, text } = this.lines[i];
      if (indent === 0 && /^---(\s|$)/.test(text)) {
        if (started) throw new YamlError('a second document');
        started = true;
        this.lines[i] = { indent: 0, text: '' };
      } else if (indent === 0 && /^\.\.\.(\s|$)/.test(text)) {
        this.lines.length = i;
        break;
      } else if (indent === 0 && text.startsWith('%') && !started) {
        this.lines[i] = { indent: 0, text: '' };
      } else if (text && !text.startsWith('#')) {
        started = true;
      }
    }
    const value = this.node(0);
    if (this.peek() !== null) throw new YamlError('content after the document');
    return value;
  }

  /** Index of the next line that is neither blank nor a comment, or null. */
  peek() {
    for (let i = this.pos; i < this.lines.length; i += 1) {
      const { text } = this.lines[i];
      if (text && !text.startsWith('#')) {
        if (this.lines[i].tab) throw new YamlError('a tab as indentation');
        this.pos = i;
        return i;
      }
    }
    this.pos = this.lines.length;
    return null;
  }

  node(minIndent) {
    const i = this.peek();
    if (i === null || this.lines[i].indent < minIndent) return null;
    const { indent, text } = this.lines[i];
    if (isSeqItem(text)) return this.seq(indent);
    if (splitKey(text)) return this.map(indent);
    this.pos = i + 1;
    return this.value(text, indent - 1);
  }

  /** The value of `key:` with nothing after it — or of a bare `-`. */
  nested(indent, sameIndentSeq) {
    const i = this.peek();
    if (i === null) return null;
    const ln = this.lines[i];
    if (sameIndentSeq && ln.indent === indent && isSeqItem(ln.text)) return this.seq(indent);
    return ln.indent > indent ? this.node(ln.indent) : null;
  }

  map(indent) {
    const m = new Map();
    for (let i = this.peek(); i !== null; i = this.peek()) {
      const ln = this.lines[i];
      if (ln.indent < indent || (ln.indent === indent && isSeqItem(ln.text))) break;
      if (ln.indent > indent) throw new YamlError('bad indentation');
      const kv = splitKey(ln.text);
      if (!kv) throw new YamlError('expected a key');
      this.pos = i + 1;
      // Python dicts keep the FIRST position of a duplicate key and the LAST value; so do Maps.
      m.set(kv.key, kv.rest === '' || kv.rest.startsWith('#')
        ? this.nested(indent, true) : this.value(kv.rest, indent));
    }
    return m;
  }

  seq(indent) {
    const arr = [];
    for (let i = this.peek(); i !== null; i = this.peek()) {
      const ln = this.lines[i];
      if (ln.indent < indent || !isSeqItem(ln.text)) break;
      if (ln.indent > indent) throw new YamlError('bad indentation');
      const after = ln.text.slice(1);
      const body = after.trimStart();
      if (body === '' || body.startsWith('#')) {
        this.pos = i + 1;
        arr.push(this.nested(indent, false));
      } else {
        // `- key: v` opens a mapping whose keys sit at the column `key` starts in: re-read the
        // rest of this line as a node of its own at that column.
        const col = indent + 1 + (after.length - body.length);
        this.lines[i] = { indent: col, text: body };
        arr.push(this.node(col));
      }
    }
    return arr;
  }

  /** A value that starts on the current line, after `key: ` or `- `. */
  value(rest, parentIndent) {
    let s = rest;
    for (;;) {
      const anchor = /^&\S+\s*/.exec(s);
      if (anchor) { s = s.slice(anchor[0].length); continue; }
      const tag = /^!(\S*)\s*/.exec(s);
      if (tag) {
        if (!tag[1].startsWith('!')) throw new YamlError(`unknown tag !${tag[1]}`);
        s = s.slice(tag[0].length);
        continue;
      }
      break;
    }
    if (s === '' || s.startsWith('#')) return this.nested(parentIndent, false);
    const c = s[0];
    if (c === '|' || c === '>') return this.block(s, parentIndent);
    if (c === '"' || c === "'" || c === '[' || c === '{') {
      let span = s;
      let end = c === '[' || c === '{' ? flowEnd(span) : quoteEnd(span);
      while (end < 0 && this.pos < this.lines.length) {
        span += `\n${this.raw[this.pos].trim()}`;
        this.pos += 1;
        end = c === '[' || c === '{' ? flowEnd(span) : quoteEnd(span);
      }
      if (end < 0) throw new YamlError('an unterminated scalar');
      const tail = span.slice(end).trim();
      if (tail && !tail.startsWith('#')) throw new YamlError('text after a closed scalar');
      return c === '[' || c === '{' ? parseFlow(span.slice(0, end)) : quotedValue(span.slice(0, end));
    }
    if (c === '*') return s.replace(/\s+#.*$/, '');
    if (c === '@' || c === '`') throw new YamlError('a reserved indicator');
    return resolvePlain(this.plain(s, parentIndent));
  }

  /** A plain scalar and its continuation lines, folded. */
  plain(first, parentIndent) {
    const parts = [first.replace(/\s+#.*$/, '')];
    let blanks = 0;
    if (!/\s#/.test(first)) {
      for (let j = this.pos; j < this.lines.length; j += 1) {
        const { indent, text } = this.lines[j];
        if (!text) { blanks += 1; continue; }
        if (text.startsWith('#') || indent <= parentIndent) break;
        parts.push(blanks ? '\n'.repeat(blanks) : ' ', text.replace(/\s+#.*$/, ''));
        blanks = 0;
        this.pos = j + 1;
        if (/\s#/.test(text)) break;
      }
    }
    const out = parts.join('');
    if (/:(\s|$)/.test(out)) throw new YamlError('mapping values are not allowed here');
    return out.trim();
  }

  block(header, parentIndent) {
    const h = /^([|>])([1-9]?)([+-]?)([1-9]?)\s*(#.*)?$/.exec(header);
    if (!h) throw new YamlError('a bad block scalar header');
    const digit = Number(h[2] || h[4] || 0);
    const chomp = h[3];
    let contentIndent = digit ? parentIndent + digit : null;
    const lines = [];
    let j = this.pos;
    for (; j < this.raw.length && j < this.lines.length; j += 1) {
      const r = this.raw[j];
      if (r.trim() === '') { lines.push(''); continue; }
      const ind = r.length - r.replace(/^ +/, '').length;
      if (contentIndent === null) {
        if (ind <= parentIndent) break;
        contentIndent = ind;
      }
      if (ind < contentIndent) break;
      lines.push(r.slice(contentIndent));
    }
    this.pos = j;
    let trailing = 0;
    while (lines.length && lines[lines.length - 1] === '') { lines.pop(); trailing += 1; }
    let body;
    if (h[1] === '|') {
      body = lines.join('\n');
    } else {
      body = '';
      let prevMore = null;
      let empties = 0;
      for (const l of lines) {
        if (l === '') { empties += 1; continue; }
        const more = /^[ \t]/.test(l);
        if (prevMore === null) body += '\n'.repeat(empties);
        else if (!more && !prevMore) body += empties ? '\n'.repeat(empties) : ' ';
        else body += '\n'.repeat(empties + 1);
        body += l;
        prevMore = more;
        empties = 0;
      }
    }
    if (chomp === '-' || body === '') return chomp === '+' ? body + '\n'.repeat(trailing) : body;
    return chomp === '+' ? `${body}\n${'\n'.repeat(trailing)}` : `${body}\n`;
  }
}

function isSeqItem(text) {
  return text === '-' || /^-[ \t]/.test(text);
}

/** `key: rest` → `{ key, rest }`, or null when the line is not a mapping entry. */
function splitKey(text) {
  if (isSeqItem(text) || text[0] === '[' || text[0] === '{') return null;
  if (text.startsWith('? ')) throw new YamlError('a complex key');
  if (text[0] === '"' || text[0] === "'") {
    const end = quoteEnd(text);
    if (end < 0) return null;
    const m = /^\s*:(\s|$)/.exec(text.slice(end));
    if (!m) return null;
    return { key: quotedValue(text.slice(0, end)), rest: text.slice(end + m[0].length).trim() };
  }
  const m = /:(\s|$)/.exec(text);
  if (!m) return null;
  const hash = text.search(/\s#/);
  if (hash >= 0 && hash < m.index) return null;
  const raw = text.slice(0, m.index).trimEnd();
  const key = resolvePlain(raw);
  // Keys stay strings except the booleans and null, which `data.get(True)` must be able to find.
  return { key: typeof key === 'number' ? raw : key, rest: text.slice(m.index + 1).trim() };
}
