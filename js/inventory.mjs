/**
 * `rituals/_harness_tui.py`'s CATALOG half — the taxonomy tables, the rendered-laws
 * parser, the entity registry, and the render-accurate inventory the TUI, the `status`
 * panel and the web console all read.
 *
 * WHY THIS FILE EXISTS RATHER THAN A THIRD COPY OF THE TABLES. `LAW_CLASS`, `SKILL_CLASS`,
 * `LAW_CLASSES` and `ENTITY_STATUSES` crossed in P5g, inside `js/doctor.mjs`, because
 * doctor's authoring gates are what validate them — and `js/status.mjs`'s docblock said
 * flatly that "the taxonomy P7 owns" was not ported, which was true of `_parse_laws` and
 * `entity_status` and had stopped being true of the tables. P6c needs all of it, so the
 * tables move HERE, to the module that mirrors where Python keeps them, and `js/doctor.mjs`
 * imports them. A copy of a value under test silently stops being the value under test.
 *
 * AND `inventoryCounts` FOLDS BACK INTO `tuiInventory`. P5d shipped a counting-only twin
 * with a docblock warning that the two must not become two classifiers; this is the phase
 * that would have made them two, because `api_catalog` consumes the very fields the count
 * threw away. So there is one classifier — "a two-part relative path ending in `.md` and
 * not starting with `_`, under `agents/` or `skills/`" — and `inventoryCounts` is three
 * `length`s off it. The eleven `status` cells gate the counts; P6c's catalog cells gate
 * the fields; both run over the same walk.
 */
import path from 'node:path';

import { ROOT, SRC, makeCfg } from './checkout.mjs';
import { firstBlockquote } from './native.mjs';
import { renderAll } from './render.mjs';
import { pyResolve } from './hosts.mjs';
import { parseJson, readText } from './lib/fs.mjs';

/**
 * `_harness_tui.LAW_HEADING_RE` — a heading in the RENDERED laws file, e.g.
 * `### Rule IV — Deletion Is Deliberate`.
 *
 * Not `js/doctor.mjs`'s `LAW_HEADING_RE`, which matches the `{{LAW}}` token in the
 * unrendered source. Two patterns, two inputs, two names in Python as well.
 */
export const LAW_HEADING_RE = /^###\s+\S+\s+([IVXLCDM]+)\s+[—-]\s+(.+?)\s*$/;

/** `_harness_tui.LAW_CLASS` — each rule's class, keyed by Roman numeral. */
export const LAW_CLASS = {
  I: 'security', II: 'process', III: 'verify', IV: 'security', V: 'verify',
  VI: 'security', VII: 'security', VIII: 'craft', IX: 'security',
};

/** `_harness_tui.ENTITY_STATUSES` — the lifecycle statuses `registry.json` may carry. */
export const ENTITY_STATUSES = ['experimental', 'approved', 'deprecated'];

/**
 * `_harness_tui.LAW_CLASSES` — the six governance classes a law may carry.
 *
 * ⚠ SIX, THOUGH ONLY FOUR ARE IN USE. When the corpus became nine invariants, `context` and
 * `comms` stopped having a member — that material moved to the ontology and the doctrine packs,
 * neither of which is classed here. The list stays six because it is the VOCABULARY, not a
 * census: `doctor` quotes it verbatim in the message a bad class earns, and two recorded cells
 * in `tests/helpers/matrix/cli.*.json` hold that message byte for byte.
 */
export const LAW_CLASSES = ['security', 'process', 'verify', 'craft', 'context', 'comms'];

/** `_harness_tui.SKILL_CLASS` — each skill's category, keyed by file stem. */
export const SKILL_CLASS = {
  brainstorm: 'design', clarify: 'design', plan: 'design', council: 'design',
  workflow: 'design', 'parallel-agents': 'design', pipeline: 'design',
  'codebase-design': 'design', 'domain-modeling': 'design', wayfinder: 'design',
  tickets: 'design',
  tdd: 'build', develop: 'build', refactor: 'build', debug: 'build', migrate: 'build',
  'frontend-design': 'build', 'opencode-theme': 'build', prototype: 'build',
  'forge-mcp': 'build',
  'geneseed-code-review': 'review', 'fresh-eyes': 'review', 'gap-detector': 'review',
  'roast-me': 'review', 'review-response': 'review', ponytail: 'review',
  commit: 'ship', ship: 'ship', release: 'ship', handoff: 'ship', 'git-rescue': 'ship',
  'repo-map': 'understand', 'git-archaeology': 'understand', decode: 'understand',
  research: 'understand', ingest: 'understand', 'document-project': 'understand',
  wiki: 'understand', prose: 'understand', geneseed: 'understand', rule: 'understand',
  profile: 'understand', herdr: 'understand',
  'crash-course': 'learn', drill: 'learn', feynman: 'learn', 'learning-path': 'learn',
};

/** `k in dict` — own keys only, where `k in obj` also finds `Object.prototype` members. */
const has = (obj, k) => Object.hasOwn(obj, k);

/**
 * `_harness_tui._parse_laws` — the rendered laws file split into
 * `{num, title, klass, body}`.
 *
 * The accumulator appends `line + "\n"` to every non-heading line INCLUDING the ones
 * before the first heading, which are discarded because `cur` is still None — and then
 * strips each body at the end. Reproduced literally: a body's internal blank lines are
 * kept and only its ends are trimmed.
 */
export function parseLaws(text) {
  const laws = [];
  let cur = null;
  for (const line of text.split('\n')) {
    const m = LAW_HEADING_RE.exec(line);
    if (m) {
      if (cur) laws.push(cur);
      cur = { num: m[1], title: m[2], klass: has(LAW_CLASS, m[1]) ? LAW_CLASS[m[1]] : 'craft', body: '' };
    } else if (cur !== null) {
      cur.body += `${line}\n`;
    }
  }
  if (cur) laws.push(cur);
  // `str.strip()`. `trim()`'s whitespace set differs from Python's only at U+FEFF, which
  // is the standing item this port has carried since P4 — a rendered law body cannot end
  // in a BOM, and a fourth primitive to say so would cost more than it gates.
  for (const law of laws) law.body = law.body.trim();
  return laws;
}

/**
 * `_harness_tui.load_registry` — the `entities` map from `registry.json`, or `{}`.
 *
 * Deliberately forgiving on BOTH failure modes, as the reference is: a missing file and a
 * corrupt one both yield `{}`, which reads every badge as "unknown" rather than breaking
 * the browser. `registryProblems` in `js/doctor.mjs` is the loud reader of the same file
 * and stays separate — the two answer different questions.
 */
export function loadRegistry() {
  let doc;
  try {
    doc = parseJson(readText(path.join(ROOT, 'registry.json')));
  } catch {
    return {};
  }
  const entities = doc && typeof doc === 'object' && !Array.isArray(doc) ? doc.entities : null;
  return entities && typeof entities === 'object' && !Array.isArray(entities) ? entities : {};
}

/**
 * `_harness_tui.entity_status` — one entity's lifecycle status, plus the two derived
 * states that are never stored.
 *
 * An entity the registry has never heard of is "personal": your own skill dropped into the
 * install, which Geneseed never shipped. An EMPTY registry means the file was missing or
 * corrupt, so everything reads "unknown" there instead of relabelling the whole shipped
 * catalogue as yours — which is why the empty check is on the registry and not on the row.
 */
export function entityStatus(registry, key) {
  if (!has(registry, key)) {
    return Object.keys(registry).length ? 'personal' : 'unknown';
  }
  const row = registry[key];
  const status = (row && typeof row === 'object' && !Array.isArray(row)) ? row.status : null;
  return ENTITY_STATUSES.includes(status) ? status : 'unknown';
}

/**
 * `_harness_tui._tui_inventory` — render-accurate inventory: every agent and skill with
 * its one-line purpose, full rendered spec, source path and lifecycle badge, and every law
 * with its title, body and governance class.
 */
export function tuiInventory(themeName) {
  const { items } = renderAll(makeCfg(), themeName);
  const registry = loadRegistry();
  const agents = [];
  const skills = [];
  let laws = [];
  for (const { text, src } of items) {
    if (text === null) continue;
    const parts = path.relative(SRC, src).split(path.sep);
    if (parts.length === 2 && parts[1].endsWith('.md') && !parts[1].startsWith('_')) {
      const name = parts[1].slice(0, -3);
      const entry = { name, desc: firstBlockquote(text), body: text,
        source: pyResolve(src), status: entityStatus(registry, `${parts[0]}/${name}`) };
      if (parts[0] === 'agents') agents.push(entry);
      else if (parts[0] === 'skills') {
        entry.klass = has(SKILL_CLASS, name) ? SKILL_CLASS[name] : 'build';
        skills.push(entry);
      }
    }
    // Scoped to the laws dir, not matched on the basename: `src/ontology/universal.md`
    // shares the name, sorts after `laws/`, and would clobber the parse with `[]` —
    // `LAW_HEADING_RE` wants `###` and the ontology uses `####`. Same spelling as the
    // already-scoped sites at `js/render.mjs`'s `rel === 'laws/universal.md'`.
    if (parts.join('/') === 'laws/universal.md') laws = parseLaws(text);
  }
  const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  agents.sort(byName);
  skills.sort(byName);
  return { agents, skills, laws, theme: themeName };
}
