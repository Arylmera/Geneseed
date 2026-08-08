/**
 * The checkout this code is running FROM — `_build_core`'s ROOT and the paths under it,
 * plus the `cfg` every render needs.
 *
 * The inverse of `js/hosts.mjs`. That module answers "where does the output go"; this one
 * answers "where is the source". Both were `bin/geneseed.mjs`'s, and both leave it for the
 * same arithmetic reason: `bin/geneseed-cli.mjs` needs them too, and the value that decides
 * which tree gets rendered is the last thing that should exist twice.
 *
 * WHY A NON-EMITTING VERB NEEDS A cfg AT ALL. `harness status` counts agents, skills and
 * laws, and it counts them by RENDERING — `_status_data` -> `_tui_inventory(theme)` ->
 * `build.render_all(theme)`. So the CLI has to build the same `cfg` the driver builds, and
 * until this move only the driver could.
 *
 * THE TWO ABSENT KEYS ARE STILL ABSENT, and the reason is bin/geneseed.mjs's, unchanged:
 * `_build_core.js_cfg()` always sends `structure` and `capabilityLinkRe` because the Python
 * originals are module-level names TESTS MUTATE (`_OWNED` membership asked one level out).
 * A Node process has no Python module to mutate, so it sends neither and
 * `js/render.mjs`'s `cfg.structure ?? STRUCTURE` takes its right-hand branch.
 *
 * The move is safe for the reason P5c's was: `tests/golden.py` drives `bin/geneseed.mjs`
 * over 259 cells and compares the tree byte-for-byte, and every one of them builds a cfg
 * from these paths. A depth error or a renamed key fails 259 cells, not zero.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `_build_core.ROOT` — the checkout, from this file's own location (`js/..`).
 *
 * NOT redirectable, and that is a property rather than a gap. The Python side is
 * `Path(__file__).resolve().parent` with every path under it derived at import; the
 * `_OWNED` redirect the suite uses is an in-process write, and no env var moves it
 * (`$GENESEED_ROOT` is `harness context`'s doc-discovery root — a different name for a
 * different job). Both implementations therefore answer from their own file's location,
 * which is what makes them comparable and what makes them unfenceable. See the
 * status/version section of `tests/harness_golden.py`.
 */
export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const SRC = path.join(ROOT, 'src');
export const CONFIG = path.join(ROOT, 'harness.config.json');
export const THEMES = path.join(ROOT, 'themes');
export const PLUGIN_SRC = path.join(ROOT, 'adapters', 'opencode', 'plugins');
export const WORKFLOW_SRC = path.join(ROOT, 'adapters', 'opencode', 'workflows');

/**
 * `_build_core.js_cfg()`, originated rather than received.
 *
 * `posture` and `mode` are `_build_core`'s module defaults (`peer` / `direct`) unless a
 * caller overrides them. `build.py`'s `main()` sets them from its flags; `rituals/harness.py`
 * never touches them, so every harness verb that renders renders at the defaults.
 */
export function makeCfg({ posture = 'peer', mode = 'direct' } = {}) {
  return {
    root: ROOT,
    src: SRC,
    themes: THEMES,
    config: CONFIG,
    colorThemes: path.join(THEMES, 'opencode'),
    pluginSrc: PLUGIN_SRC,
    workflowSrc: WORKFLOW_SRC,
    posture,
    mode,
  };
}
