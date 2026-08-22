/**
 * `geneseed migrate` — move a machine from the git-checkout install shape to the npm one.
 *
 * P10d, AND IT IS NOT A PORT. Every other module here reproduces a Python original byte for
 * byte; this verb is new behaviour on both sides, written twice in the same change so that
 * `tests/harness_golden.py` — a CROSS-IMPLEMENTATION gate — has a reference side at all. A
 * Node-only verb would have nothing to compare against, and `test_every_entry_verb_is_a_real_
 * harness_subcommand` plus `test_the_matrix_covers_every_verb_it_claims` would both fail it.
 *
 * WHAT IT IS NOT: `rebuild-all`. That was the first answer and it was checked before being
 * discarded, because the re-emit really is the same engine and is reused rather than rewritten
 * here. Four behaviours differ, and each is a cell:
 *
 *   | an unknown emit marker | rebuild-all COERCES it to a default | migrate REFUSES         |
 *   | a failing root         | continues, exit 1                   | ROLLS BACK all, exit 1  |
 *   | an already-done machine| re-emits everything                 | no-op, writes NOTHING   |
 *   | stale autostart        | not its subject                     | surveyed and REPORTED   |
 *
 * Coercing an unrecognised marker is right for a rebuild and is *guessing what the user
 * installed* for a migration. Continuing past a failure is right for a rebuild — one broken
 * install must not block the rest — and for a migration it is the half-migrated machine the
 * whole verb exists to prevent.
 *
 * THE TWO TRIGGERS, AND WHY IT TAKES BOTH. Work is needed when the machine's wiring is
 * `legacy` (see `migrateShape` — and note that shapes 2 and 3 differ only inside the shim
 * body, never in the settings file) OR when the stamp does not name this ROOT. Neither alone
 * is enough: an OpenCode-only machine wires no hooks at all, so its shape is permanently
 * `none` and a shape-only trigger would re-emit it on every run forever; and a user who
 * reinstalls the old Python build flips the shape back to `legacy` while the stamp still
 * matches, which must migrate again. Both inputs, and the stamp is written only on success.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { main as driverMain } from '../../bin/build-driver.mjs';
import { ROOT } from '../build/source.mjs';
import {
  EMIT_HOST_SCOPE, defaultMode, defaultPosture, defaultTheme, doctrinesForBuild,
  footprintOfDir, installState, installTargets, modeOfDir, postureOfDir, readMaybe, themeOfDir,
} from '../hosts/installs.mjs';
import { DEFAULT_EMIT, setupBuildArgs } from '../build/generate.mjs';
import {
  autostartPaths, autostartStale, hookShimPath, migrateShape, readJsonc, shimHome,
} from '../hosts/settings.mjs';
import { writeText, pyPrint, pyPrintErr } from '../lib/fs.mjs';

/** Every emit name the generator answers to — the set an unrecognised marker is NOT in. */
const KNOWN_EMITS = new Set(EMIT_HOST_SCOPE.keys());

/**
 * The settings file a host wires hooks into, or null for a host that has none.
 *
 * Only Claude and Bob carry hook commands. OpenCode's hooks are a PLUGIN (`js/opencode.mjs`
 * emits JS that runs in the host's own process and names neither the shim nor `harness.py`),
 * and Copilot has no hook mechanism at all. So those two classify as `none` and their whole
 * migration is the re-emit — which is the same re-emit, in the same change, on all three
 * hosts, which is what the project's host-parity rule asks for.
 */
function hookSettingsFile(root, host, scope) {
  if (host !== 'claude' && host !== 'bob') return null;
  const name = scope === 'project' && host !== 'bob' ? 'settings.local.json' : 'settings.json';
  return path.join(root, name);
}

/** Every hook command string in a settings file, or [] when it cannot be read or parsed. */
export function hookCommandsOf(file) {
  // `readJsonc`, NOT `JSON.parse`. A hand-edited settings.json with comments and a trailing
  // comma is the one shape no machine in this project writes, and strict JSON rejects it —
  // which would classify a wired install as `none` and make `migrate` skip the machine
  // silently. `mergeClaudeSettings` already reads through comments for exactly this reason.
  // Found by the JSONC corpus fixture; a generated fixture would have hidden it.
  let loaded;
  try { [loaded] = readJsonc(readFileSync(file, 'utf8')); } catch { return []; }
  if (!loaded || typeof loaded !== 'object') return [];
  const hooks = loaded.hooks;
  if (!hooks || typeof hooks !== 'object') return [];
  const out = [];
  for (const groups of Object.values(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const g of groups) {
      for (const h of (g && Array.isArray(g.hooks) ? g.hooks : [])) {
        if (h && typeof h.command === 'string') out.push(h.command);
      }
    }
  }
  return out;
}

/** `<GENESEED_HOME>/.migrated` — the ROOT the last successful migration installed from. */
export function stampPath() { return path.join(shimHome(), '.migrated'); }

/** Where the pre-migration copies live while the re-emit runs. */
function stashDir() { return path.join(shimHome(), '.migrate-backup'); }

/**
 * Step 1 — classify, WITHOUT touching anything.
 *
 * A refusal that happens here is free: nothing has been written, so "refuse and report" needs
 * no rollback. That ordering is the cheapest atomicity there is and it is why the survey is a
 * separate pass rather than a check inside the loop.
 */
export function migrateSurvey() {
  const rows = [];
  const commands = [];
  const unrecognised = [];
  for (const [host, scope, root] of installTargets()) {
    if (installState(root, host, scope) !== 'active') continue;
    const raw = readMaybe(path.join(root, '.geneseed-emit'));
    const marker = raw === null ? '' : raw.trim();
    // An unrecognised marker is a REFUSAL, not a default. `rebuild-all` coerces here.
    if (marker && !KNOWN_EMITS.has(marker)) {
      unrecognised.push({ host, scope, root, marker });
      continue;
    }
    const file = hookSettingsFile(root, host, scope);
    if (file) commands.push(...hookCommandsOf(file));
    rows.push({ host, scope, root, marker, file });
  }
  let shimBody = '';
  try { shimBody = readFileSync(hookShimPath(), 'utf8'); } catch { /* no shim yet */ }
  const shape = migrateShape(commands, shimBody);
  const stamped = (readMaybe(stampPath()) || '').trim();
  // THE TRIGGER IS THE STAMP, AND THE SHAPE IS REPORTED — the first draft had it the other
  // way round and the ref-vs-ref self-check killed it in one run. `shape === 'legacy'` cannot
  // be a trigger, because what "current" MEANS is "the shim body names the .mjs entry", and
  // the Python implementation bakes python + harness.py by design (`_hook_runner_entry`). So
  // a migration run from the reference can never reach `current`, its second run would
  // re-emit forever, and the two implementations would diverge on idempotence by
  // construction. The stamp is a value both sides write and read identically.
  return { rows, unrecognised, shape, stamped, needed: stamped !== ROOT };
}

/** Hand-written login entries that still name some other checkout. Reported, never rewritten. */
function autostartFindings() {
  const out = [];
  for (const p of autostartPaths()) {
    const text = readMaybe(p);
    if (text !== null && autostartStale(text, ROOT)) out.push(p);
  }
  return out;
}

/** A stash key that cannot collide across drives, and is a legal file name on both platforms. */
const stashKey = (p) => p.replace(/[\\/:]/g, '_');

export function cmdMigrate(args = {}) {
  const dryRun = Boolean(args.dryRun);
  const { rows, unrecognised, shape, needed } = migrateSurvey();

  if (unrecognised.length) {
    // Refuse the WHOLE run. A migration that skipped the row it did not understand and
    // migrated the rest is the half-migrated machine this verb exists to prevent.
    pyPrintErr('[migrate] REFUSED — unrecognised install marker(s):\n');
    for (const u of unrecognised) {
      pyPrintErr(`[migrate]   ${u.host}:${u.scope} (${u.root}) has .geneseed-emit `
        + `'${u.marker}', which is not an emit this generator answers to.\n`);
    }
    pyPrintErr('[migrate] Nothing was changed. Fix or delete the marker, then re-run.\n');
    return 3;
  }

  if (!rows.length) {
    pyPrint('[migrate] no active installs detected.\n');
    return 0;
  }

  if (!needed) {
    pyPrint(`[migrate] already on the npm shape (${rows.length} install(s)); nothing to do.\n`);
    return 0;
  }

  pyPrint(`[migrate] ${rows.length} install(s), wiring shape: ${shape}\n`);
  if (dryRun) {
    for (const r of rows) {
      pyPrint(`[migrate] would re-emit ${r.host}:${r.scope} (${r.root})\n`);
    }
    for (const p of autostartFindings()) {
      pyPrint(`[migrate] would report the autostart entry at ${p}\n`);
    }
    pyPrint('[migrate] --dry-run: nothing was written.\n');
    return 0;
  }

  // Step 2 — stash every file the re-emit can touch, so step 4 can put it all back.
  const stash = stashDir();
  const saved = [];
  try {
    rmSync(stash, { recursive: true, force: true });
    mkdirSync(stash, { recursive: true });
    const shim = hookShimPath();
    for (const p of [...rows.map((r) => r.file).filter(Boolean), shim]) {
      if (!existsSync(p)) continue;
      const dest = path.join(stash, stashKey(p));
      copyFileSync(p, dest);
      saved.push([p, dest]);
    }
  } catch (e) {
    pyPrintErr(`[migrate] could not stage a backup (${e.message}); nothing was changed.\n`);
    return 1;
  }

  const restore = () => {
    for (const [orig, dest] of saved) {
      try { copyFileSync(dest, orig); } catch { /* best effort — report below regardless */ }
    }
    try { rmSync(stash, { recursive: true, force: true }); } catch { /* nothing to undo */ }
  };

  // Step 3 — re-emit, in each install's OWN six values. Same reads as `cmdRebuildAll`, and
  // the pack selection is the sixth: leaving it out re-emitted a narrowed install at whatever
  // `harness.config.json` said, which WIDENS a constitution its owner had cut down (and, the
  // other way, can strip the consent gate). `null` — a pre-marker carrier, which on a MIGRATION
  // is the common case and not the rare one — resolves to ALL packs through
  // `doctrinesForBuild`, never to `harness.config.json`, which is what makes it fail-closed.
  for (const r of rows) {
    const marker = r.marker && (EMIT_HOST_SCOPE.get(r.marker) ?? ['', ''])[0] === r.host
      ? r.marker : '';
    const emit = marker || DEFAULT_EMIT.get(`${r.host} ${r.scope}`) || 'opencode-global';
    const theme = themeOfDir(r.root) || defaultTheme();
    const out = r.scope === 'global' ? null : r.root;
    const argv = setupBuildArgs(theme, emit, out, out, footprintOfDir(r.root),
      postureOfDir(r.root) || defaultPosture(), modeOfDir(r.root) || defaultMode(),
      doctrinesForBuild(r.root));
    const label = `${r.host}:${r.scope} (${r.root})`;
    pyPrint(`[migrate] re-emitting ${label}: theme=${theme} emit=${emit}\n`);
    let rc = 1;
    try { rc = driverMain(argv); } catch { rc = 1; }
    if (rc !== 0) {
      // Step 4 — ALL OR NOTHING. `rebuild-all` continues here on purpose; a migration
      // must not, or the machine is left half on each shape.
      pyPrintErr(`[migrate] FAILED ${label} (exit ${rc}) — rolling back.\n`);
      restore();
      pyPrintErr(`[migrate] rolled back ${saved.length} file(s); the install is unchanged.\n`);
      return 1;
    }
  }

  try { rmSync(stash, { recursive: true, force: true }); } catch { /* nothing to undo */ }
  try {
    mkdirSync(path.dirname(stampPath()), { recursive: true });
    writeText(stampPath(), `${ROOT}\n`);
  } catch { /* an unwritable stamp costs a redundant re-emit next run, never correctness */ }

  pyPrint(`[migrate] migrated ${rows.length} install(s).\n`);

  // Step 5 — what could NOT be fixed automatically. Reported, never rewritten: nothing in
  // this repository has ever written an autostart entry, so migrate does not own the file.
  // The `start` ACTION is load-bearing, not decoration: bare `web` runs `serve()` in the
  // FOREGROUND with `daemon=false`, which never writes the daemon record, so `web stop`,
  // `web restart` and `web status` stay blind to the server this note just told someone to
  // launch at every login. Derived, not trusted: `TheMigrateNoteAdvisesARealWebAction`.
  for (const p of autostartFindings()) {
    pyPrint(`[migrate] NOTE: the autostart entry at ${p} still names another checkout — `
      + 'update it by hand to run: geneseed web start --no-browser\n');
  }
  return 0;
}
