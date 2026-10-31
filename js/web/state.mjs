/**
 * `WebState` — the resolved view of the deployed harness every endpoint reads from.
 *
 * Its own module so that `daemon.mjs`, which needs only `webState(theme).target`, does not load
 * every read endpoint to get it (it imported all of `api.mjs` for this one factory). It still
 * reaches `catalog.mjs`, for the inventory it caches.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

import { CLAUDE_STYLE, GLOBAL_MANIFEST, HOSTS, opencodeConfigDir } from '../hosts/hosts.mjs';
import {
  EMIT_HOST_SCOPE, footprintOfDir, installState, installTargets, installedDefaults, modeOfDir,
  postureOfDir, themeOfDir, trustOfDir,
} from '../hosts/installs.mjs';
import { doctorCollect } from '../inspect/doctor.mjs';
import { DEFAULT_PRESET } from '../loop/score.mjs';
import { readText, isFile } from '../lib/fs.mjs';
import { stripWhitespace } from '../lib/text.mjs';
import { inventoryFor } from './catalog.mjs';

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

/**
 * `[target, root]` for the install the console should show when nothing picked one, or null
 * when the current target is already deployed or nothing is.
 *
 * The console used to open on the OpenCode global dir unconditionally. On a machine with only
 * IBM Bob (reported 2026-10) nothing is deployed there, so Overview showed the onboarding form
 * over a perfectly good `~/.bob`, and the selector that could re-point it hides itself below two
 * installs. So when `current` holds no manifest, the first ACTIVE install `installTargets`
 * finds is shown instead — a global before a project, in its host order.
 */
export function fallbackView(current, targets = installTargets()) {
  if (existsSync(path.join(current, GLOBAL_MANIFEST))) return null;
  const active = targets.filter(([host, scope, root]) => {
    try { return installState(root, host, scope) === 'active'; } catch { return false; }
  });
  const pick = active.find(([, scope]) => scope === 'global') || active[0];
  return pick ? [viewCfg(...pick), pick[2]] : null;
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
 * and the console GETs `/api/overview` on mount and again after every mutation, so an
 * uncached `doctor` would put a full build on each of those requests. `refresh()` is what a mutation calls to
 * drop both — except where the mutation cannot change anything the doctor reads (the checkout,
 * the hook shim, the hook shell, the OpenCode config dirs, the deployed install): a memory
 * delete passes `{ doctor: false }` and keeps the ~3.6 s verdict. Rule and profile writes do not
 * call `refresh()` at all. Every other caller keeps the default, so a new one is slow, never stale.
 *
 * A request may name another install (`installView` in actions.mjs): that one gets its OWN
 * state, made by this factory, cached in `_views` and `pinned`, so the caching above holds per
 * install. `refresh()` on the daemon's state reaches every view.
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
    trust: null,
    _inv: null,
    _doctor: null,
    // The Doctor page's per-check cards and theme list, from the SAME run as `_doctor` — kept
    // beside it rather than inside so `/api/overview` (fetched after every mutation) does not
    // carry every group.
    _doctorRun: null,
    // `diffCollect`'s memo of `expected` renders, made on first use by `api.mjs` (`memoOf`);
    // it re-renders on its own key change, so `refresh()` leaves it alone.
    renderMemo: null,
    // True for a per-install view (`installView` in actions.mjs): `refresh` must never re-point
    // it at another install, since the request named THIS one.
    pinned: false,
    // The per-install views made off this daemon's state, keyed `[host, root]` — see
    // `installView`. Kept here, not at module level, so each handler (each test's) has its own.
    _views: new Map(),
  };
  // The INSTALL ROOT (== build --out). For globals it IS the data dir; a claude/bob/openclaude
  // PROJECT install keeps its data under <repo>/.claude|.bob|.openclaude while the markers
  // land at <repo>/.
  st.root = st.target;
  st.theme = theme || themeOfDir(st.target) || 'neutral';
  st.emit = installedDefaults().emit || 'opencode-global';
  // `st.emit` to `host`, the same lookup `apiInstallCmd`/`diffCollect` already make off the
  // same map — unknown or missing falls back to OpenCode, as those two do.
  const hostOf = () => (EMIT_HOST_SCOPE.get(st.emit || '') ?? ['opencode', 'global'])[0];
  // The install's sigils, each defaulted when its marker is absent (footprint to 'full').
  // Read from the ROOT, where every emit writes them. `host`, when given, narrows the carrier
  // scan to its own (host-compat B1) — omitted here at construction, where `st.emit` is only
  // `installedDefaults()`'s best guess and may not be THIS target's own host; `selectView`
  // and `refresh` below pass it once `detectEmit()` has looked at this install directly.
  const readMarkers = (host = null) => {
    st.footprint = footprintOfDir(st.root);
    st.posture = postureOfDir(st.root, host) || 'peer';
    st.mode = modeOfDir(st.root, host) || 'direct';
    st.trust = trustOfDir(st.root, host) || DEFAULT_PRESET;
  };
  readMarkers();

  Object.defineProperty(st, 'inventory', {
    get() {
      if (st._inv === null) st._inv = inventoryFor(st);
      return st._inv;
    },
  });
  Object.defineProperty(st, 'doctor', {
    get() {
      if (st._doctor === null) st.runDoctor();
      return st._doctor;
    },
  });
  /** One fresh doctor run, cached whole: the verdict and the grouped detail of the same run. */
  st.runDoctor = () => {
    const groups = [];
    const [themes, problems] = doctorCollect({ theme: st.theme, groups });
    st.stampDoctor(problems, themes, groups);
  };
  st.stampDoctor = (problems, themes = [], groups = []) => {
    st._doctor = { ok: !problems.length, problems, checked_at: stampMinute(Date.now()) };
    st._doctorRun = { themes, groups };
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
   * `root` is the install ROOT the markers live at. It defaults to `target` and differs only
   * for claude/bob/openclaude PROJECT installs, where the data sits under
   * `<repo>/.claude|.bob|.openclaude` while `.geneseed-emit`/`-theme`/`-footprint` land at
   * `<repo>/` — reading them from the data dir mis-detects the install as opencode/neutral,
   * and a Diff or a Restore would then overwrite it in the wrong dialect. The theme/posture/mode
   * SIGILS are different: for claude/bob they live in the ROOT carrier (`themeOfDir` scans it);
   * for openclaude they live ONLY in the data dir's nested `.openclaude/CLAUDE.md`, since its
   * root carrier is deliberately left untouched (host-compat B1/I1).
   */
  st.selectView = (target, root = null) => {
    st.target = target;
    st.root = root || target;
    st.emit = st.detectEmit();
    const host = hostOf();
    st.theme = themeOfDir(st.root, host) || themeOfDir(st.target, host) || 'neutral';
    readMarkers(host);
    st._inv = null;
    st._doctor = null;
  };
  /** This state alone. `refresh` below is what callers use: it also reaches every view. */
  st.refreshOwn = ({ doctor = true } = {}) => {
    // A job may have deployed the first install while the view still points at an empty
    // default (the onboarding Build), or removed the one in view: follow it to one that exists.
    // Only on a full refresh: `{ doctor: false }` marks a mutation that cannot change installs.
    // Never for a pinned view: it answers for the install its request named, or is refused.
    const fallback = doctor && !st.pinned ? fallbackView(st.target) : null;
    if (fallback) { st.selectView(...fallback); return; }
    st._inv = null;
    if (doctor) st._doctor = null;
    st.emit = st.detectEmit() || st.emit;
    const host = hostOf();
    st.theme = themeOfDir(st.root, host) || themeOfDir(st.target, host) || st.theme;
    readMarkers(host);
  };
  /**
   * After a mutation, this state AND every per-install view made off it: a job or a write
   * through one view can change what any other one reads (the same install, seen twice).
   */
  st.refresh = (opts = {}) => {
    st.refreshOwn(opts);
    for (const v of st._views.values()) v.refreshOwn(opts);
  };
  return st;
}

/**
 * Run the doctor once in the background, right after the server binds, so the first
 * `/api/overview` finds a verdict instead of paying the ~3.6 s itself. Still synchronous once it
 * starts — the event loop is blocked for that run — so a request landing mid-run waits for it,
 * no longer than it would have. The catch is not optional: a throw inside `setImmediate` is
 * uncaught and would kill the daemon; a failed warm-up just leaves the cache cold.
 */
export function warmDoctor(st) {
  setImmediate(() => {
    try { if (st._doctor === null) st.runDoctor(); } catch { /* cold cache, computed on demand */ }
  });
}
