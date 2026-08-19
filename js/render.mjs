/**
 * The generator's render core, in Node — the first half of the port.
 *
 * This is a faithful translation of `_build_render.py`'s pure text pipeline: load a
 * theme, lay the fixed neutral STRUCTURE over it, inline INCLUDE directives, resolve
 * AGENT.md's CATALOG blocks, substitute {{TOKENS}}, and hand back every source file with
 * its themed output path. It writes nothing and reads nothing but `src/` and `themes/`.
 *
 * WHY THIS HALF AND NOT MORE. The emits split into five stages —
 * RENDER* -> WIRE* -> PRUNE -> MANIFEST -> VERIFY (see `_build_global._emit_claude_core`
 * and tests/test_emit_phase_order.py). RENDER produces files Geneseed owns wholesale;
 * WIRE reconciles files the user co-owns (settings.json, opencode.json, the CLAUDE.md
 * managed block) and stays in Python for now, in `_build_settings.py`. Node takes RENDER
 * because it is the only stage whose output is a pure function of the source tree.
 *
 * PARITY IS THE CONTRACT, NOT THE INTENT. Every function here has a named Python
 * counterpart and must produce byte-identical output for it; tests/test_render_parity.py
 * drives both over every theme x footprint x posture x mode and byte-compares the
 * written trees. Where Python and JS semantics differ silently — path sort order,
 * `.suffix`, `splitlines`, universal newlines — the difference is spelled out at the
 * call site rather than left to the reader.
 *
 * NO MODULE-LEVEL MUTABLE CONFIG. `_build_core` is the single owner of the source/theme
 * roots and the posture/mode selection precisely because copies of those names made
 * redirects half-work. The JS side keeps that property structurally: the four values
 * travel in one explicit `cfg` object, so there is nothing to copy and nothing to
 * redirect.
 */
import { readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { readText, parseJson, normcase, comparePaths } from './lib/fs.mjs';

/** Document STRUCTURE is theme-INDEPENDENT — mirrors `_build_render.STRUCTURE`. */
export const STRUCTURE = {
  HARNESS: 'Geneseed', CHARTER: 'Charter', CONTEXT: 'Context',
  SCRIPT: 'Script', SCRIPTS: 'Scripts',
  DIR_LAWS: 'laws', DIR_AGENTS: 'agents', DIR_SKILLS: 'skills', DIR_MEMORY: 'memory',
  DIR_NOTEBOOK: 'notebook', DIR_ONTOLOGY: 'ontology', DIR_DOCTRINES: 'doctrines',
  // Ontology section names. Theme-INDEPENDENT on purpose: a citation reads
  // `({{ONTOLOGY}}: {{ONT_TELOS}})` — token on both sides, so the heading and every
  // reference to it move together and a rename can never desync them.
  ONT_TELOS: 'Telos', ONT_EVIDENCE: 'Evidence', ONT_DECISIONS: 'Decisions',
  ONT_CONDUCT: 'Conduct',
};

/**
 * Source top-level dirs whose OUTPUT name is themed. Mirrors `SRC_DIR_TOKENS`.
 * Exported because `js/emit.mjs`'s `build` resolves the same tokens to decide which
 * dirs it owns and wipes — one owner, so the two cannot disagree about a folder name.
 */
export const SRC_DIR_TOKENS = {
  laws: 'DIR_LAWS', agents: 'DIR_AGENTS', skills: 'DIR_SKILLS',
  memory: 'DIR_MEMORY', notebook: 'DIR_NOTEBOOK',
  ontology: 'DIR_ONTOLOGY', doctrines: 'DIR_DOCTRINES',
};

const TEXT_SUFFIXES = new Set(['.md', '.tmpl', '.json', '.txt', '.yml', '.yaml']);

const TOKEN_RE = /\{\{([A-Z_]+)\}\}/g;
const INCLUDE_RE = /^[ \t]*<!--[ \t]*INCLUDE:[ \t]*(?<path>[^ \t]+)[ \t]*-->[ \t]*$/gm;
const CATALOG_BLOCK_RE =
  /[ \t]*<!-- CATALOG:begin -->\n(?<table>[\s\S]*?)[ \t]*<!-- CATALOG:else -->\n(?<pointer>[\s\S]*?)[ \t]*<!-- CATALOG:end -->\n/g;

/**
 * `PurePath.suffix`. Not `path.extname`: Python returns '' for a name whose only dot is
 * leading (`.gitignore`) or trailing (`foo.`), where `extname` returns '' and '.'
 * respectively. Neither spelling is in TEXT_SUFFIXES, so the divergence is invisible
 * today — which is exactly why it is written out rather than relied upon.
 */
function suffixOf(name) {
  const i = name.lastIndexOf('.');
  return 0 < i && i < name.length - 1 ? name.slice(i) : '';
}

/** `Path.rglob("*")` restricted to files, then `sorted()`. */
function sortedSourceFiles(src) {
  const out = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (name === '__pycache__') continue;          // `"__pycache__" in path.parts`
      if (statSync(full).isDirectory()) walk(full);  // rglob yields dirs; render_all skips them
      else out.push(full);
    }
  })(src);
  return out.sort(comparePaths);   // `sorted()` — case-folded on Windows only
}

/** `_build_render.load_theme`. Throws where Python calls `sys.exit`. */
export function loadTheme(cfg, name) {
  const p = path.join(cfg.themes, `${name}.json`);
  if (!existsSync(p)) {
    const available = readdirSync(cfg.themes)
      .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
      .map((f) => f.slice(0, -5)).sort().join(', ');
    // `sys.exit(<str>)` — the message on stderr, exit 1 — spelled the way
    // `assertSourceComplete` spells it: written at the raise site, and the throw carries
    // only the marker. ⚠ It was once described as an unreachable nicety under
    // `bin/geneseed.mjs`, on the grounds that `--theme` is validated against `choices` before
    // anything renders — it is not: `--theme` takes a value and has no `choices` entry, so THIS
    // is the refusal, on every path. It is also reachable from `geneseed status`, which takes
    // its theme from a `.geneseed-theme`
    // marker — an unvalidated file in a user's install. A bare `throw` there printed a Node
    // stack trace where Python printed one line, and the acceptance matrix is what said so.
    process.stderr.write(`[geneseed] unknown theme '${name}'. available: ${available}\n`);
    const e = new Error(`unknown theme '${name}'`);
    e.exitCode = 1;
    throw e;
  }
  // parseJson, not JSON.parse: one rule for every JSON the generator reads, so a numeric
  // theme value keeps the int/float distinction Python's `str()` and `repr()` render
  // differently. No shipped theme has one today; `_theme_json`'s ACCENT and the
  // AGENT_COLORS validation warning are both one authoring typo away from needing it.
  return parseJson(readText(p));
}

/** `_build_render.substitute`. */
export function substitute(text, theme) {
  return text.replace(TOKEN_RE, (whole, key) => {
    if (!Object.prototype.hasOwnProperty.call(theme, key)) return whole;  // visible for debugging
    const v = theme[key];
    // Python renders `str(theme[key])`, which agrees with JS only for strings —
    // `str(True)`/`String(true)` and `str({...})`/`String({...})` do not. Every one of
    // the 148 tokens the source tree actually uses resolves to a string today
    // (AGENT_COLORS is a dict but is never a token), so a non-string here means the
    // source or a theme grew a case nobody has decided the semantics for. Fail loudly
    // rather than emit `[object Object]` into somebody's AGENT.md.
    if (typeof v !== 'string') {
      throw new TypeError(`theme token {{${key}}} is ${typeof v}, not a string — Python's `
        + `str() and JS's String() disagree here; decide the rendering explicitly`);
    }
    return v;
  });
}

/** `_build_render._resolve_catalogs`. */
export function resolveCatalogs(text, nativeCatalog) {
  return text.replace(CATALOG_BLOCK_RE, (_m, table, pointer) => (nativeCatalog ? pointer : table));
}

/**
 * `re.split(r"(?m)^(?=### )", text)`.
 *
 * Hand-rolled rather than `String.split` with a lookahead: splitting on a zero-width
 * match is a corner both engines implement, and the leading '' Python produces when the
 * text starts with a heading is load-bearing (it becomes `blocks[0]`, the preamble).
 */
function splitAtLawHeadings(text) {
  const out = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if ((i === 0 || text[i - 1] === '\n') && text.startsWith('### ', i)) {
      out.push(text.slice(start, i));
      start = i;
    }
  }
  out.push(text.slice(start));
  return out;
}

/** `_build_render._terse_laws`. */
export function terseLaws(text, theme, lawsPrefix = '') {
  const blocks = splitAtLawHeadings(text);
  const out = [blocks[0].trimEnd()];
  for (const b of blocks.slice(1)) {
    // Python's `splitlines()` also breaks on VT, FF, FS-RS, NEL, LINE SEPARATOR and
    // PARAGRAPH SEPARATOR, where `split('\n')` does not. The law corpus is plain
    // markdown and readText has already folded CRLF and CR to LF, so the sets coincide.
    // (Spelling those out by name rather than by literal is not fussiness: the first
    // draft of this comment contained the actual LINE/PARAGRAPH SEPARATOR characters,
    // which are JS line terminators, and they ended the comment mid-sentence.)
    const lines = b.split('\n');
    const heading = lines[0].trimEnd();
    const body = lines.slice(1).map((l) => l.trim()).join(' ').trim();
    const m = /^([\s\S]+?[.!?])(?:\s|$)/.exec(body);
    out.push(`${heading}\n${m ? m[1].trim() : body}`);
  }
  const law = theme.LAW ?? 'Law';
  const lawsDir = theme.DIR_LAWS ?? 'laws';
  const pointer =
    `> Each ${law} above is given in brief — the rule, not its reasoning. The `
    + `complete, binding text of every ${law} is in \`${lawsPrefix}${lawsDir}/universal.md\`; `
    + `read it whenever a ${law}'s application is unclear, and before any act touching `
    + `secrets, deletion, git history, scope, or untrusted content.`;
  return out.join('\n\n') + '\n\n' + pointer;
}

/** `_build_render.render_file`. */
export function renderFile(cfg, filePath, theme, footprint = 'full', lawsPrefix = '',
                           visiting = new Set(), nativeCatalog = false) {
  const here = path.resolve(filePath);
  let text = readText(filePath);

  text = text.replace(INCLUDE_RE, (_whole, rel) => {
    const target = path.resolve(cfg.src, rel);
    if (!existsSync(target)) return `<!-- MISSING INCLUDE: ${rel} -->`;
    if (normcase(target) === normcase(here) || visiting.has(normcase(target))) {
      return `<!-- CIRCULAR INCLUDE: ${rel} -->`;
    }
    let inner = renderFile(cfg, target, theme, footprint, lawsPrefix,
                          new Set(visiting).add(normcase(here)), nativeCatalog)
      .replace(/\n+$/, '');                              // `.rstrip("\n")`
    if (footprint === 'lean' && rel === 'laws/universal.md') {
      inner = terseLaws(inner, theme, lawsPrefix);
    }
    return inner;
  });

  text = resolveCatalogs(text, nativeCatalog);
  return substitute(text, theme);
}

/** `_build_render._posture_body` / `_mode_body` — one helper, both registers. */
function registerBody(cfg, theme, dir, selected, fallback) {
  for (const name of [selected, fallback]) {
    const p = path.join(cfg.src, dir, `${name}.md`);
    if (existsSync(p) && statSync(p).isFile()) return substitute(readText(p), theme).trim();
  }
  return '';
}

/**
 * `_build_render.effective_theme`.
 *
 * `cfg.structure` overrides the constant below when the driver supplies one, and it
 * always does. STRUCTURE is a module-level dict on the Python side that tests MUTATE to
 * simulate a themed DIR_* rename (`SrcDirRenameOrphanTests`); in-process that reaches
 * every reader because the splice shares one dict object, and across a process boundary
 * it reaches nothing at all unless it travels. The constant stays as the default for the
 * parity harnesses, which drive this module directly.
 */
export function effectiveTheme(cfg, themeName) {
  const theme = { ...loadTheme(cfg, themeName), ...(cfg.structure ?? STRUCTURE) };
  theme.POSTURE_BODY = registerBody(cfg, theme, 'postures', cfg.posture ?? 'peer', 'peer');
  theme.MODE_BODY = registerBody(cfg, theme, 'modes', cfg.mode ?? 'direct', 'direct');
  return theme;
}

/** `_build_render.themed_rel` — rename the top-level folder of an output path per theme. */
export function themedRel(rel, theme) {
  const parts = rel.split(path.sep);
  if (parts.length && Object.prototype.hasOwnProperty.call(SRC_DIR_TOKENS, parts[0])) {
    parts[0] = theme[SRC_DIR_TOKENS[parts[0]]] ?? parts[0];
  }
  return parts.join(path.sep);
}

/**
 * `_build_render.dest_rel` — AGENT.md.tmpl -> AGENT.md; gitignore -> .gitignore;
 * everything else keeps its name.
 *
 * WHY THE IGNORE FILES ARE STORED WITHOUT THE DOT — the Python twin's comment carries the
 * full argument. In short: `src/memory/.gitignore` and `src/notebook/.gitignore` are
 * product content, and under their real names `npm install` renamed them to `.npmignore`
 * on extraction (so an npm-installed Geneseed emitted bundles with NO `.gitignore` and
 * leaked the user's agent memory into their repo) while `npm pack` read the notebook's
 * `*` as a live ignore rule and dropped its sibling README. A file named `gitignore` is
 * invisible to all three; the dot goes back on here. Emitted bytes unchanged.
 */
export function destRel(rel) {
  // path.join normalises the '.' that dirname returns for a bare filename, so a
  // top-level AGENT.md.tmpl comes back as 'AGENT.md', not './AGENT.md'.
  const name = path.basename(rel);
  if (name === 'AGENT.md.tmpl') return path.join(path.dirname(rel), 'AGENT.md');
  if (name === 'gitignore') return path.join(path.dirname(rel), '.gitignore');
  return rel;
}

/**
 * `_build_render.render_all`.
 *
 * Returns `{ theme, items }` where each item is `{ rel, text, src }` — `rel` is the
 * themed POSIX output path, `text` is the rendered text or `null` for a binary that the
 * caller copies from `src`. Python returns a tuple of tuples; the object form is the
 * same data with the field names the Python docstring already uses.
 */
export function renderAll(cfg, themeName, {
  footprint = 'full', lawsPrefix = '', nativeCatalog = false,
} = {}) {
  const theme = effectiveTheme(cfg, themeName);
  const items = [];
  for (const file of sortedSourceFiles(cfg.src)) {
    const rel = path.relative(cfg.src, file);
    const outRel = destRel(themedRel(rel, theme)).split(path.sep).join('/');  // as_posix()
    items.push(TEXT_SUFFIXES.has(suffixOf(path.basename(file)))
      ? { rel: outRel, text: renderFile(cfg, file, theme, footprint, lawsPrefix, new Set(), nativeCatalog), src: file }
      : { rel: outRel, text: null, src: file });
  }
  return { theme, items };
}
