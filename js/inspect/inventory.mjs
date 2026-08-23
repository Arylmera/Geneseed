/**
 * The CATALOG surface — the taxonomy tables, the rendered-laws
 * parser, the entity registry, and the render-accurate inventory the TUI, the `status`
 * panel and the web console all read.
 *
 * WHY THIS FILE EXISTS RATHER THAN A THIRD COPY OF THE TABLES. `LAW_CLASS`, `SKILL_CLASS`,
 * `LAW_CLASSES` and `ENTITY_STATUSES` crossed in P5g, inside `js/inspect/doctor.mjs`, because
 * doctor's authoring gates are what validate them — and `js/inspect/status.mjs`'s docblock said
 * flatly that "the taxonomy P7 owns" was not ported, which was true of `_parse_laws` and
 * `entity_status` and had stopped being true of the tables. P6c needs all of it, so the
 * tables move HERE, to the module that mirrors where Python keeps them, and the doctor's
 * check modules import them — `checks-authoring.mjs` takes `LAW_CLASS`, `LAW_CLASSES` and
 * `SKILL_CLASS`, `checks-repo.mjs` takes `ENTITY_STATUSES`. A copy of a value under test
 * silently stops being the value under test.
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

import { ROOT, SRC, makeCfg, PACK_ORDER } from '../build/source.mjs';
import { firstBlockquote } from '../hosts/native.mjs';
import { renderAll } from '../build/render.mjs';
import { resolvePath } from '../hosts/hosts.mjs';
import { readText } from '../lib/fs.mjs';
import { parseJson } from '../lib/json.mjs';

/**
 * `_harness_tui.LAW_HEADING_RE` — a heading in the RENDERED laws file, e.g.
 * `### Rule IV — Deletion Is Deliberate`.
 *
 * Not `js/inspect/checks-authoring.mjs`'s `LAW_HEADING_RE`, which matches the `{{LAW}}` token in the
 * unrendered source. Two patterns, two inputs, two names in Python as well.
 */
export const LAW_HEADING_RE = /^###\s+\S+\s+([IVXLCDM]+)\s+[—-]\s+(.+?)\s*$/;

/**
 * A heading in a RENDERED doctrine pack, e.g. `### Doctrine craft 1 — Automate Repetition`.
 *
 * THE TIER NOUN IS THEMED AND THE ADDRESS IS NOT, exactly as the invariants work: `{{LAW}}`
 * plus a Roman numeral there, `{{DOCTRINE}}` plus `<pack> <n>` here. So `\S+` for the noun —
 * ⚠ which is why a theme's `DOCTRINE` value must be ONE WORD, and why `doctor` asserts it in
 * all fourteen. A two-word noun does not error; it silently stops matching, and a pack quietly
 * parses to zero rules.
 *
 * It cannot collide with `LAW_HEADING_RE` in either direction and the reason is case:
 * `([a-z]+)` refuses `Rule I`'s uppercase numeral, and `([IVXLCDM]+)` refuses a lowercase pack
 * id. Measured across all fourteen themes — zero cross-matches either way.
 */
export const DOCTRINE_HEADING_RE = /^###\s+\S+\s+([a-z]+)\s+(\d+)\s+[—-]\s+(.+?)\s*$/;

/**
 * A section heading in the RENDERED ontology, e.g. `#### Telos`.
 *
 * FOUR HASHES, and that is the whole reason the ontology can share `universal.md`'s basename
 * with the laws file without either parser seeing the other's headings. The section names come
 * from `STRUCTURE` rather than from a theme, so the id below is stable across all fourteen
 * voices and is safe to put in a deep link.
 */
export const ONTOLOGY_HEADING_RE = /^####\s+(.+?)\s*$/;

/** The lead line of a pack file — `**Craft** — how code is written.` */
const PACK_LEAD_RE = /^\*\*(.+?)\*\*\s+[—-]\s+(.+?)\s*$/;

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
 * One rendered doctrine pack file split into `{pack, n, title, klass, body}` rows.
 *
 * Same accumulator as `parseLaws`, and deliberately so: text before the first heading — the
 * pack's own lead line — is dropped on the floor because `cur` is still null, and each body is
 * trimmed at its ends only.
 *
 * `klass` IS THE PACK ID, not one of `LAW_CLASSES`. A doctrine rule is grouped by the pack it
 * belongs to and there is no second taxonomy over it; the six-class chip is the invariants'.
 * The collision with the class names `craft` and `process` is real and harmless — the two
 * lists are separate end to end and nothing ever unions them.
 *
 * `pack` is read from the HEADING and not from the filename, so a rule filed under the wrong
 * pack is visible rather than silently renamed by its container. `doctor` is what compares the
 * two; this function just reports what the text says.
 */
export function parseDoctrines(text) {
  const rules = [];
  let cur = null;
  for (const line of text.split('\n')) {
    const m = DOCTRINE_HEADING_RE.exec(line);
    if (m) {
      if (cur) rules.push(cur);
      cur = { pack: m[1], n: Number(m[2]), title: m[3], klass: m[1], body: '' };
    } else if (cur !== null) {
      cur.body += `${line}\n`;
    }
  }
  if (cur) rules.push(cur);
  for (const rule of rules) rule.body = rule.body.trim();
  return rules;
}

/**
 * The rendered ontology split into `{id, title, body}` sections.
 *
 * `id` is the slugified title, and it is an ADDRESS: `#/item/law/ont:telos` is how the console
 * deep-links a section, so it has to survive a theme change. It does, because the four titles
 * come from `STRUCTURE` in `js/build/render.mjs` and not from any theme file — the same reason a
 * citation can spell itself `({{ONTOLOGY}}: {{ONT_TELOS}})` with a token on both sides.
 *
 * The preamble above the first `####` is dropped, as in the two parsers above. It is the
 * paragraph that states the tier order, and it renders into AGENT.md whole — the catalogue
 * lists sections, and the preamble is not one.
 */
export function parseOntology(text) {
  const sections = [];
  let cur = null;
  for (const line of text.split('\n')) {
    const m = ONTOLOGY_HEADING_RE.exec(line);
    if (m) {
      if (cur) sections.push(cur);
      cur = { id: m[1].toLowerCase().replace(/\s+/g, '-'), title: m[1], body: '' };
    } else if (cur !== null) {
      cur.body += `${line}\n`;
    }
  }
  if (cur) sections.push(cur);
  for (const s of sections) s.body = s.body.trim();
  return sections;
}

/**
 * `_harness_tui.load_registry` — the `entities` map from `registry.json`, or `{}`.
 *
 * Deliberately forgiving on BOTH failure modes, as the reference is: a missing file and a
 * corrupt one both yield `{}`, which reads every badge as "unknown" rather than breaking
 * the browser. `registryProblems` in `js/inspect/checks-repo.mjs` is the loud reader of the same file
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
 * `_harness_tui._tui_inventory` — render-accurate inventory of all three constitutional tiers,
 * plus every agent and skill with its one-line purpose, rendered spec, source and badge.
 *
 * THE WHOLE CATALOGUE, NOT THE BUILT SUBSET. All four pack files ship in every bundle
 * (`OWNED_SRC_DIRS`), which is what lets a cross-pack citation resolve when its pack is not
 * built into AGENT.md — and it is also what lets the console show an inactive pack greyed out
 * with the command that would enable it. So the packs are always all parsed; `doctrines` only
 * decides which of them carry `active: true`. Passing `null` — the default, and what `catalog`,
 * `status` and the graph do — means "no install to ask", and every pack reads active, matching
 * `makeCfg()`'s own default and `doctrinesForBuild`'s resolution of unknown.
 *
 * `laws` KEEPS ITS NAME and means the invariants. Renaming it to `invariants` would churn
 * `status`, `catalog`, `tui`, the web API, its `SECTIONS` id, three test fixtures and two
 * recorded corpora to say the same thing in a different word.
 */
export function tuiInventory(themeName, doctrines = null, excluded = []) {
  const { items } = renderAll(makeCfg(), themeName);
  const registry = loadRegistry();
  const agents = [];
  const skills = [];
  let laws = [];
  let ontology = [];
  const packs = new Map();
  for (const { text, src } of items) {
    if (text === null) continue;
    const parts = path.relative(SRC, src).split(path.sep);
    const two = parts.length === 2 && parts[1].endsWith('.md') && !parts[1].startsWith('_');
    const name = two ? parts[1].slice(0, -3) : null;
    if (two && (parts[0] === 'agents' || parts[0] === 'skills')) {
      const entry = { name, desc: firstBlockquote(text), body: text,
        source: resolvePath(src), status: entityStatus(registry, `${parts[0]}/${name}`) };
      if (parts[0] === 'agents') agents.push(entry);
      else {
        entry.klass = has(SKILL_CLASS, name) ? SKILL_CLASS[name] : 'build';
        skills.push(entry);
      }
    }
    // Every `.md` in the dir is read; `PACK_ORDER` below decides which of them is a pack. The
    // dir also holds a `README.md`, which passes the `_`-scaffold filter, and a second
    // membership test here would be a second owner of the same rule — one that has to agree
    // with the one that actually publishes the list.
    if (two && parts[0] === 'doctrines') {
      const lead = text.split('\n').map((l) => PACK_LEAD_RE.exec(l)).find(Boolean);
      packs.set(name, { pack: name, title: lead ? lead[1] : name, desc: lead ? lead[2] : '',
        source: resolvePath(src), rules: parseDoctrines(text) });
    }
    // Scoped to the laws dir, not matched on the basename: `src/ontology/universal.md`
    // shares the name, sorts after `laws/`, and would clobber the parse with `[]` —
    // `LAW_HEADING_RE` wants `###` and the ontology uses `####`. Same spelling as the
    // already-scoped sites at `js/build/render.mjs`'s `rel === 'laws/universal.md'`.
    if (parts.join('/') === 'laws/universal.md') laws = parseLaws(text);
    if (parts.join('/') === 'ontology/universal.md') ontology = parseOntology(text);
  }
  const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  agents.sort(byName);
  skills.sort(byName);
  // ⚠ `PACK_ORDER` IS THE SINGLE OWNER OF THE SET, and of its order. Filtering the order by
  // what was found — rather than publishing what was found — is what keeps `README.md` and any
  // other stray `.md` in that directory out of the catalogue, and it is the same membership
  // rule `js/build/render.mjs` refuses the build over, so a fifth pack cannot be silently dropped
  // here either. Order because `sortedSourceFiles` walks alphabetically, which puts `ops`
  // second: the narrative order is the reading order, and it is what the marker line, the
  // wizard and the rendered section all use.
  const on = Array.isArray(doctrines) ? doctrines : PACK_ORDER;
  // ⚠ `active` NOW LIVES ON THE RULE, and the pack's is derived from it rather than the other
  // way round. The unit a user toggles is the rule: a pack is "active" exactly when at least
  // one of its rules is, which is also the condition under which it renders at all. Keeping a
  // pack-level flag as the source would let the two disagree — a pack marked active whose
  // every rule is excluded is a header the render refuses to emit.
  const off = new Set(Array.isArray(excluded) ? excluded : []);
  const built = PACK_ORDER.filter((p) => packs.has(p)).map((p) => {
    const pack = packs.get(p);
    const rules = pack.rules.map((r) => ({
      ...r, active: on.includes(p) && !off.has(`${r.pack}.${r.n}`),
    }));
    return { ...pack, rules, active: rules.some((r) => r.active) };
  });
  return { agents, skills, laws, ontology, doctrines: built, theme: themeName };
}
