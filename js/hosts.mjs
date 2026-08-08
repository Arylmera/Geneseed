/**
 * The four host config dirs, and the two path primitives they are built on.
 *
 * EXTRACTED IN P5c, and the reason is arithmetic rather than taste. `bin/geneseed.mjs`
 * owned these; `bin/geneseed-cli.mjs` needs the same four to find a global install, and a
 * resolver that decides WHERE a driver writes is the last thing that should exist twice.
 * `js/hooks.mjs` carries a third copy of `opencodeConfigDir` on purpose — the hook path is
 * deliberately dependency-free and says so — but the CLI has no such reason, so this is one
 * owner for both drivers rather than a second exception.
 *
 * The move is a pure one, which is why it could be made at all: `tests/golden.py` runs
 * `bin/geneseed.mjs` over 259 cells and compares the tree byte-for-byte, and roughly half
 * of those resolve a global config dir. A move that changed one of these by a character
 * fails ~126 cells, not zero.
 */
import { realpathSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** `_build_global.GLOBAL_MANIFEST` — the file whose presence means "a global install". */
export const GLOBAL_MANIFEST = '.geneseed-manifest.json';

/**
 * `Path.expanduser()` — a LEADING `~` only, and `~` alone counts.
 *
 * Deliberately not a general tilde expansion: Python does not expand `~user` on Windows the
 * way a shell would, and every caller here feeds it a config-dir env var.
 */
export function expanduser(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/**
 * `Path.resolve()` — absolute, symlinks followed, and the filesystem's OWN casing.
 *
 * `path.resolve` does none of the last two and `realpathSync` THROWS on a path that does not
 * exist yet, which is the normal case here: the first `--emit opencode-global` on a machine
 * resolves a config dir nobody has created. Python's `resolve(strict=False)` canonicalises
 * the part that exists and appends the rest verbatim, so that is what this reproduces.
 * It matters because the resolved directory is printed on stdout and compared byte-for-byte.
 */
export function pyResolve(p) {
  let cur = path.resolve(expanduser(p));
  const tail = [];
  for (;;) {
    try {
      return tail.length ? path.join(realpathSync.native(cur), ...tail) : realpathSync.native(cur);
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return path.resolve(expanduser(p));  // nothing on this path exists
      tail.unshift(path.basename(cur));
      cur = parent;
    }
  }
}

/**
 * `_build_core._opencode_config_dir` — and the four resolvers like it are the reason
 * `bin/geneseed.mjs` exists rather than a child doing the work.
 *
 * P3c's rule was "the child must never resolve this": a render child that did would write
 * 135 files into the developer's real `~/.config/opencode`. A driver is the PARENT, so the
 * rule inverts — resolving it there is exactly the job. Precedence is the env var (which
 * relocates the whole dir), then `$XDG_CONFIG_HOME/opencode`, then `~/.config/opencode`.
 */
export function opencodeConfigDir() {
  const env = process.env.OPENCODE_CONFIG_DIR;
  if (env) return pyResolve(env);
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg ? expanduser(xdg) : path.join(os.homedir(), '.config');
  return pyResolve(path.join(base, 'opencode'));
}

/**
 * `_build_core._copilot_config_dir` — `~/.copilot`, relocatable via `$COPILOT_CONFIG_DIR`.
 *
 * Geneseed's own knob, mirroring `$BOB_CONFIG_DIR`: Copilot documents no such variable, but
 * tests, doctor and locked-down setups still need to re-point the target. Like every
 * relocation variable it is CLEARED by `golden.cell_env`, so no cell can observe whether
 * a driver honours it — see `test_the_relocation_var_moves_the_global_target`.
 */
export function copilotConfigDir() {
  const env = process.env.COPILOT_CONFIG_DIR;
  if (env) return pyResolve(env);
  return pyResolve(path.join(os.homedir(), '.copilot'));
}

/**
 * `_build_core._claude_config_dir` — `~/.claude`, and there is NO env branch BY DESIGN.
 *
 * Its three siblings all check a `*_CONFIG_DIR` variable first; this one does not, because
 * Claude Code documents none and inventing one here would make the two CLIs disagree about
 * where a global install lives. The absence is the specification, so it is asserted rather
 * than merely not implemented — `test_every_relocation_var_moves_its_global_target` carries
 * an INVERSE row for this host: setting `$CLAUDE_CONFIG_DIR` must NOT move the target.
 * Without that row the table could only say "no cell covers Claude", which reads the same
 * as an omission.
 */
export function claudeConfigDir() {
  return pyResolve(path.join(os.homedir(), '.claude'));
}

/** `_build_core._bob_config_dir` — `~/.bob`, relocatable via `$BOB_CONFIG_DIR`. */
export function bobConfigDir() {
  const env = process.env.BOB_CONFIG_DIR;
  if (env) return pyResolve(env);
  return pyResolve(path.join(os.homedir(), '.bob'));
}

/**
 * `_build_global.HOSTS`, reduced to the one column a non-emitting caller needs, and IN ITS
 * ORDER — opencode, claude, bob, copilot.
 *
 * An array rather than an object because the order is observable output, not an
 * implementation detail: `harness exclude add` walks it and prints one message per host, so
 * a reordering is a diff in stderr. (The rest of the registry — `emit_global`,
 * `native_catalog`, `project_marker` — stays Python; `bin/geneseed.mjs` receives those
 * decisions from its own dispatch rather than reading a table.)
 */
export const HOSTS = [
  { host: 'opencode', configDir: opencodeConfigDir },
  { host: 'claude', configDir: claudeConfigDir },
  { host: 'bob', configDir: bobConfigDir },
  { host: 'copilot', configDir: copilotConfigDir },
];
