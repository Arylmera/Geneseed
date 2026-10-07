/**
 * The CONSTITUTION gates — whether the laws and doctrine packs agree with themselves and with
 * everything keyed off them: rule declarations and citations, the LEAN blocks, the hook-pinned
 * addresses, the theme vocabulary, and the web console's per-rule Principle copy.
 *
 * Split out of `checks-authoring.mjs`, which still aggregates these (and re-exports them for
 * its existing importers). Same contract as every check module here: an array of problem
 * strings, empty when clean.
 */
import path from 'node:path';
import {
  CONFIG, PACK_ORDER, RETIRED_RULE_IDS, ROOT, RULE_ID_RE, SRC, THEMES, canonFiles, ruleCanon, titleKey,
} from '../build/source.mjs';
import { LEAN_BLOCK_RE, splitAtLawHeadings } from '../build/render.mjs';
import { themeFiles } from '../hosts/installs.mjs';
import { readText } from '../lib/fs.mjs';
import { parseJson, formatRepr } from '../lib/json.mjs';
import { NOTE, isFile, rglob } from './scan.mjs';

/**
 * The body of `const <name> = { … }` in the web Laws page — the one file out of `web/src` the
 * doctor reads. Answers `[body, null]`, or `[null, problem]` when the page is unreadable or the
 * literal is gone (`missing` is that problem's text).
 */
function lawsPageLiteral(name, missing) {
  let text;
  try { text = readText(path.join(ROOT, 'web', 'src', 'pages', 'Laws.jsx')); } catch (e) {
    return [null, `[authoring] web/src/pages/Laws.jsx unreadable: ${e.message}`];
  }
  const block = new RegExp(`^const ${name} = \\{$([\\s\\S]*?)^\\}$`, 'm').exec(text);
  return block ? [block[1], null] : [null, missing];
}

/**
 * `_harness_build._LAW_META_ROW` — `<arabic>: ['<class>', '<principle>', '<id>'],` in the web page.
 *
 * The third field PINS the row to a rule id. The key is the number the catalogue renders, and a
 * number is only a position: remove a law and every later row describes its predecessor's
 * neighbour, with every class still plausible. The pin is what makes that a doctor failure.
 *
 * Either quote style, because a principle carrying an apostrophe is double-quoted. Every
 * `\s*` spans newlines and the trailing comma before `]` is optional, so a row a prettier has
 * reflowed across several lines still matches — a gate that only understood the one-line form
 * silently lost it and left the law's Principle unguarded.
 *
 * `(?m)` is the `m` flag; JS has no inline form. The `.` inside the captures must NOT match a
 * newline (Python has no `re.S` here), which is JS's default.
 */
const LAW_META_ROW =
  /^[^\S\n]*(\d+):\s*\[\s*(['"])(.*?)\2\s*,\s*(['"])(.*?)\4\s*(?:,\s*(['"])(.*?)\6\s*)?,?\s*\]\s*,?[^\S\n]*$/gm;

/**
 * `_harness_build._law_meta_problems` — the web Laws ledger's per-rule copy stays complete.
 *
 * `LAW_META` holds each law's one-line Principle, copy that exists nowhere else in the tree,
 * and a law with no row falls back to `['craft', '']`: the rule renders with a blank
 * description and the wrong class chip, while everything upstream is fine. That is exactly
 * how two laws shipped description-less.
 */
export function lawMetaProblems(lawRules, lawClass, lawClasses) {
  const [block, refusal] = lawsPageLiteral('LAW_META', '[authoring] LAW_META literal not found '
    + "in web/src/pages/Laws.jsx — the web Laws ledger's Principle column would have no gate");
  if (refusal) return [refusal];
  const meta = new Map();
  for (const m of block.matchAll(LAW_META_ROW)) {
    meta.set(Number(m[1]), [m[3], m[5], m[7]]);
  }
  const problems = [];
  const seen = new Set();
  for (const { n, label: roman, id } of lawRules) {
    seen.add(n);
    if (!meta.has(n)) {
      problems.push(`[authoring] laws/universal.md rule ${roman} (${n}) has no row in `
        + 'LAW_META (web/src/pages/Laws.jsx) — the web Laws ledger would '
        + 'render it with a blank Principle');
      continue;
    }
    const [klass, principle, pin] = meta.get(n);
    if (pin !== id) {
      problems.push(`[authoring] LAW_META[${n}] is pinned to '${pin ?? '(no id)'}' but rule ${roman} is `
        + `'${id}' — the rows no longer follow the canon's order, so this principle `
        + 'describes a different law');
    }
    if (!principle.trim()) {
      problems.push(`[authoring] LAW_META[${n}] has an empty principle line — rule `
        + `${roman} would render with a blank description`);
    }
    if (!lawClasses.includes(klass)) {
      problems.push(`[authoring] LAW_META[${n}] class '${klass}' is not a known class `
        + `${formatRepr(lawClasses)}`);
    } else if (lawClass[roman] && klass !== lawClass[roman]) {
      problems.push(`[authoring] LAW_META[${n}] classes rule ${roman} as '${klass}' but `
        + `LAW_CLASS says '${lawClass[roman]}'`);
    }
  }
  for (const n of [...meta.keys()].filter((k) => !seen.has(k)).sort((a, b) => a - b)) {
    problems.push(`[authoring] LAW_META lists rule ${n} but laws/universal.md has no such rule`);
  }
  return problems;
}

/** `LAW_META_ROW`'s twin for a STRING key — `'<pack>.<n>': ['<pack>', '<principle>', '<id>'],`. */
const DOCTRINE_META_ROW =
  /^[^\S\n]*(['"])([a-z]+\.\d+)\1:\s*\[\s*(['"])(.*?)\3\s*,\s*(['"])(.*?)\5\s*(?:,\s*(['"])(.*?)\7\s*)?,?\s*\]\s*,?[^\S\n]*$/gm;

/**
 * `lawMetaProblems`' doctrine half — the console's per-rule Principle column stays complete.
 *
 * SAME DEFECT, ONE TIER OVER. `DOCTRINE_META` holds copy that exists nowhere else in the tree,
 * and a rule with no row falls back to an empty principle: it renders with a blank description
 * while every count upstream reads correct. Two invariants shipped exactly that way before
 * `lawMetaProblems` existed, and 23 new rules is a much larger surface to lose one in.
 *
 * ⚠ THE CLASS ARM IS DIFFERENT FROM THE INVARIANTS'. An invariant's class is checked against
 * `LAW_CLASSES`, a vocabulary of six; a doctrine rule has no second taxonomy — its class IS its
 * pack — so the check is an EQUALITY against the pack in its own key. That catches the copy
 * error a six-way vocabulary cannot: a row pasted from the pack above it, keeping the class of
 * the pack it came from, which would colour the row and label its chip with the wrong pack.
 */
export function doctrineMetaProblems(addrs, ids = null) {
  const [block, refusal] = lawsPageLiteral('DOCTRINE_META', '[authoring] DOCTRINE_META literal not '
    + "found in web/src/pages/Laws.jsx — the console's doctrine rows would have no gate on their "
    + 'Principle column');
  if (refusal) return [refusal];
  const meta = new Map();
  for (const m of block.matchAll(DOCTRINE_META_ROW)) meta.set(m[2], [m[4], m[6], m[8]]);
  const problems = [];
  const seen = new Set();
  for (const [i, addr] of addrs.entries()) {
    seen.add(addr);
    if (!meta.has(addr)) {
      problems.push(`[authoring] doctrine rule ${addr} has no row in DOCTRINE_META `
        + '(web/src/pages/Laws.jsx) — the console would render it with a blank Principle');
      continue;
    }
    const [klass, principle, pin] = meta.get(addr);
    if (ids && pin !== ids[i]) {
      problems.push(`[authoring] DOCTRINE_META['${addr}'] is pinned to '${pin ?? '(no id)'}' but `
        + `that address is '${ids[i]}' now — the row describes a different rule`);
    }
    if (!principle.trim()) {
      problems.push(`[authoring] DOCTRINE_META['${addr}'] has an empty principle line — that `
        + 'rule would render with a blank description');
    }
    const pack = addr.split('.')[0];
    if (klass !== pack) {
      problems.push(`[authoring] DOCTRINE_META['${addr}'] carries pack '${klass}' — a doctrine `
        + `rule's class IS its pack, so this must read '${pack}'`);
    }
  }
  for (const addr of [...meta.keys()].filter((k) => !seen.has(k)).sort()) {
    problems.push(`[authoring] DOCTRINE_META lists ${addr} but no pack file defines it`);
  }
  return problems;
}

// A rule is DECLARED by its heading and CITED by its id — see `ruleCanon` in
// `js/build/source.mjs`. The gates below read the RAW source, because the render resolves ids and
// a bad one would already be gone from what it hands back.
const DECL_LINE_RE = /^### \{\{(LAW|DOCTRINE):([^}]*)\}\}[ \t]+\S/;
const ID_CITE_RE = /\{\{(LAW|DOCTRINE):([^}]*)\}\}/g;
// The pre-id spellings. Either one in src/ is a citation that names a POSITION, which is exactly
// what stops being true the next time the canon moves.
const BARE_CITE_RE = /\{\{LAW\}\}\s+[IVXLCDM]+\b|\{\{DOCTRINE\}\}\s+[a-z]+\s+\d+\b/g;
// `{{DOCTRINE}}` or `{{DOCTRINE:` and not `DOCTRINE`: `{{DOCTRINES}}` is the SECTION noun and is
// legal everywhere, including in an invariant that points at the tier as a whole.
const DOCTRINE_TOKEN_RE = /\{\{DOCTRINE(?:\}\}|:)/;

/**
 * The rules the hooks enforce at the tool boundary, and the address each is bound to there. The
 * hook path cannot afford to read the canon on every tool call, so its gate-ledger keys
 * (`law-1`, `law-4`, `process-1`, `process-5`, `rigor-5` in `js/hosts/hooks.mjs` and the OpenCode guard
 * plugin), `CONSENT_RULE` in `js/hosts/settings.mjs` and the console's `HOOK_GATED` stay
 * number-keyed — and this pin is what turns a renumber that moves one of these rules into a
 * doctor failure instead of a gate silently guarding its neighbour.
 */
export const HOOK_PINNED = {
  'sealed-secrets': 'I', 'deletion-is-deliberate': 'IV',
  'persist-insight': 'process 1', 'consent-before-push': 'process 5', 'external-gate': 'rigor 5',
};

/**
 * Every authored rule carries exactly one LEAN block, and both halves say something.
 *
 * ⚠ `resolveLean` IS A REPLACE OVER A MARKER PAIR, WHICH MAKES IT A NO-OP ON MARKERLESS TEXT.
 * A rule whose block was never written, or lost to an edit, therefore ships its FULL body at
 * the default footprint — silently, in every install, with every other gate in the tree green.
 * That is the failure this arm exists for, and before it there was no LEAN gate anywhere in
 * `js/inspect/`: not for the doctrine packs, and not for the invariants either.
 *
 * The other two shapes are cheaper to state than to debug. An empty lean half renders a
 * heading over nothing at the footprint most installs use. Two blocks in one rule are
 * ambiguous by construction — `LEAN_BLOCK_RE` is global, so both would resolve, and which
 * text the reader gets would be a fact about the order they were written in.
 *
 * The ontology is exempt on purpose: it carries ONE file-wide block whose halves each repeat
 * the four `####` section headings, which is a different shape with its own gate in
 * `tests/unit/emit_smoke.test.mjs` (four distinct names, eight occurrences).
 */
export function leanBlockProblems() {
  const problems = [];
  const files = [['laws', path.join(SRC, 'laws', 'universal.md')]];
  for (const pack of PACK_ORDER) files.push(['doctrines', path.join(SRC, 'doctrines', `${pack}.md`)]);

  for (const [dir, file] of files) {
    const rel = `${dir}/${path.basename(file)}`;
    let text;
    try { text = readText(file); } catch (e) {
      problems.push(`[authoring] ${rel} unreadable: ${e.message} — every rule in it would ship `
        + 'its full body at the lean footprint, unannounced');
      continue;
    }
    // `.slice(1)` drops the lead chunk — the file's preamble, which declares no rule.
    for (const block of splitAtLawHeadings(text).slice(1)) {
      // The declaration as the SOURCE spells it — `{{LAW:<id>}} <Name>` — because that is the
      // string an author greps for, and the rendered spelling is fourteen strings.
      const heading = block.slice(0, block.indexOf('\n') === -1 ? undefined : block.indexOf('\n'));
      const addr = heading.replace(/^###\s+/, '').split(/\s+[—-]\s+/)[0].trim();
      const found = [...block.matchAll(LEAN_BLOCK_RE)];
      if (found.length === 0) {
        problems.push(`[authoring] ${rel}: ${addr} has no LEAN block — resolveLean is a no-op on `
          + 'markerless text, so the rule would inline its FULL body at the default footprint');
        continue;
      }
      if (found.length > 1) {
        problems.push(`[authoring] ${rel}: ${addr} has ${found.length} LEAN blocks — both resolve, `
          + 'so which text a reader is handed is a fact about the order they were written in');
      }
      const [, full, lean] = found[0];
      if (!full.trim()) {
        problems.push(`[authoring] ${rel}: ${addr} has an empty full half — the rule would vanish `
          + 'from a full build and from its own on-disk file');
      }
      if (!lean.trim()) {
        problems.push(`[authoring] ${rel}: ${addr} has an empty lean half — the rule would render `
          + 'as a heading over nothing at the footprint most installs use');
      }
    }
  }
  return problems;
}

/**
 * The three-tier constitution's own authoring gates — the doctrine twin of the `LAW_CLASS` /
 * `LAW_META` family, plus the two purity rules the tiering rests on.
 *
 * IT LIVES BESIDE `countTableProblems` RATHER THAN INSIDE IT, and is called from
 * `authoringProblems` beside `registry`/`secret`/`vendorPin`. `countTableProblems` opens by
 * reading `AGENT.md.tmpl` and HARD-RETURNS if that read fails, so an arm placed inside it
 * would go quiet on exactly the tree that is most broken. Nothing here needs the template's
 * tables, and `proseMirrorProblems` — the frozen recording — is untouched either way.
 *
 * ⚠ THE VOCABULARY GATES ARE HERE BECAUSE `themeParityProblems` CANNOT SEE THEM. That check is
 * presence-only and SYMMETRIC over the union of every theme's keys: a key missing from all
 * fourteen is in parity, and a key whose VALUE breaks a parser is not its business at all. So
 * `DOC_*` coverage, the `LEX_*` equality and the single-word tier noun each need a gate
 * that reads the SOURCE and asks what the source requires.
 */
export function constitutionProblems() {
  const problems = [];

  // ---- every rule declares an id, every id is well-formed and unique, none is retired.
  //
  // Numbers are positional now (`ruleCanon`), so contiguity and filing cannot go wrong; what can
  // is the declaration itself. A `### ` line in a canon file that is not `{{KIND:id}} Name`
  // renders nowhere as a rule — no number, no title — and a duplicated id makes every citation
  // of it ambiguous.
  for (const [kind, pack, file] of canonFiles(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join('/');
    let text;
    try { text = readText(file); } catch (e) {
      problems.push(`[authoring] ${rel} is ${pack ? 'named in PACK_ORDER' : 'the canon'} but `
        + `unreadable: ${e.message} — every citation into it breaks`);
      continue;
    }
    let count = 0;
    for (const line of text.split('\n').filter((l) => l.startsWith('### '))) {
      const m = DECL_LINE_RE.exec(line);
      if (!m || m[1] !== kind) {
        problems.push(`[authoring] ${rel}: '${line}' is not a rule declaration — a rule heading `
          + `here reads '### {{${kind}:<id>}} <Principle Name>'; without an id it has no number, `
          + 'no title and no way to be cited');
        continue;
      }
      count += 1;
      if (!RULE_ID_RE.test(m[2])) {
        problems.push(`[authoring] ${rel}: rule id '${m[2]}' is not kebab-case (a-z, 0-9, '-')`);
      }
    }
    if (!count) {
      const why = pack ? 'the pack would render as an empty section' : 'there would be no invariants';
      problems.push(`[authoring] ${rel} declares no rule — ${why}`);
    }
  }
  const canon = ruleCanon(SRC);
  const seenIds = new Map();
  const seenNames = new Map();
  for (const r of canon.rules) {
    const where = r.kind === 'LAW' ? `law ${r.label}` : `doctrine ${r.label}`;
    if (seenIds.has(r.id)) {
      problems.push(`[authoring] rule id '${r.id}' is declared twice (${seenIds.get(r.id)} and `
        + `${where}) — ids are unique across laws and doctrines, or a citation names two rules`);
    } else seenIds.set(r.id, where);
    const lower = r.name.toLowerCase();
    if (seenNames.has(lower)) {
      problems.push(`[authoring] principle name '${r.name}' is declared twice (${seenNames.get(lower)} `
        + `and ${where}) — a citation renders as the name, so two rules would read as one`);
    } else seenNames.set(lower, where);
    const retiredAs = RETIRED_RULE_IDS[r.id];
    if (retiredAs && retiredAs.liveAs !== r.kind) {
      problems.push(`[authoring] ${where} reuses the retired id '${r.id}' (${retiredAs.was}, `
        + `${retiredAs.note}) — an id that meant one rule in someone's notes must never come back `
        + 'meaning another; pick a new one');
    }
  }
  const rules = new Map(canon.rules.filter((r) => r.kind === 'DOCTRINE')
    .map((r) => [`${r.pack}.${r.n}`, r]));

  // ---- the hook-gated rules are still at the address the hooks key them by.
  for (const [id, label] of Object.entries(HOOK_PINNED)) {
    const r = canon.byId.get(id);
    if (!r || r.label !== label) {
      problems.push(`[authoring] the hooks gate '${id}' as ${label} (js/hosts/hooks.mjs ledger keys, `
        + `settings.mjs CONSENT_RULE, the console's HOOK_GATED), but the canon ${r ? `numbers it ${r.label}`
          : 'no longer declares it'} — move those keys with it, or the tool boundary guards a `
        + 'different rule than the prompt names');
    }
  }

  // The console's Principle column, keyed off the rules just parsed — so the gate is driven by
  // the SOURCE and a rule added to a pack file is caught the same day, not when someone
  // notices a blank description in the browser.
  problems.push(...doctrineMetaProblems([...rules.keys()], [...rules.values()].map((r) => r.id)));

  // ---- every citation in src/ is by id, and every id resolves.
  //
  // The whole tree, not the template: a skill footer citing a rule that does not exist is as
  // broken as a template one, and it renders into every bundle.
  const cited = new Map();                                    // 'process.5' -> [rel, …]
  for (const p of rglob(SRC)) {
    if (!isFile(p) || !(p.endsWith('.md') || p.endsWith('.tmpl'))) continue;
    let text;
    try { text = readText(p); } catch { continue; }
    const rel = path.relative(SRC, p).split(path.sep).join('/');
    // ⚠ AN ALWAYS-ON TIER MAY NEVER CITE A TOGGLEABLE ONE (D2). A `--doctrines craft` build
    // ships invariants that point at rules its AGENT.md does not contain; the ontology is
    // worse still, being the tier that states the order the others sit in. Doctrine->doctrine
    // citations are fine and stay: the full catalogue ships in every bundle.
    if ((rel.startsWith('ontology/') || rel.startsWith('laws/')) && DOCTRINE_TOKEN_RE.test(text)) {
      problems.push(`[authoring] ${rel} cites {{DOCTRINE}} — an always-on tier may never `
        + 'reference a toggleable one, or a pack-off build ships a rule pointing at text '
        + 'that is not there. State the point directly instead');
    }
    for (const [bare] of text.matchAll(BARE_CITE_RE)) {
      problems.push(`[authoring] ${rel} cites '${bare.replace(/\s+/g, ' ')}' by number — numbers are `
        + 'positional and move when the canon does; cite {{LAW:<id>}} / {{DOCTRINE:<id>}}');
    }
    for (const [whole, kind, id] of text.matchAll(ID_CITE_RE)) {
      const r = canon.byId.get(id);
      if (r && r.kind === kind) {
        if (kind === 'DOCTRINE') {
          const key = `${r.pack}.${r.n}`;
          if (!cited.has(key)) cited.set(key, []);
          cited.get(key).push(rel);
        }
        continue;
      }
      const retiredAs = RETIRED_RULE_IDS[id];
      let why = 'which no law or doctrine declares — it would render as the raw token';
      if (r) why = `but '${id}' is a ${r.kind === 'LAW' ? 'law' : 'doctrine rule'} — use {{${r.kind}:${id}}}`;
      else if (retiredAs) {
        why = `a retired id (${retiredAs.was}, ${retiredAs.note}) — cite the rule its text now lives in`;
      }
      problems.push(`[authoring] ${rel} cites ${whole}, ${why}`);
    }
  }

  // ---- the vocabulary every theme owes the source: one title per declared rule, keyed by id.
  const wanted = new Set(canon.rules.filter((r) => r.kind === 'DOCTRINE').map((r) => titleKey(r.kind, r.id)));
  const lexWant = canon.rules.filter((r) => r.kind === 'LAW').map((r) => titleKey(r.kind, r.id));
  // `_TEMPLATE.json` is included — it is the file `--sync-themes` seeds a new theme from, so a
  // stale key there propagates into every voice added afterwards. `themeFiles()` excludes it.
  const files = [...themeFiles(), path.join(THEMES, '_TEMPLATE.json')];
  for (const f of files) {
    const name = path.basename(f);
    let theme;
    try { theme = parseJson(readText(f)); } catch (e) {
      problems.push(`[authoring] ${name} unreadable: ${e.message}`);
      continue;
    }
    if (!theme || typeof theme !== 'object' || Array.isArray(theme)) continue;
    const keys = Object.keys(theme);
    for (const key of [...wanted].sort()) {
      if (!Object.hasOwn(theme, key)) {
        problems.push(`[authoring] ${name} has no {${key}} — a doctrine rule declares it, and `
          + 'theme parity cannot see a key that is missing from every theme at once');
      }
    }
    for (const key of keys.filter((k) => k.startsWith('DOC_')).sort()) {
      if (!wanted.has(key)) {
        problems.push(`[authoring] ${name} defines {${key}}, which no doctrine rule declares — a `
          + 'dead voice key ships a title for a rule that does not exist');
      }
    }
    // I1 — an EQUALITY, not a presence check. The renumber left `LEX_XXII`, `LEX_XXIII`,
    // `LEX_XXIV` and `LEX_XXXVI` behind in all fifteen files, and parity was silent because
    // they were absent from nowhere.
    const lex = keys.filter((k) => k.startsWith('LEX_')).sort();
    const stale = lex.filter((k) => !lexWant.includes(k));
    const missing = lexWant.filter((k) => !lex.includes(k));
    for (const k of stale) {
      problems.push(`[authoring] ${name} still defines {${k}} — no law declares this id and `
        + 'nothing renders this key, so it is a title for a rule that no longer exists');
    }
    for (const k of missing) {
      problems.push(`[authoring] ${name} has no {${k}} — one of the invariants would `
        + 'render with an empty title');
    }
    // M10 — ⚠ BOTH HEADING PARSERS MATCH THE TIER NOUN WITH `\S+`. A two-word value does not
    // error; the heading stops matching and the tier silently parses to nothing. `_TEMPLATE`'s
    // values are descriptive placeholders, so only real voices are held to this.
    if (name === '_TEMPLATE.json') continue;
    for (const key of ['LAW', 'DOCTRINE']) {
      const v = theme[key];
      if (typeof v === 'string' && /\s/.test(v)) {
        problems.push(`[authoring] ${name} spells {${key}} as ${formatRepr(v)} — the heading `
          + 'parsers match the tier noun with \\S+, so a value with a space makes every '
          + `${key === 'LAW' ? 'invariant' : 'doctrine rule'} parse to nothing, in silence`);
      }
    }
  }

  // ---- every `§N` in src/ addresses a section the template actually declares.
  //
  // ⚠ THIS GATE IS NARROW AND SAYS SO. Inserting `## 2. Doctrines` pushed every later section
  // down one, and the sweep that fixed the template's own cross-references stopped at the
  // template — four satellites under `src/skills/` and `src/agents/` kept pointing at the
  // section that used to be there, and they RENDER INTO EVERY BUNDLE. A range check would not
  // have caught those: §7 still existed, it had just stopped being the Wiki.
  //
  // What it does catch is the other half of a renumber — a pointer past the end, which is what
  // REMOVING a section leaves behind — and it is nearly free. The half it cannot catch is a
  // judgement about intent, and `docs/extending.md` carries the manual sweep for it. Naming
  // that limit here is the point: a reader who assumes this gate is total will skip the sweep.
  const declared = new Set();
  // Read here rather than borrowing `countTableProblems`' copy: that function hard-returns when
  // the template is unreadable, and this gate must not inherit a silence it did not choose.
  let tmpl = '';
  try { tmpl = readText(path.join(SRC, 'AGENT.md.tmpl')); } catch { tmpl = ''; }
  for (const [, n] of tmpl.matchAll(/^## (\d+)\.\s/gm)) declared.add(Number(n));
  if (declared.size) {
    for (const p of rglob(SRC)) {
      if (!isFile(p) || !(p.endsWith('.md') || p.endsWith('.tmpl'))) continue;
      let text;
      try { text = readText(p); } catch { continue; }
      const rel = path.relative(SRC, p).split(path.sep).join('/');
      for (const [, n] of text.matchAll(/§(\d+)/g)) {
        if (declared.has(Number(n))) continue;
        problems.push(`[authoring] ${rel} cites AGENT.md §${n}, and the template declares no `
          + `such section ${formatRepr([...declared].sort((a, b) => a - b).map(String))} — a `
          + 'renumber moved it, and this pointer renders into every bundle');
      }
    }
  }

  // ---- the build default names packs that exist.
  let cfgDoctrines = null;
  try {
    const cfg = parseJson(readText(CONFIG));
    if (cfg && typeof cfg === 'object' && Array.isArray(cfg.doctrines)) cfgDoctrines = cfg.doctrines;
  } catch { /* no config, or unreadable — `configDefaults()` is forgiving here too */ }
  if (cfgDoctrines) {
    for (const pack of cfgDoctrines) {
      if (!PACK_ORDER.includes(pack)) {
        problems.push(`[authoring] harness.config.json names doctrine pack ${formatRepr(pack)}, `
          + `which this checkout does not ship ${formatRepr([...PACK_ORDER])} — every build reading `
          + 'that default would fail');
      }
    }
  }

  // ---- D5, a NOTE and not a problem: what a narrowed default leaves pointing at the shelf.
  const on = cfgDoctrines ?? [...PACK_ORDER];
  const dangling = [...cited].filter(([k]) => rules.has(k) && !on.includes(k.split('.')[0]));
  if (dangling.length) {
    const packs = [...new Set(dangling.map(([k]) => k.split('.')[0]))].sort();
    problems.push(`${NOTE}harness.config.json builds ${formatRepr(on)}, and ${dangling.length} `
      + `citation(s) in src/ point into ${packs.join(', ')}. Those rules still SHIP — every `
      + 'pack file is in the bundle — so the reference resolves on disk; it is the rendered '
      + 'AGENT.md that will not contain them. Legal, and recorded here so it is not silent');
  }
  return problems;
}
