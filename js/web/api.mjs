/**
 * The web console's read endpoints — `overview`, `themes`, `doctor`, `diff`, `installs`,
 * `excludes`, `setup`, `profile`, `catalog`, `item` and `wiki_item` — and the `WebState`
 * all eleven read from.
 *
 * `PREFIX_ROUTES` below are the first routes that parse a path, which brings three things
 * no state-keyed route needs: `percentDecode` (NOT `decodeURIComponent`, which throws on a
 * `%` that is not an escape, where this shell instead answers a 404 naming the literal
 * text), the `NotFound` → 404 convention, and `flatName`'s traversal refusal — a GET
 * carries no token, so before that check the item route was an arbitrary-file read.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { CONFIG, ROOT, THEMES, discoverNames } from '../build/source.mjs';
import { sourceReleaseVersion } from '../hosts/opencode.mjs';
import { diffCollect } from '../inspect/diff.mjs';
import { doctorCollect } from '../inspect/doctor.mjs';
import { excludesSnapshot } from '../inspect/excludes.mjs';
import { GLOBAL_MANIFEST, HOSTS, opencodeConfigDir, resolvePath } from '../hosts/hosts.mjs';
import {
  doctrinesForBuild, excludedRulesOfDir, footprintOfDir, installState, installTargets,
  installedDefaults, modeOfDir,
  postureOfDir, readJsonMaybe, readMaybe, themeOfDir,
} from '../hosts/installs.mjs';
import { frontmatter } from '../hosts/hooks.mjs';
import {
  SKILL_CLASS, entityStatus, loadRegistry, tuiInventory,
} from '../inspect/inventory.mjs';
import { firstBlockquote } from '../hosts/native.mjs';
import { EMIT_OPTIONS, themeOptions } from '../maintain/setup.mjs';
import { accentFor, statusData } from '../inspect/status.mjs';
import { readText, withDiscardableStderr, isDir, isFile } from '../lib/fs.mjs';
import { comparePaths, normcase, within } from '../lib/paths.mjs';
import { stripWhitespace, percentDecode } from '../lib/text.mjs';
import { readJsonc } from '../hosts/settings.mjs';
import { apiActivity, apiActivityDetail } from './activity.mjs';
import { apiMcp, apiRules } from './actions.mjs';

/** A requested catalog section or item that does not exist. */
export class NotFound extends Error {}

/** Two resolved paths, compared case-folded on Windows. */
const samePath = (a, b) => normcase(resolvePath(a)) === normcase(resolvePath(b));

/** `??` would also swallow an explicit `null` the file declared; this does not. */
const dget = (obj, key, dflt) => (Object.hasOwn(obj, key) ? obj[key] : dflt);

/** SHA-256 hex, first 16 chars — `""` for an empty file. */
export function fingerprint(text) {
  return text ? createHash('sha256').update(text, 'utf-8').digest('hex').slice(0, 16) : '';
}

/**
 * `YYYY-MM-DD HH:MM`, LOCAL time — `toISOString` would be UTC, which reads wrong in every
 * timezone but one for a user-facing timestamp.
 */
export function stampMinute(ms) {
  const d = new Date(ms);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} `
    + `${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

// ---- WebState ---------------------------------------------------------------------------

/**
 * The resolved view of the deployed harness a request reads from.
 *
 * A factory returning a plain object rather than a class, because the two cached
 * properties are the only behaviour and a getter pair expresses them without ceremony.
 * THE CACHING IS BEHAVIOUR, NOT AN OPTIMISATION: `doctorCollect` renders a theme per call
 * and the dashboard GETs `/api/overview` on every navigation, so an uncached `doctor`
 * would put a full build on the request path. `refresh()` is what a mutation calls to
 * drop both.
 */
export function webState(theme = null, target = null) {
  const st = {
    // NOT resolved: `target` is printed by three endpoints, so resolving it here would
    // change what they answer.
    target: target || opencodeConfigDir(),
    root: null,
    theme: null,
    emit: null,
    footprint: null,
    posture: null,
    mode: null,
    _inv: null,
    _doctor: null,
  };
  // The INSTALL ROOT (== build --out). For globals it IS the data dir; a claude/bob
  // PROJECT install keeps its data under <repo>/.claude while the markers land at <repo>/.
  st.root = st.target;
  st.theme = theme || themeOfDir(st.target) || 'neutral';
  st.emit = installedDefaults().emit || 'opencode-global';
  st.footprint = footprintOfDir(st.target);      // 'full' when no marker
  st.posture = postureOfDir(st.target) || 'peer';
  st.mode = modeOfDir(st.target) || 'direct';

  Object.defineProperty(st, 'inventory', {
    get() {
      if (st._inv === null) st._inv = inventoryFor(st);
      return st._inv;
    },
  });
  Object.defineProperty(st, 'doctor', {
    get() {
      if (st._doctor === null) {
        const [, problems] = doctorCollect({ theme: st.theme });
        st.stampDoctor(problems);
      }
      return st._doctor;
    },
  });
  st.stampDoctor = (problems) => {
    st._doctor = { ok: !problems.length, problems, checked_at: stampMinute(Date.now()) };
  };
  /**
   * The CURRENT install's mode, from its `.geneseed-emit` marker: the ROOT first (where
   * every emit writes it), then the data dir.
   *
   * `refresh()` below MUST call this: without it, `emit` goes stale after any write that
   * re-themes or re-points the install, since the constructor only reads it once via
   * `installedDefaults()`.
   */
  st.detectEmit = () => {
    for (const d of [st.root, st.target]) {
      try {
        const em = path.join(d, '.geneseed-emit');
        if (isFile(em)) {
          const v = stripWhitespace(readText(em));
          if (v) return v;
        }
      } catch { /* unreadable marker: try the next candidate */ }
    }
    return existsSync(path.join(st.root, 'CLAUDE.md')) ? 'claude-global' : 'opencode-global';
  };
  /**
   * Re-point the console at another detected install's data dir.
   *
   * `root` is the install ROOT the markers and sigils live at. It defaults to `target` and
   * differs only for claude/bob/copilot PROJECT installs, where the data sits under
   * `<repo>/.claude|.bob|.github` while `.geneseed-emit`/`-theme`/`-footprint` land at
   * `<repo>/` — reading them from the data dir mis-detects the install as opencode/neutral,
   * and a Diff or a Restore would then overwrite it in the wrong dialect.
   */
  st.selectView = (target, root = null) => {
    st.target = target;
    st.root = root || target;
    st.theme = themeOfDir(st.root) || themeOfDir(st.target) || 'neutral';
    st.emit = st.detectEmit();
    st.footprint = footprintOfDir(st.root);
    st.posture = postureOfDir(st.root) || 'peer';
    st.mode = modeOfDir(st.root) || 'direct';
    st._inv = null;
    st._doctor = null;
  };
  st.refresh = () => {
    st._inv = null;
    st._doctor = null;
    st.theme = themeOfDir(st.root) || themeOfDir(st.target) || st.theme;
    st.emit = st.detectEmit() || st.emit;
    st.footprint = footprintOfDir(st.root);
    st.posture = postureOfDir(st.root) || 'peer';
    st.mode = modeOfDir(st.root) || 'direct';
  };
  return st;
}

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
export function specEntries(root, nested) {
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
export function deployedInventory(state) {
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

/** Always `<target>/memory` — never the CWD-scanning resolver. */
const memoryDir = (state) => path.join(state.target, 'memory');
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

export const WIKI_FILE_CAP = 5000;

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
    const entries = (dget(w, 'entries', null) || [])
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
export function apiWikiItem(state, name) {
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
 * Re-exported from `js/lib/paths.mjs`, where the lib split put it.
 *
 * ⚠ A SECOND, INDEPENDENT COPY lives in `js/inspect/scan.mjs`, written for the doctor's tree
 * walks. A change to the containment rule has to land on both, and nothing compares them.
 *
 * Re-exported here (rather than imported directly by callers) so `js/web/actions.mjs`'s
 * import path stays unchanged.
 */
export { within };

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

export const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

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
    flatName(name);
    const p = path.join(state.target, name);
    if (!isFile(p)) throw new NotFound(name);
    const raw = readMaybe(p) ?? '';
    const [title, desc] = CONFIG_META[name] ?? [name, ''];
    return { type, name, title, desc, manifest: configManifest(name, p),
      body: `\`\`\`json\n${raw}\n\`\`\``, links: [], source: resolvePath(p) };
  }
  throw new NotFound(type);
}

// ---- the eight endpoints -------------------------------------------------------------

/** `buildOverride` in `actions.mjs` is a third reader of this. */
export function themeChoices() {
  return themeOptions().map(([name, blurb]) => {
    const data = readJsonMaybe(path.join(THEMES, `${name}.json`));
    const d = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    return { name, blurb, accent: dget(d, 'ACCENT', 'cyan'),
      tagline: dget(d, 'TAGLINE', ''), sigil: dget(d, 'LOADED_SIGIL', '') };
  });
}

export const emitChoices = () => EMIT_OPTIONS.map(([name, desc]) => ({ name, desc }));

export function apiThemes(state) {
  return { themes: themeChoices(), emits: emitChoices(),
    current: { theme: state.theme, emit: state.emit } };
}

/**
 * No interpreter/runtime version field, deliberately: this server has no interpreter
 * version worth reporting under that name, and reporting this runtime's own version there
 * would misrepresent what actually changed. The field is absent rather than
 * present-and-empty.
 */
export function apiSetup(state) {
  return {
    ...statusData(),
    root: ROOT,
    target: state.target,
    deployed: deployed(state),
  };
}

/** The same engine as the `doctor` verb, grouped per check. */
export function apiDoctor(state) {
  const groups = [];
  const [themes, problems] = doctorCollect({ theme: state.theme, groups });
  state.stampDoctor(problems);
  return { themes, ok: !problems.length, problems, groups,
    checked_at: state.doctor.checked_at };
}

export function apiDiff(state) {
  const { target, theme, files } = diffCollect({
    target: state.target, theme: state.theme, emit: state.emit });
  return { deployed: files !== null, target, theme, files: files || [] };
}

/** The union across every global install, verbatim. */
export const apiExcludes = () => excludesSnapshot();

/**
 * The data dir an install's inventory/memory/diff is read from. Host-driven, so a new
 * nested-marker host cannot silently read the bare root.
 */
export function viewCfg(host, scope, root) {
  if (scope === 'project' && ['claude', 'bob', 'copilot'].includes(host)) {
    return path.join(root, HOSTS.find((h) => h.host === host).projectMarker);
  }
  return root;
}

export function apiInstalls(state) {
  const out = [];
  for (const [host, scope, root] of installTargets()) {
    out.push({
      id: `${host}:${scope}`, host, scope, path: root,
      state: installState(root, host, scope),
      theme: themeOfDir(root),
      footprint: footprintOfDir(root),
      posture: postureOfDir(root),
      mode: modeOfDir(root),
      selected: samePath(viewCfg(host, scope, root), state.target),
    });
  }
  return { installs: out, postures: discoverNames('postures', 'peer'),
    modes: discoverNames('modes', 'direct') };
}

/** Beside the deployed AGENT.md. */
export const PROFILE_FILE = 'PROFILE.md';
export const profilePath = (state) => path.join(state.target, PROFILE_FILE);

export function apiProfile(state) {
  const p = profilePath(state);
  if (!isFile(p)) return { exists: false, path: p, text: '', fingerprint: '' };
  const text = readMaybe(p) ?? '';
  return { exists: true, path: p, text, fingerprint: fingerprint(text) };
}

/** The dashboard aggregate. */
export function apiOverview(state) {
  const inv = state.inventory;
  let diff = null;
  if (deployed(state)) {
    const { files } = diffCollect({
      target: state.target, theme: state.theme, emit: state.emit });
    if (files !== null) {
      diff = {
        edited: files.filter((f) => f.status === 'edited').length,
        added: files.filter((f) => f.status === 'added').length,
        missing: files.filter((f) => f.status === 'missing').length,
      };
    }
  }
  let buildTime = null;
  // The SAME mtime twice, on purpose. `build_time` is the stamp a person reads; `build_epoch`
  // is the number a relative label ("20h") is computed from. The console used to have only the
  // first and had to re-parse it, and `Date.parse` on a space-separated local stamp is
  // engine-dependent — a plausible-but-wrong "2h" is the exact failure a second field costs
  // nothing to prevent.
  let buildEpoch = null;
  const agentMd = path.join(state.target, 'AGENT.md');
  if (isFile(agentMd)) {
    const ms = statSync(agentMd).mtimeMs;
    buildTime = stampMinute(ms);
    buildEpoch = Math.floor(ms / 1000);
  }
  // Which detected install the current view points at, so the dashboard's footprint hero
  // can re-emit exactly it. Mirrors `viewCfg`'s rule, spelled out separately here.
  let install = null;
  for (const [host, scope, root] of installTargets()) {
    const data = (scope === 'project' && ['claude', 'bob', 'copilot'].includes(host))
      ? path.join(root, HOSTS.find((h) => h.host === host).projectMarker) : root;
    try {
      if (samePath(data, state.target)) {
        install = { host, scope, path: root, footprint: footprintOfDir(root) };
        break;
      }
    } catch { /* an unreadable candidate just isn't a match */ }
  }
  return {
    theme: state.theme,
    accent: accentFor(state.theme),
    emit: state.emit,
    footprint: install ? install.footprint : state.footprint,
    // ⚠ NO PACK ROSTER HERE, DELIBERATELY. One was added when the toggle lived in Settings,
    // which has no other source for the pack names. The control moved to the Constitution
    // page, which already holds the whole catalogue — `/api/catalog/laws` carries `pack`,
    // `packTitle`, `packDesc` and `active` on every doctrine row — so a second copy of the
    // roster on this endpoint would be API surface with no reader, and two places for the
    // same fact to disagree. The SUMMARY stays, under `counts.doctrines`: the dashboard
    // tiles need the fraction and must not fetch a catalogue to draw it.
    install,
    target: state.target,
    deployed: deployed(state),
    counts: {
      agents: inv.agents.length,
      skills: inv.skills.length,
      // ⚠ `laws` STAYS THE INVARIANT COUNT. The rail badge reads it, `docCounts` mirrors it as
      // `{N_LAWS}`, and the doctor's frozen `proseMirrorProblems` compares README and
      // SHIPPED.md prose against the same number. Widening it to "the whole constitution"
      // would silently move all four at once.
      laws: inv.laws.length,
      ontology: (inv.ontology ?? []).length,
      // The tier's own summary, kept out of the section counts because it is not a section:
      // `active`/`total` is the fraction the dashboard shows, `rules` counts only the packs
      // this install built in — what it is bound by, not what its bundle carries.
      doctrines: {
        active: (inv.doctrines ?? []).filter((p) => p.active).length,
        total: (inv.doctrines ?? []).length,
        // Counted RULE BY RULE, not pack by pack: with the per-rule axis an active pack can
        // carry an inactive rule, so `p.rules.length` over active packs over-counts by
        // exactly what the user switched off — the one number on the dashboard that claims
        // to say how many rules bind this install.
        rules: (inv.doctrines ?? [])
          .reduce((n, p) => n + p.rules.filter((r) => r.active !== false).length, 0),
      },
      memory: memoryItems(state).length,
      notebook: notebookItems(state).length,
      wiki: wikiItems(state).length,
      config: configItems(state).length,
    },
    doctor: state.doctor,
    diff,
    build_time: buildTime,
    build_epoch: buildEpoch,
    // The RELEASE LABEL OF THE SOURCE THIS CONSOLE IS SERVED FROM, not of the deployed install —
    // the two differ whenever something has changed since the last emit, which is exactly when
    // knowing which one you are looking at matters. `.geneseed-version` carries the install's own
    // label and the fingerprint comparison already reports the drift; this answers the plainer
    // question the topbar asks, "what is running".
    //
    // Degrades to null rather than to a wrong number: `sourceReleaseVersion` answers '0.0.0' for
    // an unreadable config, and a console confidently displaying 0.0.0 is worse than one that
    // shows nothing.
    version: releaseLabel(),
  };
}

/**
 * How many files `apiRecent` will `stat` before it gives up on a section.
 *
 * The wiki is the only section with no ceiling — `WIKI_FILE_CAP` lets one vault contribute
 * 5000 pages — and "the newest N of the first 1200 I looked at" is not the newest N. So a
 * section over the cap is DROPPED and NAMED in `skipped`, rather than answered from a
 * truncated pool: the card can then say which shelves it read, which is a fact, where a
 * silently-biased list would be a wrong one nobody could catch.
 */
const RECENT_STAT_CAP = 1200;

/** How many entries `/api/recent` returns — the card shows a handful, not a feed. */
const RECENT_LIMIT = 8;

/**
 * THE NEWEST FILE-BACKED ENTRIES ACROSS THE HARNESS — the "freshly grown" card's whole payload.
 *
 * The first GET added after the Python→Node port froze its reference surface. It exists
 * because NOTHING else in this API carries a per-entry date: every
 * catalog row is `{name, title, desc, source}` and the only two timestamps on the whole surface are
 * `overview.build_time` and `doctor.checked_at`. A client cannot stat a path, so "what changed
 * lately" was unanswerable without a server that looks.
 *
 * ONLY THE SECTIONS THE USER WRITES BY HAND. Memory, notebook, wiki and config each name a
 * file someone actually authored, at a moment that means something.
 *
 * ⚠ SKILLS AND AGENTS ARE EXCLUDED, AND THEY WERE IN HERE FIRST — a live check is what took
 * them out. Their `source` is the EMITTED artefact (`~/.config/opencode/skills/<x>/SKILL.md`),
 * written by the last build, so on a real install all 67 of them carry ONE mtime and it is
 * `overview.build_epoch` to the second. Sorted newest-first they filled the whole answer with
 * the alphabetical head of the last rebuild — `advocate, architect, brainstorm, clarify…` —
 * and pushed out every genuinely recent memory and note. Dating a rendered file dates the
 * BUILD, which the overview already states once and correctly. (Reading the repo's `src/`
 * instead would not save it: a fresh clone stamps every file with the checkout.)
 *
 * The constitution is out for the same family of reason: its tiers are entries inside shared
 * law files, so a per-rule mtime would be the file's, repeated — one wrong date on nine rows.
 */
export function apiRecent(state) {
  const sections = [
    ['memory', 'memory', () => memoryItems(state)],
    ['notebook', 'notebook', () => notebookItems(state)],
    ['wiki', 'wiki', () => wikiItems(state)],
    ['config', 'config', () => configItems(state)],
  ];
  const items = [];
  const skipped = [];
  for (const [section, type, load] of sections) {
    let rows;
    try { rows = load() ?? []; } catch { skipped.push(section); continue; }
    if (rows.length > RECENT_STAT_CAP) { skipped.push(section); continue; }
    for (const r of rows) {
      if (!r.source) continue;
      let mtime;
      // A row whose file has been moved or deleted since the inventory was rendered is not an
      // error — it is simply not among the newest anything. Skipping beats a null date that
      // would sort somewhere.
      try { mtime = Math.floor(statSync(r.source).mtimeMs / 1000); } catch { continue; }
      items.push({ section, type, name: r.name, title: r.title || r.name, mtime });
    }
  }
  // Newest first, ties broken by name so the order is stable between two requests a second
  // apart — several files written by one rebuild share a second exactly.
  items.sort((a, b) => (b.mtime - a.mtime) || comparePaths(a.name, b.name));
  return { items: items.slice(0, RECENT_LIMIT), skipped, limit: RECENT_LIMIT };
}

/** The source's release label, or null when it cannot be read. */
function releaseLabel() {
  const v = sourceReleaseVersion({ config: CONFIG });
  return v && v !== '0.0.0' ? v : null;
}

/**
 * The prefix routes — path in, response out.
 *
 * `percentDecode` and not `decodeURIComponent`: the JS builtin throws a `URIError` on a `%`
 * that is not an escape, where this shell instead answers a 404 naming the literal text.
 */
export const PREFIX_ROUTES = [
  ['/api/catalog/', (state, p) => apiCatalog(state, p.split('/').pop())],
  // /api/item/<type>/<name> — TYPE has no slash, the NAME keeps its slashes so a wiki
  // page's relpath survives. A missing name is a 404 here rather than a 500 two frames down.
  ['/api/item/', (state, p) => {
    const m = /^\/api\/item\/([^/]+)\/(.+)$/.exec(p);
    if (!m) throw new NotFound(p);
    return apiItem(state, m[1], percentDecode(m[2]));
  }],
  // The sid is passed through unquoted — `apiActivityDetail`'s safe-name scheme is what
  // makes the lookup safe, rather than a check out here.
  ['/api/activity/', (state, p) => apiActivityDetail(
    state, percentDecode(p.slice('/api/activity/'.length)))],
];

/**
 * A literal path to `api_X(state)`, table-keyed rather than a chain of `if`s — the reason
 * it is a table is `tests/unit/web_server.test.mjs`'s cross-check, which requires this
 * table plus `PREFIX_ROUTES` and `GET_INLINE` to equal a surface list written out in the
 * test, so a route cannot appear or vanish unenumerated.
 */
export const STATE_ROUTES = {
  '/api/overview': apiOverview,
  '/api/recent': apiRecent,
  '/api/themes': apiThemes,
  '/api/setup': apiSetup,
  '/api/doctor': apiDoctor,
  '/api/installs': apiInstalls,
  '/api/excludes': apiExcludes,
  '/api/profile': apiProfile,
  '/api/diff': apiDiff,
  '/api/activity': apiActivity,
  // `/api/rules` must exist as a PAIR with its POST: `apiRulesMutate` splices `parseRules`'
  // line indices, and the fingerprint every mutation must send back is what this GET
  // answers — a daemon whose POST worked and whose GET 501'd would have no way to obtain one.
  '/api/rules': apiRules,
  '/api/mcp': apiMcp,
};
