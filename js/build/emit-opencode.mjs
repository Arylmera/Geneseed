/**
 * The OpenCode emits — a project's `.opencode/` and the global config directory.
 *
 * Split out of `emit.mjs` beside `emit-claude.mjs`, over the shared writers in
 * `emit-common.mjs`. The two are siblings on purpose: an emit that is right for one host and
 * wrong for the other is the defect these have historically carried, and it reads far more
 * plainly as two files with the same shape than as two sections of one.
 */
import path from 'node:path';
import { VERSION_MARKER } from '../hosts/hosts.mjs';
import { loadAgentOverrides, writeNativeLayer } from '../hosts/native.mjs';
import {
  copyPlugins, copyWorkflows, ensureAgentOverridesStub, writeColorThemes, writeCommandLayer,
  writePonytailCommand, writePrimaryAgent, writeTheme,
} from '../hosts/opencode.mjs';
import { mergeOpencodeJson } from '../hosts/settings.mjs';
import { readText, writeText } from '../lib/fs.mjs';
import { assertSourceComplete, build, phaseLog } from './bundle.mjs';
import {
  globalMemory, globalNotebook, isFile, relPosix, shipLeanLaws, stripCapabilityLinks,
} from './emit-common.mjs';
import { renderAll } from './render.mjs';
import {
  ensureExcludesStub, ensureMemoryIndex, ensureNotebookIndex, ensureProfileStub, ensureRulesStub,
  ensureWikiStub,
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
 * it, matching the Python side, so the pre-manifest header line stays unreachable from there on
 * both sides.
 *
 * `overridesDir` is a THIRD directory, and it is not `dir` for the per-repo emit: the
 * per-repo `agent-overrides.json` lives beside the portable bundle in `out`, while every other
 * write in this layer goes under `.opencode/`. The global emit has no such split — `out` there
 * is only the legacy memory/notebook source, never a write target — so its `overridesDir`
 * equals `dir`.
 */
function opencodeLayer(cfg, items, themeName, theme, dir, owned, opts) {
  const {
    oldOwned, manifestExisted, agentPath, wireBase, overridesDir,
  } = opts;
  ensureAgentOverridesStub(cfg, overridesDir);
  const overrides = loadAgentOverrides(overridesDir);

  const { nAgents, nSkills, written } = writeNativeLayer(
    items, path.join(dir, 'agents'), path.join(dir, 'skills'), overrides,
    { host: 'opencode', oldOwned, cfg: dir, manifestExisted, theme, src: cfg.src });
  for (const p of written) owned.push(relPosix(dir, p));

  const primary = writePrimaryAgent(cfg, path.join(dir, 'agents'), overrides);
  if (primary) owned.push(relPosix(dir, primary));

  const commands = writeCommandLayer(cfg, items, path.join(dir, 'command'));
  commands.push(writePonytailCommand(path.join(dir, 'command')));   // always-on /ponytail
  for (const p of commands) owned.push(relPosix(dir, p));

  owned.push(relPosix(dir, writeTheme(path.join(dir, 'themes'), themeName, theme)));
  for (const p of writeColorThemes(cfg, path.join(dir, 'themes'))) owned.push(relPosix(dir, p));

  const nPlugins = copyPlugins(cfg, path.join(dir, 'plugins'), owned);
  const nWorkflows = copyWorkflows(cfg, path.join(dir, 'workflows'), owned);

  // WIRE — the one file of this layer the user co-owns.
  phaseLog('WIRE');
  const cfgName = path.basename(mergeOpencodeJson(path.join(wireBase, 'opencode.json'),
    agentPath, cfg.doctrines, cfg.excludeRules));

  return {
    nAgents, nSkills, nPlugins, nWorkflows, primary, nCommands: commands.length, cfgName,
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
 * `nativeCatalog` likewise arrives decided. It is `HOSTS['opencode']['native_catalog']` from
 * `js/hosts/hosts.mjs`, resolved by the driver before the call; passing the decision rather
 * than re-reading the registry keeps one owner of it.
 */
export function emitOpencodeRender(cfg, job) {
  phaseLog('RENDER');
  const {
    theme: _theme, out, root, footprint, nativeCatalog, oldOwned, manifestExisted, agentPath,
  } = job;
  const oc = path.join(root, '.opencode');

  build(cfg, _theme, out, { footprint, nativeCatalog });

  // OpenCode loads agents/skills natively, so strip AGENT.md's per-row spec links to
  // plain names (the portable build keeps them). A deliberate de-link, not a fix.
  const agentMd = path.join(out, 'AGENT.md');
  if (isFile(agentMd)) writeText(agentMd, stripCapabilityLinks(readText(agentMd)));

  const owned = [];
  const { theme, items } = renderAll(cfg, _theme);

  const {
    nAgents, nSkills, nPlugins, nWorkflows, primary, nCommands, cfgName,
  } = opencodeLayer(cfg, items, _theme, theme, oc, owned, {
    oldOwned, manifestExisted, agentPath, wireBase: root, overridesDir: out,
  });

  return {
    owned,
    stats: {
      nAgents, nSkills, nPlugins, nWorkflows, nCommands, primary: !!primary,
    },
    cfgName,
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
 * ASSEMBLY, NOT TRANSLATION. Every unit it needs was already here — 58 of the 65 functions
 * in its Python closure, counted with `ast` rather than by name-mapping, which is how the
 * scout that produced this list first reported `_posture_body` and `_mode_body` as missing
 * when both are `registerBody` in `js/build/render.mjs`. What is new is the assembly and the
 * three values that had to be decided on the Python side.
 *
 * `cfgDir` IS THE FIRST OF THEM AND THE REASON THE OTHERS WERE ASKED ABOUT.
 * `_build_core._opencode_config_dir` is an `_OWNED` name — the suite and `harness diff`
 * both redirect it at a sandbox — so resolving it here would render 135 files into the
 * developer's real `~/.config/opencode`. Python's entry point resolves it once, before
 * anything else, and sends the answer. Fourth phase running (`STRUCTURE` at P2d,
 * `capabilityLinkRe` at P2e, `_PREAMBLE_CONFIG_DIR` at P3b): send the decision, never the
 * resolver.
 *
 * `out` IS NOT THE TARGET, and with the default nobody can tell. `emit_opencode_global`
 * writes into `<cfg>` and takes `out` ONLY as the legacy bundle to migrate a memory or
 * notebook store from; the CLI's `--out` defaults to a directory this emit never writes a
 * byte into. A port that derived the legacy source from `<cfg>` would pass every cell that
 * leaves them coincident — the `claude/bundle-in-subfolder` finding at a third call site.
 *
 * `agentPath` travels for the same reason `emitOpencodeRender`'s does: it is WIRE's one
 * input, and `Path.as_posix()` is the Python side's spelling of it.
 */
export function emitOpencodeGlobalRender(cfg, job) {
  phaseLog('RENDER');
  const {
    theme: themeName, cfgDir, out, footprint, nativeCatalog, oldOwned, agentPath,
  } = job;

  // No `lawsPrefix`: the standalone laws dir sits beside AGENT.md in <cfg>, so the lean
  // pointer's relative `laws/universal.md` resolves with no prefix.
  const { theme, items } = renderAll(cfg, themeName, { footprint, nativeCatalog });
  assertSourceComplete(cfg, 'opencode-global');
  mkdirSync(cfgDir, { recursive: true });

  const owned = [];
  const agentText = items.find((i) => i.rel === 'AGENT.md' && i.text !== null)?.text ?? null;
  if (agentText !== null) {
    // OpenCode loads agents/skills natively, so drop AGENT.md's per-row spec links to
    // plain names. Memory links stay RELATIVE: in the global layout AGENT.md and the
    // store are siblings, so `memory/` resolves from AGENT.md's own location and stays
    // hermetic — no absolute path a doctor check would flag as an escape.
    writeText(path.join(cfgDir, 'AGENT.md'), stripCapabilityLinks(agentText));
    owned.push('AGENT.md');
  }

  // `manifestExisted` is deliberately not passed — the Python does not pass it either, so
  // the pre-manifest header line is unreachable from this emit on both sides.
  const {
    nAgents, nSkills, nPlugins, nWorkflows, primary, nCommands, cfgName,
  } = opencodeLayer(cfg, items, themeName, theme, cfgDir, owned, {
    oldOwned, agentPath, wireBase: cfgDir, overridesDir: cfgDir,
  });

  const memStatus = globalMemory(cfgDir, items, out, cfg.src);
  ensureMemoryIndex(path.join(cfgDir, 'memory'));
  const nbStatus = globalNotebook(cfgDir, items, out, cfg.src);
  ensureNotebookIndex(path.join(cfgDir, 'notebook'));
  ensureWikiStub(cfgDir);
  ensureRulesStub(cfgDir);
  ensureProfileStub(cfgDir);
  ensureExcludesStub(cfgDir);

  writeVersion(cfg, cfgDir);
  owned.push(VERSION_MARKER);

  shipLeanLaws(items, theme, cfgDir, owned, footprint);

  return {
    owned,
    stats: {
      nAgents, nSkills, nPlugins, nWorkflows, nCommands, primary: !!primary,
    },
    memStatus,
    nbStatus,
    cfgName,
  };
}
