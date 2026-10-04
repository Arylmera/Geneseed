/**
 * The web console's dashboard and settings reads — `overview`, `recent`, `themes`, `setup`,
 * `doctor`, `diff`, `installs`, `excludes` and the two `loops` reads.
 *
 * WHAT IS NOT HERE, AND WHERE IT WENT: the Library read model (catalog sections, items, wiki,
 * memory, `NotFound`) is `catalog.mjs`; the `WebState` every endpoint reads from is `state.mjs`;
 * the fingerprint-guarded rules/profile editors are `user-files.mjs`; and the GET tables that
 * bind paths to these functions are `routes.mjs`. This file imports none of its route siblings,
 * which is what keeps the old `api ↔ actions` and `api ↔ activity` cycles from coming back.
 */
import { statSync } from 'node:fs';
import path from 'node:path';

import { CONFIG, ROOT, THEMES, discoverNames } from '../build/source.mjs';
import { sourceReleaseVersion } from '../hosts/opencode.mjs';
import { diffCollect } from '../inspect/diff.mjs';
import { doctorCollect } from '../inspect/doctor.mjs';
import { excludesSnapshot } from '../inspect/excludes.mjs';
import { CLAUDE_STYLE, HOSTS, resolvePath } from '../hosts/hosts.mjs';
import {
  footprintOfDir, installState, installTargets, modeOfDir, trustOfDir,
  postureOfDir, readJsonMaybe, themeOfDir,
} from '../hosts/installs.mjs';
import { PRESETS } from '../loop/score.mjs';
import { loadCatalog, catalogProblems } from '../loop/catalog.mjs';
import { activeLoops } from '../loop/registry.mjs';
import { EMIT_OPTIONS, themeOptions } from '../maintain/setup.mjs';
import { accentFor, statusData } from '../inspect/status.mjs';
import { isFile } from '../lib/fs.mjs';
import { comparePaths, normcase } from '../lib/paths.mjs';
import {
  configItems, deployed, dget, memoryItems, notebookItems, wikiItems,
} from './catalog.mjs';
import { stampMinute } from './state.mjs';

/**
 * `js/web/docs.mjs` imports these three from HERE, and that file is outside this split — so
 * they are re-exported rather than moved out from under it. New code imports `catalog.mjs`.
 */
export { NotFound, deployed, resolveLinks } from './catalog.mjs';

/** Two resolved paths, compared case-folded on Windows. */
const samePath = (a, b) => normcase(resolvePath(a)) === normcase(resolvePath(b));

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

/**
 * `deployed` and `diffable` are TWO FACTS, and they used to be one field. `diffCollect` answers
 * `files: null` for every PROJECT install (it only knows how to re-render a global emit), so
 * `deployed: files !== null` told the Diff page a perfectly real project install was "No deployed
 * harness". `deployed` is the manifest's answer, the same one every other endpoint gives;
 * `diffable` is whether a drift check exists for this install at all.
 */
export function apiDiff(state) {
  const { target, theme, files } = diffCollect({
    target: state.target, theme: state.theme, emit: state.emit });
  return { deployed: deployed(state), diffable: files !== null, target, theme,
    files: files || [] };
}

/** The union across every global install, verbatim. */
export const apiExcludes = () => excludesSnapshot();

/**
 * The data dir an install's inventory/memory/diff is read from. Host-driven, so a new
 * nested-marker host cannot silently read the bare root.
 */
export function viewCfg(host, scope, root) {
  if (scope === 'project' && CLAUDE_STYLE.includes(host)) {
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
      trust: trustOfDir(root),
      selected: samePath(viewCfg(host, scope, root), state.target),
    });
  }
  return { installs: out, postures: discoverNames('postures', 'peer'),
    modes: discoverNames('modes', 'direct'), trusts: Object.keys(PRESETS) };
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
  // can re-emit exactly it.
  let install = null;
  for (const [host, scope, root] of installTargets()) {
    try {
      if (samePath(viewCfg(host, scope, root), state.target)) {
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
    // True when the files on disk changed under this server since it started (an upgrade).
    // `serve` installs the comparison; a state built without a server has none and is false.
    daemon_stale: Boolean(state.daemonStale?.()),
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
      // The rail's Loops badge: templates only, from the same catalogue `/api/loops` reads —
      // a brick is a part, the template is what a person runs.
      loops: loadCatalog({ projectRoot: state.root }).templates.size,
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

/**
 * The Loops page: the brick and template catalogue the `geneseed loop` CLI reads, resolved from
 * the install ROOT — for a project install that is the repo, where `<repo>/.geneseed/` lives; for
 * a global one it is the config dir, which has no `.geneseed/` and so adds nothing. Read-only:
 * the page draws templates and lists bricks, it never writes one.
 *
 * A template's graph is passed whole (`graph`) rather than flattened, because the page's ring
 * layout needs `nodes`, `edges` and `loops` exactly as the engine reads them.
 */
export function apiLoops(state) {
  const opts = { projectRoot: state.root };
  const catalog = loadCatalog(opts);
  const { bricks, templates, overridden } = catalog;
  const byName = ([a], [b]) => (a < b ? -1 : 1);
  return {
    templates: [...templates].sort(byName).map(([name, { origin, ...graph }]) => ({
      name, description: graph.description || '', origin, graph,
    })),
    bricks: [...bricks].sort(byName).map(([, b]) => ({ reason: null, ...b })),
    overridden,
    // A brick or template the catalogue skipped (bad frontmatter, not JSON, misnamed), and a
    // template that fails the graph rules: the page says so — the same list `loop check`
    // prints — or a team's broken override would just silently not be there.
    // The catalogue already loaded above, not a second read of every brick and template.
    problems: catalogProblems(opts, catalog),
  };
}

/**
 * The Active tab's read: every worktree `geneseed loop init` has registered, with its live
 * `LOOP.md` state re-read on every call (`activeLoops` itself, not a cached copy — the registry
 * stores identity only, see `js/loop/registry.mjs`). Takes no `state`-derived filtering: the
 * registry is machine-wide, not scoped to this install's root, so a loop launched from a
 * different project still shows up here.
 */
export function apiLoopsActive() {
  return { loops: activeLoops() };
}

/** The source's release label, or null when it cannot be read. */
function releaseLabel() {
  const v = sourceReleaseVersion({ config: CONFIG });
  return v && v !== '0.0.0' ? v : null;
}

