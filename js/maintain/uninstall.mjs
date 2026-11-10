/**
 * `geneseed uninstall` — the first verb in this port that DELETES.
 *
 * Thirteen subcommands crossed before this one and every one of them either writes or
 * reports. `uninstall` removes a deployed install: the manifest's owned files, the empty
 * directories they leave behind, the settings-file wiring, the managed block in the
 * instruction carrier, the markers, and the registry row that the markers' absence prunes.
 * That changes what the GATE has to prove, in three ways, and all three were settled before
 * a line of this file was written.
 *
 * 1. THE GATE HAS TO PROVE WHAT SURVIVED, not only what went. `golden._snapshot` walks
 *    FILES, so a cell that seeds an install and uninstalls it reports the deletions
 *    perfectly — and says nothing at all about the user's own file in the same directory.
 *    P5c's rule applies directly: an ownership gate needs a positive control beside it. Every
 *    cell here that names a deleted path also seeds an UNOWNED neighbour and names it in
 *    `expect_files`, so a port that deleted by glob instead of by manifest fails.
 * 2. AN EMPTY DIRECTORY WAS INVISIBLE TO EVERY CELL. The ancestor-climb prune is a quarter of
 *    this verb and `_snapshot` could not see it: a port that unlinked the files and left
 *    `skills/<name>/` behind was byte-identical everywhere. Closed by a `<dirs>` column in
 *    the CLI matrix's snapshot (`tests/helpers/cli_golden.mjs`) rather than a per-cell
 *    expectation, because one entry closes it for all 219 cells written before it existed —
 *    `cmdTheme`'s statement order sat in the same hole. The ABSOLUTE half is a different axis and is the sixth
 *    expectation kind, `expect_absent_files`.
 * 3. `--archive-memory` TOUCHES THE MEMORY STORE, the one thing here a user cannot rebuild.
 *    It is why `_archive_store` MOVES and never deletes, and why the Python's `memory=delete`
 *    disposition has no flag reaching it from the CLI. This port keeps both properties.
 *
 * AND SINCE P6i, THE REVERSIBLE SIBLINGS ARE HERE TOO. `_install_deactivate` /
 * `_install_reactivate` (and their Claude-style twins) were left out with a due date: "an
 * unported deactivate has no partition to be part of until P6 brings its caller". P6f found
 * the caller — `api_install_toggle` — and P6i ports it, so the pair arrives in the module
 * whose thirteen private helpers it shares (`pruneAncestors`, `settingsFile`, `claudeMdPath`,
 * `managedOf`, `ownedOf`, `installAgentEntry`, `unmergeOpencodeJson`, `rmtreeQuiet`, …),
 * in one file. Deactivate is `_uninstall_global` with
 * `move` where it has `unlink`, plus an inverse; splitting them would have duplicated the
 * owned-file walk and the ancestor prune a fourth time.
 *
 * NO SPAWN. `ALLOWED_SPAWNS` in `tests/unit/hook_cli.test.mjs` is the table of every module
 * allowed to reach `child_process` and the argv each may use; this module has no row and
 * does not want one, because every operation here is a filesystem call. That matters more
 * than usual for this verb: shelling the uninstall out to an interpreter would have been
 * byte-identical in every cell of the matrix, so only the allow-list refutes it.
 */
import {
  existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, rmdirSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';

import { hookRunnerEntry } from '../hosts/shim.mjs';
import { confirm } from '../lib/prompt.mjs';
import {
  claudeCfg, claudeReadManifest, doctrinesOfDir, EMIT_HOST_SCOPE, emitHostScopeOf,
  excludedRulesOfDir, gatesOfDir, installKind, installState,
  registeredTargets,
} from '../hosts/installs.mjs';
import {
  CLAUDE_STYLE, DISABLED_STASH, GLOBAL_MANIFEST, HOSTS, VERSION_MARKER, expanduser, isHostGlobalDir, opencodeConfigDir,
  resolvePath, settingsFile,
} from '../hosts/hosts.mjs';
import { mcpCommented, mcpLoad } from '../hosts/mcp.mjs';
import {
  SRC_DIRS_MARKER, bundleFiles, hashesOf, ownedState, ownedWithin, recordedDenies, recordedEdit,
} from '../hosts/owned.mjs';
import {
  atomicWriteJson, managedBlockRead, managedBlockRemove, managedBlockWrite,
  loadJsonObject, mergeClaudeSettings, opencodeTarget, OPENCODE_SENTINEL, opencodeSentinelWrite,
  settingsIntegrityCheck, wireClaudeExcludes, unwireClaudeExcludes,
  unwireClaudeSettings, wireClaudeEnv, unwireClaudeEnv,
} from '../hosts/settings.mjs';
import { printOut, printErr, readText, writeText, isFile, isDir, isOsError } from '../lib/fs.mjs';
import { indexOfDeepEqual, isDict, jsonDumps, deepEquals } from '../lib/json.mjs';
import { sharedPaths } from '../lib/machine-dir.mjs';
import { archiveStore } from '../hosts/memory-files.mjs';
import { comparePaths, isAbsolutePath } from '../lib/paths.mjs';

const hostSpec = (host) => HOSTS.find((h) => h.host === host);

/**
 * `shutil.rmtree(p, ignore_errors=True)`.
 *
 * `force: true` already swallows ENOENT; the try/catch is for everything else, which is what
 * `ignore_errors` swallows and `rmSync` throws. The behaviour this preserves is the one
 * `_install_uninstall` step 3 was written around: an ignored error can leave the directory
 * standing while the call reports success, which is why the survivors sweep exists at all.
 *
 * THE DIRECTORY TEST IS THE PORT, NOT A PRECAUTION, and it was missing until P3's unit tier
 * asked for it. `shutil.rmtree` REFUSES anything that is not a real directory: handed a file it
 * raises `NotADirectoryError`, handed a symlink it raises outright ("Cannot call rmtree on a
 * symbolic link"), and `ignore_errors=True` turns both into a no-op that leaves the thing on
 * disk. `rmSync(recursive, force)` deletes all three without complaint. The gap is destructive
 * in exactly one direction — the port removes what the reference preserves — and it is
 * REACHABLE: `installDeactivate`'s rollback calls this on `root/.geneseed-disabled`, so a user
 * with a plain FILE of that name at their install root loses it on the port and keeps it on the
 * reference. No cell can see this; nothing plants a file where a stash directory belongs.
 *
 * `lstatSync`, not `statSync`, so a symlink to a directory is refused as the reference refuses
 * it rather than followed.
 */
function rmtreeQuiet(p) {
  try {
    if (!lstatSync(p).isDirectory()) return;
    rmSync(p, { recursive: true, force: true });
  } catch { /* ignore_errors=True, and the missing-path case lands here too */ }
}

/** `Path.unlink()` inside a `try: ... except OSError: pass`. */
function unlinkQuiet(p) {
  try { unlinkSync(p); } catch { /* best effort */ }
}

/**
 * `Path.rmdir()` — only ever called on a directory this code has just found empty.
 *
 * `rmdirSync`, not `rmSync(p, { recursive: false })`: the latter throws EISDIR on a
 * DIRECTORY, which is the only thing either caller ever hands it. Caught by the first
 * cross-implementation run of the group — every prune reported the directory as an owned
 * file that could not be removed, and the whole matrix came back INCOMPLETE.
 */
function rmdirQuiet(p) {
  try { rmdirSync(p); } catch { /* best effort */ }
}

/** `not any(d.iterdir())` — and False for a path that is not a readable directory. */
function isEmptyDir(p) {
  try { return readdirSync(p).length === 0; } catch { return false; }
}

/**
 * The ancestor climb `_uninstall_global`, `_claude_uninstall` and
 * `_opencode_project_uninstall` each write out inline, in the same four lines.
 *
 * Walking UP rather than clearing the immediate parent is the behaviour: it clears the nested
 * layout of a vendored skill folder (`skills/<name>/references/…`, `…/.claude-plugin/…`) as
 * well as a flat native one. Written once here where the Python has three copies — the three
 * are identical, and this is the half of the verb no cell could see before the `<dirs>`
 * column existed.
 *
 * The Python's loop has NO try/except: an `OSError` from `rmdir` propagates to the caller's
 * per-file handler and lands the file in `failed`. Reproduced exactly, so `rmdirQuiet` is
 * deliberately NOT what this calls.
 */
function pruneAncestors(start, stop) {
  let d = start;
  while (d !== stop && isDir(d) && isEmptyDir(d)) {
    rmdirSync(d);
    d = path.dirname(d);
  }
}

/**
 * The manifest's `owned` list, unlinked one by one with the ancestor prune, returning
 * `[removed, failed, kept]`.
 *
 * One function because three callers share this loop:
 * `_uninstall_global` (rooted at the target), `_claude_uninstall` (rooted at the cfg dir) and
 * `_opencode_project_uninstall` (rooted at `.opencode/`, and the only one that PREFIXES its
 * failure strings) differ in the root and in the label, which are the two arguments. The
 * `victim.is_file()` guard is load-bearing rather than defensive: a manifest entry naming a
 * directory is SKIPPED, not recursed into, and `removed` counts only what actually went.
 *
 * `ownedWithin` first, the same containment boundary deactivate draws: the manifest is a file
 * on disk, and without it an `owned` entry of `../../.bashrc` was unlinked — and the prune
 * then climbed from ITS parent, which never meets `base`, removing empty directories as it went.
 *
 * Task 5 (O-1's uninstall half): `hashes` is the manifest's recorded `hashes` map (`hashesOf`,
 * `{}` for an older manifest — the constraint that keeps a hash-less install's behaviour
 * unchanged). Unless `force`, a rel whose `ownedState` reads `'modified'` is left on disk rather
 * than unlinked and lands in `kept`, not `failed` — it is not an error, the file just is not
 * Geneseed's to delete any more once the user has edited it. `'unknown'` and `'missing'` are
 * NOT `'modified'` and are unlinked exactly as before, so an older, hash-less manifest's
 * uninstall is byte-identical to today's.
 * @returns {[number, string[], string[]]}
 */
function unlinkOwned(base, owned, label = '', hashes = {}, force = false) {
  let removed = 0;
  const failed = [];
  const kept = [];
  for (const rel of ownedWithin(base, owned)) {
    const victim = path.join(base, rel);
    try {
      if (isFile(victim)) {
        if (!force && ownedState(base, rel, hashes) === 'modified') {
          kept.push(`${label}${rel}`);
          continue;
        }
        unlinkSync(victim);
        removed += 1;
        pruneAncestors(path.dirname(victim), base);
      }
    } catch (e) {
      // `f"{rel} ({e})"`. `str(OSError)` and an `Error.message` word the same fault
      // differently, and no cell can reach this: it needs a file that exists, is a file, and
      // cannot be unlinked. Recorded rather than papered over — the same standing item
      // `js/inspect/excludes.mjs` carries for its `could not remove <stub>` branch.
      failed.push(`${label}${rel} (${e && e.message ? e.message : e})`);
    }
  }
  return [removed, failed, kept];
}

/** The two WARNs every reversal prints when an owned file survives. Identical in all three. */
function warnSurvivors(failed) {
  printErr('[uninstall] WARN: could not remove '
    + `${failed.length} owned file(s): ${failed.join(', ')}\n`);
}

/**
 * The message a reversal prints for every rel `unlinkOwned` left on disk because the user had
 * edited it and `--force` was not given. Separate from `warnSurvivors`: a kept file is not an
 * error (nothing failed) — it is the user's now, exactly like a refused claim on re-emit, and
 * the uninstall completes around it. So the hint is `--force` on the uninstall itself, not a
 * retry: once it completes there is no install left to rerun against.
 */
function warnKept(kept) {
  printErr(`[uninstall] kept ${kept.length} file(s) you edited: ${kept.join(', ')}`
    + ' — they are yours now (uninstall with --force to delete edited files too)\n');
}

/** Only a FAILED unlink keeps the manifest and markers — a kept edit never does. */
function warnMarkersKept() {
  printErr('[uninstall] WARN: the manifest and markers were KEPT so '
    + '`geneseed uninstall` can be retried once the file(s) are '
    + 'unlocked/removable.\n');
}

/** The markers a completed reversal drops, in the Python's order. */
const REVERSAL_MARKERS = [GLOBAL_MANIFEST, '.geneseed-theme', '.geneseed-emit',
  '.geneseed-footprint', VERSION_MARKER];

/**
 * Drop one `instructions` entry, leave every other
 * key intact.
 *
 * `denyNames`, Task 4 (O-1): the denies this install's manifest records writing
 * (`skill_denies`) — remove `permission.skill[name]` for each one, but ONLY where the value is
 * still exactly `"deny"`, and drop the `skill` object once it is empty. Ownership comes from the
 * record, not the value; the value check on top guards a user who re-scoped a recorded name to
 * their own `"allow"`/`"ask"`. A
 * caller passing `[]` (every non-uninstall unwire — `installDeactivate`, same as
 * `permission.bash`) leaves `permission.skill` untouched, so a paused install keeps the model
 * blind to its skills rather than re-exposing them until the next `geneseed build`.
 *
 * The sweep runs even when the `instructions` entry is already gone — an uninstall after a
 * deactivate, which removed the entry but kept the denies (PR #241 review) — so either half
 * alone is a change, and only "neither" declines.
 *
 * A COMMENTED `.jsonc` is not rewritten and the user is told to do it by hand — the entry AND
 * the recorded denies still set to `"deny"`, each named: rewriting it
 * would drop the comments. That branch returns False, so the caller's `unmerged` reports
 * REALITY rather than intent.
 */
export function unmergeOpencodeJson(p, entry, denyNames = [], edit = null) {
  const target = opencodeTarget(p);
  // Absent, unreadable (the Python's `except OSError: return False`) or not an object: decline.
  const { state, data: cfg, hadComments } = loadJsonObject(target);
  if (state !== 'ok') return false;
  const instr = cfg.instructions;
  const hasEntry = Array.isArray(instr) && instr.includes(entry);
  // The deny sweep does NOT hang off the entry: `installDeactivate` already dropped the entry
  // (and kept the denies), so an uninstall after a deactivate finds no entry but still owns them.
  const skill = isDict(cfg.permission) && isDict(cfg.permission.skill) ? cfg.permission.skill : null;
  const denies = skill ? denyNames.filter((n) => skill[n] === 'deny') : [];
  // `edit` is the manifest's `edit_asks`/`edit_shorthand` record, swept like `denyNames`: a
  // recorded key goes only while it still reads `"ask"`, and the user's blanket `"allow"` comes
  // back only when nothing but its `"*"` is left — a key the user added since keeps the object.
  const editObj = edit && isDict(cfg.permission) && isDict(cfg.permission.edit) ? cfg.permission.edit : null;
  const asks = editObj ? edit.asks.filter((k) => editObj[k] === 'ask') : [];
  if (!hasEntry && !denies.length && !asks.length) return false;
  if (path.extname(target) === '.jsonc' && hadComments) {
    printOut(`[uninstall] ${path.basename(target)} has comments — not rewriting it.`
      + (hasEntry ? ` Remove this from its "instructions" by hand: ${jsonDumps(entry)}` : '')
      + (denies.length ? ` Remove these from its "permission.skill" by hand: `
        + `${denies.map((n) => jsonDumps(n)).join(', ')}` : '')
      + (asks.length ? ` Remove these from its "permission.edit" by hand: `
        + `${asks.map((k) => jsonDumps(k)).join(', ')}` : '')
      + '\n');
    return false;
  }
  if (hasEntry) cfg.instructions = instr.filter((i) => i !== entry);
  for (const name of denies) delete skill[name];
  if (skill && denies.length && !Object.keys(skill).length) delete cfg.permission.skill;
  for (const k of asks) delete editObj[k];
  if (asks.length) {
    const left = Object.keys(editObj);
    if (!left.length) delete cfg.permission.edit;
    else if (edit.shorthand && left.length === 1 && editObj['*'] === edit.shorthand) cfg.permission.edit = edit.shorthand;
  }
  atomicWriteJson(target, cfg);
  return true;
}

/** Where the manifest says the managed block lives. */
function claudeMdPath(cfg, managed) {
  const rel = ((managed && managed.claude_md) || {}).rel || 'CLAUDE.md';
  return resolvePath(path.join(cfg, rel));
}

/** A manifest's `managed` map, or `{}` — the Python's `isinstance(..., dict)` guard. */
function managedOf(man) {
  return isDict(man.managed) ? man.managed : {};
}

/** A manifest's `owned` list, or `[]`. */
function ownedOf(man) {
  return Array.isArray(man.owned) ? man.owned : [];
}

/**
 * Reverse a Claude-style install at `cfg`.
 *
 * The survivors gate is the part worth reading twice. A locked owned file must NOT take the
 * manifest and markers with it: the manifest is this install's only qualifying signal
 * (`claudeState` keys on it), so deleting it while a file survives would report the install
 * 'absent' and the retry the WARN promises would bounce off `cmdUninstall`'s own gate,
 * stranding the leftovers forever.
 */
export function claudeUninstall(cfg, archiveMemory, force = false) {
  const man = claudeReadManifest(cfg);
  const managed = managedOf(man);
  const [removed, failed, kept] = unlinkOwned(cfg, ownedOf(man), '', hashesOf(man), force);
  if (failed.length) warnSurvivors(failed);
  if (kept.length) warnKept(kept);
  const hooks = managed.settings_hooks || [];
  const sf = settingsFile(cfg, managed);
  const unwired = unwireClaudeSettings(sf, hooks);
  unwireClaudeExcludes(sf, managed.settings_excludes || []);
  unwireClaudeEnv(sf, managed.settings_env);
  // The unwire is VERIFIED, not assumed: a commented settings file is never rewritten, so a
  // supposedly-uninstalled repo could keep firing Geneseed's hooks. Loud, never fatal.
  settingsIntegrityCheck(sf, managed, 'absent');
  // Always EXCISE, never whole-file delete: even where Geneseed created CLAUDE.md the user
  // may have added prose since. The file goes only if the excision leaves it empty.
  managedBlockRemove(claudeMdPath(cfg, managed));
  if (failed.length) warnMarkersKept();
  else for (const m of REVERSAL_MARKERS) unlinkQuiet(path.join(cfg, m));
  let archived = null;
  if (archiveMemory && isDir(path.join(cfg, 'memory'))) {
    archived = archiveStore(path.join(cfg, 'memory'));
  }
  // `unmerged` reports REALITY: hooks were recorded AND the unwire actually rewrote the file.
  return { removed, unmerged: Boolean(hooks.length) && unwired, archived, failed, kept };
}

/**
 * Reverse a global install at `target` via its manifest.
 *
 * Host-aware at the top, and that dispatch is the whole reason a Claude/Bob/OpenClaude global
 * install and an OpenCode one can share one entry point: the Claude family has no
 * opencode.json to unmerge and a settings.json plus a managed block instead.
 */
export function uninstallGlobal(target, archiveMemory, host = 'opencode', force = false) {
  if (CLAUDE_STYLE.includes(host)) return claudeUninstall(target, archiveMemory, force);
  const man = claudeReadManifest(target);
  const [removed, failed, kept] = unlinkOwned(target, ownedOf(man), '', hashesOf(man), force);
  if (failed.length) warnSurvivors(failed);
  if (kept.length) warnKept(kept);
  for (const d of ['agents', 'skills', 'plugins']) {
    const p = path.join(target, d);
    if (isDir(p) && isEmptyDir(p)) rmdirQuiet(p);
  }
  const unmerged = unmergeOpencodeJson(path.join(target, 'opencode.json'),
    path.join(target, 'AGENT.md').split(path.sep).join('/'), recordedDenies(man), recordedEdit(man));
  managedBlockRemove(path.join(target, OPENCODE_SENTINEL));
  if (failed.length) warnMarkersKept();
  else for (const m of REVERSAL_MARKERS) unlinkQuiet(path.join(target, m));
  let archived = null;
  if (archiveMemory && isDir(path.join(target, 'memory'))) {
    archived = archiveStore(path.join(target, 'memory'));
  }
  return { removed, unmerged, archived, failed, kept };
}

/**
 * The `instructions` entry to drop.
 *
 * A global install wires the ABSOLUTE posix path; a project install wires the relative
 * `…/AGENT.md` the emit recorded, read back off the live config so a bundle sub-dir layout
 * round-trips. `isAbsolutePath` and not `path.isAbsolute`: they disagree on Windows for a
 * ROOTLESS `/repo/AGENT.md`, which Python keeps and `path.isAbsolute` would have skipped.
 */
export function installAgentEntry(root, kind) {
  if (kind === 'global') {
    return path.join(root, 'AGENT.md').split(path.sep).join('/');
  }
  const cfg = mcpLoad(opencodeTarget(path.join(root, 'opencode.json')));
  return installAgentEntryOf(cfg.instructions);
}

/**
 * The DECISION half of `installAgentEntry`, split out so the corpus can drive it.
 *
 * A cell can only ever observe the entries a seeded `opencode.json` holds, and the shape
 * that separates the two `is_absolute` rules is a Windows ROOTLESS path — which a cell CAN
 * seed but whose answer then only differs on one platform, in one branch, with no other
 * observable effect. The former Python corpus drove the list directly; nothing does now.
 */
export function installAgentEntryOf(instr) {
  if (Array.isArray(instr)) {
    for (const e of instr) {
      if (typeof e === 'string' && !isAbsolutePath(e) && path.basename(e) === 'AGENT.md') return e;
    }
  }
  return 'AGENT.md';
}

/**
 * Reverse a per-repo OpenCode emit.
 *
 * ONLY WHAT THE EMIT RECORDED IS REMOVED, in both halves. `.opencode/` is unlinked file by file
 * off its manifest, so a hand-added agent or plugin under it survives. The portable bundle
 * beside it is unlinked file by file off the bundle's own list (`bundleFiles`,
 * `js/build/bundle.mjs`), so the user's own `agents/`, `skills/`, `laws/` or `AGENT.md` at the
 * repository root survive too. Both halves used to delete by directory, and a repository that
 * had such folders before the install lost them.
 *
 * `userOnly` names the watched directories this reversal emptied of everything recorded and
 * that still exist: what is left in them is the user's. `installUninstall` does not count them
 * as survivors. Counting them reported INCOMPLETE and advised a retry, with the manifest already
 * unlinked, and the retry then read `.opencode/` as a pre-manifest install and removed it whole.
 *
 * WITHOUT A RECORD the old shape still runs, for an install an older build made: no manifest
 * means `.opencode/` goes whole, and no bundle list means `laws`/`agents`/`skills` and
 * `AGENT.md` go whole. Two conditions fence it. The root must carry a bundle's own marker
 * (`.geneseed-theme` or the version file), the test `build` uses: `installState` calls a bare
 * `.opencode/` directory an install, and without the marker this reversal took a repository
 * Geneseed had already left, or never entered, for a pre-manifest install. And a root that has
 * the bundle list was made by a build that also writes the manifest, so a missing manifest
 * there is not a pre-manifest install and `.opencode/` is left alone.
 *
 * The entry is read BEFORE AGENT.md is deleted. Reading it after would find the wire
 * describing a file that no longer exists, which the fallback would then paper over with the
 * canonical spelling — and a bundle sub-dir layout would be left wired.
 */
function opencodeProjectUninstall(root, force = false) {
  const entry = installAgentEntry(root, 'project');
  let removed = 0;
  let failed = [];
  let kept = [];
  let man = null;
  const userOnly = [];
  const oc = path.join(root, '.opencode');
  const manifestPath = path.join(oc, GLOBAL_MANIFEST);
  const listed = bundleFiles(root);
  const legacy = isFile(path.join(root, '.geneseed-theme')) || isFile(path.join(root, VERSION_MARKER));
  if (isFile(manifestPath)) {
    man = claudeReadManifest(oc);
    [removed, failed, kept] = unlinkOwned(oc, ownedOf(man), '.opencode/', hashesOf(man), force);
    if (failed.length) warnSurvivors(failed);
    if (kept.length) warnKept(kept);
    // Survivors gate, mirroring the other two reversals: `_project_qualifies` keys off the
    // manifest, so deleting it while an owned file survives makes the install unfindable.
    // A kept (edited) file is not a survivor: it is the user's now, not this install's.
    if (!failed.length) {
      unlinkQuiet(manifestPath);
      if (isDir(oc) && isEmptyDir(oc)) rmdirQuiet(oc);
      else if (isDir(oc)) userOnly.push(oc);
    } else {
      warnMarkersKept();
    }
  } else if (isDir(oc)) {
    if (listed || !legacy) userOnly.push(oc);
    else { rmtreeQuiet(oc); removed += 1; }
  }
  if (listed) {
    const [n, bundleFailed] = unlinkOwned(root, listed, '', {}, true);
    removed += n;
    if (bundleFailed.length) {
      warnSurvivors(bundleFailed);
      failed = failed.concat(bundleFailed);
    } else {
      unlinkQuiet(path.join(root, SRC_DIRS_MARKER));
      for (const d of ['laws', 'agents', 'skills']) {
        if (isDir(path.join(root, d))) userOnly.push(path.join(root, d));
      }
    }
  } else if (legacy) {
    for (const d of ['laws', 'agents', 'skills']) {
      const p = path.join(root, d);
      if (isDir(p)) { rmtreeQuiet(p); removed += 1; }
    }
    const am = path.join(root, 'AGENT.md');
    if (isFile(am)) { unlinkQuiet(am); removed += 1; }
  } else {
    for (const d of ['laws', 'agents', 'skills']) {
      if (isDir(path.join(root, d))) userOnly.push(path.join(root, d));
    }
  }
  const unmerged = unmergeOpencodeJson(path.join(root, 'opencode.json'), entry,
    man ? recordedDenies(man) : [], man ? recordedEdit(man) : null);
  const result = { removed, unmerged, archived: null, userOnly };
  if (failed.length) result.failed = failed;
  if (kept.length) result.kept = kept;
  return result;
}

/** Where the manifest and the runtime stores live. */
function installDataDir(root, host = 'opencode', scope = 'global') {
  if (scope === 'project' && CLAUDE_STYLE.includes(host)) {
    return path.join(root, hostSpec(host).projectMarker);
  }
  return root;
}

/**
 * The dirs the reversal was supposed to have emptied.
 *
 * EXISTENCE is the retry signal, not emptiness: the reversals only `rmdir` a directory they
 * found empty, so a survivor here means either a locked file inside it or the `rmdir` itself
 * failing, and both are retry-worthy.
 */
export function ownedDirsFor(root, host, scope, data) {
  const dirs = [path.join(data, 'agents'), path.join(data, 'skills')];
  if (host === 'opencode') {
    if (scope === 'project') {
      dirs.push(path.join(root, '.opencode'), path.join(root, 'laws'));
    } else {
      dirs.push(path.join(data, 'plugins'));
    }
  }
  return dirs;
}

/**
 * Permanently remove the install at `root`, then de-list
 * it. Every op is best-effort and idempotent, so a partly-removed install can be retried.
 *
 * STEP 3 IS THE ONE WITH THE ARGUMENT IN IT. The ROOT markers are what the registry
 * self-prunes a row by, and dropping them while anything survived would make the install
 * unfindable and therefore unretriable — an OpenCode PROJECT install in particular carries no
 * manifest at the root, so `.geneseed-emit` is its only qualifying signal. The directory
 * sweep alone is not enough either: `ownedDirsFor` watches agents/skills (+ .opencode/laws/
 * plugins), so a locked owned file OUTSIDE those (Bob's `rules/geneseed.md`) would slip the
 * gate while the reversal kept its manifest, and deleting the root markers here would then
 * contradict that "KEPT" promise. The reversal's own `failed` list closes that hole.
 *
 * A KEPT file (Task 5: the user edited it, no `--force`) is the opposite case: it is the
 * user's now, exactly like a refused claim on re-emit, so it must NOT hold the install open —
 * a manifest kept for it left the install 'active' and the next `rebuild-all`/`update`
 * re-wired hooks into a repo the user had uninstalled. So a watched directory whose only
 * remaining files are kept ones is not a survivor, and `kept` never gates the markers; it is
 * returned so a caller (the web's remove) can name the files and the `--force` way out.
 */
export function installUninstall(root, host = 'opencode', scope = 'global', memory = 'keep',
  force = false) {
  if (!['keep', 'archive', 'delete'].includes(memory)) memory = 'keep';
  if (installState(root, host, scope) === 'absent') {
    return { ok: false, error: 'nothing installed here' };
  }
  const data = installDataDir(root, host, scope);
  // 1. The matching per-host reversal, then the disabled-state stash — its bytes are this
  //    install's, and they go with it.
  let summary;
  if (CLAUDE_STYLE.includes(host)) {
    summary = claudeUninstall(data, false, force);
    rmtreeQuiet(path.join(data, DISABLED_STASH, host));
  } else if (installKind(root) === 'global') {
    summary = uninstallGlobal(root, false, 'opencode', force);
    rmtreeQuiet(path.join(root, DISABLED_STASH));
  } else {
    summary = opencodeProjectUninstall(root, force);
    rmtreeQuiet(path.join(root, DISABLED_STASH));
  }
  // 2. Memory + notebook, independent of the owned-file removal above.
  const archived = [];
  for (const name of ['memory', 'notebook']) {
    const store = path.join(data, name);
    if (!isDir(store)) continue;
    if (memory === 'archive') archived.push(archiveStore(store));
    else if (memory === 'delete') rmtreeQuiet(store);
  }
  // 3. The root markers, but only once the reversal's dirs are actually gone.
  const failed = summary.failed || [];
  const kept = summary.kept || [];
  // `kept` rels are spelled relative to the reversal's own base: the cfg dir for the Claude
  // family, the root for OpenCode (whose project reversal already prefixes `.opencode/`).
  const keptAbs = new Set(kept.map((r) => path.join(CLAUDE_STYLE.includes(host) ? data : root, r)));
  // `userOnly`: a reversal that removed by record names the watched dirs it left holding only
  // the user's files (`opencodeProjectUninstall`).
  const userOnly = new Set(summary.userOnly || []);
  const survivors = ownedDirsFor(root, host, scope, data).filter((d) => existsSync(d)
    && !userOnly.has(d)
    && !(keptAbs.size && readdirSync(d, { recursive: true, withFileTypes: true })
      .every((e) => e.isDirectory() || keptAbs.has(path.join(e.parentPath, e.name)))));
  const withKept = (o) => (kept.length ? { ...o, kept } : o);
  if (survivors.length || failed.length) {
    if (survivors.length && !failed.length) {
      // With `failed` set the reversal already warned twice — no third overlapping WARN.
      printErr('[uninstall] WARN: could not fully remove the install — still present: '
        + `${survivors.join(', ')}. The install marker was KEPT so you can retry `
        + '`geneseed uninstall` once the file(s) are unlocked/removable.\n');
    }
    // `incomplete` names every reason the root markers stayed — directory survivors and a
    // failed unlink — deduped.
    const named = survivors.concat(failed);
    const out = withKept({
      ok: true,
      removed: summary.removed ?? 0,
      memory,
      incomplete: named.filter((f, i) => named.indexOf(f) === i),
    });
    if (archived.length) out.archived = archived;
    return out;
  }
  reconcileRootMarkers(root, host, scope);
  // 4. Tidy an emptied marker dir (.claude/.bob/.openclaude) so no husk lingers in the repo.
  if (data !== root && isDir(data) && isEmptyDir(data)) rmdirQuiet(data);
  const out = withKept({ ok: true, removed: summary.removed ?? 0, memory });
  if (archived.length) out.archived = archived;
  return out;
}

/**
 * `installUninstall`'s step 3 once nothing of THIS host's install survived: drop, rewrite or
 * keep the root markers depending on whether another host is still installed at `root`. Its
 * own function because the survivor argument below is the whole of it, and the caller must
 * only reach it after the reversal (step 1) has unlinked this host's own manifest/markers.
 */
function reconcileRootMarkers(root, host, scope) {
  // The root markers are ONE PER ROOT (`generate.mjs`'s "THE MARKER IS TRUSTED ONLY FOR ITS
  // OWN HOST") and `registryRoots` keeps a row alive only while `.geneseed-emit` exists there
  // — so in a repo sharing two project installs (`.claude/` + `.opencode/` at the same cwd,
  // last deploy wins the marker), deleting it unconditionally because THIS host is being
  // uninstalled would silently deregister the OTHER host's still-live install, regardless of
  // which host's name the marker happened to carry.
  //
  // Delete every marker ONLY when nothing else is installed here. Otherwise:
  //   - `.geneseed-emit` carries HOST IDENTITY (`EMIT_HOST_SCOPE`'s key names a (host, scope)
  //     pair) and `installProfile`/`migrateSurvey` trust it only for the host it names
  //     (`generate.mjs`'s own docblock). If it currently names the host just removed, REWRITE
  //     it to the survivor's own emit name — the same string `writeMarkers` (`driver.mjs`)
  //     would have written for that survivor — rather than deleting it and leaving the
  //     registry row to self-prune a live install. If it already names a survivor, it is
  //     already correct; leave it untouched.
  //   - `.geneseed-theme` and `VERSION_MARKER` carry NO host identity — a bare theme name and
  //     a version/fingerprint string — so there is no survivor value to rewrite them TO; the
  //     only question is whether they are THIS host's own litter to clear. At PROJECT scope
  //     `.geneseed-theme` here is OpenCode's alone: `driver.mjs`'s own comment says the
  //     claude/bob/openclaude project emits never write it, and `themeOfDir`'s host-narrowing
  //     (host-compat B1 round 3, `js/hosts/installs.mjs`) means no Claude-style sibling ever
  //     reads it either — so delete it only when OpenCode is the host being removed, and
  //     leave it for a Claude-style uninstall (it belongs to a surviving or absent OpenCode
  //     install either way, never to the host that just left). `VERSION_MARKER` is written at
  //     `cfgDir`, never bare `root`, by every PROJECT emit (`js/build/version.mjs`'s callers),
  //     so a project root never actually carries this file regardless of host — deleting it
  //     here is always a no-op there. At GLOBAL scope neither file is ever shared (each host
  //     owns its own config dir), so both are always this host's own and always safe to drop.
  // PROJECT scope uses `projectQualifies` (the same predicate `uninstallResolve` already
  // trusts for exactly this question), never `installState`: `installState`'s OpenCode
  // branch answers 'active' off a bare `.opencode/` DIRECTORY's existence alone, with no
  // manifest or marker check, so an unrelated non-Geneseed `.opencode/` sitting next to a
  // real Claude install would read as a "surviving" OpenCode install and keep the marker
  // alive for a host that was never actually here.
  const survivor = HOSTS.find(({ host: h }) => h !== host && (
    scope === 'project'
      ? projectQualifies(root, h)
      // GLOBAL: each host owns a distinct config dir, so no two hosts' global installs ever
      // share a root — this can only match THIS host's own global install, and by the time
      // execution reaches here (step 3) step 1 has already unlinked THIS host's own
      // manifest/markers, so the lookback never mistakes its own just-removed install for a
      // surviving sibling.
      : installState(root, h, scope) !== 'absent'
  ));
  if (!survivor) {
    for (const m of ['.geneseed-emit', '.geneseed-theme', VERSION_MARKER]) {
      unlinkQuiet(path.join(root, m));
    }
  } else {
    const markerScope = emitHostScopeOf(root);
    if (markerScope !== null && markerScope[0] === host) {
      const survivorEmit = [...EMIT_HOST_SCOPE.entries()]
        .find(([, hs]) => hs[0] === survivor.host && hs[1] === scope)?.[0];
      if (survivorEmit) {
        writeText(path.join(root, '.geneseed-emit'), `${survivorEmit}\n`);
      } else {
        // Defensive: every (host, scope) pair in `HOSTS` has an `EMIT_HOST_SCOPE` entry, so
        // this should be unreachable — but silently leaving a marker naming the just-removed
        // host would deregister the survivor exactly as before, so it is loud instead of quiet.
        printErr(`[uninstall] WARN: could not resolve an emit name for the surviving `
          + `${survivor.host}:${scope} install here — the shared .geneseed-emit marker still `
          + `names ${host}, which was just removed. Re-run \`geneseed rebuild-all\` or `
          + `re-emit ${survivor.host} to refresh it.\n`);
      }
    }
    if (scope === 'global' || host === 'opencode') unlinkQuiet(path.join(root, '.geneseed-theme'));
    unlinkQuiet(path.join(root, VERSION_MARKER));
  }
}

/**
 * Does `root` carry a REAL Geneseed project install?
 *
 * The marker dir exists, is not the host's global seen from its parent (`isHostGlobalDir`, the
 * `installTargets` aliasing guard — the default `~/.claude` too, under `$CLAUDE_CONFIG_DIR`),
 * and shows Geneseed's own tracks: the manifest, or the
 * root `.geneseed-emit` naming this host's project emit for a pre-manifest legacy install.
 * A bare non-Geneseed `.claude/` is very common and must never hijack the resolve.
 */
export function projectQualifies(root, host) {
  const spec = hostSpec(host);
  const cfg = path.join(root, spec.projectMarker);
  if (!isDir(cfg)) return false;
  try {
    if (isHostGlobalDir(host, cfg)) return false;
  } catch { /* best effort */ }
  if (isFile(path.join(cfg, GLOBAL_MANIFEST))) return true;
  const hs = emitHostScopeOf(root);
  return Boolean(hs) && hs[0] === host && hs[1] === 'project';
}

/**
 * (host, scope, root), or null.
 *
 * Precedence, most-specific first, and the ORDER of the first two is the subtle one: `~/.claude`
 * is NAMED like a project marker and is the global install, never `claude:project` rooted at
 * `$HOME`, so the global-config-dir case is checked before the marker-name case.
 *
 *   1. `--target` IS a host's global (`isHostGlobalDir`: its env-resolved dir, its default
 *      `~/<marker>`, or a dir whose emit marker names that host's `-global` emit).
 *   2. `--target` IS a project marker dir itself (…/.claude) — root is its parent.
 *   3. `--target` (as a root) carries a Geneseed project install.
 *   4. `--target` given and unrecognised — null, and the caller reports it.
 *   5. No `--target`: the cwd, then the OpenCode global config dir.
 */
export function uninstallResolve(targetArg) {
  const globalHit = (p) => {
    for (const spec of HOSTS) {
      try {
        if (isHostGlobalDir(spec.host, p)) return [spec.host, 'global', p];
      } catch { continue; }
    }
    return null;
  };
  const projectHit = (root) => {
    for (const spec of HOSTS) {
      if (projectQualifies(root, spec.host)) return [spec.host, 'project', root];
    }
    return null;
  };
  if (targetArg) {
    const p = resolvePath(expanduser(targetArg));
    const hit = globalHit(p);
    if (hit) return hit;
    for (const spec of HOSTS) {
      if (path.basename(p) === spec.projectMarker && isDir(p)
          && projectQualifies(path.dirname(p), spec.host)) {
        return [spec.host, 'project', path.dirname(p)];
      }
    }
    return projectHit(p);
  }
  // `.resolve()` so the cwd fallback matches every other branch and the registry, which
  // stores resolved paths — a short-form (8.3) cwd, as Windows CI hands back for %TEMP%,
  // would otherwise return a root that LOOKS different from the identical directory.
  const hit = projectHit(resolvePath(process.cwd()));
  if (hit) return hit;
  return ['opencode', 'global', opencodeConfigDir()];
}

/**
 * The PROJECT installs still on record.
 *
 * A global uninstall never cascades: each project install is self-contained, its hook
 * commands invoke the shared checkout by absolute path rather than anything under the global
 * config dir. The registry is the only place a project install outside the cwd can be
 * rediscovered from, and the just-removed root is excluded.
 */
function survivingProjectInstalls(removedRoot) {
  const rroot = resolvePath(removedRoot);
  const out = [];
  for (const [host, scope, root] of registeredTargets()) {
    if (scope !== 'project') continue;
    try { if (resolvePath(root) === rroot) continue; } catch { /* best effort */ }
    out.push([host, scope, root]);
  }
  return out;
}

/** Informational, never a cascade. */
function printSurvivingProjectInventory(removedRoot) {
  const survivors = survivingProjectInstalls(removedRoot);
  if (!survivors.length) return;
  printOut(`[uninstall] ${survivors.length} project install(s) remain — the global removal `
    + 'does not affect them (each is self-contained):\n');
  for (const [host, scope, root] of survivors) {
    printOut(`  - ${root} (${host}:${scope}) — remove with: `
      + `geneseed uninstall --target "${root}" --yes\n`);
  }
}

/**
 * One message per ADDITIONAL host at the same root.
 *
 * A repo can carry `.opencode/`, `.claude/` and `.bob/` side by side and `uninstall` only ever
 * removes the one it resolved to, so a repeat run needs to know there is more to do.
 */
function printOtherHostHits(root, removedHost) {
  for (const spec of HOSTS) {
    if (spec.host !== removedHost && projectQualifies(root, spec.host)) {
      printOut(`[uninstall] also found ${spec.host}:project here — run \`geneseed `
        + 'uninstall` again to remove it.\n');
    }
  }
}

/** D8: where the tier lives, and that no uninstall touches it. Silent when there is none. */
function printSharedTier() {
  try {
    const { root } = sharedPaths();
    if (isDir(root)) {
      printOut(`[uninstall] the shared tier at ${root} is never touched, even by the last host; `
        + 'delete it by hand if you want it gone.\n');
    }
  } catch { /* no home directory: no tier to name */ }
}

/**
 * The printing is the loud half and the deletions are the quiet one; the cells gate both. The
 * inventory at the end is informational in the strict sense — a global uninstall never
 * touches a project install, and saying so is the only thing those two branches do.
 */
export function cmdUninstall(args) {
  const hit = uninstallResolve(args.target);
  if (hit === null) {
    // `uninstallResolve(null)` never returns null — it falls back to the OpenCode global
    // default — so reaching here means `--target` was given and was not recognised.
    const targetDesc = resolvePath(expanduser(args.target));
    printErr(`[uninstall] no Geneseed install detected at ${targetDesc}.\n`
      + '[uninstall] pass --target <repo> for a project install (.opencode/.claude/'
      + '.bob/.openclaude) or --target <config dir> for a global one.\n');
    return 1;
  }
  const [host, scope, root] = hit;
  if (installState(root, host, scope) === 'absent') {
    const where = scope === 'project' && host !== 'opencode'
      ? ` under ${hostSpec(host).projectMarker}/` : '';
    printErr(`[uninstall] no ${host}:${scope} Geneseed install at ${root} `
      + `(no ${GLOBAL_MANIFEST}${where}).\n`);
    return 1;
  }
  const data = installDataDir(root, host, scope);
  const stores = ['memory', 'notebook'].filter((n) => isDir(path.join(data, n)));
  printOut(`[uninstall] target: ${root} (${host}:${scope})\n`);
  if (CLAUDE_STYLE.includes(host)) {
    // Not always settings.json: a Claude/OpenClaude PROJECT install wires settings.local.json
    // (host-compat B4) — read back from the manifest `settingsFile` already resolves, rather
    // than restate the rule here a second time.
    const cfgForSf = claudeCfg(root, scope, host);
    const sfName = path.basename(settingsFile(cfgForSf, managedOf(claudeReadManifest(cfgForSf))));
    printOut('[uninstall] removes: agents/, skills/, markers, the '
      + `${hostSpec(host).agentFile} managed block, and Geneseed's `
      + `${sfName} hooks/excludes (your own keys/hooks are kept).\n`);
  } else if (scope === 'global') {
    printOut('[uninstall] removes: AGENT.md, the AGENTS.md managed block, agents/, skills/, '
      + 'plugins/, markers, and the opencode.json instructions entry.\n');
  } else {
    printOut('[uninstall] removes: AGENT.md, .opencode/, laws/, agents/, skills/, and the '
      + 'opencode.json instructions entry.\n');
  }
  printOut('[uninstall] memory/ and notebook/ are kept in place (never deleted here)'
    + (stores.length ? ' — --archive-memory sets both aside.' : '.') + '\n');
  if (scope === 'global') printSharedTier();
  if (stores.length && args.archiveMemory) {
    printOut(`[uninstall] ${stores.join(' + ')}: will be ARCHIVED to a sibling `
      + 'archived-<name>/<timestamp>/ (never deleted)\n');
  }
  if (!args.yes) {
    if (!process.stdin.isTTY) {
      printErr('[uninstall] refusing to proceed without --yes (non-interactive).\n');
      return 1;
    }
    if (!confirm('Proceed with uninstall?', false)) {
      printOut('[uninstall] cancelled — nothing removed.\n');
      return 0;
    }
  }
  const memory = args.archiveMemory ? 'archive' : 'keep';
  const s = installUninstall(root, host, scope, memory, Boolean(args.force));
  if (!(s.ok ?? true)) {
    printErr(`[uninstall] failed: ${s.error || 'unknown error'}\n`);
    return 1;
  }
  const archived = s.archived || [];
  const mem = archived.length ? `archived -> ${archived.join(', ')}` : 'kept in place';
  const cfgfile = host === 'opencode' ? 'opencode.json' : 'settings.json';
  if (s.incomplete && s.incomplete.length) {
    printOut(`[uninstall] INCOMPLETE — removed ${s.removed} file(s), but `
      + `${s.incomplete.length} item(s) survived (see the WARN above); `
      + 'the install marker was kept — retry `geneseed uninstall` once they\'re '
      + `removable. ${cfgfile} updated where needed; memory/notebook ${mem}.\n`);
  } else {
    const keptNote = s.kept ? `, kept ${s.kept.length} you edited` : '';
    printOut(`[uninstall] done — removed ${s.removed} file(s)${keptNote}; ${cfgfile} updated where `
      + `needed; memory/notebook ${mem}. Start a new session to apply.\n`);
  }
  if (scope === 'global') printSurvivingProjectInventory(root);
  else if (scope === 'project') printOtherHostHits(root, host);
  return 0;
}

// ---- P6i: ACTIVATION — the reversible half ---------------------------------------------
//
// Deactivate turns an install OFF without deleting a byte: every owned artifact MOVES into a
// sibling stash and the wiring is dropped. Reactivate moves the same bytes back. The stash
// dir's PRESENCE is the disabled flag and its CONTENTS are the restore source — there is no
// recorded JSON state that could drift from the filesystem, which is the design decision the
// whole port has to preserve rather than improve on.
//
// ALL-OR-NOTHING IS THE PROPERTY, and it is the one a port breaks silently. A move that fails
// puts every earlier move back and reports, leaving the install fully `active`; a port that
// merely stopped on the failure would leave a half-gutted config dir that neither state
// answers for. `tests/unit/web_api.test.mjs`'s `deactivate rolls back on a failed move`
// drives it with a file planted where the stash dir belongs, which fails the FIRST move; the
// former web matrix's SECOND-move collision (a manifest naming a file AND its parent
// directory) has no successor.

/**
 * Move a file or dir, refusing an existing destination.
 *
 * THE REFUSAL IS THE CONTRACT, not a safety net: the stash is what a reactivate restores
 * FROM, so silently overwriting a destination would destroy the only copy of whatever was
 * already there. The caller catches and rolls back.
 *
 * `raise FileExistsError(dst)` is a SINGLE-ARGUMENT OSError, whose `str()` is just the path,
 * and the caller interpolates it into the `failed` list a cell compares byte for byte — so
 * the message is reproduced exactly here. Node's own fs errors word themselves completely
 * differently (`EEXIST: file already exists, rename 'a' -> 'b'` against Python's
 * `[Errno 17] File exists: 'b'`); that divergence is real, declared, and unreachable from
 * any cell, exactly as `unlinkOwned`'s is — the only arm a seeded world can reach is this
 * one, which is why this one is exact.
 *
 * `renameSync`, not a copy-then-delete: `shutil.move` falls back to a copy across
 * filesystems, and the stash is a SIBLING inside the same root, so there is no device to
 * cross by construction.
 */
function moveTree(src, dst) {
  if (existsSync(dst)) {
    throw Object.assign(new Error(String(dst)), { code: 'EEXIST' });
  }
  mkdirSync(path.dirname(dst), { recursive: true });
  renameSync(src, dst);
}

/**
 * Which kind of install a stash holds, from its CONTENTS.
 *
 * There is no recorded tag, on purpose. A project stash carries `.opencode/`; a global one
 * carries the moved owned files. `null` for an empty or missing stash.
 */
function stashedKind(root) {
  const stash = path.join(root, DISABLED_STASH);
  if (isDir(path.join(stash, '.opencode'))) return 'project';
  if (isDir(stash) && !isEmptyDir(stash)) return 'global';
  return null;
}

/**
 * The disabled install's CONTENT was re-created live.
 *
 * The user ran `build`/`upgrade` while disabled. The live signal is KIND-SPECIFIC and the
 * stashed kind is what picks it: a global deactivate moves AGENT.md aside (leaving the
 * manifest marker, so `installKind` still answers 'global' and would false-positive on its
 * own), a project deactivate leaves AGENT.md alone and moves `.opencode/`.
 */
function installRelive(root) {
  if (stashedKind(root) === 'project') return isDir(path.join(root, '.opencode'));
  return isFile(path.join(root, 'AGENT.md'));
}

/** The rels to move aside, `ownedWithin`-guarded. */
function installMoveList(root, kind) {
  let rels;
  if (kind === 'project') {
    rels = ['.opencode'];
  } else {
    rels = ownedOf(claudeReadManifest(root)).filter((r) => r !== VERSION_MARKER);
  }
  return ownedWithin(root, rels);
}

/**
 * Put back JUST the AGENT.md `instructions` entry.
 *
 * Deliberately a minimal inline re-add rather than the emit's own merge, whose side effects
 * (adding `permission` and `lsp: true` when absent) would clobber values the user may have
 * set since the install was disabled. A commented `.jsonc` is not rewritten — the same
 * refusal `unmergeOpencodeJson` makes — but here the files have ALREADY been restored, so it
 * tells the operator what to add rather than failing the whole reactivate. That asymmetry is
 * the reference's and is gated per side.
 */
function installReaddEntry(target, entry) {
  if (!existsSync(target)) {
    atomicWriteJson(target, { $schema: 'https://opencode.ai/config.json', instructions: [entry] });
    return true;
  }
  const { state, data: cfg, hadComments } = loadJsonObject(target);
  if (state !== 'ok') return false;            // unreadable (except OSError), or not an object
  const instr = Array.isArray(cfg.instructions) ? cfg.instructions : [];
  if (indexOfDeepEqual(instr, entry) >= 0) return false;
  if (path.extname(target) === '.jsonc' && hadComments) {
    printOut(`[activate] ${path.basename(target)} has comments — not rewriting it. Add this `
      + `to its "instructions" by hand: ${jsonDumps(entry)}\n`);
    return false;
  }
  cfg.instructions = [...instr, entry];
  atomicWriteJson(target, cfg);
  return true;
}

/**
 * `sorted(stash.rglob('*'))` with the directories dropped.
 *
 * `comparePaths`, not a bare sort: Windows compares paths case-folded and POSIX does not, and
 * the order here decides which collision is reported first in `failed`. Sorting the files
 * alone is the same order as sorting everything and skipping dirs afterwards, which is what
 * the Python does. `isDir` rather than the dirent flag, so a symlinked directory is recursed
 * into exactly as `is_dir()` follows it.
 */
function stashFiles(stash) {
  const out = [];
  const walk = (d) => {
    let ents;
    try { ents = readdirSync(d); } catch { return; }
    for (const name of ents) {
      const full = path.join(d, name);
      if (isDir(full)) walk(full);
      else out.push(full);
    }
  };
  walk(stash);
  return out.sort(comparePaths);
}

/** `rel.as_posix()` for a path already known to be relative. */
const asPosix = (rel) => rel.split(path.sep).join('/');

/**
 * The move-with-rollback loop `installDeactivate` and `claudeDeactivate` each wrote out
 * inline: move every `rel` from `srcBase` to `dstBase`, and on the first failure put every
 * earlier move back onto `srcBase` before reporting it. All-or-nothing is the property
 * (see the P6i note above `moveTree`), so a caught failure never leaves a partial move
 * standing even though this function itself takes no side action on failure beyond the
 * rollback — cleaning up the now-empty stash is the caller's, because the two hosts name
 * their stash differently (`rmtreeQuiet(stash)` plain, `cleanHostStash(cfg, host)` tagged).
 *
 * Returns `{ done }` on a clean run, or `{ done, failed }` once a move has failed and been
 * rolled back — `done` stays the moved-so-far list either way, which is what `rolled_back:
 * done.length` in both callers reports.
 */
function moveAll(srcBase, dstBase, rels) {
  const done = [];
  for (const rel of rels) {
    const src = path.join(srcBase, rel);
    if (!existsSync(src)) continue;   // a manifest entry already gone — nothing to move
    try {
      moveTree(src, path.join(dstBase, rel));
      done.push(rel);
    } catch (e) {
      if (!isOsError(e)) throw e;
      for (const r of [...done].reverse()) {
        try { renameSync(path.join(dstBase, r), path.join(srcBase, r)); } catch { /* OSError */ }
      }
      return { done, failed: [`${rel} (${e.message})`] };
    }
  }
  return { done };
}

/**
 * The stash-restore loop `installReactivate` and `claudeReactivate` each wrote out inline:
 * move every file under `stash` back onto `base`, by its relative path. `skip`, when given,
 * is one relative-posix path to leave untouched — `claudeReactivate`'s
 * `_claude_md_block.txt`, which holds the managed block's TEXT and is restored separately by
 * `managedBlockWrite` rather than a raw file move, because it is not a file that belongs
 * verbatim at that relative path.
 *
 * NEVER deletes the stash while anything is unrestored: a destination collision is a
 * leftover, reported rather than clobbered, so a retry has something left to restore from.
 */
function restoreAll(stash, base, skip = null) {
  const leftovers = [];
  let moved = 0;
  for (const src of stashFiles(stash)) {
    const rel = path.relative(stash, src);
    if (skip && asPosix(rel) === skip) continue;
    const dst = path.join(base, rel);
    if (existsSync(dst)) {
      // NEVER delete the stash while anything is unrestored — skip, keep, report.
      leftovers.push(asPosix(rel));
      continue;
    }
    mkdirSync(path.dirname(dst), { recursive: true });
    renameSync(src, dst);
    moved += 1;
  }
  return { leftovers, moved };
}

/**
 * Turn an OpenCode install off without deleting a byte.
 *
 * The config edit is the LAST step and the only non-move mutation, so a move failure rolls
 * back cleanly with the `instructions` entry still intact. The prune climbs from each moved
 * file's PARENT so a `skills/<name>/` husk goes too — the half of this function no file
 * snapshot can see, and the reason the former web matrix grew a `<dirs>` column in P6i.
 */
export function installDeactivate(root, host = 'opencode', scope = 'global') {
  if (CLAUDE_STYLE.includes(host)) return claudeDeactivate(root, scope, host);
  if (installState(root) !== 'active') {
    return { ok: false, error: `install is not active (${installState(root)})` };
  }
  const kind = installKind(root);
  const target = opencodeTarget(path.join(root, 'opencode.json'));
  // Caught UP FRONT, before any file moves: a commented `.jsonc` cannot be rewritten without
  // dropping the user's comments, so refuse and move NOTHING.
  if (mcpCommented(target)) {
    return { ok: false,
      error: `${path.basename(target)} has comments — refusing to rewrite it. `
        + 'Disable by hand or convert it to plain .json first.' };
  }
  const stash = path.join(root, DISABLED_STASH);
  const { done, failed } = moveAll(root, stash, installMoveList(root, kind));
  if (failed) {
    rmtreeQuiet(stash);
    return { ok: false, failed, rolled_back: done.length };
  }
  unmergeOpencodeJson(path.join(root, 'opencode.json'), installAgentEntry(root, kind));
  // The sentinel goes too, or a disabled install keeps the user's ~/.claude/CLAUDE.md from loading.
  if (kind === 'global') managedBlockRemove(path.join(root, OPENCODE_SENTINEL));
  for (const rel of done) pruneAncestors(path.dirname(path.join(root, rel)), root);
  return { ok: true, kind, moved: done.length };
}

/** The inverse. */
export function installReactivate(root, host = 'opencode', scope = 'global') {
  if (CLAUDE_STYLE.includes(host)) return claudeReactivate(root, scope, host);
  if (installState(root) !== 'disabled') {
    return { ok: false, error: `install is not disabled (${installState(root)})` };
  }
  const stash = path.join(root, DISABLED_STASH);
  const target = opencodeTarget(path.join(root, 'opencode.json'));
  // The re-emit-while-disabled guard: discard the now-stale snapshot rather than clobber the
  // fresh files, ensure the entry is present, and SAY SO. `installRelive`, not `installKind`
  // — a global deactivate leaves the manifest marker behind, so the kind test would lie here.
  if (installRelive(root)) {
    const kind = installKind(root) || 'global';
    rmtreeQuiet(stash);
    installReaddEntry(target, installAgentEntry(root, kind));
    return { ok: true,
      note: 'install was re-created while disabled; discarded the stashed snapshot' };
  }
  const { leftovers, moved } = restoreAll(stash, root);
  if (leftovers.length) return { ok: false, failed: leftovers, moved };
  const kind = installKind(root) || 'global';
  installReaddEntry(target, installAgentEntry(root, kind));
  if (kind === 'global') opencodeSentinelWrite(root);
  rmtreeQuiet(stash);
  return { ok: true, kind, moved };
}

// ---- the Claude-style fork (Claude · IBM Bob · OpenClaude) ---------------------------
//
// A Claude-style install has NO `instructions` array — the harness reaches the host through
// the CLAUDE.md managed block and the settings.json hooks. So the reversal is three moving
// parts instead of one: stash the owned agents/skills, EXCISE the managed block (stashing its
// content for an exact restore), and unwire the recorded hook groups. The stash lives under a
// host-TAGGED subdir so one root carrying both an OpenCode and a Claude install can disable
// each independently.

/**
 * Drop this host's stash and the parent if it empties.
 *
 * So 'disabled' never lingers as an empty marker, and a same-root other-host stash is left
 * standing.
 */
function cleanHostStash(cfg, host = 'claude') {
  rmtreeQuiet(path.join(cfg, DISABLED_STASH, host));
  const parent = path.join(cfg, DISABLED_STASH);
  if (isDir(parent) && isEmptyDir(parent)) rmdirQuiet(parent);
}

/**
 * Re-merge the canonical hooks and RECORD the claims.
 *
 * Threading the manifest's recorded claims through is what prunes stale groups; writing the
 * resulting set back is what keeps a group re-added after an interpreter or checkout move
 * from being orphaned at uninstall. The manifest rewrite is atomic through a sibling temp
 * file and swallows its own OSError, exactly as the reference does — a failed bookkeeping
 * write must not fail the reactivate that has already moved every file back.
 */
function remergeClaudeHooks(cfg, root = cfg, host = 'claude') {
  const data = claudeReadManifest(cfg);
  const managed = managedOf(data);
  // `hookOpts` is the one argument `mergeClaudeSettings` will not default, and it is right
  // not to: there is no computable fallback for the runner/entry the shim bakes. The
  // emitter's own originator is imported rather than restated — a reactivate that wired a
  // different shim path would point every re-added hook at a file the emitter never writes.
  // The pack selection is read back off the reactivated carrier, not defaulted: a reactivate
  // that re-wired the git-gate into an install whose owner had turned the process pack off
  // would put the boundary back at odds with the prompt. `null` (no marker) keeps the gate.
  //
  // ⚠ THE CARRIER IS NOT ALWAYS UNDER `cfg`, WHICH IS WHY `root` IS A SECOND PARAMETER. On a
  // PROJECT install `cfg` is `<repo>/.claude` and the carrier is `<repo>/CLAUDE.md`, so
  // reading `cfg` alone answered `null` for every project reactivate and re-wired the gate
  // unconditionally (fail-closed, so not a hole — but wrong, and it made the toggle one-way
  // for project installs). `root` first, `cfg` second: on a global install the two are the
  // same directory anyway. Both silent ⇒ `null` ⇒ the gate stays.
  // Both reads are narrowed to `host`'s OWN carrier (host-compat B1): in a repo shared with
  // another Claude-style host, an un-narrowed scan can answer with a SIBLING host's carrier —
  // the same failure `installProfile` had, reached here because `root` is the shared repo.
  const doctrines = doctrinesOfDir(root, host) ?? doctrinesOfDir(cfg, host);
  // Same two-carrier read for the second axis, and its own default: an absent line means
  // NOTHING excluded, so a reactivate can only ever restore a gate, never remove one.
  const excluded = excludedRulesOfDir(root, host).length ? excludedRulesOfDir(root, host)
    : excludedRulesOfDir(cfg, host);
  // `host` reaches the group builder: a Bob reactivate must re-wire Gemini-named groups.
  // The gate switches, the same two-carrier read: a gate is off only when a carrier says so,
  // so a reactivate never disarms an install that did not ask for it.
  const [atRoot, atCfg] = [gatesOfDir(root, host), gatesOfDir(cfg, host)];
  const gates = Object.fromEntries(Object.keys(atRoot).map((k) => [k, atRoot[k] && atCfg[k]]));
  const [, claims] = mergeClaudeSettings(settingsFile(cfg, managed),
    managed.settings_hooks ?? null, hookRunnerEntry(), doctrines, excluded, host, cfg,
    gates);
  // `and data` — a manifest that did not parse is not one to write back.
  if (!deepEquals(claims, managed.settings_hooks ?? null) && Object.keys(data).length > 0) {
    managed.settings_hooks = claims;
    data.managed = managed;
    try {
      atomicWriteJson(path.join(cfg, GLOBAL_MANIFEST), data);
    } catch { /* except OSError: pass */ }
  }
}

function claudeDeactivate(root, scope = 'global', host = 'claude') {
  const cfg = claudeCfg(root, scope, host);
  // `installState` dispatches Claude-style hosts to `claudeState(root, scope, host)`, which
  // is the call the Python makes directly. Same answer, one exported name.
  if (installState(root, host, scope) !== 'active') {
    return { ok: false,
      error: `install is not active (${installState(root, host, scope)})` };
  }
  const man = claudeReadManifest(cfg);
  const managed = managedOf(man);
  const stash = path.join(cfg, DISABLED_STASH, host);
  const rels = ownedWithin(cfg, ownedOf(man).filter((r) => r !== VERSION_MARKER));
  const { done, failed } = moveAll(cfg, stash, rels);
  if (failed) {
    cleanHostStash(cfg, host);
    return { ok: false, failed, rolled_back: done.length };
  }
  unwireClaudeSettings(settingsFile(cfg, managed), managed.settings_hooks || []);
  unwireClaudeExcludes(settingsFile(cfg, managed), managed.settings_excludes || []);
  unwireClaudeEnv(settingsFile(cfg, managed), managed.settings_env);
  // The same integrity check the uninstall path runs: a deactivate that silently failed to
  // unwire would leave hooks firing in a repo the user believes is off.
  settingsIntegrityCheck(settingsFile(cfg, managed), managed, 'absent');
  const cm = claudeMdPath(cfg, managed);
  const block = managedBlockRead(cm);
  mkdirSync(stash, { recursive: true });   // presence == disabled, even if nothing moved
  if (block !== null) {
    writeText(path.join(stash, '_claude_md_block.txt'), block);
    // ALWAYS EXCISE, never whole-file delete: prose the user added around the block must
    // survive a disable. The file goes only if nothing else remains.
    managedBlockRemove(cm);
  }
  for (const rel of done) pruneAncestors(path.dirname(path.join(cfg, rel)), cfg);
  return { ok: true, kind: host, moved: done.length };
}

function claudeReactivate(root, scope = 'global', host = 'claude') {
  const cfg = claudeCfg(root, scope, host);
  if (installState(root, host, scope) !== 'disabled') {
    return { ok: false,
      error: `install is not disabled (${installState(root, host, scope)})` };
  }
  const stash = path.join(cfg, DISABLED_STASH, host);
  const blockFile = path.join(stash, '_claude_md_block.txt');
  const reliveManifest = claudeReadManifest(cfg);
  const reliveManaged = managedOf(reliveManifest);
  let relive = managedBlockRead(claudeMdPath(cfg, reliveManaged)) !== null;
  // Bob GLOBAL writes no managed AGENTS.md block — its preamble carrier is the owned
  // `rules/geneseed.md`, so a live copy of THAT is the relive signal there. Without this arm
  // the guard never fires for bob-global and every stashed file collides with the fresh emit,
  // stranding the install 'disabled' until the stash is deleted by hand.
  if (!relive && !reliveManaged.claude_md) {
    relive = Object.keys(reliveManifest).length > 0
      && isFile(path.join(cfg, 'rules', 'geneseed.md'));
  }
  if (relive) {
    remergeClaudeHooks(cfg, root, host);   // ensure the hooks are present (and the claims exact)
    cleanHostStash(cfg, host);
    return { ok: true,
      note: 'install was re-created while disabled; discarded the stashed snapshot' };
  }
  const { leftovers, moved } = restoreAll(stash, cfg, '_claude_md_block.txt');
  if (leftovers.length) return { ok: false, failed: leftovers, moved };
  const managed = managedOf(claudeReadManifest(cfg));
  // ⚠ THE CARRIER IS RESTORED BEFORE THE HOOKS ARE RE-MERGED, AND THE ORDER IS LOAD-BEARING.
  // `remergeClaudeHooks` reads the install's pack selection back off the carrier, and on a
  // Claude-style host that selection lives inside the MANAGED BLOCK — which the deactivate
  // stashed. Re-merging first therefore asked a CLAUDE.md with its block cut out, got `null`
  // ("unknown"), and fail-closed straight back to the consent gate: every reactivate re-wired a
  // git-gate the owner had turned off, in both scopes. The two writes touch different files
  // (`CLAUDE.md` vs `settings*.json`), so nothing else depends on which goes first.
  if (existsSync(blockFile)) {
    managedBlockWrite(claudeMdPath(cfg, managed), readText(blockFile));
  }
  remergeClaudeHooks(cfg, root, host);
  wireClaudeExcludes(settingsFile(cfg, managed), managed.settings_excludes || []);
  // Only what the manifest records: a reactivate restores this install's own keys, never new ones.
  if (isDict(managed.settings_env)) wireClaudeEnv(settingsFile(cfg, managed), managed.settings_env);
  cleanHostStash(cfg, host);
  return { ok: true, kind: host, moved };
}
