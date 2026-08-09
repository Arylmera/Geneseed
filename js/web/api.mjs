/**
 * The web console's read endpoints — P6b: `overview`, `themes`, `doctor`, `diff`,
 * `installs`, `excludes`, `setup`, `profile`, and the `WebState` all eight read from.
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
 * THE INVENTORY IS STILL THE COUNTING HALF, and deliberately. `state.inventory` is the
 * FULL record — every agent and skill with its body, purpose, source path, lifecycle
 * badge and taxonomy class — and `apiOverview` reads three `len()`s off it. The badge and
 * the class come from `SKILL_CLASS` / `entity_status` / `load_registry`, the ~111 LOC of
 * TUI taxonomy `js/status.mjs` names and P7 owns, and no P6b endpoint consumes either.
 * So `inventoryFor` returns three integers and `specNames` is the file-SELECTION half of
 * `_spec_entries`. P6c grows them by adding the READ, not by writing a second selector —
 * which is the mistake `inventoryCounts`' docblock warned about in the other direction.
 *
 * THE ITEM LISTS ARE FULL, though only their LENGTH is consumed here. `memoryItems`,
 * `notebookItems`, `wikiItems` and `configItems` build the same records the reference
 * does, because the count is not separable from the work: `_memory_items` READS every
 * fact (an unreadable one raises, and the endpoint 500s — a variant that only counted
 * filenames would answer where the reference fails), and `_wiki_items` has to walk and
 * de-duplicate the whole manifest to know how many pages there are. Their fields are
 * unreachable from any P6b cell and P6c is what gates them.
 *
 * `python` IS THE ONE FIELD WITH NO HONEST TWIN. `api_setup` reports
 * `sys.version.split()[0]` — the interpreter running the daemon. A Node daemon has none,
 * and answering with Node's version under a key named `python` would be a lie the UI
 * would print. It answers `null`, which is exactly true and is the whole point of the
 * port. `tests/web_golden.py` normalises the field on both sides and
 * `tests/test_web_server.py` carries the absolute assertion about what the reference
 * puts there — the debt a tolerant comparison owes.
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
  footprintOfDir, installState, installTargets, installedDefaults, modeOfDir,
  postureOfDir, readJsonMaybe, readMaybe, themeOfDir,
} from '../installs.mjs';
import { frontmatter } from '../hooks.mjs';
import { EMIT_OPTIONS, themeOptions } from '../setup.mjs';
import { accentFor, inventoryCounts, statusData } from '../status.mjs';
import { normcase } from '../lib/pyfs.mjs';

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
  st.refresh = () => {
    st._inv = null;
    st._doctor = null;
    st.theme = themeOfDir(st.root) || themeOfDir(st.target) || st.theme;
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
 * `_web_core._spec_entries`, reduced to the FILE SELECTION it starts with.
 *
 * Agents are flat `<root>/<name>.md` (skipping `_*` templates); skills use OpenCode's
 * folder layout `<root>/<name>/SKILL.md`. `glob("*.md")` is case-INSENSITIVE on Windows,
 * as pathlib's is — `normcase` rather than a bare `endsWith`.
 */
export function specNames(root, nested) {
  if (!isDir(root)) return [];
  let names;
  try { names = readdirSync(root); } catch { return []; }
  if (nested) {
    return names.filter((n) => isDir(path.join(root, n))
      && isFile(path.join(root, n, 'SKILL.md')));
  }
  return names.filter((n) => normcase(n).endsWith('.md') && !n.startsWith('_')
    && isFile(path.join(root, n)));
}

/**
 * `WebState.inventory`, reduced to the three counts `api_overview` reads off it.
 *
 * The deployed arm replaces TWO of the three: agents and skills come from what is
 * installed at `target`, laws stay with the source render because once deployed they live
 * inside AGENT.md rather than as separate files.
 */
export function inventoryFor(state) {
  const render = inventoryCounts(state.theme);
  if (!deployed(state)) return render;
  return {
    agents: specNames(path.join(state.target, 'agents'), false).length,
    skills: specNames(path.join(state.target, 'skills'), true).length,
    laws: render.laws,
  };
}

// ---- the catalog stores overview counts ---------------------------------------------------

/** `_web_catalog._memory_dir` — always `<target>/memory`, never the CWD-scanning resolver. */
const memoryDir = (state) => path.join(state.target, 'memory');
const notebookDir = (state) => path.join(state.target, 'notebook');

/** `pathlib.Path.glob("*.md")`, sorted, case-insensitive on Windows. */
function globMd(dir) {
  if (!isDir(dir)) return [];
  let names;
  try { names = readdirSync(dir); } catch { return []; }
  return names.filter((n) => normcase(n).endsWith('.md') && isFile(path.join(dir, n))).sort();
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
 * `_web_catalog._wiki_manifest` — `$GENESEED_WIKI` first, else `wiki.jsonc` beside the
 * deployed bundle, read with the harness's generic JSONC loader.
 */
function wikiManifest(state) {
  const cand = process.env.GENESEED_WIKI;
  const p = cand ? pyResolve(cand) : path.join(state.target, 'wiki.jsonc');
  if (!isFile(p)) return [];
  const cfg = readJsonc(p);
  const wikis = cfg && typeof cfg === 'object' ? cfg.wikis : null;
  return Array.isArray(wikis) ? wikis : [];
}

/** `harness._mcp_load` for this one call site — the JSONC dict loader, `{}` on anything else. */
function readJsonc(p) {
  const doc = readJsonMaybe(p);
  return doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : {};
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
    const root = pyResolve(String(dget(w, 'path', null) || ''));
    if (!isDir(root)) continue;
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
      else if (isDir(fp)) mds = rglobMd(fp).sort().slice(0, WIKI_FILE_CAP);
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

// ---- the eight endpoints -------------------------------------------------------------

/** `_web_actions._theme_choices`. */
function themeChoices() {
  return themeOptions().map(([name, blurb]) => {
    const data = readJsonMaybe(path.join(THEMES, `${name}.json`));
    const d = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    return { name, blurb, accent: dget(d, 'ACCENT', 'cyan'),
      tagline: dget(d, 'TAGLINE', ''), sigil: dget(d, 'LOADED_SIGIL', '') };
  });
}

/** `_web_actions._emit_choices`. */
const emitChoices = () => EMIT_OPTIONS.map(([name, desc]) => ({ name, desc }));

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
    // See this module's header: the reference reports the interpreter running the daemon
    // and there is not one. Not Node's version under a Python key.
    python: null,
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
      agents: inv.agents,
      skills: inv.skills,
      laws: inv.laws,
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
export const STATE_ROUTES = {
  '/api/overview': apiOverview,
  '/api/themes': apiThemes,
  '/api/setup': apiSetup,
  '/api/doctor': apiDoctor,
  '/api/installs': apiInstalls,
  '/api/excludes': apiExcludes,
  '/api/profile': apiProfile,
  '/api/diff': apiDiff,
};
