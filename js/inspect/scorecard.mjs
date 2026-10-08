/**
 * `geneseed scorecard` — the AI Harness Scorecard, ported to JavaScript.
 *
 * UPSTREAM: markmishaev76/ai-harness-scorecard, pinned at commit
 * 5536e96227dc8278301eaff3f4ca3faaf13cf278, MIT License, "Copyright (c) 2026 Mark Mishaev".
 * This file ports `repo_context.py`, `ci_parser.py`, `scanner.py`, `models.py` and the JSON
 * reporter; `scorecard-checks.mjs` ports `checks/*.py`. Same 31 check ids, names, points,
 * partial scores, evidence and remediation strings, same category weights and grade thresholds.
 *
 * WHY A PORT AND NOT THE PYTHON TOOL. The CLI runs where Python may not (`ci.yml`'s
 * `package-no-python` job proves the package needs none), and doctor's ratchet has to run
 * in-process: the CLI is under a transitive spawn ban. Upstream uses no subprocess and no
 * network, and neither does this.
 *
 * WHAT IS DELIBERATELY DIFFERENT, and only this:
 *   * Paths are normalised to `/`. Upstream keeps the OS separator, so on Windows its evidence
 *     says `docs\x.md` where this says `docs/x.md`. Matching is unaffected: Python's `fnmatch`
 *     normcases both sides on Windows, and its `*` crosses separators — which the java
 *     indicator `*` + `/pom.xml` matching a pom.xml at ANY depth relies on, and `fnmatch` keeps.
 *   * The file list is sorted by the `/` spelling, i.e. upstream's order on POSIX. Only the
 *     first-match evidence strings can tell, never a score.
 *   * YAML is read by the small subset parser below, not PyYAML — see its `ponytail:` note.
 */
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { isDir, isFile, printErr, printOut, readText, writeText } from '../lib/fs.mjs';
import { ALL_CHECKS } from './scorecard-checks.mjs';
import { badgeUrl, renderSvg } from './scorecard-svg.mjs';

// ---------------------------------------------------------------------------------------------
// The YAML subset
// ---------------------------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------------------------
// ci_parser.py
// ---------------------------------------------------------------------------------------------

const GITLAB_RESERVED_KEYS = new Set([
  'stages', 'variables', 'default', 'include', 'workflow', 'image', 'services',
  'before_script', 'after_script', 'cache', 'artifacts', '.pre', '.post',
]);

const get = (m, k, dflt) => (m.has(k) ? m.get(k) : dflt);

/** `_load_yaml` — `[raw, mapping]`, or `[raw|'', null]` for a non-mapping or a parse failure. */
function loadYaml(file) {
  let raw;
  try { raw = readText(file); } catch { return ['', null]; }
  const data = parseYamlSubset(raw);
  if (data === undefined) return ['', null];
  return [raw, data instanceof Map ? data : null];
}

/** `parse_ci_configs` — `.gitlab-ci.yml`, then `.github/workflows/*.yml`, then `*.yaml`. */
export function parseCiConfigs(root) {
  const configs = [];
  const gitlab = path.join(root, '.gitlab-ci.yml');
  if (isFile(gitlab)) {
    const c = parseGitlabCi(...loadYaml(gitlab));
    if (c) configs.push(c);
  }
  const wf = path.join(root, '.github', 'workflows');
  if (isDir(wf)) {
    let names = [];
    try { names = readdirSync(wf); } catch { /* unreadable: no workflows */ }
    for (const suffix of ['.yml', '.yaml']) {
      for (const n of names.filter((x) => x.endsWith(suffix)).sort()) {
        const c = parseGithubActions(...loadYaml(path.join(wf, n)));
        if (c) configs.push(c);
      }
    }
  }
  return configs;
}

function parseGitlabCi(raw, data) {
  if (data === null) return null;
  const config = { ciType: 'gitlab', jobs: [], hasSchedule: false, rawContent: raw };
  config.hasSchedule = gitlabHasSchedule(data);
  for (const [key, value] of data) {
    if (typeof key !== 'string' || key.startsWith('.') || GITLAB_RESERVED_KEYS.has(key)) continue;
    if (!(value instanceof Map)) continue;
    config.jobs.push({
      name: key,
      commands: gitlabCommands(value),
      allowFailure: pyTruthy(get(value, 'allow_failure', false)),
      stage: get(value, 'stage', null),
    });
  }
  return config;
}

/** Every top-level mapping is scanned, reserved ones included — `workflow: rules:` counts. */
function gitlabHasSchedule(data) {
  for (const value of data.values()) {
    if (!(value instanceof Map)) continue;
    const rules = get(value, 'rules', []);
    if (!Array.isArray(rules)) continue;
    for (const rule of rules) {
      if (rule instanceof Map && pyStr(get(rule, 'if', '')).toLowerCase().includes('schedule')) {
        return true;
      }
    }
  }
  return false;
}

function gitlabCommands(job) {
  const commands = [];
  for (const key of ['before_script', 'script', 'after_script']) {
    const s = get(job, key, []);
    if (Array.isArray(s)) commands.push(...s.map(pyStr));
    else if (typeof s === 'string') commands.push(s);
  }
  return commands;
}

function parseGithubActions(raw, data) {
  if (data === null) return null;
  // `data.get("on")`, then `data.get(True)`: YAML 1.1 reads a bare `on:` key as the boolean.
  let on = get(data, 'on', null);
  if (on === null) on = get(data, true, null);
  const config = {
    ciType: 'github', jobs: [], hasSchedule: on instanceof Map && on.has('schedule'), rawContent: raw,
  };
  const jobs = get(data, 'jobs', new Map());
  if (!(jobs instanceof Map)) return config;
  for (const [name, job] of jobs) {
    if (!(job instanceof Map)) continue;
    const commands = [];
    const uses = job.get('uses');
    if (typeof uses === 'string') commands.push(`uses: ${uses}`);
    const steps = get(job, 'steps', []);
    for (const step of Array.isArray(steps) ? steps : []) {
      if (!(step instanceof Map)) continue;
      if (step.has('run')) commands.push(pyStr(step.get('run')));
      if (step.has('uses')) commands.push(`uses: ${pyStr(step.get('uses'))}`);
    }
    config.jobs.push({
      name: pyStr(name), commands, allowFailure: pyTruthy(get(job, 'continue-on-error', false)), stage: null,
    });
  }
  return config;
}

// ---------------------------------------------------------------------------------------------
// repo_context.py
// ---------------------------------------------------------------------------------------------

const LANGUAGE_INDICATORS = {
  rust: ['Cargo.toml'],
  python: ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt'],
  javascript: ['package.json'],
  typescript: ['tsconfig.json'],
  go: ['go.mod'],
  java: ['pom.xml', '*/pom.xml', 'build.gradle', '*/build.gradle', 'build.gradle.kts', '*/build.gradle.kts'],
  ruby: ['Gemfile'],
  csharp: ['*.csproj', '*.sln'],
  swift: ['Package.swift'],
  kotlin: ['build.gradle.kts', '*/build.gradle.kts'],
};

const IGNORED_DIRS = new Set([
  '.git', 'node_modules', 'target', '__pycache__', '.venv', 'venv', 'dist', 'build', '.tox',
  '.mypy_cache', '.pytest_cache', 'vendor', '.bundle', '.cargo',
]);

const FNMATCH_CACHE = new Map();

/**
 * `fnmatch(path.lower(), pattern.lower())`: anchored, `*` crossing `/`, `?` one character.
 *
 * ponytail: no `[...]` classes — none of the 31 checks' patterns uses one. Add the class branch
 * of `fnmatch.translate` when a pattern needs it.
 */
function fnmatch(name, pattern) {
  let re = FNMATCH_CACHE.get(pattern);
  if (!re) {
    const src = pattern.toLowerCase().replace(/[.+^${}()|[\]\\/]/g, '\\$&')
      .replace(/\*+/g, '.*').replace(/\?/g, '.');
    re = new RegExp(`^(?:${src})$`, 's');
    FNMATCH_CACHE.set(pattern, re);
  }
  return re.test(name.toLowerCase());
}

/** `os.walk` minus `IGNORED_DIRS` at every depth; a symlinked directory is listed but not entered. */
function scanFileTree(root) {
  const files = [];
  const walk = (dir, rel) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!IGNORED_DIRS.has(e.name)) walk(path.join(dir, e.name), r);
      } else if (e.isSymbolicLink()) {
        let d = false;
        try { d = statSync(path.join(dir, e.name)).isDirectory(); } catch { /* broken: a file */ }
        if (!d) files.push(r);
      } else {
        files.push(r);
      }
    }
  };
  walk(root, '');
  return files.sort();
}

/** `RepoContext` — the pre-scanned repo every check reads. */
export class RepoContext {
  constructor(root) {
    this.path = path.resolve(root);
    this.fileTree = scanFileTree(this.path);
    this.languages = Object.keys(LANGUAGE_INDICATORS)
      .filter((lang) => LANGUAGE_INDICATORS[lang].some((p) => this.hasFile(p))).sort();
    this.ciConfigs = parseCiConfigs(this.path);
    this.scripts = this.loadScripts();
  }

  hasFile(...patterns) {
    for (const p of patterns) {
      for (const f of this.fileTree) if (fnmatch(f, p)) return f;
    }
    return null;
  }

  findFiles(...patterns) {
    const out = [];
    for (const p of patterns) for (const f of this.fileTree) if (fnmatch(f, p)) out.push(f);
    return out;
  }

  hasDir(...patterns) {
    return patterns.find((p) => isDir(path.join(this.path, p))) ?? null;
  }

  readFile(rel) {
    const full = path.join(this.path, rel);
    if (!isFile(full)) return null;
    try { return readText(full); } catch { return null; }
  }

  searchFile(rel, pattern) {
    const content = this.readFile(rel);
    return content !== null && new RegExp(pattern, 'im').test(content);
  }

  searchAnyFile(filePatterns, textPattern) {
    for (const fp of filePatterns) {
      for (const f of this.fileTree) {
        if (fnmatch(f, fp) && this.searchFile(f, textPattern)) return f;
      }
    }
    return null;
  }

  ciHasCommand(pattern) {
    const re = new RegExp(pattern, 'i');
    return this.ciConfigs.some((ci) => ci.jobs.some((j) => this.matchesCommand(j.commands, re)));
  }

  ciHasBlockingCommand(pattern) {
    const re = new RegExp(pattern, 'i');
    return this.ciConfigs.some((ci) => ci.jobs.some(
      (j) => !j.allowFailure && this.matchesCommand(j.commands, re),
    ));
  }

  matchesCommand(commands, re) {
    return commands.some((cmd) => {
      if (re.test(cmd)) return true;
      const resolved = this.resolveScript(cmd);
      return Boolean(resolved) && re.test(resolved);
    });
  }

  ciHasScheduledJob() {
    return this.ciConfigs.some((ci) => ci.hasSchedule);
  }

  ciRawContent() {
    return this.ciConfigs.map((ci) => ci.rawContent).join('\n');
  }

  loadScripts() {
    const content = this.readFile('package.json');
    if (!content) return new Map();
    let data;
    try { data = JSON.parse(content); } catch { return new Map(); }
    const scripts = data && typeof data === 'object' && !Array.isArray(data) ? data.scripts : null;
    if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) return new Map();
    return new Map(Object.entries(scripts).map(([k, v]) => [k, pyStr(v)]));
  }

  /** `npm run X` / `yarn X` / `pnpm X` / `bun X` → the body of package.json's script X. */
  resolveScript(command) {
    const parts = command.split(/\s+/).filter(Boolean);
    if (parts.length < 2) return null;
    const pm = parts[0].toLowerCase();
    if (!['npm', 'yarn', 'pnpm', 'bun'].includes(pm)) return null;
    let name = null;
    if (parts[1].toLowerCase() === 'run') {
      if (parts.length >= 3) name = parts[2];
    } else if (pm !== 'npm') {
      name = parts[1];
    }
    return name && this.scripts.has(name) ? this.scripts.get(name) : null;
  }
}

// ---------------------------------------------------------------------------------------------
// scanner.py + models.py
// ---------------------------------------------------------------------------------------------

const CATEGORY_CONFIG = {
  documentation: ['Architectural Documentation', 0.20],
  constraints: ['Mechanical Constraints', 0.25],
  testing: ['Testing & Stability', 0.25],
  review: ['Review & Drift Prevention', 0.15],
  ai_safeguards: ['AI-Specific Safeguards', 0.15],
};

const GRADES = [['A', 85], ['B', 70], ['C', 55], ['D', 40]];

const GRADE_DESCRIPTIONS = {
  A: 'Strong harness. AI-generated code has robust mechanical safeguards.',
  B: 'Good foundation. Some gaps in enforcement or feedback loops.',
  C: 'Basic practices present but insufficient for safe AI scaling.',
  D: 'Significant gaps. AI code likely accumulating undetected debt.',
  F: 'No meaningful harness. AI output is essentially unaudited.',
};

export function computeGrade(score) {
  return GRADES.find(([, t]) => score >= t)?.[0] ?? 'F';
}

/**
 * `assess_repo` — every check over `dir`. Scores stay unrounded here, summed in upstream's
 * order (checks, then categories, from 0) so the floating-point totals are the same doubles;
 * rounding is the renderers' job, as it is the reporters' upstream.
 */
export function assessRepo(dir) {
  const ctx = new RepoContext(dir);
  const categories = Object.entries(ALL_CHECKS).map(([id, checks]) => {
    const [name, weight] = CATEGORY_CONFIG[id];
    const results = checks.map((c) => c.run(ctx));
    const score = results.reduce((a, c) => a + c.score, 0);
    const maxScore = results.reduce((a, c) => a + c.maxPoints, 0);
    const percentage = maxScore === 0 ? 0 : (score / maxScore) * 100;
    return { id, name, weight, score, maxScore, percentage, checks: results };
  });
  const overallScore = categories.reduce((a, c) => a + c.percentage * c.weight, 0);
  const grade = computeGrade(overallScore);
  return {
    repoPath: ctx.path,
    repoName: path.basename(ctx.path),
    languages: ctx.languages,
    overallScore,
    grade,
    gradeDescription: GRADE_DESCRIPTIONS[grade],
    totalChecks: categories.reduce((a, c) => a + c.checks.length, 0),
    passedChecks: categories.reduce((a, c) => a + c.checks.filter((k) => k.passed).length, 0),
    categories,
  };
}

/**
 * Python's `round(x, 1)`: the nearest double's decimal value decides, and an exact tie goes to
 * the even digit. `toFixed` already rounds the exact binary value, which settles every case
 * but the exact tie (x.x5 representable exactly, e.g. 0.25), where it rounds away from zero.
 */
export function round1(x) {
  // `toFixed(30)` spells the double's exact decimal expansion, so an exact tie shows as one.
  if (/\.\d50*$/.test(Math.abs(x).toFixed(30))) {
    const down = Math.trunc(Math.abs(x) * 10);
    return (Math.sign(x) * (down % 2 === 0 ? down : down + 1)) / 10;
  }
  return Number(x.toFixed(1));
}

/** The JSON payload: upstream's reporter shape, keys renamed to this module's camelCase. */
export function renderJson(a) {
  const r = (x) => round1(x);
  return `${JSON.stringify({
    ...a,
    overallScore: r(a.overallScore),
    categories: a.categories.map((c) => ({
      ...c, score: r(c.score), maxScore: r(c.maxScore), percentage: r(c.percentage),
      checks: c.checks.map((k) => ({ ...k, score: r(k.score), maxPoints: r(k.maxPoints) })),
    })),
  }, null, 2)}\n`;
}

/** The text report: grade, the per-pillar table, then every check that is not at full marks. */
export function renderText(a) {
  const out = [
    `AI Harness Scorecard — ${a.repoName}`,
    `Grade ${a.grade} — ${round1(a.overallScore)}/100 (${a.passedChecks}/${a.totalChecks} checks passing)`,
    a.gradeDescription,
    '',
  ];
  const w = Math.max(...a.categories.map((c) => c.name.length));
  for (const c of a.categories) {
    out.push(`  ${c.name.padEnd(w)}  ${String(round1(c.percentage)).padStart(5)}%  `
      + `(weight ${Math.round(c.weight * 100)}%)`);
  }
  const gaps = a.categories.flatMap((c) => c.checks.filter((k) => k.score < k.maxPoints));
  if (gaps.length) {
    out.push('', 'To improve:');
    for (const k of gaps) {
      out.push(`  ${k.passed ? '~' : 'x'} ${k.name} (${round1(k.score)}/${round1(k.maxPoints)}) — ${k.evidence}`);
      if (k.remediation) out.push(`      fix: ${k.remediation}`);
    }
  }
  out.push('', 'Scores the repo (CI, tests, docs), not the harness files. Upstream: '
    + 'markmishaev76/ai-harness-scorecard (MIT).');
  return `${out.join('\n')}\n`;
}

/** The verb: a reading, never a gate — exit 0 whatever the grade. */
export function cmdScorecard(args) {
  const dir = path.resolve(args.path ?? process.cwd());
  if (!isDir(dir)) {
    printErr(`[scorecard] not a directory: ${dir}\n`);
    return 1;
  }
  const a = assessRepo(dir);
  if (args.svg) {
    // The README card (`scorecard-svg.mjs`). Written, not printed: an SVG on a terminal helps
    // nobody, and the path is where doctor's freshness check reads it back.
    writeText(path.resolve(args.svg), renderSvg(a));
    printOut(`[scorecard] ${a.grade} ${round1(a.overallScore)}/100 → ${args.svg}\n`
      + `[scorecard] README badge: ${badgeUrl(a)}\n`);
    return 0;
  }
  printOut(args.json ? renderJson(a) : renderText(a));
  return 0;
}
