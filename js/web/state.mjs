/**
 * `WebState` — the resolved view of the deployed harness every endpoint reads from.
 *
 * Its own module so that `daemon.mjs`, which needs only `webState(theme).target`, does not load
 * every read endpoint to get it (it imported all of `api.mjs` for this one factory). It still
 * reaches `catalog.mjs`, for the inventory it caches.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

import { opencodeConfigDir } from '../hosts/hosts.mjs';
import {
  EMIT_HOST_SCOPE, footprintOfDir, installedDefaults, modeOfDir, postureOfDir, themeOfDir,
  trustOfDir,
} from '../hosts/installs.mjs';
import { doctorCollect } from '../inspect/doctor.mjs';
import { DEFAULT_PRESET } from '../loop/score.mjs';
import { readText, isFile } from '../lib/fs.mjs';
import { stripWhitespace } from '../lib/text.mjs';
import { inventoryFor } from './catalog.mjs';

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
    trust: null,
    _inv: null,
    _doctor: null,
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
  st.refresh = () => {
    st._inv = null;
    st._doctor = null;
    st.emit = st.detectEmit() || st.emit;
    const host = hostOf();
    st.theme = themeOfDir(st.root, host) || themeOfDir(st.target, host) || st.theme;
    readMarkers(host);
  };
  return st;
}
