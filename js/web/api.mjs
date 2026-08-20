/**
 * The web console's read endpoints — P6b's `overview`, `themes`, `doctor`, `diff`,
 * `installs`, `excludes`, `setup` and `profile`, P6c's `catalog`, `item` and `wiki_item`,
 * and the `WebState` all eleven read from.
 *
 * WHAT WAS ACTUALLY NEW HERE, MEASURED BY READING `js/` RATHER THAN BY GREPPING A NAME.
 * The P6 handoff scored this group at "~430 LOC new against ~1,600 already ported" and
 * the order was right, but the shape is worth stating because it is the same discovery
 * every P5 sub-phase made: six of the eight are a JSON face over a function `js/` already
 * owns. `apiSetup` is `statusData()` plus four fields. `apiDiff` is `diffCollect()`
 * reshaped. `apiExcludes` is `excludesSnapshot()`, unmodified. `apiInstalls` is a row per
 * `installTargets()` entry through five detectors P5d and P5f ported. `apiDoctor` is
 * `doctorCollect()` — with the one parameter it did not have. Only `apiThemes` and
 * `apiOverview` compute anything of their own, and most of what `apiOverview` computes is
 * counting.
 *
 * THE ONE PARAMETER: `doctorCollect({groups})`. `js/doctor.mjs` carried a `ran(check,
 * label, probs)` that returned its third argument and threw the first two away, with a
 * docblock saying the label stays "because it is the one place each check is NAMED, and
 * what P6's accumulator will key on". This is that phase. `on_progress=` — the TUI's — is
 * still absent, still P7's: nothing here passes it and adding it would be a claim no cell
 * can check.
 *
 * THE INVENTORY IS THE FULL RECORD SINCE P6c, AND THERE IS STILL ONE CLASSIFIER. P6b
 * shipped `inventoryFor` as three integers, because `apiOverview` reads three `len()`s off
 * `state.inventory` and the badges and taxonomy classes belonged to a phase that had not
 * arrived. `api_catalog` consumes exactly those fields, so this is the phase that would
 * have made the counting half and the reading half two classifiers. It did not:
 * `tuiInventory` in `js/inventory.mjs` is the one walk, `js/status.mjs`'s `inventoryCounts`
 * is three `length`s off it, and `specEntries` grew out of `specNames` by adding the READ
 * rather than by being written beside it.
 *
 * THE TAXONOMY WAS ALREADY PORTED, which the measurement found and the handoff did not.
 * `js/status.mjs` said flatly that "the ~111 LOC of TUI taxonomy" was P7's; `LAW_CLASS`,
 * `SKILL_CLASS`, `LAW_CLASSES` and `ENTITY_STATUSES` had in fact crossed in P5g inside
 * `js/doctor.mjs`, because doctor's authoring gates are what validate them. P6c moved the
 * four to `js/inventory.mjs` — where Python keeps them — rather than copying them, and
 * doctor imports them back. Only `parse_laws`, `load_registry` and `entity_status` were
 * genuinely new.
 *
 * THE SNAPSHOT REPORTS NO INTERPRETER VERSION, and the absence is deliberate. The server
 * this one replaced ran on an interpreter and published its version under a key named for
 * it; nothing here answers that question, and answering it with this runtime's version
 * under that name would have been a lie the UI printed. So the field is gone rather than
 * present-and-empty. The recorded web corpus was taken from the old server and still
 * carries the key, which is why its replay harness erases it before comparing.
 *
 * P6c's ROUTES ARE THE FIRST THAT PARSE A PATH, which brings three things no earlier
 * endpoint could reach: `pyUnquote` (NOT `decodeURIComponent`, which throws where the
 * reference leaves a stray `%` alone), the `NotFound` → 404 convention, and `flatName`'s
 * traversal refusal — a GET carries no token, so before that check the item route was an
 * arbitrary-file read.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { ROOT, THEMES, discoverNames } from '../checkout.mjs';
import { diffCollect } from '../diff.mjs';
import { doctorCollect } from '../doctor.mjs';
import { excludesSnapshot } from '../excludes.mjs';
import { GLOBAL_MANIFEST, HOSTS, opencodeConfigDir, pyResolve } from '../hosts.mjs';
import {
  doctrinesForBuild, footprintOfDir, installState, installTargets, installedDefaults, modeOfDir,
  postureOfDir, readJsonMaybe, readMaybe, themeOfDir,
} from '../installs.mjs';
import { frontmatter } from '../hooks.mjs';
import {
  SKILL_CLASS, entityStatus, loadRegistry, tuiInventory,
} from '../inventory.mjs';
import { firstBlockquote } from '../native.mjs';
import { EMIT_OPTIONS, themeOptions } from '../setup.mjs';
import { accentFor, statusData } from '../status.mjs';
import {
  comparePaths, normcase, pyStripSpace, pyUnquote, readText, withDiscardableStderr, within,
} from '../lib/fs.mjs';
import { readJsonc } from '../settings.mjs';
import { apiActivity, apiActivityDetail } from './activity.mjs';
import { apiMcp, apiRules } from './actions.mjs';
import { apiGraph } from './graph.mjs';

/** `_web_core.NotFound` — a requested catalog section or item that does not exist. */
export class NotFound extends Error {}

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

/** Two resolved paths, compared as `PurePath.__eq__` does — case-folded on Windows. */
const samePath = (a, b) => normcase(pyResolve(a)) === normcase(pyResolve(b));

/** `dict.get(key, default)` — `??` would also swallow an explicit null the file declared. */
const dget = (obj, key, dflt) => (Object.hasOwn(obj, key) ? obj[key] : dflt);

/** `hashlib.sha256(text.encode()).hexdigest()[:16]`, and "" for an empty file. */
export function fingerprint(text) {
  return text ? createHash('sha256').update(text, 'utf-8').digest('hex').slice(0, 16) : '';
}

/**
 * `datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M")` — LOCAL time, as the reference's
 * naive `fromtimestamp` is. `toISOString` would be UTC and would read as a port bug in
 * every timezone but one.
 */
export function stampMinute(ms) {
  const d = new Date(ms);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} `
    + `${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

// ---- WebState ---------------------------------------------------------------------------

/**
 * `_web_core.WebState` — the resolved view of the deployed harness a request reads from.
 *
 * A factory returning a plain object rather than a class, because the two cached
 * properties are the only behaviour and a getter pair expresses them without ceremony.
 * THE CACHING IS BEHAVIOUR, NOT AN OPTIMISATION: `doctorCollect` renders a theme per call
 * and the dashboard GETs `/api/overview` on every navigation, so an uncached `doctor`
 * would put a full build on the request path. `refresh()` is what a mutation calls to
 * drop both (P6f's).
 */
export function webState(theme = null, target = null) {
  const st = {
    // `Path(target) if target else _opencode_config_dir()` — NOT resolved. `target` is
    // printed by three endpoints, so resolving it here would change what they answer.
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
   * `WebState._detect_emit` — the CURRENT install's mode, from its `.geneseed-emit` marker:
   * the ROOT first (where every emit writes it), then the data dir.
   *
   * P6b ported `refresh()` WITHOUT this, because nothing called `refresh()` yet and the
   * constructor reads `installedDefaults()` instead. P6f is the phase with mutations, so
   * `refresh()` finally runs — and the reference's `self.emit = self._detect_emit() or
   * self.emit` line was missing here, which would have left `emit` stale after any write
   * that re-themed or re-pointed the install. Restored with its caller.
   */
  st.detectEmit = () => {
    for (const d of [st.root, st.target]) {
      try {
        const em = path.join(d, '.geneseed-emit');
        if (isFile(em)) {
          const v = pyStripSpace(readText(em));
          if (v) return v;
        }
      } catch { /* as the Python's `except OSError: pass` */ }
    }
    return existsSync(path.join(st.root, 'CLAUDE.md')) ? 'claude-global' : 'opencode-global';
  };
  /**
   * `WebState.select_view` — re-point the console at another detected install's data dir.
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

/** `_web_core._deployed`. */
export function deployed(state) {
  return existsSync(path.join(state.target, GLOBAL_MANIFEST));
}

/**
 * `_web_core._spec_desc` — a deployed spec's one-line purpose.
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
 * `_web_core._spec_entries` — agent/skill specs read straight off a DEPLOYED harness dir.
 *
 * Agents are flat `<root>/<name>.md` (skipping `_*` templates); skills use OpenCode's
 * folder layout `<root>/<name>/SKILL.md`. `glob("*.md")` is case-INSENSITIVE on Windows,
 * as pathlib's is — `normcase` rather than a bare `endsWith`. The frontmatter is stripped
 * because it is host plumbing rather than prose, which is what makes a deployed entry the
 * same shape as a source-rendered one and every consumer indifferent to the origin.
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
    out.push({ name, desc: specDesc(fm, body), body, source: pyResolve(p) });
  }
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return out;
}

/**
 * `_web_core._deployed_inventory` — the agents and skills actually installed at
 * `state.target`, not a fresh render of `src/`.
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
  const render = tuiInventory(state.theme, doctrinesForBuild(state.target));
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

/** `WebState.inventory` — the deployed record when there is one, else the source render. */
export function inventoryFor(state) {
  return deployed(state) ? deployedInventory(state) : tuiInventory(state.theme);
}

// ---- the catalog stores overview counts ---------------------------------------------------

/** `_web_catalog._memory_dir` — always `<target>/memory`, never the CWD-scanning resolver. */
const memoryDir = (state) => path.join(state.target, 'memory');
const notebookDir = (state) => path.join(state.target, 'notebook');

/**
 * `sorted(pathlib.Path.glob("*.md"))` — matched, case-insensitive on Windows.
 *
 * `comparePaths` AND NOT A BARE `.sort()`, and this was a LIVE BUG until P6f's memory cells
 * put an uppercase filename in the directory. `sorted()` over `Path` objects compares
 * `_str_normcase`, so on Windows `MEMORY.md` sorts under `m` and lands after `a-fact.md`;
 * JS's default comparator is UTF-16 code units, so `M` (0x4D) sorts before `a` (0x61) and
 * the whole catalog came back in a different order. Every seeded memory and notebook file in
 * P6b and P6c was lower-case, which is why nothing said so for three phases. The `normcase`
 * in the filter beside it was already here for exactly this reason — the sort was the half
 * that got missed.
 */
function globMd(dir) {
  if (!isDir(dir)) return [];
  let names;
  try { names = readdirSync(dir); } catch { return []; }
  return names.filter((n) => normcase(n).endsWith('.md') && isFile(path.join(dir, n)))
    .sort(comparePaths);
}

const stemOf = (name) => name.slice(0, name.length - path.extname(name).length);

/** `_web_catalog._memory_items`. */
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
      source: pyResolve(p),
    };
  });
}

/** `_web_catalog._notebook_items`. */
export function notebookItems(state) {
  const d = notebookDir(state);
  if (!isDir(d)) return [];
  return globMd(d).map((n) => ({
    name: stemOf(n), title: stemOf(n), desc: '', source: pyResolve(path.join(d, n)),
  }));
}

/** `_web_catalog._CONFIG_META` — the two setup manifests, in listing order. */
const CONFIG_META = {
  'context.json': ['Project context', 'what the agent loads for this project'],
  'wiki.jsonc': ['Wiki manifest', 'your machine-wide knowledge base(s)'],
};

/** `_web_catalog._config_items`. */
export function configItems(state) {
  const out = [];
  for (const fname of ['context.json', 'wiki.jsonc']) {
    const p = path.join(state.target, fname);
    if (!isFile(p)) continue;
    const [title, desc] = CONFIG_META[fname] ?? [fname, ''];
    out.push({ name: fname, title, desc, type: 'config', kind: 'manifest',
      source: pyResolve(p) });
  }
  return out;
}

export const WIKI_FILE_CAP = 5000;

/**
 * `pyResolve` for a path that came out of a HAND-MAINTAINED manifest — `null`, never a throw.
 *
 * The three wiki sites below are the only request-path callers of `expanduser`, and it now
 * REFUSES a `~user` form by printing and throwing (`js/hosts.mjs`'s docblock). None of them
 * may let that escape: `js/web/server.mjs` wraps the whole GET in a blanket `catch` → a JSON
 * 500, so an unguarded refusal would turn ONE bad line in a file the user hand-edits into a
 * dead Knowledge section. That is the same argument `sovereignBypass` makes in `js/hooks.mjs`
 * — contain the refusal per entry and take the site's OWN degrade — and each of the three
 * already has one: `[]`, `continue`, `continue`-into-404. The reference reaches those same
 * three degrades for a `~user` path, from the other direction: `ntpath.expanduser` expands
 * `~nosuchuser` to `C:\Users\nosuchuser\…`, which does not exist, so `is_file()`/`is_dir()`
 * answer False. `_wiki_path` in `_web_catalog.py` is the guard that makes POSIX agree, where
 * the same call raises RuntimeError instead.
 *
 * `withDiscardableStderr` because `expanduser` writes its refusal at the RAISE SITE and this
 * caller catches — the reference prints nothing here, and `<server stderr>` is compared as
 * bytes by `tests/web_golden.py`, so replaying it would be a divergence on every cell.
 *
 * DELIBERATE, ADJUDICATED RESIDUE: if `C:\Users\<other-user>\…` really exists, the reference
 * on Windows READS ANOTHER ACCOUNT'S FILE where this refuses. Refusing is the settled product
 * decision — the reference is the side that is wrong — and the reference is being deleted.
 */
function wikiPath(p) {
  try {
    return withDiscardableStderr(() => pyResolve(p));
  } catch {
    return null;
  }
}

/**
 * `_web_catalog._wiki_manifest` — `$GENESEED_WIKI` first, else `wiki.jsonc` beside the
 * deployed bundle, read with the harness's generic JSONC loader.
 *
 * `pyResolve` where the reference only `expanduser()`s. NOT OBSERVABLE, so it stays: `p` is
 * consumed by `isFile` and `mcpLoad` and never reaches a response body, and both of those
 * follow symlinks and resolve a relative path against the same cwd anyway.
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
 * `harness._mcp_load(path)` with no host — the COMMENT-TOLERANT dict loader, `{}` for a
 * file that is missing, unreadable, unparseable, or not an object.
 *
 * Comment-tolerant is the whole point and the first draft of this got it wrong. The two
 * files it reads are `wiki.jsonc` and `context.json`, and the first is `.jsonc` because it
 * is HAND-MAINTAINED: a `//` in it parses on the reference and would have made
 * `JSON.parse` return null here, so the wiki section would have silently listed nothing
 * and the config item's `manifest` would have come back empty. The seeded manifests in
 * `tests/web_golden.py` are plain JSON, so no cell had one — `catalog/…-tolerates-comments`
 * is the cell that does now.
 */
function mcpLoad(p) {
  if (!isFile(p)) return {};
  let text;
  try { text = readText(p); } catch { return {}; }
  const [data] = readJsonc(text);
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

/** Every `.md` under `dir`, recursively, POSIX-relative to it and sorted — `rglob("*.md")`. */
function rglobMd(dir, base = dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) rglobMd(full, base, out);
    else if (normcase(e.name).endsWith('.md')) out.push(full);
  }
  return out;
}

/** `_web_catalog._wiki_items`. */
export function wikiItems(state) {
  const items = [];
  const seen = new Set();
  for (const w of wikiManifest(state)) {
    if (!w || typeof w !== 'object' || Array.isArray(w)) continue;
    const wname = String(dget(w, 'name', null) || 'wiki');
    // PER ENTRY, and the loop continues — one unusable `path` in the manifest must not blank
    // every OTHER vault in it. `pyResolve` where the reference only `expanduser()`s is again
    // unobservable: `root` is only ever joined against or used as the base of a `relative()`
    // whose other operand was built FROM it, and `source` is `.resolve()`d on both sides.
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
      // `sorted(fp.rglob("*.md"))[:cap]` — `comparePaths`, for the reason `globMd` carries.
      else if (isDir(fp)) mds = rglobMd(fp).sort(comparePaths).slice(0, WIKI_FILE_CAP);
      else continue;
      for (const md of mds) {
        const r = path.relative(root, md).split(path.sep).join('/');
        const key = `${wname}:${r}`;
        if (seen.has(key) || excluded(r)) continue;
        seen.add(key);
        items.push({ name: key, title: path.basename(md, '.md'),
          desc: mds.length === 1 ? desc : r, type: 'wiki', kind: 'page', group: wname,
          source: pyResolve(md) });
      }
    }
  }
  return items;
}

/** `_web_catalog.api_wiki_item` — one page by `<wiki>:<relpath>`, never outside the vault. */
export function apiWikiItem(state, name) {
  const at = name.indexOf(':');
  const wname = at < 0 ? name : name.slice(0, at);
  const rel = (at < 0 ? '' : name.slice(at + 1))
    .replace(/^\/+|\/+$/g, '').replace(/\\/g, '/');
  for (const w of wikiManifest(state)) {
    if (!w || typeof w !== 'object' || Array.isArray(w)) continue;
    if (String(dget(w, 'name', null) || 'wiki') !== wname) continue;
    // The reference is `.expanduser().resolve()` here, so this site matches on resolve and
    // differs only on the refusal — which falls through to the `NotFound` below, exactly
    // where the reference lands when the expanded root turns out not to exist.
    const root = wikiPath(String(dget(w, 'path', null) || ''));
    if (!root) continue;
    const p = pyResolve(path.join(root, rel));
    if (rel && path.extname(p) === '.md' && within(p, root) && isFile(p)) {
      const body = readMaybe(p) ?? '';
      return { type: 'wiki', name, title: path.basename(p, '.md'), desc: '',
        body, links: resolveLinks(state, body), source: p };
    }
  }
  throw new NotFound(name);
}

/**
 * `harness._within` — re-exported from `js/lib/fs.mjs`, where P6i moved it.
 *
 * It lived here from P6b (the restore's containment check) until `_install_move_list` needed
 * the same predicate from `js/uninstall.mjs`, which must not import the web tree. The
 * re-export keeps `js/web/actions.mjs`'s import path unchanged.
 */
export { within };

/**
 * `_web_catalog._flat_name` — catalog names are flat basenames.
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

/** `_web_core.WIKILINK_RE`. Exported since P6e — `js/web/graph.mjs` is its second reader. */
export const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

/**
 * `_web_catalog._resolve_links` — `[[name]]` matched against known agent and skill names.
 *
 * AGENTS FIRST, SKILLS SECOND, into ONE map — so a name that is both resolves as a SKILL.
 * That is not a preference, it is what the reference's two loops do in that order, and
 * `item/an-agent-carries-its-body-and-its-resolved-links` is the cell that would catch the
 * other order.
 */
export function resolveLinks(state, body) {
  const inv = state.inventory;
  const known = new Map();
  for (const e of inv.agents) known.set(e.name, 'agent');
  for (const e of inv.skills) known.set(e.name, 'skill');
  const links = [];
  const seen = new Set();
  for (const m of body.matchAll(WIKILINK_RE)) {
    // `pyStripSpace`, not `trim()` — P6d measured the two whitespace classes apart and P6e
    // gave this regex a second reader, so the two call sites answer with one rule.
    const label = pyStripSpace(m[1]);
    if (known.has(label) && !seen.has(label)) {
      seen.add(label);
      links.push({ label, type: known.get(label), name: label });
    }
  }
  return links;
}

/**
 * `_web_catalog._config_manifest` — a setup file parsed into the shape the detail pane
 * renders as cards, or `null` so the caller falls back to the raw body.
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
 * `_web_core.SECTIONS` — a closed list; anything else is a 404.
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
      // ⚠ EVERY RULE IS LISTED WHETHER OR NOT ITS PACK IS BUILT IN. An inactive pack that
      // vanished from the payload would be indistinguishable from one that never shipped, and
      // the console could not then offer the command that turns it back on.
      active: p.active,
    }))),
  ];
}

/** `_web_catalog.api_catalog`. */
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

/** `_web_catalog.api_item`. */
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
      links: resolveLinks(state, body), source: pyResolve(p) };
  }
  if (type === 'wiki') return apiWikiItem(state, name);
  if (type === 'config') {
    flatName(name);
    const p = path.join(state.target, name);
    if (!isFile(p)) throw new NotFound(name);
    const raw = readMaybe(p) ?? '';
    const [title, desc] = CONFIG_META[name] ?? [name, ''];
    return { type, name, title, desc, manifest: configManifest(name, p),
      body: `\`\`\`json\n${raw}\n\`\`\``, links: [], source: pyResolve(p) };
  }
  throw new NotFound(type);
}

// ---- the eight endpoints -------------------------------------------------------------

/** `_web_actions._theme_choices`. Exported since P6g — `_build_override` is its third reader. */
export function themeChoices() {
  return themeOptions().map(([name, blurb]) => {
    const data = readJsonMaybe(path.join(THEMES, `${name}.json`));
    const d = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    return { name, blurb, accent: dget(d, 'ACCENT', 'cyan'),
      tagline: dget(d, 'TAGLINE', ''), sigil: dget(d, 'LOADED_SIGIL', '') };
  });
}

/** `_web_actions._emit_choices`. */
export const emitChoices = () => EMIT_OPTIONS.map(([name, desc]) => ({ name, desc }));

/** `_web_actions.api_themes`. */
export function apiThemes(state) {
  return { themes: themeChoices(), emits: emitChoices(),
    current: { theme: state.theme, emit: state.emit } };
}

/** `_web_actions.api_setup`. */
export function apiSetup(state) {
  return {
    ...statusData(),
    root: ROOT,
    target: state.target,
    deployed: deployed(state),
  };
}

/** `_web_actions.api_doctor` — the same engine as the `doctor` verb, grouped per check. */
export function apiDoctor(state) {
  const groups = [];
  const [themes, problems] = doctorCollect({ theme: state.theme, groups });
  state.stampDoctor(problems);
  return { themes, ok: !problems.length, problems, groups,
    checked_at: state.doctor.checked_at };
}

/** `_web_actions.api_diff`. */
export function apiDiff(state) {
  const { target, theme, files } = diffCollect({
    target: state.target, theme: state.theme, emit: state.emit });
  return { deployed: files !== null, target, theme, files: files || [] };
}

/** `_web_actions.api_excludes` — the union across every global install, verbatim. */
export const apiExcludes = () => excludesSnapshot();

/**
 * `_web_actions._view_cfg` — the data dir an install's inventory/memory/diff is read from.
 * Host-driven, so a new nested-marker host cannot silently read the bare root.
 */
export function viewCfg(host, scope, root) {
  if (scope === 'project' && ['claude', 'bob', 'copilot'].includes(host)) {
    return path.join(root, HOSTS.find((h) => h.host === host).projectMarker);
  }
  return root;
}

/** `_web_actions.api_installs`. */
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

/** `_web_catalog._profile_path` — `build.PROFILE_FILE` beside the deployed AGENT.md. */
export const PROFILE_FILE = 'PROFILE.md';
export const profilePath = (state) => path.join(state.target, PROFILE_FILE);

/** `_web_catalog.api_profile`. */
export function apiProfile(state) {
  const p = profilePath(state);
  if (!isFile(p)) return { exists: false, path: p, text: '', fingerprint: '' };
  const text = readMaybe(p) ?? '';
  return { exists: true, path: p, text, fingerprint: fingerprint(text) };
}

/** `_web_overview.api_overview` — the dashboard aggregate. */
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
  const agentMd = path.join(state.target, 'AGENT.md');
  if (isFile(agentMd)) buildTime = stampMinute(statSync(agentMd).mtimeMs);
  // Which detected install the current view points at, so the dashboard's footprint hero
  // can re-emit exactly it. Mirrors `viewCfg`'s rule, spelled out as the reference spells
  // it out — the two are separate code in the Python too.
  let install = null;
  for (const [host, scope, root] of installTargets()) {
    const data = (scope === 'project' && ['claude', 'bob', 'copilot'].includes(host))
      ? path.join(root, HOSTS.find((h) => h.host === host).projectMarker) : root;
    try {
      if (samePath(data, state.target)) {
        install = { host, scope, path: root, footprint: footprintOfDir(root) };
        break;
      }
    } catch { /* as the Python's `except OSError: pass` */ }
  }
  return {
    theme: state.theme,
    accent: accentFor(state.theme),
    emit: state.emit,
    footprint: install ? install.footprint : state.footprint,
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
        rules: (inv.doctrines ?? []).filter((p) => p.active)
          .reduce((n, p) => n + p.rules.length, 0),
      },
      memory: memoryItems(state).length,
      notebook: notebookItems(state).length,
      wiki: wikiItems(state).length,
      config: configItems(state).length,
    },
    doctor: state.doctor,
    diff,
    build_time: buildTime,
  };
}

/**
 * `_web_server.Handler.STATE_ROUTES`, the ported half.
 *
 * A literal path to `api_X(state)`, exactly as the reference's table is — and the reason
 * it is a table on this side too is `tests/test_web_server.py`'s cross-check, which reads
 * the reference's table out of `rituals/_web_server.py` with `ast` and requires this one
 * plus `NOT_PORTED` to equal it. On the second instance of anything, the gate becomes a
 * table cross-checked against the source of truth.
 */
/**
 * `_web_server.do_GET`'s prefix routes, the ported ones — path in, response out.
 *
 * `pyUnquote` and not `decodeURIComponent`: the JS builtin throws a `URIError` on a `%`
 * that is not an escape, which the shell would answer as a 500 where the reference answers
 * a 404 naming the literal text.
 */
export const PREFIX_ROUTES = [
  ['/api/catalog/', (state, p) => apiCatalog(state, p.split('/').pop())],
  // `path.split("/", 4)` — /api/item/<type>/<name>, and the NAME keeps its slashes so a
  // wiki page's relpath survives. A missing name is a 404 here rather than an IndexError
  // and a 500 two frames down.
  ['/api/item/', (state, p) => {
    const parts = splitN(p, '/', 4);
    if (parts.length < 5 || !parts[4]) throw new NotFound(p);
    return apiItem(state, parts[3], pyUnquote(parts[4]));
  }],
  // P6e. The reference's own `path[len("/api/activity/"):]`, unquoted — the sid keeps
  // whatever it carries and `api_activity_detail`'s safe-name scheme is what makes the
  // lookup safe, rather than a check out here.
  ['/api/activity/', (state, p) => apiActivityDetail(
    state, pyUnquote(p.slice('/api/activity/'.length)))],
];

/** `str.split(sep, maxsplit)` — at most `n` splits, the remainder kept whole. */
function splitN(s, sep, n) {
  const out = [];
  let rest = s;
  for (let i = 0; i < n; i += 1) {
    const at = rest.indexOf(sep);
    if (at < 0) break;
    out.push(rest.slice(0, at));
    rest = rest.slice(at + sep.length);
  }
  out.push(rest);
  return out;
}

export const STATE_ROUTES = {
  '/api/overview': apiOverview,
  '/api/themes': apiThemes,
  '/api/setup': apiSetup,
  '/api/doctor': apiDoctor,
  '/api/installs': apiInstalls,
  '/api/excludes': apiExcludes,
  '/api/profile': apiProfile,
  '/api/diff': apiDiff,
  '/api/graph': apiGraph,
  '/api/activity': apiActivity,
  // P6f. `/api/rules` had to cross as a PAIR: `api_rules_mutate` splices `parse_rules`' line
  // indices, and the fingerprint every mutation must send back is what this GET answers —
  // so a Node daemon whose POST worked and whose GET 501'd would have no way to obtain one.
  '/api/rules': apiRules,
  '/api/mcp': apiMcp,
};
