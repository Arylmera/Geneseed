/**
 * The Library's READ MODEL — what the console lists and opens: the agent/skill inventory (read
 * off the deployed install, else rendered from source), the constitution's three tiers, and the
 * hand-written stores beside the install (memory, notebook, wiki, the two setup manifests).
 * `apiCatalog` and `apiItem` are its two endpoints; `routes.mjs` binds them to paths.
 *
 * `NotFound` lives here because this is where it is raised most, and because `state.mjs` imports
 * this file (for the inventory it caches) and nothing here imports `state.mjs` back.
 *
 * `flatName`'s traversal refusal and `CONFIG_META`'s allowlist are the two reasons a GET — which
 * carries no token — cannot read an arbitrary file through `/api/item/`.
 */
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { GLOBAL_MANIFEST, resolvePath } from '../hosts/hosts.mjs';
import { doctrinesForBuild, excludedRulesOfDir, readMaybe } from '../hosts/installs.mjs';
import { frontmatter } from '../hosts/memory-files.mjs';
import {
  SKILL_CLASS, entityStatus, loadRegistry, tuiInventory,
} from '../inspect/inventory.mjs';
import { firstBlockquote } from '../hosts/native.mjs';
import { readText, withDiscardableStderr, isDir, isFile } from '../lib/fs.mjs';
import { comparePaths, normcase, within } from '../lib/paths.mjs';
import { stripWhitespace } from '../lib/text.mjs';
import { readJsonc } from '../hosts/settings.mjs';

/** A requested catalog section or item that does not exist. */
export class NotFound extends Error {}

/** `??` would also swallow an explicit `null` the file declared; this does not. */
export const dget = (obj, key, dflt) => (Object.hasOwn(obj, key) ? obj[key] : dflt);

export function deployed(state) {
  return existsSync(path.join(state.target, GLOBAL_MANIFEST));
}

/**
 * A deployed spec's one-line purpose.
 *
 * The `> blockquote` convention every rendered skill and agent carries, then the
 * frontmatter `description`, then the first prose paragraph. The fallbacks are for the
 * VENDORED skill folders, which ride in verbatim with no blockquote and would otherwise
 * show a blank Purpose cell.
 */
export function specDesc(fm, body) {
  const bq = firstBlockquote(body);
  if (bq) return bq;
  const desc = String(fm.has('description') ? fm.get('description') : '').trim();
  if (desc) return desc.split(/\s+/).filter(Boolean).join(' ');
  for (const para of body.split('\n\n')) {
    const s = para.split(/\s+/).filter(Boolean).join(' ');
    if (s && !(s.startsWith('#') || s.startsWith('---') || s.startsWith('<!--'))) return s;
  }
  return '';
}

/**
 * Agent/skill specs read straight off a DEPLOYED harness dir.
 *
 * Agents are flat `<root>/<name>.md` (skipping `_*` templates); skills use OpenCode's
 * folder layout `<root>/<name>/SKILL.md`. Matched case-INSENSITIVE on Windows via
 * `normcase`, not a bare `endsWith`. The frontmatter is stripped because it is host
 * plumbing rather than prose, which is what makes a deployed entry the same shape as a
 * source-rendered one and every consumer indifferent to the origin.
 */
function specEntries(root, nested) {
  const out = [];
  if (!isDir(root)) return out;
  let names;
  try { names = readdirSync(root); } catch { return out; }
  const files = nested
    ? names.sort(comparePaths).filter((n) => isDir(path.join(root, n)))
      .map((n) => path.join(root, n, 'SKILL.md'))
    : names.filter((n) => normcase(n).endsWith('.md') && !n.startsWith('_'))
      .sort(comparePaths).map((n) => path.join(root, n));
  for (const p of files) {
    if (!isFile(p)) continue;
    const [fm, body] = frontmatter(readMaybe(p) ?? '');
    const name = nested ? path.basename(path.dirname(p)) : path.basename(p, '.md');
    out.push({ name, desc: specDesc(fm, body), body, source: resolvePath(p) });
  }
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}

/**
 * The agents and skills actually installed at `state.target`, not a fresh render of `src/`.
 *
 * All three constitutional tiers still come from the render: once deployed they live inside
 * AGENT.md rather than as separate files, so the deployed arm replaces the two ENTITY rosters
 * and none of the constitution. A deployed spec file carries neither a category nor a
 * lifecycle status, so each is tagged BY NAME from the same two sources the source render
 * uses — and an entity the registry does not know reads "personal" for both, which is the
 * honest answer rather than a borrowed one: filing it under the `build` fallback would claim
 * a Geneseed taxonomy slot it was never given.
 *
 * ⚠ THE PACK SELECTION IS THE ONE THING THE RENDER CANNOT KNOW. `renderAll` emits all four
 * pack files whatever `cfg.doctrines` says — measured: `makeCfg({doctrines:['craft']})` yields
 * the same 105 items — because the filtering happens when AGENT.md's §2 is assembled, not in
 * the walk. So the catalogue is always whole, and which packs this INSTALL built in comes from
 * its own carrier via `doctrinesForBuild`, which resolves "no marker" to every pack.
 */
function deployedInventory(state) {
  const render = tuiInventory(state.theme, doctrinesForBuild(state.target),
    excludedRulesOfDir(state.target));
  const registry = loadRegistry();
  const skills = specEntries(path.join(state.target, 'skills'), true);
  for (const e of skills) {
    e.status = entityStatus(registry, `skills/${e.name}`);
    e.klass = e.status === 'personal' ? 'personal'
      : (Object.hasOwn(SKILL_CLASS, e.name) ? SKILL_CLASS[e.name] : 'build');
  }
  const agents = specEntries(path.join(state.target, 'agents'), false);
  for (const e of agents) e.status = entityStatus(registry, `agents/${e.name}`);
  return { agents,
    skills,
    laws: render.laws,
    ontology: render.ontology,
    doctrines: render.doctrines,
    theme: state.theme };
}

/** The deployed record when there is one, else the source render. */
export function inventoryFor(state) {
  return deployed(state) ? deployedInventory(state) : tuiInventory(state.theme);
}

// ---- the catalog stores overview counts ---------------------------------------------------

/**
 * Always `<target>/memory` — never the CWD-scanning resolver. The ONE copy: `actions.mjs` and
 * `user-files.mjs` delete and promote facts in the same directory this lists.
 */
export const memoryDir = (state) => path.join(state.target, 'memory');
const notebookDir = (state) => path.join(state.target, 'notebook');

/**
 * Matched case-insensitively on Windows.
 *
 * `comparePaths` and NOT a bare `.sort()`: on Windows, filenames sort case-insensitively, so
 * `MEMORY.md` sorts under `m` and lands after `a-fact.md`; JS's default comparator is UTF-16
 * code units, so `M` (0x4D) sorts before `a` (0x61) and the whole catalog comes back in a
 * different order. The `normcase` in the filter beside it only fixes matching, not
 * ordering — this is the other half.
 */
function globMd(dir) {
  if (!isDir(dir)) return [];
  let names;
  try { names = readdirSync(dir); } catch { return []; }
  return names.filter((n) => normcase(n).endsWith('.md') && isFile(path.join(dir, n)))
    .sort(comparePaths);
}

/** Filename without its extension — single owner, imported by `js/web/activity.mjs` too. */
export const stemOf = (name) => name.slice(0, name.length - path.extname(name).length);

export function memoryItems(state) {
  const d = memoryDir(state);
  if (!isDir(d)) return [];
  return globMd(d).map((n) => {
    const p = path.join(d, n);
    const [fm] = frontmatter(readMaybe(p) ?? '');
    const stem = stemOf(n);
    return {
      name: stem,
      title: fm.has('name') ? fm.get('name') : stem,
      desc: fm.has('description') ? fm.get('description') : '',
      source: resolvePath(p),
    };
  });
}

export function notebookItems(state) {
  const d = notebookDir(state);
  if (!isDir(d)) return [];
  return globMd(d).map((n) => ({
    name: stemOf(n), title: stemOf(n), desc: '', source: resolvePath(path.join(d, n)),
  }));
}

/** The two setup manifests, in listing order. */
const CONFIG_META = {
  'context.json': ['Project context', 'what the agent loads for this project'],
  'wiki.jsonc': ['Wiki manifest', 'your machine-wide knowledge base(s)'],
};

export function configItems(state) {
  const out = [];
  for (const fname of ['context.json', 'wiki.jsonc']) {
    const p = path.join(state.target, fname);
    if (!isFile(p)) continue;
    const [title, desc] = CONFIG_META[fname] ?? [fname, ''];
    out.push({ name: fname, title, desc, type: 'config', kind: 'manifest',
      source: resolvePath(p) });
  }
  return out;
}

const WIKI_FILE_CAP = 5000;

/**
 * `resolvePath` for a path that came out of a HAND-MAINTAINED manifest — `null`, never a throw.
 *
 * The three wiki sites below, and `apiDeployCmd` in `js/web/actions.mjs`, are the
 * request-path callers of `expanduser`, and it REFUSES a `~user` form by printing and throwing
 * (`js/hosts/hosts.mjs`'s docblock). None of them may let that escape: `js/web/handler.mjs`
 * wraps the whole GET in a blanket `catch` → a JSON 500, so an unguarded refusal would turn
 * ONE bad line in a file the user hand-edits into a dead Knowledge section. That is the same
 * argument `sovereignBypass` makes in `js/hosts/hosts.mjs` — contain the refusal per entry
 * and take the site's OWN degrade — and each of the three already has one: `[]`, `continue`,
 * `continue`-into-404.
 *
 * `withDiscardableStderr` because `expanduser` prints its refusal at the RAISE SITE, and
 * this caller wants that swallowed along with the exception rather than logged.
 *
 * DELIBERATE PRODUCT DECISION: a `~otherUser` path is refused rather than resolved, even
 * where the account happens to exist — reading another account's files through a
 * hand-edited wiki manifest is not a feature.
 */
function wikiPath(p) {
  try {
    return withDiscardableStderr(() => resolvePath(p));
  } catch {
    return null;
  }
}

/**
 * `$GENESEED_WIKI` first, else `wiki.jsonc` beside the deployed bundle, read with the
 * harness's generic JSONC loader.
 *
 * `resolvePath`, not merely `expanduser`: harmless here because `p` is consumed by `isFile`
 * and `mcpLoad` and never reaches a response body, and both of those follow symlinks and
 * resolve a relative path against the same cwd anyway.
 */
function wikiManifest(state) {
  const cand = process.env.GENESEED_WIKI;
  const p = cand ? wikiPath(cand) : path.join(state.target, 'wiki.jsonc');
  if (!p || !isFile(p)) return [];
  const cfg = mcpLoad(p);
  const wikis = cfg.wikis;
  return Array.isArray(wikis) ? wikis : [];
}

/**
 * The COMMENT-TOLERANT dict loader, `{}` for a file that is missing, unreadable,
 * unparseable, or not an object.
 *
 * Comment-tolerant is the whole point, and getting this wrong is silent: the two files it
 * reads are `wiki.jsonc` and `context.json`, hand-maintained, so a `//` line is expected.
 * Plain `JSON.parse` would throw on it and this loader would then answer `{}` — the wiki
 * section listing nothing and the config item's `manifest` coming back empty, with no
 * error surfaced anywhere.
 */
function mcpLoad(p) {
  if (!isFile(p)) return {};
  let text;
  try { text = readText(p); } catch { return {}; }
  const [data] = readJsonc(text);
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

/**
 * Every `.md` under `dir`, recursively.
 *
 * `recursive: true` replaces a hand-rolled walk; its one caller re-sorts the result with
 * `comparePaths` before using it, so the order this returns is never observed.
 */
function rglobMd(dir) {
  let entries;
  try { entries = readdirSync(dir, { recursive: true, withFileTypes: true }); } catch { return []; }
  return entries
    .filter((e) => e.isFile() && normcase(e.name).endsWith('.md'))
    .map((e) => path.join(e.parentPath, e.name));
}

export function wikiItems(state) {
  const items = [];
  const seen = new Set();
  for (const w of wikiManifest(state)) {
    if (!w || typeof w !== 'object' || Array.isArray(w)) continue;
    const wname = String(dget(w, 'name', null) || 'wiki');
    // PER ENTRY, and the loop continues — one unusable `path` in the manifest must not
    // blank every OTHER vault in it.
    const root = wikiPath(String(dget(w, 'path', null) || ''));
    if (!root || !isDir(root)) continue;
    // A hand-edited `entries` that is not a list (`{}`, a string) is a malformed vault, not a
    // crash: `/api/status` counts these, and one bad manifest must not fail the dashboard.
    const rawEntries = dget(w, 'entries', null);
    const entries = (Array.isArray(rawEntries) ? rawEntries : [])
      .filter((e) => e && typeof e === 'object' && !Array.isArray(e));
    const excludes = entries.filter((e) => dget(e, 'load', null) === 'exclude')
      .map((e) => String(dget(e, 'path', null) || '').replace(/^\/+|\/+$/g, '').replace(/\\/g, '/'));
    const excluded = (rel) => excludes.some((x) => x && (rel === x || rel.startsWith(`${x}/`)));

    for (const e of entries) {
      if (dget(e, 'load', null) === 'exclude') continue;
      const rel = String(dget(e, 'path', null) || '').replace(/^\/+|\/+$/g, '').replace(/\\/g, '/');
      const desc = String(dget(e, 'description', null) || '');
      const fp = path.join(root, rel);
      let mds;
      if (isFile(fp) && path.extname(fp) === '.md') mds = [fp];
      // Capped and sorted via `comparePaths`, for the reason `globMd` carries.
      else if (isDir(fp)) mds = rglobMd(fp).sort(comparePaths).slice(0, WIKI_FILE_CAP);
      else continue;
      for (const md of mds) {
        const r = path.relative(root, md).split(path.sep).join('/');
        const key = `${wname}:${r}`;
        if (seen.has(key) || excluded(r)) continue;
        seen.add(key);
        items.push({ name: key, title: path.basename(md, '.md'),
          desc: mds.length === 1 ? desc : r, type: 'wiki', kind: 'page', group: wname,
          source: resolvePath(md) });
      }
    }
  }
  return items;
}

/** One page by `<wiki>:<relpath>`, never outside the vault. */
function apiWikiItem(state, name) {
  const at = name.indexOf(':');
  const wname = at < 0 ? name : name.slice(0, at);
  const rel = (at < 0 ? '' : name.slice(at + 1))
    .replace(/^\/+|\/+$/g, '').replace(/\\/g, '/');
  for (const w of wikiManifest(state)) {
    if (!w || typeof w !== 'object' || Array.isArray(w)) continue;
    if (String(dget(w, 'name', null) || 'wiki') !== wname) continue;
    // An unresolvable or refused root falls through to the `NotFound` below, the same as
    // one that simply does not exist.
    const root = wikiPath(String(dget(w, 'path', null) || ''));
    if (!root) continue;
    const p = resolvePath(path.join(root, rel));
    if (rel && path.extname(p) === '.md' && within(p, root) && isFile(p)) {
      const body = readMaybe(p) ?? '';
      return { type: 'wiki', name, title: path.basename(p, '.md'), desc: '',
        body, links: resolveLinks(state, body), source: p };
    }
  }
  throw new NotFound(name);
}


/**
 * Catalog names are flat basenames.
 *
 * A separator, a `..` or a drive colon in the URL segment is someone steering the join
 * outside the catalog dir. A GET carries no token, so before this check the endpoint was
 * an arbitrary-file read; it raises rather than resolving.
 */
function flatName(name) {
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..')
      || name.includes(':')) {
    throw new NotFound(name);
  }
}

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

/**
 * `[[name]]` matched against known agent and skill names.
 *
 * AGENTS FIRST, SKILLS SECOND, into ONE map — so a name that is both resolves as a SKILL.
 * This ordering is deliberate and must not be swapped.
 */
export function resolveLinks(state, body) {
  const inv = state.inventory;
  const known = new Map();
  for (const e of inv.agents) known.set(e.name, 'agent');
  for (const e of inv.skills) known.set(e.name, 'skill');
  const links = [];
  const seen = new Set();
  for (const m of body.matchAll(WIKILINK_RE)) {
    // `stripWhitespace`, not `trim()` — the two whitespace classes differ, and both call
    // sites on this regex must answer with the same rule.
    const label = stripWhitespace(m[1]);
    if (known.has(label) && !seen.has(label)) {
      seen.add(label);
      links.push({ label, type: known.get(label), name: label });
    }
  }
  return links;
}

/**
 * A setup file parsed into the shape the detail pane renders as cards, or `null` so the
 * caller falls back to the raw body.
 */
function configManifest(name, p) {
  const cfg = mcpLoad(p);
  if (name === 'wiki.jsonc') {
    const wikis = cfg.wikis;
    return { kind: 'wiki', wikis: Array.isArray(wikis) ? wikis : [] };
  }
  if (name === 'context.json') {
    const ctx = cfg.context;
    return { kind: 'context', context: Array.isArray(ctx) ? ctx : [] };
  }
  return null;
}

/**
 * A closed list; anything else is a 404.
 *
 * ⚠ `laws` STAYS ONE SECTION FOR ALL THREE TIERS, and that is a decision rather than an
 * oversight. The console has ONE Constitution entry, not three, so a reader keeps the "read it
 * top to bottom" property; the id stays `laws` because `tests/helpers/cli_golden.mjs`
 * hard-requires `web/src/pages/Laws.jsx` and because a route rename buys nothing and costs a
 * redirect. The tier lives on the ITEM (`tier: 'ontology' | 'invariant' | 'doctrine'`), which
 * is where a consumer can act on it.
 */
export const SECTIONS = ['agents', 'skills', 'laws', 'memory', 'notebook', 'wiki', 'config'];

/**
 * The `laws` section's items — the whole constitution, in constitutional order, one flat list.
 *
 * FLAT AND NOT NESTED, because every other section is `{section, items}` and a second shape
 * for one section is a second client path for one roster. The pack's grouping metadata rides
 * on each doctrine row (`pack`, `packTitle`, `packDesc`, `active`), so a consumer groups by
 * `pack` and has everything a header needs without a second fetch.
 *
 * Names are ADDRESSES and the three shapes cannot collide: `ont:<slug>` carries a colon no
 * numeral has, an invariant is `[IVXLCDM]+`, a doctrine rule is `<pack>.<n>`. `apiItem`
 * resolves all three off the same list.
 */
function constitutionItems(inv) {
  return [
    ...(inv.ontology ?? []).map((e) => ({ name: `ont:${e.id}`, title: e.title, desc: '',
      tier: 'ontology' })),
    ...inv.laws.map((e) => ({ name: e.num, title: `Rule ${e.num} — ${e.title}`, desc: '',
      klass: e.klass ?? 'craft', tier: 'invariant' })),
    ...(inv.doctrines ?? []).flatMap((p) => p.rules.map((r) => ({
      name: `${r.pack}.${r.n}`,
      title: `Doctrine ${r.pack} ${r.n} — ${r.title}`,
      desc: '',
      klass: r.klass ?? p.pack,
      tier: 'doctrine',
      pack: p.pack,
      packTitle: p.title,
      packDesc: p.desc,
      // ⚠ EVERY RULE IS LISTED WHETHER OR NOT IT IS BUILT IN, and `active` is the RULE's own
      // — a pack can be on with one rule excluded. A row that vanished from the payload would
      // be indistinguishable from one that never shipped, and the console could not then
      // offer the switch that turns it back on.
      active: r.active !== false,
      packActive: p.active,
    }))),
  ];
}

export function apiCatalog(state, section) {
  if (!SECTIONS.includes(section)) throw new NotFound(section);
  const inv = state.inventory;
  let items;
  if (section === 'agents') {
    items = inv.agents.map((e) => ({ name: e.name, title: e.name, desc: e.desc,
      source: e.source ?? null, status: e.status ?? 'unknown' }));
  } else if (section === 'skills') {
    items = inv.skills.map((e) => ({ name: e.name, title: e.name, desc: e.desc,
      source: e.source ?? null, klass: e.klass ?? 'build', status: e.status ?? 'unknown' }));
  } else if (section === 'laws') {
    items = constitutionItems(inv);
  } else if (section === 'memory') {
    items = memoryItems(state);
  } else if (section === 'notebook') {
    items = notebookItems(state);
  } else if (section === 'wiki') {
    items = wikiItems(state);
  } else {
    items = configItems(state);
  }
  return { section, items };
}

export function apiItem(state, type, name) {
  const inv = state.inventory;
  if (type === 'agent' || type === 'skill') {
    const e = (type === 'agent' ? inv.agents : inv.skills).find((x) => x.name === name);
    if (!e) throw new NotFound(name);
    const out = { type, name, title: name, desc: e.desc, body: e.body,
      links: resolveLinks(state, e.body), source: e.source ?? null };
    if (type === 'skill') out.klass = e.klass ?? 'build';
    out.status = e.status ?? 'unknown';
    return out;
  }
  if (type === 'law') {
    // ONE ARM FOR THREE TIERS, resolved off the same list the catalogue publishes — so a name
    // that appears in `/api/catalog/laws` always opens, and one that does not always 404s.
    // Building the list twice is what would let the two drift.
    const e = constitutionItems(inv).find((x) => x.name === name);
    if (!e) throw new NotFound(name);
    const body = e.tier === 'ontology'
      ? (inv.ontology.find((s) => `ont:${s.id}` === name)?.body ?? '')
      : (e.tier === 'invariant'
        ? (inv.laws.find((x) => x.num === name)?.body ?? '')
        : (inv.doctrines.flatMap((p) => p.rules)
          .find((r) => `${r.pack}.${r.n}` === name)?.body ?? ''));
    // `links: []` — a constitution body is not link-resolved. It cites its siblings by
    // ADDRESS (`Rule IV`, `Doctrine ops 1`, `Ontology: Telos`), not by path, and there is no
    // file behind those to resolve to.
    return { ...e, type, name, body, links: [] };
  }
  if (type === 'memory' || type === 'notebook') {
    flatName(name);
    const d = type === 'notebook' ? notebookDir(state) : memoryDir(state);
    const p = path.join(d, `${name}.md`);
    if (!isFile(p)) throw new NotFound(name);
    const body = readMaybe(p) ?? '';
    return { type, name, title: name, desc: '', body,
      links: resolveLinks(state, body), source: resolvePath(p) };
  }
  if (type === 'wiki') return apiWikiItem(state, name);
  if (type === 'config') {
    // THE ALLOWLIST, NOT `flatName`: a flat name still reached every top-level file of the
    // install — `.geneseed-web.json` (this daemon's own CSRF token) and `settings.json` among
    // them — over a GET that carries no token. Only the manifests the catalogue lists can open.
    if (!Object.hasOwn(CONFIG_META, name)) throw new NotFound(name);
    const p = path.join(state.target, name);
    if (!isFile(p)) throw new NotFound(name);
    const raw = readMaybe(p) ?? '';
    const [title, desc] = CONFIG_META[name];
    return { type, name, title, desc, manifest: configManifest(name, p),
      body: `\`\`\`json\n${raw}\n\`\`\``, links: [], source: resolvePath(p) };
  }
  throw new NotFound(type);
}
