/**
 * The web console's dashboard and settings reads — `overview`, `recent`, `themes`, `setup`,
 * `doctor`, `diff`, `installs`, `fleet`, `update`, `excludes` and the two `loops` reads.
 *
 * WHAT IS NOT HERE, AND WHERE IT WENT: the Library read model (catalog sections, items, wiki,
 * memory, `NotFound`) is `catalog.mjs`; the `WebState` every endpoint reads from is `state.mjs`;
 * the fingerprint-guarded rules/profile editors are `user-files.mjs`; and the GET tables that
 * bind paths to these functions are `routes.mjs`. This file imports none of its route siblings,
 * which is what keeps the old `api ↔ actions` and `api ↔ activity` cycles from coming back.
 */
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { CONFIG, CREDIT_RE, ROOT, SRC, THEMES, discoverNames, loadKits, makeCfg, upstreamOf } from '../build/source.mjs';
import { readVersion, sourceFingerprint } from '../build/version.mjs';
import { sourceReleaseVersion } from '../hosts/opencode.mjs';
import { alwaysOnCost } from '../inspect/cost.mjs';
import { installProfile } from '../build/generate.mjs';
import { diffCollect, renderMemo } from '../inspect/diff.mjs';
import { excludesSnapshot } from '../inspect/excludes.mjs';
import { sessionStartSize } from '../hosts/hooks-context.mjs';
import { CLAUDE_STYLE, VERSION_MARKER } from '../hosts/hosts.mjs';
import { factCount } from '../hosts/memory-files.mjs';
import { autostartState } from '../hosts/shim.mjs';
import {
  footprintOfDir, gatesOfDir, installState, installTargets, modeOfDir,
  trustOfDir, sharedTierOfDir,
  postureOfDir, readJsonMaybe, readMaybe, themeOfDir,
} from '../hosts/installs.mjs';
import { PRESETS } from '../loop/score.mjs';
import { loadCatalog, catalogProblems } from '../loop/catalog.mjs';
import { activeLoops } from '../loop/registry.mjs';
import { EMIT_OPTIONS, themeOptions } from '../maintain/setup.mjs';
import { accentFor, keptKitFiles, statusData } from '../inspect/status.mjs';
import { writeTextAtomic } from '../lib/fs.mjs';
import { sharedPaths } from '../lib/machine-dir.mjs';
import { comparePaths } from '../lib/paths.mjs';
import {
  configItems, deployed, dget, fleetCounts, memoryDir, memoryItems, notebookItems, orSkip, tierOf, wikiItems,
} from './catalog.mjs';
import { defaultView, samePath, stampMinute, viewCfg } from './state.mjs';
import { MANUAL_UPDATE, gitBehind, installKind, updateStatus } from './update-check.mjs';

/**
 * `js/web/docs.mjs` imports these three from HERE, and that file is outside this split — so
 * they are re-exported rather than moved out from under it. New code imports `catalog.mjs`.
 */
export { NotFound, deployed, resolveLinks } from './catalog.mjs';

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

// Short: a user who fixes a problem and clicks Re-run must not be shown the old verdict for long.
const DOCTOR_COOLDOWN_MS = 3_000;

/**
 * The same engine as the `doctor` verb, grouped per check — served from the state's cached run
 * (a lens visit or a page mount no longer pays ~3.6 s), and re-run only when `fresh` is asked
 * for: the Doctor page's Re-run button, as `GET /api/doctor?fresh=1`.
 *
 * A fresh ask within `DOCTOR_COOLDOWN_MS` of the last one THIS PATH ran reuses that run, so a
 * page looping on `?fresh=1` cannot pin the event loop. `_doctorFreshAt` is written here only: a
 * verdict planted any other way still re-runs. No single-flight promise — `runDoctor` is
 * synchronous, so two fresh runs cannot overlap; only the warm-up is not (`warmDoctor`).
 *
 * This page needs the groups, so during the warm-up it answers with a promise of the verdict
 * rather than a pending one: the request waits, the event loop does not.
 */
export function apiDoctor(state, fresh = false) {
  if (fresh && Date.now() - (state._doctorFreshAt ?? 0) >= DOCTOR_COOLDOWN_MS) {
    state.runDoctor();
    state._doctorFreshAt = Date.now();
  }
  const answer = () => {
    const { ok, problems, checked_at } = state.doctor;
    return { ...state._doctorRun, ok, problems, checked_at };
  };
  return state._doctorJob === null ? answer() : state._doctorJob.then(answer);
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
    target: state.target, theme: state.theme, emit: state.emit, memo: memoOf(state) });
  return { deployed: deployed(state), diffable: files !== null, target, theme,
    files: files || [] };
}

/** The union across every global install, verbatim. */
export const apiExcludes = () => excludesSnapshot();

// `viewCfg` moved to `state.mjs`, which needs it to pick a default view and cannot import
// this module back (this one imports `stampMinute` from it).
export { viewCfg } from './state.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The last `n` UTC days ending today, oldest first, as 'YYYY-MM-DD' — the ledger charts' window. */
export const lastDays = (now, n = 30) => Array.from({ length: n }, (_, i) =>
  new Date(now - (n - 1 - i) * DAY_MS).toISOString().slice(0, 10));

/** `[host, scope, root, dir]` for each ACTIVE install in `targets` — where its ledgers live. */
export function* activeInstalls(targets) {
  for (const [host, scope, root] of targets) {
    if (installState(root, host, scope) === 'active') yield [host, scope, root, viewCfg(host, scope, root)];
  }
}

/**
 * The state's memo of `expected` renders, made on first use: overview and fleet diff the same
 * install on every refresh, and only the compare has to run again (see `renderMemo`).
 */
const memoOf = (state) => (state.renderMemo ??= renderMemo());

/**
 * The edited/added/missing tally of a `diffCollect` file list, and apart from it the `linked`
 * paths — the user's own links, which the console never adds into a drift total — and the
 * `stale` ones, unedited files a rebuild updates, which the console shows as "behind".
 */
const driftCounts = (files) => ({
  edited: files.filter((f) => f.status === 'edited').length,
  added: files.filter((f) => f.status === 'added').length,
  missing: files.filter((f) => f.status === 'missing').length,
  linked: files.filter((f) => f.status === 'linked').length,
  stale: files.filter((f) => f.status === 'stale').length,
});

/**
 * The fields every install row opens with, in this order. Theme is narrowed to this row's own
 * host (host-compat B1): a shared repo otherwise answers every row with whichever host's
 * carrier the host-agnostic scan favours.
 */
const installRowBase = (host, scope, root, state) => ({
  id: `${host}:${scope}:${root}`, host, scope, path: root, state,
  theme: themeOfDir(root, host),
  footprint: footprintOfDir(root),
  // Reads the machine's shared tier: its rules, profile and memory are the same on every row that
  // says so. The one field the console asks; `sharedTier` is only a project install's switch.
  shared: tierOf({ target: viewCfg(host, scope, root) }) !== null,
});

/** Move the daemon's own state to the default install `def`. A pinned view keeps the one it named. */
function followDefault(state, def) {
  if (def && state?.selectView && !state.pinned && !samePath(def[0], state.target)) state.selectView(...def);
}

/**
 * `POST /api/default-install`: `{host, path}` makes that install the default. Anything else is
 * refused (the 409 arm) and the stored pick stays: there is no clearing body, because
 * `readJsonBody` turns a malformed request into `{}`, and that must not erase a choice. The
 * pair is the VALUE here, so this route is no `VIEW_POSTS` row. It stores the detected root, not
 * the request's spelling of it. The daemon state moves here and not by `refresh`, which would
 * drop every install's cached doctor for a pick that changes none of them.
 */
export function apiDefaultInstallSet(state, body) {
  const { host, path: root } = body;
  const hit = typeof root === 'string' && root
    ? [...activeInstalls(installTargets())].find(([h, , r]) => h === host && samePath(r, root))
    : undefined;
  if (hit === undefined) return { ok: false, error: 'not an active install (host, path)' };
  const file = sharedPaths().defaultInstall;
  // The folder normally exists already, through the install registry. Created here, it does not
  // read as a tier: `tierOf` tests for the tier's memory store or a tier file, not the folder.
  mkdirSync(path.dirname(file), { recursive: true });
  writeTextAtomic(file, `${JSON.stringify({ host, path: String(hit[2]) }, null, 2)}\n`);
  followDefault(state, defaultView());
  return { ok: true };
}

/**
 * The row `id` carries the ROOT, not only `host:scope`: two project installs of one host (two
 * repos on Bob, say) are both `bob:project`, and the console keys its selection, its React rows
 * and its per-install picks on this id — with a shared one, both rows read as selected and every
 * pick resolved to whichever came first. `installTargets()` de-duplicates on (host, root), so
 * this is unique by construction.
 */
export function apiInstalls(state) {
  const out = [];
  const targets = installTargets();
  const def = defaultView(targets);
  // The row marked `default` must be the install an unnamed request reads, so the daemon state
  // follows the marker here, where the console reads it, rather than only on a full refresh.
  followDefault(state, def);
  for (const [host, scope, root] of targets) {
    out.push({
      ...installRowBase(host, scope, root, installState(root, host, scope)),
      posture: postureOfDir(root, host),
      mode: modeOfDir(root, host),
      trust: trustOfDir(root, host),
      // A project install's switch for reading the machine tier (a global install owns it).
      sharedTier: scope === 'global' ? false : sharedTierOfDir(root, host),
      // The install a request naming none reads (`defaultView`): the console's pickers start on it.
      default: !!def && samePath(viewCfg(host, scope, root), def[0]),
    });
  }
  return { installs: out, postures: discoverNames('postures', 'peer'),
    modes: discoverNames('modes', 'direct'), trusts: Object.keys(PRESETS) };
}


// How long a poll may serve `apiFleet`'s memo: a rule or profile write and a session's memory write
// call no `refresh`, so this is how late they show.
const FLEET_READS_MS = 30_000;

/**
 * EVERY INSTALLED HARNESS ON THE MACHINE, EACH JUDGED ON ITS OWN — the Overview's fleet table.
 *
 * Installed means `active` or `disabled`: a host with nothing installed is not listed, because
 * installing belongs to the Installs page with its other settings (user, 2026-10-13).
 *
 * Its own route, not more fields on `/api/installs`: the sidebar refetches that list on every
 * data revision, and the drift check below re-renders a whole emit per global install.
 * Each global install's `expected` render is memoised on the state (`renderMemo`, keyed on the
 * source fingerprint computed once per request and every axis), so a refresh re-runs only the
 * compare; the memo holds a handful of installs, enough for any machine seen so far.
 *
 * Each row reads ITS OWN `.geneseed-version`. `statusData().installed_fp` is the first carrier
 * a fixed walk finds, which describes the wrong install as soon as two hosts are deployed.
 * Every unknown stays `null` — `verdict: 'unknown'`, `drift: null` — never a reassuring zero.
 */
export function apiFleet(state, { now = Date.now() } = {}) {
  // Both reads render the session files, and an eager wiki walks a whole vault each time, so a poll
  // serves them from a memo. `refresh` clears it; `FLEET_READS_MS` bounds what no `refresh` reports.
  // `st` is in the key: an install switched off stops being measured at once.
  const reads = (host, scope, st, root, dir) => {
    const memo = (state._fleetReads ??= new Map());
    const key = JSON.stringify([host, scope, st, String(root)]);
    const hit = memo.get(key);
    if (hit && now - hit.at < FLEET_READS_MS) return hit;
    let sessionStart = null;
    if (st === 'active' && scope === 'global' && CLAUDE_STYLE.includes(host)) {
      try { sessionStart = sessionStartSize(dir, host); } catch { /* not measured, this round */ }
    }
    const fresh = { at: now, sessionStart, cost: alwaysOnCost({ host, root, dir, footprint: footprintOfDir(root) }) };
    memo.set(key, fresh);
    return fresh;
  };
  const sourceFp = sourceFingerprint(makeCfg());
  const installs = [];
  for (const [host, scope, root] of installTargets()) {
    const st = installState(root, host, scope);
    if (st !== 'active' && st !== 'disabled') continue;
    const dir = viewCfg(host, scope, root);
    const fp = readVersion(dir);
    let drift = null;
    if (st === 'active') {
      try {
        const { files } = diffCollect({ target: dir, memo: memoOf(state), sourceFp });
        if (files !== null) drift = driftCounts(files);
      } catch { /* an install that cannot be re-rendered reports no drift figure, not zero */ }
    }
    const builtMs = builtAt(dir);
    const built = builtMs === null ? null : Math.floor(builtMs / 1000);
    const { cost, sessionStart } = reads(host, scope, st, root, dir);
    const tier = tierOf({ target: dir });
    installs.push({
      ...installRowBase(host, scope, root, st),
      installed_fp: fp,
      verdict: fp === null ? 'unknown' : fp === sourceFp ? 'synced' : 'behind',
      // A project install has no drift check at all (`diffCollect` answers `files: null`), which
      // the console must say as "not checkable" — so the fact travels apart from the figure.
      diffable: drift !== null,
      drift,
      built_epoch: built,
      // Each install's own settings, on its row: the Overview has no viewed install to read them off.
      posture: postureOfDir(root, host),
      mode: modeOfDir(root, host),
      // Its memory facts: directory listings (`factCount`), no file read.
      facts: factCount(memoryDir({ target: dir }, tier)),
      // What this install injects every session, by part (characters); null when its carrier
      // is missing, so the console says "not measured" rather than drawing an empty bar.
      cost,
      // Its session-start hook against the budget. Global hook hosts only: the console has no
      // repo to add, a project install's size is that repo's, and OpenCode has no stdout cap.
      session_start: sessionStart,
    });
  }
  // `version` is the source's release label, the "Behind 4.19.0" a behind row names; the same
  // reader `/api/overview` uses, so the two never name different releases.
  return { installs, source_fp: sourceFp, doctor: state.doctor, version: releaseLabel() };
}

/**
 * When an install was built: its version marker's mtime in ms, or null. ONE rule for the Overview
 * and the fleet: every emit writes the marker, and a Claude-family install has no root `AGENT.md`.
 */
function builtAt(dir) {
  try { return statSync(path.join(dir, VERSION_MARKER)).mtimeMs; } catch { return null; }
}

/**
 * What Settings' Server panel says about the process answering it — built FIELD BY FIELD, never from the
 * daemon record, which holds the write token: a GET is readable by anything that passes the Host
 * check, and the token is the only guard on a POST. `started` is the process's own start (the
 * server is the process), in epoch seconds. `autostart` is THIS platform's login launcher,
 * `{file, state}` with state `absent`, `ours`, `stale` or `hand` (`autostartState`), so the row
 * can name the file its confirmation writes; null where the platform has none.
 */
function serverFacts() {
  return {
    pid: process.pid,
    started: Math.floor(Date.now() / 1000 - process.uptime()),
    autostart: autostartState(),
  };
}

/** Source files of a kit member: `<dir>/<name>.md`, or every `.md` in a `<dir>/<name>/` folder. */
function memberTexts(dir, name) {
  const one = readMaybe(path.join(SRC, dir, `${name}.md`));
  if (one !== null && one !== undefined) return [one];
  const d = path.join(SRC, dir, name);
  try { return readdirSync(d).filter((f) => f.endsWith('.md')).map((f) => readMaybe(path.join(d, f)) ?? ''); } catch { return []; }
}

/** Upstream credits cited by a kit's rules and member sources; an unknown key is skipped, never a 500. */
function kitCredits(m, rules) {
  const texts = [rules, ...(m.skills ?? []).flatMap((n) => memberTexts('skills', n)),
    ...(m.agents ?? []).flatMap((n) => memberTexts('agents', n))];
  const keys = new Set();
  for (const t of texts) for (const x of t.matchAll(CREDIT_RE)) keys.add(x[1]);
  const out = [];
  for (const key of [...keys].sort()) {
    let u;
    try { u = upstreamOf(key); } catch { u = null; }
    if (!u) continue;
    out.push({ key, repo: u.repo, author: u.author, license: u.license, commit: u.commit,
      compareUrl: `https://github.com/${u.repo}/compare/${u.commit}...HEAD` });
  }
  return out;
}

/**
 * EVERY INSTALL'S KITS — the Kits page. Its own route, like `apiFleet`: it re-reads each carrier
 * and the kit manifests, which the sidebar's `/api/installs` refetch must not pay for.
 *
 * `kits` per row is `installProfile(...).kits`, the reader `rebuild-all` uses, so the page shows
 * what a rebuild would keep. A malformed manifest answers 200 with `error` and EMPTY lists, never
 * rows without kits (which would read as "no kit on") and never a 500. `editable:false` carries
 * the two refusals `apiInstallCmd` makes, so the page can say why before the click.
 */
export function apiKits() {
  let known;
  try { known = loadKits(); } catch (e) {
    return { kits: [], installs: [], error: String(e?.message ?? e) };
  }
  const kits = [...known].map(([name, m]) => {
    const rules = readMaybe(path.join(SRC, 'kits', name, 'rules.md')) ?? '';
    return { name, description: m.description ?? '', skills: m.skills ?? [], agents: m.agents ?? [],
      rules, rulesWordBudget: m.rulesWordBudget ?? null, banned: m.banned ?? [],
      credits: kitCredits(m, rules) };
  });
  const installs = [];
  for (const [host, scope, root] of installTargets()) {
    const st = installState(root, host, scope);
    if (st === 'absent') continue;
    try {
      const p = installProfile(host, scope, root);
      const reason = st === 'disabled' ? 'install is disabled — reactivate it first' : null;
      installs.push({ ...installRowBase(host, scope, root, st), kits: p.kits,
        keptKitFiles: keptKitFiles(host, scope, root, p.kits), editable: reason === null, reason });
    } catch (e) {
      installs.push({ ...installRowBase(host, scope, root, 'unreadable'),
        error: String(e?.message ?? e) });
    }
  }
  return { kits, installs };
}

/**
 * Every count the console prints, over `fleet`: `fleetCounts`, plus the rail's Loops badge. That one
 * is templates only (a brick is a part, the template is what a person runs), from the catalogue
 * `/api/loops` reads, and the union across installs, where its page lists the picked install's.
 */
export function machineCounts(state, fleet) {
  const templates = (v) => [...loadCatalog({ projectRoot: v.state.root }).templates.keys()];
  return { ...fleetCounts(state, fleet),
    loops: new Set(fleet.flatMap((v) => orSkip(v, () => templates(v)))).size };
}

// How long `machineCounts` may serve a read: the overview is asked every 1.5 s while the doctor
// warms. A mutation drops it (`refreshOwn`); this bounds what a session writes behind the console.
const COUNTS_MS = 5_000;

/** `machineCounts` over `fleet()`, memoised on the daemon's state `base`. */
export function memoCounts(base, fleet, now = Date.now()) {
  const hit = base._counts;
  if (hit && now - hit.at < COUNTS_MS) return hit.counts;
  const counts = machineCounts(base, fleet());
  base._counts = { at: now, counts };
  return counts;
}

/**
 * The dashboard aggregate. One install's facts, but its `counts` are the machine's (`memoCounts`):
 * every install, deduped, the same answer whichever install asks. They default to `state` alone.
 * A pinned view runs no doctor: its one reader wants its `install`, and a cold run blocks the request
 * for seconds. It serves the verdict it holds, or null.
 */
export function apiOverview(state, counts = machineCounts(state, [{ install: null, state }])) {
  let diff = null;
  if (deployed(state)) {
    const { files } = diffCollect({
      target: state.target, theme: state.theme, emit: state.emit, memo: memoOf(state) });
    if (files !== null) diff = driftCounts(files);
  }
  let buildTime = null;
  // The SAME mtime twice, on purpose. `build_time` is the stamp a person reads; `build_epoch`
  // is the number a relative label ("20h") is computed from. The console used to have only the
  // first and had to re-parse it, and `Date.parse` on a space-separated local stamp is
  // engine-dependent — a plausible-but-wrong "2h" is the exact failure a second field costs
  // nothing to prevent.
  let buildEpoch = null;
  const ms = builtAt(state.target);
  if (ms !== null) {
    buildTime = stampMinute(ms);
    buildEpoch = Math.floor(ms / 1000);
  }
  // Which detected install the current view points at, so the dashboard's footprint hero
  // can re-emit exactly it.
  let install = null;
  for (const [host, scope, root] of installTargets()) {
    try {
      if (samePath(viewCfg(host, scope, root), state.target)) {
        // `deletionGate`/`secretsGate`/`doneGate`/`testNote`/`ownershipGate`/`externalGate`: the gate
        // switches, for the Constitution page's toggles on rows IV, I, III, VIII, inside the Credo's
        // Ownership row and inside doctrine rigor 5's row.
        install = { host, scope, path: root, footprint: footprintOfDir(root),
          ...gatesOfDir(root, host) };
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
    server: serverFacts(),
    counts,
    doctor: state.pinned ? state._doctor : state.doctor,
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
 * It exists
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
  /** @type {Array<[string, string, () => any[]]>} */
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
  /** @type {(x: [string, any], y: [string, any]) => number} */
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

/**
 * Is a newer release on npm than the source this console serves, and how would this copy take
 * it? See update-check.mjs.
 *
 * `install` picks the Update route (`git`, `npm-global`, `other`); `git` is kept beside it for a
 * console bundle older than the field. `behind` is a clone's own "up to date": commits upstream
 * holds that it does not, null when unknown — a clone can always try to pull, since `main` moves
 * between releases and a work proxy can leave the release check unanswered — and false when the
 * update job would refuse: local changes, no upstream, a detached HEAD, a diverged branch.
 * `checking` covers both asks, so a slow fetch reads as "checking…", not as a settled unknown.
 * `command` is what to run by hand when the console cannot update this copy itself.
 */
export function apiUpdate(state) {
  const install = installKind();
  const status = updateStatus(state, releaseLabel());
  const behind = install === 'git' ? gitBehind(state, { busy: Boolean(state.jobBusy?.()) }) : null;
  return {
    ...status,
    checking: status.checking || Boolean(state._behind?.inflight),
    install,
    git: install === 'git',
    behind,
    command: install === 'other' ? MANUAL_UPDATE : null,
  };
}

/** The source's release label, or null when it cannot be read. */
function releaseLabel() {
  const v = sourceReleaseVersion({ config: CONFIG });
  return v && v !== '0.0.0' ? v : null;
}

