/**
 * `geneseed export` — skills, agents and the constitution as catalogue entities, for a library
 * that is not a Geneseed install.
 *
 * An install is a harness: a carrier, hooks, settings, memory. A shared library wants none of
 * that. It wants one folder per entity, a description file a model reads and a governance file a
 * pipeline reads, in the layout many such libraries have converged on:
 *
 *   <skillsDir>/<name>/SKILL.md        frontmatter `name` + `description`, nothing else
 *   <skillsDir>/<name>/metadata.yaml   type, owner, maintainer, version, status, ...
 *   <skillsDir>/<name>/references/     the skill's side files
 *   <agentsDir>/<name>/AGENT.md        the same frontmatter rule
 *   <agentsDir>/<name>/metadata.yaml
 *   <lawsDir>/<name>/LAWS.md           the constitution's index, one entity
 *   <lawsDir>/<name>/<category>.md     ontology, laws, and one file per doctrine pack
 *
 * ONE WAY. The source stays `src/`; an export is a render of it, as an install is. Nothing reads
 * an exported folder back.
 *
 * THE PROFILE is where the receiving library's own rules go: the name prefix it demands, the
 * owner and maintainer its metadata requires, its folder names. It is a JSON file the user keeps
 * outside the package, because those values are theirs. This module names no library; without
 * a profile it exports under the source names. A git checkout may carry one of its own,
 * `export.profile.json` at the root (`DEFAULT_PROFILE`), which is the default there.
 *
 * WHAT CHANGES IN THE TEXT, and why each:
 *   - a reference to another exported entity is rewritten to the name it is exported under, and
 *     listed in `requires`, so the reader's installer can resolve it;
 *   - a skill's side files move under `references/`, and its pointers follow;
 *   - a skill loses its Self-improvement footer, which points at a notebook only an install has.
 *     An agent keeps the whole of its seven sections, step 0 and Self-improvement included: that
 *     shape is the contract a persona library reads;
 *   - host keys (`disable-model-invocation`, `disallowedTools`, ...) are not written at all.
 * A citation of a law or doctrine stays the principle's name, and the entity `requires` the
 * exported constitution, which is where that name is defined.
 *
 * NOT EXPORTED: an alias (a second name for one skill), the authoring templates, and a vendored
 * folder skill. The last is a third party's folder shipped verbatim under its own licence and
 * frontmatter; a library takes those from their upstream, not through this render.
 *
 * WRITES ARE CLAIM-ON-CREATE, as everywhere else: the export records what it wrote in
 * `geneseed-export.json` at `--out`, overwrites and prunes only what a previous export recorded,
 * and leaves a file it finds and did not write, named in the summary. So `--out` may be a
 * checkout of the library itself.
 */
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync, unlinkSync,
} from 'node:fs';
import path from 'node:path';

import {
  agentDescription, isVendoredPath, skillDescription, stripSkillBodyLinks, pointSideFiles,
} from '../hosts/native.mjs';
import { ownedWithin } from '../hosts/owned.mjs';
import { lstripNewlines } from '../hosts/settings.mjs';
import { printErr, printOut, readText, writeText } from '../lib/fs.mjs';
import { relPosix } from '../lib/text.mjs';
import { renderAll } from './render.mjs';
import {
  CREDIT_RE, ROOT, aliasesOf, loadKits, makeCfg, upstreamOf,
} from './source.mjs';
import { sourceFingerprint, sourceReleaseVersion } from './version.mjs';

export const EXPORT_MANIFEST = 'geneseed-export.json';
/**
 * The checkout's own profile, read when `--profile` is not given: the maintainer's defaults for
 * the library they publish to (the user asked for it to live in the repository, 2026-11). It is
 * a git checkout's file and is not in the npm package's `files`, so an npm install exports
 * under the source names unless a profile is passed. `--profile none` ignores it.
 */
export const DEFAULT_PROFILE = path.join(ROOT, 'export.profile.json');

/** What a profile may say, with what an export without one uses. */
const PROFILE_DEFAULTS = {
  prefix: '',
  owner: null,
  maintainer: null,
  status: 'experimental',
  compatibleTools: [],
  skillsDir: 'skills',
  agentsDir: 'agents/personas',
  lawsDir: 'laws',
  lawsName: 'laws',
  laws: true,
  only: null,
  exclude: [],
  keepSkillSelfImprovement: false,
};
const LIST_KEYS = ['compatibleTools', 'exclude'];
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const CITES_RE = /\{\{(?:LAW|DOCTRINE):[a-z0-9-]+\}\}/;

/** A refusal: the message is the whole of what the user needs, so no stack is printed. */
class ExportError extends Error {}

/**
 * Read and check a profile. Every key is optional; an unknown key is refused by name, because a
 * misspelt `prefx` would otherwise export every entity under the wrong name without a word.
 */
export function loadProfile(file) {
  if (!file) return { ...PROFILE_DEFAULTS };
  let data;
  try { data = JSON.parse(readFileSync(file, 'utf8')); } catch (e) {
    throw new ExportError(`--profile ${file}: ${e.code === 'ENOENT' ? 'no such file' : `not JSON (${e.message})`}`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ExportError(`--profile ${file}: must hold one JSON object`);
  }
  const unknown = Object.keys(data).filter((k) => !Object.hasOwn(PROFILE_DEFAULTS, k));
  if (unknown.length) {
    throw new ExportError(`--profile ${file}: unknown key(s) ${unknown.join(', ')} — it takes `
      + Object.keys(PROFILE_DEFAULTS).join(', '));
  }
  const p = { ...PROFILE_DEFAULTS, ...data };
  for (const k of LIST_KEYS) {
    if (!Array.isArray(p[k]) || p[k].some((v) => typeof v !== 'string')) {
      throw new ExportError(`--profile ${file}: ${k} must be a list of strings`);
    }
  }
  if (p.only !== null && (!Array.isArray(p.only) || p.only.some((v) => typeof v !== 'string'))) {
    throw new ExportError(`--profile ${file}: only must be a list of strings, or absent`);
  }
  for (const k of ['skillsDir', 'agentsDir', 'lawsDir']) {
    const v = p[k];
    if (typeof v !== 'string' || !v || path.isAbsolute(v) || v.split(/[\\/]/).includes('..')) {
      throw new ExportError(`--profile ${file}: ${k} must be a relative folder inside --out`);
    }
  }
  if (typeof p.prefix !== 'string') throw new ExportError(`--profile ${file}: prefix must be a string`);
  return p;
}

/** One YAML scalar. Double-quoted JSON is valid YAML, and the only safe spelling of `@handle`. */
const yamlStr = (s) => JSON.stringify(String(s));

/**
 * `metadata.yaml`: the governance half, which a pipeline reads and a model never does. Keys in
 * a fixed order, a key written only when it has a value, so two exports of one source are
 * byte-identical. `name` and `description` are passed only for the constitution: a skill's and
 * an agent's live in the frontmatter, and a library's schema may refuse them here.
 */
function metadataYaml(m) {
  const lines = [];
  if (m.name) lines.push(`name: ${m.name}`);
  lines.push(`type: ${m.type}`);
  if (m.owner) lines.push(`owner: ${yamlStr(m.owner)}`);
  if (m.maintainer) lines.push(`maintainer: ${yamlStr(m.maintainer)}`);
  lines.push(`version: ${m.version}`, `status: ${m.status}`);
  if (m.description) lines.push(`description: ${yamlStr(m.description)}`);
  const list = (key, items) => {
    if (!items.length) return;
    lines.push(`${key}:`);
    for (const it of items) lines.push(`  - ${/^[a-z0-9][a-z0-9-]*$/.test(it) ? it : yamlStr(it)}`);
  };
  list('compatible-tools', m.compatibleTools);
  if (m.origin) lines.push(`origin: ${yamlStr(m.origin)}`);
  if (m.license) lines.push(`license: ${m.license}`);
  list('requires', m.requires);
  return `${lines.join('\n')}\n`;
}

const frontmatter = (name, description) => `---\nname: ${name}\ndescription: ${yamlStr(description)}\n---\n\n`;

/** The registry's row for one entity: its version and nothing else is read. */
function registryVersions() {
  try {
    return JSON.parse(readText(path.join(ROOT, 'registry.json'))).entities ?? {};
  } catch { return {}; }
}

/**
 * Rewrite every reference to another exported entity to its exported name, and collect them.
 * Two spellings carry a reference in the sources: a Markdown link to the entity's spec
 * (`[architect](architect.md)`, `[plan](skills/plan.md)`), and its name in backticks before the
 * word skill or agent (the `explain-changes` skill). A name that is not exported is left as
 * written and reported, so the reader is not sent to an entity the export never wrote.
 */
function relink(text, self, names, requires, missing, known) {
  const hit = (stem, whole) => {
    if (stem === self.stem) return `\`${self.name}\``;
    if (names.has(stem)) { requires.add(names.get(stem)); return `\`${names.get(stem)}\``; }
    if (known.has(stem)) missing.add(stem);
    return whole;
  };
  return text
    .replace(/\[[^\]]+\]\((?:\.\.\/)?(?:(?:agents|skills)\/)?([a-z0-9][a-z0-9-]*)\.md(?:#[^)\s]*)?\)/g,
      (whole, stem) => (names.has(stem) || known.has(stem) ? hit(stem, whole) : whole))
    .replace(/`([a-z0-9][a-z0-9-]*)`(?=\s+(?:skill|agent)s?\b)/gi,
      (whole, stem) => (names.has(stem) || known.has(stem) ? hit(stem, whole) : whole));
}

/**
 * The body as a library reads it: the two authoring markers a host emit consumes are dropped
 * (`aliases:` names skills this export does not write, `invocation:` is a host frontmatter key),
 * and the title carries the exported name, which is the one the reader will look the entity up by.
 */
function forLibrary(body, s) {
  return body
    .replace(/^[ \t]*<!--[ \t]*(?:aliases|invocation):[^>]*-->[ \t]*\n/gm, '')
    .replace(new RegExp(`^(# [^\\n:]+: )${s.stem}[ \\t]*$`, 'm'), `$1${s.name}`);
}

/** A skill body without its Self-improvement footer, which is always the last section. */
function dropSelfImprovement(body) {
  const at = body.search(/^## Self-improvement[ \t]*$/m);
  return at < 0 ? body : `${body.slice(0, at).replace(/\s+$/, '')}\n`;
}

/** The upstreams a spec credits: `{ license, origin }`, the first key's licence winning. */
function creditsOf(sourceFile, src) {
  let raw;
  try { raw = readText(sourceFile); } catch { return {}; }
  const ups = [...raw.matchAll(CREDIT_RE)].map(([, key]) => upstreamOf(key, src)).filter(Boolean);
  if (!ups.length) return {};
  const repos = [...new Set(ups.map((u) => `https://github.com/${u.repo}`))];
  return { license: ups[0].license, origin: repos.join(', ') };
}

/**
 * Plan the export: every file as `{ rel, text | copy }`, plus what was left out and why. Pure
 * over the source tree; `writeExport` is the half that touches `out`.
 */
export function planExport({ profile = { ...PROFILE_DEFAULTS }, theme = 'neutral', kits = null } = {}) {
  const cfg = makeCfg({ kits: kits ?? [...loadKits().keys()] });
  // Full footprint: an exported entity is read on its own, with no carrier beside it to expand
  // a lean line.
  const { items } = renderAll(cfg, theme, { footprint: 'full' });
  const srcRel = (it) => relPosix(cfg.src, it.src);
  const versions = registryVersions();
  const release = sourceReleaseVersion(cfg);

  // The roster: flat specs under skills/ and agents/, minus templates and what the profile drops.
  const wanted = (stem) => !profile.exclude.includes(stem) && (profile.only === null || profile.only.includes(stem));
  const specs = [];
  const known = new Set();
  for (const it of items) {
    if (it.text === null || it.licenceOf) continue;
    const m = /^(skills|agents)\/([a-z0-9][a-z0-9-]*)\.md$/.exec(srcRel(it));
    if (!m) continue;
    known.add(m[2]);
    if (wanted(m[2])) {
      specs.push({ kind: m[1] === 'skills' ? 'skill' : 'persona', stem: m[2], it, name: `${profile.prefix}${m[2]}` });
    }
  }
  const skipped = [];
  const vendored = new Set(items.map(srcRel).filter(isVendoredPath).map((r) => r.split('/')[1]));
  for (const dir of [...vendored].sort()) {
    known.add(dir);
    if (wanted(dir)) skipped.push(`${dir}: a vendored folder skill, shipped under its upstream's own layout and licence`);
  }

  const names = new Map();
  const problems = [];
  for (const s of specs) {
    if (!NAME_RE.test(s.name) || s.name.length > 64) problems.push(`${s.name}: not a kebab-case name of at most 64 characters`);
    names.set(s.stem, s.name);
  }
  const lawsName = `${profile.prefix}${profile.lawsName}`;
  if (profile.laws && (!NAME_RE.test(lawsName) || lawsName.length > 64)) problems.push(`${lawsName}: not a kebab-case name of at most 64 characters`);
  if (problems.length) throw new ExportError(`these names cannot be exported:\n  ${problems.join('\n  ')}`);

  const files = [];
  const entities = [];
  const aliases = [];
  const missing = new Map();
  const base = { owner: profile.owner, maintainer: profile.maintainer, status: profile.status,
    compatibleTools: profile.compatibleTools };

  for (const s of specs.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const dir = `${s.kind === 'skill' ? profile.skillsDir : profile.agentsDir}/${s.name}`;
    const requires = new Set();
    const gone = new Set();
    const link = (text) => relink(text, s, names, requires, gone, known);
    let body = forLibrary(lstripNewlines(s.it.text), s);
    let description;
    if (s.kind === 'skill') {
      description = skillDescription(s.it.text);
      body = stripSkillBodyLinks(link(pointSideFiles(body, s.stem, 'references')));
      if (!profile.keepSkillSelfImprovement) body = dropSelfImprovement(body);
      for (const side of items) {
        const parts = srcRel(side).split('/');
        if (side.licenceOf === s.stem) {
          files.push({ rel: `${dir}/${path.posix.basename(side.rel)}`, copy: side.src });
        } else if (side.text !== null && parts.length === 3 && parts[0] === 'skills' && parts[1] === s.stem) {
          files.push({ rel: `${dir}/references/${parts[2]}`, text: stripSkillBodyLinks(link(side.text)) });
        }
      }
    } else {
      description = agentDescription(s.it.text);
      body = link(body);
    }
    if (profile.laws && CITES_RE.test(readText(s.it.src))) requires.add(lawsName);
    files.push({ rel: `${dir}/${s.kind === 'skill' ? 'SKILL.md' : 'AGENT.md'}`, text: frontmatter(s.name, description) + body });
    files.push({ rel: `${dir}/metadata.yaml`, text: metadataYaml({
      ...base, type: s.kind, requires: [...requires].sort(),
      version: versions[`${s.kind === 'skill' ? 'skills' : 'agents'}/${s.stem}`]?.version ?? release,
      ...creditsOf(s.it.src, cfg.src),
    }) });
    entities.push({ type: s.kind, name: s.name, source: srcRel(s.it), path: dir });
    if (gone.size) missing.set(s.name, [...gone].sort());
    aliases.push(...aliasesOf(s.it.text));
  }

  if (aliases.length) skipped.push(`${aliases.sort().join(', ')}: aliases, each a second name for a skill exported once`);

  if (profile.laws) {
    // The constitution, ONE FILE PER CATEGORY (the user asked, 2026-11: a reader looking for a
    // doctrine pack should not scroll through the laws to find it): the ontology, the laws, and
    // each doctrine pack, as the install ships them. `LAWS.md` is the index a reader opens
    // first, naming each file and what it holds.
    const dir = `${profile.lawsDir}/${lawsName}`;
    const parts = [];
    const packs = cfg.doctrines;   // the pack order the carrier lists them in
    for (const it of items) {
      const m = /^(ontology|laws|doctrines)\/([a-z0-9-]+)\.md$/.exec(srcRel(it));
      if (!m || it.text === null) continue;
      const [, tier, stem] = m;
      const body = stripSkillBodyLinks(lstripNewlines(it.text)).replace(/\s+$/, '');
      const rules = (body.match(/^### /gm) || []).length;
      // A rendered tier file opens on prose, with no title of its own: inside an install the
      // carrier's section heading is its title. Standing alone it needs one.
      const pack = /^\*\*(.+?)\*\* — (.+?)\.?$/m.exec(body);
      const [title, what] = tier === 'doctrines'
        ? [`Doctrines — ${pack?.[1] ?? stem}`, `${pack?.[2] ?? 'a doctrine pack'} (${rules} rules)`]
        : tier === 'laws'
          ? ['Laws', `the invariants, always in force (${rules} rules)`]
          : ['Ontology', 'how the agent thinks, decides and behaves'];
      const file = tier === 'doctrines' ? `doctrines-${stem}.md` : `${tier}.md`;
      parts.push({ rank: ['ontology', 'laws'].indexOf(tier) >= 0 ? ['ontology', 'laws'].indexOf(tier) : 2 + packs.indexOf(stem), file, title, what });
      files.push({ rel: `${dir}/${file}`, text: `# ${title}\n\n${body}\n` });
    }
    parts.sort((x, y) => x.rank - y.rank);
    files.push({ rel: `${dir}/LAWS.md`, text: [
      `# ${lawsName}`, '',
      'The constitution the skills and agents of this collection cite by principle name. One '
        + 'file per category:', '',
      ...parts.map((x) => `- \`${x.file}\` — ${x.title}: ${x.what}`), '',
    ].join('\n') });
    files.push({ rel: `${dir}/metadata.yaml`, text: metadataYaml({
      ...base, type: 'laws', name: lawsName, requires: [], version: release,
      description: 'The constitution the exported skills and agents cite by principle name: '
        + 'the ontology, the laws and every doctrine pack, in full.',
    }) });
    entities.push({ type: 'laws', name: lawsName, source: 'laws/, ontology/, doctrines/', path: dir });
  }

  return {
    files, entities, skipped, missing,
    meta: { geneseed: release, fingerprint: sourceFingerprint(cfg), theme },
  };
}

/** Remove now-empty directories from `dir` up to, never including, `out`. */
function pruneEmpty(dir, out) {
  for (let d = dir; d !== out && d.startsWith(out + path.sep); d = path.dirname(d)) {
    try { if (readdirSync(d).length) return; rmdirSync(d); } catch { return; }
  }
}

/**
 * Write a plan into `out`, claim-on-create. Returns `{ written, kept, pruned }`: `kept` is
 * every file found at a destination that no previous export recorded, and left alone.
 */
export function writeExport(plan, out) {
  mkdirSync(out, { recursive: true });
  let prior = [];
  try {
    const m = JSON.parse(readFileSync(path.join(out, EXPORT_MANIFEST), 'utf8'));
    if (Array.isArray(m.files)) prior = m.files.filter((f) => typeof f === 'string');
  } catch { /* a first export: nothing is recorded */ }
  const mine = new Set(prior);
  const now = new Set(plan.files.map((f) => f.rel));
  const pruned = [];
  for (const rel of ownedWithin(out, prior.filter((r) => !now.has(r)))) {
    const victim = path.join(out, rel);
    try { unlinkSync(victim); pruned.push(rel); pruneEmpty(path.dirname(victim), out); } catch { /* already gone */ }
  }
  const written = [];
  const kept = [];
  for (const f of plan.files) {
    const dest = path.join(out, f.rel);
    if (existsSync(dest) && !mine.has(f.rel)) { kept.push(f.rel); continue; }
    mkdirSync(path.dirname(dest), { recursive: true });
    if (f.copy) copyFileSync(f.copy, dest);
    else writeText(dest, f.text);
    written.push(f.rel);
  }
  writeText(path.join(out, EXPORT_MANIFEST), `${JSON.stringify({
    _comment: 'Written by `geneseed export`. Lists the files that export wrote here, so the next '
      + 'one replaces and prunes exactly those. A file not listed is yours and is never touched.',
    ...plan.meta, entities: plan.entities, files: written.sort(),
  }, null, 2)}\n`);
  return { written, kept, pruned };
}

/** The `export` verb. */
export function cmdExport(args) {
  if (!args.out) {
    printErr('[export] --out <folder> is required: where the entity folders are written.\n');
    return 2;
  }
  try {
    const given = args.profile == null && existsSync(DEFAULT_PROFILE) ? DEFAULT_PROFILE : args.profile;
    const profile = loadProfile(given === 'none' ? null : given);
    if (given === DEFAULT_PROFILE) printOut(`[export] profile: ${DEFAULT_PROFILE} (--profile none to export without one)\n`);
    const kits = args.kits == null ? null : String(args.kits).split(',').map((k) => k.trim()).filter((k) => k && k !== 'none');
    const plan = planExport({ profile, theme: args.theme || 'neutral', kits });
    const out = path.resolve(String(args.out));
    const { written, kept, pruned } = writeExport(plan, out);
    const count = (t) => plan.entities.filter((e) => e.type === t).length;
    printOut(`[export] ${count('skill')} skill(s), ${count('persona')} agent(s)`
      + `${count('laws') ? ', the constitution' : ''} -> ${out} (${written.length} file(s)`
      + `${pruned.length ? `, ${pruned.length} pruned` : ''})\n`);
    for (const line of plan.skipped) printOut(`[export] not exported — ${line}\n`);
    for (const [name, stems] of plan.missing) {
      printErr(`[export] WARN: ${name} refers to ${stems.join(', ')}, which this export leaves out\n`);
    }
    if (kept.length) {
      printErr(`[export] WARN: kept ${kept.length} existing file(s) no earlier export wrote, and skipped `
        + `the exported copy of each: ${kept.slice(0, 5).join(', ')}${kept.length > 5 ? `, and ${kept.length - 5} more` : ''}\n`);
    }
    if (!profile.owner || !profile.maintainer) {
      printErr('[export] WARN: no owner or maintainer in the profile; metadata.yaml was written without one\n');
    }
    return 0;
  } catch (e) {
    if (!(e instanceof ExportError)) throw e;
    printErr(`[export] ${e.message}\n`);
    return 2;
  }
}
