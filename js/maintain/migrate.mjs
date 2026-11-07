/**
 * `geneseed migrate` — move a machine from the git-checkout install shape to the npm one.
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
 * IT RUNS FROM THE NPM PACKAGE OR NOT AT ALL. The re-emit bakes the ROOT of whatever Geneseed runs
 * it into the shim, so a run from a clone or a bundle moves nothing and only writes the stamp. That
 * refusal comes before the survey, because the survey's registry read can prune `installs.json`.
 * `--dry-run` writes nothing and answers from anywhere.
 *
 * THE ONE TRIGGER IS THE STAMP: work is needed when `<GENESEED_HOME>/.migrated` does not name this
 * ROOT, and the stamp is written only on success. That is what makes the verb idempotent, and it
 * holds for an OpenCode-only machine too, which wires no hooks at all.
 */
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import { main as driverMain } from '../build/driver.mjs';
import { foldHost, foldSummary } from '../build/fold.mjs';
import { RETIRED_SKILL_IDS, ROOT, knownSkillIds, skillAliases } from '../build/source.mjs';
import { CLAUDE_STYLE, isCanonical, settingsFile } from '../hosts/hosts.mjs';
import {
  claudeCfg, claudeReadManifest, EMIT_HOST_SCOPE, installState, installTargets,
  readMaybe,
} from '../hosts/installs.mjs';
import { installProfile } from '../build/generate.mjs';
import { autostartPaths, autostartStale, hookShimPath, shimHome } from '../hosts/shim.mjs';
import { writeText, printOut, printErr } from '../lib/fs.mjs';
import { sharedPaths } from '../lib/machine-dir.mjs';
import { isNpmPackageDir } from '../lib/paths.mjs';

/** Every emit name the generator answers to — the set an unrecognised marker is NOT in. */
const KNOWN_EMITS = new Set(EMIT_HOST_SCOPE.keys());

/**
 * The settings file a host wires hooks into, or null for a host that has none.
 *
 * Only the Claude-style hosts carry hook commands. OpenCode's hooks are a PLUGIN
 * (`js/hosts/opencode.mjs` emits JS that runs in the host's own process and names neither the
 * shim), so it has no settings file here and its whole migration is the re-emit —
 * the same re-emit, in the same change, on every host, which is what the project's
 * host-parity rule asks for.
 *
 * BOTH HALVES READ BACK AN EXISTING RESOLVER rather than a second hand-rolled copy
 * (host-compat B1/B2): `claudeCfg` (`js/hosts/installs.mjs`) is the cfg dir — `root` itself
 * for a global install, `<root>/<projectMarker>` (`.claude`/`.bob`/`.openclaude`) for a
 * project one — and `settingsFile` (`js/hosts/hosts.mjs`) is the file name inside it,
 * read off the install's OWN manifest. The manifest is the authority, not a guess at the
 * canonical name: a pre-existing `bob-global` install with no `managed.settings_file` yet
 * recorded carries the bare, pre-nesting `settings.json` it was actually written with, not
 * the nested `settings/settings.json` a brand new one gets — exactly the distinction
 * `claudeWire`'s own `get(old, 'settings_file') || 'settings.json'` makes before rewiring. A
 * literal `path.join(root, name)` here, as before, skipped the project subfolder entirely and
 * guessed the canonical name instead of reading what the install actually has.
 */
export function hookSettingsFile(root, host, scope) {
  if (!CLAUDE_STYLE.includes(host)) return null;
  const cfg = claudeCfg(root, scope, host);
  return settingsFile(cfg, claudeReadManifest(cfg).managed);
}

/** `<GENESEED_HOME>/.migrated` — the ROOT the last successful migration installed from. */
function stampPath() { return path.join(shimHome(), '.migrated'); }

/** Where the pre-migration copies live while the re-emit runs. */
function stashDir() { return path.join(shimHome(), '.migrate-backup'); }

/**
 * Step 1 — classify, WITHOUT touching anything.
 *
 * A refusal that happens here is free: nothing has been written, so "refuse and report" needs
 * no rollback. That ordering is the cheapest atomicity there is and it is why the survey is a
 * separate pass rather than a check inside the loop.
 */
function migrateSurvey({ prune = true } = {}) {
  const rows = [];
  const unrecognised = [];
  for (const [host, scope, root] of installTargets({ prune })) {
    if (installState(root, host, scope) !== 'active') continue;
    const raw = readMaybe(path.join(root, '.geneseed-emit'));
    const marker = raw === null ? '' : raw.trim();
    // An unrecognised marker is a REFUSAL, not a default. `rebuild-all` coerces here.
    if (marker && !KNOWN_EMITS.has(marker)) {
      unrecognised.push({ host, scope, root, marker });
      continue;
    }
    rows.push({ host, scope, root, marker, file: hookSettingsFile(root, host, scope) });
  }
  // No home and no GENESEED_HOME: no stamp to read, so nothing says this machine has migrated.
  let stamped = '';
  try { stamped = (readMaybe(stampPath()) || '').trim(); } catch { /* the survey only reads */ }
  return { rows, unrecognised, needed: stamped !== ROOT };
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

/**
 * What each global install's next emit would fold, stamped machine or not: the fold runs in every
 * emit, so the stamp says nothing about it. Each host reads the tier as it stands, so two hosts
 * holding the same new fact both count it here, and the second finds it a duplicate in the real run.
 */
function foldPreview(rows) {
  let shared;
  try { shared = sharedPaths(); } catch { return []; }   // no home: no tier to fold into
  return rows.filter(({ host, scope, root }) => scope === 'global' && isCanonical(root, host))
    .map(({ host, root }) => {
      const report = foldHost({ host, cfgDir: root, shared, dryRun: true });
      return { host, summary: foldSummary(report), failed: report.failed };
    });
}

/**
 * M5 — files no manifest owns, so no emit will ever prune them: the root `AGENT.md` and the folder
 * of a skill that no longer ships under its own name. An earlier build likely wrote them, but an
 * alias is a plain word and a folder under it may be the user's own, so nothing claims which.
 * REPORTED, never moved: they go aside on the user's word.
 *
 * The candidate names come from what git history already settled and the source still records —
 * `RETIRED_SKILL_IDS` and the `aliases:` markers — because the CLI may not spawn `git`. Each
 * candidate is checked before it is listed: a live skill is never an orphan (`teach` is live,
 * `quiz` is its alias), and a path the manifest owns is not one either — the next emit prunes it.
 */
export function orphanFindings(cfg, owned, { live = knownSkillIds(), aliases = skillAliases() } = {}) {
  const owns = (rel) => owned.some((o) => o === rel || o.startsWith(`${rel}/`));
  const names = [...new Set([...aliases.keys(), ...Object.keys(RETIRED_SKILL_IDS)])].filter((n) => !live.includes(n));
  return ['AGENT.md', ...names.map((n) => `skills/${n}`)]
    .filter((rel) => !owns(rel) && existsSync(path.join(cfg, rel)))
    .map((rel) => path.join(cfg, rel));
}

/** The `--dry-run` half of M5: the orphans of each global Claude-style install. */
function orphanPreview(rows) {
  return rows.filter(({ host, scope, root }) => scope === 'global' && CLAUDE_STYLE.includes(host) && isCanonical(root, host))
    .flatMap(({ root }) => {
      const owned = claudeReadManifest(root).owned;
      return orphanFindings(root, Array.isArray(owned) ? owned : []);
    });
}

/** The fold and orphan half of `--dry-run`, as the CLI prints it. */
function printPreview(rows) {
  for (const { host, summary, failed } of foldPreview(rows)) {
    printOut(summary ? `[migrate] would fold ${host}: ${summary}\n` : `[migrate] ${host}: nothing to fold\n`);
    for (const f of failed) printOut(`[migrate] ${host}: the fold would stop at ${f}\n`);
  }
  for (const p of orphanPreview(rows)) {
    printOut(`[migrate] orphan: ${p} (no manifest owns it; an earlier build may have written it, or it may be yours). Nothing moves it: if it is not yours, move it by hand.\n`);
  }
}

/**
 * What the next rebuild would do, for the console: `{folds: [{host, summary, failed}], orphans}`.
 * Writes nothing. A marker `migrate` refuses is in here too: `rebuild-all` coerces it, so that
 * install still folds. No `would re-emit` plan: that is this verb's, and a clone has none to run.
 */
export function migratePreview() {
  const { rows, unrecognised } = migrateSurvey({ prune: false });
  const all = [...rows, ...unrecognised];
  return { folds: foldPreview(all), orphans: orphanPreview(all) };
}

/** A stash key that cannot collide across drives, and is a legal file name on both platforms. */
const stashKey = (p) => p.replace(/[\\/:]/g, '_');

export function cmdMigrate(args = {}, { root = ROOT } = {}) {
  const dryRun = Boolean(args.dryRun);
  const isClone = existsSync(path.join(root, '.git'));
  const outside = isClone || !isNpmPackageDir(root);
  const shape = isClone ? 'a git clone' : 'a bundle';
  if (!dryRun && outside) {
    printErr(`[migrate] REFUSED — this Geneseed runs from ${shape}, so there is nothing to migrate. Use geneseed update.\n`);
    printErr('[migrate] Nothing was changed.\n');
    return 3;
  }
  const { rows, unrecognised, needed } = migrateSurvey({ prune: !dryRun });

  if (unrecognised.length) {
    // Refuse the WHOLE run. A migration that skipped the row it did not understand and
    // migrated the rest is the half-migrated machine this verb exists to prevent.
    printErr('[migrate] REFUSED — unrecognised install marker(s):\n');
    for (const u of unrecognised) {
      printErr(`[migrate]   ${u.host}:${u.scope} (${u.root}) has .geneseed-emit `
        + `'${u.marker}', which is not an emit this generator answers to.\n`);
    }
    printErr('[migrate] Nothing was changed. Fix or delete the marker, then re-run.\n');
    return 3;
  }

  if (!rows.length) {
    printOut('[migrate] no active installs detected.\n');
    return 0;
  }

  if (dryRun) printPreview(rows);

  if (!needed) {
    printOut(`[migrate] already on the npm shape (${rows.length} install(s)); nothing to do.\n`);
    return 0;
  }

  if (dryRun && outside) {
    printOut(`[migrate] this Geneseed runs from ${shape}, so a real run would refuse. Use geneseed update.\n`);
    printOut('[migrate] --dry-run: nothing was written.\n');
    return 0;
  }

  printOut(`[migrate] ${rows.length} install(s) to migrate.\n`);
  if (dryRun) {
    for (const r of rows) {
      printOut(`[migrate] would re-emit ${r.host}:${r.scope} (${r.root})\n`);
    }
    for (const p of autostartFindings()) {
      printOut(`[migrate] would report the autostart entry at ${p}\n`);
    }
    printOut('[migrate] --dry-run: nothing was written.\n');
    return 0;
  }

  // Step 2 — stash every file the re-emit can touch, so step 4 can put it all back.
  // Refused before the first write: with no home and no GENESEED_HOME there is nowhere to stage it.
  let stash;
  try {
    stash = stashDir();
  } catch {
    printErr('[migrate] REFUSED — no home directory, so there is nowhere to stage a backup.\n');
    printErr('[migrate] Nothing was changed. Set GENESEED_HOME, then re-run.\n');
    return 3;
  }
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
    printErr(`[migrate] could not stage a backup (${e.message}); nothing was changed.\n`);
    return 1;
  }

  const restore = () => {
    for (const [orig, dest] of saved) {
      try { copyFileSync(dest, orig); } catch { /* best effort — report below regardless */ }
    }
    try { rmSync(stash, { recursive: true, force: true }); } catch { /* nothing to undo */ }
  };

  // Step 3 — re-emit, in each install's OWN values: `installProfile`, the one reading
  // `rebuild-all` and `status` share. This loop hand-copied it once and drifted twice — it
  // passed the excluded rules as `null` (re-admitting every rule an owner switched off,
  // `process 5` among them) and dropped `--config-dir`, so a global found through
  // `CLAUDE_CONFIG_DIR`/`OPENCODE_CONFIG_DIR` re-emitted into the DEFAULT dir instead.
  //
  for (const r of rows) {
    const label = `${r.host}:${r.scope} (${r.root})`;
    const { emit, theme, argv } = installProfile(r.host, r.scope, r.root,
      (n) => printErr(`[migrate] ${label}: ${n}\n`));
    printOut(`[migrate] re-emitting ${label}: theme=${theme} emit=${emit}\n`);
    let rc = 1;
    try { rc = driverMain(argv); } catch { rc = 1; }
    if (rc !== 0) {
      // Step 4 — ALL OR NOTHING. `rebuild-all` continues here on purpose; a migration
      // must not, or the machine is left half on each shape.
      printErr(`[migrate] FAILED ${label} (exit ${rc}) — rolling back.\n`);
      restore();
      printErr(`[migrate] rolled back ${saved.length} file(s); the wiring is as it was. `
        + 'What an earlier row folded stays in the shared tier.\n');
      return 1;
    }
  }

  try { rmSync(stash, { recursive: true, force: true }); } catch { /* nothing to undo */ }
  try {
    mkdirSync(path.dirname(stampPath()), { recursive: true });
    writeText(stampPath(), `${ROOT}\n`);
  } catch { /* an unwritable stamp costs a redundant re-emit next run, never correctness */ }

  printOut(`[migrate] migrated ${rows.length} install(s).\n`);

  // Step 5 — what could NOT be fixed automatically. Reported, never rewritten: nothing in
  // this repository has ever written an autostart entry, so migrate does not own the file.
  // The `start` ACTION is load-bearing, not decoration: bare `web` runs `serve()` in the
  // FOREGROUND with `daemon=false`, which never writes the daemon record, so `web stop`,
  // `web restart` and `web status` stay blind to the server this note just told someone to
  // launch at every login. Derived, not trusted: `TheMigrateNoteAdvisesARealWebAction`.
  for (const p of autostartFindings()) {
    printOut(`[migrate] NOTE: the autostart entry at ${p} still names another checkout — `
      + 'update it by hand to run: geneseed web start --no-browser\n');
  }
  return 0;
}
