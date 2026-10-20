/**
 * The COUNT gates — the hand-written tables, badges and prose that restate how many laws,
 * agents, skills, themes and plugins ship, held against `src/`.
 *
 * Split out of `checks-authoring.mjs`, which still aggregates these (and re-exports them for
 * its existing importers). `proseMirrorProblems` is pure over its inputs; `countTableProblems`
 * is the reader that feeds it.
 */
import path from 'node:path';
import {
  DOCS, DOC_FOLDERS, PLUGIN_SRC, RETIRED_KIT_IDS, ROOT, SRC, kitMembers, loadKits, makeCfg, ruleCanon, specLinks, upstreams,
} from '../build/source.mjs';
import { effectiveTheme, renderFile } from '../build/render.mjs';
import { themeFiles } from '../hosts/installs.mjs';
import { readText } from '../lib/fs.mjs';
import { formatRepr } from '../lib/json.mjs';
import { lawMetaProblems } from './checks-constitution.mjs';
import { LAW_CLASS, LAW_CLASSES, SKILL_CLASS } from './inventory.mjs';
import { globSorted, has, isDir, isFile, srcStems } from './scan.mjs';
import { existsSync, readdirSync } from 'node:fs';

/**
 * `_harness_build._prose_mirror_problems` — the human-readable count mirrors, the ones the
 * badge regex never sees.
 *
 * The README "What you get" table and the web onboarding copy each restate the law / agent /
 * skill counts in prose, and the README enumerates the skills by name. Nothing renders these,
 * so they drift silently — they already had. Pure over its inputs, so the corpus can feed it
 * crafted drift without touching the tree.
 */
export function proseMirrorProblems(readme, web, counts, skillStems, shipped = '', upstreamKeys = undefined) {
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

  // The README Credits section names EXACTLY the `src/upstreams.json` keys, both directions,
  // as the skills row does. A missing section is a problem, or deleting it would turn the gate
  // green. `upstreamKeys` is optional, like `plugins`, because the corpus predates it.
  if (upstreamKeys !== undefined) {
    const lines = readme.split('\n').map((ln) => ln.replace(/\r$/, ''));
    const at = lines.findIndex((ln) => ln.trim() === '## 🙏 Credits');
    if (at < 0) {
      problems.push("[authoring] README has no '## 🙏 Credits' section — src/upstreams.json has "
        + `${upstreamKeys.length} upstreams to credit`);
    } else {
      const end = lines.findIndex((ln, i) => i > at && ln.startsWith('## '));
      const listed = new Set();
      for (const ln of lines.slice(at + 1, end < 0 ? undefined : end).filter((l) => l.startsWith('- '))) {
        const k = /^- `([^`]+)`/.exec(ln);
        if (k) listed.add(k[1]);
        else problems.push(`[authoring] README Credits bullet names no upstream key in backticks: '${ln}'`);
      }
      for (const key of [...upstreamKeys].filter((k) => !listed.has(k)).sort()) {
        problems.push(`[authoring] README Credits omits upstream '${key}' (src/upstreams.json)`);
      }
      for (const key of [...listed].filter((k) => !upstreamKeys.includes(k)).sort()) {
        problems.push(`[authoring] README Credits names '${key}', which src/upstreams.json does not define`);
      }
    }
  }

  for (const m of web.matchAll(/(\d+) universal (?:laws|Rules)/g)) {
    if (Number(m[1]) !== laws) {
      problems.push(`[authoring] docs/ prose says '${m[1]} universal laws/Rules' but `
        + `src has ${laws}`);
    }
  }
  for (const m of web.matchAll(/(\d+) capability specialists/g)) {
    if (Number(m[1]) !== agents) {
      problems.push(`[authoring] docs/ prose says '${m[1]} capability specialists' but `
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
      problems.push(`[authoring] docs/ says '${m[1]} repeatable workflows' `
        + `but its wikilink list has ${listedN}`);
    }
  }

  // ⚠ THE ABSENCE OF THIS TRIPLE IS CHECKED BY THE CALLER, NOT HERE. This arm is satisfiable by
  // DELETING THE SENTENCE — no match, no problem, green — which is a gate failing open. The
  // presence check lives in `countTableProblems`, beside the read that already knows whether
  // the file could be opened at all; an empty `shipped` here means "nothing to compare".
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

/**
 * `_harness_build._count_table_problems` — the hand-authored AGENT.md tables and the README
 * badges, against `src/`.
 *
 * The tables must list EXACTLY the spec files (no dead row, no orphaned spec) and each
 * `agents`/`skills`/`laws`/`doctrines`/`themes` badge must equal the real count. This is the
 * authoring-time guarantee that lets tables, badges and prose stay hand-written without
 * silently drifting from the source tree.
 */
export function countTableProblems() {
  const problems = [];
  let ttext;
  try { ttext = readText(path.join(SRC, 'AGENT.md.tmpl')); } catch (e) {
    return [`[authoring] AGENT.md.tmpl unreadable: ${e.message}`];
  }

  // A kit member's row lives in its kit's manifest, not the template (spec A6). A manifest that
  // does not parse is `kitProblems`' to name; here it means no kit rows.
  let kits;
  try { kits = loadKits(); } catch { kits = new Map(); }
  const kitRows = [...kits.values()].flatMap((m) => [...(m.catalogue?.skills ?? []), ...(m.catalogue?.agents ?? [])]);
  const linked = { agents: new Set(), skills: new Set() };
  for (const m of [ttext, ...kitRows].join('\n').matchAll(TMPL_SPEC_RE)) {
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

  // The numerals the laws RENDER with — positional, off the canon — because LAW_CLASS and the
  // console's LAW_META are keyed the way the rendered catalogue numbers them.
  const canonRules = ruleCanon(SRC).rules;
  const lawRules = canonRules.filter((r) => r.kind === 'LAW');
  const lawNums = lawRules.map((r) => r.label);
  for (const num of lawNums) {
    if (!has(LAW_CLASS, num)) {
      problems.push(`[authoring] laws/universal.md rule ${num} has no class in LAW_CLASS`);
    }
  }
  // Sorted by the Roman numeral as a STRING; `doctorCollect` re-sorts every message anyway.
  for (const num of Object.keys(LAW_CLASS).sort()) {
    if (!LAW_CLASSES.includes(LAW_CLASS[num])) {
      problems.push(`[authoring] LAW_CLASS['${num}'] = '${LAW_CLASS[num]}' is not a known `
        + `class ${formatRepr(LAW_CLASSES)}`);
    }
  }
  problems.push(...lawMetaProblems(lawRules, LAW_CLASS, LAW_CLASSES));

  // WHAT SHIPS, NOT WHAT IS FLAT. A folder skill (`src/skills/<name>/SKILL.md`, vendored with
  // its scripts or references) ships exactly like a flat one, so the badge, the README list and
  // the SHIPPED.md triple count it. It is added HERE rather than in `srcStems`, whose other
  // readers above — the AGENT.md table links and SKILL_CLASS — are about flat specs only.
  const skillsDir = path.join(SRC, 'skills');
  // Core only: a kit is off by default, so its members are in no badge, README list or SHIPPED triple.
  const members = kitMembers(kits);
  const shippedSkills = new Set([...skillFiles, ...(isDir(skillsDir) ? readdirSync(skillsDir) : [])
    .filter((d) => !d.startsWith('_') && isFile(path.join(skillsDir, d, 'SKILL.md')))]
    .filter((s) => !members.skills.has(s)));

  const counts = {
    agents: [...srcStems('agents')].filter((a) => !members.agents.has(a)).length,
    skills: shippedSkills.size,
    laws: lawNums.length,
    // Every doctrine rule in every pack, opt-in ones included: the laws badge alone told a
    // reader the harness has 9 rules. It rides the laws badge (`laws-9 + 28 doctrines`).
    doctrines: canonRules.filter((r) => r.kind === 'DOCTRINE').length,
    themes: themeFiles().length,
    plugins: existsSync(PLUGIN_SRC)
      ? readdirSync(PLUGIN_SRC).filter((f) => f.startsWith('geneseed-') && f.endsWith('.js')).length
      : 0,
  };
  let readme;
  try { readme = readText(path.join(ROOT, 'README.md')); } catch { return problems; }
  // ⚠ PRESENCE FIRST, THEN THE VALUE — the same absence arm the SHIPPED triple needed, for the
  // same reason: `if (m && …)` is green when there is no badge, so deleting a badge silences its
  // own gate.
  for (const [key, n] of Object.entries(counts)) {
    const m = (key === 'doctrines' ? /badge\/laws-\d+%20%2B%20(\d+)%20doctrines/
      : new RegExp(`badge/${key}-(\\d+)`)).exec(readme);
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
  // `docs/<folder>/*.md`, and the counts in it render from `{N_LAWS}` / `{N_AGENTS}` / `{N_SKILLS}`
  // — so the read was still succeeding against a file the sentences had left, all three arms
  // below scored zero, and the check looked healthy while gating nothing. A templated count
  // cannot drift; what these arms still catch is a maintainer typing the NUMBER into a page
  // instead of the token, which is the drift that reaches a reader.
  //
  // `web` stays fail-soft — a missing docs tree is not an authoring fault.
  let web = '';
  try {
    web = DOC_FOLDERS
      .flatMap((f) => (isDir(path.join(DOCS, f))
        ? globSorted(path.join(DOCS, f), (n) => n.endsWith('.md')) : []))
      .map(readText).join('\n');
  } catch { web = ''; }
  // ⚠ NOT FAIL-SOFT, UNLIKE `web` ABOVE, AND THE ASYMMETRY IS THE POINT. A missing docs tree
  // is not an authoring fault — a checkout can legitimately lack it. SHIPPED.md is a tracked,
  // shipped file whose CONTENT this function asserts, so an unreadable one was
  // indistinguishable from a deleted claim: swallowing it into `''` handed the triple arm an
  // empty string and turned a hard read failure into a silent pass.
  //
  // AND THE PRESENCE OF THE TRIPLE IS CHECKED HERE rather than inside `proseMirrorProblems`:
  // this is the caller that already owns the question "could the file be read".
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
  // A bad upstreams.json is creditProblems' to name; here it means no keys to hold the README to.
  let upstreamKeys;
  try { upstreamKeys = Object.keys(upstreams()); } catch { upstreamKeys = []; }
  problems.push(...proseMirrorProblems(readme, web, counts, shippedSkills, shipped, upstreamKeys));
  return problems;
}

/**
 * The kit arm (spec A6, R3, R4, B7): each `src/kits/<kit>.json` against `src`. Refused: a
 * manifest that does not parse or lacks `description`/`rules`/`skills`/`agents`; a reserved kit
 * id (`RETIRED_KIT_IDS`); `rules` naming a missing file, or rendering (neutral theme) to more
 * words than its `rulesWordBudget` (default 300); a member in two kits, or a core one (a row in
 * AGENT.md.tmpl) — R3; a member with no spec or no `registry.json` row; and a core file linking a
 * kit member, which dangles with the kit off — R4. `registry.json` sits beside `src`, as at ROOT.
 */
export function kitProblems(src = SRC) {
  let kits;
  try { kits = loadKits(src); } catch (e) { return [`[authoring] ${e.message}`]; }
  if (!kits.size) return [];
  const problems = [];
  const core = { agents: new Set(), skills: new Set() };
  let tmpl = '';
  try { tmpl = readText(path.join(src, 'AGENT.md.tmpl')); } catch { /* countTableProblems names it */ }
  for (const m of tmpl.matchAll(TMPL_SPEC_RE)) core[m[1] === 'AGENTS' ? 'agents' : 'skills'].add(m[2]);
  let registry = {};
  try { registry = JSON.parse(readText(path.join(path.dirname(src), 'registry.json'))).entities ?? {}; } catch {
    // registryProblems names an unreadable registry
  }
  const owner = new Map();
  const cfg = { ...makeCfg(), src };
  let theme = null;
  for (const [kit, m] of kits) {
    const at = `src/kits/${kit}.json`;
    if (Object.hasOwn(RETIRED_KIT_IDS, kit)) {
      problems.push(`[authoring] ${at}: kit id '${kit}' is reserved (${RETIRED_KIT_IDS[kit]})`);
    }
    const lacking = ['description', 'rules', 'skills', 'agents'].filter((k) => (
      k === 'skills' || k === 'agents' ? !Array.isArray(m[k]) : typeof m[k] !== 'string'));
    for (const k of lacking) problems.push(`[authoring] ${at} has no '${k}'`);
    if (lacking.length) continue;
    for (const kind of ['skills', 'agents']) {
      for (const name of m[kind]) {
        const key = `${kind}/${name}`;
        if (owner.has(key)) problems.push(`[authoring] ${key} is in two kits: '${owner.get(key)}' and '${kit}'`);
        else owner.set(key, kit);
        if (core[kind].has(name)) problems.push(`[authoring] ${key} is core (AGENT.md.tmpl lists it), but kit '${kit}' claims it`);
        if (!isFile(path.join(src, kind, `${name}.md`))) {
          problems.push(`[authoring] kit '${kit}' lists ${key}, but src/${key}.md does not exist`);
        }
        if (!Object.hasOwn(registry, key)) problems.push(`[authoring] ${key} (kit '${kit}') has no row in registry.json`);
      }
    }
    // A6: a kit's catalogue rows are its own members' — a core row here would show twice with the
    // kit on, or vanish with it off.
    const rows = [...(m.catalogue?.skills ?? []), ...(m.catalogue?.agents ?? [])].join('\n');
    for (const r of rows.matchAll(TMPL_SPEC_RE)) {
      const kind = r[1] === 'AGENTS' ? 'agents' : 'skills';
      if (!m[kind].includes(r[2])) {
        problems.push(`[authoring] ${at} catalogue lists ${kind}/${r[2]}, which is not a member of kit '${kit}'`);
      }
    }
    const rules = path.join(src, m.rules);
    if (!isFile(rules)) {
      problems.push(`[authoring] ${at}: rules '${m.rules}' does not exist`);
      continue;
    }
    theme ??= effectiveTheme(cfg, 'neutral');
    const words = renderFile(cfg, rules, theme).split(/\s+/).filter(Boolean).length;
    const budget = m.rulesWordBudget ?? 300;
    if (words > budget) {
      problems.push(`[authoring] src/${m.rules} renders to ${words} words, over kit '${kit}' rulesWordBudget of ${budget}`);
    }
  }
  // R4. A core member (R3, named above) is left out: every core file linking it would repeat that.
  const r4 = new Set();
  for (const l of specLinks(src)) {
    // Links run kit -> core only: a core file, or ANOTHER kit's file, linking a member dangles
    // whenever that member's kit is off.
    if (!l.owner || l.kit === l.owner || core[l.kind].has(l.name)) continue;
    r4.add(l.kit
      ? `[authoring] src/${l.rel} (kit '${l.kit}') links ${l.kind}/${l.name}, a member of kit '${l.owner}' — links run kit → core only`
      : `[authoring] src/${l.rel} links ${l.kind}/${l.name}, a kit member — the link dangles when the kit is off`);
  }
  problems.push(...r4);
  return problems;
}
