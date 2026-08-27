/**
 * The AUTHORING gates — whether the sources agree with themselves. Law and doctrine
 * metadata, the constitution's numbering, the counts the README and the web UI quote back,
 * and `authoringProblems`, which aggregates them and compiles the OpenCode plugins.
 *
 * Over half of the old `doctor.mjs` was this group, and it is the one with the most reasons
 * to be read: adding a law, a doctrine or a skill moves numbers in files nobody edits by
 * hand, and these are the assertions that say so. `tests/unit/authoring_gates.test.mjs` is
 * its gate, and plants one fault per check.
 *
 * `authoringProblems` is why the doctor is the one verb allowed to spawn a process — it runs
 * `node --check` over every OpenCode plugin. See `doctor.mjs` for what that allow-list costs.
 */
import path from 'node:path';
import {
  CONFIG, PACK_ORDER, PLUGIN_SRC, ROOT, SRC, THEMES, knownRuleIds,
} from '../build/source.mjs';
import { themeFiles } from '../hosts/installs.mjs';
import { descBlockProblem, firstBlockquote } from '../hosts/native.mjs';
import { readText } from '../lib/fs.mjs';
import { parseJson, formatRepr } from '../lib/json.mjs';
import { which } from '../lib/paths.mjs';
import { NO_WINDOW } from '../lib/proc.mjs';
import { registryProblems, secretProblems, vendorPinProblems } from './checks-repo.mjs';
import { LAW_CLASS, LAW_CLASSES, SKILL_CLASS } from './inventory.mjs';
import { NOTE, globSorted, has, isDir, isFile, rglob, srcStems } from './scan.mjs';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';

const ROMAN_VALUES = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

/**
 * `_harness_build._roman_to_int`. Law headings number in Roman and the web ledger keys its
 * per-rule copy by the Arabic equivalent, so the gate has to bridge the two. 0 on an
 * unparseable numeral, which surfaces as a gate problem rather than a crash.
 */
export function romanToInt(num) {
  let total = 0;
  let prev = 0;
  for (const ch of [...num.toUpperCase()].reverse()) {
    const v = ROMAN_VALUES[ch];
    if (v === undefined) return 0;
    total += v < prev ? -v : v;
    prev = Math.max(prev, v);
  }
  return total;
}

/**
 * `_harness_build._LAW_META_ROW` — `<arabic>: ['<class>', '<principle>'],` in the web page.
 *
 * Either quote style, because a principle carrying an apostrophe is double-quoted. Every
 * `\s*` spans newlines and the trailing comma before `]` is optional, so a row a prettier has
 * reflowed across several lines still matches — a gate that only understood the one-line form
 * silently lost it and left the law's Principle unguarded.
 *
 * `(?m)` is the `m` flag; JS has no inline form. The `.` inside the captures must NOT match a
 * newline (Python has no `re.S` here), which is JS's default.
 */
const LAW_META_ROW = /^[^\S\n]*(\d+):\s*\[\s*(['"])(.*?)\2\s*,\s*(['"])(.*?)\4\s*,?\s*\]\s*,?[^\S\n]*$/gm;

/**
 * `_harness_build._law_meta_problems` — the web Laws ledger's per-rule copy stays complete.
 *
 * `LAW_META` holds each law's one-line Principle, copy that exists nowhere else in the tree,
 * and a law with no row falls back to `['craft', '']`: the rule renders with a blank
 * description and the wrong class chip, while everything upstream is fine. That is exactly
 * how two laws shipped description-less.
 */
export function lawMetaProblems(lawNums, lawClass, lawClasses) {
  const page = path.join(ROOT, 'web', 'src', 'pages', 'Laws.jsx');
  let text;
  try { text = readText(page); } catch (e) {
    return [`[authoring] web/src/pages/Laws.jsx unreadable: ${e.message}`];
  }
  const block = /^const LAW_META = \{$([\s\S]*?)^\}$/m.exec(text);
  if (!block) {
    return ['[authoring] LAW_META literal not found in web/src/pages/Laws.jsx — the web '
      + 'Laws ledger\'s Principle column would have no gate'];
  }
  const meta = new Map();
  for (const m of block[1].matchAll(LAW_META_ROW)) {
    meta.set(Number(m[1]), [m[3], m[5]]);
  }
  const problems = [];
  const seen = new Set();
  for (const roman of lawNums) {
    const n = romanToInt(roman);
    seen.add(n);
    if (!meta.has(n)) {
      problems.push(`[authoring] laws/universal.md rule ${roman} (${n}) has no row in `
        + 'LAW_META (web/src/pages/Laws.jsx) — the web Laws ledger would '
        + 'render it with a blank Principle');
      continue;
    }
    const [klass, principle] = meta.get(n);
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

/** `LAW_META_ROW`'s twin for a STRING key — `'<pack>.<n>': ['<pack>', '<principle>'],`. */
const DOCTRINE_META_ROW =
  /^[^\S\n]*(['"])([a-z]+\.\d+)\1:\s*\[\s*(['"])(.*?)\3\s*,\s*(['"])(.*?)\5\s*,?\s*\]\s*,?[^\S\n]*$/gm;

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
export function doctrineMetaProblems(addrs) {
  const page = path.join(ROOT, 'web', 'src', 'pages', 'Laws.jsx');
  let text;
  try { text = readText(page); } catch (e) {
    return [`[authoring] web/src/pages/Laws.jsx unreadable: ${e.message}`];
  }
  const block = /^const DOCTRINE_META = \{$([\s\S]*?)^\}$/m.exec(text);
  if (!block) {
    return ['[authoring] DOCTRINE_META literal not found in web/src/pages/Laws.jsx — the '
      + "console's doctrine rows would have no gate on their Principle column"];
  }
  const meta = new Map();
  for (const m of block[1].matchAll(DOCTRINE_META_ROW)) meta.set(m[2], [m[4], m[6]]);
  const problems = [];
  const seen = new Set();
  for (const addr of addrs) {
    seen.add(addr);
    if (!meta.has(addr)) {
      problems.push(`[authoring] doctrine rule ${addr} has no row in DOCTRINE_META `
        + '(web/src/pages/Laws.jsx) — the console would render it with a blank Principle');
      continue;
    }
    const [klass, principle] = meta.get(addr);
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

/**
 * `_harness_build._prose_mirror_problems` — the human-readable count mirrors, the ones the
 * badge regex never sees.
 *
 * The README "What you get" table and the web onboarding copy each restate the law / agent /
 * skill counts in prose, and the README enumerates the skills by name. Nothing renders these,
 * so they drift silently — they already had. Pure over its inputs, so the corpus can feed it
 * crafted drift without touching the tree.
 */
export function proseMirrorProblems(readme, web, counts, skillStems, shipped = '') {
  const problems = [];
  const { laws, agents, skills, plugins } = counts;

  for (const m of readme.matchAll(/(\d+) universal laws/g)) {
    if (Number(m[1]) !== laws) {
      problems.push(`[authoring] README prose says '${m[1]} universal laws' but src has ${laws}`);
    }
  }
  // The README plugin count. It had drifted — the overview sentence said six while seven
  // shipped — because the project's other plugin count ({N_PLUGINS} in the web docs) reads
  // a DEPLOYED plugins dir that a markdown file in this repository never has. `plugins` is
  // optional in `counts` (Python's `.get`, undefined here) because the corpus predates it.
  if (plugins !== undefined) {
    for (const m of readme.matchAll(/(\d+) \*{0,2}plugins/g)) {
      if (Number(m[1]) !== plugins) {
        problems.push(`[authoring] README prose says '${m[1]} plugins' but `
          + `adapters/opencode/plugins has ${plugins}`);
      }
    }
  }
  for (const [label, want] of [['Agents', agents], ['Skills', skills]]) {
    const m = new RegExp(`${label}\\*\\*\\s*\\((\\d+)\\)`).exec(readme);
    if (m && Number(m[1]) !== want) {
      problems.push(`[authoring] README '${label} (${m[1]})' but src has ${want}`);
    }
  }
  // The README Skills row must enumerate EXACTLY the source skills — a dropped name is
  // invisible to the (N) count alone, which is the off-by-one this gate forbids.
  const row = readme.split('\n').find((ln) => ln.includes('🛠') && ln.includes('Skills')) ?? '';
  if (row.includes('workflows:')) {
    const listed = new Set(row.split('workflows:').slice(1).join('workflows:').split('·')
      .map((seg) => seg.replace(/[^a-z0-9-]/g, '')));
    listed.delete('');
    for (const missing of [...skillStems].filter((s) => !listed.has(s)).sort()) {
      problems.push(`[authoring] README skills list omits '${missing}'`);
    }
    for (const orphan of [...listed].filter((s) => !skillStems.has(s)).sort()) {
      problems.push(`[authoring] README skills list names '${orphan}' but no `
        + `skills/${orphan}.md exists`);
    }
  }

  for (const m of web.matchAll(/(\d+) universal (?:laws|Rules)/g)) {
    if (Number(m[1]) !== laws) {
      problems.push(`[authoring] _web_core prose says '${m[1]} universal laws/Rules' but `
        + `src has ${laws}`);
    }
  }
  for (const m of web.matchAll(/(\d+) capability specialists/g)) {
    if (Number(m[1]) !== agents) {
      problems.push(`[authoring] _web_core prose says '${m[1]} capability specialists' but `
        + `src has ${agents}`);
    }
  }
  // N is a curated-subset size, not the total, so it is gated against the wikilinks it
  // introduces rather than against the skill count. `[\s\S]` is Python's `re.S` dot.
  const m = /(\d+) repeatable workflows the agent can invoke by name([\s\S]*?)playbook under/
    .exec(web);
  if (m) {
    const listedN = (m[2].match(/\[\[[^\]]+\]\]/g) ?? []).length;
    if (Number(m[1]) !== listedN) {
      problems.push(`[authoring] _web_core says '${m[1]} repeatable workflows' `
        + `but its wikilink list has ${listedN}`);
    }
  }

  // ⚠ THE ABSENCE OF THIS TRIPLE IS CHECKED BY THE CALLER, NOT HERE, AND THAT IS FORCED RATHER
  // THAN CHOSEN. This arm is satisfiable by DELETING THE SENTENCE — no match, no problem, green
  // — which is a gate failing open. The obvious fix is an `else` right here, and it cannot go
  // here: `prose_mirror_problems` is one of the pure functions recorded in
  // `tests/__snapshots__/primitives/`, the recording holds a case that passes an EMPTY `shipped`
  // and expects `[]`, and there is no recorder left to re-bless it. So the presence check lives
  // in `countTableProblems`, which is not recorded — beside the read that already knows whether
  // the file could be opened at all, which is where it reads better anyway.
  const s = /(\d+) laws, (\d+) agents, (\d+) skills/.exec(shipped);
  if (s) {
    for (const [got, want, label] of [[s[1], laws, 'laws'], [s[2], agents, 'agents'],
      [s[3], skills, 'skills']]) {
      if (Number(got) !== want) {
        problems.push(`[authoring] SHIPPED.md says '${got} ${label}' but src has ${want}`);
      }
    }
  }
  return problems;
}

/** `_build_render._TMPL_SPEC_RE`, as the count gate spells it. */
const TMPL_SPEC_RE = /\{\{DIR_(AGENTS|SKILLS)\}\}\/([A-Za-z0-9_-]+)\.md/g;
const LAW_HEADING_RE = /^### \{\{LAW\}\} ([IVXLCDM]+)\b/gm;

// The doctrine twins of `LAW_HEADING_RE`, over the UNRENDERED source — `js/inspect/inventory.mjs`'s
// pair of the same names read the rendered form. A citation is the heading minus its `### `,
// so one regex cannot serve both: a heading is an anchored line, a citation is anywhere.
const DOCTRINE_HEADING_RE = /^### \{\{DOCTRINE\}\} ([a-z]+) (\d+)\b/gm;
const DOCTRINE_CITE_RE = /\{\{DOCTRINE\}\}\s+([a-z]+)\s+(\d+)/g;
// `\{\{DOCTRINE\}\}` and not `DOCTRINE`: `{{DOCTRINES}}` is the SECTION noun and is legal
// everywhere, including in an invariant that points at the tier as a whole.
const DOCTRINE_TOKEN_RE = /\{\{DOCTRINE\}\}/;
const DOC_TOKEN_RE = /\{\{(DOC_[A-Z0-9_]+)\}\}/g;

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
 * `DOC_*` coverage, the `LEX_I..LEX_IX` equality and the single-word tier noun each need a gate
 * that reads the SOURCE and asks what the source requires.
 */
export function constitutionProblems() {
  const problems = [];
  const dir = path.join(SRC, 'doctrines');

  // ---- the packs themselves: present, contiguous from 1, and filed where they say they are.
  const rules = new Map();                                    // 'craft.1' -> title-less marker
  for (const pack of PACK_ORDER) {
    const file = path.join(dir, `${pack}.md`);
    let text;
    try { text = readText(file); } catch (e) {
      problems.push(`[authoring] doctrines/${pack}.md is named in PACK_ORDER but unreadable: `
        + `${e.message} — the build ships the whole catalogue, so a missing pack file breaks `
        + 'every citation into it, active or not');
      continue;
    }
    const found = [...text.matchAll(DOCTRINE_HEADING_RE)];
    if (!found.length) {
      problems.push(`[authoring] doctrines/${pack}.md carries no '### {{DOCTRINE}} ${pack} <n>' `
        + 'heading — the pack would render as an empty section');
      continue;
    }
    found.forEach(([, named, n], i) => {
      if (named !== pack) {
        problems.push(`[authoring] doctrines/${pack}.md holds a rule addressed to '${named} `
          + `${n}' — a rule's pack is read from its heading, so this one is unreachable at `
          + `'${pack}.${n}' and shadows whatever ${named}.md numbers ${n}`);
      }
      if (Number(n) !== i + 1) {
        problems.push(`[authoring] doctrines/${pack}.md rule ${n} is at position ${i + 1} — `
          + 'pack ids must run contiguously from 1, or a citation addresses a gap');
      }
      rules.set(`${named}.${Number(n)}`, true);
    });
  }

  // The console's Principle column, keyed off the rules just parsed — so the gate is driven by
  // the SOURCE and a rule added to a pack file is caught the same day, not when someone
  // notices a blank description in the browser.
  problems.push(...doctrineMetaProblems([...rules.keys()]));

  // ---- `--exclude-rules` closes against the SAME rules this walk just found.
  //
  // `knownRuleIds` is what the CLI flag, the console's trust boundary and every wizard prompt
  // validate an address against; the walk above is what the constitution actually renders.
  // Two readers of one directory is the shape that lets a rule be authored, rendered, cited —
  // and rejected by the only flag that can switch it off, with `invalid choice` naming a set
  // that visibly contains it. An equality, not containment: a stale id in the enumerator is a
  // rule the console offers a switch for and the build cannot drop.
  const enumerated = knownRuleIds();
  const walked = [...rules.keys()];
  for (const id of enumerated.filter((i) => !walked.includes(i))) {
    problems.push(`[authoring] knownRuleIds() offers '${id.replace('.', ' ')}', which no pack `
      + 'file defines — --exclude-rules accepts an address the build cannot drop');
  }
  for (const id of walked.filter((i) => !enumerated.includes(i))) {
    problems.push(`[authoring] doctrine ${id.replace('.', ' ')} is defined but knownRuleIds() `
      + 'does not offer it — --exclude-rules refuses a rule that exists, and the console has '
      + 'no switch for it');
  }

  // ---- the consent gate's address still names the consent rule.
  //
  // ⚠ THE ONE HARDCODED ADDRESS IN THE CODEBASE, and the one whose drift is silent AND unsafe.
  // `js/hosts/settings.mjs` keys the git-gate hooks on `process.5` by literal; a renumber of the
  // process pack moves that rule's neighbours under it, and the boundary would then follow
  // whatever rule inherited the number while the prompt still said `process 5`. Checked
  // against the pack file's own title token rather than against prose, so a reworded rule is
  // not a false alarm and a MOVED one is not a silent pass.
  const consentTitle = 'DOC_PROCESS_5';
  let processText = '';
  try { processText = readText(path.join(dir, 'process.md')); } catch { /* reported above */ }
  if (processText && !new RegExp(`^### \\{\\{DOCTRINE\\}\\} process 5 — \\{\\{${consentTitle}\\}\\}`,
    'm').test(processText)) {
    problems.push('[authoring] js/hosts/settings.mjs gates git commit/push on doctrine \'process 5\', '
      + `but doctrines/process.md does not number {${consentTitle}} 5 — the tool boundary and `
      + 'the prompt now name different rules');
  }

  // ---- every `{{DOCTRINE}} <pack> <n>` anywhere in src/ resolves to a rule that exists.
  //
  // The whole tree, not the template: a skill footer citing `process 9` is as broken as a
  // template one, and it is the shape 339 rewired citations could have left behind.
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
    for (const [, pack, n] of text.matchAll(DOCTRINE_CITE_RE)) {
      const key = `${pack}.${Number(n)}`;
      if (!cited.has(key)) cited.set(key, []);
      cited.get(key).push(rel);
    }
  }
  for (const [key, where] of [...cited].sort()) {
    if (rules.has(key)) continue;
    problems.push(`[authoring] ${where[0]} cites {{DOCTRINE}} ${key.replace('.', ' ')}, which `
      + `no pack file defines${where.length > 1 ? ` (and ${where.length - 1} more)` : ''}`);
  }

  // ---- the vocabulary every theme owes the source.
  const wanted = new Set();
  for (const pack of PACK_ORDER) {
    let text;
    try { text = readText(path.join(dir, `${pack}.md`)); } catch { continue; }
    for (const [, key] of text.matchAll(DOC_TOKEN_RE)) wanted.add(key);
  }
  const lexWant = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI']
    .map((r) => `LEX_${r}`);
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
        problems.push(`[authoring] ${name} has no {${key}} — a doctrine file names it, and `
          + 'theme parity cannot see a key that is missing from every theme at once');
      }
    }
    for (const key of keys.filter((k) => k.startsWith('DOC_')).sort()) {
      if (!wanted.has(key)) {
        problems.push(`[authoring] ${name} defines {${key}}, which no doctrine file uses — a `
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
      problems.push(`[authoring] ${name} still defines {${k}} — no law heading carries this `
        + 'numeral and nothing renders this key, so it is a title for a rule that no longer exists');
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

/**
 * `_harness_build._count_table_problems` — the hand-authored AGENT.md tables and the README
 * badges, against `src/`.
 *
 * The tables must list EXACTLY the spec files (no dead row, no orphaned spec) and each
 * `agents`/`skills`/`laws`/`themes` badge must equal the real count. This is the
 * authoring-time guarantee that lets tables, badges and prose stay hand-written without
 * silently drifting from the source tree.
 */
export function countTableProblems() {
  const problems = [];
  let ttext;
  try { ttext = readText(path.join(SRC, 'AGENT.md.tmpl')); } catch (e) {
    return [`[authoring] AGENT.md.tmpl unreadable: ${e.message}`];
  }

  const linked = { agents: new Set(), skills: new Set() };
  for (const m of ttext.matchAll(TMPL_SPEC_RE)) {
    if (m[2] !== '_template') linked[m[1] === 'AGENTS' ? 'agents' : 'skills'].add(m[2]);
  }
  for (const folder of ['agents', 'skills']) {
    const files = srcStems(folder);
    for (const missing of [...linked[folder]].filter((x) => !files.has(x)).sort()) {
      problems.push(`[authoring] AGENT.md links ${folder}/${missing}.md but no such spec exists`);
    }
    for (const orphan of [...files].filter((x) => !linked[folder].has(x)).sort()) {
      problems.push(`[authoring] ${folder}/${orphan}.md exists but the AGENT.md table omits it`);
    }
  }

  const skillFiles = srcStems('skills');
  for (const missing of [...skillFiles].filter((s) => !has(SKILL_CLASS, s)).sort()) {
    problems.push(`[authoring] skills/${missing}.md has no category in SKILL_CLASS`);
  }
  for (const stale of Object.keys(SKILL_CLASS).filter((s) => !skillFiles.has(s)).sort()) {
    problems.push(`[authoring] SKILL_CLASS lists '${stale}' but no skills/${stale}.md exists`);
  }

  const lawsMd = path.join(SRC, 'laws', 'universal.md');
  const lawNums = isFile(lawsMd)
    ? [...readText(lawsMd).matchAll(LAW_HEADING_RE)].map((m) => m[1]) : [];
  for (const num of lawNums) {
    if (!has(LAW_CLASS, num)) {
      problems.push(`[authoring] laws/universal.md rule ${num} has no class in LAW_CLASS`);
    }
  }
  // `sorted(LAW_CLASS.items())` — by the Roman numeral as a STRING, which is what Python
  // sorts here; the messages are re-sorted by `doctorCollect` anyway, so only the set travels.
  for (const num of Object.keys(LAW_CLASS).sort()) {
    if (!LAW_CLASSES.includes(LAW_CLASS[num])) {
      problems.push(`[authoring] LAW_CLASS['${num}'] = '${LAW_CLASS[num]}' is not a known `
        + `class ${formatRepr(LAW_CLASSES)}`);
    }
  }
  problems.push(...lawMetaProblems(lawNums, LAW_CLASS, LAW_CLASSES));

  const counts = {
    agents: srcStems('agents').size,
    skills: srcStems('skills').size,
    laws: lawNums.length,
    themes: themeFiles().length,
    // Last on purpose: the badge loop below walks this object in insertion order and the
    // message sequence is compared byte for byte against the Python implementation.
    plugins: existsSync(PLUGIN_SRC)
      ? readdirSync(PLUGIN_SRC).filter((f) => f.startsWith('geneseed-') && f.endsWith('.js')).length
      : 0,
  };
  let readme;
  try { readme = readText(path.join(ROOT, 'README.md')); } catch { return problems; }
  // ⚠ PRESENCE FIRST, THEN THE VALUE — the same absence arm the SHIPPED triple needed, for the
  // same reason: `if (m && …)` is green when there is no badge, so deleting a badge silences its
  // own gate. The `continue` keeps the loop's MESSAGE ORDER intact, which is load-bearing (see
  // the `plugins`-is-last comment above): a missing badge reports in its own slot rather than
  // reordering the ones after it.
  for (const [key, n] of Object.entries(counts)) {
    const m = new RegExp(`badge/${key}-(\\d+)`).exec(readme);
    if (!m) {
      problems.push(`[authoring] README has no ${key} badge — deleting one is how this gate `
        + 'goes green while the reader is told nothing');
      continue;
    }
    if (Number(m[1]) !== n) {
      problems.push(`[authoring] README ${key} badge says ${m[1]} but src has ${n}`);
    }
  }

  // WHERE THE ONBOARDING COPY LIVES, AND WHY THIS READ MOVED. It used to open the one module
  // that held the web console's onboarding prose. That prose has since moved into
  // `docs/web/*.md`, and the counts in it render from `{N_LAWS}` / `{N_AGENTS}` / `{N_SKILLS}`
  // — so the read was still succeeding against a file the sentences had left, all three arms
  // below scored zero, and the check looked healthy while gating nothing. A templated count
  // cannot drift; what these arms still catch is a maintainer typing the NUMBER into a page
  // instead of the token, which is the drift that reaches a reader.
  //
  // MEASURED BEFORE AND AFTER: zero problems either way on the shipped tree, so no recorded
  // byte moves. `web` stays fail-soft — a missing docs tree is not an authoring fault.
  let web = '';
  try {
    web = globSorted(path.join(ROOT, 'docs', 'web'), (n) => n.endsWith('.md'))
      .map(readText).join('\n');
  } catch { web = ''; }
  // ⚠ NOT FAIL-SOFT, UNLIKE `web` ABOVE, AND THE ASYMMETRY IS THE POINT. A missing `docs/web`
  // tree is not an authoring fault — a checkout can legitimately lack it. SHIPPED.md is a
  // tracked, shipped file that this function asserts the CONTENT of, so an unreadable one is
  // indistinguishable from a deleted claim: swallowing it into `''` used to hand the triple arm
  // an empty string and turn a hard read failure into a silent pass.
  // ⚠ NOT FAIL-SOFT, UNLIKE `web` ABOVE, AND THE ASYMMETRY IS THE POINT. A missing `docs/web`
  // tree is not an authoring fault — a checkout can legitimately lack it. SHIPPED.md is a
  // tracked, shipped file whose CONTENT this function asserts, so an unreadable one was
  // indistinguishable from a deleted claim: swallowing it into `''` handed the triple arm an
  // empty string and turned a hard read failure into a silent pass.
  //
  // AND THE PRESENCE OF THE TRIPLE IS CHECKED HERE rather than inside `proseMirrorProblems`,
  // which is where it belongs by subject and cannot go by construction — that function is
  // recorded in `tests/__snapshots__/primitives/` with a case that passes an empty `shipped` and
  // expects `[]`, and nothing can re-bless a recording whose recorder is deleted. This is the
  // caller, it is not recorded, and it already owns the question "could the file be read".
  let shipped;
  try {
    shipped = readText(path.join(ROOT, 'SHIPPED.md'));
  } catch (e) {
    problems.push(`[authoring] SHIPPED.md is unreadable (${e.message}) — the counts it carries `
      + 'cannot be checked, and a gate that cannot read its subject must say so');
    shipped = '';
  }
  if (shipped && !/(\d+) laws, (\d+) agents, (\d+) skills/.test(shipped)) {
    problems.push('[authoring] SHIPPED.md carries no \'N laws, N agents, N skills\' line — '
      + 'deleting it is how that gate goes green while the count drifts');
  }
  problems.push(...proseMirrorProblems(readme, web, counts, skillFiles, shipped));
  return problems;
}

/** `_harness_core.LEARN_PROMPT_HEAD`'s extraction regex — one owner, two readers. */
const LEARN_PROMPT_RE = /const LEARN_PROMPT_HEAD = `([\s\S]*?)`/;

/**
 * `_harness_core._load_learn_prompt_head` — the distil instructions, read out of the plugin.
 *
 * The single source of truth is the OpenCode plugin, the artifact that ships to the primary
 * runtime, so the CLI extracts it at load time rather than carrying a copy. Reproduced here
 * rather than imported from `js/hosts/hooks.mjs`, which this entry may not reach: `learn` spawns the
 * model CLI, and the allow-list below names ONE call site.
 *
 * The fallback matters as much as the extraction. It is what makes the drift arm of
 * `_authoring_problems` unreachable — both the loaded copy and the checked literal come from
 * one file through one regex, so a reference can never disagree with itself. A port that
 * hardcoded the prompt WOULD disagree, which is what
 * `doctor/the-loaded-copy-follows-the-plugin-rather-than-a-constant` exists to catch.
 */
function loadLearnPromptHead() {
  try {
    const m = LEARN_PROMPT_RE.exec(readText(path.join(PLUGIN_SRC, 'geneseed-learn.js')));
    if (m) return m[1];
  } catch { /* OSError — fall through */ }
  return 'Distil at most one durable, reusable memory from the notes below. '
    + 'When in doubt, output exactly: NOTHING.';
}

/**
 * `_harness_build._authoring_problems` — author-time gates on the source specs and plugins.
 *
 * Every agent/skill spec must carry a one-line `>` purpose blockquote as the FIRST content
 * block after its title, or its `description:` on every host either renders empty or silently
 * picks up the WRONG line; the learn-prompt literal must stay extractable; and, if node is on
 * PATH, the plugins must pass `node --check`. Then three source-wide gates: the lifecycle
 * registry describes exactly what `src/` provides, no credential ships, and every vendored
 * folder carries an immutable upstream pin.
 */
export function authoringProblems() {
  const problems = [];
  for (const folder of ['agents', 'skills']) {
    const d = path.join(SRC, folder);
    if (!isDir(d)) continue;
    for (const spec of globSorted(d, (n) => n.endsWith('.md') && !n.startsWith('_'))) {
      let text;
      try { text = readText(spec); } catch (e) {
        problems.push(`[authoring] ${folder}/${path.basename(spec)} unreadable: ${e.message}`);
        continue;
      }
      if (!firstBlockquote(text)) {
        problems.push(`[authoring] ${folder}/${path.basename(spec)} has no '>' purpose line `
          + '(its OpenCode description would render empty)');
        continue;
      }
      const reason = descBlockProblem(text);
      if (reason) {
        problems.push(`[authoring] ${folder}/${path.basename(spec)}: ${reason} — `
          + 'desc_of() would silently extract the wrong description');
      }
    }
  }
  const plugin = path.join(PLUGIN_SRC, 'geneseed-learn.js');
  let m = null;
  try { m = LEARN_PROMPT_RE.exec(readText(plugin)); } catch { m = null; }
  if (!m) {
    // "the harness", not `harness.py`: both implementations load this literal, and the file
    // the old wording named is the one this migration deletes. Moved on both sides at once —
    // these two strings are byte-compared by the live doctor comparison.
    problems.push('[authoring] LEARN_PROMPT_HEAD literal not found in '
      + 'geneseed-learn.js — the harness would fall back (single source broken)');
  } else if (m[1] !== loadLearnPromptHead()) {
    problems.push('[authoring] LEARN_PROMPT_HEAD drifted between geneseed-learn.js '
      + "and the harness's loaded copy");
  }
  const node = which('node');
  if (node) {
    for (const js of globSorted(PLUGIN_SRC, (n) => n.endsWith('.js'))) {
      // THE ONE SPAWN. `node --check` and nothing else — see the module header, and
      // the `inspect/checks-authoring.mjs` row of the spawn allow-list in
// `tests/unit/hook_cli.test.mjs`, which names this argv literally.
      // `NO_WINDOW` because the reference's `run()` folds `CREATE_NO_WINDOW` into every
      // CAPTURING spawn and this is one — and because this loop is the burst a user sees:
      // one console window per plugin, every time the web daemon runs the doctor.
      const r = spawnSync(node, ['--check', js], { encoding: 'utf-8', ...NO_WINDOW });
      if (r.status !== 0) {
        // `(stderr.strip().splitlines() or ["syntax error"])[-1]` — node's LAST line, which
        // is its version banner rather than the SyntaxError. Faithful, and surprising enough
        // that the cell asserts the prefix and never the version.
        const lines = (r.stderr ?? '').trim().split('\n').filter((x) => x !== '');
        const tail = lines.length ? lines[lines.length - 1] : 'syntax error';
        problems.push(`[authoring] node --check failed for ${path.basename(js)}: ${tail}`);
      }
    }
  }
  problems.push(...registryProblems());
  problems.push(...secretProblems());
  problems.push(...vendorPinProblems());
  problems.push(...constitutionProblems());
  problems.push(...countTableProblems());
  return problems;
}

