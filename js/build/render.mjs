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
 * managed block) and lives in `js/hosts/settings.mjs`, driven from the two emit modules.
 * THIS module is only RENDER
 * because it is the only stage whose output is a pure function of the source tree.
 *
 * PARITY IS THE CONTRACT, NOT THE INTENT. Every function here has a named Python
 * counterpart and had to produce byte-identical output for it. The reference is gone, so
 * what holds the line is `tests/golden.mjs --against`, replaying recorded emit cells;
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
import { readText } from '../lib/fs.mjs';
import { parseJson } from '../lib/json.mjs';
import { normcase, comparePaths } from '../lib/paths.mjs';
// `js/build/source.mjs` imports nothing but node builtins, so this direction cannot cycle.
import { PACK_ORDER, readPackText } from './source.mjs';

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
 * Exported because `js/build/bundle.mjs`'s `build` resolves the same tokens to decide which
 * dirs it owns and wipes — one owner, so the two cannot disagree about a folder name.
 */
export const SRC_DIR_TOKENS = {
  laws: 'DIR_LAWS', agents: 'DIR_AGENTS', skills: 'DIR_SKILLS',
  memory: 'DIR_MEMORY', notebook: 'DIR_NOTEBOOK',
  ontology: 'DIR_ONTOLOGY', doctrines: 'DIR_DOCTRINES',
};

const TEXT_SUFFIXES = new Set(['.md', '.tmpl', '.json', '.txt', '.yml', '.yaml']);

// Digits are legal after the first character: `DOC_<PACK>_<n>` (the doctrine rule titles) are
// the first token names in the project to carry one, and without `0-9` here `{{DOC_CRAFT_1}}`
// silently never substitutes. A leading digit stays illegal, so `{{1}}` is still not a token.
const TOKEN_RE = /\{\{([A-Z_][A-Z0-9_]*)\}\}/g;
const INCLUDE_RE = /^[ \t]*<!--[ \t]*INCLUDE:[ \t]*(?<path>[^ \t]+)[ \t]*-->[ \t]*$/gm;
const CATALOG_BLOCK_RE =
  /[ \t]*<!-- CATALOG:begin -->\n(?<table>[\s\S]*?)[ \t]*<!-- CATALOG:else -->\n(?<pointer>[\s\S]*?)[ \t]*<!-- CATALOG:end -->\n/g;
// The footprint twin of CATALOG. Before it existed, `lean` could only reach the two
// include-driven corpora (`laws/universal.md` and the doctrine packs, both truncated
// mechanically to heading + first sentence); every other section of the root template was
// byte-identical across footprints, which is how ~1.5k tokens of §-level prose rode into
// every lean install. A LEAN block ships a HAND-WRITTEN condensation instead of a
// truncation — the objection `docs/token-footprint.md` raised against terse-ing the
// Ontology ("four orphan sentences") is answered by authoring the short form, not
// generating it. Same marker grammar as CATALOG so the two stay learnable as one idea.
const LEAN_BLOCK_RE =
  /[ \t]*<!-- LEAN:begin -->\n(?<full>[\s\S]*?)[ \t]*<!-- LEAN:else -->\n(?<lean>[\s\S]*?)[ \t]*<!-- LEAN:end -->\n/g;

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

/**
 * `Path.rglob("*")` restricted to files, then `sorted()`.
 *
 * `recursive: true, withFileTypes: true` replaces the hand-rolled walk — the order it
 * yields is not the walk's order, but the explicit `.sort(comparePaths)` below is what
 * every caller actually observes, so a different collection order changes nothing.
 */
function sortedSourceFiles(src) {
  const out = readdirSync(src, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && !d.parentPath.split(path.sep).includes('__pycache__'))
    .map((d) => path.join(d.parentPath, d.name));
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
    // `bin/build-driver.mjs`, on the grounds that `--theme` is validated against `choices` before
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
    if (!Object.hasOwn(theme, key)) return whole;  // visible for debugging
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
function resolveCatalogs(text, nativeCatalog) {
  return text.replace(CATALOG_BLOCK_RE, (_m, table, pointer) => (nativeCatalog ? pointer : table));
}

/** LEAN blocks — full text or the hand-written condensation, by footprint. */
function resolveLean(text, footprint) {
  return text.replace(LEAN_BLOCK_RE, (_m, full, lean) => (footprint === 'lean' ? lean : full));
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

/**
 * Heading + first sentence, per `### ` block. DOCTRINES ONLY, now.
 *
 * The laws used to go through this too, and it made a law's lean footprint a function of its
 * punctuation: Law II shipped as one 36-character sentence and lost its stop-and-ask
 * mechanism, while a law written as one colon-chained run-on shipped nearly whole. The laws
 * now carry authored LEAN blocks in `src/laws/universal.md`, the way the ontology already did,
 * and `resolveLean` picks the half. Doctrine rules stay machine-cut: there are ~23 of them
 * across four packs, and a pack is a practice catalogue whose first sentence is written to
 * stand alone.
 */
function terseBlocks(text) {
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
  return out.join('\n\n');
}

/** The pointer under §1 at lean. The laws' lean text itself is authored in LEAN blocks. */
export function lawsPointer(theme, lawsPrefix = '') {
  const law = theme.LAW ?? 'Law';
  const lawsDir = theme.DIR_LAWS ?? 'laws';
  return `> Each ${law} above is given in brief — the rule, not its reasoning. The `
    + `complete, binding text of every ${law} is in \`${lawsPrefix}${lawsDir}/universal.md\`; `
    + `read it whenever a ${law}'s application is unclear, and before any act touching `
    + 'secrets, deletion, git history, scope, or untrusted content.';
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
      inner = `${inner}\n\n${lawsPointer(theme, lawsPrefix)}`;
    }
    return inner;
  });

  text = resolveCatalogs(text, nativeCatalog);
  text = resolveLean(text, footprint);
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
 * The doctrine packs this build actually renders, in `PACK_ORDER` — and the two gates
 * that stand between `cfg.doctrines` and a silently wrong AGENT.md.
 *
 * GATE 1 (stray pack): a `.md` under `src/doctrines/` that `PACK_ORDER` does not name is a
 * refusal, not a skip. Discovery sorts alphabetically and `PACK_ORDER` does not, so the two
 * cannot be the same list; without this gate a fifth pack file would render into no install
 * and no test would say so.
 *
 * GATE 2 (missing file): a pack named in `cfg.doctrines` with no file is a refusal too. The
 * CLI validates `--doctrines` against discovery, but `makeCfg({doctrines})` is a public
 * entry point and an emit that quietly dropped a pack the user asked for is exactly the
 * failure the `Active packs:` marker would then attest to.
 *
 * Both throw with `exitCode`, the marker `bin/build-driver.mjs`'s `main` turns into a status.
 */
function activeDoctrines(cfg) {
  const dir = path.join(cfg.src, 'doctrines');
  const onDisk = existsSync(dir)
    ? readdirSync(dir)
      .filter((f) => f.endsWith('.md') && path.basename(f, '.md').toLowerCase() !== 'readme')
      .map((f) => path.basename(f, '.md'))
    : [];
  const stray = onDisk.filter((n) => !PACK_ORDER.includes(n));
  if (stray.length) {
    const e = new Error(`doctrine pack file(s) ${stray.join(', ')} exist under src/doctrines/ `
      + 'but are missing from PACK_ORDER (js/build/source.mjs) — add them there, or they render '
      + 'into no install at all');
    e.exitCode = 1;
    throw e;
  }
  const wanted = cfg.doctrines ?? PACK_ORDER;
  for (const name of wanted) {
    if (!onDisk.includes(name)) {
      const e = new Error(`doctrine pack '${name}' is selected but src/doctrines/${name}.md `
        + `does not exist (packs on disk: ${onDisk.join(', ') || 'none'})`);
      e.exitCode = 1;
      throw e;
    }
  }
  // ⚠ A PACK WHOSE EVERY RULE IS EXCLUDED IS NOT A PACK, it is a heading over nothing. The
  // console only ever offers per-RULE switches, so "turn this whole pack off" arrives here as
  // seven exclusions rather than as a missing pack name — and rendering `**Observance** — how
  // a task is run.` with no rules under it would be the one shape the reader cannot
  // interpret. Dropped here rather than in `doctrinesBody` so `DOCTRINES_LIST` — the
  // `Active packs:` marker a later reader parses back — agrees with what was rendered.
  const excluded = new Set(cfg.excludeRules ?? []);
  const survives = (pack) => {
    const ids = [...readPackText(path.join(dir, `${pack}.md`))
      .matchAll(/^### \{\{DOCTRINE\}\} ([a-z]+) (\d+)\b/gm)]
      .map((m) => `${m[1]}.${Number(m[2])}`);
    return ids.some((id) => !excluded.has(id));
  };
  return PACK_ORDER.filter((p) => wanted.includes(p)).filter(survives);
}

/**
 * `{{DOCTRINES_BODY}}` — the active packs concatenated, the multi-select answer to
 * `registerBody`'s single-select one.
 *
 * `registerBody` reads ONE file because a posture and a mode are scalars; a doctrine set is
 * 0-4 files, so this loops instead of wrapping it. Under `lean` each pack gets the same
 * heading + first-sentence treatment the invariants get, and the whole section — not each
 * pack — closes with one pointer at the full catalogue, which ships in every bundle whether
 * or not a pack is active.
 */
/** `### {{DOCTRINE}} <pack> <n> —` in the UNRENDERED source, which is where the address is. */
const SRC_RULE_HEADING_RE = /^### \{\{DOCTRINE\}\} ([a-z]+) (\d+)\b/;

/**
 * Drop the individual rules an install excluded, leaving the pack's lead line and the rest.
 *
 * ⚠ FILTERED BEFORE SUBSTITUTION, ON THE SOURCE. The rendered heading spells the tier noun in
 * the theme's own voice — `Doctrina process 7` on imperial, `Custom process 7` on pirate — so
 * matching after substitution means matching fourteen spellings, and a theme whose noun
 * happened not to match would silently exclude nothing at all. The source spelling is one
 * literal and is the same in every voice.
 *
 * The pack's lead line (`**{{PACK_CRAFT}}** — how code is written.`) sits before the first
 * heading and always survives: `splitAtLawHeadings` returns it as the leading chunk, and a
 * pack whose every rule is excluded is not rendered at all — `activeDoctrines` drops it from
 * the selection, so a header with nothing under it cannot occur.
 */
function dropExcludedRules(text, pack, excluded) {
  if (!excluded.size) return text;
  return splitAtLawHeadings(text)
    .filter((block) => {
      const m = SRC_RULE_HEADING_RE.exec(block);
      return !m || !excluded.has(`${m[1]}.${Number(m[2])}`);
    })
    .join('');
}

function doctrinesBody(cfg, theme, active, footprint, lawsPrefix) {
  if (!active.length) return '';
  const excluded = new Set(cfg.excludeRules ?? []);
  const parts = active.map((name) => {
    const raw = dropExcludedRules(readPackText(path.join(cfg.src, 'doctrines', `${name}.md`)),
      name, excluded);
    const body = substitute(raw, theme).trim();
    return footprint === 'lean' ? terseBlocks(body) : body;
  });
  if (footprint === 'lean') {
    const doctrine = theme.DOCTRINE ?? 'Doctrine';
    const dir = theme.DIR_DOCTRINES ?? 'doctrines';
    parts.push(`> Each ${doctrine} above is given in brief — the rule, not its reasoning. `
      + `The complete text of every pack, active or not, is in \`${lawsPrefix}${dir}/\`; read `
      + `the pack file whenever a ${doctrine}'s application is unclear.`);
  }
  return parts.join('\n\n');
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
export function effectiveTheme(cfg, themeName, { footprint = 'full', lawsPrefix = '' } = {}) {
  const theme = { ...loadTheme(cfg, themeName), ...(cfg.structure ?? STRUCTURE) };
  theme.POSTURE_BODY = registerBody(cfg, theme, 'postures', cfg.posture ?? 'peer', 'peer');
  theme.MODE_BODY = registerBody(cfg, theme, 'modes', cfg.mode ?? 'direct', 'direct');
  // The doctrines pair is threaded, not read off `cfg`: `footprint` is a per-RENDER value
  // (`renderAll`'s option, and the same cfg renders both ways in one process), so parking it
  // on cfg would make the terse/full choice sticky across calls. An options object rather
  // than two positional params keeps the existing two-arg call sites — every test, and
  // `renderAll` — compiling unchanged, and defaults to the full text if a caller forgets.
  const active = activeDoctrines(cfg);
  theme.DOCTRINES_BODY = doctrinesBody(cfg, theme, active, footprint, lawsPrefix);
  theme.DOCTRINES_LIST = active.length ? active.join(', ') : 'none';
  // ⚠ EMITTED ONLY WHEN SOMETHING IS EXCLUDED, and that is not cosmetic. An unconditional
  // second marker line would put a new line into EVERY carrier — 261 golden cells, both
  // footprints, nine emit modes — to say "nothing was excluded", which is what the line's
  // absence already says. Keeping the default build byte-identical is what lets this ship
  // without re-blessing anything, and it is why `excludedRulesOfDir` reads a MISSING line as
  // `[]` rather than as unknown: absence is a real answer here, unlike the pack list.
  //
  // Rendered `process 7`, not `process.7`: the dotted form is the console's address, the
  // spaced form is how every citation in the corpus already spells a rule, and this line is
  // read by people first and by `excludedRulesOfDir` second.
  const dropped = [...(cfg.excludeRules ?? [])].sort();
  theme.EXCLUDED_RULES_LINE = dropped.length
    ? `\nExcluded rules: ${dropped.map((id) => id.replace('.', ' ')).join(', ')}`
    : '';
  return theme;
}

/** `_build_render.themed_rel` — rename the top-level folder of an output path per theme. */
export function themedRel(rel, theme) {
  const parts = rel.split(path.sep);
  if (parts.length && Object.hasOwn(SRC_DIR_TOKENS, parts[0])) {
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
  const theme = effectiveTheme(cfg, themeName, { footprint, lawsPrefix });
  const items = [];
  for (const file of sortedSourceFiles(cfg.src)) {
    const rel = path.relative(cfg.src, file);
    const outRel = destRel(themedRel(rel, theme)).split(path.sep).join('/');  // as_posix()
    // The on-disk `laws/` and `ontology/` are the "complete, binding text" the lean pointer
    // promises. They render at full whatever the footprint; only what AGENT.md INLINES leans.
    // Keyed on the SOURCE rel, not the themed one, so a DIR_* rename cannot un-exempt them.
    const fp = /^(?:laws|ontology)[\\/]/.test(rel) ? 'full' : footprint;
    items.push(TEXT_SUFFIXES.has(suffixOf(path.basename(file)))
      ? { rel: outRel, text: renderFile(cfg, file, theme, fp, lawsPrefix, new Set(), nativeCatalog), src: file }
      : { rel: outRel, text: null, src: file });
  }
  return { theme, items };
}
