/**
 * The Claude and Bob emits — one renderer, and the settings merge that wires it in.
 *
 * Split out of `emit.mjs` beside `emit-opencode.mjs`, over the shared writers in
 * `emit-common.mjs`. `claudeWire` is the half that touches a file the USER also edits, and
 * its prior-claim pruning is the reason `deepEquals` exists — read it before changing anything here.
 */
import path from 'node:path';
import { VERSION_MARKER } from '../hosts/hosts.mjs';
import { loadAgentOverrides, writeNativeLayer } from '../hosts/native.mjs';
import { ensureAgentOverridesStub } from '../hosts/opencode.mjs';
import {
  managedBlockRemove, managedBlockWrite, mergeClaudeSettings, unwireClaudeExcludes,
  unwireClaudeSettings, wireClaudeExcludes,
} from '../hosts/settings.mjs';
import { writeText } from '../lib/fs.mjs';
import { isTruthy } from '../lib/json.mjs';
import { assertSourceComplete, phaseLog } from './bundle.mjs';
import {
  get, globalMemory, globalNotebook, isDict, relPosix, shipLeanLaws, stripCapabilityLinks,
} from './emit-common.mjs';
import { renderAll, renderFile } from './render.mjs';
import {
  BOB_RULES_STUB, ensureExcludesStub, ensureMemoryIndex, ensureNotebookIndex, ensureProfileStub,
  ensureRulesStub, ensureWikiStub,
} from './stubs.mjs';
import { writeVersion } from './version.mjs';
import { existsSync, mkdirSync } from 'node:fs';

// ---------------------------------------------------------------------------
// _emit_claude_core — both halves
// ---------------------------------------------------------------------------

/**
 * The RENDER half of `_build_global._emit_claude_core`: everything up to (not including)
 * the CLAUDE.md managed-block merge. WIRE, PRUNE, MANIFEST and VERIFY stay in Python.
 *
 * Six emits route through here — claude, bob and copilot at both scopes — so this one
 * job is what puts two thirds of the matrix on the seam.
 *
 * `claudeMdText` is the payload's one item that is not a file this process wrote. WIRE
 * needs the managed block's text, and that text is a RENDER (`prefixedAgentText`
 * re-renders AGENT.md with every store dir prefixed), so it is computed here and merged
 * there. `emitOpencodeRender` needed nothing of the kind — its wired file is derived from
 * a path, not from a render.
 */
export function emitClaudeRender(cfg, job) {
  phaseLog('RENDER');
  const {
    theme: themeName, cfgDir, claudeMd, scope, out, footprint, host, nativeCatalog,
    oldOwned,
  } = job;

  // `os.path.relpath(cfg, claude_md.parent)` — note the reversed argument order, and
  // that Python answers '.' for an identical pair where `path.relative` answers ''.
  const relCfg = path.relative(path.dirname(claudeMd), cfgDir).split(path.sep).join('/')
    || '.';
  const lawsPrefix = relCfg === '.' ? '' : `${relCfg}/`;
  const { theme, items } = renderAll(cfg, themeName, { footprint, lawsPrefix, nativeCatalog });
  assertSourceComplete(cfg, `claude-${scope}`);
  mkdirSync(cfgDir, { recursive: true });

  /** `_emit_claude_core._prefixed_agent_text`. */
  const prefixedAgentText = (prefix) => {
    const tmplItem = items.find((i) => i.rel === 'AGENT.md');
    if (tmplItem === undefined) return null;
    // Deliberately NOT the same lookup as `agentText` below: that one skips an
    // AGENT.md whose text is null, this one does not. Unreachable today (`.md` is a
    // text suffix, so the render is never null) and reproduced anyway, because the two
    // spellings sit four lines apart in the Python and only one of them filters.
    //
    // The fast path itself is byte-inert, measured: removing it re-renders with a theme
    // whose DIR_* tokens gained an EMPTY prefix and with the same lawsPrefix, so it
    // produces exactly the item's own text. The mutation stays green, and that is
    // "nothing to detect" rather than "the gate cannot see it" — recorded the way
    // `themed_rel` and `lstripNewlines` are, so the two verdicts stay distinguishable.
    if (!prefix) return tmplItem.text;
    const ptheme = { ...theme };
    for (const tok of ['DIR_LAWS', 'DIR_AGENTS', 'DIR_SKILLS', 'DIR_MEMORY', 'DIR_NOTEBOOK']) {
      ptheme[tok] = prefix + (ptheme[tok] ?? tok.split('_').slice(1).join('_').toLowerCase());
    }
    // Same catalogue decision as the renderAll above — a re-render that forgot it would
    // quietly put the stripped tables back.
    return renderFile(cfg, tmplItem.src, ptheme, footprint, '', new Set(), nativeCatalog);
  };

  const owned = [];
  const agentText = items.find((i) => i.rel === 'AGENT.md' && i.text !== null)?.text ?? null;
  const isBob = host === 'bob';
  const isCopilot = host === 'copilot';

  // Bob's always-injected channel is the rules folder. At GLOBAL scope rules/geneseed.md
  // IS the preamble (a global ~/.bob/AGENTS.md is not auto-loaded), and its pointers need
  // a `../` prefix because it sits one level below the stores; at PROJECT scope it is the
  // slim shadow stub whose only job is to have the same filename.
  if (isBob && agentText !== null) {
    const rulesMd = path.join(cfgDir, 'rules', 'geneseed.md');
    mkdirSync(path.dirname(rulesMd), { recursive: true });
    writeText(rulesMd, scope === 'project' ? BOB_RULES_STUB
      : stripCapabilityLinks(cfg, prefixedAgentText('../') || agentText));
    owned.push('rules/geneseed.md');
  }

  ensureAgentOverridesStub(cfg, cfgDir);
  // Bob's agents/skills use the Claude dialect verbatim; Copilot has its own frontmatter.
  // `manifestExisted` is deliberately not passed: the Python does not pass it either, so
  // the pre-manifest header line is unreachable from this emit on both sides.
  const { nAgents, nSkills, written } = writeNativeLayer(
    items, path.join(cfgDir, 'agents'), path.join(cfgDir, 'skills'),
    loadAgentOverrides(cfgDir),
    { host: isCopilot ? 'copilot' : 'claude', oldOwned, cfg: cfgDir, src: cfg.src });
  for (const p of written) owned.push(relPosix(cfgDir, p));

  const memStatus = globalMemory(cfgDir, items, out, cfg.src);
  ensureMemoryIndex(path.join(cfgDir, 'memory'));
  const nbStatus = globalNotebook(cfgDir, items, out, cfg.src);
  ensureNotebookIndex(path.join(cfgDir, 'notebook'));
  ensureWikiStub(cfgDir);
  ensureRulesStub(cfgDir);
  ensureProfileStub(cfgDir);
  ensureExcludesStub(cfgDir);

  // Project hygiene, claim-on-create: an existing (possibly user-authored) .gitignore is
  // never rewritten, but one we created stays owned across re-emits.
  if (scope === 'project') {
    const gi = path.join(cfgDir, '.gitignore');
    const giLines = (host === 'claude' ? ['settings.local.json'] : [])
      .concat(['wiki.jsonc', 'agent-overrides.json']);
    if (!existsSync(gi)) {
      writeText(gi, `${giLines.join('\n')}\n`);
      owned.push('.gitignore');
    } else if (oldOwned.includes('.gitignore')) {
      owned.push('.gitignore');
    }
  }

  writeVersion(cfg, cfgDir);
  owned.push(VERSION_MARKER);

  shipLeanLaws(items, theme, cfgDir, owned, footprint);

  // The last render of the emit, and the only one whose product is not written here.
  // Bob at GLOBAL scope gets no managed block at all, so nothing is rendered for it —
  // the condition is the merge's, kept here so RENDER produces exactly what WIRE
  // consumes and no more.
  let claudeMdText = null;
  if (agentText !== null && !(isBob && scope === 'global')) {
    claudeMdText = stripCapabilityLinks(cfg, prefixedAgentText(lawsPrefix) || agentText);
  }

  // WIRE — see `claudeWire` below. One child per emit, so the two halves are two
  // functions rather than two spawns; the seam between them is a call, not a process.
  const managed = claudeWire(job, claudeMdText, agentText !== null, cfg.doctrines,
    cfg.excludeRules);

  return {
    owned,
    stats: { nAgents, nSkills },
    memStatus,
    nbStatus,
    hasAgentText: agentText !== null,
    claudeMdText,
    managed,
  };
}

/**
 * `_build_global._claude_wire_py` — the files the Claude-shaped emits do NOT own: the
 * CLAUDE.md/AGENTS.md managed block and settings(.local).json.
 *
 * Everything the render half wrote, it wrote wholesale. Everything here reconciles
 * Geneseed's claim with content it did not write. The return value is `managed`, the claim
 * set Python records in the manifest so every teardown path unwires exactly what was wired
 * — which is why WIRE must precede MANIFEST, and why `managed` travels back rather than
 * being recomputed.
 *
 * `preambleExclude` arrives decided and is NOT derived here. Python computes it from
 * `_PREAMBLE_CONFIG_DIR`, which resolves through `_build_core._claude_config_dir` — an
 * `_OWNED` name precisely because the suite redirects it at a sandbox. Resolving `~/.claude`
 * on this side would write the developer's REAL CLAUDE.md path into a test's exclude list
 * and suppress it. Third phase running that a name had to travel rather than be re-derived
 * (`STRUCTURE` at P2d, `capabilityLinkRe` at P2e); this one edits a file the user co-owns.
 *
 * `GENESEED_STACK_GLOBAL` is read from the environment on BOTH sides — the child inherits
 * `process.env`, so the opt-out reaches here without travelling in the job. `isTruthy` is
 * not needed for it: Python tests `os.environ.get(...)` for truthiness and an env var is
 * always a string, so `''` is the only falsy value either language sees.
 */
function claudeWire(job, claudeMdText, hasAgentText, doctrines = null, excludeRules = []) {
  phaseLog('WIRE');
  const { cfgDir, claudeMd, scope, host, oldManaged, preambleExclude, hookOpts } = job;
  const old = oldManaged && typeof oldManaged === 'object' && !Array.isArray(oldManaged)
    ? oldManaged : {};
  const isBob = host === 'bob';
  const isCopilot = host === 'copilot';
  const managed = {};

  // CLAUDE.md — Claude auto-loads it by location; merge as a delimited block so any user
  // prose around it survives. `claudeMdText` is the render half's product; it is null
  // exactly when no block is to be written.
  // Exception — Bob GLOBAL: Bob never auto-loads a global ~/.bob/AGENTS.md, so a global
  // copy is pure disk weight; none is written, and a re-emit self-heals the one an older
  // install carries.
  if (claudeMdText !== null) {
    managedBlockWrite(claudeMd, claudeMdText);
    // No sticky "whole" flag: teardown always excises the block and deletes the file only
    // when nothing else remains — a whole-file delete would eat prose the user added AFTER
    // Geneseed created the file.
    //
    // `os.path.relpath(claude_md, cfg).replace(os.sep, '/')`. Python answers '.' where
    // `path.relative` answers '' for an identical pair, the same guard `lawsPrefix` needs
    // above — unreachable here (CLAUDE.md is a file, cfgDir a directory, so the pair is
    // never identical) and spelled anyway, because the two call sites are 400 lines apart
    // and only one of them is obviously safe.
    const rel = path.relative(cfgDir, claudeMd).split(path.sep).join('/') || '.';
    managed.claude_md = { rel };
  } else if (isBob && scope === 'global' && isTruthy(get(old, 'claude_md'))) {
    const oldCm = isDict(get(old, 'claude_md')) ? get(old, 'claude_md') : {};
    // `.resolve()` on the Python side; `path.resolve` is its counterpart and both are
    // applied to a path already built from an absolute cfgDir.
    const victim = path.resolve(cfgDir, get(oldCm, 'rel') || path.basename(claudeMd));
    managedBlockRemove(victim);
  }

  // Hooks embed machine-absolute paths. At PROJECT scope for Claude they go into
  // settings.local.json — the personal, untracked file — never the team-shared
  // settings.json, which would hand every teammate failing hooks pointing at this machine's
  // python. (Bob documents no local variant, so it keeps settings.json.) Copilot has NO
  // settings.json and no hook mechanism at all, so the whole stage is skipped: nothing
  // written, no settings_* keys recorded for the lifecycle to unwire.
  if (!isCopilot) {
    const settingsName = scope === 'project' && !isBob ? 'settings.local.json' : 'settings.json';
    const settingsPath = path.join(cfgDir, settingsName);
    managed.settings_file = settingsName;
    // Migration: an older install wired hooks/excludes into a different file — unwire the
    // recorded claims there, or they linger (and run) forever.
    const oldSf = get(old, 'settings_file') || 'settings.json';
    if (oldSf !== settingsName) {
      unwireClaudeSettings(path.join(cfgDir, oldSf), get(old, 'settings_hooks') || []);
      unwireClaudeExcludes(path.join(cfgDir, oldSf), get(old, 'settings_excludes') || []);
    }
    // The merge prunes recorded groups that are no longer canonical and returns the
    // COMPLETE current claim set — store it as-is; unioning with prior would resurrect the
    // stale claims.
    // `doctrines` decides whether the git-gate group is part of the canonical claim set. It
    // travels from `cfg` rather than being re-read off the deployment: this is the emit that
    // DECIDES the install's packs, so the marker on disk is still the previous build's.
    const [, managedHooks] = mergeClaudeSettings(
      settingsPath, scope, oldSf === settingsName ? get(old, 'settings_hooks') : null, hookOpts,
      doctrines, excludeRules,
    );
    managed.settings_hooks = managedHooks;

    // Project-bypasses-global (Claude only): a PROJECT install suppresses the GLOBAL
    // ~/.claude/CLAUDE.md while cwd is this repo, via Claude's native claudeMdExcludes.
    // Written only when this run actually emitted the project's own preamble (never
    // suppress with no replacement); GENESEED_STACK_GLOBAL=1 opts out, and a re-emit with
    // it set strips a prior exclude. Bob never gets one: its bypass is the same-named
    // workspace rules file.
    const priorRaw = get(old, 'settings_excludes');
    const priorExcl = Array.isArray(priorRaw) ? priorRaw : [];
    if (scope === 'project' && hasAgentText && preambleExclude) {
      const wantExcl = [preambleExclude];
      if (process.env.GENESEED_STACK_GLOBAL) {
        unwireClaudeExcludes(settingsPath, wantExcl);
        managed.settings_excludes = [];
      } else {
        const addedExcl = wireClaudeExcludes(settingsPath, wantExcl);
        // Claim only what Geneseed itself wired (prior + newly added) — folding `wantExcl`
        // in unconditionally would claim a user's own pre-existing exclude, and uninstall
        // would then strip it. `sorted(set(a) | set(b))` — Python sorts strings by code
        // point and so does the default `Array.sort`, which is why no comparator is passed.
        managed.settings_excludes = [...new Set([...priorExcl, ...addedExcl])].sort();
      }
    } else if (priorExcl.length && isBob) {
      // Self-heal older Bob installs: earlier versions wrote the global AGENTS.md into
      // claudeMdExcludes here. The key is Claude-only and its Bob semantics are unknown, so
      // a re-emit removes it instead of carrying it forward.
      unwireClaudeExcludes(settingsPath, priorExcl);
    } else if (priorExcl.length) {
      managed.settings_excludes = priorExcl;
    }
  }
  return managed;
}

