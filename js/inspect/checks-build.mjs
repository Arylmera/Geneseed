/**
 * The checks over what the BUILD produced — rendered bytes, themes, colours, links.
 *
 * Every export here answers with an array of problem strings, empty when it finds nothing.
 * That shape is the whole contract: `doctorCollect` in `doctor.mjs` concatenates them and
 * a clean run is byte-identical whichever check is missing, which is why each one is gated
 * by a PLANTED FAULT in `tests/unit/harness.test.mjs` rather than by a comparison.
 */
import path from 'node:path';
import { stripCapabilityLinks } from '../build/emit-common.mjs';
import { STRUCTURE, renderAll } from '../build/render.mjs';
import { CONFIG, CREDIT_RE, DESCRIPTION_LIMIT, makeCfg } from '../build/source.mjs';
import { CLAUDE_STYLE, HOSTS, hostCatalogsNatively, resolvePath } from '../hosts/hosts.mjs';
import {
  EMIT_HOST_SCOPE, footprintOfDir, installState, installTargets, readMaybe, renderedTier, themeFiles, tiersOfDir,
} from '../hosts/installs.mjs';
import { isVendoredPath, tierModel, loadAgentOverrides, loadTierMap } from '../hosts/native.mjs';
import { PALETTE_ROLES, colorThemeFiles } from '../hosts/opencode.mjs';
import { readText, withDiscardableStderr } from '../lib/fs.mjs';
import { parseJson, formatRepr } from '../lib/json.mjs';
import { renderedSharedRoot, sharedPaths } from '../lib/machine-dir.mjs';
import { normcase } from '../lib/paths.mjs';
import {
  ABS_LINK_RE, LINK_RE, NOTE, TOKEN_RE, has, isDir, isFile, rglob, sortedUnique, stemOf, stripCode, within,
} from './scan.mjs';
import { existsSync, readFileSync } from 'node:fs';

// --------------------------------------------------------------------------------------
// the checks
// --------------------------------------------------------------------------------------

/**
 * Dead links AND non-hermetic ones.
 *
 * Hermeticity is what lets a bundle be copied or subtree-split into any repo; a link that
 * escapes `out` breaks it silently. The two are separate messages because they have separate
 * causes, and a target that merely does not exist is the DEAD one — the absolute check runs
 * first and returns, so `~/x.md` never reaches the filesystem at all.
 */
export function linkProblems(md, text, out, rel) {
  const problems = [];
  for (const m of stripCode(text).matchAll(LINK_RE)) {
    const link = m[1];
    const raw = link.split('#')[0].trim();
    if (!raw) continue;
    if (ABS_LINK_RE.test(raw)) {
      problems.push(`non-hermetic absolute link '${link}' in ${rel}`);
      continue;
    }
    // `resolvePath`, not `path.resolve`, because it canonicalises the symlinks in the part
    // that exists and this comparison is against an `out` that went through the same call.
    const target = resolvePath(path.join(path.dirname(md), raw));
    if (!existsSync(target)) problems.push(`dead link '${link}' in ${rel}`);
    else if (!within(target, out)) {
      problems.push(`non-hermetic link '${link}' escapes the bundle in ${rel}`);
    }
  }
  return problems;
}

/**
 * Scan one rendered tree for unresolved tokens and bad links.
 *
 * `isVendored` decides which relative shape counts as a vendored folder, and the two callers
 * pass different ones ON PURPOSE: a `files`/opencode-global bundle nests skills at
 * `skills/<name>/…` and a per-repo native layer one level deeper at `.claude/skills/<name>/…`.
 * Vendored folders are verbatim upstream docs carrying their own license, and their internal
 * cross-links point at the upstream project's own files, so they are exempt.
 *
 * `rel` keeps the platform's separator, because that is what the messages print
 * — every emit-scan cell in the acceptance matrix names a backslash on Windows.
 */
export function checkBuild(themeName, out, isVendored = isVendoredPath) {
  const outAbs = resolvePath(out);
  const problems = [];
  for (const md of rglob(outAbs)) {
    if (!md.endsWith('.md') || !isFile(md)) continue;
    const rel = path.relative(outAbs, md);
    if (isVendored(rel)) {
      // Upstream docs are exempt, but a vendored SKILL.md's description is ours (the catalogue
      // line `vendoredWithCatalogueLine` writes) and is listed like any other skill's.
      if (path.basename(rel) === 'SKILL.md') {
        for (const p of descriptionProblems(readText(md), rel)) problems.push(`[${themeName}] ${p}`);
      }
      continue;
    }
    const text = readText(md);
    // Sorted per file: `doctorCollect` re-sorts everything anyway, but `validate` prints these
    // in the order they come back.
    for (const tok of sortedUnique(text.match(TOKEN_RE) ?? [])) {
      problems.push(`[${themeName}] unresolved token ${tok} in ${rel}`);
    }
    // `TOKEN_RE` cannot see a credit (colon, lowercase key): one left standing names no upstream.
    if (text.includes('{{CREDIT:')) {
      for (const tok of sortedUnique(text.match(CREDIT_RE) ?? ['{{CREDIT:'])) {
        problems.push(`[${themeName}] unresolved token ${tok} in ${rel}`);
      }
    }
    for (const p of linkProblems(md, text, outAbs, rel)) problems.push(`[${themeName}] ${p}`);
    for (const p of descriptionProblems(text, rel)) problems.push(`[${themeName}] ${p}`);
  }
  return problems;
}

/**
 * The `description:` of an emitted native skill or agent, held to Anthropic's skill-authoring
 * rules — it is the ONLY text a host routes on, so a defect here is a skill that silently
 * never fires. Three arms: a `…` ending is `withWhen`'s mid-sentence fallback (the trigger
 * was cut, cure it with a shorter first trigger sentence); an XML-looking tag is rejected
 * outright by the Agent Skills spec; a first/second-person pronoun is the point-of-view drift
 * the spec warns degrades discovery, since the text is injected into the system prompt.
 * The pronoun arm reads only the `Use when:` half, and skips quoted user phrases ("teach me
 * X" is what the user types, not the description's voice): the purpose half is the theme's
 * persona copy ("Make your own OpenCode theme"), authored per theme on purpose. A skill's
 * catalogue line (`src/skill-descriptions.json`) has no `Use when:` and no persona half: the
 * pronoun arm reads all of it.
 * A fourth arm, for a skill's `SKILL.md` only: the description is at most `DESCRIPTION_LIMIT`
 * characters. The model's skill listing has a budget, and the host drops the descriptions of
 * the least-used skills when it overruns; agents are listed apart and keep their own length.
 * Files without frontmatter (every bundle `.md`, AGENT.md) carry no description and pass.
 */
const DESC_LINE_RE = /^---\n(?:.*\n)*?description: (".*")\n(?:.*\n)*?---\n/;
const SKILL_FILE_RE = /(?:^|[\\/])skills[\\/][^\\/]+[\\/]SKILL\.md$/;
export function descriptionProblems(text, rel) {
  const m = text.match(DESC_LINE_RE);
  if (!m) return [];
  const desc = parseJson(m[1]);
  const problems = [];
  if (desc.endsWith('…')) problems.push(`description cut mid-sentence in ${rel} — shorten the first trigger sentence`);
  if (/<\/?[A-Za-z][^>]*>/.test(desc)) problems.push(`description carries an XML-like tag in ${rel}`);
  if (SKILL_FILE_RE.test(rel) && desc.length > DESCRIPTION_LIMIT) {
    problems.push(`description is ${desc.length} characters in ${rel}, over ${DESCRIPTION_LIMIT} — shorten its line in src/skill-descriptions.json`);
  }
  const when = desc.includes(' Use when: ') ? desc.split(' Use when: ')[1] : desc;
  if (/\b(I|I'm|me|my|you|you're|your)\b/i.test(when.replace(/"[^"]*"|\bI\/O\b/g, ''))) {
    problems.push(`description's "Use when" is not in the third person in ${rel}`);
  }
  return problems;
}

/**
 * Every theme defines the same VOICE keys.
 *
 * A token present in one theme map and missing from another renders as a raw `{{TOKEN}}`
 * only in the files that use it and only under that theme, so a plain build can miss it
 * entirely. The maps are compared directly, in every mode, whatever `--theme` scoped the rest
 * of the run to.
 */
export function themeParityProblems() {
  const themes = new Map();
  for (const p of themeFiles()) {
    let doc;
    try { doc = JSON.parse(readText(p)); } catch (e) {
      return [`[themes] ${path.basename(p)} unreadable: ${e.message}`];
    }
    themes.set(stemOf(p), doc);
  }
  if (themes.size < 2) return [];
  const allKeys = new Set();
  for (const t of themes.values()) for (const k of Object.keys(t)) allKeys.add(k);
  const problems = [];
  for (const [name, t] of themes) {
    for (const k of [...allKeys].filter((x) => !has(t, x)).sort()) {
      problems.push(`[themes] '${name}' missing key {${k}} (defined in another theme)`);
    }
  }
  return problems;
}

/** Anchored at BOTH ends, so `#12345` and `#1122334` both fail. */
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Every curated colour theme carries the full
 * palette, in 6-digit hex. Voice-theme parity, for colours.
 *
 * TWO OF ITS THREE ARMS ARE UNREACHABLE FROM ANY CELL, and it is doctor's own ordering that
 * makes them so: the opencode-global emit reads the same files (`writeColorThemes` ->
 * `palette[role]`) and runs BEFORE this check, so a palette that is missing a role, or
 * missing entirely, kills the emit rather than reaching here. The consumer is stricter than
 * the gate. Only the third arm — a value present and not `#rrggbb` — passes the emit through
 * to be reported.
 */
export function colorThemeProblems() {
  const problems = [];
  for (const p of colorThemeFiles(makeCfg())) {
    let spec;
    try { spec = JSON.parse(readText(p)); } catch (e) {
      problems.push(`[colors] ${path.basename(p)} unreadable: ${e.message}`);
      continue;
    }
    const pal = spec.palette;
    if (pal === null || typeof pal !== 'object' || Array.isArray(pal)) {
      problems.push(`[colors] ${path.basename(p)} has no 'palette' object`);
      continue;
    }
    for (const role of [...PALETTE_ROLES].filter((r) => !has(pal, r)).sort()) {
      problems.push(`[colors] '${stemOf(p)}' palette missing role '${role}'`);
    }
    for (const [role, val] of Object.entries(pal)) {
      if (!(typeof val === 'string' && HEX_RE.test(val))) {
        problems.push(`[colors] '${stemOf(p)}' role '${role}' is not #rrggbb hex: ${formatRepr(val)}`);
      }
    }
  }
  return problems;
}

/**
 * Each global install whose carrier names another tier than the one this process resolves: the
 * agent writes where the text says, the hooks read where the environment says. `$XDG_CONFIG_HOME`
 * moved, or the install rendered relative and the tier has since appeared. A NOTE, because a
 * rebuild clears it and `update` rolls a pull back on a doctor problem, and that rebuild comes
 * after its gate. A relative carrier with no tier is a pre-tier install and is consistent.
 */
export function renderedPathNotes() {
  const root = renderedSharedRoot();
  if (root === null) return [];
  const notes = [];
  for (const { host, configDir } of HOSTS) {
    let dir;
    try { dir = configDir(); } catch { continue; }
    if (readMaybe(path.join(dir, '.geneseed-emit'))?.trim() !== `${host}-global`) continue;
    const { text, root: rendered } = renderedTier(dir, host);
    if (!text.includes('user-rules.md')) continue;
    if (rendered === null ? isDir(sharedPaths().memory) : normcase(rendered) !== normcase(root)) {
      notes.push(`${NOTE}[shared-tier] ${host}: the carrier renders ${rendered ?? 'relative paths'}, `
        + `the run-time tier is ${root} — run geneseed rebuild-all`);
    }
  }
  return notes;
}

/**
 * Each Claude Code install, global or project, built `--tiers auto` whose tier alias cannot
 * resolve in this process's environment (spec D11, revised): a Bedrock or Vertex provider with no
 * `ANTHROPIC_DEFAULT_<ALIAS>_MODEL`. The build wrote the alias anyway, and Claude Code resolves it
 * to its built-in model id, which may not exist in the user's cloud project; this names the
 * variable to pin. A tier is skipped when every agent of it carries its own `agents.<name>.model`
 * pin, since no alias is then in play. A NOTE, not a problem: nothing is known to be broken.
 * `env` is a parameter so a test plants the provider without touching the real one.
 *
 * Which installs: `installTargets()` (the cwd, the registered project roots and every host's
 * global dir), each read at its own overrides dir: the config dir itself for a global install,
 * `<root>/.claude` for a project one (where the emit read the map from).
 */
export function tierEnvNotes(env = process.env) {
  const notes = [];
  let agents = null;   // the agent stems of each tier, rendered once, only when an install needs it
  for (const [host, scope, root] of installTargets()) {
    if (host !== 'claude' || installState(root, host, scope) !== 'active') continue;
    if (tiersOfDir(root, host) !== 'auto') continue;
    const dir = scope === 'global' ? root : path.join(root, '.claude');
    const map = loadTierMap(dir, () => {});
    const pins = loadAgentOverrides(dir);
    if (agents === null) {
      agents = { standard: [], light: [] };
      for (const { rel, tier = 'standard' } of renderAll(makeCfg(), 'neutral').items) {
        const m = /^agents\/([^_/][^/]*)\.md$/.exec(rel);
        if (m && agents[tier]) agents[tier].push(m[1]);
      }
    }
    for (const tier of ['standard', 'light']) {
      if (agents[tier].every((stem) => Object.hasOwn(pins, stem) && pins[stem]?.model)) continue;
      const { warning } = tierModel(tier, map, env, 'claude');
      const where = scope === 'global' ? host : `${host} (project ${root})`;
      if (warning) notes.push(`${NOTE}[tiers] ${where}: ${warning}`);
    }
  }
  return notes;
}

/**
 * A committed bundle must match a fresh render of
 * `src/` for its OWN recorded theme, emit and footprint.
 *
 * Doctor's temp builds never touch the committed bundle, so drift there is invisible to
 * every other check. All three values are read back off the bundle's own markers rather than
 * assumed, and each for the same reason: assuming one reports every file as drifted the
 * moment that default moves, which is a diagnosis about this function rather than about the
 * bundle. The emit marker is the one that took longest to learn — a host that catalogues
 * capabilities to the model itself gets AGENT.md's tables collapsed to a pointer, and the
 * OpenCode emits additionally strip the per-row spec links, so rendering the portable shape
 * and comparing it against an OpenCode bundle reports AGENT.md stale on EVERY run with no
 * rebuild able to clear it.
 *
 * Host-state files (context.json, MEMORY.md, the markers) are created once and never
 * rendered (MEMORY.md's one later write is `migrateMemoryIndex` moving a flat index to
 * topics), so they are not in the render set and are correctly ignored. Notebook files
 * except its `.gitignore` are seed-once and agent-owned after the first build, so they are
 * compared only for EXISTENCE.
 */
export function renderedProblems(bundle) {
  if (!isDir(bundle)) return [];
  const cfg = makeCfg();
  const marker = path.join(bundle, '.geneseed-theme');
  let themeName;
  if (existsSync(marker)) themeName = readText(marker).trim();
  else if (existsSync(CONFIG)) themeName = parseJson(readText(CONFIG))?.theme ?? 'neutral';
  else themeName = 'neutral';
  let emit;
  try { emit = readText(path.join(bundle, '.geneseed-emit')).trim(); } catch { emit = ''; }
  const [host, scope] = EMIT_HOST_SCOPE.get(emit) ?? ['', ''];
  // A Claude-shaped PROJECT install is not a bundle: its tree is `AGENTS.md`/`CLAUDE.md` plus a
  // `.bob/`/`.claude/`/`.openclaude/` data dir, so every rendered file reads "missing" and no
  // rebuild can clear it. The console's onboarding once put a Bob project install exactly here
  // (`./Harness` under the checkout, reported 2026-10: 178 such lines). Its own drift is
  // `geneseed diff`'s and `status`'s to report, not this committed-bundle check's.
  if (scope === 'project' && CLAUDE_STYLE.includes(host)) return [];
  let items;
  try {
    // THIS CALLER CATCHES A REFUSAL, and that is why the stderr is buffered. The
    // convention is to write at the raise site (`loadTheme`, and its docblock says why),
    // which is right for every caller that lets the throw propagate
    // and wrong for exactly this one. Buffered and replayed on success, so a WARN the render
    // legitimately emits still reaches the user, and discarded with the refusal it belongs to.
    ({ items } = withDiscardableStderr(() => renderAll(cfg, themeName, {
      footprint: footprintOfDir(bundle), nativeCatalog: hostCatalogsNatively(host), host,
      // The bundle's own root, like its theme and footprint: `renderedPathNotes` judges that value,
      // and a second verdict here would call every file stale for one moved directory.
      sharedRoot: scope === 'global' ? renderedTier(bundle, host).root : null,
    })));
  } catch (e) {
    // `except SystemExit` — `effectiveTheme` refuses an unknown theme, and the driver's
    // marker for a deliberate refusal is the `exitCode` this port already uses everywhere.
    if (e && e.exitCode !== undefined) {
      return [`[rendered] cannot render theme '${themeName}' for ${path.basename(bundle)}/`];
    }
    throw e;
  }
  const problems = [];
  const nbDirname = STRUCTURE.DIR_NOTEBOOK ?? 'notebook';
  for (const { rel: outRel, text: rendered, src } of items) {
    const dest = path.join(bundle, outRel);
    const parts = outRel.split('/');
    const name = path.basename(bundle);
    if (!existsSync(dest)) {
      problems.push(`[rendered] ${name}/${outRel} missing — rebuild the bundle`);
    } else if (parts[0] === nbDirname && parts[parts.length - 1] !== '.gitignore') {
      continue;   // seed-once, agent-owned: a rewrite is not drift
    } else if (rendered !== null) {
      // The OpenCode emits de-link AGENT.md's per-row table entries after rendering, so the
      // bundle on disk legitimately differs from `renderAll`'s output for this one file.
      const text = host === 'opencode' && outRel === 'AGENT.md'
        ? stripCapabilityLinks(rendered) : rendered;
      if (readText(dest) !== text) {
        problems.push(`[rendered] ${name}/${outRel} stale (differs from a fresh render) `
          + '— rebuild');
      }
    } else if (!readFileSync(dest).equals(readFileSync(src))) {
      problems.push(`[rendered] ${name}/${outRel} stale — rebuild`);
    }
  }
  return problems;
}

