/**
 * The OpenCode emits — a project's `.opencode/` and the global config directory.
 *
 * Split out of `emit.mjs` beside `emit-claude.mjs`, over the shared writers in
 * `emit-common.mjs`. The two are siblings on purpose: an emit that is right for one host and
 * wrong for the other is the defect these have historically carried, and it reads far more
 * plainly as two files with the same shape than as two sections of one.
 */
import path from 'node:path';
import { bundleFiles } from '../hosts/owned.mjs';
import { VERSION_MARKER } from '../hosts/hosts.mjs';
import { claimer, loadAgentOverrides, writeNativeLayer } from '../hosts/native.mjs';
import {
  copyPlugins, copyWorkflows, ensureAgentOverridesStub, writeColorThemes, writeCommandLayer,
  writeAliasCommands, writePonytailCommand, writePrimaryAgent, writeTheme,
} from '../hosts/opencode.mjs';
import { mergeOpencodeJson, opencodeEditAsks, opencodeSentinelWrite } from '../hosts/settings.mjs';
import { isFile, readText, writeText } from '../lib/fs.mjs';
import { relPosix } from '../lib/text.mjs';
import { assertSourceComplete, build, phaseLog, ensureMemoryStore } from './bundle.mjs';
import {
  claimAndWrite, globalMemory, globalNotebook, shipLeanLaws, stripCapabilityLinks,
} from './emit-common.mjs';
import { foldOnEmit } from './fold.mjs';
import { pruneRetiredSkills } from './retired-skills.mjs';
import { renderAll } from './render.mjs';
import {
  ensureExcludesStub, ensureNotebookIndex, ensureProfileStub, ensureRulesStub,
  ensureWikiStub, sharedRootFor,
} from './stubs.mjs';
import { writeVersion } from './version.mjs';
import { mkdirSync } from 'node:fs';

/**
 * The layer both OpenCode emits share once RENDER has `items`/`theme` in hand: overrides, the
 * native agents/skills layer, the primary agent, commands, themes, plugins/workflows, and the
 * final `opencode.json` WIRE. `dir` is the emit's own directory — `.opencode/` for the
 * per-repo emit, `cfgDir` for the global one — which is why `wireBase` (where `opencode.json`
 * itself lives) travels separately: the per-repo config sits at the project ROOT, one level
 * above `dir`, while the global config sits IN `cfgDir`, i.e. `dir` itself.
 *
 * Folding WIRE in here moves it earlier in the global emit's own write order (it used to run
 * after the memory/notebook/laws steps, now before them) — harmless, because none of those
 * later steps read `opencode.json` back, and the phase-order gate only requires WIRE to log no
 * earlier than RENDER, which still holds since nothing after this logs a phase at all.
 *
 * `manifestExisted` only ever arrives from the per-repo caller; the global emit does not pass
 * it, so the pre-manifest header line stays unreachable from there.
 *
 * `overridesDir` is a THIRD directory, and it is not `dir` for the per-repo emit: the
 * per-repo `agent-overrides.json` lives beside the portable bundle in `out`, while every other
 * write in this layer goes under `.opencode/`. The global emit has no such split — `out` there
 * is only the legacy memory/notebook source, never a write target — so its `overridesDir`
 * equals `dir`.
 */
function opencodeLayer(cfg, items, themeName, theme, dir, owned, opts) {
  const {
    oldOwned, manifestExisted, agentPath, wireBase, overridesDir, oldDenies = [], oldEdit = { asks: [], shorthand: null },
    oldHashes = {}, oldGates = [],
  } = opts;
  ensureAgentOverridesStub(cfg, overridesDir);
  const overrides = loadAgentOverrides(overridesDir);
  // One claim for every writer below whose path lands in `owned` — see `claimer`.
  const claim = claimer(oldOwned, dir, manifestExisted, oldHashes, cfg.force);

  const { nAgents, nSkills, written, userOnlySkills } = writeNativeLayer(
    items, path.join(dir, 'agents'), path.join(dir, 'skills'), overrides,
    { host: 'opencode', theme, src: cfg.src, claim });
  for (const p of written) owned.push(relPosix(dir, p));

  const primary = writePrimaryAgent(cfg, path.join(dir, 'agents'), overrides, claim);
  if (primary) owned.push(relPosix(dir, primary));

  // Where a command's side-file pointer says the skill lives — Bob's rule (`emitClaudeRender`):
  // per repo relative to the workspace root, so a committed `.opencode/` holds on a teammate's
  // checkout; globally (`wireBase` IS `dir`) absolute.
  const skillDirOf = wireBase === dir ? (n) => path.join(dir, 'skills', n).split(path.sep).join('/')
    : (n) => relPosix(wireBase, path.join(dir, 'skills', n));
  const commands = writeCommandLayer(cfg, items, path.join(dir, 'command'), claim, skillDirOf);
  const ponytail = writePonytailCommand(path.join(dir, 'command'), claim);   // always-on /ponytail
  if (ponytail) commands.push(ponytail);
  for (const p of commands) owned.push(relPosix(dir, p));
  // Owned but not counted in `nCommands`, as an alias skill is not counted in `nSkills`.
  for (const p of writeAliasCommands(cfg, items, path.join(dir, 'command'), claim, skillDirOf)) owned.push(relPosix(dir, p));

  const themeDest = writeTheme(path.join(dir, 'themes'), themeName, theme, claim);
  if (themeDest) owned.push(relPosix(dir, themeDest));
  for (const p of writeColorThemes(cfg, path.join(dir, 'themes'), claim)) owned.push(relPosix(dir, p));

  const nPlugins = copyPlugins(cfg, path.join(dir, 'plugins'), owned, claim);
  const nWorkflows = copyWorkflows(cfg, path.join(dir, 'workflows'), owned, claim);

  // WIRE — the one file of this layer the user co-owns. `oldDenies` is the previous manifest's
  // `skill_denies`: the `permission.skill` denies Geneseed itself ADDED (final review — owning
  // `skills/<name>/SKILL.md` is not owning a deny the user put on that name). `staleSkillNames`
  // is the part of it this build no longer wants denied — the skill lost its user-only marker,
  // or was `--exclude-skills`'d. No record (a first emit, or an older manifest) sweeps nothing.
  phaseLog('WIRE');
  const staleSkillNames = oldDenies.filter((n) => !userOnlySkills.includes(n));
  const wired = {};
  const cfgName = path.basename(mergeOpencodeJson(path.join(wireBase, 'opencode.json'),
    agentPath, cfg.doctrines, cfg.excludeRules, userOnlySkills, staleSkillNames, wired,
    cfg.deletionGate, opencodeEditAsks(dir, wireBase === dir, wireBase === dir ? null : agentPath,
      cfg.doctrines, cfg.excludeRules), oldEdit, oldGates, cfg.pruneGates));
  // The next record: Geneseed's earlier denies still wanted, plus the ones it added now. A merge
  // that wrote nothing (`skillsAdded` unset) keeps the old record whole.
  const skillDenies = wired.skillsAdded
    ? [...new Set([...oldDenies.filter((n) => userOnlySkills.includes(n)), ...wired.skillsAdded])].sort()
    : oldDenies;

  return {
    nAgents, nSkills, nPlugins, nWorkflows, primary, nCommands: commands.length, cfgName,
    skillDenies, editRecord: wired.editRecord ?? oldEdit, editRefused: [...claim.editRefused],
    // As `skillDenies`: a merge that wrote nothing keeps the old record whole.
    bashGates: wired.bashGates ? [...wired.bashGates].sort() : oldGates,
    kept: [...claim.kept],
  };
}

// ---------------------------------------------------------------------------
// emit_opencode — the RENDER stage only
// ---------------------------------------------------------------------------

/**
 * RENDER and WIRE for `_build_emit.emit_opencode` — everything through `opencodeLayer`'s
 * `mergeOpencodeJson` call. PRUNE and MANIFEST are the driver's, in `bin/build-driver.mjs`.
 *
 * `oldOwned` and `manifestExisted` arrive in the job rather than being read here. The
 * manifest is the DRIVER's stage: it reads the file, hands the prior claim in, and prunes
 * and rewrites it after this returns. One owner of the file, and this function is not it.
 *
 * `nativeCatalog` likewise arrives decided. It is `hostCatalogsNatively('opencode')` from
 * `js/hosts/hosts.mjs`, resolved by the driver before the call; passing the decision rather
 * than re-reading the registry keeps one owner of it.
 */
export function emitOpencodeRender(cfg, job) {
  phaseLog('RENDER');
  const {
    theme: _theme, out, root, footprint, nativeCatalog, oldOwned, manifestExisted, agentPath,
    oldDenies, oldEdit, oldHashes = {}, oldGates = [],
  } = job;
  const oc = path.join(root, '.opencode');

  build(cfg, _theme, out, { footprint, nativeCatalog });

  // OpenCode loads agents/skills natively, so strip AGENT.md's per-row spec links to
  // plain names (the portable build keeps them). A deliberate de-link, not a fix.
  // Only the AGENT.md this build wrote: one it found there and kept is the user's, and this
  // rewrite changed its links, and its line endings on Windows.
  const agentMd = path.join(out, 'AGENT.md');
  if (isFile(agentMd) && bundleFiles(out)?.includes('AGENT.md')) {
    writeText(agentMd, stripCapabilityLinks(readText(agentMd)));
  }

  const owned = [];
  const { theme, items } = renderAll(cfg, _theme, { footprint, nativeCatalog });

  const {
    nAgents, nSkills, nPlugins, nWorkflows, primary, nCommands, cfgName, skillDenies, editRecord, editRefused, bashGates, kept,
  } = opencodeLayer(cfg, items, _theme, theme, oc, owned, {
    oldOwned, manifestExisted, agentPath, wireBase: root, overridesDir: out, oldDenies, oldEdit, oldHashes, oldGates,
  });

  return {
    owned,
    stats: {
      nAgents, nSkills, nPlugins, nWorkflows, nCommands, primary: !!primary,
    },
    cfgName,
    skillDenies,
    editRecord,
    editRefused,
    bashGates,
    kept,
  };
}

// ---------------------------------------------------------------------------
// emit_opencode_global — the ninth, and the last emit to cross
// ---------------------------------------------------------------------------

/**
 * BOTH halves of `_build_global.emit_opencode_global`, the "everything global, zero
 * per-repo" OpenCode deployment. PRUNE and MANIFEST are the driver's; there is no VERIFY,
 * because this emit writes no settings file.
 *
 * ASSEMBLY, NOT TRANSLATION. Every unit it needs already exists elsewhere (`_posture_body`
 * and `_mode_body`, for one, are `registerBody` in `js/build/render.mjs`); what is here is the
 * assembly and the values the caller must decide.
 *
 * `cfgDir` IS THE FIRST OF THEM. The suite and `harness diff` both redirect the OpenCode
 * config dir at a sandbox, so resolving it here would render 135 files into the
 * developer's real `~/.config/opencode`. The entry point resolves it once, before
 * anything else, and sends the answer: send the decision, never the resolver.
 *
 * `out` IS NOT THE TARGET, and with the default nobody can tell. `emit_opencode_global`
 * writes into `<cfg>` and takes `out` ONLY as the legacy bundle to migrate a memory or
 * notebook store from; the CLI's `--out` defaults to a directory this emit never writes a
 * byte into. A port that derived the legacy source from `<cfg>` would pass every cell that
 * leaves them coincident — the `claude/bundle-in-subfolder` finding at a third call site.
 *
 * `agentPath` travels for the same reason `emitOpencodeRender`'s does: it is WIRE's one
 * input, and it is a POSIX-style path.
 */
export function emitOpencodeGlobalRender(cfg, job) {
  phaseLog('RENDER');
  const {
    theme: themeName, cfgDir, out, footprint, nativeCatalog, oldOwned, agentPath, oldDenies, oldEdit,
    oldHashes = {}, oldGates = [],
  } = job;

  // No `lawsPrefix`: the standalone laws dir sits beside AGENT.md in <cfg>, so the lean
  // pointer's relative `laws/universal.md` resolves with no prefix.
  // A re-render of a deployed install sends that install's root, null included.
  const { sharedRoot = sharedRootFor(cfgDir, 'opencode') } = job;
  const { theme, items } = renderAll(cfg, themeName, { footprint, nativeCatalog, sharedRoot });
  assertSourceComplete(cfg, 'opencode-global');
  mkdirSync(cfgDir, { recursive: true });

  const owned = [];
  const agentText = items.find((i) => i.rel === 'AGENT.md' && i.text !== null)?.text ?? null;
  if (agentText !== null) {
    // OpenCode loads agents/skills natively, so drop AGENT.md's per-row spec links to
    // plain names. Memory LINKS stay relative: in the global layout AGENT.md and the host
    // store are siblings, so `memory/README.md` resolves from AGENT.md's own location and stays
    // hermetic. The shared store is named in code spans only (`pathTokens`), never as a link
    // target, which a doctor check would flag as an escape.
    const agentDest = path.join(cfgDir, 'AGENT.md');
    claimAndWrite(cfgDir, agentDest, 'AGENT.md', stripCapabilityLinks(agentText), owned);
  }
  // Co-owned, so never in `owned` — see `opencodeSentinelWrite`.
  opencodeSentinelWrite(cfgDir);

  // As in `emitClaudeRender`: before the skill layer claims anything.
  // `held`: the user's kept edits under a revived name, recorded again so they never lapse.
  const held = sharedRoot !== null ? pruneRetiredSkills('opencode', cfgDir, oldOwned) : [];

  // `manifestExisted` is deliberately not passed, so
  // the pre-manifest header line is unreachable from this emit.
  const {
    nAgents, nSkills, nPlugins, nWorkflows, primary, nCommands, cfgName, skillDenies, editRecord, editRefused, bashGates, kept,
  } = opencodeLayer(cfg, items, themeName, theme, cfgDir, owned, {
    oldOwned, agentPath, wireBase: cfgDir, overridesDir: cfgDir, oldDenies, oldEdit, oldHashes, oldGates,
  });

  const memStatus = globalMemory(cfgDir, items, out, cfg.src);
  ensureMemoryStore(path.join(cfgDir, 'memory'));
  const nbStatus = globalNotebook(cfgDir, items, out, cfg.src);
  ensureNotebookIndex(path.join(cfgDir, 'notebook'));
  ensureWikiStub(cfgDir);
  ensureRulesStub(cfgDir);
  ensureProfileStub(cfgDir);
  ensureExcludesStub(cfgDir);
  // As in `emitClaudeRender`: after the seeds.
  if (sharedRoot !== null) foldOnEmit('opencode', cfgDir);

  if (writeVersion(cfg, cfgDir) !== null) owned.push(VERSION_MARKER);

  shipLeanLaws(items, theme, cfgDir, owned, footprint);

  return {
    owned,
    stats: {
      nAgents, nSkills, nPlugins, nWorkflows, nCommands, primary: !!primary,
    },
    memStatus,
    nbStatus,
    cfgName,
    skillDenies,
    editRecord,
    editRefused,
    bashGates,
    kept: [...new Set([...kept, ...held])],
  };
}
