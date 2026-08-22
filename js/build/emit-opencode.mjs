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
import { copyPlugins, copyWorkflows, ensureAgentOverridesStub, writeColorThemes, writeCommandLayer, writePonytailCommand, writePrimaryAgent, writeTheme } from '../hosts/opencode.mjs';
import { mergeOpencodeJson } from '../hosts/settings.mjs';
import { readText, writeText } from '../lib/fs.mjs';
import { assertSourceComplete, build, phaseLog } from './bundle.mjs';
import { globalMemory, globalNotebook, isFile, relPosix, shipLeanLaws, stripCapabilityLinks } from './emit-common.mjs';
import { renderAll } from './render.mjs';
import { ensureExcludesStub, ensureMemoryIndex, ensureNotebookIndex, ensureProfileStub, ensureRulesStub, ensureWikiStub } from './stubs.mjs';
import { writeVersion } from './version.mjs';
import { mkdirSync } from 'node:fs';

// ---------------------------------------------------------------------------
// emit_opencode — the RENDER stage only
// ---------------------------------------------------------------------------

/**
 * The RENDER half of `_build_emit.emit_opencode`: everything up to (not including) the
 * `_merge_opencode_json` call. WIRE, PRUNE and MANIFEST stay in Python.
 *
 * `oldOwned` and `manifestExisted` arrive in the job rather than being read here. The
 * manifest is Python's stage — it writes it, prunes against it, and now reads it too, so
 * there is one owner of the file instead of two processes racing to interpret it.
 *
 * `nativeCatalog` likewise arrives decided. It is `HOSTS['opencode']['native_catalog']`,
 * and the HOSTS registry stays Python this phase; passing the decision keeps the registry
 * in exactly one place rather than duplicating it for one boolean.
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
  if (isFile(agentMd)) writeText(agentMd, stripCapabilityLinks(cfg, readText(agentMd)));

  const owned = [];
  const { theme, items } = renderAll(cfg, _theme);

  ensureAgentOverridesStub(cfg, out);
  const overrides = loadAgentOverrides(out);

  const { nAgents, nSkills, written } = writeNativeLayer(
    items, path.join(oc, 'agents'), path.join(oc, 'skills'), overrides,
    { host: 'opencode', oldOwned, cfg: oc, manifestExisted, theme, src: cfg.src });
  for (const p of written) owned.push(relPosix(oc, p));

  const primary = writePrimaryAgent(cfg, path.join(oc, 'agents'), overrides);
  if (primary) owned.push(relPosix(oc, primary));

  const commands = writeCommandLayer(cfg, items, path.join(oc, 'command'));
  commands.push(writePonytailCommand(path.join(oc, 'command')));   // always-on /ponytail
  for (const p of commands) owned.push(relPosix(oc, p));

  owned.push(relPosix(oc, writeTheme(path.join(oc, 'themes'), _theme, theme)));
  for (const p of writeColorThemes(cfg, path.join(oc, 'themes'))) owned.push(relPosix(oc, p));

  const nPlugins = copyPlugins(cfg, path.join(oc, 'plugins'), owned);
  const nWorkflows = copyWorkflows(cfg, path.join(oc, 'workflows'), owned);

  // WIRE — the one file of this emit the user co-owns. `agentPath` arrives decided
  // (`_rel_under` is the Python side by design), and only the BASENAME is consumed
  // downstream: `opencode.json`, or the `.jsonc` sibling when that is what is on disk.
  phaseLog('WIRE');
  const cfgName = path.basename(mergeOpencodeJson(path.join(root, 'opencode.json'), agentPath,
    cfg.doctrines, cfg.excludeRules));

  return {
    owned,
    stats: {
      nAgents, nSkills, nPlugins, nWorkflows, nCommands: commands.length, primary: !!primary,
    },
    cfgName,
  };
}

// ---------------------------------------------------------------------------
// emit_opencode_global — the ninth, and the last emit to cross
// ---------------------------------------------------------------------------

/**
 * BOTH halves of `_build_global.emit_opencode_global`, the "everything global, zero
 * per-repo" OpenCode deployment. PRUNE and MANIFEST stay in Python; there is no VERIFY,
 * because this emit writes no settings file.
 *
 * ASSEMBLY, NOT TRANSLATION. Every unit it needs was already here — 58 of the 65 functions
 * in its Python closure, counted with `ast` rather than by name-mapping, which is how the
 * scout that produced this list first reported `_posture_body` and `_mode_body` as missing
 * when both are `registerBody` in `js/render.mjs`. What is new is the assembly and the
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
    writeText(path.join(cfgDir, 'AGENT.md'), stripCapabilityLinks(cfg, agentText));
    owned.push('AGENT.md');
  }

  ensureAgentOverridesStub(cfg, cfgDir);
  const overrides = loadAgentOverrides(cfgDir);

  // `manifestExisted` is deliberately not passed — the Python does not pass it either, so
  // the pre-manifest header line is unreachable from this emit on both sides.
  const { nAgents, nSkills, written } = writeNativeLayer(
    items, path.join(cfgDir, 'agents'), path.join(cfgDir, 'skills'), overrides,
    { host: 'opencode', oldOwned, cfg: cfgDir, theme, src: cfg.src });
  for (const p of written) owned.push(relPosix(cfgDir, p));

  const primary = writePrimaryAgent(cfg, path.join(cfgDir, 'agents'), overrides);
  if (primary) owned.push(relPosix(cfgDir, primary));

  const commands = writeCommandLayer(cfg, items, path.join(cfgDir, 'command'));
  commands.push(writePonytailCommand(path.join(cfgDir, 'command')));   // always-on /ponytail
  for (const p of commands) owned.push(relPosix(cfgDir, p));

  owned.push(relPosix(cfgDir, writeTheme(path.join(cfgDir, 'themes'), themeName, theme)));
  for (const p of writeColorThemes(cfg, path.join(cfgDir, 'themes'))) {
    owned.push(relPosix(cfgDir, p));
  }

  const nPlugins = copyPlugins(cfg, path.join(cfgDir, 'plugins'), owned);
  const nWorkflows = copyWorkflows(cfg, path.join(cfgDir, 'workflows'), owned);

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

  // WIRE — the one file of this emit the user co-owns, and the last render is now behind
  // us. Inlined the way `emitOpencodeRender`'s is (one call, the same merge, the same
  // file name), while the Python side keeps it a separate `_opencode_global_wire_py`:
  // that split is what `tests/test_emit_phase_order.py` walks, and it walks the Python.
  phaseLog('WIRE');
  const cfgName = path.basename(mergeOpencodeJson(path.join(cfgDir, 'opencode.json'),
    agentPath, cfg.doctrines, cfg.excludeRules));

  return {
    owned,
    stats: {
      nAgents, nSkills, nPlugins, nWorkflows, nCommands: commands.length, primary: !!primary,
    },
    memStatus,
    nbStatus,
    cfgName,
  };
}

